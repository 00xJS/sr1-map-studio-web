// Early surface registration and v1.15's stock object library (editor side). The catalog here is made up for the
// test: the real one stays in the player's data pack.
import { afterEach, describe, expect, it } from 'vitest'
import { libraryPresets, type LibraryCatalog } from '../src/lib/propLibrary'
import { LIBRARY_PRESETS, PRESET_BY_KEY, presetOf, setLibraryPresets } from '../src/lib/physicsProps'
import { defaultSettings, gameSkyWanted, maxMapName, type SceneItem } from '../src/lib/project'
import { SURFACE_PAIR } from '../src/lib/install'
import { DATAPACK } from '../src/lib/datapack'

const catalog: LibraryCatalog = {
  profiles: [
    { name: 'Crate Small', properties: { Weight: '20' }, explosion: null },
    { name: 'Tire', properties: { Weight: '10' }, explosion: null },
    { name: 'Big Bin', properties: { Weight: '2500', Hitpoints: '200', Material: 'Metal - Solid', Friction: '1', Damaged_By: { Element: ['explosions', 'cars'] } }, explosion: null },
    { name: 'Boom Drum', properties: { Weight: '300', Hitpoints: '50', Material: 'Metal - Solid', Movable_By_Humans: 'true', Damaged_By: { Element: 'all' }, Flags: { Flag: ['disappear_on_death'] } }, explosion: { Radius: '6', Impulse: '900' } },
  ],
  presets: {
    stock_tire: { label: 'Tire', profile: 'Tire' },
    stock_big_bin: { label: 'Big Bin', profile: 'Big Bin' },
    stock_boom: { label: 'Boom drum', profile: 'Boom Drum' },
  },
}

const prop = { uid: 'a', name: 'x', path: 'x.obj', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: {}, alpha: {},
  native_prefab: 'sr1_native_custom_mesh_glass_experiment', native_prop_behavior: 'movable' } as SceneItem

afterEach(() => setLibraryPresets([]))

describe('stock object library', () => {
  it("offers the profiles the web doesn't have, with preview numbers from the table", () => {
    const list = libraryPresets(catalog)
    expect(list.map((p) => p.key)).toEqual(['lib_stock_big_bin', 'lib_stock_boom'])
    const [bin, boom] = list
    expect(bin).toMatchObject({ behavior: 'movable', profile: 'Big Bin', lb: 2500, hp: 200, hurtBy: 'x', breaks: false, pushable: false, friction: 1 })
    expect(boom).toMatchObject({ hurtBy: 'bx', breaks: true, pushable: true, blast: { radius: 6, force: 900 } })
    expect(boom.hint).toContain('explodes (6 m)')
  })

  it('finds an item made from a library preset, loaded or not', () => {
    const item = { ...prop, physics_preset: 'lib_stock_big_bin', native_profile: 'Big Bin' }
    expect(presetOf(item)?.label).toBe('Big Bin')
    expect(presetOf(item)?.hint).toContain("isn't in this browser's data pack")
    setLibraryPresets(libraryPresets(catalog))
    expect(LIBRARY_PRESETS).toHaveLength(2)
    expect(presetOf(item)?.lb).toBe(2500)
    expect(PRESET_BY_KEY.lib_stock_boom.profile).toBe('Boom Drum')
    setLibraryPresets([])
    expect(PRESET_BY_KEY.lib_stock_boom).toBeUndefined()
  })
})

describe('early surface registration', () => {
  it('is off by default and shortens the map name limit', () => {
    const s = defaultSettings()
    expect(s.surface_preload).toBeFalsy()
    expect(maxMapName(s)).toBe(11)
    expect(maxMapName({ surface_preload: true })).toBe(10)
  })

  it("brings its own sky, so the game's sky steps aside", () => {
    expect(gameSkyWanted({ native_sky: '' })).toBe(true)
    expect(gameSkyWanted({ native_sky: '', surface_preload: true })).toBe(false)
  })

  it('recognises old pairs to clear from an installed map', () => {
    expect(SURFACE_PAIR.test('sf_0123456789ab.peg_xbox2')).toBe(true)
    expect(SURFACE_PAIR.test('sf_0123456789ab.bbchunk_xbox2')).toBe(true)
    expect(SURFACE_PAIR.test('sf_probe0000001.peg_xbox2')).toBe(false)
    expect(SURFACE_PAIR.test('mymap.peg_xbox2')).toBe(false)
  })

  it('accepts the template and library from the data pack, never as required files', () => {
    expect(DATAPACK['surface_preload_presets/surftest.bbcity_xbox2']).toMatchObject({ group: 'surface', size: 3060416 })
    const library = Object.entries(DATAPACK).filter(([, e]) => e.group === 'library')
    expect(library.some(([p]) => p === 'native_props/expanded_v114/catalog.json')).toBe(true)
    expect(Object.values(DATAPACK).filter((e) => e.group === 'required')).toHaveLength(6)
  })
})
