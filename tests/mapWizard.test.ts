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
