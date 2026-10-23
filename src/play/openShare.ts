// Opens a play-link share in this browser: models go straight to the model
// cache, textures are remade from their recipes (generated here, or the
// starter library loaded from this site) and kept in this browser's file store.
import { cacheModel } from '../lib/assets'
import { db } from '../lib/db'
import { storeFile } from '../lib/files'
import { parseObj } from '../lib/geometry'
import { pixelsToPng } from '../lib/images'
import { generate } from '../lib/procedural'
import { isDataPackPath, uid, type FileRef, type Project } from '../lib/project'
import type { TextureRecipe } from '../lib/recipes'
import type { ShareDoc } from './share'

/** Remade textures are capped at this size: plenty on screen, and quick to make on a phone. */
const MAX_GEN = 512

const made = new Map<string, Promise<{ vpath: string; ref: FileRef } | null>>()

function remake(r: TextureRecipe, size: number) {
  const key = JSON.stringify([r, size])
  let p = made.get(key)
  if (!p) {
    p = (async () => {
      if (r.kind === 'library') {
        const res = await fetch(`/textures/${r.id}.jpg`)
        if (!res.ok) return null
        return storeFile(await res.blob(), `${r.id}.jpg`)
      }
      const params = { ...r.params, size: Math.min(r.params.size, size) }
      return storeFile(await pixelsToPng(generate(params), params.size, `${params.kind}_${params.seed}.png`), `${params.kind}_${params.seed}.png`)
    })().catch(() => null)
    made.set(key, p)
  }
  return p
}

/** Lets the page paint now and then while textures are made. */
let lastBreath = 0
async function breathe() {
  if (performance.now() - lastBreath < 60) return
  await new Promise((r) => setTimeout(r, 0))
  lastBreath = performance.now()
}

/** A project the viewer can draw (not saved as one of the user's maps). */
export async function openShare(doc: ShareDoc, onProgress?: (t: string) => void): Promise<Project> {
  const p: Project = JSON.parse(JSON.stringify(doc.project))
  p.id = uid()
  p.name = doc.title
  // Paths unique to this opening, so caches never mix two shares.
  const base = `/play/${p.id}/`
  const at = (k: string) => (isDataPackPath(k) ? k : base + k)
  // The viewer tells browser images by their extension.
  const tex = (k: string) => (isDataPackPath(k) ? k : base + k + (doc.textures[k]?.kind === 'library' ? '.jpg' : '.png'))
  for (const [k, text] of Object.entries(doc.models)) cacheModel(at(k), parseObj(text))
  const entries = Object.entries(doc.textures)
  const size = entries.length > 60 ? 256 : MAX_GEN
  for (const [i, [k, r]] of entries.entries()) {
    onProgress?.(`Making textures (${i + 1}/${entries.length})…`)
    const s = await remake(r, size)
    if (s) p.files[tex(k)] = s.ref
    await breathe()
  }
  for (const it of p.scene_items) {
    it.path = at(it.path)
    if (it.native_mesh_obj) it.native_mesh_obj = at(it.native_mesh_obj)
    it.textures = Object.fromEntries(Object.entries(it.textures || {}).map(([m, v]) => [m, v ? tex(v) : '']))
    if (it.glass_custom_texture) it.glass_custom_texture = tex(it.glass_custom_texture)
  }
  return p
}

/** Your own map from this browser, read-only. */
export async function openLocal(id: string): Promise<Project | null> {
  const rec = await db.getProject(id)
  if (!rec) return null
  const { normalizeProject } = await import('../lib/project')
  return normalizeProject(rec.project)
}
