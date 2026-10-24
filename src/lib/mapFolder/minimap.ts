// A minimap for a finished map, for the quick upgrade (py/map_upgrade.py Minimap): the map's pieces, read as for
// opening it (read.ts), drawn from straight above with their own pictures over a square round the footprint. The
// game stretches the picture over the minimap region's rectangle with image right = game -X and image down = game
// +Z (lib/minimap.ts), so the picture is drawn in the game frame and turned to match; the rectangle goes to Python
// with it. Roofs are cut off a little above the highest spawn, so indoor maps show their floors and walls as the
// game's own minimaps do rather than the roof over them. Browser only (WebGL).
import { INVISIBLE_TEXTURE } from '../gameObjects/textures'
import { MINIMAP_PAD_M } from '../minimap'
import { SPAWN_TYPES } from '../project'
import { ctsMarkers } from './cts'
import type { Material } from 'three'
import type { MapInfo } from './info'
import type { MapScene } from './read'

/** [minX, minZ, maxX, maxZ], game metres. */
export type GameRect = [number, number, number, number]

/** How far above the highest spawn the picture is cut (game metres): a storey, with room for a player's head. */
export const CEILING_ABOVE_SPAWNS = 3

/** The height the minimap is cut at (game frame): just above where the players stand, or none when no spawn is known. */
export function minimapCeiling(info: MapInfo): number | undefined {
  // Frame at the game origin, one unit a metre: editor heights are the game's.
  const spawns = ctsMarkers(info.cts, { origin: [0, 0, 0], ws: 1 }).markers.filter((m) => SPAWN_TYPES.includes(m.type))
  return spawns.length ? Math.max(...spawns.map((m) => m.position[1])) + CEILING_ABOVE_SPAWNS : undefined
}

/** The square the minimap covers: the pieces' footprint (invisible blockers left out) plus the editor's border. */
export function minimapBox(scene: MapScene, pad = MINIMAP_PAD_M): GameRect | null {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (const pc of scene.pieces) {
    const { positions: p, triangles: t, triMaterial: tm } = pc.mesh
    for (let i = 0; i < tm.length; i++) {
      if (INVISIBLE_TEXTURE.test(scene.materials[tm[i]] ?? '')) continue
      for (let k = 0; k < 3; k++) {
        const v = t[3 * i + k] * 3
        const x = p[v] + pc.base[0], z = p[v + 2] + pc.base[2]
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (z < z0) z0 = z
        if (z > z1) z1 = z
      }
    }
  }
  if (!(x1 > x0) && !(z1 > z0)) return null
  const half = Math.max(x1 - x0, z1 - z0) / 2 + pad
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
  const r = (v: number) => +v.toFixed(3)
  return [r(cx - half), r(cz - half), r(cx + half), r(cz + half)]
}

/**
 * The map drawn from straight above over `rect`, as a PNG the size of `size`, turned as the game shows it; nothing
 * above `ceiling` (game frame) is drawn.
 */
export async function drawMinimap(scene: MapScene, rect: GameRect, size = 1024, ceiling?: number): Promise<Blob> {
  const THREE = await import('three')
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
  const disposables: { dispose(): void }[] = []
  try {
    renderer.setSize(size, size, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    if (ceiling !== undefined) renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), ceiling)]
    const world = new THREE.Scene()
    world.background = new THREE.Color(0x000000)
    world.add(new THREE.HemisphereLight(0xffffff, 0x808080, 2.2))
    const sun = new THREE.DirectionalLight(0xffffff, 1.2)
    sun.position.set(0.3, 1, 0.45)
    world.add(sun)
    // One material per picture, shared by every piece; pictures' rows run top-down, as their UVs do.
    const looks = scene.materials.map((name, m) => {
      if (INVISIBLE_TEXTURE.test(name)) return null
      const t = scene.textures[m]
      const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, color: t ? 0xffffff : 0x8a8a8a })
      if (t) {
        const tex = new THREE.DataTexture(new Uint8Array(t.rgba), t.width, t.height, THREE.RGBAFormat)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping
        tex.magFilter = THREE.LinearFilter
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.generateMipmaps = true
        tex.needsUpdate = true
        mat.map = tex
        if (t.alpha) mat.alphaTest = 0.5
        disposables.push(tex)
      }
      disposables.push(mat)
      return mat
    })
    let top = -Infinity, bottom = Infinity
    for (const pc of scene.pieces) {
      const { positions, uvs, triangles, triMaterial } = pc.mesh
      // Triangles grouped by picture, so each piece is one mesh with a group per picture.
      const order = [...triMaterial.keys()].filter((i) => looks[triMaterial[i]]).sort((a, b) => triMaterial[a] - triMaterial[b])
      if (!order.length) continue
      const index = new Uint32Array(order.length * 3)
      const geo = new THREE.BufferGeometry()
      const groups: Material[] = []
      order.forEach((tri, k) => {
        index.set(triangles.subarray(3 * tri, 3 * tri + 3), 3 * k)
        const m = triMaterial[tri]
        if (!k || m !== triMaterial[order[k - 1]]) {
          geo.addGroup(3 * k, 0, groups.length)
          groups.push(looks[m]!)
        }
        geo.groups[geo.groups.length - 1].count += 3
      })
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
      geo.setIndex(new THREE.BufferAttribute(index, 1))
      geo.computeVertexNormals()
      geo.computeBoundingBox()
      disposables.push(geo)
      const mesh = new THREE.Mesh(geo, groups)
      mesh.position.set(...pc.base)
      world.add(mesh)
      top = Math.max(top, geo.boundingBox!.max.y + pc.base[1])
      bottom = Math.min(bottom, geo.boundingBox!.min.y + pc.base[1])
    }
    const [x0, z0, x1, z1] = rect
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
    const cam = new THREE.OrthographicCamera(-(x1 - x0) / 2, (x1 - x0) / 2, (z1 - z0) / 2, -(z1 - z0) / 2, 0.1, top - bottom + 1000)
    // Looking straight down with -Z up: +X right, +Z down. The game wants -X right, so the picture is mirrored below.
    cam.position.set(cx, top + 500, cz)
    cam.up.set(0, 0, -1)
    cam.lookAt(cx, bottom, cz)
    renderer.render(world, cam)
    const out = document.createElement('canvas')
    out.width = out.height = size
    const ctx = out.getContext('2d')!
    ctx.translate(size, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(canvas, 0, 0)
    return await new Promise<Blob>((ok, no) => out.toBlob((b) => (b ? ok(b) : no(new Error('The minimap could not be drawn.'))), 'image/png'))
  } finally {
    for (const d of disposables) d.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
