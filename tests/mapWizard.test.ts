import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LAYOUTS, SETTINGS, wizardLayout, wizardSample, type WizardLayout, type WizardSetting } from '../src/lib/mapWizard'
import { checkModes } from '../src/lib/levels'
import { KINDS } from '../src/lib/procedural'
import { newMarker } from '../src/lib/project'
import { catalogs } from '../src/lib/catalogs'
import { blocker, mapSize, support } from '../src/lib/sampleScale'

const library = new Set((JSON.parse(readFileSync('public/textures/index.json', 'utf8')).textures as { id: string }[]).map((t) => t.id))
const weapons = new Set(catalogs.weapons.map(([, id]) => id))

describe('new map wizard', () => {
  for (const setting of Object.keys(SETTINGS) as WizardSetting[]) for (const layout of Object.keys(LAYOUTS) as WizardLayout[]) {
    it(`${setting} / ${layout}: fair, playable maps for every seed`, () => {
      // The last one is the top of the busy scale, about three times Packed.
      for (const [seed, players, density, busy] of [[1, 12, 'normal', undefined], [77, 8, 'packed', undefined], [4242, 4, 'open', undefined], [9001, 10, 'packed', 100]] as const) {
        const o = { setting, layout, players, density, seed, busy }
        const s = wizardSample(o)
        const where = `seed ${seed}`
        const problems: string[] = []
        for (const [type, p, patch] of s.markers) {
          if (support(s.parts, p) < 0) problems.push(`${type} at ${p.join(', ')}: nothing to stand on`)
          const b = blocker(s.parts, p)
          if (b) problems.push(`${type} at ${p.join(', ')}: inside ${b.label}`)
          if (type === 'Weapon pickup') expect(weapons.has(patch!.weapon!), patch!.weapon).toBe(true)
        }
        expect(problems, where).toEqual([])
        for (const p of s.parts) for (const t of [p.top, p.side]) {
          if ('lib' in t) expect(library.has(t.lib), t.lib).toBe(true)
          else expect('gen' in t && KINDS[t.gen]).toBeTruthy()
        }
        const count = (t: string) => s.markers.filter(([m]) => m === t).length
        expect(count('Red team spawn'), where).toBe(count('Blue team spawn'))
        expect(count('Red team spawn'), where).toBeGreaterThanOrEqual(4)
        expect(count('Shared spawn'), where).toBeGreaterThanOrEqual(8)
        expect(count('Weapon pickup'), where).toBeGreaterThanOrEqual(10)
        const markers = s.markers.map(([type, at, patch]) => ({ ...newMarker(type, at), ...patch }))
        expect(checkModes({ modes: s.modes }, markers).errors, where).toEqual([])
        expect(s.lights?.length ?? 0).toBeLessThanOrEqual(catalogs.limits.max_lights)
        // Sized for the players asked for (the size check counts at most 12).
        expect(Math.abs(mapSize(s).players - Math.min(12, players)), where).toBeLessThanOrEqual(3)
      }
    })
  }

  it('the same seed gives the same map, a new seed a different one', () => {
    const o = { setting: 'downtown', layout: 'blocks', players: 10, density: 'normal', seed: 5 } as const
    expect(JSON.stringify(wizardLayout(o))).toBe(JSON.stringify(wizardLayout({ ...o })))
    expect(JSON.stringify(wizardLayout(o))).not.toBe(JSON.stringify(wizardLayout({ ...o, seed: 6 })))
  })
})
