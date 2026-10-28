// Where the AI's "spread the spawns out" and "add these weapons" put things: open floor found with the
// map-health height grid (flat ground with no wall or ledge next to it), spread as far apart as the floor
// allows, with red's half (−Z) mirrored onto blue's so the map stays fair.
import { HeightGrid, extentOf, solids, type BoundsFn } from './mapFacts'
import { SPAWN_TYPES, newMarker, type Marker, type Project, type Vec3 } from './project'
import { SPAWN_RULES } from './player'
import { openHeading, towardMiddle, type RayTest } from './markerPlan'

const flip = (p: Vec3): Vec3 => [-p[0], p[1], -p[2]]
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]) + Math.abs(a[1] - b[1]) * 2
/** Red's half, plus one side of the middle line (so a spot and its twin are never the same half). */
const redHalf = (p: Vec3) => p[2] < 0 || (p[2] === 0 && p[0] < 0)
/** Yaw facing the middle of the map (yaw 0 faces −Z). */
export const faceMiddle = towardMiddle
/** Standing eye height, metres. */
const EYE_M = 1.62
/** The most spots weighed at once; bigger maps are sampled evenly. */
const MAX_POOL = 5000

export interface OpenFloor { spots: Vec3[]; depth: number; grid: HeightGrid }

/** openHeading's ray test on the height grid: anything standing taller than the line, a step at a time. */
export function gridRay(g: HeightGrid): RayTest {
  return (ax, ay, az, bx, _by, bz) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)))
    for (let s = 1; s <= steps; s++) if (g.at(ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps) > ay) return true
    return false
  }
}

/** Flat, open floor at ground level (not roofs or prop tops): every cell whose neighbours are the same height. */
export function openFloor(p: Project, bounds?: BoundsFn): OpenFloor {
  const u = (metres: number) => metres / (p.settings.world_scale || 0.5)
  const ss = solids(p, bounds)
  const ex = extentOf(p, ss)
  const g = new HeightGrid(ex.minX, ex.minZ, ex.maxX, ex.maxZ, ss)
  const spots: Vec3[] = []
  for (let k = 1; k < g.nz - 1; k++) for (let i = 1; i < g.nx - 1; i++) {
    const h = g.top[k * g.nx + i]
    if (!Number.isFinite(h) || h > g.floorY + u(0.8)) continue
    let flat = true
    for (let a = -1; a <= 1 && flat; a++) for (let b = -1; b <= 1 && flat; b++) flat = Math.abs(g.top[(k + a) * g.nx + i + b] - h) < 0.3
    if (flat) { const [x, z] = g.centre(i, k); spots.push([x, h, z]) }
  }
  const every = Math.ceil(spots.length / MAX_POOL)
  return { spots: every > 1 ? spots.filter((_, n) => n % every === 0) : spots, depth: ex.maxZ - ex.minZ, grid: g }
}

/** `n` spots from the pool, each as far as it can be from the others, their twins and `keepAway`. */
function farthest(pool: Vec3[], keepAway: Vec3[], n: number, ok: (p: Vec3) => boolean): Vec3[] {
  const cand = pool.filter(ok)
  // A spot near the middle line is close to its own twin, too.
  const near = cand.map((c) => keepAway.reduce((m, q) => Math.min(m, dist(c, q)), dist(c, flip(c))))
  const out: Vec3[] = []
  for (let k = 0; k < n && cand.length; k++) {
    let best = -1
    for (let i = 0; i < cand.length; i++) if (best < 0 || near[i] > near[best]) best = i
    if (best < 0 || near[best] < 2) break
    const p = cand[best]
    out.push(p)
    for (let i = 0; i < cand.length; i++) near[i] = Math.min(near[i], dist(cand[i], p), dist(cand[i], flip(p)))
  }
  return out
}

export type SpawnSet = 'shared' | 'team' | 'all'

/** Whether a spot (and its mirror twin) is clear of every busy place by the game's spawn distance: 5 m, unless 5 m above or below. */
function clearOf(busy: Vec3[], scale: number): (q: Vec3) => boolean {
  const near = SPAWN_RULES.enemyM / scale, dy = SPAWN_RULES.enemyDyM / scale
  return (q) => [q, flip(q)].every((s) => busy.every((b) => Math.abs(b[1] - s[1]) >= dy || Math.hypot(b[0] - s[0], b[1] - s[1], b[2] - s[2]) >= near))
}

/** Where players gather: weapon pickups and drop-offs. */
const busyMarkers = (p: Project) => p.markers.filter((m) => m.type === 'Weapon pickup' || m.type === 'Chains drop-off').map((m) => m.position)

/**
 * The map's markers with its spawns moved: free-for-all spawns spread over the whole floor, team spawns over
 * their own end (red −Z, blue +Z). `count` is the new total of each kind (shared spawns, or spawns per team);
 * by default the map keeps how many it has. Null when there is no open floor to use.
 * The game won't use a spawn while an enemy is within 5 m of it, so spawns keep that far from weapons, drop-offs
 * and `hotspots` (the busiest spots from a health check) where the floor allows.
 */
export function spreadSpawns(p: Project, bounds: BoundsFn | undefined, which: SpawnSet, count?: number, hotspots: Vec3[] = []): Marker[] | null {
  const { spots, depth, grid } = openFloor(p, bounds)
  if (!spots.length) return null
  // Each spawn looks the way it sees farthest, the middle of the map where it sees as far (markerPlan.ts).
  const ray = gridRay(grid), eye = EYE_M / (p.settings.world_scale || 0.5)
  const shared = which !== 'team', team = which !== 'shared'
  const moving = (m: Marker) => (shared && m.type === 'Shared spawn') || (team && (m.type === 'Red team spawn' || m.type === 'Blue team spawn'))
  const has = (type: string) => p.markers.filter((m) => m.type === type).length
  const kept = p.markers.filter((m) => !moving(m))
  const away = kept.filter((m) => SPAWN_TYPES.includes(m.type) || m.type === 'Chains drop-off').map((m) => m.position)
  const clear = clearOf([...busyMarkers(p), ...hotspots], p.settings.world_scale || 0.5)
  const out = [...kept]
  const add = (type: string, at: Vec3) => { const m = newMarker(type, [at[0], at[1] + 0.1, at[2]]); m.yaw = openHeading(ray, [at[0], at[1] + eye, at[2]]); out.push(m) }
  /** Clear spots first; if there aren't enough, the rest anywhere allowed. */
  const choose = (n: number, ok: (q: Vec3) => boolean) => {
    const first = farthest(spots, away, n, (q) => ok(q) && clear(q))
    return first.length >= n ? first : [...first, ...farthest(spots, [...away, ...first, ...first.map(flip)], n - first.length, ok)]
  }
  if (team) {
    const n = Math.max(1, Math.min(16, Math.round(count ?? (has('Red team spawn') || 4))))
    for (const at of choose(n, (q) => q[2] < -depth * 0.2)) { add('Red team spawn', at); add('Blue team spawn', flip(at)); away.push(at, flip(at)) }
  }
  if (shared) {
    const n = Math.max(2, Math.min(32, Math.round(count ?? (has('Shared spawn') || 8))))
    for (const at of choose(Math.ceil(n / 2), redHalf)) { add('Shared spawn', at); add('Shared spawn', flip(at)) }
  }
  return out
}

export type WeaponArea = 'middle' | 'spread' | 'ends'

/** Spots on red's half for `n` weapons (their twins go on blue's), off the spawns and apart from other weapons. */
export function weaponSpots(p: Project, bounds: BoundsFn | undefined, n: number, where: WeaponArea = 'spread'): Vec3[] {
  const { spots, depth } = openFloor(p, bounds)
  const u = (metres: number) => metres / (p.settings.world_scale || 0.5)
  const spawns = p.markers.filter((m) => SPAWN_TYPES.includes(m.type)).map((m) => m.position)
  const weapons = p.markers.filter((m) => m.type === 'Weapon pickup').map((m) => m.position)
  const area = where === 'middle' ? (q: Vec3) => Math.abs(q[2]) < depth * 0.18 : where === 'ends' ? (q: Vec3) => q[2] < -depth * 0.25 : () => true
  // At least the game's 5 m from every spawn: someone at a weapon that close stops the spawn being used.
  const offSpawns = (q: Vec3) => spawns.every((s) => dist(s, q) > u(SPAWN_RULES.enemyM))
  const ok = (q: Vec3) => redHalf(q) && area(q) && offSpawns(q)
  const picked = farthest(spots, [...weapons, ...spawns], n, ok)
  // Not enough room there: anywhere on the half.
  return picked.length >= n ? picked : [...picked, ...farthest(spots, [...weapons, ...spawns, ...picked, ...picked.map(flip)], n - picked.length, (q) => redHalf(q) && offSpawns(q))]
}
