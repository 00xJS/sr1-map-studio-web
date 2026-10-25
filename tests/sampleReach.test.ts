// Every sample map's spawns, weapons and drop-offs stand where players can use them: on the floor players get round
// both ways (up stairs, a ramp or a jump, and back down without a fall). A spawn on a roof with no way up leaves its
// player to camp there or fall; a gun on a deck nobody can climb is never picked up.
import { describe, expect, it } from 'vitest'
import { SAMPLES, sampleFor } from '../src/lib/samples'
import { sampleInput } from '../src/lib/analysis'
import { prepareMap } from '../src/lib/analysis/analyze'

describe('sample maps: spawns and weapons players can use', () => {
  for (const s of SAMPLES) {
    it(s.name, () => {
      const p = prepareMap(sampleInput(sampleFor(s.id)), { cell: 2 })
      expect(p.unreachable.map((u) => `${u.type} at ${u.position.map((v) => Math.round(v)).join(',')}: ${u.why}`)).toEqual([])
    })
  }
})
