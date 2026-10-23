import { describe, expect, it } from 'vitest'
import { INTERIOR2_PREFABS } from '../src/lib/prefabsInteriors2'
import { GAMEPLAY_PREFABS } from '../src/lib/prefabsGameplay'
import { PREFABS } from '../src/lib/prefabs'
import { MORE_PREFABS } from '../src/lib/prefabsMore'
import { INTERIOR_PREFABS } from '../src/lib/prefabsInterior'
import { PHYSICS_PREFABS } from '../src/lib/prefabsPhysics'
import { ROAD_PREFABS } from '../src/lib/roads'
import { prefabParams } from '../src/lib/prefabs'

const NEW = { ...INTERIOR2_PREFABS, ...GAMEPLAY_PREFABS }

describe('interior and gameplay prefabs', () => {
  it('use keys no other prefab file has', () => {
    const others = new Set([PREFABS, MORE_PREFABS, INTERIOR_PREFABS, PHYSICS_PREFABS, ROAD_PREFABS].flatMap((m) => Object.keys(m)))
    for (const k of Object.keys(INTERIOR2_PREFABS)) expect(others.has(k) || k in GAMEPLAY_PREFABS, k).toBe(false)
    for (const k of Object.keys(GAMEPLAY_PREFABS)) expect(others.has(k), k).toBe(false)
  })

  // Players walk up steps of 0.3 m (0.6 units) at most; anything taller needs a jump.
  for (const [key, def] of Object.entries(NEW)) {
    it(`${key}: stairs are walkable at every setting's extremes`, () => {
      const settings = [{}, ...(def.params ?? []).filter((d) => d.kind === 'number').flatMap((d) => [{ [d.key]: d.min! }, { [d.key]: d.max! }])]
      for (const s of settings) {
        for (const p of def.make(0, 0, 0, 1, prefabParams(def, s))) {
          if (p.kind !== 'stairs') continue
          expect(p.size[1] / (p.segments ?? 8), `${p.label} step rise with ${JSON.stringify(s)}`).toBeLessThanOrEqual(0.6 + 1e-6)
        }
      }
    })
  }
})
