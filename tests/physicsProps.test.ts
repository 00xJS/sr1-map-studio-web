import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OBJECT_BUDGET, PHYSICS_PRESETS, PHYSICS_SHAPES, PRESET_BY_KEY, countPhysics, cylinderAxis, cylinderPoints, mergePieces, pieces, presetOf, type P3 } from '../src/lib/physicsProps'
import { PHYSICS_PREFABS, ballObj, oneMaterial, type PhysicsPart } from '../src/lib/prefabsPhysics'
import { parseObj } from '../src/lib/geometry'
import { shapeObj } from '../src/lib/shapes'
import { newProject, type SceneItem } from '../src/lib/project'

const py = (name: string) => readFileSync(join(__dirname, '..', 'py', name), 'utf8')

/** Signed volume of a parsed OBJ: positive when its faces point outward. */
const volume = (text: string) => {
  const m = parseObj(text)
  let v = 0
  for (let f = 0; f < m.faces.length; f += 3) {
    const [a, b, c] = [m.faces[f], m.faces[f + 1], m.faces[f + 2]].map((i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]])
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
  }
  return v
}

describe('physics presets', () => {
  it('only name stock profiles the exporter accepts', () => {
    const features = py('map_features.py')
    for (const p of PHYSICS_PRESETS) {
      if (p.behavior === 'explosive') expect(p.profile).toBe('Propanesmall')
      else expect(features, p.profile).toContain(JSON.stringify(p.profile).slice(1, -1))
    }
  })

  it('use shapes and a budget the exporter knows', () => {
    const shapes = py('physics_props.py')
    expect(shapes).toContain(`SHAPES = (${PHYSICS_SHAPES.map((s) => `'${s.key}'`).join(', ')})`)
    expect(shapes).toContain(`OBJECT_BUDGET = ${OBJECT_BUDGET}`)
    for (const p of PHYSICS_PRESETS) expect(PHYSICS_SHAPES.map((s) => s.key)).toContain(p.shape)
  })

  it('finds the preset of an item from its choice or its profile', () => {
    const base = { uid: 'a', name: 'x', path: 'x.obj', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: {}, alpha: {} } as SceneItem
    expect(presetOf(base)).toBeNull()
    const prop = { ...base, native_prefab: 'sr1_native_custom_mesh_glass_experiment', native_prop_behavior: 'movable' } as SceneItem
    expect(presetOf(prop)?.key).toBe('light_crate')
    expect(presetOf({ ...prop, native_profile: 'Tire' })?.key).toBe('rolls')
    expect(presetOf({ ...prop, native_prop_behavior: 'explosive' })?.key).toBe('explodes')
    expect(presetOf({ ...prop, physics_preset: 'ball' })?.key).toBe('ball')
    // Breakable wood breaks like a can unless told otherwise.
    expect(presetOf({ ...base, native_prefab: 'sr1_native_custom_mesh_glass_experiment', native_breakable_kind: 'wood' })?.key).toBe('breaks')
  })

  it('counts physics objects against the budget', () => {
    const p = newProject('t')
    const prop = (i: number) => ({ uid: 'u' + i, name: 'c', path: 'c.obj', native_mesh_obj: 'c.obj', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: {}, alpha: {}, native_prefab: 'sr1_native_custom_mesh_glass_experiment', native_prop_behavior: 'movable', glass_custom_texture: 't.png' }) as SceneItem
    p.scene_items = [{ ...prop(0), native_prefab: undefined, native_prop_behavior: undefined }, ...Array.from({ length: 20 }, (_, i) => prop(i + 1))]
    expect(countPhysics(p)).toMatchObject({ objects: 20, props: 20, models: 1, warnings: [] })
    p.scene_items.push(...Array.from({ length: OBJECT_BUDGET }, (_, i) => prop(100 + i)))
    expect(countPhysics(p).warnings[0]).toContain(`at most ${OBJECT_BUDGET}`)
  })
})

describe('physics shapes', () => {
  it('fit cylinders across the roundest side, like the exporter', () => {
    expect(cylinderAxis([-1, -0.4, -1], [1, 0.4, 1])).toBe(1)
    expect(cylinderAxis([-0.3, -1, -1], [0.3, 1, 1])).toBe(0)
    const pts = cylinderPoints([-1, 0, -1], [1, 3, 1])
    expect(pts).toHaveLength(32)
    for (const p of pts) expect(Math.hypot(p[0], p[2])).toBeCloseTo(1, 6)
  })

  it('split a mesh into its separate pieces and merge down to 15', () => {
    const box = (o: number): P3[] => [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => [x + o, y, z] as P3)))
    const verts = [...box(0), ...box(3)]
    const tris = [0, 1, 2, 1, 3, 2, 0, 4, 1, 4, 5, 1, 8, 9, 10, 9, 11, 10, 8, 12, 9, 12, 13, 9]
    expect(pieces(verts, tris)).toHaveLength(2)
    expect(mergePieces(Array.from({ length: 20 }, (_, i) => [[i, 0, 0], [i + 0.5, 1, 1]] as P3[]))).toHaveLength(15)
  })
})

describe('physics showcase sets', () => {
  it('make one-material, outward-facing props that use known presets', () => {
    for (const [key, def] of Object.entries(PHYSICS_PREFABS)) {
      const parts = def.make(0, 0, 90, 1) as PhysicsPart[]
      const props = parts.filter((p) => p.physics)
      expect(props.length, key).toBeGreaterThanOrEqual(7)
      expect(props.length, key).toBeLessThanOrEqual(16)
      for (const p of props) {
        expect(PRESET_BY_KEY[p.physics!.preset], `${key}: ${p.physics!.preset}`).toBeTruthy()
        expect(p.group, `${key}: props are objects of their own`).toBeUndefined()
        const obj = p.physics!.ball ? ballObj(p.size[0]) : oneMaterial(shapeObj({ kind: p.kind, size: p.size, tile: p.tile ?? 4, segments: p.segments, lie: p.lie }))
        expect(parseObj(obj).mats).toEqual(['m0'])
        expect(volume(obj), `${key}: ${p.label}`).toBeGreaterThan(0)
      }
    }
  })

  it('stack crates without overlap', () => {
    const crates = (PHYSICS_PREFABS.crate_tower.make(0, 0, 0, 0) as PhysicsPart[])
    expect(crates).toHaveLength(10)
    for (const a of crates) {
      for (const b of crates) {
        if (a === b) continue
        const apart = [0, 1, 2].some((k) => k === 1
          ? a.at[1] >= b.at[1] + b.size[1] || b.at[1] >= a.at[1] + a.size[1]
          : Math.abs(a.at[k] - b.at[k]) >= (a.size[k] + b.size[k]) / 2)
        expect(apart).toBe(true)
      }
    }
  })

  it('builds a closed ball of the right size', () => {
    const m = parseObj(ballObj(2))
    let top = 0
    for (let i = 1; i < m.positions.length; i += 3) top = Math.max(top, m.positions[i])
    expect(top).toBeCloseTo(2, 5)
    expect(volume(ballObj(2))).toBeGreaterThan(0.9 * (4 / 3) * Math.PI)
  })
})
