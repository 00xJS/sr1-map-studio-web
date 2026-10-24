// Reads the parts of a Saints Row map chunk (.bbchunk_xbox2, version 85, big-endian) that the "From my game"
// library needs: the string table, the instance table, the render geometry (vertex buffers, materials, meshes)
// and the named static records with their physics profile names. A TypeScript port of the reading half of
// read_chunk / read_geometry in studio-py/sr_reborn_core.py (GPL-3.0-or-later); the sections after the static
// records are not walked. Runs in the game-objects worker and in Node tests. Nothing here writes a chunk.

const MAGIC = 0xbbcaca12
const VERSION = 85

const al = (c: number, a: number) => Math.ceil(c / a) * a

export interface VertexBuffer {
  /** Vertex count, stride in bytes, and where the vertices and the 16-bit indices sit in the chunk. */
  count: number
  stride: number
  vertexAt: number
  vertexBytes: number
  indexAt: number
  indexCount: number
  /**
   * The vertex layout, told from the stride and the bytes: lit world geometry (position, DEC3N normal and
   * tangent at 12 and 16, then 1-4 SHORT2 UV sets from 20) or position and UV sets only (sky, clouds, shadow
   * volumes; UV sets from 12). `uvAt` is -1 when there is no UV set.
   */
  lit: boolean
  uvAt: number
  uvSets: number
}

export interface Batch { first: number; count: number; material: number }
export interface SubMesh { vb: number; batches: Batch[] }
export interface Mesh { min: [number, number, number]; max: [number, number, number]; subs: SubMesh[] }
/** A texture parameter of a material: the shader slot (name hash, e.g. Diffuse_Map) and the picture it names. */
export interface TextureSlot { slot: number; texture: string }
/** A named constant (name hash) with its four values. */
export interface MaterialConst { name: number; values: [number, number, number, number] }
/** A per-axis address mode on one texture parameter (index into `slots`): axis 1 = U, 2 = V; mode 3 = clamp. */
export interface AddressMode { param: number; axis: number; mode: number }

/**
 * A material record as stored: the shader (hash of the effect's name), the material key, the flags (3 normal,
 * 0xB self-lit/glowing, 4 stencil shadow), every texture slot, the engine-bound textures, the tiling and other
 * constants, and the address-mode overrides (clamped decals).
 */
export interface Material {
  /** Picture names among the slots (any slot), in record order: what earlier versions kept. */
  textures: string[]
  shader: number
  key: number
  flags: number
  slots: TextureSlot[]
  engine: { name: number; id: number }[]
  tiling: MaterialConst[]
  constants: MaterialConst[]
  address: AddressMode[]
}

export interface StaticRecord {
  name: string
  flags: number
  /** Index into the chunk's physics shape bank, or -1 for none. */
  shape: number
  instance: number
  profile: string
}

export interface Instance { position: [number, number, number]; rotation: number[]; mesh: number; flags: number }

export interface Chunk {
  bytes: Uint8Array
  strings: string[]
  instances: Instance[]
  vbs: VertexBuffer[]
  materials: Material[]
  meshes: Mesh[]
  records: StaticRecord[]
  /** Where the collision blob (one MOPP block per mesh, then one over the instances) sits in `bytes`. */
  coll: { at: number; size: number }
}

class Reader {
  dv: DataView
  constructor(public b: Uint8Array) { this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength) }
  check(o: number, n: number) { if (o < 0 || o + n > this.b.length) throw new Error('read past end of chunk data') }
  u32(o: number) { this.check(o, 4); return this.dv.getUint32(o) }
  i32(o: number) { this.check(o, 4); return this.dv.getInt32(o) }
  u16(o: number) { this.check(o, 2); return this.dv.getUint16(o) }
  s16(o: number) { this.check(o, 2); return this.dv.getInt16(o) }
  f32(o: number) { this.check(o, 4); return this.dv.getFloat32(o) }
  /** A NUL-terminated Latin-1 string; returns it and the offset after its NUL. */
  cstr(o: number): [string, number] {
    const z = this.b.indexOf(0, o)
    if (z < 0) throw new Error('unterminated string in chunk')
    let s = ''
    for (let i = o; i < z; i++) s += String.fromCharCode(this.b[i])
    return [s, z + 1]
  }
}

interface Front { strings: string[]; meshes: number; instances: number; vbs: number; a164: number; inst: number; geo: number }

/** A signed 10-bit field of a DEC3N word (x bits 0-9, y 10-19, z 20-29), as -1..1. */
const dec10 = (w: number, k: number) => { let v = (w >>> (10 * k)) & 1023; if (v >= 512) v -= 1024; return v / 511 }

/** A DEC3N word as (x, y, z, w): w is the top two bits as a signed number (1 = +1, 3 = -1, 0 = 0). */
export function dec3n(w: number): [number, number, number, number] {
  const top = (w >>> 30) & 3
  return [dec10(w, 0), dec10(w, 1), dec10(w, 2), top === 3 ? -1 : top === 1 ? 1 : top === 2 ? -2 : 0]
}

/**
 * Which vertex layout a buffer has. Lit world geometry is position, DEC3N normal, DEC3N tangent, then the UV
 * sets (stride 24-36); the rest is position and UV sets. The stride alone can't tell 24 and 28 apart, so the
 * normals of the first vertices decide: unit length for lit geometry.
 */
export function vertexLayout(dv: DataView, v: Pick<VertexBuffer, 'count' | 'stride' | 'vertexAt' | 'vertexBytes'>): { lit: boolean; uvAt: number; uvSets: number } {
  const s = v.stride
  if (s >= 24 && s <= 36 && s % 4 === 0 && v.count && v.vertexBytes >= s * v.count) {
    const n = Math.min(v.count, 16)
    let unit = 0
    for (let i = 0; i < n; i++) {
      const [x, y, z] = dec3n(dv.getUint32(v.vertexAt + s * i + 12))
      const l = Math.hypot(x, y, z)
      if (l > 0.85 && l < 1.15) unit++
    }
    if (unit * 2 >= n) return { lit: true, uvAt: 20, uvSets: (s - 20) / 4 }
  }
  if (s >= 16 && s % 4 === 0 && s <= 28) return { lit: false, uvAt: 12, uvSets: (s - 12) / 4 }
  // Older reading: one UV set at 20 for any stride that has room for it.
  return s >= 24 ? { lit: false, uvAt: 20, uvSets: 1 } : { lit: false, uvAt: -1, uvSets: 0 }
}

function parseFront(r: Reader): Front {
  if (r.b.length < 968 || r.u32(0) !== MAGIC) throw new Error('not a Saints Row map chunk (.bbchunk_xbox2)')
  if (r.u32(4) !== VERSION) throw new Error('unsupported chunk version ' + r.u32(4))
  let c = al(968, 64)
  const n = r.u32(c)
  c += 4 + 4 * n
  const strings: string[] = []
  for (let i = 0; i < n; i++) { const [s, next] = r.cstr(c); strings.push(s); c = next }
  c = al(c, 64)
  const meshes = r.u32(c), instances = r.u32(c + 4), vbs = r.u32(c + 8), c180 = r.u32(c + 12)
  c = al(c + 16, 64)
  const a164 = c
  c = al(c + 16 * meshes, 64)
  const inst = c
  c = al(c + 112 * instances, 64)
  c += 100 * c180
  c = al(al(c, 64), 64)
  const blobSize = r.u32(c)
  c = al(c + 4 + blobSize, 64)
  return { strings, meshes, instances, vbs, a164, inst, geo: c }
}

/** The render geometry from `at`; returns where it ends (the static records follow). */
function readGeometry(r: Reader, f: Front): { vbs: VertexBuffer[]; materials: Material[]; meshes: Mesh[]; end: number; coll: { at: number; size: number } } {
  let c = f.geo
  const nv = f.vbs
  const coll = { at: c + 4, size: r.u32(c) }
  r.check(coll.at, coll.size)
  c += 4 + coll.size // collision blob
  c = al(c + 24, 4)
  c += 4 * nv // vertex buffer pointers
  const aux: number[] = []
  for (let i = 0; i < nv; i++) aux.push(r.u32(c + 4 * i))
  c = al(c + 4 * nv, 64)
  const descs: number[] = []
  for (let i = 0; i < nv; i++) {
    c = al(c, 16)
    descs.push(c)
    c += 88
    if (aux[i]) {
      c = al(c, 16)
      const h = c
      c += 16
      if (r.u32(h)) { c = al(c, 32); c += r.u16(h + 8) * 2 }
      if (r.u32(h + 4)) { c = al(c, 32); c += r.u16(h + 10) * 2 }
    }
  }
  c = al(c, 4096)
  const vbs: VertexBuffer[] = []
  for (const d of descs) {
    const v: VertexBuffer = { count: r.u16(d + 12), stride: r.u16(d + 16), vertexAt: 0, vertexBytes: 0, indexAt: 0, indexCount: 0, lit: false, uvAt: -1, uvSets: 0 }
    if (r.u32(d + 8)) { c = al(c, 32); v.indexAt = c; v.indexCount = r.u16(d + 14); c += v.indexCount * 2 }
    if (r.u32(d + 4)) { c = al(c, 32); v.vertexAt = c; v.vertexBytes = v.stride * v.count; c += v.vertexBytes }
    r.check(v.indexAt, v.indexCount * 2); r.check(v.vertexAt, v.vertexBytes)
    Object.assign(v, vertexLayout(r.dv, v))
    vbs.push(v)
  }
  c = al(al(c, 4096), 16)
  const nm = r.u16(c), n2 = r.u16(c + 2)
  c += 12
  const materials: Material[] = []
  if (nm) {
    c = al(c, 16)
    const mb = c
    c = al(c + nm * 56, 16)
    for (let i = 0; i < nm; i++) {
      const m = mb + 56 * i
      const take = (a: number, k: number) => { c = al(c, a); const at = c; c += k; return at }
      const params = take(4, r.u16(m + 10) * 12)
      const textures: string[] = [], slots: TextureSlot[] = []
      for (let j = 0; j < r.u16(m + 10); j++) {
        const ix = r.u32(params + 12 * j + 4)
        const s = f.strings[ix]
        slots.push({ slot: r.u32(params + 12 * j), texture: s ?? '' })
        if (s && /\.(tga|tgn|dds|png)$/i.test(s)) textures.push(s)
      }
      const ne = Math.max(r.s16(m + 20), 0)
      const eb = take(4, ne * 8)
      const engine = Array.from({ length: ne }, (_, j) => ({ name: r.u32(eb + 8 * j), id: r.u32(eb + 8 * j + 4) }))
      const lists: MaterialConst[][] = []
      for (const off of [28, 40]) {
        const n = r.u16(m + off)
        const at = take(16, n * 24)
        lists.push(Array.from({ length: n }, (_, j) => {
          const o = at + 24 * j
          return { name: r.u32(o), values: [r.f32(o + 8), r.f32(o + 12), r.f32(o + 16), r.f32(o + 20)] as [number, number, number, number] }
        }))
        take(16, r.u16(m + off + 2) * 2)
      }
      const na = r.u16(m + 8)
      const ab = take(4, na * 6)
      const address = Array.from({ length: na }, (_, j) => ({ param: r.u16(ab + 6 * j), axis: r.u16(ab + 6 * j + 2), mode: r.u16(ab + 6 * j + 4) }))
      materials.push({ textures, shader: r.u32(m), key: r.u32(m + 4), flags: r.u16(m + 18), slots, engine, tiling: lists[0], constants: lists[1], address })
    }
  }
  if (n2) {
    c = al(c, 4)
    const eb = c
    c += n2 * 16
    for (let i = 0; i < n2; i++) { c = al(c, 4); c += r.u16(eb + 16 * i + 8) * 4 }
  }
  const meshes: Mesh[] = []
  for (let i = 0; i < f.meshes; i++) {
    const e = f.a164 + 16 * i
    if (r.u32(e + 4)) c += 48 + r.u32(c + 36) * 12 + r.u32(c + 28) * 4 + r.u32(c + 44) * 2
    c = al(c, 4)
    const h = c
    c = al(c + 40, 16)
    const k = r.s16(h + 28)
    if (k < 0) throw new Error('bad submesh count')
    const s32 = c
    c += 16 * k
    const has36 = r.u32(h + 36) !== 0
    let s36 = 0
    if (has36) { c = al(c, 16); s36 = c; c += 12 * k }
    const subs: SubMesh[] = []
    for (let j = 0; j < k; j++) {
      const s = s32 + 16 * j
      const nb = r.u16(s + 2)
      const batches: Batch[] = []
      if (nb) {
        c = al(c, 16)
        for (let b = 0; b < nb; b++) batches.push({ first: r.u32(c + 8 * b), count: r.u16(c + 8 * b + 4), material: r.u16(c + 8 * b + 6) })
        c += nb * 8
      }
      if (has36) { const n12 = r.u16(s36 + 12 * j + 2); if (n12) { c = al(c, 16); c += n12 * 8 } }
      subs.push({ vb: r.u32(s + 8), batches })
    }
    meshes.push({ min: [r.f32(h), r.f32(h + 4), r.f32(h + 8)], max: [r.f32(h + 12), r.f32(h + 16), r.f32(h + 20)], subs })
  }
  return { vbs, materials, meshes, end: c, coll }
}

/** Static records start right after the geometry; then the record blob that holds the profile names. */
function readRecords(r: Reader, geoEnd: number): StaticRecord[] {
  const n = r.u32(868)
  let c = al(geoEnd, 64)
  const recAt = c
  c += 80 * n
  r.check(recAt, 80 * n)
  const names: string[] = []
  for (let i = 0; i < n; i++) { const [s, next] = r.cstr(c); names.push(s); c = next }
  c = al(c, 64)
  const blobAt = c, blobSize = r.u32(c)
  const out: StaticRecord[] = []
  for (let i = 0; i < n; i++) {
    const a = recAt + 80 * i
    const off = r.u32(a + 64)
    let profile = ''
    if (off !== 0xffffffff && off + 4 < blobSize + 4) profile = r.cstr(blobAt + 4 + off)[0]
    const shape = r.u16(a + 56)
    out.push({ name: names[i], flags: r.u32(a + 32), shape: shape === 0xffff ? -1 : shape, instance: r.u32(a + 60), profile })
  }
  return out
}

export function readChunk(bytes: Uint8Array): Chunk {
  const r = new Reader(bytes)
  const f = parseFront(r)
  const g = readGeometry(r, f)
  const instances: Instance[] = []
  for (let i = 0; i < f.instances; i++) {
    const a = f.inst + 112 * i
    const rotation: number[] = []
    for (let k = 0; k < 9; k++) rotation.push(r.f32(a + 16 + 4 * k))
    instances.push({ position: [r.f32(a + 4), r.f32(a + 8), r.f32(a + 12)], rotation, mesh: r.u32(a + 104), flags: r.u32(a + 108) })
  }
  return { bytes, strings: f.strings, instances, vbs: g.vbs, materials: g.materials, meshes: g.meshes, records: readRecords(r, g.end), coll: g.coll }
}

// ---------------- triangles of one mesh ----------------

export interface MeshPart {
  /** Vertex positions (x, y, z), in the mesh's own frame, metres. */
  positions: Float32Array
  /** First UV set, as stored (u, v with v = 0 at the top of the picture), or zeros for layouts without one. */
  uvs: Float32Array
  /** Triangles, three vertex indices each, wound as the game's strips decode. */
  triangles: Uint32Array
  /** Material index of each triangle. */
  triMaterial: Uint16Array
  /** UV sets 1-3 (u, v per vertex, as stored), as many as the mesh's buffers have; zeros where a buffer has fewer. */
  extraUvs: Float32Array[]
  /** Stored unit normals and tangents (x, y, z, sign of the bitangent), mesh frame; null when no buffer is lit. */
  normals: Float32Array | null
  tangents: Float32Array | null
}

/** Reads UV set `k` of vertex `i` (stored as SHORT2 / 1024) into `out` at `at`. */
export function readUv(dv: DataView, vb: VertexBuffer, i: number, k: number, out: { [n: number]: number }, at: number) {
  if (vb.uvAt < 0 || k >= vb.uvSets) { out[at] = 0; out[at + 1] = 0; return }
  const o = vb.vertexAt + vb.stride * i + vb.uvAt + 4 * k
  out[at] = dv.getInt16(o) / 1024
  out[at + 1] = dv.getInt16(o + 2) / 1024
}

/** Every triangle of a mesh, with only the vertices its strips use (vertex buffers are shared between meshes). */
export function meshTriangles(ch: Chunk, meshIndex: number): MeshPart {
  const mesh = ch.meshes[meshIndex]
  if (!mesh) throw new Error('mesh ' + meshIndex + ' is not in the chunk')
  const dv = new DataView(ch.bytes.buffer, ch.bytes.byteOffset, ch.bytes.byteLength)
  const pos: number[] = [], uv: number[] = [], tris: number[] = [], mats: number[] = []
  const usable = (vb: VertexBuffer | undefined): vb is VertexBuffer => !!vb && vb.stride >= 12 && vb.stride % 4 === 0 && vb.stride <= 128 && !!vb.count && vb.vertexBytes >= vb.stride * vb.count
  const subVbs = mesh.subs.map((s) => ch.vbs[s.vb]).filter(usable)
  const nExtra = Math.max(0, ...subVbs.map((v) => v.uvSets - 1))
  const lit = subVbs.some((v) => v.lit)
  const extra: number[][] = Array.from({ length: Math.min(3, nExtra) }, () => [])
  const nrm: number[] = [], tan: number[] = []
  const tmp = [0, 0]
  for (const sub of mesh.subs) {
    const vb = ch.vbs[sub.vb]
    if (!usable(vb)) continue
    const remap = new Map<number, number>()
    const vert = (i: number) => {
      let k = remap.get(i)
      if (k !== undefined) return k
      k = pos.length / 3
      const o = vb.vertexAt + vb.stride * i
      pos.push(dv.getFloat32(o), dv.getFloat32(o + 4), dv.getFloat32(o + 8))
      readUv(dv, vb, i, 0, tmp, 0)
      uv.push(tmp[0], tmp[1])
      extra.forEach((e, s) => { readUv(dv, vb, i, s + 1, tmp, 0); e.push(tmp[0], tmp[1]) })
      if (lit) {
        if (vb.lit) {
          const n = dec3n(dv.getUint32(o + 12)), t = dec3n(dv.getUint32(o + 16))
          nrm.push(n[0], n[1], n[2]); tan.push(t[0], t[1], t[2], t[3] < 0 ? -1 : 1)
        } else { nrm.push(0, 0, 0); tan.push(0, 0, 0, 1) }
      }
      remap.set(i, k)
      return k
    }
    for (const b of sub.batches) {
      if (b.first + b.count > vb.indexCount) continue
      const ix = (j: number) => dv.getUint16(vb.indexAt + 2 * (b.first + j))
      for (let j = 0; j + 2 < b.count; j++) {
        let a = ix(j), bb = ix(j + 1)
        const c = ix(j + 2)
        if (a === bb || bb === c || a === c || Math.max(a, bb, c) >= vb.count) continue
        if (j & 1) [a, bb] = [bb, a]
        const va = vert(a), vbi = vert(bb), vc = vert(c)
        if (![va, vbi, vc].every((v) => Number.isFinite(pos[3 * v]) && Number.isFinite(pos[3 * v + 1]) && Number.isFinite(pos[3 * v + 2]))) continue
        tris.push(va, vbi, vc)
        mats.push(b.material)
      }
    }
  }
  return {
    positions: new Float32Array(pos), uvs: new Float32Array(uv), triangles: new Uint32Array(tris), triMaterial: new Uint16Array(mats),
    extraUvs: extra.map((e) => new Float32Array(e)), normals: lit ? new Float32Array(nrm) : null, tangents: lit ? new Float32Array(tan) : null,
  }
}

/** Strip index count over a mesh's batches: a cheap fingerprint of its geometry. */
export const meshIndexCount = (m: Mesh) => m.subs.reduce((a, s) => a + s.batches.reduce((x, b) => x + b.count, 0), 0)

/** Triangles a mesh draws (the strips' joining triangles with a repeated corner left out). */
export function meshTriangleCount(ch: Chunk, m: Mesh): number {
  const dv = new DataView(ch.bytes.buffer, ch.bytes.byteOffset, ch.bytes.byteLength)
  let n = 0
  for (const s of m.subs) {
    const vb = ch.vbs[s.vb]
    if (!vb) continue
    for (const b of s.batches) {
      if (b.first + b.count > vb.indexCount) continue
      let a = -1, c = -1
      for (let j = 0; j < b.count; j++) {
        const x = dv.getUint16(vb.indexAt + 2 * (b.first + j))
        if (j >= 2 && a !== c && c !== x && a !== x) n++
        a = c; c = x
      }
    }
  }
  return n
}

/** The diffuse texture names a mesh uses, most-used first (normal maps left out). */
export function meshTextures(ch: Chunk, m: Mesh): string[] {
  const use = new Map<string, number>()
  for (const s of m.subs) for (const b of s.batches) {
    const t = ch.materials[b.material]?.textures.find((x) => !/\.tgn$/i.test(x))
    if (t) use.set(t, (use.get(t) ?? 0) + b.count)
  }
  return [...use.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
}
