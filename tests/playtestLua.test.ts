// The companion mod's playtest recorder (companion-mod/playtest.lua), run in fengari against fake game memory
// (tests/fixtures/playtest-harness.lua). fengari is Lua 5.3 with 32-bit integers, so game addresses above
// 0x7FFFFFFF read negative: the recorder's pointer test is loosened here, nothing else changes.
// PLAYTEST_FIXTURE=write npx vitest run tests/playtestLua.test.ts writes tests/fixtures/playtest-rooftop.jsonl again.
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from 'fengari'
import { exportFactLines, parsePlaytest, type GameFrame } from '../src/lib/playtest'

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

function play(o: { windows?: boolean; scenario?: string; note?: string | null; mod?: string | null; keep?: number; index?: string | null } = {}) {
  const r = runLua(read('tests/fixtures/playtest-harness.lua'), {
    PLAYTEST_SRC: recorder(o.windows ?? true), NOTE: o.note === undefined ? note : o.note, MOD_FOLDER: o.mod === undefined ? MOD : o.mod,
    SCENARIO: o.scenario ?? 'rooftop', KEEP: o.keep ?? 20, INDEX: o.index ?? null,
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

  it('finds the same falls, stuck spots and marks with a clock of whole seconds (a Mac)', () => {
    const kinds = (text: string) => parsePlaytest(text).events.filter((e) => e.ev !== 'pos')
    const pc = kinds(play().files['playtest/rooftop-20261027-180211.jsonl'])
    const mac = kinds(play({ windows: false }).files['playtest/rooftop-20261027-180211.jsonl'])
    expect(mac.map((e) => e.ev)).toEqual(pc.map((e) => e.ev))
    expect(mac.map((e) => e.ev)).toEqual(expect.arrayContaining(['stuck', 'fall', 'mark']))
    mac.forEach((e, i) => expect(Math.abs(e.t - pc[i].t)).toBeLessThan(0.1))
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
