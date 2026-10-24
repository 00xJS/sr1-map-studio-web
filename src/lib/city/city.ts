// The real city (sr_city_stream) as a place to start maps from and to check: a top-down height map of every
// chunk, cutting a rectangle out of it (clipped exactly at the edges, solid and look-only geometry kept apart the
// way the game has them), and scanning an area for spots that look finished but aren't: a floor you'd fall
// through, a building seen from above with no roof. Pure functions over parsed chunks: the game-objects worker
// runs them on the player's own packfiles, the tests on a local install. Game coordinates throughout (metres).
import type { Chunk } from '../gameObjects/chunk'
import type { ObjectMesh } from '../gameObjects/extract'
import { NO_COLLISION_FLAGS, solidity } from './collision'

export interface Rect { x0: number; z0: number; x1: number; z1: number }

/** City chunks worth reading: the low-detail stand-ins (_al) and the always-loaded sky and sea are left out. */
export const isCityChunk = (stem: string) => /^sr_chunk/i.test(stem) && !/_al$/i.test(stem)

const WATERISH = /water|ocean|wave|sky|cloud/i
/** The sea's surface in the city (m): below it is the sea bed and the like, never stood on. */
const SEA = -6
/**
 * Streets, pavements and ground ("Ter_" textures) are the city's terrain layer, which the game keeps solid
 * through a collision of its own (hiding the terrain with a debug switch leaves it walkable); the meshes' own
 * collision lists only part of it. So terrain counts as solid. (Inferred from the data, not read from the game.)
 */
const TERRAIN = /^ter_/i

// ---------------- every triangle of a chunk, in world space ----------------

/** One triangle as `forEachTriangle` hands it over (the arrays are reused: copy what you keep). */
export interface Tri {
  /** Corners x, y, z (three times). */
  p: Float64Array
  /** First UV set per corner (u, v, three times). */
  uv: Float64Array
  /** Unit normal's height (1 = facing straight up), and area in m². */
  ny: number
  area: number
  /** The player stands on it / it blocks the player. */
  solid: boolean
  /** Diffuse texture name ('' for none). */
  tex: string
}

const box = (ch: Chunk, mesh: number, P: number[], R: number[]) => {
  const m = ch.meshes[mesh]
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let c = 0; c < 8; c++) {
    const v = [c & 1 ? m.max[0] : m.min[0], c & 2 ? m.max[1] : m.min[1], c & 4 ? m.max[2] : m.min[2]]
    const x = P[0] + v[0] * R[0] + v[1] * R[3] + v[2] * R[6], z = P[2] + v[0] * R[2] + v[1] * R[5] + v[2] * R[8]
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z)
  }
  return { x0, z0, x1, z1 }
}

const overlaps = (a: Rect, b: Rect) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1

/** Calls `cb` for every drawn triangle of the chunk (only instances whose box meets `area`, when given). */
export function forEachTriangle(ch: Chunk, cb: (t: Tri) => void, area?: Rect) {
  const sol = solidity(ch)
  const shaped = new Set(ch.records.filter((r) => r.shape >= 0).map((r) => r.instance))
  const dv = new DataView(ch.bytes.buffer, ch.bytes.byteOffset, ch.bytes.byteLength)
  const t: Tri = { p: new Float64Array(9), uv: new Float64Array(6), ny: 0, area: 0, solid: false, tex: '' }
  const texOf = ch.materials.map((m) => m.textures.find((x) => !/\.tgn$/i.test(x)) ?? '')
  for (const [ii, inst] of ch.instances.entries()) {
    const mesh = ch.meshes[inst.mesh]
    if (!mesh) continue
    const P = inst.position, R = inst.rotation
    if (area && !overlaps(box(ch, inst.mesh, P, R), area)) continue
    const keys = sol ? sol.meshKeys[sol.canon[inst.mesh]] : null
    // Its own physics shape (a prop): solid as a whole. Otherwise the triangles its mesh's collision lists.
    const whole = shaped.has(ii)
    const instSolid = !(inst.flags & NO_COLLISION_FLAGS)
    for (const sub of mesh.subs) {
      const vb = ch.vbs[sub.vb]
      if (!vb || vb.stride < 12 || vb.stride % 4 || vb.stride > 128 || !vb.count || vb.vertexBytes < vb.stride * vb.count) continue
      for (let bi = 0; bi < sub.batches.length; bi++) {
        const b = sub.batches[bi]
        if (b.first + b.count > vb.indexCount) continue
        t.tex = texOf[b.material] ?? ''
        for (let j = 0; j + 2 < b.count; j++) {
          let a = dv.getUint16(vb.indexAt + 2 * (b.first + j)), c1 = dv.getUint16(vb.indexAt + 2 * (b.first + j + 1))
          const c2 = dv.getUint16(vb.indexAt + 2 * (b.first + j + 2))
          if (a === c1 || c1 === c2 || a === c2 || Math.max(a, c1, c2) >= vb.count) continue
          if (j & 1) [a, c1] = [c1, a]
          let ok = true
          for (const [k, i] of [a, c1, c2].entries()) {
            const o = vb.vertexAt + vb.stride * i
            const x = dv.getFloat32(o), y = dv.getFloat32(o + 4), z = dv.getFloat32(o + 8)
            if (!Number.isFinite(x + y + z) || Math.abs(x) + Math.abs(y) + Math.abs(z) > 1e5) { ok = false; break }
            t.p[3 * k] = P[0] + x * R[0] + y * R[3] + z * R[6]
            t.p[3 * k + 1] = P[1] + x * R[1] + y * R[4] + z * R[7]
            t.p[3 * k + 2] = P[2] + x * R[2] + y * R[5] + z * R[8]
            if (vb.stride >= 24) { t.uv[2 * k] = dv.getInt16(o + 20) / 1024; t.uv[2 * k + 1] = dv.getInt16(o + 22) / 1024 } else { t.uv[2 * k] = 0; t.uv[2 * k + 1] = 0 }
          }
          if (!ok) continue
          const p = t.p
          const ex = p[3] - p[0], ey = p[4] - p[1], ez = p[5] - p[2], fx = p[6] - p[0], fy = p[7] - p[1], fz = p[8] - p[2]
          const nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx
          const len = Math.hypot(nx, ny, nz)
          if (len < 1e-9) continue
          t.area = len / 2
          t.ny = ny / len
          t.solid = (instSolid && (whole || !!keys?.has((bi << 16) | (b.first + j)))) || TERRAIN.test(t.tex)
          cb(t)
        }
      }
    }
  }
}

/** Neighbouring chunks carry some of the same geometry: a key that's equal for the same triangle in either. */
export function triangleKey(p: Float64Array): string {
  const c = [0, 1, 2].map((k) => `${Math.round(p[3 * k] * 50)},${Math.round(p[3 * k + 1] * 50)},${Math.round(p[3 * k + 2] * 50)}`)
  return c.sort().join('|')
}

/** forEachTriangle over several chunks, each shared triangle once. */
export function forEachAreaTriangle(chunks: [string, Chunk][], r: Rect, cb: (t: Tri, chunk: number) => void) {
  const seen = new Set<string>()
  chunks.forEach(([, ch], ci) => forEachTriangle(ch, (t) => {
    const k = triangleKey(t.p)
    if (seen.has(k)) return
    seen.add(k)
    cb(t, ci)
  }, r))
}

/**
 * Street level in an area (m): low in the spread of its flat solid surfaces. Pavements, crossings and grass at
 * street level are solid in the game through its terrain collision, which the chunks' own lists don't show, so
 * the cut keeps them solid and the scan only judges floors above it.
 */
export function streetLevel(chunks: [string, Chunk][], r: Rect): number {
  const heights: number[] = []
  forEachAreaTriangle(chunks, r, (t) => { if (t.solid && t.ny > 0.85) heights.push(t.p[1], t.p[4], t.p[7]) })
  heights.sort((a, b) => a - b)
  return heights.length ? heights[Math.floor(heights.length * 0.1)] : 0
}
/** Up to this far (m) above or below street level, a surface facing up counts as ground. */
const STREET_BAND = 1.2

// ---------------- a grid over the ground ----------------

export class Grid {
  readonly w: number
  readonly h: number
  constructor(readonly area: Rect, readonly cell: number) {
    this.w = Math.max(1, Math.ceil((area.x1 - area.x0) / cell))
    this.h = Math.max(1, Math.ceil((area.z1 - area.z0) / cell))
  }
  /** Calls `cb(cell index, height)` for every cell whose centre the triangle covers, seen from above. */
  cover(p: Float64Array, cb: (i: number, y: number) => void) {
    const { area, cell, w, h } = this
    const minX = Math.min(p[0], p[3], p[6]), maxX = Math.max(p[0], p[3], p[6]), minZ = Math.min(p[2], p[5], p[8]), maxZ = Math.max(p[2], p[5], p[8])
    const i0 = Math.max(0, Math.floor((minX - area.x0) / cell - 0.5)), i1 = Math.min(w - 1, Math.ceil((maxX - area.x0) / cell - 0.5))
    const j0 = Math.max(0, Math.floor((minZ - area.z0) / cell - 0.5)), j1 = Math.min(h - 1, Math.ceil((maxZ - area.z0) / cell - 0.5))
    if (i0 > i1 || j0 > j1) return
    const d = (p[3] - p[0]) * (p[8] - p[2]) - (p[6] - p[0]) * (p[5] - p[2])
    if (Math.abs(d) < 1e-9) return
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = area.x0 + (i + 0.5) * cell, z = area.z0 + (j + 0.5) * cell
      const a = ((p[3] - x) * (p[8] - z) - (p[6] - x) * (p[5] - z)) / d
      const b = ((p[6] - x) * (p[2] - z) - (p[0] - x) * (p[8] - z)) / d
      const c = 1 - a - b
      if (a < -1e-6 || b < -1e-6 || c < -1e-6) continue
      cb(j * w + i, a * p[1] + b * p[4] + c * p[7])
    }
  }
  centre(i: number): [number, number] { return [this.area.x0 + ((i % this.w) + 0.5) * this.cell, this.area.z0 + (Math.floor(i / this.w) + 0.5) * this.cell] }
}

// ---------------- the city map ----------------

/** The top-down map's frame: metres per pixel, and the square of the world it covers. */
export const MAP = { cell: 4, x0: -2400, z0: -2400, size: 1200 }
/** Tiles that say which chunks hold geometry where (for picking the chunks an area needs). */
export const TILE = 64

export interface ChunkSummary {
  stem: string
  /** Tiles (index ty * TILES + tx over MAP's square) holding any of the chunk's triangles. */
  tiles: number[]
  triangles: number
}
export const TILES = Math.ceil((MAP.size * MAP.cell) / TILE)

/** Adds a chunk to the city map (`top`: highest surface per pixel, -Infinity where there's nothing) and sums it up. */
export function mapChunk(ch: Chunk, stem: string, top: Float32Array): ChunkSummary {
  const tiles = new Set<number>()
  let triangles = 0
  forEachTriangle(ch, (t) => {
    triangles++
    for (let k = 0; k < 3; k++) {
      const x = t.p[3 * k], y = t.p[3 * k + 1], z = t.p[3 * k + 2]
      const i = Math.floor((x - MAP.x0) / MAP.cell), j = Math.floor((z - MAP.z0) / MAP.cell)
      if (i < 0 || j < 0 || i >= MAP.size || j >= MAP.size) continue
      const at = j * MAP.size + i
      if (y > top[at]) top[at] = y
      tiles.add(Math.floor(j * MAP.cell / TILE) * TILES + Math.floor(i * MAP.cell / TILE))
    }
  })
  return { stem, tiles: [...tiles], triangles }
}

/** The chunks with geometry in an area. */
export function chunksIn(summaries: ChunkSummary[], r: Rect): string[] {
  const t0 = Math.max(0, Math.floor((r.x0 - MAP.x0) / TILE)), t1 = Math.min(TILES - 1, Math.floor((r.x1 - MAP.x0) / TILE))
  const u0 = Math.max(0, Math.floor((r.z0 - MAP.z0) / TILE)), u1 = Math.min(TILES - 1, Math.floor((r.z1 - MAP.z0) / TILE))
  const want = new Set<number>()
  for (let u = u0; u <= u1; u++) for (let t = t0; t <= t1; t++) want.add(u * TILES + t)
  return summaries.filter((s) => s.tiles.some((x) => want.has(x))).map((s) => s.stem)
}

// ---------------- cutting an area out ----------------

export interface CutMeshes {
  /** What the player collides with, and what is only drawn (decals, grass, far detail): kept apart as in the game. */
  solid: ObjectMesh
  look: ObjectMesh
  /** The chunk each material's texture came from (for finding its picture). */
  matChunk: string[]
  /** Street level (metres, game frame): the meshes are moved so it sits at 0, and the area's centre at x = z = 0. */
  ground: number
  /** Flat solid ground near street level a player can stand on (x, y, z after the move), for spawns. */
  standable: [number, number, number][]
}

class MeshBuilder {
  pos: number[] = []; uv: number[] = []; tri: number[] = []; mat: number[] = []
  add(poly: number[][], m: number) {
    const base = this.pos.length / 3
    for (const v of poly) { this.pos.push(v[0], v[1], v[2]); this.uv.push(v[3], v[4]) }
    for (let k = 1; k + 1 < poly.length; k++) { this.tri.push(base, base + k, base + k + 1); this.mat.push(m) }
  }
  done(materials: string[], shift: [number, number, number]): ObjectMesh {
    const p = new Float32Array(this.pos.length)
    for (let i = 0; i < this.pos.length; i++) p[i] = this.pos[i] + shift[i % 3]
    return { positions: p, uvs: new Float32Array(this.uv), triangles: new Uint32Array(this.tri), triMaterial: new Uint16Array(this.mat), materials }
  }
}

/** A triangle (x, y, z, u, v per corner) clipped to the rectangle, as a polygon; empty when it's outside. */
export function clip(poly: number[][], r: Rect): number[][] {
  const planes: [number, number, number][] = [[0, 1, r.x0], [0, -1, -r.x1], [2, 1, r.z0], [2, -1, -r.z1]]
  let out = poly
  for (const [axis, s, lim] of planes) {
    if (!out.length) break
    const next: number[][] = []
    for (let k = 0; k < out.length; k++) {
      const a = out[k], b = out[(k + 1) % out.length]
      const da = s * a[axis] - lim, db = s * b[axis] - lim
      if (da >= 0) next.push(a)
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); next.push(a.map((v, i) => v + (b[i] - v) * t)) }
    }
    out = next
  }
  return out.length >= 3 ? out : []
}

/** Cuts the rectangle out of the given chunks. */
export function cutArea(chunks: [string, Chunk][], r: Rect): CutMeshes {
  const solid = new MeshBuilder(), look = new MeshBuilder()
  const materials: string[] = [], matChunk: string[] = []
  const matIndex = new Map<string, number>()
  const grid = new Grid(r, 2)
  const floor = new Float32Array(grid.w * grid.h).fill(-Infinity)
  const ceiling: number[][] = Array.from({ length: grid.w * grid.h }, () => [])
  const ground = streetLevel(chunks, r)
  forEachAreaTriangle(chunks, r, (t, ci) => {
      if (!t.solid && t.ny > 0.7 && t.tex && Math.abs((t.p[1] + t.p[4] + t.p[7]) / 3 - ground) <= STREET_BAND) t.solid = true
      const stem = chunks[ci][0]
      const corners = [0, 1, 2].map((k) => [t.p[3 * k], t.p[3 * k + 1], t.p[3 * k + 2], t.uv[2 * k], t.uv[2 * k + 1]])
      const inside = corners.every((v) => v[0] >= r.x0 && v[0] <= r.x1 && v[2] >= r.z0 && v[2] <= r.z1)
      // Untextured look-only planes (the sea bed) draw nothing worth keeping.
      if (!t.solid && !t.tex) return
      const poly = inside ? corners : clip(corners, r)
      if (!poly.length) return
      const key = t.tex.toLowerCase()
      let m = matIndex.get(key)
      if (m === undefined) { m = materials.length; materials.push(t.tex); matChunk.push(stem); matIndex.set(key, m) }
      ;(t.solid ? solid : look).add(poly, m)
      if (t.solid) {
        if (t.ny > 0.85) grid.cover(t.p, (i, y) => { if (y > floor[i]) floor[i] = y })
        else if (t.ny < -0.3) grid.cover(t.p, (i, y) => ceiling[i].push(y))
      }
  })
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2
  const shift: [number, number, number] = [-cx, -ground, -cz]
  const standable: [number, number, number][] = []
  for (let i = 0; i < floor.length; i++) {
    const y = floor[i]
    if (!(Math.abs(y - ground) < 1.5)) continue
    // Head room: nothing solid hanging lower than a standing player above it.
    if (ceiling[i].some((c) => c > y + 0.3 && c < y + 2.2)) continue
    const [x, z] = grid.centre(i)
    standable.push([x - cx, y - ground, z - cz])
  }
  return { solid: solid.done(materials, shift), look: look.done(materials, shift), matChunk, ground, standable }
}

// ---------------- looking for holes ----------------

export interface Hole {
  kind: 'fall' | 'roof'
  /** Centre (game frame, metres) and size across. */
  x: number; y: number; z: number
  w: number; d: number
  /** Area flagged, m². */
  area: number
  /** Fall: how far you'd drop to the next solid surface (Infinity: nothing at all). */
  drop?: number
  /** Height above the area's street level (m): rooftops far up are rarely reached. */
  above: number
  chunk: string
}

/** Grid size (m) the scan works at. */
const SCAN = 2

/**
 * Scans the rectangle: "fall" where a surface you can see, facing up, has nothing solid under it within 2 m;
 * "roof" where, looking straight down, the first thing you see is the back of a surface (an open top).
 * Each spot is a cluster of flagged cells of at least `minArea` m².
 */
export function scanArea(chunks: [string, Chunk][], r: Rect, minArea = 12): Hole[] {
  const g = new Grid(r, SCAN)
  const n = g.w * g.h
  // Solid surfaces facing up, per cell (a few heights each), and the topmost surface seen from above.
  const solidY: number[][] = Array.from({ length: n }, () => [])
  const topY = new Float32Array(n).fill(-Infinity), topNy = new Float32Array(n), topChunk = new Int16Array(n).fill(-1)
  const floors: { p: Float64Array; chunk: number }[] = []
  const ground = streetLevel(chunks, r)
  forEachAreaTriangle(chunks, r, (t, ci) => {
      if (Math.abs(t.ny) > 0.3 && !(t.ny < 0 && /leaf|leaves|tree|palm|foliage|bush|ivy|vine/i.test(t.tex))) {
        g.cover(t.p, (i, y) => { if (y > topY[i]) { topY[i] = y; topNy[i] = t.ny; topChunk[i] = ci } })
      }
      const y = (t.p[1] + t.p[4] + t.p[7]) / 3
      // Ground at street level is solid in the game whatever the chunk lists say (see streetLevel).
      if (t.ny > 0.5 && (t.solid || (t.tex && Math.abs(y - ground) <= STREET_BAND))) g.cover(t.p, (i, yy) => { if (solidY[i].length < 12) solidY[i].push(yy) })
      // Untextured planes (the sea bed and such) and anything under the sea are never stood on.
      else if (t.ny > 0.7 && !t.solid && t.area > 0.25 && t.tex && !WATERISH.test(t.tex) && y > SEA && y > ground + STREET_BAND) floors.push({ p: Float64Array.from(t.p), chunk: ci })
  })
  const fall = new Float32Array(n).fill(NaN), fallY = new Float32Array(n), fallChunk = new Int16Array(n).fill(-1)
  for (const f of floors) {
    g.cover(f.p, (i, y) => {
      // Solid surfaces under this cell or the ones round it: a strip drawn beside the strip that's solid
      // (lanes of one road, the two halves of a ramp) stands on it all the same.
      let below = -Infinity
      const ci = i % g.w, cj = Math.floor(i / g.w)
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ni = ci + di, nj = cj + dj
        if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) continue
        for (const s of solidY[nj * g.w + ni]) {
          if (s > y + 0.3) continue
          if (s > below) below = s
        }
      }
      // Solid within 2 m under it (a decal, a grass tuft, a rug on a floor): fine.
      if (y - below <= 2) return
      const drop = y - below
      if (Number.isNaN(fall[i]) || drop > fall[i]) { fall[i] = drop; fallY[i] = y; fallChunk[i] = f.chunk }
    })
  }
  const holes: Hole[] = []
  const take = (kind: Hole['kind'], hit: (i: number) => boolean) => {
    const seen = new Uint8Array(n)
    for (let s = 0; s < n; s++) {
      if (seen[s] || !hit(s)) continue
      const cells: number[] = []
      const stack = [s]
      seen[s] = 1
      while (stack.length) {
        const c = stack.pop()!
        cells.push(c)
        const ci = c % g.w, cj = Math.floor(c / g.w)
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj
          if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) continue
          const q = nj * g.w + ni
          if (!seen[q] && hit(q)) { seen[q] = 1; stack.push(q) }
        }
      }
      const area = cells.length * SCAN * SCAN
      if (area < minArea) continue
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, ys = 0, drop = 0
      const votes = new Map<number, number>()
      for (const c of cells) {
        const [x, z] = g.centre(c)
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z)
        ys += kind === 'fall' ? fallY[c] : topY[c]
        if (kind === 'fall') drop = Math.max(drop, fall[c])
        const ch = kind === 'fall' ? fallChunk[c] : topChunk[c]
        votes.set(ch, (votes.get(ch) ?? 0) + 1)
      }
      const chunk = chunks[[...votes.entries()].sort((a, b) => b[1] - a[1])[0][0]]?.[0] ?? ''
      holes.push({
        kind, x: (x0 + x1) / 2, y: ys / cells.length, z: (z0 + z1) / 2, w: x1 - x0 + SCAN, d: z1 - z0 + SCAN, area, above: ys / cells.length - ground,
        ...(kind === 'fall' ? { drop } : {}), chunk,
      })
    }
  }
  take('fall', (i) => !Number.isNaN(fall[i]))
  take('roof', (i) => topNy[i] < -0.3)
  return holes.sort((a, b) => b.area - a.area)
}
