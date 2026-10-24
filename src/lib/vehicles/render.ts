// A car read from the player's game as a three.js object: the car frame in metres (X right, Y up, Z forward),
// standing on its wheels at y = 0. Approximate looks: the diffuse picture times the material's colour (the paint's
// colour for car paint), see-through glass, lit lamps; no reflections, dirt or damage layers.
import * as THREE from 'three'
import { textureFrom } from '../sr1char/materials'
import { volitionHash, hex8 } from '../sr1char/hash'
import type { CmeshMaterial } from '../sr1char/cmesh'
import type { CarResult } from './car.worker'

/** Material constants by hash (the shader parameter names aren't known): the paint's base colour and glass. */
const BASE_COLOR = '3e344564'
const GLASS = '5bdfabb1'
const LAMP_SHADER = '055c3e11'
const METAL = new Set(['chrome', 'rims', 'trim_chrome', 'chrome_rims'].map((n) => hex8(volitionHash(n))))

const rgb = (v: number[] | undefined, d: number[]) => (v ? [v[0], v[1], v[2]] : d)

function materialFor(m: CmeshMaterial | undefined, tex: THREE.Texture | null, alpha: boolean): THREE.Material {
  if (!m) return new THREE.MeshPhongMaterial({ color: 0x777777 })
  const diffuse = m.slots.find((s) => s.slot === 'diffuse_map')
  if (!diffuse) {
    if (GLASS in m.consts) return new THREE.MeshPhongMaterial({ color: 0x1b232c, specular: 0x666666, shininess: 90, transparent: true, opacity: 0.55, depthWrite: false })
    // Shadow cards, light cones and placeholders: not drawn.
    return new THREE.MeshBasicMaterial({ visible: false })
  }
  const opts: THREE.MeshPhongMaterialParameters = { map: tex, specular: 0x222222, shininess: 30, alphaTest: alpha ? 0.5 : 0, side: THREE.FrontSide }
  const color = new THREE.Color()
  if (METAL.has(m.name)) { color.setRGB(0.62, 0.62, 0.64, THREE.SRGBColorSpace); opts.specular = 0xbbbbbb; opts.shininess = 80 }
  else if (BASE_COLOR in m.consts) { const [r, g, b] = rgb(m.consts[BASE_COLOR], [1, 1, 1]); color.setRGB(r, g, b, THREE.SRGBColorSpace); opts.specular = 0x555555; opts.shininess = 60 }
  else { const [r, g, b] = rgb(m.consts.diffuse_color, [1, 1, 1]); color.setRGB(r, g, b, THREE.SRGBColorSpace) }
  opts.color = color
  if (m.shader === LAMP_SHADER) { opts.emissive = new THREE.Color(0x222222); opts.emissiveMap = tex }
  return new THREE.MeshPhongMaterial(opts)
}

/** The car as one group (one mesh per piece), sharing textures and materials between pieces. */
export function carObject(r: CarResult): THREE.Group {
  const { model } = r
  const textures = new Map<string, THREE.Texture>()
  for (const [name, t] of Object.entries(r.textures)) {
    const tex = textureFrom({ width: t.width, height: t.height, rgba: new Uint8Array(t.rgba) }, true)
    textures.set(name, tex)
  }
  const mats = new Map<number, THREE.Material>()
  const matFor = (i: number) => {
    let mat = mats.get(i)
    if (!mat) {
      const m = model.materials[i]
      const name = m?.slots.find((s) => s.slot === 'diffuse_map')?.texture?.toLowerCase() ?? ''
      mat = materialFor(m, textures.get(name) ?? null, !!r.textures[name]?.alpha)
      mats.set(i, mat)
    }
    return mat
  }
  const group = new THREE.Group()
  group.name = 'vehicle:' + r.id
  const ground = model.wheelBottom ?? model.min[1]
  for (const piece of model.meshes) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(piece.positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(piece.normals, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(piece.uvs, 2))
    g.setIndex(new THREE.BufferAttribute(piece.indices, 1))
    const list: THREE.Material[] = []
    piece.groups.forEach((gr, k) => { g.addGroup(gr.start, gr.count, k); list.push(matFor(gr.material)) })
    g.computeBoundingSphere()
    const mesh = new THREE.Mesh(g, list)
    mesh.position.y = -ground
    mesh.castShadow = true
    group.add(mesh)
  }
  group.userData.size = [model.max[2] - model.min[2], model.max[0] - model.min[0], model.max[1] - ground]
  return group
}

/** Frees what carObject made (textures, materials, geometry). */
export function disposeCar(group: THREE.Object3D) {
  const seen = new Set<unknown>()
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    o.geometry.dispose()
    for (const m of (Array.isArray(o.material) ? o.material : [o.material]) as THREE.MeshPhongMaterial[]) {
      if (seen.has(m)) continue
      seen.add(m)
      m.map?.dispose()
      m.dispose()
    }
  })
}
