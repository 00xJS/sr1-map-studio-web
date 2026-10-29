// "Remix in editor" for a play link: the share becomes a new map in My maps.
// Models are stored as they came (plain OBJ geometry), or made again from the
// shape or compound settings the share carries for them when those make the
// same model, so a remix of a gallery map can go in the gallery too. A share
// names every material m0, m1…; a model made again gets its recipe's names
// back, and the objects using it follow. Textures are made again from their
// recipes, as the Showcase does.
import { db } from '../lib/db'
import { storeFile } from '../lib/files'
import { uid, type FileRef, type Project, type SceneItem } from '../lib/project'
import { compoundObj, shapeObj } from '../lib/shapes'
import type { FileRecipe } from '../lib/recipes'
import { canonicalObj, cleanObj } from './share'
import { rebuildFromRecipes } from '../lib/showcase'
import { fetchShare } from './shareApi'

/** Makes a new local map from the link `token`; returns its id. */
export async function remixShare(token: string, onProgress?: (text: string) => void): Promise<string> {
  const doc = await fetchShare(token)
  const p: Project = JSON.parse(JSON.stringify(doc.project))
  const files: Record<string, FileRef> = {}
  const models = new Map<string, string>()
  const entries = Object.entries(doc.models)
  const { buildProblem, sameObj } = await import('./shareBuilds')
  /** By model key: the share's material names back to the recipe's. */
  const back = new Map<string, Record<string, string>>()
  for (const [i, [k, text]] of entries.entries()) {
    if (i % 20 === 0) onProgress?.(`Storing models (${i + 1}/${entries.length})`)
    const b = doc.made?.[k] !== 'import' ? doc.builds?.[k] : undefined
    let obj = text, recipe: FileRecipe | null = null
    if (b && b.kind !== 'prefab' && !buildProblem(b)) {
      const raw = cleanObj(b.kind === 'shape' ? shapeObj(b.shape) : compoundObj(b.pieces))
      const c = raw ? canonicalObj(raw) : null
      if (raw && c && sameObj(c.obj, text)) {
        obj = raw
        recipe = b
        back.set(k, Object.fromEntries([...c.renamed].map(([from, to]) => [to, from])))
      }
    }
    const stored = await storeFile(new Blob([obj], { type: 'model/obj' }), `${k.replace(/\W+/g, '_')}.obj`)
    files[stored.vpath] = recipe ? { ...stored.ref, recipe } : stored.ref
    models.set(k, stored.vpath)
  }
  for (const it of p.scene_items) {
    const r = back.get(it.path)
    if (r) renameMaterials(it, r)
  }
  // Recipe-only entries under the share's own keys: rebuildFromRecipes makes the files and repoints the objects.
  for (const [k, r] of Object.entries(doc.textures)) {
    files[k] = { hash: '', size: 0, name: `${k.replace(/\W+/g, '_')}.${r.kind === 'library' ? 'jpg' : 'png'}`, type: '', origin: 'user', recipe: r }
  }
  for (const it of p.scene_items) {
    it.path = models.get(it.path) ?? it.path
    if (it.native_mesh_obj) it.native_mesh_obj = models.get(it.native_mesh_obj) ?? it.native_mesh_obj
  }
  p.files = files
  onProgress?.('Making textures')
  const built = await rebuildFromRecipes(p)
  // It keeps only the files it made: models without a recipe go back in as stored.
  for (const v of models.values()) if (!files[v].recipe) built.files[v] = files[v]
  const now = new Date().toISOString()
  const project: Project = { ...built, id: uid(), name: `${doc.title} (remix)`.slice(0, 120), created_at: now, updated_at: now }
  await db.putProject({ id: project.id, name: project.name, updated_at: now, project })
  return project.id
}

/** An object's material settings under the names its model now uses. */
function renameMaterials(it: SceneItem, r: Record<string, string>) {
  const name = (m: string) => r[m] ?? m
  const keys = <T,>(o: Record<string, T> | undefined) => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [name(k), v]))
  it.textures = keys(it.textures)!
  it.alpha = keys(it.alpha)!
  if (it.glow) it.glow = keys(it.glow)
  if (it.surface_ids) it.surface_ids = keys(it.surface_ids)
  if (it.water_materials) it.water_materials = it.water_materials.map(name)
}
