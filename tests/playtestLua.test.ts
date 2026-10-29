// The companion mod's playtest recorder (companion-mod/playtest.lua), run in fengari against fake game memory
// (tests/fixtures/playtest-harness.lua). fengari is Lua 5.3 with 32-bit integers, so game addresses above
// 0x7FFFFFFF read negative: the recorder's pointer test is loosened here, nothing else changes.
// PLAYTEST_FIXTURE=write npx vitest run tests/playtestLua.test.ts writes tests/fixtures/playtest-rooftop.jsonl again.
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from 'fengari'
import { exportFactLines, parsePlaytest, type GameFrame, type PlaytestEvent } from '../src/lib/playtest'

type Value = string | number | boolean | null

function runLua(code: string, globals: Record<string, Value>, out: string[]): Record<string, string> {
  const L = lauxlib.luaL_newstate()
  lualib.luaL_openlibs(L)
  for (const [k, v] of Object.entries(globals)) {
    if (v === null) lua.lua_pushnil(L)
    else if (typeof v === 'string') lua.lua_pushstring(L, to_luastring(v))
    else if (typeof v === 'number') lua.lua_pushinteger(L, v)
    else lua.lua_pushboolean(L, v)
    lua.lua_setglobal(L, to_luastring(k))
  }
  if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
    throw new Error(to_jsstring(lua.lua_tostring(L, -1)))
  }
  return Object.fromEntries(out.map((k) => {
    lua.lua_getglobal(L, to_luastring(k))
    const s = lua.lua_tostring(L, -1)
    return [k, s ? to_jsstring(s) : '']
  }))
}

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

/** The recorder as it ships, but for the pointer test, with the Windows clock or the whole-second one. */
function recorder(windows: boolean) {
  const src = read('companion-mod/playtest.lua')
  const out = src.replace(/local function pointer\(v\)[^\n]*/, 'local function pointer(v) return v ~= 0 end')
    .replace('local windows = SEP == "\\\\"', `local windows = ${windows}`)
  expect(out.match(/v ~= 0 end|local windows = (true|false)\n/g)).toHaveLength(2)
  return out
}

const frame: GameFrame = { origin: [3.25, -0.5, -12], worldScale: 0.5, mirrorX: true }
// MAP_STUDIO_EXPORT.txt as the exporter writes it (exporter.ts exportNotes).
const note = ['Exported by SR1 Map Studio (web) on 2026-10-27T17:58:40.512Z', 'Project: Rooftop test',
  ...exportFactLines({ projectId: '5d0c9e7a-3f41-4b8e-9a2d-7c1e6f0b2a93', origin: frame.origin, worldScale: 0.5, mirrorX: true, floorY: -10.25 }),
  '', 'Render: 12,345 triangles in 3 mesh(es), 40 material batches'].join('\r\n')

const MOD = 'C:/Games/SaintsReborn/dist/mods/companion-mod'

function play(o: {
  windows?: boolean; scenario?: string; note?: string | null; mod?: string | null; keep?: number; index?: string; deleted?: string
  taken?: number; readOnly?: string
} = {}) {
  const r = runLua(read('tests/fixtures/playtest-harness.lua'), {
    PLAYTEST_SRC: recorder(o.windows ?? true), NOTE: o.note === undefined ? note : o.note, MOD_FOLDER: o.mod === undefined ? MOD : o.mod,
    SCENARIO: o.scenario ?? 'rooftop', KEEP: o.keep ?? 20, INDEX: o.index ?? null, DELETED: o.deleted ?? null, TAKEN: o.taken ?? 0,
    READ_ONLY: o.readOnly ?? null,
  }, ['RESULT', 'LOG'])
  const files: Record<string, string> = {}
  for (const block of r.RESULT.split(/^### /m).filter(Boolean)) {
    const nl = block.indexOf('\n')
    files[block.slice(0, nl).replace(/\\/g, '/').slice(MOD.length + 1)] = block.slice(nl + 1)
  }
  return { files, log: r.LOG }
}

describe('playtest.lua', () => {
  it('records the scripted run as in the sample log', () => {
    const { files, log } = play()
    expect(Object.keys(files)).toEqual(['playtest/rooftop-20261027-180211.jsonl', 'playtest/index.txt'])
    const out = files['playtest/rooftop-20261027-180211.jsonl']
    if (process.env.PLAYTEST_FIXTURE === 'write') writeFileSync('tests/fixtures/playtest-rooftop.jsonl', out)
    expect(out).toBe(read('tests/fixtures/playtest-rooftop.jsonl'))
    expect(files['playtest/index.txt']).toBe('rooftop-20261027-180211.jsonl\n')
    expect(log).toContain('Playtest: recording rooftop to')
    expect(log).not.toContain('error')
  })

  it('reads the export note the exporter writes', () => {
    const start = parsePlaytest(play().files['playtest/rooftop-20261027-180211.jsonl']).start!
    expect(start).toMatchObject({ project: '5d0c9e7a-3f41-4b8e-9a2d-7c1e6f0b2a93', exported: '2026-10-27T17:58:40.512Z', floorY: -10.25 })
    expect(start.frame).toEqual(frame)
  })

  it('records without a note: no frame, no below-the-floor falls', () => {
    const log = parsePlaytest(play({ note: null }).files['playtest/rooftop-20261027-180211.jsonl'])
    expect(log.start?.frame).toBeUndefined()
    expect(log.start?.project).toBeUndefined()
    expect(log.events.filter((e) => e.ev === 'fall').map((e) => e.ev === 'fall' && e.belowFloor)).toEqual([false, false])
  })

  it('reads each fact only at the start of a line', () => {
    const quoted = note.replace('Project: Rooftop test', 'Project: Rooftop test (copied from Project id: someone-else)')
    expect(parsePlaytest(play({ note: quoted }).files['playtest/rooftop-20261027-180211.jsonl']).start)
      .toMatchObject({ project: '5d0c9e7a-3f41-4b8e-9a2d-7c1e6f0b2a93', frame })
    const only = parsePlaytest(play({ note: 'Project: Old (was Project id: someone-else)\r\nNotes: World scale: 2\r\n' }).files['playtest/rooftop-20261027-180211.jsonl'])
    expect([only.start?.project, only.start?.frame]).toEqual([undefined, undefined])
  })

  it('finds the same falls, stuck spots and marks with a clock of whole seconds (a Mac)', () => {
    const kinds = (text: string) => parsePlaytest(text).events.filter((e) => e.ev !== 'pos')
    const pc = kinds(play().files['playtest/rooftop-20261027-180211.jsonl'])
    const mac = kinds(play({ windows: false }).files['playtest/rooftop-20261027-180211.jsonl'])
    expect(mac.map((e) => e.ev)).toEqual(pc.map((e) => e.ev))
    expect(mac.map((e) => e.ev)).toEqual(expect.arrayContaining(['stuck', 'fall', 'mark']))
    mac.forEach((e, i) => expect(Math.abs(e.t - pc[i].t)).toBeLessThan(0.1))
  })

  it('takes a long ramp for a ramp while the frame rate climbs from 40 to 60', () => {
    // On a Mac the clock stands still for the frames over the last second's rate, so a 0.1 s speed window can
    // last 0.4 s: 3 m/s down the ramp read as 10 m/s, a fall. Only the drop off the ramp's end is one. (Before it
    // stands still that clock runs fast, so a Mac reads the drop's top speed low, but still well over 8 m/s.)
    for (const windows of [false, true]) {
      const falls = parsePlaytest(play({ windows, scenario: 'ramp' }).files['playtest/rooftop-20261027-180211.jsonl']).events
        .filter((e) => e.ev === 'fall')
      expect(falls).toHaveLength(1)
      const fall = falls[0] as Extract<PlaytestEvent, { ev: 'fall' }>
      expect(fall.t).toBeGreaterThan(10)
      expect(fall.fromY).toBeCloseTo(16, 1)
      expect(fall.drop).toBeCloseTo(16, 1)
      expect(fall.speed).toBeGreaterThan(windows ? 15 : 10)
    }
  })

  it('logs the rain where the camera is: in and out of a rain blocker, once a second while it rains', () => {
    const log = parsePlaytest(play({ scenario: 'rain' }).files['playtest/rooftop-20261027-180211.jsonl'])
    expect(log.skipped).toEqual([])
    const rain = log.events.filter((e): e is Extract<PlaytestEvent, { ev: 'rain' }> => e.ev === 'rain')
    expect(rain[0]).toMatchObject({ t: 0, indoor: false, region: -1, weather: 4, fade: 0, screenRain: [0.8, 0.5] })
    // Into the blocker at 3 s, a line on the way in, the fade at 1 and the screen rain gone by the next second.
    const into = rain.find((e) => e.indoor)!
    expect(into.t).toBeCloseTo(3, 1)
    expect(into.region).toBe(8)
    expect(rain.find((e) => e.t > 4.5 && e.t < 6)).toMatchObject({ indoor: true, fade: 1, screenRain: [0, 0] })
    // Out at 6 s: a line as the camera leaves (the latch holds while the fade runs down), then one at the clear.
    expect(rain.find((e) => e.t >= 6 && e.region === -1)?.t).toBeCloseTo(6, 1)
    expect(rain.some((e) => e.t > 7 && !e.indoor && e.fade === 0)).toBe(true)
    // About one a second while it rains, plus the crossings.
    expect(rain.length).toBeGreaterThanOrEqual(9)
    expect(rain.length).toBeLessThanOrEqual(14)
  })

  it('logs no rain in a clear match outside any region (the sample log has none)', () => {
    expect(parsePlaytest(play().files['playtest/rooftop-20261027-180211.jsonl']).events.some((e) => e.ev === 'rain')).toBe(false)
  })

  it('starts a second file when play starts again within the same second', () => {
    const { files } = play({ scenario: 'reenter' })
    const first = parsePlaytest(files['playtest/rooftop-20261027-180211.jsonl'])
    const second = parsePlaytest(files['playtest/rooftop-20261027-180211-2.jsonl'])
    expect([first.events[0].ev, first.complete, first.skipped]).toEqual(['start', true, []])
    expect([second.events[0].ev, second.complete]).toEqual(['start', true])
    expect(files['playtest/index.txt']).toBe('rooftop-20261027-180211.jsonl\nrooftop-20261027-180211-2.jsonl\n')
  })

  it('keeps the newest logs and deletes only logs from its own list', () => {
    const { files, log } = play({ scenario: 'reenter', keep: 3, index: 'a.jsonl\n..\\..\\mod.ini.jsonl\nb.jsonl\nc.jsonl\n' })
    expect(Object.keys(files).filter((f) => f.endsWith('.jsonl')).sort())
      .toEqual(['playtest/../../mod.ini.jsonl', 'playtest/c.jsonl', 'playtest/rooftop-20261027-180211-2.jsonl', 'playtest/rooftop-20261027-180211.jsonl'])
    expect(files['playtest/index.txt']).toBe('c.jsonl\nrooftop-20261027-180211.jsonl\nrooftop-20261027-180211-2.jsonl\n')
    expect(log.match(/\(removed [^)]*\)/g)?.map((l) => l.replace(/\\/g, '/'))).toEqual([`(removed ${MOD}/playtest/a.jsonl)`, `(removed ${MOD}/playtest/b.jsonl)`])
  })

  it('never deletes the log it has open, however often the index lists it', () => {
    // The index still has a log the player deleted by hand, twice, so the new log gets the same name.
    const name = 'rooftop-20261027-180211.jsonl'
    const { files, log } = play({ keep: 1, index: `${name}\na.jsonl\n${name}\n`, deleted: name })
    expect(Object.keys(files).filter((f) => f.endsWith('.jsonl'))).toEqual([`playtest/${name}`])
    expect(parsePlaytest(files[`playtest/${name}`]).complete).toBe(true)
    expect(files['playtest/index.txt']).toBe(`${name}\n`)
    expect(log.match(/\(removed [^)]*\)/g)).toHaveLength(1)
  })

  it('writes in the mod’s own folder when the playtest folder can’t be written', () => {
    const { files, log } = play({ readOnly: `${MOD}/playtest` })
    expect(Object.keys(files)).toEqual(['playtest-rooftop-20261027-180211.jsonl', 'playtest-index.txt'])
    expect(parsePlaytest(files['playtest-rooftop-20261027-180211.jsonl']).complete).toBe(true)
    expect(files['playtest-index.txt']).toBe('playtest-rooftop-20261027-180211.jsonl\n')
    expect(log).toContain(`Playtest: recording rooftop to ${MOD}`)
  })

  it('numbers up to 99 logs a second, then writes in the mod’s own folder', () => {
    const fresh = (taken: number) => {
      const old = Array.from({ length: taken }, (_, i) => `playtest/rooftop-20261027-180211${i ? `-${i + 1}` : ''}.jsonl`)
      return Object.keys(play({ taken }).files).filter((f) => f.endsWith('.jsonl') && !old.includes(f))
    }
    expect(fresh(98)).toEqual(['playtest/rooftop-20261027-180211-99.jsonl'])
    expect(fresh(99)).toEqual(['playtest-rooftop-20261027-180211.jsonl'])
  })

  it('stops recording when nothing can be written', () => {
    const { files, log } = play({ readOnly: MOD })
    expect(files).toEqual({})
    expect(log).toContain(`Playtest: can't write a log in ${MOD}; recording off`)
  })

  it('stays off when the mod loader gives no folder', () => {
    const { files, log } = play({ mod: null })
    expect(files).toEqual({})
    expect(log).toContain("didn't say where the mod's folder is; recording off")
  })
})

describe('main.lua', () => {
  const load = (playtest: string) => runLua(`
    local logs = {}
    wml = { mod_folder = "/m", setting = function(_, d) return d end, hook = function() end, on_frame = function() end,
      log = function(s) logs[#logs + 1] = s end }
    package.preload.surfaces = function() return { install = function() end } end
    package.preload.reload = function() return { setup = function() end, update = function() end } end
    package.preload.playtest = ${playtest}
    assert(load(MAIN_SRC, "=main.lua"))()
    LOG = table.concat(logs, "\\n")`, { MAIN_SRC: read('companion-mod/main.lua') }, ['LOG']).LOG

  it('loads without playtest.lua, with the log off', () => {
    const log = load('function() error("module \'playtest\' not found") end')
    expect(log).toContain('Playtest log off')
    expect(log).toContain('SR1 Map Studio Companion loaded')
  })

  it('starts the recorder when it is there', () => {
    const log = load('function() return { setup = function(_, _, s) wml.log("setup keep " .. s.keep) end, update = function() end } end')
    expect(log).toContain('setup keep 20')
    expect(log).not.toContain('Playtest log off')
  })
})
