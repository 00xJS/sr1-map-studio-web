// Editor commands. Each mirrors a MainWindow method in the desktop app;
// rules that live in Python (native props, breakables, validation) are
// called through the worker so behavior stays identical.
import { useEditor, currentProject } from './store'
import { importModels, importImage, type ImportedModel } from '../lib/importers'
import { cacheModel, loadModel } from '../lib/assets'
import { groundOffset, meshPivot, withPivot } from '../lib/geometry'
import { py } from '../lib/py'
import { catalogs } from '../lib/catalogs'
import { isCustomNative, isGlass, isProp, newLight, newMarker, referencedPaths, uid, type Asset, type FileRef, type Marker, type Project, type SceneItem, type Vec3 } from '../lib/project'
import { SHAPE_PRESETS, shapeLabel, shapeName, shapeObj, type Shape } from '../lib/shapes'
import { storeFile } from '../lib/files'
import { parseObj } from '../lib/geometry'
import { confirmDialog } from '../ui'
import { ALL_PREFABS } from '../lib/prefabRegistry'
import { pictureSlot, tagRecipe } from '../lib/recipes'

const log = (t: string) => useEditor.getState().log(t)
const update = (...a: Parameters<ReturnType<typeof useEditor.getState>['update']>) => useEditor.getState().update(...a)

export class UserError extends Error {}

function addFiles(files: Record<string, FileRef>) {
  return (d: { files: Record<string, FileRef> }) => { Object.assign(d.files, files) }
}

function itemFromImport(m: ImportedModel): SceneItem {
  return {
    uid: uid(), name: m.name, path: m.objPath, source_path: m.objPath, original_import_path: m.sourceName,
    position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: { ...m.textures }, alpha: { ...m.alpha }, physics_intent: 'Static',
  }
}

function assetFromImport(m: ImportedModel): Asset {
  return { uid: uid(), name: m.name, path: m.objPath, source_path: m.objPath, original_import_path: m.sourceName, textures: { ...m.textures }, alpha: { ...m.alpha }, triangles: m.triangles }
}

/** File > Open base map / + Add model / Import to library. */
export async function importModelFiles(files: File[], mode: 'base' | 'add' | 'library') {
  const imported = await importModels(files)
  for (const m of imported) {
    cacheModel(m.objPath, m.model)
    m.warnings.forEach((w) => log(m.name + ': ' + w))
  }
  update(mode === 'base' ? 'Open base map' : mode === 'add' ? 'Add model' : 'Import assets', (d) => {
    for (const m of imported) {
      addFiles(m.files)(d)
      if (!d.asset_library.some((a) => a.source_path === m.objPath)) d.asset_library.push(assetFromImport(m))
      if (mode === 'library') continue
      if (mode === 'base') {
        d.scene_items = [itemFromImport(m)]
        mode = 'add'
      } else d.scene_items.push(itemFromImport(m))
    }
  })
  const p = currentProject()!
  if (mode !== 'library') useEditor.getState().select({ kind: 'item', index: p.scene_items.length - 1 })
  imported.forEach((m) => log(`Imported ${m.sourceName} (${m.triangles.toLocaleString()} triangles, ${Object.keys(m.textures).length} textures)`))
  return imported
}

/** Asset library entry -> scene instance (desktop _create_asset_instance). */
export async function placeAsset(assetIndex: number, position: Vec3) {
  const p = currentProject()
  if (!p) return
  const asset = p.asset_library[assetIndex]
  if (!asset) return
  const ws = p.settings.world_scale
  let item: SceneItem
  if (isGlass(asset)) {
    const { uid: _u, ...rest } = asset
    item = { ...structuredClone(rest), uid: uid(), position: [...position] as Vec3, rotation: [0, 0, 0], scale: (asset as any).scale ?? 1 } as SceneItem
    if (!isCustomNative(item)) {
      item.scale = 1 / ws
      item.position[1] += catalogs.glass_size[1] / (2 * ws)
    }
    const others = p.scene_items.filter(isGlass)
    await py.syncProject(p)
    await py.sceneOp('restore_glass', { item }).then((r) => { item = { ...r, uid: item.uid } })
    if (others.length + 1 > catalogs.limits.max_native_objects) throw new UserError(`Native props and glass panes support at most ${catalogs.limits.max_native_objects} objects per map.`)
  } else {
    item = {
      uid: uid(), path: asset.path, source_path: asset.source_path, name: asset.name, position: [...position] as Vec3,
      rotation: [0, 0, 0], scale: 1, textures: { ...asset.textures }, alpha: { ...asset.alpha }, physics_intent: 'Static', asset_ref: asset.source_path,
    }
  }
  update('Place ' + asset.name, (d) => { d.scene_items.push(item) })
  useEditor.getState().select({ kind: 'item', index: currentProject()!.scene_items.length - 1 })
  log('Placed ' + asset.name + ' at ' + position.map((v) => v.toFixed(2)).join(', '))
}

export async function addGlass(styleLabel: string, position: Vec3) {
  const p = currentProject()
  if (!p) return
  if (!p.scene_items.length || isGlass(p.scene_items[0])) throw new UserError('Load your base map before placing glass.')
  await py.syncProject(p)
  const item = await py.sceneOp<SceneItem>('create_glass', { position, world_scale: p.settings.world_scale, style_label: styleLabel, others: p.scene_items.filter(isGlass) })
  const style = item.glass_style
  update('Add breakable glass', (d) => {
    if (!d.asset_library.some((a) => a.native_prefab === item.native_prefab && a.glass_style === style)) {
      const { position: _p, rotation: _r, ...asset } = item
      d.asset_library.push({ ...structuredClone(asset), uid: uid() } as unknown as Asset)
    }
    d.scene_items.push({ ...item, uid: uid() })
  })
  useEditor.getState().select({ kind: 'item', index: currentProject()!.scene_items.length - 1 })
}

/** Remove a library entry. Objects already placed keep their own copy of its files. */
export async function removeAsset(index: number): Promise<boolean> {
  const p = currentProject()
  const asset = p?.asset_library[index]
  if (!p || !asset) return false
  const used = p.scene_items.filter((it) => it.path === asset.path).length
  if (used && !(await confirmDialog('Remove from library?', `${used} placed object${used === 1 ? ' uses' : 's use'} this asset. They stay in the scene; only the library entry is removed.`, { confirm: 'Remove' }))) return false
  update('Remove asset ' + asset.name, (d) => {
    d.asset_library.splice(index, 1)
    // Drop file records nothing refers to any more.
    const live = new Set(referencedPaths(d as Project))
    for (const path of Object.keys(d.files)) if (!live.has(path)) delete d.files[path]
  })
  return true
}

export function duplicateItem(index: number) {
  const p = currentProject()
  const it = p?.scene_items[index]
  if (!p || !it) return
  if (isGlass(it) && p.scene_items.filter(isGlass).length >= catalogs.limits.max_native_objects) throw new UserError(`This build supports up to ${catalogs.limits.max_native_objects} native objects.`)
  update('Duplicate ' + it.name, (d) => { d.scene_items.splice(index + 1, 0, { ...structuredClone(it), uid: uid(), name: it.name + ' Copy' }) })
  useEditor.getState().select({ kind: 'item', index: index + 1 })
  log('Duplicated ' + it.name + ' at the same transform; move it with the gizmo.')
}

export function removeItem(index: number) {
  const it = currentProject()?.scene_items[index]
  if (!it) return
  update('Remove ' + it.name, (d) => { d.scene_items.splice(index, 1) })
  const n = currentProject()!.scene_items.length
  useEditor.getState().select(n ? { kind: 'item', index: Math.min(index, n - 1) } : null)
}

export function moveItem(index: number, to: number) {
  const p = currentProject()
  if (!p || to < 0 || to >= p.scene_items.length || to === index) return
  update('Reorder objects', (d) => { const [x] = d.scene_items.splice(index, 1); d.scene_items.splice(to, 0, x) })
  useEditor.getState().select({ kind: 'item', index: to })
}

export async function groundItem(index: number) {
  const p = currentProject()
  const it = p?.scene_items[index]
  if (!p || !it) return
  const model = await loadModel(p, it.path)
  const y = groundOffset(model, it)
  update('Ground ' + it.name, (d) => { d.scene_items[index].position[1] = y })
  log(`Grounded ${it.name} to Y=0 (not a terrain raycast)`)
}

export async function setPivot(index: number, mode: 'center' | 'bottom' | 'reset' | Vec3) {
  const p = currentProject()
  const it = p?.scene_items[index]
  if (!p || !it) return
  const pivot: Vec3 = Array.isArray(mode) ? mode : mode === 'reset' ? [0, 0, 0] : meshPivot(await loadModel(p, it.path), mode === 'bottom')
  const next = withPivot(it, pivot)
  update('Set pivot', (d) => { d.scene_items[index].pivot = next.pivot; d.scene_items[index].position = next.position })
  log(`${it.name}: pivot ${pivot.map((v) => +v.toFixed(4)).join(', ')}. Mesh stayed in place.`)
}

export function resetGlassSize(index: number) {
  const p = currentProject()
  const it = p?.scene_items[index]
  if (!p || !it || !isGlass(it) || isCustomNative(it)) return
  update('Reset glass size', (d) => { d.scene_items[index].scale = 1 / p.settings.world_scale })
  log('Native glass restored to its fixed physical size.')
}

const others = (index: number) => currentProject()!.scene_items.filter((x, j) => j !== index && isGlass(x))

export async function applyNativeProp(index: number, behavior: 'movable' | 'explosive') {
  const p = currentProject()
  if (!p || index <= 0 || index >= p.scene_items.length) throw new UserError('Select a separate imported prop, not the base map.')
  await py.syncProject(p)
  const item = await py.sceneOp<SceneItem>('native_prop', { item: p.scene_items[index], behavior, world_scale: p.settings.world_scale, others: others(index) })
  update('Make ' + behavior, (d) => { d.scene_items[index] = { ...item, uid: p.scene_items[index].uid, native_profile: undefined } })
  log(`Applied ${catalogs.prop_presets[behavior].label} to ${item.native_prop_original_name}. Re-export the map; first gameplay test pending.`)
}

export async function convertBreakable(index: number, mode: 'glass' | 'wood') {
  const p = currentProject()
  if (!p || index <= 0 || index >= p.scene_items.length) throw new UserError('Choose a crate or other imported object, not your base map.')
  const old = p.scene_items[index]
  if (isGlass(old) && !isCustomNative(old)) throw new UserError('Choose an imported crate or custom-mesh breakable.')
  await py.syncProject(p)
  const item = await py.sceneOp<SceneItem>('convert_breakable', { item: old, render_mode: mode, world_scale: p.settings.world_scale, others: others(index) })
  update('Make breakable ' + mode, (d) => { d.scene_items[index] = { ...item, uid: old.uid, native_profile: undefined } })
  log('Experimental native custom-mesh breakable: ' + item.name + '; fitted Havok collision experiment enabled.')
}

export async function returnStatic(index: number) {
  const p = currentProject()
  const it = p?.scene_items[index]
  if (!p || !it || index <= 0 || !isGlass(it)) return
  const item = await py.sceneOp<SceneItem>('return_static', { item: it })
  update('Return to static', (d) => { d.scene_items[index] = { ...item, uid: it.uid } })
  log('Returned selected prop to normal static map geometry; re-export to apply.')
}

export function makeOpaque(index: number) {
  update('Make opaque', (d) => {
    const it = d.scene_items[index]
    if (!it || !isCustomNative(it)) return
    it.native_use_alpha = false; it.native_opacity = 100; it.glass_style = 'blue'
  })
}

export function setOpacity(index: number, value: number) {
  const it = currentProject()?.scene_items[index]
  if (!it || !isCustomNative(it) || it.native_breakable_kind === 'wood' || isProp(it)) return
  update('Opacity', (d) => { d.scene_items[index].native_opacity = value; d.scene_items[index].native_use_alpha = value < 100 }, { merge: 'opacity' + index })
}

export async function checkBreakables(): Promise<string> {
  const p = currentProject()
  if (!p) return ''
  await py.syncProject(p)
  const r = await py.sceneOp<{ text: string }>('check_breakables', { items: p.scene_items, world_scale: p.settings.world_scale })
  log(r.text)
  return r.text
}

export async function sceneAudit(): Promise<string> {
  const p = currentProject()
  if (!p?.scene_items.length) throw new UserError('Import models first.')
  await py.syncProject(p)
  const lines = await py.sceneOp<string[]>('audit', { items: p.scene_items })
  return lines.join('\n')
}

/** surface: also set the material's physical surface (texture studio presets know theirs). */
export async function assignTexture(index: number, mat: string, file: File, surface?: number) {
  const s = await importImage(file)
  update('Assign texture', (d) => {
    d.files[s.vpath] = s.ref
    const it = d.scene_items[index]
    if (isCustomNative(it)) it.glass_custom_texture = s.vpath
    else {
      it.textures[mat] = s.vpath
      if (surface !== undefined && !isGlass(it)) (it.surface_ids ||= {})[mat] = surface
    }
  })
  if (s.note) log(s.note)
  log(`${mat} -> ${file.name}`)
}

export async function setProjectFile(key: 'sky_texture' | 'minimap_texture' | 'bbcity_donor' | 'cts_template' | 'loading_image', file: File | null) {
  if (!file) { update('Clear ' + key, (d) => { d.settings[key] = '' }); return }
  const s = key === 'bbcity_donor' || key === 'cts_template'
    ? await import('../lib/files').then((f) => f.storeFile(file, file.name, 'game'))
    : key === 'loading_image'
      ? await Promise.all([import('../lib/files'), import('../lib/mapFeatures')]).then(async ([f, m]) => { const pic = await m.loadingPicture(file); return f.storeFile(pic, pic.name) })
      : await importImage(file, key === 'minimap_texture' ? 1024 : 2048)
  const note = (s as { note?: string }).note
  if (note) log(note)
  update('Set ' + key, (d) => { d.files[s.vpath] = s.ref; d.settings[key] = s.vpath })
}

// ---------------- markers & lights ----------------

export function addMarker(type: string, position: Vec3, patch: Partial<Marker> = {}) {
  update('Add marker', (d) => {
    const m = { ...newMarker(type, position), ...patch }
    if (m.type === 'Weapon pickup') m.label = m.weapon
    if (m.type === 'Vehicle spawn') m.label = m.vehicle
    d.markers.push(m)
  })
  useEditor.getState().select({ kind: 'marker', index: currentProject()!.markers.length - 1 })
}

export function removeSelected() {
  const { selection } = useEditor.getState()
  if (selection) removeTarget(selection)
}

/** Deletes every marker of the given types, as one undo step (unused game-mode markers). */
export function removeMarkersOfType(types: string[]) {
  const n = currentProject()?.markers.filter((m) => types.includes(m.type)).length ?? 0
  if (!n) return 0
  update(`Remove ${n} unused marker${n === 1 ? '' : 's'}`, (d) => { d.markers = d.markers.filter((m) => !types.includes(m.type)) })
  const sel = useEditor.getState().selection
  if (sel?.kind === 'marker') useEditor.getState().select(null)
  log(`Removed ${n} marker${n === 1 ? '' : 's'} that no selected game mode uses (Undo brings ${n === 1 ? 'it' : 'them'} back).`)
  return n
}

/** Deletes one object, marker or light (the Eraser tool and the Delete key). */
export function removeTarget(selection: { kind: 'item' | 'marker' | 'light'; index: number }) {
  if (selection.kind === 'item') return removeItem(selection.index)
  const key = selection.kind === 'marker' ? 'markers' : 'lights'
  update('Remove ' + selection.kind, (d) => { d[key].splice(selection.index, 1) })
  const n = currentProject()![key].length
  useEditor.getState().select(n ? { kind: selection.kind, index: Math.min(selection.index, n - 1) } : null)
}

export function addLight(position: Vec3) {
  const p = currentProject()
  if (!p) return
  if (p.lights.length >= catalogs.limits.max_lights) throw new UserError(`Use at most ${catalogs.limits.max_lights} point lights per map.`)
  update('Add light', (d) => { d.lights.push(newLight(position)) })
  useEditor.getState().select({ kind: 'light', index: currentProject()!.lights.length - 1 })
}

/** Vertical ray onto the scene surface (desktop "Snap selected to surface"). */
export function snapPoint(raycastDown: (x: number, y: number, z: number) => number | null, pos: Vec3): Vec3 | null {
  const y = raycastDown(pos[0], pos[1], pos[2])
  return y === null ? null : [pos[0], y + 0.12, pos[2]]
}

// ---------------- block-out shapes ----------------

async function defaultShapeTextures(): Promise<{ files: Record<string, FileRef>; top: string; side: string }> {
  const { generate, defaultParams } = await import('../lib/procedural')
  const { pixelsToPng } = await import('../lib/images')
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

/** Drop file records nothing refers to any more (e.g. a shape's previous OBJ). */
function pruneFiles(d: Project) {
  const live = new Set(referencedPaths(d))
  for (const path of Object.keys(d.files)) if (!live.has(path)) delete d.files[path]
}

/** Adds a block-out shape at the camera target, resting on the surface below if there is one. */
export async function addShape(presetKey: string, at: Vec3, groundY: number | null, o: { rot?: number; size?: Vec3 } = {}) {
  const preset = SHAPE_PRESETS[presetKey]
  if (!preset) return
  const shape = structuredClone(preset.shape)
  if (o.size) shape.size = o.size.map((v) => Math.max(0.1, Math.min(400, +v || 1))) as Vec3
  const stored = await storeShape(shape)
  const tex = await defaultShapeTextures()
  const item: SceneItem = {
    uid: uid(), name: shapeName(preset.label, shape), path: stored.vpath, source_path: stored.vpath, shape,
    position: [at[0], groundY ?? 0, at[2]], rotation: [0, o.rot ?? 0, 0], scale: 1,
    textures: { top: tex.top, side: tex.side }, alpha: { top: false, side: false }, surface_ids: { top: 0, side: 0 }, physics_intent: 'Static',
  }
  update('Add ' + preset.label.toLowerCase(), (d) => {
    Object.assign(d.files, tex.files, { [stored.vpath]: stored.ref })
    d.scene_items.push(item)
  })
  useEditor.getState().select({ kind: 'item', index: currentProject()!.scene_items.length - 1 })
  log(`Added ${preset.label.toLowerCase()} (${shape.size.join(' × ')}). Change its textures in Materials → Create….`)
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
    if (label) x.name = shapeName(label, shape)
    d.files[stored.vpath] = stored.ref
    pruneFiles(d as Project)
  }, { merge: 'shape' + index })
}

/** Builds a prefab as one scene object at a spot, turned by rot. */
async function prefabItem(key: string, params: Record<string, number | string>, at: Vec3, rot: number) {
  const def = ALL_PREFABS[key]
  const { materialize } = await import('../lib/samples')
  const { prefabParams, tagPrefab } = await import('../lib/prefabs')
  const p = prefabParams(def, params)
  const { items, files } = await materialize(tagPrefab(def.make(at[0], at[2], rot, at[1], p), key, p, at, rot))
  return { item: { ...items[0], name: def.label }, files }
}

/**
 * Stamps a prefab (a building, car, tree, bus stop...) where the user clicked.
 * With `wall` (the clicked surface's outward direction), one that can go on a
 * wall (a sign, a photo frame) is stuck flat on it, centred on the click.
 */
export async function addPrefab(key: string, at: Vec3, groundY: number | null, o: { rot?: number; params?: Record<string, number | string>; wall?: Vec3 } = {}) {
  const def = ALL_PREFABS[key]
  if (!def) return
  if ((def as { physicsSet?: boolean }).physicsSet) return (await import('./physicsActions')).addPhysicsSet(key, at, groundY, o.rot ?? 0)
  let params = o.params ?? {}, base: Vec3 = [at[0], groundY ?? 0, at[2]], rot = o.rot ?? 0
  const n = o.wall
  if (def.onWall && n && Math.abs(n[1]) < 0.6) {
    const { prefabParams } = await import('../lib/prefabs')
    params = { ...prefabParams(def, params), ...def.onWall }
    const top = Math.max(...def.make(0, 0, 0, 0, params).map((p) => p.at[1] + p.size[1]))
    const len = Math.hypot(n[0], n[2]) || 1
    rot = +((Math.atan2(n[0] / len, n[2] / len) * 180) / Math.PI).toFixed(2)
    base = [at[0] + (n[0] / len) * 0.03, at[1] - top / 2, at[2] + (n[2] / len) * 0.03]
  }
  const { item, files } = await prefabItem(key, params, base, rot)
  update('Add ' + def.label.toLowerCase(), (d) => {
    Object.assign(d.files, files)
    d.scene_items.push(item)
  })
  useEditor.getState().select({ kind: 'item', index: currentProject()!.scene_items.length - 1 })
  log(`Added ${def.label.toLowerCase()}. Change its settings, turn it or repaint it in its panel.`)
}

/** Rebuilds a placed prefab with new settings, in place; repaints the user made are kept where the same part still exists. */
export async function updatePrefab(index: number, params: Record<string, number | string>) {
  const it = currentProject()?.scene_items[index]
  const pf = it?.prefab
  if (!it || !pf || !ALL_PREFABS[pf.key]) return
  const { item, files } = await prefabItem(pf.key, params, it.position, it.rotation[1])
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
  }, { merge: 'prefab-' + index })
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
  const { cropPhoto } = await import('../lib/photoPiece')
  const stored = await storeFile(await cropPhoto(file, aspect), 'photo.jpg')
  update('Choose photo', (d) => {
    d.files[stored.vpath] = stored.ref
    const x = d.scene_items[index]
    x.textures[mat] = stored.vpath; x.alpha[mat] = false
    pruneFiles(d)
  })
}

// ---- Several objects at once: duplicate, delete, copy and paste, group ----

const CLIPBOARD_KEY = 'sr1ms.clipboard'

/** Selected objects as a portable bundle: positions relative to their bottom centre, plus the file records they use. */
export interface ItemBundle { items: SceneItem[]; files: Record<string, FileRef> }

export function bundleItems(indices: number[]): ItemBundle | null {
  const p = currentProject()
  const items = indices.map((i) => p?.scene_items[i]).filter((x): x is SceneItem => !!x)
  if (!p || !items.length) return null
  const lo = (k: 0 | 1 | 2) => Math.min(...items.map((it) => it.position[k]))
  const hi = (k: 0 | 1 | 2) => Math.max(...items.map((it) => it.position[k]))
  const o: Vec3 = [(lo(0) + hi(0)) / 2, lo(1), (lo(2) + hi(2)) / 2]
  const rel = items.map((it) => ({ ...structuredClone(it), position: [it.position[0] - o[0], it.position[1] - o[1], it.position[2] - o[2]] as Vec3 }))
  const used = new Set(referencedPaths({ ...p, scene_items: rel, asset_library: [] } as Project))
  const files = Object.fromEntries(Object.entries(p.files).filter(([k]) => used.has(k)))
  return { items: rel, files }
}

/** Puts a bundle into the map with its bottom centre at `at`, turned by `rot` degrees; returns the new indices. Groups get fresh ids. */
export function placeBundle(b: ItemBundle, at: Vec3, label: string, rot = 0): number[] {
  const p = currentProject()
  if (!p) return []
  const glass = b.items.filter(isGlass).length
  if (glass && p.scene_items.filter(isGlass).length + glass > catalogs.limits.max_native_objects) throw new UserError(`This build supports up to ${catalogs.limits.max_native_objects} native objects.`)
  const regroup = new Map<string, string>()
  const start = p.scene_items.length
  update(label, (d) => {
    Object.assign(d.files, b.files)
    for (const it of b.items) {
      const group = it.group && (regroup.get(it.group) ?? regroup.set(it.group, 'g-' + uid()).get(it.group))
      // Turned about the bundle's middle the same way the editor turns objects (x' = x cos + z sin, z' = -x sin + z cos).
      const t = (rot * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t)
      const [x, y, z] = it.position
      const rotation: Vec3 = [it.rotation[0], (((it.rotation[1] + rot) % 360) + 360) % 360, it.rotation[2]]
      d.scene_items.push({ ...structuredClone(it), uid: uid(), group, rotation, position: [x * c + z * sn + at[0], y + at[1], -x * sn + z * c + at[2]] })
    }
  })
  const added = b.items.map((_, i) => start + i)
  useEditor.getState().selectItems(added)
  return added
}

const bundleOrigin = (indices: number[]): Vec3 => {
  const items = indices.map((i) => currentProject()!.scene_items[i])
  const xs = items.map((it) => it.position[0]), zs = items.map((it) => it.position[2])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...items.map((it) => it.position[1])), (Math.min(...zs) + Math.max(...zs)) / 2]
}

export function duplicateItems(indices: number[]) {
  if (indices.length === 1 && !currentProject()?.scene_items[indices[0]]?.group) return duplicateItem(indices[0])
  const b = bundleItems(indices)
  if (!b) return
  const o = bundleOrigin(indices)
  placeBundle(b, [o[0] + 4, o[1], o[2] + 4], `Duplicate ${b.items.length} objects`)
  log(`Duplicated ${b.items.length} objects, shifted a little so you can see them.`)
}

export function removeItems(indices: number[]) {
  const p = currentProject()
  if (!p || !indices.length) return
  if (indices.length === 1) return removeItem(indices[0])
  const drop = new Set(indices)
  update(`Remove ${drop.size} objects`, (d) => { d.scene_items = d.scene_items.filter((_, i) => !drop.has(i)) })
  useEditor.getState().select(null)
}

export function copyItems(indices: number[]): number {
  const b = bundleItems(indices)
  if (!b) return 0
  try { localStorage.setItem(CLIPBOARD_KEY, JSON.stringify({ ...b, origin: bundleOrigin(indices), pastes: 0 })) } catch { throw new UserError('This browser would not keep the copy (storage is full or blocked).') }
  return b.items.length
}

export function hasClipboard() {
  try { return !!localStorage.getItem(CLIPBOARD_KEY) } catch { return false }
}

/** Pastes next to where the objects were copied from, stepping a little further each time. */
export function pasteItems(): number {
  let c: (ItemBundle & { origin: Vec3; pastes: number }) | null = null
  try { c = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) || 'null') } catch { /* nothing usable */ }
  if (!c?.items?.length) return 0
  c.pastes = (c.pastes || 0) + 1
  try { localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(c)) } catch { /* the next paste just lands in the same spot */ }
  const step = 4 * c.pastes
  placeBundle(c, [c.origin[0] + step, c.origin[1], c.origin[2] + step], `Paste ${c.items.length} objects`)
  return c.items.length
}

/** Turns several objects together about their shared centre. */
export function turnItems(indices: number[], deg: number) {
  const p = currentProject()
  if (!p || !indices.length) return
  const [cx, , cz] = bundleOrigin(indices)
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
  update('Turn objects', (d) => {
    for (const i of indices) {
      const it = d.scene_items[i]
      if (!it) continue
      // Same sense as the gizmo: +deg is a turn about +Y.
      const x = it.position[0] - cx, z = it.position[2] - cz
      it.position = [+(cx + x * c + z * s).toFixed(4), it.position[1], +(cz - x * s + z * c).toFixed(4)]
      it.rotation = [it.rotation[0], ((it.rotation[1] + deg) % 360 + 360) % 360, it.rotation[2]]
    }
  })
}

export function groupItems(indices: number[]) {
  if (indices.length < 2) throw new UserError('Pick two or more objects to group (Shift+click to add).')
  const id = 'g-' + uid()
  update(`Group ${indices.length} objects`, (d) => { for (const i of indices) if (d.scene_items[i]) d.scene_items[i].group = id })
  useEditor.getState().selectItems(indices)
  log(`Grouped ${indices.length} objects: clicking any of them now picks the whole group.`)
}

export function ungroupItems(indices: number[]) {
  const p = currentProject()
  if (!p || !indices.some((i) => p.scene_items[i]?.group)) return
  update('Ungroup', (d) => { for (const i of indices) if (d.scene_items[i]) delete d.scene_items[i].group })
  useEditor.getState().selectItems(indices)
}
