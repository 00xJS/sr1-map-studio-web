// Ported from SR1-Creator (github.com/00xJS/SR1-Creator)
// Saints Row (2006) morph file (.morph_xbox2, magic 0x1337BEEF version 1).
// Header (big-endian u32): magic, 1, record count, part count, +0x10 and +0x14 offsets of per-part u16 vertex
// counts, +0x18 section count (2), +0x1c section 0 offset, +0x20 section 1 offset, +0x24 remap table offset,
// +0x28 u16 vertex count.
// Section 0: records of 48 bytes {name hash, row count, float scale[9] (pos xyz, normal xyz, tangent xyz), data offset}.
// Rows (16 bytes): i16 dx dy dz, u16 remap index, i8 nx ny nz, u8 entry count, i8 tx ty tz, pad.
// Each row expands to `entry count` consecutive remap entries {u16 part id, u16 GPU vertex index}; this mirrors the
// game's apply routine (sub_8222CEC0): pos += i16/32767 * scale * weight, normal += i8/127 * scale * weight.
import { hex8 } from './hash'

export interface MorphTarget { hash: number; idx: Uint16Array; dpos: Float32Array; dnrm: Float32Array }
export interface Morph { nverts: number; targets: Record<string, MorphTarget> }

export function parseMorph(u8: Uint8Array, nameOfHash: (h: number) => string = hex8): Morph {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  if (dv.getUint32(0) !== 0x1337beef) throw new Error('not a morph file')
  const nrec = dv.getUint32(8), nsec = dv.getUint32(0x18)
  if (nsec !== 2) throw new Error('unsupported morph layout (section count ' + nsec + ')')
  const sec0 = dv.getUint32(0x1c), remapAt = dv.getUint32(0x24), nverts = dv.getUint16(0x28)
  const nmap = (u8.byteLength - remapAt) >> 2
  const remapIdx = new Uint16Array(nmap)
  for (let i = 0; i < nmap; i++) remapIdx[i] = dv.getUint16(remapAt + 4 * i + 2)
  const targets: Record<string, MorphTarget> = {}
  for (let i = 0; i < nrec; i++) {
    const o = sec0 + 48 * i, hash = dv.getUint32(o), cnt = dv.getUint32(o + 4), off = dv.getUint32(o + 44)
    if (!cnt) continue
    const sc = [0, 1, 2, 3, 4, 5].map((k) => dv.getFloat32(o + 8 + 4 * k))
    let total = 0
    for (let k = 0; k < cnt; k++) total += u8[off + 16 * k + 11]
    const idx = new Uint16Array(total), dpos = new Float32Array(total * 3), dnrm = new Float32Array(total * 3)
    let j = 0
    for (let k = 0; k < cnt; k++) {
      const r = off + 16 * k
      const dx = (dv.getInt16(r) / 32767) * sc[0], dy = (dv.getInt16(r + 2) / 32767) * sc[1], dz = (dv.getInt16(r + 4) / 32767) * sc[2]
      const nx = (dv.getInt8(r + 8) / 127) * sc[3], ny = (dv.getInt8(r + 9) / 127) * sc[4], nz = (dv.getInt8(r + 10) / 127) * sc[5]
      const base = dv.getUint16(r + 6), n = u8[r + 11]
      for (let e = 0; e < n; e++) {
        const m = base + e
        if (m >= nmap) continue
        idx[j] = remapIdx[m]
        dpos[3 * j] = dx; dpos[3 * j + 1] = dy; dpos[3 * j + 2] = dz
        dnrm[3 * j] = nx; dnrm[3 * j + 1] = ny; dnrm[3 * j + 2] = nz
        j++
      }
    }
    targets[nameOfHash(hash)] = { hash, idx: idx.subarray(0, j), dpos: dpos.subarray(0, 3 * j), dnrm: dnrm.subarray(0, 3 * j) }
  }
  return { nverts, targets }
}

/** Morphs `pos`/`nrm` in place (they start as copies of the base arrays). weights: {targetName: weight}. */
export function applyMorphs(pos: Float32Array, nrm: Float32Array, morph: Morph, weights: Record<string, number>) {
  const nv = pos.length / 3
  for (const [name, w] of Object.entries(weights)) {
    if (!w) continue
    const t = morph.targets[name]
    if (!t) continue
    const { idx, dpos, dnrm } = t
    for (let k = 0; k < idx.length; k++) {
      const vi = idx[k]
      if (vi >= nv) continue
      const v = vi * 3, d = k * 3
      pos[v] += w * dpos[d]; pos[v + 1] += w * dpos[d + 1]; pos[v + 2] += w * dpos[d + 2]
      nrm[v] += w * dnrm[d]; nrm[v + 1] += w * dnrm[d + 1]; nrm[v + 2] += w * dnrm[d + 2]
    }
  }
  for (let v = 0; v < nrm.length; v += 3) {
    const l = Math.hypot(nrm[v], nrm[v + 1], nrm[v + 2]) || 1
    nrm[v] /= l; nrm[v + 1] /= l; nrm[v + 2] /= l
  }
}
