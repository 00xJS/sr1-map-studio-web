/// <reference lib="webworker" />
// Runs the original SR1 Map Studio Python inside Pyodide, off the UI thread.
import { loadPyodide, type PyodideInterface } from 'pyodide'

// The site serves Pyodide itself (scripts/bundle-pyodide.mjs puts it in public/pyodide). The CDN is only the
// fallback for a build that didn't bundle it.
const CDN_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/'
async function pyodideURL(): Promise<string> {
  const local = new URL('/pyodide/', self.location.origin).href
  try {
    const res = await fetch(local + 'version.json', { cache: 'no-cache' })
    if (res.ok && (await res.json()).pyodide) return local
  } catch { /* not bundled: use the CDN */ }
  post({ type: 'log', text: 'Python runtime: this build has no public/pyodide, loading it from the CDN.' })
  return CDN_URL
}

export type WorkerRequest =
  | { id: number; type: 'init' }
  | { id: number; type: 'write'; files: { path: string; data: ArrayBuffer }[] }
  | { id: number; type: 'remove'; paths: string[] }
  | { id: number; type: 'read'; paths: string[] }
  | { id: number; type: 'exists'; paths: string[] }
  | { id: number; type: 'call'; fn: string; args: (string | number | null)[] }
  | { id: number; type: 'texture'; path: string; max: number }

/** Export progress from py/export_runner.py: stage `index` of `count`, and `done` of `total` within it when known. */
export interface ExportProgress { stage: string; index: number; count: number; label: string; done: number | null; total: number | null }

export type WorkerMessage =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }
  | { type: 'log'; text: string }
  | { type: 'status'; text: string }
  | { type: 'progress'; progress: ExportProgress }

let py: PyodideInterface | null = null
let booting: Promise<PyodideInterface> | null = null
// Compressed textures persist in IndexedDB (IDBFS at /cache), so a texture is
// encoded once per device rather than once per export (py/export_cache.py).
const CACHE = '/cache'
let cacheSync: Promise<void> = Promise.resolve()
function syncCache(p: PyodideInterface, load: boolean) {
  cacheSync = cacheSync.then(() => new Promise<void>((resolve) => {
    try { p.FS.syncfs(load, () => resolve()) } catch { resolve() }
  }))
  return cacheSync
}
const post = (m: WorkerMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)

async function boot(): Promise<PyodideInterface> {
  post({ type: 'status', text: 'Loading Python runtime…' })
  const p = await loadPyodide({ indexURL: await pyodideURL(), stdout: (t) => post({ type: 'log', text: t }), stderr: (t) => post({ type: 'log', text: t }) })
  post({ type: 'status', text: 'Loading numpy and Pillow…' })
  await p.loadPackage(['numpy', 'pillow'])
  post({ type: 'status', text: 'Loading SR1 Map Studio modules…' })
  const zip = await (await fetch(new URL('/py/studio.zip', self.location.origin))).arrayBuffer()
  p.FS.mkdirTree('/studio')
  p.FS.mkdirTree('/work')
  p.unpackArchive(zip, 'zip', { extractDir: '/studio' })
  let cached = false
  try {
    p.FS.mkdirTree(CACHE)
    p.FS.mount(p.FS.filesystems.IDBFS, {}, CACHE)
    await syncCache(p, true)
    cached = true
  } catch (err) {
    // No IndexedDB here (a private window): textures are compressed again each visit, which is slower.
    post({ type: 'log', text: 'Texture cache unavailable, exports will be slower: ' + String(err) })
  }
  p.runPython(`
import sys, os
sys.path.insert(0, '/studio')
os.chdir('/work')
import web_api
import export_runner
export_runner.install(${cached ? "'/cache/textures'" : 'None'})
`)
  post({ type: 'status', text: 'ready' })
  return p
}

function mkdirFor(p: PyodideInterface, path: string) {
  const dir = path.slice(0, path.lastIndexOf('/'))
  if (dir) p.FS.mkdirTree(dir)
}

async function handle(msg: WorkerRequest) {
  if (msg.type === 'init') {
    booting ??= boot()
    py = await booting
    return true
  }
  if (!py) { booting ??= boot(); py = await booting }
  const p = py
  switch (msg.type) {
    case 'write':
      for (const f of msg.files) { mkdirFor(p, f.path); p.FS.writeFile(f.path, new Uint8Array(f.data)) }
      return msg.files.length
    case 'remove':
      for (const path of msg.paths) {
        try { p.FS.unlink(path) } catch { /* already gone */ }
      }
      return true
    case 'exists':
      return msg.paths.map((path) => { try { p.FS.stat(path); return true } catch { return false } })
    case 'read': {
      const out = msg.paths.map((path) => {
        const data = p.FS.readFile(path) as Uint8Array
        return { path, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) }
      })
      return { files: out, transfer: out.map((f) => f.data) }
    }
    case 'texture': {
      const fn = p.globals.get('web_api').texture_preview
      const res = fn(msg.path, msg.max)
      const bytes = res.toJs() as Uint8Array
      res.destroy?.(); fn.destroy?.()
      const copy = bytes.slice().buffer
      return { files: [{ path: msg.path, data: copy }], transfer: [copy] }
    }
    case 'call': {
      const api = p.globals.get('web_api')
      const fn = api[msg.fn]
      if (!fn) throw new Error('Unknown Python function ' + msg.fn)
      // Every bridge function returns a JSON string; long jobs get a log callback.
      const log = (text: string) => post({ type: 'log', text: String(text) })
      // Exports go through export_runner: progress events and reuse of unchanged work.
      const runner = msg.fn === 'export_project' ? p.globals.get('export_runner') : null
      const progress = (json: string) => post({ type: 'progress', progress: JSON.parse(String(json)) })
      const raw = runner ? runner.export_project(...msg.args, log, progress) : fn(...msg.args)
      const text = typeof raw === 'string' ? raw : String(raw)
      fn.destroy?.(); api.destroy?.(); runner?.destroy?.()
      if (runner) void syncCache(p, false)
      const parsed = JSON.parse(text)
      if (!parsed.ok) {
        const err = new Error(parsed.error) as Error & { trace?: string }
        err.trace = parsed.trace
        throw err
      }
      return parsed.value
    }
  }
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  try {
    const value = await handle(msg) as any
    if (value && typeof value === 'object' && 'transfer' in value) post({ id: msg.id, ok: true, value: value.files }, value.transfer)
    else post({ id: msg.id, ok: true, value })
  } catch (err: any) {
    const text = err?.trace ? `${err.message}\n\n${err.trace}` : String(err?.message ?? err)
    post({ id: msg.id, ok: false, error: text })
  }
}
