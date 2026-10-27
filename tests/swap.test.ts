// The object swapper's choices (src/lib/gameObjects/swap.ts) on made-up library entries and prefab sizes: other art
// first, then other versions, the same kind, then anything that fits the footprint; never parts, decals or railings.
import { describe, expect, it } from 'vitest'
import { fitTurn, prefabBox, stemOf, swapOptions, swapPool, swapPrefabs, type SwapPrefab, type SwapSpot } from '../src/lib/gameObjects/swap'
import type { GameObjectEntry } from '../src/lib/gameObjects/indexer'

const entry = (name: string, size: [number, number, number], more: Partial<GameObjectEntry> = {}): GameObjectEntry =>
  ({ id: name, name, cat: '', profile: '', pack: 'sr_city_stream', chunk: 'c', record: 0, size, tris: 200, tex: [name + '_co.tga'], seen: 5, ...more })

const bench = entry('bench01a', [2, 0.7, 1])
const lib = [
  bench,
  // The same bench in red: same size and triangles, other pictures.
  entry('bench01b', [2, 0.7, 1], { tex: ['benchred_co.tga'] }),
  // Another bench, a little longer.
  entry('bench02a', [2.3, 0.7, 1.05], { tris: 340 }),
  // A copy of the first one from a multiplayer map: the same look, never offered.
  entry('mp_bench', [2, 0.7, 1], { tex: ['bench01a_co.tga'], where: ['mp_bac_01'] }),
  // Other street furniture about its size, a crate that fits, and a container that doesn't.
  entry('planter01', [1.9, 0.6, 0.9], { tris: 120 }),
  entry('newsbox01', [0.6, 0.5, 1.1], { tris: 90 }),
  entry('crate01', [1.8, 0.65, 0.9], { tris: 12 }),
  entry('container01', [12, 2.4, 2.6], { tris: 600 }),
  // Never on their own: a stair rail, a graffiti layer, a trailer's door.
  entry('railing01', [2, 0.1, 1]),
  entry('fnorhpr1a', [2, 0.2, 1], { tex: ['B46_Graf1.tga'] }),
  entry('husk_door01', [2, 0.1, 1]),
]
const pool = swapPool(lib)
const spotOf = (e: GameObjectEntry): SwapSpot => ({ long: e.size[0], short: e.size[1], h: e.size[2], label: e.name, entry: e })

describe('object swapper', () => {
  it('names models without their copy numbers and variant letters', () => {
    expect(stemOf('14mailboxA01')).toBe('mailbox')
    expect(stemOf('mailbox_b')).toBe('mailbox')
    expect(stemOf('bench01a')).toBe('bench')
    expect(stemOf('dumpster')).toBe('dumpster')
    expect(stemOf('slab')).toBe('slab')
  })

  it('offers only whole things that stand alone, one of each look', () => {
    const ids = pool.map((m) => m.e.id)
    expect(ids).not.toContain('railing01')
    expect(ids).not.toContain('fnorhpr1a')
    expect(ids).not.toContain('husk_door01')
    // The city's own copy, not the multiplayer map's.
    expect(ids).toContain('bench01a')
    expect(ids).not.toContain('mp_bench')
  })

  it('ranks other art, then other versions, then the same kind, then whatever fits', () => {
    const opts = swapOptions(spotOf(bench), { models: pool })
    const at = (id: string) => opts.findIndex((o) => o.key === 'game:' + id)
    expect(opts[0]).toMatchObject({ key: 'game:bench01b', why: 'art' })
    expect(opts.find((o) => o.key === 'game:bench02a')?.why).toBe('version')
    expect(opts.find((o) => o.key === 'game:planter01')?.why).toBe('kind')
    expect(at('bench01b')).toBeLessThan(at('bench02a'))
    expect(at('bench02a')).toBeLessThan(at('planter01'))
    // Not the bench itself or its copy; nothing too big; nothing much smaller than the spot.
    for (const id of ['bench01a', 'mp_bench', 'container01', 'newsbox01', 'railing01']) expect(at(id)).toBe(-1)
  })

  it('offers other shapes when they fit the footprint and height', () => {
    const crate = entry('crate02', [1.8, 0.65, 0.9], { tris: 12, tex: ['crate02_co.tga'] })
    const opts = swapOptions(spotOf(crate), { models: pool })
    // Another crate-sized crate is the same kind; the planter fits the spot though it is another kind of thing.
    expect(opts.find((o) => o.key === 'game:crate01')?.why).toBe('art')
    expect(opts.find((o) => o.key === 'game:planter01')?.why).toBe('fits')
    expect(opts.find((o) => o.key === 'game:bench01a')).toBeUndefined()
  })

  it('swaps a site prefab for prefabs of its category and game models of its kind', () => {
    const prefabs: SwapPrefab[] = [
      { key: 'bench', label: 'Park bench', category: 'Street', long: 2, short: 0.7, h: 1 },
      { key: 'picnic', label: 'Picnic table', category: 'Street', long: 2.2, short: 0.9, h: 0.8 },
      { key: 'crates', label: 'Crates', category: 'Cover', long: 1.9, short: 0.7, h: 0.95 },
      { key: 'tower', label: 'Watch tower', category: 'Military', long: 4, short: 4, h: 9 },
    ]
    const spot: SwapSpot = { long: 2, short: 0.7, h: 1, label: 'Park bench', prefab: 'bench' }
    const opts = swapOptions(spot, { models: pool, prefabs })
    expect(opts.some((o) => o.key === 'prefab:bench')).toBe(false)
    expect(opts.find((o) => o.key === 'prefab:picnic')?.why).toBe('kind')
    expect(opts.find((o) => o.key === 'prefab:crates')?.why).toBe('fits')
    expect(opts.some((o) => o.key === 'prefab:tower')).toBe(false)
    // The game's benches are the same kind of thing as the site's bench, ahead of what merely fits.
    const kinds = opts.filter((o) => o.why === 'kind').map((o) => o.key)
    expect(kinds).toEqual(expect.arrayContaining(['game:bench01a', 'game:bench01b', 'prefab:picnic']))
    expect(opts.findIndex((o) => o.key === 'game:bench01a')).toBeLessThan(opts.findIndex((o) => o.key === 'prefab:crates'))
  })

  it('offers site prefabs for a game model: a placed game bench can become the site bench', () => {
    const prefabs: SwapPrefab[] = [{ key: 'bench', label: 'Park bench', category: 'Street', long: 2.1, short: 0.75, h: 1 }]
    expect(swapOptions(spotOf(bench), { models: pool, prefabs }).find((o) => o.key === 'prefab:bench')?.why).toBe('kind')
  })

  it('a shape is swapped for whatever fits it', () => {
    const opts = swapOptions({ long: 2, short: 0.7, h: 1, label: 'Box' }, { models: pool })
    expect(opts.length).toBeGreaterThan(0)
    expect(opts.every((o) => o.why === 'fits')).toBe(true)
  })

  it('turns the new thing so its long side goes the way the old one did', () => {
    // An old thing long along X at 30°; a new one long along Z goes in turned a quarter more.
    expect(fitTurn(4, 1, 30, 1, 4)).toBe(120)
    expect(fitTurn(4, 1, 30, 4, 1)).toBe(30)
    // A square one keeps the heading.
    expect(fitTurn(4, 1, 30, 2, 2)).toBe(30)
    expect(fitTurn(1, 4, 300, 4, 1)).toBe(30)
  })

  it('measures the site prefabs', () => {
    const list = swapPrefabs(0.5)
    expect(list.length).toBeGreaterThan(50)
    expect(list.some((p) => p.key === 'road')).toBe(false)
    const box = prefabBox('bench')!
    expect(box.max[0] - box.min[0]).toBeGreaterThan(0)
    for (const p of list) expect(p.long).toBeGreaterThanOrEqual(p.short)
  })
})
