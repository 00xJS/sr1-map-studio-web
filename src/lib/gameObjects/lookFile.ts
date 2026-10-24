// The "look" file kept beside a placed game object's OBJ (origin 'game', on this device only): how each of its
// materials is drawn (material.ts, with picture names swapped for this browser's stored files) and the vertex data
// the OBJ can't hold: UV sets 1-3 and the stored normals, one entry per OBJ vertex ("v" line), in editor space.
// The exporter doesn't read it; the editor's viewer draws the game's layers from it (src/editor/gameMaterial.ts).
import type { GameLook, LookLayer } from './material'

const MAGIC = 0x53524c4b // "SRLK"
export const LOOK_VERSION = 1

/** A material's look with stored file paths in place of picture names; `diffuse` is the picture the OBJ material uses. */
export interface StoredLook { diffuse: string; look: GameLook }

export interface LookData {
  /** OBJ material name -> look. */
  mats: Record<string, StoredLook>
  vertices: number
  /** UV sets 1.. per vertex (u, v as stored by the game: v = 0 at the top of the picture). */
  uvs: Float32Array[]
  /** Unit normals per vertex, editor space (zeros: none stored there); absent when none. */
  normals?: Float32Array
}

/** Where a placed object's look lives: the look file and the pictures its layers use (all origin 'game'). */
export interface GameLookRef { path: string; layers: string[] }

export function encodeLook(d: LookData): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify({ v: LOOK_VERSION, vertices: d.vertices, uvSets: d.uvs.length, normals: !!d.normals, mats: d.mats }))
  const pad = (4 - ((12 + head.length) % 4)) % 4
  const arrays = [...d.uvs, ...(d.normals ? [d.normals] : [])]
  for (const [i, a] of arrays.entries()) {
    const want = (i < d.uvs.length ? 2 : 3) * d.vertices
    if (a.length !== want) throw new Error(`look data: array ${i} has ${a.length} values, expected ${want}`)
  }
  const out = new Uint8Array(12 + head.length + pad + arrays.reduce((n, a) => n + a.byteLength, 0))
  const dv = new DataView(out.buffer)
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, LOOK_VERSION, true); dv.setUint32(8, head.length, true)
  out.set(head, 12)
  let at = 12 + head.length + pad
  for (const a of arrays) { out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at); at += a.byteLength }
  return out
}

export function decodeLook(bytes: Uint8Array): LookData {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 12 || dv.getUint32(0, true) !== MAGIC) throw new Error('not a look file')
  const n = dv.getUint32(8, true)
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + n)))
  if (h.v !== LOOK_VERSION) throw new Error('unsupported look file version ' + h.v)
  let at = 12 + n + ((4 - ((12 + n) % 4)) % 4)
  const take = (count: number) => {
    const a = new Float32Array(count)
    new Uint8Array(a.buffer).set(bytes.subarray(at, at + 4 * count))
    at += 4 * count
    return a
  }
  const uvs = Array.from({ length: h.uvSets }, () => take(2 * h.vertices))
  const normals = h.normals ? take(3 * h.vertices) : undefined
  return { mats: h.mats, vertices: h.vertices, uvs, ...(normals ? { normals } : {}) }
}

/** The look with each picture name swapped by `path` (null: that layer is dropped, e.g. its picture wasn't found). */
export function mapLookTextures(l: GameLook, path: (tex: string) => string | null): GameLook {
  const one = <T extends LookLayer>(x: T | undefined): T | undefined => {
    if (!x) return undefined
    const p = path(x.tex)
    return p ? { ...x, tex: p } : undefined
  }
  return {
    ...l, base: one(l.base), base2: one(l.base2), mask: one(l.mask), normal: one(l.normal),
    specular: { ...l.specular, map: one(l.specular.map) },
    decals: l.decals.flatMap((d) => { const layer = one(d.layer); return layer ? [{ ...d, layer }] : [] }),
  }
}
