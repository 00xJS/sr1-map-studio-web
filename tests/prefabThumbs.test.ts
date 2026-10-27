// Pictures that fail to draw (src/lib/prefabThumbs.ts): tried again a couple of times, and asked for again after a reset.
// Prefabs use the pictures the site ships while those match, and are drawn otherwise.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  // Each case starts without a manifest read (it is remembered for the session).
  const fresh = async () => { vi.resetModules(); return import('../src/lib/prefabThumbs') }
  const pic = (body: string) => new Response(new Blob([body], { type: 'image/webp' }))
  const manifest = () => Response.json({ acunit: prefabThumbSig('acunit'), antenna: prefabThumbSig('antenna'), ambulance: '1:old', airpump: prefabThumbSig('airpump') })
  let fetched: string[]
  const serve = (answer: (url: string) => Response | Promise<Response>) => vi.stubGlobal('fetch', async (url: string) => { fetched.push(url); return answer(url) })
  const manifestReads = () => fetched.filter((u) => u === '/thumbs/manifest.json').length

  beforeEach(() => { fetched = []; drawParts.mockClear() })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('are fetched when they match, and drawn when changed, missing or not served', async () => {
    const { subscribeThumb, thumbStats } = await fresh()
    const got = (key: string) => new Promise<string | null>((ok) => { subscribeThumb(key, ok) })
    serve((url) => {
      if (url === '/thumbs/manifest.json') return manifest()
      // A file the site doesn't have comes back as the app's page.
      if (url.startsWith('/thumbs/airpump.webp')) return new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })
      return pic('shipped')
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
    expect(manifestReads()).toBe(1)
  })

  it('are drawn when the picture fetch fails', async () => {
    const { subscribeThumb, thumbStats } = await fresh()
    serve((url) => (url === '/thumbs/manifest.json' ? manifest() : Promise.reject(new TypeError('offline'))))
    expect(await new Promise((ok) => { subscribeThumb('prefab:acunit', ok) })).toBeTruthy()
    expect(drawParts).toHaveBeenCalledOnce()
    expect(thumbStats.shipped).toBe(0)
  })

  for (const [how, answer] of [
    ['fails', () => Promise.reject(new TypeError('offline'))],
    ['is missing', () => new Response('not found', { status: 404 })],
    ["comes back as the app's page",() => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })],
  ] as const) {
    it(`are drawn while the manifest ${how}, and the manifest is asked for again a little later`, async () => {
      const { subscribeThumb, thumbStats, MANIFEST_RETRY_MS } = await fresh()
      const got = (key: string) => new Promise<string | null>((ok) => { subscribeThumb(key, ok) })
      let now = 1_000_000
      vi.spyOn(Date, 'now').mockImplementation(() => now)
      let broken = true
      serve((url) => (url !== '/thumbs/manifest.json' ? pic('shipped') : broken ? answer() : manifest()))

      expect(await got('prefab:acunit')).toBeTruthy()
      expect(drawParts).toHaveBeenCalledOnce()
      // Not asked again straight away.
      broken = false
      expect(await got('prefab:airpump')).toBeTruthy()
      expect(drawParts).toHaveBeenCalledTimes(2)
      expect(manifestReads()).toBe(1)

      now += MANIFEST_RETRY_MS
      expect(await got('prefab:ambulance')).toBeTruthy()
      expect(manifestReads()).toBe(2)
      expect(drawParts).toHaveBeenCalledTimes(3) // ambulance's shipped picture is stale
      expect(thumbStats.shipped).toBe(0)
      // Read now: a listed prefab is fetched, not drawn.
      expect(await got('prefab:antenna')).toBeTruthy()
      expect(thumbStats.shipped).toBe(1)
      expect(drawParts).toHaveBeenCalledTimes(3)
      expect(manifestReads()).toBe(2)
    })
  }
})
