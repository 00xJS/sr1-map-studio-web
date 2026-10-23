// Showcase maps in the browser: rebuild a map's files from their recipes
// (nothing is downloaded but the site's own starter textures), and give
// older maps the recipes they can prove.
import { storeFile } from './files'
import { generate } from './procedural'
import { pixelsToPng } from './images'
import { compoundObj, shapeObj } from './shapes'
import { libraryIds, recognizeTexture } from './recognize'
import type { FileRecipe } from './recipes'
import type { FileRef, Project } from './project'

export { libraryIds }

async function make(r: FileRecipe, name: string): Promise<Blob> {
  switch (r.kind) {
    case 'library': {
      const res = await fetch(`/textures/${r.id}.jpg`)
      if (!res.ok) throw new Error(`Starter texture ${r.id} could not be loaded.`)
      return res.blob()
    }
    case 'generated': return pixelsToPng(generate(r.params), r.params.size, name)
    case 'shape': return new Blob([shapeObj(r.shape)], { type: 'model/obj' })
    case 'compound': return new Blob([compoundObj(r.pieces)], { type: 'model/obj' })
  }
}

/** Stores every recipe file of the project in this browser and points the map at the new copies. */
export async function rebuildFromRecipes(p: Project, onProgress?: (done: number, total: number) => void): Promise<Project> {
  const entries = Object.entries(p.files).filter(([, ref]) => ref.recipe)
  const moved = new Map<string, string>()
  const files: Record<string, FileRef> = {}
  let done = 0
  for (const [path, ref] of entries) {
    const stored = await storeFile(await make(ref.recipe!, ref.name), ref.name)
    moved.set(path, stored.vpath)
    files[stored.vpath] = { ...stored.ref, recipe: ref.recipe }
    onProgress?.(++done, entries.length)
  }
  const to = (v: unknown) => (typeof v === 'string' && moved.get(v)) || v
  for (const it of p.scene_items) {
    it.path = to(it.path) as string
    it.source_path = it.path
    if (it.native_mesh_obj) it.native_mesh_obj = to(it.native_mesh_obj) as string
    if (it.glass_custom_texture) it.glass_custom_texture = to(it.glass_custom_texture) as string
    for (const m of Object.keys(it.textures || {})) it.textures[m] = to(it.textures[m]) as string
    if (it.prefab) for (const m of Object.keys(it.prefab.defaults)) it.prefab.defaults[m] = to(it.prefab.defaults[m]) as string
  }
  const s = p.settings
  for (const k of ['sky_texture', 'minimap_texture', 'loading_image', 'bbcity_donor', 'cts_template'] as const) s[k] = to(s[k]) as string
  p.files = files
  return p
}

/**
 * Recipes for files made before the site recorded them: a block-out shape's
 * mesh (from the object's shape settings), and textures the site can prove it
 * made (recognize.ts, as play links do). Returns how many files gained one.
 */
export async function adoptRecipes(p: Project): Promise<number> {
  let found = 0
  for (const it of p.scene_items) {
    const ref = p.files[it.path]
    if (it.shape && ref && !ref.recipe && !it.prefab) { ref.recipe = { kind: 'shape', shape: it.shape }; found++ }
  }
  for (const ref of Object.values(p.files)) {
    if (ref.recipe || ref.origin !== 'user' || !/\.(png|jpe?g)$/i.test(ref.name)) continue
    const r = await recognizeTexture(ref)
    if (r) { ref.recipe = r; found++ }
  }
  return found
}
