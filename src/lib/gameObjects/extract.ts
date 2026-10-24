// Cuts one library entry out of its chunk as a mesh ready to place: its triangles (only the vertices its strips
// use), stood the way the game stands it but facing a fixed way (the turn about the vertical is taken out), with
// its feet at the origin. Buildings keep their parts where they stand relative to each other. Coordinates are the
// game's own (metres, its handedness); see place.ts for the editor's.
import { meshTriangles, type Chunk } from './chunk'
import { upAxis } from './indexer'

export interface ObjectMesh {
  positions: Float32Array
  /** First UV set as stored: v = 0 at the top of the picture. */
  uvs: Float32Array
  /** Three vertex indices per triangle, wound as the game's strips decode. */
  triangles: Uint32Array
  /** Index into `materials` per triangle. */
  triMaterial: Uint16Array
  /** One per distinct texture: the diffuse texture name, or '' for a material without one. */
  materials: string[]
}

export interface ObjectRef { chunk: string; record: number; parts?: number[] }

/** The vertical turn of an instance: the angle its first level axis makes with +X, about +Y. */
function yawOf(R: number[], up: number) {
  const h = [0, 1, 2].find((k) => k !== up)!
  return Math.atan2(R[3 * h + 2], R[3 * h])
}

export function extractObject(ch: Chunk, ref: Pick<ObjectRef, 'record' | 'parts'>): ObjectMesh {
  const records = ref.parts?.length ? ref.parts : [ref.record]
  const single = records.length === 1
  const pos: number[] = [], uv: number[] = [], tris: number[] = [], triMat: number[] = []
  const matIndex = new Map<string, number>()
  const materials: string[] = []
  // A record number below 0 is a piece placed without a record: -(instance + 1).
  const instOf = (ri: number) => (ri < 0 ? ch.instances[-ri - 1] : ch.instances[ch.records[ri]?.instance])
  // Buildings: parts placed about the first part's position.
  const first = instOf(records[0])
  if (!first) throw new Error('record ' + records[0] + ' has no placement in the chunk')
  const origin = single ? [0, 0, 0] : first.position
  for (const ri of records) {
    const inst = instOf(ri)
    if (!inst || !ch.meshes[inst.mesh]) continue
    const part = meshTriangles(ch, inst.mesh)
    const R = inst.rotation
    // A single object loses its turn about the vertical, so every copy comes in facing the same way.
    const yaw = single ? yawOf(R, upAxis(R)) : 0
    const c = Math.cos(yaw), s = Math.sin(yaw)
    const t = single ? [0, 0, 0] : [inst.position[0] - origin[0], inst.position[1] - origin[1], inst.position[2] - origin[2]]
    const base = pos.length / 3
    for (let i = 0; i < part.positions.length; i += 3) {
      const x = part.positions[i], y = part.positions[i + 1], z = part.positions[i + 2]
      const wx = x * R[0] + y * R[3] + z * R[6], wy = x * R[1] + y * R[4] + z * R[7], wz = x * R[2] + y * R[5] + z * R[8]
      pos.push(wx * c + wz * s + t[0], wy + t[1], -wx * s + wz * c + t[2])
    }
    for (let i = 0; i < part.uvs.length; i++) uv.push(part.uvs[i])
    for (let i = 0; i < part.triangles.length; i++) tris.push(part.triangles[i] + base)
    for (let i = 0; i < part.triMaterial.length; i++) {
      const tex = ch.materials[part.triMaterial[i]]?.textures.find((x) => !/\.tgn$/i.test(x)) ?? ''
      let m = matIndex.get(tex.toLowerCase())
      if (m === undefined) { m = materials.length; materials.push(tex); matIndex.set(tex.toLowerCase(), m) }
      triMat.push(m)
    }
  }
  if (!tris.length) throw new Error('This object has no triangles the editor can read.')
  // Feet at the origin, centred across.
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]) }
  const shift = [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2]
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) pos[i + k] += shift[k]
  return { positions: new Float32Array(pos), uvs: new Float32Array(uv), triangles: new Uint32Array(tris), triMaterial: new Uint16Array(triMat), materials }
}
