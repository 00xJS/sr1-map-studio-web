// Health-check worker. One worker (the lead) builds the floor graph and
// writes the report; every worker, the lead included, checks a share of the
// sight lines. See client.ts for the order of the messages.
import { Bvh } from './bvh'
import { finishMap, prepareMap, type Prepared } from './analyze'
import { observe, type SightCounts } from './sight'
import type { AnalysisInput, AnalysisOptions, HealthReport } from './types'

export type AnalysisRequest =
  | { id: number; kind: 'prepare'; input: AnalysisInput; opts: Omit<AnalysisOptions, 'onProgress'> }
  | { id: number; kind: 'load'; tris: Float32Array; flags: Uint8Array }
  | { id: number; kind: 'observe'; pos: Float32Array; nodes: Int32Array; observers: Int32Array; maxSight: number }
  | { id: number; kind: 'finish'; counts: SightCounts; sightMs: number }
  | { id: number; kind: 'drop' }

export type AnalysisReply =
  | { id: number; kind: 'progress'; text: string; done: number }
  | { id: number; kind: 'prepared'; pos: Float32Array; nodes: Int32Array; observers: Int32Array }
  | { id: number; kind: 'counts'; counts: SightCounts }
  | { id: number; kind: 'report'; report: HealthReport }
  | { id: number; kind: 'error'; message: string }

let job: { id: number; bvh: Bvh; prepared?: Prepared } | null = null

const post = (m: AnalysisReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)

self.onmessage = (e: MessageEvent<AnalysisRequest>) => {
  const m = e.data
  try {
    switch (m.kind) {
      case 'prepare': {
        const opts: AnalysisOptions = { ...m.opts, onProgress: (text, done) => post({ id: m.id, kind: 'progress', text, done }) }
        const prepared = prepareMap(m.input, opts)
        job = { id: m.id, bvh: prepared.bvh, prepared }
        post({ id: m.id, kind: 'prepared', pos: prepared.g.grid.pos, nodes: prepared.reachList, observers: prepared.observers })
        break
      }
      case 'load':
        job = { id: m.id, bvh: new Bvh(m.tris, m.flags) }
        break
      case 'observe': {
        if (job?.id !== m.id) throw new Error('The map was not loaded in this worker')
        const counts = observe(job.bvh, m.pos, m.nodes, m.observers, m.maxSight, (done) => post({ id: m.id, kind: 'progress', text: 'Checking sight lines', done }))
        post({ id: m.id, kind: 'counts', counts }, [counts.stand.buffer, counts.crouch.buffer])
        break
      }
      case 'finish': {
        const p = job?.id === m.id ? job.prepared : undefined
        if (!p) throw new Error('The map was not prepared in this worker')
        p.ms.sight = m.sightMs
        p.opts.onProgress = (text, done) => post({ id: m.id, kind: 'progress', text, done })
        const report = finishMap(p, m.counts)
        job = null
        post({ id: m.id, kind: 'report', report })
        break
      }
      case 'drop':
        if (job?.id === m.id) job = null
        break
    }
  } catch (err) {
    post({ id: m.id, kind: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
