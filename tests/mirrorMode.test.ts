/// <reference types="vite/client" />
import { afterEach, describe, expect, it } from 'vitest'
import { useEditor, withoutMirror } from '../src/editor/store'
import { newLight, newMarker, newProject, uid, type Project, type SceneItem, type Vec3 } from '../src/lib/project'
import { holdsBothHalves, symmetryOf } from '../src/lib/mirrorEdit'
import { mirrorCheck } from '../src/lib/analysis'
import { unmirroredCost } from '../src/lib/analysis/analyze'

const box = (name: string, position: Vec3, turn = 0): SceneItem => ({
  uid: uid(), name, path: '/work/f/x/box.obj', position, rotation: [0, turn, 0], scale: 1, textures: {}, alpha: {},
  shape: { kind: 'box', size: [3, 3, 3], tile: 3 },
})

/** A map with a crate and its twin across the middle, and a red spawn with its blue twin. */
function mirrored(): Project {
  const p = newProject('Mirror')
  p.scene_items = [box('Floor', [0, 0, 0]), box('Crate', [10, 0, -20]), box('Crate', [-10, 0, 20], 180)]
  p.markers = [{ ...newMarker('Red team spawn', [5, 0, -30]), yaw: 0 }, { ...newMarker('Blue team spawn', [-5, 0, 30]), yaw: 180 }]
  return p
}

const st = () => useEditor.getState()
const open = () => { st().open(mirrored()); st().set({ mirror: true }) }

afterEach(() => { st().set({ mirror: false }); st().close() })

describe('mirror mode', () => {
  it('moves the twin with the edit, and one undo puts both back', () => {
    open()
    st().update('Move object', (d) => { d.scene_items[1].position = [14, 0, -20]; d.scene_items[1].rotation = [0, 30, 0] })
    let p = st().project!
    expect(p.scene_items[2].position).toEqual([-14, 0, 20])
    expect(p.scene_items[2].rotation).toEqual([0, 210, 0])
    expect(st().past).toHaveLength(1)
    st().undo()
    p = st().project!
    expect(p.scene_items[1].position).toEqual([10, 0, -20])
    expect(p.scene_items[2].position).toEqual([-10, 0, 20])
    expect(st().past).toHaveLength(0)
    st().redo()
    expect(st().project!.scene_items[2].position).toEqual([-14, 0, 20])
  })

  it('a gizmo drag stays one step, the twin following each move', () => {
    open()
    for (const x of [11, 12, 13]) st().update('Move object', (d) => { d.scene_items[1].position = [x, 0, -20] }, { merge: 'drag' })
    expect(st().project!.scene_items[2].position).toEqual([-13, 0, 20])
    expect(st().past).toHaveLength(1)
    st().undo()
    expect(st().project!.scene_items[2].position).toEqual([-10, 0, 20])
  })

  it('adds a twin for something new, and deletes the twin of something deleted', () => {
    open()
    st().update('Add crate', (d) => { d.scene_items.push(box('Crate', [6, 0, 8], 90)) })
    let p = st().project!
    expect(p.scene_items).toHaveLength(5)
    expect(p.scene_items[4]).toMatchObject({ position: [-6, 0, -8], rotation: [0, 270, 0] })
    expect(p.scene_items[4].uid).not.toBe(p.scene_items[3].uid)
    st().update('Add spawn', (d) => { d.markers.push(newMarker('Red team spawn', [2, 0, -40])) })
    p = st().project!
    expect(p.markers.at(-1)).toMatchObject({ type: 'Blue team spawn', position: [-2, 0, 40] })
    st().update('Delete', (d) => { d.scene_items.splice(1, 1) })
    expect(st().project!.scene_items.map((it) => it.position)).toEqual([[0, 0, 0], [6, 0, 8], [-6, 0, -8]])
    st().undo()
    expect(st().project!.scene_items).toHaveLength(5)
  })

  it('leaves things on the centre, pairs the edit already made and twins both selected alone', () => {
    open()
    st().update('Move floor', (d) => { d.scene_items[0].position = [0, 1, 0] })
    expect(st().project!.scene_items).toHaveLength(3)
    // Both twins moved by the edit (both selected): each keeps its own move.
    st().update('Move both', (d) => { d.scene_items[1].position = [10, 0, -25]; d.scene_items[2].position = [-10, 0, 21] })
    expect(st().project!.scene_items[2].position).toEqual([-10, 0, 21])
    // An edit that adds a pair (AI "mirror: true") gets no third copy.
    st().update('Add pair', (d) => { d.scene_items.push(box('Crate', [3, 0, 3]), box('Crate', [-3, 0, -3], 180)) })
    expect(st().project!.scene_items).toHaveLength(5)
  })

  it('stays out of noMirror edits and transactions (Fix all)', async () => {
    open()
    st().update('Make symmetric', (d) => { d.scene_items.splice(2, 1) }, { noMirror: true })
    expect(st().project!.scene_items).toHaveLength(2)
    await st().transaction('Fix all', async () => { st().update('Fix', (d) => { d.markers[0].position = [5, 0, -32] }) })
    expect(st().project!.markers[1].position).toEqual([-5, 0, 30])
    expect(st().past.map((h) => h.label)).toEqual(['Make symmetric', 'Fix all'])
  })

  it('off, an edit is just the edit', () => {
    st().open(mirrored())
    st().update('Move object', (d) => { d.scene_items[1].position = [14, 0, -20] })
    expect(st().project!.scene_items[2].position).toEqual([-10, 0, 20])
  })

  it('counts twins live, as the map checks pair markers', () => {
    const p = mirrored()
    expect(symmetryOf(p)).toEqual({ objects: 3, totalObjects: 3, markers: 2, totalMarkers: 2, lights: 0, totalLights: 0 })
    expect(mirrorCheck(p.markers)).toEqual([])
    p.scene_items[2].position = [-10, 0, 26]
    p.markers.push({ ...newMarker('Weapon pickup', [20, 0, 5]), weapon: 'ak47' })
    expect(symmetryOf(p)).toMatchObject({ objects: 1, markers: 2, totalMarkers: 3 })
    expect(mirrorCheck(p.markers)).toHaveLength(1)
    // Team spawns: 3 points each, 20 at most. With one spawn there are no sides, and nothing caps it.
    expect(unmirroredCost(p.markers)).toEqual({ count: 1, points: 3 })
    const lone = [newMarker('Shared spawn', [5, 0, 5]), ...Array.from({ length: 8 }, (_, k) => ({ ...newMarker('Weapon pickup', [k * 10 + 3, 0, 40]), weapon: 'ak47' }))]
    expect(unmirroredCost(lone)).toEqual({ count: 9, points: 27 })
  })

  it('drags through the middle without losing the twin', () => {
    open()
    for (let k = 1; k <= 20; k++) { const t = k / 20; st().update('Move', (d) => { d.scene_items[1].position = [10 - 20 * t, 0, -20 + 40 * t] }, { merge: 'drag' }) }
    expect(st().project!.scene_items[2].position).toEqual([10, 0, -20])
    expect(st().project!.scene_items).toHaveLength(3)
    expect(st().past).toHaveLength(1)
  })

  it('gives a centre object a twin when it moves off the middle, and takes it back if it returns', () => {
    open()
    st().update('Move floor', (d) => { d.scene_items[0].position = [6, 0, 0] }, { merge: 'drag' })
    let p = st().project!
    expect(p.scene_items).toHaveLength(4)
    expect(p.scene_items[3]).toMatchObject({ name: 'Floor', position: [-6, 0, 0], rotation: [0, 180, 0] })
    st().update('Move floor', (d) => { d.scene_items[0].position = [8, 0, 0] }, { merge: 'drag' })
    expect(st().project!.scene_items[3].position).toEqual([-8, 0, 0])
    st().update('Move floor', (d) => { d.scene_items[0].position = [0, 0, 0] }, { merge: 'drag' })
    p = st().project!
    expect(p.scene_items.map((it) => it.name)).toEqual(['Floor', 'Crate', 'Crate'])
  })

  it('turns about the middle of the spawns, as the fairness check does, on an off-centre map', () => {
    const p = mirrored()
    const shift = (v: Vec3): Vec3 => [v[0] + 100, v[1], v[2] + 40]
    for (const x of [...p.scene_items, ...p.markers]) x.position = shift(x.position)
    // Opened maps are centred on their bounds, not their spawns: the check still finds every twin.
    expect(mirrorCheck(p.markers)).toEqual([])
    st().open(p); st().set({ mirror: true })
    st().update('Move', (d) => { d.scene_items[1].position = [114, 0, 20] })
    expect(st().project!.scene_items[2].position).toEqual([86, 0, 60])
    st().update('Add pickup', (d) => { d.markers.push({ ...newMarker('Weapon pickup', [102, 0, 10]), weapon: 'm16' }) })
    expect(st().project!.markers.at(-1)).toMatchObject({ type: 'Weapon pickup', weapon: 'm16', position: [98, 0, 70] })
    expect(mirrorCheck(st().project!.markers)).toEqual([])
  })

  it('copies size, paint and settings to the twin, and lights too', () => {
    open()
    const twinUid = st().project!.scene_items[2].uid
    st().update('Paint', (d) => {
      const it = d.scene_items[1]
      it.textures = { m0: '/work/f/b/brick.png' }
      it.shape = { kind: 'box', size: [6, 3, 3], tile: 3 }
      it.path = '/work/f/y/box2.obj'
    })
    let twin = st().project!.scene_items[2]
    expect(twin).toMatchObject({ uid: twinUid, path: '/work/f/y/box2.obj', textures: { m0: '/work/f/b/brick.png' }, position: [-10, 0, 20], rotation: [0, 180, 0] })
    expect(twin.shape!.size).toEqual([6, 3, 3])
    // Still a pair: the next move mirrors.
    st().update('Move', (d) => { d.scene_items[1].position = [12, 0, -20] })
    twin = st().project!.scene_items[2]
    expect(twin.position).toEqual([-12, 0, 20])
    st().update('Add light', (d) => { d.lights.push(newLight([4, 3, 9])) })
    expect(st().project!.lights.map((l) => l.position)).toEqual([[4, 3, 9], [-4, 3, -9]])
    st().update('Move light', (d) => { d.lights[0].position = [5, 3, 9] })
    expect(st().project!.lights[1].position).toEqual([-5, 3, -9])
  })

  it('leaves edits that make both halves themselves alone (the AI, a single fix)', () => {
    open()
    withoutMirror(() => {
      st().update('Add', (d) => { d.scene_items.push(box('C', [8, 0, 8])) })
      st().update('Add', (d) => { d.scene_items.push(box('C', [-8, 0, -8], 180)) })
    })
    expect(st().project!.scene_items).toHaveLength(5)
    st().update('Add', (d) => { d.scene_items.push(box('D', [3, 0, 9])) })
    expect(st().project!.scene_items).toHaveLength(7)
  })

  it('pastes a copied pair as it is, but twins a copied half', () => {
    const items = mirrored().scene_items
    expect(holdsBothHalves(items.slice(1))).toBe(true)
    expect(holdsBothHalves(items)).toBe(true)
    expect(holdsBothHalves(items.slice(1, 2))).toBe(false)
    expect(holdsBothHalves([items[0], items[1], { ...items[2], position: [-10, 0, 25] }])).toBe(false)
  })

  it('opening another map turns mirror mode off', () => {
    open()
    st().open(mirrored())
    expect(st().mirror).toBe(false)
  })

  it('keeps a drag quick on a big map', () => {
    const p = newProject('Big')
    for (let i = 0; i < 500; i++) { const x = (i % 50) * 4 + 3, z = Math.floor(i / 50) * 4 + 3; p.scene_items.push(box('A' + (i % 7), [x, 0, z]), box('A' + (i % 7), [-x, 0, -z], 180)) }
    const frame = (n: number) => st().update('Move', (d) => { for (let i = 0; i < n * 2; i += 2) { const q = d.scene_items[i].position; d.scene_items[i].position = [q[0] + 0.01, 0, q[2]] } }, { merge: 'drag' })
    const time = (mirror: boolean, n: number) => {
      st().open(structuredClone(p)); st().set({ mirror })
      frame(n)
      const t0 = performance.now()
      for (let k = 0; k < 20; k++) frame(n)
      return (performance.now() - t0) / 20
    }
    const off = time(false, 200), on = time(true, 200)
    expect(st().project!.scene_items[1].position[0]).toBeCloseTo(-3.21, 4)
    // About 1 ms off and 2 ms on here; the bounds are generous for slower machines.
    console.log(`200-object drag on 1000 objects: ${off.toFixed(2)} ms off, ${on.toFixed(2)} ms on`)
    expect(on).toBeLessThan(Math.max(20, off * 6))
    const t0 = performance.now()
    for (let k = 0; k < 20; k++) st().update('Name', (d) => { d.settings.display_name = 'x' + k }, { merge: 'n' })
    expect((performance.now() - t0) / 20).toBeLessThan(5)
  })
})
