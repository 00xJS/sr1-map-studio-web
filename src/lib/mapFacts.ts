// Facts about a map worked out in code, for the AI's critique: counts,
// symmetry, spawn safety (who can see whom), sight lines, cover, ways across
// the middle and weapon fairness. The model is handed these numbers rather
// than asked to guess them, and the problems found come with fixes (edits the
// chat can apply in one click).
//
// The geometry is a simple height grid: every object is a box (exact for
// block-out shapes, the 3D view's bounding box for anything else), and a
// cell's height is the top of the tallest box over it. Lines of sight are
// checked against that grid at eye height. A fuller analysis can replace this
// one behind `FactSource` (see setFactSource).
import { SPAWN_TYPES, type Project, type Vec3 } from './project'
import type { AiAction } from './aiChat'
import { findMarkerTwin, findTwin } from './aiEdits'

/** The 3D view's world box for object i, when it has one. */
export type BoundsFn = (index: number) => [Vec3, Vec3] | null

export interface FactInput { project: Project; bounds?: BoundsFn }

export type Topic = 'spawns' | 'sightlines' | 'cover' | 'flow' | 'fairness' | 'weapons'
export const TOPICS: Record<Topic, string> = {
  spawns: 'Spawn safety', sightlines: 'Sight lines', cover: 'Cover', flow: 'Flow', fairness: 'Fairness (red vs blue)', weapons: 'Weapon placement',
}

export interface FactFix { label: string; actions: AiAction[] }

/** A problem (or a good point) found in code, with a fix when there is an obvious one. */
export interface FactIssue {
  id: string
  topic: Topic
  severity: 'good' | 'info' | 'warn' | 'bad'
  text: string
  fix?: FactFix
}

export interface SpawnFact {
  marker: number
  type: string
  at: Vec3
  /** Enemy spawns (or, for shared spawns, other spawns within 40 m) this one can see. */
  seen: number[]
  /** Metres to the nearest enemy (or other) spawn. */
  nearest: number
  inside?: string
  noFloor?: boolean
  wrongEnd?: boolean
}

export interface MapFacts {
  source: string
  /** Metres per editor unit. */
  scale: number
  extent: { minX: number; maxX: number; minZ: number; maxZ: number; widthM: number; depthM: number }
  counts: { objects: number; lights: number; markers: Record<string, number> }
  symmetry: { objects: { total: number; matched: number; unmatched: number[] }; markers: { total: number; matched: number; unmatched: number[] }; score: number }
  spawns: { list: SpawnFact[]; exposed: number[]; inside: number[]; noFloor: number[]; wrongEnd: number[] }
  sightLines: { longestM: number; from: Vec3; to: Vec3; longCount: number }
  /** Share of open floor with something chest-high within 3 m, by area. */
  cover: { red: number; middle: number; blue: number }
  flow: { crossings: number[]; groundRoute: boolean | null; routeM: number | null; straightM: number | null }
  weapons: { total: number; red: number; middle: number; blue: number; byId: Record<string, number>; power: { id: string; at: Vec3; side: 'red' | 'middle' | 'blue' }[]; redNearestM: number | null; blueNearestM: number | null }
  issues: FactIssue[]
}

/** Something that works out MapFacts; the simple grid one is the default. */
export interface FactSource { name: string; gather(input: FactInput): MapFacts }

// ---------------- the height grid ----------------

const CELL = 2
const POWER = new Set(['sniper_rifle', 'rpg_launcher', 'rpg_laser'])
const r1 = (v: number) => Math.round(v * 10) / 10

interface Solid { item: number; name: string; cx: number; cz: number; hw: number; hd: number; cos: number; sin: number; y0: number; y1: number; exact: boolean }

/** Every object as a box: exact for shapes, the view's bounding box otherwise. */
export function solids(p: Project, bounds?: BoundsFn): Solid[] {
  const out: Solid[] = []
  p.scene_items.forEach((it, i) => {
    if (it.swimmable_water && !it.water_materials) return
    if (it.shape && it.shape.kind !== 'blob') {
      const [w, h, d] = it.shape.size.map((v) => v * it.scale)
      const rad = (it.rotation[1] * Math.PI) / 180
      // Ramps block about as much as a box half their height.
      const top = it.shape.kind === 'ramp' ? h * 0.5 : h
      out.push({ item: i, name: it.name, cx: it.position[0], cz: it.position[2], hw: w / 2, hd: d / 2, cos: Math.cos(rad), sin: Math.sin(rad), y0: it.position[1], y1: it.position[1] + top, exact: true })
      return
    }
    const b = bounds?.(i)
    if (!b) return
    out.push({ item: i, name: it.name, cx: (b[0][0] + b[1][0]) / 2, cz: (b[0][2] + b[1][2]) / 2, hw: (b[1][0] - b[0][0]) / 2, hd: (b[1][2] - b[0][2]) / 2, cos: 1, sin: 0, y0: b[0][1], y1: b[1][1], exact: false })
  })
  return out
}

/** Is (x, z) over the solid's footprint? */
function covers(s: Solid, x: number, z: number, margin = 0) {
  const dx = x - s.cx, dz = z - s.cz
  // Into the object's own axes (the inverse of its turn).
  const lx = dx * s.cos - dz * s.sin, lz = dx * s.sin + dz * s.cos
  return Math.abs(lx) <= s.hw + margin && Math.abs(lz) <= s.hd + margin
}

export class HeightGrid {
  readonly nx: number
  readonly nz: number
  readonly top: Float32Array
  floorY = 1
  constructor(readonly minX: number, readonly minZ: number, maxX: number, maxZ: number, readonly solids: Solid[]) {
    this.nx = Math.max(1, Math.ceil((maxX - minX) / CELL))
    this.nz = Math.max(1, Math.ceil((maxZ - minZ) / CELL))
    this.top = new Float32Array(this.nx * this.nz).fill(-Infinity)
    for (const s of solids) {
      const rx = Math.abs(s.hw * s.cos) + Math.abs(s.hd * s.sin), rz = Math.abs(s.hw * s.sin) + Math.abs(s.hd * s.cos)
      const [i0, k0] = this.cell(s.cx - rx, s.cz - rz), [i1, k1] = this.cell(s.cx + rx, s.cz + rz)
      for (let k = Math.max(0, k0); k <= Math.min(this.nz - 1, k1); k++) for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) {
        const [x, z] = this.centre(i, k)
        // Thin walls still fill a cell.
        if (!covers({ ...s, hw: Math.max(s.hw, CELL * 0.51), hd: Math.max(s.hd, CELL * 0.51) }, x, z, 0.01)) continue
        const n = k * this.nx + i
        if (s.y1 > this.top[n]) this.top[n] = s.y1
      }
    }
    // The floor is the most common height (the ground most players run on).
    const hist = new Map<number, number>()
    for (const v of this.top) if (Number.isFinite(v)) { const q = Math.round(v * 2) / 2; hist.set(q, (hist.get(q) ?? 0) + 1) }
    let best = 0
    for (const [h, n] of hist) if (n > best) { best = n; this.floorY = h }
  }
  cell(x: number, z: number): [number, number] { return [Math.floor((x - this.minX) / CELL), Math.floor((z - this.minZ) / CELL)] }
  centre(i: number, k: number): [number, number] { return [this.minX + (i + 0.5) * CELL, this.minZ + (k + 0.5) * CELL] }
  at(x: number, z: number): number {
    const [i, k] = this.cell(x, z)
    return i < 0 || k < 0 || i >= this.nx || k >= this.nz ? -Infinity : this.top[k * this.nx + i]
  }
  /** Can someone at eye height over a see someone at eye height over b? */
  clear(a: Vec3, b: Vec3, eye: number): boolean {
    const ya = a[1] + eye, yb = b[1] + eye
    const len = Math.hypot(b[0] - a[0], b[2] - a[2])
    const steps = Math.ceil(len / (CELL / 2))
    for (let s = 1; s < steps; s++) {
      const f = s / steps
      const h = this.at(a[0] + (b[0] - a[0]) * f, a[2] + (b[2] - a[2]) * f)
      if (h > ya + (yb - ya) * f) return false
    }
    return true
  }
}

// ---------------- the facts ----------------

function extentOf(p: Project, ss: Solid[]) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  const add = (x: number, z: number) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z) }
  for (const s of ss) {
    const rx = Math.abs(s.hw * s.cos) + Math.abs(s.hd * s.sin), rz = Math.abs(s.hw * s.sin) + Math.abs(s.hd * s.cos)
    add(s.cx - rx, s.cz - rz); add(s.cx + rx, s.cz + rz)
  }
  for (const m of p.markers) add(m.position[0], m.position[2])
  if (!Number.isFinite(minX)) { minX = -50; maxX = 50; minZ = -50; maxZ = 50 }
  return { minX: minX - CELL, maxX: maxX + CELL, minZ: minZ - CELL, maxZ: maxZ + CELL }
}

const sideOf = (z: number, depth: number): 'red' | 'middle' | 'blue' => (Math.abs(z) < depth * 0.08 ? 'middle' : z < 0 ? 'red' : 'blue')

/** The simple grid analysis. */
export const gridFacts: FactSource = {
  name: 'grid',
  gather({ project: p, bounds }): MapFacts {
    const scale = p.settings.world_scale || 0.5
    const m = (units: number) => r1(units * scale)
    const u = (metres: number) => metres / scale
    const ss = solids(p, bounds)
    const ex = extentOf(p, ss)
    const g = new HeightGrid(ex.minX, ex.minZ, ex.maxX, ex.maxZ, ss)
    const floor = g.floorY
    const eye = u(1.6), step = u(0.8), chest = u(1.0)
    const depth = ex.maxZ - ex.minZ
    const walkable = (h: number) => Number.isFinite(h) && h <= floor + step
    const issues: FactIssue[] = []

    // Counts.
    const markerCounts: Record<string, number> = {}
    for (const mk of p.markers) markerCounts[mk.type] = (markerCounts[mk.type] ?? 0) + 1

    // Symmetry.
    const unmatchedItems: number[] = []
    p.scene_items.forEach((_, i) => { if (findTwin(p, i) === null) unmatchedItems.push(i) })
    const unmatchedMarkers: number[] = []
    p.markers.forEach((mk, i) => { if (mk.type !== 'Pimp entrance' && findMarkerTwin(p, i) === null) unmatchedMarkers.push(i) })
    const twinnable = p.markers.filter((mk) => mk.type !== 'Pimp entrance').length
    const symScore = (p.scene_items.length + twinnable) ? 1 - (unmatchedItems.length + unmatchedMarkers.length) / (p.scene_items.length + twinnable) : 1

    // Spawns.
    const spawnIdx = p.markers.map((mk, i) => [mk, i] as const).filter(([mk]) => SPAWN_TYPES.includes(mk.type))
    const list: SpawnFact[] = spawnIdx.map(([mk, i]) => {
      const others = spawnIdx.filter(([o, j]) => j !== i && (mk.type === 'Shared spawn' ? o.type === 'Shared spawn' : o.type !== mk.type && o.type !== 'Shared spawn'))
      const seen: number[] = []
      let nearest = Infinity
      for (const [o, j] of others) {
        const d = Math.hypot(o.position[0] - mk.position[0], o.position[2] - mk.position[2])
        nearest = Math.min(nearest, d)
        if (mk.type === 'Shared spawn' && d > u(40)) continue
        if (g.clear(mk.position, o.position, eye)) seen.push(j)
      }
      const f: SpawnFact = { marker: i, type: mk.type, at: mk.position, seen, nearest: Number.isFinite(nearest) ? m(nearest) : 0 }
      const [x, y, z] = mk.position
      const inside = ss.find((s) => s.exact && covers(s, x, z, -0.2) && s.y0 < y + 0.5 && s.y1 > y + 0.5)
      if (inside) f.inside = inside.name
      else if (!(g.at(x, z) > y - u(3))) f.noFloor = true
      if ((mk.type === 'Red team spawn' && z > 0) || (mk.type === 'Blue team spawn' && z < 0)) f.wrongEnd = true
      return f
    })
    const exposed = list.filter((s) => s.type !== 'Shared spawn' ? s.seen.length > 0 : s.seen.length >= 3).map((s) => s.marker)

    // Nearest open floor to a point, not inside anything (for moving spawns).
    const openSpot = (x: number, z: number, avoid: (x: number, z: number) => boolean = () => false): [number, number] | null => {
      const [ci, ck] = g.cell(x, z)
      for (let r = 1; r < 40; r++) for (let dk = -r; dk <= r; dk++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dk)) !== r) continue
        const i = ci + di, k = ck + dk
        if (i < 1 || k < 1 || i >= g.nx - 1 || k >= g.nz - 1) continue
        const [cx, cz] = g.centre(i, k)
        // The cell and its neighbours are floor (room to stand).
        let ok = true
        for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1 && ok; b++) ok = walkable(g.top[(k + a) * g.nx + i + b])
        if (ok && !avoid(cx, cz)) return [Math.round(cx), Math.round(cz)]
      }
      return null
    }

    for (const s of list) {
      const mk = p.markers[s.marker]
      if (s.inside || s.noFloor) {
        const to = openSpot(mk.position[0], mk.position[2])
        issues.push({
          id: 'spawn-stuck-' + s.marker, topic: 'spawns', severity: 'bad',
          text: `${mk.type} #${s.marker} at (${r1(mk.position[0])}, ${r1(mk.position[2])}) is ${s.inside ? `inside "${s.inside}"` : 'over nothing to stand on'}.`,
          ...(to ? { fix: { label: 'Move it to open floor', actions: [{ do: 'move_marker', index: s.marker, x: to[0], z: to[1] }] } } : {}),
        })
      }
      if (s.wrongEnd) issues.push({
        id: 'spawn-end-' + s.marker, topic: 'spawns', severity: 'bad',
        text: `${mk.type} #${s.marker} is at the other team's end (red belongs at -Z, blue at +Z).`,
        fix: { label: 'Move it to its own end', actions: [{ do: 'move_marker', index: s.marker, x: r1(-mk.position[0]), z: r1(-mk.position[2]) }] },
      })
    }
    const exposedTeam = list.filter((s) => s.type !== 'Shared spawn' && s.seen.length)
    if (exposedTeam.length) {
      // A wall a third of the way from each exposed red spawn toward an enemy it sees; mirrored for blue.
      const fixes: AiAction[] = []
      for (const s of exposedTeam.filter((x) => x.type === 'Red team spawn').slice(0, 4)) {
        const o = p.markers[s.seen[0]].position
        const [x, , z] = s.at
        const dx = o[0] - x, dz = o[2] - z, len = Math.hypot(dx, dz) || 1
        const turn = Math.round((Math.atan2(dx, dz) * 180) / Math.PI + 90)
        const d = Math.min(u(6), len / 3)
        fixes.push({ do: 'add_shape', shape: 'wall', x: r1(x + (dx / len) * d), z: r1(z + (dz / len) * d), turn, size: [Math.round(u(5)), Math.round(u(2.5)), 1], mirror: true })
      }
      const close = exposedTeam.some((s) => s.seen.some((j) => Math.hypot(p.markers[j].position[0] - s.at[0], p.markers[j].position[2] - s.at[2]) < u(40)))
      issues.push({
        id: 'spawn-exposed', topic: 'spawns', severity: close ? 'bad' : 'warn',
        text: `${exposedTeam.length} team spawn${exposedTeam.length === 1 ? ' has' : 's have'} a clear line of sight to an enemy spawn${close ? ' less than 40 m away (spawn kills likely)' : ', though only at long range'}.`,
        ...(fixes.length ? { fix: { label: 'Add a wall in front of each (both ends)', actions: fixes } } : {}),
      })
    }
    const busyShared = list.filter((s) => s.type === 'Shared spawn' && s.seen.length >= 3)
    if (busyShared.length) issues.push({ id: 'shared-exposed', topic: 'spawns', severity: 'warn', text: `${busyShared.length} shared spawn${busyShared.length === 1 ? ' sees' : 's see'} 3 or more other spawns within 40 m.` })
    const red = markerCounts['Red team spawn'] ?? 0, blue = markerCounts['Blue team spawn'] ?? 0
    if (red !== blue) issues.push({
      id: 'team-count', topic: 'fairness', severity: 'bad', text: `Red has ${red} team spawns and blue has ${blue}.`,
      fix: { label: `Copy ${red >= blue ? "red's" : "blue's"} spawns and pickups to the other end`, actions: [{ do: 'make_symmetric', keep: red >= blue ? 'red' : 'blue', only: 'markers' }] },
    })
    if (!list.length) issues.push({ id: 'no-spawns', topic: 'spawns', severity: 'bad', text: 'There are no spawns yet.' })
    else if (!exposed.length && !issues.some((i) => i.topic === 'spawns')) issues.push({ id: 'spawns-ok', topic: 'spawns', severity: 'good', text: 'No spawn can see an enemy spawn, and none is stuck in an object.' })

    // Symmetry issues.
    if (unmatchedItems.length || unmatchedMarkers.length) {
      const redStuff = p.scene_items.filter((it) => it.position[2] < 0).length, blueStuff = p.scene_items.filter((it) => it.position[2] > 0).length
      const keep = redStuff >= blueStuff ? 'red' : 'blue'
      issues.push({
        id: 'symmetry', topic: 'fairness', severity: symScore < 0.85 ? 'bad' : 'warn',
        text: `${unmatchedItems.length} object${unmatchedItems.length === 1 ? '' : 's'} and ${unmatchedMarkers.length} marker${unmatchedMarkers.length === 1 ? '' : 's'} have no twin across the middle (symmetry ${Math.round(symScore * 100)}%).`,
        fix: { label: keep === 'red' ? "Make blue's half match red's" : "Make red's half match blue's", actions: [{ do: 'make_symmetric', keep }] },
      })
    } else if (p.scene_items.length) issues.push({ id: 'symmetry-ok', topic: 'fairness', severity: 'good', text: 'Every object and marker has a twin across the middle.' })

    // Sight lines: from open floor, look 8 ways at eye height.
    let longest = 0, from: Vec3 = [0, 0, 0], to: Vec3 = [0, 0, 0], longCount = 0
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]].map(([a, b]) => { const l = Math.hypot(a, b); return [a / l, b / l] })
    const stride = Math.max(2, Math.round(Math.sqrt((g.nx * g.nz) / 900)))
    for (let k = 1; k < g.nz - 1; k += stride) for (let i = 1; i < g.nx - 1; i += stride) {
      const h = g.top[k * g.nx + i]
      if (!walkable(h)) continue
      const [x, z] = g.centre(i, k)
      for (const [dx, dz] of dirs) for (const sgn of [1, -1]) {
        let d = 0
        for (; ; d += CELL / 2) {
          const hh = g.at(x + dx * sgn * (d + CELL / 2), z + dz * sgn * (d + CELL / 2))
          if (!Number.isFinite(hh) || hh > h + eye) break
        }
        if (d > u(70)) longCount++
        if (d > longest) { longest = d; from = [r1(x), r1(h), r1(z)]; to = [r1(x + dx * sgn * d), r1(h), r1(z + dz * sgn * d)] }
      }
    }
    if (longest > u(90)) {
      const mx = (from[0] + to[0]) / 2, mz = (from[2] + to[2]) / 2
      const turn = Math.round((Math.atan2(to[0] - from[0], to[2] - from[2]) * 180) / Math.PI + 90)
      issues.push({
        id: 'long-sight', topic: 'sightlines', severity: longest > u(130) ? 'bad' : 'warn',
        text: `The longest clear sight line is ${m(longest)} m, from (${from[0]}, ${from[2]}) to (${to[0]}, ${to[2]}). Snipers will own it.`,
        fix: { label: 'Break it up with a wall halfway (both halves)', actions: [{ do: 'add_shape', shape: 'wall', x: r1(mx), z: r1(mz), turn, size: [Math.round(u(6)), Math.round(u(3)), 1], mirror: true }] },
      })
    } else if (longest) issues.push({ id: 'sight-ok', topic: 'sightlines', severity: 'good', text: `The longest clear sight line is ${m(longest)} m.` })

    // Cover: open floor with something chest-high within 3 m.
    const zone = { red: [0, 0], middle: [0, 0], blue: [0, 0] } as Record<'red' | 'middle' | 'blue', [number, number]>
    const reach = Math.ceil(u(3) / CELL)
    const bare: Record<'red' | 'middle' | 'blue', [number, number][]> = { red: [], middle: [], blue: [] }
    for (let k = 1; k < g.nz - 1; k++) for (let i = 1; i < g.nx - 1; i++) {
      const h = g.top[k * g.nx + i]
      if (!walkable(h)) continue
      const [x, z] = g.centre(i, k)
      const zn = sideOf(z, depth)
      let near = false
      for (let a = -reach; a <= reach && !near; a++) for (let b = -reach; b <= reach && !near; b++) {
        const hh = g.top[Math.min(g.nz - 1, Math.max(0, k + a)) * g.nx + Math.min(g.nx - 1, Math.max(0, i + b))]
        near = Number.isFinite(hh) && hh >= h + chest
      }
      zone[zn][1]++
      if (near) zone[zn][0]++
      else if ((i + k) % 7 === 0) bare[zn].push([x, z])
    }
    const share = (z: [number, number]) => (z[1] ? Math.round((z[0] / z[1]) * 100) / 100 : 0)
    const cover = { red: share(zone.red), middle: share(zone.middle), blue: share(zone.blue) }
    for (const zn of ['middle', 'red'] as const) {
      if (!zone[zn][1] || cover[zn] >= 0.35) continue
      // Crates at bare spots on red's side (mirrored), spread apart.
      const picks: [number, number][] = []
      for (const q of bare[zn].filter(([, z]) => zn === 'red' || z <= 0)) if (picks.every((o) => Math.hypot(o[0] - q[0], o[1] - q[1]) > u(12)) && picks.length < 4) picks.push(q)
      issues.push({
        id: 'cover-' + zn, topic: 'cover', severity: cover[zn] < 0.2 ? 'bad' : 'warn',
        text: `Only ${Math.round(cover[zn] * 100)}% of the open floor ${zn === 'middle' ? 'in the middle' : "on each team's side"} has cover within 3 m.`,
        ...(picks.length ? { fix: { label: 'Add chest-high boxes in the open (both halves)', actions: picks.map(([x, z]): AiAction => ({ do: 'add_shape', shape: 'box', x: r1(x), z: r1(z), size: [Math.round(u(2)), Math.round(u(1.2)), Math.round(u(2))], mirror: true })) } } : {}),
      })
    }
    if (Math.abs(cover.red - cover.blue) > 0.1) issues.push({ id: 'cover-unfair', topic: 'fairness', severity: 'warn', text: `Red's side has cover on ${Math.round(cover.red * 100)}% of its floor, blue's on ${Math.round(cover.blue * 100)}%.` })
    if (!issues.some((x) => x.topic === 'cover') && zone.middle[1]) issues.push({ id: 'cover-ok', topic: 'cover', severity: 'good', text: `Cover near ${Math.round(cover.middle * 100)}% of the middle and ${Math.round(cover.red * 100)}% of each side.` })

    // Flow: ways across the middle at ground level, and a ground route between the team ends.
    const crossings: number[] = []
    {
      const [, k] = g.cell(0, 0)
      let run = 0
      for (let i = 0; i <= g.nx; i++) {
        const ok = i < g.nx && k >= 0 && k < g.nz && walkable(g.top[k * g.nx + i])
        if (ok) run++
        else { if (run * CELL >= u(2)) crossings.push(m(run * CELL)); run = 0 }
      }
    }
    const centroid = (type: string) => {
      const ps = p.markers.filter((mk) => mk.type === type).map((mk) => mk.position)
      return ps.length ? [ps.reduce((a, q) => a + q[0], 0) / ps.length, ps.reduce((a, q) => a + q[2], 0) / ps.length] as [number, number] : null
    }
    const a = centroid('Red team spawn') ?? [0, ex.minZ + depth * 0.2] as [number, number], b = centroid('Blue team spawn') ?? [0, ex.maxZ - depth * 0.2] as [number, number]
    let groundRoute: boolean | null = null, routeM: number | null = null
    const sa = openSpot(a[0], a[1]), sb = openSpot(b[0], b[1])
    if (sa && sb) {
      const [i0, k0] = g.cell(sa[0], sa[1]), [i1, k1] = g.cell(sb[0], sb[1])
      const dist = new Int32Array(g.nx * g.nz).fill(-1)
      const q = [k0 * g.nx + i0]
      dist[q[0]] = 0
      for (let h = 0; h < q.length; h++) {
        const n = q[h], i = n % g.nx, k = (n - i) / g.nx
        for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, kk = k + dk
          if (ii < 0 || kk < 0 || ii >= g.nx || kk >= g.nz) continue
          const nn = kk * g.nx + ii
          if (dist[nn] >= 0 || !walkable(g.top[nn])) continue
          dist[nn] = dist[n] + 1
          q.push(nn)
        }
      }
      const d = dist[k1 * g.nx + i1]
      groundRoute = d >= 0
      routeM = d >= 0 ? m(d * CELL) : null
    }
    const straightM = m(Math.hypot(b[0] - a[0], b[1] - a[1]))
    if (groundRoute === false) issues.push({ id: 'no-route', topic: 'flow', severity: 'warn', text: "At ground level there's no way from red's end to blue's (players must use ramps or jumps, or the ends are cut off)." })
    if (crossings.length === 1 && crossings[0] >= m(ex.maxX - ex.minX) * 0.5) issues.push({ id: 'open-middle', topic: 'flow', severity: 'info', text: `The middle is one wide-open crossing (${crossings[0]} m): fine for brawls, but there is little to flank around.` })
    else if (crossings.length === 1) issues.push({ id: 'one-lane', topic: 'flow', severity: 'warn', text: `Only one way across the middle at ground level (${crossings[0]} m wide): every fight funnels there.` })
    else if (crossings.length >= 2) issues.push({ id: 'lanes', topic: 'flow', severity: 'good', text: `${crossings.length} ways across the middle at ground level (${crossings.join(', ')} m wide).` })
    if (routeM && straightM && routeM > straightM * 1.8) issues.push({ id: 'long-route', topic: 'flow', severity: 'info', text: `The walk between the team ends is ${routeM} m, against ${straightM} m as the crow flies.` })

    // Weapons.
    const weapons = p.markers.filter((mk) => mk.type === 'Weapon pickup')
    const byId: Record<string, number> = {}
    const sideCount = { red: 0, middle: 0, blue: 0 }
    const power: MapFacts['weapons']['power'] = []
    for (const w of weapons) {
      byId[w.weapon || '?'] = (byId[w.weapon || '?'] ?? 0) + 1
      const sd = sideOf(w.position[2], depth)
      sideCount[sd]++
      if (POWER.has(w.weapon)) power.push({ id: w.weapon, at: w.position, side: sd })
    }
    const nearestFrom = (type: string) => {
      const ss2 = p.markers.filter((mk) => mk.type === type)
      if (!ss2.length || !weapons.length) return null
      return m(ss2.reduce((acc, s) => acc + Math.min(...weapons.map((w) => Math.hypot(w.position[0] - s.position[0], w.position[2] - s.position[2]))), 0) / ss2.length)
    }
    const redNearestM = nearestFrom('Red team spawn'), blueNearestM = nearestFrom('Blue team spawn')
    const unmatchedWeapons = unmatchedMarkers.filter((i) => p.markers[i].type === 'Weapon pickup')
    if (!weapons.length) issues.push({ id: 'no-weapons', topic: 'weapons', severity: 'warn', text: 'There are no weapon pickups.' })
    else if (unmatchedWeapons.length || sideCount.red !== sideCount.blue) issues.push({
      id: 'weapon-balance', topic: 'weapons', severity: 'bad',
      text: `Weapons are uneven: ${sideCount.red} on red's side, ${sideCount.blue} on blue's${unmatchedWeapons.length ? `; ${unmatchedWeapons.length} have no twin` : ''}.`,
      ...(unmatchedWeapons.length ? { fix: { label: 'Give each one a twin across the middle', actions: [{ do: 'mirror', markers: unmatchedWeapons }] } } : {}),
    })
    const powerRed = power.filter((x) => x.side === 'red').length, powerBlue = power.filter((x) => x.side === 'blue').length
    if (powerRed !== powerBlue) issues.push({ id: 'power-weapons', topic: 'weapons', severity: 'bad', text: `Power weapons (sniper, RPG) are lopsided: ${powerRed} on red's side, ${powerBlue} on blue's.` })
    if (redNearestM !== null && blueNearestM !== null && Math.abs(redNearestM - blueNearestM) > 5) issues.push({ id: 'weapon-reach', topic: 'fairness', severity: 'warn', text: `From their spawns, red's nearest weapon is ${redNearestM} m away on average and blue's ${blueNearestM} m.` })
    if (weapons.length && !issues.some((x) => x.topic === 'weapons')) issues.push({ id: 'weapons-ok', topic: 'weapons', severity: 'good', text: `${weapons.length} weapons, evenly split, ${power.length} of them power weapons.` })

    return {
      source: 'grid', scale,
      extent: { ...ex, widthM: m(ex.maxX - ex.minX), depthM: m(depth) },
      counts: { objects: p.scene_items.length, lights: p.lights.length, markers: markerCounts },
      symmetry: { objects: { total: p.scene_items.length, matched: p.scene_items.length - unmatchedItems.length, unmatched: unmatchedItems }, markers: { total: twinnable, matched: twinnable - unmatchedMarkers.length, unmatched: unmatchedMarkers }, score: Math.round(symScore * 100) / 100 },
      spawns: { list, exposed, inside: list.filter((s) => s.inside).map((s) => s.marker), noFloor: list.filter((s) => s.noFloor).map((s) => s.marker), wrongEnd: list.filter((s) => s.wrongEnd).map((s) => s.marker) },
      sightLines: { longestM: m(longest), from, to, longCount },
      cover,
      flow: { crossings, groundRoute, routeM, straightM },
      weapons: { total: weapons.length, ...sideCount, byId, power, redNearestM, blueNearestM },
      issues,
    }
  },
}

let source: FactSource = gridFacts
/** Swap in another analysis (such as a fuller map-health check) for the critique. */
export const setFactSource = (s: FactSource) => { source = s }
export const gatherFacts = (input: FactInput): MapFacts => source.gather(input)

/** The facts as short lines for the model. */
export function factsText(f: MapFacts): string {
  const mk = Object.entries(f.counts.markers).map(([t, n]) => `${t} ${n}`).join(', ') || 'none'
  const lines = [
    `Measured in code (${f.source} analysis; 1 editor unit = ${f.scale} m):`,
    `Size ${f.extent.widthM} × ${f.extent.depthM} m. ${f.counts.objects} objects, ${f.counts.lights} lights. Markers: ${mk}.`,
    `Symmetry ${Math.round(f.symmetry.score * 100)}%: ${f.symmetry.objects.matched}/${f.symmetry.objects.total} objects and ${f.symmetry.markers.matched}/${f.symmetry.markers.total} markers have a twin.`,
    `Spawns: ${f.spawns.exposed.length} exposed, ${f.spawns.inside.length} inside objects, ${f.spawns.noFloor.length} over nothing, ${f.spawns.wrongEnd.length} at the wrong end.`,
    `Longest clear sight line ${f.sightLines.longestM} m; ${f.sightLines.longCount} sampled lines over 70 m.`,
    `Cover within 3 m of open floor: red side ${Math.round(f.cover.red * 100)}%, middle ${Math.round(f.cover.middle * 100)}%, blue side ${Math.round(f.cover.blue * 100)}%.`,
    `Ways across the middle at ground level: ${f.flow.crossings.length ? f.flow.crossings.map((w) => w + ' m').join(', ') : 'none'}. Ground route between team ends: ${f.flow.groundRoute === null ? 'unknown' : f.flow.groundRoute ? `yes, ${f.flow.routeM} m (straight ${f.flow.straightM} m)` : 'no'}.`,
    `Weapons ${f.weapons.total}: red side ${f.weapons.red}, middle ${f.weapons.middle}, blue side ${f.weapons.blue}; power weapons ${f.weapons.power.map((p) => `${p.id} (${p.side})`).join(', ') || 'none'}. Mean distance from team spawns to nearest weapon: red ${f.weapons.redNearestM ?? '-'} m, blue ${f.weapons.blueNearestM ?? '-'} m.`,
    `Findings (id: topic, severity, text; "fix" means a ready-made fix exists):`,
    ...f.issues.map((i) => `${i.id}: ${i.topic}, ${i.severity}, ${i.text}${i.fix ? ` [fix: ${i.fix.label}]` : ''}`),
  ]
  return lines.join('\n')
}
