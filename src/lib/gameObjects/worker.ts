// The game-objects worker: reads the player's own packfiles (by byte range, nothing uploaded) to build the
// library index chunk by chunk, and cuts single objects out with their textures for thumbnails, the placement
// ghost and placing. Keeps the packfiles open and the last few chunks and texture files parsed.
/// <reference lib="webworker" />
import { openVpp, type Vpp } from '../sr1char/vpp'
import { readChunk, type Chunk } from './chunk'
import type { PegImage } from '../sr1char/peg'
import { indexChunk, type Candidate, isMpChunk, summarizeChunk, type MapSummary } from './indexer'
import { extractObject, type ObjectMesh } from './extract'
import { lookTextures } from './material'
import { ALWAYS_PEGS, INVISIBLE_TEXTURE, chunkPegNames, findShared, findTexture, hasAlpha, indexPeg, shrink, textureDirectory, textureSize, type PegIndex, type TextureDirectory } from './textures'
import { MAP, cutArea, isCityChunk, mapChunk, scanArea, type ChunkSummary, type CutPiece, type Hole, type Rect } from '../city/city'

/** A packfile: a File from the player's folder, or (development only) a URL the dev server serves by range. */
export type PackSource = File | { url: string; size: number }

export interface ObjectTexture { width: number; height: number; rgba: ArrayBuffer; alpha: boolean }
/**
 * A cut-out object: its mesh, the diffuse picture per material, and the pictures its materials' other layers use
 * (decals, masks, normal and specular maps), by lower-cased texture name.
 */
export interface ObjectResult { mesh: ObjectMesh; textures: (ObjectTexture | null)[]; layers?: Record<string, ObjectTexture | null> }

export type Request =
  | { id: number; type: 'open'; packs: Record<string, PackSource> }
  | { id: number; type: 'index'; skip: string[] }
  | { id: number; type: 'texdir'; dir: TextureDirectory }
  | { id: number; type: 'object'; pack: string; chunk: string; record: number; parts?: number[]; texSize: number; layers?: boolean }
  | { id: number; type: 'cityMap' }
  | { id: number; type: 'cityCut'; rect: Rect; stems: string[]; texSize: number }
  | { id: number; type: 'cityScan'; rect: Rect; stems: string[] }
  | { id: number; type: 'cityTextures'; rect: Rect; stems: string[] }

export type Reply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }
  | { id: number; type: 'chunk'; key: string; candidates: Candidate[]; summary?: MapSummary; done: number; total: number; ms: number }
  | { id: number; type: 'progress'; done: number; total: number }

/** The city map: highest surface per pixel (decimetres, -32768 for nothing), what it is (see Ground), and which chunks cover where. */
export interface CityMap { top: Int16Array; kind: Uint8Array; summaries: ChunkSummary[]; texDir?: TextureDirectory }
/**
 * A cut-out: what's solid and what's only drawn, sharing one list of materials and their pictures, and the game
 * object (piece) each triangle of either belongs to.
 */
export interface CityCut {
  solid: ObjectResult; look: ObjectResult; ground: number; standable: [number, number, number][]
  pieces: CutPiece[]; solidPiece: Uint32Array; lookPiece: Uint32Array
}

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
const chunks = new Lru<Promise<Chunk>>(8)
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
    if (n && INVISIBLE_TEXTURE.test(n)) { out.push({ width: 8, height: 8, rgba: new Uint8Array(8 * 8 * 4).buffer, alpha: true }); continue }
    let img = n ? findTexture(n, all) : null
    // Not in the usual places (the chunk's own file only points at it): the texture file that really holds it.
    const where = n && !img && texDir ? texDir.names[n.toLowerCase()] : undefined
    if (where !== undefined) {
      const [wp, ...rest] = texDir!.pegs[where].split('/')
      const peg = await pegOf(wp, rest.join('/'))
      if (peg) img = findTexture(n, [peg])
    }
    // Last: a picture that points into pixels it shares with another entry, read where it points.
    if (n && !img) img = findShared(n, all)
    out.push(img ? small(img, max) : null)
  }
  return out
}

/** The layer pictures of the given materials' looks, decoded once each into `out`. */
async function layersFor(p: string, chunk: string, mesh: ObjectMesh, mats: number[], max: number, out: Record<string, ObjectTexture | null>) {
  const names = [...new Set(mats.flatMap((i) => lookTextures(mesh.looks?.[i] ?? null)))].filter((n) => !(n.toLowerCase() in out))
  if (!names.length) return
  const found = await texturesFor(p, chunk, names, max)
  names.forEach((n, k) => { out[n.toLowerCase()] = found[k] })
}

const meshBuffers = (m: ObjectMesh): Transferable[] =>
  [m.positions.buffer, m.uvs.buffer, m.triangles.buffer, m.triMaterial.buffer, ...(m.extraUvs ?? []).map((u) => u.buffer), ...(m.normals ? [m.normals.buffer] : [])]

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
    let summary: MapSummary | undefined
    try {
      const vpp = await pack(p)
      const ch = readChunk(await vpp.read(c + '.bbchunk_xbox2'))
      candidates = indexChunk(ch, p, c)
      if (isMpChunk(p, c)) summary = summarizeChunk(ch, c)
    } catch (e) {
      failed.push(`${c}: ${(e as Error).message}`)
    }
    post({ id, type: 'chunk', key, candidates, summary, done, total: jobs.length, ms: performance.now() - t })
  }
  const opened: [string, Vpp][] = []
  for (const p of INDEX_PACKS) if (vpps.has(p)) opened.push([p, await pack(p)])
  texDir = await textureDirectory(opened)
  return { total: jobs.length, failed, texDir }
}

// ---------------- the city ----------------

async function cityStems(): Promise<string[]> {
  const vpp = await pack('sr_city_stream')
  return vpp.list().filter((n) => /\.bbchunk_xbox2$/i.test(n)).map((n) => n.replace(/\.bbchunk_xbox2$/i, '')).filter(isCityChunk)
}

async function cityMap(id: number): Promise<CityMap> {
  const stems = await cityStems()
  const top = new Float32Array(MAP.size * MAP.size).fill(-Infinity)
  const kind = new Uint8Array(MAP.size * MAP.size)
  const summaries: ChunkSummary[] = []
  for (const [i, stem] of stems.entries()) {
    try { summaries.push(mapChunk(await chunkOf('sr_city_stream', stem), stem, top, kind)) } catch { /* an unreadable chunk leaves a gap */ }
    post({ id, type: 'progress', done: i + 1, total: stems.length })
  }
  const out = new Int16Array(top.length)
  for (let i = 0; i < top.length; i++) out[i] = top[i] > -1e4 ? Math.max(-32767, Math.min(32767, Math.round(top[i] * 10))) : -32768
  // Which texture file holds each picture (as the library builds it), so cut-outs find every texture.
  if (!texDir) {
    const opened: [string, Vpp][] = []
    for (const p of INDEX_PACKS) if (vpps.has(p)) opened.push([p, await pack(p)])
    texDir = await textureDirectory(opened)
  }
  return { top: out, kind, summaries, texDir }
}

async function areaChunks(stems: string[]) {
  const out: [string, Awaited<ReturnType<typeof chunkOf>>][] = []
  for (const s of stems) out.push([s, await chunkOf('sr_city_stream', s)])
  return out
}

/** The different pictures a cut of the area would bring: name, width, height, alpha (sizes from the entry tables). */
async function cityTextures(m: Extract<Request, { type: 'cityTextures' }>): Promise<[string, number, number, boolean][]> {
  const cut = cutArea(await areaChunks(m.stems), m.rect)
  const byChunk = new Map<string, string[]>()
  cut.matChunk.forEach((c, i) => { const l = byChunk.get(c); if (l) l.push(cut.solid.materials[i]); else byChunk.set(c, [cut.solid.materials[i]]) })
  const out = new Map<string, [string, number, number, boolean]>()
  for (const [c, names] of byChunk) {
    const own: PegIndex[] = []
    for (const n of chunkPegNames(c)) { const x = await pegOf('sr_city_stream', n); if (x) own.push(x) }
    const all = [...own, ...(await alwaysPegs())]
    for (const n of names) {
      if (!n || out.has(n.toLowerCase()) || INVISIBLE_TEXTURE.test(n)) continue
      let wh = textureSize(n, all)
      const where = !wh && texDir ? texDir.names[n.toLowerCase()] : undefined
      if (where !== undefined) {
        const [wp, ...rest] = texDir!.pegs[where].split('/')
        const peg = await pegOf(wp, rest.join('/'))
        if (peg) wh = textureSize(n, [peg])
      }
      out.set(n.toLowerCase(), [n, wh?.[0] ?? 256, wh?.[1] ?? 256, wh?.[2] ?? false])
    }
  }
  return [...out.values()]
}

async function cityCut(m: Extract<Request, { type: 'cityCut' }>): Promise<CityCut> {
  const cut = cutArea(await areaChunks(m.stems), m.rect)
  // Pictures: each material's from the chunk it was first met in.
  const byChunk = new Map<string, number[]>()
  cut.matChunk.forEach((c, i) => { const l = byChunk.get(c); if (l) l.push(i); else byChunk.set(c, [i]) })
  const textures: (ObjectTexture | null)[] = cut.solid.materials.map(() => null)
  const layers: Record<string, ObjectTexture | null> = {}
  for (const [c, list] of byChunk) {
    const found = await texturesFor('sr_city_stream', c, list.map((i) => cut.solid.materials[i]), m.texSize)
    list.forEach((i, k) => { textures[i] = found[k] })
    await layersFor('sr_city_stream', c, cut.solid, list, m.texSize, layers)
  }
  return {
    solid: { mesh: cut.solid, textures, layers }, look: { mesh: cut.look, textures, layers }, ground: cut.ground, standable: cut.standable,
    pieces: cut.pieces, solidPiece: cut.solidPiece, lookPiece: cut.lookPiece,
  }
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const m = e.data
  try {
    if (m.type === 'open') post({ id: m.id, ok: true, value: openPacks(m.packs) })
    else if (m.type === 'texdir') { texDir = m.dir; post({ id: m.id, ok: true, value: true }) }
    else if (m.type === 'index') post({ id: m.id, ok: true, value: await index(m.id, new Set(m.skip)) })
    else if (m.type === 'cityMap') {
      const v = await cityMap(m.id)
      post({ id: m.id, ok: true, value: v }, [v.top.buffer, v.kind.buffer])
    } else if (m.type === 'cityScan') post({ id: m.id, ok: true, value: scanArea(await areaChunks(m.stems), m.rect) satisfies Hole[] })
    else if (m.type === 'cityTextures') post({ id: m.id, ok: true, value: await cityTextures(m) })
    else if (m.type === 'cityCut') {
      const v = await cityCut(m)
      // Both meshes share the pictures: send them once (the look mesh's list is the same objects).
      const transfer: Transferable[] = []
      for (const r of [v.solid, v.look]) transfer.push(...meshBuffers(r.mesh))
      for (const t of v.solid.textures) if (t) transfer.push(t.rgba)
      for (const t of Object.values(v.solid.layers ?? {})) if (t && !transfer.includes(t.rgba)) transfer.push(t.rgba)
      transfer.push(v.solidPiece.buffer, v.lookPiece.buffer)
      post({ id: m.id, ok: true, value: v }, transfer)
    } else if (m.type === 'object') {
      const ch = await chunkOf(m.pack, m.chunk)
      const mesh = extractObject(ch, m)
      // texSize 0: the shape only (measuring it), no pictures.
      const textures = m.texSize > 0 ? await texturesFor(m.pack, m.chunk, mesh.materials, m.texSize) : mesh.materials.map(() => null)
      const layers: Record<string, ObjectTexture | null> = {}
      if (m.layers) await layersFor(m.pack, m.chunk, mesh, mesh.materials.map((_, i) => i), m.texSize, layers)
      const transfer: Transferable[] = meshBuffers(mesh)
      for (const t of textures) if (t) transfer.push(t.rgba)
      for (const t of Object.values(layers)) if (t) transfer.push(t.rgba)
      post({ id: m.id, ok: true, value: { mesh, textures, layers } satisfies ObjectResult }, transfer)
    }
  } catch (err) {
    post({ id: m.id, ok: false, error: (err as Error).message || String(err) })
  }
}
