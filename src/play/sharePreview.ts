// A link's automatic preview picture, drawn from the share itself, as a
// player who opens the link would see the map: plain OBJ geometry and the
// site's own textures remade from their recipes. Not from the editor's view,
// which can show what a share never carries (game files, the data pack's
// objects, the author's own pictures).
import { Viewer, type ViewOptions } from '../editor/Viewer'
import { textureUrl } from '../lib/assets'
import { isDataPackPath } from '../lib/project'
import { openShare } from './openShare'
import { itemPaths, type ShareDoc } from './share'

/** Previews and in-game screenshots are stored at this size (16:9). */
export const PREVIEW_W = 1280
export const PREVIEW_H = 720

const OPTS: ViewOptions = { selection: null, gizmo: 'translate', wireframe: false, collisionView: 'off', soloMaterial: null, faceRange: [0, 0], readOnly: true, showGizmo: false }
const NO_EVENTS = { onPick() {}, onSurface() {}, onTransform() {}, onErase() {} }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const atMost = <T,>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p, sleep(ms).then(() => null)])

/** The share without anything drawn from this browser's data pack (players without one don't see it either). */
export function withoutDataPack(doc: ShareDoc): ShareDoc {
  const project = JSON.parse(JSON.stringify(doc.project)) as ShareDoc['project']
  project.scene_items = project.scene_items.filter((it) => !itemPaths(it).models.some(isDataPackPath))
  for (const it of project.scene_items) {
    it.textures = Object.fromEntries(Object.entries(it.textures || {}).map(([m, p]) => [m, p && isDataPackPath(p) ? '' : p]))
    if (it.glass_custom_texture && isDataPackPath(it.glass_custom_texture)) delete it.glass_custom_texture
  }
  return { ...doc, project }
}

/** Renders the share in a hidden view and returns a WebP picture of it, or null if that fails. */
export async function sharePreview(doc: ShareDoc): Promise<Blob | null> {
  const host = document.createElement('div')
  Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', width: `${PREVIEW_W}px`, height: `${PREVIEW_H}px`, pointerEvents: 'none' })
  document.body.appendChild(host)
  let v: Viewer | null = null
  try {
    const project = await openShare(withoutDataPack(doc))
    v = new Viewer(host, NO_EVENTS)
    v.sync(project, OPTS)
    await atMost(v.whenLoaded(), 20000)
    const textures = [...new Set(project.scene_items.flatMap((it) => itemPaths(it).textures))]
    await atMost(Promise.all(textures.map((p) => textureUrl(project, p))), 8000)
    await sleep(500) // the viewer decodes the images after their URLs are ready
    v.frameAll()
    await sleep(100)
    return await v.capture(PREVIEW_W, PREVIEW_H)
  } catch {
    return null
  } finally {
    v?.dispose()
    host.remove()
  }
}

/** An in-game screenshot the author picked, as a 1280×720 WebP (cropped to 16:9 from the middle). */
export async function screenshotPreview(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  try {
    const k = Math.max(PREVIEW_W / bmp.width, PREVIEW_H / bmp.height)
    const sw = PREVIEW_W / k, sh = PREVIEW_H / k
    const c = new OffscreenCanvas(PREVIEW_W, PREVIEW_H)
    c.getContext('2d')!.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, PREVIEW_W, PREVIEW_H)
    return await c.convertToBlob({ type: 'image/webp', quality: 0.85 })
  } finally { bmp.close() }
}
