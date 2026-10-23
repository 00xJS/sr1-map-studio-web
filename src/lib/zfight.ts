// Flicker ("z-fighting"): two pieces whose outside faces lie in the same plane
// and overlap, like a crate rim whose top is level with the fruit in it. The
// screen can't tell which is in front, so it flickers as the camera moves.
// This finds such faces between the parts of a prefab or map, and nudges the
// smaller piece out by a centimetre or so, which is enough for the depth buffer
// (in the editor and in the game) and too little to see.
import { faces, type Shape } from './shapes'
import type { Part } from './sampleKit'
import type { Vec3 } from './project'

/** A part as the shape the editor and exporter build for it. */
export const partShape = (part: Part): Shape => ({
  kind: part.kind, size: part.size, tile: part.tile ?? 4,
  ...(part.segments ? { segments: part.segments } : {}), ...(part.taper !== undefined ? { taper: part.taper } : {}), ...(part.bevel ? { bevel: part.bevel } : {}),
  ...(part.lie ? { lie: true } : {}), ...(part.outline ? { outline: part.outline } : {}), ...(part.fit ? { fit: true } : {}),
  ...(part.heights ? { cells: part.cells, heights: part.heights } : {}),
})

type P2 = [number, number]
interface Flat { part: number; n: Vec3; d: number; pts: P2[][]; area: number }

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const crossV = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const area2 = (p: P2[]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1] }, 0) / 2

/** Two axes in the plane with normal n (the same for every face sharing that normal). */
function basis(n: Vec3): [Vec3, Vec3] {
  const up: Vec3 = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
  const u = crossV(up, n), l = Math.hypot(...u)
  const uu: Vec3 = [u[0] / l, u[1] / l, u[2] / l]
  return [uu, crossV(n, uu)]
}

/** Convex pieces of a simple polygon (ear clipping), all counter-clockwise. */
function convexPieces(p: P2[]): P2[][] {
  const pts = area2(p) < 0 ? [...p].reverse() : [...p]
  const convex = pts.every((a, i) => { const b = pts[(i + 1) % pts.length], c = pts[(i + 2) % pts.length]; return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) >= -1e-9 })
  if (convex) return [pts]
  const out: P2[][] = []
  const v = [...pts]
  let guard = v.length * v.length
  while (v.length > 3 && guard-- > 0) {
    for (let i = 0; i < v.length; i++) {
      const a = v[(i + v.length - 1) % v.length], b = v[i], c = v[(i + 1) % v.length]
      if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) <= 1e-12) continue
      const inside = v.some((q) => q !== a && q !== b && q !== c && area2([a, b, q]) >= 0 && area2([b, c, q]) >= 0 && area2([c, a, q]) >= 0)
      if (inside) continue
      out.push([a, b, c])
      v.splice(i, 1)
      break
    }
  }
  if (v.length === 3) out.push(v)
  return out
}

/** Area of the overlap of two counter-clockwise convex polygons (Sutherland–Hodgman). */
function overlap(a: P2[], b: P2[]): number {
  let out = a
  for (let i = 0; i < b.length && out.length; i++) {
    const p = b[i], q = b[(i + 1) % b.length]
    const side = (r: P2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    const next: P2[] = []
    for (let k = 0; k < out.length; k++) {
      const r = out[k], s = out[(k + 1) % out.length], sr = side(r), ss = side(s)
      if (sr >= 0) next.push(r)
      if ((sr >= 0) !== (ss >= 0)) { const t = sr / (sr - ss); next.push([r[0] + (s[0] - r[0]) * t, r[1] + (s[1] - r[1]) * t]) }
    }
    out = next
  }
  return out.length > 2 ? Math.abs(area2(out)) : 0
}

/** Every flat face of the parts, in world space, keyed for a quick same-plane lookup. */
function flats(parts: Part[]): Flat[] {
  const out: Flat[] = []
  parts.forEach((part, i) => {
    if (part.kind === 'terrain' || part.water) return
    const t = ((part.rot ?? 0) * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t)
    for (const f of faces(partShape(part))) {
      // Same turn as compoundObj: x' = x cos + z sin, z' = -x sin + z cos.
      const w = f.pts.map((p): Vec3 => [p[0] * c + p[2] * sn + part.at[0], p[1] + part.at[1], -p[0] * sn + p[2] * c + part.at[2]])
      if (w.length < 3) continue
      let n: Vec3 = [0, 0, 0]
      for (let k = 1; k + 1 < w.length; k++) {
        const x = crossV([w[k][0] - w[0][0], w[k][1] - w[0][1], w[k][2] - w[0][2]], [w[k + 1][0] - w[0][0], w[k + 1][1] - w[0][1], w[k + 1][2] - w[0][2]])
        n = [n[0] + x[0], n[1] + x[1], n[2] + x[2]]
      }
      const l = Math.hypot(...n)
      if (l < 1e-9) continue
      n = [n[0] / l, n[1] / l, n[2] / l]
      const [u, v] = basis(n)
      const flat = w.map((p): P2 => [dot(p, u), dot(p, v)])
      const area = Math.abs(area2(flat))
      if (area < 1e-6) continue
      out.push({ part: i, n, d: dot(w[0], n), pts: convexPieces(flat), area })
    }
  })
  return out
}

export interface Fight { a: number; b: number; area: number; n: Vec3 }

/** Pairs of parts with outside faces in the same plane, facing the same way, overlapping by at least `minArea` square units. */
export function fights(parts: Part[], minArea = 0.01): Fight[] {
  const all = flats(parts)
  const key = (f: Flat, dd = 0) => `${f.n.map((x) => Math.round(x * 200)).join(',')}|${Math.round(f.d * 100) + dd}`
  const buckets = new Map<string, Flat[]>()
  for (const f of all) { const k = key(f); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k)!.push(f) }
  const found = new Map<string, Fight>()
  for (const f of all) {
    for (const dd of [0, 1]) {
      for (const g of buckets.get(key(f, dd)) ?? []) {
        if (g.part <= f.part || dot(f.n, g.n) < 0.9999 || Math.abs(f.d - g.d) > 0.002) continue
        let area = 0
        for (const a of f.pts) for (const b of g.pts) area += overlap(a, b)
        if (area < minArea) continue
        const k = f.part + ':' + g.part
        const prev = found.get(k)
        if (!prev || prev.area < area) found.set(k, { a: f.part, b: g.part, area, n: f.n })
      }
    }
  }
  return [...found.values()]
}

/** How far a nudged face moves out, in editor units (0.03 = 1.5 cm). */
export const NUDGE = 0.03

/**
 * The parts with their flickering faces pulled apart. Pieces whose faces overlap
 * in one plane each get their own small offset (the largest stays put, the
 * next moves out NUDGE, one touching both moves 2 × NUDGE, and so on), so even
 * a row of identical pieces only moves a few centimetres. Boxes, cylinders and
 * blobs move on top and bottom, boxes on their sides too, lying cylinders at
 * their ends; a face no piece of the pair can move is left as it is.
 */
export function unflicker(parts: Part[]): Part[] {
  let out = parts
  for (let pass = 0; pass < 6; pass++) {
    const list = fights(out)
    if (!list.length) break
    out = spread(out, list)
  }
  return out
}

function spread(parts: Part[], list: Fight[]): Part[] {
  const out = parts.map((p) => ({ ...p, size: [...p.size] as Vec3, at: [...p.at] as Vec3 }))
  const vol = (p: Part) => p.size[0] * p.size[1] * p.size[2]
  // One facing at a time (a part has one face per facing): which parts overlap which there.
  const planes = new Map<string, { n: Vec3; near: Map<number, Set<number>> }>()
  for (const f of list) {
    const k = f.n.map((x) => Math.round(x * 100)).join(',')
    if (!planes.has(k)) planes.set(k, { n: f.n, near: new Map() })
    const { near } = planes.get(k)!
    for (const [a, b] of [[f.a, f.b], [f.b, f.a]]) { if (!near.has(a)) near.set(a, new Set()); near.get(a)!.add(b) }
  }
  for (const { n, near } of planes.values()) {
    // Pieces that can't move keep offset 0, then the largest first.
    const order = [...near.keys()].sort((a, b) => Number(movable(parts[a], n)) - Number(movable(parts[b], n)) || vol(parts[b]) - vol(parts[a]))
    const step = new Map<number, number>()
    for (const i of order) {
      const used = new Set([...near.get(i)!].filter((j) => step.has(j)).map((j) => step.get(j)!))
      let k = 0
      if (movable(parts[i], n)) while (used.has(k)) k++
      step.set(i, k)
      if (k) nudge(out[i], n, k * NUDGE)
    }
  }
  return out
}

/** Whether nudge can move this part's face with outward normal n. */
const movable = (p: Part, n: Vec3) => nudge({ ...p, size: [...p.size] as Vec3, at: [...p.at] as Vec3 }, n, 0)

/** Moves the part's face with outward normal n out by `by`; false when this kind of part can't be. */
function nudge(p: Part, n: Vec3, by: number): boolean {
  const lying = p.kind === 'cylinder' && p.lie
  const flat = p.kind === 'box' || ((p.kind === 'cylinder' || p.kind === 'blob') && !p.lie)
  if (!flat && !lying) return false
  if (flat && n[1] > 0.999) { p.size[1] += by; return true }
  if (flat && n[1] < -0.999) { p.size[1] += by; p.at[1] -= by; return true }
  // Sides: a box's four, or the two ends of a cylinder lying along its X.
  if ((p.kind !== 'box' && !lying) || Math.abs(n[1]) > 0.001) return false
  // Which of the box's own axes the side faces along (x' = x cos + z sin, z' = -x sin + z cos).
  const t = ((p.rot ?? 0) * Math.PI) / 180
  const ax: Vec3 = [Math.cos(t), 0, -Math.sin(t)], az: Vec3 = [Math.sin(t), 0, Math.cos(t)]
  const along = Math.abs(dot(n, ax)) > 0.999 ? 0 : Math.abs(dot(n, az)) > 0.999 ? 2 : null
  if (along === null || (lying && along !== 0)) return false
  p.size[along] += by
  p.at[0] += (n[0] * by) / 2
  p.at[2] += (n[2] * by) / 2
  return true
}
