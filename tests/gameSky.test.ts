// The game's own sky at export (src/lib/gameSky.ts): finding the sky's pictures in a map chunk and in a texture
// file's head, checked on small files built here, and the editor's stand-in sky (src/editor/skyLook.ts). The last
// block reads mp_bac_01 from a local game install when there is one (SR1_PACKFILES, or the default install
// folder); nothing from the game is copied into the repo. With SR1_GAME_SKY_OUT set it also writes the files the
// exporter is handed, for tests/native_sky_check.py.
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, openAsBlob, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { GAME_TESTS } from './testMode'
import { buildChunk, box, type Spec } from './chunkBuilder'
import { readChunk } from '../src/lib/gameObjects/chunk'
import { SKY_OBJECTS, SKY_SOURCE, pegPicks, skyDonorFiles, skyFilesFrom, skyTextureNames } from '../src/lib/gameSky'
import { defaultSettings, gameSkyWanted, newProject } from '../src/lib/project'
import { mapChecklist } from '../src/lib/checklist'
import { skyPuffs } from '../src/editor/skyLook'
import { openVpp } from '../src/lib/sr1char/vpp'

/** A chunk with the five sky objects (and a bench), their materials naming the pictures given. */
function skyChunk(names = SKY_OBJECTS): Spec {
  return {
    strings: ['moon.tga', 'test_sphere_N.tgn', 'cf_ring_glow.tga', 'shd_stars.tga', 'ds_grad_blk.tga', 'cloud_sparse_hz.tga', 'bench_wo.tga', 'Moon.TGA'],
    vbs: [box(1, 1, 1), box(30, 12, 30)],
    // Sun: none; moon + normal map; glow; stars; clouds; bench; the moon again under another case
    materials: [[], [0, 1], [2], [3, 4], [5], [6], [7]],
    meshes: [
      { subs: [{ vb: 0, batches: [[0, 10, 0]] }] },
      { subs: [{ vb: 0, batches: [[0, 4, 1], [4, 6, 2]] }] },
      { subs: [{ vb: 1, batches: [[0, 10, 3]] }] },
      { subs: [{ vb: 1, batches: [[0, 10, 6]] }] },
      { subs: [{ vb: 1, batches: [[0, 10, 4]] }] },
      { subs: [{ vb: 0, batches: [[0, 10, 5]] }] },
    ],
    instances: [0, 1, 2, 3, 4, 5].map((mesh) => ({ pos: [246, 2, -88], mesh })),
    records: [
      { name: 'parkbencha01', instance: 5 },
      ...names.map((name, i) => ({ name, instance: i })),
    ],
  }
}

describe('the sky in a map chunk', () => {
  it('names the pictures of the five sky objects, once each and in order', () => {
    const ch = readChunk(buildChunk(skyChunk()))
    expect(skyTextureNames(ch)).toEqual(['moon.tga', 'test_sphere_N.tgn', 'cf_ring_glow.tga', 'shd_stars.tga', 'ds_grad_blk.tga', 'cloud_sparse_hz.tga'])
  })
  it('refuses a chunk without the whole sky', () => {
    expect(() => skyTextureNames(readChunk(buildChunk(skyChunk(SKY_OBJECTS.slice(0, 4)))))).toThrow(/no sky/)
  })
})

/** A texture file's head: 'VKEG', the entry count at 16, 72-byte entries from 0x18 (offset, name at +23, size at +0x34). */
function pegHead(entries: { name: string; offset: number; size: number }[], cut = 0): Uint8Array {
  const b = new Uint8Array(0x18 + 0x48 * entries.length)
  const dv = new DataView(b.buffer)
  b.set([0x56, 0x4b, 0x45, 0x47])
  dv.setUint16(16, entries.length)
  entries.forEach((e, i) => {
    const o = 0x18 + 0x48 * i
    dv.setUint32(o, e.offset)
    for (let k = 0; k < e.name.length; k++) b[o + 23 + k] = e.name.charCodeAt(k)
    dv.setUint32(o + 0x34, e.size)
  })
  return cut ? b.subarray(0, cut) : b
}

describe('the sky pictures in a texture file', () => {
  const head = pegHead([
    { name: 'bench_wo.tga', offset: 4096, size: 100 },
    { name: 'moon.tga', offset: 8192, size: 300 },
    { name: 'test_sphere_n.tgn', offset: 12288, size: 50 },
    { name: 'alias.tga', offset: 8192, size: 0 },
    { name: 'moon.tga', offset: 16384, size: 20 },
  ])
  it('picks the entries with pixels, matching names without case, first one only', () => {
    const picks = pegPicks(head, ['moon.tga', 'test_sphere_N.tgn', 'alias.tga', 'ds_grad_blk.tga'])
    expect('need' in picks).toBe(false)
    if ('need' in picks) return
    expect(picks.map((p) => [p.name, p.offset, p.size])).toEqual([['moon.tga', 8192, 300], ['test_sphere_n.tgn', 12288, 50]])
    expect(picks[0].entry.length).toBe(0x48)
  })
  it('asks for more of the head when it is cut short', () => {
    expect(pegPicks(head.subarray(0, 100), ['moon.tga'])).toEqual({ need: 0x18 + 0x48 * 5 })
    expect(() => pegPicks(new Uint8Array(32), [])).toThrow(/not a texture file/)
  })
  it('hands the exporter the chunk, the pictures and their list', () => {
    const files = skyDonorFiles({ chunk: new Uint8Array([1, 2]), pictures: [{ name: 'moon.tga', entry: new Uint8Array(0x48).fill(7), data: new Uint8Array(300) }], shared: ['ds_grad_blk.tga'] })
    expect(files.map((f) => f.path)).toEqual([`${SKY_SOURCE}.bbchunk_xbox2`, 'native_sky/texture_00.bin', 'native_sky/textures.json'])
    const list = JSON.parse(new TextDecoder().decode(files[2].data))
    expect(list.textures).toEqual([{ name: 'moon.tga', entry: '07'.repeat(0x48), file: 'texture_00.bin', bytes: 300 }])
    expect(list.shared).toEqual(['ds_grad_blk.tga'])
  })
})

describe('the setting', () => {
  it('is on by default, off when turned off or with a native sky preset', () => {
    expect(gameSkyWanted(defaultSettings())).toBe(true)
    expect(gameSkyWanted({ ...defaultSettings(), game_sky: false })).toBe(false)
    expect(gameSkyWanted({ ...defaultSettings(), native_sky: 'sr_custom000001' })).toBe(false)
  })
  it('the checklist still suggests a fallback sky picture', () => {
    const p = newProject()
    p.scene_items.push({ uid: 'a', name: 'Ground', path: '/work/x.obj', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: {}, alpha: {} })
    expect(mapChecklist(p, true).find((i) => i.id === 'sky')?.text).toMatch(/fallback sky picture/)
    p.settings.game_sky = false
    expect(mapChecklist(p, true).find((i) => i.id === 'sky')?.text).toMatch(/black overhead/)
  })
})

describe("the editor's stand-in sky", () => {
  it('has the same clouds every walk, most of them low over the horizon', () => {
    const a = skyPuffs(), b = skyPuffs()
    expect(a).toEqual(b)
    expect(a.every((p) => p.elevation > 0 && p.elevation < 50 && p.x >= 0 && p.x < 1 && p.alpha > 0 && p.alpha <= 1)).toBe(true)
    expect(a.filter((p) => p.elevation < 14).length / a.length).toBeGreaterThan(0.8)
  })
})

// ---------------- a local game install ----------------

const GAME = process.env.SR1_PACKFILES || 'C:/Games/SaintsReborn/dist/game/packfiles'
const haveGame = existsSync(join(GAME, 'mp_city_stream.vpp_xbox2'))

describe.skipIf(!GAME_TESTS || !haveGame)("the game's sky from a local game install", () => {
  it('reads mp_bac_01: five sky objects, ten pictures in its texture file and one the game keeps loaded', async () => {
    const vpp = await openVpp(await openAsBlob(join(GAME, 'mp_city_stream.vpp_xbox2')), 'mp_city_stream')
    const t0 = performance.now()
    const files = await skyFilesFrom(vpp)
    console.log(`read the sky in ${((performance.now() - t0) / 1000).toFixed(1)} s`)
    expect(files).not.toBeNull()
    if (!files) return
    expect(files.pictures.map((p) => p.name.toLowerCase()).sort()).toEqual(['cf_ring_glow.tga', 'cloud_cirrus_01.tga', 'cloud_hz_noise.tga',
      'cloud_msk_noise.tga', 'cloud_sparse_hz.tga', 'missing-black.tga', 'moon.tga', 'shd_noise_sph.tga', 'shd_stars.tga', 'test_sphere_n.tgn'])
    expect(files.shared).toEqual(['ds_grad_blk.tga'])
    expect(files.pictures.every((p) => p.data.length > 0 && p.data.some((x) => x !== 0))).toBe(true)
    // The other retail maps with an outdoor sky carry the same objects.
    for (const m of ['mp_bac_03', 'mp_bor_02', 'mp_coop_delivery']) {
      expect(skyTextureNames(readChunk(await vpp.read(m + '.bbchunk_xbox2'))).length, m).toBe(11)
    }
    const out = process.env.SR1_GAME_SKY_OUT
    if (out) for (const f of skyDonorFiles(files)) {
      mkdirSync(dirname(join(out, f.path)), { recursive: true })
      writeFileSync(join(out, f.path), f.data)
    }
  }, 300_000)
})
