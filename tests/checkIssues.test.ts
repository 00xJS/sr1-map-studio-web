// The Check tab's ranked list (editor/checkIssues.ts) and the command palette's search.
import { describe, expect, it } from 'vitest'
import { autoFixes, buildIssues } from '../src/editor/checkIssues'
import type { CheckItem } from '../src/lib/checklist'
import type { HealthReport } from '../src/lib/analysis/types'

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
