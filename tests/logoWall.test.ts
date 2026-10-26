import { describe, expect, it } from 'vitest'
import { LOGO_WALL, PB, logoTile, perimeter } from '../src/lib/sampleKit'

describe('logo wall', () => {
  it('is what outer walls wear on their sides, whatever wall a map asks for', () => {
    for (const w of perimeter(80, 96, 6, PB.brick, PB.concrete)) {
      expect(w.side).toEqual(LOGO_WALL)
      expect(w.top).toEqual(PB.concrete)
    }
  })

  it('shows one row of logos, centred on the part of the wall above the ground', () => {
    for (const [visible, hidden] of [[2, 1], [6, 1], [8, 0], [14, 0], [20, 12]]) {
      const t = logoTile(visible, hidden), mid = hidden + visible / 2, row = Math.round(mid / t - 0.51)
      expect((row + 0.51) * t).toBeCloseTo(mid, 1)
      // The rows above and below, band and all (about 0.09 of a repeat either side of its middle), are off the wall.
      expect(mid + t - 0.09 * t).toBeGreaterThan(hidden + visible)
      expect(mid - t + 0.09 * t).toBeLessThan(hidden)
    }
  })
})
