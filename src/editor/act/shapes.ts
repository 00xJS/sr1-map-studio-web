// Block-out shapes, prefabs and photo frames.
import { useEditor, currentProject, keepQuiet, mapRun, mirrorPaused, stillCurrent, thingKey } from '../store'
import { importImage } from '../../lib/importers'
import { cacheModel } from '../../lib/assets'
import { uid, type FileRef, type Project, type SceneItem, type Vec3 } from '../../lib/project'
import { SHAPE_PRESETS, shapeLabel, shapeName, shapeObj, type Shape } from '../../lib/shapes'
import { storeFile } from '../../lib/files'
import { parseObj } from '../../lib/geometry'
import { ALL_PREFABS } from '../../lib/prefabRegistry'
import { pictureSlot, tagRecipe } from '../../lib/recipes'
import { log, pruneFiles, update } from './core'

async function defaultShapeTextures(): Promise<{ files: Record<string, FileRef>; top: string; side: string }> {
  const { generate, defaultParams } = await import('../../lib/procedural')
  const { pixelsToPng } = await import('../../lib/images')
  const make = async (kind: 'concrete' | 'brick', name: string) => {
    const params = { ...defaultParams(kind, 512), seed: 1 }
    return importImage(tagRecipe(await pixelsToPng(generate(params), 512, name), { kind: 'generated', params }))
  }
  const top = await make('concrete', 'blockout_top.png')
  const side = await make('brick', 'blockout_side.png')
  return { files: { [top.vpath]: top.ref, [side.vpath]: side.ref }, top: top.vpath, side: side.vpath }
}

async function storeShape(shape: Shape) {
  const text = shapeObj(shape)
  const stored = await storeFile(tagRecipe(new Blob([text], { type: 'model/obj' }), { kind: 'shape', shape }), `${shape.kind}.obj`)
  cacheModel(stored.vpath, parseObj(text))
  return stored
}

/** Adds a block-out shape at the camera target, resting on the surface below if there is one. */
export async function addShape(presetKey: string, at: Vec3, groundY: number | null, o: { rot?: number; size?: Vec3 } = {}, run = mapRun()) {
  // Called inside withoutMirror (the AI), its edit isn't mirrored either.
  const noMirror = mirrorPaused()
  const preset = SHAPE_PRESETS[presetKey]
  if (!preset) return
  const shape = structuredClone(preset.shape)
  if (o.size) shape.size = o.size.map((v) => Math.max(0.1, Math.min(400, +v || 1))) as Vec3
  const stored = await storeShape(shape)
  const tex = await defaultShapeTextures()
  // Not on a map opened while it loaded (an AI reply mid-way when the map changed, too).
  stillCurrent(run)
  const item: SceneItem = {
    uid: uid(), name: shapeName(preset.label, shape, currentProject()?.settings.world_scale), path: stored.vpath, source_path: stored.vpath, shape,
    position: [at[0], groundY ?? 0, at[2]], rotation: [0, o.rot ?? 0, 0], scale: 1,
    textures: { top: tex.top, side: tex.side }, alpha: { top: false, side: false }, surface_ids: { top: 0, side: 0 }, physics_intent: 'Static',
  }
  update('Add ' + preset.label.toLowerCase(), (d) => {
    Object.assign(d.files, tex.files, { [stored.vpath]: stored.ref })
    d.scene_items.push(item)
  }, { noMirror })
  useEditor.getState().select({ kind: 'item', index: currentProject()!.scene_items.length - 1 })
  log(`Added ${preset.label.toLowerCase()} (${shapeName('', shape, currentProject()?.settings.world_scale).trim()}). Change its look in the panel on the right.`)
}

/** Regenerates a shape's mesh after its size, steps/sides or texture scale change. */
export async function updateShape(index: number, patch: Partial<Shape>) {
  const it = currentProject()?.scene_items[index]
  if (!it?.shape) return
  const shape: Shape = { ...it.shape, ...patch }
  const stored = await storeShape(shape)
  update('Resize shape', (d) => {
    const x = d.scene_items[index]
    x.shape = shape
    x.path = x.source_path = stored.vpath
    const label = shapeLabel(x.name)
    if (label) x.name = shapeName(label, shape, d.settings.world_scale)
    d.files[stored.vpath] = stored.ref
    pruneFiles(d as Project)
  }, { merge: 'shape' + thingKey('item', index) })
}

/** Builds a prefab as one scene object at a spot, turned by rot. */
export async function prefabItem(key: string, params: Record<string, number | string>, at: Vec3, rot: number) {
  const def = ALL_PREFABS[key]
  const { materialize } = await import('../../lib/samples')
  const { prefabParams, tagPrefab } = await import('../../lib/prefabs')
  const p = prefabParams(def, params)
  const { items, files } = await materialize(tagPrefab(def.make(at[0], at[2], rot, at[1], p), key, p, at, rot))
  return { item: { ...items[0], name: def.label }, files }
}

/**
 * Stamps a prefab (a building, car, tree, bus stop...) where the user clicked.
 * With `wall` (the clicked surface's outward direction), one that can go on a
 * wall (a sign, a photo frame) is stuck flat on it, centred on the click.
 */
export async function addPrefab(key: string, at: Vec3, groundY: number | null, o: { rot?: number; params?: Record<string, number | string>; wall?: Vec3 } = {}, run = mapRun()) {
  // Called inside withoutMirror (the AI), its edit isn't mirrored either.
  const noMirror = mirrorPaused()
  const def = ALL_PREFABS[key]
  if (!def) return
  if ((def as { physicsSet?: boolean }).physicsSet) { const physics = await import('../physicsActions'); return keepQuiet(noMirror, () => physics.addPhysicsSet(key, at, groundY, o.rot ?? 0, run)) }
  let params = o.params ?? {}, base: Vec3 = [at[0], groundY ?? 0, at[2]], rot = o.rot ?? 0
  const n = o.wall
  if (def.onWall && n && Math.abs(n[1]) < 0.6) {
    const { prefabParams } = await import('../../lib/prefabs')
    params = { ...prefabParams(def, params), ...def.onWall }
    const top = Math.max(...def.make(0, 0, 0, 0, params).map((p) => p.at[1] + p.size[1]))
    const len = Math.hypot(n[0], n[2]) || 1
    rot = +((Math.atan2(n[0] / len, n[2] / len) * 180) / Math.PI).toFixed(2)
    base = [at[0] + (n[0] / len) * 0.03, at[1] - top / 2, at[2] + (n[2] / len) * 0.03]
  }
  const { item, files } = await prefabItem(key, params, base, rot)
  // Not on a map opened while it loaded (an AI reply mid-way when the map changed, too).
  stillCurrent(run)
  update('Add ' + def.label.toLowerCase(), (d) => {
    Object.assign(d.files, files)
    d.scene_items.push(item)
  }, { noMirror })
  useEditor.getState().select({ kind: 'item', index: currentProject()!.scene_items.length - 1 })
  log(`Added ${def.label.toLowerCase()}. Change its settings, turn it or repaint it in its panel.`)
}

/** Rebuilds a placed prefab with new settings, in place; repaints the user made are kept where the same part still exists. */
export async function updatePrefab(index: number, params: Record<string, number | string>, run = mapRun()) {
  // Called inside withoutMirror (the AI), its edit isn't mirrored either.
  const noMirror = mirrorPaused()
  const it = currentProject()?.scene_items[index]
  const pf = it?.prefab
  if (!it || !pf || !ALL_PREFABS[pf.key]) return
  const { item, files } = await prefabItem(pf.key, params, it.position, it.rotation[1])
  // Not on a map opened while it loaded (an AI reply mid-way when the map changed, too).
  stillCurrent(run)
  const repaint = new Map(Object.entries(pf.defaults).filter(([m, v]) => it.textures[m] && it.textures[m] !== v).map(([m, v]) => [v, it.textures[m]]))
  update('Change ' + ALL_PREFABS[pf.key].label.toLowerCase(), (d) => {
    Object.assign(d.files, files)
    const x = d.scene_items[index]
    x.path = item.path; x.source_path = item.path
    x.textures = Object.fromEntries(Object.entries(item.textures).map(([m, v]) => [m, repaint.get(v) ?? v]))
    x.alpha = item.alpha; x.surface_ids = item.surface_ids
    x.prefab = item.prefab
    if (item.water_materials) x.water_materials = item.water_materials
    else delete x.water_materials
    pruneFiles(d)
  }, { merge: 'prefab-' + thingKey('item', index), noMirror })
}

/** The material of a placed photo frame that shows its picture (null for anything else). */
export const photoMaterial = (it: SceneItem, files: Project['files']): string | null =>
  it.prefab && ALL_PREFABS[it.prefab.key]?.photo ? pictureSlot(it, files) : null

/** Puts a photo in a placed frame, cropped to the frame's shape; null takes it out again. */
export async function setFramePhoto(index: number, file: Blob | null, aspect = 1) {
  const it = currentProject()?.scene_items[index]
  const mat = it && photoMaterial(it, currentProject()!.files)
  if (!it || !mat) return
  if (!file) {
    update('Remove photo', (d) => { d.scene_items[index].textures[mat] = it.prefab!.defaults[mat]; pruneFiles(d) })
    return
  }
  const { cropPhoto } = await import('../../lib/photoPiece')
  const stored = await storeFile(await cropPhoto(file, aspect), 'photo.jpg')
  update('Choose photo', (d) => {
    d.files[stored.vpath] = stored.ref
    const x = d.scene_items[index]
    x.textures[mat] = stored.vpath; x.alpha[mat] = false
    pruneFiles(d)
  })
}
