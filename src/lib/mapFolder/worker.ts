// The map folder worker: reads an opened map's chunk and texture files off the page's thread (read.ts).
/// <reference lib="webworker" />
import { readMapScene, sceneTransfer } from './read'

export interface SceneRequest { id: number; chunk: Blob; pegs: Blob[]; loading: Blob | null; texSize: number }

self.onmessage = async (e: MessageEvent<SceneRequest>) => {
  const m = e.data
  try {
    const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer())
    const scene = readMapScene(await bytes(m.chunk), await Promise.all(m.pegs.map(bytes)), m.loading ? await bytes(m.loading) : null, m.texSize)
    ;(self as unknown as Worker).postMessage({ id: m.id, ok: true, value: scene }, sceneTransfer(scene))
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id: m.id, ok: false, error: (err as Error).message || String(err) })
  }
}
