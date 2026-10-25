// Pictures of models from the player's game put together: a model with the parts it is never placed without, a
// building with its pieces, a group or a module of the city with every part where the game had it. Parts are
// placed in the editor's frame (X mirrored like every model the editor exports: a part at game (x, y, z) turned
// `yaw` about +Y goes to (-x, y, z) with rotation.y = yaw). Drawn on this device only; nothing is uploaded.
import * as THREE from 'three'
import { getObject } from './client'
import { identify } from './identity'
import type { GameObjectEntry, Vec3 } from './indexer'
import type { Side } from './cityModules'

/** A part to place: the library entry, where its feet stand (game frame, metres) and its turn about +Y (radians). */
export interface PlacedPart { id: string; at: Vec3; yaw: number }

/**
 * The parts as one object (each cut out of the player's game; the never-drawn left out). At most `max` parts,
 * the biggest first, so a large module stays quick to draw.
 */
export async function assemble(parts: PlacedPart[], byId: (id: string) => GameObjectEntry | undefined, texSize = 64, max = 160): Promise<THREE.Group> {
  const { objectMesh } = await import('./render')
  const g = new THREE.Group()
  const usable = parts.map((p) => ({ p, e: byId(p.id) })).filter((x): x is { p: PlacedPart; e: GameObjectEntry } => !!x.e && identify(x.e).role !== 'skip')
  const size = (e: GameObjectEntry) => e.size[0] * e.size[1] * Math.max(e.size[2], 0.1)
  usable.sort((a, b) => size(b.e) - size(a.e))
  const cache = new Map<string, Promise<THREE.Mesh | null>>()
  const mesh = (e: GameObjectEntry) => {
    let m = cache.get(e.id)
    if (!m) { m = getObject(e, texSize).then((r) => objectMesh(r, 1)).catch(() => null); cache.set(e.id, m) }
    return m
  }
  await Promise.all(usable.slice(0, max).map(async ({ p, e }) => {
    const m = await mesh(e)
    if (!m) return
    const c = m.clone()
    c.rotation.y = p.yaw
    c.position.set(-p.at[0], p.at[1], p.at[2])
    g.add(c)
  }))
  return g
}

let renderer: THREE.WebGLRenderer | null = null

/**
 * A square picture of an object (a data URL): from a 3/4 view above, or straight at one side of the game's frame
 * (`side`, as Side; the editor mirrors X, so the game's +x side is the editor's -x).
 */
export async function snapshot(obj: THREE.Object3D, px: number, side?: Side | string | null): Promise<string> {
  const box = new THREE.Box3().setFromObject(obj)
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a2a38, 2.2))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(-0.4, 1, 0.7)
  scene.add(sun, obj)
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()), r = size.length() / 2 || 1
  const dir = side ? new THREE.Vector3(side[1] === 'x' ? (side[0] === '+' ? -1 : 1) : 0, 0.25, side[1] === 'z' ? (side[0] === '+' ? 1 : -1) : 0).normalize() : new THREE.Vector3(1, 0.8, 1.2).normalize()
  const cam = new THREE.OrthographicCamera(-r, r, r, -r, 0.01, r * 8)
  cam.position.copy(c).addScaledVector(dir, r * 4)
  cam.lookAt(c)
  renderer ??= new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(px, px)
  renderer.setClearColor(0x202028)
  renderer.render(scene, cam)
  const url = renderer.domElement.toDataURL('image/png')
  scene.remove(obj)
  return url
}
