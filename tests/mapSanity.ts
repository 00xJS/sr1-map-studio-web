// Layout sanity checks for built sample maps (helpers for cyberSanity.test.ts):
// things that look wrong when you walk a map, found from its parts and markers.
// Every check returns plain-language problems; an empty list is a clean map.
import { Bvh } from '../src/lib/analysis/bvh'
import { prepareMap } from '../src/lib/analysis/analyze'
import { JUMP_UP, PLAYER } from '../src/lib/analysis/floor'
import { sampleInput } from '../src/lib/analysis/sampleInput'
import { OPAQUE, SOLID } from '../src/lib/analysis/types'
import type { Vec3 } from '../src/lib/project'
import { turn, type Part, type Sample } from '../src/lib/sampleKit'
import { over, partIndex } from '../src/lib/sampleScale'

const SPAWNS = ['Shared spawn', 'Red team spawn', 'Blue team spawn']
// JUMP_UP: the highest ledge a player gets onto, as the health check's floor graph allows (the game's 1.1 m).
const r1 = (v: number) => +v.toFixed(1)
const at = (p: Part) => `${p.label} at ${p.at.map(r1).join(', ')}`
/** World point from a part's local offset (the editor's heading convention). */
const W = (p: Part, dx: number, dz: number): [number, number] => { const [x, z] = turn(dx, dz, p.rot ?? 0); return [p.at[0] + x, p.at[2] + z] }
const top = (p: Part) => p.at[1] + p.size[1]

/** Parts meant to hang in the air or on a wall. */
const AIRBORNE = /Floating|Holo|Hover|Drone|Sign|Strip|Banner|Screen|Halo|Beam|Arrow|Cable|Lamp|Light|Glow|Logo|Ticker|Scoreboard/i
/** Thin decals and paint lying on a floor: stepped over, never in the way. */
const flat = (p: Part) => p.size[1] <= 0.3
/** The map's own floor slabs. */
const isFloor = (p: Part) => p.at[1] <= 0.01 && p.size[1] <= 1.01 && Math.max(p.size[0], p.size[2]) >= 40

/** Height of a part's walkable top at (x, z), or null when (x, z) is not over it. */
export function topAt(p: Part, x: number, z: number): number | null {
  if (p.kind === 'terrain' || p.kind === 'blob' || p.kind === 'roof') return over(p, x, z, 0) ? top(p) : null
  const t = ((p.rot ?? 0) * Math.PI) / 180
  const dx = x - p.at[0], dz = z - p.at[2]
  const lx = dx * Math.cos(t) - dz * Math.sin(t), lz = dx * Math.sin(t) + dz * Math.cos(t)
  const [w, h, d] = p.size
  if (p.kind === 'cylinder' && p.lie) return Math.abs(lx) <= w / 2 && Math.abs(lz) <= d / 2 ? top(p) : null
  if (p.kind === 'cylinder') return (lx / (w / 2)) ** 2 + (lz / (d / 2)) ** 2 <= 1 ? top(p) : null
  if (Math.abs(lx) > w / 2 + 1e-6 || Math.abs(lz) > d / 2 + 1e-6) return null
  if (p.kind === 'ramp') return p.at[1] + h * (d / 2 - lz) / d
  if (p.kind === 'stairs') {
    const n = Math.max(1, Math.round(p.segments ?? 8))
    return p.at[1] + (h * Math.min(n, Math.floor(((d / 2 - lz) / d) * n) + 1)) / n
  }
  return top(p)
}

/** A walkable top within `below`..`above` of height y at (x, z). */
const surfaceNear = (parts: Part[], x: number, z: number, y: number, below: number, above: number, skip?: Part) =>
  parts.some((q) => { if (q === skip) return false; const h = topAt(q, x, z); return h !== null && h >= y - below && h <= y + above })
/** Something solid at (x, z) between heights y0 and y1. */
const solidAt = (parts: Part[], x: number, z: number, y0: number, y1: number, skip?: Part) =>
  parts.find((q) => {
    if (q === skip || flat(q) || q.at[1] >= y1 || !over(q, x, z, 0)) return false
    // A ramp or stairs is only as high as its surface there (a flight that carries on is not in the way).
    const h = q.kind === 'ramp' || q.kind === 'stairs' ? topAt(q, x, z) ?? top(q) : top(q)
    return h > y0
  })

/** Points spread over a part's footprint, shrunk a little from the edge. */
function footprintPoints(p: Part, n = 4): [number, number][] {
  const out: [number, number][] = []
  const [w, , d] = p.lie ? p.size : p.size
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    const lx = (i / n - 0.5) * w * 0.8, lz = (j / n - 0.5) * d * 0.8
    if (p.kind === 'cylinder' && !p.lie && (lx / (w * 0.4)) ** 2 + (lz / (d * 0.4)) ** 2 > 1.0001) continue
    out.push(W(p, lx, lz))
  }
  return out
}

// ---------------- rectangles in plan view ----------------

interface Rect { c: [number, number]; ax: [number, number][]; h: [number, number]; round: boolean }
function rect(p: Part): Rect {
  const t = ((p.rot ?? 0) * Math.PI) / 180
  return { c: [p.at[0], p.at[2]], ax: [[Math.cos(t), -Math.sin(t)], [Math.sin(t), Math.cos(t)]], h: [p.size[0] / 2, p.size[2] / 2], round: p.kind === 'cylinder' && !p.lie }
}
/** How deep two footprints overlap in plan view (separating-axis test; round parts use a circle). 0 or less: apart. */
function planOverlap(a: Rect, b: Rect): number {
  const dx = b.c[0] - a.c[0], dz = b.c[1] - a.c[1]
  if (a.round && b.round) return (a.h[0] + b.h[0]) * 0.92 - Math.hypot(dx, dz)
  if (a.round || b.round) {
    const [r, q] = a.round ? [a, b] : [b, a]
    const vx = r.c[0] - q.c[0], vz = r.c[1] - q.c[1]
    const lx = vx * q.ax[0][0] + vz * q.ax[0][1], lz = vx * q.ax[1][0] + vz * q.ax[1][1]
    const cx = Math.max(-q.h[0], Math.min(q.h[0], lx)), cz = Math.max(-q.h[1], Math.min(q.h[1], lz))
    const inside = cx === lx && cz === lz
    const rad = r.h[0] * 0.92
    return inside ? rad + Math.min(q.h[0] - Math.abs(lx), q.h[1] - Math.abs(lz)) : rad - Math.hypot(lx - cx, lz - cz)
  }
  let depth = Infinity
  for (const axis of [...a.ax, ...b.ax]) {
    const proj = (r: Rect) => r.h[0] * Math.abs(r.ax[0][0] * axis[0] + r.ax[0][1] * axis[1]) + r.h[1] * Math.abs(r.ax[1][0] * axis[0] + r.ax[1][1] * axis[1])
    depth = Math.min(depth, proj(a) + proj(b) - Math.abs(dx * axis[0] + dz * axis[1]))
  }
  return depth
}

// ---------------- the checks ----------------

/** Parts resting on nothing (not on the floor, a top or against a side). */
export function floating(s: Sample): string[] {
  const out: string[] = []
  const rects = s.parts.map(rect)
  s.parts.forEach((p, i) => {
    if (p.at[1] <= 1.05 || AIRBORNE.test(p.label)) return
    const y = p.at[1]
    const onTop = footprintPoints(p).some(([x, z]) => surfaceNear(s.parts, x, z, y, 0.15, 0.15, p))
      || s.parts.some((q, j) => j !== i && q.kind !== 'ramp' && q.kind !== 'stairs' && Math.abs(top(q) - y) < 0.15 && planOverlap(rects[i], rects[j]) > 0.05)
    if (onTop) return
    // Against the side of something (a bridge between two decks, a pipe on a wall).
    const beside = s.parts.some((q, j) => j !== i && q.at[1] < top(p) && top(q) > y && planOverlap(rects[i], rects[j]) > -0.15)
    if (!beside) out.push(`${at(p)}: floating ${r1(y - 1)} above the floor with nothing under it`)
  })
  return out
}

/** Parts sunk into the floor (their top at or under it), or poking out under it. */
export function sunk(s: Sample): string[] {
  const out: string[] = []
  for (const p of s.parts) {
    if (isFloor(p) || /wall|floor|ground/i.test(p.label)) continue
    if (top(p) <= 1.01) out.push(`${at(p)}: buried in the floor (top at ${r1(top(p))})`)
    else if (p.at[1] < 0.95 && p.at[1] > -0.5 && !/Ring|Pool|Pit|Trench/.test(p.label)) out.push(`${at(p)}: starts ${r1(1 - p.at[1])} under the floor`)
  }
  return out
}

/** Solid parts of different objects pushed into each other (z-fighting, pieces through pieces). */
export function overlaps(s: Sample, depth = 0.35): string[] {
  const out: string[] = []
  const rects = s.parts.map(rect)
  const solid = s.parts.map((p) => !isFloor(p) && !flat(p) && p.kind !== 'terrain')
  for (let i = 0; i < s.parts.length; i++) {
    if (!solid[i]) continue
    for (let j = i + 1; j < s.parts.length; j++) {
      if (!solid[j]) continue
      const a = s.parts[i], b = s.parts[j]
      if (a.group && a.group === b.group) continue
      // Walls meeting at a corner overlap on purpose; parallel walls doing so flicker.
      const long = (p: Part) => ((p.rot ?? 0) + (p.size[0] >= p.size[2] ? 0 : 90)) % 180
      // Walls and walkways meeting at a corner overlap on purpose (not flush: their tops differ or they cross).
      const joint = /wall|concourse/i
      if (joint.test(a.label) && joint.test(b.label) && Math.abs(long(a) - long(b)) > 1 && (/wall/i.test(a.label) || Math.abs(top(a) - top(b)) > 0.03)) continue
      const dy = Math.min(top(a), top(b)) - Math.max(a.at[1], b.at[1])
      if (dy <= depth) continue
      // Ramps and stairs only fill their lower half near the low end; compare against their middle height.
      const d = planOverlap(rects[i], rects[j])
      if (d > depth) out.push(`${at(a)} and ${at(b)} overlap by ${r1(Math.min(d, dy))}`)
    }
  }
  return out
}

/** Ramps and stairs: the foot on a floor and clear, the top landing on something walkable. Jump pads aim at a ledge. */
export function ramps(s: Sample): string[] {
  const out: string[] = []
  for (const p of s.parts) {
    if (p.kind !== 'ramp' && p.kind !== 'stairs') continue
    const [w, h, d] = p.size
    const y0 = p.at[1], y1 = y0 + h
    const across = [-w / 3, 0, w / 3]
    const jump = /Jump|Kicker|Wedge/.test(p.label)
    // Foot: a floor under the low edge, and nothing standing right in front of it.
    const footOk = across.some((a) => { const [x, z] = W(p, a, d / 2 + 0.6); return surfaceNear(s.parts, x, z, y0, 0.6, 0.6, p) && !solidAt(s.parts, x, z, y0 + 0.6, y0 + 3, p) })
    if (!footOk) out.push(`${at(p)}: its foot is blocked or over nothing`)
    if (jump) {
      // A jump pad launches toward a ledge it can reach (no higher than a jump from its lip).
      let target = false
      for (let ahead = 0.6; ahead <= 12 && !target; ahead += 0.6) {
        target = across.some((a) => { const [x, z] = W(p, a, -d / 2 - ahead); return s.parts.some((q) => { if (q === p || flat(q)) return false; const t = topAt(q, x, z); return t !== null && t > y0 + 1.2 && t <= y1 + JUMP_UP }) })
      }
      if (!target) out.push(`${at(p)}: jump pad launches at nothing to land on`)
      continue
    }
    // Top: a walkable surface at the landing height just past the high edge, with head room.
    const lands = across.some((a) => { const [x, z] = W(p, a, -d / 2 - 0.6); return surfaceNear(s.parts, x, z, y1, 0.8, PLAYER.step, p) && !solidAt(s.parts, x, z, y1 + 1.3, y1 + PLAYER.stand, p) })
    if (!lands) out.push(`${at(p)}: leads nowhere (nothing to step onto at the top, ${r1(y1)})`)
  }
  return out
}

/** Light gates stand across an open path: clear to walk through on both sides. */
export function gates(s: Sample): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of s.parts) {
    // A light gate prefab, or a gate built from plain parts (its top bar spans the opening).
    const key = p.prefab?.key === 'lightgate' ? p.group! : p.label === 'Gate top' ? at(p) : null
    if (!key || seen.has(key)) continue
    seen.add(key)
    const g = (p.prefab ? { ...p, at: p.prefab.at, rot: p.prefab.rot } : { ...p, at: [p.at[0], p.at[1] - 7, p.at[2]] }) as Part
    const y = g.at[1]
    // Floor right through it, and nothing a player can't step (just past it) or jump (a little further) onto.
    const blocked = [-6, -3, 3, 6].filter((dz) => { const [x, z] = W(g, 0, dz), near = Math.abs(dz) < 4; return (near && !surfaceNear(s.parts, x, z, y, 0.6, 0.6)) || solidAt(s.parts, x, z, y + (near ? PLAYER.step : JUMP_UP), y + 3) })
    if (blocked.length) out.push(`Light gate at ${g.at.map(r1).join(', ')}: walking through it runs into something or off the floor`)
  }
  return out
}

/** Outside flood fill on the ground level: anything (a marker or a part) the outside reaches is beyond the walls, or the walls leak. */
export function enclosure(s: Sample): string[] {
  const out: string[] = []
  const floors = s.parts.filter(isFloor)
  const ground = floors.length ? Math.max(...floors.map(top)) : 1
  const xs = s.parts.flatMap((p) => [p.at[0] - p.size[0], p.at[0] + p.size[0]]), zs = s.parts.flatMap((p) => [p.at[2] - p.size[2], p.at[2] + p.size[2]])
  const cell = 0.5, x0 = Math.min(...xs) - 4, z0 = Math.min(...zs) - 4
  const nx = Math.ceil((Math.max(...xs) + 4 - x0) / cell), nz = Math.ceil((Math.max(...zs) + 4 - z0) / cell)
  // A wall is anything a player can neither step nor jump over, reaching down to near the floor.
  const walls = s.parts.filter((p) => p.at[1] <= ground + 0.4 && top(p) > ground + JUMP_UP && !isFloor(p))
  const blocked = new Uint8Array(nx * nz), wallsNear = partIndex(walls)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell
    if (wallsNear.some(x, z, (p) => over(p, x, z, 0.25))) blocked[j * nx + i] = 1
  }
  const outside = new Uint8Array(nx * nz)
  const stack: number[] = [0]
  outside[0] = 1
  while (stack.length) {
    const k = stack.pop()!, i = k % nx, j = (k - i) / nx
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + a, jj = j + b
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue
      const kk = jj * nx + ii
      if (outside[kk] || blocked[kk]) continue
      outside[kk] = 1
      stack.push(kk)
    }
  }
  const isOut = (x: number, z: number) => {
    const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell)
    return i >= 0 && j >= 0 && i < nx && j < nz && outside[j * nx + i] === 1
  }
  const leaks = s.markers.filter(([type, p]) => SPAWNS.includes(type) && Math.abs(p[1] - ground) < 0.2 && isOut(p[0], p[2]))
  if (leaks.length) out.push(`The outer walls leak: ${leaks.length} ground spawns can walk off the map (e.g. ${leaks[0][1].map(r1).join(', ')})`)
  else {
    for (const p of s.parts) if (!isFloor(p) && !walls.includes(p) && p.at[1] < ground + 6 && isOut(p.at[0], p.at[2])) out.push(`${at(p)}: outside the walls`)
    for (const [type, p] of s.markers) if (isOut(p[0], p[2])) out.push(`${type} at ${p.map(r1).join(', ')}: outside the walls`)
  }
  return out
}

/** Spawns looking straight into a wall (nothing to see within 3 m), or away from the map. */
export function spawnFacing(s: Sample, input = sampleInput(s), bvh = new Bvh(input.tris, input.flags)): string[] {
  const out: string[] = []
  for (const [type, p, patch] of s.markers) {
    if (!SPAWNS.includes(type)) continue
    const yaw = ((patch?.yaw ?? 0) * Math.PI) / 180
    const dx = Math.sin(yaw), dz = -Math.cos(yaw)
    const eye: Vec3 = [p[0], p[1] + 0.1 + PLAYER.standEye, p[2]]
    if (bvh.blocked(eye[0], eye[1], eye[2], eye[0] + dx * 6, eye[1], eye[2] + dz * 6, SOLID)) out.push(`${type} at ${p.map(r1).join(', ')}: faces a wall`)
  }
  return out
}

/** Team spawns an enemy team spawn can see (shot as you appear). */
export function spawnSight(s: Sample, input = sampleInput(s), bvh = new Bvh(input.tris, input.flags)): string[] {
  const eye = (p: Vec3) => [p[0], p[1] + 0.1 + PLAYER.standEye, p[2]]
  const red = s.markers.filter(([t]) => t === 'Red team spawn').map(([, p]) => p)
  const blue = s.markers.filter(([t]) => t === 'Blue team spawn').map(([, p]) => p)
  const out: string[] = []
  for (const r of red) for (const b of blue) if (!bvh.blocked(...(eye(r) as Vec3), ...(eye(b) as Vec3), OPAQUE)) out.push(`Red spawn ${r.map(r1).join(', ')} sees blue spawn ${b.map(r1).join(', ')}`)
  return out
}

/** Markers a player can't walk to, and platforms with a way up that nobody can reach. */
export function reach(s: Sample, input = sampleInput(s)): string[] {
  const p = prepareMap(input, { cell: 2 })
  const out = p.unreachable.map((u) => `${u.type} at ${u.position.map(r1).join(', ')}: can't be walked to`)
  const P = p.g.grid.pos, R = p.g.grid.reachable
  for (const q of s.parts) {
    if (!/Platform|Island|Deck|Tier|Core ring|Seating|Concourse|Balcony|Catwalk|Ledge/.test(q.label) || q.kind === 'ramp' || q.kind === 'stairs' || top(q) < 1 + JUMP_UP) continue
    let nodes = 0, reached = 0
    for (let n = 0; n < p.g.grid.count; n++) {
      if (Math.abs(P[n * 3 + 1] - top(q)) > 0.3 || !over(q, P[n * 3], P[n * 3 + 2], -0.6)) continue
      nodes++
      if (R[n]) reached++
    }
    if (nodes >= 3 && !reached) out.push(`${at(q)}: a platform nobody can get onto`)
  }
  return out
}

/** Every check on a built map. */
export function sanity(s: Sample): Record<string, string[]> {
  const input = sampleInput(s)
  const bvh = new Bvh(input.tris, input.flags)
  return {
    floating: floating(s), sunk: sunk(s), overlaps: overlaps(s), ramps: ramps(s), gates: gates(s),
    enclosure: enclosure(s), facing: spawnFacing(s, input, bvh), spawnSight: spawnSight(s, input, bvh), reach: reach(s, input),
  }
}
