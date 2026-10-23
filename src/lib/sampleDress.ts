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
import { dressStreets } from './sampleStreet'

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
  // Jump pads and light gates are placed by hand in each map, where they lead somewhere.
  cy_grid: ['floatplat', 'neonpillar', 'holowall', 'neoncube', 'codepillar', 'hexpillar'],
  cy_core: ['holowall', 'codepillar', 'terminal', 'neonpillar', 'neoncube'],
  cy_circuit: ['serverrow', 'holowall', 'neonpillar', 'neoncube', 'terminal'],
  cy_hex: ['neoncube', 'codepillar'],
  cy_servers: ['serverrow', 'terminal', 'holowall', 'codepillar', 'neoncube'],
  cy_islands: ['floatplat', 'neonpillar', 'codepillar', 'neoncube'],
  cy_pyramid: ['holowall', 'neonpillar', 'codepillar', 'neoncube'],
  cy_maze: ['neoncube', 'codepillar'],
  cy_skyline: ['neonpillar', 'neoncube', 'holosign'],
  cy_colosseum: ['holowall', 'neonpillar', 'neoncube', 'terminal'],
  cy_lanes: ['holowall', 'neoncube', 'codepillar'],
  cy_reactor: ['fueltank', 'piperack', 'serverrow', 'generator', 'barrels', 'neoncube'],
}

/**
 * What each city map's streets hold, placed by dressStreets where it belongs
 * (see sampleStreet.ts): "key*n" places n pairs, "key@where" overrides the
 * usual spot (wall, front, side, kerb, verge, park, gutter, road, open, roof).
 * Big and particular pieces first, then the everyday clutter.
 */
export const URBAN_EXTRA: Record<string, string[]> = {
  u_downtown: ['signal*2', 'busstopsign', 'citytaxi*2', 'car*2', 'cityvan', 'hydrant*3', 'meters*3', 'newsbox*2', 'mailbox', 'trashcan*3', 'streetsign*2', 'bikerack',
    'cafe*2', 'atm', 'vending', 'phone', 'stormdrain*4', 'manholecover*3', 'puddle*2', 'litter*3', 'binbags*2', 'bins*2', 'posters*3', 'graffiti*2', 'roofac*2', 'satdish'],
  u_plaza: ['newsbox@wall', 'bench@wall*2', 'cafe*3', 'trashcan@open*3', 'drinkfountain*2', 'foodcart', 'bikerack@open', 'posters*2', 'flowers*2', 'litter@open*2', 'roofac'],
  u_park: ['trashcan@open*4', 'drinkfountain*2', 'picnic*2', 'grill*2', 'noticeboard@open', 'bikerack@open', 'foodcart', 'bush*4', 'flowers*3', 'litter@open*2', 'puddle@open*2'],
  u_parking: ['busstopsign', 'trashcan*3', 'bench@kerb*2', 'newsbox', 'atm', 'vending@front*2', 'icemachine', 'bikerack', 'cruiser', 'cityvan',
    'stormdrain*4', 'manholecover*2', 'puddle*4', 'litter*4', 'bins*2', 'posters', 'roofac*3'],
  u_gas: ['utilitypole*4', 'airpump', 'icemachine', 'propanecage', 'tirerack', 'vending@front', 'phone', 'newsbox@front', 'trashcan@wall*2', 'streetsign@verge',
    'barrels', 'bins*2', 'binbags', 'posters*2', 'graffiti*2', 'manholecover*2', 'puddle*3', 'litter*3', 'roofac'],
  u_trainyard: ['sleepers*2', 'relaybox*3', 'bench@kerb*2', 'trashcan@kerb', 'cratestack*2', 'pallets*2', 'barrels*2', 'graffiti*5', 'posters*2', 'litter@open*3', 'puddle@open*3'],
  u_docks: ['lifering*3', 'buoys*3', 'fishnet*2', 'fishcrates*4', 'cratestack*4', 'barrels*3', 'pallets*4', 'forklift@open', 'bins', 'binbags', 'graffiti*3', 'posters', 'litter@open*4', 'puddle@open*5'],
  u_suburb: ['utilitypole*4', 'postbox*3', 'bins@verge*2', 'hydrant@verge*2', 'citypickup', 'cityvan', 'car', 'grill*2', 'lawnchairs*2', 'washingline', 'bush*4', 'flowers*3', 'manholecover*2', 'puddle*2', 'lowwall'],
  u_trailer: ['grill*3', 'lawnchairs*3', 'washingline*2', 'bins*2', 'binbags*2', 'barrels', 'tirestack*2', 'propanecage', 'puddle@open*4', 'litter@open*3', 'chainfence'],
  u_chinatown: ['produce*3', 'fruitcrates*3', 'cafe*2', 'vending@front', 'newsbox@front', 'binbags*3', 'bins*2', 'bikerack@open', 'posters*3', 'graffiti',
    'manholecover@open*2', 'puddle@open*3', 'litter@open*4', 'roofac*2'],
  u_skyscraper: ['portapotty', 'cementmixer@open', 'generator*2', 'roadbarricade@open*3', 'cones*3', 'pallets*3', 'barrels*2', 'cratestack', 'binbags', 'litter@open*3', 'puddle@open*4', 'chainfence'],
  u_rooftops: ['roofac*3', 'satdish*2', 'binbags*3', 'bins*2', 'vending', 'newsbox@wall', 'phone', 'graffiti*4', 'posters*2', 'manholecover*3', 'puddle*3', 'litter*3'],
  u_highway: ['roadbarricade*3', 'cones@road*2', 'graffiti*5', 'binbags*2', 'manholecover*2', 'puddle*4', 'litter*4', 'jersey@road'],
  u_school: ['bins*3', 'trashcan@open*3', 'bench@wall*3', 'picnic*2', 'vending@front', 'drinkfountain*2', 'posters*2', 'graffiti', 'roofac*2', 'litter@open*2', 'puddle@open*2', 'lowwall', 'chainfence'],
  u_terminal: ['citybus*2', 'citytaxi*2', 'busstopsign*3', 'trashcan@kerb*3', 'newsbox@kerb', 'vending@front*2', 'atm', 'phone', 'stormdrain*2', 'manholecover*2', 'puddle*3', 'litter*3', 'posters*2', 'graffiti', 'roofac*2'],
  u_projects: ['bins*3', 'binbags*3', 'washingline', 'grill', 'lawnchairs', 'trashcan@open*2', 'graffiti*5', 'posters*2', 'litter@open*5', 'puddle@open*3', 'chainfence'],
  u_warehouses: ['pallets*3', 'cratestack*3', 'barrels*2', 'generator', 'dumpster*2', 'bins', 'binbags', 'graffiti*4', 'posters', 'manholecover*2', 'puddle*4', 'litter*3', 'roofac*3', 'chainfence'],
  u_canal: ['lifering*2', 'cafe*3', 'bench@kerb*2', 'trashcan@kerb*2', 'bikerack@kerb', 'flowers*2', 'posters*2', 'graffiti*2', 'litter@open*2', 'puddle@open*2', 'bollards'],
  u_junkyard: ['carwreck*3', 'tirestack*3', 'tirerack', 'barrels*3', 'pallets', 'generator', 'binbags*2', 'dumpster', 'deadtree*2', 'graffiti*3', 'puddle@open*4', 'litter@open*3', 'chainfence'],
  u_church: ['gravestones', 'flowers*3', 'bush*3', 'trashcan@open*2', 'cafe*2', 'bikerack@open', 'posters', 'litter@open', 'puddle@open*2', 'lowwall'],
  u_clubstrip: ['citytaxi*3', 'car*2', 'hydrant*2', 'trashcan*2', 'newsbox', 'atm*2', 'vending', 'stormdrain*4', 'manholecover*3', 'puddle*4', 'litter*4', 'binbags*3', 'bins', 'graffiti*3', 'posters*3', 'roofac*2', 'billboard'],
  u_river: ['utilitypole*3', 'lifering*2', 'bench@kerb*2', 'trashcan@kerb*2', 'citypickup', 'cityvan', 'streetsign@verge', 'cafe*2', 'graffiti*4', 'posters', 'manholecover*2', 'puddle*2', 'litter*2', 'bollards'],
  u_market: ['produce@open*3', 'fruitcrates@open*4', 'trashcan@open*3', 'icemachine', 'bins*2', 'binbags*2', 'cratestack', 'posters*2', 'graffiti', 'litter@open*4', 'puddle@open*2'],
  u_ruins: ['binbags@open*3', 'tirestack*2', 'pallets@open', 'roadbarricade@open*2', 'deadtree*3', 'graffiti*6', 'litter@open*5', 'puddle@open*4', 'chainfence'],
  u_mainstreet: ['utilitypole*4', 'busstop', 'citytaxi', 'car*2', 'cityvan', 'citypickup', 'hydrant*3', 'meters*4', 'newsbox*2', 'mailbox', 'trashcan*3', 'bikerack', 'streetsign*2',
    'cafe*2', 'vending', 'atm', 'stormdrain*4', 'manholecover*3', 'puddle*2', 'litter*3', 'binbags*2', 'bins*2', 'posters*3', 'graffiti*2', 'roofac*2', 'billboard', 'lowwall'],
  u_office_park: ['bench@wall*3', 'trashcan@open*3', 'bikerack@open', 'flowers*3', 'bush*2', 'cafe*2', 'drinkfountain', 'vending@front', 'atm', 'newsbox@front', 'roofac*3', 'litter@open*2', 'acunit', 'lowwall'],
  u_stadium: ['trashcan@open*4', 'foodcart*2', 'drinkfountain', 'vending@wall*2', 'atm@wall', 'bikerack@open', 'roadbarricade@open*3', 'posters*3', 'litter@open*6', 'puddle@open*2', 'billboard@open', 'portapotty'],
}

/** Background sound for each city map: a retail map of the same kind of place. */
export const URBAN_AMBIENCE: Record<string, string> = {
  u_downtown: 'amb_mp_bac_01', u_plaza: 'amb_mp_bac_01', u_mainstreet: 'amb_mp_bac_01', u_clubstrip: 'amb_mp_bac_01', u_rooftops: 'amb_mp_bac_01', u_office_park: 'amb_mp_bac_01',
  u_parking: 'amb_mp_bac_03', u_gas: 'amb_mp_bac_03', u_terminal: 'amb_mp_bac_03', u_highway: 'amb_mp_bac_03', u_chinatown: 'amb_mp_bac_03', u_junkyard: 'amb_mp_bac_03',
  u_suburb: 'amb_mp_bor_01', u_school: 'amb_mp_bor_01', u_park: 'amb_mp_bor_01', u_church: 'amb_mp_bor_01',
  u_trailer: 'amb_mp_bor_02', u_projects: 'amb_mp_bor_02', u_market: 'amb_mp_bor_02', u_canal: 'amb_mp_bor_02', u_river: 'amb_mp_bor_02',
  u_docks: 'amb_mp_coop_delivery', u_warehouses: 'amb_mp_coop_delivery', u_trainyard: 'amb_mp_coop_delivery', u_skyscraper: 'amb_mp_coop_delivery', u_ruins: 'amb_mp_coop_delivery',
  u_stadium: 'amb_mp_arena',
}

/** Street clutter for city maps without a list of their own. */
const URBAN_CLUTTER = ['hydrant*2', 'trashcan*2', 'meters', 'newsbox', 'vending', 'bench', 'manholecover*2', 'stormdrain*2', 'puddle*2', 'litter*2', 'binbags', 'bins', 'posters', 'graffiti']
const THEME_FALLBACK: Record<Theme, string[]> = {
  'Starter': ['pallets', 'barrels', 'jersey'], 'Urban': URBAN_CLUTTER,
  'Urban paintball': ['cake', 'can', 'dorito', 'snake'], 'Cyber': ['neoncube', 'neonpillar', 'codepillar'],
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
  // City maps are dressed like real streets: each piece where it belongs.
  if (s.theme === 'Urban' && !s.dressWith) return { ...dressStreets(s, { list: URBAN_EXTRA[s.id] ?? URBAN_CLUTTER }), ambience: s.ambience ?? URBAN_AMBIENCE[s.id] }
  const keys = (s.dressWith ?? DRESS[s.id] ?? THEME_FALLBACK[s.theme]).filter((k) => ALL_PREFABS[k])
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
    !parts.some((q) => q.at[1] < p[1] + 4 && q.at[1] + q.size[1] > p[1] + 0.35 && (Math.max(q.size[0], q.size[2]) < 150 || Math.min(q.size[0], q.size[2]) < 4) && over(q, p[0], p[2], r + o.gap))
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
