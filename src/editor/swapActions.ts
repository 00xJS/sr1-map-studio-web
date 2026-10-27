// The object swapper's commands: where the selected object stands (its footprint, its floor and its heading), and
// swapping something else in there (lib/gameObjects/swap.ts says what), turned to fit, in one undo step. The
// object keeps its uid, group and anything else that isn't about its model, so it stays where the map keeps it.
import { useEditor, currentProject } from './store'
import { prefabItem, pruneFiles } from './actions'
import { loadModel } from '../lib/assets'
import { ALL_PREFABS } from '../lib/prefabRegistry'
import { turn } from '../lib/sampleKit'
import type { FileRef, Project, SceneItem, Vec3 } from '../lib/project'
import { entryById, loadIndex } from '../lib/gameObjects/client'
import { gameObjectItem, gameRefOf, sinkUnits } from '../lib/gameObjects/place'
import type { GameObjectEntry } from '../lib/gameObjects/indexer'
import { fitTurn, prefabBox, type SwapOption, type SwapSpot } from '../lib/gameObjects/swap'

/** Where a placed object stands, in editor units. */
export interface Stand {
  /** Its middle across X and Z, and the floor under it (its lowest point, or its floor when it is sunk into one). */
  at: Vec3
  /** Its extents along its own X and Z, and its height. */
  ex: number; ez: number; h: number
  /** Its heading, degrees. */
  rot: number
}

const wsOf = (p: Project) => p.settings.world_scale || 0.5

/** A game model's extents along its own X and Z (metres). */
const extents = (e: Pick<GameObjectEntry, 'size' | 'long'>): [number, number] => (e.long === 'z' ? [e.size[1], e.size[0]] : [e.size[0], e.size[1]])

/** Whether the swapper is offered for this object: anything with a model, but not glass, terrain or a road network. */
export const swappable = (it: SceneItem) => !it.native_prefab && it.shape?.kind !== 'terrain' && it.prefab?.key !== 'road'

/** The library entry of a placed game model, reading the stored library when it isn't open yet. */
async function entryOf(it: SceneItem): Promise<GameObjectEntry | undefined> {
  const g = gameRefOf(it)
  if (!g) return undefined
  return entryById(g.id) ?? (await loadIndex(), entryById(g.id))
}

/** Where an object stands: from its model's own box, or (a game model whose files aren't here) its library size. */
export async function standOf(it: SceneItem, p: Project): Promise<Stand> {
  const e = await entryOf(it).catch(() => undefined)
  const g = gameRefOf(it), s = it.scale || 1, rot = it.rotation[1] || 0
  // Sunk into the floor as the city has it: the floor is that far above its lowest point.
  const sink = e && g ? sinkUnits(e, g.ws) * s : 0
  try {
    const m = await loadModel(p, it.path)
    const pv = it.pivot ?? [0, 0, 0]
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < m.positions.length; i++) { const k = i % 3; min[k] = Math.min(min[k], m.positions[i]); max[k] = Math.max(max[k], m.positions[i]) }
    if (!Number.isFinite(min[0])) throw new Error('empty model')
    const [dx, dz] = turn(((min[0] + max[0]) / 2 - pv[0]) * s, ((min[2] + max[2]) / 2 - pv[2]) * s, rot)
    return { at: [it.position[0] + dx, it.position[1] + (min[1] - pv[1]) * s + sink, it.position[2] + dz], ex: (max[0] - min[0]) * s, ez: (max[2] - min[2]) * s, h: (max[1] - min[1]) * s, rot }
  } catch (err) {
    if (!e || !g) throw err
    const [ex, ez] = extents(e)
    return { at: [it.position[0], it.position[1] + sink, it.position[2]], ex: (ex / g.ws) * s, ez: (ez / g.ws) * s, h: (e.size[2] / g.ws) * s, rot }
  }
}

/** The spot the swapper fills (swap.ts), in metres. */
export async function spotOf(it: SceneItem, p: Project): Promise<SwapSpot> {
  const st = await standOf(it, p)
  const ws = wsOf(p)
  const entry = await entryOf(it).catch(() => undefined)
  return {
    long: Math.max(st.ex, st.ez) * ws, short: Math.min(st.ex, st.ez) * ws, h: st.h * ws,
    label: it.prefab ? ALL_PREFABS[it.prefab.key]?.label ?? it.name : entry?.name ?? it.name,
    ...(entry ? { entry } : {}), ...(it.prefab ? { prefab: it.prefab.key } : {}),
  }
}

/** What a swap leaves of the old object: everything that isn't about its model or where it stands. */
const MODEL_KEYS = ['name', 'path', 'source_path', 'original_import_path', 'position', 'rotation', 'scale', 'pivot', 'textures', 'alpha',
  'surface_ids', 'triangles', 'shape', 'prefab', 'game_object', 'game_look', 'asset_ref', 'double_sided', 'collision_excluded_faces',
  'swimmable_water', 'water_materials', 'native_prefab', 'glass_style', 'glass_custom_texture', 'native_mesh_obj', 'native_breakable_kind',
  'native_opacity', 'native_use_alpha', 'native_prop_behavior', 'native_original_name', 'native_prop_original_name', 'native_profile',
  'physics_intent', 'physics_preset', 'physics_shape', 'physics_bottom_heavy']

/** Swaps the object at `index` for `opt`: standing where it stood, on its floor, its long side the same way. */
export async function swapItem(index: number, opt: SwapOption) {
  const p = currentProject()
  const it = p?.scene_items[index]
  if (!p || !it) return
  const st = await standOf(it, p)
  const ws = wsOf(p)
  let made: { item: SceneItem; files: Record<string, FileRef> }
  if (opt.key.startsWith('game:')) {
    const id = opt.key.slice(5)
    const e = entryById(id) ?? (await loadIndex(), entryById(id))
    if (!e) throw new Error('That object is not in your game library any more. Rebuild the library (Prefabs → From my game).')
    const [ex, ez] = extents(e)
    const rot = fitTurn(st.ex, st.ez, st.rot, ex / ws, ez / ws)
    made = await gameObjectItem(e, [st.at[0], st.at[1] - sinkUnits(e, ws), st.at[2]], rot, ws)
  } else {
    const key = opt.key.slice(7)
    const b = ALL_PREFABS[key] && prefabBox(key)
    if (!b) throw new Error('That prefab is not available.')
    const rot = fitTurn(st.ex, st.ez, st.rot, b.max[0] - b.min[0], b.max[2] - b.min[2])
    // Its own frame's middle goes where the old one's middle was, its bottom on the floor.
    const [dx, dz] = turn((b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2, rot)
    made = await prefabItem(key, {}, [st.at[0] - dx, st.at[1] - b.min[1], st.at[2] - dz], rot)
  }
  const keep: Record<string, unknown> = { ...it }
  for (const k of MODEL_KEYS) delete keep[k]
  const item = { ...keep, ...made.item, uid: it.uid } as SceneItem
  const s = useEditor.getState()
  s.update(`Swap ${it.name} for ${opt.label}`, (d) => {
    const i = d.scene_items.findIndex((x) => x.uid === it.uid)
    if (i < 0) return
    Object.assign(d.files, made.files)
    d.scene_items[i] = item
    pruneFiles(d as Project)
  })
  s.log(`Swapped ${it.name} for ${opt.label}${made.item.game_object ? ' from your game files (yours to use in your own maps; it can’t be shared or published)' : ''}. Ctrl+Z puts it back.`)
}
