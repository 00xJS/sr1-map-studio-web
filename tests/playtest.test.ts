import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { editorToGame, exportFactLines, frameOf, gameToEditor, parsePlaytest, playtestPath, playtestSpots, readExportNote, type GameFrame } from '../src/lib/playtest'
import type { Vec3 } from '../src/lib/project'
import { installedProjectId, replaceNeedsAsking } from '../src/lib/install'

// Recorded by companion-mod/playtest.lua against a scripted run (tests/playtestLua.test.ts): run on a roof,
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
    expect(fall).toMatchObject({ ev: 'fall', belowFloor: false, drop: 12, fromY: 12, pos: [6.652, 0, 6] })
    expect(log.events.find((e) => e.ev === 'fall' && e.belowFloor)).toMatchObject({ floorY: -10.25, pos: [30.002, -13.335, 9] })
    expect(log.events.find((e) => e.ev === 'stuck')).toMatchObject({ t: 5, keys: 'W', seconds: 2 })
    expect(log.events.filter((e) => e.ev === 'mark').map((e) => e.ev === 'mark' && e.n)).toEqual([1, 2])
    expect(log.events.find((e) => e.ev === 'push')).toMatchObject({ by: 2.589, wanted: [6.406, 3.218, 6.05] })
    expect(log.events.find((e) => e.ev === 'respawn')).toMatchObject({ from: [30.002, -29.763, 9], pos: [24, 0.02, -30.067] })
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

  it('matches the exporter’s own conversion (sr1_cts.convert_xyz)', () => {
    // [editor point, world scale, mirror x, origin, convert_xyz's answer], from
    // cd studio-py && py -3 -c "import sr1_cts; print(sr1_cts.convert_xyz((13.25, 3.5, -2), 0.5, True, (3.25, -0.5, -12)))" and so on.
    const cases: [Vec3, number, boolean, Vec3, Vec3][] = [
      [[13.25, 3.5, -2], 0.5, true, [3.25, -0.5, -12], [-5, 2, 5]],
      [[0, 0, 0], 0.5, true, [3.25, -0.5, -12], [1.625, 0.25, 6]],
      [[-41.7, 12.125, 88.3], 0.5, false, [-7.5, 1.25, 30], [-17.1, 5.4375, 29.15]],
      [[100, -3, -250.5], 1.25, true, [10.5, 0, -4.75], [-111.875, -3.75, -307.1875]],
      [[2.2, 0.02, -1.1], 2, false, [0, 0, 0], [4.4, 0.04, -2.2]],
    ]
    for (const [editor, worldScale, mirrorX, origin, game] of cases) {
      close(editorToGame(editor, { origin, worldScale, mirrorX }), game)
      close(gameToEditor(game, { origin, worldScale, mirrorX }), editor)
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
    // The first fall landed at game (6.652, 0, 6): editor x = -6.652 / 0.5 + 3.25.
    close(spots[2].at, [-10.054, -0.5, 0])
    const path = playtestPath(log)
    expect(path.map((r) => r.length)).toEqual([19, 4])
    close(path[0][0], gameToEditor([-19.917, 12, 6], frame))
    close(path[1][0], gameToEditor([24, 0.02, -30.067], frame))
    // Another frame can be given, for a log without one.
    close(playtestSpots(log, { ...frame, mirrorX: false })[2].at, [16.554, -0.5, 0])
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

describe('installing over a map', () => {
  /** A maps folder with these map folders and files, as the File System Access API hands them out. */
  const maps = (folders: Record<string, Record<string, string>>) => ({
    name: 'maps',
    async getDirectoryHandle(name: string) {
      const files = folders[name]
      if (!files) throw new DOMException(name, 'NotFoundError')
      return {
        async getFileHandle(file: string) {
          if (!(file in files)) throw new DOMException(file, 'NotFoundError')
          return { getFile: async () => new Blob([files[file]]) }
        },
      }
    },
  }) as unknown as Parameters<typeof replaceNeedsAsking>[0]

  const note = (id: string) => ['Exported by SR1 Map Studio (web) on 2026-10-27T17:58:40.512Z', 'Project: Rooftop test',
    ...exportFactLines({ projectId: id, origin: [0, 0, 0], worldScale: 0.5, mirrorX: true, floorY: 0 })].join('\r\n')
  const folder = maps({
    'Rooftop test': { 'MAP_STUDIO_EXPORT.txt': note('p-1') },
    'Old export': { 'MAP_STUDIO_EXPORT.txt': 'Exported by SR1 Map Studio (web) on 2026-01-01T00:00:00Z\r\nProject: Old\r\n' },
    'Community map': { 'bundle_info.xtbl': '<root/>' },
  })

  it('reads the installed project from the export note', async () => {
    expect(await installedProjectId(folder, 'Rooftop test')).toBe('p-1')
    expect(await installedProjectId(folder, 'Old export')).toBeUndefined()
    expect(await installedProjectId(folder, 'Community map')).toBeUndefined()
    expect(await installedProjectId(folder, 'Not there')).toBeUndefined()
  })

  it('asks before replacing anything but this project’s own last install', async () => {
    expect(await replaceNeedsAsking(folder, 'Rooftop test', 'p-1')).toBe(false)
    expect(await replaceNeedsAsking(folder, 'Rooftop test', 'p-2')).toBe(true)
    expect(await replaceNeedsAsking(folder, 'Old export', 'p-1')).toBe(true)
    expect(await replaceNeedsAsking(folder, 'Community map', 'p-1')).toBe(true)
    // Nothing there to replace.
    expect(await replaceNeedsAsking(folder, 'New map', 'p-1')).toBe(false)
  })
})
