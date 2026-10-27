// Draws every prefab's thumbnail ahead of time (npm run thumbs), so the prefab browser shows pictures the
// first time it opens instead of drawing ~670 of them in the visitor's browser. Starts the Vite dev server,
// opens a blank page on it in headless Chromium (Playwright) and draws each prefab exactly as
// src/lib/prefabThumbs.ts would: prefabRender.drawParts on the prefab's default parts. Writes
//   public/thumbs/<key>.webp       one 160 px picture per prefab
//   public/thumbs/manifest.json    key → the signature it was drawn from (prefabThumbSig)
//   public/thumbs/drawn-with.json  a hash of each file they are drawn with (scripts/thumbSources.mjs)
// Only prefabs whose signature changed are drawn again, so another machine's GPU doesn't rewrite pictures nobody
// changed; every one is drawn when what they are drawn with changed (or with --all), and the git diff shows which
// pictures really did. The new set is built in .cache/ and swapped in at the end: a run that fails
// leaves the old one. A prefab whose parts change gets a new signature: the site draws that one live until this
// is run again, and tests/prefabThumbsShipped.test.ts fails until it is. Nothing from the game is drawn here.
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { drawingSources } from './thumbSources.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'public', 'thumbs')
const tmp = join(root, '.cache', 'thumbs-new')
const readJson = async (f) => (existsSync(f) ? JSON.parse((await readFile(f, 'utf8')).replace(/^\uFEFF/, '')) : {})

// Everything is drawn again when the renderer, texture generators or texture previews changed since the last run.
const sources = drawingSources(root)
const drewWith = await readJson(join(out, 'drawn-with.json'))
const sameSources = JSON.stringify(Object.entries(sources).sort()) === JSON.stringify(Object.entries(drewWith).sort())
const all = process.argv.includes('--all') || !sameSources
if (!sameSources) console.log('What the thumbnails are drawn with changed since the last run: drawing every one.')

// Pictures already drawn, by the signature they were drawn from (kept when it still matches).
const old = all ? {} : await readJson(join(out, 'manifest.json'))
const have = Object.fromEntries(Object.entries(old).filter(([k]) => existsSync(join(out, k + '.webp'))))

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
const manifest = {}
let bytes = 0, drawn = 0, kept = 0, result
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('page error:', e.message))
  // A blank page on the dev server's origin, so its modules can be imported (the app itself isn't needed).
  await page.route(base + '/__thumbs', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>thumbs</title>' }))
  await page.goto(base + '/__thumbs')

  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  await page.exposeFunction('saveThumb', async (key, sig, b64) => {
    const buf = Buffer.from(b64, 'base64')
    bytes += buf.length
    drawn++
    await writeFile(join(tmp, key + '.webp'), buf)
    manifest[key] = sig
  })

  const t0 = Date.now()
  const sigs = await page.evaluate(async () => {
    const { ALL_PREFABS } = await import('/src/lib/prefabRegistry.ts')
    const { prefabThumbSig } = await import('/src/lib/prefabIndex.ts')
    return Object.fromEntries(Object.keys(ALL_PREFABS).map((k) => [k, prefabThumbSig(k)]))
  })
  const redraw = Object.keys(sigs).filter((k) => have[k] !== sigs[k])
  for (const k of Object.keys(sigs)) if (have[k] === sigs[k]) { await copyFile(join(out, k + '.webp'), join(tmp, k + '.webp')); manifest[k] = sigs[k]; kept++ }
  const failed = redraw.length ? await page.evaluate(async (keys) => {
    const { prefabParts, prefabThumbSig } = await import('/src/lib/prefabIndex.ts')
    const { drawParts } = await import('/src/lib/prefabRender.ts')
    const failed = []
    for (const key of keys) {
      const blob = await drawParts(prefabParts(key))
      if (!blob || blob.type !== 'image/webp') { failed.push(key); continue }
      const bin = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (let i = 0; i < bin.length; i += 0x8000) s += String.fromCharCode(...bin.subarray(i, i + 0x8000))
      await window.saveThumb(key, prefabThumbSig(key), btoa(s))
    }
    return failed
  }, redraw) : []
  result = { total: Object.keys(sigs).length, failed, seconds: (Date.now() - t0) / 1000 }
} finally {
  await browser.close()
  await server.close()
}

const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => (a < b ? -1 : 1)))
await writeFile(join(tmp, 'manifest.json'), JSON.stringify(sorted, null, 1) + '\n')
await writeFile(join(tmp, 'drawn-with.json'), JSON.stringify(sources, null, 1) + '\n')

// Swap the new set in. A folder something still watches can refuse the rename on Windows: copy over instead.
const gone = join(root, '.cache', 'thumbs-old')
await rm(gone, { recursive: true, force: true })
try {
  if (existsSync(out)) await rename(out, gone)
  await rename(tmp, out)
} catch {
  if (!existsSync(out)) await rename(gone, out)
  // The manifest last, so a copy cut short never pairs the new manifest with old pictures.
  const want = new Set(await readdir(tmp))
  for (const f of want) if (f !== 'manifest.json') await copyFile(join(tmp, f), join(out, f))
  for (const f of await readdir(out)) if (!want.has(f)) await rm(join(out, f))
  await copyFile(join(tmp, 'manifest.json'), join(out, 'manifest.json'))
  await rm(tmp, { recursive: true, force: true })
}
await rm(gone, { recursive: true, force: true })

const mb = (bytes / 1024 / 1024).toFixed(2)
console.log(`${result.total} prefab thumbnails in ${result.seconds.toFixed(1)} s: drew ${drawn} (${mb} MB), kept ${kept} unchanged → public/thumbs`)
if (result.failed.length) console.log(`Not drawn (drawn live on the site instead): ${result.failed.join(', ')}`)
