// The "From my game" library on the page: opens the player's own packfiles in the game-objects worker, builds
// the library index once (chunk by chunk, so a closed tab carries on where it stopped) and keeps it in this
// browser's IndexedDB, and asks the worker for single objects. Nothing read here is uploaded or shared: the index
// (names, sizes, texture names) and the pictures stay on this device.
import { create } from 'zustand'
import { openDb } from '../db'
import { gamePack } from '../gameFiles'
import { mergeCandidates, type Candidate, type GameObjectEntry, type MapSummary } from './indexer'
import type { CityCut, CityMap, ObjectResult, PackSource, Reply, Request } from './worker'
import type { Hole, Rect } from '../city/city'
import type { TextureDirectory } from './textures'

/** Bump when the index changes shape or rules: the next visit rebuilds it. */
export const INDEX_VERSION = 14
const INDEX_KEY = 'gameObjects:index'
const CHUNK_PREFIX = 'gameObjects:chunk:'
export const PACK_FILES: Record<string, string> = {
  sr_city_stream: 'sr_city_stream.vpp_xbox2',
  mp_city_stream: 'mp_city_stream.vpp_xbox2',
  misc2: 'misc2.vpp_xbox2',
}
const NEEDED = ['sr_city_stream']

interface StoredIndex { version: number; sig: string; entries: GameObjectEntry[]; texDir: TextureDirectory; builtAt: string; ms: number; chunks: number; failed: string[]; maps?: MapSummary[] }

/** Which texture file holds each picture (kept with the index, handed to the worker when it opens the game files). */
let texDir: TextureDirectory | null = null

export interface GameObjectsState {
  /** idle: nothing known; ready: the index is here (game files may still need opening for pictures). */
  status: 'idle' | 'loading' | 'indexing' | 'ready' | 'error'
  entries: GameObjectEntry[] | null
  progress: { done: number; total: number } | null
  error: string | null
  /** The packfiles are open in the worker this tab (pictures and placing work). */
  connected: boolean
  info: { builtAt: string; ms: number; chunks: number; failed: string[]; maps?: MapSummary[] } | null
}

export const useGameObjects = create<GameObjectsState>(() => ({ status: 'idle', entries: null, progress: null, error: null, connected: false, info: null }))

export class NeedGameFolder extends Error {
  constructor() { super('Choose your Saints Reborn folder first (From my game → Choose folder).') }
}

// ---------------- the worker ----------------

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onChunk?: (m: Extract<Reply, { type: 'chunk' }>) => void; onProgress?: (done: number, total: number) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const m = e.data
    const p = pending.get(m.id)
    if (!p) return
    if ('type' in m) { if (m.type === 'chunk') p.onChunk?.(m); else p.onProgress?.(m.done, m.total); return }
    pending.delete(m.id)
    if (m.ok) p.resolve(m.value)
    else p.reject(new Error(m.error))
  }
  return worker
}

type Body = Request extends infer R ? (R extends Request ? Omit<R, 'id'> : never) : never
function call<T>(msg: Body, onChunk?: (m: Extract<Reply, { type: 'chunk' }>) => void, onProgress?: (done: number, total: number) => void): Promise<T> {
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, onChunk, onProgress })
    getWorker().postMessage({ ...msg, id })
  })
}

// ---------------- the player's packfiles ----------------

let devSources: Record<string, PackSource> | null = null
/** Development only: packfiles the dev server serves from the SR1_PACKFILES folder (see scripts/devGameFiles.ts). */
export function useDevPackfiles(sources: Record<string, PackSource>) { devSources = sources; connected = null; useGameObjects.setState({ connected: false }) }

let connected: Promise<string> | null = null

/** The packfiles' identity: names, sizes and dates, so a changed install rebuilds the index. */
const signature = (packs: Record<string, PackSource>) => Object.entries(packs).sort(([a], [b]) => a.localeCompare(b))
  .map(([n, f]) => `${n}:${f instanceof File ? f.size + ':' + f.lastModified : f.size}`).join('|')

/**
 * Opens the library's packfiles in the worker (once per tab). `ask` lets the browser ask for the game folder
 * (needs a click). Resolves to the packfiles' signature; NeedGameFolder when they can't be read.
 */
export function connect(ask: boolean): Promise<string> {
  if (connected) return connected
  const p = (async () => {
    const packs: Record<string, PackSource> = {}
    if (devSources) Object.assign(packs, devSources)
    else for (const [k, file] of Object.entries(PACK_FILES)) { const f = await gamePack(file, ask && !Object.keys(packs).length); if (f) packs[k] = f }
    if (!NEEDED.every((k) => packs[k])) throw new NeedGameFolder()
    await call({ type: 'open', packs })
    if (texDir) await call({ type: 'texdir', dir: texDir })
    useGameObjects.setState({ connected: true })
    return signature(packs)
  })()
  connected = p
  p.catch(() => { if (connected === p) connected = null })
  return p
}

// ---------------- the index ----------------

const req = <T>(r: IDBRequest<T>) => new Promise<T>((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
async function meta(mode: IDBTransactionMode = 'readonly') { return (await openDb()).transaction('meta', mode).objectStore('meta') }
const chunkRange = () => IDBKeyRange.bound(CHUNK_PREFIX, CHUNK_PREFIX + '￿')

/** Reads the stored index (no game files needed). */
export async function loadIndex(): Promise<GameObjectEntry[] | null> {
  const s = useGameObjects.getState()
  if (s.entries) return s.entries
  useGameObjects.setState({ status: 'loading' })
  try {
    const stored = await req((await meta()).get(INDEX_KEY)) as StoredIndex | undefined
    if (stored?.version === INDEX_VERSION) {
      const { entries, builtAt, ms, chunks, failed, maps } = stored
      texDir = stored.texDir
      useGameObjects.setState({ status: 'ready', entries, info: { builtAt, ms, chunks, failed, maps } })
      return entries
    }
  } catch { /* storage blocked: build it in memory */ }
  useGameObjects.setState({ status: 'idle' })
  return null
}

let building: Promise<GameObjectEntry[]> | null = null

/** Builds the index from the game files, or keeps the stored one when the game files haven't changed. */
export function buildIndex(ask: boolean, force = false): Promise<GameObjectEntry[]> {
  return (building ??= (async () => {
    try {
      const sig = await connect(ask)
      const stored = await req((await meta()).get(INDEX_KEY)).catch(() => undefined) as StoredIndex | undefined
      if (!force && stored?.version === INDEX_VERSION && stored.sig === sig) {
        if (!texDir) { texDir = stored.texDir; await call({ type: 'texdir', dir: texDir }) }
        useGameObjects.setState({ status: 'ready', entries: stored.entries, info: { builtAt: stored.builtAt, ms: stored.ms, chunks: stored.chunks, failed: stored.failed, maps: stored.maps } })
        return stored.entries
      }
      useGameObjects.setState({ status: 'indexing', progress: { done: 0, total: 0 }, error: null })
      const t0 = performance.now()
      // Chunks done on an earlier visit with the same game files are not read again.
      const kept = new Map<string, Candidate[]>()
      const summaries = new Map<string, MapSummary>()
      try {
        const store = await meta()
        const [keys, values] = await Promise.all([req(store.getAllKeys(chunkRange())), req(store.getAll(chunkRange()))])
        keys.forEach((k, i) => {
          const v = values[i] as { sig: string; version: number; candidates: Candidate[]; summary?: MapSummary }
          if (!force && v?.sig === sig && v.version === INDEX_VERSION) {
            kept.set(String(k).slice(CHUNK_PREFIX.length), v.candidates)
            if (v.summary) summaries.set(String(k).slice(CHUNK_PREFIX.length), v.summary)
          }
        })
      } catch { /* storage blocked */ }
      const found = new Map(kept)
      const result = await call<{ total: number; failed: string[]; texDir: TextureDirectory }>({ type: 'index', skip: [...kept.keys()] }, (m) => {
        found.set(m.key, m.candidates)
        if (m.summary) summaries.set(m.key, m.summary)
        useGameObjects.setState({ progress: { done: m.done, total: m.total } })
        void meta('readwrite').then((s) => s.put({ sig, version: INDEX_VERSION, candidates: m.candidates, summary: m.summary }, CHUNK_PREFIX + m.key)).catch(() => {})
      })
      const entries = mergeCandidates([...found.values()].flat())
      texDir = result.texDir
      const maps = [...summaries.values()].sort((a, b) => a.chunk.localeCompare(b.chunk))
      const rec: StoredIndex = { version: INDEX_VERSION, sig, entries, texDir, builtAt: new Date().toISOString(), ms: Math.round(performance.now() - t0), chunks: result.total, failed: result.failed, maps }
      try {
        const store = await meta('readwrite')
        await req(store.put(rec, INDEX_KEY))
        await req(store.delete(chunkRange()))
      } catch { /* storage blocked: the index lasts this tab */ }
      useGameObjects.setState({ status: 'ready', entries, progress: null, info: { builtAt: rec.builtAt, ms: rec.ms, chunks: rec.chunks, failed: rec.failed, maps } })
      return entries
    } catch (e) {
      useGameObjects.setState({ status: useGameObjects.getState().entries ? 'ready' : 'error', progress: null, error: (e as Error).message })
      throw e
    } finally {
      building = null
    }
  })())
}

/** Forgets the stored index and its pictures (the game files are not touched). */
export async function forgetIndex() {
  try {
    const store = await meta('readwrite')
    await req(store.delete(INDEX_KEY))
    await req(store.delete(chunkRange()))
    await req(store.delete(IDBKeyRange.bound('prefabThumb:game:', 'prefabThumb:game:￿')))
  } catch { /* nothing stored */ }
  useGameObjects.setState({ status: 'idle', entries: null, info: null })
}

export const entryById = (id: string) => useGameObjects.getState().entries?.find((e) => e.id === id)

// ---------------- single objects ----------------

/**
 * One object's mesh and textures (pictures at most `texSize` pixels across), with its layers' pictures when
 * `layers` (decals, masks, normal and specular maps). Needs the game files open.
 */
export async function getObject(ref: Pick<GameObjectEntry, 'pack' | 'chunk' | 'record' | 'parts'>, texSize: number, ask = false, layers = false): Promise<ObjectResult> {
  await connect(ask)
  return call<ObjectResult>({ type: 'object', pack: ref.pack, chunk: ref.chunk, record: ref.record, parts: ref.parts, texSize, layers })
}

// Development only: `SR1_PACKFILES=<packfiles folder> npx vite`, then in the console
// `await __sr1GameObjects.useDevServer()` feeds the library the local install instead of the folder picker.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as any).__sr1GameObjects = {
    async useDevServer() {
      const sizes = await (await fetch('/__sr1dev/packfiles')).json() as Record<string, number>
      const sources: Record<string, PackSource> = {}
      for (const [k, file] of Object.entries(PACK_FILES)) if (sizes[file]) sources[k] = { url: `${location.origin}/__sr1dev/packfiles/${file}`, size: sizes[file] }
      useDevPackfiles(sources)
      // The vehicle models for Vehicle spawn markers.
      ;(await import('../vehicles/client')).useDevVehicleSources(sizes)
      // The item table's packfile is small: handed over whole, as if picked by hand.
      if (sizes['misc.vpp_xbox2']) {
        const blob = await (await fetch('/__sr1dev/packfiles/misc.vpp_xbox2')).blob()
        ;(await import('../gameFiles')).addPickedFiles([new File([blob], 'misc.vpp_xbox2')])
      }
      return Object.keys(sources)
    },
    buildIndex, loadIndex, getObject, state: () => useGameObjects.getState(),
  }
}

// ---------------- the city (see ../city) ----------------

/** Reads every city chunk for the top-down map (the game files must be open: connect first). */
export const workerCityMap = (onProgress: (done: number, total: number) => void) => call<CityMap>({ type: 'cityMap' }, undefined, onProgress)
export const workerCityCut = (rect: Rect, stems: string[], texSize: number) => call<CityCut>({ type: 'cityCut', rect, stems, texSize })
export const workerCityScan = (rect: Rect, stems: string[]) => call<Hole[]>({ type: 'cityScan', rect, stems })
/** The different pictures a cut of the area would bring (name, width, height, alpha): for its texture budget. */
export const workerCityTextures = (rect: Rect, stems: string[]) => call<[string, number, number, boolean][]>({ type: 'cityTextures', rect, stems })

const CITY_KEY = 'city:map'
// 2: 2 m pixels, triangles filled, and what each pixel is.
const CITY_VERSION = 2
interface StoredCity extends CityMap { version: number; sig: string; builtAt: string }

/** The stored city map, if one was built from these game files (or any, when the files aren't open). */
export async function loadCityMap(): Promise<CityMap | null> {
  try {
    const s = await req((await meta()).get(CITY_KEY)) as StoredCity | undefined
    return s?.version === CITY_VERSION ? s : null
  } catch { return null }
}

/** Builds the city map from the game files (about one read of every city chunk) and keeps it on this device. */
export async function buildCityMap(ask: boolean, onProgress: (done: number, total: number) => void): Promise<CityMap> {
  const sig = await connect(ask)
  const map = await workerCityMap(onProgress)
  if (!texDir && map.texDir) texDir = map.texDir
  try { await req((await meta('readwrite')).put({ ...map, version: CITY_VERSION, sig, builtAt: new Date().toISOString() } satisfies StoredCity, CITY_KEY)) } catch { /* storage blocked: this tab only */ }
  return map
}

/** Opens the game files for the city, handing the worker the texture directory the city map keeps (when the library hasn't). */
export async function connectCity(ask: boolean, map: CityMap) {
  await connect(ask)
  if (!texDir && map.texDir) { texDir = map.texDir; await call({ type: 'texdir', dir: texDir }) }
}
