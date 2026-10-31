// Baking a decoy dummy from the player's own packfiles: the character (the player as walk.ts builds it, or one of
// the game's people) posed on its skeleton and frozen into plain triangles with one picture per material, ready to
// be written as an OBJ and PNGs (place.ts). Nothing leaves the browser.
//
// Space: metres, the dummy's own (game model space with Z mirrored: facing -Z, feet on the ground at the origin).
// UVs are three.js-style (v up), which is OBJ's convention too.
import type * as THREE from 'three'
import type { Vpp } from '../sr1char/vpp'
import { parseCmesh, stripToTriangles, type Cmesh, type CmeshMaterial, type Draw } from '../sr1char/cmesh'
import { parseMorph, applyMorphs, type Morph } from '../sr1char/morph'
import { decodePeg, type PegImage } from '../sr1char/peg'
import { parseRig, skinPositions, type Rig } from '../sr1char/rig'
import { volitionHash, hex8 } from '../sr1char/hash'
import { EYES, HAIR, OUTFIT, PRESET_WEIGHTS, library, morphName, trianglesByMat } from '../sr1char/player'
import { figureJoints, type Joints, type PoseId } from './figure'
import { poseMatrices, rigJoints } from './rigPose'
import { HAIRS, PLAYER, SKINS, TOPS, fullLook, isNpc, type DummySpec } from './models'
import { clothPicture, eyePicture, hairPicture, pictureKey, plainPicture, skinPicture, type Lookup, type Picture } from './pictures'

export interface BakedDummy {
  /** Metres, the dummy's space. */
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  /** Three vertex indices per triangle, facing out (counter-clockwise seen from outside). */
  triangles: Uint32Array
  triMaterial: Uint16Array
  /** One picture per material; `png` once the worker has encoded it. */
  materials: { name: string; picture: Picture; png?: Blob }[]
  /** Where the joints ended up, for the body boxes. */
  joints: Joints
  /** Standing height, metres. */
  height: number
  summary: string
}

/** One mesh's share of the dummy: its vertices (morphed) and, per material, triangles and picture. */
interface Part {
  name: string
  cmesh: Cmesh
  pos: Float32Array
  nrm: Float32Array
  draws: { mat: number; tris: number[]; uvSet: 0 | 1; picture: () => Picture }[]
}

const EMPTY: CmeshMaterial = { slots: [], consts: {}, name: '', shader: '' }

/** Pictures in a peg by lower-case name, skipping the engine's placeholder names (missing*.tga). */
const lookup = (pegs: Record<string, PegImage>): Lookup => (n) => (n && !/^missing/i.test(n) ? pegs[n.toLowerCase()] ?? null : null)

/** UVs three.js-style: the first set's v is negative in the game (image top at -1); the second set runs top-down. */
function uvs(cmesh: Cmesh, set: 0 | 1): Float32Array {
  const g = cmesh.geometry, src = set ? g.uv1 : g.uv0, out = new Float32Array(g.nverts * 2)
  for (let i = 0; i < g.nverts; i++) { out[2 * i] = src[2 * i]; out[2 * i + 1] = set ? 1 - src[2 * i + 1] : -src[2 * i + 1] }
  return out
}

function morphed(cmesh: Cmesh, morph: Morph | null) {
  const pos = cmesh.geometry.pos.slice(), nrm = cmesh.geometry.nrm.slice()
  if (morph) applyMorphs(pos, nrm, morph, PRESET_WEIGHTS)
  return { pos, nrm }
}

type Lib = ReturnType<typeof library>
const morphOf = async (lib: Lib, base: string) => { const b = await lib.maybe(base + '_pc.morph_xbox2'); return b ? parseMorph(b, morphName) : null }

// ---------------- the player ----------------

async function playerParts(lib: Lib, spec: DummySpec, notes: string[]): Promise<Part[]> {
  const look = fullLook(spec.model, spec.look)
  const parts: Part[] = []
  const hides = new Set<number>()
  // The creator outfit, with the T-shirt in the chosen colour.
  const outfit = OUTFIT.map((it) => (it.mesh === 'cunds_tshirt_th' ? { ...it, variant: TOPS[look.top].variant } : it))
  for (const item of outfit) {
    if (!lib.has(item.mesh + '.cmesh_xbox2')) { notes.push(item.mesh + ' not found'); continue }
    const [cm, pg, morph] = await Promise.all([lib.read(item.mesh + '.cmesh_xbox2'), lib.maybe(item.mesh + '.peg_xbox2'), morphOf(lib, item.mesh)])
    const cmesh = parseCmesh(cm), tex = lookup(pg ? decodePeg(pg) : {}), want = hex8(volitionHash(item.variant))
    const byMat = trianglesByMat(cmesh, undefined, (mi) => cmesh.materials[mi]?.name === want)
    if (!byMat.size) { notes.push(item.mesh + ' has no ' + item.variant); continue }
    parts.push({ name: item.mesh, cmesh, ...morphed(cmesh, morph), draws: [...byMat].map(([mat, tris]) => ({ mat, tris, uvSet: 0, picture: () => clothPicture(cmesh.materials[mat] || EMPTY, tex) })) })
    item.hides.forEach((v) => hides.add(v))
  }
  {
    const [cm, pg, morph] = await Promise.all([lib.read('pc_body.cmesh_xbox2'), lib.read('pc_body.peg_xbox2'), morphOf(lib, 'pc_body')])
    const cmesh = parseCmesh(cm), tex = lookup(decodePeg(pg)), tone = SKINS[look.skin]
    const draws: Part['draws'] = []
    for (const [mat, tris] of trianglesByMat(cmesh, hides)) {
      const m = cmesh.materials[mat] || EMPTY
      if (m.name === 'ffffffff' || !tris.length) continue
      draws.push({ mat, tris, uvSet: 0, picture: () => (m.shader === '35a9fb3d' ? skinPicture(m, tex, tone) : plainPicture(m, tex)) })
    }
    parts.push({ name: 'body', cmesh, ...morphed(cmesh, morph), draws })
  }
  if (lib.has('pc_eyeballs.cmesh_xbox2')) {
    const [cm, pg, morph] = await Promise.all([lib.read('pc_eyeballs.cmesh_xbox2'), lib.maybe('pc_eyeballs.peg_xbox2'), morphOf(lib, 'pc_eyeballs')])
    const cmesh = parseCmesh(cm), pegs = pg ? decodePeg(pg) : {}
    const eye = cmesh.materials.find((m) => m.name === EYES) || EMPTY
    // The iris reads from its own UVs (the second set); see eyePicture.
    const draws = [...trianglesByMat(cmesh)].map(([mat, tris]) => ({ mat, tris, uvSet: 1 as const, picture: () => eyePicture(pegs['pceye_iris.tga'] ?? null, pegs['pceye_d.tga'] ?? null, eye, cmesh.materials[mat] || EMPTY) }))
    parts.push({ name: 'eyes', cmesh, ...morphed(cmesh, morph), draws })
  }
  for (const h of HAIR) {
    if (!lib.has(h.mesh + '.cmesh_xbox2')) { notes.push(h.mesh + ' not found'); continue }
    const [cm, pg, morph] = await Promise.all([lib.read(h.mesh + '.cmesh_xbox2'), lib.maybe(h.mesh + '.peg_xbox2'), morphOf(lib, h.mesh)])
    const cmesh = parseCmesh(cm), pegs = pg ? decodePeg(pg) : {}
    const draws: Part['draws'] = []
    for (const [mat, tris] of trianglesByMat(cmesh)) {
      const m = cmesh.materials[mat] || EMPTY
      const slot = m.slots.find((s) => /dsa|diffuse/i.test(s.texture || '')) || m.slots[0]
      const img = slot && pegs[slot.texture.toLowerCase()]
      if (!img || !tris.length) continue
      // diffuse_map_2 samples the second UV set.
      draws.push({ mat, tris, uvSet: /_2$/i.test(slot.slot) ? 1 : 0, picture: () => hairPicture(img, HAIRS[look.hair], h.head) })
    }
    parts.push({ name: h.mesh, cmesh, ...morphed(cmesh, morph), draws })
  }
  return parts
}

// ---------------- the game's people ----------------

/**
 * Which of a person's alternative pieces to draw. Their mesh holds every variant: visibility ids (VIDs) pick the
 * pieces (0 the body that is always there, 1-9 the heads, then groups by tens: sleeves, shirts, trousers, hats;
 * 100 and up small extras, all worn), and draws of the same triangles under different materials are skin tones.
 * Read from the meshes, not from the game's variant tables (not located): `dark` picks the second head and the
 * last tone, `outfit` the n-th piece of each group (wrapping).
 */
export function npcDraws(cmesh: Cmesh, dark: boolean, outfit: number): Draw[] {
  const vids = cmesh.vids.filter((v) => v.record === 0)
  if (!vids.length) return cmesh.records[0].subs
  const groups = new Map<string, typeof vids>()
  for (const v of vids) {
    const g = v.vid === 0 ? 'base' : v.vid < 10 ? 'head' : v.vid >= 100 ? 'extra' : 'g' + Math.floor(v.vid / 10)
    groups.set(g, [...(groups.get(g) ?? []), v])
  }
  const chosen: typeof vids = []
  for (const [g, list] of groups) {
    if (g === 'base' || g === 'extra') { chosen.push(...list); continue }
    const sorted = [...list].sort((a, b) => a.vid - b.vid)
    chosen.push(sorted[(g === 'head' ? (dark ? 1 : 0) : outfit) % sorted.length])
  }
  const out: Draw[] = []
  for (const v of chosen) {
    const byRange = new Map<string, Draw[]>()
    for (const d of v.draws) byRange.set(d.start + ':' + d.count, [...(byRange.get(d.start + ':' + d.count) ?? []), d])
    for (const alts of byRange.values()) out.push(alts.length > 1 ? alts[dark ? alts.length - 1 : 0] : alts[0])
  }
  return [...new Map(out.map((d) => [d.start + ':' + d.count + ':' + d.mat, d])).values()]
}

/** A skeleton, or null when its file is one of the layouts parseRig can't read yet. */
function readableRig(u8: Uint8Array | null | undefined): Rig | null {
  if (!u8) return null
  try { return parseRig(u8) } catch { return null }
}

/** The person's skeleton: their own, the one character.xtbl names, or the player's (every person has the same 64 bones). */
async function npcRig(lib: Lib, name: string): Promise<Rig | null> {
  const own = readableRig(await lib.maybe(name + '.rig_xbox2'))
  if (own) return own
  const table = await lib.maybe('character.xtbl')
  if (table) {
    const text = new TextDecoder().decode(table)
    const at = text.toLowerCase().indexOf('<name>' + name.toLowerCase() + '</name>')
    const m = at >= 0 ? /<Rig>\s*<Filename>([^<]+?)\.rigx<\/Filename>/i.exec(text.slice(at, at + 2000)) : null
    const rig = readableRig(m && (await lib.maybe(m[1].toLowerCase() + '.rig_xbox2')))
    if (rig) return rig
  }
  const pc = await lib.maybe('pc.rig_xbox2')
  return pc ? parseRig(pc) : null
}

async function npcParts(lib: Lib, spec: DummySpec): Promise<Part[]> {
  const name = spec.model
  if (!lib.has(name + '.cmesh_xbox2')) throw new Error(`${name} isn't in your game files (cmesh_stream.vpp_xbox2).`)
  const [cm, pg] = await Promise.all([lib.read(name + '.cmesh_xbox2'), lib.maybe(name + '.peg_xbox2')])
  const cmesh = parseCmesh(cm), tex = lookup(pg ? decodePeg(pg) : {})
  const look = fullLook(spec.model, spec.look)
  const byMat = new Map<number, number[]>()
  for (const d of npcDraws(cmesh, look.skin === 'dark', look.outfit)) {
    const list = byMat.get(d.mat) ?? []
    stripToTriangles(cmesh.geometry.strip, d.start, d.count, list)
    byMat.set(d.mat, list)
  }
  const draws: Part['draws'] = []
  for (const [mat, tris] of byMat) {
    const m = cmesh.materials[mat] || EMPTY
    if (m.name === 'ffffffff' || !tris.length) continue
    draws.push({ mat, tris, uvSet: 0, picture: () => (m.shader === 'fb48c18d' ? clothPicture(m, tex) : plainPicture(m, tex)) })
  }
  return [{ name, cmesh, ...morphed(cmesh, null), draws }]
}

// ---------------- posing and freezing ----------------

/** Turns normals by the skinning matrices' rotation (blended like the positions), in place. */
function skinNormals(nrm: Float32Array, weights: Uint8Array, indices: Uint8Array, skin: THREE.Matrix4[]) {
  const e = skin.map((m) => m.elements), n = nrm.length / 3
  for (let v = 0; v < n; v++) {
    let x = 0, y = 0, z = 0
    const a = nrm[3 * v], b = nrm[3 * v + 1], c = nrm[3 * v + 2]
    for (let k = 0; k < 4; k++) {
      const w = weights[4 * v + k] / 255, m = w ? e[indices[4 * v + k]] : undefined
      if (!m) continue
      x += w * (m[0] * a + m[4] * b + m[8] * c); y += w * (m[1] * a + m[5] * b + m[9] * c); z += w * (m[2] * a + m[6] * b + m[10] * c)
    }
    const l = Math.hypot(x, y, z)
    if (l > 1e-6) { nrm[3 * v] = x / l; nrm[3 * v + 1] = y / l; nrm[3 * v + 2] = z / l }
  }
}

function freeze(parts: Part[], rig: Rig | null, pose: PoseId, notes: string[]): BakedDummy {
  const skin = rig ? poseMatrices(rig, pose) : null
  if (!rig) notes.push('no skeleton found, so it stands as the mesh was made')
  const posed = parts.map((p) => {
    const pos = p.pos.slice(), nrm = p.nrm.slice(), g = p.cmesh.geometry
    if (skin) { skinPositions(pos, g.boneWeights, g.boneIndices, skin); skinNormals(nrm, g.boneWeights, g.boneIndices, skin) }
    return { pos, nrm }
  })
  // Feet on the ground: the lowest point drawn at 0.
  let minY = Infinity, maxY = -Infinity
  parts.forEach((p, i) => { for (const d of p.draws) for (const t of d.tris) { const y = posed[i].pos[3 * t + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y } })
  if (!Number.isFinite(minY)) throw new Error('The character has nothing to draw.')
  const lift = -minY

  const P: number[] = [], N: number[] = [], U: number[] = [], T: number[] = [], M: number[] = []
  const materials: BakedDummy['materials'] = []
  const matByKey = new Map<string, number>()
  parts.forEach((p, pi) => {
    const sets: Partial<Record<0 | 1, Float32Array>> = {}
    // One output vertex per mesh vertex and UV set it is drawn with.
    const remap = new Map<number, number>()
    for (const d of p.draws) {
      const uv = (sets[d.uvSet] ??= uvs(p.cmesh, d.uvSet))
      const picture = d.picture()
      const key = pictureKey(picture)
      let mi = matByKey.get(key)
      if (mi === undefined) {
        mi = materials.length
        matByKey.set(key, mi)
        materials.push({ name: `${p.name.replace(/[^A-Za-z0-9]+/g, '_')}_${d.mat}`.slice(0, 40), picture })
      }
      const at = (v: number) => {
        const k = v * 2 + d.uvSet
        let o = remap.get(k)
        if (o === undefined) {
          o = P.length / 3
          remap.set(k, o)
          const { pos, nrm } = posed[pi]
          // The game's model space has Z mirrored into the dummy's.
          P.push(pos[3 * v], pos[3 * v + 1] + lift, -pos[3 * v + 2])
          N.push(nrm[3 * v], nrm[3 * v + 1], -nrm[3 * v + 2])
          // The eye's iris UVs stay on the picture (outside it is the eye's white).
          const u = uv[2 * v], w = uv[2 * v + 1]
          U.push(d.uvSet ? Math.min(1, Math.max(0, u)) : u, d.uvSet ? Math.min(1, Math.max(0, w)) : w)
        }
        return o
      }
      // The mirror turns each triangle over: two corners swap so it faces out again.
      for (let t = 0; t + 2 < d.tris.length; t += 3) { T.push(at(d.tris[t]), at(d.tris[t + 2]), at(d.tris[t + 1])); M.push(mi) }
    }
  })
  const joints = (rig && skin && rigJoints(rig, skin, lift)) || figureJoints(pose)
  const tris = T.length / 3
  return {
    positions: new Float32Array(P), normals: new Float32Array(N), uvs: new Float32Array(U), triangles: new Uint32Array(T), triMaterial: new Uint16Array(M),
    materials, joints, height: maxY - minY,
    summary: `${tris.toLocaleString('en')} triangles, ${materials.length} materials${notes.length ? ' (' + notes.join('; ') + ')' : ''}`,
  }
}

/** Bakes a dummy from the packfiles (misc2, morph_stream, preload and cmesh_stream; sr1char/folder.ts PACKFILES). */
export async function bakeDummy(packs: Vpp[], spec: DummySpec): Promise<BakedDummy> {
  const lib = library(packs)
  const notes: string[] = []
  if (spec.model === PLAYER) {
    if (!lib.has('pc_body.cmesh_xbox2')) throw new Error('The player body (pc_body.cmesh_xbox2, in misc2.vpp_xbox2) was not found.')
    const rigBytes = await lib.maybe('pc.rig_xbox2')
    return freeze(await playerParts(lib, spec, notes), rigBytes ? parseRig(rigBytes) : null, spec.pose, notes)
  }
  if (!isNpc(spec.model)) throw new Error('Unknown dummy model: ' + spec.model)
  const parts = await npcParts(lib, spec)
  return freeze(parts, await npcRig(lib, spec.model), spec.pose, notes)
}
