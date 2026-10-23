import { describe, expect, it } from 'vitest'
import { SAMPLES, sampleFor } from '../src/lib/samples'
import { sanity } from './mapSanity'

const CYBER = SAMPLES.filter((s) => s.theme === 'Cyber')

describe('cyber map layouts make sense', () => {
  for (const s of CYBER) {
    for (const compact of [false, true]) {
      it(`${s.name} (${compact ? 'compact' : 'full'})`, () => {
        const found = sanity(sampleFor(s.id, compact))
        if (process.env.SANITY_LOG) console.log(`\n### ${s.id} ${compact ? 'compact' : 'full'}\n` + Object.entries(found).flatMap(([k, v]) => v.map((x) => `[${k}] ${x}`)).join('\n'))
        expect(found).toEqual(Object.fromEntries(Object.keys(found).map((k) => [k, []])))
      })
    }
  }
})
