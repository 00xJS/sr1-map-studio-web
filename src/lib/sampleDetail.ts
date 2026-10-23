// Detail pass for sample maps: plain blocks become real-looking pieces.
// - Building blocks become generated buildings (storefront, windows by floor,
//   ledges, cornice, parapet, rooftop clutter, fire escapes), styled after the
//   wall texture the map gave them.
// - Car, bus, bench and dumpster boxes become their prefabs.
// - Small cover gets softened (beveled) edges; paintball bunkers get the
//   rounded look of inflatables.
import type { Part, Sample, Tex } from './sampleKit'
import { CY, PB } from './sampleKit'
import { U } from './urbanKit'
import { bench, building, car, dumpster, group, type Style } from './prefabs'
import { box } from './sampleKit'

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
  const glass: Tex = { gen: 'tiles', tweak: { color: '#25313b', accent: '#1a2229', scale: 1, wear: 0, seed: 330 }, surface: 9 }
  const t = (rot * Math.PI) / 180, at = (dx: number, dy: number, dz: number): [number, number, number] =>
    [p.at[0] + dx * Math.cos(t) + dz * Math.sin(t), p.at[1] + dy, p.at[2] - dx * Math.sin(t) + dz * Math.cos(t)]
  return group(`Bus@${p.at.join(',')}#${busSeed++}`, [
    { ...box('Bus body', [w, h - 0.6, len], at(0, 0.6, 0), p.top, p.side, rot), bevel: 0.4 },
    box('Bus windows', [w + 0.1, 1.4, len - 3], at(0, h - 2.4, -0.5), glass, glass, rot),
    ...[[-w / 2 + 0.3, len / 2 - 3], [w / 2 - 0.3, len / 2 - 3], [-w / 2 + 0.3, -len / 2 + 3], [w / 2 - 0.3, -len / 2 + 3]]
      .map(([a, b]) => ({ ...box('Wheel', [0.7, 1.5, 1.5], at(a, 0, b), PB.tire, PB.tire, rot), bevel: 0.3 })),
  ])
}

export function detailize(s: Sample): Sample {
  const parts: Part[] = []
  for (const p of s.parts) {
    if (p.group || p.kind !== 'box') { parts.push(p); continue }
    const [w, h, d] = p.size
    if (BUILDING_LABELS.test(p.label) && h >= 6 && Math.min(w, d) >= 8) {
      const style = LABEL_STYLE[p.label] ?? TEX_STYLE.get(key(p.side)) ?? (s.theme === 'Cyber' ? 'cyber' : 'plaster')
      // Buildings were drawn axis-aligned; a turned one keeps its footprint by swapping width and depth.
      const turned = Math.round((p.rot ?? 0) / 90) % 2 !== 0
      parts.push(...building({ x: p.at[0], y: p.at[1], z: p.at[2], w: turned ? d : w, d: turned ? w : d, h, style, roof: p.top, label: p.label, keepClear: s.markers.map(([, m]) => m) }))
      continue
    }
    if (p.label === 'Car' || p.label === 'Limo') {
      const along = d >= w
      parts.push(...car(p.at[0], p.at[2], (p.rot ?? 0) + (along ? 0 : 90), p.side, p.at[1], Math.max(w, d)))
      continue
    }
    if (p.label === 'Bus') { parts.push(...bus(p)); continue }
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
  return { ...s, parts }
}
