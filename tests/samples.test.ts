import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SAMPLES, sampleFor } from '../src/lib/samples'
import { checkModes } from '../src/lib/levels'
import { KINDS } from '../src/lib/procedural'
import { newMarker } from '../src/lib/project'
import { catalogs } from '../src/lib/catalogs'
import { blocker, support } from '../src/lib/sampleScale'

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
          else expect('gen' in t && KINDS[t.gen]).toBeTruthy()
        }
      }
      expect(s.lights?.length ?? 0).toBeLessThanOrEqual(catalogs.limits.max_lights)
    })

    it(`${s.name}: ready for its game modes`, () => {
      // The map as players get it: spawns, weapons and drop-offs filled in.
      const markers = sampleFor(s.id).markers.map(([type, at, patch]) => ({ ...newMarker(type, at), ...patch }))
      const { errors, warnings } = checkModes({ modes: s.modes }, markers)
      expect(errors).toEqual([])
      expect(warnings.filter((w) => !w.includes('Retail PTP maps use 6 per team'))).toEqual([])
    })
  }
})

describe('sample marker placement', () => {
  const builds = SAMPLES.flatMap((s) => [
    { name: `${s.name} (full)`, s: sampleFor(s.id) },
    ...((s.size ?? 'compact') === 'compact' ? [{ name: `${s.name} (compact)`, s: sampleFor(s.id, true) }] : []),
  ])
  for (const { name, s } of builds) {
    it(`${name}: every marker stands on a floor with head room`, () => {
      const problems: string[] = []
      for (const [type, p] of s.markers) {
        const where = `${type} at ${p.join(', ')}`
        if (support(s.parts, p) < 0) problems.push(`${where}: nothing to stand on`)
        const b = blocker(s.parts, p)
        if (b) problems.push(`${where}: inside ${b.label} at ${b.at.join(', ')}`)
      }
      expect(problems).toEqual([])
    })

    it(`${name}: plenty of spawns and weapons, ready for its modes`, () => {
      const count = (t: string) => s.markers.filter(([m]) => m === t).length
      const markers = s.markers.map(([type, at, patch]) => ({ ...newMarker(type, at), ...patch }))
      expect(checkModes({ modes: s.modes }, markers).errors).toEqual([])
      expect(count('Red team spawn')).toBe(count('Blue team spawn'))
      expect(count('Red team spawn')).toBeGreaterThanOrEqual(6)
      expect(count('Shared spawn')).toBeGreaterThanOrEqual(8)
      expect(count('Weapon pickup')).toBeGreaterThanOrEqual(10)
      // The drop-off moves between 4 spots, as on the game's own maps; maps without a Chains mode get none.
      if (s.modes.some((m) => m.includes('Chains'))) expect(count('Chains drop-off')).toBeGreaterThanOrEqual(4)
      else expect(count('Chains drop-off')).toBe(0)
      expect(s.lights?.length ?? 0).toBeLessThanOrEqual(64)
    })
  }

  it('has at least 25 urban, 13 paintball and 12 cyber maps with unique ids', () => {
    expect(SAMPLES.filter((s) => s.theme === 'Urban').length).toBeGreaterThanOrEqual(25)
    expect(SAMPLES.filter((s) => s.theme === 'Urban paintball')).toHaveLength(13)
    expect(SAMPLES.filter((s) => s.theme === 'Cyber')).toHaveLength(12)
    expect(new Set(SAMPLES.map((s) => s.id)).size).toBe(SAMPLES.length)
  })
})

describe('placed prefabs', () => {
  it('every prefab in every sample is tagged where its parts are (so editing rebuilds it in place)', () => {
    const problems: string[] = []
    for (const s of SAMPLES) {
      const groups = new Map<string, typeof s.parts>()
      for (const p of sampleFor(s.id).parts) if (p.prefab && p.group) groups.set(p.group, [...(groups.get(p.group) ?? []), p])
      for (const [g, parts] of groups) {
        const tag = parts[0].prefab!
        const near = Math.min(...parts.map((p) => Math.hypot(p.at[0] - tag.at[0], p.at[2] - tag.at[2])))
        if (near > 40) problems.push(`${s.id}: ${g} tagged ${near.toFixed(0)} units from its parts`)
      }
    }
    expect(problems).toEqual([])
  })
})
