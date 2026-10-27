// The map wizard's dressing for Game pieces maps, from the game's own models and the game's own habits (areaKits.ts):
// what Stilwater stands along a building's front, in an alley and out on open ground, sized by each model's real
// measurements rather than by the site's prefabs. Three passes over red's half (each piece mirrored for blue):
//
// 1. Spawn screens: a row of cover across the front of the spawn strip, with gaps to run through, so the spawns at
//    the end of the map aren't in plain view of the middle.
// 2. Fronts and alleys: along each building's walls, a step out from them, things the game keeps there, backs to the
//    wall; where another wall stands close behind (an alley), the alley's own things.
// 3. Open ground: cover, farthest from everything first, until the floor carries the retail maps' cover density.
//
// The pieces come from anything with the six methods of DressPieces: the player's game library (wizardPieces.ts) or
// the site's own prefabs (siteKit.ts), so a Site pieces map is dressed the same way.
import type { Vec3 } from '../project'
import type { Part, Sample } from '../sampleKit'
import { turn } from '../sampleKit'
import { over, partIndex } from '../sampleScale'
import { candidates } from '../samplePopulate'
import { UNITS_PER_M } from '../player'
import { COVER_PER_1000, SIDEWALK_EVERY, type AreaKit, type KitItem } from './areaKits'
import { facingVec } from './wizardPieces'
import type { Side } from './cityModules'

const M = UNITS_PER_M
/** A building's wall, for the fronts: at least this tall and long (units). */
const WALL_H = 6, WALL_LONG = 6
/** Room kept round each piece (units), and off markers. */
const GAP = 1.5, OFF_MARKERS = 3
/** Gaps between buildings up to this wide (units, wall to wall) are alleys. */
const ALLEY = 16
/** Open ground: at least this far from any wall (units). */
const OPEN = 8

/** What each list may hold, in metres: things for a sidewalk or an alley stay small; cover is something to hide behind. */
const SIZE = {
  sidewalk: { long: 3.5, h: [0.4, 2.6] },
  alley: { long: 4.5, h: [0.4, 2.6] },
  cover: { long: 12, h: [0.9, 3.5] },
  // In front of a spawn: taller than a standing player's eyes, and wide enough to hide behind.
  screen: { long: 12, h: [1.8, 3.5] },
} as const

export interface DressStats { screens: number; fronts: number; alleys: number; cover: number; wanted: number }

/** A piece the dressing can pick: metres (long side, short side, height) and the cover it gives (catalog.ts's). */
export interface DressCand { long: number; short: number; h: number; cat: { measures: { cover: { value: string } } } }

/** What the dressing asks of its pieces, by identify()'s names (areaKits.ts). */
export interface DressPieces<C extends DressCand = DressCand> {
  /** Whether anything goes by that name. */
  hasNamed(name: string): boolean
  /** The most cover anything under that name gives. */
  coverOf(name: string): 'none' | 'crouch' | 'stand'
  /** One under that name that `fit` likes best (0: won't do), or null. Not counted until commit(). */
  named(name: string, fit: (c: C) => number): C | null
  /** Which of its sides is its front, in the game's frame, when it has one. */
  frontOf(c: C): Side | undefined
  /** Its parts at a spot (its long side along X turned rot), or null when it can't stand there. */
  place(c: C, label: string, at: Vec3, rot: number, parts: Part[]): Part[] | null
  /** Counts one that was placed (both halves). */
  commit(c: C): void
  /** What the last dressing placed. */
  dressed?: DressStats
}

/**
 * Dresses a Game pieces map from the area kit. `busy` is the wizard's 0..100. Returns the map with the stand-ins
 * added (red's half and their mirror twins); markers are left as they are.
 */
export function gameDress<C extends DressCand>(s: Sample, pieces: DressPieces<C>, kit: AreaKit, busy: number, seed: number, stats?: DressStats): Sample {
  const floor = candidates(s)
  if (!floor.length) return s
  const ground = Math.min(...floor.map((p) => p[1]))
  const red = floor.filter((p) => p[1] === ground && (p[2] < 0 || (p[2] === 0 && p[0] < 0)))
  const base = partIndex(s.parts)
  // What this pass places, filed by 8-unit squares (what is near a spot is asked thousands of times).
  const added: Part[] = []
  const cells = new Map<string, Part[]>()
  const cellKey = (x: number, z: number) => `${Math.floor(x / 8)},${Math.floor(z / 8)}`
  const file = (q: Part) => {
    added.push(q)
    // Filed wherever a question about a spot within reach of it (its room, a cover spacing) could be asked.
    const r = Math.hypot(q.size[0], q.size[2]) / 2 + 7
    for (let cx = Math.floor((q.at[0] - r) / 8); cx <= Math.floor((q.at[0] + r) / 8); cx++) for (let cz = Math.floor((q.at[2] - r) / 8); cz <= Math.floor((q.at[2] + r) / 8); cz++) {
      const k = `${cx},${cz}`, l = cells.get(k)
      if (l) l.push(q); else cells.set(k, [q])
    }
  }
  const nearby = (x: number, z: number) => cells.get(cellKey(x, z)) ?? NONE
  const markers = s.markers.map(([, p]) => p)
  const walls = s.parts.filter((q) => !q.water && q.size[1] >= WALL_H && Math.max(q.size[0], q.size[2]) >= WALL_LONG && q.at[1] <= ground + 0.5
    && q.size[0] * q.size[2] < 0.5 * extentArea(s.parts))
  const out = stats ?? { screens: 0, fronts: 0, alleys: 0, cover: 0, wanted: 0 }
  pieces.dressed = out
  let h = (seed >>> 0) || 1
  const rand = () => { h = (Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0; return h / 2 ** 32 }

  // Something in the way of a footprint at p (half extents hx, hz along its own axes, turned rot, up to height ht).
  const inWay = (q: Part, x: number, z: number, m: number, ht: number) => !q.water && q.size[1] > 0.3 && q.at[1] < ground + Math.max(4, ht + 0.5)
    && q.at[1] + q.size[1] > ground + 0.35 && over(q, x, z, m)
  const roomy = (p: Vec3, hx: number, hz: number, rot: number, ht: number) => {
    const pts: [number, number][] = [[0, 0]]
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) if (a || b) pts.push([a * hx, b * hz])
    for (const [lx, lz] of pts) {
      const [dx, dz] = turn(lx, lz, rot), x = p[0] + dx, z = p[2] + dz
      if (base.some(x, z, (q) => inWay(q, x, z, GAP, ht)) || nearby(x, z).some((q) => inWay(q, x, z, GAP, ht))) return false
      // Floor under every corner.
      if ((a(lx) || a(lz)) && base.support([x, ground, z]) < 0) return false
    }
    // Every marker clear of its footprint by a few units.
    return markers.every((m) => {
      if (Math.abs(m[1] - p[1]) > 3) return true
      const t = (rot * Math.PI) / 180, dx = m[0] - p[0], dz = m[2] - p[2]
      const lx = dx * Math.cos(t) - dz * Math.sin(t), lz = dx * Math.sin(t) + dz * Math.cos(t)
      return Math.abs(lx) > hx + OFF_MARKERS || Math.abs(lz) > hz + OFF_MARKERS
    })
  }
  const a = (v: number) => Math.abs(v) > 1e-6

  /** Places a kit piece at p turned rot, and its twin; false when nothing in the list fits there. */
  const put = (list: KitItem[], which: keyof typeof SIZE, p: Vec3, rot: number, wall?: [number, number]): boolean => {
    const lim = SIZE[which]
    // Cover: something a standing player hides behind (taller than the eyes) far likelier than a crouch's worth.
    const fit = (c: C) => {
      if (c.long > lim.long || c.h < lim.h[0] || c.h > lim.h[1]) return 0
      const cover = c.cat.measures.cover.value
      if (which === 'screen') return cover === 'stand' && c.long >= 2.4 ? c.long : 0
      if (which !== 'cover') return 1
      return cover === 'none' ? 0 : cover === 'stand' ? 4 : 1
    }
    // As cover, names with something taller than a standing player's eyes count three times.
    const items = list.filter((i) => pieces.hasNamed(i.name) && (which !== 'screen' || pieces.coverOf(i.name) === 'stand'))
      .map((i) => ({ ...i, w: i.w * (which === 'cover' && pieces.coverOf(i.name) === 'stand' ? 3 : 1) }))
    for (let tries = 0; tries < 3 && items.length; tries++) {
      const total = items.reduce((t, i) => t + i.w, 0)
      let x = rand() * total
      const item = items.find((i) => (x -= i.w) <= 0) ?? items[items.length - 1]
      const c = pieces.named(item.name, fit)
      if (!c) { items.splice(items.indexOf(item), 1); continue }
      // Along a wall: its long side along the wall (its front, if it has one, away from it), a step off the wall.
      let r = rot, at = p
      if (wall) {
        const [nx, nz] = wall
        // The stand-in's own X (its long side) turned by r is (cos r, −sin r): along the wall when that is (nz, −nx).
        const along = (Math.atan2(nx, nz) * 180) / Math.PI
        const side = pieces.frontOf(c)
        r = side ? [0, 90, 180, 270].map((d) => along + d).sort((u, v) => dot(facingVec(side, v), wall) - dot(facingVec(side, u), wall))[0] : along
        // How deep it reaches out from the wall, as turned.
        const [ux, uz] = turn(1, 0, r), [vx, vz] = turn(0, 1, r)
        const half = (Math.abs(ux * nx + uz * nz) * c.long + Math.abs(vx * nx + vz * nz) * c.short) * M / 2
        at = [p[0] + nx * (half + 0.6), p[1], p[2] + nz * (half + 0.6)]
      }
      const [hx, hz] = [c.long * M / 2, c.short * M / 2]
      const q: Vec3 = [-at[0], at[1], -at[2]]
      if (!roomy(at, hx, hz, r, c.h * M) || !roomy(q, hx, hz, r + 180, c.h * M)) return false
      const mine = pieces.place(c, 'Game prop', at, ((r % 360) + 360) % 360, [...s.parts, ...added])
      const twin = mine && pieces.place(c, 'Game prop', q, (((r + 180) % 360) + 360) % 360, [...s.parts, ...added])
      if (!mine || !twin) return false
      pieces.commit(c)
      for (const q of [...mine, ...twin]) file(q)
      return true
    }
    return false
  }

  const level = Math.max(0, Math.min(100, busy)) / 100
  const xs = s.parts.flatMap((q) => [q.at[0] - q.size[0] / 2, q.at[0] + q.size[0] / 2])
  const W = Math.max(...xs) - Math.min(...xs)

  // 1. Spawn screens: a tall piece straight in front of each of red's spawns at the end of the map, then more across
  //    the front of the strip with room to run between.
  const strip = s.markers.filter(([t, p]) => /spawn/i.test(t) && p[2] < 0).map(([, p]) => p)
  if (strip.length) {
    const front = Math.max(...strip.map((m) => m[2]))
    for (const m of strip) if (m[2] > front - 4) for (const dz of [6, 8, 10]) if (put(kit.cover, 'screen', [m[0], ground, Math.round(front + dz)], 0)) { out.screens++; break }
    const step = 16 - 6 * level
    for (let x = -W / 2 + 10; x <= W / 2 - 10; x += step) {
      if (strip.some((m) => Math.abs(m[0] - x) < step / 2)) continue
      if (put(kit.cover, 'cover', [Math.round(x), ground, Math.round(front + 7)], 0)) out.screens++
    }
  }

  // Each spot's nearest wall: how far, and the way out from it.
  const nearWall = (p: Vec3): { d: number; n: [number, number] } | null => {
    let best: { d: number; n: [number, number] } | null = null
    for (const w of walls) {
      const t = ((w.rot ?? 0) * Math.PI) / 180, dx = p[0] - w.at[0], dz = p[2] - w.at[2]
      const lx = dx * Math.cos(t) - dz * Math.sin(t), lz = dx * Math.sin(t) + dz * Math.cos(t)
      const ex = Math.max(0, Math.abs(lx) - w.size[0] / 2), ez = Math.max(0, Math.abs(lz) - w.size[2] / 2)
      const d = Math.hypot(ex, ez)
      if (d <= 0 || (best && d >= best.d)) continue
      // Out of the wall's nearest face, in the world.
      const [nx, nz] = ex >= ez ? turn(Math.sign(lx), 0, w.rot ?? 0) : turn(0, Math.sign(lz), w.rot ?? 0)
      best = { d, n: [nx, nz] }
    }
    return best
  }
  const wallOf = new Map<Vec3, ReturnType<typeof nearWall>>()
  for (const p of red) wallOf.set(p, nearWall(p))

  // 2. Fronts and alleys: spots a step or two off a wall, a piece every SIDEWALK_EVERY metres (closer when busy).
  const every = (SIDEWALK_EVERY * M) * (1.3 - 0.6 * level)
  const taken: Vec3[] = []
  const spaced = (p: Vec3, gap: number) => taken.every((t) => Math.hypot(t[0] - p[0], t[2] - p[2]) >= gap && Math.hypot(t[0] + p[0], t[2] + p[2]) >= gap)
  for (const p of red) {
    const w = wallOf.get(p)
    if (!w || w.d < 1 || w.d > 5 || !spaced(p, every)) continue
    // On the wall's face; another wall straight across from it, close: an alley.
    const at: Vec3 = [p[0] - w.n[0] * w.d, p[1], p[2] - w.n[1] * w.d]
    const alley = [6, 10, ALLEY].some((t) => walls.some((q) => over(q, at[0] + w.n[0] * t, at[2] + w.n[1] * t, 0)))
    if (put(alley ? kit.alley : kit.sidewalk, alley ? 'alley' : 'sidewalk', at, 0, w.n)) { taken.push(p); if (alley) out.alleys++; else out.fronts++ }
  }

  // 3. Open ground: cover, farthest from everything first, up to the density for how busy the map is.
  const open = red.filter((p) => { const w = wallOf.get(p); return !w || w.d >= OPEN })
  const per1000 = level < 0.18 ? COVER_PER_1000.open + level / 0.18 * (COVER_PER_1000.normal - COVER_PER_1000.open)
    : level < 0.45 ? COVER_PER_1000.normal : COVER_PER_1000.normal + (level - 0.45) / 0.2 * (COVER_PER_1000.packed - COVER_PER_1000.normal)
  // Each candidate spot stands for a 4 × 4-unit square (4 m²).
  const want = Math.round((open.length * 4 * per1000) / 1000)
  out.wanted = want
  const placedAt: Vec3[] = [...markers, ...taken]
  const dist = (p: Vec3) => Math.min(Math.hypot(2 * p[0], 2 * p[2]), ...placedAt.map((t) => Math.min(Math.hypot(t[0] - p[0], t[2] - p[2]), Math.hypot(t[0] + p[0], t[2] + p[2]))))
  const score = new Map(open.map((p) => [p, dist(p)]))
  for (let n = 0, guard = 0; n < want && guard < want * 4; guard++) {
    let best: Vec3 | null = null, bd = 0
    for (const [p, d] of score) if (d > bd) { bd = d; best = p }
    if (!best || bd < 5) break
    score.delete(best)
    const rot = Math.floor(rand() * 4) * 90 + (rand() < 0.3 ? 45 : 0)
    if (!put(kit.cover, 'cover', best, rot)) continue
    n++; out.cover++
    for (const [p, d] of score) score.set(p, Math.min(d, Math.hypot(best[0] - p[0], best[2] - p[2]), Math.hypot(best[0] + p[0], best[2] + p[2])))
  }
  // Then wherever a long line at eye height still runs through open ground, more cover across it (most open first),
  // up to two and a half times as much: crouch-high pieces leave a standing player in view.
  const eyeTop = ground + 3.4
  const wet = s.parts.filter((q) => q.water)
  const sees = (q: Part, x: number, z: number) => !q.water && q.at[1] < eyeTop && q.at[1] + q.size[1] >= eyeTop && over(q, x, z, 0)
  const clearRun = (x: number, z: number, t: number) => {
    const dx = Math.sin(t), dz = Math.cos(t)
    for (let d = 2; d <= LINE_MAX; d += 2) {
      const px = x + dx * d, pz = z + dz * d
      // (Players see across water too: a harbour basin is no end to a line.)
      if ((base.support([px, ground, pz]) < 0 && !wet.some((q) => over(q, px, pz, 0))) || base.some(px, pz, (q) => sees(q, px, pz)) || nearby(px, pz).some((q) => sees(q, px, pz))) return d
    }
    return LINE_MAX
  }
  const line = (p: Vec3) => {
    let best = 0, across = 0
    for (let k = 0; k < 4; k++) { const t = (k * Math.PI) / 4, l = clearRun(p[0], p[2], t) + clearRun(p[0], p[2], t + Math.PI); if (l > best) { best = l; across = k * 45 } }
    return [best, across] as const
  }
  // Lazily: a spot's line only ever gets shorter as cover goes down, so its last length is an upper bound and only
  // the spots at the top of the list are measured again.
  const spots = open.filter((p) => markers.every((m) => Math.hypot(m[0] - p[0], m[2] - p[2]) > 6)).map((p) => ({ p, l: Infinity, at: 0 }))
  for (let n = out.cover, guard = 0; n < want * 2.5 && guard < 80 && spots.length; guard++) {
    spots.sort((u, v) => v.l - u.l)
    let pickAt = -1
    for (let i = 0; i < spots.length; i++) {
      const sp = spots[i]
      if (placedNear(sp.p)) { sp.l = 0; continue }
      ;[sp.l, sp.at] = line(sp.p)
      // Still at least as long as the next one's bound: the most open spot.
      if (i + 1 >= spots.length || sp.l >= spots[i + 1].l) { pickAt = i; break }
      // Otherwise it sinks; look again from the top.
      spots.sort((u, v) => v.l - u.l); i = -1
    }
    if (pickAt < 0 || spots[pickAt].l < LONG_LINE) break
    const [sp] = spots.splice(pickAt, 1)
    // Across the line it breaks.
    if (!put(kit.cover, 'cover', sp.p, sp.at + 90)) continue
    n++; out.cover++
  }
  return added.length ? { ...s, parts: [...s.parts, ...added] } : s

  function placedNear(p: Vec3) { return nearby(p[0], p[2]).some((q) => Math.hypot(q.at[0] - p[0], q.at[2] - p[2]) < 6) }
}

/** Longest line counted (units), and a line at eye height this long or more through open ground still gets cover. */
const LINE_MAX = 60, LONG_LINE = 36

const dot = (u: [number, number], v: [number, number]) => u[0] * v[0] + u[1] * v[1]
const NONE: Part[] = []

function extentArea(parts: Part[]): number {
  const xs = parts.flatMap((q) => [q.at[0] - q.size[0] / 2, q.at[0] + q.size[0] / 2]), zs = parts.flatMap((q) => [q.at[2] - q.size[2] / 2, q.at[2] + q.size[2] / 2])
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs))
}
