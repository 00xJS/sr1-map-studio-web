/// <reference types="vite/client" />
import { afterEach, describe, expect, it } from 'vitest'
import { command, mirrorCentreNow, useEditor, withoutMirror } from '../src/editor/store'
import { bundleItems, placeBundle } from '../src/editor/act/several'
import { newLight, newMarker, newProject, uid, type Project, type SceneItem, type Vec3 } from '../src/lib/project'
import { mirrorEdit, mirrorSession, symmetryOf } from '../src/lib/mirrorEdit'
import { produce, type Draft } from 'immer'
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

  it("leaves the edits a job makes itself alone, but mirrors the user's edits while it runs", async () => {
    open()
    withoutMirror(() => {
      st().update('Add', (d) => { d.scene_items.push(box('C', [8, 0, 8])) })
      st().update('Add', (d) => { d.scene_items.push(box('C', [-8, 0, -8], 180)) })
    })
    expect(st().project!.scene_items).toHaveLength(5)
    // A job like the AI's: a command started inside withoutMirror edits after an await, still unmirrored.
    let release = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const add = command(async (e) => {
      await gate
      e.update('Job adds', (d) => { d.scene_items.push(box('E', [5, 0, 12])) })
    })
    const job = withoutMirror(() => add())
    // Meanwhile the user's own edit is mirrored.
    st().update('User adds', (d) => { d.scene_items.push(box('D', [3, 0, 9])) })
    expect(st().project!.scene_items).toHaveLength(7)
    release()
    await job
    expect(st().project!.scene_items.map((it) => it.name)).toEqual(['Floor', 'Crate', 'Crate', 'C', 'C', 'D', 'D', 'E'])
  })

  it('a job still waiting when another map opens leaves mirror mode on that map alone', async () => {
    open()
    const pending = withoutMirror(() => new Promise<void>(() => {}))
    void pending
    st().open(mirrored())
    st().set({ mirror: true })
    st().update('Add', (d) => { d.markers.push(newMarker('Red team spawn', [4, 0, -12])) })
    expect(st().project!.markers.at(-1)).toMatchObject({ type: 'Blue team spawn', position: [-4, 0, 12] })
  })

  it("keeps the middle it found when turned on, though edits it doesn't copy move the spawns", () => {
    open()
    st().update('Nudge', (d) => { d.scene_items[1].position = [11, 0, -20] })
    // A fix moves the red spawn (not mirrored): the spawns' middle moves, the pairs don't.
    st().update('Fix moves a spawn', (d) => { d.markers[0].position = [25, 0, -30] }, { noMirror: true })
    st().update('Move', (d) => { d.scene_items[1].position = [12, 0, -20] })
    expect(st().project!.scene_items[2].position).toEqual([-12, 0, 20])
    // Off and on again: it finds the middle afresh.
    st().set({ mirror: false }); st().set({ mirror: true })
    st().update('Move', (d) => { d.scene_items[1].position = [13, 0, -20] })
    expect(st().project!.scene_items[2].position).not.toEqual([-13, 0, 20])
  })

  it('finds the middle when turned on; with fewer than two spawns it is the origin', () => {
    const p = mirrored()
    for (const m of p.markers) m.position = [m.position[0] + 50, 0, m.position[2] + 10]
    st().open(p)
    st().set({ mirror: true })
    expect(mirrorCentreNow()).toEqual([50, 10])
    // A spawn moved without mirroring (a fix): the pinned middle stays; every count uses it.
    st().update('Fix moves a spawn', (d) => { d.markers[0].position = [90, 0, -20] }, { noMirror: true })
    expect(mirrorCentreNow()).toEqual([50, 10])
    st().set({ mirror: false })
    expect(mirrorCentreNow()).toEqual([67.5, 10])
    const lone = mirrored()
    lone.markers = [newMarker('Red team spawn', [30, 0, 30]), { ...newMarker('Weapon pickup', [40, 0, 40]), weapon: 'ak47' }]
    st().open(lone)
    st().set({ mirror: true })
    expect(mirrorCentreNow()).toEqual([0, 0])
  })

  it('redo (or a jump) back across where it was turned on brings its middle back', () => {
    const p = newProject('Redo')
    p.markers = [newMarker('Red team spawn', [10, 0, -20]), newMarker('Blue team spawn', [-10, 0, 20])]
    st().open(p)
    st().update('Move spawns', (d) => { d.markers[0].position = [60, 0, -20]; d.markers[1].position = [40, 0, 20] })
    st().set({ mirror: true })
    expect(mirrorCentreNow()).toEqual([50, 0])
    st().undo()
    expect(mirrorCentreNow()).toEqual([0, 0])
    st().redo()
    expect(mirrorCentreNow()).toEqual([50, 0])
    st().update('Add', (d) => { d.markers.push({ ...newMarker('Weapon pickup', [55, 0, 5]), weapon: 'ak47' }) })
    expect(st().project!.markers.at(-1)!.position).toEqual([45, 0, -5])
    // The same through the history list: back past it, then forward past it.
    st().jumpTo(-2)
    expect(mirrorCentreNow()).toEqual([0, 0])
    st().jumpTo(2)
    expect(mirrorCentreNow()).toEqual([50, 0])
  })

  it('the first edit after turning it on is a step of its own, so undo can reach where it was turned on', () => {
    st().open(mirrored())
    st().update('Move', (d) => { d.scene_items[0].position = [0, 1, 0] }, { merge: 'drag' })
    st().set({ mirror: true })
    st().update('Move', (d) => { d.scene_items[0].position = [0, 2, 0] }, { merge: 'drag' })
    expect(st().past).toHaveLength(2)
  })

  it('reading the middle never pins it (it is read while drawing)', () => {
    open()
    st().update('Fix moves a spawn', (d) => { d.markers[0].position = [25, 0, -30] }, { noMirror: true })
    // Pinned when turned on, at the middle then.
    expect(mirrorCentreNow()).toEqual([0, 0])
    st().set({ mirror: false })
    expect(mirrorCentreNow()).toEqual([10, 0])
    expect(mirrorCentreNow()).toEqual([10, 0])
  })

  it('undoing past where it was turned on finds the middle again', () => {
    const p = mirrored()
    st().open(p)
    st().update('Move spawns', (d) => { d.markers[0].position = [25, 0, -30]; d.markers[1].position = [15, 0, 30] })
    st().set({ mirror: true })
    expect(mirrorCentreNow()).toEqual([20, 0])
    st().undo()
    expect(mirrorCentreNow()).toEqual([0, 0])
  })

  it('keeps its middle at the history limit: only undoing past where it was turned on finds it again', () => {
    st().open(mirrored())
    for (let k = 0; k < 160; k++) st().update('Rename', (d) => { d.name = 'n' + k })
    expect(st().past).toHaveLength(150)
    st().set({ mirror: true })
    expect(mirrorCentreNow()).toEqual([0, 0])
    // A fix moves a spawn (not mirrored), then the user moves a crate (mirrored); undoing the crate keeps the middle.
    st().update('Fix moves a spawn', (d) => { d.markers[0].position = [25, 0, -30] }, { noMirror: true })
    st().update('Move', (d) => { d.scene_items[1].position = [12, 0, -20] })
    st().undo()
    expect(mirrorCentreNow()).toEqual([0, 0])
    st().undo(); st().undo()
    expect(st().project!.name).toBe('n158')
    expect(mirrorCentreNow()).toEqual([0, 0])
  })

  it('a drag that crosses the middle keeps the twin it had (its uid and its own paint)', () => {
    open()
    st().update('Paint the twin', (d) => { d.scene_items[2].textures = { m0: '/work/f/b/brick.png' } }, { noMirror: true })
    const twin = st().project!.scene_items[2]
    for (let k = 1; k <= 20; k++) { const t = k / 20; st().update('Move', (d) => { d.scene_items[1].position = [10 - 20 * t, 0, -20 + 40 * t] }, { merge: 'drag' }) }
    const p = st().project!
    expect(p.scene_items).toHaveLength(3)
    const back = p.scene_items.find((it) => it.uid === twin.uid)!
    expect(back).toMatchObject({ position: [10, 0, -20], textures: { m0: '/work/f/b/brick.png' } })
    expect(st().past).toHaveLength(2)
  })

  it('a twin dragged onto the middle becomes one with the thing it mirrors', () => {
    open()
    for (const x of [6, 3, 0]) st().update('Move', (d) => { d.scene_items[1].position = [x, 0, -2 * x + 0] }, { merge: 'drag' })
    expect(st().project!.scene_items.map((it) => [it.name, it.position])).toEqual([['Floor', [0, 0, 0]], ['Crate', [0, 0, 0]]])
    st().undo()
    expect(st().project!.scene_items).toHaveLength(3)
  })

  it('pasting a copied pair away from where it was twins it, so the map stays symmetric', () => {
    open()
    const b = bundleItems([1, 2])!
    placeBundle(b, [4, 0, 4], 'Paste 2 objects')
    const p = st().project!
    expect(p.scene_items).toHaveLength(7)
    expect(symmetryOf(p)).toMatchObject({ objects: 7, totalObjects: 7 })
  })

  it('opening another map turns mirror mode off', () => {
    open()
    st().open(mirrored())
    expect(st().mirror).toBe(false)
  })

  it('keeps a drag quick on a big map', { timeout: 30_000 }, () => {
    const p = newProject('Big')
    for (let i = 0; i < 500; i++) { const x = (i % 50) * 4 + 3, z = Math.floor(i / 50) * 4 + 3; p.scene_items.push(box('A' + (i % 7), [x, 0, z]), box('A' + (i % 7), [-x, 0, -z], 180)) }
    // Through the store: the twins follow a 200-object drag, as one undo step.
    st().open(structuredClone(p)); st().set({ mirror: true })
    const drag = (d: Draft<Project>) => { for (let i = 0; i < 400; i += 2) { const q = d.scene_items[i].position; d.scene_items[i].position = [q[0] + 0.01, 0, q[2]] } }
    for (let k = 0; k < 10; k++) st().update('Move', drag, { merge: 'drag' })
    expect(st().project!.scene_items[1].position[0]).toBeCloseTo(-3.1, 4)
    expect(st().past).toHaveLength(1)
    // An edit that moves nothing mirrored hands back the edit's own result: no work at all.
    const before = st().project!, named = produce(before, (d) => { d.settings.display_name = 'x' })
    expect(mirrorEdit(before, named, uid, mirrorSession(before))).toBe(named)
    // The mirror pass against the edit itself, frame by frame in the same loop, so a busy machine slows both alike.
    let cur = produce(p, () => {})
    const session = mirrorSession(cur)
    const edit: number[] = [], mirror: number[] = []
    for (let k = 0; k < 40; k++) {
      const t0 = performance.now()
      const next = produce(cur, drag)
      const t1 = performance.now()
      cur = mirrorEdit(cur, next, uid, session)
      const t2 = performance.now()
      if (k >= 10) { edit.push(t1 - t0); mirror.push(t2 - t1) }
    }
    const mid = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]
    console.log(`200-object drag on 1000 objects: edit ${mid(edit).toFixed(2)} ms, mirror pass ${mid(mirror).toFixed(2)} ms (median frame)`)
    expect(cur.scene_items[1].position[0]).toBeCloseTo(-3.4, 4)
    // About half the edit's own time here; under twice it on any machine. A machine so loaded that the edit alone
    // takes ten times its usual few ms says nothing about mirroring: then only the result above counts.
    if (mid(edit) < 50) expect(mid(mirror)).toBeLessThan(mid(edit) * 2)
  })
})
