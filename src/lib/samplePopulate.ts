// Fills a sample map with spawns, weapons, drop-offs and lights, spread evenly
// over the floor players can stand on. More spawns spread far apart mean random
// teams start apart and spawn camping is hard; weapons are scattered everywhere,
// with the strongest nearest the middle. Everything stays point-symmetric, so
// red (−Z) and blue (+Z) get the same chances.
import type { Vec3 } from './project'
import type { MarkerSpec, Sample, Theme } from './sampleKit'
import { over, partIndex, type PartIndex } from './sampleScale'
import { prepareMap } from './analysis/analyze'
import { nodeNear, PLAYER, twoWay } from './analysis/floor'
import { sampleInput } from './analysis/sampleInput'
import { OPAQUE, SOLID } from './analysis/types'
import type { Bvh } from './analysis/bvh'
import { SPAWN_RULES, UNITS_PER_M } from './player'

const URBAN_POOL = ['rpg_launcher', 'sniper_rifle', 'spas12', 'm16', 'ak47', 'pump_action_shotgun', 'mac10', 'tec9', 'magnum', 'desert eagle', 'glock', 'molotov', 'pipe_bomb', 'grenade', 'baseball_bat', 'beretta']
const CYBER_POOL = ['rpg_laser', 'sniper_rifle', 'spas12', 'ak47L', 'm16', 'mac10L', 'magnumL', 'tec9b', 'desert_eagle_gold', 'grenade', 'pipe_bomb', 'glock']

const LIGHTS: Record<Theme, Vec3[]> = {
  'Starter': [[1, 0.85, 0.65], [0.8, 0.9, 1]],
  'Urban paintball': [[1, 0.82, 0.6], [1, 0.95, 0.85]],
  'Urban': [[1, 0.75, 0.45], [0.75, 0.85, 1], [1, 0.9, 0.7]],
  'Cyber': [[0.2, 0.9, 1], [1, 0.25, 0.85], [0.6, 0.35, 1], [0.5, 1, 0.3]],
}

export interface PopulateTargets {
  shared: number; perTeam: number; weapons: number; drops: number; lights: number
  /**
   * Spawns go to sheltered spots first: ones little of the map can see at eye height (as the health check judges
   * them), before any out in the open. The wizard's maps ask for it.
   */
  shelter?: boolean
}
export const FULL_TARGETS: PopulateTargets = { shared: 20, perTeam: 8, weapons: 22, drops: 4, lights: 24 }

const flip = (p: Vec3): Vec3 => [-p[0], p[1], -p[2]]
const d2 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]) + Math.abs(a[1] - b[1]) * 2
/** Closer than the game's 5 m (and less than 5 m above or below): an enemy there stops a spawn being used. */
const crowding = (a: Vec3, b: Vec3) => Math.abs(a[1] - b[1]) < SPAWN_RULES.enemyDyM * UNITS_PER_M && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < SPAWN_RULES.enemyM * UNITS_PER_M
/** A spot (with its mirror twin) clear of every one of `list` by that much. */
const clearOf = (list: Vec3[], p: Vec3) => list.every((q) => !crowding(q, p) && !crowding(q, flip(p)))
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
  const all = partIndex(s.parts), ground = floor === s.parts ? all : partIndex(floor)
  // Not on top of a kerb or other low ledge (a spawn there sits half in the step).
  // Not under water (a seabed is floor, but nobody spawns or finds a gun down there).
  const wet = s.parts.filter((q) => q.water)
  const underWater = ([x, y, z]: Vec3) => wet.some((q) => q.at[1] + q.size[1] > y + 0.2 && over(q, x, z, 0))
  const open = (p: Vec3) => ground.support(p) >= 0 && !all.blocker(p) && !inKerb(all, p) && !underWater(p)
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
      if (!b || seen.has(k) || all.blocker(way(a, dx, dz, 2))) continue
      if (ground.support(way(a, dx, dz, 2)) < 0 && (ground.support(way(a, dx, dz, 1)) < 0 || ground.support(way(a, dx, dz, 3)) < 0)) continue
      seen.add(k); queue.push(b)
    }
  }
  return [...spots.entries()].filter(([k]) => seen.has(k)).map(([, p]) => p)
}

/** How far a spawn at p sees along a heading at eye height before something solid is in the way (up to `max`). */
function view(parts: PartIndex, p: Vec3, yaw: number, max: number): number {
  const t = (yaw * Math.PI) / 180, eye = p[1] + 3.2
  for (let d = 1; d <= max; d += 0.5) {
    const x = p[0] + Math.sin(t) * d, z = p[2] - Math.cos(t) * d
    if (parts.some(x, z, (q) => q.kind !== 'terrain' && !q.water && q.size[1] > 0.3 && q.at[1] < eye && q.at[1] + q.size[1] > eye - 0.4 && over(q, x, z, 0))) return d
  }
  return max
}

/** A spawn facing a wall turns to the nearest heading with a few metres of open view (point-symmetric maps stay symmetric). */
function aim(parts: PartIndex, p: Vec3, yaw: number): number {
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
const inKerb = (parts: PartIndex, [x, y, z]: Vec3) =>
  parts.some(x, z, (q) => q.size[1] > 0.13 && q.at[1] + q.size[1] > y + 0.01 && q.at[1] + q.size[1] <= y + 0.35 && q.at[1] <= y + 0.01 && over(q, x, z, 0))

/** Farthest-point picks: each new spot is as far as possible from everything already taken (and its mirror is clear too, `mirrorOk`). */
function pick(pool: Vec3[], taken: Vec3[], count: number, minGap: number, ok: (p: Vec3) => boolean, mirrorOk: (p: Vec3) => boolean): Vec3[] {
  const chosen: Vec3[] = []
  // How far each spot and its mirror are from everything taken, kept up to date as spots are picked.
  const flips = pool.map(flip)
  const gap = pool.map((p, i) => {
    const q = flips[i]
    let d = d2(p, q) / 2
    for (const t of taken) d = Math.min(d, d2(t, p), d2(t, q))
    return d
  })
  while (chosen.length < count) {
    let best = -1, bestD = -1
    pool.forEach((p, i) => {
      if (!ok(p) || !mirrorOk(p)) return
      if (gap[i] > bestD) { bestD = gap[i]; best = i }
    })
    if (best < 0 || bestD < minGap) break
    const b = pool[best], fb = flips[best]
    chosen.push(b)
    pool.forEach((p, i) => { gap[i] = Math.min(gap[i], d2(b, p), d2(fb, p), d2(b, flips[i]), d2(fb, flips[i])) })
  }
  return chosen
}

/** Viewpoints spread over the floor that a spot's exposure is measured against. */
const OBSERVERS = 64

/**
 * Share of the floor (OBSERVERS viewpoints spread over `pool`) that sees a player standing at a spot, eye to eye:
 * the health check's exposure, roughly. Worked out once per spot, when asked.
 */
function exposureOf(bvh: Bvh, pool: Vec3[]): (p: Vec3) => number {
  const eye = (p: Vec3): Vec3 => [p[0], p[1] + 0.1 + PLAYER.standEye, p[2]]
  const watchers = pick(pool, [], Math.min(OBSERVERS, pool.length), 0, () => true, () => true).map(eye)
  const memo = new Map<Vec3, number>()
  return (p) => {
    let v = memo.get(p)
    if (v === undefined) {
      const e = eye(p)
      let seen = 0
      for (const w of watchers) if (!bvh.blocked(...w, ...e, OPAQUE)) seen++
      v = seen / Math.max(1, watchers.length)
      memo.set(p, v)
    }
    return v
  }
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
  // Spots players get to and back from on foot: up stairs or a ramp and down again without a fall (twoWay), on the
  // stretch of floor the map's own spawns stand on. Never a roof nobody can climb, or one whose only way off is a fall.
  const two = walk ? twoWay(walk.g) : null
  const home = (() => {
    if (!walk || !two) return -1
    const votes = new Map<number, number>()
    for (const [type, p] of s.markers) {
      if (!/spawn/i.test(type)) continue
      const n = nodeNear(walk.g, p[0], p[1] + 0.1, p[2])
      if (n >= 0) votes.set(two.comp[n], (votes.get(two.comp[n]) ?? 0) + 1)
    }
    let best = -1
    for (const [c, v] of votes) if (best < 0 || v > votes.get(best)! || (v === votes.get(best)! && two.sizes[c] > two.sizes[best])) best = c
    return best >= 0 ? best : two.sizes.indexOf(Math.max(...two.sizes))
  })()
  const reached = (p: Vec3) => {
    if (!walk) return true
    const n = nodeNear(walk.g, p[0], p[1] + 0.1, p[2])
    const P = walk.g.grid.pos
    return n >= 0 && walk.g.grid.reachable[n] === 1 && two!.comp[n] === home && Math.abs(P[n * 3 + 1] - p[1]) < 0.6 && Math.hypot(P[n * 3] - p[0], P[n * 3 + 2] - p[2]) <= 1.5
  }
  const pool = candidates(s, floor).filter((p) => reached(p) && reached(flip(p)))
  if (!pool.length) return s
  const parts = partIndex(s.parts)
  const mirrorClear = new Map<Vec3, boolean>()
  const mirrorOk = (p: Vec3) => {
    let v = mirrorClear.get(p)
    if (v === undefined) { const q = flip(p); v = parts.support(q) >= 0 && !parts.blocker(q); mirrorClear.set(p, v) }
    return v
  }
  const zs = pool.map((p) => p[2])
  const depth = Math.max(...zs) - Math.min(...zs)
  // The layout's own weapons and drop-offs nobody can walk to (on a deck whose stairs went, inside something) go:
  // the weapons are made up below, where players can get to them.
  const markers: MarkerSpec[] = s.markers.filter(([type, p]) => !walk || !/Weapon pickup|Chains drop-off/.test(type) || reached(p))
  const of = (type: string) => markers.filter(([m]) => m === type).map(([, p]) => p)
  const spawns = () => [...of('Shared spawn'), ...of('Red team spawn'), ...of('Blue team spawn')]
  // The map's own weapons and drop-offs within the game's 5 m of a spawn move (with their mirror twins) to the
  // nearest open spot on the same floor that is clear, if there is one within 8 m.
  {
    const own = spawns()
    markers.forEach(([type, p], k) => {
      if ((type !== 'Weapon pickup' && type !== 'Chains drop-off') || clearOf(own, p) || !(p[2] < 0 || (p[2] === 0 && p[0] < 0))) return
      const twin = markers.findIndex(([t, q], j) => j !== k && t === type && Math.abs(q[0] + p[0]) < 0.01 && Math.abs(q[2] + p[2]) < 0.01 && Math.abs(q[1] - p[1]) < 0.01)
      let best: Vec3 | null = null, bestD = 16
      for (const q of pool) {
        const d = Math.hypot(q[0] - p[0], q[2] - p[2])
        if (d >= bestD || Math.abs(q[1] - p[1]) > 0.3 || !clearOf(own, q) || !mirrorOk(q)) continue
        if (markers.some(([t, o], j) => j !== k && j !== twin && /Weapon|drop-off/.test(t) && d2(o, q) < 4)) continue
        best = q; bestD = d
      }
      if (!best) return
      const at = best
      markers[k] = [type, [at[0], p[1], at[2]], markers[k][2]]
      if (twin >= 0) markers[twin] = [type, [-at[0], p[1], -at[2]], markers[twin][2]]
    })
  }
  // Where players gather; spawns keep the game's 5 m from them (and they from spawns).
  const busy = [...of('Weapon pickup'), ...of('Chains drop-off')]
  // How much of the map sees a spot (and its mirror twin): the sheltered ones take spawns first.
  const seen = t.shelter && walk ? exposureOf(walk.bvh, pool) : null
  const sheltered = (limit: number) => (p: Vec3) => !seen || Math.max(seen(p), seen(flip(p))) <= limit

  // Team spawns: spread across each team's end of the map, out of sight of the other team's spawns where there's room.
  const eye = (p: Vec3) => [p[0], p[1] + 0.1 + PLAYER.standEye, p[2]]
  const hidden = (p: Vec3) => !walk || of('Blue team spawn').concat([flip(p)]).every((b) => walk.bvh.blocked(...(eye(b) as Vec3), ...(eye(p) as Vec3), OPAQUE))
  // Hidden spots first, closer together (2 m, the game's spawn box) before any in sight of the enemy.
  // Off the weapons and drop-offs by the game's 5 m too, unless there is no room left that way.
  const teamPasses = [[true, 6, true, 0.12], [true, 4, true, 0.2], [true, 6, true, 1], [true, 4, true, 1], [false, 6, true, 1], [false, 6, false, 1]] as const
  for (const [strict, gap, clear, open] of seen ? teamPasses : teamPasses.filter(([, , , o]) => o === 1)) {
    const cover = sheltered(open)
    for (let need = t.perTeam - of('Red team spawn').length; need > 0; need--) {
      const [p] = pick(pool, of('Red team spawn'), 1, gap, (q) => q[2] < -depth * 0.3 && (!clear || clearOf(busy, q)) && (!strict || hidden(q)) && cover(q), mirrorOk)
      if (!p) break
      markers.push(['Red team spawn', p, { yaw: 180 }], ['Blue team spawn', flip(p), { yaw: 0 }])
    }
  }

  // Free-for-all spawns: everywhere, as far apart as possible.
  const sharedNeed = Math.max(0, t.shared - of('Shared spawn').length)
  const sharedOk = (p: Vec3) => p[2] < 0 || (p[2] === 0 && p[0] < 0)
  let shared: Vec3[] = []
  // Sheltered spots first (a little closer together if that's what it takes), then anywhere. Each out of sight of
  // most of the spawns already placed (and its own twin), as few as it takes: the health check calls a shared spawn
  // six others can see easy to camp.
  const seenBy = (p: Vec3) => [...spawns(), ...shared, ...shared.map(flip), flip(p)]
    .filter((q) => !walk!.bvh.blocked(...(eye(q) as Vec3), ...(eye(p) as Vec3), OPAQUE)).length
  if (seen) for (const [open, gap, views] of [[0.12, 12, 2], [0.2, 12, 3], [0.2, 9, 4], [0.12, 12, Infinity], [0.2, 12, Infinity], [0.2, 9, Infinity]] as const) {
    while (shared.length < Math.ceil(sharedNeed / 2)) {
      const [p] = pick(pool, [...spawns(), ...of('Chains drop-off'), ...shared, ...shared.map(flip)], 1, gap, (q) => sharedOk(q) && clearOf(busy, q) && sheltered(open)(q) && (views === Infinity || seenBy(q) <= views), mirrorOk)
      if (!p) break
      shared.push(p)
    }
  }
  if (shared.length < Math.ceil(sharedNeed / 2)) shared.push(...pick(pool, [...spawns(), ...of('Chains drop-off'), ...shared, ...shared.map(flip)], Math.ceil(sharedNeed / 2) - shared.length, 12, (p) => sharedOk(p) && clearOf(busy, p), mirrorOk))
  if (shared.length < Math.ceil(sharedNeed / 2)) shared = [...shared, ...pick(pool, [...spawns(), ...of('Chains drop-off'), ...shared, ...shared.map(flip)], Math.ceil(sharedNeed / 2) - shared.length, 12, sharedOk, mirrorOk)]
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
      (p) => Math.abs(p[2]) < depth * band && (p[2] < 0 || p[0] < 0) && clearOf(spawns(), p) && (gap < 24 || offSpawns(p)), mirrorOk))
  }
  for (const p of drops) markers.push(['Chains drop-off', p], ['Chains drop-off', flip(p)])

  // Weapons: scattered everywhere, not on top of spawns; the strongest closest to the middle.
  const weaponNeed = Math.max(0, t.weapons - of('Weapon pickup').length)
  const away = spawns()
  const weaponOk = (p: Vec3) => (p[2] < 0 || (p[2] === 0 && p[0] < 0)) && away.every((a) => d2(a, p) > 8) && clearOf(away, p)
  let spots = pick(pool, [...of('Weapon pickup'), ...away], Math.ceil(weaponNeed / 2), 10, weaponOk, mirrorOk)
  // Closer together on small maps, if that's what it takes.
  if (spots.length < Math.ceil(weaponNeed / 2)) spots = [...spots, ...pick(pool, [...of('Weapon pickup'), ...away, ...spots, ...spots.map(flip)], Math.ceil(weaponNeed / 2) - spots.length, 6, weaponOk, mirrorOk)]
  // Still short: nearer the spawns than the game's 5 m.
  const nearOk = (p: Vec3) => (p[2] < 0 || (p[2] === 0 && p[0] < 0)) && away.every((a) => d2(a, p) > 8)
  if (spots.length < Math.ceil(weaponNeed / 2)) spots = [...spots, ...pick(pool, [...of('Weapon pickup'), ...away, ...spots, ...spots.map(flip)], Math.ceil(weaponNeed / 2) - spots.length, 6, nearOk, mirrorOk)]
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
  const lit = pick(pool, lights.map(([p]) => [p[0], p[1] - 7, p[2]] as Vec3), Math.ceil(lightNeed / 2), 16, (p) => p[2] < 0 || (p[2] === 0 && p[0] < 0), mirrorOk)
  lit.forEach((p, i) => {
    const c = colors[i % colors.length]
    lights.push([[p[0], p[1] + 7, p[2]], c], [[-p[0], p[1] + 7, -p[2]], c])
  })

  const aimed = markers.map(([type, p, patch]): MarkerSpec => (/spawn/i.test(type) ? [type, p, { ...patch, yaw: aim(parts, p, patch?.yaw ?? 0) }] : [type, p, patch]))
  // Nobody starts nose to a wall: spawns looking into one turn toward the nearest open view.
  const faced = walk ? aimed.map(([type, p, m]): MarkerSpec => (m?.yaw !== undefined && /spawn/.test(type) ? [type, p, { ...m, yaw: openYaw(walk.bvh, p, m.yaw) }] : [type, p, m])) : aimed
  return { ...s, markers: faced, lights: lights.slice(0, 64) }
}
