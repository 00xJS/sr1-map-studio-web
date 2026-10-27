// Draws every prefab's thumbnail ahead of time (npm run thumbs), so the prefab browser shows pictures the
// first time it opens instead of drawing ~670 of them in the visitor's browser. Starts the Vite dev server,
// opens a blank page on it in headless Chromium (Playwright) and draws each prefab exactly as
// src/lib/prefabThumbs.ts would: prefabRender.drawParts on the prefab's default parts. Writes
//   public/thumbs/<key>.webp       one 160 px picture per prefab
//   public/thumbs/manifest.json    key → the signature it was drawn from (prefabThumbSig)
// A prefab whose parts change gets a new signature: the site draws that one live until this is run again,
// and tests/prefabThumbsShipped.test.ts fails until it is. Nothing from the game is drawn here.
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'public', 'thumbs')

const server = await createServer({ root, logLevel: 'warn', server: { port: 4189, strictPort: false } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
// Playwright's own Chromium (npx playwright install chromium), else the Edge or Chrome already installed
// (recent ones have only the new headless mode).
async function launch() {
  let first
  for (const channel of [undefined, 'msedge', 'chrome']) {
    const opts = channel ? { channel, ignoreDefaultArgs: ['--headless=old'], args: ['--headless=new'] } : {}
    try { return await chromium.launch(opts) } catch (e) { first ??= e }
  }
  await server.close()
  throw first
}
const browser = await launch()
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('page error:', e.message))
  // A blank page on the dev server's origin, so its modules can be imported (the app itself isn't needed).
  await page.route(base + '/__thumbs', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>thumbs</title>' }))
  await page.goto(base + '/__thumbs')

  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  const manifest = {}
  let bytes = 0
  await page.exposeFunction('saveThumb', async (key, sig, b64) => {
    const buf = Buffer.from(b64, 'base64')
    bytes += buf.length
    await writeFile(join(out, key + '.webp'), buf)
    manifest[key] = sig
  })

  const t0 = Date.now()
  const result = await page.evaluate(async () => {
    const { ALL_PREFABS } = await import('/src/lib/prefabRegistry.ts')
    const { prefabParts, prefabThumbSig } = await import('/src/lib/prefabIndex.ts')
    const { drawParts } = await import('/src/lib/prefabRender.ts')
    const failed = []
    const keys = Object.keys(ALL_PREFABS)
    for (const key of keys) {
      const blob = await drawParts(prefabParts(key))
      if (!blob || blob.type !== 'image/webp') { failed.push(key); continue }
      const bin = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (let i = 0; i < bin.length; i += 0x8000) s += String.fromCharCode(...bin.subarray(i, i + 0x8000))
      await window.saveThumb(key, prefabThumbSig(key), btoa(s))
    }
    return { total: keys.length, failed }
  })

  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => (a < b ? -1 : 1)))
  await writeFile(join(out, 'manifest.json'), JSON.stringify(sorted, null, 1) + '\n')
  const files = (await readdir(out)).filter((f) => f.endsWith('.webp')).length
  console.log(`Drew ${files} of ${result.total} prefab thumbnails in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${(bytes / 1024 / 1024).toFixed(2)} MB → public/thumbs`)
  if (result.failed.length) console.log(`Not drawn (drawn live on the site instead): ${result.failed.join(', ')}`)
} finally {
  await browser.close()
  await server.close()
}
