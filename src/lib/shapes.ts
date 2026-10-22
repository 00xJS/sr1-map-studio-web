// Block-out shapes: simple solids generated as OBJ text, so they go through
// the same pipeline as imported models. Texture coordinates come from world
// position (one texture repeat per `tile` units), so a brick texture keeps its
// brick size whatever the shape's dimensions. Faces that point up use the
// "top" material, all others "side". Origin is the bottom center.
import type { Vec3 } from './project'

export type ShapeKind = 'box' | 'ramp' | 'stairs' | 'cylinder'

export interface Shape {
  kind: ShapeKind
  /** Width (X), height (Y), depth (Z), in editor units. */
  size: Vec3
  /** Stairs: number of steps. Cylinder: number of sides. */
  segments?: number
  /** Units per texture repeat. */
  tile: number
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

function faces(s: Shape): Face[] {
  const [w, h, d] = s.size.map((v) => Math.max(0.01, v)) as V
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  switch (s.kind) {
    case 'box': return boxFaces(x0, x1, 0, h, z0, z1)
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
    case 'cylinder': {
      const n = Math.max(3, Math.min(64, Math.round(s.segments ?? 16)))
      const ring = (y: number) => [...Array(n)].map((_, i): V => {
        const a = (i / n) * Math.PI * 2
        return [Math.cos(a) * (w / 2), y, Math.sin(a) * (d / 2)]
      })
      const lo = ring(0), hi = ring(h)
      const c: V = [0, h / 2, 0]
      const out: Face[] = [
        { pts: outward(hi, c), top: true },
        { pts: outward(lo, c), top: false },
      ]
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        out.push({ pts: outward([lo[i], lo[j], hi[j], hi[i]], c), top: false })
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

/** "Wall 12×6×1": the preset label plus the size. */
export const shapeName = (label: string, s: Shape) => `${label} ${s.size.map((v) => +v.toFixed(2)).join('×')}`

/** The label part of a generated name, or null if the user renamed it. */
export const shapeLabel = (name: string) => /^([A-Za-z]+) [\d.]+×[\d.]+×[\d.]+$/.exec(name)?.[1] ?? null
