// Health-check worker. One worker (the lead) builds the floor graph and
// writes the report; every worker, the lead included, checks a share of the
// sight lines. See client.ts for the order of the messages.
// Play's "Race the bots" asks one for a floor graph and the walking cost to
// each pickup ('floor'; see src/play/bots.ts).
import { Bvh } from './bvh'
import { finishMap, prepareMap, type Prepared } from './analyze'
import { buildFloor, dijkstraTo, LETHAL_DROP, nodeNear } from './floor'
import { observe, type SightCounts } from './sight'
import type { AnalysisInput, AnalysisOptions, HealthReport } from './types'
import type { Vec3 } from '../project'

export type AnalysisRequest =
  | { id: number; kind: 'prepare'; input: AnalysisInput; opts: Omit<AnalysisOptions, 'onProgress'> }
  | { id: number; kind: 'load'; tris: Float32Array; flags: Uint8Array }
  | { id: number; kind: 'observe'; pos: Float32Array; nodes: Int32Array; observers: Int32Array; maxSight: number; within?: number }
  | { id: number; kind: 'finish'; counts: SightCounts; sightMs: number }
  | { id: number; kind: 'drop' }
  | { id: number; kind: 'floor'; tris: Float32Array; flags: Uint8Array; goals: Vec3[]; starts: Vec3[] }

export type AnalysisReply =
  | { id: number; kind: 'progress'; text: string; done: number }
  | { id: number; kind: 'prepared'; pos: Float32Array; nodes: Int32Array; observers: Int32Array }
  | { id: number; kind: 'counts'; counts: SightCounts }
  | { id: number; kind: 'report'; report: HealthReport }
  | { id: number; kind: 'error'; message: string }
  | { id: number; kind: 'floor'; graph: RaceGraph }

/** A floor graph for bots: node positions and edges (floor.ts), each goal's node and walking-cost field, each start's node. */
export interface RaceGraph {
  pos: Float32Array; edgeStart: Int32Array; edgeTo: Int32Array; edgeCost: Float32Array
  goals: Int32Array; fields: Float32Array[]; starts: Int32Array
}

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
        const counts = observe(job.bvh, m.pos, m.nodes, m.observers, m.maxSight, (done) => post({ id: m.id, kind: 'progress', text: 'Checking sight lines', done }), m.within)
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
      case 'floor': {
        const bvh = new Bvh(m.tris, m.flags)
        const area = Math.max(1, (bvh.max[0] - bvh.min[0]) * (bvh.max[2] - bvh.min[2]))
        // The health check's cell size (1 m on most maps), so bots walk where its routes go.
        const g = buildFloor(bvh, Math.max(2, Math.ceil(Math.sqrt(area / 90000) * 2) / 2), LETHAL_DROP)
        const goals = Int32Array.from(m.goals.map((p) => nodeNear(g, p[0], p[1], p[2])))
        const fields = Array.from(goals, (n) => (n >= 0 ? dijkstraTo(g, [n]) : new Float32Array(g.grid.count).fill(Infinity)))
        const starts = Int32Array.from(m.starts.map((p) => nodeNear(g, p[0], p[1], p[2])))
        const graph: RaceGraph = { pos: g.grid.pos, edgeStart: g.edgeStart, edgeTo: g.edgeTo, edgeCost: g.edgeCost, goals, fields, starts }
        post({ id: m.id, kind: 'floor', graph }, [...fields.map((f) => f.buffer), graph.pos.buffer, graph.edgeStart.buffer, graph.edgeTo.buffer, graph.edgeCost.buffer])
        break
      }
    }
  } catch (err) {
    post({ id: m.id, kind: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
