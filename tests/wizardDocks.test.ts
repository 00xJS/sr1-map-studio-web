// The docks setting's harbour (src/lib/mapWizard.ts harbour): swimmable water down each side of the quay (the game's
// own water volumes once exported), a seabed, and slipways so a player who falls in can climb back out; spawns and
// weapons never under water, and every one usable.
import { describe, expect, it } from 'vitest'
import { wizardSample, wizardSize, type WizardLayout } from '../src/lib/mapWizard'
import { sampleInput } from '../src/lib/analysis'
import { prepareMap } from '../src/lib/analysis/analyze'
import { gameOnly } from '../src/lib/gameObjects/frame'

describe('docks: a harbour players can swim in and climb out of', () => {
  for (const layout of ['blocks', 'plaza', 'lanes', 'crossroads'] as WizardLayout[]) {
    it(layout, () => {
      const o = { setting: 'docks' as const, layout, players: 10, density: 'normal' as const, seed: 7 }
      const s = wizardSample(o)
      const water = s.parts.filter((p) => p.water)
      // One basin each side, inside the map's size, along its side walls.
      expect(water.length).toBe(2)
      const [W] = wizardSize(o.players, layout)
      for (const w of water) expect(Math.abs(w.at[0]) + w.size[0] / 2).toBeCloseTo(W / 2, 3)
      expect(water[0].at[0] * water[1].at[0]).toBeLessThan(0)
      // A way out of each.
      expect(s.parts.filter((p) => p.label === 'Slipway').length).toBe(2)
      // Nothing to spawn on or pick up down there, and everything where players can use it.
      for (const [type, at] of s.markers) {
        if (!/spawn|Weapon/.test(type)) continue
        expect(water.some((w) => Math.abs(at[0] - w.at[0]) < w.size[0] / 2 && Math.abs(at[2] - w.at[2]) < w.size[2] / 2), `${type} at ${at}`).toBe(false)
      }
      expect(prepareMap(sampleInput(s), { cell: 2 }).unreachable).toEqual([])
    })
  }

  it('keeps the water, seabed, quay and slipways on Game pieces maps', () => {
    const s = wizardSample({ setting: 'docks', layout: 'blocks', players: 10, density: 'normal', seed: 7 })
    const kept = gameOnly(s.parts, {})
    for (const label of ['Water', 'Seabed', 'Quay wall', 'Slipway']) expect(kept.some((p) => p.label === label), label).toBe(true)
  })
})
