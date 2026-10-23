// Builds the "From my game" library from the player's map chunks: one entry per distinct object (a placed
// prop, sign, fence, light...) or building (the parts that share a building code and stand together). Copies of
// one model are found by a fingerprint of their geometry (strip length, size and main texture), whatever they
// are called, so a model copied into many chunks is one entry. Pure functions: the worker runs them on chunks
// read from the player's own packfiles, and the tests on synthetic and real chunks.
import { meshIndexCount, meshTextures, meshTriangleCount, type Chunk } from './chunk'
import { BUILDINGS, CATEGORIES, OTHER, baseName, buildingCode, categoryOf, skipName } from './classify'

export type Vec3 = [number, number, number]

/** One library entry. Sizes are metres: length and width across, height up. */
export interface GameObjectEntry {
  id: string
  /** Short name (the base name of its records, or the building code). */
  name: string
  /** Other names the same model goes by, for searching. */
  names?: string[]
  cat: string
  /** The game's physics profile name ('' for none). */
  profile: string
  /** Where it was read from: packfile stem and chunk stem. */
  pack: string
  chunk: string
  /** The static record placed (the first part, for buildings). */
  record: number
  /** Buildings: every part's record. */
  parts?: number[]
  size: Vec3
  tris: number
  /** Diffuse texture names, most used first. */
  tex: string[]
  /** How many times the game places it. */
  seen: number
  /** It has its own physics shape in the game. */
  physics?: boolean
}

/** A chunk's entries before they are merged with the other chunks'. */
export interface Candidate extends GameObjectEntry { key: string; up: number }

/** Objects bigger than this across are roads, ground and the like. */
const MAX_SIDE = 90
const MIN_SIDE = 0.03
/** Parts of one building closer than this (metres) belong together. */
const JOIN_GAP = 1.5

type Box = { min: Vec3; max: Vec3 }

/** The box round the vertices a mesh's strips actually use (vertex buffers are shared, so its own box is loose). */
export function meshBounds(ch: Chunk, meshIndex: number): Box | null {
  const mesh = ch.meshes[meshIndex]
  if (!mesh) return null
  const dv = new DataView(ch.bytes.buffer, ch.bytes.byteOffset, ch.bytes.byteLength)
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const s of mesh.subs) {
    const vb = ch.vbs[s.vb]
    if (!vb || vb.stride < 12 || !vb.count || vb.vertexBytes < vb.stride * vb.count) continue
    const seen = new Uint8Array(vb.count)
    for (const b of s.batches) {
      if (b.first + b.count > vb.indexCount) continue
      for (let j = 0; j < b.count; j++) {
        const i = dv.getUint16(vb.indexAt + 2 * (b.first + j))
        if (i >= vb.count || seen[i]) continue
        seen[i] = 1
        const o = vb.vertexAt + vb.stride * i
        for (let k = 0; k < 3; k++) {
          const v = dv.getFloat32(o + 4 * k)
          if (!Number.isFinite(v) || Math.abs(v) > 1e5) continue
          if (v < min[k]) min[k] = v
          if (v > max[k]) max[k] = v
        }
      }
    }
  }
  return min[0] <= max[0] ? { min, max } : null
}

/** World box of a mesh box under an instance (rotation column-major: column k is where local axis k goes). */
function worldBox(b: Box, pos: number[], R: number[]): Box {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let c = 0; c < 8; c++) {
    const p = [c & 1 ? b.max[0] : b.min[0], c & 2 ? b.max[1] : b.min[1], c & 4 ? b.max[2] : b.min[2]]
    for (let j = 0; j < 3; j++) {
      const w = pos[j] + p[0] * R[j] + p[1] * R[3 + j] + p[2] * R[6 + j]
      if (w < min[j]) min[j] = w
      if (w > max[j]) max[j] = w
    }
  }
  return { min, max }
}

/** The local axis an instance turns into world up. */
export const upAxis = (R: number[]) => [0, 1, 2].reduce((best, k) => (Math.abs(R[3 * k + 1]) > Math.abs(R[3 * best + 1]) ? k : best), 0)

const r2 = (v: number) => Math.round(v * 100) / 100

/** A short id from a key (two 32-bit FNV-1a hashes). */
export function keyId(key: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15)
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36)
}

/** The distinct objects and buildings of one chunk. */
export function indexChunk(ch: Chunk, pack: string, chunk: string): Candidate[] {
  const bounds = new Map<number, Box | null>()
  const boundsOf = (m: number) => { if (!bounds.has(m)) bounds.set(m, meshBounds(ch, m)); return bounds.get(m)! }
  const out = new Map<string, Candidate>()
  const groups = new Map<string, number[]>()
  const singles: number[] = []

  ch.records.forEach((rec, i) => {
    const lname = rec.name.toLowerCase()
    if (!lname || skipName(lname)) return
    const inst = ch.instances[rec.instance]
    if (!inst || !ch.meshes[inst.mesh]?.subs.length) return
    const code = (!rec.profile || rec.profile === 'Default') ? buildingCode(lname) : null
    if (code) { const g = groups.get(code); if (g) g.push(i); else groups.set(code, [i]) }
    else singles.push(i)
  })

  // Buildings: the parts with one code that stand together; small groups are single objects after all.
  for (const [code, recs] of groups) {
    if (recs.length < 3) { singles.push(...recs); continue }
    const boxes = recs.map((i) => {
      const inst = ch.instances[ch.records[i].instance]
      const b = boundsOf(inst.mesh)
      return b ? worldBox(b, inst.position, inst.rotation) : null
    })
    const parent = recs.map((_, i) => i)
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
    for (let a = 0; a < recs.length; a++) for (let b = a + 1; b < recs.length; b++) {
      const A = boxes[a], B = boxes[b]
      if (!A || !B) continue
      if ([0, 1, 2].every((k) => A.min[k] - JOIN_GAP <= B.max[k] && B.min[k] - JOIN_GAP <= A.max[k])) parent[find(a)] = find(b)
    }
    const clusters = new Map<number, number[]>()
    recs.forEach((_, i) => { if (!boxes[i]) return; const r = find(i); const c = clusters.get(r); if (c) c.push(i); else clusters.set(r, [i]) })
    for (const members of clusters.values()) {
      if (members.length < 3) { singles.push(...members.map((m) => recs[m])); continue }
      const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
      let idx = 0, tris = 0
      const tex = new Map<string, number>()
      for (const m of members) {
        const b = boxes[m]!
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], b.min[k]); max[k] = Math.max(max[k], b.max[k]) }
        const mesh = ch.meshes[ch.instances[ch.records[recs[m]].instance].mesh]
        idx += meshIndexCount(mesh)
        tris += meshTriangleCount(ch, mesh)
        meshTextures(ch, mesh).forEach((t, n) => tex.set(t, (tex.get(t) ?? 0) + (n === 0 ? 2 : 1)))
      }
      const ext = [0, 1, 2].map((k) => max[k] - min[k])
      if (Math.max(ext[0], ext[2]) > 250) continue
      const size: Vec3 = [r2(Math.max(ext[0], ext[2])), r2(Math.min(ext[0], ext[2])), r2(ext[1])]
      const key = `b|${members.length}|${idx}|${ext.map((v) => Math.round(v * 10)).join(',')}`
      const parts = members.map((m) => recs[m]).sort((a, b) => a - b)
      const prev = out.get(key)
      if (prev) { prev.seen++; continue }
      out.set(key, {
        key, up: 1, id: keyId(key), name: code, cat: BUILDINGS, profile: '', pack, chunk, record: parts[0], parts,
        size, tris, tex: [...tex.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t), seen: 1,
      })
    }
  }

  for (const i of singles) {
    const rec = ch.records[i]
    const inst = ch.instances[rec.instance]
    const mesh = ch.meshes[inst.mesh]
    const b = boundsOf(inst.mesh)
    if (!b) continue
    const ext = [0, 1, 2].map((k) => b.max[k] - b.min[k])
    const up = upAxis(inst.rotation)
    const across = [0, 1, 2].filter((k) => k !== up).map((k) => ext[k])
    const size: Vec3 = [r2(Math.max(...across)), r2(Math.min(...across)), r2(ext[up])]
    if (Math.max(...size) > MAX_SIDE || Math.max(...size) < MIN_SIDE) continue
    const tex = meshTextures(ch, mesh)
    const key = `o|${meshIndexCount(mesh)}|${ext.map((v) => Math.round(v * 100)).join(',')}|${(tex[0] ?? '').toLowerCase()}`
    const name = baseName(rec.name)
    const prev = out.get(key)
    if (prev) {
      prev.seen++
      if (name !== prev.name && !prev.names?.includes(name) && (prev.names?.length ?? 0) < 4) (prev.names ??= []).push(name)
      continue
    }
    out.set(key, {
      key, up, id: keyId(key), name, cat: categoryOf(rec.profile, name), profile: rec.profile === 'Default' ? '' : rec.profile,
      pack, chunk, record: i, size, tris: meshTriangleCount(ch, mesh), tex: tex.slice(0, 4), seen: 1, ...(rec.shape >= 0 ? { physics: true } : {}),
    })
  }
  return [...out.values()]
}

/** Pieces with no category and no profile are mostly bits of buildings and ground: kept when the game reuses them and they are not too big. */
const keep = (c: Candidate, seen: number) => c.cat !== OTHER || !!c.profile || (seen >= 2 && Math.max(...c.size) <= 12)

/**
 * Merges every chunk's candidates into the library: one entry per key, placed where the model is most often
 * stood the same way up, named after its most common name. Sorted by category (in the library's order), then by
 * how often the game uses it.
 */
export function mergeCandidates(all: Iterable<Candidate>): GameObjectEntry[] {
  const by = new Map<string, { copies: Candidate[]; seen: number; names: Map<string, number>; ups: Map<number, number> }>()
  // How many different objects each chunk holds: copies are taken from as few chunks as possible, so drawing a
  // page of pictures reads few chunks.
  const perChunk = new Map<string, number>()
  for (const c of all) {
    let g = by.get(c.key)
    if (!g) by.set(c.key, (g = { copies: [], seen: 0, names: new Map(), ups: new Map() }))
    g.copies.push(c)
    g.seen += c.seen
    for (const n of [c.name, ...(c.names ?? [])]) g.names.set(n, (g.names.get(n) ?? 0) + (n === c.name ? c.seen : 1))
    g.ups.set(c.up, (g.ups.get(c.up) ?? 0) + c.seen)
    const ck = c.pack + '/' + c.chunk
    perChunk.set(ck, (perChunk.get(ck) ?? 0) + 1)
  }
  const entries: GameObjectEntry[] = []
  for (const g of by.values()) {
    // A copy that stands the way most copies do, from the busiest chunk.
    const upBest = [...g.ups.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const score = (c: Candidate) => (c.up === upBest ? 1e9 : 0) + (perChunk.get(c.pack + '/' + c.chunk) ?? 0)
    const best = g.copies.reduce((a, b) => (score(b) > score(a) ? b : a))
    if (!keep(best, g.seen)) continue
    const { key: _k, up: _u, names: _n, ...e } = best
    const names = [...g.names.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n)
    const entry: GameObjectEntry = { ...e, name: names[0] ?? e.name, seen: g.seen }
    if (names.length > 1) entry.names = names.slice(1, 5)
    else delete entry.names
    entries.push(entry)
  }
  const rank = (c: string) => { const i = CATEGORIES.indexOf(c); return i < 0 ? CATEGORIES.length : i }
  return entries.sort((a, b) => rank(a.cat) - rank(b.cat) || b.seen - a.seen || a.name.localeCompare(b.name))
}
