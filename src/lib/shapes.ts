// Block-out shapes: simple solids generated as OBJ text, so they go through
// the same pipeline as imported models. Texture coordinates come from world
// position (one texture repeat per `tile` units), so a brick texture keeps its
// brick size whatever the shape's dimensions. Faces that point up use the
// "top" material, all others "side". Origin is the bottom center.
import type { Vec3 } from './project'
import { terrainFaces, terrainObj } from './terrain'

export type ShapeKind = 'box' | 'ramp' | 'stairs' | 'cylinder' | 'roof' | 'blob' | 'terrain' | 'torus' | 'sphere'

export interface Shape {
  kind: ShapeKind
  /** Width (X), height (Y), depth (Z), in editor units. */
  size: Vec3
  /** Stairs: number of steps. Cylinder: number of sides. Torus and sphere: steps round the middle. */
  segments?: number
  /** Units per texture repeat. */
  tile: number
  /** Cylinder: top width as a fraction of the bottom (0 = cone, 1 = straight, above 1 flares out). */
  taper?: number
  /** Box: rounds off the vertical and top edges by this many units. */
  bevel?: number
  /** Cylinder: lying on its side, its length along X (wheels, logs, pipes). Size stays width (length) × height × depth.
   *  Torus: standing up facing ±Z, size outer width × outer height × tube thickness. */
  lie?: boolean
  /** Blob: the outline as [x, z] points round the middle (each visible from the centre), extruded up by the height. */
  outline?: [number, number][]
  /** Stretch the texture once over each face instead of repeating it (a photo on a wall). */
  fit?: boolean
  /** Ramp: just the sloped top, no sides or bottom (the invisible ramps over tall steps, stairRamps.ts). */
  open?: boolean
  /** Terrain: grid cells along X and Z (see terrain.ts). */
  cells?: [number, number]
  /** Terrain: (cells X + 1) × (cells Z + 1) heights above the slab top, row by row along X. */
  heights?: number[]
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
  ball: { label: 'Ball', hint: 'A ball or rounded lump; stretch it into an egg, a dome or a sack', shape: { kind: 'sphere', size: [3, 3, 3], segments: 16, tile: 4 } },
  ring: { label: 'Ring', hint: 'A donut or tyre shape lying flat; the top takes the top texture', shape: { kind: 'torus', size: [6, 2, 6], segments: 24, tile: 4 } },
}

type V = [number, number, number]
/** `mat` names a material other than top/side (a terrain's rock). `ns`: a normal per point, for surfaces shaded smooth (round sides). */
export interface Face { pts: V[]; top: boolean; mat?: string; ns?: V[] }

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: V): V => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const avg = (pts: V[]): V => pts.reduce<V>((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0])

/** Polygon wound counter-clockwise seen from outside (OBJ convention), judged against the solid's center. */
function outward(pts: V[], center: V): V[] {
  const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]))
  return dot(n, sub(avg(pts), center)) >= 0 ? pts : [...pts].reverse()
}

/** A smooth face wound to match its normals (which point outward). */
function smooth(pts: V[], ns: V[], top: boolean): Face {
  const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]))
  return dot(n, avg(ns)) >= 0 ? { pts, ns, top } : { pts: [...pts].reverse(), ns: [...ns].reverse(), top }
}

/** Round sides with at least this many steps are shaded smooth; fewer stay faceted (a hex nut, an octagon kiosk). */
const SMOOTH_FROM = 8

/** An ellipsoid w × h × d standing on its lowest point, shaded smooth; faces looking mostly up take the top material. */
function sphereFaces(w: number, h: number, d: number, steps: number): Face[] {
  const n = Math.max(6, Math.min(64, Math.round(steps)))
  const m = Math.max(4, Math.round(n / 2))
  const at = (i: number, j: number): [V, V] => {
    const a = (i / n) * Math.PI * 2, b = -Math.PI / 2 + (j / m) * Math.PI
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b)
    // The poles are exact points, so the rings that meet there close up.
    const c = j === 0 || j === m ? 0 : cb
    return [[(w / 2) * c * ca, (h / 2) * (1 + sb), (d / 2) * c * sa], norm([(c * ca) / w, sb / h, (c * sa) / d])]
  }
  const out: Face[] = []
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    // Drop the doubled point at a pole: the quad there is a triangle.
    const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)].filter((c, k, all) => k === 0 || Math.hypot(...sub(c[0], all[k - 1][0])) > 1e-9)
    if (q.length > 3 && Math.hypot(...sub(q[q.length - 1][0], q[0][0])) < 1e-9) q.pop()
    if (q.length < 3) continue
    const ns = q.map((c) => c[1])
    out.push(smooth(q.map((c) => c[0]), ns, norm(avg(ns))[1] > 0.55))
  }
  return out
}

/** A ring: `R` from the middle to the tube's centre, tube radii `rx` across and `ry` up, flat in XZ (standing: in XY, facing ±Z). */
function torusFaces(w: number, h: number, d: number, steps: number, stand: boolean): Face[] {
  const n = Math.max(6, Math.min(64, Math.round(steps)))
  const m = Math.max(6, Math.round(n / 2))
  // Flat: across is X/Z, thickness is Y. Standing: across is X/Y, thickness is Z.
  const ax = w / 2, az = stand ? h / 2 : d / 2, t = stand ? d : h
  const tube = Math.min(t / 2, Math.min(ax, az) * 0.9)
  const ring = (i: number, j: number): [V, V] => {
    const a = (i / n) * Math.PI * 2, b = (j / m) * Math.PI * 2
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b)
    // Tube centre on an ellipse; the tube's own width is `tube` across and t/2 through.
    const cx = (ax - tube) * ca, cz = (az - tube) * sa
    const p: V = [cx + tube * cb * ca, (t / 2) * sb, cz + tube * cb * sa]
    const nn = norm([cb * ca / tube, sb / (t / 2), cb * sa / tube])
    return stand ? [[p[0], p[2] + h / 2, p[1]], [nn[0], nn[2], nn[1]]] : [[p[0], p[1] + h / 2, p[2]], nn]
  }
  const out: Face[] = []
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const q = [ring(i, j), ring(i + 1, j), ring(i + 1, j + 1), ring(i, j + 1)]
    const ns = q.map((c) => c[1]), up = avg(ns)
    // The icing: the top (lying flat) or both faces (standing).
    out.push(smooth(q.map((c) => c[0]), ns, stand ? Math.abs(up[2]) > 0.35 : up[1] > 0.3))
  }
  return out
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

export function faces(s: Shape): Face[] {
  const [w, h, d] = s.size.map((v) => Math.max(0.01, v)) as V
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  switch (s.kind) {
    case 'terrain': return terrainFaces(s).map((f) => ({ pts: f.pts, top: f.mat === 'top', ...(f.mat === 'rock' ? { mat: 'rock' } : {}) }))
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
      return (s.open ? polys.slice(0, 1) : polys).map(([pts, top]) => ({ pts: outward(pts, c), top }))
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
    case 'torus': return torusFaces(w, h, d, s.segments ?? 24, !!s.lie)
    case 'sphere': return sphereFaces(w, h, d, s.segments ?? 16)
    case 'cylinder': {
      if (s.lie) {
        // Built upright with the length as its height, then tipped onto its side.
        const c: V = [0, h / 2, 0]
        const tip = ([x, y, z]: V): V => [y - w / 2, x + h / 2, z]
        return faces({ ...s, lie: false, size: [h, w, d] }).map((f) => f.ns
          ? ((ns) => smooth(f.pts.map(tip), ns, norm(avg(ns))[1] > 0.55))(f.ns.map(([x, y, z]): V => [y, x, z]))
          : upward(f.pts.map(tip), c))
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
      if (n >= SMOOTH_FROM) {
        // Round sides: each point's normal points straight out from the axis, tilted up by the taper.
        const lean = ((1 - t) * (w + d)) / 4 / h
        const at = (i: number): V => { const a = (i / n) * Math.PI * 2, r = norm([Math.cos(a) / w, 0, Math.sin(a) / d]); return norm([r[0], lean, r[2]]) }
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n, ns = [at(i), at(j)]
          const top = norm(add(ns[0], ns[1]))[1] > 0.55
          out.push(t > 0 ? smooth([lo[i], lo[j], hi[j], hi[i]], [ns[0], ns[1], ns[1], ns[0]], top) : smooth([lo[i], lo[j], [0, h, 0]], [ns[0], ns[1], norm(add(ns[0], ns[1]))], top))
        }
        return out
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        // A cone meets in a point: triangles instead of quads.
        out.push(t > 0 ? (t !== 1 ? upward([lo[i], lo[j], hi[j], hi[i]], c) : { pts: outward([lo[i], lo[j], hi[j], hi[i]], c), top: false }) : upward([lo[i], lo[j], [0, h, 0]], c))
      }
      return out
    }
  }
}

/** UVs for one face: world-scaled repeats, or (fit) the whole texture once across the face. */
function faceUvs(pts: V[], normal: V, tile: number, fit?: boolean): [number, number][] {
  const raw = pts.map((p) => uv(p, normal, fit ? 1 : tile))
  if (!fit) return raw
  const us = raw.map((r) => r[0]), vs = raw.map((r) => r[1])
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs)
  return raw.map(([u, v]) => [(u - u0) / (u1 - u0 || 1), (v - v0) / (v1 - v0 || 1)])
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

/** Writes faces as OBJ, gathering polygons by material. Smooth faces carry their normals (`vn`); flat ones leave them to the reader. */
class ObjWriter {
  v: string[] = []
  vt: string[] = []
  vn: string[] = []
  groups = new Map<string, string[]>()
  add(f: Face, place: (p: V) => V, turn: (n: V) => V, tile: number, fit: boolean | undefined, mat: string) {
    const pts = f.pts.map(place)
    // Texture coordinates from where the face ends up, so pieces side by side carry the pattern on across the join.
    const uvs = faceUvs(pts, cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])), tile, fit)
    const idx = pts.map((p, k) => {
      this.v.push(`v ${fmt(p[0])} ${fmt(p[1])} ${fmt(p[2])}`)
      this.vt.push(`vt ${fmt(uvs[k][0])} ${fmt(uvs[k][1])}`)
      const i = this.v.length
      if (!f.ns) return `${i}/${i}`
      const n = turn(f.ns[k])
      this.vn.push(`vn ${fmt(n[0])} ${fmt(n[1])} ${fmt(n[2])}`)
      return `${i}/${i}/${this.vn.length}`
    })
    if (!this.groups.has(mat)) this.groups.set(mat, [])
    this.groups.get(mat)!.push('f ' + idx.join(' '))
  }
  text(head: string) {
    const lines = [head, ...this.v, ...this.vt, ...this.vn]
    for (const [m, fs] of this.groups) lines.push('usemtl ' + m, ...fs)
    return lines.join('\n') + '\n'
  }
}

const same = (p: V) => p

/** OBJ text with materials "top" and "side"; polygons are fan-triangulated by the importer. */
export function shapeObj(s: Shape): string {
  if (s.kind === 'terrain') return terrainObj(s)
  const w = new ObjWriter()
  w.groups.set('top', []).set('side', [])
  for (const f of faces(s)) w.add(f, same, same, s.tile, s.fit, f.top ? 'top' : 'side')
  for (const m of ['top', 'side']) if (!w.groups.get(m)!.length) w.groups.delete(m)
  return w.text('# SR1 Map Studio block-out shape: ' + JSON.stringify(s))
}

/** One piece of a compound object: a shape placed relative to the object's origin, with its own material names. */
export interface CompoundPiece { shape: Shape; at: Vec3; rot: number; top: string; side: string }

/** Several shapes as one OBJ (a prefab): each keeps its own texture scale; materials are shared by name. */
export function compoundObj(pieces: CompoundPiece[]): string {
  const w = new ObjWriter()
  for (const pc of pieces) {
    const t = (pc.rot * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t)
    // Same turn as the editor's heading: x' = x cos + z sin, z' = -x sin + z cos.
    const turn = (p: V): V => [p[0] * c + p[2] * sn, p[1], -p[0] * sn + p[2] * c]
    const place = (p: V): V => { const q = turn(p); return [q[0] + pc.at[0], q[1] + pc.at[1], q[2] + pc.at[2]] }
    for (const f of faces(pc.shape)) w.add(f, place, turn, pc.shape.tile, pc.shape.fit, f.top ? pc.top : pc.side)
  }
  return w.text('# SR1 Map Studio prefab')
}

/** "Wall 12×6×1": the preset label plus the size. */
export const shapeName = (label: string, s: Shape) => `${label} ${s.size.map((v) => +v.toFixed(2)).join('×')}`

/** The label part of a generated name, or null if the user renamed it. */
export const shapeLabel = (name: string) => /^([A-Za-z]+) [\d.]+×[\d.]+×[\d.]+$/.exec(name)?.[1] ?? null
