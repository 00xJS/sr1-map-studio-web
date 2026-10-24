// Generated textures as PNGs, painted by a few workers at once so a big map's 200-odd textures don't queue on
// the main thread; on the main thread when workers aren't available.
import { generate, type GenParams } from './procedural'
import { pixelsToPng } from './images'
import type { TexReply, TexRequest } from './texgen.worker'

let pool: Worker[] | null = null
let turn = 0
let nextId = 1
const waiting = new Map<number, { ok: (b: Blob) => void; no: (e: Error) => void }>()

function workers(): Worker[] | null {
  if (pool) return pool.length ? pool : null
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return (pool = []), null
  const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))
  pool = Array.from({ length: n }, () => {
    const w = new Worker(new URL('./texgen.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<TexReply>) => {
      const m = e.data, p = waiting.get(m.id)
      if (!p) return
      waiting.delete(m.id)
      if (m.ok) p.ok(m.png); else p.no(new Error(m.error))
    }
    return w
  })
  return pool
}

/** The texture as a PNG file named `name`. */
export async function generatedPng(params: GenParams, name: string): Promise<File> {
  const ws = workers()
  const size = Math.max(16, Math.round(params.size))
  if (ws) {
    try {
      const id = nextId++
      const png = await new Promise<Blob>((ok, no) => {
        waiting.set(id, { ok, no })
        ws[turn++ % ws.length].postMessage({ id, params } satisfies TexRequest)
      })
      return new File([png], name, { type: 'image/png' })
    } catch { /* fall back to painting it here */ }
  }
  return pixelsToPng(generate(params), size, name)
}
