import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8 } from 'fflate'
import { STRING_LANGUAGES, helpText, packageMetadata } from '../src/lib/exporter'
import { AMBIENCE_OPTIONS, BREAKING_PRESETS, MOVABLE_PRESETS } from '../src/lib/mapFeatures'
import { POOL_FLOOR, POOL_FREEBOARD, POOL_MAX_DEPTH, poolParts } from '../src/lib/prefabsMore'
import { ALL_PREFABS } from '../src/lib/prefabRegistry'

const utf16 = (b: Uint8Array) => {
  expect([b[0], b[1]]).toEqual([0xff, 0xfe])
  let s = ''
  for (let i = 2; i < b.length; i += 2) s += String.fromCharCode(b[i] | (b[i + 1] << 8))
  return s
}

describe('menu text', () => {
  const files = packageMetadata('My Map', 'mymap', 'My Map', { modes: ['Gangsta Brawl'], always_clear_weather: true }, [], 'Two towers.\nA bridge = fun.')

  it('writes a help page that names the map strings and has no level ID', () => {
    const help = strFromU8(files['My Map/levels/help_screens.xtbl'])
    expect(help).toContain('<Name>level_mymap</Name>')
    expect(help).toContain('<OnPage>MPLevel</OnPage>')
    expect(help).toContain('<DisplayName>MULTI_LEVEL_mymap</DisplayName>')
    expect(help).toContain('<DisplayText>HELP_TEXT_MYMAP_LEVEL</DisplayText>')
    expect(help).toContain('<DisplayMask>Multi</DisplayMask>')
    expect(help).not.toContain('<ID>')
    expect(help.split('\r\n')[0]).toBe('<root>')
  })

  it('writes the same strings for every game language, with the description as help text', () => {
    const want = ['BINTEXT', '', 'MULTI_LEVEL_mymap=My Map', 'HELP_TEXT_MYMAP_LEVEL=Two towers. A bridge fun.', '             2', ''].join('\r\n')
    for (const lang of STRING_LANGUAGES) expect(utf16(files[`My Map/levels/${lang}_strings.txt`])).toBe(want)
    expect(Object.keys(files).filter((f) => f.endsWith('_strings.txt'))).toHaveLength(6)
  })

  it('falls back to a short help text without a description', () => {
    expect(helpText('My Map', '')).toBe('My Map: a custom map made with SR1 Map Studio.')
    expect(helpText('X', 'a\r\nb')).toBe('a b')
  })
})

describe('presets match the exporter', () => {
  const py = readFileSync(join(__dirname, '..', 'py', 'map_features.py'), 'utf8')
  const block = (name: string) => { const start = py.indexOf(name + ' = ('); return py.slice(start, py.indexOf(')', start)) }
  const dictKeys = (name: string) => {
    const start = py.indexOf(name + ' = {')
    return [...py.slice(start, py.indexOf('\n}', start)).matchAll(/^\s+(['"])(.+?)\1:/gm)].map((m) => m[2])
  }

  it('offers exactly the profiles the exporter accepts', () => {
    expect(MOVABLE_PRESETS.map(([p]) => p)).toEqual(dictKeys('MOVABLE_PROFILES'))
    expect(BREAKING_PRESETS.map(([p]) => p)).toEqual(dictKeys('BREAKING_PROFILES'))
  })

  it('offers exactly the background sounds the exporter accepts', () => {
    const files = [...block('AMBIENCE_FILES').matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])
    expect(AMBIENCE_OPTIONS.map((o) => o.file)).toEqual(files)
  })
})

describe('swimming pool', () => {
  const L = (dx: number, dy: number, dz: number): [number, number, number] => [dx, dy, dz]

  it('has one water part filling the basin up to just under the rim', () => {
    for (const depth of [3, 4, POOL_MAX_DEPTH]) {
      const parts = poolParts(L, 16, 24, depth)
      const water = parts.filter((p) => p.water)
      expect(water).toHaveLength(1)
      const rim = Math.max(...parts.filter((p) => p.label === 'Pool wall').map((p) => p.at[1] + p.size[1]))
      expect(water[0].at[1]).toBe(POOL_FLOOR)
      expect(water[0].at[1] + water[0].size[1]).toBeCloseTo(rim - POOL_FREEBOARD)
      // Players climb ledges up to about 3 m (6 units) by themselves.
      expect(rim).toBeLessThanOrEqual(6)
      // Every step is a small one.
      for (const s of parts.filter((p) => p.kind === 'stairs')) expect(s.size[1] / (s.segments ?? 8)).toBeLessThanOrEqual(0.5)
      // The water texture is used by nothing else, so only the water is swimmable.
      const key = JSON.stringify(water[0].top)
      expect(parts.filter((p) => !p.water).some((p) => JSON.stringify(p.top) === key || JSON.stringify(p.side) === key)).toBe(false)
    }
  })

  it('is offered as a prefab, and the pond says why it is not swimmable', () => {
    expect(ALL_PREFABS.pool.label).toBe('Swimming pool')
    expect(ALL_PREFABS.pool.make(0, 0, 0, 0).filter((p) => p.water)).toHaveLength(1)
    expect(ALL_PREFABS.pond.hint).toMatch(/swim/i)
    expect(ALL_PREFABS.pond.make(0, 0, 0, 0).some((p) => p.water)).toBe(false)
  })
})
