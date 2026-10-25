// The new map wizard's "Game pieces" (src/lib/gameObjects/wizardPieces.ts), with a made-up library: no game data.
// Plots get buildings that fit, turned to fit; props suit the setting; nothing that is a building piece or never
// placed goes in; where nothing fits the site's piece stays; reroll picks other models; the budget holds.
import { describe, expect, it } from 'vitest'
import type { GameObjectEntry } from '../src/lib/gameObjects/indexer'
import type { GameIdentity } from '../src/lib/gameObjects/identity'
import { GamePieces, TEXTURE_BUDGET, TRI_BUDGET, gameParts, modelTurn } from '../src/lib/gameObjects/wizardPieces'
import { wizardLayout, wizardSample, type WizardOptions } from '../src/lib/mapWizard'

type Fake = Partial<GameObjectEntry> & { id: string; who: Omit<GameIdentity, 'category' | 'name'> & { name?: string } }
const fakes: Fake[] = []
const add = (id: string, size: [number, number, number], who: Fake['who'], tris = 400, tex = [id + '_co.tga']) => fakes.push({ id, size, tris, tex, who })

// Buildings (metres: long side, short side, height).
add('shop_down', [11, 8, 9], { role: 'building', settings: ['downtown'], building: { footprint: [11, 8], height: 9, storeys: 3 } }, 3000)
add('flats_down', [13, 10, 14], { role: 'building', settings: ['downtown'], building: { footprint: [13, 10], height: 14, storeys: 4 } }, 4000)
add('shack_rundown', [10, 7, 6], { role: 'building', settings: ['rundown'], building: { footprint: [10, 7], height: 6, storeys: 2 } }, 2500)
add('shed_any', [9, 6, 5], { role: 'building', settings: [], building: { footprint: [9, 6], height: 5, storeys: 1 } }, 2000)
add('shed_ind', [14, 11, 8], { role: 'building', settings: ['industrial'], building: { footprint: [14, 11], height: 8, storeys: 2 } }, 2000)
add('tower', [60, 40, 120], { role: 'building', settings: ['downtown'], building: { footprint: [60, 40], height: 120, storeys: 30 } }, 20000)
// Props.
add('crate', [1.2, 1.2, 1.2], { role: 'prop', kind: 'cover', settings: ['industrial'] })
add('barrel', [0.7, 0.7, 1], { role: 'prop', kind: 'cover', settings: [] })
add('bags', [1.2, 0.9, 0.6], { role: 'prop', kind: 'clutter', settings: ['rundown'] })
add('hydrant', [0.5, 0.5, 0.9], { role: 'prop', kind: 'street', settings: ['downtown'] })
add('bin', [0.7, 0.7, 1.1], { role: 'prop', kind: 'street', settings: [] })
add('tree', [3, 3, 6], { role: 'prop', kind: 'nature', settings: [] })
add('lamp', [0.6, 1.8, 7], { role: 'prop', kind: 'light', settings: [] })
add('husk', [4.4, 1.9, 1.4], { role: 'prop', kind: 'vehicle', settings: ['rundown'] })
add('fence', [3, 0.1, 1.8], { role: 'fence', settings: [] })
// Fit anywhere, and must never be placed.
add('wallpiece', [8, 0.3, 3], { role: 'piece', settings: ['downtown'] })
add('blocker', [8, 6, 5], { role: 'skip', settings: ['downtown'] })
add('blocker2', [1, 1, 1], { role: 'skip', settings: [] })

const entries: GameObjectEntry[] = fakes.map((f) => ({
  id: f.id, name: f.id, cat: 'Other', profile: '', pack: 'sr_city_stream', chunk: 'c1', record: 0, size: f.size!, tris: f.tris!, tex: f.tex!, seen: 3,
}))
const who = new Map(fakes.map((f) => [f.id, f.who]))
const identify = (e: GameObjectEntry): GameIdentity => ({ category: 'Other', name: e.id, ...who.get(e.id)! })
const role = (id: string) => who.get(id)!.role

const opts = (o: Partial<WizardOptions> = {}): WizardOptions => ({ setting: 'downtown', layout: 'blocks', players: 8, density: 'normal', seed: 11, ...o })
const pieces = (o: WizardOptions, lib = entries) => new GamePieces(lib, { setting: o.setting, seed: o.seed, identify })

describe('game pieces: building plots', () => {
  it('puts a building that fits the plot on it, long side along the plot', () => {
    const gp = pieces(opts())
    for (const [w, d] of [[26, 20], [20, 26], [30, 24]]) {
      const p = gp.building(0, -40, w, d)!
      expect(p, `${w}×${d}`).toBeTruthy()
      expect(role(p.game!.id)).toBe('building')
      // Its footprint in the plot's frame (units: 2 a metre).
      const turned = (p.rot ?? 0) % 180 === 90
      const [fx, fz] = turned ? [p.size[2], p.size[0]] : [p.size[0], p.size[2]]
      expect(fx).toBeLessThanOrEqual(w)
      expect(fz).toBeLessThanOrEqual(d)
      // Long side along the plot's long side.
      expect(fx >= fz).toBe(w >= d)
    }
  })

  it('keeps the site building where nothing fits', () => {
    const gp = pieces(opts())
    expect(gp.building(0, -40, 8, 8)).toBeNull()
    expect(gp.stats.kept).toBe(1)
    // Nothing at all in the library: the map is the site's own, part for part.
    const o = opts({ seed: 5 })
    const plain = wizardLayout(o)
    expect(wizardLayout(o, pieces(o, []))).toEqual(plain)
  })

  it('prefers buildings that suit the setting', () => {
    const count = (setting: WizardOptions['setting']) => {
      const hits = new Map<string, number>()
      for (let seed = 1; seed <= 60; seed++) {
        const id = pieces(opts({ setting, seed })).building(0, -40, 24, 18)!.game!.id
        hits.set(id, (hits.get(id) ?? 0) + 1)
      }
      return hits
    }
    const down = count('downtown'), run = count('rundown')
    const downTown = (down.get('shop_down') ?? 0) + (down.get('flats_down') ?? 0)
    expect(downTown).toBeGreaterThan(40)
    expect(run.get('shack_rundown') ?? 0).toBeGreaterThan(25)
    // Never too big for the plot, whatever suits.
    expect(down.has('tower')).toBe(false)
  })

  it('turns a model to fit and its front toward the street when known', () => {
    const standIn = { size: [26, 10, 20] as [number, number, number], rot: 0, game: { id: 'x', name: 'x', front: 0 } }
    // Long side along X in the stand-in: a model long along Z turns a quarter.
    expect(modelTurn(10, 13, standIn) % 180).toBe(90)
    expect(modelTurn(13, 10, standIn) % 180).toBe(0)
    // Front on the game's −Z side: turned round so it faces the stand-in's +Z (the street).
    expect(modelTurn(13, 10, standIn, '-z')).toBe(180)
    expect(modelTurn(13, 10, standIn, '+z')).toBe(0)
    // The twin on blue's half (turned 180°) faces its own street.
    expect(modelTurn(13, 10, { ...standIn, rot: 180 }, '+z')).toBe(180)
    // A front on a short side can't face the street without breaking the fit: the fit wins.
    expect(modelTurn(13, 10, standIn, '+x') % 180).toBe(0)
  })
})

describe('game pieces: whole maps', () => {
  const maps = (['downtown', 'industrial', 'rundown'] as const).map((setting) => {
    const o = opts({ setting, layout: setting === 'rundown' ? 'neighbourhood' : 'blocks', busy: 55 })
    const gp = pieces(o)
    return { o, gp, s: wizardSample(o, gp) }
  })

  it('places buildings, props and lights, never pieces or blockers, mirrored for both teams', () => {
    for (const { o, gp, s } of maps) {
      const game = gameParts(s)
      expect(game.length, o.setting).toBeGreaterThan(4)
      expect(gp.stats.buildings, o.setting).toBeGreaterThan(0)
      for (const p of game) expect(['building', 'prop', 'fence'], p.game!.id).toContain(role(p.game!.id))
      // Each one has its twin, the same model, on the other half.
      for (const p of game) {
        const twin = game.find((q) => q.game!.id === p.game!.id && Math.abs(q.at[0] + p.at[0]) < 0.05 && Math.abs(q.at[2] + p.at[2]) < 0.05)
        expect(twin, `${p.game!.id} at ${p.at}`).toBeTruthy()
      }
      // Spawns and weapons are still there, placed round the models.
      expect(s.markers.filter(([t]) => /spawn/.test(t)).length).toBeGreaterThan(8)
    }
    // Rundown's neighbourhood swaps the road's lamps for the game's.
    const rundown = maps[2].s
    expect(gameParts(rundown).some((p) => p.game!.id === 'lamp')).toBe(true)
    expect(rundown.parts.some((p) => p.prefab?.key === 'road' && p.label === 'Lamp post')).toBe(false)
    // Compounds: yard walls became fence runs, end to end.
    const o = opts({ setting: 'industrial', layout: 'compounds', players: 12 })
    const fences = gameParts(wizardSample(o, pieces(o))).filter((p) => p.game!.id === 'fence')
    expect(fences.length).toBeGreaterThan(8)
  })

  it('reuses a few models, within the triangle and texture budget', () => {
    for (const { gp, s } of maps) {
      const placed = gameParts(s).length, models = new Set(gameParts(s).map((p) => p.game!.id)).size
      expect(models).toBeLessThan(placed)
      expect(gp.stats.triangles).toBeLessThanOrEqual(TRI_BUDGET)
      expect(gp.stats.textures).toBeLessThanOrEqual(TEXTURE_BUDGET)
    }
    // A library of heavy models with their own textures each: the budget stops it and the site's pieces stay.
    const heavy: GameObjectEntry[] = Array.from({ length: 40 }, (_, i) => ({ ...entries[0], id: 'heavy' + i, tris: 20000, tex: Array.from({ length: 12 }, (_, k) => `h${i}_${k}.tga`) }))
    heavy.forEach((e) => who.set(e.id, who.get('shop_down')!))
    const o = opts({ busy: 100 })
    const gp = new GamePieces(heavy, { setting: 'downtown', seed: 3, identify })
    wizardSample(o, gp)
    expect(gp.stats.triangles).toBeLessThanOrEqual(TRI_BUDGET)
    expect(gp.stats.textures).toBeLessThanOrEqual(TEXTURE_BUDGET)
    expect(gp.stats.kept).toBeGreaterThan(0)
  })

  it('rerolls to other models; the same seed gives the same map', () => {
    const ids = (seed: number) => gameParts(wizardSample(opts({ seed }), pieces(opts({ seed })))).map((p) => `${p.game!.id}@${p.at}`).join('|')
    expect(ids(21)).toBe(ids(21))
    expect(ids(21)).not.toBe(ids(22))
    const differ = new Set([31, 32, 33, 34, 35, 36].map((seed) => pieces(opts({ seed })).building(0, -40, 30, 24)!.game!.id))
    expect(differ.size).toBeGreaterThan(1)
  })
})
