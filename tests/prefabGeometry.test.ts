// Every prefab's parts and parameters, hashed: refactoring the prefab packs must not change a single piece.
// If a prefab is changed on purpose, update the snapshot with `npx vitest run -u tests/prefabGeometry.test.ts`.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ALL_PREFABS } from '../src/lib/prefabRegistry'
import { prefabParams } from '../src/lib/prefabs'

describe('prefab geometry', () => {
  it('builds the same parts as before for every prefab', () => {
    const hashes: Record<string, string> = {}
    for (const [key, def] of Object.entries(ALL_PREFABS).sort(([a], [b]) => a.localeCompare(b))) {
      const parts = def.make(3, -7, 30, 1, prefabParams(def))
      hashes[key] = createHash('sha256').update(JSON.stringify({ parts, params: def.params ?? null, label: def.label, hint: def.hint })).digest('hex').slice(0, 16)
    }
    expect(Object.keys(hashes).length).toBeGreaterThan(600)
    expect(hashes).toMatchSnapshot()
  })
})
