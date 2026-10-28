// What's under the cursor in the editor view: scene surfaces (with the source face and its normal), marker and light
// handles, the ground where nothing is, and the surface straight below a point.
import * as THREE from 'three'
import type { Vec3 } from '../../lib/project'

export type Handle = { kind: 'item' | 'marker' | 'light'; index: number }
export interface SurfaceHit { point: Vec3; item: number; face: number; normal: Vec3 }

/** What picking needs from the viewer. */
export interface PickHost {
  readonly canvas: HTMLCanvasElement
  camera(): THREE.Camera
  /** Every object's mesh with its uid; `visible` is false when its layer is hidden. */
  meshes(): { uid: string; mesh: THREE.Mesh; visible: boolean }[]
  /** The index of the object with this uid, or -1. */
  indexOf(uid: string): number
  /** Marker and light handles (their groups carry userData.kind and .index). */
  handles(): THREE.Object3D[]
  /** The height of the guide grid (the ground where there is no map). */
  groundY(): number
}

export class Picker {
  constructor(private host: PickHost) {}

  /** Screen point to normalised device coordinates. */
  ndc(x: number, y: number) {
    const r = this.host.canvas.getBoundingClientRect()
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1)
  }

  private ray(x: number, y: number) {
    const rc = new THREE.Raycaster()
    rc.setFromCamera(this.ndc(x, y), this.host.camera())
    return rc
  }

  /** Nearest scene-item surface under the cursor. */
  surface(x: number, y: number): SurfaceHit | null {
    const list = this.host.meshes().filter((n) => n.visible)
    const hit = this.ray(x, y).intersectObjects(list.map((n) => n.mesh), false)[0]
    if (!hit) return null
    const node = list.find((n) => n.mesh === hit.object)
    const index = node ? this.host.indexOf(node.uid) : -1
    const info = (hit.object as THREE.Mesh).userData.faceOrder as Uint32Array | undefined
    const face = info && hit.faceIndex != null ? info[hit.faceIndex] : -1
    const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).toArray() as Vec3 : [0, 1, 0] as Vec3
    return { point: hit.point.toArray() as Vec3, item: index, face, normal }
  }

  /** The marker or light handle under the cursor (they're small and sit on top of geometry, so they win). */
  handle(x: number, y: number): Handle | null {
    const hit = this.ray(x, y).intersectObjects(this.host.handles(), true)[0]
    let o: THREE.Object3D | null = hit?.object ?? null
    while (o && !o.userData.kind) o = o.parent
    return o ? { kind: o.userData.kind, index: o.userData.index } : null
  }

  /** A surface under the cursor, else the point on the ground (the guide grid's height); null looking at the sky. */
  point(x: number, y: number): Vec3 | null {
    const s = this.surface(x, y)
    if (s) return s.point
    const p = this.ray(x, y).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.host.groundY()), new THREE.Vector3())
    return p ? (p.toArray() as Vec3) : null
  }

  /** Height of the first scene surface straight below (x, z), or null. */
  surfaceBelow(x: number, y: number, z: number): number | null {
    const meshes = this.host.meshes().map((n) => n.mesh)
    const box = new THREE.Box3()
    meshes.forEach((m) => box.expandByObject(m))
    const top = Math.max(y, box.isEmpty() ? y : box.max.y) + 5
    const rc = new THREE.Raycaster(new THREE.Vector3(x, top, z), new THREE.Vector3(0, -1, 0))
    rc.params.Line = { threshold: 0 }
    const hits = rc.intersectObjects(meshes, false)
    const hit = hits.find((h) => h.point.y <= y + 0.01) ?? hits[0]
    return hit ? hit.point.y : null
  }
}
