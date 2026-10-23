import { describe, expect, it } from 'vitest'
import { ALL_PREFABS, PREFAB_CATEGORIES } from '../src/lib/prefabRegistry'
import { compoundObj } from '../src/lib/shapes'
import { parseObj } from '../src/lib/geometry'
import type { Part } from '../src/lib/sampleKit'

const volume = (parts: Part[]) => {
  const m = parseObj(compoundObj(parts.map((p) => ({
    shape: { kind: p.kind, size: p.size, tile: p.tile ?? 4, segments: p.segments, taper: p.taper, bevel: p.bevel },
    at: p.at, rot: p.rot ?? 0, top: 'a', side: 'b',
  }))))
  let v = 0
  for (let f = 0; f < m.faces.length; f += 3) {
    const [a, b, c] = [m.faces[f], m.faces[f + 1], m.faces[f + 2]].map((i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]])
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
  }
  return v
}

describe('prefabs', () => {
  for (const [key, def] of Object.entries(ALL_PREFABS)) {
    it(`${def.label} (${key}) builds solid pieces that sit on the ground`, () => {
      for (const rot of [0, 90]) {
        const parts = def.make(5, -3, rot, 1)
        expect(parts.length).toBeGreaterThan(0)
        for (const p of parts) {
          expect(p.size.every((v) => v > 0), `${p.label} size`).toBe(true)
          expect(p.at[1], `${p.label} below the base`).toBeGreaterThanOrEqual(0.98)
        }
        // Each piece is a closed solid facing outward, so the total volume is positive.
        expect(volume(parts)).toBeGreaterThan(0)
      }
    })
  }

  it('every prefab has a known category, and there are plenty', () => {
    for (const p of Object.values(ALL_PREFABS)) expect(PREFAB_CATEGORIES).toContain(p.category)
    expect(Object.keys(ALL_PREFABS).length).toBeGreaterThanOrEqual(70)
  })
})

describe('map dressing', () => {
  it('names only prefabs that exist', async () => {
    const { DRESS } = await import('../src/lib/sampleDress')
    for (const [map, keys] of Object.entries(DRESS)) for (const k of keys) expect(ALL_PREFABS[k], `${map}: ${k}`).toBeTruthy()
  })
})
