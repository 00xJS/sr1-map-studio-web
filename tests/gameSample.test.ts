// Catalogue samples remade with game pieces (src/lib/gameObjects/gameSample.ts), with a made-up library: no game data.
import { describe, expect, it } from 'vitest'
import type { GameObjectEntry } from '../src/lib/gameObjects/indexer'
import type { GameIdentity, PropKind } from '../src/lib/gameObjects/identity'
import { GamePieces, gameParts } from '../src/lib/gameObjects/wizardPieces'
import { gameSampleFor, settingFor, buried } from '../src/lib/gameObjects/gameSample'
import { COMPACT_TARGETS, SAMPLES } from '../src/lib/samples'

type Fake = { id: string; name: string; size: [number, number, number]; kind?: PropKind; role: GameIdentity['role']; eye?: number }
const fakes: Fake[] = [
  { id: 'shop', name: 'Shop', size: [14, 10, 12], role: 'building' },
  { id: 'flats', name: 'Flats', size: [20, 14, 16], role: 'building' },
  { id: 'cbar', name: 'Concrete barrier', size: [4.8, 1.1, 1.3], kind: 'cover', role: 'prop' },
  { id: 'dump', name: 'Dumpster', size: [2.1, 1.9, 1.8], kind: 'cover', role: 'prop' },
  { id: 'wreck', name: 'Wrecked car', size: [4.2, 1.9, 1.9], kind: 'vehicle', role: 'prop', eye: 0.9 },
  { id: 'bin', name: 'Trash can', size: [0.8, 0.8, 1.1], kind: 'street', role: 'prop' },
  { id: 'bench', name: 'Bench', size: [2.5, 0.8, 1], kind: 'street', role: 'prop' },
]
const entries: GameObjectEntry[] = fakes.map((f) => ({
  id: f.id, name: f.name, cat: 'Other', profile: '', pack: 'sr_city_stream', chunk: 'c1', record: 0, size: f.size, tris: 300, tex: [f.id + '_co.tga'], seen: 20, ...(f.eye !== undefined ? { eye: f.eye } : {}),
}))
const byId = new Map(fakes.map((f) => [f.id, f]))
const identify = (e: GameObjectEntry): GameIdentity => {
  const f = byId.get(e.id)!
  return { category: 'Other', name: f.name, role: f.role, settings: [], ...(f.kind ? { kind: f.kind } : {}),
    ...(f.role === 'building' ? { building: { footprint: [f.size[0], f.size[1]] as [number, number], height: f.size[2], storeys: 3 } } : {}) }
}

describe('samples with game pieces', () => {
  it('picks the game setting a sample is like, and none for the cyber arenas', () => {
    const by = (id: string) => settingFor(SAMPLES.find((s) => s.id === id)!)
    expect(by('u_docks')).toBe('docks')
    expect(by('u_trainyard')).toBe('industrial')
    expect(by('u_trailer')).toBe('rundown')
    expect(by('u_downtown')).toBe('downtown')
    expect(by(SAMPLES.find((s) => s.theme === 'Cyber')!.id)).toBeNull()
  })

  it("puts game buildings on the sample's building plots, keeps the ones players climb, and spawns nobody inside", () => {
    const s = SAMPLES.find((x) => x.id === 'u_downtown')!
    const make = () => gameSampleFor(s, false, COMPACT_TARGETS, new GamePieces(entries, { setting: 'downtown', seed: 1, identify }), 'downtown')
    const g = make()
    const buildings = gameParts(g).filter((p) => p.label === 'Game building')
    expect(buildings.length).toBeGreaterThan(0)
    // Its stairs still lead somewhere: every one of the sample's stairs and ramps is still there.
    const climbs = (x: { parts: { label: string }[] }) => x.parts.filter((p) => /Stairs|Ramp/.test(p.label)).length
    expect(climbs(g)).toBeGreaterThanOrEqual(climbs(s))
    expect(buried(g)).toHaveLength(0)
    expect(g.markers.filter(([t]) => /spawn/i.test(t)).length).toBeGreaterThan(8)
    // The same sample comes out the same every time.
    expect(gameParts(make()).map((p) => p.game!.id)).toEqual(gameParts(g).map((p) => p.game!.id))
  })
})
