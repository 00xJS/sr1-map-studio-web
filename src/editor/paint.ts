// Paint bucket and eyedropper: the palette of textures (generated, starter
// library, or already in this map) and applying one to the material under a
// clicked triangle.
import { useEditor, currentProject, mapRun, stillCurrent, type Swatch } from './store'
import * as act from './actions'
import { loadModel, textureUrl } from '../lib/assets'
import { KINDS, PREFAB_ONLY, defaultParams, generate, type TextureKind } from '../lib/procedural'
import { pixelsToPng } from '../lib/images'
import { tagRecipe } from '../lib/recipes'
import { baseName, isCustomNative, isGlass } from '../lib/project'

export interface LibraryEntry { id: string; name: string; surface: number; authors: string[]; source: string }

let library: Promise<LibraryEntry[]> | null = null
export const loadLibrary = () => (library ??= fetch('/textures/index.json').then((r) => {
  if (!r.ok) throw new Error('The starter library could not be loaded.')
  return r.json()
}).then((d) => d.textures as LibraryEntry[]))

// A text sign's words are typed in the Texture Studio or on a Sign prefab, so the bucket leaves it out.
export const generatedSwatches = (): Swatch[] => (Object.keys(KINDS) as TextureKind[]).filter((k) => !PREFAB_ONLY.has(k) && k !== 'lettering').map((kind) => ({
  key: 'gen:' + kind, label: KINDS[kind].label, surface: KINDS[kind].surface,
  source: { kind: 'generated', params: defaultParams(kind, 1024) },
}))

export const librarySwatches = async (): Promise<Swatch[]> => (await loadLibrary()).map((t) => ({
  key: 'lib:' + t.id, label: t.name, surface: t.surface, source: { kind: 'library', id: t.id },
}))

/** "red_brick_1024.png" -> "red brick" */
export const niceName = (vpath: string) => baseName(vpath).replace(/\.\w+$/, '').replace(/(_\d+)+$/, '').replace(/_/g, ' ')

/** Textures already used by objects in the map. */
export function mapSwatches(): Swatch[] {
  const p = currentProject()
  if (!p) return []
  const seen = new Map<string, Swatch>()
  for (const it of p.scene_items) {
    if (isGlass(it) && !isCustomNative(it)) continue
    for (const [mat, vpath] of Object.entries(it.textures || {})) {
      if (!vpath || seen.has(vpath)) continue
      seen.set(vpath, { key: 'file:' + vpath, label: niceName(vpath), surface: it.surface_ids?.[mat] ?? 0, source: { kind: 'file', vpath } })
    }
  }
  return [...seen.values()]
}

const thumbs = new Map<string, Promise<string | null>>()
/** Small preview image URL for a swatch. */
export function swatchThumb(s: Swatch): Promise<string | null> {
  let t = thumbs.get(s.key)
  if (!t) {
    t = (async () => {
      if (s.source.kind === 'library') return `/textures/thumbs/${s.source.id}.jpg`
      if (s.source.kind === 'file') return textureUrl(currentProject(), s.source.vpath)
      const file = await pixelsToPng(generate({ ...s.source.params, size: 64 }), 64, 'thumb.png')
      return URL.createObjectURL(file)
    })().catch(() => null)
    thumbs.set(s.key, t)
  }
  return t
}

const files = new Map<string, Promise<File>>()
function swatchFile(s: Exclude<Swatch['source'], { kind: 'file' }>, key: string): Promise<File> {
  let f = files.get(key)
  if (!f) {
    f = s.kind === 'library'
      ? fetch(`/textures/${s.id}.jpg`).then((r) => r.blob()).then((b) => tagRecipe(new File([b], `${s.id}.jpg`, { type: 'image/jpeg' }), { kind: 'library', id: s.id }))
      : pixelsToPng(generate(s.params), s.params.size, `${s.params.kind}_${s.params.seed}_${s.params.size}.png`).then((file) => tagRecipe(file, { kind: 'generated', params: s.params }))
    f.catch(() => files.delete(key))
    files.set(key, f)
  }
  return f
}

async function materialAt(index: number, face: number): Promise<string | null> {
  const p = currentProject()
  const it = p?.scene_items[index]
  if (!p || !it || face < 0) return null
  const model = await loadModel(p, it.path)
  const m = model.mats[model.faceMat[face]]
  return m === undefined ? null : m || 'default'
}

/** Paint bucket: put the swatch on the material of the clicked triangle. */
export async function paintAt(index: number, face: number, swatch: Swatch) {
  const it = currentProject()?.scene_items[index]
  if (!it) return
  if (isGlass(it) && !isCustomNative(it)) throw new Error('Glass panes keep their glass look. Paint the objects around them.')
  const mat = await materialAt(index, face)
  if (mat) await paintMaterial(index, mat, swatch)
}

/** Put the swatch on one material of an object. */
export async function paintMaterial(index: number, mat: string, swatch: Swatch) {
  if (swatch.source.kind === 'file') {
    const vpath = swatch.source.vpath
    useEditor.getState().update('Paint', (d) => {
      const x = d.scene_items[index]
      if (isCustomNative(x)) x.glass_custom_texture = vpath
      else { x.textures[mat] = vpath; (x.surface_ids ||= {})[mat] = swatch.surface }
    })
    return
  }
  const run = mapRun()
  const file = await swatchFile(swatch.source, swatch.key)
  // Not on a map opened while it loaded (an AI reply mid-way when the map changed, too).
  stillCurrent(run)
  await act.assignTexture(index, mat, file, swatch.surface, run)
}

/** Eyedropper: the texture on the clicked triangle becomes the paint bucket's swatch. */
export async function pickAt(index: number, face: number): Promise<Swatch | null> {
  const it = currentProject()?.scene_items[index]
  const mat = it && (await materialAt(index, face))
  if (!it || !mat) return null
  const vpath = isCustomNative(it) ? it.glass_custom_texture : it.textures?.[mat]
  if (!vpath) return null
  return { key: 'file:' + vpath, label: niceName(vpath), surface: it.surface_ids?.[mat] ?? 0, source: { kind: 'file', vpath } }
}
