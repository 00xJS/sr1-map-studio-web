// Paints one generated texture off the main thread: the pixels, then the PNG.
/// <reference lib="webworker" />
import { generate, type GenParams } from './procedural'

export interface TexRequest { id: number; params: GenParams }
export type TexReply = { id: number; ok: true; png: Blob } | { id: number; ok: false; error: string }

self.onmessage = async (e: MessageEvent<TexRequest>) => {
  const { id, params } = e.data
  try {
    const size = Math.max(16, Math.round(params.size))
    const px = generate(params)
    const c = new OffscreenCanvas(size, size)
    c.getContext('2d')!.putImageData(new ImageData(px, size, size), 0, 0)
    const png = await c.convertToBlob({ type: 'image/png' })
    ;(self as unknown as Worker).postMessage({ id, ok: true, png } satisfies TexReply)
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, ok: false, error: (err as Error).message || String(err) } satisfies TexReply)
  }
}
