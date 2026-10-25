// Detail pass for sample maps: plain blocks become real-looking pieces.
// - Building blocks become generated buildings (storefront, windows by floor,
//   ledges, cornice, parapet, rooftop clutter, fire escapes), styled after the
//   wall texture the map gave them. The shop front goes on the side that opens
//   onto the most room (a street or square, not an alley, a wall or the map
//   edge) and the fire escape on an open side beside it.
// - Car, bus, bench and dumpster boxes become their prefabs.
// - Small cover gets softened (beveled) edges; paintball bunkers get the
//   rounded look of inflatables.
import type { Part, Sample, Tex } from './sampleKit'
import { CY, PB } from './sampleKit'
import { ROAD_SURFACES, U } from './urbanKit'
import { bench, building, car, dumpster, group, tagPrefab, type Style } from './prefabs'
import { box, lying, turn } from './sampleKit'
import { Space, corners, turnBy } from './sampleSpace'
import { facadeLife } from './prefabsUrbanLife'

const HUB: Tex = { gen: 'metal_plate', tweak: { color: '#b9bcc0', accent: '#8d9094', scale: 1, wear: 0, seed: 336 }, surface: 15 }

const BUILDING_LABELS = /^(Building|Warehouse|Courthouse|Mall|Store|Car wash|Station|Park office|School|Ticket hall|Tower|Control room|Stair bulkhead)$/
const LABEL_STYLE: Record<string, Style> = {
  'Warehouse': 'warehouse', 'Courthouse': 'stone', 'Mall': 'shop', 'Store': 'shop', 'Ticket hall': 'shop', 'School': 'brick',
  'Station': 'brick', 'Park office': 'plaster', 'Car wash': 'concrete', 'Stair bulkhead': 'concrete', 'Control room': 'cyber',
}
const key = (t: Tex) => JSON.stringify(t)
const TEX_STYLE = new Map<string, Style>([
  [key(PB.brick), 'brick'], [key(PB.oldBrick), 'darkbrick'], [key(PB.plaster), 'plaster'], [key(PB.beige), 'beige'],
  [key(U.apartments), 'apartment'], [key(U.office), 'office'], [key(U.officeGreen), 'glass'], [key(U.shopfront), 'shop'],
  [key(PB.corrugated), 'warehouse'], [key(PB.boxBlue), 'warehouse'], [key(PB.cinder), 'concrete'], [key(PB.concrete), 'concrete'],
  [key(U.projects), 'projects'], [key(U.stone), 'stone'], [key(U.clubWall), 'club'], [key(U.clubWall2), 'club'],
  [key(CY.windows), 'cyber'], [key(CY.windowsPink), 'cyberpink'], [key(CY.dark), 'cyber'], [key(PB.planks), 'plaster'],
])

const BUNKERS = /^(Cake|Snake|Temple|Maya|Tombstone|X bunker|Neon block|Cover|Cover block)$/
const NO_BEVEL = /Wall|Floor|Ground|Platform|Deck|Road|Sidewalk|Path|Court|Pier|Bank|Bridge|Ramp|Island|Tier|Divider|Catwalk|Slab|Parapet|Ledge|Cornice|Rail|Track|Fence|Barrier|Container|Boxcar|Tanker|Train car|Water|Sign|Canopy|Awning|Roof|Shelter|Billboard|Crosswalk|Median|Trace|Pipe|Beam|Leg|Post|Column|Stage/

let busSeed = 0
function bus(p: Part): Part[] {
  const along = p.size[2] >= p.size[0]
  const [w, h, len] = along ? p.size : [p.size[2], p.size[1], p.size[0]]
  const rot = (p.rot ?? 0) + (along ? 0 : 90)
  const glass: Tex = { gen: 'paint', tweak: { color: '#25313b', accent: '#1a2229', scale: 2, wear: 0, seed: 330 }, surface: 9 }
  const t = (rot * Math.PI) / 180, at = (dx: number, dy: number, dz: number): [number, number, number] =>
    [p.at[0] + dx * Math.cos(t) + dz * Math.sin(t), p.at[1] + dy, p.at[2] - dx * Math.sin(t) + dz * Math.cos(t)]
  return group(`${p.label}@${p.at.join(',')}#${busSeed++}`, [
    { ...box('Bus body', [w, h - 0.6, len], at(0, 0.6, 0), p.top, p.side, rot), bevel: 0.4 },
    box('Bus windows', [w + 0.1, 1.4, len - 3], at(0, h - 2.4, -0.5), glass, glass, rot),
    ...[[-w / 2 + 0.3, len / 2 - 3], [w / 2 - 0.3, len / 2 - 3], [-w / 2 + 0.3, -len / 2 + 3], [w / 2 - 0.3, -len / 2 + 3]]
      .flatMap(([a, b]) => [
        lying('Wheel', 1.5, 0.7, at(a, 0, b), PB.tire, PB.tire, 14, rot),
        lying('Hubcap', 0.8, 0.76, at(a, 0.35, b), HUB, HUB, 10, rot),
      ]),
  ])
}

type Side = 'S' | 'N' | 'E' | 'W'
const SIDES: Record<Side, number> = { S: 0, N: 180, E: 90, W: 270 }
const ROADS = new Set(ROAD_SURFACES.map(key))

/** How far one can walk out from each side of a block (up to 20), and whether a road lies in front. */
function openSides(space: Space, block: Part, w: number, d: number): Record<Side, { open: number; road: boolean }> {
  const [x, y, z] = block.at
  const out = {} as Record<Side, { open: number; road: boolean }>
  for (const side of Object.keys(SIDES) as Side[]) {
    const rot = SIDES[side], depth = side === 'N' || side === 'S' ? d : w, fw = side === 'N' || side === 'S' ? w : d
    let sum = 0, road = false
    for (const dx of [-fw * 0.3, 0, fw * 0.3]) {
      let dist = 20
      for (let dz = depth / 2 + 0.6; dz <= depth / 2 + 20; dz += 0.5) {
        const [ox, oz] = turnBy(dx, dz, rot)
        // The floor in front may be a kerb, a porch or a loading dock.
        const fl = space.floorAt(x + ox, z + oz, y + 4.5, (q) => q === block)
        if (fl.by && ROADS.has(key(fl.by.top))) road = true
        // Stopped by a wall or a body, or the edge of the map.
        if (!fl.by || space.solidAt(x + ox, fl.y + 1.2, z + oz, (q) => q === block)) { dist = dz - depth / 2; break }
      }
      sum += dist
    }
    out[side] = { open: sum / 3, road }
  }
  return out
}

export function detailize(s: Sample): Sample {
  const parts: Part[] = []
  const space = new Space(s.parts)
  for (const p of s.parts) {
    if (p.group || p.kind !== 'box') { parts.push(p); continue }
    const [w, h, d] = p.size
    if (BUILDING_LABELS.test(p.label) && h >= 6 && Math.min(w, d) >= 8) {
      const style = LABEL_STYLE[p.label] ?? TEX_STYLE.get(key(p.side)) ?? (s.theme === 'Cyber' ? 'cyber' : 'plaster')
      // Buildings were drawn axis-aligned; a turned one keeps its footprint by swapping width and depth.
      const turned = Math.round((p.rot ?? 0) / 90) % 2 !== 0
      const [x, y, z] = p.at, bw = turned ? d : w, bd = turned ? w : d
      const inward: Side = Math.abs(x) > Math.abs(z) ? (x > 0 ? 'W' : 'E') : (z > 0 ? 'N' : 'S')
      const open = openSides(space, p, bw, bd)
      const score = (k: Side) => Math.min(open[k].open, 14) + (open[k].road ? 3 : 0) + (k === inward ? 2 : 0)
      const front = (Object.keys(SIDES) as Side[]).reduce((a, b) => (score(b) > score(a) ? b : a), inward)
      // The fire escape sticks out 2.5: on the more open side beside the front, if there is room (an alley can't take two).
      const beside: Side[] = front === 'N' || front === 'S' ? ['E', 'W'] : ['S', 'N']
      const esc = beside.reduce((a, b) => (open[b].open > open[a].open ? b : a))
      // An awning the map already hung over this front.
      const fr = SIDES[front], fd = front === 'N' || front === 'S' ? bd : bw, fw = front === 'N' || front === 'S' ? bw : bd
      const noAwning = s.parts.some((q) => {
        if (q.label !== 'Awning') return false
        const t = (fr * Math.PI) / 180, dx = q.at[0] - x, dz = q.at[2] - z
        const lx = dx * Math.cos(t) - dz * Math.sin(t), lz = dx * Math.sin(t) + dz * Math.cos(t)
        return Math.abs(lx) < fw / 2 && lz > fd / 2 - 0.5 && lz < fd / 2 + 4
      })
      const made = building({ x, y, z, w: bw, d: bd, h, style, front, roof: p.top, label: p.label, keepClear: s.markers.map(([, m]) => m), noAwning, escape: open[esc].open >= 6 ? esc : 'none' })
      // City buildings get lived in: AC units, flower boxes, a dish, a shop sign, an aerial.
      // Each piece only where it is clear of everything else the map has there (signs, canopies, stairs, the next building).
      const pieces = new Map<string, Part[]>()
      if (s.theme === 'Urban') for (const q of facadeLife({ x, y, z, w: bw, d: bd, h, style, front, escape: open[esc].open >= 6 ? esc : 'none', keepClear: s.markers.map(([, m]) => m) })) pieces.set(q.group!, [...(pieces.get(q.group!) ?? []), q])
      // ...and over the map (not hanging out over the outer wall).
      const over = (g: Part[]) => g.every((q) => corners(q).every(([cx, cz]) => Number.isFinite(space.floorAt(cx, cz, 999, (r) => r.label === 'Wall' || r === p).y)))
      const life = [...pieces.values()].filter((g) => space.fits(g, 0.15, (q) => q === p) && over(g)).flat()
      parts.push(...tagPrefab([...made, ...life], 'shop', { w: bw, d: bd, h, style, front }, [x, y, z], 0))
      continue
    }
    if (p.label === 'Car' || p.label === 'Limo') {
      const along = d >= w
      const rot = (p.rot ?? 0) + (along ? 0 : 90), len = Math.max(w, d)
      const color = 'gen' in p.side ? String(p.side.tweak?.color ?? '#b8322a') : '#b8322a'
      parts.push(...tagPrefab(car(p.at[0], p.at[2], rot, p.side, p.at[1], len), 'car', { color, len }, p.at, rot))
      continue
    }
    if (p.label === 'Bus' || p.label === 'Crashed bus') { parts.push(...bus(p)); continue }
    if (p.label === 'Bench' && h <= 1.5) { parts.push(...bench(p.at[0], p.at[2], (p.rot ?? 0) + (d > w ? 90 : 0), p.at[1])); continue }
    if (p.label === 'Dumpster') { parts.push(...dumpster(p.at[0], p.at[2], (p.rot ?? 0) + (d > w ? 90 : 0), p.at[1])); continue }
    const small = Math.max(w, d) <= 12 && h <= 8 && Math.min(w, h, d) >= 0.8
    if (small && !p.bevel && !NO_BEVEL.test(p.label)) {
      const b = BUNKERS.test(p.label) ? Math.min(0.7, Math.min(w, h, d) * 0.3) : Math.max(0.08, Math.min(0.4, Math.min(w, h, d) * 0.1))
      parts.push({ ...p, bevel: +b.toFixed(2) })
      continue
    }
    parts.push(p)
  }
  return { ...s, parts: openLandings(parts) }
}

/** Low walls round a raised floor that stairs or a ramp may arrive at. */
const LIPS = /^(Parapet|Railing|Rail|Guard rail|Low wall)$/

/**
 * Where stairs or a ramp arrive at a raised floor (a roof, a deck), the parapet or railing in the way gets a gap a
 * little wider than they are: a roof reached by stairs is one players can step onto, not one behind a wall too tall
 * to jump (spawns and weapons up there would be stuck: camp or fall).
 */
export function openLandings(parts: Part[]): Part[] {
  const ways = parts.filter((p) => p.kind === 'stairs' || p.kind === 'ramp')
  if (!ways.length) return parts
  const cuts = new Map<Part, [number, number][]>()
  for (const w of ways) {
    const top = w.at[1] + w.size[1]
    // Stairs and ramps rise toward their own −Z: the landing is just past that end, as wide as they are and a bit.
    const [dx, dz] = turn(0, -w.size[2] / 2 - 0.6, w.rot ?? 0)
    const lx = w.at[0] + dx, lz = w.at[2] + dz, r = w.size[0] / 2 + 1
    for (const q of parts) {
      if (q.kind !== 'box' || !LIPS.test(q.label) || Math.round(q.rot ?? 0) % 90 !== 0) continue
      // Standing on (or just under) the floor the stairs reach.
      if (q.at[1] > top + 0.6 || q.at[1] + q.size[1] < top - 0.2) continue
      const turned = Math.round((q.rot ?? 0) / 90) % 2 !== 0
      const [sx, sz] = turned ? [q.size[2], q.size[0]] : [q.size[0], q.size[2]]
      const alongX = sx >= sz
      const [c, across, len, thick] = alongX ? [q.at[0], q.at[2], sx, sz] : [q.at[2], q.at[0], sz, sx]
      const [pc, pa] = alongX ? [lx, lz] : [lz, lx]
      if (Math.abs(pa - across) > thick / 2 + 1.2 || pc + r < c - len / 2 || pc - r > c + len / 2) continue
      cuts.set(q, [...(cuts.get(q) ?? []), [pc - r, pc + r]])
    }
  }
  if (!cuts.size) return parts
  return parts.flatMap((q) => {
    const gaps = cuts.get(q)
    if (!gaps) return [q]
    const turned = Math.round((q.rot ?? 0) / 90) % 2 !== 0
    const alongX = (turned ? q.size[2] : q.size[0]) >= (turned ? q.size[0] : q.size[2])
    const c = alongX ? q.at[0] : q.at[2], len = alongX ? (turned ? q.size[2] : q.size[0]) : (turned ? q.size[0] : q.size[2])
    // What's left of the wall either side of the gaps.
    let runs: [number, number][] = [[c - len / 2, c + len / 2]]
    for (const [a, b] of gaps) {
      const next: [number, number][] = []
      for (const [u, v] of runs) {
        if (b <= u || a >= v) { next.push([u, v]); continue }
        if (a - u > 0.3) next.push([u, a])
        if (v - b > 0.3) next.push([b, v])
      }
      runs = next
    }
    return runs.map(([u, v]): Part => {
      const mid = (u + v) / 2, l = v - u
      const size: [number, number, number] = alongX === !turned ? [l, q.size[1], q.size[2]] : [q.size[0], q.size[1], l]
      return { ...q, size, at: alongX ? [mid, q.at[1], q.at[2]] : [q.at[0], q.at[1], mid] }
    })
  })
}
