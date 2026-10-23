import { describe, expect, it } from 'vitest'
import { gatherFacts, factsText, setFactSource, gridFacts, type BoundsFn, type FactSource } from '../src/lib/mapFacts'
import { expandPlacement, findTwin, resolveTarget, symmetricPlan } from '../src/lib/aiEdits'
import { wizardSample } from '../src/lib/mapWizard'
import { newMarker, newProject, uid, type Project, type SceneItem, type Vec3 } from '../src/lib/project'
import type { Part, Sample } from '../src/lib/sampleKit'

/** A project from a sample without building files: single parts as shapes, prefab groups as one object with a bounding box (as the 3D view gives). */
function projectOf(s: Sample): { project: Project; bounds: BoundsFn } {
  const p = newProject(s.name)
  const boxes: [Vec3, Vec3][] = []
  const units = new Map<string, Part[]>()
  for (const part of s.parts) {
    const k = part.group ?? uid()
    units.set(k, [...(units.get(k) ?? []), part])
  }
  for (const unit of units.values()) {
    const part = unit[0]
    if (unit.length === 1 && !part.group) {
      p.scene_items.push({ uid: uid(), name: part.label, path: '', position: part.at, rotation: [0, part.rot ?? 0, 0], scale: 1, textures: {}, alpha: {}, shape: { kind: part.kind, size: part.size, tile: 4 } })
      boxes.push([part.at, part.at])
      continue
    }
    const tag = part.prefab
    p.scene_items.push({ uid: uid(), name: part.group!.split('@')[0], path: 'prefab.obj', position: tag?.at ?? part.at, rotation: [0, tag?.rot ?? 0, 0], scale: 1, textures: {}, alpha: {}, ...(tag ? { prefab: { key: tag.key, params: tag.params, defaults: {} } } : {}) })
    // Corners of each part, turned by its heading.
    const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity]
    for (const q of unit) {
      const a = ((q.rot ?? 0) * Math.PI) / 180, c = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a))
      const rx = (q.size[0] * c + q.size[2] * sn) / 2, rz = (q.size[0] * sn + q.size[2] * c) / 2
      lo[0] = Math.min(lo[0], q.at[0] - rx); hi[0] = Math.max(hi[0], q.at[0] + rx)
      lo[2] = Math.min(lo[2], q.at[2] - rz); hi[2] = Math.max(hi[2], q.at[2] + rz)
      lo[1] = Math.min(lo[1], q.at[1]); hi[1] = Math.max(hi[1], q.at[1] + q.size[1])
    }
    boxes.push([lo, hi])
  }
  p.markers = s.markers.map(([type, at, patch]) => ({ ...newMarker(type, [at[0], at[1] + 0.1, at[2]]), ...patch }))
  return { project: p, bounds: (i) => (p.scene_items[i]?.shape ? null : boxes[i] ?? null) }
}

const shape = (name: string, at: Vec3, size: Vec3, rot = 0): SceneItem => ({
  uid: uid(), name, path: '', position: at, rotation: [0, rot, 0], scale: 1, textures: {}, alpha: {}, shape: { kind: 'box', size, tile: 4 },
})

function arena(): Project {
  const p = newProject('Arena')
  p.scene_items = [shape('Ground', [0, 0, 0], [80, 1, 120])]
  p.markers = [newMarker('Red team spawn', [0, 1.1, -50]), newMarker('Blue team spawn', [0, 1.1, 50])]
  return p
}

describe('map facts', () => {
  it('a wizard map is symmetric, with safe spawns and even weapons', () => {
    for (const layout of ['blocks', 'lanes', 'arena'] as const) {
      const p = projectOf(wizardSample({ setting: 'downtown', layout, players: 8, density: 'normal', seed: 11 }))
      const f = gatherFacts(p)
      const u = f.symmetry.objects.unmatched.map((i) => `${p.project.scene_items[i].name} ${p.project.scene_items[i].position.map(Math.round)} ${p.project.scene_items[i].rotation[1]}`)
      expect(u, layout).toEqual([])
      expect(f.spawns.inside, layout).toEqual([])
      expect(f.spawns.wrongEnd, layout).toEqual([])
      expect(f.weapons.red, layout).toBe(f.weapons.blue)
      expect(f.issues.find((i) => i.id === 'team-count'), layout).toBeUndefined()
    }
  })

  it('an open field: spawns see each other, one long sight line, no cover, and fixes for each', () => {
    const f = gatherFacts({ project: arena() })
    expect(f.spawns.exposed.sort()).toEqual([0, 1])
    const exposed = f.issues.find((i) => i.id === 'spawn-exposed')!
    expect(exposed.fix!.actions[0]).toMatchObject({ do: 'add_shape', shape: 'wall', mirror: true })
    expect(f.sightLines.longestM).toBeGreaterThan(50)
    expect(f.cover.middle).toBe(0)
    expect(f.issues.find((i) => i.id === 'cover-middle')?.fix?.actions.length).toBeGreaterThan(0)
    expect(f.flow.groundRoute).toBe(true)
    expect(f.flow.crossings).toHaveLength(1)
    expect(f.issues.find((i) => i.id === 'open-middle')).toBeTruthy()
  })

  it('a wall between the spawns hides them from each other', () => {
    const p = arena()
    p.scene_items.push(shape('Wall', [0, 1, 0], [80, 8, 1]))
    const f = gatherFacts({ project: p })
    expect(f.spawns.exposed).toEqual([])
    expect(f.flow.groundRoute).toBe(false)
  })

  it('finds lopsided maps and offers to mirror them', () => {
    const p = arena()
    p.scene_items.push(shape('Crate', [10, 1, -20], [4, 4, 4]))
    p.markers.push({ ...newMarker('Weapon pickup', [10, 1.1, -30]), weapon: 'sniper_rifle' })
    p.markers.push(newMarker('Red team spawn', [6, 1.1, 30]))
    const f = gatherFacts({ project: p })
    expect(f.symmetry.objects.unmatched).toEqual([1])
    expect(f.spawns.wrongEnd).toEqual([3])
    const ids = f.issues.map((i) => i.id)
    expect(ids).toEqual(expect.arrayContaining(['symmetry', 'team-count', 'weapon-balance', 'power-weapons', 'spawn-end-3']))
    expect(f.issues.find((i) => i.id === 'symmetry')!.fix!.actions).toEqual([{ do: 'make_symmetric', keep: 'red' }])
    expect(f.issues.find((i) => i.id === 'spawn-end-3')!.fix!.actions).toEqual([{ do: 'move_marker', index: 3, x: -6, z: -30 }])
    expect(factsText(f)).toContain('Symmetry')
  })

  it('a spawn inside a box is moved to open floor', () => {
    const p = arena()
    p.scene_items.push(shape('Block', [0, 1, -50], [10, 6, 10]), shape('Block', [0, 1, 50], [10, 6, 10]))
    const f = gatherFacts({ project: p })
    expect(f.spawns.inside).toEqual([0, 1])
    const fix = f.issues.find((i) => i.id === 'spawn-stuck-0')!.fix!.actions[0] as { x: number; z: number }
    expect(Math.max(Math.abs(fix.x), Math.abs(fix.z + 50))).toBeGreaterThan(5)
  })

  it('can switch to another analysis', () => {
    const other: FactSource = { name: 'other', gather: (i) => ({ ...gridFacts.gather(i), source: 'other' }) }
    setFactSource(other)
    expect(gatherFacts({ project: arena() }).source).toBe('other')
    setFactSource(gridFacts)
  })
})

describe('AI edit helpers', () => {
  it('targets objects by index, name or kind', () => {
    const p = arena()
    p.scene_items.push(shape('Wall 4×4×1', [5, 1, 5], [4, 4, 1]), shape('Crate', [3, 1, 3], [2, 2, 2]))
    expect(resolveTarget(p, { name: 'wall' })).toEqual([1])
    expect(resolveTarget(p, { shape: 'box' })).toEqual([0, 1, 2])
    expect(resolveTarget(p, { indices: [2, 9] })).toEqual([2])
    expect(resolveTarget(p, {})).toEqual([])
  })

  it('places things along a line and round a ring', () => {
    const line = expandPlacement({ do: 'place_line', item: { do: 'add_prefab', key: 'lamp' }, from: [-20, -40], to: [20, -40], count: 5, face: 'along', mirror: true })
    expect(line).toHaveLength(5)
    expect(line.map((a) => (a as { x: number }).x)).toEqual([-20, -10, 0, 10, 20])
    expect(line[0]).toMatchObject({ do: 'add_prefab', key: 'lamp', z: -40, turn: 90, mirror: true })
    const ring = expandPlacement({ do: 'place_ring', item: { do: 'add_marker', type: 'Shared spawn' }, radius: 30, count: 4 })
    expect(ring.map((a) => [(a as { x: number }).x, (a as { z: number }).z])).toEqual([[0, 30], [30, 0], [0, -30], [-30, 0]])
    expect(expandPlacement({ do: 'place_ring', item: { do: 'add_light' }, radius: 5, count: 500 })).toHaveLength(40)
  })

  it('pairs twins and plans a symmetric copy', () => {
    const p = arena()
    p.scene_items.push(shape('Crate', [10, 1, -20], [4, 4, 4], 30), shape('Crate', [-10, 1, 20], [4, 4, 4], 210), shape('Crate', [5, 1, -5], [2, 2, 2]))
    expect(findTwin(p, 1)).toBe(2)
    expect(findTwin(p, 3)).toBeNull()
    expect(findTwin(p, 0)).toBe(0)
    const plan = symmetricPlan(p, 'red')
    expect(plan.items).toEqual({ drop: [2], copy: [1, 3] })
    expect(plan.markers).toEqual({ drop: [1], copy: [0] })
  })
})
