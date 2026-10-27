// "Race the bots": a few bots run for the same pickups as the player. The
// analysis worker builds the walking graph of the map's floor (analysis/floor.ts,
// from the same collision the health check uses) and, for every pickup, the
// walking cost from everywhere to it (dijkstraTo). Each bot heads for the
// untaken pickup it can reach soonest, stepping downhill on that field at the
// player's running speed, then walks the last bit straight onto the marker.
// Bots don't shoot: Play has no combat.
import { loadModel } from '../lib/assets'
import { collisionFromProject } from '../lib/analysis/collision'
import type { AnalysisReply, AnalysisRequest, RaceGraph } from '../lib/analysis/analysis.worker'
import type { ObjModel } from '../lib/geometry'
import { RUN_SPEED } from '../lib/player'
import type { Project, Vec3 } from '../lib/project'
import { targets, touches, type Pickup, type RunState } from './game'

export const BOT_COLORS = [0xff8a1f, 0x2fc7c0, 0xe0473e, 0x8ad14f]
export const BOT_NAMES = ['Bot Orange', 'Bot Teal', 'Bot Red', 'Bot Lime']

/** Builds the race graph for a map's run targets in a worker. `starts`: where bots may begin. */
export async function raceGraph(project: Project, goals: Vec3[], starts: Vec3[]): Promise<RaceGraph> {
  const paths = [...new Set(project.scene_items.filter((it) => !it.collision_disabled).map((it) => it.path))]
  const models = new Map<string, ObjModel>()
  await Promise.all(paths.map(async (p) => { try { models.set(p, await loadModel(project, p)) } catch { /* missing: left out */ } }))
  const input = collisionFromProject(project, (p) => models.get(p))
  if (!input.flags.length) throw new Error('This map has no floor for the bots to run on.')
  const w = new Worker(new URL('../lib/analysis/analysis.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<RaceGraph>((resolve, reject) => {
      w.onerror = (e) => reject(new Error(e.message || 'Working out the bots’ routes failed.'))
      w.onmessage = (e: MessageEvent<AnalysisReply>) => {
        if (e.data.kind === 'floor') resolve(e.data.graph)
        else if (e.data.kind === 'error') reject(new Error(e.data.message))
      }
      const m: AnalysisRequest = { id: 1, kind: 'floor', tris: input.tris, flags: input.flags, goals, starts }
      w.postMessage(m, [input.tris.buffer, input.flags.buffer])
    })
  } finally { w.terminate() }
}

export interface Bot {
  /** 1 and up (0 is the player). */
  id: number
  at: Vec3
  heading: number
  /** Ground speed this frame, units/s (for the walk animation). */
  speed: number
  /** The node it stands on or last left, and the one it is walking to (-1: none). */
  node: number
  next: number
  /** How far along node -> next, 0..1. */
  k: number
  /** The pickup it is after (index in the race's targets), or -1. */
  goal: number
  /** Breaks ties between equally good steps differently for each bot. */
  jitter: number
}

/** Moves bots over a race graph. Pure apart from the graph; the session draws them. */
export class RaceBots {
  bots: Bot[] = []

  constructor(private g: RaceGraph, private pickupIds: string[], count: number, startNodes: number[]) {
    const starts = startNodes.filter((n) => n >= 0)
    for (let i = 0; i < count && starts.length; i++) {
      const n = starts[i % starts.length]
      this.bots.push({ id: i + 1, at: this.xyz(n), heading: 0, speed: 0, node: n, next: -1, k: 0, goal: -1, jitter: (i * 0.37) % 1 })
    }
  }

  private xyz(n: number): Vec3 { const p = this.g.pos; return [p[n * 3], p[n * 3 + 1], p[n * 3 + 2]] }

  /** Advances every bot by `dt` seconds toward the untaken targets of `run`. */
  step(dt: number, run: RunState) {
    const open = targets(run)
    const want = this.pickupIds.map((id) => open.find((p) => p.id === id && !p.taken) ?? null)
    for (const b of this.bots) {
      const before: Vec3 = [...b.at]
      if (run.started === null || run.finished !== null) { b.speed = 0; continue }
      // Re-aim whenever the current goal is gone (or at every node, in case another got nearer).
      if (b.goal < 0 || !want[b.goal] || b.next < 0) b.goal = this.nearest(b.node, want)
      let left = dt * RUN_SPEED
      for (let guard = 0; left > 1e-6 && b.goal >= 0 && guard < 64; guard++) {
        const f = this.g.fields[b.goal]
        const target = want[b.goal]!
        if (b.next < 0) {
          if (f[b.node] <= 0) { left = this.approach(b, target, left); break }
          b.next = this.downhill(b, f)
          if (b.next < 0) { b.goal = -1; break }
          b.k = 0
        }
        const cost = Math.max(1e-3, this.edgeCost(b.node, b.next))
        const need = (1 - b.k) * cost
        if (left < need) { b.k += left / cost; left = 0 }
        else { left -= need; b.node = b.next; b.next = -1; b.k = 0; b.goal = this.nearest(b.node, want) }
      }
      if (b.next >= 0) {
        const a = this.xyz(b.node), c = this.xyz(b.next)
        b.at = [a[0] + (c[0] - a[0]) * b.k, a[1] + (c[1] - a[1]) * b.k, a[2] + (c[2] - a[2]) * b.k]
      } else if (b.goal < 0 || this.g.fields[b.goal][b.node] > 0) b.at = this.xyz(b.node)
      const dx = b.at[0] - before[0], dz = b.at[2] - before[2], d = Math.hypot(dx, dz)
      if (d > 1e-4) b.heading = Math.atan2(-dx, -dz)
      b.speed = dt > 0 ? d / dt : 0
    }
  }

  /** The reachable untaken target with the shortest walk, or -1. */
  private nearest(node: number, want: (Pickup | null)[]): number {
    let best = -1, cost = Infinity
    for (let i = 0; i < want.length; i++) {
      if (!want[i] || this.g.goals[i] < 0) continue
      const c = this.g.fields[i][node]
      if (c < cost) { cost = c; best = i }
    }
    return best
  }

  /** The neighbour that gets closest to the goal (cost so far plus what is left). */
  private downhill(b: Bot, f: Float32Array): number {
    const { edgeStart, edgeTo, edgeCost } = this.g
    let best = -1, score = Infinity
    for (let e = edgeStart[b.node]; e < edgeStart[b.node + 1]; e++) {
      const v = edgeTo[e]
      if (!(f[v] < f[b.node])) continue
      const s = f[v] + edgeCost[e] + ((v * 2654435761 + b.id) % 97) * 0.002 * b.jitter
      if (s < score) { score = s; best = v }
    }
    return best
  }

  private edgeCost(u: number, v: number): number {
    const { edgeStart, edgeTo, edgeCost } = this.g
    for (let e = edgeStart[u]; e < edgeStart[u + 1]; e++) if (edgeTo[e] === v) return edgeCost[e]
    return Math.hypot(...this.xyz(v).map((x, i) => x - this.xyz(u)[i]) as Vec3)
  }

  /** At the goal's node: walk straight at the marker until touching it. Returns the distance left over. */
  private approach(b: Bot, p: Pickup, left: number): number {
    if (touches(p, b.at)) return 0
    const dx = p.at[0] - b.at[0], dz = p.at[2] - b.at[2], d = Math.hypot(dx, dz)
    const go = Math.min(left, Math.max(0, d - p.radius * 0.5))
    if (go <= 0) return 0
    b.at = [b.at[0] + (dx / d) * go, b.at[1], b.at[2] + (dz / d) * go]
    return left - go
  }
}
