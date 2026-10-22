// Loads model geometry and preview textures for the viewport from local
// storage (user files) or the local data pack (/studio/... paths).
import { db } from './db'
import { dataPackBlob } from './datapack'
import { parseObj, type ObjModel } from './geometry'
import type { Project } from './project'
import { py } from './py'

const models = new Map<string, Promise<ObjModel>>()
const textures = new Map<string, Promise<string | null>>()

export async function fileBlob(project: Project | null, vpath: string): Promise<Blob | undefined> {
  if (vpath.startsWith('/studio/')) return dataPackBlob(vpath.slice('/studio/'.length))
  const ref = project?.files[vpath]
  if (!ref) return undefined
  return db.getBlob(ref.hash)
}

export function loadModel(project: Project | null, vpath: string): Promise<ObjModel> {
  let p = models.get(vpath)
  if (!p) {
    p = (async () => {
      const blob = await fileBlob(project, vpath)
      if (!blob) throw new Error('Missing model file ' + vpath.split('/').pop())
      return parseObj(await blob.text())
    })()
    p.catch(() => models.delete(vpath))
    models.set(vpath, p)
  }
  return p
}

export function peekModel(vpath: string): Promise<ObjModel> | undefined { return models.get(vpath) }
export function cacheModel(vpath: string, model: ObjModel) { models.set(vpath, Promise.resolve(model)) }

const BROWSER_IMAGE = /\.(png|jpe?g|bmp|gif|webp)$/i

/** Object URL suitable for THREE.TextureLoader, or null if unavailable. */
export function textureUrl(project: Project | null, vpath: string): Promise<string | null> {
  let p = textures.get(vpath)
  if (!p) {
    p = (async () => {
      const blob = await fileBlob(project, vpath)
      if (!blob) return null
      if (BROWSER_IMAGE.test(vpath)) return URL.createObjectURL(blob)
      // TGA / DDS / TIFF: decode with Pillow in the worker.
      await py.writeFiles([{ path: vpath, data: await blob.arrayBuffer() }])
      const png = await py.texturePreview(vpath, 1024)
      return URL.createObjectURL(new Blob([png], { type: 'image/png' }))
    })().catch(() => null)
    textures.set(vpath, p)
  }
  return p
}
