// Pictures that fail to draw (src/lib/prefabThumbs.ts): tried again a couple of times, and asked for again after a reset.
// Prefabs use the pictures the site ships while those match, and are drawn otherwise.
import { describe, expect, it, vi } from 'vitest'
import { prefabThumbSig } from '../src/lib/prefabIndex'

vi.mock('../src/lib/db', () => ({ openDb: () => Promise.reject(new Error('no storage here')) }))
const drawParts = vi.fn(async () => new Blob(['drawn'], { type: 'image/webp' }))
vi.mock('../src/lib/prefabRender', () => ({ drawParts }))
globalThis.URL.createObjectURL ??= () => 'blob:x'

const { missingThumbs, onThumbsReset, registerThumbSource, resetThumbs, subscribeThumb, thumbStats } = await import('../src/lib/prefabThumbs')

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

describe('shipped prefab pictures', () => {
  it('are fetched when they match, and drawn when changed, missing or not served', async () => {
    const fetched: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url)
      if (url === '/thumbs/manifest.json') return Response.json({ acunit: prefabThumbSig('acunit'), ambulance: '1:old', airpump: prefabThumbSig('airpump') })
      // A file the site doesn't have comes back as the app's page.
      if (url.startsWith('/thumbs/airpump.webp')) return new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })
      return new Response(new Blob(['shipped'], { type: 'image/webp' }))
    })
    expect(await got('prefab:acunit')).toBeTruthy()
    expect(thumbStats.shipped).toBe(1)
    expect(drawParts).not.toHaveBeenCalled()
    expect(fetched).toContain(`/thumbs/acunit.webp?v=${encodeURIComponent(prefabThumbSig('acunit'))}`)

    expect(await got('prefab:ambulance')).toBeTruthy()
    expect(await got('prefab:airstation')).toBeTruthy()
    expect(await got('prefab:airpump')).toBeTruthy()
    expect(drawParts).toHaveBeenCalledTimes(3)
    expect(thumbStats.shipped).toBe(1)
    expect(fetched.filter((u) => u === '/thumbs/manifest.json')).toHaveLength(1)
    vi.unstubAllGlobals()
  })
})
