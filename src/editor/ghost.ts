// The ghost: a see-through copy of the shape, prefab or saved piece the Shape
// tool is about to place, which follows the mouse so you can see where it
// will land and which way it faces (R turns it) before you click.
import * as THREE from 'three'
import { SHAPE_PRESETS } from '../lib/shapes'
import { prefabParts } from '../lib/prefabIndex'
import { partsObject, bundleObject } from '../lib/prefabRender'
import type { Part, Tex } from '../lib/sampleKit'
import { readMyPrefab } from './myPrefabs'

const PLAIN: Tex = { gen: 'concrete', tweak: { color: '#c9ced6', accent: '#9aa1ab', wear: 0.1, seed: 900 } }

/** Builds the 3D object for a Shape-tool choice ("box", "prefab:<key>", "mine:<id>"), origin at its feet. */
async function build(toolShape: string): Promise<THREE.Object3D | null> {
  if (toolShape.startsWith('prefab:')) {
    const parts = prefabParts(toolShape.slice(7))
    return parts.length ? partsObject(parts) : null
  }
  if (toolShape.startsWith('mine:')) {
    const p = readMyPrefab(toolShape.slice(5))
    return p ? bundleObject(p.bundle) : null
  }
  const preset = SHAPE_PRESETS[toolShape]
  if (!preset) return null
  const s = preset.shape
  const part: Part = {
    label: preset.label, kind: s.kind, size: s.size, at: [0, 0, 0], top: PLAIN, side: PLAIN, tile: s.tile,
    ...(s.segments ? { segments: s.segments } : {}), ...(s.taper !== undefined ? { taper: s.taper } : {}), ...(s.bevel ? { bevel: s.bevel } : {}),
  }
  return partsObject([part])
}

/** Makes an object look like a ghost: see-through, slightly blue, not hiding what's behind it, plus its outline. */
function ghostly(obj: THREE.Object3D): THREE.Object3D {
  const root = new THREE.Group()
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m: THREE.Material) => {
      const c = m.clone() as THREE.MeshLambertMaterial
      c.transparent = true
      c.opacity = 0.55
      c.depthWrite = false
      if (c.color) c.color.multiply(new THREE.Color(0.85, 0.95, 1.15))
      return c
    })
    o.material = Array.isArray(o.material) ? mats : mats[0]
    o.renderOrder = 10
    o.raycast = () => {} // the mouse must hit the map under the ghost, not the ghost
  })
  root.add(obj)
  const box = new THREE.Box3().setFromObject(obj)
  if (!box.isEmpty()) {
    const outline = new THREE.Box3Helper(box, 0x8fd3ff)
    outline.raycast = () => {}
    root.add(outline)
  }
  return root
}

const cache = new Map<string, Promise<THREE.Object3D | null>>()

/** The ghost for a Shape-tool choice (a fresh copy each time; build once per choice). */
export async function ghostFor(toolShape: string): Promise<THREE.Object3D | null> {
  // Saved pieces can change, so they aren't cached.
  const made = toolShape.startsWith('mine:') ? build(toolShape) : (cache.get(toolShape) ?? (cache.set(toolShape, build(toolShape)), cache.get(toolShape)!))
  const obj = await made.catch(() => null)
  return obj ? ghostly(obj.clone(true)) : null
}
