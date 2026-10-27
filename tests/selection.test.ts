/// <reference types="vite/client" />
import { afterEach, describe, expect, it } from 'vitest'
import { useEditor } from '../src/editor/store'
import { newMarker, newProject, type SceneItem } from '../src/lib/project'

const item = (uid: string) => ({ uid, name: uid, path: '', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } as unknown as SceneItem)
const st = () => useEditor.getState()
const names = () => st().project!.scene_items.map((it) => it.uid)

function openWith(...uids: string[]) {
  const p = newProject('Selection')
  p.scene_items = uids.map(item)
  st().open(p)
}

afterEach(() => st().close())

describe('selection follows the thing it points at', () => {
  it('stays on the same object when one before it is deleted', () => {
    openWith('a', 'b', 'c')
    st().select({ kind: 'item', index: 2 })
    st().update('Delete a', (d) => { d.scene_items.splice(0, 1) })
    expect(st().selection).toEqual({ kind: 'item', index: 1 })
    expect(names()[st().selection!.index]).toBe('c')
  })

  it('is dropped when the selected object is deleted', () => {
    openWith('a', 'b', 'c')
    st().select({ kind: 'item', index: 1 })
    st().update('Delete b', (d) => { d.scene_items.splice(1, 1) })
    expect(st().selection).toBeNull()
  })

  it('undo of an add never leaves the selection on another object', () => {
    openWith('a', 'b')
    st().update('Add c', (d) => { d.scene_items.unshift(item('c')) })
    st().select({ kind: 'item', index: 2 }) // b
    st().undo()
    expect(names()[st().selection!.index]).toBe('b')
    st().select({ kind: 'item', index: 0 }) // a
    st().redo()
    expect(names()[st().selection!.index]).toBe('a')
  })

  it('undo of an add drops a selection on the added object', () => {
    openWith('a')
    st().update('Add b', (d) => { d.scene_items.push(item('b')) })
    st().select({ kind: 'item', index: 1 })
    st().undo()
    expect(st().selection).toBeNull()
  })

  it('carries a multi-selection and the last item through history jumps', () => {
    openWith('a', 'b', 'c', 'd')
    st().selectItems([1, 3])
    st().update('Delete a', (d) => { d.scene_items.splice(0, 1) })
    expect(st().multi.map((i) => names()[i])).toEqual(['b', 'd'])
    st().update('Delete b', (d) => { d.scene_items.splice(0, 1) })
    expect(st().multi).toEqual([]) // one left: a plain selection
    expect(names()[st().selection!.index]).toBe('d')
    st().jumpTo(-2)
    expect(names()[st().selection!.index]).toBe('d')
    expect(names()[st().lastItem]).toBe('d')
  })

  it('keeps a piece rebuilt in place under a new uid', () => {
    openWith('a', 'b')
    st().select({ kind: 'item', index: 1 })
    st().update('Rebuild b', (d) => { d.scene_items[1] = item('b2') })
    expect(st().selection).toEqual({ kind: 'item', index: 1 })
  })

  it('follows markers too', () => {
    const p = newProject('Markers')
    p.markers = [newMarker('Shared spawn'), newMarker('Shared spawn'), newMarker('Shared spawn')]
    st().open(p)
    const uid = p.markers[2].uid
    st().select({ kind: 'marker', index: 2 })
    st().update('Delete marker', (d) => { d.markers.splice(0, 1) })
    expect(st().project!.markers[st().selection!.index].uid).toBe(uid)
  })
})
