// How game objects are drawn the way the game draws them: the whole material record and every UV set, the stored
// normals and tangents (chunk.ts), and what each material draws (material.ts), checked on small chunks built
// here. The last block reads real chunks of a local Saints Reborn install when there is one (SR1_PACKFILES, or
// the default install folder); nothing from it is written into the repo.
import { describe, expect, it } from 'vitest'
import { existsSync, openAsBlob } from 'node:fs'
import { join } from 'node:path'
import { GAME_TESTS } from './testMode'
import { buildChunk, vhash, type Spec } from './chunkBuilder'
import { dec3n, meshTriangles, readChunk } from '../src/lib/gameObjects/chunk'
import { describeMaterial, lookKey, lookTextures, lookUvSets, namedMaterial, shaderName } from '../src/lib/gameObjects/material'
import { extractObject } from '../src/lib/gameObjects/extract'
import { decodeLook, encodeLook, mapLookTextures } from '../src/lib/gameObjects/lookFile'
import { gameObjectPaths } from '../src/lib/gameObjects/policy'
import { cutArea } from '../src/lib/city/city'
import { splitPieces } from '../src/lib/city/build'
import { newProject, referencedPaths, type SceneItem } from '../src/lib/project'
import { openVpp } from '../src/lib/sr1char/vpp'
import { ALWAYS_PEGS, chunkPegNames, findTexture, hasAlpha, indexPeg, type PegIndex } from '../src/lib/gameObjects/textures'

const quad = (uvSets: number) => ({
  verts: [0, 1, 2, 3].map((i) => [i & 1, 0, i >> 1, ...Array.from({ length: 2 * uvSets }, (_, k) => (k + 1) * 0.25 + i * 0.5)]),
  indices: [0, 1, 2, 3], uvSets,
  normals: [[0, 1, 0], [0, 1, 0], [0.6, 0.8, 0], [0, 0, 1]],
  tangents: [[1, 0, 0, 1], [1, 0, 0, -1], [0, 0, 1, 1], [1, 0, 0, 1]],
})

const spec = (): Spec => ({
  strings: ['wall_co.tga', 'grime_d.tga', 'sticker_d.tga', 'wall_nm.tgn', 'wall_sp.tga', 'missing-alpha.tga', 'grass_gs.tga', 'dirt_gs.tga', 'GE_LfBlend.tga', 'line_d.tga', 'sky.tga'],
  vbs: [quad(3), quad(1), { ...quad(2), unlit: true }],
  materials: [
    {
      shader: 'bb-standard_s', flags: 3,
      slots: [['Diffuse_Map', 0], ['Decal_Map_1', 1], ['Decal_Map_2', 2], ['Normal_Map', 3], ['Specular_Map', 4]],
      tiling: [['Decal_Map_1_TilingU', [3.5]], ['Decal_Map_1_TilingV', [2]], ['Decal_Map_2_TilingU', [1]], ['Decal_Map_2_TilingV', [1]], ['Normal_Map_TilingU', [4]], ['Normal_Map_TilingV', [4]], ['Spec_Map_TilingU', [2]], ['Spec_Map_TilingV', [2]]],
      consts: [['Diffuse_Color', [0.7, 0.75, 0.8, 1]], ['Decal_Map_1_Opacity', [0.6]], ['Decal_Map_2_Opacity', [1]], ['Normal_Map_Height', [0.5]], ['Specular_Map_Amount', [1]], ['Specular_Power', [40]], ['Specular_Alpha', [0.3]], ['Specular_Color', [1, 0.9, 0.8, 1]], ['Self_Illumination', [0]]],
      // Decal 2 (texture parameter 2) clamped in U and V: one sticker.
      address: [[2, 1, 3], [2, 2, 3]],
    },
    {
      shader: 'bb-terrain1_s', slots: [['Diffuse_Map_1', 6], ['Diffuse_Map_2', 7], ['Transition_Map_3', 8], ['Normal_Map_1', 3], ['Specular_Map_1', 5]],
      consts: [['Diffuse_Color_1', [1, 1, 1, 1]], ['Diffuse_Color_2', [0.7, 0.6, 0.5, 1]], ['Invert_Transition_Map', [1]], ['Normal_Map_1_Height', [0.8]]],
    },
    { shader: 'bb-floatingdecal1_s', slots: [['Decal_Map_1', 9], ['Normal_Map', 3]], tiling: [['Decal_Map_1_TilingU', [1]], ['Decal_Map_1_TilingV', [12]]], consts: [['Decal_Map_1_Opacity', [0.9]]], address: [[0, 1, 3]] },
    { shader: 'bb-tod-window1_s', flags: 0xb, slots: [['Diffuse_Map', 0], ['Decal_Map_1', 5], ['Decal_Map_2', 5]], consts: [['Self_Illumination', [1]]] },
    { shader: 'bb-skydome1_s', slots: [['Diffuse_Map', 10]] },
    [0, 3],
  ],
  meshes: [{ subs: [{ vb: 0, batches: [[0, 4, 0]] }] }, { subs: [{ vb: 1, batches: [[0, 4, 1]] }] }, { subs: [{ vb: 2, batches: [[0, 4, 4]] }] }],
  instances: [{ pos: [0, 0, 0], mesh: 0 }, { pos: [5, 0, 0], mesh: 1 }, { pos: [9, 0, 0], mesh: 2 }],
  records: [{ name: 'wall', instance: 0 }, { name: 'ground', instance: 1 }, { name: 'sky', instance: 2 }],
})

describe('the whole material record', () => {
  const ch = readChunk(buildChunk(spec()))

  it('reads the shader, flags, every slot, the tiling and other constants and the address modes', () => {
    const m = ch.materials[0]
    expect(shaderName(m)).toBe('bb-standard_s')
    expect(m.shader).toBe(vhash('bb-standard_s'))
    expect(m.flags).toBe(3)
    expect(m.slots.map((s) => s.texture)).toEqual(['wall_co.tga', 'grime_d.tga', 'sticker_d.tga', 'wall_nm.tgn', 'wall_sp.tga'])
    expect(m.slots[1].slot).toBe(vhash('Decal_Map_1'))
    expect(m.tiling).toHaveLength(8)
    expect(m.tiling[0]).toEqual({ name: vhash('Decal_Map_1_TilingU'), values: [3.5, 0, 0, 0] })
    expect(m.constants[0].values.map((v) => +v.toFixed(3))).toEqual([0.7, 0.75, 0.8, 1])
    expect(m.address).toEqual([{ param: 2, axis: 1, mode: 3 }, { param: 2, axis: 2, mode: 3 }])
    // What earlier versions kept: the picture names, in record order.
    expect(m.textures).toEqual(['wall_co.tga', 'grime_d.tga', 'sticker_d.tga', 'wall_nm.tgn', 'wall_sp.tga'])
    expect(ch.materials[3].flags).toBe(0xb)
    expect(ch.materials[5].slots.map((s) => s.texture)).toEqual(['wall_co.tga', 'wall_nm.tgn'])
    const n = namedMaterial(m)
    expect(n.slots.get('Normal_Map')).toBe('wall_nm.tgn')
    expect(n.clamp.get('Decal_Map_2')).toEqual([true, true])
    expect(n.clamp.get('Decal_Map_1')).toBeUndefined()
  })

  it('tells the vertex layouts apart and reads UV0-UV3 (÷ 1024), normals and tangents', () => {
    expect(ch.vbs.map((v) => [v.stride, v.lit, v.uvAt, v.uvSets])).toEqual([[32, true, 20, 3], [24, true, 20, 1], [20, false, 12, 2]])
    const p = meshTriangles(ch, 0)
    expect(p.extraUvs).toHaveLength(2)
    // Vertex i's set k (0-based) holds ((2k + 1) * 0.25 + i * 0.5, (2k + 2) * 0.25 + i * 0.5).
    expect([...p.uvs.slice(0, 2)]).toEqual([0.25, 0.5])
    expect([...p.extraUvs[0].slice(0, 2)]).toEqual([0.75, 1])
    expect([...p.extraUvs[1].slice(2, 4)]).toEqual([1.75, 2])
    const r = (a: ArrayLike<number> | null, n: number) => Array.from(a!).slice(0, n).map((v) => +v.toFixed(2))
    expect(r(p.normals, 9)).toEqual([0, 1, 0, 0, 1, 0, 0.6, 0.8, 0])
    expect(r(p.tangents, 8)).toEqual([1, 0, 0, 1, 1, 0, 0, -1])
    // Position and UVs only: no normals, UV0 right after the position.
    const sky = meshTriangles(ch, 2)
    expect(sky.normals).toBeNull()
    expect([...sky.uvs.slice(0, 2)]).toEqual([0.25, 0.5])
    expect([...sky.extraUvs[0].slice(0, 2)]).toEqual([0.75, 1])
    expect(dec3n(0xc0000000 | 511)).toEqual([1, 0, 0, -1])
  })

  it('works out what each material draws', () => {
    const wall = describeMaterial(ch.materials[0])!
    expect(wall.kind).toBe('standard')
    expect(wall.base).toEqual({ tex: 'wall_co.tga', uv: 0, repeat: [1, 1], clamp: [false, false] })
    expect(wall.tint.map((v) => +v.toFixed(2))).toEqual([0.7, 0.75, 0.8])
    expect(wall.decals.map((d) => [d.layer.tex, d.layer.uv, d.layer.repeat, d.layer.clamp, +d.opacity.toFixed(2)])).toEqual([
      ['grime_d.tga', 1, [3.5, 2], [false, false], 0.6], ['sticker_d.tga', 2, [1, 1], [true, true], 1],
    ])
    expect(wall.normal).toMatchObject({ tex: 'wall_nm.tgn', uv: 0, repeat: [4, 4], scale: 0.5 })
    expect(wall.specular).toMatchObject({ map: { tex: 'wall_sp.tga', repeat: [2, 2] }, amount: 1, power: 40 })
    expect(+wall.specular.alpha.toFixed(2)).toBe(0.3)
    expect(wall.blend).toBe(false)
    expect(lookTextures(wall)).toEqual(['wall_co.tga', 'wall_nm.tgn', 'wall_sp.tga', 'grime_d.tga', 'sticker_d.tga'])
    expect(lookUvSets(wall)).toBe(2)
    // A mesh with only two UV sets: the decal on UV2 is left out.
    expect(describeMaterial(ch.materials[0], 2)!.decals.map((d) => d.layer.tex)).toEqual(['grime_d.tga'])

    const ground = describeMaterial(ch.materials[1])!
    expect(ground).toMatchObject({ kind: 'terrain', ground: true, invertMask: true, base: { tex: 'grass_gs.tga', uv: 0 }, base2: { tex: 'dirt_gs.tga', uv: 1 }, mask: { tex: 'GE_LfBlend.tga', uv: 2 } })
    expect(ground.tint2!.map((v) => +v.toFixed(2))).toEqual([0.7, 0.6, 0.5])
    expect(ground.specular.map).toBeUndefined() // missing-alpha.tga is "nothing"

    const line = describeMaterial(ch.materials[2])!
    expect(line).toMatchObject({ kind: 'decal', blend: true, ground: true })
    expect(line.decals[0].layer).toEqual({ tex: 'line_d.tga', uv: 1, repeat: [1, 12], clamp: [true, false] })

    const win = describeMaterial(ch.materials[3])!
    expect(win).toMatchObject({ glow: true, selfIllum: 1, decals: [] })
    expect(describeMaterial(ch.materials[4])).toBeNull() // the sky: drawn as before
    expect(describeMaterial(ch.materials[5])).toBeNull() // no shader the editor knows
    expect(lookKey('A.tga', wall)).not.toBe(lookKey('A.tga', describeMaterial(ch.materials[0], 2)))
  })
})

describe('the layers travel with the object', () => {
  // The wall twice, with one copy turned 90 degrees, and the same picture under two looks (tinted and not).
  const two = (): Spec => {
    const s = spec()
    s.materials.push({ shader: 'bb-standard_s', slots: [['Diffuse_Map', 0]], consts: [['Diffuse_Color', [1, 1, 1, 1]]] })
    s.vbs.push(quad(3))
    s.meshes.push({ subs: [{ vb: 3, batches: [[0, 4, 6]] }] })
    s.instances.push({ pos: [0, 0, 3], rot: [0, 0, -1, 0, 1, 0, 1, 0, 0], mesh: 3 })
    s.records.push({ name: 'wall_b', instance: 3 })
    return s
  }
  const ch = readChunk(buildChunk(two()))

  it('a cut-out object keeps UV sets, normals and each material look; same picture, different look stays apart', () => {
    const m = extractObject(ch, { record: 0, parts: [0, 3] })
    expect(m.materials).toEqual(['wall_co.tga', 'wall_co.tga'])
    expect(m.looks!.map((l) => l?.tint.map((v) => +v.toFixed(2)))).toEqual([[0.7, 0.75, 0.8], [1, 1, 1]])
    expect(m.extraUvs).toHaveLength(2)
    expect(m.extraUvs![0].length).toBe(m.uvs.length)
    expect([...m.extraUvs![1].slice(0, 2)]).toEqual([1.25, 1.5])
    // Normals turn with their part: the second wall's straight-up normal stays up, its tilted one turns about Y.
    const n = m.normals!
    expect(+n[1].toFixed(2)).toBe(1)
    const tilted = [n[3 * 6], n[3 * 6 + 1], n[3 * 6 + 2]].map((v) => +v.toFixed(2) + 0)
    expect(tilted).toEqual([0, 0.8, -0.6])
    // The first wall alone: one material, the same as before for a plain one.
    // The sky: no look, its one picture as before.
    const plain = extractObject(ch, { record: 2 })
    expect(plain.looks).toBeUndefined()
    expect(plain.materials).toEqual(['sky.tga'])
  })

  it('a look file holds the looks and the vertex data, and reads back', () => {
    const m = extractObject(ch, { record: 0 })
    const look = mapLookTextures(m.looks![0]!, (t) => (t === 'sticker_d.tga' ? null : '/work/f/x/' + t))
    expect(look.decals.map((d) => d.layer.tex)).toEqual(['/work/f/x/grime_d.tga'])
    const n = m.positions.length / 3
    const bytes = encodeLook({ mats: { wall: { diffuse: '/work/f/x/wall.png', look } }, vertices: n, uvs: m.extraUvs!, normals: m.normals })
    const back = decodeLook(bytes)
    expect(back.vertices).toBe(n)
    expect(back.mats.wall.look).toEqual(look)
    expect([...back.uvs[1]]).toEqual([...m.extraUvs![1]])
    expect([...back.normals!]).toEqual([...m.normals!])
    expect(() => decodeLook(new Uint8Array(16))).toThrow(/look file/)
    expect(() => encodeLook({ mats: {}, vertices: 3, uvs: [new Float32Array(2)] })).toThrow(/expected 6/)
  })

  it('a city cut keeps the layers through clipping, and each piece keeps its own vertices of them', () => {
    // The wall quad spans x 0..1, z 0..1; cut at x = 0.5.
    const cut = cutArea([['c', ch]], { x0: -1, z0: -1, x1: 0.5, z1: 2 })
    const wall = cut.solid.looks!.findIndex((l) => l?.decals.length)
    expect(wall).toBeGreaterThanOrEqual(0)
    let checked = 0
    for (const sm of [cut.solid, cut.look]) {
      expect(sm.extraUvs).toHaveLength(3)
      expect(sm.looks).toBe(cut.solid.looks)
      // Every corner's UV1 lies on the line the quad's own UV1 runs along (u1 - u0 = 0.5 everywhere), clipped corners too.
      for (let t = 0; t < sm.triMaterial.length; t++) {
        if (sm.triMaterial[t] !== wall) continue
        for (const i of sm.triangles.slice(3 * t, 3 * t + 3)) { expect(sm.extraUvs![0][2 * i] - sm.uvs[2 * i]).toBeCloseTo(0.5); checked++ }
      }
      for (let i = 0; i < sm.normals!.length; i += 3) { const l = Math.hypot(sm.normals![i], sm.normals![i + 1], sm.normals![i + 2]); expect(l === 0 || Math.abs(l - 1) < 1e-6).toBe(true) }
    }
    expect(checked).toBeGreaterThan(3)
    // The clipped corner at x = 0.5 is halfway along: UV0 u = 0.25 + 0.25.
    expect([...cut.solid.uvs, ...cut.look.uvs].some((u, i) => i % 2 === 0 && Math.abs(u - 0.5) < 1e-6)).toBe(true)
    const pieces = splitPieces({ solid: { mesh: cut.solid, textures: [] }, look: { mesh: cut.look, textures: [] }, pieces: cut.pieces, solidPiece: cut.solidPiece, lookPiece: cut.lookPiece })
    for (const p of pieces) {
      expect(p.mesh.extraUvs![2].length).toBe(p.mesh.uvs.length)
      expect(p.mesh.normals!.length).toBe(p.mesh.positions.length)
      expect(p.mesh.looks).toBe(cut.solid.looks)
    }
  })

  it('look files and their pictures are game data: kept by the project, left out of backups', () => {
    const p = newProject('t')
    const it = { uid: 'u', name: 'piece', path: '/work/f/a/piece.obj', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: { m: '/work/f/b/m.png' }, alpha: {}, game_look: { path: '/work/f/c/piece.look', layers: ['/work/f/d/grime.png'] } } as SceneItem
    p.scene_items.push(it)
    for (const path of ['/work/f/a/piece.obj', '/work/f/b/m.png', '/work/f/c/piece.look', '/work/f/d/grime.png']) p.files[path] = { hash: path, size: 1, name: path, type: '', origin: 'game' }
    expect(referencedPaths(p)).toEqual(expect.arrayContaining(['/work/f/c/piece.look', '/work/f/d/grime.png']))
    expect([...gameObjectPaths(p)].sort()).toEqual(['/work/f/c/piece.look', '/work/f/d/grime.png'])
  })
})

const GAME = process.env.SR1_PACKFILES || 'C:/Games/SaintsReborn/dist/game/packfiles'
const haveGame = existsSync(join(GAME, 'mp_city_stream.vpp_xbox2'))

describe.skipIf(!GAME_TESTS || !haveGame)('materials and vertices of a local game install', () => {
  it('reads every material record and UV set of real chunks the way the research measured them', async () => {
    const mp = await openVpp(await openAsBlob(join(GAME, 'mp_city_stream.vpp_xbox2')), 'mp_city_stream')
    const city = existsSync(join(GAME, 'sr_city_stream.vpp_xbox2')) ? await openVpp(await openAsBlob(join(GAME, 'sr_city_stream.vpp_xbox2')), 'sr_city_stream') : null
    const chunks = [readChunk(await mp.read('mp_bac_01.bbchunk_xbox2'))]
    if (city) chunks.push(readChunk(await city.read(city.list().find((n) => /^sr_chunk0\d+\.bbchunk_xbox2$/i.test(n))!)))
    for (const ch of chunks) {
      const mats = ch.materials
      expect(mats.length).toBeGreaterThan(100)
      // Nearly every material's effect is one of the world effects the editor draws or knowingly leaves alone.
      const known = mats.filter((m) => !/^[0-9a-f]{8}$/.test(shaderName(m))).length
      expect(known / mats.length).toBeGreaterThan(0.9)
      // Address modes: clamp (3), on decal slots.
      for (const m of mats) for (const a of m.address) {
        expect(a.mode).toBe(3)
        expect([1, 2]).toContain(a.axis)
        expect(m.slots[a.param], shaderName(m)).toBeDefined()
      }
      const std = mats.filter((m) => shaderName(m) === 'bb-standard_s')
      expect(std.length).toBeGreaterThan(20)
      for (const m of std) expect(namedMaterial(m).slots.has('Diffuse_Map')).toBe(true)
      const looks = std.map((m) => describeMaterial(m)).filter(Boolean)
      expect(looks.length / std.length).toBeGreaterThan(0.95)
      expect(looks.some((l) => l!.decals.length)).toBe(true)
      // Lit geometry: unit normals, tangent signs ±1; most triangles carry three or more UV sets.
      const lit = ch.vbs.filter((v) => v.lit)
      expect(lit.length / ch.vbs.length).toBeGreaterThan(0.8)
      let tris = 0, rich = 0, bad = 0, nn = 0
      for (const [mi, mesh] of ch.meshes.entries()) {
        if (mi % 7) continue
        const p = meshTriangles(ch, mi)
        tris += p.triangles.length / 3
        if (p.extraUvs.length >= 2) rich += p.triangles.length / 3
        if (!p.normals) continue
        for (let i = 0; i < p.normals.length; i += 3) {
          const l = Math.hypot(p.normals[i], p.normals[i + 1], p.normals[i + 2])
          if (l === 0) continue
          nn++
          if (Math.abs(l - 1) > 0.02 || Math.abs(Math.abs(p.tangents![(i / 3) * 4 + 3]) - 1) > 0) bad++
        }
        void mesh
      }
      expect(nn).toBeGreaterThan(1000)
      expect(bad / nn).toBeLessThan(0.01)
      expect(rich / tris).toBeGreaterThan(0.5)
      // Extra UV sets are real unwraps, not copies of UV0.
      const someStd = ch.meshes.findIndex((m) => m.subs.some((s) => (ch.vbs[s.vb]?.uvSets ?? 0) >= 3))
      const p = meshTriangles(ch, someStd)
      let same = 0
      for (let i = 0; i < p.uvs.length; i++) if (p.uvs[i] === p.extraUvs[0][i]) same++
      expect(same / p.uvs.length).toBeLessThan(0.9)
    }
  }, 120_000)

  it('a cut of the city keeps its layers, and their pictures decode (decals with soft alpha, normal maps)', async () => {
    if (!existsSync(join(GAME, 'sr_city_stream.vpp_xbox2'))) return
    const city = await openVpp(await openAsBlob(join(GAME, 'sr_city_stream.vpp_xbox2')), 'sr_city_stream')
    const misc = existsSync(join(GAME, 'misc2.vpp_xbox2')) ? await openVpp(await openAsBlob(join(GAME, 'misc2.vpp_xbox2')), 'misc2') : null
    const stem = 'sr_chunk13'
    const cut = cutArea([[stem, readChunk(await city.read(stem + '.bbchunk_xbox2'))]], { x0: 20, z0: 690, x1: 80, z1: 750 })
    const looks = cut.solid.looks!
    const withDecals = looks.filter((l) => l?.decals.length).length
    console.log(`${looks.length} materials: ${looks.filter(Boolean).length} with a look, ${withDecals} with decals, ${looks.filter((l) => l?.kind === 'terrain' || l?.kind === 'blend').length} blends, ${looks.filter((l) => l?.normal).length} normal maps`)
    expect(looks.filter(Boolean).length / looks.length).toBeGreaterThan(0.6)
    expect(withDecals).toBeGreaterThan(3)
    // Layers on UV1/UV2 are read: those corners don't all sit at 0.
    let nonzero = 0
    for (const v of cut.solid.extraUvs![0]) if (v) nonzero++
    expect(nonzero).toBeGreaterThan(cut.solid.extraUvs![0].length / 4)
    const pegs: PegIndex[] = []
    for (const n of chunkPegNames(stem)) if (city.has(n)) pegs.push(indexPeg(await city.read(n)))
    if (misc) for (const n of ALWAYS_PEGS) if (misc.has(n)) pegs.push(indexPeg(await misc.read(n)))
    const decals = [...new Set(looks.flatMap((l) => l?.decals.map((d) => d.layer.tex) ?? []))]
    const normals = [...new Set(looks.flatMap((l) => (l?.normal ? [l.normal.tex] : [])))]
    const dec = decals.map((t) => findTexture(t, pegs)).filter(Boolean)
    const nrm = normals.map((t) => findTexture(t, pegs)).filter(Boolean)
    expect(dec.length / decals.length).toBeGreaterThan(0.5)
    expect(dec.filter((img) => hasAlpha(img!)).length / dec.length).toBeGreaterThan(0.5)
    expect(nrm.length).toBeGreaterThan(0)
    // Tangent-space normal maps: mostly facing out (blue high).
    const img = nrm[0]!
    let blue = 0
    for (let i = 2; i < img.rgba.length; i += 4) blue += img.rgba[i]
    expect(blue / (img.rgba.length / 4)).toBeGreaterThan(160)
  }, 300_000)
})
