import { describe, expect, it } from 'vitest'
import { ALL_PREFABS } from '../src/lib/prefabRegistry'
import { galleryPages, gallerySample } from '../src/lib/gallery'
import { support, blocker } from '../src/lib/sampleScale'
import { checkModes } from '../src/lib/levels'
import { newMarker } from '../src/lib/project'

describe('object gallery', () => {
  const pages = galleryPages()
  it('shows every prefab exactly once, in pages of at most 30', () => {
    const keys = pages.flatMap((g) => g.keys)
    expect(keys.sort()).toEqual(Object.keys(ALL_PREFABS).sort())
    for (const g of pages) expect(g.keys.length).toBeLessThanOrEqual(30)
  })

  it('every page is a playable map: spawns on the floor, clear of the objects, no mode errors', () => {
    for (const g of pages) {
      const s = gallerySample(g)
      const spawns = s.markers.filter(([t]) => t === 'Shared spawn')
      expect(spawns.length, s.name).toBeGreaterThanOrEqual(4)
      for (const [, p] of spawns) {
        expect(support(s.parts, p), `${s.name} spawn ${p}`).toBeGreaterThanOrEqual(0)
        expect(blocker(s.parts, p)?.label, `${s.name} spawn ${p}`).toBeUndefined()
      }
      expect(checkModes({ modes: s.modes }, s.markers.map(([t, at, x]) => ({ ...newMarker(t, at), ...x }))).errors).toEqual([])
      expect(s.lights!.length).toBeLessThanOrEqual(64)
    }
  }, 120000)
})
