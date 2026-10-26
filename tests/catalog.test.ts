// The catalogue (src/lib/gameObjects/catalog.ts) and the placeholders beside their game pieces (placeholders.ts),
// on made-up library entries: each side judged from what the library knows, with how sure and why.
import { describe, expect, it } from 'vitest'
import { catalogEntry, catalogue, surfaceName, tally, withCorrections } from '../src/lib/gameObjects/catalog'
import { prefabSize, sameKind, sizeOff } from '../src/lib/gameObjects/placeholders'
import type { GameObjectEntry } from '../src/lib/gameObjects/indexer'

const entry = (name: string, size: [number, number, number], more: Partial<GameObjectEntry> = {}): GameObjectEntry =>
  ({ id: name, name, cat: '', profile: '', pack: 'sr_city_stream', chunk: 'c', record: 0, size, tris: 200, tex: [name + '_co.tga'], seen: 5, ...more })

describe('catalogue', () => {
  it('tells a 3D model from a flat sheet, a line, a stand-in, water and the sky', () => {
    expect(catalogEntry(entry('dumpster', [3.5, 2, 2])).form.value).toBe('model')
    const poster = catalogEntry(entry('poster', [1, 0.01, 0.9]))
    expect(poster.form.value).toBe('flat')
    expect(poster.form.why).toMatch(/thick/)
    expect(catalogEntry(entry('cable', [5.6, 0.03, 0.03])).form.value).toBe('line')
    expect(catalogEntry(entry('shell', [14, 13, 23], { tex: ['proxy01_co.tga'] })).form.value).toBe('invisible')
    expect(catalogEntry(entry('fountain_water', [8, 8, 0], { tex: [] })).form.value).toBe('water')
    expect(catalogEntry(entry('Cloud Layer', [35, 35, 9])).form.value).toBe('sky')
    // A building piece named after the moon is not the sky.
    expect(catalogEntry(entry('moon_wall', [5.8, 0.7, 4])).form.value).toBe('model')
  })

  it('says how a model is put together, from what the game places with it', () => {
    expect(catalogEntry(entry('lamp', [0.5, 0.5, 4], { assembly: [{ id: 'base', at: [0, 0, 0], yaw: 0, share: 0.9 }] })).structure.value).toBe('assembly')
    expect(catalogEntry(entry('base', [0.6, 0.6, 0.3], { partOf: 'lamp' })).structure.value).toBe('part')
    expect(catalogEntry(entry('window', [1, 0.1, 1.5], { kitOf: 'bsad2a', belongsTo: ['b1'] })).structure.value).toBe('kit')
    expect(catalogEntry(entry('crate2', [1, 1, 1], { copyOf: 'crate' })).structure.value).toBe('copy')
    const alone = catalogEntry(entry('bench', [2.6, 0.7, 1]))
    expect(alone.structure.value).toBe('standalone')
    expect(alone.structure.sure).toBeGreaterThan(0.6)
  })

  it('measures it: cover, standing on top, solidity, surfaces', () => {
    const wall = catalogEntry(entry('barrier', [4, 0.8, 1.2]))
    expect(wall.measures.cover.value).toBe('crouch')
    expect(wall.measures.standOn).toBe(false)
    const crate = catalogEntry(entry('crate', [1, 1, 1]))
    expect(crate.measures.standOn).toBe(true)
    const canopy = catalogEntry(entry('canopy', [8, 6, 4], { eye: 0.2 }))
    expect(canopy.measures.cover.value).toBe('none')
    expect(canopy.measures.solid).toBe(0.2)
    expect(catalogEntry(entry('container', [12, 2.5, 2.6], { eye: 0.95 })).measures.cover.value).toBe('stand')
    expect(surfaceName('rusty_metal-01_me.tga')).toBe('Metal Solid')
    expect(surfaceName('nosuffix.tga')).toBe('Concrete')
  })

  it("puts the player's corrections first", () => {
    const c = catalogEntry(entry('thing', [1, 0.01, 1]))
    const fixed = withCorrections(c, { form: 'model', structure: 'part' })
    expect(fixed.form).toEqual({ value: 'model', sure: 1, why: 'Set by you' })
    expect(fixed.structure.value).toBe('part')
    expect(withCorrections(c, { ok: true }).role.sure).toBe(1)
  })

  it('tallies the library by each side', () => {
    const lib = [entry('a', [1, 1, 1]), entry('b', [1, 0.01, 1]), entry('c', [5, 0.03, 0.03])]
    const t = tally(catalogue(lib).values())
    expect(t.form).toEqual({ model: 1, flat: 1, line: 1 })
  })
})

describe('placeholders', () => {
  it('measures the site pieces and how far a game piece is off in size', () => {
    const d = prefabSize('dumpster')!
    expect(d.long).toBeGreaterThan(d.short)
    expect(d.height).toBeGreaterThan(1)
    expect(sizeOff(d, d)).toBe(0)
    expect(sizeOff({ long: d.long * 2, short: d.short, height: d.height }, d)).toBeCloseTo(1, 5)
  })

  it('knows a game piece of the same kind by its name', () => {
    expect(sameKind('tree', 'Tree', ['palm_tree_a', 'Tree'])).toBe(true)
    expect(sameKind('tree', 'Tree', ['rocka', 'Rock'])).toBe(false)
    expect(sameKind('trashbags', 'Trash bags', ['garbagebag_a', 'Trash'])).toBe(true)
  })
})

describe('bases and what stands on them', () => {
  it('calls a model with things on top a base, with its variations, and the things on it "stands on a base"', () => {
    const base = catalogEntry(entry('lamppostornbsea', [0.66, 0.64, 0.35], { seen: 515, tops: [
      { id: 'bannerpolea', n: 170, at: [0, 0.26, 0], yaw: 0 }, { id: 'lamppostorna', n: 139, at: [0, 0.26, 0], yaw: 0 }, { id: 'lamppostflaga', n: 112, at: [0, 0.26, 0], yaw: 0 },
    ] }))
    expect(base.structure.value).toBe('base')
    expect(base.structure.why).toMatch(/3 variations/)
    expect(base.tops!.map((t) => t.id)).toEqual(['bannerpolea', 'lamppostorna', 'lamppostflaga'])
    const post = catalogEntry(entry('lamppostorna', [0.5, 0.5, 4], { seen: 139, bases: [{ id: 'lamppostornbsea', n: 139 }] }))
    expect(post.structure.value).toBe('top')
    expect(post.bases![0].id).toBe('lamppostornbsea')
    // Something on it now and then is no base: a barrel with a poster leaning once.
    expect(catalogEntry(entry('barrel', [0.8, 0.7, 1], { seen: 800, tops: [{ id: 'poster', n: 3, at: [0, 1, 0], yaw: 0 }] })).structure.value).not.toBe('base')
  })
})

describe('what the wizard places', () => {
  it('whole pieces only, a model on a low foot (placed with it), never a bare base, a part or a sheet', async () => {
    const { wizardWhole } = await import('../src/lib/gameObjects/wizardPieces')
    const foot = entry('lampbase', [0.6, 0.6, 0.35], { seen: 100, tops: [{ id: 'lampa', n: 60, at: [0, 0.3, 0], yaw: 0 }, { id: 'lampb', n: 40, at: [0, 0.3, 0], yaw: 0 }] })
    const lamp = entry('lampa', [1.5, 0.5, 5], { seen: 60, bases: [{ id: 'lampbase', n: 60 }] })
    const table = entry('table', [2, 1, 0.9], { seen: 50, tops: [{ id: 'cup', n: 40, at: [0, 0.9, 0], yaw: 0 }] })
    const cup = entry('cup', [0.2, 0.2, 0.15], { seen: 40, bases: [{ id: 'table', n: 40 }] })
    const byId = new Map([foot, lamp, table, cup].map((e) => [e.id, e]))
    const ok = (e: GameObjectEntry) => wizardWhole(catalogEntry(e), e, byId)
    expect(ok(lamp)).toBe(true)
    expect(ok(foot)).toBe(false)
    // A cup lives on a table: not a thing to place by itself, nor with a table under it.
    expect(ok(cup)).toBe(false)
    expect(ok(entry('bench', [2.6, 0.7, 1]))).toBe(true)
    expect(ok(entry('poster', [1, 0.01, 0.9]))).toBe(false)
    expect(ok(entry('panel', [1, 0.3, 1], { partOf: 'lampa' }))).toBe(false)
    expect(ok(entry('window', [1, 0.2, 1.5], { kitOf: 'bsad2a' }))).toBe(false)
  })
})
