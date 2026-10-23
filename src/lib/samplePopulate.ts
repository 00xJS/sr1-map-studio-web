// Fills a sample map with spawns, weapons, drop-offs and lights, spread evenly
// over the floor players can stand on. More spawns spread far apart mean random
// teams start apart and spawn camping is hard; weapons are scattered everywhere,
// with the strongest nearest the middle. Everything stays point-symmetric, so
// red (−Z) and blue (+Z) get the same chances.
import type { Vec3 } from './project'
import type { MarkerSpec, Sample, Theme } from './sampleKit'
import { blocker, over, support } from './sampleScale'
import { prepareMap } from './analysis/analyze'
import { nodeNear, PLAYER } from './analysis/floor'
import { sampleInput } from './analysis/sampleInput'
import { OPAQUE, SOLID } from './analysis/types'
import type { Bvh } from './analysis/bvh'

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

/**
 * Spots players can stand on: a 4-unit grid over the map, at the heights the map's own markers use, joined
 * to one of those markers (known to be reachable) over open floor, so nothing lands on a roof or a prop top
 * nobody can climb. `floor` is what counts as floor (default: every part; the samples pass the map from
 * before dressing, so nothing stands on a dressed prop).
 */
export function candidates(s: Sample, floor: Sample['parts'] = s.parts): Vec3[] {
  const heights = [...new Set(s.markers.map(([, p]) => p[1]))]
  const xs = s.parts.flatMap((p) => [p.at[0] - p.size[0], p.at[0] + p.size[0]])
  const zs = s.parts.flatMap((p) => [p.at[2] - p.size[2], p.at[2] + p.size[2]])
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  // Not on top of a kerb or other low ledge (a spawn there sits half in the step).
  const open = (p: Vec3) => support(floor, p) >= 0 && !blocker(s.parts, p) && !inKerb(s.parts, p)
  const spots = new Map<string, Vec3>()
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`
  for (let x = Math.ceil(x0 / 4) * 4; x <= x1; x += 4) for (let z = Math.ceil(z0 / 4) * 4; z <= z1; z += 4) for (const y of heights) {
    const p: Vec3 = [x, y, z]
    if (open(p)) spots.set(key(x, y, z), p)
  }
  // Walk out from the markers to neighbouring spots, across floor (or a gap small enough to step over) with nothing in the way.
  const seen = new Set<string>(), queue: Vec3[] = []
  for (const [, m] of s.markers) for (const p of spots.values()) {
    const k = key(...p)
    if (p[1] === m[1] && Math.hypot(p[0] - m[0], p[2] - m[2]) <= 4.5 && !seen.has(k)) { seen.add(k); queue.push(p) }
  }
  const way = (a: Vec3, dx: number, dz: number, t: number): Vec3 => [a[0] + dx * t, a[1], a[2] + dz * t]
  while (queue.length) {
    const a = queue.pop()!
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = key(a[0] + dx * 4, a[1], a[2] + dz * 4), b = spots.get(k)
      if (!b || seen.has(k) || blocker(s.parts, way(a, dx, dz, 2))) continue
      if (support(floor, way(a, dx, dz, 2)) < 0 && (support(floor, way(a, dx, dz, 1)) < 0 || support(floor, way(a, dx, dz, 3)) < 0)) continue
      seen.add(k); queue.push(b)
    }
  }
  return [...spots.entries()].filter(([k]) => seen.has(k)).map(([, p]) => p)
}

/** How far a spawn at p sees along a heading at eye height before something solid is in the way (up to `max`). */
function view(parts: Sample['parts'], p: Vec3, yaw: number, max: number): number {
  const t = (yaw * Math.PI) / 180, eye = p[1] + 3.2
  for (let d = 1; d <= max; d += 0.5) {
    const x = p[0] + Math.sin(t) * d, z = p[2] - Math.cos(t) * d
    if (parts.some((q) => q.kind !== 'terrain' && !q.water && q.size[1] > 0.3 && q.at[1] < eye && q.at[1] + q.size[1] > eye - 0.4 && over(q, x, z, 0))) return d
  }
  return max
}

/** A spawn facing a wall turns to the nearest heading with a few metres of open view (point-symmetric maps stay symmetric). */
function aim(parts: Sample['parts'], p: Vec3, yaw: number): number {
  if (view(parts, p, yaw, 8) >= 8) return yaw
  let best = yaw, far = 0
  for (let k = 1; k <= 12; k++) for (const sign of [1, -1]) {
    const y = yaw + sign * k * 15, d = view(parts, p, y, 8)
    if (d >= 8) return +(((y + 540) % 360) - 180).toFixed(1)
    if (d > far) { far = d; best = y }
  }
  return +(((best + 540) % 360) - 180).toFixed(1)
}

/** Standing inside a kerb or raised sidewalk (its top a step above the feet): the spot belongs to the higher floor. */
const inKerb = (parts: Sample['parts'], [x, y, z]: Vec3) =>
  parts.some((q) => q.size[1] > 0.13 && q.at[1] + q.size[1] > y + 0.01 && q.at[1] + q.size[1] <= y + 0.35 && q.at[1] <= y + 0.01 && over(q, x, z, 0))

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

/** Heading (yaw 0 faces −Z) turned the least from `yaw` that looks down open floor rather than into a wall. */
function openYaw(bvh: Bvh, p: Vec3, yaw: number): number {
  const eye = p[1] + 0.1 + PLAYER.standEye
  const clear = (a: number, len: number) => { const t = (a * Math.PI) / 180; return !bvh.blocked(p[0], eye, p[2], p[0] + Math.sin(t) * len, eye, p[2] - Math.cos(t) * len, SOLID) }
  const turns = [0, ...[...Array(12)].flatMap((_, i) => [15 * (i + 1), -15 * (i + 1)])]
  for (const len of [12, 6]) for (const d of turns) if (clear(yaw + d, len)) return +(((yaw + d + 540) % 360) - 180).toFixed(1)
  return yaw
}

/** `floor`: the map's floor before dressing (see candidates). */
export function populate(s: Sample, t: PopulateTargets = FULL_TARGETS, floor: Sample['parts'] = s.parts): Sample {
  // Only spots a player can walk to from the map's own spawns: not the top of a tall crate or a ledge with no way up.
  const walk = s.markers.length ? prepareMap(sampleInput(s), { cell: 2 }) : null
  const reached = (p: Vec3) => {
    if (!walk) return true
    const n = nodeNear(walk.g, p[0], p[1] + 0.1, p[2])
    const P = walk.g.grid.pos
    return n >= 0 && walk.g.grid.reachable[n] === 1 && Math.abs(P[n * 3 + 1] - p[1]) < 0.6 && Math.hypot(P[n * 3] - p[0], P[n * 3 + 2] - p[2]) <= 1.5
  }
  const pool = candidates(s, floor).filter((p) => reached(p) && reached(flip(p)))
  if (!pool.length) return s
  const zs = pool.map((p) => p[2])
  const depth = Math.max(...zs) - Math.min(...zs)
  const markers: MarkerSpec[] = [...s.markers]
  const of = (type: string) => markers.filter(([m]) => m === type).map(([, p]) => p)
  const spawns = () => [...of('Shared spawn'), ...of('Red team spawn'), ...of('Blue team spawn')]

  // Team spawns: spread across each team's end of the map, out of sight of the other team's spawns where there's room.
  const eye = (p: Vec3) => [p[0], p[1] + 0.1 + PLAYER.standEye, p[2]]
  const hidden = (p: Vec3) => !walk || of('Blue team spawn').concat([flip(p)]).every((b) => walk.bvh.blocked(...(eye(b) as Vec3), ...(eye(p) as Vec3), OPAQUE))
  for (const strict of [true, false]) {
    for (let need = t.perTeam - of('Red team spawn').length; need > 0; need--) {
      const [p] = pick(pool, of('Red team spawn'), 1, 6, (q) => q[2] < -depth * 0.3 && (!strict || hidden(q)), s.parts)
      if (!p) break
      markers.push(['Red team spawn', p, { yaw: 180 }], ['Blue team spawn', flip(p), { yaw: 0 }])
    }
  }

  // Free-for-all spawns: everywhere, as far apart as possible.
  const sharedNeed = Math.max(0, t.shared - of('Shared spawn').length)
  const shared = pick(pool, [...spawns(), ...of('Chains drop-off')], Math.ceil(sharedNeed / 2), 12, (p) => p[2] < 0 || (p[2] === 0 && p[0] < 0), s.parts)
  for (const p of shared) markers.push(['Shared spawn', p, { yaw: lookAtCenter(p) }], ['Shared spawn', flip(p), { yaw: lookAtCenter(flip(p)) }])

  // Chains drop-offs: the drop-off moves between them during the match, so they sit well apart from each other
  // (20 m where there's room), off the spawns, in the middle band if there's room there, else anywhere away from the ends.
  // Only maps with a mode that uses them (Big Ass Chains, or Blinged Out Ride's cash drop-off).
  const usesDrops = s.modes.some((m) => m.includes('Chains') || m === 'Blinged Out Ride')
  const dropNeed = usesDrops ? Math.ceil(Math.max(0, t.drops - of('Chains drop-off').length) / 2) : 0
  const offSpawns = (p: Vec3) => spawns().every((q) => d2(q, p) >= 16 && d2(q, flip(p)) >= 16)
  const drops: Vec3[] = []
  for (const [band, gap] of [[0.3, 40], [0.45, 40], [0.7, 40], [0.45, 24], [0.45, 6]]) {
    if (drops.length >= dropNeed) break
    drops.push(...pick(pool, [...of('Chains drop-off'), ...drops, ...drops.map(flip)], dropNeed - drops.length, gap,
      (p) => Math.abs(p[2]) < depth * band && (p[2] < 0 || p[0] < 0) && (gap < 24 || offSpawns(p)), s.parts))
  }
  for (const p of drops) markers.push(['Chains drop-off', p], ['Chains drop-off', flip(p)])

  // Weapons: scattered everywhere, not on top of spawns; the strongest closest to the middle.
  const weaponNeed = Math.max(0, t.weapons - of('Weapon pickup').length)
  const away = spawns()
  const weaponOk = (p: Vec3) => (p[2] < 0 || (p[2] === 0 && p[0] < 0)) && away.every((a) => d2(a, p) > 8)
  let spots = pick(pool, [...of('Weapon pickup'), ...away], Math.ceil(weaponNeed / 2), 10, weaponOk, s.parts)
  // Closer together on small maps, if that's what it takes.
  if (spots.length < Math.ceil(weaponNeed / 2)) spots = [...spots, ...pick(pool, [...of('Weapon pickup'), ...away, ...spots, ...spots.map(flip)], Math.ceil(weaponNeed / 2) - spots.length, 6, weaponOk, s.parts)]
  spots.sort((a, b) => Math.hypot(a[0], a[2]) - Math.hypot(b[0], b[2]))
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

  const aimed = markers.map(([type, p, patch]): MarkerSpec => (/spawn/i.test(type) ? [type, p, { ...patch, yaw: aim(s.parts, p, patch?.yaw ?? 0) }] : [type, p, patch]))
  // Nobody starts nose to a wall: spawns looking into one turn toward the nearest open view.
  const faced = walk ? aimed.map(([type, p, m]): MarkerSpec => (m?.yaw !== undefined && /spawn/.test(type) ? [type, p, { ...m, yaw: openYaw(walk.bvh, p, m.yaw) }] : [type, p, m])) : aimed
  return { ...s, markers: faced, lights: lights.slice(0, 64) }
}
