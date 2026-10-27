/// <reference types="vite/client" />
// Layers (lib/layers.ts) and what the Layers panel does with them (editor/layerActions.ts).
import { describe, expect, it } from 'vitest'
import { useEditor } from '../src/editor/store'
import { newProject, type SceneItem } from '../src/lib/project'
import { autoLayer, exportedItems, hiddenSet, layerList } from '../src/lib/layers'
import * as L from '../src/editor/layerActions'

const item = (name: string, layer?: string): SceneItem => ({
  uid: name + Math.random(), name, path: '', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: {}, alpha: {}, ...(layer ? { layer } : {}),
})

describe('layers', () => {
  it('names an object\'s layer by what it is called, copy numbers left off', () => {
    expect(['House', 'House 2', 'house_03', 'House (copy)', 'picnic_table', 'Tree.obj', ''].map((n) => autoLayer({ name: n })))
      .toEqual(['House', 'House', 'House', 'House', 'Picnic table', 'Tree', 'Objects'])
  })

  it('lists the project\'s layers in order, then ones only objects name, then the objects in none', () => {
    const p = { scene_items: [item('a', 'Trees'), item('b', 'House'), item('c', 'House'), item('d')], layers: [{ name: 'House', hidden: true }, { name: 'Empty' }] }
    expect(layerList(p)).toEqual([
      { name: 'House', hidden: true, count: 2 }, { name: 'Empty', hidden: false, count: 0 }, { name: 'Trees', hidden: false, count: 1 }, { name: '', hidden: false, count: 1 },
    ])
    expect([...hiddenSet(p)]).toEqual(['House'])
    // The export keeps hidden layers unless told not to.
    expect(exportedItems(p).length).toBe(4)
    expect(exportedItems({ ...p, export_hidden_layers: false }).map((it) => it.name)).toEqual(['a', 'd'])
  })
})

describe('the Layers panel', () => {
  const open = () => {
    const p = newProject('Layers')
    p.scene_items = [item('House'), item('House 2'), item('Tree'), item('Fence', 'Yard')]
    useEditor.getState().open(p)
  }
  const names = () => useEditor.getState().project!.scene_items.map((it) => it.layer ?? '')

  it('sorts objects into layers, hides, solos and shows them again, each one undoable', () => {
    open()
    expect(L.sortIntoLayers(false)).toBe(3)
    expect(names()).toEqual(['House', 'House', 'Tree', 'Yard'])
    const order = layerList(useEditor.getState().project!).map((l) => l.name)
    L.setHidden('Tree', true)
    expect([...hiddenSet(useEditor.getState().project!)]).toEqual(['Tree'])
    expect(layerList(useEditor.getState().project!).map((l) => l.name)).toEqual(order)
    L.solo('Tree')
    expect(layerList(useEditor.getState().project!).filter((l) => !l.hidden).map((l) => l.name)).toEqual(['Tree'])
    // The list keeps its order.
    expect(layerList(useEditor.getState().project!).map((l) => l.name)).toEqual(order)
    L.solo('Tree')
    expect(hiddenSet(useEditor.getState().project!).size).toBe(0)
    useEditor.getState().undo()
    expect(layerList(useEditor.getState().project!).filter((l) => !l.hidden).map((l) => l.name)).toEqual(['Tree'])
  })

  it('renames (merging into a layer that exists), moves the selection, reorders and deletes', () => {
    open()
    L.sortIntoLayers(false)
    L.rename('Tree', 'Yard')
    expect(names()).toEqual(['House', 'House', 'Yard', 'Yard'])
    useEditor.getState().selectItems([0])
    L.moveTo(L.selectedItems(), 'Main house')
    expect(names()[0]).toBe('Main house')
    expect(layerList(useEditor.getState().project!).map((l) => l.name)[0]).toBe('Main house')
    L.reorder('Main house', 1)
    expect(layerList(useEditor.getState().project!).map((l) => l.name).slice(0, 2)).toEqual(['House', 'Main house'])
    L.remove('Yard')
    expect(names()).toEqual(['Main house', 'House', '', ''])
    L.selectLayer('House')
    expect(L.selectedItems()).toEqual([1])
  })
})
