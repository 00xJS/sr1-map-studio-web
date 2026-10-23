// A game object as a three.js mesh in editor space (X mirrored like every model the editor exports, one editor
// unit = world_scale metres), for the placement ghost and the library thumbnails.
import * as THREE from 'three'
import type { ObjectResult } from './worker'

/** Editor-space position of game-space vertex i (the exporter mirrors X back). */
export const toEditor = (p: Float32Array, i: number, ws: number): [number, number, number] => [-p[3 * i] / ws, p[3 * i + 1] / ws, p[3 * i + 2] / ws]

export function objectMesh(r: ObjectResult, ws = 1): THREE.Mesh {
  const { mesh, textures } = r
  const tris = mesh.triangles.length / 3
  const order = Array.from({ length: tris }, (_, i) => i).sort((a, b) => mesh.triMaterial[a] - mesh.triMaterial[b] || a - b)
  const g = new THREE.BufferGeometry()
  const n = mesh.positions.length / 3
  const pos = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) pos.set(toEditor(mesh.positions, i, ws), 3 * i)
  const index = new Uint32Array(tris * 3)
  let start = 0
  order.forEach((t, i) => {
    // Mirroring X turns the triangle over: swap two corners to keep it facing out.
    index[3 * i] = mesh.triangles[3 * t]; index[3 * i + 1] = mesh.triangles[3 * t + 2]; index[3 * i + 2] = mesh.triangles[3 * t + 1]
    const next = order[i + 1]
    if (next === undefined || mesh.triMaterial[next] !== mesh.triMaterial[t]) { g.addGroup(start * 3, (i + 1 - start) * 3, mesh.triMaterial[t]); start = i + 1 }
  })
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  // DataTextures are not flipped, so the game's UVs (v = 0 at the picture's top row) read them as they are.
  g.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  g.computeVertexNormals()
  const mats = mesh.materials.map((_, i) => {
    const t = textures[i]
    if (!t) return new THREE.MeshLambertMaterial({ color: 0x8a8790, side: THREE.DoubleSide })
    const tex = new THREE.DataTexture(new Uint8Array(t.rgba), t.width, t.height, THREE.RGBAFormat)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.colorSpace = THREE.SRGBColorSpace
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.generateMipmaps = true
    tex.needsUpdate = true
    return new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, alphaTest: t.alpha ? 0.4 : 0, transparent: false })
  })
  return new THREE.Mesh(g, mats)
}
