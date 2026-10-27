// "Remix in editor" for a play link: the share becomes a new map in My maps.
// Models are stored as they came (plain OBJ geometry), textures are made again
// from their recipes, as the Showcase does.
import { db } from '../lib/db'
import { storeFile } from '../lib/files'
import { uid, type FileRef, type Project } from '../lib/project'
import { rebuildFromRecipes } from '../lib/showcase'
import { fetchShare } from './shareApi'

/** Makes a new local map from the link `token`; returns its id. */
export async function remixShare(token: string, onProgress?: (text: string) => void): Promise<string> {
  const doc = await fetchShare(token)
  const p: Project = JSON.parse(JSON.stringify(doc.project))
  const files: Record<string, FileRef> = {}
  const models = new Map<string, string>()
  const entries = Object.entries(doc.models)
  for (const [i, [k, text]] of entries.entries()) {
    if (i % 20 === 0) onProgress?.(`Storing models (${i + 1}/${entries.length})`)
    const stored = await storeFile(new Blob([text], { type: 'model/obj' }), `${k.replace(/\W+/g, '_')}.obj`)
    files[stored.vpath] = stored.ref
    models.set(k, stored.vpath)
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
