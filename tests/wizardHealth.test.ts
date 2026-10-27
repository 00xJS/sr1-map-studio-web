// The map wizard's health over the settings the game has pieces like (every one but cyber) × every layout × two seeds,
// as the health check scores each map from its own shapes. Slow (160 maps), so only with WIZARD_HEALTH set; it writes
// the scores to WIZARD_HEALTH (a JSON file) for the before/after table in the PR. With WIZARD_GATE set too, a map
// under the Start dialog's bar is tried again with the dialog's next seeds (MapWizard.tsx) and the best kept. Run with:
//   WIZARD_HEALTH=out.json [WIZARD_GATE=1] npx vitest run tests/wizardHealth.test.ts
import { writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { LAYOUTS, SETTINGS, wizardSample, type WizardLayout, type WizardSetting } from '../src/lib/mapWizard'
import { analyzeMap, sampleInput } from '../src/lib/analysis'
import { PASS, TRIES, nextSeeds } from '../src/lib/wizardClient'

const OUT = process.env.WIZARD_HEALTH
const GATE = !!process.env.WIZARD_GATE
const SEEDS = [1, 4242]

describe.skipIf(!OUT)('wizard health', () => {
  it('scores every setting × layout × seed', () => {
    const settings = (Object.keys(SETTINGS) as WizardSetting[]).filter((s) => s !== 'cyber')
    const rows: { setting: string; layout: string; seed: number; score: number; findings: string[]; gated?: number; tries?: number }[] = []
    const score = (setting: WizardSetting, layout: WizardLayout, seed: number) =>
      analyzeMap(sampleInput(wizardSample({ setting, layout, players: 10, density: 'normal', seed })), { rayBudget: 400_000, trips: 80 })
    for (const setting of settings) for (const layout of Object.keys(LAYOUTS) as WizardLayout[]) for (const seed of SEEDS) {
      const r = score(setting, layout, seed)
      let gated = r.score, tries = 1
      if (GATE) for (const next of nextSeeds(seed, TRIES - 1)) { if (gated >= PASS) break; gated = Math.max(gated, score(setting, layout, next).score); tries++ }
      rows.push({ setting, layout, seed, score: r.score, findings: r.findings.slice(0, 3), ...(GATE ? { gated, tries } : {}) })
      console.log(`${setting} ${layout} ${seed}: ${r.score}${GATE ? ` (gated ${gated}, ${tries} tries)` : ''}`)
    }
    writeFileSync(OUT!, JSON.stringify(rows, null, 1))
  }, 3_600_000)
})
