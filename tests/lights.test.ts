// Default light ranges (src/lib/project.ts): the game's own, in metres, turned into editor units by the map's world
// scale. The exporter writes inner_range and range times the world scale (py/retail_records.py; checked against
// retail lights by tests/retail_records_check.py).
import { describe, expect, it } from 'vitest'
import { LIGHT_RANGES, newLight, newProject } from '../src/lib/project'
import { catalogs } from '../src/lib/catalogs'

const metres = (l: { inner_range: number; range: number }, scale: number) => [l.inner_range * scale, l.range * scale].map((v) => +v.toFixed(2))

describe('light ranges', () => {
  it('new lights are retail interior lights: full bright to 1 m, dark at 3 m', () => {
    const scale = newProject().settings.world_scale
    expect(metres(newLight(), scale)).toEqual([1, 3])
    expect(LIGHT_RANGES.interior).toEqual([1, 3])
  })

  it('street lamps are 11 / 17 m, as the game\'s lampPostStLightA', () => {
    expect(metres(newLight([0, 8, 0], 'lamp'), 0.5)).toEqual([11, 17])
    expect(newLight([0, 8, 0], 'lamp').name).toBe('Street lamp')
  })

  it('follow the map\'s world scale', () => {
    expect(metres(newLight([0, 3, 0], 'interior', 1), 1)).toEqual([1, 3])
    expect(metres(newLight([0, 3, 0], 'lamp', 0.25), 0.25)).toEqual([11, 17])
    expect(newLight([0, 3, 0], 'interior', 1)).toMatchObject({ inner_range: 1, range: 3 })
  })

  it('the exporter\'s own default (the bundled catalog) is the same light', () => {
    const l = newLight()
    expect(catalogs.new_light).toMatchObject({ inner_range: l.inner_range, range: l.range })
  })
})
