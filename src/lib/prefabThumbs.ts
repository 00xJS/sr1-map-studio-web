// Thumbnails for the prefab browser: small 3D pictures of each prefab's own
// parts, kept in IndexedDB so each is fetched or drawn once. The site ships one
// per prefab, drawn ahead of time (npm run thumbs → public/thumbs); a prefab
// whose parts changed since, a saved piece or a game object is drawn here. A picture is drawn only while a tile that
// shows it is on screen, the newest request first, one at a time, so scrolling
// through hundreds of prefabs stays smooth. A prefab whose parts change gets a
// new picture by itself (its signature is a hash of its parts).
import { openDb } from './db'
import { THUMB_VERSION, prefabParts, prefabThumbSig } from './prefabIndex'
import type { ThumbBundle } from './prefabRender'

const PREFIX = 'prefabThumb:'

interface Cached { sig: string; blob: Blob }
type Listener = (url: string | null) => void

/** How the thumbnails have done this session (shown nowhere; handy in the console). */
export const thumbStats = { drawn: 0, fromCache: 0, shipped: 0, failed: 0, drawMs: 0 }

const ready = new Map<string, string | null>()
const listeners = new Map<string, Set<Listener>>()
const queue: string[] = []
const mine = new Map<string, { sig: string; bundle: ThumbBundle }>()
const sigs = new Map<string, string>()
/** Shipped pictures on their way, and ones the site couldn't give (drawn here instead). */
const fetching = new Set<string>()
const unshipped = new Set<string>()
let running = false

/** Other kinds of thumbnail, by key prefix ("game:" for the From my game library): a signature and a drawing. */
export interface ThumbSource { sig(key: string): string | null; draw(key: string): Promise<Blob | null> }
const sources = new Map<string, ThumbSource>()
export function registerThumbSource(prefix: string, src: ThumbSource) { sources.set(prefix, src) }
const sourceFor = (key: string) => [...sources].find(([p]) => key.startsWith(p))?.[1]
/** Forgets pictures known this session under a prefix, so they are asked for again (after their source becomes readable). */
export function resetThumbs(prefix: string) {
  for (const k of [...ready.keys()]) if (k.startsWith(prefix) && ready.get(k) === null) ready.delete(k)
  for (const k of [...tries.keys()]) if (k.startsWith(prefix)) tries.delete(k)
  // Tiles on screen without a picture ask again.
  resets.forEach((fn) => fn())
}
const resets = new Set<() => void>()
/** Calls back after resetThumbs (a tile showing no picture asks for it again). */
export function onThumbsReset(fn: () => void): () => void { resets.add(fn); return () => { resets.delete(fn) } }
/** Pictures under a prefix that couldn't be drawn this session. */
export const missingThumbs = (prefix: string) => [...ready].filter(([k, v]) => k.startsWith(prefix) && v === null).length
/** Failed drawings per key: a picture that throws is tried again (a busy reader, a file still opening) before it is given up. */
const tries = new Map<string, number>()
const RETRIES = 2

const req = <T>(r: IDBRequest<T>) => new Promise<T>((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })

let cache: Promise<Map<string, Cached>> | null = null
/** Every stored thumbnail, read in one go the first time one is needed. */
function loadCache() {
  return (cache ??= (async () => {
    const out = new Map<string, Cached>()
    try {
      const store = (await openDb()).transaction('meta').objectStore('meta')
      const range = IDBKeyRange.bound(PREFIX, PREFIX + '￿')
      const [keys, values] = await Promise.all([req(store.getAllKeys(range)), req(store.getAll(range))])
      keys.forEach((k, i) => out.set(String(k).slice(PREFIX.length), values[i] as Cached))
    } catch { /* storage blocked (private window): draw them each time */ }
    return out
  })())
}

async function save(key: string, value: Cached) {
  try { await req((await openDb()).transaction('meta', 'readwrite').objectStore('meta').put(value, PREFIX + key)) } catch { /* full or blocked: fine, it is redrawn next time */ }
}

function signature(key: string): string | null {
  const src = sourceFor(key)
  if (src) return src.sig(key)
  if (key.startsWith('mine:')) { const m = mine.get(key); return m ? `${THUMB_VERSION}:${m.sig}` : null }
  let s = sigs.get(key)
  if (s === undefined) { s = prefabThumbSig(key.slice(7)); sigs.set(key, s) }
  return s
}

let shipped: Promise<Record<string, string>> | null = null
/** The pictures the site ships: prefab key → the signature each was drawn from. */
function loadShipped() {
  // A missing file comes back as the app's own page, which isn't JSON: none shipped.
  return (shipped ??= fetch('/thumbs/manifest.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})) as Promise<Record<string, string>>)
}

/** Fetches a shipped picture alongside the drawing queue (they are quick); one the site can't give goes back in the queue to be drawn. */
function fetchShipped(key: string, sig: string, stored: Map<string, Cached>) {
  fetching.add(key)
  void (async () => {
    let blob: Blob | null = null
    try {
      const r = await fetch(`/thumbs/${encodeURIComponent(key.slice(7))}.webp?v=${encodeURIComponent(sig)}`)
      const b = r.ok ? await r.blob() : null
      if (b?.type.startsWith('image/')) blob = b
    } catch { /* offline: drawn instead */ }
    fetching.delete(key)
    if (!blob) {
      unshipped.add(key)
      if (listeners.has(key)) { queue.push(key); void pump() }
      return
    }
    thumbStats.shipped++
    stored.set(key, { sig, blob })
    void save(key, { sig, blob })
    finish(key, URL.createObjectURL(blob))
  })()
}

let renderer: Promise<typeof import('./prefabRender')> | null = null
async function draw(key: string): Promise<Blob | null> {
  const src = sourceFor(key)
  if (src) return src.draw(key)
  const r = await (renderer ??= import('./prefabRender'))
  if (key.startsWith('prefab:')) return r.drawParts(prefabParts(key.slice(7)))
  const m = mine.get(key)
  return m ? r.drawBundle(m.bundle) : null
}

function finish(key: string, url: string | null) {
  ready.set(key, url)
  const ls = listeners.get(key)
  listeners.delete(key)
  ls?.forEach((fn) => fn(url))
}

async function pump() {
  if (running) return
  running = true
  try {
    const stored = await loadCache()
    while (queue.length) {
      const key = queue.pop()!
      if (!listeners.has(key) || ready.has(key) || fetching.has(key)) continue
      let url: string | null = null
      try {
        const sig = signature(key)
        const hit = stored.get(key)
        if (sig && hit?.sig === sig) { url = URL.createObjectURL(hit.blob); thumbStats.fromCache++ }
        else if (sig && key.startsWith('prefab:') && !unshipped.has(key) && (await loadShipped())[key.slice(7)] === sig) { fetchShipped(key, sig, stored); continue }
        else if (sig) {
          const t0 = performance.now()
          const blob = await draw(key)
          thumbStats.drawMs += performance.now() - t0
          if (blob) {
            thumbStats.drawn++
            stored.set(key, { sig, blob })
            void save(key, { sig, blob })
            url = URL.createObjectURL(blob)
          }
          // Let the page breathe between drawings.
          await new Promise((ok) => setTimeout(ok, 0))
        }
      } catch (e) {
        thumbStats.failed++
        const n = (tries.get(key) ?? 0) + 1
        tries.set(key, n)
        // Again later, behind the pictures waiting now.
        if (n <= RETRIES) { queue.unshift(key); await new Promise((ok) => setTimeout(ok, 250 * n)); continue }
        console.warn('Prefab thumbnail', key, e)
      }
      finish(key, url)
    }
  } finally { running = false }
}

/** The picture for a key if it is already known (undefined: not yet; null: none could be drawn). */
export const readyThumb = (key: string) => ready.get(key)

/**
 * Asks for the thumbnail of "prefab:<key>" or "mine:<id>" (a saved piece also passes
 * its bundle and something that changes when it does). Calls back once with an
 * object URL, or null if it can't be drawn. Unsubscribe when the tile scrolls out
 * of view: a picture nobody is waiting for is not drawn.
 */
export function subscribeThumb(key: string, fn: Listener, saved?: { sig: string; bundle: ThumbBundle }): () => void {
  if (saved) {
    const old = mine.get(key)
    if (old && old.sig !== saved.sig) ready.delete(key)
    mine.set(key, saved)
  }
  if (ready.has(key)) { fn(ready.get(key)!); return () => {} }
  let ls = listeners.get(key)
  if (!ls) listeners.set(key, (ls = new Set()))
  ls.add(fn)
  const at = queue.indexOf(key)
  if (at >= 0) queue.splice(at, 1)
  queue.push(key)
  void pump()
  return () => {
    ls!.delete(fn)
    if (ls!.size || listeners.get(key) !== ls) return
    listeners.delete(key)
    const i = queue.indexOf(key)
    if (i >= 0) queue.splice(i, 1)
  }
}
