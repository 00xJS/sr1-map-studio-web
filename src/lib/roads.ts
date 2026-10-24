// Roads: polylines drawn on the map turned into streets. Each line gets
// asphalt with lane markings, kerbs and sidewalks either side, and street
// lamps along the sidewalk. Where lines of the same road meet or cross, the
// sidewalks stop short, a junction plate fills the middle, the corners get a
// paved fill and each arm gets a zebra crossing. Bends are mitred so the
// pieces meet without gaps. Built from the same block-out pieces as prefabs,
// so a whole road network is one object in the editor and one mesh in game.
// Coordinates are editor units (1 unit = 0.5 m); a road lies on the surface
// at its base height (ground level y 1 in the sample maps).
import type { Vec3 } from './project'
import { LIGHT, PB, blob, box, turn, type Part, type Tex } from './sampleKit'
import { lamp } from './prefabs'
import type { ParamDef, Params, PrefabDef } from './prefabs'

export type Pt = [number, number]
export type Polyline = Pt[]

export interface RoadOptions {
  /** Kerb to kerb, units (14 = two 3.5 m lanes). */
  width: number
  /** Sidewalk width each side, kerb included; 0 for none. */
  walk: number
  lines: 'dashed' | 'double' | 'none'
  /** Units between street lamps; 0 for none. */
  lamps: number
  crossings: boolean
}

export const ROAD_DEFAULTS: RoadOptions = { width: 14, walk: 5, lines: 'dashed', lamps: 28, crossings: true }

/** Asphalt sits this far proud of the surface (so it never fights the ground); sidewalks this high (a kerb a players steps up). */
export const ROAD_H = 0.06
export const WALK_H = 0.32
const KERB = 0.6
const MARK_H = 0.02

export const ROAD_TEX = {
  asphalt: { gen: 'asphalt', tweak: { line: 'none', seed: 81 } } as Tex,
  walk: { gen: 'tiles', tweak: { color: '#a29e95', accent: '#77736c', scale: 4, wear: 0.25, seed: 83 } } as Tex,
  kerb: PB.concrete,
  white: { gen: 'paint', tweak: { color: '#e6e4de', accent: '#c9c6bd', scale: 2, wear: 0.1, seed: 94 }, surface: 0 } as Tex,
  yellow: { gen: 'paint', tweak: { color: '#e8b81c', accent: '#b38a10', scale: 2, wear: 0.15, seed: 95 }, surface: 0 } as Tex,
}

// ---------------- vectors ----------------

const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]]
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k]
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1]
const crs = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0]
const len = (a: Pt) => Math.hypot(a[0], a[1])
const unit = (a: Pt): Pt => { const l = len(a) || 1; return [a[0] / l, a[1] / l] }
/** Left of a direction, turning toward increasing angle (atan2(z, x)). */
const left = (d: Pt): Pt => [-d[1], d[0]]
const angle = (d: Pt) => Math.atan2(d[1], d[0])

/** Where two lines (point + direction) cross, or null if they are (nearly) parallel. */
function meet(p: Pt, d: Pt, q: Pt, e: Pt): Pt | null {
  const den = crs(d, e)
  if (Math.abs(den) < 1e-6) return null
  return add(p, mul(d, crs(sub(q, p), e) / den))
}

// ---------------- the network ----------------

interface Edge { a: number; b: number }
export interface RoadGraph { nodes: Pt[]; edges: Edge[]; links: number[][] }

const TOL = 0.3

/** Splits the lines where they cross or one ends on another, and joins them into one graph of nodes and edges. */
export function roadGraph(lines: Polyline[], snap = 4): RoadGraph {
  // Clean: no repeated points, at least one segment.
  const ls = lines.map((l) => l.filter((p, i) => i === 0 || len(sub(p, l[i - 1])) > TOL)).filter((l) => l.length >= 2).map((l) => l.map((p): Pt => [p[0], p[1]]))
  // Points along each line, as (parameter, point): its own vertices plus where others cross it or end on it.
  const stops = ls.map((l) => l.map((p, i): [number, Pt] => [i, p]))
  // An end that stops near another line joins it there (a T, or an L where two ends meet).
  ls.forEach((l, a) => {
    for (const which of [0, l.length - 1]) {
      let best: { b: number; t: number; foot: Pt; dist: number } | null = null
      ls.forEach((m, b) => {
        if (b === a) return
        for (let j = 0; j + 1 < m.length; j++) {
          const q = m[j], e = sub(m[j + 1], q), L2 = dot(e, e)
          const t = Math.max(0, Math.min(1, dot(sub(l[which], q), e) / L2))
          const foot = add(q, mul(e, t)), dist = len(sub(l[which], foot))
          if (dist < snap && (!best || dist < best.dist)) best = { b, t: j + t, foot, dist }
        }
      })
      if (!best) continue
      const { b, t, foot } = best as { b: number; t: number; foot: Pt }
      l[which] = foot
      stops[a][which] = [which, foot]
      stops[b].push([t, foot])
    }
  })
  // Lines that cross each other.
  for (let a = 0; a < ls.length; a++) for (let b = a + 1; b < ls.length; b++) {
    for (let i = 0; i + 1 < ls[a].length; i++) for (let j = 0; j + 1 < ls[b].length; j++) {
      const p = ls[a][i], d = sub(ls[a][i + 1], p), q = ls[b][j], e = sub(ls[b][j + 1], q)
      const den = crs(d, e)
      if (Math.abs(den) < 1e-9) continue
      const t = crs(sub(q, p), e) / den, u = crs(sub(q, p), d) / den
      if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) continue
      const x = add(p, mul(d, t))
      stops[a].push([i + t, x]); stops[b].push([j + u, x])
    }
  }

  const nodes: Pt[] = []
  const nodeAt = (p: Pt) => {
    let k = nodes.findIndex((n) => len(sub(n, p)) < TOL * 2)
    if (k < 0) { k = nodes.length; nodes.push(p) }
    return k
  }
  const edges: Edge[] = []
  const seen = new Set<string>()
  for (const st of stops) {
    const order = st.sort((x, y) => x[0] - y[0]).map(([, p]) => nodeAt(p))
    for (let k = 0; k + 1 < order.length; k++) {
      const a = order[k], b = order[k + 1]
      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      if (a === b || seen.has(key)) continue
      seen.add(key)
      edges.push({ a, b })
    }
  }
  const links = nodes.map(() => [] as number[])
  edges.forEach((e, i) => { links[e.a].push(i); links[e.b].push(i) })
  return { nodes, edges, links }
}

// ---------------- building the pieces ----------------

/** A flat piece with the given outline (any convex polygon), `h` thick, from height y. */
function slab(label: string, pts: Pt[], y: number, h: number, top: Tex, side: Tex, tile = 6): Part | null {
  const ring = pts.filter((p, i) => len(sub(p, pts[(i + pts.length - 1) % pts.length])) > 0.02)
  if (ring.length < 3) return null
  const c = mul(ring.reduce<Pt>((s, p) => add(s, p), [0, 0]), 1 / ring.length)
  // Skip slivers: a piece needs some area.
  let area = 0
  ring.forEach((p, i) => { area += crs(p, ring[(i + 1) % ring.length]) })
  if (Math.abs(area) / 2 < 0.05) return null
  return blob(label, ring.map((p): [number, number] => [+(p[0] - c[0]).toFixed(3), +(p[1] - c[1]).toFixed(3)]), h, [+c[0].toFixed(3), y, +c[1].toFixed(3)], top, side, tile)
}

export interface RoadBuild { parts: Part[]; lights: [Vec3, Vec3?][]; junctions: Pt[]; graph: RoadGraph }

/** The pieces of a road network in its own frame (y is the surface it lies on). */
export function buildRoad(lines: Polyline[], o: RoadOptions, y = 1): RoadBuild {
  const g = roadGraph(lines, Math.max(2, o.width * 0.4))
  const hw = Math.max(2, o.width / 2)
  const walk = Math.max(0, o.walk)
  const outer = hw + walk
  const parts: Part[] = []
  const lights: [Vec3, Vec3?][] = []
  const push = (p: Part | null) => { if (p) parts.push(p) }
  const dirAway = (n: number, ei: number): Pt => { const e = g.edges[ei]; const other = e.a === n ? e.b : e.a; return unit(sub(g.nodes[other], g.nodes[n])) }

  // Junctions: arms in angle order, how far each arm's sidewalk stops short, the corners between arms.
  interface Arm { edge: number; d: Pt; n: Pt; cut: number; inner: number }
  interface Gap { a: Arm; b: Arm; p1: Pt | null; p2: Pt | null }
  const junction = new Map<number, { arms: Arm[]; gaps: Gap[] }>()
  g.links.forEach((ls, ni) => {
    if (ls.length < 3) return
    const J = g.nodes[ni]
    const arms: Arm[] = ls.map((ei) => { const d = dirAway(ni, ei); return { edge: ei, d, n: left(d), cut: hw + 1, inner: hw } }).sort((x, y) => angle(x.d) - angle(y.d))
    const gaps: Gap[] = arms.map((a, k) => {
      const b = arms[(k + 1) % arms.length]
      let turnBy = angle(b.d) - angle(a.d)
      if (turnBy <= 0) turnBy += Math.PI * 2
      // Corners only where the gap is less than a straight line; across a straight side the sidewalk just runs through.
      if (turnBy > Math.PI - 0.09) return { a, b, p1: null, p2: null }
      return { a, b, p1: meet(add(J, mul(a.n, hw)), a.d, sub(J, mul(b.n, hw)), b.d), p2: meet(add(J, mul(a.n, outer)), a.d, sub(J, mul(b.n, outer)), b.d) }
    })
    for (const gp of gaps) {
      if (!gp.p1 || !gp.p2) continue
      for (const arm of [gp.a, gp.b]) {
        arm.inner = Math.max(arm.inner, dot(sub(gp.p1, J), arm.d))
        arm.cut = Math.max(arm.cut, dot(sub(gp.p2, J), arm.d), dot(sub(gp.p1, J), arm.d) + (o.crossings ? 4.5 : 1))
      }
    }
    junction.set(ni, { arms, gaps })
  })
  const cutAt = (ni: number, ei: number) => junction.get(ni)?.arms.find((a) => a.edge === ei)?.cut ?? 0

  // Where an offset line of an edge starts or ends at a node: square at ends and junctions, mitred at bends.
  const corner = (ni: number, ei: number, along: Pt, n: Pt, off: number): Pt => {
    const ls = g.links[ni]
    const N = g.nodes[ni]
    const start = g.edges[ei].a === ni
    if (ls.length === 2) {
      // A bend: both pieces share the mitre point on each offset line.
      const od = dirAway(ni, ls[0] === ei ? ls[1] : ls[0])
      // The other edge's left side, seen travelling through the bend in this edge's direction.
      const on = start ? mul(left(od), -1) : left(od)
      const m = unit(add(n, on))
      const k = dot(m, n)
      if (len(add(n, on)) > 1e-3 && k > 0.35) return add(N, mul(m, off / k))
      return add(N, mul(n, off))
    }
    return add(add(N, mul(along, start ? cutAt(ni, ei) : -cutAt(ni, ei))), mul(n, off))
  }

  const bands: [string, number, number, number, Tex, Tex][] = [['Road', -hw, hw, ROAD_H, ROAD_TEX.asphalt, ROAD_TEX.kerb]]
  if (walk > 0) {
    const k = Math.min(KERB, walk)
    bands.push(['Kerb', hw, hw + k, WALK_H, ROAD_TEX.kerb, ROAD_TEX.kerb], ['Kerb', -hw - k, -hw, WALK_H, ROAD_TEX.kerb, ROAD_TEX.kerb])
    if (walk > k) bands.push(['Sidewalk', hw + k, outer, WALK_H, ROAD_TEX.walk, ROAD_TEX.kerb], ['Sidewalk', -outer, -hw - k, WALK_H, ROAD_TEX.walk, ROAD_TEX.kerb])
  }
  const marks: [string, number, number, Tex][] = []
  if (o.lines !== 'none' && hw >= 3) marks.push(['Edge line', hw - 0.9, hw - 0.6, ROAD_TEX.white], ['Edge line', -hw + 0.6, -hw + 0.9, ROAD_TEX.white])
  if (o.lines === 'double') marks.push(['Centre line', -0.45, -0.15, ROAD_TEX.yellow], ['Centre line', 0.15, 0.45, ROAD_TEX.yellow])

  let lampSide = 1
  g.edges.forEach((e, ei) => {
    const A = g.nodes[e.a], B = g.nodes[e.b]
    const d = unit(sub(B, A)), n = left(d), L = len(sub(B, A))
    const s0 = g.links[e.a].length >= 3 ? cutAt(e.a, ei) : 0, s1 = g.links[e.b].length >= 3 ? cutAt(e.b, ei) : 0
    if (s0 + s1 > L - 0.2) return
    for (const [label, o1, o2, h, top, side] of bands) {
      push(slab(label, [corner(e.a, ei, d, n, o1), corner(e.b, ei, d, n, o1), corner(e.b, ei, d, n, o2), corner(e.a, ei, d, n, o2)], y, h, top, side, label === 'Road' ? 8 : 4))
    }
    for (const [label, o1, o2, tex] of marks) {
      push(slab(label, [corner(e.a, ei, d, n, o1), corner(e.b, ei, d, n, o1), corner(e.b, ei, d, n, o2), corner(e.a, ei, d, n, o2)], y + ROAD_H, MARK_H, tex, tex, 2))
    }
    const rot = +((Math.atan2(d[0], d[1]) * 180) / Math.PI).toFixed(3)
    // Dashes down the middle: 3 units painted, 3 left.
    if (o.lines === 'dashed') {
      const from = s0 + 1.5, to = L - s1 - 1.5
      for (let t = from; t + 3 <= to + 1e-6; t += 6) {
        const c = add(A, mul(d, t + 1.5))
        parts.push(box('Lane dash', [0.3, MARK_H, 3], [+c[0].toFixed(3), y + ROAD_H, +c[1].toFixed(3)], ROAD_TEX.white, ROAD_TEX.white, rot, 2))
      }
    }
    // Lamps along the sidewalk, sides taking turns, clear of the junctions.
    if (o.lamps > 0) {
      const from = s0 + 3, to = L - s1 - 3
      const off = walk > 0 ? hw + Math.min(KERB, walk) + 0.7 : hw + 1.5
      const ly = y + (walk > 0 ? WALK_H : 0)
      const count = Math.floor((to - from) / o.lamps)
      for (let k = 0; k <= count && to - from >= 0; k++) {
        const t = count > 0 ? from + ((to - from) * k) / count : (from + to) / 2
        const side = lampSide
        lampSide = -lampSide
        const p = add(add(A, mul(d, t)), mul(n, off * side))
        // The arm reaches toward +Z before turning: point it at the road.
        const face = mul(n, -side)
        const r = +((Math.atan2(face[0], face[1]) * 180) / Math.PI).toFixed(3)
        const [x, z] = [+p[0].toFixed(3), +p[1].toFixed(3)]
        parts.push(...lamp(x, z, ly, r))
        const [hx, hz] = turn(0, 1.8, r)
        lights.push([[+(x + hx).toFixed(3), +(ly + 8.6).toFixed(3), +(z + hz).toFixed(3)], LIGHT.warm])
        if (count === 0) break
      }
    }
  })

  // Junction plates, corner fills and crossings.
  for (const [ni, { arms, gaps }] of junction) {
    const J = g.nodes[ni]
    const plate: Pt[] = []
    for (const gp of gaps) {
      const a = gp.a
      plate.push(add(add(J, mul(a.d, a.cut)), mul(a.n, -hw)), add(add(J, mul(a.d, a.cut)), mul(a.n, hw)))
      if (gp.p1) plate.push(gp.p1)
    }
    // Fanned from the junction's middle, so it is drawn as one piece round J.
    push(blob('Junction', plate.map((p): [number, number] => [+(p[0] - J[0]).toFixed(3), +(p[1] - J[1]).toFixed(3)]), ROAD_H, [+J[0].toFixed(3), y, +J[1].toFixed(3)], ROAD_TEX.asphalt, ROAD_TEX.kerb, 8))
    if (walk > 0) for (const gp of gaps) {
      const { a, b } = gp
      const aIn = add(add(J, mul(a.d, a.cut)), mul(a.n, hw)), aOut = add(add(J, mul(a.d, a.cut)), mul(a.n, outer))
      const bIn = sub(add(J, mul(b.d, b.cut)), mul(b.n, hw)), bOut = sub(add(J, mul(b.d, b.cut)), mul(b.n, outer))
      let turnBy = angle(b.d) - angle(a.d)
      if (turnBy <= 0) turnBy += Math.PI * 2
      if (gp.p1 && gp.p2) push(slab('Sidewalk', [aIn, aOut, gp.p2, bOut, bIn, gp.p1], y, WALK_H, ROAD_TEX.walk, ROAD_TEX.kerb, 4))
      else if (turnBy < Math.PI + 0.09) push(slab('Sidewalk', [aIn, aOut, bOut, bIn], y, WALK_H, ROAD_TEX.walk, ROAD_TEX.kerb, 4))
    }
    if (o.crossings) for (const a of arms) {
      const t0 = a.inner + 0.6, t1 = a.cut - 0.6
      if (t1 - t0 < 1.5) continue
      const rot = +((Math.atan2(a.d[0], a.d[1]) * 180) / Math.PI).toFixed(3)
      for (let off = -hw + 1.2; off <= hw - 1.2 + 1e-6; off += 1.8) {
        const c = add(add(J, mul(a.d, (t0 + t1) / 2)), mul(a.n, off))
        parts.push(box('Crosswalk', [0.9, MARK_H, +(t1 - t0).toFixed(3)], [+c[0].toFixed(3), y + ROAD_H, +c[1].toFixed(3)], ROAD_TEX.white, ROAD_TEX.white, rot, 2))
      }
    }
  }
  return { parts, lights, junctions: [...junction.keys()].map((k) => g.nodes[k]), graph: g }
}

// ---------------- the road prefab ----------------

/** Lines as stored in a placed road: offsets from its origin, [x, z] points per line. */
export const parsePath = (s: string | number | undefined): Polyline[] => {
  try {
    const v = JSON.parse(String(s ?? '[]'))
    return Array.isArray(v) ? v.filter((l) => Array.isArray(l) && l.length >= 2).map((l) => l.map((p: unknown) => [Number((p as number[])[0]) || 0, Number((p as number[])[1]) || 0] as Pt)) : []
  } catch { return [] }
}
export const formatPath = (lines: Polyline[]) => JSON.stringify(lines.map((l) => l.map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)])))

export const roadOptions = (p: Params): RoadOptions => ({
  width: Number(p.width) || ROAD_DEFAULTS.width,
  walk: Math.max(0, Number(p.walk ?? ROAD_DEFAULTS.walk)),
  lines: (['dashed', 'double', 'none'].includes(String(p.lines)) ? p.lines : 'dashed') as RoadOptions['lines'],
  lamps: Math.max(0, Number(p.lamps ?? ROAD_DEFAULTS.lamps)),
  crossings: p.crossings !== 'no',
})

export const ROAD_PARAMS: ParamDef[] = [
  { key: 'path', label: 'Points', kind: 'path', default: '[[[-20,0],[20,0]]]' },
  { key: 'width', label: 'Road width', kind: 'number', min: 6, max: 40, step: 1, default: 14 },
  { key: 'walk', label: 'Sidewalks', kind: 'number', min: 0, max: 14, step: 0.5, default: 5 },
  { key: 'lines', label: 'Markings', kind: 'select', options: [['dashed', 'Dashed'], ['double', 'Double yellow'], ['none', 'None']], default: 'dashed' },
  { key: 'lamps', label: 'Lamp spacing', kind: 'number', min: 0, max: 120, step: 2, default: 28 },
  { key: 'crossings', label: 'Crossings', kind: 'select', options: [['yes', 'At junctions'], ['no', 'None']], default: 'yes' },
]

/** Builds a road from its settings at (x, z), turned by rot. */
export function roadPrefabParts(x: number, z: number, rot: number, y: number, p: Params = {}): Part[] {
  const { parts } = buildRoad(parsePath(p.path ?? ROAD_PARAMS[0].default), roadOptions(p), 0)
  return parts.map((q) => {
    const [ox, oz] = turn(q.at[0], q.at[2], rot)
    return { ...q, at: [+(x + ox).toFixed(3), +(y + q.at[1]).toFixed(3), +(z + oz).toFixed(3)] as Vec3, rot: (((q.rot ?? 0) + rot) % 360 + 360) % 360 }
  })
}

export const ROAD_PREFABS: Record<string, PrefabDef & { category: string }> = {
  road: { category: 'Street', label: 'Road', hint: 'Asphalt, lane markings, kerbs, sidewalks, crossings and lamps. Draw one with the Road tool.', params: ROAD_PARAMS, make: roadPrefabParts },
}
