// A link's preview picture, drawn by the site from the share itself, as a
// player who opens the link would see the map: plain OBJ geometry and the
// site's own textures remade from their recipes. Not from the editor's view,
// which can show what a share never carries (game files, the data pack's
// objects, the author's own pictures). It is the only preview a link can have
// (share.ts previewProblem).
import { Viewer, type ViewOptions } from '../editor/Viewer'
import { textureUrl } from '../lib/assets'
import { isDataPackPath } from '../lib/project'
import { openShare } from './openShare'
import { PREVIEW_H, PREVIEW_W, itemPaths, previewProblem, type ShareDoc } from './share'

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

/** Renders the share in a hidden view and returns a WebP picture of it, or null if that fails (or the browser can't write WebP). */
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
    const pic = await v.capture(PREVIEW_W, PREVIEW_H)
    return pic && !previewProblem(new Uint8Array(await pic.arrayBuffer())) ? pic : null
  } catch {
    return null
  } finally {
    v?.dispose()
    host.remove()
  }
}
