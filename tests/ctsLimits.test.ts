// The game's CTS limits as the editor shows them (report BC, sections 2, 5 and 6); the Python side is
// tests/cts_limits_check.py. Python and TypeScript share these numbers, so they are read here from both.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { catalogs } from '../src/lib/catalogs'
import { mapChecklist } from '../src/lib/checklist'
import { ITEM_PROP } from '../src/lib/gameObjects/items'
import { MARKER_HINTS } from '../src/lib/labels'
import { MAX_ITEM_TYPES, MAX_SPAWNS, MAX_TRIGGER_FIRES, checkModes, customizableCounts, itemTypes, spawnLimitTexts } from '../src/lib/levels'
import { BOR, BOR_CAR_RED } from '../src/lib/retailModes'
import { PIMP_EXIT, newMarker, newProject, type GameMode, type Marker } from '../src/lib/project'

const at = (type: string, extra: Partial<Marker> = {}): Marker => ({ ...newMarker(type), ...extra })
const warn = (markers: Marker[]) => checkModes({ modes: ['Gangsta Brawl'] }, markers).warnings.join('\n')
const pickups = (n: number) => Array.from({ length: n }, (_, i) => at('Weapon pickup', { label: `w${i}` }))
const props = (n: number) => Array.from({ length: n }, (_, i) => at(ITEM_PROP, { item: `p${i}` }))
const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

describe('Pimp exit', () => {
  it('is not offered, and an old project is still told to remove it', () => {
    expect(catalogs.trigger_kinds).not.toContain(PIMP_EXIT)
    expect(checkModes({ modes: ['Gangsta Brawl'] }, [at(PIMP_EXIT)]).errors.join()).toMatch(/pimp exit/)
  })

  it('has no action in the game, so typing it into a custom trigger warns', () => {
    expect(catalogs.trigger_actions).toHaveLength(41)
    expect(catalogs.trigger_actions).toContain('pimp enter')
    expect(catalogs.trigger_actions).not.toContain('pimp exit')
    expect(warn([at('Sphere trigger (custom)', { trigger_action: 'pimp exit' })])).toMatch(/no "pimp exit" trigger action.*execute lua script/)
  })

  it('takes the game\'s own actions, ignoring case as the game does', () => {
    expect(warn([at('Sphere trigger (custom)', { trigger_action: 'Save Spot' })])).not.toMatch(/trigger action/)
  })
})

describe('Max fires', () => {
  it('matches the Python limit', () => {
    expect(source('studio-py/sr1_cts.py')).toContain(`MAX_TRIGGER_FIRES = ${MAX_TRIGGER_FIRES}`)
    expect(MAX_TRIGGER_FIRES).toBe(255)
  })

  it('warns above one byte only', () => {
    expect(warn([at('Pimp entrance', { max_fires: 255 })])).not.toMatch(/max fires/)
    expect(warn([at('Chains drop-off', { max_fires: 256 })])).toMatch(/more than 255 max fires/)
  })
})

describe('Starts switched off', () => {
  it('new drop-offs start on, as most of the game\'s own do; other triggers keep their default', () => {
    expect(newMarker('Chains drop-off').disabled).toBe(false)
    expect(newMarker('Pimp entrance').disabled).toBe(true)
  })

  it('warns only when every drop-off is off, which no game map does', () => {
    const off = at('Chains drop-off', { disabled: true }), on = at('Chains drop-off')
    expect(warn([off, off])).toMatch(/Every Chains drop-off/)
    expect(warn([off, on])).not.toMatch(/Every Chains drop-off/)
    expect(warn([])).not.toMatch(/Every Chains drop-off/)
  })
})

describe('Spawns', () => {
  const many = (type: string, n: number) => Array.from({ length: n }, () => at(type))
  const over = (modes: GameMode[], markers: Marker[]) => spawnLimitTexts(modes, markers).length

  it('matches the Python limit', () => {
    expect(source('py/map_features.py')).toContain(`MAX_SPAWNS = ${MAX_SPAWNS}`)
    expect(MAX_SPAWNS).toBe(64)
  })

  it('counts each spawn file on its own, as the modes load them', () => {
    const shared40 = many('Shared spawn', 40), red40 = many('Red team spawn', 40), blue40 = many('Blue team spawn', 40)
    // Team spawns stay out of the main file while Player spawns exist.
    expect(over(['Gangsta Brawl'], [...shared40, ...red40, ...blue40])).toBe(0)
    expect(over(['Protect Tha Pimp'], [...shared40, ...red40, ...blue40])).toBe(1)
    expect(over(['Gangsta Brawl', 'Protect Tha Pimp'], [...shared40, ...red40, ...blue40])).toBe(1)
    expect(over(['Gangsta Brawl'], many('Shared spawn', 64))).toBe(0)
    expect(over(['Gangsta Brawl'], many('Shared spawn', 65))).toBe(1)
    // With no Player spawns the main file holds the team spawns.
    expect(over(['Gangsta Brawl'], [...red40, ...blue40])).toBe(1)
    expect(over(['Protect Tha Pimp'], [...many('Red team spawn', 32), ...many('Blue team spawn', 32)])).toBe(0)
  })

  it('counts team cars in the Blinged Out Ride file only', () => {
    const list = [...many('Red team spawn', 32), ...many('Blue team spawn', 32), at(BOR_CAR_RED)]
    expect(over([BOR], list)).toBe(1)
    expect(over(['Protect Tha Pimp'], list)).toBe(0)
  })

  it('warns in the Game tab and the checklist, and says how many to remove', () => {
    const list = many('Shared spawn', 70)
    expect(warn(list)).toMatch(/70 spawns in the Gangsta Brawl.*first 64.*remove 6/)
    const items = mapChecklist({ ...newProject('m'), settings: { ...newProject('m').settings, modes: ['Gangsta Brawl'] }, markers: list }, true)
    expect(items.find((c) => c.id === 'spawn-limit-0')?.state).toBe('suggested')
  })
})

describe('Item types', () => {
  it('matches the Python limit', () => {
    expect(source('py/item_props.py')).toContain(`MAX_ITEM_TYPES = ${MAX_ITEM_TYPES}`)
    expect(MAX_ITEM_TYPES).toBe(20)
  })

  it('counts distinct types across pickups and chosen props, as the game names them', () => {
    const list = [at('Weapon pickup', { label: 'desert-eagle' }), at('Weapon pickup', { label: 'Desert Eagle' }),
      at(ITEM_PROP, { item: 'Chair_Office' }), at(ITEM_PROP, { item: 'chair_office' }), at(ITEM_PROP, { item: '' })]
    expect([...itemTypes(list)]).toEqual(['desert eagle', 'chair_office'])
  })

  it('says on the item prop marker that lobby weapons replace it, without a warning nothing can fix', () => {
    expect(MARKER_HINTS[ITEM_PROP]).toMatch(/lobby weapons.*swaps it for one of those weapons/)
    expect(warn(props(2))).toBe('')
  })

  it('warns and adds a checklist item past 20 types, and says what the export does', () => {
    const fine = [...pickups(10), ...props(10)], over = [...pickups(10), ...props(11)]
    expect(warn(fine)).not.toMatch(/different item types/)
    expect(warn(over)).toMatch(/21 different item types.*leaves out item props/)
    expect(warn(pickups(21))).toMatch(/21 different item types.*keeps every pickup/)
    const list = (markers: Marker[]) => mapChecklist({ ...newProject('m'), markers }, true).map((c) => c.id)
    expect(list(fine)).not.toContain('item-types')
    expect(list(over)).toContain('item-types')
  })

  it('leaves the lobby cap to weapon pickups', () => {
    expect(customizableCounts([...pickups(3), ...props(5)]).weapons).toBe(3)
  })
})
