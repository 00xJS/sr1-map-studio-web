// Game pieces maps dressed the way the game dresses each kind of place (src/lib/gameObjects/gameDress.ts, areaKits.ts),
// with a made-up library named as identify() names the game's models: no game data.
import { describe, expect, it } from 'vitest'
import type { GameObjectEntry } from '../src/lib/gameObjects/indexer'
import type { GameIdentity, PropKind } from '../src/lib/gameObjects/identity'
import { GamePieces, TEXTURE_BUDGET, TRI_BUDGET, gameParts, prepare } from '../src/lib/gameObjects/wizardPieces'
import { KITS } from '../src/lib/gameObjects/areaKits'
import { wizardSample, type WizardOptions } from '../src/lib/mapWizard'

type Fake = { id: string; name: string; size: [number, number, number]; kind?: PropKind; role: GameIdentity['role']; eye?: number; tris?: number }
const fakes: Fake[] = [
  { id: 'cbar', name: 'Concrete barrier', size: [4.8, 1.1, 1.3], kind: 'cover', role: 'prop' },
  { id: 'dump', name: 'Dumpster', size: [2.1, 1.9, 1.8], kind: 'cover', role: 'prop' },
  { id: 'cont', name: 'Shipping container', size: [6, 2.5, 2.6], kind: 'cover', role: 'prop', eye: 0.95 },
  { id: 'wreck', name: 'Wrecked car', size: [4.2, 1.9, 1.9], kind: 'vehicle', role: 'prop', eye: 0.9 },
  { id: 'bin', name: 'Trash can', size: [0.8, 0.8, 1.1], kind: 'street', role: 'prop' },
  { id: 'bench', name: 'Bench', size: [2.5, 0.8, 1], kind: 'street', role: 'prop' },
  { id: 'meter', name: 'Parking meter', size: [0.6, 0.3, 1.3], kind: 'street', role: 'prop' },
  { id: 'bags', name: 'Trash bags', size: [0.8, 0.7, 0.7], kind: 'clutter', role: 'prop' },
  { id: 'shop', name: 'Shop', size: [12, 9, 10], role: 'building' },
]
const entries: GameObjectEntry[] = fakes.map((f) => ({
  id: f.id, name: f.name, cat: 'Other', profile: '', pack: 'sr_city_stream', chunk: 'c1', record: 0, size: f.size, tris: f.tris ?? 300, tex: [f.id + '_co.tga'], seen: 20,
  ...(f.eye !== undefined ? { eye: f.eye } : {}),
}))
const byId = new Map(fakes.map((f) => [f.id, f]))
const identify = (e: GameObjectEntry): GameIdentity => {
  const f = byId.get(e.id)!
  return { category: 'Other', name: f.name, role: f.role, settings: [], ...(f.kind ? { kind: f.kind } : {}),
    ...(f.role === 'building' ? { building: { footprint: [f.size[0], f.size[1]] as [number, number], height: f.size[2], storeys: 3 } } : {}) }
}
const opts = (o: Partial<WizardOptions> = {}): WizardOptions => ({ setting: 'downtown', layout: 'scatter', players: 8, density: 'normal', seed: 5, ...o })
const pieces = (o: WizardOptions) => new GamePieces(entries, { setting: o.setting, seed: o.seed, identify })

describe('game dressing', () => {
  it("covers a cover field with the setting's own things, mirrored for the other team, and no site blocks", () => {
    const o = opts()
    const gp = pieces(o)
    const s = wizardSample(o, gp)
    const props = gameParts(s).filter((p) => p.label === 'Game prop')
    const kit = new Set([...KITS.downtown.cover, ...KITS.downtown.sidewalk, ...KITS.downtown.alley].map((i) => i.name))
    expect(props.length).toBeGreaterThan(20)
    for (const p of props) expect(kit.has(p.game!.name), p.game!.name).toBe(true)
    // Something to hide behind in front of the spawns, and on open ground.
    expect(gp.dressed!.screens).toBeGreaterThan(0)
    expect(gp.dressed!.cover).toBeGreaterThanOrEqual(gp.dressed!.wanted)
    // The site's own low walls are gone: the game's cover stands in the field instead.
    expect(s.parts.some((p) => p.label === 'Cover')).toBe(false)
    // Every piece has its twin on the other half, turned round.
    for (const p of props) expect(props.some((q) => q.game!.id === p.game!.id && Math.abs(q.at[0] + p.at[0]) < 0.05 && Math.abs(q.at[2] + p.at[2]) < 0.05), p.game!.name).toBe(true)
    expect(gp.stats.triangles).toBeLessThanOrEqual(TRI_BUDGET)
    expect(gp.stats.textures).toBeLessThanOrEqual(TEXTURE_BUDGET)
  })

  it('makes a busier map carry more cover', () => {
    const dressed = (busy: number) => { const o = opts({ layout: 'plaza', busy, seed: 9 }); const gp = pieces(o); wizardSample(o, gp); return gp.dressed! }
    const calm = dressed(5), busy = dressed(80)
    expect(busy.wanted).toBeGreaterThan(calm.wanted)
    expect(busy.cover).toBeGreaterThanOrEqual(busy.wanted)
  })

  it('charges the budget only for what is placed', () => {
    const gp = pieces(opts())
    const c = gp.named('Shipping container', () => 1)!
    expect(c).toBeTruthy()
    expect(gp.stats.triangles).toBe(0)
    gp.commit(c)
    expect(gp.stats.triangles).toBe(600)
    expect(gp.stats.props).toBe(2)
  })
})

describe('city copies first', () => {
  it("leaves out a multiplayer map's copy of a model the city has (the retail bus stop on its concrete block)", () => {
    const city: GameObjectEntry = { ...entries.find((e) => e.id === 'bench')!, id: 'city_stop', where: ['city'] }
    const mp: GameObjectEntry = { ...city, id: 'mp_stop', where: ['mp_bac_01'] }
    // A multiplayer-only model with no city copy stays.
    const only: GameObjectEntry = { ...entries.find((e) => e.id === 'bin')!, id: 'mp_only', where: ['mp_bac_01'] }
    byId.set('city_stop', byId.get('bench')!); byId.set('mp_stop', byId.get('bench')!); byId.set('mp_only', byId.get('bin')!)
    const ids = [...prepare([city, mp, only], 'downtown', identify).props.values()].flat().map((c) => c.e.id)
    expect(ids).toContain('city_stop')
    expect(ids).toContain('mp_only')
    expect(ids).not.toContain('mp_stop')
  })
})
