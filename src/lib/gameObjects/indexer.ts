// Builds the "From my game" library from the player's map chunks: one entry per distinct object (a placed
// prop, sign, fence, light...) or building (the parts that share a building code and stand together). Copies of
// one model are found by a fingerprint of their geometry (strip length, size and main texture), whatever they
// are called, so a model copied into many chunks is one entry. Pure functions: the worker runs them on chunks
// read from the player's own packfiles, and the tests on synthetic and real chunks.
import { meshIndexCount, meshTextures, meshTriangleCount, type Chunk } from './chunk'
import { extractObject } from './extract'
import { eyeCover } from './eyeCover'
import { baseName, buildingCode, skipName } from './classify'
import { BUILDINGS, CATEGORIES, buildingKind, chunkDistricts, identify } from './identity'
import { SITS_LEN, Solid, probeChunk, sitsFrom, type Sits, type Target } from './sits'
import { cityData, isStudyChunk, studyChunk, studyCity, type Cover, type Site } from './cityStudy'
import type { CityGroup, CityModule } from './cityModules'

export type Vec3 = [number, number, number]

/** One library entry. Sizes are metres: length and width across, height up. */
export interface GameObjectEntry {
  id: string
  /** Short name (the base name of its records, or the building code). */
  name: string
  /** Other names the same model goes by, for searching. */
  names?: string[]
  /** The game's own names for it, as written (record names like "14mailboxA01"), for searching. */
  raw?: string[]
  cat: string
  /** The game's physics profile name ('' for none). */
  profile: string
  /** Where it was read from: packfile stem and chunk stem. */
  pack: string
  chunk: string
  /** The static record placed (the first part, for buildings); -(instance + 1) for a piece the game placed without a record. */
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
  /** The multiplayer maps it is in (their chunk names), and 'city' when Stilwater has it too. */
  where?: string[]
  /** The Stilwater districts the chunks it is placed in belong to (as far as their names tell). */
  districts?: string[]
  /** Buildings: the side of its own frame (as cut out) its doors and shop fronts face, and the axis its long side runs along. */
  front?: '+x' | '-x' | '+z' | '-z'
  long?: 'x' | 'z'
  /**
   * The models the game always places with this one at the same spot (a lamp's base, a fence panel's feet, a
   * trailer's other half): together they make the whole thing. `at` is where the part's feet stand in this
   * model's own frame as cut out (game axes, metres) and `yaw` its turn about +Y relative to this one (radians);
   * `share` how many of this model's placements have it there.
   */
  assembly?: GamePart[]
  /** This model is one of those parts of another (its id). */
  partOf?: string
  /**
   * Another model of the same size the game always places at exactly the same spot as this one (a second copy
   * of it, sometimes its damaged state): place one or the other, never both. `copyNames` are that model's names,
   * for a copy that has none of its own.
   */
  copyOf?: string
  copyNames?: string[]
  /** Models the game most often stands within a few metres of this one, most telling first, with how often. */
  near?: { id: string; n: number }[]
  /**
   * What the game stands on top of this one (a lamp post on its base, a sign on its pole's foot, a crate on a pallet):
   * each model, how many of this one's placements have it there, where its feet stand in this one's frame (metres)
   * and turned how (radians). Several of them are the variations that fit this base.
   */
  tops?: { id: string; n: number; at: Vec3; yaw: number }[]
  /** The models this one stands on top of (its bases), and how often. */
  bases?: { id: string; n: number }[]
  /**
   * A piece only ever used on one kind of building (its windows, doors, trims and corners made for it): that
   * building's code ("bsad2a"), and the library's buildings of that kind it stands on (ids, most used first).
   * Kit pieces are not to be mixed onto other buildings.
   */
  kitOf?: string
  belongsTo?: string[]
  /** Buildings: the pieces made only for buildings of this kind (ids), its kit. */
  kit?: string[]
  /**
   * Buildings and models the size of one: how solid it is at eye height as cut out (eyeCover.ts, 0..1). Low for
   * a canopy on posts, a frame, or a building's front whose sides the game keeps elsewhere.
   */
  eye?: number
  /**
   * Buildings: every piece the game places on most copies of this building, where (its feet in the building's
   * cut-out frame, game axes, metres) and turned how (radians about +Y): what completes it.
   */
  layout?: GamePart[]
  /** How the game stands it (on the ground, on a wall, on a roof, hanging), from a few of its placements per chunk (sits.ts). */
  sits?: Sits
  /** The groups of things the city keeps placing with this one, this one their anchor (cityStudy.ts; cityModules.ts groups()). */
  groups?: CityGroup[]
  /** Buildings: this building cut out of the city with what stands on and around it (cityStudy.ts; cityModules.ts cityModules()). */
  modules?: CityModule[]
}

export interface GamePart { id: string; at: Vec3; yaw: number; share: number }

/** What a retail multiplayer map holds, for the library's per-map view. */
export interface MapSummary {
  chunk: string
  /** Named objects and placed pieces. */
  records: number
  instances: number
  /** Placed point lights (the count at header +884). */
  lights: number
  /** It carries the game's sky objects (sun, moon, stars, clouds). */
  sky: boolean
  materials: number
  textures: number
  /** Where its pieces stand, metres: [minX, minZ, maxX, maxZ]. */
  extent: [number, number, number, number]
}

/** Multiplayer map chunks: the playable maps and their always-loaded halves. */
export const isMpChunk = (pack: string, chunk: string) => pack === 'mp_city_stream' && /^mp_/i.test(chunk)

/** A map chunk's contents in numbers. */
export function summarizeChunk(ch: Chunk, chunk: string): MapSummary {
  const dv = new DataView(ch.bytes.buffer, ch.bytes.byteOffset, ch.bytes.byteLength)
  const lights = ch.bytes.byteLength > 888 ? dv.getUint32(884) : 0
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (const inst of ch.instances) {
    const [x, , z] = inst.position
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 1e5 || Math.abs(z) > 1e5) continue
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z)
  }
  const tex = new Set<string>()
  for (const m of ch.materials) for (const t of m.textures ?? []) tex.add(t.toLowerCase())
  const sky = ['sun', 'moon', 'stars'].every((n) => ch.records.some((r) => r.name.toLowerCase() === n))
  const r1 = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0)
  return { chunk, records: ch.records.length, instances: ch.instances.length, lights: lights < 10000 ? lights : 0, sky, materials: ch.materials.length, textures: tex.size, extent: [r1(x0), r1(z0), r1(x1), r1(z1)] }
}

/**
 * A chunk's entries before they are merged with the other chunks'. `close` counts the models found at each spot
 * next to its placements (by id, offset and turn: [count, summed x, y, z, turn]); `around` how many of its
 * placements have each model within NEAR metres.
 */
export interface Candidate extends GameObjectEntry {
  key: string; up: number; close?: Record<string, number[]>; around?: Record<string, number>; on?: Record<string, number>; onAt?: Record<string, number[]>
  /**
   * City chunks (the Stilwater study, cityStudy.ts): where each copy stands (x, y, z, turn), its size across in its
   * own frame, a building's sites (one per copy) and a piece of ground's cover.
   */
  spots?: number[]; foot?: [number, number]; sites?: Site[]; cover?: Cover
  /** How the chunk stands it (sits.ts): the counts (SITS_LEN numbers) and its cover at eye height. */
  sitSums?: number[]; sitCover?: number
}

/** Smaller than this across is a speck nobody could place. */
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

/** The vertical turn of an instance: the angle its first level axis makes with +X, about +Y. */
export function yawOf(R: number[], up: number) {
  const h = [0, 1, 2].find((k) => k !== up)!
  return Math.atan2(R[3 * h + 2], R[3 * h])
}

/**
 * Where a single object's feet stand in the world when cut out the way extract.ts cuts it (its turn about the
 * vertical taken out, centred across, feet at the bottom), and that turn.
 */
function anchorOf(b: Box, pos: number[], R: number[]): { at: Vec3; yaw: number; ext: [number, number] } {
  const yaw = yawOf(R, upAxis(R)), c = Math.cos(yaw), s = Math.sin(yaw)
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let k = 0; k < 8; k++) {
    const p = [k & 1 ? b.max[0] : b.min[0], k & 2 ? b.max[1] : b.min[1], k & 4 ? b.max[2] : b.min[2]]
    const w = [0, 1, 2].map((j) => p[0] * R[j] + p[1] * R[3 + j] + p[2] * R[6 + j])
    const u = [w[0] * c + w[2] * s, w[1], -w[0] * s + w[2] * c]
    for (let j = 0; j < 3; j++) { min[j] = Math.min(min[j], u[j]); max[j] = Math.max(max[j], u[j]) }
  }
  const ux = (min[0] + max[0]) / 2, uz = (min[2] + max[2]) / 2
  return { at: [pos[0] + ux * c - uz * s, pos[1] + min[1], pos[2] + ux * s + uz * c], yaw, ext: [max[0] - min[0], max[2] - min[2]] }
}

/** How far around a placement its neighbours are counted (metres, across). */
const NEAR = 6
/** Models whose shapes touch, give or take this much (metres), can be one assembled thing. */
const TOUCH = 0.15

/** One placed model: where its feet stand, its turn, half its long side across and its height. */
export interface Placement { key: string; at: Vec3; yaw: number; half: number; h: number; ext: [number, number]; inst: number[] }

/** Counts, for each placement, what stands at the same spot and what stands around it (see Candidate). */
function relate(places: Placement[], out: Map<string, Candidate>) {
  const cell = (x: number) => Math.floor(x / NEAR)
  const grid = new Map<string, number[]>()
  places.forEach((p, i) => { const k = cell(p.at[0]) + ',' + cell(p.at[2]); const g = grid.get(k); if (g) g.push(i); else grid.set(k, [i]) })
  const turn = (a: number) => { let t = a % (2 * Math.PI); if (t > Math.PI) t -= 2 * Math.PI; if (t <= -Math.PI) t += 2 * Math.PI; return t }
  places.forEach((a, i) => {
    const c = out.get(a.key)!
    const cx = cell(a.at[0]), cz = cell(a.at[2])
    const co = Math.cos(a.yaw), si = Math.sin(a.yaw)
    const seenNear = new Set<string>(), seenClose = new Set<string>()
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const j of grid.get(cx + dx + ',' + (cz + dz)) ?? []) {
      if (j === i) continue
      const b = places[j]
      const d = [b.at[0] - a.at[0], b.at[1] - a.at[1], b.at[2] - a.at[2]]
      const across = Math.hypot(d[0], d[2])
      if (across > NEAR || Math.abs(d[1]) > NEAR) continue
      const bid = keyId(b.key)
      if (b.key !== a.key && !seenNear.has(bid)) { seenNear.add(bid); (c.around ??= {})[bid] = (c.around[bid] ?? 0) + 1 }
      // Only models that touch: their footprints (as circles round the long side) and their heights overlap.
      if (across > a.half + b.half + TOUCH || d[1] > a.h + TOUCH || -d[1] > b.h + TOUCH) continue
      // Where it stands in this one's own frame (the cut-out's), and how it is turned against it.
      const o = [d[0] * co + d[2] * si, d[1], -d[0] * si + d[2] * co], t = turn(b.yaw - a.yaw)
      const bin = `${bid}|${o.map((v) => Math.round(v * 4)).join(',')}|${Math.round(t / (Math.PI / 12))}`
      if (seenClose.has(bin)) continue
      seenClose.add(bin)
      const v = ((c.close ??= {})[bin] ??= [0, 0, 0, 0, 0])
      v[0]++; v[1] += o[0]; v[2] += o[1]; v[3] += o[2]; v[4] += t
    }
  })
}

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
export function indexChunk(ch: Chunk, pack: string, chunk: string, onPlaces?: (places: Placement[], byKey: Map<string, Candidate>) => void): Candidate[] {
  const bounds = new Map<number, Box | null>()
  const boundsOf = (m: number) => { if (!bounds.has(m)) bounds.set(m, meshBounds(ch, m)); return bounds.get(m)! }
  const out = new Map<string, Candidate>()
  const groups = new Map<string, number[]>()
  const singles: number[] = []

  const districts = chunkDistricts(ch.records.map((r) => r.name))
  const places: Placement[] = []
  // The instances that are a building's parts (solid walls and floors for sits.ts).
  const structure = new Set<number>()
  const named = new Set<number>()
  ch.records.forEach((rec, i) => {
    named.add(rec.instance)
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
      // Its front: the side its doors and shop fronts stand nearest (in the game's axes, which the cut-out keeps).
      let fx = 0, fz = 0, nf = 0
      for (const m of members) {
        if (!FRONT_PART.test(ch.records[recs[m]].name.toLowerCase().replace(/^.*?\d[a-z]_/, ''))) continue
        const b = boxes[m]!
        fx += ((b.min[0] + b.max[0]) / 2 - (min[0] + max[0]) / 2) / Math.max(ext[0] / 2, 0.1)
        fz += ((b.min[2] + b.max[2]) / 2 - (min[2] + max[2]) / 2) / Math.max(ext[2] / 2, 0.1)
        nf++
      }
      fx /= nf || 1; fz /= nf || 1
      const front = !nf || Math.max(Math.abs(fx), Math.abs(fz)) < 0.3 ? undefined : Math.abs(fx) >= Math.abs(fz) ? (fx > 0 ? '+x' : '-x') : (fz > 0 ? '+z' : '-z')
      const size: Vec3 = [r2(Math.max(ext[0], ext[2])), r2(Math.min(ext[0], ext[2])), r2(ext[1])]
      const key = `b|${members.length}|${idx}|${ext.map((v) => Math.round(v * 10)).join(',')}`
      const parts = members.map((m) => recs[m]).sort((a, b) => a - b)
      for (const m of members) structure.add(ch.records[recs[m]].instance)
      places.push({ key, at: [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2], yaw: 0, half: Math.max(ext[0], ext[2]) / 2, h: ext[1], ext: [ext[0], ext[2]], inst: members.map((m) => ch.records[recs[m]].instance) })
      const prev = out.get(key)
      if (prev) { prev.seen++; continue }
      out.set(key, {
        key, up: 1, id: keyId(key), name: code, cat: BUILDINGS, profile: '', pack, chunk, record: parts[0], parts,
        size, tris, tex: [...tex.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t), seen: 1,
        long: ext[0] >= ext[2] ? 'x' : 'z', ...(front ? { front } : {}), ...(districts.length ? { districts } : {}),
      })
    }
  }

  // Pieces the game placed with no record of their own (much of the city's ground, walls and trim): named after
  // their main texture, and found again by their instance.
  const loose: number[] = []
  ch.instances.forEach((inst, n) => { if (!named.has(n) && ch.meshes[inst.mesh]?.subs.length) loose.push(-(n + 1)) })

  for (const i of [...singles, ...loose]) {
    const rec = i >= 0 ? ch.records[i] : null
    const inst = ch.instances[rec ? rec.instance : -i - 1]
    const mesh = ch.meshes[inst.mesh]
    const b = boundsOf(inst.mesh)
    if (!b) continue
    const ext = [0, 1, 2].map((k) => b.max[k] - b.min[k])
    const up = upAxis(inst.rotation)
    const across = [0, 1, 2].filter((k) => k !== up).map((k) => ext[k])
    const size: Vec3 = [r2(Math.max(...across)), r2(Math.min(...across)), r2(ext[up])]
    if (Math.max(...size) < MIN_SIDE) continue
    const tex = meshTextures(ch, mesh)
    const key = `o|${meshIndexCount(mesh)}|${ext.map((v) => Math.round(v * 100)).join(',')}|${(tex[0] ?? '').toLowerCase()}`
    const name = rec ? baseName(rec.name) : textureName(tex[0] ?? '') || 'piece'
    places.push({ key, ...anchorOf(b, inst.position, inst.rotation), half: size[0] / 2, h: size[2], inst: [rec ? rec.instance : -i - 1] })
    const prev = out.get(key)
    if (prev) {
      prev.seen++
      if (name !== prev.name && !prev.names?.includes(name) && (prev.names?.length ?? 0) < 4) (prev.names ??= []).push(name)
      if (rec && !prev.raw?.includes(rec.name) && (prev.raw?.length ?? 0) < 6) (prev.raw ??= []).push(rec.name)
      continue
    }
    const profile = rec && rec.profile !== 'Default' ? rec.profile : ''
    const c: Candidate = {
      key, up, id: keyId(key), name, cat: '', profile,
      pack, chunk, record: i, size, tris: meshTriangleCount(ch, mesh), tex: tex.slice(0, 4), seen: 1,
      ...(rec ? { raw: [rec.name] } : {}), ...(rec && rec.shape >= 0 ? { physics: true } : {}), ...(districts.length ? { districts } : {}),
    }
    c.cat = identify(c).category
    out.set(key, c)
  }
  // What stands with what: never-drawn copies and the ground say nothing about it.
  const counted = (p: Placement) => { const id = identify(out.get(p.key)!); return id.role !== 'skip' && id.role !== 'ground' }
  relate(places.filter(counted), out)
  // Which building each piece stands on (the smallest whose footprint, a little larger, holds its feet), and
  // where on it, in the building's own frame.
  const hosts = places.filter((p) => buildingKind(out.get(p.key)!) === 'whole')
  for (const p of places) {
    const c = out.get(p.key)!
    if (buildingKind(c) || !hosts.length) continue
    let best: Placement | null = null, area = Infinity, at: number[] = []
    for (const h of hosts) {
      const d = [p.at[0] - h.at[0], p.at[1] - h.at[1], p.at[2] - h.at[2]]
      if (Math.abs(d[0]) > h.half + 1 || Math.abs(d[2]) > h.half + 1) continue
      const co = Math.cos(h.yaw), si = Math.sin(h.yaw)
      const o = [d[0] * co + d[2] * si, d[1], -d[0] * si + d[2] * co]
      if (Math.abs(o[0]) > h.ext[0] / 2 + 0.5 || Math.abs(o[2]) > h.ext[1] / 2 + 0.5 || o[1] < -1 || o[1] > h.h + 1) continue
      const a = h.ext[0] * h.ext[1]
      if (a < area) { area = a; best = h; at = o }
    }
    if (!best) continue
    const id = keyId(best.key)
    ;(c.on ??= {})[id] = (c.on[id] ?? 0) + 1
    let t = (p.yaw - best.yaw) % (2 * Math.PI); if (t > Math.PI) t -= 2 * Math.PI; if (t <= -Math.PI) t += 2 * Math.PI
    const v = ((c.onAt ??= {})[`${id}|${at.map((x) => Math.round(x * 4)).join(',')}|${Math.round(t / (Math.PI / 12))}`] ??= [0, 0, 0, 0, 0])
    v[0]++; v[1] += at[0]; v[2] += at[1]; v[3] += at[2]; v[4] += t
  }
  standing(ch, places, out, structure, hosts, boundsOf)
  if (isStudyChunk(pack, chunk)) studyChunk(ch, places, out)
  onPlaces?.(places, out)
  // How solid each building is at eye height, as the map wizard will see it (editor units: twice the metres).
  for (const c of out.values()) {
    if (!buildingKind(c) && !(Math.min(c.size[0], c.size[1]) >= 3 && c.size[2] >= 2.5)) continue
    try {
      const m = extractObject(ch, c)
      c.eye = +eyeCover({ positions: m.positions.map((v) => v * 2), faces: m.triangles }).toFixed(2)
    } catch { /* left unmeasured */ }
  }
  return [...out.values()]
}

/** How the chunk stands each model that isn't a building, the ground or never drawn (sits.ts): onto the candidates. */
function standing(ch: Chunk, places: Placement[], out: Map<string, Candidate>, structure: Set<number>, hosts: Placement[], boundsOf: (m: number) => Box | null) {
  const kinds = new Map<number, Solid>()
  for (const n of structure) kinds.set(n, Solid.Structure)
  const targets: Target[] = []
  for (const p of places) {
    // (A building's parts are its walls and floors, already counted.)
    if (p.inst.length !== 1 || structure.has(p.inst[0])) continue
    const c = out.get(p.key)!, role = identify(c).role, inst = p.inst[0]
    kinds.set(inst, role === 'skip' ? Solid.None : role === 'ground' ? Solid.Ground : role === 'prop' ? Solid.Prop : Solid.Structure)
    if (role !== 'skip' && role !== 'ground' && !buildingKind(c)) targets.push({ inst, key: p.key, at: p.at, yaw: p.yaw, ext: p.ext, h: p.h })
  }
  if (!targets.length) return
  const inside = (q: Vec3) => hosts.some((h) => Math.abs(q[0] - h.at[0]) <= h.ext[0] / 2 + 0.5 && Math.abs(q[2] - h.at[2]) <= h.ext[1] / 2 + 0.5 && q[1] >= h.at[1] - 1 && q[1] <= h.at[1] + h.h + 1)
  for (const [key, r] of probeChunk(ch, targets, (n) => kinds.get(n) ?? Solid.None, boundsOf, inside)) {
    const c = out.get(key)!
    c.sitSums = r.sums
    if (r.cover !== undefined) c.sitCover = r.cover
  }
}

/** At least this share of a model's placements have the other at the same spot: one assembled thing. */
const ALWAYS = 0.6

/**
 * The library's assemblies and neighbours (GameObjectEntry.assembly, partOf, near) from what each chunk counted:
 * a model nearly always found at one spot of a bigger one, which is nearly always there too, is a part of it;
 * the models most often standing around it are its neighbours.
 */
function together(entries: GameObjectEntry[], rel: Map<string, { close: Map<string, number[]>; around: Map<string, number> }>) {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const volume = (e: GameObjectEntry) => e.size[0] * e.size[1] * Math.max(e.size[2], 0.05)
  const r2 = (v: number) => Math.round(v * 100) / 100
  const same = (a: GameObjectEntry, b: GameObjectEntry) => [0, 1, 2].every((k) => Math.abs(a.size[k] - b.size[k]) <= Math.max(0.3, 0.25 * Math.max(a.size[k], b.size[k])))
  // Copies first: the same size at the same spot, nearly every time, both ways. The one with a record (or the
  // more used) is the model; the other its copy.
  for (const e of entries) {
    if (e.copyOf) continue
    for (const [bin, v] of rel.get(e.id)!.close) {
      const b = byId.get(bin.slice(0, bin.indexOf('|')))
      // (A piece placed without a record at a named model's spot every time is that model's other state, even
      // a smaller one: a fence's broken panel.)
      const state = !!b && (b.record < 0) !== (e.record < 0) && Math.max(e.size[0], b.size[0]) <= 2.5 * Math.min(e.size[0], b.size[0])
      if (!b || b.id === e.id || b.copyOf || !(same(e, b) || state)) continue
      const n = v[0]
      if (n / e.seen < 0.8 || n / b.seen < 0.8 || Math.hypot(v[1] / n, v[2] / n, v[3] / n) > 0.3 || Math.abs(v[4] / n) > 0.2) continue
      const [main, copy] = (b.record < 0) !== (e.record < 0) ? (e.record < 0 ? [b, e] : [e, b]) : e.seen > b.seen || (e.seen === b.seen && e.id < b.id) ? [e, b] : [b, e]
      if (main.copyOf) continue
      copy.copyOf = main.id
      if (main.record >= 0) copy.copyNames = [main.name, ...(main.raw ?? []).slice(0, 3)]
      if (copy === e) break
    }
  }
  // A copy of a copy is a copy of the model at the end of the chain.
  for (const e of entries) {
    let m = e.copyOf ? byId.get(e.copyOf) : undefined
    for (let i = 0; m?.copyOf && i < 8; i++) m = byId.get(m.copyOf)
    if (!m || m === e) { delete e.copyOf; delete e.copyNames } else if (m.id !== e.copyOf) { e.copyOf = m.id; e.copyNames = m.record >= 0 ? [m.name, ...(m.raw ?? []).slice(0, 3)] : undefined; if (!e.copyNames) delete e.copyNames }
  }
  for (const e of entries) {
    if (e.copyOf) continue
    const g = rel.get(e.id)!
    const parts: GamePart[] = []
    for (const [bin, v] of g.close) {
      const b = byId.get(bin.slice(0, bin.indexOf('|')))
      if (!b || b.id === e.id || b.copyOf || e.seen < 2) continue
      const n = v[0], share = n / e.seen
      if (share < ALWAYS || n / b.seen < ALWAYS / 2 || volume(b) > volume(e)) continue
      parts.push({ id: b.id, at: [r2(v[1] / n), r2(v[2] / n), r2(v[3] / n)], yaw: r2(v[4] / n), share: r2(Math.min(1, share)) })
    }
    if (parts.length) {
      e.assembly = parts.sort((a, b) => b.share - a.share).slice(0, 12)
      for (const p of e.assembly) { const b = byId.get(p.id)!; if (!b.partOf || volume(byId.get(b.partOf)!) < volume(e)) b.partOf = e.id }
    }
  }
  // What stands on what: a model touching this one whose feet are at its top, inside its footprint.
  for (const e of entries) {
    if (e.copyOf) continue
    const g = rel.get(e.id)!
    // Its feet inside the base's narrow width round its middle (a parking meter beside a kerb block isn't on it).
    const h = e.size[2], reach = Math.max(0.3, e.size[1] / 2 + 0.15)
    const found = new Map<string, { n: number; x: number; y: number; z: number; t: number }>()
    for (const [bin, v] of g.close) {
      const b = byId.get(bin.slice(0, bin.indexOf('|')))
      if (!b || b.id === e.id || b.copyOf) continue
      const n = v[0], x = v[1] / n, y = v[2] / n, z = v[3] / n
      if (Math.abs(y - h) > Math.max(0.12, 0.15 * h) || Math.hypot(x, z) > reach || h < 0.05) continue
      const f = found.get(b.id) ?? { n: 0, x: 0, y: 0, z: 0, t: 0 }
      f.n += n; f.x += x * n; f.y += y * n; f.z += z * n; f.t += (v[4] / n) * n
      found.set(b.id, f)
    }
    const tops = [...found].filter(([, f]) => f.n >= 2).sort((a, b) => b[1].n - a[1].n).slice(0, 12)
      .map(([id, f]) => ({ id, n: f.n, at: [r2(f.x / f.n), r2(f.y / f.n), r2(f.z / f.n)] as Vec3, yaw: r2(f.t / f.n) }))
    if (!tops.length) continue
    e.tops = tops
    for (const t of tops) { const b = byId.get(t.id)!; (b.bases ??= []).push({ id: e.id, n: t.n }) }
  }
  for (const e of entries) e.bases?.sort((a, b) => b.n - a.n)
  for (const e of entries) {
    const g = rel.get(e.id)!
    const mine = new Set([...(e.assembly ?? []).map((p) => p.id), e.partOf ?? '', e.copyOf ?? ''])
    // Most telling: found around many of its placements, and not just because it is everywhere.
    const near = [...g.around].filter(([id, n]) => n >= 2 && !mine.has(id) && byId.has(id) && !byId.get(id)!.copyOf)
      .map(([id, n]) => ({ id, n, score: (n / e.seen) * Math.log2(1 + n) / Math.log2(2 + byId.get(id)!.seen) }))
      .sort((a, b) => b.score - a.score).slice(0, 10)
    if (near.length) e.near = near.map(({ id, n }) => ({ id, n }))
  }
}

/** At least this share of a piece's placements stand on buildings of one kind: it is made for that kind. */
const KIT = 0.8

/** A building's kind: its code without the shell suffix ("bsad2a_hull" -> "bsad2a"). */
const familyOf = (e: GameObjectEntry) => e.name.toLowerCase().replace(/_hull\d*$/, '')
/** The building code a part's own name starts with ("bsad2a_medfront" -> "bsad2a"), or null. */
const partCode = (name: string) => name.toLowerCase().match(/^(?:[a-z0-9]{1,6}_|[a-z]{1,3}\d+)?([a-z]{2,10}\d+[a-z]{1,2})_[a-z]/)?.[1] ?? null

/**
 * The building kits (GameObjectEntry.kitOf, belongsTo, kit): a piece whose placements nearly all stand on
 * buildings of one kind, or whose own name carries a building's code, is made for that kind of building.
 */
function kits(entries: GameObjectEntry[], rel: Map<string, { on: Map<string, number>; onAt: Map<string, number[]> }>) {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const families = new Map<string, GameObjectEntry[]>()
  for (const e of entries) if (buildingKind(e) === 'whole') { const f = familyOf(e); (families.get(f) ?? families.set(f, []).get(f)!).push(e) }
  // Building texture sets ("B11_" in "B11_window1_gs.tga") used by one kind of building only.
  const setOf = (t: string) => t.toLowerCase().match(/^([a-z]{1,2}\d{2}[a-z]?)_/)?.[1] ?? null
  const setFamilies = new Map<string, Set<string>>()
  for (const [f, bs] of families) for (const b of bs) for (const t of b.tex) { const k = setOf(t); if (k) (setFamilies.get(k) ?? setFamilies.set(k, new Set()).get(k)!).add(f) }
  const familyFor = (code: string) => (families.has(code) ? code : [...families.keys()].find((f) => f.length >= 5 && (code.endsWith(f) || f.endsWith(code))) ?? null)
  for (const e of entries) {
    if (buildingKind(e)) continue
    const on = [...rel.get(e.id)!.on].filter(([id]) => buildingKind(byId.get(id)!) === 'whole').sort((a, b) => b[1] - a[1])
    const total = on.reduce((s, [, n]) => s + n, 0)
    const kinds = new Set(on.map(([id]) => familyOf(byId.get(id)!)))
    // Its own name says which building it is a part of; failing that, where it stands; failing that, its pictures.
    const code = [e.name, ...(e.raw ?? [])].map(partCode).find(Boolean)
    let family = code ? familyFor(code) : null
    if (!family && total >= KIT * e.seen && kinds.size === 1) family = [...kinds][0]
    else if (!family && !total) {
      // (A piece placed without a record, wearing only pictures of one kind of building's set.)
      if (e.record < 0 && e.tex.length) {
        const fams = e.tex.map(setOf).map((k) => (k ? setFamilies.get(k) : undefined))
        if (fams.every((f) => f?.size === 1) && new Set(fams.map((f) => [...f!][0])).size === 1) family = [...fams[0]!][0]
      }
    }
    if (!family) continue
    e.kitOf = family
    const ids = on.map(([id]) => id)
    e.belongsTo = (ids.length ? ids : families.get(family)!.map((b) => b.id)).slice(0, 8)
  }
  // A kit piece's own parts (its base, its copy) belong to the same building.
  for (const e of entries) for (const other of buildingKind(e) ? [] : [e.partOf, e.copyOf]) {
    const m = other ? byId.get(other) : undefined
    if (m?.kitOf && !e.kitOf) { e.kitOf = m.kitOf; if (m.belongsTo) e.belongsTo = m.belongsTo }
  }
  // Each building's layout: the pieces at a spot on it on at least half its copies (never copies or the
  // never-drawn: their roles are left to identify(), so only what an entry is known not to be is left out here).
  const r2 = (v: number) => Math.round(v * 100) / 100
  const layouts = new Map<string, GamePart[]>()
  for (const e of entries) {
    if (buildingKind(e) || e.copyOf) continue
    for (const [bin, v] of rel.get(e.id)!.onAt) {
      const b = byId.get(bin.slice(0, bin.indexOf('|')))
      if (!b || v[0] < Math.max(1, b.seen / 2)) continue
      const n = v[0], copies = Math.max(1, Math.round(n / b.seen))
      const part: GamePart = { id: e.id, at: [r2(v[1] / n), r2(v[2] / n), r2(v[3] / n)], yaw: r2(v[4] / n), share: r2(Math.min(1, n / (b.seen * copies))) }
      ;(layouts.get(b.id) ?? layouts.set(b.id, []).get(b.id)!).push(part)
    }
  }
  for (const [id, parts] of layouts) byId.get(id)!.layout = parts.sort((a, b) => a.at[1] - b.at[1] || a.id.localeCompare(b.id)).slice(0, 400)
  for (const [f, bs] of families) {
    const kit = entries.filter((e) => e.kitOf === f).map((e) => e.id)
    if (kit.length) for (const b of bs) b.kit = kit.slice(0, 200)
  }
}

/** Building part names that face the street: doors, shop fronts and windows, canopies, porches. */
const FRONT_PART = /front|door|entr|display|marq|canop|porch|shop|awn/

/** A plain name from a texture file name: "USPSMailBox_tm.tga" -> "uspsmailbox". */
export const textureName = (t: string) => t.replace(/\.\w+$/, '').replace(/_(tm|sp|nm|nor|spec|diff?|d|c|a|alpha|mask|hi|lo)$/i, '').toLowerCase()

/**
 * Merges every chunk's candidates into the library: one entry per key, placed where the model is most often
 * stood the same way up, named after its most common name. Sorted by category (in the library's order), then by
 * how often the game uses it.
 */
export function mergeCandidates(all: Iterable<Candidate>): GameObjectEntry[] {
  const by = new Map<string, { copies: Candidate[]; seen: number; names: Map<string, number>; ups: Map<number, number>; raw: Set<string>; where: Set<string>; districts: Set<string>; close: Map<string, number[]>; around: Map<string, number>; on: Map<string, number>; onAt: Map<string, number[]>; sits?: number[]; sitCover?: number }>()
  // How many different objects each chunk holds: copies are taken from as few chunks as possible, so drawing a
  // page of pictures reads few chunks.
  const perChunk = new Map<string, number>()
  for (const c of all) {
    let g = by.get(c.key)
    if (!g) by.set(c.key, (g = { copies: [], seen: 0, names: new Map(), ups: new Map(), raw: new Set(), where: new Set(), districts: new Set(), close: new Map(), around: new Map(), on: new Map(), onAt: new Map() }))
    g.where.add(isMpChunk(c.pack, c.chunk) ? c.chunk.toLowerCase().replace(/_al$/, '') : 'city')
    for (const r of c.raw ?? []) if (g.raw.size < 8) g.raw.add(r)
    for (const d of c.districts ?? []) g.districts.add(d)
    for (const [k, v] of Object.entries(c.close ?? {})) { const t = g.close.get(k); if (t) for (let i = 0; i < 5; i++) t[i] += v[i]; else g.close.set(k, [...v]) }
    for (const [k, n] of Object.entries(c.around ?? {})) g.around.set(k, (g.around.get(k) ?? 0) + n)
    for (const [k, n] of Object.entries(c.on ?? {})) g.on.set(k, (g.on.get(k) ?? 0) + n)
    for (const [k, v] of Object.entries(c.onAt ?? {})) { const t = g.onAt.get(k); if (t) for (let i = 0; i < 5; i++) t[i] += v[i]; else g.onAt.set(k, [...v]) }
    if (c.sitSums) { const t = (g.sits ??= new Array(SITS_LEN).fill(0)); for (let i = 0; i < SITS_LEN; i++) t[i] += c.sitSums[i] ?? 0 }
    if (c.sitCover !== undefined) g.sitCover ??= c.sitCover
    g.copies.push(c)
    g.seen += c.seen
    for (const n of [c.name, ...(c.names ?? [])]) g.names.set(n, (g.names.get(n) ?? 0) + (n === c.name ? c.seen : 1))
    g.ups.set(c.up, (g.ups.get(c.up) ?? 0) + c.seen)
    const ck = c.pack + '/' + c.chunk
    perChunk.set(ck, (perChunk.get(ck) ?? 0) + 1)
  }
  const entries: GameObjectEntry[] = []
  const rel = new Map<string, { close: Map<string, number[]>; around: Map<string, number>; on: Map<string, number>; onAt: Map<string, number[]> }>()
  for (const g of by.values()) {
    // A copy that stands the way most copies do, from the busiest chunk.
    const upBest = [...g.ups.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const score = (c: Candidate) => (c.up === upBest ? 1e9 : 0) + (perChunk.get(c.pack + '/' + c.chunk) ?? 0)
    const best = g.copies.reduce((a, b) => (score(b) > score(a) ? b : a))
    const { key: _k, up: _u, names: _n, raw: _r, districts: _d, close: _c, around: _a, on: _o, onAt: _oa, spots: _s, foot: _f, sites: _si, cover: _cv, sitSums: _ss, sitCover: _sc, ...e } = best
    const names = [...g.names.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n)
    const entry: GameObjectEntry = { ...e, name: names[0] ?? e.name, seen: g.seen }
    if (names.length > 1) entry.names = names.slice(1, 5)
    else delete entry.names
    if (g.raw.size) entry.raw = [...g.raw]
    entry.where = [...g.where].sort()
    if (g.districts.size) entry.districts = [...g.districts].sort()
    if (g.sits) entry.sits = sitsFrom(g.sits, g.sitCover)
    entries.push(entry)
    rel.set(entry.id, g)
  }
  together(entries, rel)
  kits(entries, rel)
  // What each is, now that every name, map, district and companion it has is known (one rule table: identity.ts).
  for (const e of entries) e.cat = identify(e).category
  // How the city is put together: its recurring groups and its buildings cut out as modules.
  studyCity(entries, cityData([...by.values()].flatMap((g) => g.copies)))
  const rank = (c: string) => { const i = CATEGORIES.indexOf(c); return i < 0 ? CATEGORIES.length : i }
  return entries.sort((a, b) => rank(a.cat) - rank(b.cat) || b.seen - a.seen || a.name.localeCompare(b.name))
}
