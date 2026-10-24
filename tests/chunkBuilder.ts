// A map chunk (.bbchunk_xbox2) built from a small description, in the layout src/lib/gameObjects/chunk.ts walks:
// the string table, instances, vertex buffers, materials, meshes and named static records. For tests only.

export class W {
  b: number[] = []
  get at() { return this.b.length }
  align(a: number) { while (this.b.length % a) this.b.push(0) }
  u8(v: number) { this.b.push(v & 255) }
  u16(v: number) { this.b.push((v >> 8) & 255, v & 255) }
  u32(v: number) { this.u16(v >>> 16); this.u16(v & 0xffff) }
  f32(v: number) { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, v); for (let i = 0; i < 4; i++) this.u8(d.getUint8(i)) }
  zeros(n: number) { for (let i = 0; i < n; i++) this.b.push(0) }
  str(s: string) { for (const c of s) this.u8(c.charCodeAt(0)); this.u8(0) }
  set32(o: number, v: number) { this.b[o] = (v >>> 24) & 255; this.b[o + 1] = (v >>> 16) & 255; this.b[o + 2] = (v >>> 8) & 255; this.b[o + 3] = v & 255 }
}

export interface Spec {
  strings: string[]
  vbs: { verts: number[][]; indices: number[] }[]
  materials: number[][]
  meshes: { subs: { vb: number; batches: [number, number, number][] }[] }[]
  instances: { pos: number[]; rot?: number[]; mesh: number }[]
  records: { name: string; instance: number; profile?: string; shape?: number }[]
}

export const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
/** Turned `deg` about +Y (column-major: column k is where local axis k goes). */
export const yawRot = (deg: number) => { const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t); return [c, 0, -s, 0, 1, 0, s, 0, c] }

export function buildChunk(s: Spec): Uint8Array {
  const w = new W()
  w.zeros(968)
  w.set32(0, 0xbbcaca12); w.set32(4, 85); w.set32(868, s.records.length)
  w.align(64)
  w.u32(s.strings.length); w.zeros(4 * s.strings.length); s.strings.forEach((x) => w.str(x))
  w.align(64)
  w.u32(s.meshes.length); w.u32(s.instances.length); w.u32(s.vbs.length); w.u32(0)
  w.align(64)
  w.zeros(16 * s.meshes.length)
  w.align(64)
  for (const i of s.instances) { w.u32(0); i.pos.forEach((v) => w.f32(v)); (i.rot ?? I3).forEach((v) => w.f32(v)); w.zeros(112 - 52 - 8); w.u32(i.mesh); w.u32(0) }
  w.align(64); w.align(64)
  w.u32(0) // record blob
  w.align(64)
  // geometry
  w.u32(0); w.zeros(24); w.align(4)
  w.zeros(4 * s.vbs.length); w.zeros(4 * s.vbs.length)
  w.align(64)
  for (const v of s.vbs) { w.align(16); const d = w.at; w.zeros(88); w.set32(d + 4, 1); w.set32(d + 8, 1); w.b[d + 12] = v.verts.length >> 8; w.b[d + 13] = v.verts.length & 255; w.b[d + 14] = v.indices.length >> 8; w.b[d + 15] = v.indices.length & 255; w.b[d + 17] = 24 }
  w.align(4096)
  for (const v of s.vbs) {
    w.align(32); v.indices.forEach((i) => w.u16(i))
    w.align(32); for (const [x, y, z, u = 0, vv = 0] of v.verts) { w.f32(x); w.f32(y); w.f32(z); w.zeros(8); w.u16(Math.round(u * 1024) & 0xffff); w.u16(Math.round(vv * 1024) & 0xffff) }
  }
  w.align(4096); w.align(16)
  w.u16(s.materials.length); w.u16(0); w.zeros(8)
  if (s.materials.length) {
    w.align(16)
    for (const m of s.materials) { const a = w.at; w.zeros(56); w.b[a + 11] = m.length }
    w.align(16)
    for (const m of s.materials) { w.align(4); for (const ix of m) { w.u32(0); w.u32(ix); w.u32(0) } w.align(4); w.align(16); w.align(16); w.align(16); w.align(16); w.align(4) }
  }
  for (const m of s.meshes) {
    w.align(4)
    const h = w.at
    w.zeros(40)
    w.b[h + 29] = m.subs.length
    w.align(16); w.align(16)
    for (const sub of m.subs) { const a = w.at; w.zeros(16); w.b[a + 3] = sub.batches.length; w.set32(a + 8, sub.vb) }
    for (const sub of m.subs) { if (!sub.batches.length) continue; w.align(16); for (const [first, count, mat] of sub.batches) { w.u32(first); w.u16(count); w.u16(mat) } }
  }
  // static records, their names and the profile names
  w.align(64)
  const profiles: string[] = []
  const recAt = w.at
  for (const r of s.records) {
    const a = w.at; w.zeros(80)
    w.set32(a + 32, 0x10000000); w.b[a + 56] = r.shape === undefined ? 255 : 0; w.b[a + 57] = r.shape === undefined ? 255 : r.shape
    w.set32(a + 60, r.instance)
    w.set32(a + 64, r.profile ? 0 : 0xffffffff)
    if (r.profile && !profiles.includes(r.profile)) profiles.push(r.profile)
  }
  s.records.forEach((r) => w.str(r.name))
  w.align(64)
  const blobAt = w.at
  w.u32(0)
  const offs = new Map<string, number>()
  for (const p of profiles) { offs.set(p, w.at - blobAt - 4); w.str(p) }
  w.set32(blobAt, w.at - blobAt - 4)
  s.records.forEach((r, i) => { if (r.profile) w.set32(recAt + 80 * i + 64, offs.get(r.profile)!) })
  w.zeros(64)
  return new Uint8Array(w.b)
}

/** A unit-ish box: 8 corners (with UVs) and one strip per side pair, degenerate joins included. */
export function box(sx: number, sy: number, sz: number) {
  const verts: number[][] = []
  for (let i = 0; i < 8; i++) verts.push([i & 1 ? sx / 2 : -sx / 2, i & 2 ? sy : 0, i & 4 ? sz / 2 : -sz / 2, i & 1 ? 1 : 0, i & 2 ? 0 : 1])
  // two strips joined by a degenerate pair: 0 1 2 3 | 3 4 | 4 5 6 7
  const indices = [0, 1, 2, 3, 3, 4, 4, 5, 6, 7]
  return { verts, indices }
}
