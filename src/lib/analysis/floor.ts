// The floor players can stand on, as a walking graph: a grid of columns over
// the map, a node for every surface in a column with room above it, and edges
// where the walk-through's player could step, climb a ramp, jump up a ledge,
// pull up onto an object marked climbable or drop down to the neighbouring spot. Shortest walks come from Dijkstra on it.
import type { Bvh } from './bvh'
import { ledgeGetsYouUp, type Ledge } from './ledges'
import { SOLID, type FloorGrid } from './types'
import { CLIMB, CROUCH_SPEED, FALL, JUMP_HEIGHT, LETHAL_FALL_M, MANTLE, MAX_SLOPE_DEG, RUN_SPEED, STEP, UNITS_PER_M } from '../player'

/** The walk-through's player (src/editor/walk.ts), editor units. Kept here so the worker doesn't load three.js. */
export const PLAYER = { stand: 3.56, crouch: 2.22, standEye: 3.24, crouchEye: 2.1, radius: 0.85, step: STEP, jump: JUMP_HEIGHT, walk: RUN_SPEED, crouchSpeed: CROUCH_SPEED }
/** Steepest ramp walked up, as rise over run. */
export const SLOPE = Math.tan((MAX_SLOPE_DEG * Math.PI) / 180)
/** Highest ledge a jump gets onto. */
export const JUMP_UP = MANTLE
/** Height of the wall probes above the feet: just over a step. */
const LOW = PLAYER.step + 0.15
/** Drops up to this are free, editor units (4 m); higher ones hurt. */
export const FREE_DROP = FALL.freeM * UNITS_PER_M
/** Drops this high or higher kill from full health, editor units (9 m). */
export const LETHAL_DROP = LETHAL_FALL_M * UNITS_PER_M
/** Extra walking cost per unit of a drop that hurts, so routes go round one when they can. */
const HURT_COST = 3
/** Points sampled across each sloped edge to tell a ramp (or stairs) from a ledge. */
const RAMP_SAMPLES = 8

export interface FloorGraph {
  grid: FloorGrid
  nx: number
  nz: number
  x0: number
  z0: number
  /** Nodes of column (i, j) are colStart[j * nx + i] .. colStart[j * nx + i + 1], highest first. */
  colStart: Int32Array
  edgeStart: Int32Array
  edgeTo: Int32Array
  /** Walking time, as editor units walked. */
  edgeCost: Float32Array
}

const NEIGHBOURS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]

/** `ledges`: the climb ledges the export would write (ledges.ts), a way up where nothing else reaches. */
export function buildFloor(bvh: Bvh, cell: number, maxDrop: number, ledges: readonly Ledge[] = []): FloorGraph {
  const [minX, minY, minZ] = bvh.min, [maxX, maxY, maxZ] = bvh.max
  // Columns on multiples of the cell size, so a map that is point-symmetric about 0 gets a symmetric grid.
  const x0 = Math.floor(minX / cell) * cell, z0 = Math.floor(minZ / cell) * cell
  const nx = Math.max(1, Math.ceil((maxX - x0) / cell)), nz = Math.max(1, Math.ceil((maxZ - z0) / cell))
  const top = maxY + 1, bottom = minY - 1
  const colStart = new Int32Array(nx * nz + 1)
  const px: number[] = [], py: number[] = [], pz: number[] = [], crouch: number[] = []
  const ys: number[] = [], tris: number[] = []
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    colStart[j * nx + i] = px.length
    const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell
    bvh.column(x, z, top, bottom, SOLID, ys, tris)
    let above = Infinity
    for (let k = 0; k < ys.length; k++) {
      const y = ys[k]
      if (above - y < 0.02) continue // the same spot as the hit above (two faces meeting)
      const room = above - y
      above = y
      if (Math.abs(bvh.normalY(tris[k])) < 0.5) continue // too steep to stand on
      if (room < PLAYER.crouch) continue
      if (tooNarrow(bvh, x, y, z)) continue
      px.push(x); py.push(y); pz.push(z); crouch.push(room < PLAYER.stand ? 1 : 0)
    }
  }
  colStart[nx * nz] = px.length
  const count = px.length
  const pos = new Float32Array(count * 3)
  for (let n = 0; n < count; n++) { pos[n * 3] = px[n]; pos[n * 3 + 1] = py[n]; pos[n * 3 + 2] = pz[n] }
  const crouchOnly = Uint8Array.from(crouch)

  // Edges to the 8 neighbouring columns.
  const edgeStart = new Int32Array(count + 1)
  const to: number[] = [], cost: number[] = []
  const colOf = new Int32Array(count)
  for (let c = 0; c < nx * nz; c++) for (let n = colStart[c]; n < colStart[c + 1]; n++) colOf[n] = c
  for (let a = 0; a < count; a++) {
    edgeStart[a] = to.length
    const ci = colOf[a] % nx, cj = (colOf[a] / nx) | 0
    const ay = pos[a * 3 + 1]
    for (const [di, dj] of NEIGHBOURS) {
      const i = ci + di, j = cj + dj
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue
      const flat = cell * (di && dj ? Math.SQRT2 : 1)
      const maxRise = Math.max(SLOPE * flat, JUMP_UP)
      // You end up on the highest floor in that column you can get to (a deck under a roof, say, not the roof).
      const c = j * nx + i
      for (let b = colStart[c]; b < colStart[c + 1]; b++) {
        if (pos[b * 3 + 1] > ay + maxRise) {
          // Too high to jump: only up a climb ledge. Lower floor in that column (under a deck, say) is still walked to.
          if (canClimb(bvh, pos, crouchOnly, a, b, cell, ledges)) { to.push(b); cost.push(flat * 2 + 6) }
          continue
        }
        const cst = edge(bvh, pos, crouchOnly, a, b, flat, maxDrop, ys, tris)
        if (cst > 0) { to.push(b); cost.push(cst); break }
      }
    }
  }
  edgeStart[count] = to.length
  return {
    grid: { cell, count, pos, crouchOnly, reachable: new Uint8Array(count) },
    nx, nz, x0, z0, colStart, edgeStart, edgeTo: Int32Array.from(to), edgeCost: Float32Array.from(cost),
  }
}

/** No room for the player's body: walls close on both sides along X or along Z. */
function tooNarrow(bvh: Bvh, x: number, y: number, z: number): boolean {
  const h = y + LOW, r = PLAYER.radius * 0.8
  const hit = (dx: number, dz: number) => bvh.closest(x, h, z, dx, 0, dz, r, SOLID) >= 0
  return (hit(1, 0) && hit(-1, 0)) || (hit(0, 1) && hit(0, -1))
}

/** Cost of moving from node a to node b (a neighbour column), or 0 when the player can't. */
function edge(bvh: Bvh, pos: Float32Array, crouchOnly: Uint8Array, a: number, b: number, flat: number, maxDrop: number, ys: number[], tris: number[]): number {
  const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2]
  const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2]
  const rise = by - ay
  const low = crouchOnly[a] || crouchOnly[b]
  const head = (low ? PLAYER.crouch : PLAYER.stand) - 0.3
  const slow = low ? PLAYER.walk / PLAYER.crouchSpeed : 1
  if (rise < -PLAYER.step) {
    // A drop: walk off at a's height (or hop over a railing), then fall. Ones that hurt cost extra; ones that kill
    // are not taken.
    if (-rise > maxDrop || -rise >= LETHAL_DROP) return 0
    const hurt = Math.max(0, -rise - FREE_DROP) * HURT_COST
    if (!bvh.blocked(ax, ay + LOW, az, bx, ay + LOW, bz, SOLID) && !bvh.blocked(ax, ay + head, az, bx, ay + head, bz, SOLID)) return flat * slow + 1 + hurt
    return !crouchOnly[a] && canHop(bvh, ax, ay, az, bx, bz) ? flat * 1.5 + 2 + hurt : 0
  }
  // Walk, following the slope: probes at step height and at the head.
  const walkable = !bvh.blocked(ax, ay + LOW, az, bx, by + LOW, bz, SOLID) && !bvh.blocked(ax, ay + head, az, bx, by + head, bz, SOLID)
  if (walkable && Math.abs(rise) > 0.25) {
    // A ramp or stairs, not a ledge: the floor rises a little at a time all the way across, never more than a step
    // (or the steepest slope) between two samples.
    if (smoothRise(bvh, ax, ay, az, bx, by, bz, flat, ys, tris)) return Math.hypot(flat, rise) * slow
  } else if (walkable && rise <= SLOPE * flat) return Math.hypot(flat, rise) * slow
  if (rise > JUMP_UP || crouchOnly[a]) return 0
  // A jump up onto a ledge: room to jump at a, and nothing in the way over the edge.
  if (rise > PLAYER.step * 0.5) {
    const over = by + 0.5
    if (!bvh.blocked(ax, over, az, bx, over, bz, SOLID) && !bvh.blocked(ax, ay + 0.2, az, ax, over + PLAYER.stand - 0.5, az, SOLID)) return flat * 1.5 + 2
  }
  // A hop over something low in the way (a railing, a parapet) onto floor about as high.
  return canHop(bvh, ax, ay, az, bx, bz) ? flat * 1.5 + 2 : 0
}

/** Whether the player at a can pull up onto b by a climb ledge between them, with room over the edge. */
function canClimb(bvh: Bvh, pos: Float32Array, crouchOnly: Uint8Array, a: number, b: number, cell: number, ledges: readonly Ledge[]): boolean {
  if (!ledges.length || crouchOnly[a]) return false
  const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2]
  const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2]
  // Well over the game's highest climb: most walls next to floor stop here.
  if (by - ay > CLIMB.maxM * UNITS_PER_M + cell) return false
  const from = [ax, ay, az] as const, onto = [bx, by, bz] as const
  if (!ledges.some((l) => ledgeGetsYouUp(l, from, onto, cell))) return false
  const over = by + 1
  return !bvh.blocked(ax, over, az, bx, over, bz, SOLID) && !bvh.blocked(ax, ay + 0.2, az, ax, over, az, SOLID)
}

/** Whether a jump from a clears whatever stands between it and b: nothing above a, nothing at the top of the jump. */
function canHop(bvh: Bvh, ax: number, ay: number, az: number, bx: number, bz: number): boolean {
  const top = ay + JUMP_UP + 0.05
  return !bvh.blocked(ax, ay + 0.2, az, ax, top + PLAYER.crouch, az, SOLID)
    && !bvh.blocked(ax, top, az, bx, top, bz, SOLID)
    && !bvh.blocked(ax, top + PLAYER.crouch - 0.3, az, bx, top + PLAYER.crouch - 0.3, bz, SOLID)
}

/** Whether the floor from a to b climbs smoothly enough to walk: sampled across, no rise bigger than a step or the slope limit. */
function smoothRise(bvh: Bvh, ax: number, ay: number, az: number, bx: number, by: number, bz: number, flat: number, ys: number[], tris: number[]): boolean {
  const hi = Math.max(ay, by) + 0.3, lo = Math.min(ay, by) - PLAYER.step - 0.3
  const sub = Math.max(PLAYER.step, (SLOPE * flat) / RAMP_SAMPLES)
  let prev = ay
  for (let s = 1; s < RAMP_SAMPLES; s++) {
    const f = s / RAMP_SAMPLES
    bvh.column(ax + (bx - ax) * f, az + (bz - az) * f, hi, lo, SOLID, ys, tris)
    let y = NaN
    for (let k = 0; k < ys.length; k++) if (Math.abs(bvh.normalY(tris[k])) >= 0.5) { y = ys[k]; break }
    if (!Number.isFinite(y) || Math.abs(y - prev) > sub) return false
    prev = y
  }
  return Math.abs(by - prev) <= sub
}

/**
 * Stretches of floor players can get round both ways: up by stairs, a ramp or a jump onto a ledge, and back down
 * without a fall (a drop is one way). A roof with no way up, a deck whose only way off is a fall or a sealed room is a
 * stretch of its own. `comp`: each node's stretch; `sizes`: nodes in each.
 */
export function twoWay(g: FloorGraph): { comp: Int32Array; sizes: number[] } {
  const n = g.grid.count
  const comp = new Int32Array(n).fill(-1)
  const sizes: number[] = []
  const back = (from: number, to: number) => {
    for (let e = g.edgeStart[from]; e < g.edgeStart[from + 1]; e++) if (g.edgeTo[e] === to) return true
    return false
  }
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0) continue
    const c = sizes.length, stack = [s]
    let size = 0
    comp[s] = c
    while (stack.length) {
      const u = stack.pop()!
      size++
      for (let e = g.edgeStart[u]; e < g.edgeStart[u + 1]; e++) {
        const v = g.edgeTo[e]
        if (comp[v] < 0 && back(v, u)) { comp[v] = c; stack.push(v) }
      }
    }
    sizes.push(size)
  }
  return { comp, sizes }
}

/** Shortest walking cost from any source to every node (Infinity where none reaches). */
export function dijkstra(g: FloorGraph, sources: number[]): Float32Array {
  const n = g.grid.count
  const dist = new Float32Array(n).fill(Infinity)
  const heap = new MinHeap(Math.max(16, sources.length * 4))
  for (const s of sources) if (s >= 0 && dist[s] > 0) { dist[s] = 0; heap.push(0, s) }
  const { edgeStart, edgeTo, edgeCost } = g
  while (heap.size) {
    const d = heap.topKey(), u = heap.pop()
    if (d > dist[u]) continue
    for (let e = edgeStart[u], end = edgeStart[u + 1]; e < end; e++) {
      // Rounded as stored, so a node isn't pushed again for a cost that only differs below float32 precision.
      const v = edgeTo[e], nd = Math.fround(d + edgeCost[e])
      if (nd < dist[v]) { dist[v] = nd; heap.push(nd, v) }
    }
  }
  return dist
}

/** The same, against the edges: the walking cost from every node to the nearest target. */
export function dijkstraTo(g: FloorGraph, targets: number[]): Float32Array {
  const rev = reverse(g)
  return dijkstra(rev, targets)
}

const reversed = new WeakMap<FloorGraph, FloorGraph>()
export function reverse(g: FloorGraph): FloorGraph {
  let r = reversed.get(g)
  if (r) return r
  const n = g.grid.count
  const start = new Int32Array(n + 1)
  for (let e = 0; e < g.edgeTo.length; e++) start[g.edgeTo[e] + 1]++
  for (let i = 0; i < n; i++) start[i + 1] += start[i]
  const fill = start.slice(0, n)
  const to = new Int32Array(g.edgeTo.length), cost = new Float32Array(g.edgeTo.length)
  for (let u = 0; u < n; u++) for (let e = g.edgeStart[u]; e < g.edgeStart[u + 1]; e++) {
    const v = g.edgeTo[e], k = fill[v]++
    to[k] = u; cost[k] = g.edgeCost[e]
  }
  r = { ...g, edgeStart: start, edgeTo: to, edgeCost: cost }
  reversed.set(g, r)
  return r
}

/** Nearest node to a marker (it sits a little above the floor), within a cell or two; -1 if none.
 *  Ties go to the node nearer the centre (cx, cz), so mirrored markers land on mirrored nodes. */
export function nodeNear(g: FloorGraph, x: number, y: number, z: number, cx = 0, cz = 0): number {
  const { cell, pos } = g.grid
  const ci = Math.floor((x - g.x0) / cell), cj = Math.floor((z - g.z0) / cell)
  let best = -1, bestD = Infinity
  for (let r = 0; r <= 2 && best < 0; r++) {
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) continue
      const c = j * g.nx + i
      for (let n = g.colStart[c]; n < g.colStart[c + 1]; n++) {
        const dy = y - pos[n * 3 + 1]
        if (dy < -1 || dy > 3) continue // a floor well above or below the marker
        const d = Math.hypot(x - pos[n * 3], z - pos[n * 3 + 2]) + Math.abs(dy) * 2 + 1e-4 * Math.hypot(pos[n * 3] - cx, pos[n * 3 + 2] - cz)
        if (d < bestD) { bestD = d; best = n }
      }
    }
  }
  return best
}

class MinHeap {
  private keys: Float64Array
  private vals: Int32Array
  size = 0
  constructor(cap: number) { this.keys = new Float64Array(cap); this.vals = new Int32Array(cap) }
  topKey() { return this.keys[0] }
  push(k: number, v: number) {
    if (this.size === this.keys.length) {
      const nk = new Float64Array(this.size * 2); nk.set(this.keys); this.keys = nk
      const nv = new Int32Array(this.size * 2); nv.set(this.vals); this.vals = nv
    }
    let i = this.size++
    const K = this.keys, V = this.vals
    while (i > 0) {
      const p = (i - 1) >> 1
      if (K[p] <= k) break
      K[i] = K[p]; V[i] = V[p]; i = p
    }
    K[i] = k; V[i] = v
  }
  pop(): number {
    const K = this.keys, V = this.vals
    const top = V[0]
    const k = K[--this.size], v = V[this.size]
    let i = 0
    for (;;) {
      let c = i * 2 + 1
      if (c >= this.size) break
      if (c + 1 < this.size && K[c + 1] < K[c]) c++
      if (K[c] >= k) break
      K[i] = K[c]; V[i] = V[c]; i = c
    }
    K[i] = k; V[i] = v
    return top
  }
}
