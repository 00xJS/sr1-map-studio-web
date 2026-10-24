import { describe, expect, it } from 'vitest'
import { pickSpawn, type SpawnSpot } from '../src/lib/analysis/spawnPick'
import { rng } from '../src/lib/analysis/sight'
import { crowdedSpawns, checkModes } from '../src/lib/levels'
import { mapChecklist } from '../src/lib/checklist'
import { spreadSpawns } from '../src/lib/markerPlacer'
import { newMarker, newProject, uid, type Project, type Vec3 } from '../src/lib/project'

const spot = (x: number, team: SpawnSpot['team'] = 'shared', used?: number): SpawnSpot => ({ at: [x, 0, 0], team, used })
/** How often each spawn is picked over many tries. */
function share(spots: SpawnSpot[], team: SpawnSpot['team'], others: { at: Vec3; team: SpawnSpot['team'] }[], now = 100000, tries = 4000): number[] {
  const rand = rng(7), n = new Array(spots.length).fill(0)
  for (let i = 0; i < tries; i++) n[pickSpawn(spots, team, others, now, rand)]++
  return n.map((c) => c / tries)
}

describe("the game's spawn rules", () => {
  it('never spawns within 5 m of an enemy (unless they are 5 m above or below)', () => {
    const spots = [spot(0), spot(40)]
    expect(share(spots, 'shared', [{ at: [8, 0, 0], team: 'shared' }])[0]).toBe(0) // 4 m away
    const above = share(spots, 'shared', [{ at: [0, 12, 0], team: 'shared' }]) // 6 m up
    expect(above[0]).toBeGreaterThan(0)
  })

  it('skips a spawn used in the last 5 s or with someone standing on it', () => {
    expect(share([spot(0, 'shared', 99000), spot(100)], 'shared', [])[0]).toBe(0)
    expect(share([spot(0, 'shared', 94000), spot(100)], 'shared', [])[0]).toBeGreaterThan(0.3)
    // A team-mate standing on it blocks it too.
    expect(share([spot(0, 'red'), spot(100, 'red')], 'red', [{ at: [1, 0, 1], team: 'red' }])[0]).toBe(0)
    // Every spawn busy: the one used longest ago.
    expect(share([spot(0, 'shared', 99000), spot(100, 'shared', 98000)], 'shared', [])).toEqual([0, 1])
  })

  it('picks at random, weighted by the distance to the nearest enemy squared', () => {
    // The enemy at x = 0: spawns 20 and 40 units away, so the far one is 4 times as likely.
    const s = share([spot(20), spot(40)], 'shared', [{ at: [0, 0, 0], team: 'shared' }])
    expect(s[1] / s[0]).toBeGreaterThan(3.3)
    expect(s[1] / s[0]).toBeLessThan(4.8)
    // Alone on the map: any spawn, evenly.
    const alone = share([spot(20), spot(40)], 'shared', [])
    expect(Math.abs(alone[0] - 0.5)).toBeLessThan(0.05)
  })

  it('team spawns: your own team only; team-mates are not enemies', () => {
    const spots = [spot(0, 'red'), spot(20, 'red'), spot(40, 'blue')]
    const s = share(spots, 'red', [{ at: [22, 0, 0], team: 'red' }, { at: [-30, 0, 0], team: 'blue' }])
    expect(s[2]).toBe(0)
    expect(s[0] + s[1]).toBeCloseTo(1)
    expect(s[0]).toBeGreaterThan(0)
  })
})

function arena(): Project {
  const p = newProject('Spawn test')
  p.scene_items = [{ uid: uid(), name: 'Ground', path: '', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: {}, alpha: {}, shape: { kind: 'box', size: [100, 1, 100], tile: 4 } }]
  return p
}

describe('spawns keep 5 m from weapons, drop-offs and busy spots', () => {
  it('spreading spawns keeps them off weapons, drop-offs and hotspots', () => {
    const p = arena()
    const weapons: Vec3[] = [[-40, 1.1, -40], [40, 1.1, 40], [40, 1.1, -40], [-40, 1.1, 40], [0, 1.1, -45], [0, 1.1, 45]]
    p.markers = [...weapons.map((w) => ({ ...newMarker('Weapon pickup', w), weapon: 'ak47' })), newMarker('Chains drop-off', [-45, 1.1, 0]), newMarker('Chains drop-off', [45, 1.1, 0])]
    const hotspots: Vec3[] = [[-20, 1, -20], [20, 1, 20]]
    const out = spreadSpawns(p, undefined, 'shared', 12, hotspots)!
    const spawns = out.filter((m) => m.type === 'Shared spawn')
    expect(spawns).toHaveLength(12)
    const busy = [...out.filter((m) => m.type !== 'Shared spawn').map((m) => m.position), ...hotspots]
    for (const s of spawns) for (const b of busy) expect(Math.hypot(s.position[0] - b[0], s.position[2] - b[2])).toBeGreaterThanOrEqual(10)
    expect(crowdedSpawns(out)).toEqual([])
  })

  it('warns when a weapon or drop-off is within 5 m of a spawn, and points at it', () => {
    const p = arena()
    p.settings.modes = ['Gangsta Brawl']
    p.markers = [newMarker('Shared spawn', [0, 1.1, 0]), newMarker('Shared spawn', [30, 1.1, 30]), { ...newMarker('Weapon pickup', [6, 1.1, 6]), weapon: 'ak47' }, newMarker('Chains drop-off', [30, 1.1, 19])]
    expect(crowdedSpawns(p.markers)).toEqual([{ marker: 2, spawn: 0 }])
    p.markers[3].position = [30, 1.1, 24]
    expect(crowdedSpawns(p.markers).map((c) => c.marker)).toEqual([2, 3])
    const item = mapChecklist(p, true).find((c) => c.id === 'crowded-spawns')!
    expect(item.state).toBe('suggested')
    expect(item.fix).toEqual({ kind: 'marker', index: 2 })
    expect(item.text).toBe("2 weapon pickups and drop-offs are within 5 m of a spawn. The game won't spawn anyone there while an enemy is that close, and players gather at them: move them further away.")
    expect(checkModes(p.settings, p.markers).warnings.join('\n')).toMatch(/within 5 m of a spawn/)
    // 6 m up (a walkway over the spawn) is fine.
    p.markers[2].position = [6, 13.1, 6]
    p.markers[3].position = [30, 1.1, 18]
    expect(crowdedSpawns(p.markers)).toEqual([])
  })
})
