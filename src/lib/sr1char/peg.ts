// Ported from SR1-Creator (github.com/00xJS/SR1-Creator)
// Saints Row (2006) Xbox 360 texture container (.peg_xbox2, "VKEG" version 8).
// Entries are 0x48 bytes from 0x18. Pixel data is Xbox 360 tiled DXT with big-endian 16-bit words.

export interface PegEntry { offset: number; width: number; height: number; format: number; flags: number; mips: number; name: string; size: number }
export interface Peg { entries: PegEntry[]; data: Uint8Array }
export interface PegImage { width: number; height: number; rgba: Uint8Array }

export function parsePeg(buf: Uint8Array): Peg {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const u8 = buf
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'VKEG') throw new Error('not a peg')
  const count = dv.getUint16(16)
  const entries: PegEntry[] = []
  for (let i = 0; i < count; i++) {
    const o = 0x18 + 0x48 * i
    let e = o + 23, s = ''
    while (u8[e]) s += String.fromCharCode(u8[e++])
    entries.push({
      offset: dv.getUint32(o), width: dv.getUint16(o + 4), height: dv.getUint16(o + 6), format: dv.getUint16(o + 8),
      flags: dv.getUint16(o + 20), mips: u8[o + 22], name: s, size: dv.getUint32(o + 0x34),
    })
  }
  return { entries, data: u8 }
}

function tiledOffset(x: number, y: number, widthBlocks: number, bpb: number) {
  const aligned = (widthBlocks + 31) & ~31
  const logbpp = (bpb >> 2) + ((bpb >> 1) >> (bpb >> 2))
  const macro = ((x >> 5) + (y >> 5) * (aligned >> 5)) << (logbpp + 7)
  const micro = ((x & 7) + ((y & 6) << 2)) << logbpp
  const off = macro + ((micro & ~15) << 1) + (micro & 15) + ((y & 8) << (3 + logbpp)) + ((y & 1) << 4)
  return (((off & ~511) << 3) + ((off & 448) << 2) + (off & 63) + ((y & 16) << 7) + (((((y & 8) >> 2) + (x >> 3)) & 3) << 6)) >> logbpp
}
const c565 = (v: number) => [(((v >> 11) & 31) * 255 / 31) | 0, (((v >> 5) & 63) * 255 / 63) | 0, ((v & 31) * 255 / 31) | 0]

/** RGBA (top row first) for mip 0 of a DXT1 (400), DXT5 (402) or CTX1 normal map (603) entry.
 *  Entries with no data (size 0) are placeholders that point at another entry's pixels: treated as missing. */
export function decodeEntry(peg: Peg, e: PegEntry): PegImage | null {
  if (!e.size) return null
  if (e.format === 603) return decodeCtx1(peg, e)
  const dxt5 = e.format === 402
  if (!dxt5 && e.format !== 400) return null
  const w = e.width, h = e.height, bw = Math.max(w >> 2, 1), bh = Math.max(h >> 2, 1), bpb = dxt5 ? 16 : 8
  const out = new Uint8Array(w * h * 4)
  const src = peg.data, base = e.offset
  const blk = new Uint8Array(16), alpha = new Uint8Array(16), pal = new Uint8Array(12)
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const o = base + tiledOffset(bx, by, bw, bpb) * bpb
    if (o + bpb > src.length) continue
    for (let i = 0; i < bpb; i += 2) { blk[i] = src[o + i + 1]; blk[i + 1] = src[o + i] } // byte-swap 16-bit words
    let p = 0
    if (dxt5) {
      const a0 = blk[0], a1 = blk[1]
      const ap = [a0, a1]
      if (a0 > a1) for (let i = 0; i < 6; i++) ap.push((((6 - i) * a0 + (i + 1) * a1) / 7) | 0)
      else { for (let i = 0; i < 4; i++) ap.push((((4 - i) * a0 + (i + 1) * a1) / 5) | 0); ap.push(0, 255) }
      let lo = blk[2] | (blk[3] << 8) | (blk[4] << 16), hi = blk[5] | (blk[6] << 8) | (blk[7] << 16)
      for (let i = 0; i < 8; i++) { alpha[i] = ap[lo & 7]; lo >>= 3 }
      for (let i = 8; i < 16; i++) { alpha[i] = ap[hi & 7]; hi >>= 3 }
      p = 8
    } else alpha.fill(255)
    const c0 = blk[p] | (blk[p + 1] << 8), c1 = blk[p + 2] | (blk[p + 3] << 8)
    const idx = blk[p + 4] | (blk[p + 5] << 8) | (blk[p + 6] << 16) | (blk[p + 7] << 24)
    const [r0, g0, b0] = c565(c0), [r1, g1, b1] = c565(c1)
    pal.set([r0, g0, b0, r1, g1, b1])
    let transparent3 = false
    if (c0 > c1 || dxt5) pal.set([((2 * r0 + r1) / 3) | 0, ((2 * g0 + g1) / 3) | 0, ((2 * b0 + b1) / 3) | 0, ((r0 + 2 * r1) / 3) | 0, ((g0 + 2 * g1) / 3) | 0, ((b0 + 2 * b1) / 3) | 0], 6)
    else { pal.set([(r0 + r1) >> 1, (g0 + g1) >> 1, (b0 + b1) >> 1, 0, 0, 0], 6); transparent3 = true }
    for (let i = 0; i < 16; i++) {
      const px = bx * 4 + (i & 3), py = by * 4 + (i >> 2)
      if (px >= w || py >= h) continue
      const k = (idx >>> (2 * i)) & 3, d = (py * w + px) * 4
      out[d] = pal[k * 3]; out[d + 1] = pal[k * 3 + 1]; out[d + 2] = pal[k * 3 + 2]
      out[d + 3] = dxt5 ? alpha[i] : transparent3 && k === 3 ? 0 : 255
    }
  }
  return { width: w, height: h, rgba: out }
}

// CTX1 (Xbox 360 two-channel block format, used for the .tgn normal maps): per 4x4 block two 8:8 (x, y) endpoints and
// 2-bit indices into {e0, e1, 2/3 e0 + 1/3 e1, 1/3 e0 + 2/3 e1}. Returns RGBA with z rebuilt from x and y.
function decodeCtx1(peg: Peg, e: PegEntry): PegImage {
  const w = e.width, h = e.height, bw = Math.max(w >> 2, 1), bh = Math.max(h >> 2, 1), out = new Uint8Array(w * h * 4), src = peg.data, blk = new Uint8Array(8)
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const o = e.offset + tiledOffset(bx, by, bw, 8) * 8
    if (o + 8 > src.length) continue
    for (let i = 0; i < 8; i += 2) { blk[i] = src[o + i + 1]; blk[i + 1] = src[o + i] }
    const px = [blk[0], blk[2], ((2 * blk[0] + blk[2]) / 3) | 0, ((blk[0] + 2 * blk[2]) / 3) | 0]
    const py = [blk[1], blk[3], ((2 * blk[1] + blk[3]) / 3) | 0, ((blk[1] + 2 * blk[3]) / 3) | 0]
    const idx = blk[4] | (blk[5] << 8) | (blk[6] << 16) | (blk[7] << 24)
    for (let i = 0; i < 16; i++) {
      const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2)
      if (x >= w || y >= h) continue
      const k = (idx >>> (2 * i)) & 3, d = (y * w + x) * 4, nx = px[k] / 127.5 - 1, ny = py[k] / 127.5 - 1
      out[d] = px[k]; out[d + 1] = py[k]
      out[d + 2] = Math.round((Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * 0.5 + 0.5) * 255); out[d + 3] = 255
    }
  }
  return { width: w, height: h, rgba: out }
}

/** Every decodable image in a peg, by lower-case name. */
export function decodePeg(bytes: Uint8Array): Record<string, PegImage> {
  const peg = parsePeg(bytes)
  const out: Record<string, PegImage> = {}
  for (const e of peg.entries) { const d = decodeEntry(peg, e); if (d) out[e.name.toLowerCase()] = d }
  return out
}
