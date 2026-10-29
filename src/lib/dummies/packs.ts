// Where dummies are built from: the packfiles a dummy needs (sr1char/folder.ts PACKFILES) from the remembered game
// folder, read by byte range in the browser. The bake itself runs in a worker (worker.ts), so the editor keeps
// drawing while a character is posed and its pictures are worked out; without workers (tests) it runs here.
import { gameFolderFiles, PACKFILES } from '../sr1char/folder'
import { openVpp, type Vpp } from '../sr1char/vpp'
import type { BakedDummy } from './bake'
import type { DummySpec } from './models'
import type { BakeReply, BakeRequest } from './worker'

/** The player's packfiles, and a key that changes with the folder or its files (for caches). */
export interface GameSource { key: string; files: Map<string, Blob> }

const sourceKey = (files: Map<string, Blob>) =>
  [...files].map(([n, f]) => `${n}:${f.size}:${f instanceof File ? f.lastModified : 0}`).sort().join('|')

export const gameSource = (files: Map<string, Blob>): GameSource => ({ key: sourceKey(files), files })

/** `ask` may prompt for the folder (needs a click). Null when there is none or it lacks the packfiles. */
export async function dummySource(ask: boolean): Promise<GameSource | null> {
  const found = await gameFolderFiles(PACKFILES, ask).catch(() => null)
  if (!found?.has('misc2.vpp_xbox2') || !found.has('cmesh_stream.vpp_xbox2')) return null
  return gameSource(found)
}

// ---------------- baking ----------------

let opened: { key: string; packs: Promise<Vpp[]> } | null = null
/** The source's packfiles, opened once per source. */
export function openPacks(source: GameSource): Promise<Vpp[]> {
  if (opened?.key !== source.key) {
    const packs = Promise.all(PACKFILES.filter((n) => source.files.has(n)).map((n) => openVpp(source.files.get(n)!, n)))
    opened = { key: source.key, packs }
    packs.catch(() => { if (opened?.packs === packs) opened = null })
  }
  return opened.packs
}

let worker: Worker | null | undefined
let nextId = 1
const waiting = new Map<number, { ok: (b: BakedDummy) => void; no: (e: Error) => void }>()
/** The worker itself failed (it didn't load, or a reply couldn't be read): the bake runs here instead. */
class WorkerFailed extends Error {}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  if (typeof Worker === 'undefined') return (worker = null)
  // Every waiting bake moves to this thread, and later ones stay here.
  const fail = (why: string) => {
    worker?.terminate()
    worker = null
    for (const w of waiting.values()) w.no(new WorkerFailed(why))
    waiting.clear()
  }
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<BakeReply>) => {
      const w = waiting.get(e.data.id)
      if (!w) return
      waiting.delete(e.data.id)
      if ('error' in e.data) w.no(new Error(e.data.error)); else w.ok(e.data.baked)
    }
    worker.onerror = (e) => { e.preventDefault(); fail(e.message || 'the dummy builder stopped') }
    worker.onmessageerror = () => fail('a reply from the dummy builder could not be read')
  } catch { worker = null }
  return worker
}

async function bakeHere(source: GameSource, spec: DummySpec): Promise<BakedDummy> {
  const { bakeDummy } = await import('./bake')
  return bakeDummy(await openPacks(source), spec)
}

/** Bakes a dummy from the source: in the worker when there is one, else (or if it fails) here. */
export async function bake(source: GameSource, spec: DummySpec): Promise<BakedDummy> {
  const w = getWorker()
  if (!w) return bakeHere(source, spec)
  const id = nextId++
  try {
    return await new Promise<BakedDummy>((ok, no) => {
      waiting.set(id, { ok, no })
      w.postMessage({ id, key: source.key, files: Object.fromEntries(source.files), order: PACKFILES, spec } satisfies BakeRequest)
    })
  } catch (e) {
    if (e instanceof WorkerFailed) return bakeHere(source, spec)
    throw e
  }
}
