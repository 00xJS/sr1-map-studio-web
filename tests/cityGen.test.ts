import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CITY_SIZES, DISTRICTS, citySample, type CitySize } from '../src/lib/cityGen'
import { blocker, support } from '../src/lib/sampleScale'
import { checkModes } from '../src/lib/levels'
import { newMarker } from '../src/lib/project'
import { KINDS } from '../src/lib/procedural'
import { catalogs } from '../src/lib/catalogs'

const library = new Set((JSON.parse(readFileSync('public/textures/index.json', 'utf8')).textures as { id: string }[]).map((t) => t.id))

describe('the Stilwater-style city', () => {
  for (const size of Object.keys(CITY_SIZES) as CitySize[]) {
    it(`${size}: every marker on the street with head room, modes ready, textures and lights valid`, () => {
      for (const seed of [1, 42]) {
        const s = citySample({ size, seed })
        const problems = s.markers.filter(([, p]) => support(s.parts, p) < 0 || blocker(s.parts, p)).map(([t, p]) => `${t} at ${p}`)
        expect(problems, `seed ${seed}`).toEqual([])
        const markers = s.markers.map(([type, at, patch]) => ({ ...newMarker(type, at), ...patch }))
        expect(checkModes({ modes: s.modes }, markers).errors).toEqual([])
        for (const p of s.parts) for (const t of [p.top, p.side]) {
          if ('lib' in t) expect(library.has(t.lib), t.lib).toBe(true)
          else expect('gen' in t && KINDS[t.gen], JSON.stringify(t)).toBeTruthy()
        }
        expect(s.lights!.length).toBeLessThanOrEqual(catalogs.limits.max_lights)
        expect(s.parts.some((p) => p.water)).toBe(true)
      }
    })
  }

  it('a city has every district, and the same seed gives the same city', () => {
    for (const size of ['city', 'big'] as const) for (const seed of [1, 2, 3, 4, 5, 6, 9]) {
      const s = citySample({ size, seed })
      const lots = new Set(s.parts.map((p) => p.label).filter((l) => / lot$/.test(l)))
      for (const d of Object.values(DISTRICTS)) expect(lots, `${size} seed ${seed}: ${d.label}`).toContain(`${d.label} lot`)
    }
    expect(JSON.stringify(citySample({ size: 'town', seed: 3 }))).toBe(JSON.stringify(citySample({ size: 'town', seed: 3 })))
    expect(JSON.stringify(citySample({ size: 'town', seed: 3 }))).not.toBe(JSON.stringify(citySample({ size: 'town', seed: 4 })))
  })
})
