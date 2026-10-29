// The Saints Row player pipeline (src/lib/sr1char). The last block builds the real character from a local Saints
// Reborn install and is skipped when there is none; no game file is ever copied into the repo.
import { describe, expect, it } from 'vitest'
import { GAME_TESTS } from './testMode'
import { existsSync, openAsBlob } from 'node:fs'
import * as THREE from 'three'
import { zlibSync } from 'fflate'
import { openVpp } from '../src/lib/sr1char/vpp'
import { volitionHash, hex8 } from '../src/lib/sr1char/hash'
import { clothingMaterial, eyeMaterial, hairMaterial, skinMaterial } from '../src/lib/sr1char/materials'
import { PACKFILES, pickPackfiles } from '../src/lib/sr1char/folder'
import { buildPlayer } from '../src/lib/sr1char/player'
import { parseCmesh, stripToTriangles } from '../src/lib/sr1char/cmesh'
import { CROUCH_EYE, CROUCH_HEIGHT, CROUCH_SPEED, STAND_EYE, STAND_HEIGHT } from '../src/editor/walk'

const up = (x: number) => (x + 2047) & ~2047

/** A packfile in the game's layout: flags 1 = each entry its own zlib stream, 3 = one stream for all (condensed). */
function makeVpp(files: Record<string, Uint8Array>, flags: 0 | 1 | 3): Uint8Array {
  const names = Object.keys(files), enc = new TextEncoder()
  const nameBytes: number[] = [], nameAt: number[] = []
  for (const n of names) { nameAt.push(nameBytes.length); nameBytes.push(...enc.encode(n), 0) }
  const dirSize = names.length * 28, namesAt = up(0x800 + dirSize), dataAt = up(namesAt + nameBytes.length)
  const offs: number[] = [], sizes: number[] = [], ssizes: number[] = []
  let raw = 0
  for (const n of names) { offs.push(raw); sizes.push(files[n].length); raw += files[n].length + ((64 - (files[n].length % 64)) % 64) }
  const plain = new Uint8Array(raw)
  names.forEach((n, i) => plain.set(files[n], offs[i]))
  const chunks: Uint8Array[] = []
  if (flags === 3) chunks.push(zlibSync(plain))
  else if (flags === 1) for (const n of names) { const z = zlibSync(files[n]); ssizes.push(z.length); const pad = new Uint8Array(up(z.length)); pad.set(z); chunks.push(pad) }
  else chunks.push(plain)
  const body = chunks.reduce((a, c) => a + c.length, 0)
  const out = new Uint8Array(dataAt + body), dv = new DataView(out.buffer)
  dv.setUint32(0, 0x51890ace); dv.setUint32(4, 3); out[0x14f] = flags
  dv.setUint32(0x154, names.length); dv.setUint32(0x15c, dirSize); dv.setUint32(0x160, nameBytes.length)
  names.forEach((_, i) => {
    const e = 0x800 + 28 * i
    dv.setUint32(e, nameAt[i]); dv.setUint32(e + 8, offs[i]); dv.setUint32(e + 16, sizes[i]); dv.setUint32(e + 20, ssizes[i] ?? sizes[i])
  })
  out.set(nameBytes, namesAt)
  let at = dataAt
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}

function noise(n: number, seed: number) {
  const a = new Uint8Array(n)
  let s = seed
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) >>> 0; a[i] = s >>> 24 }
  return a
}

describe('packfile reader', () => {
  const files = { 'a.cmesh_xbox2': noise(3000, 1), 'B.peg_xbox2': noise(1_300_000, 2), 'c.rig_xbox2': noise(777, 3) }
  for (const flags of [0, 1, 3] as const) {
    it(`reads single entries (flags ${flags})`, async () => {
      const vpp = await openVpp(new Blob([makeVpp(files, flags)]), 'test.vpp_xbox2')
      expect(vpp.list()).toEqual(Object.keys(files))
      expect(vpp.has('b.PEG_xbox2')).toBe(true)
      for (const [n, data] of Object.entries(files)) expect(Buffer.compare(await vpp.read(n), data)).toBe(0)
    })
  }
  it('rejects other files', async () => {
    await expect(openVpp(new Blob([new Uint8Array(4096)]), 'x')).rejects.toThrow(/not a Saints Row packfile/)
  })
})

describe('helpers', () => {
  it('hashes names as the game does (CRC-32, lower case, no final xor)', () => {
    expect(volitionHash('Root')).toBe(volitionHash('root'))
    expect(hex8(volitionHash(''))).toBe('00000000')
  })
  it('picks only the four packfiles out of a folder listing', () => {
    const f = (name: string) => new File([], name)
    const found = pickPackfiles([f('misc2.vpp_xbox2'), f('MORPH_STREAM.vpp_xbox2'), f('cs_lc01_scene01.vpp_xbox2'), f('readme.txt')])
    expect([...found.keys()]).toEqual(['misc2.vpp_xbox2', 'morph_stream.vpp_xbox2'])
    expect(PACKFILES).toContain('preload.vpp_xbox2')
  })
})

describe('materials', () => {
  // Every shader edit must land on a chunk that exists in this three.js version, or the look silently breaks.
  const compile = (m: THREE.Material) => {
    const sh = { uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.phong.uniforms), vertexShader: THREE.ShaderLib.phong.vertexShader, fragmentShader: THREE.ShaderLib.phong.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms
    m.onBeforeCompile(sh, {} as THREE.WebGLRenderer)
    return sh
  }
  const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1)
  it('patch the phong shader', () => {
    const skin = compile(skinMaterial({ diffuse: tex, pigment: tex, specular: null, consts: {} }))
    expect(skin.fragmentShader).not.toContain('#include <map_fragment>')
    expect(skin.fragmentShader).toContain('srRim')
    expect(skin.fragmentShader).toContain('srLin(mix(')
    const hair = compile(hairMaterial(tex))
    expect(hair.fragmentShader).not.toContain('#include <specularmap_fragment>')
    expect(hair.fragmentShader).toContain('outgoingLight += uSheen')
    const eye = compile(eyeMaterial({ diffuse: tex, iris: tex, consts: {} }))
    expect(eye.vertexShader).toContain('vIris = uvIris')
    expect(eye.fragmentShader).toContain('srIris')
    const cloth = compile(clothingMaterial({ shader: '', name: '', slots: [{ slot: 'diffuse_map', texture: 'd.tga' }, { slot: 'decal_map_1', texture: 'd.tga' }], consts: {} }, { 'd.tga': { width: 1, height: 1, rgba: new Uint8Array(4) } }))
    expect(cloth.fragmentShader).toContain('uDecal0')
    expect(cloth.fragmentShader).not.toContain('#include <map_fragment>')
    expect(Object.keys(cloth.uniforms)).toContain('uDecalC0')
  })
})

// A local Saints Reborn install, if there is one (nothing from it is written anywhere).
const GAME = process.env.SR1_PACKFILES || 'C:/Games/SaintsReborn/dist/game/packfiles'
const haveGame = existsSync(GAME + '/misc2.vpp_xbox2')

describe.skipIf(!GAME_TESTS || !haveGame)('the player from a local game install', () => {
  it('builds the default character standing at the origin, facing -Z, at player height', async () => {
    const packs = []
    for (const n of PACKFILES) if (existsSync(GAME + '/' + n)) packs.push(await openVpp(await openAsBlob(GAME + '/' + n), n))
    const p = await buildPlayer(packs)
    const meshes: THREE.Mesh[] = []
    p.object.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o) })
    expect(meshes.map((m) => m.name).sort()).toEqual(['body', 'cbotm_casbagypant_nh', 'cshoe_sneakers', 'cunds_tshirt_th', 'eyes', 'heyeb_e', 'hsbur_b', 'htop_forward'].sort())
    expect(meshes.every((m) => m instanceof THREE.SkinnedMesh)).toBe(true)
    for (const m of meshes) expect(m.geometry.index!.count).toBeGreaterThan(0)
    expect(p.summary).toContain('standing pose')
    // the walk-through's player is 3.6 units (1.8 m)
    expect(p.height).toBeGreaterThan(3.3)
    expect(p.height).toBeLessThan(4.0)

    p.object.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(p.object, true)
    expect(Math.abs(box.min.y)).toBeLessThan(0.05)
    expect(box.max.y).toBeGreaterThan(3.3)
    expect(box.max.x - box.min.x).toBeLessThan(2.5) // arms down: the standing pose, not the T pose
    const at = (name: string) => p.object.getObjectByName(name)!.getWorldPosition(new THREE.Vector3())
    expect(at('L-Toe0').z).toBeLessThan(at('L-Foot').z) // toes point -Z
    expect(at('L-Thigh').x).toBeLessThan(at('R-Thigh').x) // left leg on the left when facing -Z
    expect(at('Head').y).toBeGreaterThan(3)

    // the walk cycle moves the legs and stays finite
    const before = (p.object.getObjectByName('L-Thigh') as THREE.Bone).quaternion.clone()
    for (let i = 0; i < 10; i++) p.update(0.05, 9)
    const after = (p.object.getObjectByName('L-Thigh') as THREE.Bone).quaternion
    expect(after.angleTo(before)).toBeGreaterThan(0.01)
    expect(Number.isFinite(after.w)).toBe(true)

    // The model's standing and crouched sizes are close to the walker's (the game capsule, walk.ts): height and eye
    // height (eyes mesh centre).
    const measure = (crouch: number) => {
      for (let i = 0; i < 40; i++) p.update(0.05, 0, crouch)
      p.object.updateMatrixWorld(true)
      const all = new THREE.Box3().setFromObject(p.object, true)
      const eyes = new THREE.Box3().setFromObject(p.object.getObjectByName('eyes')!, true)
      return { min: all.min.y, height: all.max.y, eye: eyes.getCenter(new THREE.Vector3()).y }
    }
    const stand = measure(0), crouched = measure(1)
    expect(Math.abs(stand.height - STAND_HEIGHT)).toBeLessThan(0.08)
    expect(Math.abs(stand.eye - STAND_EYE)).toBeLessThan(0.08)
    expect(crouched.height).toBeGreaterThan(CROUCH_HEIGHT - 0.05) // head top 1.11 to 1.2 m
    expect(crouched.height).toBeLessThan(2.4)
    expect(Math.abs(crouched.eye - CROUCH_EYE)).toBeLessThan(0.2)
    expect(Math.abs(crouched.min)).toBeLessThan(0.05) // feet stay on the ground
    // crouch-walking keeps the feet on the ground too
    for (let i = 0; i < 20; i++) {
      p.update(0.05, CROUCH_SPEED, 1)
      p.object.updateMatrixWorld(true)
      expect(Math.abs(new THREE.Box3().setFromObject(p.object, true).min.y)).toBeLessThan(0.06)
    }
    p.dispose()
  }, 120000)

  // Weapons and props are type-0 (static) meshes, whose render header stops at +36: every one reads to the end of the
  // file with its vertices inside its own bounding box and unit normals.
  it.skipIf(!existsSync(GAME + '/preload_lower.vpp_xbox2'))('reads every static mesh (.smesh_xbox2)', async () => {
    const pack = await openVpp(await openAsBlob(GAME + '/preload_lower.vpp_xbox2'), 'preload_lower')
    const names = pack.list().filter((n) => n.toLowerCase().endsWith('.smesh_xbox2'))
    expect(names.length).toBeGreaterThan(50)
    for (const name of names) {
      const u8 = await pack.read(name)
      const m = parseCmesh(u8), g = m.geometry, [x0, y0, z0, x1, y1, z1] = m.bbox
      expect(m.mtype, name).toBe(0)
      expect(m.vids, name).toEqual([])
      const end = Math.max(...m.records.map((r) => Math.max(r.ibOffset + r.nidx * 2, r.vbOffset + r.nverts * r.stride)))
      expect(end, name).toBeLessThanOrEqual(u8.length)
      for (let i = 0; i < g.nverts; i++) {
        const [x, y, z] = [g.pos[3 * i], g.pos[3 * i + 1], g.pos[3 * i + 2]]
        expect(x >= x0 - 1e-3 && x <= x1 + 1e-3 && y >= y0 - 1e-3 && y <= y1 + 1e-3 && z >= z0 - 1e-3 && z <= z1 + 1e-3, name).toBe(true)
        expect(Math.abs(Math.hypot(g.nrm[3 * i], g.nrm[3 * i + 1], g.nrm[3 * i + 2]) - 1), name).toBeLessThan(0.05)
      }
      expect(g.strip.every((k) => k < g.nverts), name).toBe(true)
      expect(m.records[0].subs.reduce((a, s) => a + stripToTriangles(g.strip, s.start, s.count).length, 0), name).toBeGreaterThan(0)
    }
  }, 120000)
})
