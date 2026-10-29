// The dummy builder's worker failing (it doesn't load, or a reply can't be read): the bake runs on the page instead.
import { describe, expect, it, vi } from 'vitest'

const baked = { positions: new Float32Array(0), triangles: new Uint32Array(0), materials: [], summary: 'here' }
vi.mock('../src/lib/dummies/bake', () => ({ bakeDummy: vi.fn(async () => baked) }))
vi.mock('../src/lib/sr1char/vpp', () => ({ openVpp: async (_: Blob, label: string) => ({ label }) }))

type Fail = 'error' | 'messageerror'
let failWith: Fail = 'error'
class FailingWorker {
  onmessage: unknown = null
  onerror: ((e: { message: string; preventDefault(): void }) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminated = false
  postMessage() {
    setTimeout(() => (failWith === 'error' ? this.onerror?.({ message: 'failed to load', preventDefault() {} }) : this.onmessageerror?.()), 0)
  }
  terminate() { this.terminated = true }
}

describe('the dummy builder', () => {
  for (const f of ['error', 'messageerror'] as Fail[]) {
    it(`bakes on the page when the worker fails (${f})`, async () => {
      vi.resetModules()
      failWith = f
      ;(globalThis as { Worker?: unknown }).Worker = FailingWorker
      const { bake, gameSource } = await import('../src/lib/dummies/packs')
      const src = gameSource(new Map([['misc2.vpp_xbox2', new Blob(['x'])]]))
      expect(await bake(src, { model: 'player', pose: 'standing', look: {} })).toBe(baked)
      // Later bakes go straight to the page.
      expect(await bake(src, { model: 'player', pose: 'aim', look: {} })).toBe(baked)
      delete (globalThis as { Worker?: unknown }).Worker
    })
  }
})
