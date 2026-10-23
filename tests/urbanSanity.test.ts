// The urban sample maps make sense to someone walking them: see urbanCheck.ts.
// REPORT=1 npx vitest run tests/urbanSanity.test.ts prints every finding.
import { describe, expect, it } from 'vitest'
import { SAMPLES, sampleFor } from '../src/lib/samples'
import { PB } from '../src/lib/sampleKit'
import { U } from '../src/lib/urbanKit'
import { ROAD_TEX } from '../src/lib/roads'
import { URBAN_AMBIENCE, URBAN_EXTRA } from '../src/lib/sampleDress'
import { ALL_PREFABS } from '../src/lib/prefabRegistry'
import { AMBIENCE_OPTIONS } from '../src/lib/mapFeatures'
import { inspect, roadTextures, triangles } from './urbanCheck'

roadTextures(U.road, U.roadLine, U.roadWhite, PB.asphalt, PB.oldAsphalt, ROAD_TEX.asphalt)

const URBAN = SAMPLES.filter((s) => s.theme === 'Urban')

describe('urban maps make sense', () => {
  for (const s of URBAN) {
    it(`${s.name}: nothing out of place`, () => {
      const built = sampleFor(s.id)
      const found = inspect(built)
      if (process.env.REPORT) console.log(`\n== ${s.id} (${triangles(built).toLocaleString()} triangles, ${built.parts.length} parts)\n` + found.map((f) => `  [${f.rule}] ${f.what} at ${f.at.join(', ')}: ${f.detail}`).join('\n'))
      expect(found.map((f) => `[${f.rule}] ${f.what} at ${f.at.join(', ')}: ${f.detail}`)).toEqual([])
      // Lived in, but still light enough to export and play.
      expect(triangles(built)).toBeLessThan(60000)
      expect(built.ambience, 'background sound').toBeTruthy()
    })
  }

  it('dressing lists name real prefabs and places, and every map has one', () => {
    const places = new Set(['wall', 'front', 'side', 'kerb', 'verge', 'park', 'gutter', 'road', 'open', 'roof'])
    for (const s of URBAN) {
      expect(URBAN_EXTRA[s.id], s.id).toBeTruthy()
      expect(AMBIENCE_OPTIONS.some((o) => o.file === URBAN_AMBIENCE[s.id]), s.id).toBe(true)
      for (const e of URBAN_EXTRA[s.id]) {
        const m = /^([a-z]+)(?:@([a-z]+))?(?:\*(\d+))?$/.exec(e)
        expect(m && ALL_PREFABS[m[1]], `${s.id}: ${e}`).toBeTruthy()
        if (m?.[2]) expect(places.has(m[2]), `${s.id}: ${e}`).toBe(true)
      }
    }
  })
})
