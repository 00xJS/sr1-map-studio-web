/// <reference types="vite/client" />
import { afterEach, describe, expect, it } from 'vitest'
import { useEditor } from '../src/editor/store'
import { newMarker, newProject, uid, type Project, type SceneItem, type Vec3 } from '../src/lib/project'
import { symmetryOf } from '../src/lib/mirrorEdit'
import { mirrorCheck } from '../src/lib/analysis'

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

  it('counts twins live, as the map checks pair markers (about the origin)', () => {
    const p = mirrored()
    expect(symmetryOf(p)).toEqual({ objects: 3, totalObjects: 3, markers: 2, totalMarkers: 2 })
    expect(mirrorCheck(p.markers)).toEqual([])
    p.scene_items[2].position = [-10, 0, 26]
    p.markers[1].position = [-5, 0, 36]
    expect(symmetryOf(p)).toEqual({ objects: 1, totalObjects: 3, markers: 0, totalMarkers: 2 })
    expect(mirrorCheck(p.markers)).toHaveLength(2)
  })
})
