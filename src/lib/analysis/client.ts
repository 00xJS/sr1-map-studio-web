// Runs the health checks off the main thread: the lead worker builds the
// floor graph while the others build their ray trees, then every worker
// checks a share of the sight lines, and the lead writes the report.
import { loadModel } from '../assets'
import type { ObjModel } from '../geometry'
import type { Project } from '../project'
import { SIGHT_FROM, SIGHT_TO, WITHIN } from './analyze'
import { collisionFromProject } from './collision'
import { mergeCounts, type SightCounts } from './sight'
import type { AnalysisInput, AnalysisOptions, HealthReport } from './types'
import type { AnalysisReply, AnalysisRequest } from './analysis.worker'

let pool: Worker[] = []
let nextId = 1

function workers(): Worker[] {
  if (!pool.length) {
    const n = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1))
    pool = Array.from({ length: n }, () => new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' }))
  }
  return pool
}

/** Stops a check that is running (its promise rejects). */
export function cancelAnalysis() {
  pool.forEach((w) => w.terminate())
  pool = []
  cancelled?.(new Error('Stopped'))
}
let cancelled: ((e: Error) => void) | null = null

/** The same as analyzeMap, in workers. */
export function analyzeInWorkers(input: AnalysisInput, opts: AnalysisOptions = {}): Promise<HealthReport> {
  const { onProgress, ...plain } = opts
  const ws = workers()
  const id = nextId++
  const lead = ws[0]
  const send = (w: Worker, m: AnalysisRequest, transfer: Transferable[] = []) => w.postMessage(m, transfer)
  return new Promise<HealthReport>((resolve, reject) => {
    const share = new Array<number>(ws.length).fill(0)
    const parts: SightCounts[] = []
    let sightStart = 0
    const done = (fn: () => void) => { ws.forEach((w) => { w.onmessage = null; w.onerror = null }); cancelled = null; fn() }
    cancelled = (e) => done(() => reject(e))
    ws.forEach((w, k) => {
      w.onerror = (e) => done(() => reject(new Error(e.message || 'The health check stopped')))
      w.onmessage = (e: MessageEvent<AnalysisReply>) => {
        const m = e.data
        if (m.id !== id) return
        switch (m.kind) {
          case 'progress':
            if (m.text === 'Checking sight lines') {
              share[k] = m.done
              onProgress?.(m.text, SIGHT_FROM + ((SIGHT_TO - SIGHT_FROM) * share.reduce((a, b) => a + b, 0)) / ws.length)
            } else onProgress?.(m.text, m.done)
            break
          case 'prepared': {
            // Observers were shuffled, so even slices take about the same time.
            sightStart = performance.now()
            const per = Math.ceil(m.observers.length / ws.length)
            ws.forEach((x, i) => send(x, { id, kind: 'observe', pos: m.pos, nodes: m.nodes, observers: m.observers.slice(i * per, (i + 1) * per), maxSight: plain.maxSight ?? 300, within: plain.within ?? WITHIN }))
            break
          }
          case 'counts':
            parts.push(m.counts)
            if (parts.length === ws.length) {
              const counts = mergeCounts(parts)
              send(lead, { id, kind: 'finish', counts, sightMs: Math.round(performance.now() - sightStart) }, [counts.stand.buffer, counts.crouch.buffer])
            }
            break
          case 'report':
            ws.slice(1).forEach((x) => send(x, { id, kind: 'drop' }))
            done(() => resolve(m.report))
            break
          case 'error':
            ws.forEach((x) => send(x, { id, kind: 'drop' }))
            done(() => reject(new Error(m.message)))
            break
        }
      }
    })
    send(lead, { id, kind: 'prepare', input, opts: plain })
    ws.slice(1).forEach((w) => send(w, { id, kind: 'load', tris: input.tris, flags: input.flags }))
  })
}

/** Health checks for a project: loads its models, then runs the checks in workers. */
export async function analyzeProject(project: Project, opts: AnalysisOptions = {}): Promise<HealthReport> {
  opts.onProgress?.('Reading the map', 0)
  const paths = [...new Set(project.scene_items.filter((it) => !it.collision_disabled).map((it) => it.path))]
  const models = new Map<string, ObjModel>()
  await Promise.all(paths.map(async (p) => { try { models.set(p, await loadModel(project, p)) } catch { /* missing file: left out */ } }))
  const input = collisionFromProject(project, (p) => models.get(p))
  if (!input.flags.length) throw new Error('There is nothing solid to check yet: add a floor or start from a sample map.')
  return analyzeInWorkers(input, opts)
}
