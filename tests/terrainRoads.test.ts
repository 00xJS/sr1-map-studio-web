import { describe, expect, it } from 'vitest'
import { heightAt, sculpt, shapeTerrain, steepest, terrainModel, terrainShape, TERRAIN_MAX_CELLS, hills } from '../src/lib/terrain'
import { compoundObj, shapeObj } from '../src/lib/shapes'
import { wizardLayout, wizardSample } from '../src/lib/mapWizard'
import { blocker, support } from '../src/lib/sampleScale'
import { parseObj } from '../src/lib/geometry'
import { buildRoad, formatPath, parsePath, roadGraph, roadPrefabParts, ROAD_DEFAULTS, WALK_H } from '../src/lib/roads'
import { ALL_PREFABS } from '../src/lib/prefabRegistry'

/** Every edge of a closed mesh is used exactly twice, once each way. */
function closedEdges(positions: Float32Array, faces: Uint32Array) {
  const key = (i: number) => `${positions[i * 3].toFixed(3)},${positions[i * 3 + 1].toFixed(3)},${positions[i * 3 + 2].toFixed(3)}`
  const count = new Map<string, number>()
  for (let f = 0; f < faces.length; f += 3) for (let k = 0; k < 3; k++) {
    const a = key(faces[f + k]), b = key(faces[f + (k + 1) % 3])
    count.set(a + '>' + b, (count.get(a + '>' + b) ?? 0) + 1)
  }
  const bad: string[] = []
  for (const [e, n] of count) {
    const [a, b] = e.split('>')
    if (n !== 1 || count.get(b + '>' + a) !== 1) bad.push(e)
  }
  return bad
}

/** Signed volume of a closed mesh (positive when every face points out). */
function volume(positions: Float32Array, faces: Uint32Array) {
  let v = 0
  for (let f = 0; f < faces.length; f += 3) {
    const [a, b, c] = [faces[f], faces[f + 1], faces[f + 2]].map((i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]])
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
  }
  return v
}

describe('terrain', () => {
  const hilly = shapeTerrain(terrainShape(120, 80, { base: 1 }), (x, z) => 14 * hills(7, 30)(x, z) + (Math.abs(x) > 40 ? 8 : 0))

  it('is a closed solid with every face pointing out', () => {
    for (const s of [terrainShape(40, 40), hilly]) {
      const m = terrainModel(s)
      expect(closedEdges(m.positions, m.faces)).toEqual([])
      expect(volume(m.positions, m.faces)).toBeGreaterThan(0)
      // The OBJ the editor stores says the same.
      const o = parseObj(shapeObj(s))
      expect(o.faces.length).toBe(m.faces.length)
      expect(closedEdges(o.positions, o.faces)).toEqual([])
    }
  })

  it('keeps every slope walkable (45° or less) and stays inside the triangle budget', () => {
    expect(steepest(hilly)).toBeLessThanOrEqual(45)
    // A cliff asked for is pulled back to a walkable slope.
    const cliff = shapeTerrain(terrainShape(60, 60), (x) => (x > 0 ? 20 : 0))
    expect(steepest(cliff)).toBeLessThanOrEqual(45)
    const big = terrainShape(2000, 2000, { cell: 1 })
    expect(big.cells).toEqual([TERRAIN_MAX_CELLS, TERRAIN_MAX_CELLS])
    // 64 × 64 cells: 8,192 surface triangles plus the edges and bottom; one material batch stays far below 65,535 indices.
    expect(terrainModel(big).faces.length / 3).toBeLessThan(9500)
  })

  it('textures flats with grass, slopes with dirt and steep or high ground with rock', () => {
    const m = terrainModel(hilly)
    const used = new Set([...m.faceMat].map((i) => m.mats[i]))
    expect([...used].sort()).toEqual(['rock', 'side', 'top'])
    const flat = terrainModel(terrainShape(40, 40))
    // A flat field: grass on top, nothing but the slab's edges and bottom in "side".
    const tops = [...flat.faceMat].filter((i) => flat.mats[i] === 'top').length
    expect(tops).toBe(10 * 10 * 2)
  })

  it('sculpts: raise, lower, smooth and flatten, never below the slab', () => {
    let s = terrainShape(40, 40, { base: 2 })
    const step = (brush: 'raise' | 'lower' | 'smooth' | 'flatten', level?: number) => { s = { ...s, heights: sculpt(s, { brush, x: 0, z: 0, radius: 10, strength: 4, dt: 0.5, level }) } }
    for (let i = 0; i < 6; i++) step('raise')
    const top = heightAt(s, 0, 0)!
    expect(top).toBeGreaterThan(5)
    expect(steepest(s)).toBeLessThanOrEqual(45)
    step('smooth')
    expect(heightAt(s, 0, 0)!).toBeLessThan(top)
    for (let i = 0; i < 20; i++) step('flatten', 1)
    expect(Math.abs(heightAt(s, 0, 0)! - 1)).toBeLessThan(0.2)
    for (let i = 0; i < 40; i++) step('lower')
    expect(Math.min(...s.heights!)).toBeGreaterThanOrEqual(-2 + 0.1 - 1e-9)
  })

  it('reads its height on the actual triangles', () => {
    const s = shapeTerrain(terrainShape(40, 40), (x, z) => 0.1 * x + 0.05 * z, false)
    expect(heightAt(s, 7, -3)).toBeCloseTo(0.7 - 0.15, 5)
    expect(heightAt(s, 30, 0)).toBeNull()
  })
})

describe('roads', () => {
  const o = ROAD_DEFAULTS
  const labels = (parts: { label: string }[]) => parts.reduce<Record<string, number>>((m, p) => ({ ...m, [p.label]: (m[p.label] ?? 0) + 1 }), {})

  it('a straight road: asphalt, kerbs, sidewalks, markings and lamps, no junction', () => {
    const r = buildRoad([[[-50, 0], [50, 0]]], o)
    const n = labels(r.parts)
    expect(n.Road).toBe(1)
    expect(n.Kerb).toBe(2)
    expect(n.Sidewalk).toBe(2)
    expect(n['Edge line']).toBe(2)
    expect(n['Lane dash']).toBeGreaterThan(10)
    expect(n.Junction).toBeUndefined()
    expect(n.Crosswalk).toBeUndefined()
    expect(r.lights.length).toBeGreaterThanOrEqual(3)
    expect(n['Lamp post']).toBe(r.lights.length)
    // Sidewalks sit a kerb above the road, which sits just above the ground.
    const walk = r.parts.find((p) => p.label === 'Sidewalk')!
    expect(walk.at[1] + walk.size[1]).toBeCloseTo(1 + WALK_H)
  })

  it('a crossroads: one junction plate, four corners, crossings on every arm, sidewalks cut back', () => {
    const r = buildRoad([[[-60, 0], [60, 0]], [[0, -60], [0, 60]]], o)
    const n = labels(r.parts)
    expect(r.junctions).toEqual([[0, 0]])
    expect(n.Junction).toBe(1)
    expect(n.Road).toBe(4)
    // 4 arms × 2 sides of sidewalk, plus 4 corner fills.
    expect(n.Sidewalk).toBe(12)
    expect(n.Crosswalk).toBeGreaterThanOrEqual(4 * 4)
    // Nothing raised (sidewalk, kerb, lamp) stands in the junction square.
    const hw = o.width / 2
    for (const p of r.parts.filter((q) => q.at[1] + q.size[1] > 1 + 0.1)) {
      expect(Math.abs(p.at[0]) < hw && Math.abs(p.at[2]) < hw, `${p.label} at ${p.at}`).toBe(false)
    }
  })

  it('a T: the side road ends on the main road and joins it', () => {
    const g = roadGraph([[[-50, 0], [50, 0]], [[10, 2], [10, 60]]], 6)
    const junctions = g.links.filter((l) => l.length === 3)
    expect(junctions.length).toBe(1)
    expect(g.nodes[g.links.findIndex((l) => l.length === 3)]).toEqual([10, 0])
    const r = buildRoad([[[-50, 0], [50, 0]], [[10, 2], [10, 60]]], o)
    expect(labels(r.parts).Junction).toBe(1)
  })

  it('bends are mitred: the pieces either side of a bend share their corners', () => {
    const r = buildRoad([[[-40, 0], [0, 0], [30, 30]]], { ...o, lamps: 0, lines: 'none' })
    const roads = r.parts.filter((p) => p.label === 'Road')
    expect(roads.length).toBe(2)
    const world = (p: (typeof roads)[0]) => p.outline!.map(([x, z]) => `${(x + p.at[0]).toFixed(2)},${(z + p.at[2]).toFixed(2)}`)
    const shared = world(roads[0]).filter((c) => world(roads[1]).includes(c))
    expect(shared.length).toBe(2)
  })

  it('is a prefab the editor can rebuild from its stored points', () => {
    const def = ALL_PREFABS.road
    expect(def).toBeTruthy()
    const path = formatPath([[[-30, 0], [30, 0]], [[0, -30], [0, 30]]])
    expect(parsePath(path)).toEqual([[[-30, 0], [30, 0]], [[0, -30], [0, 30]]])
    const parts = roadPrefabParts(100, 50, 90, 1, { path })
    // Turned 90°: the junction lands at the placement point.
    const j = parts.find((p) => p.label === 'Junction')!
    expect(j.at[0]).toBeCloseTo(100)
    expect(j.at[2]).toBeCloseTo(50)
    expect(j.at[1]).toBeCloseTo(1)
  })
})

describe('neighbourhood layout', () => {
  const base = { setting: 'downtown', layout: 'neighbourhood', players: 12, density: 'normal', seed: 31 } as const

  it('lays real streets as one editable road, point-symmetric, with junctions and crossings', () => {
    const s = wizardLayout(base)
    const streets = s.parts.filter((p) => p.prefab?.key === 'road')
    expect(streets.length).toBeGreaterThan(50)
    const lines = parsePath(streets[0].prefab!.params.path)
    const key = (l: [number, number][]) => l.map(([x, z]) => `${x},${z}`).sort().join(' ')
    const flipped = new Set(lines.map((l) => key(l.map(([x, z]) => [-x || 0, -z || 0] as [number, number]))))
    for (const l of lines) expect(flipped.has(key(l)), key(l)).toBe(true)
    const labels = new Set(streets.map((p) => p.label))
    for (const l of ['Road', 'Junction', 'Sidewalk', 'Kerb', 'Crosswalk', 'Lamp post']) expect(labels.has(l), l).toBe(true)
    // Every other part has its twin turned 180° about the middle.
    const rest = s.parts.filter((p) => p.prefab?.key !== 'road' && p.label !== 'Ground' && p.label !== 'Wall')
    const at = new Set(rest.map((p) => `${p.label}@${p.at.map((v) => v.toFixed(2)).join(',')}`))
    for (const p of rest) expect(at.has(`${p.label}@${[-p.at[0], p.at[1], -p.at[2]].map((v) => (v || 0).toFixed(2)).join(',')}`), `${p.label} ${p.at}`).toBe(true)
  })

  it('has buildings, a park with a raised plaza and walkable hills; markers stay off the slopes', () => {
    const s = wizardSample(base)
    const labels = new Set(s.parts.map((p) => p.label))
    for (const l of ['Building', 'Lot', 'Plaza', 'Hills', 'Park']) expect(labels.has(l), l).toBe(true)
    for (const p of s.parts.filter((q) => q.kind === 'terrain')) {
      expect(steepest({ kind: 'terrain', size: p.size, tile: 8, cells: p.cells, heights: p.heights })).toBeLessThanOrEqual(45)
    }
    for (const [type, p] of s.markers) expect(blocker(s.parts, p), `${type} ${p}`).toBeUndefined()
  })

  it('works without terrain too', () => {
    for (const seed of [2, 3, 4]) for (const players of [4, 8, 12]) {
      const s = wizardSample({ ...base, seed, players, terrain: false })
      expect(s.parts.some((p) => p.kind === 'terrain')).toBe(false)
      expect(s.parts.some((p) => p.label === 'Lawn')).toBe(true)
      for (const [type, p] of s.markers) {
        expect(support(s.parts, p), `${type} ${p}`).toBeGreaterThanOrEqual(0)
        expect(blocker(s.parts, p), `${type} ${p}`).toBeUndefined()
      }
    }
  })

  it('keeps the streets and terrain inside the game’s mesh limits', () => {
    const s = wizardLayout(base)
    const streets = s.parts.filter((p) => p.prefab?.key === 'road')
    const obj = parseObj(compoundObj(streets.map((p) => ({ shape: { kind: p.kind, size: p.size, tile: p.tile ?? 4, segments: p.segments, taper: p.taper, bevel: p.bevel, outline: p.outline }, at: p.at, rot: p.rot ?? 0, top: JSON.stringify(p.top), side: JSON.stringify(p.side) }))))
    const perMat = new Map<number, number>()
    for (const m of obj.faceMat) perMat.set(m, (perMat.get(m) ?? 0) + 1)
    // A render batch indexes with 16 bits: under 21,845 triangles per material.
    for (const n of perMat.values()) expect(n).toBeLessThan(21845)
    expect(obj.faces.length / 3).toBeLessThan(40000)
  })
})
