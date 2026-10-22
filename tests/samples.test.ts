import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SAMPLES } from '../src/lib/samples'
import { checkModes } from '../src/lib/levels'
import { KINDS } from '../src/lib/procedural'
import { newMarker } from '../src/lib/project'
import { catalogs } from '../src/lib/catalogs'

const library = new Set((JSON.parse(readFileSync('public/textures/index.json', 'utf8')).textures as { id: string }[]).map((t) => t.id))
const weapons = new Set(catalogs.weapons.map(([, id]) => id))

describe('sample maps', () => {
  for (const s of SAMPLES) {
    it(`${s.name}: valid markers, weapons and textures`, () => {
      for (const [type, , patch] of s.markers) {
        expect(catalogs.marker_types).toContain(type)
        if (type === 'Weapon pickup') expect(weapons.has(patch!.weapon!), patch!.weapon).toBe(true)
      }
      for (const p of s.parts) {
        for (const t of [p.top, p.side]) {
          if ('lib' in t) expect(library.has(t.lib), t.lib).toBe(true)
          else expect(KINDS[t.gen]).toBeTruthy()
        }
      }
      expect(s.lights?.length ?? 0).toBeLessThanOrEqual(catalogs.limits.max_lights)
    })

    it(`${s.name}: ready for its game modes`, () => {
      const markers = s.markers.map(([type, at, patch]) => ({ ...newMarker(type, at), ...patch }))
      const { errors, warnings } = checkModes({ modes: s.modes }, markers)
      expect(errors).toEqual([])
      expect(warnings.filter((w) => !w.includes('Retail PTP maps use 6 per team'))).toEqual([])
    })
  }
})
