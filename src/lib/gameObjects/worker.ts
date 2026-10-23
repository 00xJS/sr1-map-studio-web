// The game-objects worker: reads the player's own packfiles (by byte range, nothing uploaded) to build the
// library index chunk by chunk, and cuts single objects out with their textures for thumbnails, the placement
// ghost and placing. Keeps the packfiles open and the last few chunks and texture files parsed.
/// <reference lib="webworker" />
import { openVpp, type Vpp } from '../sr1char/vpp'
import { readChunk, type Chunk } from './chunk'
import type { PegImage } from '../sr1char/peg'
import { indexChunk, type Candidate } from './indexer'
import { extractObject, type ObjectMesh } from './extract'
import { ALWAYS_PEGS, chunkPegNames, findTexture, hasAlpha, indexPeg, shrink, textureDirectory, type PegIndex, type TextureDirectory } from './textures'

/** A packfile: a File from the player's folder, or (development only) a URL the dev server serves by range. */
export type PackSource = File | { url: string; size: number }

export interface ObjectTexture { width: number; height: number; rgba: ArrayBuffer; alpha: boolean }
export interface ObjectResult { mesh: ObjectMesh; textures: (ObjectTexture | null)[] }

export type Request =
  | { id: number; type: 'open'; packs: Record<string, PackSource> }
  | { id: number; type: 'index'; skip: string[] }
  | { id: number; type: 'texdir'; dir: TextureDirectory }
  | { id: number; type: 'object'; pack: string; chunk: string; record: number; parts?: number[]; texSize: number }

export type Reply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }
  | { id: number; type: 'chunk'; key: string; candidates: Candidate[]; done: number; total: number; ms: number }

/** Library packfiles: the city, the multiplayer maps, and misc2 (the always-loaded city chunks and textures). */
export const INDEX_PACKS = ['sr_city_stream', 'mp_city_stream', 'misc2']

const post = (m: Reply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)

/** Byte ranges of a URL, shaped like the Blob slices openVpp reads (development only). */
function rangeSource(url: string, size: number): Blob {
  const slice = (a = 0, b = size) => ({
    async arrayBuffer() {
      const r = await fetch(url, { headers: { Range: `bytes=${a}-${Math.min(b, size) - 1}` } })
      if (r.status !== 206 && r.status !== 200) throw new Error('could not read ' + url)
      return r.arrayBuffer()
    },
  })
  return { size, slice } as unknown as Blob
}

const vpps = new Map<string, Promise<Vpp>>()

function openPacks(packs: Record<string, PackSource>) {
  vpps.clear()
  chunks.clear()
  pegs.clear()
  always = null
  for (const [name, src] of Object.entries(packs)) {
    const blob = src instanceof Blob ? src : rangeSource(src.url, src.size)
    const p = openVpp(blob, name + '.vpp_xbox2')
    p.catch(() => {})
    vpps.set(name, p)
  }
  return Object.keys(packs)
}

async function pack(name: string): Promise<Vpp> {
  const v = vpps.get(name)
  if (!v) throw new Error(`${name}.vpp_xbox2 isn't open`)
  return v
}

/** A small least-recently-used cache. */
class Lru<V> {
  private m = new Map<string, V>()
  constructor(private max: number) {}
  get(k: string) { const v = this.m.get(k); if (v !== undefined) { this.m.delete(k); this.m.set(k, v) } return v }
  set(k: string, v: V) { this.m.delete(k); this.m.set(k, v); while (this.m.size > this.max) this.m.delete(this.m.keys().next().value!) }
  clear() { this.m.clear() }
}
const chunks = new Lru<Promise<Chunk>>(4)
const pegs = new Lru<Promise<PegIndex | null>>(4)
let always: Promise<PegIndex[]> | null = null
let texDir: TextureDirectory | null = null

function chunkOf(p: string, c: string): Promise<Chunk> {
  const k = p + '/' + c
  let v = chunks.get(k)
  if (!v) {
    v = pack(p).then(async (vpp) => readChunk(await vpp.read(c + '.bbchunk_xbox2')))
    v.catch(() => {})
    chunks.set(k, v)
  }
  return v
}

function pegOf(p: string, name: string): Promise<PegIndex | null> {
  const k = p + '/' + name
  let v = pegs.get(k)
  if (!v) {
    v = pack(p).then(async (vpp) => (vpp.has(name) ? indexPeg(await vpp.read(name)) : null)).catch(() => null)
    pegs.set(k, v)
  }
  return v
}

function alwaysPegs(): Promise<PegIndex[]> {
  return (always ??= (async () => {
    const out: PegIndex[] = []
    if (!vpps.has('misc2')) return out
    for (const n of ALWAYS_PEGS) { const p = await pegOf('misc2', n); if (p) out.push(p) }
    return out
  })())
}

async function texturesFor(p: string, chunk: string, names: string[], max: number): Promise<(ObjectTexture | null)[]> {
  const own: PegIndex[] = []
  for (const n of chunkPegNames(chunk)) {
    const x = await pegOf(p, n)
    if (x) own.push(x)
    // The always-loaded city chunks live in misc2; their pictures may sit in the city packfile.
    else if (p === 'misc2' && vpps.has('sr_city_stream')) { const y = await pegOf('sr_city_stream', n); if (y) own.push(y) }
  }
  const all = [...own, ...(await alwaysPegs())]
  const out: (ObjectTexture | null)[] = []
  for (const n of names) {
    let img = n ? findTexture(n, all) : null
    // Not in the usual places (the chunk's own file only points at it): the texture file that really holds it.
    const where = n && !img && texDir ? texDir.names[n.toLowerCase()] : undefined
    if (where !== undefined) {
      const [wp, ...rest] = texDir!.pegs[where].split('/')
      const peg = await pegOf(wp, rest.join('/'))
      if (peg) img = findTexture(n, [peg])
    }
    out.push(img ? small(img, max) : null)
  }
  return out
}

function small(img: PegImage, max: number): ObjectTexture {
  const s = shrink(img, max)
  return { width: s.width, height: s.height, rgba: s.rgba.slice().buffer, alpha: hasAlpha(s) }
}


async function index(id: number, skip: Set<string>) {
  const jobs: [string, string][] = []
  const named = new Set<string>()
  for (const p of INDEX_PACKS) {
    if (!vpps.has(p)) continue
    const vpp = await pack(p)
    for (const n of vpp.list()) {
      const c = n.replace(/\.bbchunk_xbox2$/i, '')
      // misc2 repeats some city chunks: read each once.
      if (c === n || named.has(c.toLowerCase())) continue
      named.add(c.toLowerCase())
      jobs.push([p, c])
    }
  }
  const failed: string[] = []
  let done = 0
  for (const [p, c] of jobs) {
    const key = p + '/' + c
    done++
    if (skip.has(key)) continue
    const t = performance.now()
    let candidates: Candidate[] = []
    try {
      const vpp = await pack(p)
      candidates = indexChunk(readChunk(await vpp.read(c + '.bbchunk_xbox2')), p, c)
    } catch (e) {
      failed.push(`${c}: ${(e as Error).message}`)
    }
    post({ id, type: 'chunk', key, candidates, done, total: jobs.length, ms: performance.now() - t })
  }
  const opened: [string, Vpp][] = []
  for (const p of INDEX_PACKS) if (vpps.has(p)) opened.push([p, await pack(p)])
  texDir = await textureDirectory(opened)
  return { total: jobs.length, failed, texDir }
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const m = e.data
  try {
    if (m.type === 'open') post({ id: m.id, ok: true, value: openPacks(m.packs) })
    else if (m.type === 'texdir') { texDir = m.dir; post({ id: m.id, ok: true, value: true }) }
    else if (m.type === 'index') post({ id: m.id, ok: true, value: await index(m.id, new Set(m.skip)) })
    else if (m.type === 'object') {
      const ch = await chunkOf(m.pack, m.chunk)
      const mesh = extractObject(ch, m)
      const textures = await texturesFor(m.pack, m.chunk, mesh.materials, m.texSize)
      const transfer: Transferable[] = [mesh.positions.buffer, mesh.uvs.buffer, mesh.triangles.buffer, mesh.triMaterial.buffer]
      for (const t of textures) if (t) transfer.push(t.rgba)
      post({ id: m.id, ok: true, value: { mesh, textures } satisfies ObjectResult }, transfer)
    }
  } catch (err) {
    post({ id: m.id, ok: false, error: (err as Error).message || String(err) })
  }
}
