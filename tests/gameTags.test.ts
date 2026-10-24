// Tags, descriptions and themed picks for the "From my game" library.
import { describe, expect, it } from 'vitest'
import { describeEntry, displayName, tagsFor, tagsOf, textTags, varietyPick } from '../src/lib/gameObjects/tags'
import type { GameObjectEntry } from '../src/lib/gameObjects/indexer'

let n = 0
const entry = (name: string, cat: string, size: [number, number, number], tex: string[] = [], seen = 5, extra: Partial<GameObjectEntry> = {}): GameObjectEntry =>
  ({ id: 'e' + n++, name, cat, profile: '', pack: 'sr_city_stream', chunk: 'c', record: 0, size, tris: 10, tex, seen, ...extra })

describe('game object tags', () => {
  it('says what a thing is made of, its state, where it belongs and what it is good for', () => {
    const dumpster = entry('dumpsterrusta', 'Street furniture', [2, 1.2, 1.4], ['rustydump_me.tga'])
    expect(tagsOf(dumpster)).toEqual(expect.arrayContaining(['street', 'outdoor', 'run-down', 'metal', 'medium', 'cover', 'city']))
    const chandelier = entry('chandeliera', 'Lights and signals', [1, 1, 1], ['chandalear01_me.tga'], 5, { where: ['mp_bac_01'] })
    expect(tagsOf(chandelier)).toEqual(expect.arrayContaining(['upscale', 'light', 'multiplayer']))
    expect(tagsOf(chandelier)).not.toContain('city')
    // Words inside other words don't count: an el track is no shop rack, a carpet is no car, a guardrail no police.
    expect(tagsOf(entry('eltrack', 'Other', [20, 4, 3]))).not.toContain('shop')
    expect(tagsOf(entry('carpet', 'Other', [4, 4, 0.02]))).not.toContain('transport')
    expect(tagsOf(entry('guardraile', 'Fences and barriers', [4, 0.3, 0.8]))).not.toContain('police')
  })

  it('reads the words people use', () => {
    expect(tagsFor('a ghetto map with abandoned buildings')).toContain('run-down')
    expect(tagsFor('somewhere fancy, like a penthouse')).toContain('upscale')
    expect(tagsFor('fill the docks with stuff')).toContain('industrial')
    expect(textTags('A shut-down shop: plywood over the windows, graffiti, a trashed interior')).toEqual(expect.arrayContaining(['run-down']))
  })

  it('names and describes objects plainly', () => {
    const can = entry('trashcand', 'Street furniture', [0.7, 0.7, 1], ['trashcan1_me.tga'], 120)
    expect(displayName(can)).toBe('Trash can')
    expect(describeEntry(can)).toMatch(/^Trash can \(trashcand\): street furniture; 0\.7 × 0\.7 × 1 m; .*used 120× in the game$/)
  })

  it('picks a varied mix for a theme, never building pieces, decals or one-offs', () => {
    const lib = [
      entry('trashcana', 'Street furniture', [0.7, 0.7, 1], ['trashcan1_me.tga'], 50), entry('trashcanb', 'Street furniture', [0.7, 0.7, 1], ['trashcan2_me.tga'], 40),
      entry('dumpsterrusta', 'Street furniture', [2, 1.2, 1.4], ['rustydump_me.tga'], 30), entry('barbwirea', 'Fences and barriers', [4, 0.2, 1], ['barbwire.tga'], 20),
      entry('grimedecal', 'Other', [3, 3, 0.01], ['grime_d.tga'], 90), entry('wallbroken', 'Building pieces', [5, 0.3, 3], ['crack_co.tga'], 90),
      entry('junkcar', 'Wrecks and vehicles', [4, 2, 1.4], ['husk_me.tga'], 1),
    ]
    const pick = varietyPick(lib, ['run-down'], 3)
    expect(pick.map((e) => e.name)).toEqual(expect.arrayContaining(['dumpsterrusta', 'barbwirea']))
    expect(pick.some((e) => ['grimedecal', 'wallbroken', 'junkcar'].includes(e.name))).toBe(false)
  })
})
