// The Check tab's ranked list (editor/checkIssues.ts) and the command palette's search.
import { describe, expect, it } from 'vitest'
import { autoFixes, buildIssues } from '../src/editor/checkIssues'
import type { CheckItem } from '../src/lib/checklist'
import type { HealthReport } from '../src/lib/analysis/types'
import { exportBlocks } from '../src/editor/exportBlocks'
import { fileNameFor } from '../src/editor/PlayDialog'
import { newMarker } from '../src/lib/project'

const report = (findings: string[]) => ({ findings } as unknown as HealthReport)

describe('Check list', () => {
  it('puts what blocks the game first, then what players notice, then the rest', () => {
    const checklist: CheckItem[] = [
      { id: 'ground', state: 'done', text: 'Ground to stand on' },
      { id: 'weapons', state: 'suggested', text: 'Add weapons to pick up', fix: { kind: 'tool', tool: 'weapon' }, action: 'Place' },
      { id: 'modes', state: 'needed', text: 'Choose at least one game mode', fix: { kind: 'modes' }, action: 'Choose' },
    ]
    const issues = buildIssues({
      checklist, stairs: 2, slivers: null, removeWalls: true,
      report: report(['Every spawn is out of sight and away from the enemy.', '40% of the floor is wide open (half the map can see it and is close enough to hit it): add cover.', 'Spawn 2 can be seen from 3 places: easy to camp.']),
    })
    expect(issues.map((x) => x.id)).toEqual(['list-modes', 'health-2', 'stairs', 'list-weapons', 'health-1'])
    expect(issues[0].go?.label).toBe('Choose')
    expect(issues[1].show?.what).toEqual({ spawn: 2 })
  })

  it('runs each fix once under Fix all, spawns last', () => {
    const checklist: CheckItem[] = [
      { id: 'spawns', state: 'suggested', text: 'Only 2 spawns', fix: { kind: 'autoSpawns' }, action: 'Add for me' },
      { id: 'sky', state: 'suggested', text: 'No sky', fix: { kind: 'sky' }, action: 'Add sky' },
    ]
    const issues = buildIssues({ checklist, stairs: 1, slivers: { count: 4, places: [[0, 0, 0]] } as never, removeWalls: false, report: report(["1 weapon can't be used: in the air."]) })
    expect(autoFixes(issues).map((f) => f.kind)).toEqual(['ramps', 'walls', 'sky', 'spawns'])
    // With the setting on, invisible walls are only a note.
    const on = buildIssues({ checklist: [], stairs: 0, slivers: { count: 4, places: [] } as never, removeWalls: true, report: null })
    expect(on).toHaveLength(1)
    expect(on[0].auto).toBeUndefined()
    expect(on[0].rank).toBe(3)
  })
})

describe('What stops a build', () => {
  const pack = (groups: Partial<Record<'surface' | 'sky', boolean>>) => ({
    ready: true,
    groups: Object.fromEntries(['required', 'glass', 'props', 'cts', 'sky', 'surface', 'library', 'demo'].map((g) => [g, { have: (groups as Record<string, boolean>)[g] === false ? 0 : 1, total: 1 }])),
  }) as never

  it('blocks a file name too long for early surface registration, not one Install in game names itself', () => {
    expect(exportBlocks({ base_name: 'mymap4567ab', surface_preload: true, native_sky: '', modes: [] }, [], pack({}))[0]).toMatch(/11 characters.*10 at most/)
    expect(exportBlocks({ base_name: 'mymap4567ab', surface_preload: false, native_sky: '', modes: [] }, [], pack({}))).toEqual([])
    expect(exportBlocks({ base_name: 'mymap', surface_preload: true, native_sky: '', modes: [] }, [], pack({}))).toEqual([])
  })

  it('blocks settings whose data-pack files are missing', () => {
    expect(exportBlocks({ base_name: 'arena', surface_preload: true, native_sky: '', modes: [] }, [], pack({ surface: false }))[0]).toMatch(/surface template/)
    expect(exportBlocks({ base_name: 'arena', surface_preload: false, native_sky: 'sr_alwayshwyf01', modes: [] }, [], pack({ sky: false }))[0]).toMatch(/native sky/)
    expect(exportBlocks({ base_name: 'arena', surface_preload: false, native_sky: 'sr_alwayshwyf01', modes: [] }, [], null)).toEqual([])
  })

  it("blocks a game mode missing the markers it needs, as the exporter would fail on it", () => {
    const s = { base_name: 'arena', surface_preload: false, native_sky: '', modes: ['Protect Tha Pimp'] } as Parameters<typeof exportBlocks>[0]
    expect(exportBlocks(s, [newMarker('Shared spawn', [0, 0, 0])], pack({})).join(' ')).toMatch(/Protect Tha Pimp needs Red team spawns, Blue team spawns/)
    const ptp = [newMarker('Red team spawn', [0, 0, 0]), newMarker('Blue team spawn', [9, 0, 0]), newMarker('Pimp entrance', [5, 0, 5])]
    expect(exportBlocks(s, ptp, pack({}))).toEqual([])
    // No game mode at all is the checklist's own line.
    expect(exportBlocks({ ...s, modes: [] }, [], pack({}))).toEqual([])
  })

  it('names a map to fit: 10 characters with early surface registration', () => {
    expect(fileNameFor('Rooftop Arena', 10)).toMatch(/^roofto\d{4}$/)
    expect(fileNameFor('Rooftop Arena')).toMatch(/^rooftop\d{4}$/)
  })
})
