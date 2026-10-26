// Pictures that fail to draw (src/lib/prefabThumbs.ts): tried again a couple of times, and asked for again after a reset.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/db', () => ({ openDb: () => Promise.reject(new Error('no storage here')) }))
globalThis.URL.createObjectURL ??= () => 'blob:x'

const { missingThumbs, onThumbsReset, registerThumbSource, resetThumbs, subscribeThumb } = await import('../src/lib/prefabThumbs')

const got = (key: string) => new Promise<string | null>((ok) => { subscribeThumb(key, ok) })

describe('thumbnails that fail', () => {
  it('are drawn again after a throw, and given up only after the retries', async () => {
    let calls = 0
    registerThumbSource('flaky:', { sig: () => 's', draw: async () => { if (++calls < 2) throw new Error('busy'); return new Blob(['x']) } })
    expect(await got('flaky:a')).toBeTruthy()
    expect(calls).toBe(2)
    registerThumbSource('broken:', { sig: () => 's', draw: async () => { throw new Error('bad file') } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await got('broken:a')).toBeNull()
    expect(missingThumbs('broken:')).toBe(1)
  })

  it('are asked for again after a reset, and tiles are told', async () => {
    let fail = true
    registerThumbSource('later:', { sig: () => 's', draw: async () => { if (fail) throw new Error('not open yet'); return new Blob(['x']) } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await got('later:a')).toBeNull()
    const told = vi.fn()
    const off = onThumbsReset(told)
    fail = false
    resetThumbs('later:')
    expect(told).toHaveBeenCalledOnce()
    expect(missingThumbs('later:')).toBe(0)
    expect(await got('later:a')).toBeTruthy()
    off()
  })
})
