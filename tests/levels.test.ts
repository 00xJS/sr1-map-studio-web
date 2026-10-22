import { describe, expect, it } from 'vitest'
import { strFromU8 } from 'fflate'
import { checkModes, customizableCounts, levelEntries, levelId } from '../src/lib/levels'
import { packageMetadata } from '../src/lib/exporter'
import { GAME_MODES, newMarker, PIMP_EXIT, type GameMode, type Marker } from '../src/lib/project'

const at = (type: string, extra: Partial<Marker> = {}): Marker => ({ ...newMarker(type), ...extra })
const ptpReady = [at('Red team spawn'), at('Red team spawn'), at('Red team spawn'), at('Red team spawn'),
  at('Blue team spawn'), at('Blue team spawn'), at('Blue team spawn'), at('Blue team spawn'), at('Pimp entrance')]

describe('levelId', () => {
  it('depends only on map name and mode', () => {
    const alone = levelEntries('arena', ['Big Ass Chains'], []).find((e) => e.mode === 'Big Ass Chains')!.id
    const withOthers = levelEntries('arena', GAME_MODES, []).find((e) => e.mode === 'Big Ass Chains')!.id
    expect(alone).toBe(withOthers)
    expect(levelId('Arena', 'Gangsta Brawl')).toBe(levelId('arena', 'Gangsta Brawl'))
  })

  it('stays in the custom range and differs between modes', () => {
    const ids = GAME_MODES.map((m) => levelId('bloodgulch', m))
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id >= 1000 && id <= 32767).toBe(true)
  })
})

describe('customizableCounts', () => {
  it('counts distinct placed weapon and vehicle types', () => {
    const markers = [
      at('Weapon pickup', { label: 'ak47' }), at('Weapon pickup', { label: 'ak47' }), at('Weapon pickup', { label: 'pipe-bomb' }),
      at('Weapon pickup', { label: 'pipe_bomb' }), at('Vehicle spawn', { label: 'car_2dr_sports03' }),
    ]
    // pipe-bomb is written to the CTS as "pipe bomb", which differs from pipe_bomb.
    expect(customizableCounts(markers)).toEqual({ weapons: 3, vehicles: 1 })
  })

  it('uses 6 weapons when there are no pickups, like retail PTP maps', () => {
    expect(customizableCounts([at('Shared spawn')])).toEqual({ weapons: 6, vehicles: 0 })
  })

  it('caps at 20', () => {
    const many = Array.from({ length: 25 }, (_, i) => at('Weapon pickup', { label: 'w' + i }))
    expect(customizableCounts(many).weapons).toBe(20)
  })
})

describe('levelEntries', () => {
  it('points Protect Tha Pimp at its own CTS with no pickups', () => {
    const markers = [at('Weapon pickup', { label: 'ak47' }), at('Weapon pickup', { label: 'tec9' })]
    const [gb, ptp] = levelEntries('arena', ['Gangsta Brawl', 'Protect Tha Pimp'], markers)
    expect(gb).toMatchObject({ ctsFile: 'arena', weapons: 2, name: 'arena GB' })
    expect(ptp).toMatchObject({ ctsFile: 'arena_ptp', weapons: 6, vehicles: 0, name: 'arena PTP' })
  })
})

describe('checkModes', () => {
  it('blocks Pimp exit markers', () => {
    expect(checkModes({ modes: ['Gangsta Brawl'] }, [at('Shared spawn'), at(PIMP_EXIT)]).errors.join()).toMatch(/pimp exit/)
  })

  it('needs both teams and a pimp entrance for Protect Tha Pimp', () => {
    const r = checkModes({ modes: ['Protect Tha Pimp'] }, [at('Red team spawn')])
    expect(r.errors.join()).toMatch(/Blue team spawns, a Pimp entrance/)
    expect(checkModes({ modes: ['Protect Tha Pimp'] }, ptpReady).errors).toEqual([])
  })

  it('warns about chains drop-offs and unused pimp entrances', () => {
    const r = checkModes({ modes: ['Big Ass Chains'] }, [...ptpReady, at('Chains drop-off')])
    expect(r.errors).toEqual([])
    expect(r.warnings.join('\n')).toMatch(/at least 2/)
    expect(r.warnings.join('\n')).toMatch(/only used by Protect Tha Pimp/)
  })

  it('needs at least one mode', () => {
    expect(checkModes({ modes: [] as GameMode[] }, ptpReady).errors.join()).toMatch(/at least one game mode/)
  })
})

describe('packageMetadata', () => {
  const xtbl = (always: boolean, modes: GameMode[]) =>
    strFromU8(packageMetadata('Arena', 'arena', 'Arena', { modes, always_clear_weather: always }, [at('Weapon pickup', { label: 'ak47' })])['Arena/levels/multiplayer_levels_extra.xtbl'])

  it('writes the weather flag only when asked', () => {
    expect(xtbl(true, ['Gangsta Brawl'])).toContain('<Flag>AlwaysClearWeather</Flag>')
    expect(xtbl(false, ['Gangsta Brawl'])).not.toContain('<Flags>')
  })

  it('writes the exact mode names, PTP CTS file, IDs and counts', () => {
    const x = xtbl(true, ['Team Gangsta Brawl', 'Protect Tha Pimp'])
    expect(x).toContain('<Mode>Protect Tha Pimp</Mode>')
    expect(x).toContain('<CTSFile>arena_ptp</CTSFile>')
    expect(x).toContain(`<ID>${levelId('arena', 'Protect Tha Pimp')}</ID>`)
    expect(x).toContain('<num_customizable_weapons>1</num_customizable_weapons>')
    expect(x.match(/<MultiplayerLevel>/g)).toHaveLength(2)
  })
})
