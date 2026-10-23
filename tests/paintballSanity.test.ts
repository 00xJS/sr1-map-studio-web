// Common-sense checks for the paintball and starter sample maps as they build
// (full size and compact): nothing floating, sunk, overlapping or outside the
// walls; ramps and stairs that land somewhere and aren't blocked; seats,
// hoops and screens facing open floor; props that stay with what they belong
// to when a compact map is spread ×2; platforms players can reach; spawns that
// don't stare at a wall. Set SANITY_REPORT=1 to print every finding.
import { describe, expect, it } from 'vitest'
import { SAMPLES, sampleFor } from '../src/lib/samples'
import { over, spreadSample } from '../src/lib/sampleScale'
import { turn, type Part, type Sample } from '../src/lib/sampleKit'
import { sampleInput } from '../src/lib/analysis'
import { prepareMap, type Prepared } from '../src/lib/analysis/analyze'
import { sees } from '../src/lib/analysis/sight'
import { PLAYER } from '../src/lib/analysis/floor'

const MAPS = SAMPLES.filter((s) => s.theme === 'Urban paintball' || s.theme === 'Starter')
const REPORT = !!process.env.SANITY_REPORT

type V2 = [number, number]
const f1 = (v: number) => +v.toFixed(1)
const at = (x: number, z: number) => `(${f1(x)}, ${f1(z)})`

/** A part's footprint as a turned rectangle, plus its height range. */
interface Rect { c: V2; h: V2; ax: V2; az: V2; y0: number; y1: number }
function rect(p: Part): Rect {
  // An upright cylinder by the square round it, whatever its heading.
  const rot = p.kind === 'cylinder' && !p.lie ? 0 : p.rot ?? 0
  return { c: [p.at[0], p.at[2]], h: [p.size[0] / 2, p.size[2] / 2], ax: turn(1, 0, rot), az: turn(0, 1, rot), y0: p.at[1], y1: p.at[1] + p.size[1] }
}
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1]
/** How deep two footprints overlap (negative: the gap between them), by separating axes. */
function depth(a: Rect, b: Rect): number {
  let best = Infinity
  for (const n of [a.ax, a.az, b.ax, b.az]) {
    const ra = Math.abs(a.h[0] * dot(a.ax, n)) + Math.abs(a.h[1] * dot(a.az, n))
    const rb = Math.abs(b.h[0] * dot(b.ax, n)) + Math.abs(b.h[1] * dot(b.az, n))
    const d = Math.abs(dot([b.c[0] - a.c[0], b.c[1] - a.c[1]], n))
    best = Math.min(best, ra + rb - d)
  }
  return best
}
const yOverlap = (a: Rect, b: Rect) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
function bounds(ps: Part[]) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (const p of ps) {
    const r = rect(p)
    const ex = Math.abs(r.ax[0]) * r.h[0] + Math.abs(r.az[0]) * r.h[1], ez = Math.abs(r.ax[1]) * r.h[0] + Math.abs(r.az[1]) * r.h[1]
    x0 = Math.min(x0, r.c[0] - ex); x1 = Math.max(x1, r.c[0] + ex); z0 = Math.min(z0, r.c[1] - ez); z1 = Math.max(z1, r.c[1] + ez)
  }
  return { x0, x1, z0, z1 }
}

/** Things you see and walk through: water, decals, see-through pictures. */
const seeThrough = (p: Part) => !!p.water || /decal/i.test(p.label) || ('file' in p.top && !!p.top.alpha)
/** Things you walk through or over: those, paint and other thin films, terrain (checked by its own height). */
const ghost = (p: Part) => seeThrough(p) || p.size[1] <= 0.3 || p.kind === 'terrain'
/** Façade trim of a generated building: a prop set against the wall may cover a little of it. */
const trim = (p: Part) => /^(shop|apartments|office|warehouse)$/.test(p.prefab?.key ?? '') && !/^(Building|Warehouse)$/.test(p.label)
/** A floor slab: things stand on it, they don't hit it. */
const slab = (p: Part) => p.size[1] <= 1.5 && Math.max(p.size[0], p.size[2]) >= 30

interface Unit { key: string; label: string; parts: number[]; base: number }
function units(s: Sample): Unit[] {
  const map = new Map<string, Unit>()
  s.parts.forEach((p, i) => {
    const key = p.group ?? `#${i}`
    let u = map.get(key)
    if (!u) { u = { key, label: p.prefab?.key ?? p.group?.split('@')[0] ?? p.label, parts: [], base: Infinity }; map.set(key, u) }
    u.parts.push(i)
    u.base = Math.min(u.base, p.at[1])
  })
  return [...map.values()]
}
const unitOf = (s: Sample) => s.parts.map((p, i) => p.group ?? `#${i}`)

// ---------------- the checks ----------------

/** The walkable map: the ground slabs, grown a little for the walls just outside them. */
function region(s: Sample) {
  const grounds = s.parts.filter((p) => p.at[1] <= 0.01 && Math.max(p.size[0], p.size[2]) >= 40 && !/barrier|building/i.test(p.label))
  const walls = s.parts.filter((p) => p.at[1] <= 1.01 && Math.max(p.size[0], p.size[2]) >= 40 && /wall/i.test(p.label))
  const b = bounds([...grounds, ...walls])
  return { x0: b.x0 - 1.5, x1: b.x1 + 1.5, z0: b.z0 - 1.5, z1: b.z1 + 1.5 }
}

function outside(s: Sample): string[] {
  const r = region(s), out: string[] = []
  const inside = (x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1
  for (const u of units(s)) {
    if (u.base <= 0.01) continue // structures standing on the world floor (buildings, walls) shape the map themselves
    const b = bounds(u.parts.map((i) => s.parts[i]))
    if (b.x0 < r.x0 || b.x1 > r.x1 || b.z0 < r.z0 || b.z1 > r.z1) out.push(`${u.label} at ${at((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2)} sticks out of the map`)
  }
  for (const [type, p] of s.markers) if (!inside(p[0], p[2])) out.push(`${type} at ${at(p[0], p[2])} is outside the map`)
  for (const [p] of s.lights ?? []) if (!inside(p[0], p[2])) out.push(`light at ${at(p[0], p[2])} is outside the map`)
  return out
}

/** Every piece rests on something (or hangs on a wall); none is half buried in the floor under it. */
function floating(s: Sample): string[] {
  const out: string[] = [], owner = unitOf(s)
  const rects = s.parts.map(rect)
  for (const u of units(s)) {
    if (u.base <= 1.01 && u.base >= 0.99 && s.parts.some((q, j) => !u.parts.includes(j) && q.at[1] <= 0.01 && q.at[1] + q.size[1] >= 0.99 && u.parts.some((i) => depth(rects[i], rects[j]) > 0))) {
      // standing on the ground slab
    } else if (u.base > 0.01) {
      const low = u.parts.filter((i) => s.parts[i].at[1] < u.base + 0.05)
      const rests = low.some((i) => s.parts.some((q, j) => {
        if (owner[j] === u.key || seeThrough(q)) return false
        const top = q.at[1] + q.size[1]
        if (q.kind === 'terrain') return over(q, s.parts[i].at[0], s.parts[i].at[2], 0)
        if (Math.abs(top - u.base) <= 0.08 && depth(rects[i], rects[j]) > 0.05) return true
        // Hung on the side of something tall (a sign on a wall, a board on a post).
        return q.size[1] >= 1 && q.at[1] <= u.base + 0.1 && top >= u.base && depth(rects[i], rects[j]) > -0.12
      }))
      if (!rests) { const p = s.parts[low[0]]; out.push(`${u.label} at ${at(p.at[0], p.at[2])} floats at height ${f1(u.base)}`) }
    }
    // Sunk: the floor under its middle rises above its base.
    for (const i of u.parts) {
      const p = s.parts[i]
      if (p.at[1] > u.base + 0.05) continue
      const q = s.parts.find((q, j) => owner[j] !== u.key && !ghost(q) && q.kind !== 'ramp' && q.kind !== 'stairs' && q.kind !== 'terrain'
        && q.at[1] < p.at[1] - 0.01 && q.at[1] + q.size[1] > p.at[1] + 0.12 && over(q, p.at[0], p.at[2], -0.05))
      const film = s.parts.find((q, j) => owner[j] !== u.key && q.size[1] <= 0.3 && !q.water && q.at[1] <= p.at[1] + 0.01 && q.at[1] + q.size[1] > p.at[1] + 0.05 && over(q, p.at[0], p.at[2], -0.05))
      const under = q ?? film
      if (under) { out.push(`${u.label} at ${at(p.at[0], p.at[2])} is sunk ${f1(under.at[1] + under.size[1] - p.at[1])} into ${under.label}`); break }
    }
  }
  return out
}

/** Separate pieces don't run into each other. */
function overlaps(s: Sample): string[] {
  const out: string[] = [], owner = unitOf(s)
  const rects = s.parts.map(rect)
  const idx = s.parts.map((_, i) => i).filter((i) => !ghost(s.parts[i]) && !slab(s.parts[i]) && s.parts[i].kind !== 'blob')
  const box = idx.map((i) => ({ i, ...bounds([s.parts[i]]) })).sort((a, b) => a.x0 - b.x0)
  const seen = new Set<string>()
  for (let a = 0; a < box.length; a++) {
    for (let b = a + 1; b < box.length && box[b].x0 < box[a].x1; b++) {
      const i = box[a].i, j = box[b].i
      if (owner[i] === owner[j] || box[b].z0 > box[a].z1 || box[a].z0 > box[b].z1) continue
      const p = s.parts[i], q = s.parts[j]
      // Hand-built bunker shapes are drawn as crossing blocks of one name (the X, the temple).
      if (!p.group && !q.group && p.label === q.label) continue
      if (yOverlap(rects[i], rects[j]) <= 0.2) continue
      const d = depth(rects[i], rects[j])
      if (d <= 0.25 || (d <= 0.6 && (trim(p) || trim(q)))) continue
      const pair = [owner[i], owner[j]].sort().join('|')
      if (seen.has(pair)) continue
      seen.add(pair)
      const la = p.prefab?.key ?? p.group?.split('@')[0] ?? p.label, lb = q.prefab?.key ?? q.group?.split('@')[0] ?? q.label
      out.push(`${la} (${p.label}) at ${at(p.at[0], p.at[2])} runs ${f1(d)} into ${lb} (${q.label}) at ${at(q.at[0], q.at[2])}`)
    }
  }
  return out
}

const NOT_A_WAY_UP = /quarter|kicker|wedge|bleacher|lid|roof|canopy|jump|slide|pad|awning|ramp-shaped|wheelchair/i
/** Stairs and ramps land on a floor at their top, start from a floor at their foot, and nothing stands in the way. */
function ways(s: Sample): string[] {
  const out: string[] = [], owner = unitOf(s)
  s.parts.forEach((p, i) => {
    if ((p.kind !== 'ramp' && p.kind !== 'stairs') || NOT_A_WAY_UP.test(p.label)) return
    const r = rect(p), top = r.y1, d = r.h[1], w = r.h[0]
    const pt = (along: number, across: number): V2 => [r.c[0] - r.az[0] * along + r.ax[0] * across, r.c[1] - r.az[1] * along + r.ax[1] * across]
    const floorAt = ([x, z]: V2, y: number, tol: number) => s.parts.some((q, j) => j !== i && !seeThrough(q) && Math.abs(q.at[1] + q.size[1] - y) <= tol && over(q, x, z, -0.05))
    const blockAt = ([x, z]: V2, y: number) => s.parts.find((q, j) => j !== i && owner[j] !== owner[i] && !ghost(q) && q.at[1] < y + 3 && q.at[1] + q.size[1] > y + 0.45 && over(q, x, z, 0))
    const where = `${p.label} at ${at(p.at[0], p.at[2])}`
    const ahead = [pt(d + 0.7, 0), pt(d + 0.7, -w * 0.6), pt(d + 0.7, w * 0.6)]
    const aside = [pt(d - 0.8, -(w + 0.7)), pt(d - 0.8, w + 0.7)]
    if (![...ahead, ...aside].some((q) => floorAt(q, top, 0.6))) out.push(`${where} leads nowhere (nothing to step onto at height ${f1(top)})`)
    const atTop = blockAt(pt(d + 1, 0), top)
    if (atTop && floorAt(pt(d + 0.7, 0), top, 0.6)) out.push(`${where}: ${atTop.label} blocks the top`)
    const foot = pt(-d - 1, 0)
    if (r.y0 > 0.01 && !floorAt(foot, r.y0, 0.4)) out.push(`${where}: its foot hangs in the air`)
    const atFoot = blockAt(foot, r.y0)
    if (atFoot) out.push(`${where}: ${atFoot.label} blocks the foot`)
  })
  return out
}

/** Pieces with a front, and the open floor they need in front of them. */
const FRONTS: Record<string, number> = {
  bench: 3, bleachers: 8, hoop: 10, goal: 10, vending: 3, atm: 3, phone: 3, busstop: 4, kiosk: 3,
  reftower: 6, scoreboard: 10, gearrack: 3, teambench: 4, airstation: 3, chronostation: 3, spectatorstand: 8, staging: 4,
}
function facing(s: Sample): string[] {
  const out: string[] = [], owner = unitOf(s)
  for (const u of units(s)) {
    const first = s.parts[u.parts[0]]
    let key = first.prefab?.key, rot = first.prefab?.rot ?? 0
    if (!key && first.group?.startsWith('Bench@')) { key = 'bench'; rot = s.parts[u.parts.find((i) => s.parts[i].label === 'Seat') ?? u.parts[0]].rot ?? 0 }
    if (!key && first.label === 'Bleachers' && !first.group) { key = 'bleachers'; rot = first.rot ?? 0 }
    if (!key || !(key in FRONTS)) continue
    const f = turn(0, 1, rot), c: V2 = [first.prefab?.at[0] ?? first.at[0], first.prefab?.at[2] ?? first.at[2]]
    // How far the piece reaches forward of its base point.
    let reach = 0
    for (const i of u.parts) {
      const r = rect(s.parts[i])
      reach = Math.max(reach, dot([r.c[0] - c[0], r.c[1] - c[1]], f) + Math.abs(r.h[0] * dot(r.ax, f)) + Math.abs(r.h[1] * dot(r.az, f)))
    }
    for (let t = 0.5; t <= FRONTS[key]; t += 0.5) {
      const x = c[0] + f[0] * (reach + t), z = c[1] + f[1] * (reach + t)
      const q = s.parts.find((q, j) => owner[j] !== u.key && !ghost(q) && q.at[1] < u.base + 3 && q.at[1] + q.size[1] > u.base + 2.5 && over(q, x, z, 0))
      if (q) { out.push(`${key} at ${at(c[0], c[1])} faces ${q.label} ${f1(t)} away`); break }
      if (t > 1 && !s.parts.some((g) => !seeThrough(g) && Math.abs(g.at[1] + g.size[1] - u.base) < 0.3 && over(g, x, z, 0))) { out.push(`${key} at ${at(c[0], c[1])} faces a drop`); break }
    }
  }
  return out
}

/** Spreading a compact map ×2 keeps props with what they stood on or next to. */
function spread(s: Sample): string[] {
  if ((s.size ?? 'compact') !== 'compact') return []
  const t = spreadSample(s, 2), out: string[] = []
  const big = s.parts.map((p, i) => t.parts[i].size[0] !== p.size[0] || t.parts[i].size[2] !== p.size[2])
  const box = s.parts.map((p) => ({ ...bounds([p]), y0: p.at[1], y1: p.at[1] + p.size[1] }))
  const gap = (a: typeof box[0], b: typeof box[0]) => Math.max(a.x0 - b.x1, b.x0 - a.x1, a.z0 - b.z1, b.z0 - a.z1, a.y0 - b.y1, b.y0 - a.y1)
  const tbox = t.parts.map((p) => ({ ...bounds([p]), y0: p.at[1], y1: p.at[1] + p.size[1] }))
  const moved = (i: number): V2 => [t.parts[i].at[0] - s.parts[i].at[0], t.parts[i].at[2] - s.parts[i].at[2]]
  for (let i = 0; i < s.parts.length; i++) for (let j = i + 1; j < s.parts.length; j++) {
    if (big[i] && big[j]) continue
    const g = gap(box[i], box[j])
    if (g > 0.5) continue
    const [a, b] = [s.parts[i], s.parts[j]]
    if (!big[i] && !big[j]) {
      const [ai, bi] = [moved(i), moved(j)]
      const drift = Math.hypot(ai[0] - bi[0], ai[1] - bi[1])
      if (drift > 0.3) out.push(`${a.label} at ${at(a.at[0], a.at[2])} and ${b.label} at ${at(b.at[0], b.at[2])} drift ${f1(drift)} apart`)
    } else if (g <= 0.06 && gap(tbox[i], tbox[j]) > 0.1) {
      const prop = big[i] ? b : a, base = big[i] ? a : b
      out.push(`${prop.label} at ${at(prop.at[0], prop.at[2])} comes off ${base.label}`)
    }
  }
  // Lights hung on a prop (a lantern, a lamp) move with it.
  ;(s.lights ?? []).forEach(([p], k) => {
    const host = s.parts.findIndex((q, i) => !big[i] && over(q, p[0], p[2], 0.5) && p[1] >= q.at[1] && p[1] <= q.at[1] + q.size[1] + 1)
    if (host < 0) return
    const [dx, dz] = moved(host), q = t.lights![k][0]
    if (Math.hypot(q[0] - p[0] - dx, q[2] - p[2] - dz) > 0.5) out.push(`light at ${at(p[0], p[2])} leaves ${s.parts[host].label} behind`)
  })
  return out
}

const PLATFORM = /deck|platform|catwalk|slab|bridge|lookout|funbox|landing|stage|tower top/i
const prepared = new Map<Sample, Prepared>()
const prep = (s: Sample) => { let p = prepared.get(s); if (!p) { p = prepareMap(sampleInput(s)); prepared.set(s, p) } return p }

/** Spawns, pickups and drop-offs, and every raised platform, can be walked to. */
function reach(s: Sample): string[] {
  const p = prep(s), out: string[] = []
  for (const u of p.unreachable) out.push(`${u.type} at ${at(u.position[0], u.position[2])} (height ${f1(u.position[1])}) can't be reached`)
  const P = p.g.grid.pos, R = p.g.grid.reachable
  for (const q of s.parts) {
    if (!PLATFORM.test(q.label) || q.size[0] * q.size[2] < 12 || q.at[1] + q.size[1] < 2.5 || q.kind === 'stairs' || q.kind === 'ramp') continue
    const top = q.at[1] + q.size[1]
    let any = false, ok = false
    for (let n = 0; n < p.g.grid.count && !ok; n++) {
      if (Math.abs(P[n * 3 + 1] - top) > 0.3 || !over(q, P[n * 3], P[n * 3 + 2], -0.3)) continue
      any = true
      if (R[n]) ok = true
    }
    if (any && !ok) out.push(`${q.label} at ${at(q.at[0], q.at[2])} (height ${f1(top)}) can't be reached`)
  }
  return out
}

/** A spawn looks at open space: at least 3 m clear straight ahead at eye height. */
function views(s: Sample): string[] {
  const p = prep(s), out: string[] = []
  for (const [type, m, patch] of s.markers) {
    if (!/spawn/i.test(type)) continue
    const yaw = ((patch?.yaw ?? 0) * Math.PI) / 180, [fx, fz] = [Math.sin(yaw), -Math.cos(yaw)]
    // Straight ahead and a shoulder's width either side: a post or a pole in the way is not a wall.
    const blocked = [-0.75, 0, 0.75].every((side) => {
      const eye = [m[0] - fz * side, m[1] + 0.1 + PLAYER.standEye, m[2] + fx * side]
      return !sees(p.bvh, eye, [eye[0] + fx * 6, eye[1], eye[2] + fz * 6])
    })
    if (blocked) out.push(`${type} at ${at(m[0], m[2])} stares at a wall`)
  }
  return out
}

const CHECKS: Record<string, (s: Sample) => string[]> = { outside, floating, overlaps, ways, facing, spread, reach, views }

describe('paintball and starter maps make sense', () => {
  for (const def of MAPS) {
    const builds: [string, () => Sample][] = [['full', () => sampleFor(def.id)]]
    if ((def.size ?? 'compact') === 'compact') builds.push(['compact', () => sampleFor(def.id, true)])
    for (const [size, make] of builds) {
      let built: Sample | undefined
      const get = () => (built ??= make())
      for (const [name, check] of Object.entries(CHECKS)) {
        if (name === 'spread' && size === 'compact') continue
        it(`${def.name} (${size}): ${name}`, () => {
          const problems = check(name === 'spread' ? def : get())
          if (REPORT && problems.length) console.log(`\n## ${def.id} ${size} ${name}\n` + problems.map((x) => '- ' + x).join('\n'))
          expect(problems).toEqual([])
        })
      }
    }
  }
})
