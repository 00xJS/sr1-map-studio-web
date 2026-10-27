// The identity of a game model (src/lib/gameObjects/identity.ts): the contract the library and the new-map wizard
// share, and the one rule table behind it. Made-up entries only; the real library is checked in gameObjects.test.ts.
import { describe, expect, it } from 'vitest'
import { CATEGORIES, GENERIC_NAMES, RULE_CATEGORIES, chunkDistricts, identify, parseBuildingCode, pieceName, storeysOf } from '../src/lib/gameObjects/identity'
import { categoryOf } from '../src/lib/gameObjects/classify'
import { displayName } from '../src/lib/gameObjects/tags'
import type { GameObjectEntry } from '../src/lib/gameObjects/indexer'

const entry = (p: Partial<GameObjectEntry>): GameObjectEntry => ({
  id: 'x', name: 'thing', cat: 'Other', profile: '', pack: 'sr_city_stream', chunk: 'c1', record: 0, size: [1, 1, 1], tris: 12, tex: [], seen: 1, ...p,
})
const id = (p: Partial<GameObjectEntry>) => identify(entry(p))

describe('game model identity', () => {
  it('gives every model a role, a name and the settings it suits', () => {
    const barrel = id({ name: 'barrelc', tex: ['barrel_rust_me.tga'], size: [0.8, 0.75, 1.05] })
    expect(barrel).toMatchObject({ role: 'prop', category: 'Containers and crates', name: 'Barrel', kind: 'cover' })
    expect(barrel.settings).toEqual(expect.arrayContaining(['industrial', 'rundown']))
  })

  it('decides role, category and name together, so they always agree', () => {
    // Each name the table gives belongs to one category only.
    for (const [name, cat] of RULE_CATEGORIES) expect(CATEGORIES, name).toContain(cat)
    const cases: [Partial<GameObjectEntry>, string, string, string][] = [
      [{ name: 'parkingblocka', raw: ['2g_parkingBlockA14'], tex: ['postcement_co.tga'], size: [2.3, 0.3, 0.23] }, 'prop', 'Street furniture', 'Parking block'],
      [{ name: 'fencechaina', raw: ['2fenceChainA19'], tex: ['Galv_Met.tga', 'cc_chainlinkA_fm.tga'], size: [4.2, 0.12, 2.4], profile: 'FenceChainlink' }, 'fence', 'Fences and barriers', 'Chain-link fence'],
      [{ name: 'fenceshtmtlta', tex: ['SheetMetalPanel_me.tga'], size: [10, 0.12, 2.7] }, 'fence', 'Fences and barriers', 'Sheet metal fence'],
      [{ name: 'barbwire', record: -5, tex: ['barbwire.tga'], size: [8, 0.6, 0.6] }, 'fence', 'Fences and barriers', 'Barbed wire'],
      [{ name: 'utilitypolea', tex: ['Tele_Pole01_wo.tga'], size: [0.5, 0.5, 9] }, 'prop', 'Street furniture', 'Utility pole'],
      [{ name: 'cinderblocka', tex: ['cindblockA01_co.tga'], size: [0.66, 0.29, 0.31], profile: "Cement Object 1'x1'x1'" }, 'prop', 'Containers and crates', 'Cinder block'],
      [{ name: 'lamppoststa', tex: ['highway-light.tga'], size: [3.9, 0.5, 13.5], profile: 'Streetlight' }, 'prop', 'Lights and signals', 'Street lamp'],
      [{ name: 'trashcand', names: ['trshd'], tex: ['trashcan1_me.tga'], size: [0.75, 0.75, 1.1], profile: 'Trashcan_Anchored' }, 'prop', 'Street furniture', 'Trash can'],
      [{ name: 'stonee', raw: ['RL_cc180Rock24'], tex: ['Ter_cliffrock01_co.tga'], size: [2.7, 2.2, 2.5] }, 'prop', 'Nature', 'Rock'],
      [{ name: 'rtainwalla', tex: ['Ter_Concrete05_co.tga'], size: [5, 0.5, 12] }, 'fence', 'Fences and barriers', 'Retaining wall'],
      [{ name: 'ter_road01', tex: ['Ter_Street01_co.tga'], size: [24, 24, 0.4] }, 'ground', 'Ground and roads', 'Road'],
      [{ name: 'abcd1a_medfront', tex: ['B11_window1_gl.tga'], size: [8, 0.5, 4] }, 'piece', 'Doors and windows', 'Window'],
    ]
    for (const [p, role, category, name] of cases) {
      const got = id(p)
      expect([p.name, got.role, got.category, got.name]).toEqual([p.name, role, category, name])
      expect(RULE_CATEGORIES.get(got.name) ?? got.category).toBe(got.category)
    }
  })

  it('tells a lamp from its base, a fence from its post and foot', () => {
    expect(id({ name: 'lamppoststbsea', tex: ['highway-light.tga', 'conc4_co.tga'], size: [0.65, 0.62, 1.2] })).toMatchObject({ role: 'piece', name: 'Street lamp base' })
    expect(id({ name: 'fencechainbsea', tex: ['Mec_Cement02_co.tga'], size: [0.2, 0.19, 0.38] })).toMatchObject({ role: 'piece', category: 'Fences and barriers', name: 'Chain-link fence base' })
    expect(id({ name: 'fencewdpostd', tex: ['WhiteWood_wo.tga'], size: [0.12, 0.1, 1.3] })).toMatchObject({ role: 'piece', name: 'Fence post' })
    expect(id({ name: 'handrailbar_a', tex: ['I08_metal2bla_me.tga'], size: [0.09, 0.09, 1] })).toMatchObject({ role: 'piece', name: 'Railing post' })
    expect(id({ name: 'trashcanlidf', tex: ['lined_green_me.tga'], size: [0.4, 0.3, 0.2] })).toMatchObject({ role: 'piece', name: 'Trash can lid' })
  })

  it('never places invisible blockers, shadow and low-detail copies, decals, sky or water', () => {
    expect(id({ name: 'blocker', tex: ['missing-alpha.tga'] })).toMatchObject({ role: 'skip', name: 'Invisible blocker' })
    expect(id({ name: 'proxy01_co', record: -3, tex: ['proxy01_co.tga'], size: [3.5, 0.9, 3.4] }).role).toBe('skip')
    expect(id({ name: 'wall', tex: ['norender.tga'], size: [4, 0.2, 3] }).role).toBe('skip')
    expect(id({ name: 'bstsr1a_hullshd', size: [13, 9, 18] })).toMatchObject({ role: 'skip', name: 'Shadow copy' })
    expect(id({ name: 'rl6bspr1b_lod', tex: ['bspr1b_co.tga'], size: [10, 8, 9] }).role).toBe('skip')
    expect(id({ name: 'bsad2a_al', tex: ['BSAD2A_AL01.TGA'], size: [19, 16, 23] }).role).toBe('skip')
    expect(id({ name: 'chdecal_sq', tex: ['sq_chinachar_D.tga'], size: [1, 1, 0] })).toMatchObject({ role: 'skip', name: 'Decal' })
    expect(id({ name: 'lightpoolwall', tex: ['lightpool.tga'], size: [3, 0, 2] }).role).toBe('skip')
    expect(id({ name: 'sky', tex: ['sky_day.tga'], size: [500, 500, 100] }).role).toBe('skip')
    expect(id({ name: 'watermesh', tex: ['water_co.tga'], size: [112, 104, 0] }).role).toBe('skip')
    // A name that says what something is beats a see-through part drawn with the invisible picture.
    expect(id({ name: 'glass_a', raw: ['Wine_Glass_A21'], tex: ['missing-alpha.tga', 'wine_glass_gl.tga'], size: [0.1, 0.1, 0.2] }).role).toBe('prop')
    expect(id({ name: 'glass_a', raw: ['Wine_Glass_A21'], tex: ['missing-alpha.tga'], size: [0.1, 0.1, 0.2] }).role).toBe('skip')
    // "trshd" is a trash can, not a shadow; a texture called "decal" on a solid jar is no decal.
    expect(id({ name: 'trshd', tex: ['trashcan1_me.tga'], size: [0.7, 0.7, 1.1] }).role).toBe('prop')
    expect(id({ name: 'glass_container_a', tex: ['I05_Resin_Decal_co.tga'], size: [0.44, 0.39, 0.47] }).role).toBe('prop')
    // A model of nothing but graffiti is the paint on a building's walls (fnorhpr1a on the rhpr1a houses);
    // stairs whose tiles are called "decal" are still stairs.
    expect(id({ name: 'fnorhpr1a', tex: ['B46_Graf1.tga', 'A14_graffiti08_d.tga'], size: [8.9, 2.5, 7.3] })).toMatchObject({ role: 'skip', name: 'Graffiti layer' })
    expect(id({ name: 'stairs', tex: ['DecalTiles01.tga'], size: [6.4, 4.6, 6.1] }).name).not.toBe('Graffiti layer')
  })

  it("keeps a thing's door with the thing (a trailer's rear door is no trailer)", () => {
    expect(id({ name: 'semitrailerdoorab', tex: ['JT_semi1_2D.tga'], size: [1.31, 0.09, 2.61] })).toMatchObject({ role: 'piece', name: 'Door' })
  })

  it("names a building's part by what it is, and keeps it a piece", () => {
    // Its own texture set says stone: a wall, not a rock.
    expect(id({ name: 'wrfdo7a_medna', tex: ['B26_Stones_co.tga'], size: [14, 0.3, 1.8] })).toMatchObject({ role: 'piece', category: 'Building pieces', name: 'Building detail' })
    expect(id({ name: 'retba10a_largesa', tex: ['d20_door_wo.tga'], size: [2.7, 0.4, 3] })).toMatchObject({ role: 'piece', name: 'Door' })
    expect(id({ name: 'whatever', tex: ['B11_conc1_co.tga'], record: -9, size: [3, 2, 2] })).toMatchObject({ role: 'piece' })
  })

  it('reads shapes when the words say only what something is made of', () => {
    expect(id({ name: 'galv_met', record: -4, tex: ['Galv_Met.tga', 'tarp_ca.tga', 'cc_chainlinkA_fm.tga'], size: [4, 0.3, 2.4] }).name).toBe('Chain-link fence')
    expect(id({ name: 'dock_wood1_wo', record: -4, tex: ['dock_wood1_wo.tga'], size: [3.1, 0.16, 2.7] })).toMatchObject({ role: 'fence', name: 'Wooden fence' })
    expect(id({ name: 'conc4_co', record: -4, tex: ['conc4_co.tga'], size: [0.7, 0.67, 1.1] })).toMatchObject({ role: 'piece', name: 'Concrete block' })
    expect(id({ name: 'zzz', tex: [], size: [120, 80, 2] })).toMatchObject({ role: 'ground' })
  })

  it('names whole buildings from their size, storeys, material and kind, with the settings they suit', () => {
    const b = id({ name: 'retba8a', cat: 'Buildings', parts: [1, 2, 3], size: [28, 24, 25.2], tex: ['d21_windowframe_wo.tga', 'D21_brick_co.tga', 'graffiti_02.tga'], front: '-x', long: 'x', districts: ['Barrio'] })
    expect(b).toMatchObject({ role: 'building', category: 'Buildings', name: '6-storey brick shop' })
    expect(b.building).toMatchObject({ footprint: [28, 24], height: 25.2, storeys: 6, front: '-x', long: 'x', type: 'shop', material: 'brick', districts: ['Barrio'] })
    expect(b.settings).toEqual(expect.arrayContaining(['downtown', 'rundown']))
    expect(id({ name: 'aptvk3a', cat: 'Buildings', parts: [1, 2, 3], size: [56, 47, 49], tex: ['C33_window_gl.tga', 'C33_stucco_co.tga'] }).name).toBe('13-storey stucco apartment block')
    expect(id({ name: 'hswr3a', cat: 'Buildings', parts: [1, 2, 3], size: [20, 15, 9], tex: ['E34_siding_wo.tga'] })).toMatchObject({ name: '2-storey wooden house', settings: expect.arrayContaining(['suburbs']) })
    const shed = id({ name: 'whdo05a_hull', size: [64, 64, 35], tex: ['B48_Brick1_co.tga'] })
    expect(shed).toMatchObject({ role: 'building', name: 'Large brick warehouse', settings: expect.arrayContaining(['industrial', 'docks']) })
    expect(id({ name: 'olddwnt9a', cat: 'Buildings', parts: [1, 2, 3], size: [50, 40, 102], tex: ['D09_midwin02_gl.tga', 'D09_midwin01_gl.tga', 'D09_win01_gl.tga'] }).name).toBe('27-storey glass tower')
    // A building's far copy, and a cluster of parts too small to be a building, are not buildings to place.
    expect(id({ name: 'bstvk6a', cat: 'Buildings', parts: [1, 2, 3], size: [46, 30, 18], tex: ['BSTVK6A_AL01.tga'] }).role).toBe('skip')
    expect(id({ name: 'barpr1a', cat: 'Buildings', parts: [1, 2, 3], size: [4.8, 0.5, 1.3], tex: ['D45_concrete_co.tga'] }).role).toBe('piece')
    // The contract's first fields stay as they were.
    expect(id({ name: 'abcd1a', cat: 'Buildings', size: [33, 19, 10] }).building).toMatchObject({ footprint: [33, 19], height: 10, storeys: 2 })
  })

  it('reads building codes and districts', () => {
    expect(parseBuildingCode('retba8a')).toEqual({ type: 'ret', district: 'Barrio' })
    expect(parseBuildingCode('bstsr1a')).toEqual({ type: 'bst', district: "Saint's Row" })
    expect(parseBuildingCode('wrfdo7a')).toEqual({ type: 'wrf', district: 'Docks' })
    expect(parseBuildingCode('olddwnt4a')).toEqual({ type: 'old', district: 'Downtown' })
    expect(storeysOf(25.16)).toBe(6)
    expect(storeysOf(3)).toBe(1)
    const names = [...Array(20).fill('DT_lampPost'), ...Array(9).fill('4cBSTRL1A_details_lgA'), 'SR01lampPostStA02', 'crate01']
    expect(chunkDistricts(names)).toEqual(['Downtown', 'Red Light'])
    expect(chunkDistricts(['crate01', 'SR_pier01'])).toEqual([])
    // Something found in one district suits that district's settings.
    expect(id({ name: 'benchgreena', tex: ['ccBenchFull_wo.tga'], size: [2.6, 0.8, 1], districts: ['Factories'] }).settings).toContain('industrial')
  })

  it('is what the library shows: its category, its name and the old helpers agree', () => {
    const e = entry({ name: 'trashcand', tex: ['trashcan1_me.tga'], size: [0.7, 0.7, 1.1] })
    expect(displayName(e)).toBe(identify(e).name)
    expect(categoryOf('Default', 'chainfencea')).toBe('Fences and barriers')
    expect(categoryOf('Streetlight', 'polea')).toBe('Lights and signals')
    expect(pieceName('sr_chunk13_streetlamp_02.tga')).toBe('Street lamp')
    expect(GENERIC_NAMES.has('Wall')).toBe(true)
    expect(GENERIC_NAMES.has('Bench')).toBe(false)
  })
})
