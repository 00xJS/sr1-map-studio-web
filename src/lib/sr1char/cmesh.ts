// Ported from SR1-Creator (github.com/00xJS/SR1-Creator)
// Saints Row (2006) Xbox 360 character mesh (.cmesh_xbox2, magic 0x424BD00D, version 28).
// The layout below mirrors the game's own load-time fix-up (sub_82238708 / sub_82238510 / sub_8223D768 /
// sub_82235860 / sub_82235048 / sub_82235318 / sub_82235758 in the recompiled executable).
import { volitionHash, hex8 } from './hash'

const KNOWN: Record<number, string> = {}
for (const n of ('diffuse_map specular_map subsurface_map normal_map pigment_map diffuse_color specular_color specular_power specular_alpha ' +
  'diffuse_map_saturation diffuse_map_luminosity subsurface_color face_white body_white teeth back chest left_shoulder right_shoulder ' +
  'left_forearm right_forearm left_leg right_leg eyes_brown eyes_blue eyes_hazel eyes_darkbrown eyes_darkblue eyes_green eyes_gray ' +
  // shader parameter names read from the effect files in shaders.vpp_xbox2
  'decal_map_1 decal_map_2 decal_map_1_color decal_map_2_color decal_map_1_opacity decal_map_2_opacity decal_map_1_tilingu decal_map_1_tilingv ' +
  'decal_map_2_tilingu decal_map_2_tilingv decal_map_2_offsetu decal_map_2_offsetv glancing_falloff_brightness glancing_falloff_contrast ' +
  'glancing_specular_alpha glancing_specular_color glancing_specular_power specular_map_amount subsurface_brightness subsurface_contrast ' +
  'subsurface_map_amount subsurface_rolloff diffuse_map_2 normal_map_2 diffuse_map_luminosity_amount specular_map_luminosity_amount ' +
  'specular_color_1 specular_color_2 specular_offset self_illumination normal_map_height spec_map_tilingu spec_map_tilingv tint ' +
  'detail_map_opacity detail_map_4 specular_map_4').split(' ')) KNOWN[volitionHash(n)] = n
const nameOf = (h: number) => KNOWN[h] || hex8(h)

export interface CmeshMaterial { shader: string; name: string; slots: { slot: string; texture: string }[]; consts: Record<string, number[]> }
export interface Draw { start: number; count: number; mat: number }
interface MeshRecord { flags: number; subs: Draw[]; nverts: number; nidx: number; stride: number; ibOffset: number; vbOffset: number }
export interface CmeshGeometry {
  nverts: number
  pos: Float32Array; nrm: Float32Array; uv0: Float32Array; uv1: Float32Array; uv2: Float32Array
  strip: Uint16Array
  boneWeights: Uint8Array; boneIndices: Uint8Array
}
export interface Cmesh {
  bsphere: number[]
  bbox: number[]
  textures: string[]
  materials: CmeshMaterial[]
  records: MeshRecord[]
  vids: { record: number; vid: number; draws: Draw[] }[]
  geometry: CmeshGeometry
}

class Cursor {
  cur = 0
  constructor(private dv: DataView) {}
  align(a: number) { const r = this.cur % a; if (r) this.cur += a - r }
  take(n: number, a = 1) { this.align(a); const o = this.cur; this.cur += n; return o }
  u16(o: number) { return this.dv.getUint16(o) }
  s16(o: number) { return this.dv.getInt16(o) }
  u32(o: number) { return this.dv.getUint32(o) }
  f32(o: number) { return this.dv.getFloat32(o) }
}

export function parseCmesh(u8: Uint8Array): Cmesh {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const p = new Cursor(dv)
  if (p.u32(0) !== 0x424bd00d || p.u16(4) !== 28) throw new Error('not a version-28 cmesh')
  const ntex = p.s16(12), n14 = p.s16(14), n36 = p.s16(36), mtype = p.u32(44)
  const textures: string[] = [], materials: CmeshMaterial[] = [], records: MeshRecord[] = []
  const vids: Cmesh['vids'] = []
  const bsphere = [0, 1, 2, 3].map((i) => p.f32(0x14 + 4 * i))
  p.cur = 0x40; p.take(ntex * 4, 16); p.align(16); p.cur += 1
  for (let i = 0; i < ntex; i++) { let s = ''; while (u8[p.cur]) s += String.fromCharCode(u8[p.cur++]); p.cur++; textures.push(s) }
  if (n14) p.take(n14 * 96, 16)
  if (n36) p.take(n36 * 4, 16)
  // material table
  const T = p.take(12, 16), na = p.u16(T), nb = p.u16(T + 2)
  if (na) {
    const ma = p.take(na * 56, 16); p.align(16)
    for (let i = 0; i < na; i++) {
      const m = ma + 56 * i
      const mat: CmeshMaterial = { shader: hex8(p.u32(m)), name: nameOf(p.u32(m + 4)), slots: [], consts: {} }
      const n8 = p.u16(m + 8), n10 = p.u16(m + 10), n20 = p.s16(m + 20)
      p.align(4)
      if (n10) { const o = p.take(n10 * 12); for (let k = 0; k < n10; k++) { const ti = p.u32(o + 12 * k + 4); mat.slots.push({ slot: nameOf(p.u32(o + 12 * k)), texture: textures[ti] }) } }
      p.align(4); if (n20) p.take(n20 * 8)
      for (const [c0, c1] of [[p.u16(m + 28), p.u16(m + 30)], [p.u16(m + 40), p.u16(m + 42)]]) {
        p.align(16)
        if (c0) { const o = p.take(c0 * 24); for (let k = 0; k < c0; k++) { const e = o + 24 * k; mat.consts[nameOf(p.u32(e))] = [0, 1, 2, 3].map((j) => p.f32(e + 8 + 4 * j)) } }
        p.align(16); if (c1) p.take(c1 * 2)
      }
      p.align(4); if (n8) p.take(n8 * 6)
      materials.push(mat)
    }
  }
  if (nb) { const tb = p.take(nb * 16, 4); for (let i = 0; i < nb; i++) { p.align(4); p.cur += p.u16(tb + 16 * i + 8) * 4 } }
  // render mesh header
  const hsz = ({ 0: 40, 1: 56, 2: 60 } as Record<number, number>)[mtype]
  if (!hsz) throw new Error('unknown cmesh mesh type ' + mtype)
  const hd = p.take(hsz, 4); p.align(16)
  const bbox = [0, 1, 2, 3, 4, 5].map((i) => p.f32(hd + 4 * i))
  const nrec = p.s16(hd + 28), n48 = p.u16(hd + 48), n50 = p.u16(hd + 50)
  const has36 = p.u32(hd + 36) !== 0, has40 = p.u32(hd + 40) !== 0, has44 = p.u32(hd + 44) !== 0
  const recs = p.take(nrec * 16, 16)
  const t36 = has36 ? p.take(nrec * 12, 16) : 0
  for (let i = 0; i < nrec; i++) {
    const r = recs + 16 * i
    const rec: MeshRecord = { flags: p.u16(r), subs: [], nverts: 0, nidx: 0, stride: 0, ibOffset: 0, vbOffset: 0 }
    const nsub = p.u16(r + 2)
    if (nsub) { const o = p.take(nsub * 8, 16); for (let k = 0; k < nsub; k++) rec.subs.push({ start: p.u32(o + 8 * k), count: p.u16(o + 8 * k + 4), mat: p.u16(o + 8 * k + 6) }) }
    const s = p.take(88, 16)
    rec.nverts = p.u16(s + 12); rec.nidx = p.u16(s + 14); rec.stride = p.u16(s + 16)
    if (has36) {
      const t = t36 + 12 * i
      if (p.u16(t + 2)) p.take(p.u16(t + 2) * 8, 16)
      const S = p.take(16, 16), c8 = p.u16(S + 8), c10 = p.u16(S + 10)
      if (p.u32(S)) p.take(c8 * 2, 32)
      if (p.u32(S + 4)) p.take(c10 * 2, 32)
    }
    records.push(rec)
  }
  const t52 = p.take(n50 * 16, 16)
  for (let i = 0; i < n50; i++) { p.align(4); p.cur += p.u16(t52 + 16 * i + 10) << 4 }
  if (has44) {
    p.take(nrec * 4, 16)
    for (let i = 0; i < nrec; i++) {
      const g = p.take(n48 * 12, 64)
      for (let j = 0; j < n48; j++) {
        const b = g + 12 * j, cnt = p.u16(b + 8), o = p.take(cnt << 3, 16)
        const draws: Draw[] = []
        for (let k = 0; k < cnt; k++) draws.push({ start: p.u32(o + 8 * k), count: p.u16(o + 8 * k + 4), mat: p.u16(o + 8 * k + 6) })
        vids.push({ record: i, vid: p.u32(b), draws })
      }
    }
  }
  if (has40) { const t40 = p.take(nrec * 8, 16); for (let i = 0; i < nrec; i++) p.take(p.u16(t40 + 8 * i) << 3, 16) }
  p.align(4096)
  for (const rec of records) {
    rec.ibOffset = p.take(rec.nidx * 2, 32)
    if (!(rec.flags & 0x20)) rec.vbOffset = p.take(rec.nverts * rec.stride, 32)
  }
  // decode record 0 geometry
  const rec = records[0]
  const n = rec.nverts, S = rec.stride, V = rec.vbOffset
  if (V + n * S > u8.byteLength) throw new Error('cmesh vertex data runs past the end of the file')
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv0 = new Float32Array(n * 2), uv1 = new Float32Array(n * 2), uv2 = new Float32Array(n * 2)
  const dec10 = (w: number, k: number) => { let v = (w >>> (10 * k)) & 1023; if (v >= 512) v -= 1024; return v / 511 }
  for (let i = 0; i < n; i++) {
    const o = V + S * i
    pos[3 * i] = p.f32(o); pos[3 * i + 1] = p.f32(o + 4); pos[3 * i + 2] = p.f32(o + 8)
    const nw = p.u32(o + 20)
    nrm[3 * i] = dec10(nw, 0); nrm[3 * i + 1] = dec10(nw, 1); nrm[3 * i + 2] = dec10(nw, 2)
    uv0[2 * i] = p.s16(o + 28) / 1024; uv0[2 * i + 1] = p.s16(o + 30) / 1024
    // Second UV set at +32 when the vertex has one (stride 36 hair, 40 hair/body, 44 eyes); materials whose texture slot
    // ends in _2 (diffuse_map_2 on the hair) sample it. A third set follows at +36 (stride 40) or +40 (eyes).
    if (S >= 36) { uv1[2 * i] = p.s16(o + 32) / 1024; uv1[2 * i + 1] = p.s16(o + 34) / 1024 }
    if (S === 40) { uv2[2 * i] = p.s16(o + 36) / 1024; uv2[2 * i + 1] = p.s16(o + 38) / 1024 }
    if (S === 44) { uv2[2 * i] = p.s16(o + 40) / 1024; uv2[2 * i + 1] = p.s16(o + 42) / 1024 }
  }
  // skinning: 4 weight bytes at +12 and 4 bone indices (into the character rig) at +16
  const bw = new Uint8Array(n * 4), bi = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { bw[4 * i + k] = u8[V + S * i + 12 + k]; bi[4 * i + k] = u8[V + S * i + 16 + k] }
  const strip = new Uint16Array(rec.nidx)
  for (let i = 0; i < rec.nidx; i++) strip[i] = p.u16(rec.ibOffset + 2 * i)
  return { bsphere, bbox, textures, materials, records, vids, geometry: { nverts: n, pos, nrm, uv0, uv1, uv2, strip, boneWeights: bw, boneIndices: bi } }
}

/** Triangle strip (with degenerates) to triangle list for a draw range. */
export function stripToTriangles(strip: Uint16Array, start: number, count: number, out: number[] = []): number[] {
  for (let i = 0; i + 2 < count; i++) {
    const a = strip[start + i], b = strip[start + i + 1], c = strip[start + i + 2]
    if (a === b || b === c || a === c) continue
    if (i & 1) out.push(a, c, b)
    else out.push(a, b, c)
  }
  return out
}
