// What the Layers panel does to the project (lib/layers.ts), each one undoable.
import { useEditor } from './store'
import { autoLayer, layerList, layerOf, withLayer, type LayerState } from '../lib/layers'
import type { Project } from '../lib/project'

const st = () => useEditor.getState()

/** The selected objects' indices (one, or the whole multi-selection). */
export function selectedItems(): number[] {
  const { selection, multi } = st()
  return multi.length ? multi : selection?.kind === 'item' ? [selection.index] : []
}

/** Puts objects in layers by what they are called; `all`: objects already in a layer too. Returns how many moved. */
export function sortIntoLayers(all: boolean): number {
  let moved = 0
  st().update('Sort into layers', (d) => {
    for (const it of d.scene_items) {
      if (!all && layerOf(it)) continue
      const name = autoLayer(it)
      if (layerOf(it) !== name) { it.layer = name; moved++ }
    }
  })
  return moved
}

/** Every layer as the panel lists them, in that order (so changing one never moves it). */
const listed = (d: Pick<Project, 'scene_items' | 'layers'>): LayerState[] => layerList(d).map((l) => ({ name: l.name, ...(l.hidden ? { hidden: true } : {}) }))

export function setHidden(name: string, hidden: boolean) {
  st().update(hidden ? 'Hide layer' : 'Show layer', (d) => { d.layers = listed(d).map((l) => (l.name === name ? { ...l, hidden } : l)) })
}

/** Only this layer shown; again (when it already is the only one shown) shows every layer. */
export function solo(name: string) {
  const p = st().project
  if (!p) return
  const list = layerList(p)
  const alone = list.every((l) => (l.name === name ? !l.hidden : l.hidden))
  st().update(alone ? 'Show all layers' : 'Show one layer', (d) => {
    // Every layer in the list, in its order.
    d.layers = list.map((l) => ({ name: l.name, hidden: alone ? false : l.name !== name }))
  })
}

export function showAll() {
  st().update('Show all layers', (d) => { d.layers = (d.layers ?? []).map((l) => ({ ...l, hidden: false })) })
}

/** Renames a layer (into another one that exists: the two become one). */
export function rename(from: string, to: string) {
  to = to.trim()
  if (!to || to === from) return
  st().update('Rename layer', (d) => {
    for (const it of d.scene_items) if (layerOf(it) === from) it.layer = to
    // In its place in the list, or into the other one.
    const list = d.layers ?? []
    const i = list.findIndex((l) => l.name === from)
    if (list.some((l) => l.name === to)) d.layers = list.filter((l) => l.name !== from)
    else if (i >= 0) list[i] = { ...list[i], name: to }
  })
}

/** Moves objects into layer `name` ('' for none), making it when it is new. */
export function moveTo(indices: number[], name: string) {
  if (!indices.length) return
  st().update(name ? `Move to layer ${name}` : 'Take out of layer', (d) => {
    for (const i of indices) {
      const it = d.scene_items[i]
      if (!it) continue
      if (name) it.layer = name
      else delete it.layer
    }
    if (name && !(d.layers ?? []).some((l) => l.name === name)) d.layers = withLayer(d.layers, name, (l) => l)
  })
}

/** Deletes a layer; its objects stay, in no layer. */
export function remove(name: string) {
  st().update('Delete layer', (d) => {
    for (const it of d.scene_items) if (layerOf(it) === name) delete it.layer
    d.layers = (d.layers ?? []).filter((l) => l.name !== name)
  })
}

/** Moves a layer up or down the list. */
export function reorder(name: string, by: -1 | 1) {
  const p = st().project
  if (!p) return
  const names = layerList(p).map((l) => l.name).filter(Boolean)
  const i = names.indexOf(name), j = i + by
  if (i < 0 || j < 0 || j >= names.length) return
  ;[names[i], names[j]] = [names[j], names[i]]
  st().update('Reorder layers', (d) => {
    const state = new Map((d.layers ?? []).map((l) => [l.name, l]))
    d.layers = [...names.map((n) => state.get(n) ?? { name: n }), ...(d.layers ?? []).filter((l) => !l.name)]
  })
}

/** Selects every object in a layer. */
export function selectLayer(name: string) {
  const p = st().project
  if (!p) return
  st().selectItems(p.scene_items.flatMap((it, i) => (layerOf(it) === name ? [i] : [])))
}

export function setExportHidden(on: boolean) {
  st().update(on ? 'Export hidden layers' : 'Leave hidden layers out of the export', (d) => { if (on) delete d.export_hidden_layers; else d.export_hidden_layers = false })
}
