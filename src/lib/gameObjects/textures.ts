// Finds and decodes the textures a game object uses. A chunk's materials name pictures in the chunk's own texture
// file (<chunk>.peg_xbox2 beside it), and in the two city-wide texture files the game always keeps loaded; the
// pictures are Xbox 360 DXT, decoded by sr1char/peg.ts. Only the entries asked for are decoded.
import { decodeEntry, parsePeg, type Peg, type PegEntry, type PegImage } from '../sr1char/peg'
import type { Vpp } from '../sr1char/vpp'

/** City-wide texture files, in misc2. */
export const ALWAYS_PEGS = ['sr_alwaysload.peg_xbox2', 'sr_alwaysload_user.peg_xbox2']

export interface PegIndex { peg: Peg; byName: Map<string, PegEntry> }

export function indexPeg(bytes: Uint8Array): PegIndex {
  const peg = parsePeg(bytes)
  const byName = new Map<string, PegEntry>()
  for (const e of peg.entries) if (e.name && !byName.has(e.name.toLowerCase())) byName.set(e.name.toLowerCase(), e)
  return { peg, byName }
}

/** Texture files to look in for a chunk, in order: its own, the one of the chunk it is a part of ("x_al" -> "x"). */
export function chunkPegNames(chunk: string): string[] {
  const out = [chunk + '.peg_xbox2']
  const m = chunk.match(/^(.+?)_(al|dl|[a-z]+)$/i)
  if (m) out.push(m[1] + '.peg_xbox2')
  return out
}

/** Box-filters an image down so its longer side is at most `max` (power-of-two steps; the editor wants square-ish sizes). */
export function shrink(img: PegImage, max: number): PegImage {
  let { width: w, height: h, rgba } = img
  while (Math.max(w, h) > max && w > 1 && h > 1) {
    const nw = w >> 1, nh = h >> 1, out = new Uint8Array(nw * nh * 4)
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      for (let c = 0; c < 4; c++) {
        const a = ((2 * y) * w + 2 * x) * 4 + c, b = a + w * 4
        out[(y * nw + x) * 4 + c] = (rgba[a] + rgba[a + 4] + rgba[b] + rgba[b + 4] + 2) >> 2
      }
    }
    w = nw; h = nh; rgba = out
  }
  return { width: w, height: h, rgba }
}

/** True when enough of the picture is see-through that the material should draw with alpha (chain-link, leaves, glass). */
export function hasAlpha(img: PegImage): boolean {
  let clear = 0
  const n = img.width * img.height
  for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] < 200) clear++
  return clear > n * 0.005
}

/** Decodes one named picture from the first texture file that has it. Null when none does or its format isn't read. */
export function findTexture(name: string, pegs: PegIndex[]): PegImage | null {
  const key = name.toLowerCase()
  for (const p of pegs) {
    const e = p.byName.get(key)
    if (e) { const img = decodeEntry(p.peg, e); if (img) return img }
  }
  return null
}

/** Bytes of a texture file's head that hold its entry table (for a file with `count` entries). */
export const pegHeadSize = (count: number) => 0x18 + 0x48 * count

/**
 * Names of the pictures a texture file really holds (entries of size 0 only point at another entry's pixels),
 * read from its head alone. When the head is too short, says how many bytes are needed.
 */
export function pegHeadNames(head: Uint8Array): { names: string[] } | { need: number } {
  if (head.length < 0x18 || String.fromCharCode(head[0], head[1], head[2], head[3]) !== 'VKEG') return { names: [] }
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const count = dv.getUint16(16)
  if (head.length < pegHeadSize(count)) return { need: pegHeadSize(count) }
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    const o = 0x18 + 0x48 * i
    if (!dv.getUint32(o + 0x34)) continue
    let e = o + 23, s = ''
    while (head[e] && e < o + 0x48) s += String.fromCharCode(head[e++])
    if (s) names.push(s.toLowerCase())
  }
  return { names }
}

/** Where each picture lives across the library's packfiles: texture file paths ("pack/file") and, per picture name, the first that holds it. */
export interface TextureDirectory { pegs: string[]; names: Record<string, number> }

/**
 * Reads the head of every texture file in the packfiles given (in order of preference, best first): which file
 * really holds each picture.
 */
export async function textureDirectory(packs: [string, Vpp][]): Promise<TextureDirectory> {
  const dir: TextureDirectory = { pegs: [], names: {} }
  for (const [p, vpp] of [...packs].reverse()) {
    for (const n of vpp.list()) {
      if (!/\.peg_xbox2$/i.test(n)) continue
      try {
        let r = pegHeadNames(await vpp.readHead(n, 65536))
        if ('need' in r) r = pegHeadNames(await vpp.readHead(n, r.need))
        if (!('names' in r) || !r.names.length) continue
        const at = dir.pegs.push(p + '/' + n) - 1
        // Packfiles read later (the preferred ones) overwrite earlier ones.
        for (const name of r.names) dir.names[name] = at
      } catch { /* an unreadable texture file: its pictures stay grey */ }
    }
  }
  return dir
}
