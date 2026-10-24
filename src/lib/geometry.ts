// JavaScript ports of the small geometry helpers the editor needs every frame.
// parseObj must match sr1_obj_core.parse_obj_attrs face-for-face, because
// collision face IDs picked in the viewport are sent to the Python exporter.
import type { SceneItem, Vec3 } from './project'

export interface ObjModel {
  positions: Float32Array // per native vertex (split by v/vt/vn corner key)
  uvs: Float32Array // 0,0 where the corner has no UV
  hasUv: Uint8Array
  /** Authored normals per native vertex (0,0,0 where the corner has none); absent when the file has none. */
  normals?: Float32Array
  faces: Uint32Array // 3 native vertex ids per triangle, in source order
  /** The OBJ position ("v" line, 0-based) each native vertex came from (data kept per OBJ vertex, like a game object's look, maps through it). */
  vIndex?: Uint32Array
  faceMat: Uint16Array // index into mats
  mats: string[]
  mtllibs: string[]
}

const objIndex = (s: string | undefined, n: number): number | null => {
  if (s === undefined || s === '') return null
  const x = parseInt(s, 10)
  return x > 0 ? x - 1 : n + x
}

export function parseObj(text: string): ObjModel {
  const pos: number[] = []
  const tex: number[] = []
  const nrm: number[] = []
  const mats: string[] = []
  const matIndex = new Map<string, number>()
  let mat = '(default)'
  const corner = new Map<string, number>()
  const outPos: number[] = []
  const outUv: number[] = []
  const outHasUv: number[] = []
  const outN: number[] = []
  const outV: number[] = []
  const faces: number[] = []
  const faceMat: number[] = []
  const mtllibs: string[] = []

  const nativeId = (vi: number | null, ti: number | null, ni: number | null) => {
    const key = `${vi}/${ti}/${ni}`
    let id = corner.get(key)
    if (id !== undefined) return id
    if (vi === null || vi < 0 || vi >= pos.length / 3) throw new Error('OBJ face references an invalid position index')
    id = corner.size
    corner.set(key, id)
    outPos.push(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2])
    outV.push(vi)
    if (ti !== null && ti >= 0 && ti < tex.length / 2) { outUv.push(tex[ti * 2], tex[ti * 2 + 1]); outHasUv.push(1) }
    else { outUv.push(0, 0); outHasUv.push(0) }
    if (ni !== null && ni >= 0 && ni < nrm.length / 3) outN.push(nrm[ni * 3], nrm[ni * 3 + 1], nrm[ni * 3 + 2])
    else outN.push(0, 0, 0)
    return id
  }

  const lines = text.split(/\r?\n|\r/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line[0] === '#') continue
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/)
      pos.push(parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3]))
    } else if (line.startsWith('vt ')) {
      const p = line.split(/\s+/)
      tex.push(parseFloat(p[1]), parseFloat(p[2]))
    } else if (line.startsWith('vn ')) {
      const p = line.split(/\s+/)
      nrm.push(parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3]))
    } else if (line.startsWith('usemtl ')) {
      mat = line.slice(7).trim()
    } else if (line.startsWith('mtllib ')) {
      mtllibs.push(line.slice(7).trim())
    } else if (line.startsWith('f ')) {
      const corners: [number | null, number | null, number | null][] = []
      const toks = line.split(/\s+/).slice(1)
      for (const tok of toks) {
        const q = tok.split('/')
        corners.push([objIndex(q[0], pos.length / 3), q.length > 1 ? objIndex(q[1], tex.length / 2) : null, q.length > 2 ? objIndex(q[2], nrm.length / 3) : null])
      }
      let mi = matIndex.get(mat)
      if (mi === undefined) { mi = mats.length; mats.push(mat); matIndex.set(mat, mi) }
      for (let i = 1; i < corners.length - 1; i++) {
        faces.push(nativeId(...corners[0]), nativeId(...corners[i]), nativeId(...corners[i + 1]))
        faceMat.push(mi)
      }
    }
  }
  return {
    positions: new Float32Array(outPos), uvs: new Float32Array(outUv), hasUv: new Uint8Array(outHasUv),
    ...(nrm.length ? { normals: new Float32Array(outN) } : {}),
    faces: new Uint32Array(faces), faceMat: new Uint16Array(faceMat), mats, mtllibs, vIndex: new Uint32Array(outV),
  }
}

/** Material names as the exporter sees them (`f[3] or 'default'`). */
export const exportMatName = (m: string) => m || 'default'

/** MTL newmtl -> map_Kd (last token, like the desktop parser). */
export function parseMtl(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  let cur: string | null = null
  for (const raw of text.split(/\r?\n|\r/)) {
    const line = raw.trim()
    if (!line || line[0] === '#') continue
    const lo = line.toLowerCase()
    if (lo.startsWith('newmtl ')) cur = line.slice(7).trim()
    else if (cur && lo.startsWith('map_kd ')) {
      const parts = line.match(/"[^"]*"|\S+/g) || []
      if (parts.length >= 2) out[cur] = parts[parts.length - 1].replace(/^"|"$/g, '')
    }
  }
  return out
}

const rad = (d: number) => (d * Math.PI) / 180

/** sr1_scene.transform: roll Z, pitch X, then heading Y; then translate. */
export function transformPoint(p: ArrayLike<number>, item: Pick<SceneItem, 'position' | 'rotation' | 'scale' | 'pivot'>): Vec3 {
  const pivot = item.pivot || [0, 0, 0]
  const s = item.scale ?? 1
  let x = (p[0] - pivot[0]) * s
  let y = (p[1] - pivot[1]) * s
  let z = (p[2] - pivot[2]) * s
  const [rx, ry, rz] = (item.rotation || [0, 0, 0]).map(rad)
  ;[x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)]
  ;[y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)]
  ;[x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)]
  return [x + item.position[0], y + item.position[1], z + item.position[2]]
}

/** sr1_scene.mesh_pivot: center of used vertex bounds (bottom = min Y). */
export function meshPivot(model: ObjModel, bottom = false): Vec3 {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let f = 0; f < model.faces.length; f++) {
    const v = model.faces[f] * 3
    for (let a = 0; a < 3; a++) {
      const c = model.positions[v + a]
      if (c < lo[a]) lo[a] = c
      if (c > hi[a]) hi[a] = c
    }
  }
  if (!model.faces.length) throw new Error('The selected object has no mesh faces.')
  return [0, 1, 2].map((a) => (bottom && a === 1 ? lo[a] : (lo[a] + hi[a]) / 2)) as Vec3
}

/** sr1_scene.set_pivot: new local origin, same world placement. */
export function withPivot<T extends SceneItem>(item: T, pivot: Vec3): T {
  if (!pivot.every(Number.isFinite)) throw new Error('Object pivot must contain three finite XYZ coordinates.')
  const position = transformPoint(pivot, item)
  return { ...item, pivot: [...pivot] as Vec3, position }
}

/** Ground Y=0 (desktop "Ground" button): lowest transformed vertex to zero. */
export function groundOffset(model: ObjModel, item: SceneItem): number {
  let ymin = Infinity
  const at = { ...item, position: [0, 0, 0] as Vec3 }
  for (let i = 0; i < model.positions.length; i += 3) {
    const y = transformPoint(model.positions.subarray(i, i + 3), at)[1]
    if (y < ymin) ymin = y
  }
  return -ymin
}

export function modelBounds(model: ObjModel) {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < model.positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const c = model.positions[i + a]
      if (c < lo[a]) lo[a] = c
      if (c > hi[a]) hi[a] = c
    }
  }
  return { lo: lo as Vec3, hi: hi as Vec3 }
}
