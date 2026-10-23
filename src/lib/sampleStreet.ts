// Street dressing for the city maps: everything goes where it would be in a
// real street, not just where there is room. Machines, benches, bins and
// dumpsters stand with their backs to a wall and face out; hydrants, meters,
// mailboxes and bus stops line the kerb facing the road; cars park along the
// kerb with it on their right (traffic keeps right), nose to tail; signals
// stand on the corners of junctions with their arms over the lanes and their
// lights toward the drivers they stop; drains sit in the gutter and manholes
// and puddles in the road; dishes and air handlers go on roofs; power lines
// run pole to pole. Nothing blocks a door, a walkway, a spawn or a pickup,
// and every piece gets a twin turned 180° on blue's half.
import type { Vec3 } from './project'
import type { Part, Sample, Tex } from './sampleKit'
import { ALL_PREFABS } from './prefabRegistry'
import { CAR_COLORS, group, prefabParams, tagPrefab, type Params } from './prefabs'
import { Space, isFlat, penetration, top, turnBy, yOverlap } from './sampleSpace'
import { ROAD_SURFACES } from './urbanKit'
import { candidates } from './samplePopulate'

export type Where = 'wall' | 'front' | 'side' | 'kerb' | 'verge' | 'park' | 'gutter' | 'road' | 'open' | 'roof' | 'signal' | 'poles'

/** Where each piece belongs (anything else goes in the open). How far it sits off its wall or kerb comes from its size. */
const PLACE: Record<string, Where> = {
  vending: 'wall', phone: 'wall', airpump: 'wall', propanecage: 'wall', bench: 'wall', noticeboard: 'wall', candles: 'wall',
  atm: 'front', icemachine: 'front', cafe: 'front', produce: 'front', fruitcrates: 'front',
  tirerack: 'side', dumpster: 'side', trashbags: 'side', bins: 'side', pallets: 'side', cratestack: 'side', barrels: 'side', generator: 'side', acunit: 'side',
  portapotty: 'side', posters: 'side', graffiti: 'side', fishcrates: 'side', fishnet: 'side', buoys: 'side', sleepers: 'side', relaybox: 'side',
  hydrant: 'kerb', meters: 'kerb', trashcan: 'kerb', mailbox: 'kerb', newsbox: 'kerb', busstop: 'kerb', busstopsign: 'kerb', streetsign: 'kerb', bikerack: 'kerb',
  bollardrow: 'kerb', lifering: 'kerb', bollards: 'kerb', postbox: 'verge',
  stormdrain: 'gutter', manhole: 'road', puddle: 'road', litter: 'road', barricade: 'road',
  roofac: 'roof', billboard: 'roof', antenna: 'roof', satdish: 'roof',
  signal: 'signal', utilitypole: 'poles',
}
/** A bus shelter stands back from the kerb so its roof doesn't hang over the road. */
const KERB_BACK: Record<string, number> = { busstop: 2.3 }
/** Prefabs whose walls things can stand against (homes, sheds, containers). */
const WALLISH = new Set(['trailerhome', 'house', 'garage', 'diner', 'kiosk', 'containers'])
/** Flat on a wall: placed flush, needing no room in front. */
const DECALS = new Set(['posters', 'graffiti'])
const VEHICLES = new Set(['car', 'taxi', 'policecar', 'van', 'pickup', 'boxtruck', 'schoolbus', 'citybus', 'foodtruck', 'cementmixer'])

const key = (t: Tex) => JSON.stringify(t)
const isFlatPaint = (p: Part) => p.size[1] <= 0.05
const ROADS = new Set(ROAD_SURFACES.map(key))
const isRoad = (p: Part | null) => !!p && ROADS.has(key(p.top))
const deg = (x: number, z: number) => +((Math.atan2(x, z) * 180) / Math.PI).toFixed(1)
const norm = (r: number) => +(((r % 360) + 360) % 360).toFixed(1)
const onRed = (x: number, z: number) => z < -0.01 || (Math.abs(z) <= 0.01 && x < -0.01)

interface Spot { x: number; y: number; z: number; rot: number; /** For runs along an edge: the edge direction. */ along?: [number, number]; edge?: number }
interface Entry { key: string; n: number; where: Where }

/** "key", "key*3" (pairs) or "key@kerb*2" (somewhere else than usual). */
function parse(list: string[]): Entry[] {
  return list.map((s) => {
    const m = /^([a-z]+)(?:@([a-z]+))?(?:\*(\d+))?$/.exec(s)
    if (!m || !ALL_PREFABS[m[1]]) return null
    const where = (m[2] as Where) ?? (VEHICLES.has(m[1]) ? 'park' : PLACE[m[1]] ?? 'open')
    return { key: m[1], n: m[3] ? +m[3] : 1, where }
  }).filter((e): e is Entry => !!e)
}

/** Footprint of a prefab at rot 0: half width (x), half depth (z), and the farthest reach. */
const extents = new Map<string, { hx: number; hz: number; r: number }>()
function extent(k: string) {
  let e = extents.get(k)
  if (!e) {
    let hx = 0, hz = 0, r = 0
    for (const p of ALL_PREFABS[k].make(0, 0, 0, 1)) {
      const t = ((p.rot ?? 0) * Math.PI) / 180
      const ex = Math.abs(Math.cos(t)) * p.size[0] / 2 + Math.abs(Math.sin(t)) * p.size[2] / 2
      const ez = Math.abs(Math.sin(t)) * p.size[0] / 2 + Math.abs(Math.cos(t)) * p.size[2] / 2
      hx = Math.max(hx, Math.abs(p.at[0]) + ex); hz = Math.max(hz, Math.abs(p.at[2]) + ez)
      r = Math.max(r, Math.hypot(Math.abs(p.at[0]) + ex, Math.abs(p.at[2]) + ez))
    }
    e = { hx, hz, r }
    extents.set(k, e)
  }
  return e
}

/** Settings for the i-th copy of a prefab: colors and looks cycle so a row of cars isn't all one paint. */
function paramsFor(k: string, i: number, seed: number): Params {
  const def = ALL_PREFABS[k]
  const p = prefabParams(def)
  for (const d of def.params ?? []) {
    if (d.key === 'color' && d.options) p.color = d.options[(i * 3 + seed) % d.options.length][0]
    if (d.key === 'look') p.look = (i + seed) % 6
  }
  if (k === 'car') p.color = CAR_COLORS[(i * 5 + seed) % CAR_COLORS.length][0]
  return p
}

export interface StreetOptions { list: string[] }

export function dressStreets(s: Sample, o: StreetOptions): Sample {
  const entries = parse(o.list)
  if (!entries.length) return s
  const parts: Part[] = [...s.parts]
  const space = new Space(parts)
  const markers = s.markers.map(([t, p]) => ({ t, p }))
  const placed: { x: number; z: number; y: number; key: string }[] = []

  // ---- what the map gives to place against ----
  const shops = parts.filter((p) => p.prefab?.key === 'shop' && p.kind === 'box' && p.size[0] === +p.prefab.params.w && p.size[2] === +p.prefab.params.d && p.size[1] === +p.prefab.params.h)
  const shopFront = new Map(shops.map((p) => [p, String(p.prefab!.params.front)]))
  const FACE: Record<string, [number, number]> = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] }
  // Doors stay clear: a zone 7 wide and 5 deep in front of each building's door.
  const doors: Part[] = shops.map((p) => {
    const [nx, nz] = FACE[shopFront.get(p)!], depth = nx ? p.size[0] : p.size[2]
    return { label: 'Door zone', kind: 'box', size: [7, 5, 5], at: [p.at[0] + nx * (depth / 2 + 2.5), p.at[1], p.at[2] + nz * (depth / 2 + 2.5)], rot: nx ? 90 : 0, top: p.top, side: p.side }
  })

  // Faces of walls and buildings, walked along in steps.
  const walls = parts.filter((p) => p.kind === 'box' && !isFlat(p) && p.size[1] >= 2.5 && !p.water && Math.max(p.size[0], p.size[2]) >= 4
    && (shopFront.has(p) || !p.group || WALLISH.has(p.prefab?.key ?? '') || p.label === 'House') && !/^(Ground|Sidewalk|Platform|Median|Island|Pier|Floor|Low deck|High deck|Walkway|Footbridge|Bridge|Stage|Portico|Loading dock|Station platform|Concourse)/.test(p.label))
  const faces: { part: Part; kind: 'front' | 'side'; spots: (back: number) => Spot[] }[] = []
  for (const p of walls) {
    for (const [lx, lz] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as [number, number][]) {
      const [nx, nz] = turnBy(lx, lz, p.rot ?? 0)
      const len = lx ? p.size[2] : p.size[0], depth = lx ? p.size[0] : p.size[2]
      const front = shopFront.get(p)
      const kind = front && FACE[front][0] === Math.round(nx) && FACE[front][1] === Math.round(nz) ? 'front' : 'side'
      faces.push({
        part: p, kind, spots: (back) => {
          const out: Spot[] = []
          for (let a = -len / 2 + 2; a <= len / 2 - 2; a += 2.5) {
            const [ax, az] = turnBy(lz ? a : 0, lx ? a : 0, p.rot ?? 0)
            const x = p.at[0] + ax + nx * (depth / 2 + back), z = p.at[2] + az + nz * (depth / 2 + back)
            if (!onRed(x, z)) continue
            const f = space.floorAt(x, z, Math.max(p.at[1], 1) + 1)
            if (!Number.isFinite(f.y) || f.by?.water) continue
            out.push({ x, y: f.y, z, rot: deg(nx, nz) })
          }
          return out
        },
      })
    }
  }

  // Kerb edges: raised sidewalks, platforms and islands with a drop beyond (and whether the drop is a road).
  interface Edge { id: number; a: [number, number]; b: [number, number]; n: [number, number]; y: number; road: boolean; width: number; median?: boolean; label?: string }
  const edges: Edge[] = []
  const kerbs = parts.filter((p) => p.kind === 'box' && /^(Sidewalk|Platform|Median|Island|Station platform|Quay|Bank|Pier|Loading dock)$/.test(p.label) && p.size[1] <= 4)
  for (const p of kerbs) {
    for (const [lx, lz] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as [number, number][]) {
      const [nx, nz] = turnBy(lx, lz, p.rot ?? 0)
      const len = lx ? p.size[2] : p.size[0], depth = lx ? p.size[0] : p.size[2]
      const [ax, az] = turnBy(lz ? len / 2 : 0, lx ? len / 2 : 0, p.rot ?? 0)
      const cx = p.at[0] + nx * depth / 2, cz = p.at[2] + nz * depth / 2
      // Looked at in a few places along it (a bridge or a building can meet it at one point):
      // a drop to a floor beyond, not the map's edge or a wall right there, and how wide the road is out to the next raised thing.
      let road = false, ok = false
      const widths: number[] = []
      for (const f of [-0.35, -0.15, 0, 0.15, 0.35]) {
        const sx = cx + ax * 2 * f + nx * 1.2, sz = cz + az * 2 * f + nz * 1.2
        const mid = space.floorAt(sx, sz, top(p) + 0.05)
        if (!Number.isFinite(mid.y) || !(mid.y < top(p) - 0.15) || space.solidAt(sx, mid.y + 1.2, sz)) continue
        ok = true
        road ||= isRoad(mid.by)
        let d = 2
        for (; d < 40; d += 1) {
          const fl = space.floorAt(sx + nx * (d - 1.2), sz + nz * (d - 1.2), top(p) + 6)
          if (fl.y > mid.y + 0.2 || space.solidAt(sx + nx * (d - 1.2), mid.y + 1.2, sz + nz * (d - 1.2))) break
        }
        widths.push(d)
      }
      if (!ok) continue
      // The usual width (a car or bus in the road somewhere doesn't make it a lane).
      const width = widths.sort((m, n) => m - n)[widths.length >> 1]
      edges.push({ id: edges.length, a: [cx - ax, cz - az], b: [cx + ax, cz + az], n: [nx, nz], y: top(p), road, width, median: /Median|Island/.test(p.label) })
    }
  }
  /** Spots along an edge, `out` units beyond it (negative: back over the raised side), on the floor there. */
  const alongEdge = (e: Edge, out: number, step: number, end = 1.5): Spot[] => {
    const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]), u: [number, number] = [(e.b[0] - e.a[0]) / len, (e.b[1] - e.a[1]) / len]
    const res: Spot[] = []
    for (let t = end; t <= len - end; t += step) {
      const x = e.a[0] + u[0] * t + e.n[0] * out, z = e.a[1] + u[1] * t + e.n[1] * out
      if (!onRed(x, z)) continue
      // Beyond a kerb is the lower road; beyond a road strip's edge is the verge, level with it.
      const verge = e.id >= 1000
      const f = space.floorAt(x, z, verge ? e.y + 0.2 : out > 0 ? e.y - 0.1 : e.y + 0.05)
      if (!Number.isFinite(f.y) || (verge && out > 0 && space.floorAt(x, z, e.y + 0.2, isFlatPaint).by?.label === e.label)) continue
      // Right here the kerb drops to open floor (not a wall or a building's foot).
      if (!verge) {
        const bx = e.a[0] + u[0] * t + e.n[0] * 1.2, bz = e.a[1] + u[1] * t + e.n[1] * 1.2, below = space.floorAt(bx, bz, e.y - 0.1)
        if (!Number.isFinite(below.y) || space.solidAt(bx, below.y + 1.2, bz)) continue
      }
      res.push({ x, y: f.y, z, rot: deg(e.n[0], e.n[1]), along: u, edge: e.id })
    }
    return res
  }
  // Road edges where a strip of road lies on other ground (no kerb): the verge is the ground beside it.
  const strips = parts.filter((p) => isRoad(p) && p.size[1] <= 0.13 && p.label !== 'Ground' && p.kind === 'box')
  const verges: Edge[] = []
  for (const p of strips) {
    for (const [lx, lz] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as [number, number][]) {
      const [nx, nz] = turnBy(lx, lz, p.rot ?? 0)
      const len = lx ? p.size[2] : p.size[0], depth = lx ? p.size[0] : p.size[2]
      const [ax, az] = turnBy(lz ? len / 2 : 0, lx ? len / 2 : 0, p.rot ?? 0)
      const cx = p.at[0] + nx * depth / 2, cz = p.at[2] + nz * depth / 2
      // Beside it: ground that isn't this road (a verge, or a lot paved differently).
      const other = (b: { y: number; by: Part | null }) => Number.isFinite(b.y) && !!b.by && (!isRoad(b.by) || key(b.by.top) !== key(p.top))
      const beyond = [-0.35, -0.15, 0, 0.15, 0.35].map((f) => space.floorAt(cx + ax * 2 * f + nx * 1.5, cz + az * 2 * f + nz * 1.5, top(p) + 0.4)).find(other)
      if (!beyond) continue
      verges.push({ id: 1000 + verges.length, a: [cx - ax, cz - az], b: [cx + ax, cz + az], n: [nx, nz], y: beyond.y, road: true, width: depth, label: p.label })
    }
  }

  // ---- checks every piece must pass ----
  // Room to use what faces the street: in front of benches, machines and shelters already there.
  const FACING = /^(bench|busstop|vending|atm|phone|newsbox|icemachine|kiosk|cafe|shelter back|ticket booth|merch stand|food cart|news stand)$/i
  const frontZone = (at: Vec3, rot: number, depth: number): Part => {
    const [ox, oz] = turnBy(0, depth + 1.4, rot)
    return { label: 'Front zone', kind: 'box', size: [3, 3, 2.8], at: [at[0] + ox, at[1], at[2] + oz], rot, top: WIRE, side: WIRE }
  }
  const seenFacing = new Set<string>()
  for (const p of parts) {
    const k = p.prefab?.key ?? p.group?.split('@')[0] ?? p.label
    if (!FACING.test(k) || seenFacing.has(p.group ?? String(parts.indexOf(p)))) continue
    seenFacing.add(p.group ?? String(parts.indexOf(p)))
    doors.push(frontZone(p.prefab?.at ?? p.at, p.prefab?.rot ?? p.rot ?? 0, k === 'Shelter back' ? 1.6 : 0.8))
  }
  const zones = new Space(doors)
  const teamSpawn = (t: string) => t === 'Red team spawn' || t === 'Blue team spawn'
  const clearOfMarkers = (x: number, y: number, z: number, r: number) =>
    markers.every(({ t, p }) => Math.abs(p[1] - y) > 3 || Math.hypot(p[0] - x, p[2] - z) > r + (teamSpawn(t) ? 5 : 2))
  const level = (made: Part[], y: number) => made.every((p) => p.at[1] > y + 0.5 || (isFlat(p) && p.at[1] > y + 0.05) || [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]].every(([a, b]) => {
    const [ox, oz] = turnBy(a * p.size[0] / 2 * 0.9, b * p.size[2] / 2 * 0.9, p.rot ?? 0)
    return Math.abs(space.floorAt(p.at[0] + ox, p.at[2] + oz, y + 0.3).y - y) < 0.06
  }))
  const blocksDoor = (made: Part[]) => made.some((p) => !isFlat(p) && zones.around(p).some((d) => yOverlap(p, d) > 0 && penetration(p, d) > 0))
  /** Room to walk: `need` units clear in front (or behind) of the piece. */
  const walkway = (sp: Spot, from: number, need: number, sign = 1) => {
    for (let d = from; d <= from + need; d += 0.8) for (const sx of [-1, 0, 1]) {
      const [ox, oz] = turnBy(sx, sign * d, sp.rot)
      if (space.solidAt(sp.x + ox, sp.y + 1.2, sp.z + oz) || space.floorAt(sp.x + ox, sp.z + oz, sp.y + 0.4).y < sp.y - 0.4) return false
    }
    return true
  }
  const spread = (sp: Spot, k: string) => {
    let d = Infinity
    for (const q of placed) { const e = Math.hypot(q.x - sp.x, q.z - sp.z) * (q.key === k ? 0.5 : 1); if (e < d) d = e }
    for (const { p } of markers) { const e = Math.hypot(p[0] - sp.x, p[2] - sp.z) + 4; if (e < d) d = e }
    return Math.min(d, Math.hypot(2 * sp.x, 2 * sp.z))
  }

  const make = (k: string, sp: Spot, params: Params) => {
    const def = ALL_PREFABS[k]
    const at: Vec3 = [+sp.x.toFixed(2), +sp.y.toFixed(3), +sp.z.toFixed(2)]
    const tw: Vec3 = [-at[0], at[1], -at[2]], tr = norm(sp.rot + 180)
    return [tagPrefab(def.make(at[0], at[2], norm(sp.rot), at[1], params), k, params, at, norm(sp.rot)), tagPrefab(def.make(tw[0], tw[2], tr, tw[1], params), k, params, tw, tr)]
  }
  const commit = (pair: Part[][], k: string, sp: Spot) => {
    for (const ps of pair) for (const p of ps) { parts.push(p); space.add(p) }
    if (FACING.test(k)) for (const ps of pair) zones.add(frontZone(ps[0].prefab!.at, ps[0].prefab!.rot, extent(k).hz))
    placed.push({ x: sp.x, z: sp.z, y: sp.y, key: k }, { x: -sp.x, z: -sp.z, y: sp.y, key: k })
  }
  const flat = (k: string) => ALL_PREFABS[k].make(0, 0, 0, 1).every((p) => isFlat(p) || p.size[1] <= 0.2)

  /** Tries spots best-spread first; places a pair at the first that passes. */
  const tryPlace = (k: string, spots: Spot[], i: number, opts: { gap?: number; front?: number; behind?: number; minSpread?: number } = {}) => {
    const thin = flat(k), r = extent(k).r
    spots = spots.filter((sp) => Math.hypot(2 * sp.x, 2 * sp.z) > 2 * r + 1)
    const ranked = spots.map((sp) => [spread(sp, k), sp] as const).filter(([d]) => d >= (opts.minSpread ?? 0)).sort((a, b) => b[0] - a[0])
    for (const [, sp] of ranked.slice(0, 220)) {
      if (!thin && !clearOfMarkers(sp.x, sp.y, sp.z, r)) continue
      const params = paramsFor(k, i, Math.abs(Math.round(sp.x + sp.z)))
      const pair = make(k, sp, params)
      if (!thin && !pair.every((ps) => space.fits(ps, opts.gap ?? 0.35))) continue
      // Paint-thin pieces only keep off each other (and crosswalks) on the same floor.
      if (thin && !pair.every((ps) => ps.every((p) => space.around(p).every((q) => !isFlat(q) || q.at[1] < p.at[1] - 0.01 || penetration(p, q) <= 0)))) continue
      if (!pair.every((ps) => level(ps, sp.y)) || pair.some(blocksDoor)) continue
      // Posters and tags need a wall right behind them, all the way across.
      if (DECALS.has(k) && !pair.every((ps) => ps.every((p) => [-0.5, 0, 0.5].every((f) => {
        const [bx, bz] = turnBy(f * p.size[0], -0.12, p.rot ?? 0), [fx, fz] = turnBy(f * p.size[0], 0.15, p.rot ?? 0)
        const y = p.at[1] + p.size[1] / 2
        return !!space.solidAt(p.at[0] + bx, y, p.at[2] + bz) && !space.solidAt(p.at[0] + fx, y, p.at[2] + fz)
      })))) continue
      if (opts.front && !walkway(sp, extent(k).hz + 0.3, opts.front)) continue
      if (opts.behind && !walkway(sp, extent(k).hz + 0.3, opts.behind, -1)) continue
      commit(pair, k, sp)
      return true
    }
    return false
  }

  // ---- spots for each kind of place ----
  // Kerbside clutter lines sidewalks and platforms, not the strip of a median.
  const kerbSpots = (back: number) => edges.filter((e) => !e.median).flatMap((e) => alongEdge(e, -back, 2.5))
  const vergeSpots = (back: number) => verges.flatMap((e) => alongEdge(e, back, 3).map((sp) => ({ ...sp, rot: norm(sp.rot + 180) })))
  /** Computed once: later checks see what has been placed since. */
  const once = <T,>(f: () => T) => { let v: T | undefined; return () => (v ??= f()) }
  const roadSpots = once(() => {
    const out: Spot[] = []
    const xs = parts.flatMap((p) => [p.at[0] - p.size[0] / 2, p.at[0] + p.size[0] / 2]), zs = parts.flatMap((p) => [p.at[2] - p.size[2] / 2, p.at[2] + p.size[2] / 2])
    for (let x = Math.ceil(Math.min(...xs) / 5) * 5; x <= Math.max(...xs); x += 5) for (let z = Math.ceil(Math.min(...zs) / 5) * 5; z <= 0; z += 5) {
      if (!onRed(x, z)) continue
      const f = space.floorAt(x, z, 3)
      if (!isRoad(f.by) || space.solidAt(x, f.y + 1, z) || space.near(x, z).some((q) => q.label === 'Crosswalk' && Math.hypot(q.at[0] - x, q.at[2] - z) < 4)) continue
      out.push({ x, y: f.y, z, rot: ((x * 7 + z * 3) % 4) * 90 })
    }
    return out
  })
  // Not on a road (paint like a crosswalk doesn't count as the floor).
  const openSpots = once(() => candidates({ ...s, parts }).filter((p) => onRed(p[0], p[2]) && !isRoad(space.floorAt(p[0], p[2], p[1] + 0.05, isFlatPaint).by))
    .map((p): Spot => {
      // Face away from the nearest wall within reach, else along the grid.
      let best = 0, bestD = 9
      for (let a = 0; a < 360; a += 90) for (let d = 1; d < 8; d += 1) {
        const [ox, oz] = turnBy(0, -d, a)
        if (space.solidAt(p[0] + ox, p[1] + 1.2, p[2] + oz)) { if (d < bestD) { bestD = d; best = a } break }
      }
      return { x: p[0], y: p[1], z: p[2], rot: best }
    }))
  const roofSpots = (back: number) => shops.flatMap((p) => {
    const y = top(p), out: Spot[] = []
    for (const [lx, lz] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as [number, number][]) {
      const len = lx ? p.size[2] : p.size[0], depth = lx ? p.size[0] : p.size[2]
      for (let a = -len / 2 + 3; a <= len / 2 - 3; a += 3) {
        const x = p.at[0] + (lz ? a : lx * (depth / 2 - back)), z = p.at[2] + (lx ? a : lz * (depth / 2 - back))
        if (onRed(x, z)) out.push({ x, y, z, rot: deg(lx, lz) })
      }
    }
    return out
  })

  // ---- placing, in the map's order ----
  let index = 0
  for (const e of entries) {
    const k = e.key, decal = DECALS.has(k), hz = extent(k).hz
    for (let n = 0; n < e.n; n++, index++) {
      let ok = false
      if (e.where === 'wall' || e.where === 'front' || e.where === 'side') {
        // Backed up to the wall: a little off it, more on a shop front (its windows stand proud).
        const want = e.where === 'wall' ? null : e.where
        const back = (f: { kind: string }) => (decal ? 0 : hz + (f.kind === 'front' ? 0.5 : 0.2))
        const spots = (fs: typeof faces) => fs.flatMap((f) => f.spots(back(f)))
        const opts = decal ? { gap: -0.01 } : { gap: 0.1, front: 2.4 }
        ok = tryPlace(k, spots(faces.filter((f) => !want || f.kind === want)), index, opts)
        if (!ok && want && !decal) ok = tryPlace(k, spots(faces), index, opts)
      } else if (e.where === 'kerb') {
        const back = Math.max(KERB_BACK[k] ?? 0, hz + 0.4)
        ok = tryPlace(k, kerbSpots(back), index, { gap: 0.3, behind: 3 }) || tryPlace(k, vergeSpots(back), index, { gap: 0.3 })
      } else if (e.where === 'verge') {
        const back = hz + 0.8
        ok = tryPlace(k, vergeSpots(back), index, { gap: 0.3 }) || tryPlace(k, kerbSpots(back), index, { gap: 0.3, behind: 3 })
      } else if (e.where === 'gutter') {
        ok = tryPlace(k, edges.filter((g) => g.road).flatMap((g) => alongEdge(g, hz + 0.02, 2.5, 4)), index)
      } else if (e.where === 'road') {
        ok = tryPlace(k, roadSpots(), index, { gap: 0.6 })
      } else if (e.where === 'open') {
        ok = tryPlace(k, openSpots(), index, { gap: 0.8, front: 1.5, minSpread: 6 })
      } else if (e.where === 'roof') {
        ok = tryPlace(k, roofSpots(hz + 1.2), index, { gap: 0.3 })
      } else if (e.where === 'park') {
        // Along a kerb with the road beyond, kerb on the car's right: heading atan2(−nz, nx).
        const hw = extent(k).hx
        const spots = [...edges.filter((g) => g.road && g.width >= 12 && !g.median), ...verges].flatMap((g) => alongEdge(g, (g.id >= 1000 ? -1 : 1) * (hw + 0.6), 2.5, 7)
          .map((sp) => {
            const [nx, nz] = g.id >= 1000 ? [-g.n[0], -g.n[1]] : g.n
            return { ...sp, rot: norm((Math.atan2(-nz, nx) * 180) / Math.PI) }
          }))
          .filter((sp) => !parts.some((q) => (q.label === 'Crosswalk' && Math.hypot(q.at[0] - sp.x, q.at[2] - sp.z) < 9) || ((q.prefab?.key === 'hydrant' || q.prefab?.key === 'busstop') && Math.hypot(q.at[0] - sp.x, q.at[2] - sp.z) < 7)))
        ok = tryPlace(k, spots, index, { gap: 0.5 })
      } else if (e.where === 'signal') {
        ok = placeSignal()
      } else if (e.where === 'poles') {
        ok = placePoles(e.n)
        n = e.n
      }
      if (!ok) break
    }
  }

  /** A signal on a junction corner: arm over the lanes beyond one kerb, lights toward the drivers approaching the crossing. */
  function placeSignal(): boolean {
    const spots: (Spot & { len: number })[] = []
    for (const a of edges) for (const b of edges) {
      if (a === b || !a.road || !b.road || Math.abs(a.n[0] * b.n[0] + a.n[1] * b.n[1]) > 0.1 || a.width > 36 || b.width > 36 || a.width < 10 || b.width < 10) continue
      // The corner a and b share; b must point the way drivers along a are going: t(a) = (−nz, nx).
      const t: [number, number] = [-a.n[1], a.n[0]]
      if (Math.hypot(b.n[0] - t[0], b.n[1] - t[1]) > 0.1) continue
      const corner = [a.a, a.b].find((c) => [b.a, b.b].some((d) => Math.hypot(c[0] - d[0], c[1] - d[1]) < 0.5))
      if (!corner) continue
      const x = corner[0] - a.n[0] * 1.2 - b.n[0] * 1.2, z = corner[1] - a.n[1] * 1.2 - b.n[1] * 1.2
      if (!onRed(x, z)) continue
      spots.push({ x, y: a.y, z, rot: deg(a.n[0], a.n[1]), len: Math.max(5, Math.min(10, a.width * 0.55)) })
    }
    for (const sp of spots.sort((p, q) => spread(q, 'signal') - spread(p, 'signal'))) {
      const params = { len: +sp.len.toFixed(1) }
      if (!clearOfMarkers(sp.x, sp.y, sp.z, 1.5)) continue
      const pair = make('signal', sp, params)
      if (!pair.every((ps) => space.fits(ps.filter((p) => p.at[1] < sp.y + 4), 0.2) && space.fits(ps.filter((p) => p.at[1] >= sp.y + 4), 0))) continue
      commit(pair, 'signal', sp)
      return true
    }
    return false
  }

  /** A run of utility poles along the longest open kerb or verge, wired pole to pole. */
  function placePoles(count: number): boolean {
    const runs = [...edges, ...verges].map((e) => ({ e, len: Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) })).sort((p, q) => q.len - p.len)
    for (const { e } of runs) {
      const out = e.id >= 1000 ? 1.2 : -1.0
      const spots = alongEdge(e, out, 2, 3)
      if (spots.length < 2) continue
      const chosen: Spot[] = []
      for (const sp of spots) {
        if (chosen.length >= count) break
        const last = chosen[chosen.length - 1]
        if (last && Math.hypot(sp.x - last.x, sp.z - last.z) < 24) continue
        const pole = { ...sp, rot: deg(sp.along![0], sp.along![1]) }
        if (!clearOfMarkers(pole.x, pole.y, pole.z, 1)) continue
        const pair = make('utilitypole', pole, {})
        if (!pair.every((ps) => space.fits(ps, 0.3)) || pair.some(blocksDoor)) continue
        // Wires to the last pole, along the run, at the insulator tips.
        if (last) {
          const dx = pole.x - last.x, dz = pole.z - last.z, len = Math.hypot(dx, dz)
          const wires: Part[] = [-2, 0, 2].map((off) => {
            const [ox, oz] = turnBy(off, 0, pole.rot)
            return { label: 'Power line', kind: 'box', size: [0.08, 0.08, len], at: [(pole.x + last.x) / 2 + ox, pole.y + 15.42, (pole.z + last.z) / 2 + oz], rot: pole.rot, top: WIRE, side: WIRE, tile: 4 }
          })
          const twin = wires.map((w): Part => ({ ...w, at: [-w.at[0], w.at[1], -w.at[2]], rot: norm((w.rot ?? 0) + 180) }))
          if (!space.fits(wires, 0)) break
          const id = `Power lines@${last.x.toFixed(1)},${last.z.toFixed(1)}`
          for (const w of [...group(id, wires), ...group(id + '~', twin)]) { parts.push(w); space.add(w) }
        }
        commit(pair, 'utilitypole', pole)
        chosen.push(pole)
      }
      if (chosen.length >= 2) return true
    }
    return false
  }

  return { ...s, parts }
}

const WIRE: Tex = { gen: 'tiles', tweak: { color: '#1d1d20', accent: '#141416', scale: 1, wear: 0, seed: 461 }, surface: 15 }
