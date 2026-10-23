// Draws prefab thumbnails with three.js: one small offscreen renderer, a fixed
// 3/4 view from the front right and above, framed to fit. Textures are the real
// ones at thumbnail size: generated ones made at 64 px, starter-library ones
// from their small previews, saved pieces from their own files.
// Loaded only when a thumbnail has to be drawn (prefabThumbs.ts).
import * as THREE from 'three'
import { compoundObj, type Shape } from './shapes'
import { parseObj, type ObjModel } from './geometry'
import { defaultParams, generate } from './procedural'
import { db } from './db'
import type { Part, Tex } from './sampleKit'
import type { FileRef, SceneItem } from './project'

export const THUMB_PX = 160
const TEX_PX = 64
const RAD = Math.PI / 180
/** Where the camera looks from: front right (+X, +Z, the side a prefab faces) and above. */
const VIEW = new THREE.Vector3(0.75, 0.62, 1).normalize()

export interface ThumbBundle { items: SceneItem[]; files: Record<string, FileRef> }

let renderer: THREE.WebGLRenderer | null = null
function getRenderer(): THREE.WebGLRenderer {
  if (renderer && !renderer.getContext().isContextLost()) return renderer
  renderer?.dispose()
  const r = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true, preserveDrawingBuffer: true })
  r.setPixelRatio(1)
  r.setSize(THUMB_PX, THUMB_PX, false)
  r.outputColorSpace = THREE.SRGBColorSpace
  r.setClearColor(0x000000, 0)
  return (renderer = r)
}

/** An image scaled into a small canvas texture that repeats. */
function canvasTexture(draw: (g: CanvasRenderingContext2D) => void, px = TEX_PX): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = px
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

async function blobTexture(blob: Blob): Promise<THREE.Texture> {
  const img = await createImageBitmap(blob, { resizeWidth: TEX_PX, resizeHeight: TEX_PX, resizeQuality: 'medium' })
  const t = canvasTexture((g) => g.drawImage(img, 0, 0))
  img.close()
  return t
}

const texCache = new Map<string, Promise<THREE.Texture | null>>()
function cached(key: string, make: () => Promise<THREE.Texture | null>) {
  let t = texCache.get(key)
  if (!t) { t = make().catch(() => null); texCache.set(key, t) }
  return t
}

function partTexture(t: Tex): Promise<THREE.Texture | null> {
  if ('file' in t) return Promise.resolve(null)
  if ('lib' in t) return cached('lib:' + t.lib, async () => {
    const r = await fetch(`/textures/thumbs/${t.lib}.jpg`)
    return r.ok ? blobTexture(await r.blob()) : null
  })
  return cached(JSON.stringify(t), async () => {
    const params = { ...defaultParams(t.gen, TEX_PX), ...t.tweak, size: TEX_PX }
    const px = generate(params)
    return canvasTexture((g) => g.putImageData(new ImageData(new Uint8ClampedArray(px), TEX_PX, TEX_PX), 0, 0))
  })
}

const fileTexture = (ref: FileRef) => cached('file:' + ref.hash, async () => {
  const blob = await db.getBlob(ref.hash)
  return blob ? blobTexture(blob) : null
})

/** A model as a mesh with one material per OBJ material. */
function meshOf(m: ObjModel, maps: (THREE.Texture | null)[]): THREE.Mesh {
  const g = new THREE.BufferGeometry()
  const tris = m.faces.length / 3
  const order = Array.from({ length: tris }, (_, i) => i).sort((a, b) => m.faceMat[a] - m.faceMat[b] || a - b)
  const index = new Uint32Array(tris * 3)
  let start = 0
  order.forEach((f, i) => {
    index.set(m.faces.subarray(f * 3, f * 3 + 3), i * 3)
    const next = order[i + 1]
    if (next === undefined || m.faceMat[next] !== m.faceMat[f]) { g.addGroup(start * 3, (i + 1 - start) * 3, m.faceMat[f]); start = i + 1 }
  })
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  g.computeVertexNormals()
  const mats = m.mats.map((_, i) => new THREE.MeshLambertMaterial({ map: maps[i] ?? null, color: maps[i] ? 0xffffff : 0x8a8790, side: THREE.DoubleSide }))
  return new THREE.Mesh(g, mats)
}

const shapeOf = (part: Part): Shape => ({
  kind: part.kind, size: part.size, tile: part.tile ?? 4,
  ...(part.segments ? { segments: part.segments } : {}), ...(part.taper !== undefined ? { taper: part.taper } : {}), ...(part.bevel ? { bevel: part.bevel } : {}),
  ...(part.lie ? { lie: true } : {}), ...(part.outline ? { outline: part.outline } : {}), ...(part.fit ? { fit: true } : {}),
  ...(part.heights ? { cells: part.cells, heights: part.heights } : {}),
})

/** A prefab's parts (placed at the origin) as one object, as the editor builds them. */
async function partsObject(parts: Part[]): Promise<THREE.Object3D> {
  const texs = new Map<string, Tex>()
  const matOf = (t: Tex) => { const k = JSON.stringify(t); if (!texs.has(k)) texs.set(k, t); return 'm' + [...texs.keys()].indexOf(k) }
  const pieces = parts.map((p) => ({ shape: shapeOf(p), at: p.at, rot: p.rot ?? 0, top: matOf(p.top), side: matOf(p.side) }))
  const model = parseObj(compoundObj(pieces))
  const byName = new Map([...texs.values()].map((t, i) => ['m' + i, t]))
  const maps = await Promise.all(model.mats.map((m) => { const t = byName.get(m); return t ? partTexture(t) : null }))
  return meshOf(model, maps)
}

/** A saved piece ("My prefabs"): its objects from their stored files. */
async function bundleObject(b: ThumbBundle): Promise<THREE.Object3D> {
  const root = new THREE.Group()
  for (const it of b.items) {
    const ref = b.files[it.path]
    const blob = ref && await db.getBlob(ref.hash)
    if (!blob || !/\.obj$/i.test(it.path)) continue
    const model = parseObj(await blob.text())
    const maps = await Promise.all(model.mats.map((m) => { const f = b.files[it.textures?.[m || 'default']]; return f ? fileTexture(f) : null }))
    const mesh = meshOf(model, maps)
    if (it.pivot) mesh.position.set(-it.pivot[0], -it.pivot[1], -it.pivot[2])
    const g = new THREE.Group()
    g.position.set(...it.position)
    g.rotation.set(it.rotation[0] * RAD, it.rotation[1] * RAD, it.rotation[2] * RAD, 'YXZ')
    g.scale.setScalar(it.scale || 1)
    g.add(mesh)
    root.add(g)
  }
  return root
}

let shadowTex: THREE.Texture | null = null
/** A soft dark patch under things that stand on the ground. */
function contactShadow(box: THREE.Box3): THREE.Mesh {
  shadowTex ??= canvasTexture((g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    r.addColorStop(0, 'rgba(0,0,0,0.5)'); r.addColorStop(0.65, 'rgba(0,0,0,0.25)'); r.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = r; g.fillRect(0, 0, 64, 64)
  })
  const size = box.getSize(new THREE.Vector3())
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size.x * 1.25 + 0.5, size.z * 1.25 + 0.5), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }))
  m.rotation.x = -Math.PI / 2
  m.position.set((box.min.x + box.max.x) / 2, box.min.y + 0.01, (box.min.z + box.max.z) / 2)
  return m
}

/** Renders the object at the fixed 3/4 angle, fitted to the picture, as a WebP (PNG where WebP can't be written). */
async function shoot(obj: THREE.Object3D): Promise<Blob | null> {
  const box = new THREE.Box3().setFromObject(obj)
  if (box.isEmpty()) return null
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a2a38, 2.2))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(-0.4, 1, 0.7)
  scene.add(sun, obj, contactShadow(box))

  // Orthographic, so the fit is exact: the box's corners as seen from the view direction.
  const center = box.getCenter(new THREE.Vector3())
  const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, radius * 8)
  cam.position.copy(center).addScaledVector(VIEW, radius * 4)
  cam.lookAt(center)
  cam.updateMatrixWorld()
  const lo = new THREE.Vector2(Infinity, Infinity), hi = new THREE.Vector2(-Infinity, -Infinity)
  for (let i = 0; i < 8; i++) {
    const v = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(cam.matrixWorldInverse)
    lo.min(new THREE.Vector2(v.x, v.y)); hi.max(new THREE.Vector2(v.x, v.y))
  }
  const half = Math.max(hi.x - lo.x, hi.y - lo.y) / 2 * 1.06
  const cx = (lo.x + hi.x) / 2, cy = (lo.y + hi.y) / 2
  Object.assign(cam, { left: cx - half, right: cx + half, top: cy + half, bottom: cy - half })
  cam.updateProjectionMatrix()

  const r = getRenderer()
  r.render(scene, cam)
  const blob = await new Promise<Blob | null>((ok) => r.domElement.toBlob(ok, 'image/webp', 0.86))
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    o.geometry.dispose()
    for (const m of [o.material].flat()) m.dispose()
  })
  return blob
}

export async function drawParts(parts: Part[]): Promise<Blob | null> {
  return parts.length ? shoot(await partsObject(parts)) : null
}

export async function drawBundle(b: ThumbBundle): Promise<Blob | null> {
  return shoot(await bundleObject(b))
}
