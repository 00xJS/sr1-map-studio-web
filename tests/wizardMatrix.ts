// The new map wizard's settings × layouts, checked over four test files (mapWizard*.test.ts) so they run side by side.
// `npm test` builds each pair with one of the four seed setups, taking turns, so every setting, layout and seed setup
// is covered; `npm run test:full` builds every pair with all four.
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { LAYOUTS, SETTINGS, wizardSample, type WizardLayout, type WizardSetting } from '../src/lib/mapWizard'
import { checkModes } from '../src/lib/levels'
import { KINDS } from '../src/lib/procedural'
import { newMarker } from '../src/lib/project'
import { catalogs } from '../src/lib/catalogs'
import { blocker, mapSize, support } from '../src/lib/sampleScale'
import { FULL } from './testMode'

const library = new Set((JSON.parse(readFileSync('public/textures/index.json', 'utf8')).textures as { id: string }[]).map((t) => t.id))
const weapons = new Set(catalogs.weapons.map(([, id]) => id))

// The last one is the top of the busy scale, about three times Packed.
const SEEDS = [[1, 12, 'normal', undefined], [77, 8, 'packed', undefined], [4242, 4, 'open', undefined], [9001, 10, 'packed', 100]] as const

/** Part `part` (0-3) of the matrix: fair, playable maps for every pair it holds. */
export function wizardMatrix(part: number) {
  const settings = Object.keys(SETTINGS) as WizardSetting[], layouts = Object.keys(LAYOUTS) as WizardLayout[]
  settings.forEach((setting, i) => layouts.forEach((layout, j) => {
    const n = i * layouts.length + j
    if (n % 4 !== part) return
    // Turns shift by one each setting, so each setting and each layout meets every seed setup.
    const seeds = FULL ? SEEDS : [SEEDS[(i + j) % SEEDS.length]]
    it(`${setting} / ${layout}: fair, playable maps for ${FULL ? 'every seed' : `seed ${seeds[0][0]}`}`, () => {
      for (const [seed, players, density, busy] of seeds) check({ setting, layout, players, density, seed, busy })
    })
  }))
}

function check(o: Parameters<typeof wizardSample>[0]) {
  const s = wizardSample(o)
  const where = `seed ${o.seed}`
  const problems: string[] = []
  for (const [type, p, patch] of s.markers) {
    if (support(s.parts, p) < 0) problems.push(`${type} at ${p.join(', ')}: nothing to stand on`)
    const b = blocker(s.parts, p)
    if (b) problems.push(`${type} at ${p.join(', ')}: inside ${b.label}`)
    if (type === 'Weapon pickup') expect(weapons.has(patch!.weapon!), patch!.weapon).toBe(true)
  }
  expect(problems, where).toEqual([])
  for (const p of s.parts) for (const t of [p.top, p.side]) {
    if ('lib' in t) expect(library.has(t.lib), t.lib).toBe(true)
    else expect('gen' in t && KINDS[t.gen]).toBeTruthy()
  }
  const count = (t: string) => s.markers.filter(([m]) => m === t).length
  expect(count('Red team spawn'), where).toBe(count('Blue team spawn'))
  expect(count('Red team spawn'), where).toBeGreaterThanOrEqual(4)
  expect(count('Shared spawn'), where).toBeGreaterThanOrEqual(8)
  expect(count('Weapon pickup'), where).toBeGreaterThanOrEqual(10)
  const markers = s.markers.map(([type, at, patch]) => ({ ...newMarker(type, at), ...patch }))
  expect(checkModes({ modes: s.modes }, markers).errors, where).toEqual([])
  expect(s.lights?.length ?? 0).toBeLessThanOrEqual(catalogs.limits.max_lights)
  // Sized for the players asked for (the size check counts at most 12).
  expect(Math.abs(mapSize(s).players - Math.min(12, o.players)), where).toBeLessThanOrEqual(3)
}
