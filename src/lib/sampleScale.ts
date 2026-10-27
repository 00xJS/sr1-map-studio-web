// Spreads a compact sample map out to full multiplayer size.
//
// Retail Gangsta Brawl / Big Ass Chains maps are about 70-120 m across for
// 4-12 players, with spawns 10-16 m apart. At the default world scale (1 unit =
// 0.5 m) the first samples were drawn about half that size, so they are built
// at twice the spacing by default:
// - Structure (ground, outer walls, buildings, decks, roads, and anything that
//   bridges two of them) scales with the map, in width and depth, not height.
// - Props (bunkers, crates, cars, huts, stairs) keep their size. Props that
//   touch each other move together; a prop against a structure stays against it.
// - Markers move with whatever they stand on.
import type { Vec3 } from './project'
import type { MarkerSpec, Part, Sample } from './sampleKit'
import { heightAt } from './terrain'

/** Footprint at or above this (units) counts as structure. */
const BIG = 16
/** Vehicles and containers keep their real size even when long. */
const KEEP = /container|train car|\bcar\b|van|dumpster|bus/i
const EPS = 0.06

interface Box { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }

function aabb(p: Part): Box {
  const t = ((p.rot ?? 0) * Math.PI) / 180
  const hx = p.size[0] / 2, hz = p.size[2] / 2
  const ex = Math.abs(Math.cos(t)) * hx + Math.abs(Math.sin(t)) * hz
  const ez = Math.abs(Math.sin(t)) * hx + Math.abs(Math.cos(t)) * hz
  return { x0: p.at[0] - ex, x1: p.at[0] + ex, z0: p.at[2] - ez, z1: p.at[2] + ez, y0: p.at[1], y1: p.at[1] + p.size[1] }
}

const touches = (a: Box, b: Box) =>
  a.x0 <= b.x1 + EPS && b.x0 <= a.x1 + EPS && a.z0 <= b.z1 + EPS && b.z0 <= a.z1 + EPS && a.y0 <= b.y1 + EPS && b.y0 <= a.y1 + EPS
/** Within `gap` of each other (props this close belong together: a tire row, a stall's posts, a hoop's board). */
const near = (a: Box, b: Box, gap: number) =>
  a.x0 <= b.x1 + gap && b.x0 <= a.x1 + gap && a.z0 <= b.z1 + gap && b.z0 <= a.z1 + gap && a.y0 <= b.y1 + gap && b.y0 <= a.y1 + gap
/** Touching side by side rather than one resting on the other. */
const beside = (a: Box, b: Box) => touches(a, b) && Math.abs(a.y0 - b.y1) > EPS && Math.abs(b.y0 - a.y1) > EPS

/** Inside a part's footprint (as seen from above), grown by `margin` (negative shrinks it). */
export function over(p: Part, x: number, z: number, margin: number) {
  const t = ((p.rot ?? 0) * Math.PI) / 180
  const dx = x - p.at[0], dz = z - p.at[2]
  const lx = dx * Math.cos(t) - dz * Math.sin(t)
  const lz = dx * Math.sin(t) + dz * Math.cos(t)
  const rx = p.size[0] / 2 + margin, rz = p.size[2] / 2 + margin
  if (rx <= 0 || rz <= 0) return false
  if (p.kind === 'cylinder') return (lx / rx) ** 2 + (lz / rz) ** 2 <= 1
  return Math.abs(lx) <= rx && Math.abs(lz) <= rz
}

const standsOn = (p: Part, x: number, y: number, z: number) =>
  (p.kind === 'box' || p.kind === 'cylinder') && Math.abs(p.at[1] + p.size[1] - y) < 0.01 && over(p, x, z, -0.2)

const blocks = (p: Part, x: number, y: number, z: number) =>
  p.kind === 'terrain' ? terrainBlocks(p, x, y, z) : p.at[1] < y + 3.4 && p.at[1] + p.size[1] > y + 0.01 && over(p, x, z, 0.5)
    // Paint, paths, curbs and water films at foot level are stepped over, not walls.
    && !(p.size[1] <= 0.3 && p.at[1] + p.size[1] <= y + 0.35)

/** The part a marker stands on: a flat top at its height, under it. */
export function support(parts: Part[], [x, y, z]: Vec3): number {
  let best = -1
  parts.forEach((p, i) => {
    if (standsOn(p, x, y, z)) best = i
  })
  return best
}

/** Something within half a unit of a marker between its feet and head height (about 3.4 units). */
export function blocker(parts: Part[], [x, y, z]: Vec3): Part | undefined {
  return parts.find((p) => blocks(p, x, y, z))
}

export interface PartIndex {
  /** Same answer as support(parts, at). */
  support(at: Vec3): number
  /** Same answer as blocker(parts, at). */
  blocker(at: Vec3): Part | undefined
  /** Whether any part whose footprint (grown by up to a unit) covers x, z passes the test. */
  some(x: number, z: number, test: (p: Part) => boolean): boolean
}

/**
 * support and blocker for many spots on one map: parts are filed by the 8-unit squares their footprint covers,
 * so each question looks at the few parts nearby instead of all of them. The parts must not change while it's used.
 */
export function partIndex(parts: Part[]): PartIndex {
  const C = 8, GROW = 1, cells = new Map<number, number[]>(), wide: number[] = []
  const key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768)
  parts.forEach((p, i) => {
    const b = aabb(p)
    const x0 = Math.floor((b.x0 - GROW) / C), x1 = Math.floor((b.x1 + GROW) / C), z0 = Math.floor((b.z0 - GROW) / C), z1 = Math.floor((b.z1 + GROW) / C)
    // Huge, far-off or broken footprints are checked everywhere.
    if (!((x1 - x0 + 1) * (z1 - z0 + 1) <= 4096) || Math.max(-x0, x1, -z0, z1) > 32000) { wide.push(i); return }
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = key(cx, cz), list = cells.get(k)
      if (list) list.push(i)
      else cells.set(k, [i])
    }
  })
  const NONE: number[] = []
  const near = (x: number, z: number) => cells.get(key(Math.floor(x / C), Math.floor(z / C))) ?? NONE
  return {
    support([x, y, z]) {
      // The last matching part, as support() gives.
      let best = -1
      const list = near(x, z)
      for (let j = list.length - 1; j >= 0; j--) if (standsOn(parts[list[j]], x, y, z)) { best = list[j]; break }
      for (let j = wide.length - 1; j >= 0 && wide[j] > best; j--) if (standsOn(parts[wide[j]], x, y, z)) { best = wide[j]; break }
      return best
    },
    blocker([x, y, z]) {
      // The first matching part, as blocker() gives.
      let first = Infinity
      for (const i of near(x, z)) if (blocks(parts[i], x, y, z)) { first = i; break }
      for (const i of wide) { if (i > first) break; if (blocks(parts[i], x, y, z)) { first = i; break } }
      return parts[first]
    },
    some(x, z, test) {
      return near(x, z).some((i) => test(parts[i])) || wide.some((i) => test(parts[i]))
    },
  }
}

/**
 * A ray test over a sample's parts for openHeading (markerPlan.ts): something solid whose box spans the line's
 * height somewhere along it, a unit at a time (water doesn't block).
 */
export function partRay(parts: Part[]): (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => boolean {
  const idx = partIndex(parts)
  return (ax, ay, az, bx, _by, bz) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)))
    for (let s = 1; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps, z = az + ((bz - az) * s) / steps
      if (idx.some(x, z, (q) => !q.water && q.at[1] < ay && q.at[1] + q.size[1] > ay && over(q, x, z, 0))) return true
    }
    return false
  }
}

/** Terrain is in the way where its surface within half a unit of the spot rises more than a kerb above the feet. */
function terrainBlocks(p: Part, x: number, y: number, z: number) {
  const t = ((p.rot ?? 0) * Math.PI) / 180
  const shape = { kind: p.kind, size: p.size, tile: 4, cells: p.cells, heights: p.heights }
  for (const [ox, oz] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) {
    const dx = x + ox - p.at[0], dz = z + oz - p.at[2]
    const hgt = heightAt(shape, dx * Math.cos(t) - dz * Math.sin(t), dx * Math.sin(t) + dz * Math.cos(t))
    if (hgt !== null && p.at[1] + p.size[1] + hgt > y + 0.35) return true
  }
  return false
}

export function spreadSample(s: Sample, k: number): Sample {
  if (k === 1) return s
  const boxes = s.parts.map(aabb)
  // The parts of a placed prefab stay one piece of its own size.
  const big = s.parts.map((p) => !p.group && (!!p.big || (Math.max(p.size[0], p.size[2]) >= BIG && !KEEP.test(p.label))))
  // A small piece wedged between two structures (a bridge, a step) has to stretch with them.
  s.parts.forEach((p, i) => {
    if (big[i] || p.group || KEEP.test(p.label)) return
    const n = boxes.filter((b, j) => big[j] && j !== i && beside(boxes[i], b)).length
    if (n >= 2) big[i] = true
  })

  // Props that touch each other move as one piece, except two that each lean on
  // a structure (stairs up the faces of a stepped pyramid follow their own step).
  const leans = s.parts.map((_, i) => !big[i] && boxes.some((b, j) => big[j] && beside(boxes[i], b)))
  const parent = s.parts.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  s.parts.forEach((_, i) => {
    if (big[i]) return
    for (let j = i + 1; j < s.parts.length; j++) {
      if (!big[j] && ((!!s.parts[i].group && s.parts[i].group === s.parts[j].group) || (!(leans[i] && leans[j]) && near(boxes[i], boxes[j], 0.5)))) parent[find(i)] = find(j)
    }
  })
  const groups = new Map<number, number[]>()
  s.parts.forEach((_, i) => { if (!big[i]) { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), i]) } })

  // How far each group moves: from its center, or from where it leans on a structure.
  const shift = new Map<number, [number, number]>()
  for (const [root, members] of groups) {
    let anchor: [number, number] | null = null
    for (const i of members) {
      for (let j = 0; j < s.parts.length && !anchor; j++) {
        if (!big[j] || !beside(boxes[i], boxes[j])) continue
        const a = boxes[i], b = boxes[j]
        anchor = [(Math.max(a.x0, b.x0) + Math.min(a.x1, b.x1)) / 2, (Math.max(a.z0, b.z0) + Math.min(a.z1, b.z1)) / 2]
      }
      if (anchor) break
    }
    if (!anchor) {
      const bs = members.map((i) => boxes[i])
      anchor = [(Math.min(...bs.map((b) => b.x0)) + Math.max(...bs.map((b) => b.x1))) / 2, (Math.min(...bs.map((b) => b.z0)) + Math.max(...bs.map((b) => b.z1))) / 2]
    }
    shift.set(root, [(k - 1) * anchor[0], (k - 1) * anchor[1]])
  }

  const parts = s.parts.map((p, i): Part => {
    if (big[i]) return { ...p, at: [p.at[0] * k, p.at[1], p.at[2] * k], size: [p.size[0] * k, p.size[1], p.size[2] * k] }
    const [dx, dz] = shift.get(find(i))!
    return { ...p, at: [p.at[0] + dx, p.at[1], p.at[2] + dz], ...(p.prefab ? { prefab: { ...p.prefab, at: [p.prefab.at[0] + dx, p.prefab.at[1], p.prefab.at[2] + dz] } } : {}) }
  })

  const moveMarker = (pos: Vec3): Vec3 => {
    const i = support(s.parts, pos)
    if (i >= 0 && !big[i]) {
      const [dx, dz] = shift.get(find(i))!
      return [pos[0] + dx, pos[1], pos[2] + dz]
    }
    return [pos[0] * k, pos[1], pos[2] * k]
  }
  const markers = s.markers.map(([type, pos, patch]): MarkerSpec => [type, settle(parts, moveMarker(pos)), patch])
  // A light hung on a prop (a lantern, a lamp) moves with it; the rest spread with the map.
  const lights = s.lights?.map(([p, c]): [Vec3, Vec3?] => {
    const i = s.parts.findIndex((q, j) => !big[j] && over(q, p[0], p[2], 0.5) && p[1] >= q.at[1] && p[1] <= q.at[1] + q.size[1] + 1)
    if (i < 0) return [[p[0] * k, p[1], p[2] * k], c]
    const [dx, dz] = shift.get(find(i))!
    return [[p[0] + dx, p[1], p[2] + dz], c]
  })
  return { ...s, parts, markers, lights }
}

/** If a moved marker ended up against a prop, step it to the nearest clear spot at the same height. */
function settle(parts: Part[], pos: Vec3): Vec3 {
  if (support(parts, pos) >= 0 && !blocker(parts, pos)) return pos
  for (let r = 1; r <= 12; r++) {
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2
      const p: Vec3 = [+(pos[0] + r * Math.cos(t)).toFixed(2), pos[1], +(pos[2] + r * Math.sin(t)).toFixed(2)]
      if (support(parts, p) >= 0 && !blocker(parts, p)) return p
    }
  }
  return pos
}

/** Ground area in square metres (world scale 0.5) and the player count it suits, after retail maps (~450 m² a player). */
export function mapSize(s: Sample) {
  const grounds = s.parts.filter((p) => p.at[1] <= 0.01 && Math.max(p.size[0], p.size[2]) >= 40)
  const bs = grounds.map(aabb)
  const w = bs.length ? Math.max(...bs.map((b) => b.x1)) - Math.min(...bs.map((b) => b.x0)) : 0
  const d = bs.length ? Math.max(...bs.map((b) => b.z1)) - Math.min(...bs.map((b) => b.z0)) : 0
  const area = grounds.reduce((a, p) => a + (p.kind === 'cylinder' ? (Math.PI / 4) * p.size[0] * p.size[2] : p.size[0] * p.size[2]), 0) * 0.25
  const players = Math.max(2, Math.min(12, Math.round(area / 450)))
  return { widthM: Math.round(w / 2), depthM: Math.round(d / 2), areaM2: Math.round(area), players }
}
