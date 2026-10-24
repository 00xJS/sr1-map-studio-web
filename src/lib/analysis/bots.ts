// Bot playtest: a few simple bots spawn, run for a weapon, then roam between
// weapons, drop-offs and spawns along (nearly) shortest walks, and now and
// then die and respawn. Where they ran is a guess at where players will run.
// They spawn by the game's rules (spawnPick.ts): each bot keeps its own clock
// (running time, plus the 5 s wait after dying), and the others count as
// standing where they last got to.
import { dijkstraTo, type FloorGraph } from './floor'
import { rng } from './sight'
import { pickSpawn, type SpawnSpot } from './spawnPick'
import { RESPAWN_DELAY_MS, RUN_SPEED } from '../player'
import type { Team } from './types'
import type { Vec3 } from '../project'

/** `spawnTeams`: whose each spawn is (default: all shared). */
export interface Interest { spawns: number[]; weapons: number[]; drops: number[]; spawnTeams?: Team[] }

/** `field(goal)` gives the walking cost from every node to a goal (pass a cached one to share the work). */
export function botPlaytest(g: FloorGraph, at: Interest, o: { bots: number; trips: number; seed: number; field?: (goal: number) => Float32Array }): { traffic: Float32Array; hotspots: Vec3[] } {
  const n = g.grid.count
  const counts = new Float32Array(n)
  const keep = at.spawns.map((_, k) => k).filter((k) => at.spawns[k] >= 0)
  const spawns = keep.map((k) => at.spawns[k])
  const places = [...new Set([...at.weapons, ...at.drops, ...spawns].filter((s) => s >= 0))]
  if (!spawns.length || places.length < 2) return { traffic: counts, hotspots: [] }
  const rand = rng(o.seed)
  const field = o.field ?? fieldCache(g)
  const P = g.grid.pos
  const xyz = (v: number): Vec3 => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]
  // Free-for-all at the shared spawns when there are any (or only one team has spawns), else two teams.
  const teams = keep.map((k) => at.spawnTeams?.[k] ?? 'shared')
  const ffa = teams.includes('shared') || !teams.includes('red') || !teams.includes('blue')
  const spots: SpawnSpot[] = spawns.map((s, k) => ({ at: xyz(s), team: ffa && !teams.includes('shared') ? 'shared' : teams[k] }))
  const teamOf = (b: number): Team => (ffa ? 'shared' : b % 2 ? 'blue' : 'red')
  /** A random goal, nearer ones likelier. */
  const choose = (from: number, list: number[]) => {
    const w = list.map((p) => (p === from ? 0 : 1 / (field(p)[from] + 30)))
    let total = 0
    for (const x of w) if (Number.isFinite(x)) total += x
    if (!total) return -1
    let r = rand() * total
    for (let i = 0; i < list.length; i++) { if (!Number.isFinite(w[i])) continue; r -= w[i]; if (r <= 0) return list[i] }
    return -1
  }
  const { edgeStart, edgeTo, edgeCost } = g
  const cell = g.grid.cell
  /** Runs from `from` to `goal`, counting every spot on the way; false if there is no way. */
  const run = (from: number, goal: number) => {
    const f = field(goal)
    if (!Number.isFinite(f[from])) return false
    let u = from
    for (let guard = 0; u !== goal && guard < n; guard++) {
      counts[u]++
      let best = -1, bestScore = Infinity
      for (let e = edgeStart[u]; e < edgeStart[u + 1]; e++) {
        const v = edgeTo[e]
        if (!(f[v] < f[u])) continue
        // A little randomness spreads the bots over equally good routes.
        const score = f[v] + edgeCost[e] + rand() * cell * 0.8
        if (score < bestScore) { bestScore = score; best = v }
      }
      if (best < 0) break
      u = best
    }
    counts[goal]++
    return true
  }
  const bots = Math.max(1, o.bots)
  const pos = new Array<number>(bots).fill(-1)
  const clock = new Float64Array(bots)
  /** Where bot b (re)spawns, by the game's rules, with the other bots where they are. */
  const spawn = (b: number, from?: Vec3) => {
    const others = pos.flatMap((p, k) => (k !== b && p >= 0 ? [{ at: xyz(p), team: teamOf(k) }] : []))
    let s = pickSpawn(spots, teamOf(b), others, clock[b], rand, from)
    if (s < 0) s = Math.floor(rand() * spots.length)
    spots[s].used = clock[b]
    return spawns[s]
  }
  for (let b = 0; b < bots; b++) pos[b] = spawn(b)
  const armed = new Array<boolean>(bots).fill(false)
  for (let trip = 0, fails = 0; trip < o.trips && fails < o.trips; ) {
    const b = trip % bots
    const goal = !armed[b] && at.weapons.length ? choose(pos[b], at.weapons) : choose(pos[b], places)
    const walk = goal >= 0 ? field(goal)[pos[b]] : Infinity
    if (goal < 0 || !run(pos[b], goal)) { fails++; clock[b] += RESPAWN_DELAY_MS; pos[b] = spawn(b, xyz(pos[b])); continue }
    trip++
    clock[b] += (walk / RUN_SPEED) * 1000
    pos[b] = goal
    armed[b] = true
    // Killed now and then: after the wait, back to a spawn by the game's rules, unarmed.
    if (rand() < 0.25) { clock[b] += RESPAWN_DELAY_MS; pos[b] = spawn(b, xyz(pos[b])); armed[b] = false }
  }
  // 0..1 against the busiest few percent, so one crowded corner doesn't wash the rest out.
  const sorted = Array.from(counts).filter((c) => c > 0).sort((a, b) => a - b)
  const top = sorted.length ? sorted[Math.floor(sorted.length * 0.98)] || sorted[sorted.length - 1] : 1
  const traffic = new Float32Array(n)
  for (let i = 0; i < n; i++) traffic[i] = Math.min(1, counts[i] / top)
  return { traffic, hotspots: hotspots(g, counts) }
}

/** Walking cost to a goal, worked out once per goal. */
export function fieldCache(g: FloorGraph): (goal: number) => Float32Array {
  const fields = new Map<number, Float32Array>()
  return (goal) => {
    let f = fields.get(goal)
    if (!f) { f = dijkstraTo(g, [goal]); fields.set(goal, f) }
    return f
  }
}

/** The busiest spots, at least 12 m apart. */
function hotspots(g: FloorGraph, counts: Float32Array, count = 5): Vec3[] {
  const P = g.grid.pos
  const order = Array.from(counts.keys()).filter((i) => counts[i] > 0).sort((a, b) => counts[b] - counts[a])
  const out: Vec3[] = []
  for (const i of order) {
    const p: Vec3 = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]
    if (out.some((q) => Math.hypot(q[0] - p[0], q[2] - p[2]) < 24)) continue
    out.push(p)
    if (out.length >= count) break
  }
  return out
}
