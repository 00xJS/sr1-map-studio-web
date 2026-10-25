// How the game stands each model in the city: on the ground or a floor, flush against a wall, on a roof, or
// hanging with nothing under it. For a couple of placements of each model in a chunk, short rays are cast from
// the model's own box against the solid things around it (the ground, buildings and their pieces, other props):
// down for what holds it up, sideways for a wall right behind one of its sides and the clear floor in front of
// each side, up for a ceiling or open sky, and far down for its height above the ground. Each model's counts add
// up across chunks into GameObjectEntry.sits, which placement rules (cityModules.ts placementOf) read. Pure
// functions on a chunk already read; nothing is kept but the counts.
import { meshIndexCount, type Chunk } from './chunk'
import type { Side } from './cityModules'

type Vec3 = [number, number, number]
/** The sides in the order the counts keep them. */
export const SIDES: readonly Side[] = ['+x', '-x', '+z', '-z']

/** How a model is placed, over the placements looked at (GameObjectEntry.sits). */
export interface Sits {
  /** Placements looked at. */
  n: number
  /** Of those: standing on something, flush on a wall with nothing under it, on a building's roof, hanging (nothing under it, no wall). */
  ground: number
  wall: number
  roof: number
  hang: number
  /** Standing within a building's footprint (on it, in it or against it). */
  inside: number
  /** Per side of its own frame (+x, -x, +z, -z as SIDES): placements with a wall right behind that side. */
  back: [number, number, number, number]
  /** Placements with a ceiling (anything) right over its top. */
  ceiling: number
  /** Its feet above the ground under it, metres (average). */
  lift: number
  /** Clear floor in front of each side, metres (average, at most OPEN_MAX). */
  open: [number, number, number, number]
  /** How solid its own shape is between knee and eye height, or its own height when lower (0..1; the less of two side views). */
  cover?: number
}

/** The counts as they add up: n, ground, wall, roof, hang, inside, back x4, lift sum, open sums x4, ceiling. */
export const SITS_LEN = 16
/** Floor in front is looked for up to this far (metres). */
export const OPEN_MAX = 3

/** What a solid thing is: the ground, a building or a piece of one (walls, floors), or a prop (None: not solid). */
export const Solid = { None: 0, Ground: 1, Structure: 2, Prop: 3 } as const
export type Solid = (typeof Solid)[keyof typeof Solid]

/** One placement to look at: its instance, where its feet stand, its turn about +Y and its size in its own frame. */
export interface Target { inst: number; key: string; at: Vec3; yaw: number; ext: [number, number]; h: number }

type Box = { min: Vec3; max: Vec3 }

/** A mesh's triangles (9 floats each, its own frame) with a bounding-volume tree over them. */
interface Bvh { tri: Float32Array; order: Uint32Array; nodes: Float32Array; kids: Int32Array }

const LEAF = 8

/** The positions of a mesh's triangles (strips decoded as chunk.ts meshTriangles decodes them; positions only). */
function meshTris(ch: Chunk, mi: number): Float32Array {
  const mesh = ch.meshes[mi]
  const dv = new DataView(ch.bytes.buffer, ch.bytes.byteOffset, ch.bytes.byteLength)
  const out = new Float32Array(Math.max(0, meshIndexCount(mesh) - 2) * 9)
  let n = 0
  for (const sub of mesh.subs) {
    const vb = ch.vbs[sub.vb]
    if (!vb || vb.stride < 12 || vb.stride % 4 || !vb.count || vb.vertexBytes < vb.stride * vb.count) continue
    for (const b of sub.batches) {
      if (b.first + b.count > vb.indexCount) continue
      const base = vb.indexAt + 2 * b.first
      for (let j = 0; j + 2 < b.count; j++) {
        const a = dv.getUint16(base + 2 * j), c = dv.getUint16(base + 2 * j + 2), d = dv.getUint16(base + 2 * j + 4)
        if (a === c || c === d || a === d || a >= vb.count || c >= vb.count || d >= vb.count || n + 9 > out.length) continue
        let ok = true
        for (const v of [a, c, d]) {
          const o = vb.vertexAt + vb.stride * v
          const x = dv.getFloat32(o), y = dv.getFloat32(o + 4), z = dv.getFloat32(o + 8)
          if (!(Math.abs(x) < 1e5 && Math.abs(y) < 1e5 && Math.abs(z) < 1e5)) ok = false
          out[n++] = x; out[n++] = y; out[n++] = z
        }
        if (!ok) n -= 9
      }
    }
  }
  return out.subarray(0, n)
}

function buildBvh(tri: Float32Array): Bvh {
  const nt = tri.length / 9
  const order = new Uint32Array(nt)
  const cen = new Float32Array(nt * 3)
  for (let i = 0; i < nt; i++) {
    order[i] = i
    for (let k = 0; k < 3; k++) cen[3 * i + k] = (tri[9 * i + k] + tri[9 * i + 3 + k] + tri[9 * i + 6 + k]) / 3
  }
  const nodes = new Float32Array(12 * nt), kids = new Int32Array(4 * nt)
  let count = 0
  // A node: its box (6), then [left, right] or [-1 - start, count]. Split at the middle of the centres' spread
  // along its longest side (halves by count when they all sit at one spot).
  const build = (s: number, e: number): number => {
    const id = count++
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
    let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity
    for (let i = s; i < e; i++) {
      const p = 9 * order[i]
      for (let v = 0; v < 9; v += 3) {
        const x = tri[p + v], y = tri[p + v + 1], z = tri[p + v + 2]
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
        if (z < z0) z0 = z
        if (z > z1) z1 = z
      }
      const c = 3 * order[i], x = cen[c], y = cen[c + 1], z = cen[c + 2]
      if (x < cx0) cx0 = x
      if (x > cx1) cx1 = x
      if (y < cy0) cy0 = y
      if (y > cy1) cy1 = y
      if (z < cz0) cz0 = z
      if (z > cz1) cz1 = z
    }
    nodes[6 * id] = x0; nodes[6 * id + 1] = y0; nodes[6 * id + 2] = z0; nodes[6 * id + 3] = x1; nodes[6 * id + 4] = y1; nodes[6 * id + 5] = z1
    if (e - s <= LEAF) { kids[2 * id] = -1 - s; kids[2 * id + 1] = e - s; return id }
    const sx = cx1 - cx0, sy = cy1 - cy0, sz = cz1 - cz0
    const axis = sx >= sy && sx >= sz ? 0 : sy >= sz ? 1 : 2
    const mid = axis === 0 ? (cx0 + cx1) / 2 : axis === 1 ? (cy0 + cy1) / 2 : (cz0 + cz1) / 2
    let i = s, j = e - 1
    while (i <= j) {
      if (cen[3 * order[i] + axis] < mid) i++
      else { const t = order[i]; order[i] = order[j]; order[j] = t; j-- }
    }
    const m = i === s || i === e ? (s + e) >> 1 : i
    const l = build(s, m), r = build(m, e)
    kids[2 * id] = l; kids[2 * id + 1] = r
    return id
  }
  if (nt) build(0, nt)
  return { tri, order, nodes: nodes.subarray(0, 6 * count), kids: kids.subarray(0, 2 * count) }
}

/** A ray against a box (6 numbers from `at`): whether it meets it within tmax. */
function slab(o: Float64Array, inv: Float64Array, b: ArrayLike<number>, at: number, tmax: number): boolean {
  let t0 = 0, t1 = tmax
  for (let k = 0; k < 3; k++) {
    let a = (b[at + k] - o[k]) * inv[k], c = (b[at + 3 + k] - o[k]) * inv[k]
    if (a > c) { const t = a; a = c; c = t }
    if (a > t0) t0 = a
    if (c < t1) t1 = c
    if (t0 > t1) return false
  }
  return true
}

const stack = new Int32Array(256)
/** The last castBvh answer: distance and triangle (-1: none). */
const hitAt = { t: 0, i: -1 }

/** The nearest triangle a ray (the mesh's own frame) meets within tmax, into hitAt. */
function castBvh(h: Bvh, o: Float64Array, d: Float64Array, inv: Float64Array, tmax: number) {
  hitAt.i = -1
  hitAt.t = tmax
  if (!h.kids.length) return
  let top = 0
  stack[top++] = 0
  const T = h.tri
  while (top) {
    const n = stack[--top]
    if (!slab(o, inv, h.nodes, 6 * n, hitAt.t)) continue
    const a = h.kids[2 * n]
    if (a >= 0) { if (top < 254) { stack[top++] = a; stack[top++] = h.kids[2 * n + 1] } continue }
    const s = -1 - a, e = s + h.kids[2 * n + 1]
    for (let q = s; q < e; q++) {
      const i = h.order[q], p = 9 * i
      // Möller–Trumbore, either face.
      const e1x = T[p + 3] - T[p], e1y = T[p + 4] - T[p + 1], e1z = T[p + 5] - T[p + 2]
      const e2x = T[p + 6] - T[p], e2y = T[p + 7] - T[p + 1], e2z = T[p + 8] - T[p + 2]
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x
      const det = e1x * px + e1y * py + e1z * pz
      if (det > -1e-12 && det < 1e-12) continue
      const id = 1 / det
      const tx = o[0] - T[p], ty = o[1] - T[p + 1], tz = o[2] - T[p + 2]
      const u = (tx * px + ty * py + tz * pz) * id
      if (u < 0 || u > 1) continue
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * id
      if (v < 0 || u + v > 1) continue
      const t = (e2x * qx + e2y * qy + e2z * qz) * id
      if (t >= 0 && t < hitAt.t) { hitAt.t = t; hitAt.i = i }
    }
  }
}

/** A 3x3 inverse (column-major in and out); null when it can't be inverted. */
function invert(R: number[]): Float64Array | null {
  const [a, b, c, d, e, f, g, h, i] = R
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-9) return null
  const k = 1 / det
  return Float64Array.of(A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k)
}

/** Grid cell for instances, metres across. */
const CELL = 8

interface Hit { t: number; kind: Solid; ny: number }

/**
 * The solid things of a chunk, for casting rays: each instance's world box, sorted into a grid, and each mesh's
 * triangles read (and its tree built) the first time a ray comes near it.
 */
class Scene {
  boxes: Float64Array
  has: Uint8Array
  kinds: Uint8Array
  private stamp: Uint32Array
  private calls = 0
  private grid = new Map<number, number[]>()
  bvh = new Map<number, Bvh>()
  private inv = new Map<number, Float64Array | null>()
  private o = new Float64Array(3)
  private oi = new Float64Array(3)
  private lo = new Float64Array(3)
  private ld = new Float64Array(3)
  private li = new Float64Array(3)
  constructor(public ch: Chunk, kind: (inst: number) => Solid, bounds: (mesh: number) => Box | null) {
    const N = ch.instances.length
    this.boxes = new Float64Array(6 * N)
    this.has = new Uint8Array(N)
    this.kinds = new Uint8Array(N)
    this.stamp = new Uint32Array(N)
    ch.instances.forEach((inst, n) => {
      const k = kind(n)
      if (!k) return
      const b = bounds(inst.mesh)
      if (!b) return
      const B = this.boxes, o = 6 * n
      B[o] = B[o + 1] = B[o + 2] = Infinity
      B[o + 3] = B[o + 4] = B[o + 5] = -Infinity
      const R = inst.rotation, p = inst.position
      for (let c = 0; c < 8; c++) {
        const q0 = c & 1 ? b.max[0] : b.min[0], q1 = c & 2 ? b.max[1] : b.min[1], q2 = c & 4 ? b.max[2] : b.min[2]
        for (let j = 0; j < 3; j++) {
          const w = p[j] + q0 * R[j] + q1 * R[3 + j] + q2 * R[6 + j]
          if (w < B[o + j]) B[o + j] = w
          if (w > B[o + 3 + j]) B[o + 3 + j] = w
        }
      }
      if (!(B[o + 3] - B[o] < 2000 && B[o + 5] - B[o + 2] < 2000)) return
      this.has[n] = 1
      this.kinds[n] = k
      for (let x = Math.floor(B[o] / CELL); x <= Math.floor(B[o + 3] / CELL); x++) for (let z = Math.floor(B[o + 2] / CELL); z <= Math.floor(B[o + 5] / CELL); z++) {
        const key = x * 65536 + z
        const g = this.grid.get(key)
        if (g) g.push(n); else this.grid.set(key, [n])
      }
    })
  }

  tris(mesh: number): Bvh {
    let h = this.bvh.get(mesh)
    if (!h) { h = buildBvh(meshTris(this.ch, mesh)); this.bvh.set(mesh, h) }
    return h
  }

  /**
   * The nearest solid a world ray meets within tmax, among the kinds in `accept` (a bit per Solid), skipping
   * `skip`: how far, the kind of solid, and the up part of the face's normal (0 for a wall, 1 for a floor). With
   * `any`, the first found.
   */
  cast(o: Vec3, d: Vec3, tmax: number, skip: (n: number) => boolean, accept: number, any = false): Hit | null {
    const stamp = ++this.calls
    const ex = o[0] + d[0] * tmax, ez = o[2] + d[2] * tmax
    const x0 = Math.floor(Math.min(o[0], ex) / CELL), x1 = Math.floor(Math.max(o[0], ex) / CELL)
    const z0 = Math.floor(Math.min(o[2], ez) / CELL), z1 = Math.floor(Math.max(o[2], ez) / CELL)
    const W = this.o, I = this.oi, lo = this.lo, ld = this.ld, li = this.li
    for (let k = 0; k < 3; k++) { W[k] = o[k]; I[k] = Math.abs(d[k]) < 1e-12 ? 1e12 : 1 / d[k] }
    let best: Hit | null = null
    let lim = tmax
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const cell = this.grid.get(x * 65536 + z)
      if (!cell) continue
      for (const n of cell) {
        if (this.stamp[n] === stamp) continue
        this.stamp[n] = stamp
        const k = this.kinds[n]
        if (!(accept & (1 << k)) || skip(n) || !slab(W, I, this.boxes, 6 * n, lim)) continue
        const inst = this.ch.instances[n]
        let Ri = this.inv.get(n)
        if (Ri === undefined) { Ri = invert(inst.rotation); this.inv.set(n, Ri) }
        if (!Ri) continue
        const h = this.tris(inst.mesh)
        const w0 = o[0] - inst.position[0], w1 = o[1] - inst.position[1], w2 = o[2] - inst.position[2]
        for (let j = 0; j < 3; j++) {
          lo[j] = Ri[j] * w0 + Ri[3 + j] * w1 + Ri[6 + j] * w2
          ld[j] = Ri[j] * d[0] + Ri[3 + j] * d[1] + Ri[6 + j] * d[2]
          li[j] = Math.abs(ld[j]) < 1e-12 ? 1e12 : 1 / ld[j]
        }
        castBvh(h, lo, ld, li, lim)
        if (hitAt.i < 0) continue
        // The face's normal in the world (rotations here are turns, so the matrix turns normals too).
        const T = h.tri, p = 9 * hitAt.i
        const ax = T[p + 3] - T[p], ay = T[p + 4] - T[p + 1], az = T[p + 5] - T[p + 2], bx = T[p + 6] - T[p], by = T[p + 7] - T[p + 1], bz = T[p + 8] - T[p + 2]
        const n0 = ay * bz - az * by, n1 = az * bx - ax * bz, n2 = ax * by - ay * bx
        const R = inst.rotation
        const nx = n0 * R[0] + n1 * R[3] + n2 * R[6], ny = n0 * R[1] + n1 * R[4] + n2 * R[7], nz = n0 * R[2] + n1 * R[5] + n2 * R[8]
        lim = hitAt.t
        best = { t: hitAt.t, kind: k as Solid, ny: Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1) }
        if (any) return best
      }
    }
    return best
  }
}

/** The kinds a ray may meet (bits for Scene.cast): anything solid, the ground's own pieces, walls (not props). */
const ANY = (1 << Solid.Ground) | (1 << Solid.Structure) | (1 << Solid.Prop), GROUND = 1 << Solid.Ground, WALLS = (1 << Solid.Ground) | (1 << Solid.Structure)

/** At most this many placements of one model are looked at in a chunk. */
const PER_CHUNK = 2

/** Cover is measured between these heights above its feet (metres): a crouching player to a standing one's eyes. */
const COVER_BAND: [number, number] = [0.3, 1.7]

/** How solid a mesh (its own frame, as placed with rotation R) is between knee and eye height, seen from two sides (0..1). */
export function coverOf(tri: Float32Array, yaw: number, R: number[]): number {
  // Into its cut-out frame: turned as placed, then the turn about +Y taken off (as extract.ts cuts it).
  const c = Math.cos(yaw), s = Math.sin(yaw)
  const P = new Float32Array(tri.length)
  let y0 = Infinity, top = -Infinity
  for (let i = 0; i < tri.length; i += 3) {
    const x = tri[i], y = tri[i + 1], z = tri[i + 2]
    const wx = x * R[0] + y * R[3] + z * R[6], wy = x * R[1] + y * R[4] + z * R[7], wz = x * R[2] + y * R[5] + z * R[8]
    P[i] = wx * c + wz * s; P[i + 1] = wy; P[i + 2] = -wx * s + wz * c
    if (wy < y0) y0 = wy
    if (wy > top) top = wy
  }
  const band: [number, number] = [y0 + COVER_BAND[0], y0 + Math.min(COVER_BAND[1], Math.max(COVER_BAND[0] + 0.2, top - y0))]
  const CELLS = 20
  let lo = Infinity
  for (const axis of [0, 2]) {
    let a0 = Infinity, a1 = -Infinity
    for (let i = 0; i < P.length; i += 3) { if (P[i + axis] < a0) a0 = P[i + axis]; if (P[i + axis] > a1) a1 = P[i + axis] }
    const span = a1 - a0
    if (!(span > 0)) return 0
    const hit = new Uint8Array(CELLS * CELLS)
    const cu = (u: number) => ((u - a0) / span) * CELLS - 0.5, cv = (v: number) => ((v - band[0]) / (band[1] - band[0])) * CELLS - 0.5
    for (let t = 0; t < P.length; t += 9) {
      const ax = cu(P[t + axis]), ay = cv(P[t + 1]), bx = cu(P[t + 3 + axis]), by = cv(P[t + 4]), cx = cu(P[t + 6 + axis]), cy = cv(P[t + 7])
      const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
      if (Math.abs(d) < 1e-9) continue
      const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx))), i1 = Math.min(CELLS - 1, Math.floor(Math.max(ax, bx, cx)))
      const j0 = Math.max(0, Math.ceil(Math.min(ay, by, cy))), j1 = Math.min(CELLS - 1, Math.floor(Math.max(ay, by, cy)))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const w1 = ((bx - i) * (cy - j) - (cx - i) * (by - j)) / d, w2 = ((cx - i) * (ay - j) - (ax - i) * (cy - j)) / d
        if (w1 >= 0 && w2 >= 0 && w1 + w2 <= 1) hit[j * CELLS + i] = 1
      }
    }
    let n = 0
    for (const h of hit) n += h
    lo = Math.min(lo, n / hit.length)
  }
  return Math.round(lo * 100) / 100
}

/**
 * How the chunk stands each target model: the counts per key (SITS_LEN numbers, see Sits) and its cover. `kind`
 * says what each instance is as a solid (Solid.None: not solid, such as shadows, blockers and far copies);
 * `inside` whether a point stands within a building's footprint.
 */
export function probeChunk(ch: Chunk, targets: Target[], kind: (inst: number) => Solid, bounds: (mesh: number) => Box | null, inside: (p: Vec3) => boolean): Map<string, { sums: number[]; cover?: number }> {
  const scene = new Scene(ch, kind, bounds)
  const out = new Map<string, { sums: number[]; cover?: number }>()
  const count = new Map<string, number>()
  for (const t of targets) {
    const done = count.get(t.key) ?? 0
    if (done >= PER_CHUNK) continue
    count.set(t.key, done + 1)
    let r = out.get(t.key)
    if (!r) {
      r = { sums: new Array(SITS_LEN).fill(0) }
      out.set(t.key, r)
      const inst = ch.instances[t.inst]
      if (t.h >= 0.4) r.cover = coverOf(scene.bvh.get(inst.mesh)?.tri ?? meshTris(ch, inst.mesh), t.yaw, inst.rotation)
    }
    probe(scene, t, r.sums, inside)
  }
  return out
}

/** Looks at one placement and adds it to `sums` (unless it stands where this chunk has nothing around it). */
function probe(scene: Scene, t: Target, sums: number[], inside: (p: Vec3) => boolean) {
  const B = scene.boxes, oi = 6 * t.inst, mine = scene.has[t.inst] === 1
  // Itself, and any copy of it standing at the same spot (a second copy, a damaged state), are no support.
  const same = (n: number) => {
    if (n === t.inst) return true
    if (!mine) return false
    const o = 6 * n
    for (let k = 0; k < 6; k++) if (Math.abs(B[o + k] - B[oi + k]) >= 0.1) return false
    return true
  }
  const c = Math.cos(t.yaw), s = Math.sin(t.yaw)
  // Its own axes in the world (the cut-out frame turned by its yaw).
  const ax: Vec3 = [c, 0, s], az: Vec3 = [-s, 0, c]
  const [ex, ez] = t.ext, h = Math.max(t.h, 0.02)
  const P = (u: number, y: number, w: number): Vec3 => [t.at[0] + u * ax[0] + w * az[0], t.at[1] + y, t.at[2] + u * ax[2] + w * az[2]]
  // What holds it up: a floor or the ground across its lower part or within a hand's width under its feet (feet
  // are often sunk into the ground), at its middle or along its long side.
  const long = ex >= ez ? [ex * 0.3, 0] : [0, ez * 0.3]
  const up = Math.min(1, h * 0.6)
  let under: Hit | null = null
  for (const [u, w] of [[0, 0], long, [-long[0], -long[1]]]) {
    const r = scene.cast(P(u, up, w), [0, -1, 0], up + 0.3, same, ANY)
    if (r && r.ny > 0.3) { under = r; break }
  }
  // Its height above the ground's own pieces (none when its feet are sunk in them), and what is over it.
  const gy = Math.min(1.5, h)
  const g = scene.cast(P(0, gy, 0), [0, -1, 0], 80, same, GROUND)
  const lift = g ? Math.max(0, g.t - gy) : 0
  const over = scene.cast(P(0, h - 0.02, 0), [0, 1, 0], 40, same, ANY)
  // A wall behind a side: rays from its middle out through that side meet an upright face of a building, a piece
  // of one or the ground's (not a prop) at the side or within a hand's width past it.
  const back = [0, 0, 0, 0], open = [0, 0, 0, 0]
  const dirs: [Vec3, number][] = [[ax, ex / 2], [[-ax[0], 0, -ax[2]], ex / 2], [az, ez / 2], [[-az[0], 0, -az[2]], ez / 2]]
  dirs.forEach(([d, half], i) => {
    // (A wall at the end of something long, such as a railing run, doesn't hold it: only short things, a blade
    // sign or a bracket, stand out from a wall end-on.)
    const endOn = half > 1.5 && half > (i < 2 ? ez : ex) / 2
    let hits = 0
    for (const y of [0.3, 0.75]) {
      const r = scene.cast(P(0, h * y, 0), d, half + 0.45, same, WALLS)
      if (r && r.ny < 0.45 && r.t >= half - Math.max(0.35, half * 0.6)) hits++
    }
    if (hits === 2 && !endOn) back[i] = 1
    // Floor clear in front: nothing at knee height for how far past the side.
    const f = scene.cast(P(0, Math.min(0.5, h * 0.5), 0), d, half + OPEN_MAX, same, ANY)
    open[i] = f ? Math.max(0, Math.min(OPEN_MAX, f.t - half)) : OPEN_MAX
  })
  // Walls on two facing sides (a gap, an opening) say nothing about which way it faces.
  if (back[0] && back[1]) back[0] = back[1] = 0
  if (back[2] && back[3]) back[2] = back[3] = 0
  const backed = back.some(Boolean)
  // Nothing under it, around it or over it in this chunk (an always-loaded chunk's lamp, whose street is in
  // another chunk): it can't be told how it stands here.
  const ceiling = !!over && over.t < 0.6
  if (!under && !g && !backed && !ceiling) return
  // On a roof: held up by a building or its piece, well above the ground, with open sky over it.
  const roof = !!under && under.kind === Solid.Structure && lift > 3 && !over
  const how = under ? (roof ? 3 : 1) : backed ? 2 : 4
  sums[0]++
  sums[how]++
  if (inside(t.at)) sums[5]++
  for (let i = 0; i < 4; i++) { sums[6 + i] += back[i]; sums[11 + i] += open[i] }
  sums[10] += lift
  if (ceiling) sums[15]++
}

/** The counts added up across chunks, as a Sits. */
export function sitsFrom(sums: number[], cover?: number): Sits {
  const n = Math.max(1, sums[0])
  const r1 = (v: number) => Math.round(v * 10) / 10
  return {
    n: sums[0], ground: sums[1], wall: sums[2], roof: sums[3], hang: sums[4], inside: sums[5],
    back: [sums[6], sums[7], sums[8], sums[9]], ceiling: sums[15] ?? 0, lift: r1(sums[10] / n), open: [r1(sums[11] / n), r1(sums[12] / n), r1(sums[13] / n), r1(sums[14] / n)],
    ...(cover !== undefined ? { cover } : {}),
  }
}
