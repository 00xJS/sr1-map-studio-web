// Saints Row (2006) Xbox 360 vehicle model (.car_xbox2, big-endian), read from the player's own cmesh_stream packfile.
// Pure parsing: no three.js. Nothing read here is stored or shared.
//
// The container, as far as it is needed to draw the car:
//   0x00  16 words: (count, offset) pairs. Word 11 = texture-name count, word 12 = the offset of that many name
//         offsets; word 13 = the shared material table (the cmesh material table layout); word 15 = the body mesh.
//   0x98  the number of parts, then one 536-byte record per part from 0x9C:
//           +0x00 kind (1 fixed, 2 front wheel, 3 rear wheel, 4 door / hood / trunk, 6 wheel cap, 8 door inside)
//           +0x08 parent part (-1 = the body)
//           +0x14 3 x 3 rotation (rows = the part's axes in its parent's frame), +0x38 position in the parent's frame
//           +0x44 the part's mesh
//   Every mesh (the body and each part) is a version-28 cmesh without a material table of its own; its draws index
//   the shared table. The car frame is X right, Y up, Z forward; the wheels' lowest point is the ground.
// Which optional pieces show (hoods, bumpers, spoilers, rims...) and which paint, comes from the vehicle's variant
// table (<name>.xtbl in variants.vpp_xbox2): the default variant's most likely choice in each group.
import { Cursor, parseCmesh, readMaterialTable, readStrip, stripToTriangles, type Cmesh, type CmeshMaterial, type CmeshTag, type Draw, type MeshRecord } from '../sr1char/cmesh'
import { volitionHash } from '../sr1char/hash'

export const CAR_PART_KINDS: Record<number, string> = { 1: 'fixed', 2: 'front wheel', 3: 'rear wheel', 4: 'opening', 6: 'wheel cap', 8: 'door inside' }

/** One drawable piece: vertices in the car frame and triangles grouped by material. */
export interface CarMesh {
  /** -1 for the body, else the part's index. */
  part: number
  kind: number
  positions: Float32Array
  normals: Float32Array
  /** First UV set, v flipped for three.js (image top at v = 1). */
  uvs: Float32Array
  indices: Uint32Array
  /** Index ranges per material (into the car's material list). */
  groups: { start: number; count: number; material: number }[]
}

export interface CarVariantChoice {
  name: string
  /** VIDs switched on (0, the always-on pieces, included). */
  vids: number[]
  /** Material names the variant picks (lower case); where a draw offers several materials, the one named here wins. */
  materials: string[]
}

export interface CarModel {
  textures: string[]
  materials: CmeshMaterial[]
  meshes: CarMesh[]
  tags: CmeshTag[]
  variant: CarVariantChoice | null
  /** Bounds of what is drawn, car frame, metres (the ground is at min[1] when the car has wheels). */
  min: [number, number, number]
  max: [number, number, number]
  /** The lowest wheel point (y), or null for a model with no wheel parts. */
  wheelBottom: number | null
  triangles: number
}

export interface CarPartRecord { index: number; kind: number; parent: number; rot: number[]; pos: number[]; mesh: number }

const MAGIC = 0x424bd00d

/** Reads the texture names, the shared material table and the part records. */
export function readCarHeader(u8: Uint8Array) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  if (u8.byteLength < 0x100) throw new Error('not a vehicle model')
  const W = (i: number) => dv.getUint32(4 * i)
  const body = W(15)
  if (body + 8 > u8.byteLength || dv.getUint32(body) !== MAGIC) throw new Error('not a vehicle model (no body mesh)')
  const ntex = W(11), texAt = W(12)
  if (ntex > 4096 || texAt + 4 * ntex > u8.byteLength) throw new Error('vehicle texture table out of range')
  const textures: string[] = []
  for (let i = 0; i < ntex; i++) {
    let o = dv.getUint32(texAt + 4 * i), s = ''
    while (o < u8.byteLength && u8[o]) s += String.fromCharCode(u8[o++])
    textures.push(s)
  }
  const p = new Cursor(dv)
  p.cur = W(13)
  const materials = readMaterialTable(p, textures)
  const nparts = dv.getUint32(0x98)
  if (nparts > 256 || 0x9c + 0x218 * nparts > body) throw new Error('vehicle part table out of range')
  const parts: CarPartRecord[] = []
  for (let k = 0; k < nparts; k++) {
    const r = 0x9c + 0x218 * k
    parts.push({
      index: k, kind: dv.getInt32(r), parent: dv.getInt32(r + 8),
      rot: [...Array(9)].map((_, i) => dv.getFloat32(r + 0x14 + 4 * i)),
      pos: [0, 1, 2].map((i) => dv.getFloat32(r + 0x38 + 4 * i)),
      mesh: dv.getUint32(r + 0x44),
    })
  }
  return { textures, materials, body, parts }
}

// ---------------- variants ----------------

export interface CarVariant { name: string; weight: number; groups: { name: string; options: { vids: number[]; chance: number }[] }[]; materialGroups: { name: string; options: { names: string[]; chance: number }[] }[] }

const tagText = (s: string, tag: string) => { const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(s); return m ? m[1].trim() : '' }
const blocks = (s: string, tag: string) => [...s.matchAll(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'g'))].map((m) => m[1])

/** The variants of a vehicle's mesh table (variants.vpp_xbox2: <name>.xtbl). */
export function parseCarVariants(xml: string): CarVariant[] {
  return blocks(xml, 'Variant').map((v) => {
    const w = tagText(v, 'Weight')
    return {
      name: tagText(v, 'Name'),
      weight: w === '' ? 1 : parseFloat(w) || 0,
      groups: blocks(v, 'Vid_group').map((g) => ({
        name: tagText(g, 'Name'),
        options: blocks(g, 'Vid_chance').map((c) => ({ vids: tagText(c, 'VID_list').split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite), chance: parseFloat(tagText(c, 'Chance')) || 0 })),
      })),
      materialGroups: blocks(v, 'Material_group').map((g) => ({
        name: tagText(g, 'Name'),
        options: blocks(g, 'Material_chance').map((c) => ({ names: tagText(c, 'Name').replace(/[()]/g, '').split(',').map((n) => n.trim().toLowerCase()).filter(Boolean), chance: parseFloat(tagText(c, 'Chance')) || 0 })),
      })),
    }
  })
}

/**
 * A clean showroom look: the variant called Standard or Stock when the game spawns it at all, else the heaviest
 * (the one seen most), and in it each group's most likely option. (The game picks a variant at random by weight,
 * so a spawned car may be a Beater or Bling version of the same model.)
 */
export function defaultVariant(variants: CarVariant[]): CarVariantChoice | null {
  if (!variants.length) return null
  const v = variants.find((x) => /^(standard|stock)$/i.test(x.name) && x.weight > 0) ?? variants.reduce((a, b) => (b.weight > a.weight ? b : a))
  const vids = new Set([0])
  for (const g of v.groups) {
    const best = g.options.reduce<{ vids: number[]; chance: number } | null>((a, b) => (b.chance > 0 && (!a || b.chance > a.chance) ? b : a), null)
    best?.vids.forEach((x) => vids.add(x))
  }
  const materials: string[] = []
  for (const g of v.materialGroups) {
    const best = g.options.reduce<{ names: string[]; chance: number } | null>((a, b) => (!a || b.chance > a.chance ? b : a), null)
    if (best) materials.push(...best.names)
  }
  return { name: v.name, vids: [...vids].sort((a, b) => a - b), materials }
}

// ---------------- geometry ----------------

type Mat3x4 = number[] // rotation rows r0 r1 r2 (9) then position (3): world = local.x * r0 + local.y * r1 + local.z * r2 + pos

const IDENTITY: Mat3x4 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]

function compose(parent: Mat3x4, rot: number[], pos: number[]): Mat3x4 {
  const out = new Array(12).fill(0)
  const apply = (v: number[], withPos: boolean) => [0, 1, 2].map((j) => v[0] * parent[j] + v[1] * parent[3 + j] + v[2] * parent[6 + j] + (withPos ? parent[9 + j] : 0))
  for (let i = 0; i < 3; i++) out.splice(3 * i, 3, ...apply(rot.slice(3 * i, 3 * i + 3), false))
  out.splice(9, 3, ...apply(pos, true))
  return out
}

const dec10 = (w: number, k: number) => { let v = (w >>> (10 * k)) & 1023; if (v >= 512) v -= 1024; return v / 511 }

/**
 * The draws a mesh makes for the chosen VIDs (with no VID lists: its record's draws), one material per index range:
 * where a range is offered with several materials (paint alternatives), the variant's pick, else the first.
 */
export function chooseDraws(cmesh: Cmesh, rec: number, vids: Set<number> | null, prefer: Set<number>): Draw[] {
  const lists = cmesh.vids.filter((v) => v.record === rec)
  const draws = lists.length ? lists.filter((v) => !vids || vids.has(v.vid)).flatMap((v) => v.draws) : cmesh.records[rec].subs
  const byRange = new Map<string, Draw>()
  for (const d of draws) {
    const key = d.start + ':' + d.count, had = byRange.get(key)
    if (!had) byRange.set(key, d)
    else if (prefer.has(d.mat) && !prefer.has(had.mat)) byRange.set(key, d)
  }
  return [...byRange.values()]
}

function meshFrom(u8: Uint8Array, rec: MeshRecord, draws: Draw[], m: Mat3x4, part: number, kind: number): CarMesh | null {
  if (!draws.length || !rec.nverts || rec.flags & 0x20) return null
  const S = rec.stride, V = rec.vbOffset, n = rec.nverts
  if (S < 24 || V + n * S > u8.byteLength) throw new Error('vertex data out of range')
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const strip = readStrip(u8, rec)
  const tris: number[] = [], groups: CarMesh['groups'] = []
  const byMat = new Map<number, Draw[]>()
  for (const d of draws) { const l = byMat.get(d.mat); if (l) l.push(d); else byMat.set(d.mat, [d]) }
  for (const [mat, ds] of byMat) {
    const start = tris.length
    for (const d of ds) stripToTriangles(strip, d.start, d.count, tris)
    if (tris.length > start) groups.push({ start, count: tris.length - start, material: mat })
  }
  if (!tris.length) return null
  // Only the vertices the triangles use, renumbered.
  const remap = new Int32Array(n).fill(-1)
  let used = 0
  for (const t of tris) { if (t >= n) throw new Error('index out of range'); if (remap[t] < 0) remap[t] = used++ }
  const positions = new Float32Array(used * 3), normals = new Float32Array(used * 3), uvs = new Float32Array(used * 2)
  for (let i = 0; i < n; i++) {
    const j = remap[i]
    if (j < 0) continue
    const o = V + S * i
    const x = dv.getFloat32(o), y = dv.getFloat32(o + 4), z = dv.getFloat32(o + 8)
    const w = dv.getUint32(o + 12), nx = dec10(w, 0), ny = dec10(w, 1), nz = dec10(w, 2)
    for (let k = 0; k < 3; k++) {
      positions[3 * j + k] = x * m[k] + y * m[3 + k] + z * m[6 + k] + m[9 + k]
      normals[3 * j + k] = nx * m[k] + ny * m[3 + k] + nz * m[6 + k]
    }
    uvs[2 * j] = dv.getInt16(o + 20) / 1024
    uvs[2 * j + 1] = -dv.getInt16(o + 22) / 1024
  }
  const indices = new Uint32Array(tris.length)
  for (let i = 0; i < tris.length; i++) indices[i] = remap[tris[i]]
  return { part, kind, positions, normals, uvs, indices, groups }
}

/** Builds the car as the game shows it with the given variant (null: every piece, first material of each draw). */
export function parseCar(u8: Uint8Array, variant: CarVariantChoice | null = null): CarModel {
  const { textures, materials, body, parts } = readCarHeader(u8)
  const vids = variant ? new Set(variant.vids) : null
  const preferNames = new Set((variant?.materials || []).map((n) => volitionHash(n)))
  const prefer = new Set<number>()
  materials.forEach((m, i) => { if (preferNames.has(parseInt(m.name, 16))) prefer.add(i) })
  const meshes: CarMesh[] = []
  const add = (at: number, m: Mat3x4, part: number, kind: number) => {
    const cmesh = parseCmesh(u8, { at, materials, noGeometry: true })
    cmesh.records.forEach((rec, ri) => {
      const mesh = meshFrom(u8, rec, chooseDraws(cmesh, ri, vids, prefer), m, part, kind)
      if (mesh) meshes.push(mesh)
    })
    return cmesh
  }
  const bodyMesh = add(body, IDENTITY, -1, 0)
  // Parts in the car frame (a part's parent may be another part: a wheel cap on its wheel, a handle on its door).
  const frames: (Mat3x4 | null)[] = parts.map(() => null)
  const frameOf = (k: number, depth = 0): Mat3x4 => {
    const have = frames[k]
    if (have) return have
    const p = parts[k]
    const parent = p.parent >= 0 && p.parent < parts.length && p.parent !== k && depth < 8 ? frameOf(p.parent, depth + 1) : IDENTITY
    return (frames[k] = compose(parent, p.rot, p.pos))
  }
  for (const p of parts) {
    if (!p.mesh || p.mesh + 64 > u8.byteLength) continue
    add(p.mesh, frameOf(p.index), p.index, p.kind)
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  let wheelBottom: number | null = null, triangles = 0
  for (const m of meshes) {
    triangles += m.indices.length / 3
    for (let i = 0; i < m.positions.length; i += 3) for (let k = 0; k < 3; k++) {
      const v = m.positions[i + k]
      if (v < min[k]) min[k] = v
      if (v > max[k]) max[k] = v
      if (k === 1 && (m.kind === 2 || m.kind === 3) && (wheelBottom === null || v < wheelBottom)) wheelBottom = v
    }
  }
  if (!meshes.length) throw new Error('vehicle model has nothing to draw')
  return { textures, materials, meshes, tags: bodyMesh.tags, variant, min, max, wheelBottom, triangles }
}
