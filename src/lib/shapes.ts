// Block-out shapes: simple solids generated as OBJ text, so they go through
// the same pipeline as imported models. Texture coordinates come from world
// position (one texture repeat per `tile` units), so a brick texture keeps its
// brick size whatever the shape's dimensions. Faces that point up use the
// "top" material, all others "side". Origin is the bottom center.
import type { Vec3 } from './project'

export type ShapeKind = 'box' | 'ramp' | 'stairs' | 'cylinder' | 'roof' | 'blob'

export interface Shape {
  kind: ShapeKind
  /** Width (X), height (Y), depth (Z), in editor units. */
  size: Vec3
  /** Stairs: number of steps. Cylinder: number of sides. */
  segments?: number
  /** Units per texture repeat. */
  tile: number
  /** Cylinder: top width as a fraction of the bottom (0 = cone, 1 = straight, above 1 flares out). */
  taper?: number
  /** Box: rounds off the vertical and top edges by this many units. */
  bevel?: number
  /** Cylinder: lying on its side, its length along X (wheels, logs, pipes). Size stays width (length) × height × depth. */
  lie?: boolean
  /** Blob: the outline as [x, z] points round the middle (each visible from the centre), extruded up by the height. */
  outline?: [number, number][]
}

export interface ShapePreset { label: string; shape: Shape; hint: string }

export const SHAPE_PRESETS: Record<string, ShapePreset> = {
  floor: { label: 'Floor', hint: 'A large flat slab to build on', shape: { kind: 'box', size: [40, 1, 40], tile: 4 } },
  wall: { label: 'Wall', hint: 'A straight wall section', shape: { kind: 'box', size: [12, 6, 1], tile: 4 } },
  box: { label: 'Box', hint: 'Crate-sized cover', shape: { kind: 'box', size: [3, 3, 3], tile: 3 } },
  platform: { label: 'Platform', hint: 'A raised deck to jump up on', shape: { kind: 'box', size: [10, 3, 10], tile: 4 } },
  ramp: { label: 'Ramp', hint: 'Rises toward the back (−Z)', shape: { kind: 'ramp', size: [6, 3, 10], tile: 4 } },
  stairs: { label: 'Stairs', hint: 'Steps rising toward the back (−Z)', shape: { kind: 'stairs', size: [6, 3, 8], segments: 8, tile: 4 } },
  pillar: { label: 'Pillar', hint: 'A round column', shape: { kind: 'cylinder', size: [2, 8, 2], segments: 16, tile: 4 } },
  block: { label: 'Rounded box', hint: 'Cover with softened edges', shape: { kind: 'box', size: [4, 3, 4], tile: 3, bevel: 0.4 } },
  roof: { label: 'Roof', hint: 'A pitched roof; the ridge runs along X', shape: { kind: 'roof', size: [12, 4, 10], tile: 4 } },
  cone: { label: 'Cone', hint: 'A cone or spire', shape: { kind: 'cylinder', size: [3, 5, 3], segments: 16, tile: 4, taper: 0 } },
}

type V = [number, number, number]
interface Face { pts: V[]; top: boolean }

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const avg = (pts: V[]): V => pts.reduce<V>((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0])

/** Polygon wound counter-clockwise seen from outside (OBJ convention), judged against the solid's center. */
function outward(pts: V[], center: V): V[] {
  const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]))
  return dot(n, sub(avg(pts), center)) >= 0 ? pts : [...pts].reverse()
}

function boxFaces(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Face[] {
  const c: V = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]
  const quads: [V[], boolean][] = [
    [[[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], true],
    [[[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], false],
    [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], false],
    [[[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], false],
    [[[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], false],
    [[[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], false],
  ]
  return quads.map(([pts, top]) => ({ pts: outward(pts, c), top }))
}

/** Faces whose normal points mostly up use the "top" material. */
function upward(pts: V[], center: V): Face {
  const o = outward(pts, center)
  const n = cross(sub(o[1], o[0]), sub(o[2], o[0]))
  const len = Math.hypot(n[0], n[1], n[2]) || 1
  return { pts: o, top: n[1] / len > 0.55 }
}

/** Removes repeated neighbouring points (a chamfer that closes into a corner). */
const dedupe = (pts: V[]) => pts.filter((p, i) => { const q = pts[(i + pts.length - 1) % pts.length]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 1e-6 })

function bevelFaces(x0: number, x1: number, h: number, z0: number, z1: number, bv: number): Face[] {
  const b = Math.max(0.001, Math.min(bv, (x1 - x0) / 2 - 0.001, (z1 - z0) / 2 - 0.001, h / 2))
  // Octagon with cut corners; [point, inward step] pairs, going round.
  const ring: [number, number, number, number][] = [
    [x0 + b, z0, 0, 1], [x1 - b, z0, 0, 1], [x1, z0 + b, -1, 0], [x1, z1 - b, -1, 0],
    [x1 - b, z1, 0, -1], [x0 + b, z1, 0, -1], [x0, z1 - b, 1, 0], [x0, z0 + b, 1, 0],
  ]
  const r0 = ring.map(([x, z]): V => [x, 0, z])
  const r1 = ring.map(([x, z]): V => [x, h - b, z])
  const r2 = ring.map(([x, z, ix, iz]): V => [x + ix * b, h, z + iz * b])
  const c: V = [(x0 + x1) / 2, h / 2, (z0 + z1) / 2]
  const out: Face[] = [{ pts: outward(dedupe(r0), c), top: false }, { pts: outward(dedupe(r2), c), top: true }]
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8
    out.push({ pts: outward([r0[i], r0[j], r1[j], r1[i]], c), top: false })
    const slant = dedupe([r1[i], r1[j], r2[j], r2[i]])
    if (slant.length >= 3) out.push(upward(slant, c))
  }
  return out
}

function faces(s: Shape): Face[] {
  const [w, h, d] = s.size.map((v) => Math.max(0.01, v)) as V
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  switch (s.kind) {
    case 'box': return s.bevel ? bevelFaces(x0, x1, h, z0, z1, s.bevel) : boxFaces(x0, x1, 0, h, z0, z1)
    case 'roof': {
      // Gable roof: ridge along X at the top middle.
      const c: V = [0, h / 3, 0]
      return [
        { pts: outward([[x0, 0, z0], [x1, 0, z0], [x1, h, 0], [x0, h, 0]], c), top: true },
        { pts: outward([[x0, 0, z1], [x1, 0, z1], [x1, h, 0], [x0, h, 0]], c), top: true },
        { pts: outward([[x0, 0, z0], [x0, 0, z1], [x0, h, 0]], c), top: false },
        { pts: outward([[x1, 0, z0], [x1, 0, z1], [x1, h, 0]], c), top: false },
        { pts: outward([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], c), top: false },
      ]
    }
    case 'ramp': {
      // Low edge at the front (+Z), high edge at the back (−Z).
      const c: V = [0, h / 3, -d / 6]
      const polys: [V[], boolean][] = [
        [[[x0, 0, z1], [x1, 0, z1], [x1, h, z0], [x0, h, z0]], true],
        [[[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], false],
        [[[x0, 0, z0], [x1, 0, z0], [x1, h, z0], [x0, h, z0]], false],
        [[[x1, 0, z1], [x1, 0, z0], [x1, h, z0]], false],
        [[[x0, 0, z1], [x0, 0, z0], [x0, h, z0]], false],
      ]
      return polys.map(([pts, top]) => ({ pts: outward(pts, c), top }))
    }
    case 'stairs': {
      const n = Math.max(1, Math.min(64, Math.round(s.segments ?? 8)))
      const out: Face[] = []
      for (let i = 0; i < n; i++) {
        const za = z1 - (d * i) / n, zb = z1 - (d * (i + 1)) / n
        out.push(...boxFaces(x0, x1, 0, (h * (i + 1)) / n, zb, za))
      }
      return out
    }
    case 'blob': {
      // A flat organic slab (pond, lawn, puddle): fans from the middle so any outline seen from the centre works.
      const ring = s.outline?.length ? s.outline : [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as [number, number][]
      const n = ring.length
      const c: V = [0, h / 2, 0]
      const out: Face[] = []
      for (let i = 0; i < n; i++) {
        const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % n]
        out.push({ pts: outward([[0, h, 0], [ax, h, az], [bx, h, bz]], [0, -1e6, 0]), top: true })
        out.push({ pts: outward([[0, 0, 0], [ax, 0, az], [bx, 0, bz]], [0, 1e6, 0]), top: false })
        out.push({ pts: outward([[ax, 0, az], [bx, 0, bz], [bx, h, bz], [ax, h, az]], c), top: false })
      }
      return out
    }
    case 'cylinder': {
      if (s.lie) {
        // Built upright with the length as its height, then tipped onto its side.
        const c: V = [0, h / 2, 0]
        return faces({ ...s, lie: false, size: [h, w, d] }).map((f) => upward(f.pts.map(([x, y, z]): V => [y - w / 2, x + h / 2, z]), c))
      }
      const n = Math.max(3, Math.min(64, Math.round(s.segments ?? 16)))
      const ring = (y: number) => [...Array(n)].map((_, i): V => {
        const a = (i / n) * Math.PI * 2
        return [Math.cos(a) * (w / 2), y, Math.sin(a) * (d / 2)]
      })
      const t = Math.max(0, Math.min(3, s.taper ?? 1))
      const lo = ring(0), hi = ring(h).map((p): V => [p[0] * t, h, p[2] * t])
      const c: V = [0, h / 3, 0]
      const out: Face[] = [{ pts: outward(lo, c), top: false }]
      if (t > 0) out.push({ pts: outward(hi, c), top: true })
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        // A cone meets in a point: triangles instead of quads.
        out.push(t > 0 ? (t !== 1 ? upward([lo[i], lo[j], hi[j], hi[i]], c) : { pts: outward([lo[i], lo[j], hi[j], hi[i]], c), top: false }) : upward([lo[i], lo[j], [0, h, 0]], c))
      }
      return out
    }
  }
}

/** World-space UVs: project onto the plane the face is most aligned with. */
function uv(p: V, normal: V, tile: number): [number, number] {
  const ax = Math.abs(normal[0]), ay = Math.abs(normal[1]), az = Math.abs(normal[2])
  const t = Math.max(0.05, tile)
  if (ay >= ax && ay >= az) return [p[0] / t, -p[2] / t]
  if (ax >= az) return [p[2] / t, p[1] / t]
  return [p[0] / t, p[1] / t]
}

const fmt = (n: number) => String(+n.toFixed(5))

/** OBJ text with materials "top" and "side"; polygons are fan-triangulated by the importer. */
export function shapeObj(s: Shape): string {
  const lines = ['# SR1 Map Studio block-out shape: ' + JSON.stringify(s)]
  const vt: string[] = []
  const groups: Record<'top' | 'side', string[]> = { top: [], side: [] }
  let vi = 1
  for (const f of faces(s)) {
    const n = cross(sub(f.pts[1], f.pts[0]), sub(f.pts[2], f.pts[0]))
    const idx: string[] = []
    for (const p of f.pts) {
      lines.push(`v ${fmt(p[0])} ${fmt(p[1])} ${fmt(p[2])}`)
      const [u, v] = uv(p, n, s.tile)
      vt.push(`vt ${fmt(u)} ${fmt(v)}`)
      idx.push(`${vi}/${vi}`)
      vi++
    }
    groups[f.top ? 'top' : 'side'].push('f ' + idx.join(' '))
  }
  lines.push(...vt)
  for (const m of ['top', 'side'] as const) {
    if (groups[m].length) lines.push('usemtl ' + m, ...groups[m])
  }
  return lines.join('\n') + '\n'
}

/** One piece of a compound object: a shape placed relative to the object's origin, with its own material names. */
export interface CompoundPiece { shape: Shape; at: Vec3; rot: number; top: string; side: string }

/** Several shapes as one OBJ (a prefab): each keeps its own texture scale; materials are shared by name. */
export function compoundObj(pieces: CompoundPiece[]): string {
  const lines = ['# SR1 Map Studio prefab']
  const vt: string[] = []
  const groups = new Map<string, string[]>()
  let vi = 1
  for (const pc of pieces) {
    const t = (pc.rot * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t)
    for (const f of faces(pc.shape)) {
      const n = cross(sub(f.pts[1], f.pts[0]), sub(f.pts[2], f.pts[0]))
      const idx: string[] = []
      for (const p of f.pts) {
        // Same turn as the editor's heading: x' = x cos + z sin, z' = -x sin + z cos.
        lines.push(`v ${fmt(p[0] * c + p[2] * sn + pc.at[0])} ${fmt(p[1] + pc.at[1])} ${fmt(-p[0] * sn + p[2] * c + pc.at[2])}`)
        const [u, v] = uv(p, n, pc.shape.tile)
        vt.push(`vt ${fmt(u)} ${fmt(v)}`)
        idx.push(`${vi}/${vi}`)
        vi++
      }
      const m = f.top ? pc.top : pc.side
      if (!groups.has(m)) groups.set(m, [])
      groups.get(m)!.push('f ' + idx.join(' '))
    }
  }
  lines.push(...vt)
  for (const [m, fs] of groups) lines.push('usemtl ' + m, ...fs)
  return lines.join('\n') + '\n'
}

/** "Wall 12×6×1": the preset label plus the size. */
export const shapeName = (label: string, s: Shape) => `${label} ${s.size.map((v) => +v.toFixed(2)).join('×')}`

/** The label part of a generated name, or null if the user renamed it. */
export const shapeLabel = (name: string) => /^([A-Za-z]+) [\d.]+×[\d.]+×[\d.]+$/.exec(name)?.[1] ?? null
