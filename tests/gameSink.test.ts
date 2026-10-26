// Game models stood on a flat floor the way the city stands them (src/lib/gameObjects/place.ts sinkUnits, sunk):
// one whose lowest point goes below the city's floor round it (a building's stairwell, a pole's buried foot) is sunk
// by that much instead of floating on its lowest point.
import { describe, expect, it } from 'vitest'
import { sinkUnits, sunk } from '../src/lib/gameObjects/place'
import type { Part } from '../src/lib/sampleKit'

const part = (game: Part['game']): Pick<Part, 'game'> => ({ game })

describe('sinking game models into the floor', () => {
  it("sinks a building by its own measure, a prop by its placements', in the map's units", () => {
    expect(sinkUnits({ sink: 1.1 }, 0.5)).toBeCloseTo(2.2, 5)
    expect(sinkUnits({ sits: { sink: 0.4 } as never }, 0.5)).toBeCloseTo(0.8, 5)
    expect(sinkUnits({}, 0.5)).toBe(0)
    // At a quarter metre a unit, twice as many units.
    expect(sinkUnits({ sink: 1 }, 0.25)).toBe(4)
  })

  it('leaves a whole module\'s parts where the city has them, and sinks a group by its lead', () => {
    const e = { sink: 0.8 }
    expect(sunk(part({ id: 'a', name: 'a' }), e, 0.5)).toBeCloseTo(1.6, 5)
    expect(sunk(part({ id: 'a', name: 'a', exact: true, from: 'Corner shop' }), e, 0.5)).toBe(0)
    // A lamp on its foot: both go down by the foot's sink, whatever the lamp's own.
    expect(sunk(part({ id: 'a', name: 'a', exact: true, sink: 0.3 }), e, 0.5)).toBeCloseTo(0.6, 5)
  })
})
