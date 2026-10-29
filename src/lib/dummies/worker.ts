// The dummy builder: bakes a dummy (bake.ts) from the player's packfiles off the editor's thread, and encodes its
// pictures as PNGs here too. Keeps the packfiles of the last folder open.
/// <reference lib="webworker" />
import { openVpp, type Vpp } from '../sr1char/vpp'
import { bakeDummy, type BakedDummy } from './bake'
import type { DummySpec } from './models'

/** `files` by name, `order` the names in the order entries are looked up (sr1char/folder.ts PACKFILES). */
export interface BakeRequest { id: number; key: string; files: Record<string, Blob>; order: string[]; spec: DummySpec }
export type BakeReply = { id: number; baked: BakedDummy } | { id: number; error: string }

let opened: { key: string; packs: Promise<Vpp[]> } | null = null

async function png(p: { width: number; height: number; rgba: Uint8Array }): Promise<Blob> {
  const c = new OffscreenCanvas(p.width, p.height)
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.rgba), p.width, p.height), 0, 0)
  return c.convertToBlob({ type: 'image/png' })
}

self.onmessage = async (e: MessageEvent<BakeRequest>) => {
  const { id, key, files, order, spec } = e.data
  try {
    if (opened?.key !== key) opened = { key, packs: Promise.all(order.filter((n) => files[n]).map((n) => openVpp(files[n], n))) }
    const baked = await bakeDummy(await opened.packs, spec)
    for (const m of baked.materials) m.png = await png(m.picture)
    const transfer = [...new Set([baked.positions.buffer, baked.normals.buffer, baked.uvs.buffer, baked.triangles.buffer, baked.triMaterial.buffer, ...baked.materials.map((m) => m.picture.rgba.buffer)])] as ArrayBuffer[]
    ;(self as unknown as Worker).postMessage({ id, baked } satisfies BakeReply, transfer)
  } catch (err) {
    opened = null
    ;(self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies BakeReply)
  }
}
