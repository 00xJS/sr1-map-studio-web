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

/** The part a marker stands on: a flat top at its height, under it. */
export function support(parts: Part[], [x, y, z]: Vec3): number {
  let best = -1
  parts.forEach((p, i) => {
    if ((p.kind === 'box' || p.kind === 'cylinder') && Math.abs(p.at[1] + p.size[1] - y) < 0.01 && over(p, x, z, -0.2)) best = i
  })
  return best
}

/** Something within half a unit of a marker between its feet and head height (about 3.4 units). */
export function blocker(parts: Part[], [x, y, z]: Vec3): Part | undefined {
  return parts.find((p) => p.kind === 'terrain' ? terrainBlocks(p, x, y, z) : p.at[1] < y + 3.4 && p.at[1] + p.size[1] > y + 0.01 && over(p, x, z, 0.5)
    // Paint, paths, curbs and water films at foot level are stepped over, not walls.
    && !(p.size[1] <= 0.3 && p.at[1] + p.size[1] <= y + 0.35))
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
  // Parts of a prefab (a group) move as one piece and keep their size, unless marked big.
  const big = s.parts.map((p) => !!p.big || (!p.group && Math.max(p.size[0], p.size[2]) >= BIG && !KEEP.test(p.label)))
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
      if (!big[j] && ((!!s.parts[i].group && s.parts[i].group === s.parts[j].group) || (!(leans[i] && leans[j]) && touches(boxes[i], boxes[j])))) parent[find(i)] = find(j)
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
  const lights = s.lights?.map(([p, c]): [Vec3, Vec3?] => [[p[0] * k, p[1], p[2] * k], c])
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
