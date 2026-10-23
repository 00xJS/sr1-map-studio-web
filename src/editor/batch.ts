// Static batching for big maps: objects that aren't selected or changing are
// drawn as one merged mesh per material, instead of one draw call per object
// and material. Their own meshes stay in the scene, hidden, so picking, walking
// and bounds work as before; any change to a batched object shows the meshes
// again until the next rebuild.
import * as THREE from 'three'

export interface BatchSource { uid: string; mesh: THREE.Mesh; sig: string }

/** Below this many objects a map draws fast enough as it is. */
export const MIN_BATCH = 40
const REBUILD_MS = 400

const matKey = (m: THREE.MeshLambertMaterial) =>
  [m.map?.uuid ?? '-', m.color.getHex(), m.side, m.opacity, m.alphaTest].join('|')

/** True if the mesh can be drawn by a merged copy (opaque and fully visible). */
export const batchable = (mesh: THREE.Mesh) =>
  (mesh.material as THREE.Material[]).every((m) => m.visible && !m.transparent && !(m as THREE.MeshLambertMaterial).wireframe)

export class StaticBatch {
  readonly root = new THREE.Group()
  private members = new Map<string, { mesh: THREE.Mesh; sig: string }>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private collect: () => BatchSource[] | null, private changed: () => void) {
    this.root.name = 'static batch'
  }

  /**
   * Call after every scene sync with what may be batched now (null: batching
   * off). Drops the batch if a member changed or left, then schedules a rebuild
   * if anything batchable isn't in it.
   */
  update(sources: BatchSource[] | null) {
    const now = new Map((sources ?? []).map((s) => [s.uid, s]))
    for (const [uid, m] of this.members) {
      const s = now.get(uid)
      if (!s || s.mesh !== m.mesh || s.sig !== m.sig) { this.clear(); break }
    }
    if (!sources || sources.length < MIN_BATCH || sources.every((s) => this.members.has(s.uid))) {
      if (!sources || sources.length < MIN_BATCH) this.clear()
      return
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; this.build() }, REBUILD_MS)
  }

  /** Show every object's own mesh again and drop the merged ones. */
  clear() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (!this.members.size && !this.root.children.length) return
    for (const m of this.members.values()) m.mesh.visible = true
    this.members.clear()
    for (const c of [...this.root.children] as THREE.Mesh[]) {
      c.geometry.dispose()
      ;(c.material as THREE.Material).dispose()
      this.root.remove(c)
    }
    this.changed()
  }

  private build() {
    const sources = this.collect()
    this.clear()
    if (!sources || sources.length < MIN_BATCH) return
    type Bucket = { material: THREE.MeshLambertMaterial; pos: number[]; nor: number[]; uv: number[]; index: number[] }
    const buckets = new Map<string, Bucket>()
    const v = new THREE.Vector3()
    const normalMatrix = new THREE.Matrix3()
    for (const s of sources) {
      const { mesh } = s
      const g = mesh.geometry
      const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), uv = g.getAttribute('uv'), idx = g.getIndex()
      if (!pos || !nor || !uv || !idx) continue
      mesh.updateWorldMatrix(true, false)
      normalMatrix.getNormalMatrix(mesh.matrixWorld)
      const mats = mesh.material as THREE.MeshLambertMaterial[]
      for (const group of g.groups) {
        const mat = mats[group.materialIndex ?? 0]
        if (!mat) continue
        const key = matKey(mat)
        let b = buckets.get(key)
        if (!b) {
          b = { material: mat.clone(), pos: [], nor: [], uv: [], index: [] }
          buckets.set(key, b)
        }
        const remap = new Map<number, number>()
        for (let i = group.start; i < group.start + group.count; i++) {
          const vi = idx.getX(i)
          let ni = remap.get(vi)
          if (ni === undefined) {
            ni = b.pos.length / 3
            remap.set(vi, ni)
            v.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld)
            b.pos.push(v.x, v.y, v.z)
            v.fromBufferAttribute(nor, vi).applyMatrix3(normalMatrix).normalize()
            b.nor.push(v.x, v.y, v.z)
            b.uv.push(uv.getX(vi), uv.getY(vi))
          }
          b.index.push(ni)
        }
      }
      this.members.set(s.uid, { mesh, sig: s.sig })
    }
    for (const b of buckets.values()) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3))
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2))
      geo.setIndex(b.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.index, 1) : new THREE.Uint16BufferAttribute(b.index, 1))
      geo.computeBoundingSphere()
      const merged = new THREE.Mesh(geo, b.material)
      merged.raycast = () => {}
      merged.matrixAutoUpdate = false
      this.root.add(merged)
    }
    for (const m of this.members.values()) m.mesh.visible = false
    this.changed()
  }

  dispose() { this.clear() }
}
