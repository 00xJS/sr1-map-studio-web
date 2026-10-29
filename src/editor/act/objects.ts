// Objects: importing models, the asset library, glass, per-object edits, breakables, textures and map files.
import { useEditor, currentProject, thingKey, mirrorPaused } from '../store'
import { importModels, importImage, type ImportedModel } from '../../lib/importers'
import { cacheModel, loadModel } from '../../lib/assets'
import { groundOffset, meshPivot, withPivot } from '../../lib/geometry'
import { py } from '../../lib/py'
import { catalogs } from '../../lib/catalogs'
import { isCustomNative, isGlass, isProp, referencedPaths, uid, type Asset, type Project, type SceneItem, type Vec3 } from '../../lib/project'
import { confirmDialog } from '../../ui'
import { addFiles, log, update, UserError } from './core'

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
  // Called inside withoutMirror (the AI), its edit isn't mirrored either.
  const noMirror = mirrorPaused()
  const p = currentProject()
  const it = p?.scene_items[index]
  if (!p || !it || index <= 0 || !isGlass(it)) return
  const item = await py.sceneOp<SceneItem>('return_static', { item: it })
  update('Return to static', (d) => { d.scene_items[index] = { ...item, uid: it.uid } }, { noMirror })
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
  update('Opacity', (d) => { d.scene_items[index].native_opacity = value; d.scene_items[index].native_use_alpha = value < 100 }, { merge: 'opacity' + thingKey('item', index) })
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
  // Called inside withoutMirror (the AI), its edit isn't mirrored either.
  const noMirror = mirrorPaused()
  const s = await importImage(file)
  update('Assign texture', (d) => {
    d.files[s.vpath] = s.ref
    const it = d.scene_items[index]
    if (isCustomNative(it)) it.glass_custom_texture = s.vpath
    else {
      it.textures[mat] = s.vpath
      if (surface !== undefined && !isGlass(it)) (it.surface_ids ||= {})[mat] = surface
    }
  }, { noMirror })
  if (s.note) log(s.note)
  log(`${mat} -> ${file.name}`)
}

/** `fromGame`: the picture shows the player's game (a view of a map with game objects): kept as a game file. */
export async function setProjectFile(key: 'sky_texture' | 'minimap_texture' | 'bbcity_donor' | 'cts_template' | 'loading_image', file: File | null, fromGame = false) {
  if (!file) { update('Clear ' + key, (d) => { d.settings[key] = '' }); return }
  const s = key === 'bbcity_donor' || key === 'cts_template'
    ? await import('../../lib/files').then((f) => f.storeFile(file, file.name, 'game'))
    : key === 'loading_image'
      ? await Promise.all([import('../../lib/files'), import('../../lib/mapFeatures')]).then(async ([f, m]) => {
        const pic = await m.loadingPicture(file)
        const s = await f.storeFile(pic, pic.name, fromGame ? 'game' : 'user')
        if (fromGame) s.ref.origin = 'game'
        return s
      })
      : await importImage(file, key === 'minimap_texture' ? 1024 : 2048)
  const note = (s as { note?: string }).note
  if (note) log(note)
  update('Set ' + key, (d) => { d.files[s.vpath] = s.ref; d.settings[key] = s.vpath })
}
