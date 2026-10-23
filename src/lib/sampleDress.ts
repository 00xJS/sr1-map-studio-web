// Dressing pass: fills a map's open floor with prefabs that suit it (bunkers
// on a paintball field, pallets and forklifts on a building site, neon crates
// and jump pads in a cyber arena, street clutter in the city). Pieces go where
// there is the most room, mirrored for the other team, with space to walk
// round them and never on top of a spawn or pickup.
import type { Vec3 } from './project'
import type { Part, Sample, Theme } from './sampleKit'
import { ALL_PREFABS } from './prefabRegistry'
import { prefabParams, tagPrefab } from './prefabs'
import { blocker, over } from './sampleScale'
import { candidates } from './samplePopulate'

/** Prefabs for each map, roughly from big set pieces to small clutter. */
export const DRESS: Record<string, string[]> = {
  flat: ['koth', 'containers', 'bunker', 'scaffold', 'pallets', 'barrels', 'jersey', 'forklift', 'generator', 'sandbagwall'],
  arena: ['koth', 'bunker', 'tower', 'sandbagwall', 'barrels', 'jersey', 'pallets', 'boulder', 'hay'],
  warehouse: ['catwalk', 'containers', 'piperack', 'pallets', 'forklift', 'barrels', 'generator', 'jersey'],
  rooftops: ['generator', 'vending', 'barrels', 'trashcan', 'jersey', 'pallets', 'bush'],
  street: ['busstop', 'car', 'foodcart', 'trafficlight', 'hydrant', 'trashcan', 'meters', 'vending', 'jersey', 'tree'],
  pb_speedball: ['snake', 'xbunker', 'maya', 'temple', 'cake', 'dorito', 'can', 'tombstone', 'wedge', 'pin'],
  pb_rooftop: ['generator', 'palletwall', 'spool', 'tirestack', 'barrels', 'pallets', 'vending'],
  pb_containers: ['containers', 'forklift', 'spool', 'palletwall', 'tirestack', 'pallets', 'barrels'],
  pb_garage: ['car', 'jersey', 'barrels', 'cones', 'trashcan', 'pallets'],
  pb_alley: ['car', 'dumpster', 'palletwall', 'barrels', 'trashcan', 'hydrant', 'cones'],
  pb_tires: ['spool', 'tirestack', 'palletwall', 'hay', 'logs', 'barrels', 'deadtree'],
  pb_construction: ['scaffold', 'piperack', 'forklift', 'pallets', 'generator', 'barrels', 'jersey', 'cones'],
  pb_court: ['bleachers', 'hoop', 'car', 'dumpster', 'vending', 'trashcan', 'jersey'],
  pb_subway: ['jersey', 'barrels', 'vending', 'trashcan', 'bench'],
  pb_skate: ['halfpipe', 'jumpramp', 'hurdles', 'bench', 'trashcan', 'cones'],
  pb_village: ['tower', 'bunker', 'sandbagwall', 'hay', 'logs', 'barrels', 'rocks', 'deadtree'],
  pb_market: ['foodtruck', 'stall', 'foodcart', 'picnic', 'barrels', 'trashcan'],
  pb_overpass: ['car', 'jersey', 'dumpster', 'barrels', 'cones', 'trafficlight'],
  cy_grid: ['floatplat', 'lightgate', 'neonpillar', 'holowall', 'neoncube', 'jumppad', 'hexpillar'],
  cy_core: ['datacore', 'lightgate', 'holowall', 'neonpillar', 'neoncube'],
  cy_circuit: ['serverrow', 'holowall', 'neonpillar', 'neoncube', 'jumppad'],
  cy_hex: ['lightgate', 'neoncube', 'jumppad'],
  cy_servers: ['datacore', 'serverrow', 'holowall', 'neonpillar', 'neoncube'],
  cy_islands: ['floatplat', 'lightgate', 'neonpillar', 'jumppad', 'neoncube'],
  cy_pyramid: ['lightgate', 'holowall', 'neonpillar', 'neoncube', 'jumppad'],
  cy_maze: ['lightgate', 'neoncube', 'jumppad'],
  cy_skyline: ['neonpillar', 'neoncube', 'jumppad'],
  cy_colosseum: ['holowall', 'neonpillar', 'neoncube', 'jumppad'],
  cy_lanes: ['lightgate', 'holowall', 'neoncube', 'jumppad'],
  cy_reactor: ['fueltank', 'piperack', 'serverrow', 'generator', 'barrels', 'neoncube'],
}

/** Street clutter for the urban maps (already full of buildings and cover). */
const URBAN_CLUTTER = ['hydrant', 'trashcan', 'meters', 'vending', 'phone', 'mailbox', 'atm', 'cones', 'bush', 'flowers', 'bench', 'foodcart']
const THEME_FALLBACK: Record<Theme, string[]> = {
  'Starter': ['pallets', 'barrels', 'jersey'], 'Urban': URBAN_CLUTTER,
  'Urban paintball': ['cake', 'can', 'dorito', 'snake'], 'Cyber': ['neoncube', 'neonpillar', 'jumppad'],
}

const footprint = new Map<string, number>()
/** Radius (units) a prefab needs around its base point. */
function radius(key: string): number {
  let r = footprint.get(key)
  if (r === undefined) {
    r = 0
    for (const p of ALL_PREFABS[key].make(0, 0, 0, 1)) r = Math.max(r, Math.hypot(Math.abs(p.at[0]) + p.size[0] / 2, Math.abs(p.at[2]) + p.size[2] / 2))
    footprint.set(key, r)
  }
  return r
}

export interface DressOptions {
  /** Square units of floor per pair of pieces; smaller is denser. */
  perArea: number
  /** Extra space to keep clear round each piece. */
  gap: number
  maxPairs: number
}
export const DENSE: DressOptions = { perArea: 650, gap: 2.5, maxPairs: 40 }
export const LIGHT_DRESS: DressOptions = { perArea: 2200, gap: 1.2, maxPairs: 24 }

export function dress(s: Sample, o: DressOptions = DENSE): Sample {
  const keys = (s.theme === 'Urban' ? URBAN_CLUTTER : DRESS[s.id] ?? THEME_FALLBACK[s.theme]).filter((k) => ALL_PREFABS[k])
  if (!keys.length || !s.markers.length) return s
  const ground = Math.min(...s.markers.map(([, p]) => p[1]))
  const floor = candidates(s).filter((p) => p[1] === ground && (p[2] < 0 || (p[2] === 0 && p[0] < 0)))
  if (!floor.length) return s
  const xs = floor.map((p) => p[0]), zs = floor.map((p) => p[2])
  const area = 2 * (Math.max(...xs) - Math.min(...xs) + 4) * (Math.max(...zs) - Math.min(...zs) + 4)
  const pairs = Math.min(o.maxPairs, Math.round(area / o.perArea / 2))

  const parts: Part[] = [...s.parts]
  const markers = s.markers.map(([, p]) => p)
  // Is there room for a piece of radius r at p: nothing solid within r + gap, and no marker too close?
  const roomy = (p: Vec3, r: number) =>
    !parts.some((q) => q.at[1] < p[1] + 4 && q.at[1] + q.size[1] > p[1] + 0.35 && Math.max(q.size[0], q.size[2]) < 150 && over(q, p[0], p[2], r + o.gap))
    && markers.every((m) => Math.abs(m[1] - p[1]) > 3 || Math.hypot(m[0] - p[0], m[2] - p[2]) > r + 3)
  const taken: Vec3[] = [...markers, ...parts.filter((q) => q.at[1] + q.size[1] > ground + 0.35 && Math.max(q.size[0], q.size[2]) < 40).map((q) => q.at)]
  const dist = (p: Vec3) => {
    let d = Infinity
    for (const t of taken) { const e = Math.hypot(t[0] - p[0], t[2] - p[2]); if (e < d) d = e }
    // Its own mirrored twin counts as a neighbour too.
    return Math.min(d, Math.hypot(2 * p[0], 2 * p[2]))
  }

  for (let i = 0; i < pairs; i++) {
    // Farthest open spot first; try the map's pieces in turn until one fits there and at its mirror.
    const order = floor.map((p) => [dist(p), p] as const).sort((a, b) => b[0] - a[0]).slice(0, 160)
    let placed = false
    for (const [, p] of order) {
      const q: Vec3 = [-p[0], p[1], -p[2]]
      for (let k = 0; k < keys.length && !placed; k++) {
        const key = keys[(i + k) % keys.length]
        const r = radius(key)
        if (Math.hypot(2 * p[0], 2 * p[2]) < 2 * r + o.gap || !roomy(p, r) || !roomy(q, r)) continue
        const rot = ((i * 47 + k * 31) % 24) * 15
        const def = ALL_PREFABS[key], params = prefabParams(def)
        const piece = tagPrefab(def.make(p[0], p[2], rot, p[1], params), key, params, p, rot)
        const twin = tagPrefab(def.make(q[0], q[2], (rot + 180) % 360, q[1], params), key, params, q, (rot + 180) % 360)
        parts.push(...piece, ...twin)
        taken.push(p, q)
        placed = true
      }
      if (placed) break
    }
    if (!placed) break
  }
  // Pieces must not end up over a marker (a marker can't be under a canopy edge or inside a frame).
  const clean = markers.every((m) => !blocker(parts, m) || blocker(s.parts, m))
  return clean ? { ...s, parts } : s
}
