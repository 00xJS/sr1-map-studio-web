// Opening a finished map folder as a project: its pieces (read.ts, in a worker) become scene objects with their
// pictures, its CTS files become markers, its lights and name, modes and weather come along. Every file made from
// it is stored as a file from the game (origin 'game'): a map from the player's install or from someone else
// can be edited and exported for the player's own game, never shared, published or synced.
import { storeFile } from '../files'
import { parseObj } from '../geometry'
import { newLight, newProject, type FileRef, type Light, type Project, type SceneItem, type Vec3 } from '../project'
import { objText, plain, rgbaPng, safe, stemOf, surfaceOf } from '../gameObjects/place'
import type { ObjectMesh } from '../gameObjects/extract'
import { fileAt } from './files'
import { ctsMarkers, toEditor, type Frame } from './cts'
import { MAX_BASE, baseNameFor, type MapInfo } from './info'
import type { MapScene, SceneTexture } from './read'
import type { MapPiece } from './scene'

export { readMapInfo, type MapInfo } from './info'

/** Largest picture side kept (the exporter packs them again). */
const TEX = 1024

// ---------------- the worker ----------------

/** The map's pieces and pictures, read off the page's thread; pictures kept up to `texSize` on a side. */
export function sceneInWorker(info: MapInfo, texSize = TEX): Promise<MapScene> {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  const pegs = [info.peg, ...[...info.src.files].filter(([p]) => /\.peg_xbox2$/i.test(p) && !/^levels\/ld-/i.test(p) && info.src.files.get(p) !== info.peg).map(([, f]) => f)].filter((x): x is Blob => !!x)
  const loading = fileAt(info.src, `levels/ld-${info.stem}.peg_xbox2`) ?? null
  return new Promise<MapScene>((ok, no) => {
    w.onmessage = (e) => { w.terminate(); e.data.ok ? ok(e.data.value) : no(new Error(e.data.error)) }
    w.onerror = (e) => { w.terminate(); no(new Error(e.message || 'The map could not be read.')) }
    w.postMessage({ id: 1, chunk: info.chunk, pegs, loading, texSize })
  })
}

// ---------------- the project ----------------

export interface OpenReport {
  pieces: number
  triangles: number
  doubleSided: number
  props: number
  missingTextures: string[]
  markers: number
  lights: number
  notes: string[]
}

/** The OBJ face numbers of the look-only triangles: objText writes them grouped by material, in order. */
function lookFaces(piece: Pick<MapPiece, 'mesh' | 'look'>, localMat: (m: number) => number): number[] {
  const order = [...Array(piece.look.length).keys()].sort((a, b) => localMat(piece.mesh.triMaterial[a]) - localMat(piece.mesh.triMaterial[b]) || a - b)
  const out: number[] = []
  order.forEach((t, face) => { if (piece.look[t]) out.push(face) })
  return out
}

async function storeGame(blob: Blob, name: string, files: Record<string, FileRef>): Promise<string> {
  const f = await storeFile(blob, name, 'game')
  f.ref.origin = 'game'
  files[f.vpath] = f.ref
  return f.vpath
}

const png = (t: SceneTexture, name: string) => rgbaPng(t, name)

interface PyLight { name: string; kind: number; color: number[]; position: number[]; near: number; far: number; intensity: number }

/** The map's lights in editor space (read by py/map_upgrade.py); none when Python isn't to hand. */
async function mapLights(info: MapInfo, frame: Frame, notes: string[]): Promise<Light[]> {
  try {
    const { py } = await import('../py')
    const job = '/work/mapopen/' + Date.now().toString(36)
    await py.writeFiles([{ path: `${job}/${info.stem}.bbchunk_xbox2`, data: await info.chunk.arrayBuffer() }])
    const r = await py.call<{ lights: PyLight[] }>('map_tool', 'inspect', JSON.stringify({ chunk: `${job}/${info.stem}.bbchunk_xbox2` }))
    const out: Light[] = []
    let dark = 0, other = 0
    for (const l of r.lights) {
      const c = l.color.map((v) => Math.min(1, Math.max(0, v))) as Vec3
      if (!c.some((v) => v > 0.001)) { dark++; continue }
      if (l.kind !== 0x390) other++
      const range = Math.min(1000, Math.max(0.05, l.far / frame.ws))
      out.push({ ...newLight(toEditor(frame, l.position as Vec3)), name: l.name || 'Light', color: c, intensity: Math.min(10, Math.max(0, l.intensity)), range, inner_range: Math.min(Math.max(0, l.near / frame.ws), range * 0.9) })
    }
    if (out.length > 64) { notes.push(`The map has ${out.length} lights; the editor keeps the first 64.`); out.length = 64 }
    if (other) notes.push(`${other} of its lights are spot or other kinds; they came in as point lights.`)
    if (dark) notes.push(`${dark} light${dark === 1 ? '' : 's'} with no colour left out.`)
    return out
  } catch (e) {
    notes.push('Lights were not read: ' + (e as Error).message.split('\n')[0])
    return []
  }
}

/** The map folder as a new project (not yet saved). */
export async function openMapProject(info: MapInfo, onProgress: (t: string) => void = () => {}): Promise<{ project: Project; report: OpenReport }> {
  onProgress(`Reading ${info.identity.displayName}…`)
  const scene = await sceneInWorker(info)
  if (!scene.pieces.length) throw new Error('This map has no geometry the editor can read.')
  const p = newProject(info.identity.displayName)
  const ws = p.settings.world_scale
  const frame: Frame = { origin: scene.origin, ws }
  const notes: string[] = []
  // Each picture once, shared by every piece that uses it.
  onProgress('Saving the map’s pictures on this device…')
  const matName: string[] = [], used = new Set<string>()
  for (const tex of scene.materials) {
    const b = safe(tex ? stemOf(tex) : 'plain')
    let n = b
    for (let i = 2; used.has(n); i++) n = `${b}_${i}`
    used.add(n)
    matName.push(n)
  }
  const texPath: string[] = []
  const missing: string[] = []
  for (const m of new Set(scene.pieces.flatMap((pc) => [...pc.mesh.triMaterial]))) {
    const t = scene.textures[m]
    if (!t && scene.materials[m]) missing.push(scene.materials[m])
    texPath[m] = await storeGame(await png(t ?? plain(), matName[m] + '.png'), matName[m] + '.png', p.files)
  }
  const items: SceneItem[] = []
  const { cacheModel } = await import('../assets')
  for (const [i, pc] of scene.pieces.entries()) {
    if (i % 20 === 0) onProgress(`Saving the map’s objects on this device (${i} of ${scene.pieces.length})…`)
    const own = [...new Set(pc.mesh.triMaterial)].sort((a, b) => a - b)
    const local = new Map(own.map((m, k) => [m, k]))
    const mesh: ObjectMesh = { ...pc.mesh, triMaterial: pc.mesh.triMaterial.map((m) => local.get(m)!), materials: own.map((m) => scene.materials[m]) }
    const text = objText({ mesh, textures: [] }, ws, own.map((m) => matName[m]), pc.name)
    const path = await storeGame(new Blob([text], { type: 'model/obj' }), safe(pc.name) + '.obj', p.files)
    cacheModel(path, parseObj(text))
    const faces = lookFaces(pc, (m) => local.get(m)!)
    items.push({
      uid: crypto.randomUUID(), name: pc.name, path, source_path: path,
      position: toEditor(frame, pc.base), rotation: [0, 0, 0], scale: 1,
      textures: Object.fromEntries(own.map((m) => [matName[m], texPath[m]])),
      alpha: Object.fromEntries(own.map((m) => [matName[m], !!scene.textures[m]?.alpha])),
      surface_ids: Object.fromEntries(own.map((m) => [matName[m], surfaceOf(scene.materials[m])])),
      physics_intent: 'Static', triangles: pc.look.length,
      ...(pc.doubleSided ? { double_sided: true } : {}),
      // What it was in the map it came from (a record name), for the user's reference.
      ...(pc.record ? { source_record: pc.record } : {}),
      ...(faces.length === pc.look.length ? { collision_disabled: true } : faces.length ? { collision_excluded_faces: faces } : {}),
    })
  }
  p.scene_items = items
  // Markers, sound zones and lights, in the same frame.
  const cts = ctsMarkers(info.cts, frame)
  p.markers = cts.markers
  if (cts.skipped.length) notes.push('Left out of the CTS files: ' + cts.skipped.join(', ') + '.')
  onProgress('Reading the map’s lights…')
  p.lights = await mapLights(info, frame, notes)
  // Settings: who the map is.
  const s = p.settings
  const id = info.identity
  s.display_name = id.displayName
  s.base_name = baseNameFor(info.stem)
  if (s.base_name !== info.stem.toLowerCase()) notes.push(`The map's id "${info.stem}" is longer than the exporter allows (${MAX_BASE}); an export makes it "${s.base_name}", a map of its own in the game.`)
  if (id.modes.length) s.modes = id.modes
  if (id.otherModes.length) notes.push('Modes the editor can\'t export: ' + id.otherModes.join(', ') + '.')
  s.always_clear_weather = id.alwaysClearWeather
  p.description = id.description
  if (info.ambience) s.ambience = info.ambience
  if (scene.sky) s.sky_texture = await storeGame(await png(scene.sky, 'sky.png'), safe(info.stem) + '_sky.png', p.files)
  else { const { skyFile } = await import('../samples'); const sky = await skyFile(); p.files[sky.vpath] = sky.ref; s.sky_texture = sky.vpath }
  if (scene.loading) {
    s.loading_image = await storeGame(await png(scene.loading, 'loading.png'), safe(info.stem) + '_loading.png', p.files)
    s.loading_mode = 'custom'
  }
  const props = scene.pieces.filter((x) => x.prop).length
  if (props) notes.push(`${props} movable prop${props === 1 ? '' : 's'} or glass pane${props === 1 ? '' : 's'} came in as fixed objects; make them physics props again in the Physics panel.`)
  if (scene.skipped.skyObjects) notes.push("The game's sky was left out: the export adds it again.")
  if (missing.length) notes.push(`${missing.length} picture${missing.length === 1 ? '' : 's'} not in the map's files came in grey: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}.`)
  return {
    project: p,
    report: {
      pieces: items.length, triangles: scene.triangles.pieces, doubleSided: scene.pieces.filter((x) => x.doubleSided).length, props,
      missingTextures: missing, markers: p.markers.length, lights: p.lights.length, notes,
    },
  }
}
