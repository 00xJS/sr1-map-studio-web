// Spawns and weapons where players can use them (src/lib/markerPlan.ts), on made-up collision: a play floor with a
// bigger catch-all plane under it (as a converted city cut has), a solid block, and markers good and bad.
import { describe, expect, it } from 'vitest'
import { prepareMap } from '../src/lib/analysis/analyze'
import { OPAQUE, SOLID } from '../src/lib/analysis/types'
import { planMarkers, type PlanMarker } from '../src/lib/markerPlan'
import type { Vec3 } from '../src/lib/project'

/** Triangles of an axis-aligned box (editor units). */
function boxTris(min: Vec3, max: Vec3): number[] {
  const [x0, y0, z0] = min, [x1, y1, z1] = max
  const q = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => [...a, ...b, ...c, ...a, ...c, ...d]
  return [
    ...q([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]), ...q([x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]),
    ...q([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]), ...q([x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]),
    ...q([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]), ...q([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]),
  ]
}

function map(markers: PlanMarker[]) {
  const t = [
    // The play floor, 80 × 80 units, on top of a slab.
    ...boxTris([-40, -1, -40], [40, 0, 40]),
    // A catch-all plane far below, much bigger than the map.
    ...boxTris([-120, -14, -120], [120, -13, 120]),
    // A solid block on the floor, and walls for cover.
    ...boxTris([10, 0, 10], [18, 8, 18]),
    ...boxTris([-20, 0, -4], [-18, 6, 14]),
    ...boxTris([-4, 0, -24], [14, 6, -22]),
  ]
  const tris = new Float32Array(t)
  const flags = new Uint8Array(tris.length / 9).fill(SOLID | OPAQUE)
  return prepareMap({ tris, flags, markers }, { cell: 2 })
}

describe('spawns and weapons where players can use them', () => {
  const markers: PlanMarker[] = [
    { type: 'Shared spawn', position: [-30, 0.1, -30] },
    { type: 'Weapon pickup', position: [14, 0.1, 14], weapon: 'ak47' },
    { type: 'Weapon pickup', position: [0, 30, 0], weapon: 'tec9' },
    { type: 'Weapon pickup', position: [25, 0.1, -25], weapon: 'm16' },
  ]
  const plan = planMarkers(map(markers), markers, { spawns: 8, weapons: 5 })

  it('leaves usable markers where they are', () => {
    expect(plan.moved.map((m) => m.index).sort()).toEqual([1, 2])
  })

  it('moves one inside a block and one in the air onto the play floor, not the plane under the map', () => {
    for (const m of plan.moved) {
      expect(m.to[1]).toBeGreaterThan(-0.5)
      expect(m.to[1]).toBeLessThan(0.5)
      expect(Math.abs(m.to[0])).toBeLessThanOrEqual(40)
      expect(Math.abs(m.to[2])).toBeLessThanOrEqual(40)
      // Not inside the block.
      expect(m.to[0] > 10 && m.to[0] < 18 && m.to[2] > 10 && m.to[2] < 18).toBe(false)
    }
    expect(plan.moved.find((m) => m.index === 2)!.why).toMatch(/not on any floor/)
  })

  it('adds spawns and weapons up to the counts, spread out on the play floor', () => {
    const spawns = plan.added.filter((a) => a.type === 'Shared spawn'), weapons = plan.added.filter((a) => a.type === 'Weapon pickup')
    expect(spawns.length).toBe(7)
    expect(weapons.length).toBe(2)
    for (const a of plan.added) expect(Math.abs(a.at[1])).toBeLessThan(0.5)
    const all = [markers[0].position, ...spawns.map((s) => s.at)]
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++)
      expect(Math.hypot(all[i][0] - all[j][0], all[i][2] - all[j][2])).toBeGreaterThanOrEqual(9)
    for (const w of weapons) expect(w.weapon).toBeTruthy()
  })

  it('finds nothing to do without any floor', () => {
    const empty = prepareMap({ tris: new Float32Array(0), flags: new Uint8Array(0), markers: [] }, { cell: 2 })
    expect(planMarkers(empty, [], { spawns: 4, weapons: 4 }).floor).toBe(0)
  })
})
