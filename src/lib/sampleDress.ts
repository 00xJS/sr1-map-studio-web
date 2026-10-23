// Dressing pass: fills a map's open floor with prefabs that suit it (bunkers
// on a paintball field, pallets and forklifts on a building site, neon crates
// and jump pads in a cyber arena, street clutter in the city). Pieces go where
// there is the most room, mirrored for the other team, with space to walk
// round them and never on top of a spawn or pickup.
import type { Vec3 } from './project'
import type { Part, Sample, Theme } from './sampleKit'
import { ALL_PREFABS } from './prefabRegistry'
import { prefabParams, tagPrefab } from './prefabs'
import { blocker, over, support } from './sampleScale'
import { LIFE_FRONTS } from './prefabsPaintballLife'
import { candidates } from './samplePopulate'

/** Prefabs for each map, roughly from big set pieces to small clutter. */
export const DRESS: Record<string, string[]> = {
  flat: ['koth', 'containers', 'bunker', 'scaffold', 'pallets', 'barrels', 'jersey', 'forklift', 'generator', 'sandbagwall'],
  arena: ['koth', 'bunker', 'tower', 'sandbagwall', 'barrels', 'jersey', 'pallets', 'boulder', 'hay'],
  warehouse: ['catwalk', 'containers', 'piperack', 'pallets', 'forklift', 'barrels', 'generator', 'jersey'],
  rooftops: ['generator', 'vending', 'barrels', 'trashcan', 'jersey', 'pallets', 'bush'],
  street: ['busstop', 'car', 'foodcart', 'trafficlight', 'hydrant', 'trashcan', 'meters', 'vending', 'jersey', 'tree'],
  pb_speedball: ['snake', 'xbunker', 'maya', 'temple', 'cake', 'dorito', 'can', 'tombstone', 'wedge', 'pin'],
  pb_rooftop: ['acunit', 'dish', 'generator', 'palletwall', 'spool', 'tirestack', 'barrels', 'paintboxes'],
  pb_containers: ['containers', 'forklift', 'spool', 'palletwall', 'tirestack', 'pallets', 'paintboxes', 'barrels'],
  pb_garage: ['car', 'jersey', 'barrels', 'cones', 'trashcan', 'trashbags'],
  pb_alley: ['car', 'dumpster', 'trashbags', 'palletwall', 'barrels', 'acunit', 'trashcan', 'hydrant', 'cones'],
  pb_tires: ['spool', 'tirestack', 'palletwall', 'paintboxes', 'hay', 'logs', 'barrels', 'deadtree'],
  pb_construction: ['scaffold', 'concretepipes', 'rebar', 'piperack', 'forklift', 'portapotty', 'pallets', 'generator', 'barrels', 'jersey', 'cones'],
  pb_court: ['car', 'dumpster', 'trashbags', 'vending', 'trashcan', 'hydrant', 'jersey'],
  pb_subway: ['jersey', 'barrels', 'vending', 'trashcan', 'bench'],
  pb_skate: ['halfpipe', 'jumpramp', 'grindrail', 'hurdles', 'bench', 'trashcan', 'cones'],
  pb_village: ['tower', 'bunker', 'sandbagwall', 'hay', 'logs', 'barrels', 'rocks', 'deadtree'],
  pb_market: ['foodtruck', 'stall', 'producecrates', 'foodcart', 'picnic', 'barrels', 'trashcan'],
  pb_overpass: ['car', 'carwreck', 'jersey', 'dumpster', 'barrels', 'cones', 'trafficlight'],
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

/** Pieces that belong in particular urban maps, placed before the general street clutter. */
const URBAN_EXTRA: Record<string, string[]> = {
  u_downtown: ['billboard', 'utilitypole'], u_mainstreet: ['billboard', 'utilitypole', 'lowwall'], u_plaza: ['lowwall'],
  u_clubstrip: ['billboard', 'utilitypole'], u_chinatown: ['utilitypole'], u_projects: ['chainfence', 'utilitypole'],
  u_suburb: ['lowwall', 'utilitypole'], u_trailer: ['chainfence', 'utilitypole'], u_school: ['lowwall', 'chainfence'],
  u_office_park: ['acunit', 'lowwall'], u_skyscraper: ['portapotty', 'cementmixer', 'chainfence'], u_warehouses: ['boxtruck', 'cratestack', 'chainfence'],
  u_trainyard: ['railsignal', 'cratestack'], u_terminal: ['citybus', 'railsignal'], u_docks: ['bollards', 'cratestack'],
  u_canal: ['bollards'], u_river: ['bollards'], u_highway: ['tollbooth', 'boxtruck', 'utilitypole'], u_gas: ['boxtruck', 'utilitypole'],
  u_junkyard: ['carwreck', 'chainfence'], u_ruins: ['carwreck', 'chainfence'], u_church: ['gravestones', 'lowwall'],
  u_market: ['cratestack', 'boxtruck'], u_parking: ['utilitypole'], u_stadium: ['billboard', 'portapotty'], u_park: ['lowwall'],
}

/** Street clutter for the urban maps (already full of buildings and cover). */
const URBAN_CLUTTER = ['hydrant', 'trashcan', 'meters', 'vending', 'phone', 'mailbox', 'atm', 'cones', 'bush', 'flowers', 'bench', 'foodcart']
const THEME_FALLBACK: Record<Theme, string[]> = {
  'Starter': ['pallets', 'barrels', 'jersey'], 'Urban': URBAN_CLUTTER,
  'Urban paintball': ['cake', 'can', 'dorito', 'snake'], 'Cyber': ['neoncube', 'neonpillar', 'codepillar'],
}

const footprint = new Map<string, [number, number]>()
/** Radius (units) a prefab needs around its base point, and how tall it stands. */
function extent(key: string): [number, number] {
  let r = footprint.get(key)
  if (r === undefined) {
    let rad = 0, top = 0
    for (const p of ALL_PREFABS[key].make(0, 0, 0, 1)) {
      rad = Math.max(rad, Math.hypot(Math.abs(p.at[0]) + p.size[0] / 2, Math.abs(p.at[2]) + p.size[2] / 2))
      top = Math.max(top, p.at[1] + p.size[1] - 1)
    }
    footprint.set(key, r = [rad, top])
  }
  return r
}

/**
 * Pieces with a front (seats, hoops, screens, counters, serving hatches): where the front points (degrees from
 * the piece's +Z), the open floor it needs, and the heading step (most things line up with the site).
 */
const FRONTS: Record<string, [number, number, number]> = {
  bench: [0, 3, 45], bleachers: [0, 8, 90], hoop: [0, 10, 90], goal: [0, 10, 90], vending: [0, 3, 90], atm: [0, 3, 90], busstop: [0, 4, 90],
  kiosk: [0, 3, 90], stall: [0, 3, 90], foodtruck: [90, 4, 90], ...LIFE_FRONTS,
}
/** Pieces that stand square to the site (parked, stacked, lined up), not at any angle. */
const SQUARE = new Set(['car', 'containers', 'dumpster', 'jersey', 'scaffold', 'piperack', 'catwalk', 'generator', 'bunker', 'tower', 'koth', 'spawnroom', 'boxtruck', 'citybus', 'pallets', 'picnic', 'foodcart'])

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
  const keys = (s.dressWith ?? (s.theme === 'Urban' ? [...(URBAN_EXTRA[s.id] ?? []), ...URBAN_CLUTTER] : DRESS[s.id] ?? THEME_FALLBACK[s.theme])).filter((k) => ALL_PREFABS[k])
  if (!keys.length || !s.markers.length) return s
  const ground = Math.min(...s.markers.map(([, p]) => p[1]))
  const floor = candidates(s).filter((p) => p[1] === ground && (p[2] < 0 || (p[2] === 0 && p[0] < 0)))
  if (!floor.length) return s
  const xs = floor.map((p) => p[0]), zs = floor.map((p) => p[2])
  const area = 2 * (Math.max(...xs) - Math.min(...xs) + 4) * (Math.max(...zs) - Math.min(...zs) + 4)
  const pairs = Math.min(o.maxPairs, Math.round(area / o.perArea / 2))

  const parts: Part[] = [...s.parts]
  const markers = s.markers.map(([, p]) => p)
  // Is there room for a piece of radius r and height h at p: nothing solid within r + gap up to its top, and no marker too close?
  const roomy = (p: Vec3, r: number, h: number) =>
    !parts.some((q) => q.at[1] < p[1] + Math.max(4, h + 0.5) && q.at[1] + q.size[1] > p[1] + 0.35 && over(q, p[0], p[2], r + o.gap))
    && markers.every((m) => Math.abs(m[1] - p[1]) > 3 || Math.hypot(m[0] - p[0], m[2] - p[2]) > r + 3)
  // Floor under every corner of what stands on the ground (nothing hangs off the map or a platform).
  const grounded = (piece: Part[], y: number) => piece.filter((q) => q.at[1] <= y + 0.05).every((q) =>
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].every(([a, b]) => {
      const t = ((q.rot ?? 0) * Math.PI) / 180, dx = (a * q.size[0]) / 2, dz = (b * q.size[2]) / 2
      return support(s.parts, [q.at[0] + dx * Math.cos(t) + dz * Math.sin(t), y, q.at[2] - dx * Math.sin(t) + dz * Math.cos(t)]) >= 0
    }))
  // Not on paint (a court, a crosswalk, parking lines): that floor is kept for playing on.
  const onPaint = (p: Vec3, r: number) => s.parts.some((q) => q.size[1] <= 0.3 && !q.water && q.at[1] <= p[1] + 0.01 && q.at[1] + q.size[1] > p[1] && over(q, p[0], p[2], r))
  // A piece with a front faces the middle of the map, or the nearest heading with open floor in front of it (null: none).
  const aim = (p: Vec3, r: number, [off, need, step]: [number, number, number]): number | null => {
    const toward = Math.round((Math.atan2(-p[0], -p[2]) * 180) / Math.PI / step) * step
    for (let k = 0; k <= 180 / step; k++) for (const sign of k ? [1, -1] : [1]) {
      const h = toward + sign * k * step, t = (h * Math.PI) / 180
      let open = true
      for (let d = r; d <= r + need && open; d += 1) {
        const x = p[0] + Math.sin(t) * d, z = p[2] + Math.cos(t) * d
        open = support(s.parts, [x, p[1], z]) >= 0 && !parts.some((q) => q.at[1] < p[1] + 3 && q.at[1] + q.size[1] > p[1] + 1.2 && over(q, x, z, 0))
      }
      if (open) return (((h - off) % 360) + 360) % 360
    }
    return null
  }
  const taken: Vec3[] = [...markers, ...parts.filter((q) => q.at[1] + q.size[1] > ground + 0.35 && Math.max(q.size[0], q.size[2]) < 40).map((q) => q.at)]
  const dist = (p: Vec3) => {
    let d = Infinity
    for (const t of taken) { const e = Math.hypot(t[0] - p[0], t[2] - p[2]); if (e < d) d = e }
    // Its own mirrored twin counts as a neighbour too.
    return Math.min(d, Math.hypot(2 * p[0], 2 * p[2]))
  }

  // No one piece fills the map: each is used about as often as the others.
  const used = new Map<string, number>(), cap = Math.max(2, Math.ceil(pairs / keys.length) + 1)
  for (let i = 0; i < pairs; i++) {
    // Farthest open spot first; try the map's pieces in turn until one fits there and at its mirror.
    const order = floor.map((p) => [dist(p), p] as const).sort((a, b) => b[0] - a[0]).slice(0, 160)
    let placed = false
    for (const [, p] of order) {
      const q: Vec3 = [-p[0], p[1], -p[2]]
      for (let k = 0; k < keys.length && !placed; k++) {
        const key = keys[(i + k) % keys.length]
        const [r, h] = extent(key)
        if ((used.get(key) ?? 0) >= cap || Math.hypot(2 * p[0], 2 * p[2]) < 2 * r + o.gap || onPaint(p, r) || !roomy(p, r, h) || !roomy(q, r, h)) continue
        const front = FRONTS[key]
        const first = front ? aim(p, r, front) : SQUARE.has(key) ? ((i + k) % 4) * 90 : ((i * 47 + k * 31) % 24) * 15
        if (first === null) continue
        // The first heading whose piece (and its twin) stands wholly on the floor; a piece with a front keeps its aim.
        const def = ALL_PREFABS[key], params = prefabParams(def)
        let made: [Part[], Part[]] | null = null
        for (const rot of front ? [first] : [0, 90, 180, 270].map((d) => (first + d) % 360)) {
          const piece = tagPrefab(def.make(p[0], p[2], rot, p[1], params), key, params, p, rot)
          const twin = tagPrefab(def.make(q[0], q[2], (rot + 180) % 360, q[1], params), key, params, q, (rot + 180) % 360)
          if (grounded(piece, p[1]) && grounded(twin, q[1])) { made = [piece, twin]; break }
        }
        if (!made) continue
        const [piece, twin] = made
        parts.push(...piece, ...twin)
        used.set(key, (used.get(key) ?? 0) + 1)
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
