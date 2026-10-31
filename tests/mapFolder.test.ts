// Opening a finished map folder (src/lib/mapFolder): the level list, strings and CTS files read back the way the
// exporter writes them, a chunk split into pieces (back faces folded, the sky left out), and finding maps in a
// folder pick, a zip or loose files, all on small data made here. The last block opens every map installed in a
// local SaintsReborn/dist/maps (SR1_MAPS, or next to SR1_PACKFILES / the default install), read only: nothing
// from the game or from those maps is copied into the repo.
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { GAME_TESTS } from './testMode'
import { buildChunk, box, type Spec } from './chunkBuilder'
import { packageMetadata } from '../src/lib/exporter'
import { SPAWN_TYPES, defaultSettings, newMarker } from '../src/lib/project'
import { readChunk } from '../src/lib/gameObjects/chunk'
import { decodeText, mapIdentity, parseLevels, parseStrings } from '../src/lib/mapFolder/meta'
import { ctsMarkers, hasWeaponPickups, parseCts, soundZones, toEditor, yawToEditor, type Frame } from '../src/lib/mapFolder/cts'
import { FAKE_SKY, backFaces, chunkSoup, objectName, sceneOrigin, splitParts, splitScene, type TriSoup } from '../src/lib/mapFolder/scene'
import { chunkStems, findMaps, folderEntries, type MapSource } from '../src/lib/mapFolder/files'
import { baseNameFor, readMapInfo } from '../src/lib/mapFolder/info'
import { readMapScene } from '../src/lib/mapFolder/read'
import { MAP_UPGRADES } from '../src/lib/mapFolder/upgrades'
import { minimapBox } from '../src/lib/mapFolder/minimap'

const blob = (s: string | Uint8Array) => new Blob([s])
const source = (name: string, files: Record<string, string | Uint8Array>): MapSource => ({ name, files: new Map(Object.entries(files).map(([p, v]) => [p, blob(v)])) })

describe('a map folder says who it is', () => {
  const settings = { ...defaultSettings(), modes: ['Gangsta Brawl', 'Big Ass Chains', 'Protect Tha Pimp'] as const, always_clear_weather: false }
  const meta = packageMetadata('My Arena', 'myarena', 'My Arena', { ...settings, modes: [...settings.modes] }, [newMarker('Shared spawn')], 'A test map.')
  const at = (p: string) => meta[`My Arena/${p}`]

  it('reads back the level list, the name and the help text the exporter writes', () => {
    const levels = parseLevels(new TextDecoder().decode(at('levels/multiplayer_levels_extra.xtbl')))
    expect(levels.map((l) => [l.mode, l.map, l.cts])).toEqual([['Gangsta Brawl', 'myarena', 'myarena'], ['Big Ass Chains', 'myarena', 'myarena'], ['Protect Tha Pimp', 'myarena', 'myarena_ptp']])
    const strings = parseStrings(at('levels/US_strings.txt'))
    const id = mapIdentity(levels, strings, ['myarena'], 'Folder')
    expect(id).toMatchObject({ map: 'myarena', displayName: 'My Arena', description: 'A test map.', modes: ['Gangsta Brawl', 'Big Ass Chains', 'Protect Tha Pimp'], alwaysClearWeather: false })
    expect(id.ctsByMode['Protect Tha Pimp']).toBe('myarena_ptp')
  })
  it('keeps modes it does not know apart, and falls back to the folder name', () => {
    const levels = parseLevels('<MultiplayerLevel><Name>x</Name><Mode>Gangsta brawl</Mode><Map>Dust</Map><CTSFile>dust</CTSFile><Flags><Flag>AlwaysClearWeather</Flag></Flags></MultiplayerLevel><MultiplayerLevel><Mode>Co-op Mission</Mode><Map>dust</Map><CTSFile>dust</CTSFile></MultiplayerLevel>')
    const id = mapIdentity(levels, {}, ['dust'], 'Dust Folder')
    expect(id).toMatchObject({ map: 'Dust', displayName: 'Dust Folder', modes: ['Gangsta Brawl'], otherModes: ['Co-op Mission'], alwaysClearWeather: false })
  })
  it('reads strings files in UTF-16 or plain text', () => {
    expect(parseStrings(new TextEncoder().encode('BINTEXT\r\n\r\nMULTI_LEVEL_DUST=Dust\r\n  1\r\n'))).toEqual({ MULTI_LEVEL_DUST: 'Dust' })
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x41, 0, 0x42, 0]))).toBe('AB')
  })
})

// The CTS layout studio-py/sr1_cts.py and py/sound_zones.py write.
const CTS = `// -------
#Includes
// -------
$Include: "amb_myarena.cts"

// -------
#Groups
// -------
$Group:	"myarena__studio_$G_crew"

// -------
#Navpoints
// -------
$Navpoint:	"myarena__studio_$respawn000"
$Type:		"ground"
$Pos:			<-2.000000 10.500000 4.000000>
$Orient:		[-1.570796]
+Chunk:		"myarena"

$Navpoint:	"myarena__studio_$item000"
$Type:		"ground"
$Pos:			<1.000000 10.000000 1.000000>
$Orient:		[0.000000]
+Chunk:		"myarena"

$Navpoint:	"myarena__studio_$prop000"
$Type:		"ground"
$Pos:			<3.000000 10.000000 1.000000>
$Orient:		[0.000000]
+Chunk:		"myarena"

$Navpoint:	"myarena__studio_$veh000"
$Type:		"ground"
$Pos:			<9.000000 10.000000 9.000000>
$Orient:		[0.000000]
+Chunk:		"myarena"

$Navpoint:	"myarena__studio_$chains000"
$Type:		"ground"
$Pos:			<0.000000 10.000000 0.000000>
$Orient:		[0.000000]
+Chunk:		"myarena"

$Navpoint:	"myarena__studio_$human000"
$Type:		"ground"
$Pos:			<5.000000 10.000000 5.000000>
$Orient:		[0.000000]
+Chunk:		"myarena"

$Navpoint:	"myarena__studio_$floatnav000"
$Type:		"floating"
$Pos:			<7.000000 14.000000 7.000000>
$Orient:		[0.000000]
+Chunk:		"myarena"

// -------
#Cameras
// -------

// -------
#Items
// -------
$Item:		"myarena__studio_$item000"
$Item type:	"pump action shotgun"
$Start nav:	"myarena__studio_$item000"

$Item:		"myarena__studio_$prop000"
$Item type:	"Chair_Office"
$Start nav:	"myarena__studio_$prop000"

// -------
#Triggers
// -------
$Trigger:				"myarena__studio_$chains000"
$Trigger type:			"sphere"
$Trigger action:		"chains drop off"
$Trigger max fires:	0
$Trigger delay:		10000
$Start nav:				"myarena__studio_$chains000"
+Disabled
$Sphere radius:		0.700000

// -------
#Vehicles
// -------
$Vehicle:		"myarena__studio_$veh000"
$Vehicle type:	"car_2dr_sports04"
$Start nav:		"myarena__studio_$veh000"
$Stream Distance:			50.000

// -------
#Respawns
// -------
$Respawn:		"myarena__studio_$respawn000"
$Start nav:		"myarena__studio_$respawn000"
$Box size:		-2.000000 0.000000 -2.000000 2.000000 2.000000 2.000000

// -------
#Humans
// -------
$Human:				"myarena__studio_$human000"
$Char type:				"TS_X_M_Thug1-01"
$Start nav:				"myarena__studio_$human000"
+Leash distance:		12.00
+Group:				"myarena__studio_$G_crew"

// -------
#Special Spawns
// -------
$Special Spawn:	"myarena__studio_$special000"
$Type:		"Smoking Weed"
$Pos:			<6.000000 10.000000 -6.000000>
$Orient:		[0.000000]
+Chunk:		"myarena"
`

const PTP = `#Navpoints
$Navpoint:	"p0"
$Type:		"ground"
$Pos:			<-4.000000 10.000000 0.000000>
$Orient:		[0.000000]
+Chunk:		"myarena"

$Navpoint:	"p1"
$Type:		"ground"
$Pos:			<4.000000 10.000000 0.000000>
$Orient:		[0.000000]
+Chunk:		"myarena"

$Navpoint:	"pimp"
$Type:		"ground"
$Pos:			<0.000000 10.000000 8.000000>
$Orient:		[0.000000]
+Chunk:		"myarena"

$Navpoint:	"myarena__studio_$veh000"
$Type:		"ground"
$Pos:			<9.000000 10.000000 9.000000>
$Orient:		[0.000000]
+Chunk:		"myarena"
#Vehicles
$Vehicle:		"myarena__studio_$veh000"
$Vehicle type:	"car_2dr_sports04"
$Start nav:		"myarena__studio_$veh000"
#Respawns
$Respawn:		"r0"
$Start nav:		"p0"
+MPTeam1

$Respawn:		"r1"
$Start nav:		"p1"
+MPTeam2
#Triggers
$Trigger:				"t0"
$Trigger type:			"sphere"
$Trigger action:		"pimp enter"
$Trigger max fires:	0
$Trigger delay:		10000
$Start nav:				"pimp"
$Sphere radius:		1.500000
`

const AMB = `#Navpoints
$Navpoint:	"amb_myarena_z00"
$Type:		"floating"
$Pos:			<0.000000 12.000000 0.000000>
$Orient:		[0.000000]
+Chunk:		"myarena"

$Navpoint:	"amb_myarena_z01"
$Type:		"floating"
$Pos:			<10.000000 12.000000 0.000000>
$Orient:		[0.000000]
+Chunk:		"myarena"
#Ambients
$Ambient:	"amb_myarena_z00"
	$Navpoint:	"amb_myarena_z00"
	$Shape:	"Sphere"
		$Inner Radius:	12.75
		$Outer Radius:	15.00
	$Inner Offset:	<0 0 0>
	$Emitter:	"e0"
		$Volume:	0.4000
		$Min Delay:	0
		$Max Delay:	0
		$Play Type:	"In Order"
		+File:	"amb_birds_day.wav"

$Ambient:	"amb_myarena_z01"
	$Navpoint:	"amb_myarena_z01"
	$Shape:	"Cylinder"
		$Inner Radius:	9.00
		$Outer Radius:	10.00
		$Inner Height:	4.00
		$Outer Height:	6.00
	$Emitter:	"e0"
		$Volume:	0.2500
		$Min Delay:	5000
		$Max Delay:	20000
		$Play Type:	"Random"
		+File:	"amb_dog_bark.wav"
#End
`

describe('CTS files back into markers', () => {
  const frame: Frame = { origin: [0, 10, 0], ws: 0.5 }
  const got = ctsMarkers({ main: parseCts(CTS), ptp: parseCts(PTP), ambience: parseCts(AMB) }, frame)
  const of = (type: string) => got.markers.filter((m) => m.type === type)

  it('puts each record at its navpoint, in editor space (X mirrored, world-scale units)', () => {
    const [spawn] = of('Shared spawn')
    expect(spawn.position).toEqual([4, 1, 8])
    // radians(-yaw) is what the exporter writes for a mirrored map.
    expect(spawn.yaw).toBeCloseTo(90, 3)
    expect(toEditor(frame, [-2, 10.5, 4])).toEqual([4, 1, 8])
    expect(yawToEditor(-Math.PI / 2)).toBe(90)
  })
  it('tells whether a file has weapon pickups, not just item props', () => {
    const item = (type: string) => parseCts(`#Items\n$Item:\t"a"\n$Item type:\t"${type}"\n$Start nav:\t"a"\n\n#End\n`)
    expect(hasWeaponPickups(item('pump action shotgun'))).toBe(true)
    expect(hasWeaponPickups(item('Chair_Office'))).toBe(false)
    expect(hasWeaponPickups(undefined)).toBe(false)
  })
  it('keeps a weapon ID typed in under Other… as a pickup, by the name the exporter gave its record', () => {
    const file = (name: string, type: string) => parseCts(`#Navpoints\n$Navpoint:\t"${name}"\n$Type:\t"ground"\n$Pos:\t<1 2 3>\n$Orient:\t[0]\n\n#Items\n$Item:\t"${name}"\n$Item type:\t"${type}"\n$Start nav:\t"${name}"\n\n#End\n`)
    const typed = file('map__studio_$item000', 'glockL')
    expect(hasWeaponPickups(typed)).toBe(true)
    // In both files, as a kept weapon is: one marker, not a prop and a pickup.
    expect(ctsMarkers({ main: typed, ptp: typed }, frame).markers).toMatchObject([{ type: 'Weapon pickup', weapon: 'glockL', label: 'glockL' }])
    const prop = file('map__studio_$prop000', 'Chair_Office')
    expect(hasWeaponPickups(prop)).toBe(false)
    expect(ctsMarkers({ main: prop }, frame).markers).toMatchObject([{ type: 'Item prop', item: 'Chair_Office' }])
    // A map from elsewhere: only the weapon list can say.
    expect(ctsMarkers({ main: file('item1', 'glockL') }, frame).markers).toMatchObject([{ type: 'Item prop', item: 'glockL' }])
  })
  it('reads every kind the exporter writes', () => {
    expect(of('Weapon pickup').map((m) => m.weapon)).toEqual(['pump_action_shotgun'])
    expect(of('Item prop').map((m) => m.item)).toEqual(['Chair_Office'])
    expect(of('Vehicle spawn').map((m) => m.vehicle)).toEqual(['car_2dr_sports04'])
    expect(of('Chains drop-off')[0]).toMatchObject({ radius: 0.7, delay_ms: 10000, max_fires: 0, disabled: true })
    expect(of('Human NPC spawn')[0]).toMatchObject({ char_type: 'TS_X_M_Thug1-01', leash_distance: 12, group: 'crew' })
    expect(of('Special spawn')[0]).toMatchObject({ special_type: 'Smoking Weed', position: [-12, 0, -12] })
    expect(of('Floating navpoint').map((m) => m.position)).toEqual([[-14, 8, 14]])
  })
  it('takes the team spawns and pimp entrances from the PTP file, and what it repeats only once', () => {
    expect(of('Red team spawn').map((m) => m.position)).toEqual([[8, 0, 0]])
    expect(of('Blue team spawn').map((m) => m.position)).toEqual([[-8, 0, 0]])
    expect(of('Pimp entrance')[0]).toMatchObject({ radius: 1.5, disabled: false })
    expect(of('Vehicle spawn')).toHaveLength(1)
    expect(got.includes).toEqual(['amb_myarena'])
  })
  it('makes sound zones from the ambience file: spheres, and cylinders as boxes', () => {
    const z = soundZones(parseCts(AMB), frame)
    expect(z.map((m) => [m.sound, m.shape])).toEqual([['amb_birds_day', 'sphere'], ['amb_dog_bark', 'box']])
    expect(z[0]).toMatchObject({ radius: 15, volume: 0.4, position: [-0, 4, 0] })
    expect(z[1]).toMatchObject({ size: [20, 6, 20], volume: 0.25, sound_random: true, delay_min_s: 5, delay_max_s: 20 })
    expect(of('Sound zone')).toHaveLength(2)
  })
  it('keeps a nested field out of the record above it', () => {
    const c = parseCts(AMB)
    expect(c.records.filter((r) => r.kind === 'Navpoint')).toHaveLength(2)
    expect(c.records.find((r) => r.kind === 'Ambient')!.fields.Navpoint).toBe('"amb_myarena_z00"')
  })
})

// ---------------- pieces ----------------

/** A triangle soup from [corners, solid, material, instance] (corners: 9 numbers). */
function soup(tris: [number[], number, number, number][], materials = ['wall_co.tga', 'floor_co.tga']): TriSoup {
  return {
    pos: new Float32Array(tris.flatMap((t) => t[0])), uv: new Float32Array(tris.length * 6),
    solid: new Uint8Array(tris.map((t) => t[1])), mat: new Uint16Array(tris.map((t) => t[2])), inst: new Uint32Array(tris.map((t) => t[3])), materials, plans: materials.map((tex) => ({ tex, uv: 0 })),
  }
}
/** A quad as two triangles, and the same turned round. */
const quad = (x: number, y: number, z: number, s = 1): number[][] => [[x, y, z, x + s, y, z, x + s, y + s, z], [x, y, z, x + s, y + s, z, x, y + s, z]]
const turned = (t: number[]) => [t[0], t[1], t[2], t[6], t[7], t[8], t[3], t[4], t[5]]

describe('a map chunk into pieces', () => {
  it('finds the back faces a double-sided export added (and never takes the solid one for the copy)', () => {
    const q = quad(0, 0, 0)
    const s = soup([[q[0], 1, 0, 0], [q[1], 1, 0, 0], [turned(q[0]), 0, 0, 0], [turned(q[1]), 0, 0, 0], [quad(5, 0, 0)[0], 0, 0, 0]])
    expect([...backFaces(s)]).toEqual([-1, -1, 0, 1, -1])
    const solidCopy = soup([[turned(q[0]), 0, 0, 0], [q[0], 1, 0, 0]])
    expect([...backFaces(solidCopy)]).toEqual([1, -1])
  })
  it('folds the copies into a double-sided piece', () => {
    const q = quad(0, 0, 0)
    const s = soup([[q[0], 1, 0, 0], [q[1], 1, 0, 0], [turned(q[0]), 0, 0, 0], [turned(q[1]), 0, 0, 0]])
    const [p] = splitScene(s, [{ record: 'BeaverCreek_0', prop: false, profile: '' }])
    expect(p.doubleSided).toBe(true)
    expect(p.look.length).toBe(2)
    expect([...p.look]).toEqual([0, 0])
  })
  it('splits the map geometry into its parts, a small part inside a big one kept with it', () => {
    const tris: [number[], number, number, number][] = []
    const add = (q: number[][], inst: number, mat = 0) => q.forEach((t) => tris.push([t, 1, mat, inst]))
    add(quad(0, 0, 0, 10), 0)        // a wall, 10 m
    add(quad(2, 2, 0.01, 1), 0, 1)   // a sign on it (its own part, inside the wall's box)
    add(quad(30, 0, 0, 10), 1)       // another wall far off
    const s = soup(tris)
    const parts = splitParts(s, [...Array(tris.length).keys()])
    expect(parts.map((p) => p.length)).toEqual([4, 2])
  })
  it('keeps placed objects and props on their own, the map first, props last', () => {
    const tris: [number[], number, number, number][] = []
    quad(0, 0, 0, 40).forEach((t) => tris.push([t, 1, 1, 0]))
    quad(1, 0, 1, 1).forEach((t) => tris.push([t, 1, 0, 1]))
    quad(3, 0, 3, 1).forEach((t) => tris.push([t, 1, 0, 2]))
    const pieces = splitScene(soup(tris), [
      { record: '', prop: false, profile: '' },
      { record: 'mymap_native_prop_000', prop: true, profile: 'Crate Small' },
      { record: 'parkbencha01', prop: false, profile: '' },
    ])
    expect(pieces.map((p) => [p.name, p.kind, p.prop])).toEqual([['Floor', 'part', false], ['Bench', 'object', false], ['Prop', 'object', true]])
    expect(pieces[2].profile).toBe('Crate Small')
    expect(objectName('mymap_native_glass_003', true)).toBe('Glass pane')
  })
  it('puts each piece about the middle of its footprint, at its lowest point', () => {
    const q = quad(4, 2, 6, 2)
    const [p] = splitScene(soup(q.map((t) => [t, 1, 0, 0])), [{ record: '', prop: false, profile: '' }])
    expect(p.base).toEqual([5, 2, 6])
    expect(Math.min(...p.mesh.positions.filter((_, i) => i % 3 === 1))).toBe(0)
    expect(sceneOrigin(soup(q.map((t) => [t, 1, 0, 0])))).toEqual([5, 2, 6])
  })
  it('leaves out the sky objects and the template sky box, and counts everything as solid when collision is unreadable', () => {
    const spec: Spec = {
      strings: ['ground_co.tga', FAKE_SKY, 'shd_stars.tga'],
      vbs: [box(4, 1, 4), box(100, 100, 100)],
      materials: [[0], [1], [2]],
      meshes: [{ subs: [{ vb: 0, batches: [[0, 10, 0]] }] }, { subs: [{ vb: 1, batches: [[0, 10, 1]] }] }, { subs: [{ vb: 1, batches: [[0, 10, 2]] }] }],
      instances: [{ pos: [0, 0, 0], mesh: 0 }, { pos: [0, 0, 0], mesh: 1 }, { pos: [0, 0, 0], mesh: 2 }],
      records: [{ name: 'BeaverCreek_0', instance: 0 }, { name: 'beavercreek_opaque_sky', instance: 1 }, { name: 'Stars', instance: 2 }],
    }
    const s = chunkSoup(readChunk(buildChunk(spec)))
    expect(s.fakeSky).toBe(true)
    expect(s.skipped.skyObjects).toBe(1)
    expect(s.soup.materials).toEqual(['ground_co.tga'])
    expect([...s.soup.solid].every((x) => x === 1)).toBe(true)
    expect(new Set(s.soup.inst)).toEqual(new Set([0]))
  })
})

describe('finding the maps in what was picked', () => {
  const b = blob('x')
  it('finds each map in a pick of the whole maps folder', () => {
    const maps = findMaps([
      ['maps/Dust/bundle_info.xtbl', b], ['maps/Dust/levels/dust.bbchunk_xbox2', b], ['maps/Dust/levels/dust.cts', b],
      ['maps/Sublot/levels/parkgar.bbchunk_xbox2', b], ['maps/readme.txt', b],
    ])
    expect(maps.map((m) => [m.name, [...m.files.keys()]])).toEqual([['Dust', ['bundle_info.xtbl', 'levels/dust.bbchunk_xbox2', 'levels/dust.cts']], ['Sublot', ['levels/parkgar.bbchunk_xbox2']]])
  })
  it('takes a zip of one map\'s contents, and loose files, as one map', () => {
    const zipped = findMaps([['bundle_info.xtbl', b], ['levels/dust.bbchunk_xbox2', b]], 'dust_upgraded')
    expect(zipped.map((m) => m.name)).toEqual(['dust_upgraded'])
    const loose = findMaps([['dust.bbchunk_xbox2', b], ['dust.peg_xbox2', b], ['bundle_info.xtbl', b]], 'dust')
    expect([...loose[0].files.keys()]).toEqual(['levels/dust.bbchunk_xbox2', 'levels/dust.peg_xbox2', 'bundle_info.xtbl'])
    expect(chunkStems(loose[0])).toEqual(['dust'])
    expect(findMaps([['notes.txt', b]])).toEqual([])
  })
  it('hands the folder back with the upgraded files swapped in and new ones added', async () => {
    const src = source('Dust', { 'levels/dust.bbchunk_xbox2': 'old', 'levels/dust.cts': 'cts' })
    const out = await folderEntries(src, 'Dust', { 'levels/DUST.bbchunk_xbox2': new Uint8Array([1]), 'MAP_STUDIO_UPGRADES.txt': new Uint8Array([2]) })
    expect(Object.keys(out).sort()).toEqual(['Dust/MAP_STUDIO_UPGRADES.txt', 'Dust/levels/dust.bbchunk_xbox2', 'Dust/levels/dust.cts'])
    expect([...out['Dust/levels/dust.bbchunk_xbox2']]).toEqual([1])
  })
  it('gives the map an id the exporter takes', () => {
    expect(baseNameFor('dust')).toBe('dust')
    expect(baseNameFor('mpx_ascension')).toBe('ascension')
    expect(baseNameFor('a very-long map name')).toBe('a_very_long')
  })
  it('reads the folder: modes, name, and its CTS files', async () => {
    const meta = packageMetadata('My Arena', 'myarena', 'My Arena', { modes: ['Gangsta Brawl', 'Protect Tha Pimp'], always_clear_weather: true }, [], '')
    const files: Record<string, string | Uint8Array> = { 'levels/myarena.bbchunk_xbox2': 'x', 'levels/myarena.cts': CTS, 'levels/myarena_ptp.cts': PTP, 'levels/amb_myarena.cts': AMB }
    for (const [k, v] of Object.entries(meta)) files[k.slice('My Arena/'.length)] = v
    const info = await readMapInfo(source('My Arena', files))
    expect(info.stem).toBe('myarena')
    expect(info.identity.modes).toEqual(['Gangsta Brawl', 'Protect Tha Pimp'])
    expect(info.cts.main?.records.length).toBeGreaterThan(5)
    expect(info.cts.ptp?.records.some((r) => r.flags.includes('MPTeam1'))).toBe(true)
    expect(info.cts.ambience?.records.filter((r) => r.kind === 'Ambient')).toHaveLength(2)
  })
  it('lists the quick upgrades py/map_upgrade.py has, the one that asks for the game folder before the one that draws', () => {
    expect(MAP_UPGRADES.map((u) => u.key)).toEqual(['invisible_walls', 'retail_materials', 'game_sky', 'minimap', 'dry_interiors', 'rain_occluders'])
    const py = readFileSync(resolve(__dirname, '../py/map_upgrade.py'), 'utf8')
    for (const u of MAP_UPGRADES) expect(py).toContain(`key = '${u.key}'`)
  })
})

// ---------------- the maps installed in the game ----------------

const PACKS = process.env.SR1_PACKFILES || 'C:/Games/SaintsReborn/dist/game/packfiles'
const MAPS = process.env.SR1_MAPS || resolve(PACKS, '..', '..', 'maps')
const haveMaps = GAME_TESTS && existsSync(MAPS)

/** A map folder of the install as the editor gets it from the folder picker (read only). */
function installed(name: string): MapSource {
  const root = join(MAPS, name)
  const files = new Map<string, Blob>()
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else files.set(relative(root, p).split(sep).join('/'), new Blob([readFileSync(p)]))
    }
  }
  walk(root)
  return { name, files }
}

describe.runIf(haveMaps)('the maps in the local game install', () => {
  const names = haveMaps ? readdirSync(MAPS).filter((n) => statSync(join(MAPS, n)).isDirectory()) : []
  for (const name of names) {
    it(`opens ${name}`, async () => {
      const src = installed(name)
      const info = await readMapInfo(src)
      expect(info.identity.displayName.length).toBeGreaterThan(0)
      const bytes = async (b: Blob | null | undefined) => (b ? new Uint8Array(await b.arrayBuffer()) : null)
      const ld = [...src.files].find(([p]) => /^levels\/ld-.*\.peg_xbox2$/i.test(p))?.[1]
      const scene = readMapScene((await bytes(info.chunk))!, [(await bytes(info.peg))!], await bytes(ld), 64)
      expect(scene.pieces.length).toBeGreaterThan(0)
      expect(scene.pieces[0].prop).toBe(false)
      // Every material of the map's own geometry has its picture, but for the few the template never fills.
      const found = scene.textures.filter(Boolean).length
      expect(found / scene.materials.length).toBeGreaterThan(0.8)
      // Spawns stand on the map: each has a piece's floor within a few metres below it.
      const frame = { origin: scene.origin, ws: 0.5 }
      const markers = ctsMarkers(info.cts, frame).markers
      const spawns = markers.filter((m) => SPAWN_TYPES.includes(m.type))
      const respawns = [...(info.cts.main?.records ?? []), ...(info.cts.ptp?.records ?? [])].filter((r) => r.kind === 'Respawn').length
      expect(spawns.length).toBeGreaterThan(0)
      expect(spawns.length).toBeLessThanOrEqual(respawns)
      let grounded = 0
      for (const s of spawns) {
        const g = [-s.position[0] * 0.5 + scene.origin[0], s.position[1] * 0.5 + scene.origin[1], s.position[2] * 0.5 + scene.origin[2]]
        if (scene.pieces.some((p) => floorBelow(p, g, 3))) grounded++
      }
      expect(grounded / spawns.length).toBeGreaterThan(0.9)
      // The minimap the quick upgrade draws: a square over the whole map, every spawn on it.
      const [x0, z0, x1, z1] = minimapBox(scene)!
      expect(x1 - x0).toBeCloseTo(z1 - z0, 2)
      for (const s of spawns) {
        const gx = -s.position[0] * 0.5 + scene.origin[0], gz = s.position[2] * 0.5 + scene.origin[2]
        expect(gx > x0 && gx < x1 && gz > z0 && gz < z1).toBe(true)
      }
      if (scene.loading) expect(scene.loading.width).toBeGreaterThan(0)
    }, 60000)
  }
})

/** A triangle of the piece right under the point (game frame), no more than `drop` metres down (or half a metre up). */
function floorBelow(p: { base: number[]; mesh: { positions: Float32Array; triangles: Uint32Array } }, g: number[], drop: number) {
  const q = p.mesh.positions, t = p.mesh.triangles
  const x = g[0] - p.base[0], y = g[1] - p.base[1], z = g[2] - p.base[2]
  for (let i = 0; i < t.length; i += 3) {
    const a = 3 * t[i], b = 3 * t[i + 1], c = 3 * t[i + 2]
    const d = (q[b] - q[a]) * (q[c + 2] - q[a + 2]) - (q[c] - q[a]) * (q[b + 2] - q[a + 2])
    if (Math.abs(d) < 1e-9) continue
    const u = ((x - q[a]) * (q[c + 2] - q[a + 2]) - (q[c] - q[a]) * (z - q[a + 2])) / d
    const v = ((q[b] - q[a]) * (z - q[a + 2]) - (x - q[a]) * (q[b + 2] - q[a + 2])) / d
    if (u < 0 || v < 0 || u + v > 1) continue
    const h = q[a + 1] + u * (q[b + 1] - q[a + 1]) + v * (q[c + 1] - q[a + 1])
    if (h <= y + 0.5 && h >= y - drop) return true
  }
  return false
}
