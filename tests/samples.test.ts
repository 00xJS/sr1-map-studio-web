import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SAMPLES } from '../src/lib/samples'
import { checkModes } from '../src/lib/levels'
import { KINDS } from '../src/lib/procedural'
import { newMarker } from '../src/lib/project'
import { catalogs } from '../src/lib/catalogs'
import type { Part } from '../src/lib/sampleKit'

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

/** Inside a part's footprint (as seen from above), grown by `margin` (negative shrinks it). */
function over(p: Part, x: number, z: number, margin: number) {
  const t = ((p.rot ?? 0) * Math.PI) / 180
  const dx = x - p.at[0], dz = z - p.at[2]
  const lx = dx * Math.cos(t) - dz * Math.sin(t)
  const lz = dx * Math.sin(t) + dz * Math.cos(t)
  const rx = p.size[0] / 2 + margin, rz = p.size[2] / 2 + margin
  if (rx <= 0 || rz <= 0) return false
  if (p.kind === 'cylinder') return (lx / rx) ** 2 + (lz / rz) ** 2 <= 1
  return Math.abs(lx) <= rx && Math.abs(lz) <= rz
}

describe('sample marker placement', () => {
  for (const s of SAMPLES) {
    it(`${s.name}: every marker stands on a floor with head room`, () => {
      const problems: string[] = []
      for (const [type, [x, y, z]] of s.markers) {
        const where = `${type} at ${[x, y, z].join(', ')}`
        // Something flat (a box or a column top) right under it, at its height.
        const floor = s.parts.some((p) => (p.kind === 'box' || p.kind === 'cylinder') && Math.abs(p.at[1] + p.size[1] - y) < 0.01 && over(p, x, z, -0.2))
        if (!floor) problems.push(`${where}: nothing to stand on`)
        // Nothing within half a unit of it from its feet to head height (about 3.4 units).
        const blocked = s.parts.find((p) => p.at[1] < y + 3.4 && p.at[1] + p.size[1] > y + 0.01 && over(p, x, z, 0.5))
        if (blocked) problems.push(`${where}: inside ${blocked.label} at ${blocked.at.join(', ')}`)
      }
      expect(problems).toEqual([])
    })
  }

  it('has 25 paintball and cyber maps with unique ids', () => {
    expect(SAMPLES.filter((s) => s.theme !== 'Starter')).toHaveLength(25)
    expect(new Set(SAMPLES.map((s) => s.id)).size).toBe(SAMPLES.length)
  })
})
