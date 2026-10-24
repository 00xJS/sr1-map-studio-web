// The "From my game" library (src/lib/gameObjects): the chunk reader, the index, cutting one object out and the
// OBJ it is placed as, checked on small chunks built here. The last block indexes a local Saints Reborn install
// when there is one (SR1_PACKFILES, or the default install folder); no game file is copied into the repo.
import { describe, expect, it } from 'vitest'
import { GAME_TESTS } from './testMode'
import { existsSync, mkdirSync, openAsBlob, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readChunk, meshTriangles, meshTriangleCount, meshTextures } from '../src/lib/gameObjects/chunk'
import { indexChunk, mergeCandidates, meshBounds, keyId, type Candidate } from '../src/lib/gameObjects/indexer'
import { extractObject } from '../src/lib/gameObjects/extract'
import { baseName, buildingCode, categoryOf, BUILDINGS, OTHER, skipName } from '../src/lib/gameObjects/classify'
import { chunkPegNames, pegHeadNames, pegHeadSize, shrink, hasAlpha, textureDirectory } from '../src/lib/gameObjects/textures'
import { objText, surfaceOf } from '../src/lib/gameObjects/place'
import { gameObjectPaths } from '../src/lib/gameObjects/policy'
import { showcasePlan } from '../src/lib/hubRules'
import { newProject, type SceneItem } from '../src/lib/project'
import { openVpp, type Vpp } from '../src/lib/sr1char/vpp'
import type { ObjectResult } from '../src/lib/gameObjects/worker'
import { buildChunk, box, yawRot, type Spec } from './chunkBuilder'

const world = (): Spec => ({
  strings: ['bench_wo.tga', 'bench_nm.tgn', 'wall_co.tga'],
  vbs: [box(2, 1, 0.8), box(4, 3, 0.3), { verts: [[0, 0, 0], [9, 9, 9], [1, 0, 0], [0, 1, 0]], indices: [0, 2, 3] }],
  materials: [[1, 0], [2]],
  meshes: [
    { subs: [{ vb: 0, batches: [[0, 10, 0]] }] },
    { subs: [{ vb: 1, batches: [[0, 10, 1]] }] },
    { subs: [{ vb: 2, batches: [[0, 3, 1]] }] },
  ],
  instances: [
    { pos: [10, 0, 10], rot: yawRot(90), mesh: 0 },
    { pos: [20, 0, 10], mesh: 0 },
    { pos: [0, 0, 0], mesh: 1 },
    { pos: [4, 0, 0], mesh: 1 },
    { pos: [0, 3, 0], mesh: 1 },
    { pos: [50, 0, 50], mesh: 2 },
  ],
  records: [
    { name: 'parkbencha01', instance: 0, profile: 'Park Bench', shape: 3 },
    { name: 'ab_parkbencha02', instance: 1, profile: 'Park Bench', shape: 3 },
    { name: 'shop1a_wall01', instance: 2, profile: 'Default' },
    { name: 'shop1a_wall02', instance: 3, profile: 'Default' },
    { name: 'shop1a_roof', instance: 4 },
    { name: 'ter_ground01', instance: 5 },
    { name: 'tri_thing', instance: 5 },
  ],
})

describe('chunk reader', () => {
  const ch = readChunk(buildChunk(world()))

  it('reads strings, instances, geometry and named records', () => {
    expect(ch.strings).toEqual(['bench_wo.tga', 'bench_nm.tgn', 'wall_co.tga'])
    expect(ch.instances).toHaveLength(6)
    expect(ch.instances[1].position).toEqual([20, 0, 10])
    expect(ch.vbs.map((v) => [v.count, v.stride, v.indexCount])).toEqual([[8, 24, 10], [8, 24, 10], [4, 24, 3]])
    expect(ch.materials[0].textures).toEqual(['bench_nm.tgn', 'bench_wo.tga'])
    expect(ch.meshes).toHaveLength(3)
    expect(ch.records.map((r) => [r.name, r.profile, r.shape, r.instance])).toEqual([
      ['parkbencha01', 'Park Bench', 3, 0], ['ab_parkbencha02', 'Park Bench', 3, 1], ['shop1a_wall01', 'Default', -1, 2],
      ['shop1a_wall02', 'Default', -1, 3], ['shop1a_roof', '', -1, 4], ['ter_ground01', '', -1, 5], ['tri_thing', '', -1, 5],
    ])
  })

  it('refuses other files and versions', () => {
    expect(() => readChunk(new Uint8Array(2000))).toThrow(/not a Saints Row map chunk/)
    const b = buildChunk(world()); b[7] = 57
    expect(() => readChunk(b)).toThrow(/version 57/)
  })

  it('decodes strips: degenerate joins dropped, every other triangle turned, only used vertices kept', () => {
    const p = meshTriangles(ch, 0)
    expect(p.triangles.length / 3).toBe(4)
    expect([...p.triangles.slice(0, 6)]).toEqual([0, 1, 2, 2, 1, 3])
    expect(meshTriangleCount(ch, ch.meshes[0])).toBe(4)
    const q = meshTriangles(ch, 2)
    expect(q.positions.length / 3).toBe(3) // the far vertex (9, 9, 9) is not used
    expect(meshBounds(ch, 2)).toEqual({ min: [0, 0, 0], max: [1, 1, 0] })
    expect(meshTextures(ch, ch.meshes[0])).toEqual(['bench_wo.tga'])
    // UVs as stored (v = 0 at the top of the picture)
    expect([...p.uvs.slice(0, 4)]).toEqual([0, 1, 1, 1])
  })
})

describe('library index', () => {
  const ch = readChunk(buildChunk(world()))

  it('finds props, groups building parts and skips terrain', () => {
    const c = indexChunk(ch, 'city', 'c01')
    const bench = c.filter((x) => x.name === 'parkbencha')
    expect(bench).toHaveLength(1)
    expect(bench[0]).toMatchObject({ seen: 2, profile: 'Park Bench', cat: 'Street furniture', physics: true, size: [2, 0.8, 1], tex: ['bench_wo.tga'] })
    const b = c.find((x) => x.cat === BUILDINGS)!
    expect(b).toMatchObject({ name: 'shop1a', parts: [2, 3, 4] })
    expect(b.size[2]).toBe(6) // two storeys of 3 m
    expect(c.some((x) => x.name.startsWith('ter'))).toBe(false)
  })

  it('merges copies across chunks into one entry', () => {
    const a = indexChunk(ch, 'city', 'c01'), b = indexChunk(ch, 'city', 'c02')
    const all = mergeCandidates([...a, ...b])
    const bench = all.filter((e) => e.name === 'parkbencha')
    expect(bench).toHaveLength(1)
    expect(bench[0].seen).toBe(4)
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length)
    expect(keyId('x')).toBe(keyId('x'))
    expect(keyId('x')).not.toBe(keyId('y'))
  })

  it('leaves out one-off pieces with no category or profile', () => {
    const one = { key: 'k', up: 1, id: 'i', name: 'thing', cat: OTHER, profile: '', pack: 'p', chunk: 'c', record: 0, size: [1, 1, 1], tris: 2, tex: [], seen: 1 } as Candidate
    expect(mergeCandidates([one])).toEqual([])
    expect(mergeCandidates([one, { ...one, chunk: 'd' }])).toHaveLength(1)
  })
})

describe('cutting an object out', () => {
  const ch = readChunk(buildChunk(world()))

  it('takes the turn out and stands it on the origin', () => {
    const turned = extractObject(ch, { record: 0 }), straight = extractObject(ch, { record: 1 })
    const ext = (m: Float32Array, k: number) => { let lo = Infinity, hi = -Infinity; for (let i = k; i < m.length; i += 3) { lo = Math.min(lo, m[i]); hi = Math.max(hi, m[i]) } return [lo, hi].map((v) => +v.toFixed(4)) }
    for (const o of [turned, straight]) {
      expect(ext(o.positions, 0)).toEqual([-1, 1])
      expect(ext(o.positions, 1)).toEqual([0, 1])
      expect(ext(o.positions, 2)).toEqual([-0.4, 0.4])
      expect(o.materials).toEqual(['bench_wo.tga'])
    }
  })

  it('keeps building parts where they stand', () => {
    const b = extractObject(ch, { record: 2, parts: [2, 3, 4] })
    expect(b.triangles.length / 3).toBe(12)
    let top = 0
    for (let i = 1; i < b.positions.length; i += 3) top = Math.max(top, b.positions[i])
    expect(top).toBe(6)
  })

  it('writes an OBJ in editor space: X mirrored, scaled, triangles turned back, V from the bottom', () => {
    const mesh = { positions: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), uvs: new Float32Array([0, 0, 1, 0, 0, 0.25]), triangles: new Uint32Array([0, 1, 2]), triMaterial: new Uint16Array([0]), materials: ['a_me.tga'] }
    const text = objText({ mesh, textures: [null] } as ObjectResult, 0.5, ['a_me'], 'test')
    expect(text).toContain('v -2 0 0\nv 0 2 0\nv 0 0 2\n')
    expect(text).toContain('vt 0 1\nvt 1 1\nvt 0 0.75\n')
    expect(text).toContain('usemtl a_me\nf 1/1 3/3 2/2\n')
    expect(surfaceOf('a_me.tga')).toBe(15)
    expect(surfaceOf('plain.tga')).toBe(0)
  })
})

describe('names and categories', () => {
  it('strips copy numbers and short area tags', () => {
    expect(baseName('ab_c09_lampposta12')).toBe('lampposta')
    expect(baseName('21crateb')).toBe('crateb')
    expect(baseName('Bench_02')).toBe('bench')
    expect(baseName('ab_x')).toBe('ab_x')
  })
  it('sorts objects by plain words', () => {
    expect(categoryOf('Streetlight', 'polea')).toBe('Lights and signals')
    expect(categoryOf('Default', 'chainfencea')).toBe('Fences and barriers')
    expect(categoryOf('Default', 'zzz')).toBe(OTHER)
    expect(buildingCode('shop1a_frontdoor01')).toBe('shop1a')
    expect(buildingCode('tower_hull')).toBe('tower')
    expect(buildingCode('crate01')).toBeNull()
    expect(skipName('ter_road01')).toBe(true)
    expect(skipName('bench')).toBe(false)
  })
})

describe('textures', () => {
  it('reads which pictures a texture file holds from its head', () => {
    const head = new Uint8Array(pegHeadSize(2)), dv = new DataView(head.buffer)
    head.set([86, 75, 69, 71]); dv.setUint16(16, 2)
    const name = (i: number, s: string) => [...s].forEach((c, k) => { head[0x18 + 0x48 * i + 23 + k] = c.charCodeAt(0) })
    name(0, 'Real_co.tga'); dv.setUint32(0x18 + 0x34, 4096)
    name(1, 'alias_co.tga') // size 0: only points at another entry's pixels
    expect(pegHeadNames(head)).toEqual({ names: ['real_co.tga'] })
    expect(pegHeadNames(head.subarray(0, 40))).toEqual({ need: pegHeadSize(2) })
    expect(chunkPegNames('city07_al')).toEqual(['city07_al.peg_xbox2', 'city07.peg_xbox2'])
    expect(chunkPegNames('arena_01')).toEqual(['arena_01.peg_xbox2'])
  })
  it('shrinks pictures and tells see-through ones', () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(255)
    for (let i = 3; i < 16; i += 4) rgba[i] = 0
    const img = shrink({ width: 4, height: 4, rgba }, 2)
    expect([img.width, img.height]).toEqual([2, 2])
    expect(hasAlpha({ width: 4, height: 4, rgba })).toBe(true)
    expect(hasAlpha({ width: 4, height: 4, rgba: new Uint8Array(64).fill(255) })).toBe(false)
  })
})

describe('game objects never leave the device', () => {
  const project = () => {
    const p = newProject('t')
    const item = { uid: 'u', name: 'thing', path: '/work/f/h1/thing.obj', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: { a: '/work/f/h2/a.png', b: '/work/f/h3/mine.png' }, alpha: {}, game_object: { source: 'game', pack: 'p', chunk: 'c', record: 1, id: 'x', ws: 0.5 } } as SceneItem
    p.scene_items.push(item)
    p.files = {
      '/work/f/h1/thing.obj': { hash: 'h1', size: 1, name: 'thing.obj', type: 'model/obj', origin: 'game' },
      '/work/f/h2/a.png': { hash: 'h2', size: 1, name: 'a.png', type: 'image/png', origin: 'game' },
      '/work/f/h3/mine.png': { hash: 'h3', size: 1, name: 'mine.png', type: 'image/png', origin: 'user', recipe: { kind: 'library', id: 'x' } },
    }
    return p
  }
  it('backups leave out their files but keep the user\'s own paint', () => {
    expect([...gameObjectPaths(project())].sort()).toEqual(['/work/f/h1/thing.obj', '/work/f/h2/a.png'])
  })
  it('the Showcase refuses them with a clear reason', () => {
    const plan = showcasePlan(project(), new Set(['x']))
    expect(plan.blockers.join(' ')).toMatch(/comes from your Saints Row game files/)
    expect(Object.values(plan.snapshot.files).every((f) => f.origin === 'user')).toBe(true)
  })
})

// ---------------- a local game install ----------------

const GAME = process.env.SR1_PACKFILES || 'C:/Games/SaintsReborn/dist/game/packfiles'
const haveGame = existsSync(join(GAME, 'sr_city_stream.vpp_xbox2'))

describe.skipIf(!GAME_TESTS || !haveGame)('the library from a local game install', () => {
  it('indexes every map chunk and cuts objects out with their textures', async () => {
    const packs: [string, Vpp][] = []
    for (const p of ['sr_city_stream', 'mp_city_stream', 'misc2']) if (existsSync(join(GAME, p + '.vpp_xbox2'))) packs.push([p, await openVpp(await openAsBlob(join(GAME, p + '.vpp_xbox2')), p)])
    const t0 = performance.now()
    const all: Candidate[] = [], failed: string[] = [], seen = new Set<string>()
    let chunks = 0
    for (const [p, vpp] of packs) for (const n of vpp.list()) {
      const c = n.replace(/\.bbchunk_xbox2$/i, '')
      if (c === n || seen.has(c.toLowerCase())) continue
      seen.add(c.toLowerCase())
      chunks++
      try { all.push(...indexChunk(readChunk(await vpp.read(n)), p, c)) } catch (e) { failed.push(c + ': ' + (e as Error).message) }
    }
    const lib = mergeCandidates(all)
    const dir = await textureDirectory(packs)
    const ms = performance.now() - t0
    console.log(`indexed ${chunks} chunks in ${(ms / 1000).toFixed(1)} s: ${lib.length} objects, ${Object.keys(dir.names).length} pictures; ${failed.length} unreadable`)
    expect(failed.length).toBeLessThanOrEqual(2)
    expect(lib.length).toBeGreaterThan(5000)
    expect(lib.filter((e) => e.cat === BUILDINGS).length).toBeGreaterThan(200)
    expect(lib.filter((e) => e.profile).length).toBeGreaterThan(1000)

    // The most used object with a physics profile: cut out, every picture found.
    const top = [...lib].filter((e) => e.profile && e.cat !== OTHER).sort((a, b) => b.seen - a.seen)[0]
    const vpp = packs.find(([p]) => p === top.pack)![1]
    const ch = readChunk(await vpp.read(top.chunk + '.bbchunk_xbox2'))
    const mesh = extractObject(ch, top)
    expect(mesh.triangles.length / 3).toBe(top.tris)
    for (const t of mesh.materials.filter(Boolean)) expect(dir.names[t.toLowerCase()], t).toBeTypeOf('number')

    // For tests/game_objects_check.py (a full export of a game object through the Python exporter).
    const out = process.env.SR1_GAME_OBJECT_OUT
    if (out) {
      mkdirSync(out, { recursive: true })
      const names = mesh.materials.map((_, i) => 'm' + i)
      writeFileSync(join(out, 'object.obj'), objText({ mesh, textures: [] } as unknown as ObjectResult, 0.5, names, 'check'))
      writeFileSync(join(out, 'object.json'), JSON.stringify({ positions: [...mesh.positions], triangles: [...mesh.triangles], materials: names, ws: 0.5 }))
    }
  }, 600_000)
})

describe('item props', () => {
  it('reads item names, categories and flags from an item table', async () => {
    const { parseItems } = await import('../src/lib/gameObjects/items')
    const xml = `<root><Table>
      <Item><Name>flag_a</Name><Mesh><Filename>f.smeshx</Filename><Preload>true</Preload></Mesh><_Editor><Category>Props</Category></_Editor></Item>
      <Item><Name>coin_b</Name><Touch_Script>touch_script_a</Touch_Script><_Editor><Category>Money</Category></_Editor></Item>
      <Item><Name>bad"name</Name></Item>
    </Table></root>`
    expect(parseItems(xml)).toEqual([
      { name: 'flag_a', category: 'Props', preload: true, touch: '' },
      { name: 'coin_b', category: 'Money', preload: false, touch: 'touch_script_a' },
    ])
  })
})
