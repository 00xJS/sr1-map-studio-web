// Fills a sample map with spawns, weapons, drop-offs and lights, spread evenly
// over the floor players can stand on. More spawns spread far apart mean random
// teams start apart and spawn camping is hard; weapons are scattered everywhere,
// with the strongest nearest the middle. Everything stays point-symmetric, so
// red (−Z) and blue (+Z) get the same chances.
import type { Vec3 } from './project'
import type { MarkerSpec, Sample, Theme } from './sampleKit'
import { blocker, support } from './sampleScale'

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
export function candidates(s: Sample): Vec3[] {
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
  // In the middle band if there's room there, else anywhere away from the ends.
  let drops = pick(pool, [...of('Chains drop-off'), ...spawns()], Math.ceil(dropNeed / 2), 16, (p) => Math.abs(p[2]) < depth * 0.3 && (p[2] < 0 || p[0] < 0), s.parts)
  if (drops.length < Math.ceil(dropNeed / 2)) {
    drops = [...drops, ...pick(pool, [...of('Chains drop-off'), ...spawns(), ...drops, ...drops.map(flip)], Math.ceil(dropNeed / 2) - drops.length, 6, (p) => Math.abs(p[2]) < depth * 0.45 && (p[2] < 0 || p[0] < 0), s.parts)]
  }
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
