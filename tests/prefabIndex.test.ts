import { describe, expect, it } from 'vitest'
import { ALL_PREFABS } from '../src/lib/prefabRegistry'
import { hashText, prefabCategories, prefabEntries, prefabParts, searchPrefabs } from '../src/lib/prefabIndex'

const labels = (q: string) => searchPrefabs(prefabEntries(), q).map((e) => e.label)

describe('prefab browser index', () => {
  it('lists every registered prefab once, in a listed category', () => {
    const entries = prefabEntries()
    expect(entries.map((e) => e.shape).sort()).toEqual(Object.keys(ALL_PREFABS).map((k) => 'prefab:' + k).sort())
    const cats = prefabCategories()
    for (const e of entries) expect(cats, e.shape).toContain(e.category)
    expect(new Set(cats).size).toBe(cats.length)
  })

  it('every prefab builds the same parts each time (thumbnail cache key)', () => {
    for (const key of Object.keys(ALL_PREFABS)) {
      const a = prefabParts(key)
      expect(a.length, key).toBeGreaterThan(0)
      for (const p of a) expect([...p.size, ...p.at].every(Number.isFinite), `${key}: ${p.label}`).toBe(true)
      expect(hashText(JSON.stringify(prefabParts(key))), key).toBe(hashText(JSON.stringify(a)))
    }
  })

  it('search finds by name, hint, category and plural, best match first', () => {
    expect(labels('car')[0]).toBe('Car')
    expect(labels('trees')).toContain('Tree')
    expect(labels('Street')).toContain('Bench')
    expect(labels('roll-up door')).toContain('Warehouse')
    expect(labels('zzzz nothing')).toEqual([])
    expect(searchPrefabs(prefabEntries(), '  ')).toHaveLength(prefabEntries().length)
  })
})
