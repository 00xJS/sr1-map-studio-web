// Project backups (.sr1map.zip) and importing desktop SR1 Map Studio
// projects (.sr1map.json), whose files are referenced by Windows paths.
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import { db, sha256 } from './db'
import { storeFile } from './files'
import { importModels } from './importers'
import { cacheModel } from './assets'
import { gameObjectPaths } from './gameObjects/policy'
import {
  defaultSettings, maxMapName, newProject, normalizeProject, referencedPaths, uid,
  type Light, type Marker, type Project, type SceneItem, type Asset, type FileRef,
} from './project'

export async function exportProjectZip(project: Project, thumbnail?: Blob): Promise<Blob> {
  const entries: Record<string, Uint8Array> = { 'project.json': strToU8(JSON.stringify(project, null, 1)) }
  // Objects from the player's game travel as where they came from, never as files (see gameObjects/policy.ts).
  const fromGame = gameObjectPaths(project)
  for (const path of referencedPaths(project)) {
    const ref = project.files[path]
    if (!ref || fromGame.has(path)) continue
    const blob = await db.getBlob(ref.hash)
    if (blob) entries[`files/${ref.hash}`] = new Uint8Array(await blob.arrayBuffer())
  }
  if (thumbnail) entries['thumbnail.webp'] = new Uint8Array(await thumbnail.arrayBuffer())
  return new Blob([zipSync(entries, { level: 6 })], { type: 'application/zip' })
}

export async function importProjectZip(file: File): Promise<string> {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()))
  if (!zip['project.json']) throw new Error('This zip is not an SR1 Map Studio project backup.')
  const project = normalizeProject(JSON.parse(strFromU8(zip['project.json'])))
  for (const [name, data] of Object.entries(zip)) {
    if (!name.startsWith('files/')) continue
    const blob = new Blob([data])
    const hash = await sha256(blob)
    if (hash === name.slice(6)) await db.putBlob(hash, blob)
  }
  if (await db.getProject(project.id)) project.id = uid()
  const thumb = zip['thumbnail.webp'] ? new Blob([zip['thumbnail.webp']], { type: 'image/webp' }) : undefined
  await db.putProject({ id: project.id, name: project.name, updated_at: new Date().toISOString(), project, thumbnail: thumb })
  return project.id
}

// ---------------- desktop projects ----------------

const winBase = (p: unknown) => (typeof p === 'string' ? p.replace(/\\/g, '/').split('/').pop()!.toLowerCase() : '')
const GLASS = 'sr1_native_glass_3x3'
const CUSTOM = 'sr1_native_custom_mesh_glass_experiment'

export interface DesktopImportReport { projectId: string; missing: string[]; notes: string[] }

/** files: the .sr1map.json plus the models/textures it uses (any folder layout). */
export async function importDesktopProject(files: File[]): Promise<DesktopImportReport> {
  const json = files.find((f) => /\.json$/i.test(f.name))
  if (!json) throw new Error('Select the .sr1map.json project file together with its models and textures.')
  const d = JSON.parse(await json.text())
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]))
  const missing = new Set<string>()
  const notes: string[] = []
  const project = newProject(json.name.replace(/\.sr1map\.json$|\.json$/i, ''))
  const fileRefs: Record<string, FileRef> = {}
  const stored = new Map<string, string>() // basename -> vpath

  const fileFor = async (p: unknown): Promise<string> => {
    const b = winBase(p)
    if (!b) return ''
    if (stored.has(b)) return stored.get(b)!
    const f = byName.get(b)
    if (!f) { missing.add(String(p)); return '' }
    const s = await storeFile(f, f.name)
    fileRefs[s.vpath] = s.ref
    stored.set(b, s.vpath)
    return s.vpath
  }
  const modelFor = async (it: any): Promise<string> => {
    // Prefer the baked OBJ; fall back to converting the original GLB/FBX.
    for (const candidate of [it.path, it.source_path, it.original_import_path]) {
      const b = winBase(candidate)
      if (!b || !byName.has(b)) continue
      if (/\.obj$/i.test(b)) return fileFor(candidate)
      const [m] = await importModels([byName.get(b)!])
      Object.assign(fileRefs, m.files)
      cacheModel(m.objPath, m.model)
      return m.objPath
    }
    missing.add(String(it.original_import_path || it.path))
    return ''
  }
  const restoreGlass = (it: any) => {
    const style = it.glass_style || 'tinted'
    it.path = it.source_path = '/studio/native_glass/pane.obj'
    it.textures = { glass_preview: it.glass_custom_texture || `/studio/native_glass/${style}.png` }
    it.alpha = { glass_preview: it.glass_custom_texture ? true : style === 'tinted' }
    it.physics_intent = 'Native breakable glass'
  }

  const prefixed = (map: Record<string, unknown> | undefined, i: number) => {
    const out: Record<string, unknown> = {}
    const pre = 'obj' + String(i).padStart(3, '0') + '_'
    for (const [k, v] of Object.entries(map || {})) if (k.startsWith(pre)) out[k.slice(pre.length)] = v
    return out
  }

  const items: SceneItem[] = []
  for (const [i, raw] of (d.scene_items || []).entries()) {
    const it: any = { ...raw, uid: uid() }
    if (it.native_prefab === GLASS) {
      if (it.glass_custom_texture) it.glass_custom_texture = await fileFor(it.glass_custom_texture)
      restoreGlass(it)
    } else {
      const model = await modelFor(it)
      if (!model) { notes.push(`Skipped ${it.name || 'object ' + i}: its model file was not selected.`); continue }
      it.path = it.source_path = model
      if (it.native_prefab === CUSTOM) it.native_mesh_obj = model
      if (it.glass_custom_texture) it.glass_custom_texture = await fileFor(it.glass_custom_texture)
      const textures = { ...(it.textures || {}), ...prefixed(d.textures, i) }
      it.textures = {}
      for (const [mat, p] of Object.entries(textures)) it.textures[mat] = p ? await fileFor(p) : ''
      it.alpha = { ...(it.alpha || {}), ...prefixed(d.use_alpha, i) }
      it.surface_ids = { ...(it.surface_ids || {}), ...prefixed(d.surface_ids, i) }
    }
    delete it.original_import_path
    delete it.asset_ref
    it.position ??= [0, 0, 0]; it.rotation ??= [0, 0, 0]; it.scale ??= 1
    items.push(it)
  }
  const library: Asset[] = []
  for (const raw of d.asset_library || []) {
    const a: any = { ...raw, uid: uid() }
    if (a.native_prefab === GLASS) { restoreGlass(a); library.push(a); continue }
    const model = await modelFor(a)
    if (!model) continue
    a.path = a.source_path = model
    const tex: Record<string, string> = {}
    for (const [mat, p] of Object.entries(a.textures || {})) { const v = await fileFor(p); if (v) tex[mat] = v }
    a.textures = tex
    delete a.original_import_path
    library.push(a)
  }

  const s = defaultSettings()
  s.base_name = d.base_name || s.base_name
  s.display_name = d.base_name || s.display_name
  for (const k of ['world_scale', 'mirror_x', 'flip_obj_v', 'double_sided', 'sky_scale', 'marker_game_coords'] as const) {
    if (d[k] !== undefined) (s as any)[k] = d[k]
  }
  s.sky_texture = await fileFor(d.sky_texture)
  s.minimap_texture = await fileFor(d.minimap_texture)
  s.bbcity_donor = await fileFor(d.bbcity_donor)
  const cts = winBase(d.cts_template)
  s.cts_template = cts && ['amb_downtown.cts', 'mp_ptp_01.cts', 'pb_sr_city.cts', 'shore_sr_city.cts', 'sspawn_sr_city.cts'].includes(cts) && !byName.has(cts)
    ? '/studio/cts_examples/' + cts : await fileFor(d.cts_template)
  const sky = winBase(d.native_sky_chunk)
  if (sky.startsWith('sr_alwayshwyf01')) s.native_sky = 'sr_alwayshwyf01'
  else if (sky.startsWith('sr_custom000001')) s.native_sky = 'sr_custom000001'
  // v1.15 saves its "Register surface impacts early" checkbox; older projects have none (off here).
  if (d.surface_preload === true) {
    s.surface_preload = true
    if (s.base_name.length > maxMapName(s)) notes.push(`Early surface registration needs a map file name of ${maxMapName(s)} characters or fewer: shorten "${s.base_name}" in the Export tab.`)
  }

  project.settings = s
  project.scene_items = items
  project.asset_library = library
  project.markers = (d.markers || []).map((m: Marker) => ({ ...m, uid: uid() }))
  project.lights = (d.lights || []).map((l: Light) => ({ ...l, uid: uid() }))
  project.files = fileRefs
  if (d.breakable_materials?.length || d.breakables_donor || d.working_destructible_map) notes.push('Legacy breakables-audit and destructible slot-test settings are desktop research tools and were not imported.')
  await db.putProject({ id: project.id, name: project.name, updated_at: project.updated_at, project })
  return { projectId: project.id, missing: [...missing], notes }
}
