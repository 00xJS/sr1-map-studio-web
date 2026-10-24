// Which of a chunk's triangles the player can stand on. A chunk's collision blob holds one Havok MOPP block per
// mesh, listing the mesh's own render triangles that are solid (by key: batch index << 16 | strip position), and a
// last block over the solid instances. Reading the keys back out is enough to tell what is solid; the boxes in the
// code are skipped. A port of parse_mopp_blocks / mopp_keys in studio-py/sr_reborn_core.py (GPL-3.0-or-later).
import type { Chunk } from '../gameObjects/chunk'

const al = (c: number, a: number) => Math.ceil(c / a) * a

/** Each MOPP block's code (an empty block is a mesh with no collision). */
export function moppBlocks(ch: Chunk): Uint8Array[] {
  const out: Uint8Array[] = []
  const { at, size } = ch.coll
  const d = ch.bytes.subarray(at, at + size)
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
  let c = 0
  while (c + 28 <= d.length) {
    if (d[c] !== 0x50 || d[c + 1] !== 0x50 || d[c + 2] !== 0x4f || d[c + 3] !== 0x4d) throw new Error('collision blob not understood')
    const n = dv.getUint32(c + 24)
    out.push(d.subarray(c + 28, Math.min(d.length, c + 28 + n)))
    c = al(c + 28 + n, 64)
  }
  return out
}

/** The triangle keys a MOPP block's code ends at. */
export function moppKeys(code: Uint8Array): number[] {
  const out: number[] = []
  const at = (i: number) => { if (i >= code.length) throw new Error('collision code runs past its end'); return code[i] }
  const run = (start: number, off0: number, depth: number) => {
    if (depth > 400) throw new Error('collision code too deep')
    let i = start, off = off0
    for (;;) {
      const op = at(i)
      if (op >= 0x30 && op <= 0x4f) { out.push(off + op - 0x30); return }
      if (op === 0x50) { out.push(off + at(i + 1)); return }
      if (op === 0x51) { out.push(off + ((at(i + 1) << 8) | at(i + 2))); return }
      if (op === 0x52) { out.push(off + ((at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3))); return }
      if (op === 0x53) { out.push(off + ((at(i + 1) << 24) >>> 0) + ((at(i + 2) << 16) | (at(i + 3) << 8) | at(i + 4))); return }
      if (op === 0x05) { i += 2 + at(i + 1); continue }
      if (op === 0x06) { i += 3 + ((at(i + 1) << 8) | at(i + 2)); continue }
      if (op === 0x09) { off += at(i + 1); i += 2; continue }
      if (op === 0x0a) { off += (at(i + 1) << 8) | at(i + 2); i += 3; continue }
      if (op === 0x0b) { off = ((at(i + 1) << 24) >>> 0) + ((at(i + 2) << 16) | (at(i + 3) << 8) | at(i + 4)); i += 5; continue }
      if (op >= 0x01 && op <= 0x04) { i += 4; continue }
      if ((op >= 0x20 && op <= 0x22) || (op >= 0x26 && op <= 0x28)) { i += 3; continue }
      if (op >= 0x29 && op <= 0x2b) { i += 7; continue }
      if (op >= 0x10 && op <= 0x1c) { run(i + 4, off, depth + 1); i = i + 4 + at(i + 3); continue }
      if (op >= 0x23 && op <= 0x25) {
        const j1 = (at(i + 3) << 8) | at(i + 4), j2 = (at(i + 5) << 8) | at(i + 6)
        run(i + 7 + j1, off, depth + 1)
        i = i + 7 + j2
        continue
      }
      throw new Error(`unexpected collision opcode 0x${op.toString(16)}`)
    }
  }
  if (code.length) run(0, 0, 0)
  return out
}

/** Instance flags that leave an instance out of collision (as the exporter's rebuild_collision reads them). */
export const NO_COLLISION_FLAGS = 0x4c7

export interface Solidity {
  /** Per mesh: the set of its solid triangle keys (empty for a mesh with no collision). */
  meshKeys: Set<number>[]
  /** Per mesh: the mesh whose collision it uses (meshes drawing from one vertex buffer share the first one's). */
  canon: number[]
}

/** What is solid in a chunk; null when its collision blob doesn't have one block per mesh plus one. */
export function solidity(ch: Chunk): Solidity | null {
  let blocks: Uint8Array[]
  try { blocks = moppBlocks(ch) } catch { return null }
  if (blocks.length !== ch.meshes.length + 1) return null
  const meshKeys = blocks.slice(0, -1).map((b) => { try { return new Set(moppKeys(b)) } catch { return new Set<number>() } })
  const firstOfVb = new Map<number, number>()
  const canon = ch.meshes.map((m, k) => {
    const vb = m.subs[0]?.vb ?? -1
    if (!firstOfVb.has(vb)) firstOfVb.set(vb, k)
    return firstOfVb.get(vb)!
  })
  return { meshKeys, canon }
}
