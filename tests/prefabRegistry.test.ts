import { describe, expect, it } from 'vitest'
import { ALL_PREFABS, PREFAB_CATEGORIES } from '../src/lib/prefabRegistry'
import { PREFABS } from '../src/lib/prefabs'
import { MORE_PREFABS } from '../src/lib/prefabsMore'
import { INTERIOR_PREFABS } from '../src/lib/prefabsInterior'
import { PHYSICS_PREFABS } from '../src/lib/prefabsPhysics'
import { NATURE_PREFABS } from '../src/lib/prefabsNature'
import { VEHICLE_PREFABS } from '../src/lib/prefabsVehicles'
import { INDUSTRIAL_PREFABS } from '../src/lib/prefabsIndustrial'
import { INTERIOR2_PREFABS } from '../src/lib/prefabsInteriors2'
import { GAMEPLAY_PREFABS } from '../src/lib/prefabsGameplay'
import { ROAD_PREFABS } from '../src/lib/roads'
import { BUILDING_PREFABS } from '../src/lib/prefabsBuildings'
import { CYBER_LIFE_PREFABS } from '../src/lib/prefabsCyberLife'
import { LIFE_PREFABS } from '../src/lib/prefabsPaintballLife'

// Prefab packs are written separately and merged into one registry, where a later pack would
// silently replace an earlier one's piece of the same name.
const PACKS: Record<string, Record<string, unknown>> = {
  PREFABS, MORE_PREFABS, INTERIOR_PREFABS, PHYSICS_PREFABS, NATURE_PREFABS, VEHICLE_PREFABS, INDUSTRIAL_PREFABS,
  INTERIOR2_PREFABS, GAMEPLAY_PREFABS, ROAD_PREFABS, BUILDING_PREFABS, CYBER_LIFE_PREFABS, LIFE_PREFABS,
}

describe('prefab registry', () => {
  it('no two packs define the same prefab', () => {
    const seen = new Map<string, string>(), clashes: string[] = []
    for (const [pack, defs] of Object.entries(PACKS)) for (const k of Object.keys(defs)) {
      if (seen.has(k)) clashes.push(`${k}: ${seen.get(k)} and ${pack}`)
      else seen.set(k, pack)
    }
    expect(clashes).toEqual([])
  })

  it('every prefab is in a listed category, and every category has prefabs', () => {
    const used = new Set(Object.values(ALL_PREFABS).map((p) => p.category))
    expect([...used].filter((c) => !PREFAB_CATEGORIES.includes(c))).toEqual([])
    expect(PREFAB_CATEGORIES.filter((c) => !used.has(c))).toEqual([])
    expect(new Set(PREFAB_CATEGORIES).size).toBe(PREFAB_CATEGORIES.length)
  })
})
