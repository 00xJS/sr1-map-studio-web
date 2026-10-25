// The identity of a game model (src/lib/gameObjects/identity.ts): the contract the library and the new-map wizard
// share. These pin its shape and the first version's rules; the indexing overhaul may change the rules, not the shape.
import { describe, expect, it } from 'vitest'
import { identify } from '../src/lib/gameObjects/identity'
import type { GameObjectEntry } from '../src/lib/gameObjects/indexer'

const entry = (p: Partial<GameObjectEntry>): GameObjectEntry => ({
  id: 'x', name: 'thing', cat: 'Other', profile: '', pack: 'sr_city_stream', chunk: 'c1', record: 0, size: [1, 1, 1], tris: 12, tex: [], seen: 1, ...p,
})

describe('game model identity', () => {
  it('gives every model a role, a name and the settings it suits', () => {
    const id = identify(entry({ name: 'barrelc', cat: 'Containers and crates', tex: ['barrel_rust_me.tga'] }))
    expect(id.role).toBe('prop')
    expect(id.kind).toBe('cover')
    expect(id.name.length).toBeGreaterThan(0)
    expect(Array.isArray(id.settings)).toBe(true)
  })

  it('never places invisible blockers or sky, and keeps building pieces out of the scatter', () => {
    expect(identify(entry({ name: 'blocker', tex: ['missing-alpha.tga'] })).role).toBe('skip')
    expect(identify(entry({ name: 'sky', cat: 'Water and sky' })).role).toBe('skip')
    expect(identify(entry({ name: 'wallpiece', cat: 'Building pieces' })).role).toBe('piece')
  })

  it('gives buildings their footprint, height and storeys', () => {
    const id = identify(entry({ name: 'abcd1a', cat: 'Buildings', size: [33, 19, 10] }))
    expect(id.role).toBe('building')
    expect(id.building).toEqual({ footprint: [33, 19], height: 10, storeys: 3 })
  })
})
