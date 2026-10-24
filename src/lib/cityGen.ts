// A Stilwater-style city for people without the game: an original city laid out from the site's own shapes
// and prefabs (nothing from the game files), styled after how Saints Row's city feels: a grid of streets
// split by a river with bridges and quays, a downtown of towers, a Chinatown-like quarter, a red-light strip,
// the projects, a barrio, suburbs, rich houses, docks and factories, parks. Each district has its own
// buildings, heights, colours and street furniture. Units are editor units (0.5 m); street level is y = 1.
import type { Vec3 } from './project'
import { ALL_PREFABS } from './prefabRegistry'
import { building, prefabParams, tagPrefab, type Params, type Style } from './prefabs'
import { PB, blob, box, perimeter, type MarkerSpec, type Part, type Sample, type Tex } from './sampleKit'
import { U, car } from './urbanKit'
import { buildRoad, formatPath, roadOptions, roadPrefabParts, WALK_H, type Polyline } from './roads'
import { rng, type Rng } from './mapWizard'

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

interface Block { i: number; j: number; x0: number; x1: number; z0: number; z1: number; d: DistrictKey }
interface Rect { x0: number; x1: number; z0: number; z1: number }
/** Which way a front faces: +Z, −Z, +X, −X. */
type Face = 'pz' | 'nz' | 'px' | 'nx'
const ROT: Record<Face, number> = { pz: 0, px: 90, nz: 180, nx: 270 }

// ---------------- the districts ----------------

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
}

const T = {
  plaza: U.plazaTiles, walk: U.walk, grass: U.grass, dirt: PB.dirt, worn: PB.floorWorn, asphalt: PB.oldAsphalt, concrete: PB.concrete,
}

export const DISTRICTS: Record<DistrictKey, DistrictStyle> = {
  downtown: { label: 'Downtown', lot: T.plaza, props: ['srnewsboxtall', 'srtrashcan', 'srpayphone', 'srhydrant', 'srbench', 'srplanterpot', 'srparkingmeter'], propEvery: 16, cars: 1.2, sketch: '#b9c2d0' },
  chinatown: { label: 'Chinatown', lot: T.walk, props: ['producecrates', 'fruitcrates', 'srtrashbags', 'srnewsboxshort', 'srhydrant', 'srtrashcan', 'srpayphone'], propEvery: 14, cars: 0.8, sketch: '#c8564a' },
  redlight: { label: 'Red light', lot: T.walk, props: ['srtrashbags', 'srtrashcan', 'srhydrant', 'srpayphone', 'srnewsboxshort', 'firebarrel'], propEvery: 15, cars: 1, sketch: '#d05aa8' },
  projects: { label: 'The projects', lot: T.worn, props: ['srtrashbags', 'firebarrel', 'srtrashcan', 'srhydrant', 'srconcretefence'], propEvery: 20, cars: 0.6, sketch: '#8b7d6b' },
  barrio: { label: 'Barrio', lot: T.dirt, props: ['srtrashcan', 'srhydrant', 'srtrashbags', 'srwoodfence', 'srpayphone'], propEvery: 22, cars: 0.9, sketch: '#d1a35c' },
  suburbs: { label: 'Suburbs', lot: T.grass, props: ['mailbox', 'srhydrant', 'srtrashcan', 'tree'], propEvery: 26, cars: 0.7, sketch: '#7fae6a' },
  highend: { label: 'Hillside homes', lot: T.grass, props: ['palm', 'srhydrant', 'palmshort', 'srplanterpot'], propEvery: 24, cars: 0.4, sketch: '#5fb59a' },
  docks: { label: 'Docks', lot: T.concrete, props: ['srpallets', 'barrels', 'srcrate', 'bollards', 'srconebarrel'], propEvery: 24, cars: 0.3, sketch: '#6f8796' },
  industrial: { label: 'Factories', lot: T.asphalt, props: ['srpallets', 'drumpallets', 'srgascylinders', 'srtrashbags', 'srconebarrel'], propEvery: 26, cars: 0.5, sketch: '#7a7570' },
  park: { label: 'Park', lot: T.grass, props: ['srbench', 'srtrashcan', 'tree'], propEvery: 18, cars: 0.2, sketch: '#4f8f45' },
}

// ---------------- placing prefabs ----------------

/** A prefab's footprint at heading 0 (editor units, about its own origin). */
const footprints = new Map<string, Rect>()
function footprint(key: string, params: Params): Rect {
  const k = key + JSON.stringify(params)
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
  return f
}

/** Its footprint turned to a heading of 0/90/180/270: [width across X, depth across Z, centre offset x, z]. */
function turned(f: Rect, rot: number): [number, number, number, number] {
  const t = (rot * Math.PI) / 180, c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t))
  const xs: number[] = [], zs: number[] = []
  for (const [x, z] of [[f.x0, f.z0], [f.x1, f.z0], [f.x1, f.z1], [f.x0, f.z1]]) { xs.push(x * c + z * s); zs.push(-x * s + z * c) }
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs)
  return [x1 - x0, z1 - z0, (x0 + x1) / 2, (z0 + z1) / 2]
}

/** Random settings for a prefab (only the keys asked for; the rest stay at their defaults). */
function vary(key: string, r: Rng, keys: string[], fixed: Params = {}): Params {
  const def = ALL_PREFABS[key]
  const given: Params = { ...fixed }
  for (const d of def.params ?? []) {
    if (!keys.includes(d.key) || d.key in given) continue
    if (d.kind === 'select' && d.options?.length) given[d.key] = r.pick(d.options)[0]
    else if (d.kind === 'number' && d.min !== undefined && d.max !== undefined) given[d.key] = Math.round(r.range(d.min, d.max) / (d.step ?? 1)) * (d.step ?? 1)
  }
  return prefabParams(def, given)
}

/** A prefab standing with its turned footprint centred at (cx, cz), facing `face`. */
function placeAt(key: string, params: Params, cx: number, cz: number, face: Face, y = LOT_Y): Part[] {
  const def = ALL_PREFABS[key]
  if (!def) return []
  const rot = ROT[face]
  const [, , ox, oz] = turned(footprint(key, params), rot)
  const at: Vec3 = [+(cx - ox).toFixed(2), y, +(cz - oz).toFixed(2)]
  return tagPrefab(def.make(at[0], at[2], rot, y, params), key, params, at, rot)
}

// ---------------- filling a block ----------------

/** A block being filled: what's taken, and the parts placed. */
class Lot {
  taken: Rect[] = []
  parts: Part[] = []
  constructor(readonly b: Block, readonly r: Rng) {}
  free(q: Rect, gap = 1) {
    const { b } = this
    if (q.x0 < b.x0 - 0.01 || q.x1 > b.x1 + 0.01 || q.z0 < b.z0 - 0.01 || q.z1 > b.z1 + 0.01) return false
    return this.taken.every((t) => q.x1 + gap <= t.x0 || t.x1 + gap <= q.x0 || q.z1 + gap <= t.z0 || t.z1 + gap <= q.z0)
  }
  take(q: Rect) { this.taken.push(q) }
}

/** Where along a side the fronts go: for each face, the edge it stands on and the run along it. */
function side(b: Rect, face: Face): { along: 'x' | 'z'; from: number; to: number; edge: number; inward: number } {
  if (face === 'pz') return { along: 'x', from: b.x0, to: b.x1, edge: b.z1, inward: -1 }
  if (face === 'nz') return { along: 'x', from: b.x0, to: b.x1, edge: b.z0, inward: 1 }
  if (face === 'px') return { along: 'z', from: b.z0, to: b.z1, edge: b.x1, inward: -1 }
  return { along: 'z', from: b.z0, to: b.z1, edge: b.x0, inward: 1 }
}

type Pick = () => { key?: string; params?: Params; style?: Style; w?: number; d?: number; h?: number } | null

/**
 * Lines one side of the block with buildings facing the street, from one corner to the other, each set
 * back `setback` from the sidewalk with `gap` between them.
 */
function frontage(lot: Lot, face: Face, pick: Pick, o: { setback?: number; gap?: number; maxDepth?: number } = {}) {
  const s = side(lot.b, face)
  const setback = o.setback ?? 0.5, gap = o.gap ?? 1
  let at = s.from + 1
  for (let tries = 0; tries < 40 && at < s.to - 4; tries++) {
    const c = pick()
    if (!c) break
    let w: number, d: number, cx: number, cz: number
    if (c.key) {
      const [tw, td] = turned(footprint(c.key, c.params ?? {}), ROT[face])
      ;[w, d] = s.along === 'x' ? [tw, td] : [td, tw]
    } else { w = c.w!; d = c.d! }
    if (o.maxDepth && d > o.maxDepth) { at += 2; continue }
    if (at + w > s.to - 1) { at += 2; continue }
    const mid = at + w / 2, inner = s.edge + s.inward * (setback + d / 2)
    ;[cx, cz] = s.along === 'x' ? [mid, inner] : [inner, mid]
    const q: Rect = s.along === 'x' ? { x0: mid - w / 2, x1: mid + w / 2, z0: inner - d / 2, z1: inner + d / 2 } : { x0: inner - d / 2, x1: inner + d / 2, z0: mid - w / 2, z1: mid + w / 2 }
    if (!lot.free(q, gap)) { at += 3; continue }
    if (c.key) lot.parts.push(...placeAt(c.key, c.params ?? {}, cx, cz, face))
    else lot.parts.push(...building({ x: cx, z: cz, w: q.x1 - q.x0, d: q.z1 - q.z0, h: c.h!, y: LOT_Y, style: c.style!, front: ({ pz: 'S', nz: 'N', px: 'E', nx: 'W' } as const)[face] }))
    lot.take(q)
    at += w + gap
  }
}

/**
 * Fills the gaps left along a side with plain buildings in the district's style, so a street front reads as
 * a continuous wall of buildings the way city blocks do (gaps of `keep` units or less are left as alleys).
 */
function infill(lot: Lot, face: Face, styles: Style[], storeys: [number, number], depth: [number, number], keep = 4) {
  const s = side(lot.b, face)
  const d = lot.r.int(depth[0], depth[1])
  const slice = (a0: number, a1: number): Rect => {
    const inner0 = s.edge + s.inward * 0.5, inner1 = s.edge + s.inward * (0.5 + d)
    const [i0, i1] = [Math.min(inner0, inner1), Math.max(inner0, inner1)]
    return s.along === 'x' ? { x0: a0, x1: a1, z0: i0, z1: i1 } : { x0: i0, x1: i1, z0: a0, z1: a1 }
  }
  let start: number | null = null
  for (let a = s.from + 1; a <= s.to - 1; a += 1) {
    const ok = a < s.to - 1 && lot.free(slice(a, a + 1), 1)
    if (ok && start === null) start = a
    if (!ok && start !== null) {
      const w = a - start
      if (w > keep + 6) {
        // Leave an alley at one end of a long gap now and then.
        const alley = w > 30 && lot.r.chance(0.4) ? 4 : 0
        const q = slice(start + alley, a)
        const cx = (q.x0 + q.x1) / 2, cz = (q.z0 + q.z1) / 2
        lot.parts.push(...building({ x: cx, z: cz, w: q.x1 - q.x0, d: q.z1 - q.z0, h: lot.r.int(storeys[0], storeys[1]) * 7, y: LOT_Y, style: lot.r.pick(styles), front: ({ pz: 'S', nz: 'N', px: 'E', nx: 'W' } as const)[face] }))
        lot.take(q)
      }
      start = null
    }
  }
}

const FACES: Face[] = ['pz', 'nz', 'px', 'nx']
/** A prefab, or nothing when it isn't in this build. */
const has = (key: string) => !!ALL_PREFABS[key]

function fillDowntown(lot: Lot) {
  const { b, r } = lot
  const w = b.x1 - b.x0, d = b.z1 - b.z0
  // One tower, two, or four, with a plaza between.
  const split = r.pick([1, 2, 2, 4])
  const cells: Rect[] = split === 1 ? [b]
    : split === 2 ? (r.chance(0.5) ? [{ ...b, x1: b.x0 + w / 2 }, { ...b, x0: b.x0 + w / 2 }] : [{ ...b, z1: b.z0 + d / 2 }, { ...b, z0: b.z0 + d / 2 }])
      : [0, 1].flatMap((i) => [0, 1].map((j) => ({ x0: b.x0 + (i * w) / 2, x1: b.x0 + ((i + 1) * w) / 2, z0: b.z0 + (j * d) / 2, z1: b.z0 + ((j + 1) * d) / 2 })))
  cells.forEach((c, k) => {
    const cw = c.x1 - c.x0, cd = c.z1 - c.z0
    // A plaza in place of one tower now and then.
    if (cells.length > 1 && k === 0 && r.chance(0.3)) {
      const [x, z] = [(c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2]
      if (has('fountain')) lot.parts.push(...placeAt('fountain', prefabParams(ALL_PREFABS.fountain), x, z, 'pz'))
      return
    }
    const tw = Math.min(cw - 8, r.range(0.65, 0.85) * cw), td = Math.min(cd - 8, r.range(0.65, 0.85) * cd)
    const x = (c.x0 + c.x1) / 2, z = (c.z0 + c.z1) / 2
    const face: Face = Math.abs(z - b.z1) < Math.abs(z - b.z0) ? 'pz' : 'nz'
    // Most towers 25 to 130 m, a landmark now and then.
    const h = Math.round(r.pick([50, 80, 120, 160, 200, 260, 320]) * (split === 1 ? 1.15 : 1))
    lot.parts.push(...building({ x, z, w: Math.round(tw), d: Math.round(td), h, y: LOT_Y, style: r.pick<Style>(['office', 'glass', 'office', 'concrete', 'brick', 'stone']), front: face === 'pz' ? 'S' : 'N' }))
    lot.take({ x0: x - tw / 2, x1: x + tw / 2, z0: z - td / 2, z1: z + td / 2 })
  })
}

const CHINA = ['noodlebar', 'barbershop', 'pawnshop', 'donutshop', 'liquorstore'].filter(has)
const VICE = ['divebar', 'liquorstore', 'pawnshop', 'boardedstore', 'barbershop'].filter(has)

function fillShops(lot: Lot, keys: string[], walls: string[], storey: [number, number], club?: string) {
  const { r } = lot
  if (club && has(club) && r.chance(0.6)) frontage(lot, r.pick(FACES), () => ({ key: club, params: vary(club, r, ['sign']) }), { gap: 2 })
  for (const f of FACES) {
    frontage(lot, f, () => {
      // Mostly shops with flats over them; now and then a plain building in the style.
      if (r.chance(0.75) && keys.length) {
        const key = r.pick(keys)
        return { key, params: vary(key, r, ['sign', 'awning', 'walls', 'upper'], { floors: r.int(storey[0], storey[1]) }) }
      }
      return { style: r.pick<Style>(walls as Style[]), w: r.int(12, 22), d: r.int(14, 20), h: r.int(storey[0], storey[1] + 1) * 7 }
    }, { gap: r.pick([0.5, 1, 3]) })
    infill(lot, f, walls as Style[], storey, [22, 34], 3)
  }
  // The back court: bins, crates.
  courtyard(lot, ['srtrashbags', 'dumpster', 'producecrates', 'srpallets'].filter(has), 3)
}

function fillProjects(lot: Lot) {
  const { b, r } = lot
  // Two or three slabs round a court with a basketball court or a yard.
  const slabs: Face[] = r.chance(0.5) ? ['pz', 'nz'] : ['px', 'nx']
  for (const f of slabs) {
    frontage(lot, f, () => (has('projects') ? { key: 'projects', params: vary('projects', r, ['style'], { floors: r.chance(0.15) ? 12 : r.int(4, 6) }) } : { style: 'projects', w: 46, d: 18, h: 40 }), { setback: 6, gap: 8 })
    infill(lot, f, ['projects', 'concrete'], [4, 6], [20, 26], 8)
  }
  const x = (b.x0 + b.x1) / 2, z = (b.z0 + b.z1) / 2
  const court = has('bballcourt') ? vary('bballcourt', r, ['fence']) : null
  if (court) {
    const [w, d] = turned(footprint('bballcourt', court), slabs[0] === 'pz' ? 90 : 0)
    const q = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 }
    if (lot.free(q, 1)) { lot.parts.push(...placeAt('bballcourt', court, x, z, slabs[0] === 'pz' ? 'px' : 'pz')); lot.take(q) }
  }
  courtyard(lot, ['firebarrel', 'srtrashbags', 'srconcretefence', 'dumpster'].filter(has), 4)
}

function fillHouses(lot: Lot, keys: string[], fence: string | null, trees: string[], setback: [number, number] = [16, 24], gap: [number, number] = [8, 14]) {
  const { r } = lot
  for (const f of FACES) frontage(lot, f, () => {
    const key = r.pick(keys)
    return { key, params: vary(key, r, ['color', 'garage', 'car', 'state', 'floors', 'roof', 'walls', 'trim']) }
  }, { setback: r.int(setback[0], setback[1]), gap: r.int(gap[0], gap[1]) })
  // Back yards: trees and a fence line between the two rows.
  courtyard(lot, trees.filter(has), 5)
  if (fence && has(fence)) {
    const { b } = lot
    const z = (b.z0 + b.z1) / 2
    for (let x = b.x0 + 10; x < b.x1 - 10; x += 18) lot.parts.push(...placeAt(fence, prefabParams(ALL_PREFABS[fence]), x, z, 'pz'))
  }
}

function fillDocks(lot: Lot, water: Face | null) {
  const { b, r } = lot
  // Sheds along the streets, container stacks in the yard, a crane at the water's edge.
  for (const f of FACES) if (f !== water) frontage(lot, f, () => {
    const key = r.pick(['brickwarehouse', 'metalshed', 'loadingdock', 'warehouse'].filter(has))
    return key ? { key, params: vary(key, r, ['walls', 'trailer']) } : null
  }, { setback: 12, gap: 14, maxDepth: (b.z1 - b.z0) * 0.5 })
  for (let k = 0; k < 3; k++) courtyard(lot, ['containerstack', 'containers', 'srcontainer'].filter(has), 2, 2)
  if (water && has('dockcrane')) {
    const s = side(b, water)
    const along = (s.from + s.to) / 2 + r.range(-20, 20)
    const inner = s.edge + s.inward * 12
    lot.parts.push(...placeAt('dockcrane', prefabParams(ALL_PREFABS.dockcrane), s.along === 'x' ? along : inner, s.along === 'x' ? inner : along, water))
  }
  courtyard(lot, ['srpallets', 'barrels', 'drumpallets', 'srcrate', 'palletjack'].filter(has), 8)
}

function fillIndustrial(lot: Lot) {
  const { r } = lot
  for (const f of FACES) frontage(lot, f, () => {
    const key = r.pick(['factory', 'metalshed', 'brickwarehouse', 'warehouse', 'silo', 'tankfarm'].filter(has))
    return key ? { key, params: vary(key, r, ['walls', 'chimney', 'n', 'h']) } : null
  }, { setback: 4, gap: 4 })
  // Factories fill most of their ground: big sheds behind the street fronts.
  for (const f of FACES) infill(lot, f, ['warehouse', 'concrete'], [2, 4], [36, 56], 6)
  courtyard(lot, ['chimney', 'watertower', 'fueltank', 'tankfarm', 'drumpallets', 'srgascylinders', 'srpallets'].filter(has), 5)
  // A chain-link line along one street.
  if (has('chainfence')) {
    const s = side(lot.b, r.pick(FACES))
    for (let a = s.from + 8; a < s.to - 8; a += 16) {
      const inner = s.edge + s.inward * 1
      lot.parts.push(...placeAt('chainfence', prefabParams(ALL_PREFABS.chainfence), s.along === 'x' ? a : inner, s.along === 'x' ? inner : a, s.along === 'x' ? 'pz' : 'px'))
    }
  }
}

function fillPark(lot: Lot) {
  const { b, r } = lot
  const x = (b.x0 + b.x1) / 2, z = (b.z0 + b.z1) / 2, w = b.x1 - b.x0, d = b.z1 - b.z0
  lot.parts.push(box('Path', [w, 0.04, 4], [x, LOT_Y, z], PB.gravel, PB.gravel, 0, 4), box('Path', [4, 0.04, d], [x, LOT_Y, z], PB.gravel, PB.gravel, 0, 4))
  lot.take({ x0: x - 4, x1: x + 4, z0: z - 4, z1: z + 4 })
  const centre = r.pick(['fountain', 'gazebo', 'playground'].filter(has))
  if (centre) lot.parts.push(...placeAt(centre, prefabParams(ALL_PREFABS[centre]), x, z, 'pz', LOT_Y + 0.04))
  // A pond in one quarter.
  const qx = x + r.pick([-1, 1]) * w / 4, qz = z + r.pick([-1, 1]) * d / 4
  const pond = blob('Pond', organicRing(w / 4 - 6, d / 4 - 6, r), 0.05, [qx, LOT_Y, qz], U.water, U.water, 8)
  lot.parts.push({ ...pond, water: true })
  lot.take({ x0: qx - w / 4 + 4, x1: qx + w / 4 - 4, z0: qz - d / 4 + 4, z1: qz + d / 4 - 4 })
  courtyard(lot, ['tree', 'tree', 'tree', 'srbench', 'srtrashcan'].filter(has), 18, 1)
}

/** A loose oval for ponds. */
function organicRing(rx: number, rz: number, r: Rng): [number, number][] {
  const n = 18, out: [number, number][] = []
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, s = 0.85 + r.next() * 0.3; out.push([+(Math.cos(a) * rx * s).toFixed(2), +(Math.sin(a) * rz * s).toFixed(2)]) }
  return out
}

/** Scatters up to `n` of these in the block's free space. */
function courtyard(lot: Lot, keys: string[], n: number, gap = 2) {
  const { b, r } = lot
  if (!keys.length) return
  for (let k = 0, tries = 0; k < n && tries < n * 12; tries++) {
    const key = r.pick(keys)
    const params = vary(key, r, ['n', 'cols', 'tiers', 'seed', 'size', 'type', 'color'])
    const face = r.pick(FACES)
    const [w, d] = turned(footprint(key, params), ROT[face])
    const x = r.range(b.x0 + w / 2 + 1, b.x1 - w / 2 - 1), z = r.range(b.z0 + d / 2 + 1, b.z1 - d / 2 - 1)
    const q = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 }
    if (!(w < b.x1 - b.x0 - 2 && d < b.z1 - b.z0 - 2) || !lot.free(q, gap)) continue
    lot.parts.push(...placeAt(key, params, x, z, face))
    lot.take(q)
    k++
  }
}

// ---------------- the city ----------------

const NAMES_A = ['Iron', 'Silver', 'Stone', 'Copper', 'Harbor', 'Crown', 'Saint', 'Ash', 'Raven', 'Cobalt']
const NAMES_B = ['water', 'haven', 'port', 'field', 'bay', 'mouth', 'ford', 'brook']

/** The finished city as a sample map. */
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

  // ---- streets: a grid; most cross streets stop at the waterfront, the bridges carry a few across.
  const bridgeCols = new Set<number>()
  const want = n <= 4 ? 2 : n <= 6 ? 3 : 4
  for (let k = 0; k < want; k++) bridgeCols.add(1 + Math.round(((k + 0.5) * (n - 1)) / want - 0.5))
  const lines: Polyline[] = []
  for (let k = 0; k <= n; k++) lines.push([[lineAt(0), lineAt(k)], [lineAt(n), lineAt(k)]])
  for (let i = 0; i <= n; i++) {
    const x = lineAt(i)
    if (bridgeCols.has(i)) lines.push([[x, lineAt(0)], [x, lineAt(n)]])
    else lines.push([[x, lineAt(0)], [x, lineAt(riverRow)]], [[x, lineAt(riverRow + 1)], [x, lineAt(n)]])
  }
  const roadParams = { path: formatPath(lines), width: ST, walk: WK, lines: 'double', lamps: 34, crossings: 'yes' }
  parts.push(...tagPrefab(roadPrefabParts(0, 0, 0, 1, roadParams), 'road', roadParams, [0, 1, 0], 0))
  const road = buildRoad(lines, roadOptions(roadParams), 1)
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
  const freeCols = Array.from({ length: n + 1 }, (_, i) => i).filter((i) => !bridgeCols.has(i))
  const inner = freeCols.filter((i) => i > 0 && i < n)
  const fi = r.pick(inner.length ? inner : freeCols)
  {
    const x = lineAt(fi), H = 20, FW = 36, z0 = -L / 2 + EDGE + 2, z1 = L / 2 - EDGE - 2
    const id = `Freeway@${x}`
    const deck = buildRoad([[[x, z0], [x, z1]]], { width: FW - 4, walk: 0, lines: 'dashed', lamps: 0, crossings: false }, H)
    parts.push(
      { ...box('Freeway deck', [FW, 2.5, z1 - z0], [x, H - 2.5, (z0 + z1) / 2], PB.concrete, PB.concrete), group: id },
      ...deck.parts.map((q) => ({ ...q, group: id })),
      ...[-1, 1].map((sx): Part => ({ ...box('Freeway barrier', [1, 2.2, z1 - z0], [x + sx * (FW / 2 - 0.5), H, (z0 + z1) / 2], PB.concrete, PB.concrete), group: id })),
    )
    // Pillars between the lanes, on land; over the river the span stands on piers from the bed.
    for (let z = z0 + 20; z < z1 - 10; z += 60) {
      const onRiver = z > zA - 4 && z < zB + 4
      for (const sx of [-1, 1]) {
        const y0 = onRiver ? BED : 1
        parts.push({ ...box('Freeway pillar', [3, H - 2.5 - y0, 3], [x + sx * 6, y0, z], PB.concrete, PB.concrete), group: id })
      }
    }
  }

  // ---- districts: the river splits the city; downtown on one bank by the middle, docks down one end of the other.
  const blocks: Block[] = []
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (j === riverRow) continue
    blocks.push({ i, j, x0: lineAt(i) + C / 2, x1: lineAt(i + 1) - C / 2, z0: lineAt(j) + C / 2, z1: lineAt(j + 1) - C / 2, d: 'park' })
  }
  // Downtown on the bank with more room (−1: the rows before the river).
  const before = riverRow, after = n - 1 - riverRow
  const downSide = before === after ? (r.chance(0.5) ? -1 : 1) : before > after ? -1 : 1
  const downRows = downSide < 0 ? before : after
  const otherRows = downSide < 0 ? after : before
  const sideOf = (b: Block) => (b.j < riverRow ? -1 : 1)
  const rowFromRiver = (b: Block) => (b.j < riverRow ? riverRow - 1 - b.j : b.j - riverRow - 1)
  const u = (b: Block) => flipX * ((b.i + 0.5) / n * 2 - 1) // −1 .. 1 across, flipped per seed
  const centreDist = (b: Block) => Math.hypot((b.i + 0.5) - n / 2, rowFromRiver(b))
  const core = blocks.filter((b) => sideOf(b) === downSide).sort((a, b2) => centreDist(a) - centreDist(b2)).slice(0, n <= 4 ? 2 : n <= 6 ? 4 : 6)
  const coreSet = new Set(core)
  for (const b of blocks) {
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
  const count = (d: DistrictKey) => blocks.filter((b) => b.d === d).length
  const nearCore = blocks.filter((b) => !coreSet.has(b) && core.some((c) => Math.abs(c.i - b.i) + Math.abs(c.j - b.j) === 1) && count(b.d) > 1)
  const spare = nearCore.length ? nearCore : blocks.filter((b) => !coreSet.has(b) && count(b.d) > 1)
  if (spare.length) r.pick(spare).d = 'park'
  for (const b of blocks) if (['suburbs', 'barrio', 'projects'].includes(b.d) && count(b.d) > 2 && r.chance(0.08)) b.d = 'park'

  // ---- fill every block.
  for (const b of blocks) {
    const lot = new Lot(b, r)
    const st = DISTRICTS[b.d]
    parts.push(box(`${st.label} lot`, [b.x1 - b.x0, WALK_H, b.z1 - b.z0], [(b.x0 + b.x1) / 2, 1, (b.z0 + b.z1) / 2], st.lot, PB.concrete, 0, 6))
    const water: Face | null = b.j === riverRow - 1 ? 'pz' : b.j === riverRow + 1 ? 'nz' : null
    switch (b.d) {
      case 'downtown': fillDowntown(lot); break
      case 'chinatown': fillShops(lot, CHINA, ['brick', 'darkbrick', 'beige', 'apartment'], [3, 8]); if (has('lanternstring')) courtyard(lot, ['lanternstring'], 2); break
      case 'redlight': fillShops(lot, VICE, ['darkbrick', 'club', 'plaster', 'brick'], [3, 5], 'nightclub'); break
      case 'projects': fillProjects(lot); break
      // The barrio: close-built row houses and corner shops, two or three storeys.
      case 'barrio': fillHouses(lot, ['rowhouses', 'townhouse', 'bungalow', 'boardedhouse', 'house'].filter(has), 'chainfence', ['tree', 'srtrashbags', 'firebarrel'], [2, 6], [2, 6]); for (const f of FACES) infill(lot, f, ['plaster', 'beige', 'shop', 'brick'], [2, 3], [20, 28], 6); break
      case 'suburbs': fillHouses(lot, ['suburbhouse', 'bungalow', 'house'].filter(has), 'picketfence', ['tree', 'tree', 'backyard']); break
      case 'highend': fillHouses(lot, ['crib', 'suburbhouse', 'penthouse', 'townhouse'].filter(has), 'hedge', ['palmtall', 'palm', 'palmcluster', 'tree'], [18, 26], [10, 16]); break
      case 'docks': fillDocks(lot, water); break
      case 'industrial': fillIndustrial(lot); break
      case 'park': fillPark(lot); break
    }
    parts.push(...lot.parts)
    parts.push(...sidewalk(b, st, r))
  }

  // ---- parked cars along the kerbs, clear of the junctions.
  const lane = ST / 2 - 2.2
  const colours = ['#a8322b', '#2f5f8f', '#d8d4cc', '#2a2a2e', '#c9a23a', '#3f7a3a', '#7a7f86', '#5a3a6a']
  for (const b of blocks) {
    const per = DISTRICTS[b.d].cars
    for (const f of FACES) {
      if (!r.chance(Math.min(1, per / 2))) continue
      const s = side(b, f)
      const a = r.range(s.from + 14, s.to - 14)
      // The kerb lane beside this block.
      const kerb = s.edge - s.inward * (WK + (ST / 2 - lane))
      const [x, z] = s.along === 'x' ? [a, kerb] : [kerb, a]
      parts.push(car(+x.toFixed(2), +z.toFixed(2), (s.along === 'x' ? 90 : 0) + r.pick([0, 180]), r.pick(colours), r.int(1, 99)))
    }
  }

  // ---- markers: on the streets (open by construction), spread over the city.
  const pool: Vec3[] = []
  for (let k = 0; k <= n; k++) for (let i = 0; i < n; i++) {
    const z = lineAt(k)
    for (const f of [0.3, 0.5, 0.7]) pool.push([+(lineAt(i) + PITCH * f).toFixed(1), 1, z])
  }
  for (let i = 0; i <= n; i++) for (let k = 0; k < n; k++) {
    if (k === riverRow && !bridgeCols.has(i)) continue
    for (const f of [0.3, 0.5, 0.7]) pool.push([lineAt(i), 1, +(lineAt(k) + PITCH * f).toFixed(1)])
  }
  const spread = (from: Vec3[], count: number, taken: Vec3[]) => {
    const out: Vec3[] = [], all = [...taken]
    while (out.length < count) {
      let best = -1, bestD = -1
      from.forEach((p, i) => { const d = all.length ? Math.min(...all.map((q) => Math.hypot(q[0] - p[0], q[2] - p[2]))) : r.next(); if (d > bestD) { bestD = d; best = i } })
      if (best < 0 || (all.length && bestD < 12)) break
      out.push(from[best]); all.push(from[best])
    }
    return out
  }
  const red = spread(pool.filter((p) => p[2] <= lineAt(0) + 1), 6, [])
  const blue = spread(pool.filter((p) => p[2] >= lineAt(n) - 1), 6, [])
  const shared = spread(pool, 16, [...red, ...blue])
  const weapons = spread(pool, 20, [...red, ...blue, ...shared])
  const drops = spread(pool.filter((p) => Math.abs(p[0]) < L / 3 && Math.abs(p[2]) < L / 3), 4, [...red, ...blue])
  const guns = ['ak47', 'pump_action_shotgun', 'tec9', 'sniper_rifle', 'mac10', 'pipe_bomb', 'molotov', 'magnum', 'rpg_launcher', 'beretta']
  const look = (p: Vec3) => +((Math.atan2(-p[0], p[2]) * 180) / Math.PI).toFixed(1)
  const markers: MarkerSpec[] = [
    ...red.map((p): MarkerSpec => ['Red team spawn', p, { yaw: 180 }]),
    ...blue.map((p): MarkerSpec => ['Blue team spawn', p, { yaw: 0 }]),
    ...shared.map((p): MarkerSpec => ['Shared spawn', p, { yaw: look(p) }]),
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
    description: `A Stilwater-style ${CITY_SIZES[o.size].label.toLowerCase()} built from the site's own pieces: districts, a river with bridges, streets with sidewalks and lamps (seed ${o.seed}).`,
    parts, markers, lights,
  }
}

/** Street furniture along a block's sidewalks, set back from the corners and the kerb; signs and lights at the corners. */
function sidewalk(b: Block, st: DistrictStyle, r: Rng): Part[] {
  const out: Part[] = []
  // Corners: a street-name sign on most, traffic lights downtown and in the busy districts.
  const busy = b.d === 'downtown' || b.d === 'chinatown' || b.d === 'redlight'
  for (const [cx, cz, face] of [[b.x0, b.z0, 'nz'], [b.x1, b.z0, 'nz'], [b.x0, b.z1, 'pz'], [b.x1, b.z1, 'pz']] as const) {
    const ox = cx === b.x0 ? -2.2 : 2.2, oz = cz === b.z0 ? -2.2 : 2.2
    const key = busy && r.chance(0.5) && has('trafficlight') ? 'trafficlight' : has('srstreetname') && r.chance(0.6) ? 'srstreetname' : null
    if (key) out.push(...placeAt(key, prefabParams(ALL_PREFABS[key]), cx + ox, cz + oz, face as Face, LOT_Y))
  }
  const keys = st.props.filter(has)
  if (!keys.length) return out
  for (const f of FACES) {
    const s = side(b, f)
    for (let a = s.from + 9; a < s.to - 9; a += st.propEvery * r.range(0.7, 1.3)) {
      const key = r.pick(keys)
      const params = vary(key, r, ['n', 'color', 'size', 'type'])
      const [w, d] = turned(footprint(key, params), ROT[f])
      // On the sidewalk, a step out from the lot edge.
      const out1 = 1.2 + (s.along === 'x' ? d : w) / 2
      const pos = s.edge - s.inward * out1
      const [x, z] = s.along === 'x' ? [a, pos] : [pos, a]
      out.push(...placeAt(key, params, x, z, f, LOT_Y))
    }
  }
  return out
}
