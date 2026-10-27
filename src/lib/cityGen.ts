// A Stilwater-style city for people without the game: an original city laid out from the site's own shapes
// and prefabs (nothing from the game files), styled after how Saints Row's city feels: streets split by a river
// with bridges and quays, a downtown of towers, a Chinatown-like quarter, a red-light strip, the projects, a
// barrio, suburbs, rich houses, docks and factories, parks. As in a real city the streets aren't a perfect grid:
// an avenue bends, a diagonal cuts across the blocks and leaves wedge-shaped corners, one district's cross
// streets lean, and downtown has a boulevard with a planted median. Each district has its own buildings,
// heights, colours and street furniture. Units are editor units (0.5 m); street level is y = 1.
import type { Vec3 } from './project'
import { ALL_PREFABS } from './prefabRegistry'
import { FLOOR, building, facadeTex, prefabParams, tagPrefab, type Params, type Style } from './prefabs'
import { CY, PB, blob, box, perimeter, ramp, turn, type MarkerSpec, type Part, type Sample, type Tex } from './sampleKit'
import { U, car } from './urbanKit'
import { ROAD_H, ROAD_TEX, WALK_H, buildRoad, formatPath, parsePath, roadOptions, type Polyline, type Pt } from './roads'
import { blocker, partRay, support } from './sampleScale'
import { openHeading } from './markerPlan'
import { rng, type Rng } from './mapWizard'
const ROAD_TEX_ASPHALT = ROAD_TEX.asphalt

export type CitySize = 'town' | 'city' | 'big'
export interface CityOptions { size: CitySize; seed: number; name?: string }

/** Blocks along each side; a block and its street are about 100 m, as in the game's city. */
export const CITY_SIZES: Record<CitySize, { label: string; blocks: number; hint: string }> = {
  town: { label: 'Town', blocks: 3, hint: 'About 330 m across: downtown, the river and a few districts.' },
  city: { label: 'City', blocks: 4, hint: 'About 430 m across: every district. Best walked in the browser.' },
  big: { label: 'Big city', blocks: 6, hint: 'About 630 m across: room for all of it, twice over. For the browser only.' },
}

// ---------------- the grid ----------------

// Proportions follow the game's city: streets 12 to 17 m kerb to kerb with 4 m sidewalks (about 20 m wall to
// wall), blocks about 80 m, buildings close to the sidewalk in town and set back 8 to 12 m in the suburbs.
/** Street: kerb to kerb, sidewalk each side, and the whole band. */
const ST = 26, WK = 8, C = ST + 2 * WK
/** Street centre to street centre. */
const PITCH = 200
const LOT_Y = 1 + WALK_H
const EDGE = 8

export type DistrictKey = 'downtown' | 'chinatown' | 'redlight' | 'projects' | 'barrio' | 'suburbs' | 'highend' | 'docks' | 'industrial' | 'park'

interface Rect { x0: number; x1: number; z0: number; z1: number }
/** One side of a block, a to b with the block on its left: its inward normal, and the heading of a front facing the street. */
interface Edge { a: Pt; b: Pt; u: Pt; n: Pt; len: number; rot: number }
/**
 * The land between streets: a polygon (anticlockwise), the grid cell it came from and its district, plus a frame
 * turned to its longest side, with its extent and the biggest rectangle that fits inside, in that frame.
 */
interface Block { i: number; j: number; d: DistrictKey; poly: Pt[]; edges: Edge[]; rot: number; box: Rect; core: Rect }

// ---------------- plane geometry ----------------

const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]]
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k]
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1]
const crs = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0]
const len = (a: Pt) => Math.hypot(a[0], a[1])
const unit = (a: Pt): Pt => { const l = len(a) || 1; return [a[0] / l, a[1] / l] }
const left = (d: Pt): Pt => [-d[1], d[0]]
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
const range = (a: number, b?: number) => (b === undefined ? [...Array(Math.max(0, a)).keys()] : [...Array(Math.max(0, b - a)).keys()].map((k) => a + k))
/** A heading (as prefabs turn) that points local +Z along o. */
const heading = (o: Pt) => (Math.atan2(o[0], o[1]) * 180) / Math.PI
const norm = (rot: number) => +((((rot % 360) + 360) % 360).toFixed(3))
const toWorld = (rot: number, x: number, z: number): Pt => turn(x, z, rot)

/** Positive when the points run anticlockwise (x toward z). */
const area = (poly: Pt[]) => poly.reduce((s, p, k) => s + crs(p, poly[(k + 1) % poly.length]), 0) / 2
function centroid(poly: Pt[]): Pt {
  let cx = 0, cz = 0, a = 0
  poly.forEach((p, k) => { const q = poly[(k + 1) % poly.length], w = crs(p, q); a += w; cx += (p[0] + q[0]) * w; cz += (p[1] + q[1]) * w })
  return Math.abs(a) < 1e-9 ? mul(poly.reduce((s, p) => add(s, p), [0, 0] as Pt), 1 / poly.length) : [cx / (3 * a), cz / (3 * a)]
}
function inside(poly: Pt[], [x, z]: Pt) {
  let hit = false
  for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
    const [ax, az] = poly[k], [bx, bz] = poly[m]
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) hit = !hit
  }
  return hit
}
function edgeDist(poly: Pt[], p: Pt) {
  let best = Infinity
  poly.forEach((a, k) => {
    const e = sub(poly[(k + 1) % poly.length], a), t = Math.max(0, Math.min(1, dot(sub(p, a), e) / (dot(e, e) || 1)))
    best = Math.min(best, len(sub(p, add(a, mul(e, t)))))
  })
  return best
}
/** Where the lines p + t·d and q + s·e cross. */
function meet(p: Pt, d: Pt, q: Pt, e: Pt): Pt | null {
  const den = crs(d, e)
  if (Math.abs(den) < 1e-9) return null
  return add(p, mul(d, crs(sub(q, p), e) / den))
}
/** The part of a polygon left of the line from a toward b. */
function clip(poly: Pt[], a: Pt, b: Pt): Pt[] {
  const d = sub(b, a), side = (p: Pt) => crs(d, sub(p, a))
  const out: Pt[] = []
  poly.forEach((p, k) => {
    const q = poly[(k + 1) % poly.length], sp = side(p), sq = side(q)
    if (sp >= -1e-7) out.push(p)
    if ((sp > 1e-7 && sq < -1e-7) || (sp < -1e-7 && sq > 1e-7)) out.push(lerp(p, q, sp / (sp - sq)))
  })
  return out
}
/** A polygon (anticlockwise) shrunk by h all round; sides that would vanish are dropped. A negative h grows it. */
function inset(poly: Pt[], h: number): Pt[] | null {
  const lines = poly.map((p, k) => { const d = unit(sub(poly[(k + 1) % poly.length], p)); return { p: add(p, mul(left(d), h)), d } })
  while (lines.length >= 3) {
    const pts = lines.map((l, k) => { const m = lines[(k + lines.length - 1) % lines.length]; return (Math.abs(crs(m.d, l.d)) < 1e-4 ? null : meet(m.p, m.d, l.p, l.d)) ?? l.p })
    let worst = -1, least = 0
    pts.forEach((p, k) => { const t = dot(sub(pts[(k + 1) % pts.length], p), lines[k].d); if (t < least) { least = t; worst = k } })
    if (worst < 0) return area(pts) > 1 ? pts : null
    lines.splice(worst, 1)
  }
  return null
}
function bounds(pts: Pt[]): Rect {
  const b = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }
  for (const [x, z] of pts) { if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (z < b.z0) b.z0 = z; if (z > b.z1) b.z1 = z }
  return b
}
/** The biggest rectangle (square to the axes) that fits in a polygon, found by trying bands across it. */
function inscribed(poly: Pt[]): Rect {
  const b = bounds(poly)
  const chord = (z: number): [number, number] => {
    let lo = Infinity, hi = -Infinity
    poly.forEach((p, k) => {
      const q = poly[(k + 1) % poly.length]
      if ((p[1] - z) * (q[1] - z) > 0 || p[1] === q[1]) return
      const x = p[0] + ((z - p[1]) / (q[1] - p[1])) * (q[0] - p[0])
      lo = Math.min(lo, x); hi = Math.max(hi, x)
    })
    return [lo, hi]
  }
  const N = 8, at = (k: number) => b.z0 + 0.01 + ((b.z1 - b.z0 - 0.02) * k) / N
  let best: Rect = { x0: 0, x1: 0, z0: 0, z1: 0 }, most = 0
  for (let a = 0; a < N; a++) for (let c = a + 1; c <= N; c++) {
    const z0 = at(a), z1 = at(c)
    let lo = -Infinity, hi = Infinity
    for (let t = 0; t <= 4; t++) { const [l, h] = chord(z0 + ((z1 - z0) * t) / 4); lo = Math.max(lo, l); hi = Math.min(hi, h) }
    if (hi - lo > 0 && (hi - lo) * (z1 - z0) > most) { most = (hi - lo) * (z1 - z0); best = { x0: lo, x1: hi, z0, z1 } }
  }
  return best
}
/** An oriented rectangle: w across (its local x) and d deep, centred at c, turned to rot. */
const rect = (c: Pt, rot: number, w: number, d: number): Pt[] =>
  ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as Pt[]).map(([x, z]) => add(c, turn(x, z, rot)))
/** Two convex outlines kept at least `gap` apart along one of their sides' directions. */
function apart(a: Pt[], b: Pt[], gap: number) {
  for (const poly of [a, b]) for (let k = 0; k < poly.length; k++) {
    const ax = unit(left(sub(poly[(k + 1) % poly.length], poly[k])))
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
    for (const p of a) { const t = dot(p, ax); a0 = Math.min(a0, t); a1 = Math.max(a1, t) }
    for (const p of b) { const t = dot(p, ax); b0 = Math.min(b0, t); b1 = Math.max(b1, t) }
    if (a1 + gap <= b0 + 1e-6 || b1 + gap <= a0 + 1e-6) return true
  }
  return false
}

// ---------------- the districts ----------------

/** A facade: a building() style, and colours in place of its own. */
interface Paint { style: Style; wall?: string; trim?: Tex; roof?: Tex; neon?: Tex }

interface DistrictStyle {
  label: string
  /** What the lots between the buildings are paved or planted with. */
  lot: Tex
  /** Street furniture along its sidewalks, and every how many units. */
  props: string[]
  propEvery: number
  /** Parked cars per block side, on average. */
  cars: number
  /** Colour on the city sketch. */
  sketch: string
  /** Facades for its plain buildings, so the district reads at a glance. */
  paints: Paint[]
  /** The colour settings its prefabs choose from (walls, signs, awnings, siding); the rest stay random. */
  colours: Record<string, string[]>
}

const T = {
  plaza: U.plazaTiles, walk: U.walk, grass: U.grass, dirt: PB.dirt, worn: PB.floorWorn, asphalt: PB.oldAsphalt, concrete: PB.concrete,
}
/** Chinatown's green trim, the hillside's terracotta roofs, cream trim. */
const JADE: Tex = { gen: 'tiles', tweak: { color: '#2f6e4f', accent: '#22533b', scale: 2, wear: 0.25, seed: 951 }, surface: 0 }
const TERRACOTTA: Tex = { gen: 'brick', tweak: { color: '#b35a38', accent: '#8a4128', scale: 12, wear: 0.3, seed: 952 } }
const CREAM: Tex = { gen: 'concrete', tweak: { color: '#e6dfcc', accent: '#cbbf9f', wear: 0.15, seed: 953 } }

export const DISTRICTS: Record<DistrictKey, DistrictStyle> = {
  // Grey, glass and stone.
  downtown: {
    label: 'Downtown', lot: T.plaza, props: ['srnewsboxtall', 'srtrashcan', 'srpayphone', 'srhydrant', 'srbench', 'srplanterpot', 'srparkingmeter'], propEvery: 16, cars: 1.2, sketch: '#b9c2d0',
    paints: [{ style: 'office' }, { style: 'glass' }, { style: 'stone' }, { style: 'concrete' }, { style: 'glass', wall: '#3e5262' }, { style: 'stone', wall: '#bdb8ad' }, { style: 'office', wall: '#59616a' }], colours: {},
  },
  // Red brick, green trim.
  chinatown: {
    label: 'Chinatown', lot: T.walk, props: ['producecrates', 'fruitcrates', 'srtrashbags', 'srnewsboxshort', 'srhydrant', 'srtrashcan', 'srpayphone'], propEvery: 14, cars: 0.8, sketch: '#c8564a',
    paints: [{ style: 'brick', trim: JADE }, { style: 'brick', wall: '#9c3427', trim: JADE }, { style: 'darkbrick', trim: JADE }, { style: 'plaster', wall: '#a63a30', trim: JADE }],
    colours: { walls: ['brick', 'oldbrick'], upper: ['brick', 'darkbrick'], sign: ['red', 'green', 'yellow'], awning: ['green', 'red'], color: ['red', 'mixed'] },
  },
  // Dark brick and neon.
  redlight: {
    label: 'Red light', lot: T.walk, props: ['srtrashbags', 'srtrashcan', 'srhydrant', 'srpayphone', 'srnewsboxshort', 'firebarrel'], propEvery: 15, cars: 1, sketch: '#d05aa8',
    paints: [{ style: 'darkbrick', neon: CY.pink }, { style: 'darkbrick', wall: '#4a2b27', neon: CY.purple }, { style: 'club' }, { style: 'brick', wall: '#5c2b2e', neon: CY.cyan }],
    colours: { walls: ['oldbrick', 'brick'], upper: ['darkbrick'], sign: ['pink', 'purple', 'cyan', 'neonorange'], awning: ['black', 'red'] },
  },
  // Tan and grey concrete.
  projects: {
    label: 'The projects', lot: T.worn, props: ['srtrashbags', 'firebarrel', 'srtrashcan', 'srhydrant', 'srconcretefence'], propEvery: 20, cars: 0.6, sketch: '#8b7d6b',
    paints: [{ style: 'projects' }, { style: 'concrete' }, { style: 'projects', wall: '#ad9777' }, { style: 'concrete', wall: '#8e8d87' }], colours: { style: ['projects', 'concrete', 'beige'] },
  },
  // Warm stucco: beige, terracotta, pastels.
  barrio: {
    label: 'Barrio', lot: T.dirt, props: ['srtrashcan', 'srhydrant', 'srtrashbags', 'srwoodfence', 'srpayphone'], propEvery: 22, cars: 0.9, sketch: '#d1a35c',
    paints: [{ style: 'plaster', wall: '#d9c39f' }, { style: 'plaster', wall: '#c4704d', trim: CREAM }, { style: 'plaster', wall: '#e2b4a4' }, { style: 'plaster', wall: '#bccfa8' }, { style: 'plaster', wall: '#e3cc8a' }],
    colours: { style: ['beige'], walls: ['beige', 'plaster'], color: ['pink', 'yellow', 'green', 'white'], awning: ['red', 'green', 'orange', 'yellow'] },
  },
  // Pale siding.
  suburbs: {
    label: 'Suburbs', lot: T.grass, props: ['mailbox', 'srhydrant', 'srtrashcan', 'tree'], propEvery: 26, cars: 0.7, sketch: '#7fae6a',
    paints: [], colours: { color: ['white', 'blue', 'yellow', 'grey', 'green'], paint: ['white'] },
  },
  // White and cream with terracotta.
  highend: {
    label: 'Hillside homes', lot: T.grass, props: ['palm', 'srhydrant', 'palmshort', 'srplanterpot'], propEvery: 24, cars: 0.4, sketch: '#5fb59a',
    paints: [{ style: 'stone', wall: '#efece4', roof: TERRACOTTA, trim: TERRACOTTA }, { style: 'stone', wall: '#e8dcbe', roof: TERRACOTTA, trim: CREAM }],
    colours: { color: ['white'], walls: ['plaster', 'beige'], trim: ['white', 'orange'] },
  },
  docks: {
    label: 'Docks', lot: T.concrete, props: ['srpallets', 'barrels', 'srcrate', 'bollards', 'srconebarrel'], propEvery: 24, cars: 0.3, sketch: '#6f8796',
    paints: [{ style: 'warehouse' }, { style: 'concrete' }], colours: { walls: ['metal', 'concrete', 'oldbrick', 'brick'] },
  },
  industrial: {
    label: 'Factories', lot: T.asphalt, props: ['srpallets', 'drumpallets', 'srgascylinders', 'srtrashbags', 'srconebarrel'], propEvery: 26, cars: 0.5, sketch: '#7a7570',
    paints: [{ style: 'warehouse' }, { style: 'concrete' }, { style: 'warehouse', wall: '#7d868c' }], colours: { walls: ['brick', 'oldbrick', 'concrete', 'metal'] },
  },
  park: { label: 'Park', lot: T.grass, props: ['srbench', 'srtrashcan', 'tree'], propEvery: 18, cars: 0.2, sketch: '#4f8f45', paints: [], colours: {} },
}

// ---------------- placing prefabs ----------------

/** A prefab's footprint at heading 0 (editor units, about its own origin). */
const footprints = new Map<string, Rect>()
const lastFootprint = new WeakMap<Params, Rect>()
function footprint(key: string, params: Params): Rect {
  const known = lastFootprint.get(params)
  if (known) return known
  const k = key + '|' + Object.values(params).join('|')
  let f = footprints.get(k)
  if (!f) {
    f = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }
    for (const p of ALL_PREFABS[key].make(0, 0, 0, 0, params)) {
      const t = ((p.rot ?? 0) * Math.PI) / 180, c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t))
      const hx = (p.size[0] * c + p.size[2] * s) / 2, hz = (p.size[0] * s + p.size[2] * c) / 2
      f.x0 = Math.min(f.x0, p.at[0] - hx); f.x1 = Math.max(f.x1, p.at[0] + hx); f.z0 = Math.min(f.z0, p.at[2] - hz); f.z1 = Math.max(f.z1, p.at[2] + hz)
    }
    footprints.set(k, f)
  }
  lastFootprint.set(params, f)
  return f
}
/** Its width (along its front) and depth. */
const dims = (key: string, params: Params): [number, number] => { const f = footprint(key, params); return [f.x1 - f.x0, f.z1 - f.z0] }

/** Random settings for a prefab (only the keys asked for, colours from the district's palette; the rest stay at their defaults). */
function vary(key: string, r: Rng, keys: string[], fixed: Params = {}, colours: Record<string, string[]> = {}): Params {
  const def = ALL_PREFABS[key]
  const given: Params = { ...fixed }
  for (const d of def.params ?? []) {
    if (!keys.includes(d.key) || d.key in given) continue
    if (d.kind === 'select' && d.options?.length) {
      const allowed = d.options.filter(([v]) => colours[d.key]?.includes(v))
      given[d.key] = r.pick(allowed.length ? allowed : d.options)[0]
    } else if (d.kind === 'number' && d.min !== undefined && d.max !== undefined) given[d.key] = Math.round(r.range(d.min, d.max) / (d.step ?? 1)) * (d.step ?? 1)
  }
  return prefabParams(def, given)
}

/** A prefab with its footprint centred at (x, z), its front turned to `rot`. */
function placeAt(key: string, params: Params, x: number, z: number, rot: number, y = LOT_Y): Part[] {
  const def = ALL_PREFABS[key]
  if (!def) return []
  const f = footprint(key, params), h = norm(rot)
  const [ox, oz] = turn((f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2, h)
  const at: Vec3 = [+(x - ox).toFixed(2), y, +(z - oz).toFixed(2)]
  return tagPrefab(def.make(at[0], at[2], h, y, params), key, params, at, h)
}

/** A building() at any heading: built round the origin facing +Z, then turned and moved into place. */
function tower(p: Paint, x: number, z: number, rot: number, w: number, d: number, h: number): Part[] {
  const r = norm(rot), id = `Building@${+x.toFixed(2)},${LOT_Y},${+z.toFixed(2)}`
  return building({ x: 0, z: 0, w, d, h, y: LOT_Y, style: p.style, wall: p.wall, trim: p.trim, roof: p.roof, neon: p.neon, front: 'S' }).map((q) => {
    const [ox, oz] = turn(q.at[0], q.at[2], r)
    return { ...q, at: [+(x + ox).toFixed(3), q.at[1], +(z + oz).toFixed(3)] as Vec3, rot: norm((q.rot ?? 0) + r), group: id }
  })
}

const ROOF: Tex = { lib: 'gravel_concrete_03', surface: 12 }
const STORE: Tex = { gen: 'storefront', tweak: { seed: 321 } }
/** A building on any outline (a wedge corner, a flatiron): walls of windows, a cornice, shop fronts round the ground floor. */
function prism(poly: Pt[], h: number, p: Paint, shops: boolean, label = 'Flatiron'): Part[] {
  const c = centroid(poly), at: Vec3 = [+c[0].toFixed(3), LOT_Y, +c[1].toFixed(3)]
  const rel = (q: Pt[]) => q.map(([x, z]): [number, number] => [+(x - c[0]).toFixed(3), +(z - c[1]).toFixed(3)])
  const trim = p.trim ?? PB.concrete, id = `${label}@${at.join(',')}`
  const out: Part[] = [blob(label, rel(poly), h, at, p.roof ?? ROOF, facadeTex(p.style, p.wall), FLOOR)]
  const lip = inset(poly, -0.5)
  if (lip) out.push(blob('Cornice', rel(lip), 0.64, [at[0], LOT_Y + h - 0.7, at[2]], trim, trim, 2))
  if (shops) poly.forEach((a, k) => {
    const b = poly[(k + 1) % poly.length], e = sub(b, a), l = len(e)
    if (l < 8) return
    const o = mul(left(unit(e)), -1), m = add(lerp(a, b, 0.5), mul(o, 0.15))
    out.push(box('Storefront', [l - 4, 5.5, 0.3], [+m[0].toFixed(3), LOT_Y + 0.4, +m[1].toFixed(3)], STORE, STORE, norm(heading(o)), 5.5))
  })
  if (Math.abs(area(poly)) > 300) out.push(box('Stair hut', [4, 3.2, 4], [at[0], LOT_Y + h, at[2]], trim, trim))
  return out.map((q) => ({ ...q, group: id }))
}

// ---------------- filling a block ----------------

/** A block being filled: what's taken (convex outlines, with their extents), and the parts placed. */
class Lot {
  taken: { pts: Pt[]; x0: number; x1: number; z0: number; z1: number }[] = []
  parts: Part[] = []
  /** Whether the block bulges outward everywhere (most do), which makes "inside" a quick test against its sides. */
  readonly convex: boolean
  readonly ext: Rect
  constructor(readonly b: Block, readonly r: Rng) {
    this.convex = b.edges.every((e, k) => crs(e.u, b.edges[(k + 1) % b.edges.length].u) >= -1e-6)
    this.ext = bounds(b.poly)
  }
  /** Inside the block and at least `gap` clear of everything placed. */
  free(q: Pt[], gap = 1) { return this.within(q) && this.clear(q, gap) }
  within(q: Pt[]) {
    const { poly, edges } = this.b, x = this.ext
    for (const [px, pz] of q) if (px < x.x0 - 0.02 || px > x.x1 + 0.02 || pz < x.z0 - 0.02 || pz > x.z1 + 0.02) return false
    if (this.convex) {
      for (const p of q) for (const s of edges) if ((p[0] - s.a[0]) * s.n[0] + (p[1] - s.a[1]) * s.n[1] < -0.02) return false
      return true
    }
    if (!q.every((p) => inside(poly, p) || edgeDist(poly, p) < 0.02)) return false
    // A corner of the block poking into it (where the block bends inward).
    return !poly.some((v) => { const s = q.map((p, k) => crs(sub(q[(k + 1) % q.length], p), sub(v, p))); return s.every((d) => d > 0.02) || s.every((d) => d < -0.02) })
  }
  clear(q: Pt[], gap: number) {
    const e = bounds(q)
    return this.taken.every((t) => e.x1 + gap <= t.x0 || t.x1 + gap <= e.x0 || e.z1 + gap <= t.z0 || t.z1 + gap <= e.z0 || apart(q, t.pts, gap))
  }
  take(q: Pt[]) { this.taken.push({ pts: q, ...bounds(q) }) }
}

type Pick = () => { key?: string; params?: Params; paint?: Paint; w?: number; d?: number; h?: number } | null

/** How far the block reaches in from a side. */
const reach = (b: Block, e: Edge) => Math.max(...b.poly.map((v) => dot(sub(v, e.a), e.n)))

/**
 * Lines one side of the block with buildings facing the street, from one corner to the other, each set
 * back `setback` from the sidewalk with `gap` between them.
 */
function frontage(lot: Lot, e: Edge, pick: Pick, o: { setback?: number; gap?: number; maxDepth?: number } = {}) {
  const setback = o.setback ?? 0.5, gap = o.gap ?? 1
  let at = 1
  for (let tries = 0; tries < 40 && at < e.len - 4; tries++) {
    const c = pick()
    if (!c) break
    const [w, d] = c.key ? dims(c.key, c.params ?? {}) : [c.w!, c.d!]
    if (o.maxDepth && d > o.maxDepth) { at += 2; continue }
    if (at + w > e.len - 1) { at += 2; continue }
    const m = add(add(e.a, mul(e.u, at + w / 2)), mul(e.n, setback + d / 2))
    const q = rect(m, e.rot, w, d)
    if (!lot.free(q, gap)) { at += 3; continue }
    lot.parts.push(...(c.key ? placeAt(c.key, c.params ?? {}, m[0], m[1], e.rot) : tower(c.paint!, m[0], m[1], e.rot, w, d, c.h!)))
    lot.take(q)
    at += w + gap
  }
}

/**
 * Fills the gaps left along a side with plain buildings in the district's colours, so a street front reads as
 * a continuous wall of buildings the way city blocks do (gaps of `keep` units or less are left as alleys).
 */
function infill(lot: Lot, e: Edge, paints: Paint[], storeys: [number, number], depth: [number, number], keep = 4) {
  const d = lot.r.int(depth[0], depth[1])
  const slice = (a0: number, a1: number): [Pt, Pt[]] => {
    const m = add(add(e.a, mul(e.u, (a0 + a1) / 2)), mul(e.n, 0.5 + d / 2))
    return [m, rect(m, e.rot, a1 - a0, d)]
  }
  // On a block with no inward bends the slices that fit run unbroken from one end to the other: find the ends.
  let lo = 1, hi = Math.ceil(e.len - 1) - 1
  if (lot.convex) {
    while (lo <= hi && !lot.within(slice(lo, lo + 1)[1])) lo++
    while (hi >= lo && !lot.within(slice(hi, hi + 1)[1])) hi--
  }
  let start: number | null = null
  for (let a = 1; a <= e.len - 1; a += 1) {
    const q = slice(a, a + 1)[1]
    const ok = a < e.len - 1 && (lot.convex ? a >= lo && a <= hi : lot.within(q)) && lot.clear(q, 1)
    if (ok && start === null) start = a
    if (!ok && start !== null) {
      const w = a - start
      if (w > keep + 6) {
        // Leave an alley at one end of a long gap now and then.
        const alley = w > 30 && lot.r.chance(0.4) ? 4 : 0
        const [m, q] = slice(start + alley, a)
        lot.parts.push(...tower(lot.r.pick(paints), m[0], m[1], e.rot, w - alley, d, lot.r.int(storeys[0], storeys[1]) * 7))
        lot.take(q)
      }
      start = null
    }
  }
}

/** The block's sharpest corner if it is a wedge (under 70°): the corner, and the way into the block. */
function wedge(b: Block): { v: Pt; into: Pt } | null {
  let best: { v: Pt; into: Pt } | null = null, least = (70 * Math.PI) / 180
  b.edges.forEach((e, k) => {
    const prev = b.edges[(k + b.edges.length - 1) % b.edges.length]
    const inner = Math.PI - Math.atan2(crs(prev.u, e.u), dot(prev.u, e.u))
    if (inner < least) { least = inner; best = { v: e.a, into: unit(sub(e.u, prev.u)) } }
  })
  return best
}
/** The part of a polygon within `depth` of a corner, measured along the way in. */
const tip = (poly: Pt[], w: { v: Pt; into: Pt }, depth: number) => { const p = add(w.v, mul(w.into, depth)); return clip(poly, p, add(p, left(w.into))) }
/** A wedge-shaped corner building in the block's sharp corner, `depth` deep. */
function corner(lot: Lot, paint: Paint, depth: number, h: number, shops = true) {
  const w = wedge(lot.b), body = inset(lot.b.poly, 0.5)
  if (!w || !body) return
  const piece = tip(body, w, depth)
  if (piece.length < 3 || area(piece) < 150) return
  lot.parts.push(...prism(piece, h, paint, shops, 'Corner building'))
  lot.take(piece)
}

/** A point in the block's frame, in world coordinates. */
const inFrame = (b: Block, x: number, z: number) => toWorld(b.rot, x, z)

function fillDowntown(lot: Lot, paints: Paint[]) {
  const { b, r } = lot
  // A wedge: a flatiron filling it (or its tip, on a big one).
  const w = wedge(b)
  if (w) {
    const whole = area(b.poly) < 14000, body = inset(b.poly, 1.5)
    const piece = body && (whole ? body : tip(body, w, r.range(50, 80)))
    if (piece && piece.length >= 3 && area(piece) > 200) { lot.parts.push(...prism(piece, r.pick([60, 90, 120, 160, 200, 260]), r.pick(paints), true)); lot.take(piece) }
    if (whole) return
  }
  const c = b.core, cw = c.x1 - c.x0, cd = c.z1 - c.z0
  // One tower, two, or four, with a plaza between.
  const split = r.pick([1, 2, 2, 4])
  const cells: Rect[] = split === 1 ? [c]
    : split === 2 ? (r.chance(0.5) ? [{ ...c, x1: c.x0 + cw / 2 }, { ...c, x0: c.x0 + cw / 2 }] : [{ ...c, z1: c.z0 + cd / 2 }, { ...c, z0: c.z0 + cd / 2 }])
      : [0, 1].flatMap((i) => [0, 1].map((j) => ({ x0: c.x0 + (i * cw) / 2, x1: c.x0 + ((i + 1) * cw) / 2, z0: c.z0 + (j * cd) / 2, z1: c.z0 + ((j + 1) * cd) / 2 })))
  cells.forEach((q, k) => {
    const qw = q.x1 - q.x0, qd = q.z1 - q.z0
    const [x, z] = inFrame(b, (q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2)
    // A plaza in place of one tower now and then.
    if (cells.length > 1 && k === 0 && r.chance(0.3)) {
      if (has('fountain') && lot.free(rect([x, z], b.rot, 14, 14), 1)) lot.parts.push(...placeAt('fountain', prefabParams(ALL_PREFABS.fountain), x, z, b.rot))
      return
    }
    const tw = Math.round(Math.min(qw - 8, r.range(0.65, 0.85) * qw)), td = Math.round(Math.min(qd - 8, r.range(0.65, 0.85) * qd))
    if (tw < 10 || td < 10) return
    const rot = Math.abs((q.z0 + q.z1) / 2 - c.z1) < Math.abs((q.z0 + q.z1) / 2 - c.z0) ? b.rot : b.rot + 180
    const fp = rect([x, z], b.rot, tw, td)
    if (!lot.free(fp, 1)) return
    // Most towers 25 to 130 m, a landmark now and then.
    const h = Math.round(r.pick([50, 80, 120, 160, 200, 260, 320]) * (split === 1 ? 1.15 : 1))
    lot.parts.push(...tower(r.pick(paints), x, z, rot, tw, td, h))
    lot.take(fp)
  })
}

const CHINA = ['noodlebar', 'barbershop', 'pawnshop', 'donutshop', 'liquorstore'].filter((k) => !!ALL_PREFABS[k])
const VICE = ['divebar', 'liquorstore', 'pawnshop', 'boardedstore', 'barbershop'].filter((k) => !!ALL_PREFABS[k])
/** Sides long enough to build along. */
const sides = (b: Block, min: number) => b.edges.filter((e) => e.len >= min)

function fillShops(lot: Lot, st: DistrictStyle, keys: string[], storey: [number, number], club?: string) {
  const { r } = lot
  // A wedge corner gets a corner building of its own.
  if (r.chance(0.85)) corner(lot, r.pick(st.paints), r.range(28, 44), r.int(storey[0], storey[1]) * 7)
  if (club && has(club) && r.chance(0.6) && sides(lot.b, 30).length) frontage(lot, r.pick(sides(lot.b, 30)), () => ({ key: club, params: vary(club, r, ['sign'], {}, st.colours) }), { gap: 2 })
  for (const e of sides(lot.b, 16)) {
    frontage(lot, e, () => {
      // Mostly shops with flats over them; now and then a plain building in the district's colours.
      if (r.chance(0.75) && keys.length) {
        const key = r.pick(keys)
        return { key, params: vary(key, r, ['sign', 'awning', 'walls', 'upper'], { floors: r.int(storey[0], storey[1]) }, st.colours) }
      }
      return { paint: r.pick(st.paints), w: r.int(12, 22), d: r.int(14, 20), h: r.int(storey[0], storey[1] + 1) * 7 }
    }, { gap: r.pick([0.5, 1, 3]) })
    infill(lot, e, st.paints, storey, [22, 34], 3)
  }
  // The back court: bins, crates.
  courtyard(lot, ['srtrashbags', 'dumpster', 'producecrates', 'srpallets'].filter(has), 3)
}

function fillProjects(lot: Lot, st: DistrictStyle) {
  const { b, r } = lot
  // Two or three slabs facing each other across a court with a basketball court or a yard.
  const long = sides(b, 30).sort((p, q) => q.len - p.len)
  if (!long.length) return
  const first = r.chance(0.5) || long.length < 2 ? long[0] : long.find((e) => Math.abs(dot(e.u, long[0].u)) < 0.5) ?? long[0]
  const facing = long.filter((e) => e !== first && dot(e.u, first.u) < -0.7)
  for (const e of [first, ...facing.slice(0, 1)]) {
    frontage(lot, e, () => (has('projects') ? { key: 'projects', params: vary('projects', r, ['style'], { floors: r.chance(0.15) ? 12 : r.int(4, 6) }, st.colours) } : { paint: st.paints[0], w: 46, d: 18, h: 40 }), { setback: 6, gap: 8 })
    infill(lot, e, st.paints, [4, 6], [20, 26], 8)
  }
  // Walk-ups along the other sides now and then, in the same tan and grey concrete.
  for (const e of long) if (e !== first && !facing.includes(e) && r.chance(0.5)) infill(lot, e, st.paints, [3, 4], [16, 20], 10)
  const court = has('bballcourt') ? vary('bballcourt', r, ['fence']) : null
  if (court) {
    const [w, d] = dims('bballcourt', court), rot = first.rot + 90
    const c = inFrame(b, (b.core.x0 + b.core.x1) / 2, (b.core.z0 + b.core.z1) / 2), q = rect(c, rot, w, d)
    if (lot.free(q, 1)) { lot.parts.push(...placeAt('bballcourt', court, c[0], c[1], rot)); lot.take(q) }
  }
  courtyard(lot, ['firebarrel', 'srtrashbags', 'srconcretefence', 'dumpster'].filter(has), 4)
}

function fillHouses(lot: Lot, st: DistrictStyle, keys: string[], fence: string | null, trees: string[], setback: [number, number] = [16, 24], gap: [number, number] = [8, 14]) {
  const { b, r } = lot
  for (const e of sides(b, 24)) frontage(lot, e, () => {
    const key = r.pick(keys)
    // A villa, or a plain stucco house or corner shop, in the district's colours.
    if (key === 'villa') return { paint: r.pick(st.paints), w: r.int(18, 26), d: r.int(16, 22), h: 14 }
    if (key === 'stucco') return { paint: r.pick(st.paints), w: r.int(12, 20), d: r.int(14, 20), h: r.int(2, 3) * 7 }
    return { key, params: vary(key, r, ['color', 'garage', 'car', 'state', 'floors', 'roof', 'walls', 'trim', 'style'], {}, st.colours) }
  }, { setback: r.int(setback[0], setback[1]), gap: r.int(gap[0], gap[1]) })
  // Back yards: trees and a fence line between the two rows.
  courtyard(lot, trees.filter(has), 5)
  if (fence && has(fence)) {
    const fp = vary(fence, r, ['paint'], {}, st.colours), [fw, fd] = dims(fence, fp), z = (b.core.z0 + b.core.z1) / 2
    for (let x = b.core.x0 + 10; x < b.core.x1 - 10; x += 18) {
      const c = inFrame(b, x, z)
      if (lot.free(rect(c, b.rot, fw, fd), 0.3)) lot.parts.push(...placeAt(fence, fp, c[0], c[1], b.rot))
    }
  }
}

function fillDocks(lot: Lot, st: DistrictStyle, water: Edge | null) {
  const { b, r } = lot
  // Sheds along the streets, container stacks in the yard, a crane at the water's edge.
  for (const e of sides(b, 24)) if (e !== water) frontage(lot, e, () => {
    const key = r.pick(['brickwarehouse', 'metalshed', 'loadingdock', 'shed'].filter((k) => k === 'shed' || has(k)))
    return key === 'shed' ? { paint: r.pick(st.paints), w: r.int(24, 36), d: r.int(18, 26), h: r.int(10, 16) } : { key, params: vary(key, r, ['walls', 'trailer'], {}, st.colours) }
  }, { setback: 12, gap: 14, maxDepth: reach(b, e) * 0.5 })
  for (let k = 0; k < 3; k++) courtyard(lot, ['containerstack', 'containers', 'srcontainer'].filter(has), 2, 2)
  if (water && has('dockcrane')) {
    const p = add(add(water.a, mul(water.u, water.len / 2 + r.range(-20, 20))), mul(water.n, 12))
    lot.parts.push(...placeAt('dockcrane', prefabParams(ALL_PREFABS.dockcrane), p[0], p[1], water.rot))
  }
  courtyard(lot, ['srpallets', 'barrels', 'drumpallets', 'srcrate', 'palletjack'].filter(has), 8)
}

function fillIndustrial(lot: Lot, st: DistrictStyle) {
  const { b, r } = lot
  for (const e of sides(b, 24)) frontage(lot, e, () => {
    const key = r.pick(['factory', 'metalshed', 'brickwarehouse', 'shed', 'silo', 'tankfarm'].filter((k) => k === 'shed' || has(k)))
    return key === 'shed' ? { paint: r.pick(st.paints), w: r.int(24, 40), d: r.int(20, 30), h: r.int(10, 18) } : { key, params: vary(key, r, ['walls', 'chimney', 'n', 'h'], {}, st.colours) }
  }, { setback: 4, gap: 4 })
  // Factories fill most of their ground: big sheds behind the street fronts.
  for (const e of sides(b, 24)) infill(lot, e, st.paints, [2, 4], [36, 56], 6)
  courtyard(lot, ['chimney', 'watertower', 'fueltank', 'tankfarm', 'drumpallets', 'srgascylinders', 'srpallets'].filter(has), 5)
  // A chain-link line along one street.
  const long = sides(b, 40)
  if (has('chainfence') && long.length) {
    const e = r.pick(long)
    for (let a = 8; a < e.len - 8; a += 16) {
      const p = add(add(e.a, mul(e.u, a)), mul(e.n, 1))
      lot.parts.push(...placeAt('chainfence', prefabParams(ALL_PREFABS.chainfence), p[0], p[1], e.rot))
    }
  }
}

function fillPark(lot: Lot) {
  const { b, r } = lot
  const c = b.core, x = (c.x0 + c.x1) / 2, z = (c.z0 + c.z1) / 2, w = c.x1 - c.x0, d = c.z1 - c.z0
  const mid = inFrame(b, x, z), rot = norm(b.rot)
  lot.parts.push(box('Path', [w, 0.04, 4], [+mid[0].toFixed(2), LOT_Y, +mid[1].toFixed(2)], PB.gravel, PB.gravel, rot, 4), box('Path', [4, 0.04, d], [+mid[0].toFixed(2), LOT_Y, +mid[1].toFixed(2)], PB.gravel, PB.gravel, rot, 4))
  lot.take(rect(mid, rot, 8, 8))
  const centre = r.pick(['fountain', 'gazebo', 'playground'].filter(has))
  if (centre) lot.parts.push(...placeAt(centre, prefabParams(ALL_PREFABS[centre]), mid[0], mid[1], rot, LOT_Y + 0.04))
  // A pond in one quarter.
  const qx = x + r.pick([-1, 1]) * w / 4, qz = z + r.pick([-1, 1]) * d / 4
  if (w / 4 - 6 > 4 && d / 4 - 6 > 4) {
    const q = inFrame(b, qx, qz)
    const pond = blob('Pond', organicRing(w / 4 - 6, d / 4 - 6, r), 0.05, [+q[0].toFixed(2), LOT_Y, +q[1].toFixed(2)], U.water, U.water, 8)
    lot.parts.push({ ...pond, rot, water: true })
    lot.take(rect(q, rot, w / 2 - 8, d / 2 - 8))
  }
  courtyard(lot, ['tree', 'tree', 'tree', 'srbench', 'srtrashcan'].filter(has), 18, 1)
}

/** A loose oval for ponds. */
function organicRing(rx: number, rz: number, r: Rng): [number, number][] {
  const n = 18, out: [number, number][] = []
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, s = 0.85 + r.next() * 0.3; out.push([+(Math.cos(a) * rx * s).toFixed(2), +(Math.sin(a) * rz * s).toFixed(2)]) }
  return out
}

/** Scatters up to `n` of these in the block's free space, square to its frame. */
function courtyard(lot: Lot, keys: string[], n: number, gap = 2) {
  const { b, r } = lot
  if (!keys.length) return
  for (let k = 0, tries = 0; k < n && tries < n * 12; tries++) {
    const key = r.pick(keys)
    const params = vary(key, r, ['n', 'cols', 'tiers', 'seed', 'size', 'type', 'color'])
    const rot = b.rot + r.pick([0, 90, 180, 270])
    const [w, d] = dims(key, params), m = Math.min(w, d) / 2 + 1
    const x = r.range(b.box.x0 + m, b.box.x1 - m), z = r.range(b.box.z0 + m, b.box.z1 - m)
    const c = inFrame(b, x, z), q = rect(c, rot, w, d)
    if (!lot.free(q, gap)) continue
    lot.parts.push(...placeAt(key, params, c[0], c[1], rot))
    lot.take(q)
    k++
  }
}

/** A prefab, or nothing when it isn't in this build. */
const has = (key: string) => !!ALL_PREFABS[key]

// ---------------- the street plan ----------------

/**
 * The streets, as lines: a grid with an avenue that bends, one district's cross streets leaning, and a diagonal
 * or two through the grid's corners. The edge of the map, the waterfront, the bridges over the water and the
 * freeway stay straight.
 */
interface Plan {
  node: (i: number, k: number) => Pt
  /** Row k from column i to i + 1, and column i from row k to k + 1, as points (bends included). */
  row: (k: number, i: number) => Pt[]
  col: (i: number, k: number) => Pt[]
  lines: Polyline[]
  /** Diagonal streets, as the grid corners [i, k] they pass. */
  diagonals: [number, number][][]
  bentRows: Set<number>
  bentCols: Set<number>
}

function streetPlan(n: number, riverRow: number, fi: number, bridgeCols: Set<number>, r: Rng): Plan {
  const lineAt = (k: number) => -((n * PITCH) / 2) + k * PITCH
  const rowFns = new Map<number, ((x: number) => number)[]>(), colFns = new Map<number, ((z: number) => number)[]>()
  const push = <T>(m: Map<number, T[]>, k: number, f: T) => m.set(k, [...(m.get(k) ?? []), f])
  const bentRows = new Set<number>(), bentCols = new Set<number>()
  /** Bowed streets: the column, and the street lines it bows between. */
  const bows = new Map<number, [number, number]>()
  const fixedRow = (k: number) => k === 0 || k === n || k === riverRow || k === riverRow + 1
  const fixedCol = (i: number) => i === 0 || i === n || i === fi
  // The banks: [first, last] street line of each side's rows of blocks.
  const banks = [[0, riverRow], [riverRow + 1, n]].filter(([a, b]) => b > a)
  const x0 = lineAt(0), x1 = lineAt(n)
  const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

  // An avenue that bends gently from end to end (two in a big city): an arc or a long S.
  const free = range(n + 1).filter((k) => !fixedRow(k))
  for (let a = 0; a < (n >= 6 ? 2 : 1); a++) {
    const ok = free.filter((k) => !bentRows.has(k) && !bentRows.has(k - 1) && !bentRows.has(k + 1))
    if (!ok.length) break
    const k = r.pick(ok), amp = r.range(22, 34) * (n >= 6 ? 1.4 : n >= 4 ? 1.15 : 1) * r.pick([-1, 1]), s = r.pick([1, 1, 2])
    push(rowFns, k, (x: number) => amp * (s === 2 ? 0.8 : 1) * Math.sin(s * Math.PI * clamp01((x - x0) / (x1 - x0))))
    bentRows.add(k)
  }
  // No row to bend (a town with one row of blocks each side): a cross street bows across its bank instead.
  const bowable = range(1, n).filter((i) => !fixedCol(i))
  if (!bentRows.size && bowable.length && banks.length) {
    const [ka, kb] = r.pick(banks), i = r.pick(bowable), amp = r.range(18, 28) * r.pick([-1, 1])
    const za = lineAt(ka), zb = lineAt(kb)
    push(colFns, i, (z: number) => (z < za || z > zb ? 0 : amp * Math.sin(Math.PI * clamp01((z - za) / (zb - za)))))
    bentCols.add(i)
    bows.set(i, [ka, kb])
  }
  // A skewed grid: the outer row of blocks on one half of a bank, its cross streets leaning 7° to 12° (pivoting on
  // the street line inside it, so the waterfront and the bridges stay square to the river).
  const skewed = new Set<string>()
  for (let s = 0; s < (n >= 6 ? 2 : 1); s++) {
    const [ka, kb] = r.pick(banks), half = r.pick([-1, 1])
    if (skewed.has(`${ka},${half}`)) continue
    skewed.add(`${ka},${half}`)
    const cols = range(1, n).filter((i) => !fixedCol(i) && !bentCols.has(i) && lineAt(i) * half > 0)
    const before = kb === riverRow, zp = lineAt(before ? ka + 1 : kb - 1)
    const lean = r.pick([-1, 1]) * Math.min(Math.tan((r.range(7, 12) * Math.PI) / 180), 40 / PITCH)
    for (const i of cols) push(colFns, i, (z: number) => ((before ? z < zp : z > zp) ? lean * (z - zp) : 0))
  }

  const rowOff = (k: number, x: number) => (rowFns.get(k) ?? []).reduce((s, f) => s + f(x), 0)
  const colOff = (i: number, z: number) => (colFns.get(i) ?? []).reduce((s, f) => s + f(z), 0)
  const nodes = new Map<number, Pt>()
  const node = (i: number, k: number): Pt => {
    let p = nodes.get(i * 1000 + k)
    if (!p) {
      // Where row k and column i cross: each offset depends a little on the other, so settle it.
      let x = lineAt(i), z = lineAt(k)
      for (let t = 0; t < 8; t++) { x = lineAt(i) + colOff(i, z); z = lineAt(k) + rowOff(k, x) }
      p = [x, z]
      nodes.set(i * 1000 + k, p)
    }
    return p
  }
  // A bent avenue gets a point halfway along each block (its pieces stay longer than a junction at a diagonal
  // reaches along them); a bowed street, tighter, gets three.
  const row = (k: number, i: number): Pt[] => {
    const a = node(i, k), b = node(i + 1, k)
    return [a, ...(bentRows.has(k) ? [0.5].map((t): Pt => { const x = a[0] + (b[0] - a[0]) * t; return [x, lineAt(k) + rowOff(k, x)] }) : []), b]
  }
  const col = (i: number, k: number): Pt[] => {
    const a = node(i, k), b = node(i, k + 1)
    const bow = bows.get(i)
    return [a, ...(bow && k >= bow[0] && k < bow[1] ? [0.25, 0.5, 0.75].map((t): Pt => { const z = a[1] + (b[1] - a[1]) * t; return [lineAt(i) + colOff(i, z), z] }) : []), b]
  }
  const chain = (pieces: Pt[][]) => pieces.flatMap((p, k) => (k ? p.slice(1) : p))
  // Most cross streets stop at the waterfront; the bridges carry a few across.
  const lines: Polyline[] = range(n + 1).map((k) => chain(range(n).map((i) => row(k, i))))
  for (let i = 0; i <= n; i++) for (const [a, b] of bridgeCols.has(i) ? [[0, n]] : [[0, riverRow], [riverRow + 1, n]]) if (b > a) lines.push(chain(range(a, b).map((k) => col(i, k))))

  // Diagonals: corner to corner through a run of blocks (two blocks makes a six-way junction in the middle), or a
  // shallow one across two blocks side by side; never onto the freeway's ramps, and only the steep ones where a
  // street bends (a shallow one would meet it at too sharp an angle).
  const bowed = (i: number, j: number) => [i, i + 1].some((c) => { const b = bows.get(c); return !!b && j >= b[0] && j < b[1] })
  const bent = (i: number, j: number) => bowed(i, j) || bentRows.has(j) || bentRows.has(j + 1)
  // The map's corners and where the edge streets meet the waterfront turn without a junction to join.
  const corner = (i: number, k: number) => (i === 0 || i === n) && (k === 0 || k === n || k === riverRow || k === riverRow + 1)
  const used = new Set<string>(), usedNodes = new Set<string>()
  const diagonals: [number, number][][] = []
  for (let d = 0; d < (n >= 6 ? 2 : 1); d++) {
    const options: { nodes: [number, number][]; cells: [number, number][]; w: number }[] = []
    for (const [ka, kb] of banks) {
      const fits = (cells: [number, number][], ns: [number, number][], steep = true) =>
        cells.every(([i, j]) => i >= 0 && i < n && j >= ka && j < kb && !used.has(`${i},${j}`) && !bowed(i, j) && (steep || !bent(i, j))) &&
        ns.every(([i, k]) => !(i === fi && (k === 0 || k === n)) && !corner(i, k) && !usedNodes.has(`${i},${k}`))
      for (let j = ka; j < kb; j++) for (let i = 0; i < n; i++) {
        for (const dx of [1, -1]) for (const m of [1, 2, 3]) {
          const cells = range(m).map((t): [number, number] => [i + dx * t, j + t])
          const ns = range(m + 1).map((t): [number, number] => [dx > 0 ? i + t : i + 1 - t, j + t])
          if (fits(cells, ns)) options.push({ nodes: ns, cells, w: [0, 1, 4, 3][m] })
        }
        for (const up of [0, 1]) {
          const cells: [number, number][] = [[i, j], [i + 1, j]], ns: [number, number][] = [[i, j + up], [i + 2, j + 1 - up]]
          if (fits(cells, ns, false)) options.push({ nodes: ns, cells, w: 2 })
        }
      }
    }
    if (!options.length) break
    let roll = r.next() * options.reduce((s, o) => s + o.w, 0)
    const o = options.find((q) => (roll -= q.w) < 0) ?? options[options.length - 1]
    for (const [i, j] of o.cells) used.add(`${i},${j}`)
    for (const [i, k] of o.nodes) usedNodes.add(`${i},${k}`)
    diagonals.push(o.nodes)
    lines.push(o.nodes.map(([i, k]) => node(i, k)))
  }
  return { node, row, col, lines, diagonals, bentRows, bentCols }
}

/** A block from a cell's outline (the street centrelines round it): shrunk to the sidewalks' edge, with its sides and frame. */
function makeBlock(i: number, j: number, d: DistrictKey, outline: Pt[]): Block | null {
  const poly = inset(area(outline) < 0 ? [...outline].reverse() : outline, C / 2)
  if (!poly || area(poly) < 300) return null
  const edges = poly.map((a, k): Edge => {
    const b = poly[(k + 1) % poly.length], u = unit(sub(b, a)), n = left(u)
    return { a, b, u, n, len: len(sub(b, a)), rot: norm(heading(mul(n, -1))) }
  })
  // The frame: square to its longest side, within 45° of the map's own axes.
  const long = edges.reduce((m, e) => (e.len > m.len ? e : m))
  const rot = ((((Math.atan2(-long.u[1], long.u[0]) * 180) / Math.PI + 45) % 90) + 90) % 90 - 45
  const local = poly.map((p) => turn(p[0], p[1], -rot))
  return { i, j, d, poly, edges, rot, box: bounds(local), core: inscribed(local) }
}

// ---------------- the city ----------------

const NAMES_A = ['Iron', 'Silver', 'Stone', 'Copper', 'Harbor', 'Crown', 'Saint', 'Ash', 'Raven', 'Cobalt']
const NAMES_B = ['water', 'haven', 'port', 'field', 'bay', 'mouth', 'ford', 'brook']

/** The finished city as a sample map. */
/** The city's side, wall to wall, in editor units. */
export const citySide = (size: CitySize) => CITY_SIZES[size].blocks * PITCH + C + 2 * EDGE

export function citySample(o: CityOptions): Sample {
  const r = rng(o.seed)
  const n = CITY_SIZES[o.size].blocks
  const L = n * PITCH + C + 2 * EDGE
  const lineAt = (k: number) => -((n * PITCH) / 2) + k * PITCH
  // Which way round: downtown's side of the river and the docks' end come out differently every seed.
  const flipX = r.chance(0.5) ? -1 : 1
  const riverRow = n >= 6 ? r.pick([Math.floor(n / 2) - 1, Math.floor(n / 2)]) : Math.floor(n / 2) - (r.chance(0.5) ? 1 : 0)
  const parts: Part[] = []

  // ---- the river: a curving channel inside one row of blocks, quays both sides, waterfront streets along it.
  const zA = lineAt(riverRow) + C / 2, zB = lineAt(riverRow + 1) - C / 2
  const width = Math.round((zB - zA) * 0.55)
  const amp = (zB - zA - width) / 2 - 8
  const phase = r.range(0, Math.PI * 2)
  const zr = (x: number) => (zA + zB) / 2 + amp * Math.sin((x / L) * Math.PI * 2.2 + phase)
  const xs: number[] = []
  for (let x = -L / 2; x <= L / 2 + 0.01; x += 8) xs.push(Math.min(L / 2, x))
  const north = xs.map((x): [number, number] => [x, zr(x) - width / 2]), south = xs.map((x): [number, number] => [x, zr(x) + width / 2])
  const strip = (pts: [number, number][], y0: number, h: number, label: string, top: Tex, side: Tex) => {
    let cx = 0, cz = 0
    for (const [x, z] of pts) { cx += x; cz += z }
    cx /= pts.length; cz /= pts.length
    return blob(label, pts.map(([x, z]): [number, number] => [+(x - cx).toFixed(2), +(z - cz).toFixed(2)]), h, [+cx.toFixed(2), y0, +cz.toFixed(2)], top, side, 8)
  }
  const BED = -6, WATER = -1.5
  parts.push(
    box('Ground', [L, 1, zA + L / 2], [0, 0, (zA - L / 2) / 2], PB.concrete, PB.concrete, 0, 8),
    box('Ground', [L, 1, L / 2 - zB], [0, 0, (zB + L / 2) / 2], PB.concrete, PB.concrete, 0, 8),
    // Quays: from the waterfront street's sidewalk down to the river bed.
    strip([[-L / 2, zA], [L / 2, zA], ...north.slice().reverse()], BED - 1, 1 - (BED - 1), 'Quay', U.walk, PB.concrete),
    strip([...south, [L / 2, zB], [-L / 2, zB]], BED - 1, 1 - (BED - 1), 'Quay', U.walk, PB.concrete),
    strip([...north, ...south.slice().reverse()], BED - 1, 1, 'River bed', PB.dirt, PB.dirt),
    { ...strip([...north, ...south.slice().reverse()], WATER - 0.05, 0.05, 'River', U.water, U.water), water: true },
  )
  // Railings along both quay edges, one object each side.
  for (const [edge, k] of [[north, 0], [south, 1]] as const) {
    for (let s = 0; s + 1 < edge.length; s++) {
      const [ax, az] = edge[s], [bx, bz] = edge[s + 1]
      const len = Math.hypot(bx - ax, bz - az)
      const rot = -(Math.atan2(bz - az, bx - ax) * 180) / Math.PI
      parts.push({ ...box('Quay railing', [len, 2.2, 0.3], [(ax + bx) / 2, 1, (az + bz) / 2 + (k ? 0.6 : -0.6)], PB.steel, PB.steel, rot), group: `Quay railing ${k}` })
    }
  }

  // ---- streets: bridges carry a few cross streets over the river; the freeway runs along one that doesn't.
  const bridgeCols = new Set<number>()
  const want = n <= 4 ? 2 : n <= 6 ? 3 : 4
  for (let k = 0; k < want; k++) bridgeCols.add(1 + Math.round(((k + 0.5) * (n - 1)) / want - 0.5))
  const freeCols = Array.from({ length: n + 1 }, (_, i) => i).filter((i) => !bridgeCols.has(i))
  const innerCols = freeCols.filter((i) => i > 0 && i < n)
  const fi = r.pick(innerCols.length ? innerCols : freeCols)
  const plan = streetPlan(n, riverRow, fi, bridgeCols, r)
  const { lines } = plan
  // One road prefab for the whole network (built once, as the prefab would build it from its points, at y 1).
  const roadParams = { path: formatPath(lines), width: ST, walk: WK, lines: 'double', lamps: 34, crossings: 'yes' }
  const road = buildRoad(parsePath(roadParams.path), roadOptions(roadParams), 1)
  parts.push(...tagPrefab(road.parts, 'road', roadParams, [0, 1, 0], 0))
  // Bridges: a deck under the road over the water, railings, piers down to the bed.
  for (const i of bridgeCols) {
    const x = lineAt(i)
    const id = `Bridge@${x}`
    parts.push(
      { ...box('Bridge deck', [C, 3, zB - zA + 2], [x, -2, (zA + zB) / 2], PB.concrete, PB.concrete), group: id },
      { ...box('Bridge railing', [0.5, 2.4, zB - zA], [x - C / 2 + 0.25, 1 + WALK_H, (zA + zB) / 2], PB.steel, PB.steel), group: id },
      { ...box('Bridge railing', [0.5, 2.4, zB - zA], [x + C / 2 - 0.25, 1 + WALK_H, (zA + zB) / 2], PB.steel, PB.steel), group: id },
      ...[-0.25, 0.25].map((f): Part => ({ ...box('Bridge pier', [6, -2 - BED, 6], [x, BED, zr(x) + f * width], PB.concrete, PB.concrete), group: id })),
    )
  }

  // ---- an elevated freeway along one street, end to end, over the river on its own span: the city's signature.
  const H = 20, FW = 36, RUN = 60
  const freeway = { x: lineAt(fi), z0: -L / 2 + EDGE + 2, z1: L / 2 - EDGE - 2 }
  {
    const { x, z0, z1 } = freeway
    const id = `Freeway@${x}`
    // On-ramps at both ends, from the street up to the deck (a gentle 1 in 3, walkable and drivable).
    const d0 = z0 + RUN, d1 = z1 - RUN
    const deck = buildRoad([[[x, d0], [x, d1]]], { width: FW - 4, walk: 0, lines: 'dashed', lamps: 0, crossings: false }, H)
    parts.push(
      { ...box('Freeway deck', [FW, 2.5, d1 - d0], [x, H - 2.5, (d0 + d1) / 2], PB.concrete, PB.concrete), group: id },
      ...deck.parts.map((q) => ({ ...q, group: id })),
      ...[-1, 1].map((sx): Part => ({ ...box('Freeway barrier', [1, 2.2, d1 - d0], [x + sx * (FW / 2 - 0.5), H, (d0 + d1) / 2], PB.concrete, PB.concrete), group: id })),
      { ...ramp('Freeway ramp', [FW, H - 1, RUN], [x, 1, z0 + RUN / 2], ROAD_TEX_ASPHALT, PB.concrete, 180), group: id },
      { ...ramp('Freeway ramp', [FW, H - 1, RUN], [x, 1, z1 - RUN / 2], ROAD_TEX_ASPHALT, PB.concrete, 0), group: id },
    )
    // Pillars between the lanes, on land; over the river the span stands on piers from the bed.
    for (let z = d0 + 10; z < d1 - 10; z += 60) {
      const onRiver = z > zA - 4 && z < zB + 4
      for (const sx of [-1, 1]) {
        const y0 = onRiver ? BED : 1
        parts.push({ ...box('Freeway pillar', [3, H - 2.5 - y0, 3], [x + sx * 6, y0, z], PB.concrete, PB.concrete), group: id })
      }
    }
  }

  // ---- districts, by grid cell: the river splits the city; downtown on one bank by the middle, docks down one end of the other.
  interface Cell { i: number; j: number; d: DistrictKey }
  const cells: Cell[] = []
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (j !== riverRow) cells.push({ i, j, d: 'park' })
  // Downtown on the bank with more room (−1: the rows before the river).
  const before = riverRow, after = n - 1 - riverRow
  const downSide = before === after ? (r.chance(0.5) ? -1 : 1) : before > after ? -1 : 1
  const downRows = downSide < 0 ? before : after
  const otherRows = downSide < 0 ? after : before
  const sideOf = (b: Cell) => (b.j < riverRow ? -1 : 1)
  const rowFromRiver = (b: Cell) => (b.j < riverRow ? riverRow - 1 - b.j : b.j - riverRow - 1)
  const u = (b: Cell) => flipX * ((b.i + 0.5) / n * 2 - 1) // −1 .. 1 across, flipped per seed
  const centreDist = (b: Cell) => Math.hypot((b.i + 0.5) - n / 2, rowFromRiver(b))
  const core = cells.filter((b) => sideOf(b) === downSide).sort((a, b2) => centreDist(a) - centreDist(b2)).slice(0, n <= 4 ? 2 : n <= 6 ? 4 : 6)
  const coreSet = new Set(core)
  for (const b of cells) {
    const s = sideOf(b), x = u(b), row = rowFromRiver(b)
    if (coreSet.has(b)) b.d = 'downtown'
    // The outermost row on downtown's bank: homes, the rich ones up one end.
    else if (s === downSide) b.d = downRows >= 2 && row === downRows - 1 ? (x < -0.2 ? 'highend' : 'suburbs') : x < 0 ? 'chinatown' : 'redlight'
    // Docks on the water down one end, factories behind them (side by side when the bank has one row).
    else if (x > 0) b.d = row === 0 ? (otherRows === 1 && b.i % 2 === 0 ? 'industrial' : 'docks') : 'industrial'
    else if (x < -0.35) b.d = 'barrio'
    else b.d = row >= 2 && r.chance(0.4) ? 'suburbs' : 'projects'
  }
  // A central park beside downtown, and a small park now and then in the neighbourhoods.
  // (Never a district's only block.)
  const count = (d: DistrictKey) => cells.filter((b) => b.d === d).length
  const nearCore = cells.filter((b) => !coreSet.has(b) && core.some((c) => Math.abs(c.i - b.i) + Math.abs(c.j - b.j) === 1) && count(b.d) > 1)
  const spare = nearCore.length ? nearCore : cells.filter((b) => !coreSet.has(b) && count(b.d) > 1)
  if (spare.length) r.pick(spare).d = 'park'
  for (const b of cells) if (['suburbs', 'barrio', 'projects'].includes(b.d) && count(b.d) > 2 && r.chance(0.08)) b.d = 'park'
  const districtAt = (i: number, j: number) => cells.find((c) => c.i === i && c.j === j)?.d

  // ---- blocks: each cell's outline, cut along the diagonals into wedges, shrunk to the sidewalks.
  const cuts = plan.diagonals.flatMap((d) => d.slice(1).map((q, k): [Pt, Pt] => [plan.node(...d[k]), plan.node(...q)]))
  const blocks: Block[] = []
  for (const c of cells) {
    const { i, j } = c
    const outline = [...plan.row(j, i), ...plan.col(i + 1, j).slice(1), ...plan.row(j + 1, i).reverse().slice(1), ...plan.col(i, j).reverse().slice(1, -1)]
    let pieces = [outline]
    for (const [a, b] of cuts) pieces = pieces.flatMap((p) => ([0.15, 0.3, 0.5, 0.7, 0.85].some((t) => { const q = lerp(a, b, t); return inside(p, q) && edgeDist(p, q) > 1 })
      ? [clip(p, a, b), clip(p, b, a)].filter((q) => q.length >= 3 && Math.abs(area(q)) > 50) : [p]))
    for (const p of pieces) { const b = makeBlock(i, j, c.d, p); if (b) blocks.push(b) }
  }

  // ---- a boulevard downtown: a planted median down the middle of the street with the most downtown along it.
  {
    const diagNodes = new Set(plan.diagonals.flatMap((d) => d.map(([i, k]) => `${i},${k}`)))
    // Street segments crossed by a shallow diagonal between corners.
    const crossed = new Set(plan.diagonals.filter((d) => d.length === 2 && Math.abs(d[1][0] - d[0][0]) === 2).map((d) => `${Math.min(d[0][0], d[1][0]) + 1},${Math.min(d[0][1], d[1][1])}`))
    let best: { segs: [Pt, Pt][]; score: number } | null = null
    const consider = (segs: ([Pt, Pt] | null)[], both: boolean[]) => {
      let run: [Pt, Pt][] = [], score = 0
      segs.forEach((s, k) => {
        if (s) { run.push(s); score += both[k] ? 1.5 : 1 }
        if (!s || k === segs.length - 1) {
          if (run.length && (!best || score > best.score + (r.next() - 0.5) * 0.1)) best = { segs: run, score }
          run = []; score = 0
        }
      })
    }
    const isDown = (i: number, j: number) => districtAt(i, j) === 'downtown'
    for (let k = 0; k <= n; k++) {
      if (plan.bentRows.has(k)) continue
      consider(range(n).map((i) => ((isDown(i, k - 1) || isDown(i, k)) && !diagNodes.has(`${i},${k}`) && !diagNodes.has(`${i + 1},${k}`) ? [plan.node(i, k), plan.node(i + 1, k)] : null)),
        range(n).map((i) => isDown(i, k - 1) && isDown(i, k)))
    }
    for (let i = 1; i < n; i++) {
      if (i === fi || plan.bentCols.has(i)) continue
      consider(range(n).map((k) => (k !== riverRow && (isDown(i - 1, k) || isDown(i, k)) && !crossed.has(`${i},${k}`) && !diagNodes.has(`${i},${k}`) && !diagNodes.has(`${i},${k + 1}`) ? [plan.node(i, k), plan.node(i, k + 1)] : null)),
        range(n).map((k) => isDown(i - 1, k) && isDown(i, k)))
    }
    const MEDIAN: Tex = U.grass, END = 36, my = 1 + ROAD_H
    for (const [a, b] of (best as { segs: [Pt, Pt][] } | null)?.segs ?? []) {
      const d = unit(sub(b, a)), l = len(sub(b, a)) - 2 * END, rot = norm(heading(d)), m = lerp(a, b, 0.5)
      if (l < 30) continue
      parts.push({ ...box('Median', [5, WALK_H, +l.toFixed(2)], [+m[0].toFixed(2), my, +m[1].toFixed(2)], MEDIAN, ROAD_TEX.kerb, rot, 4), group: `Median@${+m[0].toFixed(2)},${+m[1].toFixed(2)}` })
      for (let t = END + 8; t <= len(sub(b, a)) - END - 8; t += 18) {
        const p = add(a, mul(d, t))
        if (has('tree')) parts.push(...placeAt('tree', prefabParams(ALL_PREFABS.tree, { size: 1 }), p[0], p[1], rot, my + WALK_H))
      }
    }
  }

  // ---- fill every block.
  for (const b of blocks) {
    const lot = new Lot(b, r)
    const st = DISTRICTS[b.d]
    const c = centroid(b.poly)
    parts.push(blob(`${st.label} lot`, b.poly.map(([x, z]): [number, number] => [+(x - c[0]).toFixed(3), +(z - c[1]).toFixed(3)]), WALK_H, [+c[0].toFixed(3), 1, +c[1].toFixed(3)], st.lot, PB.concrete, 6))
    // The side facing the river, on a waterfront block.
    const toRiver: Pt | null = b.j === riverRow - 1 ? [0, 1] : b.j === riverRow + 1 ? [0, -1] : null
    const water = toRiver ? b.edges.find((e) => e.len > 40 && dot(e.n, toRiver) < -0.95 && Math.abs(e.a[1] - (lineAt(b.j === riverRow - 1 ? riverRow : riverRow + 1) - toRiver[1] * C / 2)) < 2) ?? null : null
    switch (b.d) {
      case 'downtown': fillDowntown(lot, st.paints); break
      case 'chinatown': fillShops(lot, st, CHINA, [3, 8]); if (has('lanternstring')) courtyard(lot, ['lanternstring'], 2); break
      case 'redlight': fillShops(lot, st, VICE, [3, 5], 'nightclub'); break
      case 'projects': fillProjects(lot, st); break
      // The barrio: close-built row houses and corner shops, two or three storeys.
      case 'barrio': fillHouses(lot, st, ['rowhouses', 'townhouse', 'bungalow', 'boardedhouse', 'house', 'stucco', 'stucco', 'stucco'].filter((k) => k === 'stucco' || has(k)), 'chainfence', ['tree', 'srtrashbags', 'firebarrel'], [2, 6], [2, 6]); for (const e of sides(b, 24)) infill(lot, e, st.paints, [2, 3], [20, 28], 6); break
      case 'suburbs': fillHouses(lot, st, ['suburbhouse', 'bungalow', 'house'].filter(has), 'picketfence', ['tree', 'tree', 'backyard']); break
      case 'highend': fillHouses(lot, st, ['crib', 'suburbhouse', 'penthouse', 'townhouse', 'villa', 'villa', 'villa', 'suburbhouse'].filter((k) => k === 'villa' || has(k)), 'hedge', ['palmtall', 'palm', 'palmcluster', 'tree'], [18, 26], [10, 16]); break
      case 'docks': fillDocks(lot, st, water); break
      case 'industrial': fillIndustrial(lot, st); break
      case 'park': fillPark(lot); break
    }
    parts.push(...lot.parts)
    parts.push(...sidewalk(b, st, r))
  }

  // ---- parked cars along the kerbs, clear of the junctions.
  const colours = ['#a8322b', '#2f5f8f', '#d8d4cc', '#2a2a2e', '#c9a23a', '#3f7a3a', '#7a7f86', '#5a3a6a']
  for (const b of blocks) {
    const per = DISTRICTS[b.d].cars
    for (const e of b.edges) {
      if (e.len < 40 || !r.chance(Math.min(1, (per / 2) * Math.min(1, e.len / 150)))) continue
      // The kerb lane beside this side, 2.2 out from the kerb.
      const p = add(add(e.a, mul(e.u, r.range(14, e.len - 14))), mul(e.n, -(WK + 2.2)))
      parts.push(car(+p[0].toFixed(2), +p[1].toFixed(2), norm(heading(e.u) + r.pick([0, 180])), r.pick(colours), r.int(1, 99)))
    }
  }

  // ---- markers: on the streets, spread over the city; only spots that are open (nothing in the way, ground underfoot).
  const g = road.graph
  const pool: Vec3[] = []
  const walked = new Set<number>()
  g.links.forEach((ls, start) => {
    if (ls.length === 2) return
    for (const first of ls) {
      if (walked.has(first)) continue
      // A street from one junction to the next, through its bends.
      const pts: Pt[] = [g.nodes[start]]
      let at = start, e = first
      for (;;) {
        walked.add(e)
        const ed = g.edges[e], next = ed.a === at ? ed.b : ed.a
        pts.push(g.nodes[next])
        if (g.links[next].length !== 2) break
        e = g.links[next][0] === e ? g.links[next][1] : g.links[next][0]
        if (walked.has(e)) break
        at = next
      }
      const total = pts.slice(1).reduce((s, p, k) => s + len(sub(p, pts[k])), 0)
      if (total < 30) continue
      for (const f of total > 260 ? [0.2, 0.35, 0.5, 0.65, 0.8] : [0.3, 0.5, 0.7]) {
        let d = total * f, k = 0
        while (k + 2 < pts.length && d > len(sub(pts[k + 1], pts[k]))) { d -= len(sub(pts[k + 1], pts[k])); k++ }
        const p = lerp(pts[k], pts[k + 1], d / (len(sub(pts[k + 1], pts[k])) || 1))
        pool.push([+p[0].toFixed(1), 1, +p[1].toFixed(1)])
      }
    }
  })
  // Not on the freeway's ramps, and only where a player fits.
  const clearOfRamps = (p: Vec3) => !(Math.abs(p[0] - freeway.x) < FW / 2 + 2 && (p[2] < freeway.z0 + RUN + 2 || p[2] > freeway.z1 - RUN - 2))
  const fit = openSpots(parts)
  const open = pool.filter((p) => clearOfRamps(p) && fit(p))
  // Farthest first: each pick the spot farthest from everything picked so far.
  const spread = (from: Vec3[], count: number, taken: Vec3[]) => {
    const out: Vec3[] = []
    const far = from.map((p) => taken.reduce((m, q) => Math.min(m, Math.hypot(q[0] - p[0], q[2] - p[2])), Infinity))
    let any = taken.length > 0
    while (out.length < count) {
      let best = -1, bestD = -1
      from.forEach((_, i) => { const d = any ? far[i] : r.next(); if (d > bestD) { bestD = d; best = i } })
      if (best < 0 || (any && bestD < 12)) break
      const q = from[best]
      out.push(q); any = true
      from.forEach((p, i) => { far[i] = Math.min(far[i], Math.hypot(q[0] - p[0], q[2] - p[2])) })
    }
    return out
  }
  const red = spread(open.filter((p) => p[2] <= lineAt(0) + 1), 6, [])
  const blue = spread(open.filter((p) => p[2] >= lineAt(n) - 1), 6, [])
  const shared = spread(open, 16, [...red, ...blue])
  const weapons = spread(open, 20, [...red, ...blue, ...shared])
  const drops = spread(open.filter((p) => Math.abs(p[0]) < L / 3 && Math.abs(p[2]) < L / 3), 4, [...red, ...blue])
  const guns = ['ak47', 'pump_action_shotgun', 'tec9', 'sniper_rifle', 'mac10', 'pipe_bomb', 'molotov', 'magnum', 'rpg_launcher', 'beretta']
  // Each spawn looks the way it sees farthest: the other end (teams) or the middle (anyone) where it sees as far.
  const ray = partRay(parts), eye = (p: Vec3): Vec3 => [p[0], p[1] + 3.24, p[2]]
  const markers: MarkerSpec[] = [
    ...red.map((p): MarkerSpec => ['Red team spawn', p, { yaw: openHeading(ray, eye(p), 180) }]),
    ...blue.map((p): MarkerSpec => ['Blue team spawn', p, { yaw: openHeading(ray, eye(p), 0) }]),
    ...shared.map((p): MarkerSpec => ['Shared spawn', p, { yaw: openHeading(ray, eye(p)) }]),
    ...weapons.map((p, k): MarkerSpec => ['Weapon pickup', p, { weapon: guns[k % guns.length] }]),
    ...drops.map((p): MarkerSpec => ['Chains drop-off', p]),
  ]

  // ---- walls round the edge, and street lamps lit (spread out, within the light budget).
  parts.push(...perimeter(L, L, 24, PB.concrete, PB.concrete))
  const lights = road.lights.filter((_, k) => k % Math.max(1, Math.ceil(road.lights.length / 56)) === 0).slice(0, 56)

  const name = o.name?.trim() || `${r.pick(NAMES_A)}${r.pick(NAMES_B)} ${CITY_SIZES[o.size].label}`
  return {
    id: `city_${o.size}`,
    name, icon: '🌆', theme: 'Urban', modes: ['Gangsta Brawl', 'Team Gangsta Brawl', 'Big Ass Chains', 'Team Big Ass Chains'], size: 'full',
    description: `A Stilwater-style ${CITY_SIZES[o.size].label.toLowerCase()} built from the site's own pieces: districts, a river with bridges, streets that bend, with sidewalks and lamps (seed ${o.seed}).`,
    parts, markers, lights,
  }
}

/**
 * A test for street-level spots (y = 1): ground underfoot and nothing in the way up to head height, by the same
 * rules the map checks use, with the parts sorted into a grid so each spot only looks at its neighbours.
 */
function openSpots(parts: Part[]): (p: Vec3) => boolean {
  const floors = parts.filter((p) => (p.kind === 'box' || p.kind === 'cylinder') && Math.abs(p.at[1] + p.size[1] - 1) < 0.01)
  const CELL = 32, grid = new Map<number, Part[]>()
  const key = (cx: number, cz: number) => cx * 4096 + cz
  for (const p of parts) {
    if (!(p.at[1] < 1 + 3.4 && p.at[1] + p.size[1] > 1.01) || (p.size[1] <= 0.3 && p.at[1] + p.size[1] <= 1.35)) continue
    const t = ((p.rot ?? 0) * Math.PI) / 180, c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t))
    const ex = (p.size[0] * c + p.size[2] * s) / 2 + 1, ez = (p.size[0] * s + p.size[2] * c) / 2 + 1
    for (let cx = Math.floor((p.at[0] - ex) / CELL); cx <= Math.floor((p.at[0] + ex) / CELL); cx++) {
      for (let cz = Math.floor((p.at[2] - ez) / CELL); cz <= Math.floor((p.at[2] + ez) / CELL); cz++) {
        const k = key(cx, cz), list = grid.get(k)
        if (list) list.push(p); else grid.set(k, [p])
      }
    }
  }
  return (q) => support(floors, q) >= 0 && !blocker(grid.get(key(Math.floor(q[0] / CELL), Math.floor(q[2] / CELL))) ?? [], q)
}

/** Street furniture along a block's sidewalks, set back from the corners and the kerb; signs and lights at the corners. */
function sidewalk(b: Block, st: DistrictStyle, r: Rng): Part[] {
  const out: Part[] = []
  // Corners: a street-name sign on most, traffic lights downtown and in the busy districts.
  const busy = b.d === 'downtown' || b.d === 'chinatown' || b.d === 'redlight'
  b.edges.forEach((e, k) => {
    const prev = b.edges[(k + b.edges.length - 1) % b.edges.length]
    if (dot(prev.u, e.u) > 0.94) return
    const p = sub(e.a, mul(add(prev.n, e.n), 2.2))
    const key = busy && r.chance(0.5) && has('trafficlight') ? 'trafficlight' : has('srstreetname') && r.chance(0.6) ? 'srstreetname' : null
    if (key) out.push(...placeAt(key, prefabParams(ALL_PREFABS[key]), p[0], p[1], e.rot, LOT_Y))
  })
  const keys = st.props.filter(has)
  if (!keys.length) return out
  for (const e of b.edges) {
    for (let a = 9; a < e.len - 9; a += st.propEvery * r.range(0.7, 1.3)) {
      const key = r.pick(keys)
      const params = vary(key, r, ['n', 'color', 'size', 'type'])
      const [, d] = dims(key, params)
      // On the sidewalk, a step out from the lot edge.
      const p = add(add(e.a, mul(e.u, a)), mul(e.n, -(1.2 + d / 2)))
      out.push(...placeAt(key, params, p[0], p[1], e.rot, LOT_Y))
    }
  }
  return out
}
