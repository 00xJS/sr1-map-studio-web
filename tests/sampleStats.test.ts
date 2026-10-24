// The catalog shows each map's size, players, spawns and weapons from
// public/samples/stats.json, so the page doesn't have to build every map.
// Regenerate after changing maps:  UPDATE_STATS=1 npx vitest run tests/sampleStats.test.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { SAMPLES, sampleStats } from '../src/lib/samples'

const FILE = 'public/samples/stats.json'

const CARDS = 'src/lib/sampleCatalog.json'

it("the home page's list of maps matches the maps", () => {
  const cards = SAMPLES.map(({ id, name, icon, theme, description, added }) => ({ id, name, icon, theme, description, ...(added ? { added } : {}) }))
  if (process.env.UPDATE_STATS) writeFileSync(CARDS, JSON.stringify(cards, null, 1) + '\n')
  expect(JSON.parse(readFileSync(CARDS, 'utf8')), 'Maps changed: run UPDATE_STATS=1 npx vitest run tests/sampleStats.test.ts').toEqual(cards)
})

it('catalog stats match the maps', () => {
  const stats = Object.fromEntries(SAMPLES.map((s) => [s.id, sampleStats(s.id)]))
  if (process.env.UPDATE_STATS) writeFileSync(FILE, JSON.stringify(stats, null, 1) + '\n')
  expect(existsSync(FILE), `${FILE} is missing: run UPDATE_STATS=1 npx vitest run tests/sampleStats.test.ts`).toBe(true)
  expect(JSON.parse(readFileSync(FILE, 'utf8')), 'Map stats changed: run UPDATE_STATS=1 npx vitest run tests/sampleStats.test.ts').toEqual(stats)
})
