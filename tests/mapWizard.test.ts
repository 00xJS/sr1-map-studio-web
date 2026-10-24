import { describe, expect, it } from 'vitest'
import { wizardLayout } from '../src/lib/mapWizard'
import { wizardMatrix } from './wizardMatrix'

describe('new map wizard', () => {
  // A quarter of the settings × layouts; mapWizard2-4.test.ts check the rest.
  wizardMatrix(0)

  it('the same seed gives the same map, a new seed a different one', () => {
    const o = { setting: 'downtown', layout: 'blocks', players: 10, density: 'normal', seed: 5 } as const
    expect(JSON.stringify(wizardLayout(o))).toBe(JSON.stringify(wizardLayout({ ...o })))
    expect(JSON.stringify(wizardLayout(o))).not.toBe(JSON.stringify(wizardLayout({ ...o, seed: 6 })))
  })
})

describe('the rundown setting', () => {
  it('builds with every layout, with derelict buildings, wrecks and trash', async () => {
    const { wizardSample, LAYOUTS } = await import('../src/lib/mapWizard')
    for (const layout of Object.keys(LAYOUTS) as (keyof typeof LAYOUTS)[]) {
      const s = wizardSample({ setting: 'rundown', layout, players: 8, density: 'packed', seed: 11 })
      expect(s.markers.some(([t]) => t === 'Shared spawn'), layout).toBe(true)
      expect(s.parts.length, layout).toBeGreaterThan(50)
    }
    const s = wizardSample({ setting: 'rundown', layout: 'neighbourhood', players: 10, density: 'packed', seed: 3 })
    const tags = new Set(s.parts.map((p) => p.prefab?.key).filter(Boolean))
    expect(['boardedhouse', 'burnedshell', 'boardedstore', 'srtenement'].some((k) => tags.has(k))).toBe(true)
  })

  it('is what a ghetto or abandoned map asks for, and a neighbourhood is not', async () => {
    const { heuristicPlan } = await import('../src/lib/aiReview')
    expect(heuristicPlan('a Ghetto map with abandoned buildings').options.setting).toBe('rundown')
    expect(heuristicPlan('burned-out projects for 6 players').options.setting).toBe('rundown')
    expect(heuristicPlan('a quiet neighbourhood with parks').options.setting).not.toBe('rundown')
  })
})
