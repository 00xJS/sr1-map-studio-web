// The Stilwater study (src/lib/gameObjects/cityStudy.ts): finding what the city keeps placing together and cutting
// its buildings out as modules, checked on made-up placements and a small built chunk (no game data). The real city
// is checked in the last block, on a local install (npm run test:game).
import { describe, expect, it } from 'vitest'
import { existsSync, openAsBlob } from 'node:fs'
import { join } from 'node:path'
import { GAME_TESTS } from './testMode'
import { City, cutModules, findGroups, readSide, LINES, STEPS, local, studyCity, type CityData, type Cover, type Spot } from '../src/lib/gameObjects/cityStudy'
import { cityModules, groups } from '../src/lib/gameObjects/cityModules'
import { identify } from '../src/lib/gameObjects/identity'
import { readChunk } from '../src/lib/gameObjects/chunk'
import { indexChunk, mergeCandidates, type Candidate, type GameObjectEntry } from '../src/lib/gameObjects/indexer'
import { openVpp, type Vpp } from '../src/lib/sr1char/vpp'
import { buildChunk, box, yawRot } from './chunkBuilder'

const entry = (id: string, p: Partial<GameObjectEntry>): GameObjectEntry => ({
  id, name: id, cat: '', profile: '', pack: 'sr_city_stream', chunk: 'sr_chunk01', record: 0, size: [1, 1, 1], tris: 10, tex: [], seen: 1, ...p,
})

/** A seeded random number generator (mulberry32). */
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const CHUNK = { pack: 'sr_city_stream', chunk: 'sr_chunk01', districts: ['Downtown'] }
const spot = (id: string, e: GameObjectEntry, x: number, z: number, yaw = 0, y = 0, extra: Partial<Spot> = {}): Spot =>
  ({ id, at: [x, y, z], yaw, ext: [e.size[0], e.size[1]], h: e.size[2], chunk: 0, ...extra })
/** Where a companion stands in the world: `o` in the frame of something at (x, z) turned `yaw`. */
const place = (x: number, z: number, yaw: number, o: [number, number]) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [x + o[0] * c - o[1] * s, z + o[0] * s + o[1] * c] }

const props = {
  bench: entry('bench', { name: 'benchparka', size: [2, 0.6, 0.9] }),
  can: entry('can', { name: 'trashcana', size: [0.7, 0.7, 1] }),
  stop: entry('stop', { name: 'busstopa', size: [4.6, 2.6, 3.2] }),
  sign: entry('sign', { name: 'streetsigna', size: [0.4, 0.1, 2.8] }),
  news: entry('news', { name: 'newsstanda', size: [0.6, 0.6, 1.4] }),
  dump: entry('dump', { name: 'dumpsterbluea', size: [2.1, 1.9, 1.7] }),
  bags: entry('bags', { name: 'trashbaga', size: [0.8, 0.7, 0.7] }),
  barrel: entry('barrel', { name: 'barrelc', size: [0.8, 0.75, 1.05] }),
  crate: entry('crate', { name: 'cratea', size: [1.2, 1.2, 1.1] }),
}

describe('groups: what the city keeps placing together', () => {
  it('finds a fixed arrangement among scattered props, in the frame and turns of the city', () => {
    const r = rng(7)
    const spots: Spot[] = []
    // Twelve benches, each with a trash can 1.8 m to its right turned a quarter: the same arrangement every time.
    for (let i = 0; i < 12; i++) {
      const x = i * 40 + r() * 10, z = r() * 200, yaw = r() * 6.28
      spots.push(spot('bench', props.bench, x, z, yaw))
      const [cx, cz] = place(x, z, yaw, [1.8, 0.2])
      spots.push(spot('can', props.can, cx, cz, yaw + Math.PI / 2))
    }
    // Barrels and crates scattered about, near nothing in particular.
    for (let i = 0; i < 60; i++) spots.push(spot(r() < 0.5 ? 'barrel' : 'crate', r() < 0.5 ? props.barrel : props.crate, r() * 500, r() * 200, r() * 6.28))
    const city = new City(Object.values(props), { chunks: [CHUNK], spots, covers: new Map() })
    const found = findGroups(city).map((f) => f.group)
    const g = found.find((x) => x.parts.some((p) => p.id === 'bench') && x.parts.some((p) => p.id === 'can'))!
    expect(g).toBeDefined()
    expect(g).toMatchObject({ name: 'Bench with trash can', kind: 'street', anchor: 'ground' })
    expect(g.arrangement).toBeUndefined()
    expect(g.seen).toBe(12)
    expect(g.examples.length).toBeGreaterThan(0)
    // Where the can stands in the bench's own frame, and how it is turned against it.
    const b = g.parts.find((p) => p.id === 'bench')!, c = g.parts.find((p) => p.id === 'can')!
    const o = local([c.at[0] - b.at[0], 0, c.at[2] - b.at[2]], (b.yaw * Math.PI) / 180)
    expect(o[0]).toBeCloseTo(1.8, 1)
    expect(o[2]).toBeCloseTo(0.2, 1)
    expect(((c.yaw - b.yaw) % 360 + 360) % 360).toBe(90)
    // The frame sits in the middle of the group's footprint, which holds every part.
    expect(Math.abs(b.at[0] + c.at[0])).toBeLessThan(g.size[0])
    // Nothing scattered at random makes a group.
    expect(found.filter((x) => x.parts.every((p) => p.id === 'barrel' || p.id === 'crate'))).toEqual([])
  })

  it('finds things that stand together where their arrangement varies, and gives one real example', () => {
    const r = rng(11)
    const spots: Spot[] = []
    // Bus stops with their sign at one end or the other, a little in front or behind (as Stilwater's are), a
    // newspaper box now and then.
    for (let i = 0; i < 14; i++) {
      const x = i * 50, z = r() * 100, yaw = r() * 6.28
      spots.push(spot('stop', props.stop, x, z, yaw))
      const [sx, sz] = place(x, z, yaw, [(i % 2 ? 1 : -1) * (2.5 + r()), 0.5 + r() * 2])
      spots.push(spot('sign', props.sign, sx, sz, yaw + (r() - 0.5)))
      if (i % 3 === 0) { const [nx, nz] = place(x, z, yaw, [r() * 4 - 2, -2]); spots.push(spot('news', props.news, nx, nz, r() * 6)) }
    }
    for (let i = 0; i < 300; i++) spots.push(spot(r() < 0.5 ? 'barrel' : 'crate', r() < 0.5 ? props.barrel : props.crate, r() * 700, r() * 100, r() * 6.28))
    const city = new City(Object.values(props), { chunks: [CHUNK], spots, covers: new Map() })
    const found = findGroups(city).map((f) => f.group)
    const g = found.find((x) => x.parts.some((p) => p.id === 'stop') && x.parts.some((p) => p.id === 'sign'))!
    expect(g).toMatchObject({ arrangement: 'varies', kind: 'street', name: 'Bus stop with street sign' })
    expect(g.seen).toBe(14)
    // The example is a real one: the sign 2.5-3.5 m to one side of the shelter.
    const s = g.parts.find((p) => p.id === 'stop')!, n = g.parts.find((p) => p.id === 'sign')!
    const o = local([n.at[0] - s.at[0], 0, n.at[2] - s.at[2]], (s.yaw * Math.PI) / 180)
    expect(Math.abs(o[0])).toBeGreaterThan(2.4)
    expect(Math.abs(o[0])).toBeLessThan(3.6)
    expect(o[2]).toBeGreaterThan(0.4)
  })

  it('tells groups that back onto a wall, and which of their sides does', () => {
    const building = entry('shop', { name: 'shop1a', cat: 'Buildings', parts: [0, 1, 2], size: [20, 10, 12], tex: ['b11_brick_co.tga'] })
    const spots: Spot[] = []
    for (let i = 0; i < 8; i++) {
      // A building 20 m along x, 10 m deep; a dumpster with bags at its +z wall, their backs (-z) against it.
      const bx = i * 60, bz = 0
      spots.push(spot('shop', building, bx, bz, 0, 0, { ext: [20, 10], site: { climbs: [], decks: [] } }))
      spots.push(spot('dump', props.dump, bx - 3 + i * 0.5, bz + 5 + 0.95, 0))
      spots.push(spot('bags', props.bags, bx - 3 + i * 0.5 + 1.6, bz + 5 + 0.4, 0))
    }
    const city = new City([...Object.values(props), building], { chunks: [CHUNK], spots, covers: new Map() })
    const g = findGroups(city).map((f) => f.group).find((x) => x.parts.some((p) => p.id === 'dump'))!
    expect(g).toMatchObject({ name: 'Dumpster with trash bags', kind: 'alley', anchor: 'wall', back: '-z' })
  })
})

describe('modules: buildings cut out of the city', () => {
  it('reads what each side of a building meets', () => {
    const lines = (s: string) => s.repeat(LINES)
    expect(readSide(lines('wwwwrrrrrrrrrr'))).toEqual({ kind: 'street', reach: 4 })
    expect(readSide(lines('bbbbbbbbbbbbbb'))).toEqual({ kind: 'wall', reach: 0 })
    expect(readSide(lines('wwwwwwbbbbbbbb'))).toEqual({ kind: 'alley', reach: 3 })
    expect(readSide(lines('wwrrrrrrrbbbbb')).kind).toBe('street')
    expect(readSide(lines('wgggggggggggggg'.slice(0, STEPS)))).toEqual({ kind: 'yard', reach: 4 })
    expect(readSide(lines('wwwaaaaaaaaaaa')).kind).toBe('water')
    expect(readSide(lines('w'.repeat(STEPS)))).toEqual({ kind: 'sidewalk', reach: 8 })
    expect(readSide(lines('-'.repeat(STEPS))).kind).toBe('open')
  })

  /**
   * A shop 20 m along x and 10 m deep with a 4 m sidewalk then road at its front (-z), a neighbour against its +x
   * side and a fenced lawn behind (+z).
   */
  function street() {
    const shop = entry('shop', { name: 'shop1a', cat: 'Buildings', parts: [0, 1, 2], size: [20, 10, 12], tex: ['b11_brick_co.tga'], tris: 500, layout: [] })
    const next = entry('next', { name: 'shop2b', cat: 'Buildings', parts: [0, 1, 2], size: [12, 10, 15], tex: ['b12_brick_co.tga'], tris: 400 })
    const awning = entry('awning', { name: 'awninga', size: [6, 1.5, 0.8], kitOf: 'shop1a', belongsTo: ['shop'] })
    const neon = entry('neon', { name: 'neonsigna', size: [2, 0.2, 1] })
    const ac = entry('ac', { name: 'acunita', size: [1.2, 1, 1] })
    const walk = entry('walk', { name: 'sidewalktile', size: [40, 4, 0.2] })
    const road = entry('road', { name: 'road_a', size: [40, 12, 0.1] })
    const lawn = entry('lawn', { name: 'lawna', size: [40, 10, 0.1] })
    const fence = entry('fence', { name: 'fencechaina', size: [4, 0.12, 2.4], raw: ['2fenceChainA19'], tex: ['Galv_Met.tga', 'cc_chainlinkA_fm.tga'] })
    const all = [shop, next, awning, neon, ac, walk, road, lawn, fence, ...Object.values(props)]
    const cover = (w: number, d: number, letter: string): Cover => ({ cell: 1, x0: -w / 2, z0: -d / 2, w, d, rows: letter.repeat(w * d), lo: 0, hi: 0.1 })
    const covers = new Map([['walk', cover(40, 4, 'w')], ['road', cover(40, 12, 'r')], ['lawn', cover(40, 10, 'g')]])
    const site = { climbs: [{ kind: 'stairs' as const, at: [9, 0, 3] as [number, number, number], top: 4.2 }], decks: [{ y: 4, area: 40 }, { y: 12, area: 200 }] }
    const spots: Spot[] = [
      spot('shop', shop, 0, 0, 0, 0, { ext: [20, 10], site }),
      spot('next', next, 16, 0, 0, 0, { ext: [12, 10], site: { climbs: [], decks: [] } }),
      spot('awning', awning, 0, -5.2, 0, 3),
      spot('neon', neon, -6, -5.1, 0, 4),
      spot('ac', ac, 3, 1, 0, 12),
      spot('walk', walk, 0, -7, 0, 0),
      spot('road', road, 0, -15, 0, -0.15),
      spot('lawn', lawn, 0, 10, 0, 0),
      spot('bench', props.bench, -4, -7.5, 0, 0),
      spot('can', props.can, -2, -7.5, 1.57, 0),
      // A fence closing most of the back (+z) side, a 4 m gap at its -x end.
      spot('fence', fence, -2, 7.5, 0), spot('fence', fence, 2, 7.5, 0), spot('fence', fence, 6, 7.5, 0),
    ]
    return { all, data: { chunks: [CHUNK], spots, covers } as CityData }
  }

  it('cuts a building out with its kit, its details, its sidewalk and props, in its own frame', () => {
    const { all, data } = street()
    const mods = cutModules(new City(all, data))
    const m = mods.find((x) => x.parts.some((p) => p.layer === 'shell' && p.id === 'shop'))!
    expect(m).toBeDefined()
    const layer = (id: string) => m.parts.find((p) => p.id === id)?.layer
    expect(layer('shop')).toBe('shell')
    expect(layer('awning')).toBe('kit')
    expect(layer('neon')).toBe('detail')
    expect(layer('ac')).toBe('detail')
    expect(layer('bench')).toBe('prop')
    expect(layer('can')).toBe('prop')
    expect(layer('fence')).toBe('fence')
    // The neighbour is not part of it.
    expect(layer('next')).toBeUndefined()
    // Front: 4 m of sidewalk then road, so the module reaches the kerb; +x: a shared wall; +z: the yard.
    const edge = (s: string) => m.edges.find((e) => e.side === s)!
    expect(edge('-z').kind).toBe('street')
    expect(edge('+x').kind).toBe('wall')
    expect(edge('+x').openings).toEqual([])
    expect(edge('+z').kind).toBe('yard')
    expect(m.source.rect[1]).toBeCloseTo(-9, 0)
    expect(m.source.rect[2]).toBeCloseTo(10, 0)
    expect(m.kind).toBe('block')
    // Frame: the middle of the cut, the building's feet at 0; the bench where it stands, relative to that.
    const bench = m.parts.find((p) => p.id === 'bench')!
    const cx = (m.source.rect[0] + m.source.rect[2]) / 2, cz = (m.source.rect[1] + m.source.rect[3]) / 2
    expect(bench.at).toEqual([-4 - cx, 0, -7.5 - cz].map((v) => Math.round(v * 100) / 100))
    expect(m.size).toEqual([m.source.rect[2] - m.source.rect[0], m.source.rect[3] - m.source.rect[1]].map((v) => Math.round(v * 100) / 100))
    // The fence leaves its gap open on the back side: players pass there.
    const back = edge('+z')
    expect(back.openings.length).toBeGreaterThan(0)
    expect(back.openings.some((o) => o.width >= 2)).toBe(true)
    expect(m.entrances.length).toBe(m.edges.reduce((s, e) => s + e.openings.length, 0))
    // Levels: the walkway at 4 m by its stairs, the roof fenced off.
    expect(m.levels).toEqual([{ height: 4, reach: 'stairs' }, { height: 12, reach: 'none' }])
    expect(m.tris).toBe(m.parts.reduce((s, p) => s + all.find((e) => e.id === p.id)!.tris, 0))
    expect(m.district).toBe('Downtown')
    expect(m.settings).toContain('downtown')
    expect(m.name).toMatch(/on the street/)
  })

  it('rides on the library entries, and the contract gives it back', () => {
    const { all, data } = street()
    studyCity(all, data)
    const mods = cityModules(all)
    expect(mods.length).toBeGreaterThan(0)
    expect(all.find((e) => e.id === 'shop')!.modules!.length).toBeGreaterThan(0)
    // Only modules whose every part the caller has.
    expect(cityModules(all.filter((e) => e.id !== 'bench')).some((m) => m.parts.some((p) => p.id === 'shop'))).toBe(false)
    expect(Array.isArray(groups(all))).toBe(true)
  })
})

describe('reading a city chunk for the study', () => {
  it('keeps where each model stands, the ground it is made of and how a building is climbed', () => {
    const flat = (w: number, d: number) => ({ verts: [[-w / 2, 0, -d / 2, 0, 0], [w / 2, 0, -d / 2, 1, 0], [-w / 2, 0, d / 2, 0, 1], [w / 2, 0, d / 2, 1, 1]], indices: [0, 1, 2, 3] })
    /** Steps: `n` treads 0.3 m deep and 0.2 m up each, 1.2 m wide, as separate flat strips. */
    const steps = (n: number) => {
      const verts: number[][] = [], indices: number[] = []
      for (let i = 0; i < n; i++) {
        const y = 0.2 * (i + 1), z = 0.3 * i, b = verts.length
        verts.push([-0.6, y, z, 0, 0], [0.6, y, z, 1, 0], [-0.6, y, z + 0.3, 0, 1], [0.6, y, z + 0.3, 1, 1])
        if (i) indices.push(indices[indices.length - 1], b)
        indices.push(b, b + 1, b + 2, b + 3)
      }
      return { verts, indices }
    }
    const ch = readChunk(buildChunk({
      strings: ['ter_sidewalk_co.tga', 'b11_brick_co.tga', 'bench_wo.tga'],
      vbs: [flat(20, 10), box(8, 6, 6), flat(8, 6), steps(12), box(2, 1, 0.6)],
      materials: [[0], [1], [2]],
      meshes: [
        { subs: [{ vb: 0, batches: [[0, 4, 0]] }] },
        { subs: [{ vb: 1, batches: [[0, 10, 1]] }] },
        { subs: [{ vb: 2, batches: [[0, 4, 1]] }] },
        { subs: [{ vb: 3, batches: [[0, 12 * 4 + 11 * 2, 1]] }] },
        { subs: [{ vb: 4, batches: [[0, 10, 2]] }] },
      ],
      instances: [
        { pos: [0, 0, -12], mesh: 0 },
        { pos: [0, 0, 0], mesh: 1 },
        { pos: [0, 6, 0], mesh: 2 },
        { pos: [3, 0, -3.5], mesh: 3 },
        { pos: [5, 0, -12], rot: yawRot(30), mesh: 4 },
        { pos: [-5, 0, -12], mesh: 4 },
      ],
      records: [
        { name: 'sidewalk01', instance: 0 },
        { name: 'shop1a_walls', instance: 1, profile: 'Default' },
        { name: 'shop1a_roof', instance: 2, profile: 'Default' },
        { name: 'shop1a_steps01', instance: 3, profile: 'Default' },
        { name: 'parkbencha01', instance: 4, profile: 'Park Bench', shape: 3 },
        { name: 'parkbencha02', instance: 5, profile: 'Park Bench', shape: 3 },
      ],
    }))
    const cs = indexChunk(ch, 'sr_city_stream', 'sr_chunk01')
    const bench = cs.find((c) => c.name === 'parkbencha')!
    expect(bench.spots).toHaveLength(8)
    expect(bench.foot).toEqual([2, 0.6])
    expect(bench.spots!.slice(0, 3)).toEqual([5, 0, -12])
    expect(Math.abs(bench.spots![3])).toBeCloseTo(Math.PI / 6, 2)
    const walk = cs.find((c) => c.name === 'sidewalk')!
    expect(identify(walk).role).toBe('ground')
    expect(walk.cover).toMatchObject({ cell: 1, w: 21, d: 11 })
    expect(walk.cover!.rows.replace(/\./g, '')).toMatch(/^w+$/)
    expect(walk.cover!.rows.split('w').length - 1).toBeGreaterThan(150)
    const shop = cs.find((c) => c.name === 'shop1a')!
    expect(identify(shop).role).toBe('building')
    expect(shop.sites).toHaveLength(1)
    const site = shop.sites![0]
    // Its steps, by their name and by their treads; its roof, a deck 6 m up.
    expect(site.climbs.some((c) => c.kind === 'stairs' && c.top > 2)).toBe(true)
    expect(site.climbs.filter((c) => c.kind === 'stairs').length).toBeGreaterThanOrEqual(2)
    expect(site.decks).toEqual([{ y: 6, area: 48 }])
    // Merged, the city study runs (one building, nothing to group).
    const lib = mergeCandidates(cs as Candidate[])
    expect(lib.find((e) => e.name === 'shop1a')!.modules?.length).toBe(1)
  })
})

// ---------------- a local game install ----------------

const GAME = process.env.SR1_PACKFILES || 'C:/Games/SaintsReborn/dist/game/packfiles'
const haveGame = existsSync(join(GAME, 'sr_city_stream.vpp_xbox2'))

describe.skipIf(!GAME_TESTS || !haveGame)('Stilwater from a local game install', () => {
  it('finds the city’s groups and cuts its buildings out as modules', async () => {
    const packs: [string, Vpp][] = []
    for (const p of ['sr_city_stream', 'mp_city_stream', 'misc2']) if (existsSync(join(GAME, p + '.vpp_xbox2'))) packs.push([p, await openVpp(await openAsBlob(join(GAME, p + '.vpp_xbox2')), p)])
    const all: Candidate[] = [], seen = new Set<string>()
    for (const [p, vpp] of packs) for (const n of vpp.list()) {
      const c = n.replace(/\.bbchunk_xbox2$/i, '')
      if (c === n || seen.has(c.toLowerCase())) continue
      seen.add(c.toLowerCase())
      try { all.push(...indexChunk(readChunk(await vpp.read(n)), p, c)) } catch { /* the one old-version chunk */ }
    }
    const t0 = performance.now()
    const lib = mergeCandidates(all)
    const ms = performance.now() - t0
    const byId = new Map(lib.map((e) => [e.id, e]))
    const name = (id: string) => identify(byId.get(id)!).name
    const gs = groups(lib), mods = cityModules(lib)
    console.log(`study: ${gs.length} groups (${gs.filter((g) => g.arrangement === 'varies').length} varying), ${mods.length} modules; merge with the study ${(ms / 1000).toFixed(1)} s`)

    // Groups: never anything that isn't placed, every part a real entry, and the known street sets among them.
    expect(gs.length).toBeGreaterThan(60)
    for (const g of gs) {
      expect(g.parts.length).toBeGreaterThanOrEqual(2)
      for (const p of g.parts) expect(identify(byId.get(p.id)!).role, g.name).not.toBe('skip')
      expect(g.seen).toBeGreaterThanOrEqual(3)
      expect(g.examples.length).toBeGreaterThan(0)
      expect(g.examples.every((x) => x.pack === 'sr_city_stream')).toBe(true)
    }
    const has = (...names: string[]) => gs.filter((g) => names.every((n) => g.parts.some((p) => name(p.id) === n)))
    // The bus stop: its shelter with its sign or its newspaper boxes.
    expect([...has('Bus stop', 'Street sign'), ...has('Bus stop', 'Newspaper box')].length).toBeGreaterThan(0)
    expect(has('Bench', 'Trash can').length).toBeGreaterThan(0)
    expect(has('Dumpster', 'Trash bags').length).toBeGreaterThan(0)
    expect(has('Parking meter', 'Parking block').length).toBeGreaterThan(0)
    expect(gs.filter((g) => g.kind === 'industrial').length).toBeGreaterThan(5)

    // Modules: most buildings of the streets cut out, every district, each with its shell, sensible edges and size.
    expect(mods.length).toBeGreaterThan(600)
    const districts = new Set(mods.map((m) => m.district))
    for (const d of ["Saint's Row", 'Downtown', 'Suburbs', 'Docks', 'Barrio', 'Chinatown', 'Projects', 'Red Light']) expect(districts, d).toContain(d)
    for (const m of mods) {
      const shells = m.parts.filter((p) => p.layer === 'shell')
      expect(shells).toHaveLength(1)
      expect(identify(byId.get(shells[0].id)!).role).toBe('building')
      expect(m.edges.map((e) => e.side).sort()).toEqual(['+x', '+z', '-x', '-z'])
      const b = byId.get(shells[0].id)!
      expect(Math.max(...m.size)).toBeGreaterThanOrEqual(b.size[0] - 0.1)
      for (const p of m.parts) expect(identify(byId.get(p.id)!).role).not.toBe('skip')
      for (const e of m.edges) for (const o of e.openings) expect(Math.abs(o.at) + o.width / 2).toBeLessThanOrEqual((e.side[1] === 'x' ? m.size[1] : m.size[0]) / 2 + 0.6)
    }
    const kinds = new Set(mods.map((m) => m.kind))
    for (const k of ['block', 'corner', 'landmark', 'yard']) expect(kinds).toContain(k)
    expect(mods.filter((m) => m.edges.some((e) => e.kind === 'street')).length).toBeGreaterThan(mods.length / 2)
    expect(mods.filter((m) => m.parts.some((p) => p.layer === 'kit')).length).toBeGreaterThan(100)
    // Some upper floors are reached by stairs (walkways of apartment blocks), most roofs are not.
    expect(mods.filter((m) => m.levels.some((l) => l.height >= 2.5 && l.reach === 'stairs')).length).toBeGreaterThan(10)
  }, 900_000)
})
