// Fills a sample map with spawns, weapons, drop-offs and lights, spread evenly
// over the floor players can stand on. More spawns spread far apart mean random
// teams start apart and spawn camping is hard; weapons are scattered everywhere,
// with the strongest nearest the middle. Everything stays point-symmetric, so
// red (−Z) and blue (+Z) get the same chances.
import type { Vec3 } from './project'
import { CY, PB, box, cyl, type MarkerSpec, type Part, type Sample, type Theme } from './sampleKit'
import { blocker, over, support } from './sampleScale'

const URBAN_POOL = ['rpg_launcher', 'sniper_rifle', 'spas12', 'm16', 'ak47', 'pump_action_shotgun', 'mac10', 'tec9', 'magnum', 'desert eagle', 'glock', 'molotov', 'pipe_bomb', 'grenade', 'baseball_bat', 'beretta']
const CYBER_POOL = ['rpg_laser', 'sniper_rifle', 'spas12', 'ak47L', 'm16', 'mac10L', 'magnumL', 'tec9b', 'desert_eagle_gold', 'grenade', 'pipe_bomb', 'glock']

const LIGHTS: Record<Theme, Vec3[]> = {
  'Starter': [[1, 0.85, 0.65], [0.8, 0.9, 1]],
  'Urban paintball': [[1, 0.82, 0.6], [1, 0.95, 0.85]],
  'Urban': [[1, 0.75, 0.45], [0.75, 0.85, 1], [1, 0.9, 0.7]],
  'Cyber': [[0.2, 0.9, 1], [1, 0.25, 0.85], [0.6, 0.35, 1], [0.5, 1, 0.3]],
}

export interface PopulateTargets { shared: number; perTeam: number; weapons: number; drops: number; lights: number }
export const FULL_TARGETS: PopulateTargets = { shared: 20, perTeam: 8, weapons: 22, drops: 4, lights: 24 }

const flip = (p: Vec3): Vec3 => [-p[0], p[1], -p[2]]
const d2 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]) + Math.abs(a[1] - b[1]) * 2
const lookAtCenter = (p: Vec3) => +((Math.atan2(-p[0], p[2]) * 180) / Math.PI).toFixed(1)

/** Spots players can stand on: a 4-unit grid over the map, at the heights the map's own markers use (known to be reachable). */
function candidates(s: Sample): Vec3[] {
  const heights = [...new Set(s.markers.map(([, p]) => p[1]))]
  const xs = s.parts.flatMap((p) => [p.at[0] - p.size[0], p.at[0] + p.size[0]])
  const zs = s.parts.flatMap((p) => [p.at[2] - p.size[2], p.at[2] + p.size[2]])
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  const out: Vec3[] = []
  for (let x = Math.ceil(x0 / 4) * 4; x <= x1; x += 4) for (let z = Math.ceil(z0 / 4) * 4; z <= z1; z += 4) for (const y of heights) {
    const p: Vec3 = [x, y, z]
    if (support(s.parts, p) >= 0 && !blocker(s.parts, p)) out.push(p)
  }
  return out
}

/** Farthest-point picks: each new spot is as far as possible from everything already taken (and its mirror is clear too). */
function pick(pool: Vec3[], taken: Vec3[], count: number, minGap: number, ok: (p: Vec3) => boolean, parts: Sample['parts']): Vec3[] {
  const chosen: Vec3[] = []
  const all = [...taken]
  while (chosen.length < count) {
    let best: Vec3 | null = null, bestD = -1
    for (const p of pool) {
      if (!ok(p)) continue
      const q = flip(p)
      if (support(parts, q) < 0 || blocker(parts, q)) continue
      const d = Math.min(...all.map((t) => d2(t, p)), ...all.map((t) => d2(t, q)), d2(p, q) / 2)
      if (d > bestD) { bestD = d; best = p }
    }
    if (!best || bestD < minGap) break
    chosen.push(best)
    all.push(best, flip(best))
  }
  return chosen
}

export function populate(s: Sample, t: PopulateTargets = FULL_TARGETS): Sample {
  const pool = candidates(s)
  if (!pool.length) return s
  const zs = pool.map((p) => p[2])
  const depth = Math.max(...zs) - Math.min(...zs)
  const markers: MarkerSpec[] = [...s.markers]
  const of = (type: string) => markers.filter(([m]) => m === type).map(([, p]) => p)
  const spawns = () => [...of('Shared spawn'), ...of('Red team spawn'), ...of('Blue team spawn')]

  // Team spawns: spread across each team's end of the map.
  const red = pick(pool, of('Red team spawn'), Math.max(0, t.perTeam - of('Red team spawn').length), 6, (p) => p[2] < -depth * 0.3, s.parts)
  for (const p of red) markers.push(['Red team spawn', p, { yaw: 180 }], ['Blue team spawn', flip(p), { yaw: 0 }])

  // Free-for-all spawns: everywhere, as far apart as possible.
  const sharedNeed = Math.max(0, t.shared - of('Shared spawn').length)
  const shared = pick(pool, spawns(), Math.ceil(sharedNeed / 2), 12, (p) => p[2] < 0 || (p[2] === 0 && p[0] < 0), s.parts)
  for (const p of shared) markers.push(['Shared spawn', p, { yaw: lookAtCenter(p) }], ['Shared spawn', flip(p), { yaw: lookAtCenter(flip(p)) }])

  // Chains drop-offs: in the middle band, apart from each other.
  const dropNeed = Math.max(0, t.drops - of('Chains drop-off').length)
  const drops = pick(pool, [...of('Chains drop-off'), ...spawns()], Math.ceil(dropNeed / 2), 16, (p) => Math.abs(p[2]) < depth * 0.3 && (p[2] < 0 || p[0] < 0), s.parts)
  for (const p of drops) markers.push(['Chains drop-off', p], ['Chains drop-off', flip(p)])

  // Weapons: scattered everywhere, not on top of spawns; the strongest closest to the middle.
  const weaponNeed = Math.max(0, t.weapons - of('Weapon pickup').length)
  const away = spawns()
  const spots = pick(pool, [...of('Weapon pickup'), ...away], Math.ceil(weaponNeed / 2), 10,
    (p) => (p[2] < 0 || (p[2] === 0 && p[0] < 0)) && away.every((a) => d2(a, p) > 8), s.parts)
    .sort((a, b) => Math.hypot(a[0], a[2]) - Math.hypot(b[0], b[2]))
  const weapons = s.theme === 'Cyber' ? CYBER_POOL : URBAN_POOL
  spots.forEach((p, i) => {
    const id = weapons[i % weapons.length]
    markers.push(['Weapon pickup', p, { weapon: id }], ['Weapon pickup', flip(p), { weapon: id }])
  })

  // Lights: spread over the floor, a few metres up, in the theme's colors.
  const lights: [Vec3, Vec3?][] = [...(s.lights ?? [])]
  const colors = LIGHTS[s.theme]
  const lightNeed = Math.max(0, Math.min(64, t.lights) - lights.length)
  const lit = pick(pool, lights.map(([p]) => [p[0], p[1] - 7, p[2]] as Vec3), Math.ceil(lightNeed / 2), 16, (p) => p[2] < 0 || (p[2] === 0 && p[0] < 0), s.parts)
  lit.forEach((p, i) => {
    const c = colors[i % colors.length]
    lights.push([[p[0], p[1] + 7, p[2]], c], [[-p[0], p[1] + 7, -p[2]], c])
  })

  return { ...s, markers, lights: lights.slice(0, 64) }
}

// ---------------- cover ----------------

type CoverMaker = (x: number, y: number, z: number, i: number) => Part[]
const BUNKER = [PB.red, PB.blue, PB.yellow, PB.green, PB.orange]
const NEON = [CY.cyan, CY.pink, CY.purple, CY.lime]
const COVER: Record<Theme, CoverMaker> = {
  'Starter': (x, y, z, i) => i % 3 === 0
    ? [box('Crate', [3, 3, 3], [x, y, z], PB.plywood), box('Crate', [3, 3, 3], [x + 3, y, z], PB.plywood), box('Crate', [3, 3, 3], [x + 1.5, y + 3, z], PB.plywood)]
    : i % 3 === 1 ? [box('Concrete block', [6, 2.2, 1.6], [x, y, z], PB.concrete, PB.concrete, (i * 37) % 180)]
      : [cyl('Barrel', 1.6, 2.2, [x, y, z], PB.boxBlue, PB.boxBlue, 12), cyl('Barrel', 1.6, 2.2, [x + 1.8, y, z + 0.6], PB.boxRed, PB.boxRed, 12)],
  'Urban': (x, y, z, i) => [box('Jersey barrier', [8, 2, 1.2], [x, y, z], PB.concrete, PB.concrete, (i * 53) % 180)],
  'Urban paintball': (x, y, z, i) => {
    const t = BUNKER[i % BUNKER.length]
    switch (i % 4) {
      case 0: return [cyl('Can', 3, 3.5, [x, y, z], t)]
      case 1: return [box('Cake', [5, 2.2, 5], [x, y, z], t)]
      case 2: return [cyl('Dorito', 4, 3, [x, y, z], t, t, 3, (i * 41) % 120)]
      default: return [box('Snake', [3, 2.2, 10], [x, y, z], t, t, (i * 29) % 180)]
    }
  },
  'Cyber': (x, y, z, i) => i % 2
    ? [box('Neon block', [4, 2 + (i % 3) * 2, 4], [x, y, z], NEON[i % NEON.length])]
    : [box('Low wall', [8, 2, 1.2], [x, y, z], CY.panelLight, NEON[i % NEON.length], (i * 47) % 180)],
}

/**
 * Fills open floor with theme cover, mirrored for both teams: spots far from
 * everything already there, with room to walk around (and never on stairs,
 * ramps or doorways, which count as "already there").
 */
export function addCover(s: Sample, perArea = 1400): Sample {
  const ground = Math.min(...s.markers.map(([, p]) => p[1]))
  const floor = candidates(s).filter((p) => p[1] === ground)
  if (!floor.length) return s
  const xs = floor.map((p) => p[0]), zs = floor.map((p) => p[2])
  const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs))
  const pairs = Math.round(area / perArea / 2)
  const roomy = (p: Vec3) => !s.parts.some((q) => q.at[1] < p[1] + 4 && q.at[1] + q.size[1] > p[1] + 0.35 && over(q, p[0], p[2], 7))
  const taken = [...s.markers.map(([, p]) => p), ...s.parts.filter((q) => q.at[1] + q.size[1] > ground + 0.35 && Math.max(q.size[0], q.size[2]) < 40).map((q) => q.at)]
  const spots = pick(floor.filter(roomy), taken, pairs, 14, (p) => (p[2] < 0 || (p[2] === 0 && p[0] < 0)) && s.markers.every(([, m]) => d2(m, p) > 8) && roomy(flip(p)), s.parts)
  const make = COVER[s.theme]
  const parts = [...s.parts]
  spots.forEach((p, i) => {
    for (const c of make(p[0], p[1], p[2], i)) {
      parts.push(c, { ...c, at: [-c.at[0], c.at[1], -c.at[2]], rot: ((c.rot ?? 0) + 180) % 360 })
    }
  })
  return { ...s, parts }
}
