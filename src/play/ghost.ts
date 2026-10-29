// Time-trial ghosts: where the player was through a timed run, as
// [t, x, y, z, heading] samples (t in ms from the run's start, positions in
// editor units at the feet), and the checks a time must pass before it goes on
// a link's board. Pure: shared by the browser and the share function.
import type { Marker, Vec3 } from '../lib/project'
import { SPRINT_SPEED } from '../lib/player'
import { pickupsOf, type RunMode } from './game'

export type GhostSample = [t: number, x: number, y: number, z: number, heading: number]

/** Samples a ghost keeps at most; a long run thins its samples out to fit. */
export const GHOST_MAX = 4000
/** Time between samples at first, ms. */
export const GHOST_STEP = 100
/** Shortest and longest times a board takes, ms. */
export const TIME_MIN = 1000
export const TIME_MAX = 3600_000
/** Name on a board. */
export const NAME_MAX = 24

const r2 = (v: number) => Math.round(v * 100) / 100
const r3 = (v: number) => Math.round(v * 1000) / 1000

/** Records a run as it goes: call `add` every frame once the clock runs, `finish` at the end. */
export class GhostRecorder {
  samples: GhostSample[] = []
  private step = GHOST_STEP

  /** `t`: ms on the run's clock. Keeps a sample every `step` ms. */
  add(t: number, at: Vec3, heading: number) {
    const last = this.samples[this.samples.length - 1]
    if (last && t - last[0] < this.step) return
    this.push(t, at, heading)
  }

  /** The last sample, at the finishing time. */
  finish(t: number, at: Vec3, heading: number) {
    const last = this.samples[this.samples.length - 1]
    if (last && last[0] >= t) this.samples.pop()
    this.push(t, at, heading)
  }

  private push(t: number, at: Vec3, heading: number) {
    this.samples.push([Math.round(t), r2(at[0]), r2(at[1]), r2(at[2]), r3(heading)])
    if (this.samples.length >= GHOST_MAX) {
      // Keep every other sample (and the newest), and sample half as often from now on.
      this.samples = this.samples.filter((_, i, a) => i % 2 === 0 || i === a.length - 1)
      this.step *= 2
    }
  }
}

/** Where a ghost is at `t` ms, between its samples. */
export function ghostAt(g: GhostSample[], t: number): { at: Vec3; heading: number } | null {
  if (!g.length) return null
  if (t <= g[0][0]) return { at: [g[0][1], g[0][2], g[0][3]], heading: g[0][4] }
  const last = g[g.length - 1]
  if (t >= last[0]) return { at: [last[1], last[2], last[3]], heading: last[4] }
  let lo = 0, hi = g.length - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (g[mid][0] <= t) lo = mid; else hi = mid }
  const a = g[lo], b = g[hi]
  const k = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0
  let dh = b[4] - a[4]
  while (dh > Math.PI) dh -= Math.PI * 2
  while (dh < -Math.PI) dh += Math.PI * 2
  return { at: [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k], heading: a[4] + dh * k }
}

// ---------------- checks ----------------

export interface TimeEntry { mode: RunMode; ms: number; name: string; ghost: unknown }

/** Fastest the player moves across the ground, with room for slopes, frame hitches and pushes (editor units/s). */
const MAX_SPEED = SPRINT_SPEED * 1.35
/** Extra distance allowed between two samples whatever the time (editor units). */
const SLACK = 0.6
/** Pressing R (or falling off the world) puts you back at the run's spawn: a jump that ends this near it is allowed. */
const SPAWN_NEAR = 3
/** Height above the feet of the wall check: above any step, ledge or low wall a jump gets over (editor units). */
const BODY = 2.4
/** The side rays of the wall check, either side of the path: a corner cut between two samples misses one of them. */
const SIDE = 0.5
const SPAWNS = ['Shared spawn', 'Red team spawn', 'Blue team spawn']

export const cleanName = (name: unknown): string =>
  typeof name === 'string' ? name.replace(/\p{Cc}/gu, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : ''

/** Distance on the ground from p to the segment a-b, and how far along it the nearest point is (0..1). */
function toSegment(p: Vec3, a: GhostSample, b: GhostSample): { d: number; k: number } {
  const ax = a[1], az = a[3], dx = b[1] - ax, dz = b[3] - az
  const len = dx * dx + dz * dz
  const k = len > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[2] - az) * dz) / len)) : 0
  return { d: Math.hypot(p[0] - (ax + dx * k), p[2] - (az + dz * k)), k }
}

/** True when the straight line a -> b crosses the map's solid collision (ghostWalls.ts builds one from a share). */
export type WallTest = (a: Vec3, b: Vec3) => boolean
/**
 * How long a time's wall check may take: a map can be built so that every ray passes near many triangles, and a
 * run has thousands of steps. Past this the time is refused, not checked half way.
 */
export const WALL_CHECK_MS = 2000

/**
 * Problems with a time for a link's board (empty when it can go on): the run
 * exists on this map, the ghost is well formed, starts at a spawn, ends at the
 * time given, never moves faster than a sprint, passes every target and, with
 * `walls`, never goes through a wall.
 */
export function checkTime(e: TimeEntry, markers: Marker[], walls?: WallTest): string[] {
  const problems: string[] = []
  if (e.mode !== 'weapons' && e.mode !== 'dropoffs') return ['Only weapon and drop-off runs have boards.']
  const kind = e.mode === 'weapons' ? 'weapon' : 'dropoff'
  const targets = pickupsOf(markers).filter((p) => p.kind === kind)
  if (!targets.length) return ['This map has no such run.']
  if (!Number.isInteger(e.ms) || e.ms < TIME_MIN || e.ms > TIME_MAX) problems.push('The time is out of range.')
  if (!cleanName(e.name)) problems.push('Add a name for the board.')
  const g = e.ghost
  if (!Array.isArray(g) || g.length < 2 || g.length > GHOST_MAX) return [...problems, 'The run\'s recording is missing or too long.']
  for (const s of g) {
    if (!Array.isArray(s) || s.length !== 5 || !s.every((v) => typeof v === 'number' && Number.isFinite(v))) return [...problems, 'The run\'s recording is not valid.']
  }
  const samples = g as GhostSample[]
  if (samples[0][0] !== 0 && samples[0][0] > GHOST_STEP * 2) problems.push('The recording doesn\'t start with the run.')
  for (let i = 1; i < samples.length; i++) if (samples[i][0] < samples[i - 1][0]) { problems.push('The recording goes back in time.'); break }
  const end = samples[samples.length - 1][0]
  if (Math.abs(end - e.ms) > 250) problems.push('The recording doesn\'t match the time.')
  const spawns = markers.filter((m) => SPAWNS.includes(m.type)).map((m) => m.position)
  const gap = (p: Vec3, s: GhostSample) => Math.hypot(p[0] - s[1], p[2] - s[3])
  // The run's own spawn: the one it starts at. Going back (R) only ever leads there.
  const home = spawns.reduce<Vec3 | null>((best, p) => (!best || gap(p, samples[0]) < gap(best, samples[0]) ? p : best), null)
  if (home && gap(home, samples[0]) > SPAWN_NEAR) problems.push('The run doesn\'t start at a spawn.')
  // Never faster than a sprint for long, and no faster than a sprint on average (sprinting only lasts 3 s).
  let walked = 0
  const back = new Set<number>()
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i]
    const d = Math.hypot(b[1] - a[1], b[3] - a[3])
    if (d > MAX_SPEED * ((b[0] - a[0]) / 1000) + SLACK) {
      if (home && gap(home, b) <= SPAWN_NEAR) { back.add(i); continue }
      problems.push('The run moves faster than a player can.')
      break
    }
    walked += d
  }
  // Through a wall: the line between two samples at body height crosses collision, and so do lines either side of it.
  // Only for a run that passes everything else (the costly part, so not done for one already refused).
  if (walls && !problems.length) {
    const stop = performance.now() + WALL_CHECK_MS
    for (let i = 1; i < samples.length; i++) {
      if (performance.now() > stop) { problems.push('This time can’t be checked on this map: its walls take too long to test.'); break }
      if (back.has(i)) continue
      const a = samples[i - 1], b = samples[i]
      const dx = b[1] - a[1], dz = b[3] - a[3], len = Math.hypot(dx, dz)
      if (len < 1e-3) continue
      const nx = (-dz / len) * SIDE, nz = (dx / len) * SIDE
      const ray = (o: number) => walls([a[1] + nx * o, a[2] + BODY, a[3] + nz * o], [b[1] + nx * o, b[2] + BODY, b[3] + nz * o])
      if (ray(0) && ray(1) && ray(-1)) { problems.push('The run goes through a wall.'); break }
    }
  }
  if (end > 0 && walked / (end / 1000) > SPRINT_SPEED * 1.05 && !problems.some((p) => p.includes('faster'))) problems.push('The run moves faster than a player can.')
  // Every target passed on the way (between samples too: a sprint covers 2 units in 100 ms).
  for (const t of targets) {
    let hit = false
    for (let i = 1; i < samples.length && !hit; i++) {
      const a = samples[i - 1], b = samples[i]
      const { d, k } = toSegment(t.at, a, b)
      const y = a[2] + (b[2] - a[2]) * k - t.at[1]
      hit = d <= t.radius + 0.5 && y >= -2 && y <= 4.5
    }
    if (!hit) { problems.push(`The run never reaches every ${kind === 'weapon' ? 'weapon' : 'drop-off'}.`); break }
  }
  return problems
}

// ---------------- your best ghost (kept in this browser) ----------------

export interface GhostStore { getItem(k: string): string | null; setItem(k: string, v: string): void }

const ghostKey = (map: string, mode: RunMode) => `sr1-play-ghost:${map}:${mode}`

export function loadGhost(store: GhostStore | null, map: string, mode: RunMode): GhostSample[] | null {
  try {
    const g = JSON.parse(store?.getItem(ghostKey(map, mode)) || 'null')
    return Array.isArray(g) && g.length > 1 ? g : null
  } catch { return null }
}

export function saveGhost(store: GhostStore | null, map: string, mode: RunMode, g: GhostSample[]) {
  try { store?.setItem(ghostKey(map, mode), JSON.stringify(g)) } catch { /* storage full or blocked: no ghost kept */ }
}
