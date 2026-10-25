// The shared shapes for building maps from Stilwater (src/lib/gameObjects/cityModules.ts). Pins the contract's
// starting behaviour; the phases fill these in and add their own tests.
import { describe, expect, it } from 'vitest'
import { cityModules, groups, placementOf } from '../src/lib/gameObjects/cityModules'
import type { GameObjectEntry } from '../src/lib/gameObjects/indexer'

const entry: GameObjectEntry = { id: 'x', name: 'barrelc', cat: 'Containers and crates', profile: '', pack: 'sr_city_stream', chunk: 'c1', record: 0, size: [1, 1, 1], tris: 12, tex: [], seen: 1 }

describe('city modules contract', () => {
  it('answers with the agreed shapes', () => {
    expect(Array.isArray(cityModules([entry]))).toBe(true)
    expect(Array.isArray(groups([entry]))).toBe(true)
    const rule = placementOf(entry)
    expect(['ground', 'wall', 'roof', 'hang', 'building']).toContain(rule.attach)
    expect(Array.isArray(rule.mayVary)).toBe(true)
  })
})
