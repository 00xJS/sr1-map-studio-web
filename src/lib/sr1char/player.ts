// Ported from SR1-Creator (github.com/00xJS/SR1-Creator)
// The game's default player, built from the user's own packfiles: the creator's Caucasian preset head and body,
// blue eyes, light brown "combed forward" hair with sideburns and eyebrows, and the outfit every new player starts
// in (black T-shirt, dark blue jeans, sneakers), in the creator's standing pose. Everything comes out of the
// packfiles the user picked; only the preset's slider values and item names below are written here.
//
// The result is a three.js Group in map editor units (1 unit = 0.5 m, so metres x 2) with its origin at the feet,
// facing -Z, like the walk-through's stand-in. With the skeleton loaded it is skinned, so the legs and arms can swing.
import * as THREE from 'three'
import type { Vpp } from './vpp'
import { decodePeg, type PegImage } from './peg'
import { parseCmesh, stripToTriangles, type Cmesh } from './cmesh'
import { parseMorph, applyMorphs, type Morph } from './morph'
import { volitionHash, hex8 } from './hash'
import { CREATOR_OFFSET, parseRig, skinMatrices, skinPositions, standingPose, type Rig } from './rig'
import { clothingMaterial, eyeMaterial, hairMaterial, setEyeColor, setHairColor, setSkinTone, skinMaterial, textureFrom, type HairColor } from './materials'

/** Morph weights of the creator's first preset (Caucasian, "white1") with its body and hair length sliders. */
export const PRESET_WEIGHTS: Record<string, number> = {
  'brow height low': 0.25, 'eyelid look squint': 0.27, 'eye depth deep': 0.125, 'eyelid shape western': 0.5, 'eyelid slant up': 0.188,
  'nose height low': 0.063, 'nose width narrow': 0.292, 'nose length long': 0.375, 'bridge curve concave': 0.021, 'nose depth protruded': 0.021,
  'nose tip large': 0.083, 'nose pitch up': 0.208, 'nostril size small': 0.188, 'nostril height high': 0.125, 'mouth height low': 0.021,
  'mouth depth deep': 0.203, 'mouth sides out': 0.167, 'upper lip size small': 0.333, 'lower lip size small': 0.333, 'upper lip shape A': 0.003,
  'lower lip shape B': 0.248, 'upper lip length long': 0.005, 'lower lip length long': 0.165, 'lower lip notch concave': 0.188,
  'chin width wide': 0.416, 'chin height long': 0.146, 'chin length long': 0.18, 'chin shape butt': 0.063, 'cheekbone size small': 0.125,
  'cheekbone height high': 0.042, muscle: 0.25, fat: 0.25, length: 0.5,
}
export const SKIN = { saturation: 0.4, luminosity: 0.55 }
export const EYES = 'eyes_blue'
export const HAIR_COLOR: HairColor = { rgb: [155, 110, 56], lum: 1, specular: [236, 206, 170], spec_alpha: 1, spec_power: 20, spec_map: 100 } // Light Brown
export const HAIR = [
  { mesh: 'htop_forward', head: true }, // combed forward
  { mesh: 'hsbur_b', head: false }, // sideburns 3
  { mesh: 'heyeb_e', head: false }, // eyebrows 1
]
// The creator outfit; hides = Obscured_VIDs from player_cust.xtbl (body regions, and the boxers and socks under the jeans).
export const OUTFIT = [
  { mesh: 'cunds_tshirt_th', variant: 'tshirt_black', hides: [2, 3, 6, 7, 8, 9, 17] },
  { mesh: 'cbotm_casbagypant_nh', variant: 'jeans_darkblue', hides: [10, 11, 12, 13, 14, 15, 16, 19, 45, 46, 47] },
  { mesh: 'cshoe_sneakers', variant: 'sneakers_white', hides: [] as number[] },
]

const MORPH_NAMES: Record<number, string> = {}
for (const n of Object.keys(PRESET_WEIGHTS)) MORPH_NAMES[volitionHash(n)] = n
export const morphName = (h: number) => MORPH_NAMES[h] || hex8(h)

/** Editor units per game metre. */
export const UNITS_PER_METRE = 2

export interface PlayerModel {
  /** Origin at the feet, facing -Z, editor units. */
  object: THREE.Group
  /** Walk cycle and crouch: horizontal speed in editor units per second, crouch 0 (standing) to 1 (crouched). */
  update(dt: number, speed: number, crouch?: number): void
  dispose(): void
  /** What went in, for the status line. */
  summary: string
  /** Standing height in editor units. */
  height: number
}

interface Part { name: string; cmesh: Cmesh; geo: THREE.BufferGeometry; mesh: THREE.Mesh; pos: Float32Array }

/** Triangles per material for the draws the mesh makes (skipping hidden body regions, keeping one colour variant). */
export function trianglesByMat(cmesh: Cmesh, skipVids?: Set<number>, keepMat?: (m: number) => boolean) {
  const vids = cmesh.vids.filter((v) => !skipVids?.has(v.vid))
  let draws = cmesh.vids.length ? vids.flatMap((v) => v.draws) : cmesh.records[0].subs
  if (keepMat) draws = draws.filter((d) => keepMat(d.mat))
  draws = [...new Map(draws.map((d) => [d.start + ':' + d.count + ':' + d.mat, d])).values()]
  const byMat = new Map<number, number[]>()
  for (const d of draws) {
    let list = byMat.get(d.mat)
    if (!list) byMat.set(d.mat, (list = []))
    stripToTriangles(cmesh.geometry.strip, d.start, d.count, list)
  }
  return byMat
}

export function uvToThree(uv: Float32Array, n: number) {
  const a = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) { a[2 * i] = uv[2 * i]; a[2 * i + 1] = -uv[2 * i + 1] } // game v is negative; image top at v = -1
  return a
}

function makePart(name: string, cmesh: Cmesh, morph: Morph | null, materialFor: (mi: number) => THREE.Material, nbones: number, opts: { skipVids?: Set<number>; keepMat?: (m: number) => boolean } = {}): Part | null {
  const g = cmesh.geometry, n = g.nverts
  const pos = g.pos.slice(), nrm = g.nrm.slice()
  if (morph) applyMorphs(pos, nrm, morph, PRESET_WEIGHTS)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvToThree(g.uv0, n), 2))
  geo.setAttribute('uv1', new THREE.BufferAttribute(uvToThree(g.uv1, n), 2))
  const mats: THREE.Material[] = [], idx: number[] = []
  for (const [m, tris] of trianglesByMat(cmesh, opts.skipVids, opts.keepMat)) {
    if (!tris.length) continue
    geo.addGroup(idx.length, tris.length, mats.length)
    mats.push(materialFor(m))
    for (const t of tris) idx.push(t)
  }
  if (!idx.length) { geo.dispose(); return null }
  geo.setIndex(idx)
  let mesh: THREE.Mesh
  if (nbones) {
    // Normalised weights into the character rig; indices past the rig are dropped (skinPositions does the same).
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4)
    for (let v = 0; v < n; v++) {
      let sum = 0
      for (let j = 0; j < 4; j++) { const b = g.boneIndices[4 * v + j], w = b < nbones ? g.boneWeights[4 * v + j] : 0; si[4 * v + j] = w ? b : 0; sw[4 * v + j] = w; sum += w }
      if (sum > 0) for (let j = 0; j < 4; j++) sw[4 * v + j] /= sum
      else { sw[4 * v] = 1; si[4 * v] = 0 }
    }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4))
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4))
    mesh = new THREE.SkinnedMesh(geo, mats)
  } else mesh = new THREE.Mesh(geo, mats)
  mesh.name = name
  mesh.frustumCulled = false
  return { name, cmesh, geo, mesh, pos }
}

/** Finds entries across the user's packfiles, in the order given. */
export function library(packs: Vpp[]) {
  const find = (name: string) => packs.find((p) => p.has(name)) ?? null
  return {
    has: (name: string) => !!find(name),
    async read(name: string) { const p = find(name); if (!p) throw new Error(name + ' is not in the packfiles found'); return p.read(name) },
    async maybe(name: string) { const p = find(name); return p ? p.read(name) : null },
  }
}

/** Builds the default player from packfiles (misc2 and morph_stream at least; preload adds the skeleton and pose). */
export async function buildPlayer(packs: Vpp[]): Promise<PlayerModel> {
  const lib = library(packs)
  if (!lib.has('pc_body.cmesh_xbox2')) throw new Error('The player body (pc_body.cmesh_xbox2, in misc2.vpp_xbox2) was not found.')
  const notes: string[] = []
  const textures = new Set<THREE.Texture>()
  const track = <T extends THREE.Texture | null>(t: T) => { if (t) textures.add(t); return t }

  const rigBytes = await lib.maybe('pc.rig_xbox2')
  const rig: Rig | null = rigBytes ? parseRig(rigBytes) : null
  if (!rig) notes.push('no skeleton (preload.vpp_xbox2), so the arms stay out')
  const nbones = rig?.bones.length ?? 0
  const morphOf = async (base: string) => { const b = await lib.maybe(base + '_pc.morph_xbox2'); return b ? parseMorph(b, morphName) : null }
  const parts: Part[] = []

  // outfit: one colour variant of each item; the body regions it covers are left out of the body
  const hides = new Set<number>()
  for (const item of OUTFIT) {
    if (!lib.has(item.mesh + '.cmesh_xbox2')) { notes.push(item.mesh + ' not found'); continue }
    try {
      const [cm, pg, morph] = await Promise.all([lib.read(item.mesh + '.cmesh_xbox2'), lib.maybe(item.mesh + '.peg_xbox2'), morphOf(item.mesh)])
      const cmesh = parseCmesh(cm), pegs = pg ? decodePeg(pg) : {}, want = hex8(volitionHash(item.variant))
      const part = makePart(item.mesh, cmesh, morph, (mi) => {
        const mat = clothingMaterial(cmesh.materials[mi] || { slots: [], consts: {}, name: '', shader: '' }, pegs)
        for (const v of Object.values(mat.userData.uniforms as Record<string, { value: unknown }>)) if (v.value instanceof THREE.Texture) track(v.value)
        track(mat.map); track(mat.normalMap); track(mat.specularMap)
        return mat
      }, nbones, { keepMat: (mi) => cmesh.materials[mi]?.name === want })
      if (part) { parts.push(part); item.hides.forEach((v) => hides.add(v)) }
    } catch (e) { notes.push(item.mesh + ': ' + (e as Error).message) }
  }

  // body: skin regions with the creator's tone, hidden where the clothes cover it
  {
    const [cm, pg, morph] = await Promise.all([lib.read('pc_body.cmesh_xbox2'), lib.read('pc_body.peg_xbox2'), morphOf('pc_body')])
    if (!morph) notes.push('no body morphs (morph_stream.vpp_xbox2), so the face is the base head')
    const cmesh = parseCmesh(cm), pegs = decodePeg(pg)
    const cache = new Map<string, THREE.Texture>()
    const texFor = (n: string | undefined, srgb = false) => {
      if (!n) return null
      const key = n.toLowerCase() + (srgb ? ':s' : ''), d = pegs[n.toLowerCase()]
      if (!d) return null
      if (!cache.has(key)) cache.set(key, track(textureFrom(d, srgb)))
      return cache.get(key)!
    }
    const part = makePart('body', cmesh, morph, (mi) => {
      const m = cmesh.materials[mi] || { slots: [], consts: {}, name: '', shader: '' }
      const slot = (name: string) => m.slots.find((s) => s.slot === name)?.texture
      if (m.name === 'ffffffff') return new THREE.MeshBasicMaterial({ visible: false })
      if (m.shader === '35a9fb3d') { // bb-skin2: face and body regions
        const mat = skinMaterial({ diffuse: texFor(slot('diffuse_map')), pigment: texFor(slot('pigment_map')), specular: texFor(slot('specular_map')), consts: m.consts })
        setSkinTone(mat, SKIN.saturation, SKIN.luminosity)
        return mat
      }
      return new THREE.MeshPhongMaterial({ map: texFor(slot('diffuse_map'), true), shininess: (m.consts.specular_power || [30])[0], specular: 0x111111 })
    }, nbones, { skipVids: hides })
    if (part) parts.push(part)
  }

  // eyes
  if (lib.has('pc_eyeballs.cmesh_xbox2')) {
    const [cm, pg, morph] = await Promise.all([lib.read('pc_eyeballs.cmesh_xbox2'), lib.maybe('pc_eyeballs.peg_xbox2'), morphOf('pc_eyeballs')])
    const cmesh = parseCmesh(cm), pegs: Record<string, PegImage> = pg ? decodePeg(pg) : {}
    const d = pegs['pceye_d.tga'], ir = pegs['pceye_iris.tga']
    const eyeTex = d ? track(textureFrom(d)) : null, irisTex = ir ? track(textureFrom(ir)) : null
    if (irisTex) irisTex.wrapS = irisTex.wrapT = THREE.ClampToEdgeWrapping
    // The eye mesh draws one material slot; the game picks which of the seven eye-colour materials fills it.
    const part = makePart('eyes', cmesh, morph, (mi) => eyeMaterial({ diffuse: eyeTex, iris: irisTex, consts: cmesh.materials[mi]?.consts || {} }), nbones)
    if (part) {
      // The iris decal UVs (second set) run top-down with positive v, unlike the main set, so flip them as 1 - v.
      const g = cmesh.geometry, a = new Float32Array(g.nverts * 2)
      for (let i = 0; i < g.nverts; i++) { a[2 * i] = g.uv1[2 * i]; a[2 * i + 1] = 1 - g.uv1[2 * i + 1] }
      part.geo.setAttribute('uvIris', new THREE.BufferAttribute(a, 2))
      setEyeColor(part.mesh.material as THREE.Material[], cmesh.materials.find((m) => m.name === EYES))
      parts.push(part)
    }
  }

  // hair, sideburns and eyebrows
  for (const h of HAIR) {
    if (!lib.has(h.mesh + '.cmesh_xbox2')) { notes.push(h.mesh + ' not found'); continue }
    try {
      const [cm, pg, morph] = await Promise.all([lib.read(h.mesh + '.cmesh_xbox2'), lib.maybe(h.mesh + '.peg_xbox2'), morphOf(h.mesh)])
      const cmesh = parseCmesh(cm), pegs = pg ? decodePeg(pg) : {}
      const part = makePart(h.mesh, cmesh, morph, (mi) => {
        const m = cmesh.materials[mi] || { slots: [], name: '', consts: {}, shader: '' }
        const slot = m.slots.find((s) => /dsa|diffuse/i.test(s.texture || '')) || m.slots[0]
        const d = slot && pegs[slot.texture.toLowerCase()]
        if (!d) return new THREE.MeshBasicMaterial({ visible: false })
        const tex = track(textureFrom(d))
        if (/_2$/i.test(slot.slot)) tex.channel = 1 // diffuse_map_2 samples the second UV set
        // Head hair in the game is alpha-tested and opaque; facial hair blends with a doubled alpha so stubble fades.
        const mat = hairMaterial(tex, h.head ? { alphaTest: 0.3, transparent: false, alphaScale: 1 } : {})
        setHairColor(mat, HAIR_COLOR)
        return mat
      }, nbones)
      if (part) parts.push(part)
    } catch (e) { notes.push(h.mesh + ': ' + (e as Error).message) }
  }

  // Game model space (Y up, left-handed, facing +Z, metres) to the editor: mirror X for the handedness, turn to face -Z
  // (together a mirror in Z) and scale to editor units.
  const object = new THREE.Group()
  object.name = 'sr1-player'
  const model = new THREE.Group()
  model.scale.set(UNITS_PER_METRE, UNITS_PER_METRE, -UNITS_PER_METRE)
  object.add(model)

  const pose = standingPose(true)
  const bones: THREE.Bone[] = []
  if (rig) {
    const inverses: THREE.Matrix4[] = []
    rig.bones.forEach((b) => {
      const bone = new THREE.Bone()
      bone.name = b.name
      const t = b.rest.clone().sub(b.parent >= 0 ? rig.bones[b.parent].rest : new THREE.Vector3())
      const off = CREATOR_OFFSET[b.name]
      if (off) t.add(new THREE.Vector3(...off))
      bone.position.copy(t)
      if (pose[b.name]) bone.quaternion.copy(pose[b.name])
      bones.push(bone)
      inverses.push(new THREE.Matrix4().makeTranslation(-b.rest.x, -b.rest.y, -b.rest.z))
      if (b.parent >= 0) bones[b.parent].add(bone)
      else model.add(bone)
    })
    const skeleton = new THREE.Skeleton(bones, inverses)
    for (const p of parts) if (p.mesh instanceof THREE.SkinnedMesh) p.mesh.bind(skeleton, new THREE.Matrix4())
  }
  for (const p of parts) model.add(p.mesh)

  // Stand on the ground: the lowest point of the posed character (the soles) at the origin.
  const skin = rig ? skinMatrices(rig, pose, CREATOR_OFFSET) : null
  let minY = Infinity, maxY = -Infinity
  for (const p of parts) {
    const pos = p.pos.slice()
    if (skin) skinPositions(pos, p.cmesh.geometry.boneWeights, p.cmesh.geometry.boneIndices, skin)
    const used = p.geo.index!.array
    for (let i = 0; i < used.length; i++) { const y = pos[3 * used[i] + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y }
  }
  if (!isFinite(minY)) { minY = 0; maxY = 1.8 }
  const baseY = -minY * UNITS_PER_METRE
  model.position.y = baseY

  // On top of the standing pose: a simple walk cycle (legs swing from the hips, knees bend on the forward swing, arms
  // swing against the legs) and a crouch (hips and knees bend, feet stay flat, the back leans forward and the head
  // stays level). Each driven bone turns about the game's X axis in its parent's frame; in game space the character
  // faces +Z, so a negative turn moves a hanging limb forward and a positive turn tips an upright bone forward.
  // The leg bones (abs) blend from the creator pose to the crouch angle alone, so both legs fold alike (the creator
  // pose has the left leg turned out, which a crouch added on top would lift off the ground).
  // Whatever the legs do, the model is then moved so the lower foot stays on the ground and the feet stay under the
  // walker's position.
  const byName = (n: string) => (rig && rig.byName[n] !== undefined ? bones[rig.byName[n]] : null)
  const DRIVE: { name: string; walk: 'thigh' | 'calf' | 'arm' | null; side: number; crouch: number; abs?: boolean }[] = [
    { name: 'Pelvis', walk: null, side: 0, crouch: 0, abs: true },
    { name: 'L-Thigh', walk: 'thigh', side: 1, crouch: -1.4, abs: true }, { name: 'R-Thigh', walk: 'thigh', side: -1, crouch: -1.4, abs: true },
    { name: 'L-Calf', walk: 'calf', side: 1, crouch: 2.2, abs: true }, { name: 'R-Calf', walk: 'calf', side: -1, crouch: 2.2, abs: true },
    { name: 'L-Foot', walk: null, side: 1, crouch: -0.8, abs: true }, { name: 'R-Foot', walk: null, side: -1, crouch: -0.8, abs: true },
    { name: 'Spine', walk: null, side: 0, crouch: 0.3 }, { name: 'Spine1', walk: null, side: 0, crouch: 0.2 },
    { name: 'Neck', walk: null, side: 0, crouch: -0.25 }, { name: 'Head', walk: null, side: 0, crouch: -0.2 },
    { name: 'L-UpperArmTwist1', walk: 'arm', side: 1, crouch: -0.35 }, { name: 'R-UpperArmTwist1', walk: 'arm', side: -1, crouch: -0.35 },
    { name: 'L-ForeTwist', walk: null, side: 1, crouch: -0.4 }, { name: 'R-ForeTwist', walk: null, side: -1, crouch: -0.4 },
  ]
  const drive = DRIVE.filter((d) => byName(d.name)).map((d) => ({ ...d, bone: byName(d.name)!, rest: byName(d.name)!.quaternion.clone() }))
  const feet = ['L-Foot', 'R-Foot'].map(byName).filter((b): b is THREE.Bone => !!b)
  const X = new THREE.Vector3(1, 0, 0), q = new THREE.Quaternion(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), inv = new THREE.Matrix4(), v = new THREE.Vector3()
  /** The feet (ankle joints) in game model space: the lower one's height and their mean depth. */
  const feetNow = () => {
    model.updateMatrixWorld(true)
    inv.copy(model.matrixWorld).invert()
    let y = Infinity, z = 0
    for (const f of feet) { v.setFromMatrixPosition(f.matrixWorld).applyMatrix4(inv); y = Math.min(y, v.y); z += v.z / feet.length }
    return { y, z }
  }
  const feet0 = feet.length === 2 ? feetNow() : null
  let phase = 0, amp = 0
  const update = (dt: number, speed: number, crouch = 0) => {
    if (!drive.length) return
    const k = Math.max(0, Math.min(1, crouch))
    const metres = speed / UNITS_PER_METRE
    const want = Math.min(0.6, metres * 0.1) * (1 - 0.5 * k)
    amp += (want - amp) * Math.min(1, dt * 10)
    if (amp < 1e-3 && want === 0) { amp = 0; phase = 0 }
    phase = (phase + (dt * metres * Math.PI * 2) / (1.6 - 0.6 * k)) % (Math.PI * 2)
    const s = Math.sin(phase), c = Math.cos(phase)
    for (const d of drive) {
      const walk = d.walk === 'thigh' ? -amp * s * d.side : d.walk === 'calf' ? 1.6 * amp * Math.max(0, c * d.side) : d.walk === 'arm' ? 0.8 * amp * s * d.side : 0
      if (d.abs) d.bone.quaternion.copy(q.setFromAxisAngle(X, walk)).multiply(qa.copy(d.rest).slerp(qb.setFromAxisAngle(X, d.crouch), k))
      else d.bone.quaternion.copy(q.setFromAxisAngle(X, walk + d.crouch * k)).multiply(d.rest)
    }
    if (feet0) {
      const f = feetNow()
      model.position.set(0, baseY - (f.y - feet0.y) * UNITS_PER_METRE, (f.z - feet0.z) * UNITS_PER_METRE)
    }
  }

  const dispose = () => {
    for (const p of parts) {
      p.geo.dispose()
      for (const m of p.mesh.material as THREE.Material[]) m.dispose()
      if (p.mesh instanceof THREE.SkinnedMesh) p.mesh.skeleton?.dispose()
    }
    textures.forEach((t) => t.dispose())
    object.removeFromParent()
  }

  const verts = parts.reduce((a, p) => a + p.cmesh.geometry.nverts, 0)
  const summary = `${parts.length} parts, ${verts} vertices${rig ? ', standing pose' : ''}${notes.length ? ' (' + notes.join('; ') + ')' : ''}`
  return { object, update, dispose, summary, height: (maxY - minY) * UNITS_PER_METRE }
}
