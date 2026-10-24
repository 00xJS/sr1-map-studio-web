import { describe, expect, it } from 'vitest'
import { newMarker, newProject, uid, type Project, type Vec3 } from '../src/lib/project'
import { openFloor, spreadSpawns, weaponSpots } from '../src/lib/markerPlacer'
import { describeEdit } from '../src/lib/aiReview'

/** A 120 × 120 floor with a wall across each half and four spawns bunched in one corner. */
function map(): Project {
  const p = newProject('Test')
  const box = (name: string, size: Vec3, at: Vec3) => ({ uid: uid(), name, path: '', position: at, rotation: [0, 0, 0] as Vec3, scale: 1, textures: {}, alpha: {}, shape: { kind: 'box' as const, size, tile: 4 } })
  p.scene_items = [box('Ground', [120, 1, 120], [0, 0, 0]), box('Wall', [30, 6, 1], [10, 1, -25]), box('Wall', [30, 6, 1], [-10, 1, 25])]
  p.markers = [[50, -50], [52, -50], [50, -52], [52, -52]].map(([x, z]) => newMarker('Shared spawn', [x, 1.1, z]))
  p.markers.push(newMarker('Red team spawn', [0, 1.1, -50]), newMarker('Blue team spawn', [0, 1.1, 50]), newMarker('Weapon pickup', [0, 1.1, 0]))
  return p
}
const minGap = (ps: Vec3[]) => Math.min(...ps.flatMap((a, i) => ps.slice(i + 1).map((b) => Math.hypot(a[0] - b[0], a[2] - b[2]))))

describe('placing spawns and weapons on open floor', () => {
  it('finds the open floor, not the wall tops', () => {
    const { spots } = openFloor(map())
    expect(spots.length).toBeGreaterThan(500)
    expect(spots.every((s) => s[1] === 1)).toBe(true)
  })

  it('spreads bunched free-for-all spawns over the map, in mirrored pairs, keeping the rest', () => {
    const p = map()
    const out = spreadSpawns(p, undefined, 'shared', 8)!
    const shared = out.filter((m) => m.type === 'Shared spawn').map((m) => m.position)
    expect(shared).toHaveLength(8)
    expect(minGap(shared)).toBeGreaterThan(25)
    for (const s of shared) expect(shared.some((t) => Math.abs(t[0] + s[0]) < 0.01 && Math.abs(t[2] + s[2]) < 0.01)).toBe(true)
    expect(out.filter((m) => m.type !== 'Shared spawn')).toHaveLength(3)
    expect(spreadSpawns(p, undefined, 'shared')!.filter((m) => m.type === 'Shared spawn')).toHaveLength(4)
  })

  it('puts team spawns at their own ends', () => {
    const out = spreadSpawns(map(), undefined, 'team', 4)!
    const red = out.filter((m) => m.type === 'Red team spawn'), blue = out.filter((m) => m.type === 'Blue team spawn')
    expect(red).toHaveLength(4)
    expect(blue).toHaveLength(4)
    expect(red.every((m) => m.position[2] < -20)).toBe(true)
    expect(blue.every((m) => m.position[2] > 20)).toBe(true)
  })

  it('finds room for weapons away from spawns and the weapon already there', () => {
    const p = map()
    const at = weaponSpots(p, undefined, 3, 'middle')
    expect(at).toHaveLength(3)
    for (const q of at) {
      expect(q[2] <= 0).toBe(true)
      expect(Math.abs(q[2])).toBeLessThan(30)
      expect(Math.hypot(q[0], q[2])).toBeGreaterThan(4)
      for (const m of p.markers.filter((m) => m.type !== 'Weapon pickup')) expect(Math.hypot(q[0] - m.position[0], q[2] - m.position[2])).toBeGreaterThan(8)
    }
    expect(describeEdit({ do: 'add_weapons', weapons: ['rpg_launcher', 'spas12'], where: 'middle' })).toBe('Add weapons: rpg_launcher, spas12 (middle)')
    expect(describeEdit({ do: 'spread_spawns', which: 'team', count: 4 })).toBe('Spread out the team spawns (4 per team)')
  })
})
