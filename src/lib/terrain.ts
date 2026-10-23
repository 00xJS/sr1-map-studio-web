// Terrain: a heightfield ground object. A grid of heights sits on a flat
// slab (the shape's size: width × base thickness × depth); the surface is
// smooth-shaded triangles, closed underneath and round the edges so it is a
// solid like every other shape. Materials follow the ground: "top" (grass)
// on gentle ground, "side" (dirt) on slopes and the slab's edges, "rock" on
// the steepest and highest ground, with a little noise so the borders wander
// instead of following contour lines. Coordinates are local to the object,
// origin at the bottom centre, in editor units (1 unit = 0.5 m in game).
import type { ObjModel } from './geometry'
import type { Shape } from './shapes'
import type { Tex } from './sampleKit'

/** Generated ground textures: grass on the flats, dirt on slopes, broken rock on the steepest and highest ground. */
export const TERRAIN_TEX = {
  grass: { gen: 'grass', tweak: { color: '#4a7a2c', accent: '#7d8a3a', scale: 4, wear: 0.3, seed: 98 } } as Tex,
  dirt: { gen: 'dirt' } as Tex,
  rock: { gen: 'gravel', tweak: { color: '#6f6a61', accent: '#3d3a35', scale: 12, wear: 0.6, seed: 61 }, surface: 0 } as Tex,
}

/** Cells along each side at most: 64 × 64 cells is 8,192 surface triangles, well inside one render batch. */
export const TERRAIN_MAX_CELLS = 64
/** Steepest a slope may get while "keep walkable" is on: just under 45° on every triangle. */
export const WALKABLE_GRADIENT = 0.7
export const TERRAIN_MATS = ['top', 'side', 'rock'] as const
export type TerrainMat = (typeof TERRAIN_MATS)[number]

/** A flat terrain w × d, about `cell` units per grid square, on a slab `base` thick. */
export function terrainShape(w: number, d: number, o: { cell?: number; base?: number; tile?: number } = {}): Shape {
  const cell = o.cell ?? 4
  const nx = cellsFor(w, cell), nz = cellsFor(d, cell)
  return { kind: 'terrain', size: [w, o.base ?? 1, d], tile: o.tile ?? 8, cells: [nx, nz], heights: new Array((nx + 1) * (nz + 1)).fill(0) }
}

const cellsFor = (len: number, cell: number) => Math.max(2, Math.min(TERRAIN_MAX_CELLS, Math.round(len / Math.max(0.5, cell))))

/** The grid of a terrain shape, mended if the stored heights don't match its cell counts. */
export function grid(s: Shape): { nx: number; nz: number; h: number[] } {
  const nx = Math.max(1, Math.min(TERRAIN_MAX_CELLS, Math.round(s.cells?.[0] ?? 2)))
  const nz = Math.max(1, Math.min(TERRAIN_MAX_CELLS, Math.round(s.cells?.[1] ?? 2)))
  const n = (nx + 1) * (nz + 1)
  const h = s.heights?.length === n ? s.heights : new Array(n).fill(0)
  return { nx, nz, h }
}

/** Lowest height (relative to the slab top) the ground may be dug to: the slab keeps a sliver of thickness. */
export const floorOf = (s: Shape) => -Math.max(0, s.size[1] - 0.1)

/** Height of the surface above the slab top at local (x, z), on the actual triangles; null outside. */
export function heightAt(s: Shape, x: number, z: number): number | null {
  const { nx, nz, h } = grid(s)
  const [w, , d] = s.size
  const fx = ((x + w / 2) / w) * nx, fz = ((z + d / 2) / d) * nz
  if (fx < -1e-6 || fz < -1e-6 || fx > nx + 1e-6 || fz > nz + 1e-6) return null
  const i = Math.min(nx - 1, Math.max(0, Math.floor(fx))), j = Math.min(nz - 1, Math.max(0, Math.floor(fz)))
  const u = fx - i, v = fz - j
  const H = (a: number, b: number) => h[(j + b) * (nx + 1) + i + a]
  // Same split as the mesh: cells alternate their diagonal.
  if ((i + j) % 2 === 0) return u >= v ? H(0, 0) + u * (H(1, 0) - H(0, 0)) + v * (H(1, 1) - H(1, 0)) : H(0, 0) + v * (H(0, 1) - H(0, 0)) + u * (H(1, 1) - H(0, 1))
  return u + v <= 1 ? H(0, 0) + u * (H(1, 0) - H(0, 0)) + v * (H(0, 1) - H(0, 0)) : H(1, 1) + (1 - u) * (H(0, 1) - H(1, 1)) + (1 - v) * (H(1, 0) - H(1, 1))
}

/** Highest point of the surface above the slab top. */
export const peak = (s: Shape) => Math.max(0, ...grid(s).h)

// ---------------- sculpting ----------------

export type Brush = 'raise' | 'lower' | 'smooth' | 'flatten'
export interface Stroke {
  brush: Brush
  /** Local position of the brush centre. */
  x: number; z: number
  radius: number
  /** Units per second for raise and lower; 0..1 per second blend for smooth and flatten. */
  strength: number
  dt: number
  /** Flatten: the height (above the slab top) to level toward. */
  level?: number
}

/** Applies one step of a brush to the heights (returns new heights; the shape is left alone). */
export function sculpt(s: Shape, st: Stroke, walkable = true): number[] {
  const { nx, nz, h } = grid(s)
  const [w, , d] = s.size
  const cx = w / nx, cz = d / nz
  const out = h.slice()
  const lo = floorOf(s)
  const r = Math.max(0.5, st.radius)
  const i0 = Math.max(0, Math.floor(((st.x - r + w / 2) / w) * nx)), i1 = Math.min(nx, Math.ceil(((st.x + r + w / 2) / w) * nx))
  const j0 = Math.max(0, Math.floor(((st.z - r + d / 2) / d) * nz)), j1 = Math.min(nz, Math.ceil(((st.z + r + d / 2) / d) * nz))
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const dist = Math.hypot(-w / 2 + i * cx - st.x, -d / 2 + j * cz - st.z)
    if (dist >= r) continue
    // Smooth falloff: full in the middle, nothing at the rim.
    const f = 0.5 + 0.5 * Math.cos((Math.PI * dist) / r)
    const k = j * (nx + 1) + i
    if (st.brush === 'raise') out[k] = h[k] + st.strength * st.dt * f
    else if (st.brush === 'lower') out[k] = h[k] - st.strength * st.dt * f
    else {
      let target = st.level ?? 0
      if (st.brush === 'smooth') {
        let sum = 0, n = 0
        for (const [a, b] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
          const ii = i + a, jj = j + b
          if (ii < 0 || jj < 0 || ii > nx || jj > nz) continue
          sum += h[jj * (nx + 1) + ii]; n++
        }
        target = n ? sum / n : h[k]
      }
      out[k] = h[k] + (target - h[k]) * Math.min(1, st.strength * st.dt * f * 4)
    }
    out[k] = Math.max(lo, Math.min(200, out[k]))
  }
  return walkable ? limitSlope(out, nx, nz, cx, cz, out.map((_, k) => k).filter((k) => out[k] !== h[k])) : out
}

/**
 * Pulls heights in until no step between grid neighbours is steeper than
 * WALKABLE_GRADIENT. Each triangle's slope comes from two such steps, so every
 * triangle stays under 45° and players can walk anywhere on it. Points that
 * just moved (`moved`) give way to their neighbours, so a brush can't push the
 * rest of the terrain around.
 */
export function limitSlope(h: number[], nx: number, nz: number, cx: number, cz: number, moved: number[] = []): number[] {
  const out = h.slice()
  const soft = new Set(moved)
  const gx = WALKABLE_GRADIENT * cx, gz = WALKABLE_GRADIENT * cz
  for (let pass = 0; pass < 200; pass++) {
    let changed = false
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i
      for (const [a, b, g] of [[1, 0, gx], [0, 1, gz]] as const) {
        if (i + a > nx || j + b > nz) continue
        const q = (j + b) * (nx + 1) + i + a
        const diff = out[q] - out[k]
        if (Math.abs(diff) <= g + 1e-9) continue
        const excess = Math.abs(diff) - g
        // A moved point gives way entirely; between two fixed (or two moved) points, both give half.
        const sk = soft.has(k), sq = soft.has(q)
        const wk = sk === sq ? 0.5 : sk ? 1 : 0
        const sign = Math.sign(diff)
        out[k] += sign * excess * wk
        out[q] -= sign * excess * (1 - wk)
        changed = true
      }
    }
    if (!changed) break
  }
  return out
}

/** Steepest triangle of the surface, in degrees. */
export function steepest(s: Shape): number {
  const { nx, nz, h } = grid(s)
  const cx = s.size[0] / nx, cz = s.size[2] / nz
  let worst = 0
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const H = (a: number, b: number) => h[(j + b) * (nx + 1) + i + a]
    const tris = (i + j) % 2 === 0
      ? [[(H(1, 0) - H(0, 0)) / cx, (H(1, 1) - H(1, 0)) / cz], [(H(1, 1) - H(0, 1)) / cx, (H(0, 1) - H(0, 0)) / cz]]
      : [[(H(1, 0) - H(0, 0)) / cx, (H(0, 1) - H(0, 0)) / cz], [(H(1, 1) - H(0, 1)) / cx, (H(1, 1) - H(1, 0)) / cz]]
    for (const [a, b] of tris) worst = Math.max(worst, Math.atan(Math.hypot(a, b)) * (180 / Math.PI))
  }
  return worst
}

// ---------------- shaping helpers (for generators) ----------------

/** Sets every grid point from a function of local (x, z) (heights above the slab top), then keeps it walkable. */
export function shapeTerrain(s: Shape, f: (x: number, z: number) => number, walkable = true): Shape {
  const { nx, nz } = grid(s)
  const [w, , d] = s.size
  const lo = floorOf(s)
  const h: number[] = []
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) h.push(+Math.max(lo, f(-w / 2 + (i * w) / nx, -d / 2 + (j * d) / nz)).toFixed(3))
  return { ...s, cells: [nx, nz], heights: walkable ? limitSlope(h, nx, nz, w / nx, d / nz).map((v) => +v.toFixed(3)) : h }
}

/** Smooth value noise in 0..1 (no tiling needed): rolling hills. */
export function hills(seed: number, scale: number) {
  const hash = (x: number, z: number) => {
    let n = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 1442695041)
    n = Math.imul(n ^ (n >>> 13), 1274126177)
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295
  }
  const sm = (t: number) => t * t * (3 - 2 * t)
  const one = (x: number, z: number) => {
    const xi = Math.floor(x), zi = Math.floor(z), u = sm(x - xi), v = sm(z - zi)
    const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), e = hash(xi + 1, zi + 1)
    return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v
  }
  return (x: number, z: number) => (one(x / scale, z / scale) * 0.65 + one((x * 2.1) / scale + 17, (z * 2.1) / scale + 5) * 0.35)
}

// ---------------- mesh ----------------

type V3 = [number, number, number]
const wander = hills(4111, 14)

/**
 * Which material a surface triangle gets, from the slope at its corners (taken
 * from the smooth shading, so neighbours agree) and its height. A slow noise
 * moves the borders about so they wander like real ground instead of following
 * contour lines or flickering from one triangle to the next.
 */
function surfaceMat(slope: number, rel: number, top: number, x: number, z: number): TerrainMat {
  const j = (wander(x, z) - 0.5) * 14
  const tall = top >= 4
  if (slope > 39 + j || (tall && rel > 0.85 && slope > 20 + j)) return 'rock'
  if (slope > 27 + j || (tall && rel > 0.7 && slope > 15 + j)) return 'side'
  return 'top'
}

/** The terrain as a mesh: shared, smooth-shaded vertices on top; the slab's edges and bottom closed. */
export function terrainModel(s: Shape): ObjModel {
  const { nx, nz, h } = grid(s)
  const [w, base, d] = s.size.map((v) => Math.max(0.01, v))
  const t = Math.max(0.05, s.tile)
  const pos: number[] = [], uv: number[] = [], faces: number[] = [], mat: number[] = []
  const vert = (p: V3, u: number, v: number) => { pos.push(p[0], p[1], p[2]); uv.push(u, v); return pos.length / 3 - 1 }
  const P = (i: number, j: number): V3 => [-w / 2 + (i * w) / nx, base + Math.max(-base + 0.01, h[j * (nx + 1) + i]), -d / 2 + (j * d) / nz]
  const top = Math.max(0, ...h)
  // Surface: one vertex per grid point.
  const ids: number[] = []
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const p = P(i, j); ids.push(vert(p, p[0] / t, -p[2] / t)) }
  const tri = (a: number, b: number, c: number, m: number) => { faces.push(a, b, c); mat.push(m) }
  const at = (k: number): V3 => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]]
  // Slope at each grid point from its neighbours (one-sided at the edges), in degrees.
  const H = (i: number, j: number) => h[Math.min(nz, Math.max(0, j)) * (nx + 1) + Math.min(nx, Math.max(0, i))]
  const cx = w / nx, cz = d / nz
  const slope = ids.map((_, k) => {
    const i = k % (nx + 1), j = Math.floor(k / (nx + 1))
    const gx = (H(i + 1, j) - H(i - 1, j)) / (cx * (i > 0 && i < nx ? 2 : 1))
    const gz = (H(i, j + 1) - H(i, j - 1)) / (cz * (j > 0 && j < nz ? 2 : 1))
    return Math.atan(Math.hypot(gx, gz)) * (180 / Math.PI)
  })
  const surf = (a: number, b: number, c: number) => {
    const p = [at(a), at(b), at(c)]
    const mx = (p[0][0] + p[1][0] + p[2][0]) / 3, mz = (p[0][2] + p[1][2] + p[2][2]) / 3
    const rel = top > 0.5 ? ((p[0][1] + p[1][1] + p[2][1]) / 3 - base) / top : 0
    tri(a, b, c, TERRAIN_MATS.indexOf(surfaceMat((slope[a] + slope[b] + slope[c]) / 3, rel, top, mx, mz)))
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const A = ids[j * (nx + 1) + i], B = ids[j * (nx + 1) + i + 1], C = ids[(j + 1) * (nx + 1) + i + 1], E = ids[(j + 1) * (nx + 1) + i]
    // Wound counter-clockwise seen from above (normals up); the diagonal alternates so slopes don't streak one way.
    if ((i + j) % 2 === 0) { surf(A, E, C); surf(A, C, B) } else { surf(A, E, B); surf(B, E, C) }
  }
  // Edges: a wall of quads from y 0 up to the surface on each side, facing out.
  const SIDE = TERRAIN_MATS.indexOf('side')
  const edge = (pts: V3[], out: V3, u: (p: V3) => number) => {
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1]
      const q: V3[] = [[a[0], 0, a[2]], [b[0], 0, b[2]], b, a]
      // Flip the winding if it would face inward.
      const n = cross(sub(q[1], q[0]), sub(q[2], q[0]))
      const ord = n[0] * out[0] + n[2] * out[2] >= 0 ? q : [q[0], q[3], q[2], q[1]]
      const vs = ord.map((p) => vert(p, u(p) / t, p[1] / t))
      tri(vs[0], vs[1], vs[2], SIDE); tri(vs[0], vs[2], vs[3], SIDE)
    }
  }
  const row = (j: number) => [...Array(nx + 1)].map((_, i) => P(i, j))
  const col = (i: number) => [...Array(nz + 1)].map((_, j) => P(i, j))
  edge(row(0), [0, 0, -1], (p) => p[0])
  edge(row(nz), [0, 0, 1], (p) => p[0])
  edge(col(0), [-1, 0, 0], (p) => p[2])
  edge(col(nx), [1, 0, 0], (p) => p[2])
  // Bottom: a fan from the middle to every edge point, facing down (no slivers, no T-junctions).
  const ring: V3[] = [...row(0), ...col(nx).slice(1), ...row(nz).reverse().slice(1), ...col(0).reverse().slice(1, -1)].map((p): V3 => [p[0], 0, p[2]])
  const mid = vert([0, 0, 0], 0, 0)
  const rv = ring.map((p) => vert(p, p[0] / t, -p[2] / t))
  for (let k = 0; k < rv.length; k++) {
    const a = rv[k], b = rv[(k + 1) % rv.length]
    const n = cross(sub(at(a), at(mid)), sub(at(b), at(mid)))
    if (n[1] <= 0) tri(mid, a, b, SIDE); else tri(mid, b, a, SIDE)
  }
  return {
    positions: new Float32Array(pos), uvs: new Float32Array(uv), hasUv: new Uint8Array(pos.length / 3).fill(1),
    faces: new Uint32Array(faces), faceMat: new Uint16Array(mat), mats: [...TERRAIN_MATS], mtllibs: [],
  }
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

const fmt = (n: number) => String(+n.toFixed(4))

/** OBJ text for a terrain (materials top, side and rock; surface vertices shared so it shades smoothly). */
export function terrainObj(s: Shape): string {
  const m = terrainModel(s)
  const { nx, nz } = grid(s)
  const lines = ['# SR1 Map Studio terrain: ' + JSON.stringify({ size: s.size, cells: [nx, nz], tile: s.tile })]
  for (let k = 0; k < m.positions.length; k += 3) lines.push(`v ${fmt(m.positions[k])} ${fmt(m.positions[k + 1])} ${fmt(m.positions[k + 2])}`)
  for (let k = 0; k < m.uvs.length; k += 2) lines.push(`vt ${fmt(m.uvs[k])} ${fmt(m.uvs[k + 1])}`)
  TERRAIN_MATS.forEach((name, mi) => {
    const fs: string[] = []
    for (let f = 0; f < m.faceMat.length; f++) {
      if (m.faceMat[f] !== mi) continue
      const [a, b, c] = [m.faces[f * 3] + 1, m.faces[f * 3 + 1] + 1, m.faces[f * 3 + 2] + 1]
      fs.push(`f ${a}/${a} ${b}/${b} ${c}/${c}`)
    }
    if (fs.length) lines.push('usemtl ' + name, ...fs)
  })
  return lines.join('\n') + '\n'
}

/** Terrain triangles as separate faces with their material, for building it into a prefab with other shapes. */
export function terrainFaces(s: Shape): { pts: V3[]; mat: TerrainMat }[] {
  const m = terrainModel(s)
  const at = (k: number): V3 => [m.positions[k * 3], m.positions[k * 3 + 1], m.positions[k * 3 + 2]]
  const out: { pts: V3[]; mat: TerrainMat }[] = []
  for (let f = 0; f < m.faceMat.length; f++) out.push({ pts: [at(m.faces[f * 3]), at(m.faces[f * 3 + 1]), at(m.faces[f * 3 + 2])], mat: TERRAIN_MATS[m.faceMat[f]] })
  return out
}
