import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8 } from 'fflate'
import { checkModes, levelEntries } from '../src/lib/levels'
import { mapChecklist } from '../src/lib/checklist'
import { packageMetadata } from '../src/lib/exporter'
import { newMarker, newProject, type Marker } from '../src/lib/project'
import { parseCueNames, soundLabel } from '../src/lib/gameFiles'
import {
  BOR, BOR_BOXES, BOR_CARS, BOR_CAR_BLUE, BOR_CAR_RED, BOR_CASH, BOR_CHOP, BOR_DOOR, BOR_ENTRANCE, BOR_GARAGE_BLUE, BOR_GARAGE_RED, BOR_TYPES,
  BOR_VICTORY, SOUND_ZONE, borExtraCars, borMissing, retailToolMarkers, zoneShape,
} from '../src/lib/retailModes'

const at = (type: string, extra: Partial<Marker> = {}): Marker => ({ ...newMarker(type), ...extra })
const borReady = [
  at('Red team spawn'), at('Blue team spawn'), at(BOR_CAR_RED), at(BOR_CAR_RED, { vehicle: 'sp_forklift01' }), at(BOR_CAR_RED), at(BOR_CAR_BLUE),
  at(BOR_GARAGE_RED), at(BOR_GARAGE_BLUE), at(BOR_CHOP), at(BOR_ENTRANCE), at(BOR_VICTORY), at('Chains drop-off'),
  ...Array.from({ length: 8 }, () => at(BOR_CASH)),
]
const py = (name: string) => readFileSync(join(__dirname, '..', 'py', name), 'utf8')

describe('Blinged Out Ride', () => {
  it('needs every part before it is listed', () => {
    expect(borMissing(borReady)).toEqual([])
    const partial = borReady.filter((m) => m.type !== BOR_VICTORY && m.type !== BOR_CASH)
    expect(borMissing(partial).map((n) => n.text)).toEqual(['the victory garage', 'cash spawns'])
    expect(levelEntries('arena', ['Gangsta Brawl', BOR], partial).map((e) => e.mode)).toEqual(['Gangsta Brawl'])
    expect(checkModes({ modes: [BOR] }, partial).errors).toEqual(['Blinged Out Ride needs the victory garage, cash spawns.'])
  })

  it('loads its own CTS and counts extra cars per team', () => {
    const [e] = levelEntries('arena', [BOR], borReady)
    expect(e).toMatchObject({ mode: BOR, name: 'arena BOR', ctsFile: 'arena_bor', vehicles: 2, weapons: 6 })
    expect(borExtraCars(borReady)).toBe(2)
    expect(checkModes({ modes: [BOR] }, borReady).errors).toEqual([])
  })

  it('writes the level entry in the map pack', () => {
    const files = packageMetadata('Arena', 'arena', 'Arena', { modes: ['Team Gangsta Brawl', BOR], always_clear_weather: true }, borReady)
    const xtbl = strFromU8(files['Arena/levels/multiplayer_levels_extra.xtbl'])
    expect(xtbl).toContain('<Mode>Blinged Out Ride</Mode>')
    expect(xtbl).toContain('<CTSFile>arena_bor</CTSFile>')
    expect(xtbl.match(/<MultiplayerLevel>/g)).toHaveLength(2)
  })

  it('shows up in the checklist with a fix for the first missing part', () => {
    const p = newProject()
    p.settings.modes = [BOR]
    p.markers = [at('Red team spawn'), at('Blue team spawn')]
    const item = mapChecklist(p, true).find((c) => c.id === 'bor')!
    expect(item.state).toBe('needed')
    expect(item.fix).toEqual({ kind: 'tool', tool: 'spawn', spawn: BOR_CAR_RED })
    p.markers = borReady
    expect(mapChecklist(p, true).find((c) => c.id === 'bor')!.state).toBe('done')
    // The on-foot door is suggested, not required.
    expect(mapChecklist(p, true).find((c) => c.id === 'bor-door')).toMatchObject({ state: 'suggested', fix: { kind: 'tool', tool: 'spawn', spawn: BOR_DOOR } })
    p.markers = [...borReady, at(BOR_DOOR)]
    expect(mapChecklist(p, true).find((c) => c.id === 'bor-door')).toBeUndefined()
  })

  it('offers its markers only while the mode is chosen', () => {
    expect(retailToolMarkers(['Gangsta Brawl'])).toEqual([SOUND_ZONE])
    expect(retailToolMarkers([BOR])).toEqual([...BOR_TYPES, SOUND_ZONE])
  })

  it('uses the same names, boxes and cars as the exporter', () => {
    const src = py('bor_mode.py')
    for (const t of BOR_TYPES) expect(src).toContain(`'${t}'`)
    for (const [t, size] of Object.entries(BOR_BOXES)) expect(newMarker(t).size).toEqual(size)
    const models = [...src.match(/EXTRA_CAR_MODELS = \(([^)]*)\)/)![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(BOR_CARS.map(([id]) => id).sort()).toEqual([...models].sort())
    expect(py('sound_zones.py')).toContain(`TYPE = '${SOUND_ZONE}'`)
  })
})

describe('sound zones', () => {
  it('start as a sphere with no sound yet', () => {
    const m = newMarker(SOUND_ZONE)
    expect(zoneShape(m)).toEqual({ radius: 15 })
    expect(zoneShape({ ...m, shape: 'box' })).toEqual({ box: [20, 8, 20] })
    const p = newProject()
    p.markers = [m]
    expect(mapChecklist(p, true).find((c) => c.id === 'sound')?.state).toBe('suggested')
  })

  it('reads sound names from a sound bank', () => {
    // A made-up bank laid out like the game's: count at 0x12, name offset at 0x22.
    const names = ['AMB_TEST_BIRDS_1', 'AMB_TEST_ROOM TONE', 'AMB_TEST_HUM_2'] // made up; some real names have spaces
    const text = new TextEncoder().encode(names.join('\0') + '\0')
    const bank = new Uint8Array(0x80 + text.length)
    bank.set(new TextEncoder().encode('KBDS'))
    const dv = new DataView(bank.buffer)
    dv.setUint16(0x12, names.length)
    dv.setUint32(0x22, 0x80)
    dv.setUint32(0x26, 0xffffffff)
    bank.set(text, 0x80)
    expect(parseCueNames(bank)).toEqual(names)
    dv.setUint32(0x22, 0x40) // points at zeros, not at a name list
    expect(() => parseCueNames(bank)).toThrow()
    expect(() => parseCueNames(new Uint8Array(64))).toThrow('Not a sound bank')
    expect(soundLabel('AMB_TEST_BIRDS_1')).toBe('test birds 1')
  })
})
