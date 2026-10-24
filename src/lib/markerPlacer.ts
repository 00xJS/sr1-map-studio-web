// Where the AI's "spread the spawns out" and "add these weapons" put things: open floor found with the
// map-health height grid (flat ground with no wall or ledge next to it), spread as far apart as the floor
// allows, with red's half (−Z) mirrored onto blue's so the map stays fair.
import { HeightGrid, extentOf, solids, type BoundsFn } from './mapFacts'
import { SPAWN_TYPES, newMarker, type Marker, type Project, type Vec3 } from './project'

const flip = (p: Vec3): Vec3 => [-p[0], p[1], -p[2]]
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]) + Math.abs(a[1] - b[1]) * 2
/** Red's half, plus one side of the middle line (so a spot and its twin are never the same half). */
const redHalf = (p: Vec3) => p[2] < 0 || (p[2] === 0 && p[0] < 0)
/** Yaw facing the middle of the map (yaw 0 faces −Z). */
export const faceMiddle = (p: Vec3) => +((Math.atan2(-p[0], p[2]) * 180) / Math.PI).toFixed(1)
/** The most spots weighed at once; bigger maps are sampled evenly. */
const MAX_POOL = 5000

export interface OpenFloor { spots: Vec3[]; depth: number }

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
  return { spots: every > 1 ? spots.filter((_, n) => n % every === 0) : spots, depth: ex.maxZ - ex.minZ }
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

/**
 * The map's markers with its spawns moved: free-for-all spawns spread over the whole floor, team spawns over
 * their own end (red −Z, blue +Z). `count` is the new total of each kind (shared spawns, or spawns per team);
 * by default the map keeps how many it has. Null when there is no open floor to use.
 */
export function spreadSpawns(p: Project, bounds: BoundsFn | undefined, which: SpawnSet, count?: number): Marker[] | null {
  const { spots, depth } = openFloor(p, bounds)
  if (!spots.length) return null
  const shared = which !== 'team', team = which !== 'shared'
  const moving = (m: Marker) => (shared && m.type === 'Shared spawn') || (team && (m.type === 'Red team spawn' || m.type === 'Blue team spawn'))
  const has = (type: string) => p.markers.filter((m) => m.type === type).length
  const kept = p.markers.filter((m) => !moving(m))
  const away = kept.filter((m) => SPAWN_TYPES.includes(m.type) || m.type === 'Chains drop-off').map((m) => m.position)
  const out = [...kept]
  const add = (type: string, at: Vec3) => { const m = newMarker(type, [at[0], at[1] + 0.1, at[2]]); m.yaw = faceMiddle(at); out.push(m) }
  if (team) {
    const n = Math.max(1, Math.min(16, Math.round(count ?? (has('Red team spawn') || 4))))
    for (const at of farthest(spots, away, n, (q) => q[2] < -depth * 0.2)) { add('Red team spawn', at); add('Blue team spawn', flip(at)); away.push(at, flip(at)) }
  }
  if (shared) {
    const n = Math.max(2, Math.min(32, Math.round(count ?? (has('Shared spawn') || 8))))
    for (const at of farthest(spots, away, Math.ceil(n / 2), redHalf)) { add('Shared spawn', at); add('Shared spawn', flip(at)) }
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
  const ok = (q: Vec3) => redHalf(q) && area(q) && spawns.every((s) => dist(s, q) > u(4))
  const picked = farthest(spots, [...weapons, ...spawns], n, ok)
  // Not enough room there: anywhere on the half.
  return picked.length >= n ? picked : [...picked, ...farthest(spots, [...weapons, ...spawns, ...picked, ...picked.map(flip)], n - picked.length, (q) => redHalf(q) && spawns.every((s) => dist(s, q) > u(4)))]
}
