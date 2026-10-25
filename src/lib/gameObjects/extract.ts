// Cuts one library entry out of its chunk as a mesh ready to place: its triangles (only the vertices its strips
// use), stood the way the game stands it but facing a fixed way (the turn about the vertical is taken out), with
// its feet at the origin. Buildings keep their parts where they stand relative to each other. Coordinates are the
// game's own (metres, its handedness); see place.ts for the editor's. Each material keeps how the game draws it
// (material.ts) and the mesh keeps the UV sets and normals its layers need.
import { meshTriangles, type Chunk } from './chunk'
import { upAxis, yawOf } from './indexer'
import { describeMaterial, lookKey, type GameLook } from './material'

export interface ObjectMesh {
  positions: Float32Array
  /** First UV set as stored: v = 0 at the top of the picture. */
  uvs: Float32Array
  /** Three vertex indices per triangle, wound as the game's strips decode. */
  triangles: Uint32Array
  /** Index into `materials` per triangle. */
  triMaterial: Uint16Array
  /** One per distinct look: the diffuse texture name (the picture placed and exported), or '' for a material without one. */
  materials: string[]
  /** UV sets 1-3 per vertex, as stored (absent: the mesh has none). */
  extraUvs?: Float32Array[]
  /** Stored unit normals per vertex, turned like the positions (absent: none stored). */
  normals?: Float32Array
  /** Per material: how the game draws it, or null for one picture on UV0 as before. */
  looks?: (GameLook | null)[]
}

export interface ObjectRef { chunk: string; record: number; parts?: number[] }

/** The picture earlier versions placed for a material: its first that isn't a normal map. */
export const diffuseOf = (ch: Chunk, mi: number) => ch.materials[mi]?.textures.find((x) => !/\.tgn$/i.test(x)) ?? ''

/** A chunk material's look for geometry with `uvSets` UV sets, worked out once per pair. */
export function lookCache(ch: Chunk) {
  const memo = new Map<number, { tex: string; look: GameLook | null; key: string }>()
  return (mi: number, uvSets: number) => {
    const k = mi * 8 + Math.min(uvSets, 7)
    let v = memo.get(k)
    if (!v) {
      const tex = diffuseOf(ch, mi)
      const m = ch.materials[mi]
      const look = m ? describeMaterial(m, uvSets) : null
      v = { tex, look, key: lookKey(tex, look) }
      memo.set(k, v)
    }
    return v
  }
}

export function extractObject(ch: Chunk, ref: Pick<ObjectRef, 'record' | 'parts'>): ObjectMesh {
  const records = ref.parts?.length ? ref.parts : [ref.record]
  const single = records.length === 1
  const pos: number[] = [], uv: number[] = [], tris: number[] = [], triMat: number[] = [], nrm: number[] = []
  const extra: number[][] = [[], [], []]
  let nExtra = 0, anyNormals = false
  const matIndex = new Map<string, number>()
  const materials: string[] = [], looks: (GameLook | null)[] = []
  const lookOf = lookCache(ch)
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
    const turn = (x: number, y: number, z: number, out: number[], add: number[]) => {
      const wx = x * R[0] + y * R[3] + z * R[6], wy = x * R[1] + y * R[4] + z * R[7], wz = x * R[2] + y * R[5] + z * R[8]
      out.push(wx * c + wz * s + add[0], wy + add[1], -wx * s + wz * c + add[2])
    }
    for (let i = 0; i < part.positions.length; i += 3) turn(part.positions[i], part.positions[i + 1], part.positions[i + 2], pos, t)
    if (part.normals) {
      // Vertices from earlier parts without stored normals get zeros (the viewer works those out itself).
      if (!anyNormals) { for (let i = 0; i < base * 3; i++) nrm.push(0); anyNormals = true }
      for (let i = 0; i < part.normals.length; i += 3) turn(part.normals[i], part.normals[i + 1], part.normals[i + 2], nrm, [0, 0, 0])
    } else if (anyNormals) for (let i = 0; i < part.positions.length; i++) nrm.push(0)
    for (let i = 0; i < part.uvs.length; i++) uv.push(part.uvs[i])
    nExtra = Math.max(nExtra, part.extraUvs.length)
    for (let k = 0; k < 3; k++) {
      const src = part.extraUvs[k]
      for (let i = 0; i < part.uvs.length; i++) extra[k].push(src ? src[i] : 0)
    }
    for (let i = 0; i < part.triangles.length; i++) tris.push(part.triangles[i] + base)
    for (let i = 0; i < part.triMaterial.length; i++) {
      const l = lookOf(part.triMaterial[i], part.triUvSets[i])
      let m = matIndex.get(l.key)
      if (m === undefined) { m = materials.length; materials.push(l.tex); looks.push(l.look); matIndex.set(l.key, m) }
      triMat.push(m)
    }
  }
  if (!tris.length) throw new Error('This object has no triangles the editor can read.')
  // Feet at the origin, centred across.
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]) }
  const shift = [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2]
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) pos[i + k] += shift[k]
  return {
    positions: new Float32Array(pos), uvs: new Float32Array(uv), triangles: new Uint32Array(tris), triMaterial: new Uint16Array(triMat), materials,
    ...(nExtra ? { extraUvs: extra.slice(0, nExtra).map((e) => new Float32Array(e)) } : {}),
    ...(anyNormals ? { normals: new Float32Array(nrm) } : {}),
    ...(looks.some(Boolean) ? { looks } : {}),
  }
}
