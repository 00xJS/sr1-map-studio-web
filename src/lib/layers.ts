// Layers, as in a paint program: every object can sit in a named layer ("House", "Trees", "Fences"), and a layer
// can be hidden to look at the map without it, or shown on its own. An object's layer is SceneItem.layer (unset:
// no layer); the project keeps the layers' order and which are hidden (Project.layers). Hidden layers are left out
// of the editor's view, picking and walk-through; the export keeps them unless the project says to leave them out.
// Pure, so it is tested in Node.
import type { Project, SceneItem } from './project'

/** A layer's state, in the order the panel lists them. */
export interface LayerState { name: string; hidden?: boolean }

export interface LayerInfo { name: string; hidden: boolean; count: number }

/** The name shown for objects in no layer. */
export const NO_LAYER = 'No layer'

/** An object's layer ('' for none). */
export const layerOf = (it: Pick<SceneItem, 'layer'>) => (typeof it.layer === 'string' ? it.layer : '')

/**
 * The layer "Sort into layers" puts an object in: what it is called, without copy numbers and record suffixes
 * ("House 2", "House_03", "house (copy)" all go in "House"), so every house of a map lands in one layer.
 */
export function autoLayer(it: Pick<SceneItem, 'name'>): string {
  const base = (it.name || '').replace(/\.(obj|glb|gltf|fbx)$/i, '').replace(/\s*\((copy|\d+)\)$/i, '').replace(/[\s_-]*\d+$/, '').replace(/[_]+/g, ' ').trim()
  return base ? base[0].toUpperCase() + base.slice(1) : 'Objects'
}

/** Every layer: the project's, in its order, then any only objects name, then "no layer" when objects have none. */
export function layerList(p: Pick<Project, 'scene_items' | 'layers'>): LayerInfo[] {
  const counts = new Map<string, number>()
  for (const it of p.scene_items) counts.set(layerOf(it), (counts.get(layerOf(it)) ?? 0) + 1)
  const out: LayerInfo[] = []
  const seen = new Set<string>()
  for (const l of p.layers ?? []) {
    if (!l.name || seen.has(l.name)) continue
    seen.add(l.name)
    out.push({ name: l.name, hidden: !!l.hidden, count: counts.get(l.name) ?? 0 })
  }
  for (const [name, count] of counts) if (name && !seen.has(name)) { seen.add(name); out.push({ name, hidden: false, count }) }
  if (counts.get('')) out.push({ name: '', hidden: hiddenSet(p).has(''), count: counts.get('')! })
  return out
}

/** The hidden layers' names ('' when objects in no layer are hidden). */
export function hiddenSet(p: Pick<Project, 'layers'>): Set<string> {
  return new Set((p.layers ?? []).filter((l) => l.hidden).map((l) => l.name))
}

/** Whether an object is hidden by its layer. */
export const layerHidden = (hidden: Set<string>, it: Pick<SceneItem, 'layer'>) => hidden.size > 0 && hidden.has(layerOf(it))

/** The objects the export builds: all of them, or with the project's choice, those in visible layers. */
export function exportedItems(p: Pick<Project, 'scene_items' | 'layers' | 'export_hidden_layers'>): SceneItem[] {
  if (p.export_hidden_layers !== false) return p.scene_items
  const hidden = hiddenSet(p)
  return p.scene_items.filter((it) => !layerHidden(hidden, it))
}

/** The project's layer list with `name` changed by `fn` (added at the top when it isn't there yet). */
export function withLayer(layers: LayerState[] | undefined, name: string, fn: (l: LayerState) => LayerState): LayerState[] {
  const list = [...(layers ?? [])]
  const i = list.findIndex((l) => l.name === name)
  if (i < 0) return [fn({ name }), ...list]
  list[i] = fn(list[i])
  return list
}
