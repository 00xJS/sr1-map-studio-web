// Pictures of the editor view: the map's thumbnail (what the camera sees) and the minimap (straight down, orthographic).
import * as THREE from 'three'
import type { MinimapRect } from '../../lib/minimap'

/** What a picture needs from the viewer. */
export interface CaptureHost {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  /** The map's objects (what the minimap shows). */
  root: THREE.Object3D
  camera: THREE.Camera
  requestRender(): void
}

/** Hides `objects` while `fn` runs, then shows them as they were. */
function without<T>(objects: THREE.Object3D[], fn: () => T): T {
  const was = objects.map((h) => h.visible)
  objects.forEach((h) => { h.visible = false })
  try { return fn() } finally { objects.forEach((h, i) => { h.visible = was[i] }) }
}

/**
 * Straight-down picture of `rect` for the minimap: +X right, +Z down (the exporter's X mirror turns that into the
 * game's layout; `mirror` flips it for maps exported without the mirror). `hide`: handles, grid and helpers.
 */
export async function captureTopDown(v: CaptureHost, hide: THREE.Object3D[], o: { size: number; rect: MinimapRect; mirror?: boolean }): Promise<Blob | null> {
  const box = new THREE.Box3().setFromObject(v.root)
  if (box.isEmpty()) return null
  const [x0, z0, x1, z1] = o.rect
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
  const cam = new THREE.OrthographicCamera(-(x1 - x0) / 2, (x1 - x0) / 2, (z1 - z0) / 2, -(z1 - z0) / 2, 0.1, box.max.y - box.min.y + 2000)
  cam.position.set(cx, box.max.y + 500, cz)
  cam.up.set(0, 0, -1)
  cam.lookAt(cx, box.min.y, cz)
  const px = new Uint8Array(o.size * o.size * 4)
  without(hide, () => {
    const bg = v.scene.background, fog = v.scene.fog
    v.scene.background = new THREE.Color(0x000000)
    v.scene.fog = null
    const rt = new THREE.WebGLRenderTarget(o.size, o.size, { colorSpace: THREE.SRGBColorSpace })
    v.renderer.setRenderTarget(rt)
    v.renderer.render(v.scene, cam)
    v.renderer.readRenderTargetPixels(rt, 0, 0, o.size, o.size, px)
    v.renderer.setRenderTarget(null)
    rt.dispose()
    v.scene.background = bg
    v.scene.fog = fog
  })
  v.requestRender()
  // GL rows run bottom-up; images run top-down.
  const canvas = new OffscreenCanvas(o.size, o.size)
  const img = new ImageData(o.size, o.size)
  const row = o.size * 4
  for (let y = 0; y < o.size; y++) {
    const src = (o.size - 1 - y) * row
    if (!o.mirror) { img.data.set(px.subarray(src, src + row), y * row); continue }
    for (let x = 0; x < o.size; x++) img.data.set(px.subarray(src + (o.size - 1 - x) * 4, src + (o.size - x) * 4), y * row + x * 4)
  }
  canvas.getContext('2d')!.putImageData(img, 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

/** The view as the camera sees it, cropped to `width` × `height` (the map's thumbnail). `hide`: the gizmo and box. */
export async function captureView(v: CaptureHost, hide: THREE.Object3D[], width = 640, height = 360): Promise<Blob | null> {
  const el = v.renderer.domElement
  const w = el.width, h = el.height
  const canvas = new OffscreenCanvas(width, height)
  without(hide, () => {
    v.renderer.render(v.scene, v.camera)
    const scale = Math.max(width / w, height / h)
    const sw = width / scale, sh = height / scale
    canvas.getContext('2d')!.drawImage(el, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, width, height)
  })
  v.requestRender()
  return canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })
}
