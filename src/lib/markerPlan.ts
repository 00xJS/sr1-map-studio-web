// Spawns and weapons where players can use them, on any map (a converted map, a cut of the city, one opened from
// its folder), from its real collision: the health check's floor grid (analysis/floor.ts). A spawn or weapon is
// usable when it stands on the main walkable floor (the stretch its own markers stand on, not a sealed room, a
// roof with no way up or the inside of a wall), with headroom and a step of floor round it. Ones that aren't move to
// the nearest spot that is; then free-for-all spawns are added (out of sight of most of the map first, spread far
// apart) and weapons (spread out, off the spawns) up to the counts asked for. Pure: the editor runs it (spawnActions.ts).
import type { Vec3 } from './project'
import type { Prepared } from './analysis/analyze'
import { nodeNear, PLAYER, twoWay } from './analysis/floor'
import { OPAQUE, SOLID } from './analysis/types'

/** Kinds of marker that have to stand where a player can get to. */
export const PLACED = ['Shared spawn', 'Red team spawn', 'Blue team spawn', 'Weapon pickup', 'Chains drop-off']
const SPAWNS = new Set(PLACED.slice(0, 3))

/** Weapons added, in turn: the common ones first, one of each heavy one. */
export const WEAPON_ORDER = ['ak47', 'pump_action_shotgun', 'm16', 'mac10', 'tec9', 'magnum', 'spas12', 'sniper_rifle', 'molotov', 'pipe_bomb', 'grenade', 'rpg_launcher', 'desert eagle', 'baseball_bat', 'glock', 'beretta']

/** Viewpoints a spot's exposure is measured from. */
const OBSERVERS = 64
/** Least floor links round a spot (of 8): not on the edge of a drop or a ledge. */
const SOLID_FOOTING = 7
/** How far off its floor (units across, and up or down) a marker still counts as standing on it. */
const ON_FLOOR: [number, number] = [1.5, 0.6]

export interface PlanMarker { type: string; position: Vec3; weapon?: string }

export interface MarkerPlan {
  /** Markers (index into the list given) moved, and where to. */
  moved: { index: number; to: Vec3; why: string }[]
  added: { type: string; at: Vec3; yaw: number; weapon?: string }[]
  /** Usable floor spots found (0: no floor at all). */
  floor: number
}

export interface PlanOptions {
  /** Free-for-all spawns the map should have, and weapons. */
  spawns: number
  weapons: number
  /** Least gap between spawns, and from a spawn to a weapon (units). */
  spawnGap?: number
  weaponGap?: number
}

export function planMarkers(p: Prepared, markers: PlanMarker[], o: PlanOptions): MarkerPlan {
  const { g, bvh } = p
  const P = g.grid.pos, N = g.grid.count
  if (!N) return { moved: [], added: [], floor: 0 }
  // Stretches of floor players get round both ways (up stairs or a ramp, and back down without a fall).
  const { comp, sizes } = twoWay(g)
  // The main one is the stretch the map's own spawns and weapons stand on (the most of them), then the biggest: a
  // catch-all plane under the map can be bigger than the map itself.
  const votes = new Array(sizes.length).fill(0)
  for (const m of markers) {
    if (!PLACED.includes(m.type)) continue
    const n = nodeNear(g, ...m.position)
    if (n >= 0 && Math.abs(m.position[1] - P[n * 3 + 1]) <= ON_FLOOR[1]) votes[comp[n]] += SPAWNS.has(m.type) ? 2 : 1
  }
  let main = 0
  for (let c = 1; c < sizes.length; c++) if (votes[c] > votes[main] || (votes[c] === votes[main] && sizes[c] > sizes[main])) main = c
  const usable = (n: number) => comp[n] === main && !g.grid.crouchOnly[n] && g.edgeStart[n + 1] - g.edgeStart[n] >= SOLID_FOOTING
  const good: number[] = []
  for (let n = 0; n < N; n++) if (usable(n)) good.push(n)
  if (!good.length) return { moved: [], added: [], floor: 0 }
  const at = (n: number): Vec3 => [P[n * 3], +(P[n * 3 + 1] + 0.1).toFixed(3), P[n * 3 + 2]]
  const dist = (a: Vec3, n: number) => Math.hypot(a[0] - P[n * 3], a[2] - P[n * 3 + 2]) + Math.abs(a[1] - P[n * 3 + 1]) * 2

  const taken: Vec3[] = markers.filter((m) => PLACED.includes(m.type)).map((m) => m.position)
  const moved: MarkerPlan['moved'] = []
  markers.forEach((m, index) => {
    if (!PLACED.includes(m.type)) return
    const [x, y, z] = m.position
    const n = nodeNear(g, x, y, z)
    const on = n >= 0 && Math.hypot(x - P[n * 3], z - P[n * 3 + 2]) <= ON_FLOOR[0] && Math.abs(y - P[n * 3 + 1]) <= ON_FLOOR[1]
    // One placed by hand stays where it is while players can stand there (by a ledge too); new ones keep off edges.
    if (on && comp[n] === main && !g.grid.crouchOnly[n]) return
    const why = n < 0 || !on ? 'not on any floor (in the air, under the map or inside something)'
      : comp[n] !== main ? 'on floor players can\'t walk to from the rest of the map' : 'with only room to crouch'
    // The nearest usable spot not on top of another marker.
    let best = -1, bestD = Infinity
    for (const q of good) {
      const d = dist(m.position, q)
      if (d >= bestD) continue
      if (taken.some((t) => t !== m.position && Math.hypot(t[0] - P[q * 3], t[2] - P[q * 3 + 2]) < 2)) continue
      best = q; bestD = d
    }
    if (best < 0) return
    const to = at(best)
    taken[taken.indexOf(m.position)] = to
    moved.push({ index, to, why })
  })

  // How much of the floor sees a spot (eye to eye): sheltered spots take spawns first.
  const eye = (n: number): Vec3 => [P[n * 3], P[n * 3 + 1] + 0.1 + PLAYER.standEye, P[n * 3 + 2]]
  const watchers = spread(good, [], Math.min(OBSERVERS, good.length), 0, P).map(eye)
  const seen = new Map<number, number>()
  const exposure = (n: number) => {
    let v = seen.get(n)
    if (v === undefined) {
      const e = eye(n)
      let k = 0
      for (const w of watchers) if (!bvh.blocked(...w, ...e, OPAQUE)) k++
      v = k / Math.max(1, watchers.length)
      seen.set(n, v)
    }
    return v
  }

  const added: MarkerPlan['added'] = []
  const spawnGap = o.spawnGap ?? 16, weaponGap = o.weaponGap ?? 10
  const after = (type: (t: string) => boolean) => [
    ...markers.flatMap((m, i) => (type(m.type) ? [moved.find((x) => x.index === i)?.to ?? m.position] : [])),
    ...added.filter((a) => type(a.type)).map((a) => a.at),
  ]
  const spawnsNow = () => after((t) => SPAWNS.has(t))
  const weaponsNow = () => after((t) => t === 'Weapon pickup' || t === 'Chains drop-off')
  // Free-for-all spawns: sheltered and far apart first, then closer, then anywhere usable.
  const shared = markers.filter((m) => m.type === 'Shared spawn').length
  for (const [limit, gap] of [[0.15, spawnGap], [0.25, spawnGap], [0.25, spawnGap * 0.6], [1, spawnGap * 0.6]] as const) {
    const need = o.spawns - shared - added.length
    if (need <= 0) break
    const near = weaponsNow()
    const ok = good.filter((n) => exposure(n) <= limit && near.every((w) => Math.hypot(w[0] - P[n * 3], w[2] - P[n * 3 + 2]) >= weaponGap))
    for (const n of spread(ok, spawnsNow(), need, gap, P)) added.push({ type: 'Shared spawn', at: at(n), yaw: openHeading(bvh, eye(n)) })
  }
  // Weapons: spread over the floor, off the spawns.
  const have = markers.filter((m) => m.type === 'Weapon pickup').length
  for (const gap of [24, 14, 8]) {
    const need = o.weapons - have - added.filter((a) => a.type === 'Weapon pickup').length
    if (need <= 0) break
    const sp = spawnsNow()
    const ok = good.filter((n) => sp.every((s) => Math.hypot(s[0] - P[n * 3], s[2] - P[n * 3 + 2]) >= weaponGap))
    for (const n of spread(ok, [...weaponsNow(), ...sp], need, gap, P)) {
      const k = have + added.filter((a) => a.type === 'Weapon pickup').length
      added.push({ type: 'Weapon pickup', at: at(n), yaw: 0, weapon: WEAPON_ORDER[k % WEAPON_ORDER.length] })
    }
  }
  return { moved, added, floor: good.length }
}

/** Farthest-point picks from `pool` (floor nodes): each as far as possible from everything taken, at least `gap` away. */
function spread(pool: number[], taken: Vec3[], count: number, gap: number, P: Float32Array): number[] {
  const out: number[] = []
  const d = pool.map((n) => taken.reduce((m, t) => Math.min(m, Math.hypot(t[0] - P[n * 3], t[2] - P[n * 3 + 2]) + Math.abs(t[1] - P[n * 3 + 1]) * 2), Infinity))
  while (out.length < count) {
    let best = -1
    for (let i = 0; i < pool.length; i++) if (best < 0 || d[i] > d[best]) best = i
    if (best < 0 || d[best] < gap) break
    const n = pool[best]
    out.push(n)
    for (let i = 0; i < pool.length; i++) {
      const q = pool[i]
      d[i] = Math.min(d[i], Math.hypot(P[n * 3] - P[q * 3], P[n * 3 + 2] - P[q * 3 + 2]) + Math.abs(P[n * 3 + 1] - P[q * 3 + 1]) * 2)
    }
  }
  return out
}

/** The heading (degrees, 0 = facing −Z as the editor's spawns do) with the longest clear view at eye height. */
function openHeading(bvh: Prepared['bvh'], e: Vec3): number {
  let best = 0, far = -1
  for (let k = 0; k < 8; k++) {
    const a = k * 45, t = (a * Math.PI) / 180
    let d = 2
    while (d <= 24 && !bvh.blocked(e[0], e[1], e[2], e[0] + Math.sin(t) * d, e[1], e[2] - Math.cos(t) * d, SOLID)) d += 2
    if (d > far) { far = d; best = a }
  }
  return best > 180 ? best - 360 : best
}
