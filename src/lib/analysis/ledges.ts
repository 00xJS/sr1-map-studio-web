// Climb ledges as the export writes them, so the health checks count the same ones. This follows py/climb.py step by
// step, in metres: the outline of the marked objects' flat tops, long segments along it, each rated against the map,
// and the ones with a place left to grab kept. tests/climbLedges.test.ts holds both sides to LEDGE_RULES and to the
// shared cases in tests/fixtures/climb_ledges.json, so a change to one side has to be made on the other.
import type { Bvh } from './bvh'
import { SOLID } from './types'
import { CLIMB, UNITS_PER_M } from '../player'

/** The numbers py/climb.py uses, under the same names. */
export const LEDGE_RULES = {
  TOP_NY: 0.95, RISE: 0.02, WELD: 0.001, MIN_RUN: 0.01, SAG: 0.05, MAX_PIECES: 200, END_ZONE: 0.35, STRAIGHT: 2.35,
  MIN_CLIMB: CLIMB.minM, MAX_CLIMB: CLIMB.maxM, STANCE: 0.5, CLEAR_AHEAD: 0.925, CLEAR_AT: 0.5, CLEAR_UP: 0.9, SAMPLE_EVERY: 2, MAX_SAMPLES: 5,
} as const
const R = LEDGE_RULES

export type Point = readonly [number, number, number]
export type Segment = readonly [Point, Point]
export type Rating = 'low' | 'wall' | 'blocked' | 'high' | 'reach'

/** A ledge in the map's units, with how far from each end the game refuses a grab. */
export interface Ledge { a: Point; b: Point; deadA: number; deadB: number }

const dist = (p: Point, q: Point) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
const run = (p: Point, q: Point) => Math.hypot(p[0] - q[0], p[2] - q[2])
const before = (p: Point, q: Point) => p[0] < q[0] || (p[0] === q[0] && (p[1] < q[1] || (p[1] === q[1] && p[2] < q[2])))

/** Corners within WELD of each other come back as one point. */
function welder() {
  const seen = new Map<string, Point>()
  return (x: number, y: number, z: number): Point => {
    const kx = Math.round(x / R.WELD), ky = Math.round(y / R.WELD), kz = Math.round(z / R.WELD)
    const key = `${kx},${ky},${kz}`
    const hit = seen.get(key)
    if (hit) return hit
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
      const near = seen.get(`${kx + dx},${ky + dy},${kz + dz}`)
      if (near && dist(near, [x, y, z]) <= R.WELD) { seen.set(key, near); return near }
    }
    const point: Point = [kx / 1000 + 0, ky / 1000 + 0, kz / 1000 + 0]
    seen.set(key, point)
    return point
  }
}

/**
 * The outline of the tops among the faces (`corners`: 9 floats a face, metres, wound as drawn). An edge two tops share is
 * inside the top; one with a face going up past it is the foot of a wall.
 */
export function topEdges(corners: ArrayLike<number>): Segment[] {
  const weld = welder()
  const ids = new Map<Point, number>()
  const id = (p: Point) => { let n = ids.get(p); if (n === undefined) { n = ids.size; ids.set(p, n) } return n }
  const seen = new Map<string, { edge: Segment; tops: number; wall: boolean }>()
  for (let f = 0; f + 9 <= corners.length; f += 9) {
    const ux = corners[f + 3] - corners[f], uy = corners[f + 4] - corners[f + 1], uz = corners[f + 5] - corners[f + 2]
    const vx = corners[f + 6] - corners[f], vy = corners[f + 7] - corners[f + 1], vz = corners[f + 8] - corners[f + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const size = Math.hypot(nx, ny, nz)
    if (size < 1e-12) continue
    const top = ny / size >= R.TOP_NY
    const points = [0, 3, 6].map((k) => weld(corners[f + k], corners[f + k + 1], corners[f + k + 2]))
    if (new Set(points).size < 3) continue
    for (let k = 0; k < 3; k++) {
      const a = points[k], b = points[(k + 1) % 3], other = points[(k + 2) % 3]
      const edge: Segment = before(a, b) ? [a, b] : [b, a]
      const key = `${id(edge[0])}:${id(edge[1])}`
      let e = seen.get(key)
      if (!e) { e = { edge, tops: 0, wall: false }; seen.set(key, e) }
      if (top) e.tops++
      else if (other[1] > Math.max(a[1], b[1]) + R.RISE) e.wall = true
    }
  }
  return [...seen.values()].filter((e) => e.tops === 1 && !e.wall).map((e) => e.edge)
}

/** The angle at p between its way to a and its way to b, radians (pi: straight on). */
function bend(p: Point, a: Point, b: Point): number {
  const ux = a[0] - p[0], uy = a[1] - p[1], uz = a[2] - p[2], vx = b[0] - p[0], vy = b[1] - p[1], vz = b[2] - p[2]
  const size = Math.sqrt((ux * ux + uy * uy + uz * uz) * (vx * vx + vy * vy + vz * vz))
  return size ? Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / size))) : 0
}

/** How far p is from the segment a-b. */
function off(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]
  const size = dx * dx + dy * dy + dz * dz
  const t = size ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / size)) : 0
  return dist(p, [a[0] + dx * t, a[1] + dy * t, a[2] + dz * t])
}

function byEnd(segs: readonly Segment[]) {
  const at = new Map<Point, Segment[]>()
  const add = (p: Point, s: Segment) => { const l = at.get(p); if (l) l.push(s); else at.set(p, [s]) }
  for (const s of segs) { add(s[0], s); add(s[1], s) }
  return at
}

/** Edges as lines of points, split where more or fewer than two edges meet; a closed loop starts and ends at its sharpest corner. */
function chains(edges: readonly Segment[]): Point[][] {
  const at = byEnd(edges)
  const used = new Set<Segment>()
  const walk = (start: Point, first: Segment) => {
    const line = [start]
    let e = first, p = start
    for (;;) {
      used.add(e)
      p = e[0] === p ? e[1] : e[0]
      line.push(p)
      const here = at.get(p)!
      if (here.length !== 2 || p === start) return line
      e = here[1] === e ? here[0] : here[1]
    }
  }
  const out: Point[][] = []
  for (const [p, list] of at) if (list.length !== 2) for (const e of list) if (!used.has(e)) out.push(walk(p, e))
  for (const e of edges) {
    if (used.has(e)) continue
    const loop = walk(e[0], e).slice(0, -1)
    let k = 0, sharpest = Infinity
    loop.forEach((p, i) => {
      const angle = bend(p, loop[(i + loop.length - 1) % loop.length], loop[(i + 1) % loop.length])
      if (angle < sharpest) { sharpest = angle; k = i }
    })
    out.push([...loop.slice(k), ...loop.slice(0, k), loop[k]])
  }
  return out
}

/** Fewer points along a line of edges, none straying more than SAG. */
function thin(line: Point[]): Point[] {
  const out = [line[0]]
  for (let i = 0; i < line.length - 1;) {
    let j = i + 1
    while (j + 1 < line.length && j - i < R.MAX_PIECES) {
      let fits = true
      for (let k = i + 1; k <= j && fits; k++) fits = off(line[k], line[i], line[j + 1]) <= R.SAG
      if (!fits) break
      j++
    }
    out.push(line[j])
    i = j
  }
  return out
}

/** The outline as long segments: pieces in a line (or a gentle curve) become one. Two objects' edges along one line can come out the same segment: it counts once. */
export function segments(edges: readonly Segment[]): Segment[] {
  const out: Segment[] = []
  const seen = new Map<Point, Set<Point>>()
  for (const line of chains(edges)) {
    const points = thin(line)
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i], b = points[i + 1]
      if (run(a, b) < R.MIN_RUN) continue
      const [lo, hi] = before(a, b) ? [a, b] : [b, a]
      let ends = seen.get(lo)
      if (!ends) { ends = new Set(); seen.set(lo, ends) }
      if (!ends.has(hi)) { ends.add(hi); out.push([a, b]) }
    }
  }
  return out
}

/** Metres from segment end p where the game refuses a grab. */
function dead(p: Point, seg: Segment, at: Map<Point, Segment[]>): number {
  const others = at.get(p)!.filter((o) => o !== seg)
  // With more than one neighbour the game takes whichever it meets first: count on none.
  if (others.length !== 1) return R.END_ZONE
  const q = others[0][0] === p ? others[0][1] : others[0][0]
  const far = seg[0] === p ? seg[1] : seg[0]
  if (bend(p, far, q) < R.STRAIGHT) return R.END_ZONE
  return Math.max(0, R.END_ZONE - dist(p, q))
}

/** The segments that keep a place to grab, with their dead ends. Leaving one out can leave its neighbour with none. */
export function usable(segs: readonly Segment[]): { keep: { seg: Segment; deadA: number; deadB: number }[]; metres: number; left: number } {
  let now = [...segs], left = 0
  for (;;) {
    const at = byEnd(now)
    const measured = now.map((seg) => {
      const deadA = dead(seg[0], seg, at), deadB = dead(seg[1], seg, at)
      return { seg, deadA, deadB, span: dist(seg[0], seg[1]) - deadA - deadB }
    })
    const keep = measured.filter((m) => m.span > 0)
    if (keep.length === now.length) return { keep, metres: measured.reduce((s, m) => s + m.span, 0), left }
    left += now.length - keep.length
    now = keep.map((m) => m.seg)
  }
}

/** Distance in metres to the first solid triangle along a unit direction from a point in metres, or null within `far`. */
function ray(bvh: Bvh, x: number, y: number, z: number, dx: number, dy: number, dz: number, far: number): number | null {
  const t = bvh.closest(x * UNITS_PER_M, y * UNITS_PER_M, z * UNITS_PER_M, dx, dy, dz, far * UNITS_PER_M, SOLID)
  return t < 0 ? null : t / UNITS_PER_M
}

/** Climbing to edge point e from a side (a flat unit vector from the edge towards the player). */
function attempt(bvh: Bvh, e: Point, sx: number, sz: number): Rating {
  const [x, y, z] = e
  // The first thing under the edge's height, back where the player's body goes (a floor at the edge's height: no drop here).
  const down = ray(bvh, x + sx * R.STANCE, y + 0.05, z + sz * R.STANCE, 0, -1, 0, R.MAX_CLIMB + 0.05)
  if (down !== null && down - 0.05 < R.MIN_CLIMB) return 'low'
  if (ray(bvh, x, y + 0.3, z, sx, 0, sz, R.STANCE) !== null) return 'wall'
  if (ray(bvh, x, y + R.CLEAR_AT, z, -sx, 0, -sz, R.CLEAR_AHEAD) !== null) return 'blocked'
  if (ray(bvh, x - (sx * R.CLEAR_AHEAD) / 2, y + 0.1, z - (sz * R.CLEAR_AHEAD) / 2, 0, 1, 0, R.CLEAR_UP - 0.1) !== null) return 'blocked'
  return down !== null ? 'reach' : 'high'
}

const ORDER: Rating[] = ['low', 'wall', 'blocked', 'high', 'reach']

/** The best the segment does at the spots tried along it, from either side. */
export function rate(bvh: Bvh, [a, b]: Segment): Rating {
  const length = run(a, b)
  const sx = (b[2] - a[2]) / length, sz = (a[0] - b[0]) / length
  const n = Math.min(R.MAX_SAMPLES, 1 + Math.floor(length / R.SAMPLE_EVERY))
  let best: Rating = 'low'
  for (let k = 0; k < n; k++) {
    const f = (k + 0.5) / n
    const e: Point = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
    for (const s of [1, -1]) {
      const got = attempt(bvh, e, sx * s, sz * s)
      if (ORDER.indexOf(got) > ORDER.indexOf(best)) best = got
      if (best === 'reach') return best
    }
  }
  return best
}

/** What the export would keep of the segments (metres), as py/climb.py plan() does. */
export function plan(bvh: Bvh, segs: readonly Segment[]) {
  const rated = new Map(segs.map((s) => [s, rate(bvh, s)]))
  const { keep, metres, left } = usable(segs.filter((s) => rated.get(s) === 'reach' || rated.get(s) === 'high'))
  return { keep, metres, short: left, rated: [...rated.values()] }
}

/** The ledges the export would write, from AnalysisInput.ledges (6 floats a segment, in the map's units). */
export function ledgesOf(bvh: Bvh, flat: Float32Array | undefined): Ledge[] {
  if (!flat?.length) return []
  // Ends that met keep meeting: they are the same floats.
  const points = new Map<string, Point>()
  const point = (i: number): Point => {
    const key = `${flat[i]},${flat[i + 1]},${flat[i + 2]}`
    let p = points.get(key)
    if (!p) { p = [flat[i] / UNITS_PER_M, flat[i + 1] / UNITS_PER_M, flat[i + 2] / UNITS_PER_M]; points.set(key, p) }
    return p
  }
  const segs: Segment[] = []
  for (let i = 0; i + 6 <= flat.length; i += 6) segs.push([point(i), point(i + 3)])
  const units = (p: Point): Point => [p[0] * UNITS_PER_M, p[1] * UNITS_PER_M, p[2] * UNITS_PER_M]
  return plan(bvh, segs).keep.map(({ seg, deadA, deadB }) => ({ a: units(seg[0]), b: units(seg[1]), deadA: deadA * UNITS_PER_M, deadB: deadB * UNITS_PER_M }))
}

/**
 * Whether a player standing around spot a could grab this ledge and end up on spot b: on either side of it, the part of
 * it the game lets you grab in reach and in climbing range. `cell`: a spot stands for a column this wide.
 */
export function ledgeGetsYouUp(l: Ledge, a: Point, b: Point, cell: number): boolean {
  const dx = l.b[0] - l.a[0], dz = l.b[2] - l.a[2]
  const side = (p: Point) => dx * (p[2] - l.a[2]) - dz * (p[0] - l.a[0])
  if (side(a) * side(b) > 0) return false
  const length = dist(l.a, l.b)
  const from = l.deadA / length, to = 1 - l.deadB / length
  const t = Math.max(from, Math.min(to, ((a[0] - l.a[0]) * dx + (a[2] - l.a[2]) * dz) / (dx * dx + dz * dz)))
  const cx = l.a[0] + dx * t, cy = l.a[1] + (l.b[1] - l.a[1]) * t, cz = l.a[2] + dz * t
  if (Math.hypot(a[0] - cx, a[2] - cz) > CLIMB.reachM * UNITS_PER_M + cell * Math.SQRT1_2) return false
  const rise = cy - a[1]
  if (rise < CLIMB.minM * UNITS_PER_M || rise > CLIMB.maxM * UNITS_PER_M) return false
  // A top slopes 18 degrees at most, so its floor a column along stays about this near the ledge's height.
  return Math.abs(b[1] - cy) <= cell * 0.5 + 0.1
}
