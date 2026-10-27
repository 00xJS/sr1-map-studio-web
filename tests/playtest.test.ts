import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { editorToGame, exportFactLines, frameOf, gameToEditor, parsePlaytest, playtestPath, playtestSpots, readExportNote, type GameFrame } from '../src/lib/playtest'
import type { Vec3 } from '../src/lib/project'

// Recorded by companion-mod/playtest.lua against a scripted run (a Lua VM with fake game memory): run on a roof,
// pressed against a wall, End, off the edge to the street, past a pillar, down a ramp, through a gap, respawn,
// the pause menu, End again, match over.
const sample = readFileSync('tests/fixtures/playtest-rooftop.jsonl', 'utf8')

const close = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6))

describe('parsePlaytest', () => {
  const log = parsePlaytest(sample)

  it('reads every line of the sample', () => {
    expect(log.skipped).toEqual([])
    expect(log.map).toBe('rooftop')
    expect(log.complete).toBe(true)
    expect(log.duration).toBe(24)
    const count = (ev: string) => log.events.filter((e) => e.ev === ev).length
    expect([count('start'), count('pos'), count('stuck'), count('mark'), count('fall'), count('push'), count('respawn'), count('end')])
      .toEqual([1, 22, 1, 2, 3, 2, 1, 1])
  })

  it('takes the project and the frame from the start line', () => {
    expect(log.start).toMatchObject({
      project: '5d0c9e7a-3f41-4b8e-9a2d-7c1e6f0b2a93', date: '2026-10-27T18:02:11Z', exported: '2026-10-27T17:58:40.512Z',
      frame: { origin: [3.25, -0.5, -12], worldScale: 0.5, mirrorX: true }, floorY: -10.25,
    })
  })

  it('keeps each event’s own fields', () => {
    const fall = log.events.find((e) => e.ev === 'fall')!
    expect(fall).toMatchObject({ ev: 'fall', belowFloor: false, drop: 12, fromY: 12, pos: [6.589, 0, 6] })
    expect(log.events.find((e) => e.ev === 'fall' && e.belowFloor)).toMatchObject({ floorY: -10.25, pos: [29.939, -13.335, 9] })
    expect(log.events.find((e) => e.ev === 'stuck')).toMatchObject({ t: 5.017, keys: 'W', seconds: 2 })
    expect(log.events.filter((e) => e.ev === 'mark').map((e) => e.ev === 'mark' && e.n)).toEqual([1, 2])
    expect(log.events.find((e) => e.ev === 'push')).toMatchObject({ by: 2.589, wanted: [6.343, 3.218, 6.05] })
    expect(log.events.find((e) => e.ev === 'respawn')).toMatchObject({ from: [29.939, -29.763, 9], pos: [24, 0.02, -30.067] })
    expect(log.events.at(-1)).toMatchObject({ ev: 'end', reason: 'left play' })
  })

  it('skips a line cut off by a crash, blank lines, CRLF and events it doesn’t know', () => {
    const lines = sample.trim().split('\n')
    const cut = parsePlaytest([...lines.slice(0, 5), '', '{"t":9,"ev":"teleport","map":"rooftop","pos":[0,0,0],"heading":0}', lines[5].slice(0, 30)].join('\r\n'))
    expect(cut.events).toHaveLength(5)
    expect(cut.skipped).toEqual([7, 8])
    expect(cut.complete).toBe(false)
  })

  it('skips lines without a usable position and keeps a missing heading as null', () => {
    const log = parsePlaytest([
      '{"t":1,"ev":"pos","map":"m","pos":[1,null,3],"heading":0}',
      '{"t":2,"ev":"pos","map":"m","pos":[1,2,3],"heading":null}',
      '[1,2,3]',
    ].join('\n'))
    expect(log.skipped).toEqual([1, 3])
    expect(log.events[0]).toMatchObject({ pos: [1, 2, 3], heading: null })
    expect(log.start).toBeUndefined()
    expect(playtestSpots(log)).toEqual([])
  })
})

describe('game metres and editor units', () => {
  const frame: GameFrame = { origin: [3.25, -0.5, -12], worldScale: 0.5, mirrorX: true }

  it('runs the exporter’s conversion backwards', () => {
    // sr1_cts.convert_xyz: ((p - origin) * scale), x negated when mirrored.
    close(editorToGame([13.25, 3.5, -2], frame), [-5, 2, 5])
    close(gameToEditor([-5, 2, 5], frame), [13.25, 3.5, -2])
    close(gameToEditor([0, 0, 0], frame), frame.origin)
    for (const p of [[0, 0, 0], [12.5, -3, 400], [-77.1, 0.02, 3.3]] as Vec3[]) {
      close(editorToGame(gameToEditor(p, frame), frame), p)
      close(editorToGame(gameToEditor(p, { ...frame, mirrorX: false, worldScale: 1.25 }), { ...frame, mirrorX: false, worldScale: 1.25 }), p)
    }
  })

  it('uses the default scale of half a metre per unit', () => {
    expect(frameOf({ world_scale: 0, mirror_x: true }, [0, 0, 0]).worldScale).toBe(0.5)
    close(gameToEditor([1, 1, 1], frameOf({ world_scale: 0.5, mirror_x: false }, [0, 0, 0])), [2, 2, 2])
  })

  it('puts the spots and the path in editor units', () => {
    const log = parsePlaytest(sample)
    const spots = playtestSpots(log)
    expect(spots.map((s) => s.ev)).toEqual(['stuck', 'mark', 'fall', 'push', 'push', 'fall', 'fall', 'mark'])
    // The first fall landed at game (6.589, 0, 6): editor x = -6.589 / 0.5 + 3.25.
    close(spots[2].at, [-9.928, -0.5, 0])
    const path = playtestPath(log)
    expect(path.map((r) => r.length)).toEqual([19, 4])
    close(path[0][0], gameToEditor([-19.917, 12, 6], frame))
    close(path[1][0], gameToEditor([24, 0.02, -30.067], frame))
    // Another frame can be given, for a log without one.
    close(playtestSpots(log, { ...frame, mirrorX: false })[2].at, [16.428, -0.5, 0])
  })
})

describe('the export note', () => {
  it('writes lines the mod and the editor read back', () => {
    const note = ['Exported by SR1 Map Studio (web) on 2026-10-27T17:58:40.512Z', 'Project: Rooftop test',
      ...exportFactLines({ projectId: 'abc-123', origin: [3.25, -0.5, -12.123456], worldScale: 0.5, mirrorX: true, floorY: -10.25 }), '', 'Render: …'].join('\r\n')
    expect(note).toContain('\r\nMap origin: 3.25 -0.5 -12.1235\r\n')
    expect(readExportNote(note)).toEqual({ projectId: 'abc-123', frame: { origin: [3.25, -0.5, -12.1235], worldScale: 0.5, mirrorX: true }, floorY: -10.25 })
  })

  it('finds nothing in an older note', () => {
    expect(readExportNote('Exported by SR1 Map Studio (web) on 2026-01-01T00:00:00Z\r\nProject: Old\r\n')).toEqual({ projectId: undefined, frame: undefined, floorY: undefined })
    expect(readExportNote('Project id: only-the-id\r\n').projectId).toBe('only-the-id')
  })
})
