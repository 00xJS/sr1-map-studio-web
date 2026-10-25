// The new map wizard's "Game pieces" from Stilwater modules (wizardModules.ts) on a local Saints Reborn install
// (SR1_PACKFILES, or the default install folder), behind `npm run test:game`: indexes the library the way the
// browser does and builds Downtown, Industrial and Rundown maps from it. While cityModules() has nothing (before the
// Stilwater study lands) every map must come out exactly as today's single-model Game pieces build it; once it has
// modules, the maps built from them must keep the rules (edges that suit each other, openings onto ground players
// reach, the budget). Health scores, from the stand-in boxes, are printed for both. Nothing from the game is written
// into the repo.
import { describe, expect, it } from 'vitest'
import { existsSync, openAsBlob } from 'node:fs'
import { join } from 'node:path'
import { GAME_TESTS } from './testMode'
import { readChunk } from '../src/lib/gameObjects/chunk'
import { indexChunk, mergeCandidates, type Candidate, type GameObjectEntry } from '../src/lib/gameObjects/indexer'
import { cityModules, groups } from '../src/lib/gameObjects/cityModules'
import { ALLEY, GameCity, joinOk, reachability } from '../src/lib/gameObjects/wizardModules'
import { GamePieces, TEXTURE_BUDGET, TRI_BUDGET, gameParts } from '../src/lib/gameObjects/wizardPieces'
import { wizardSample, wizardSize, type WizardLayout, type WizardSetting } from '../src/lib/mapWizard'
import { analyzeMap, sampleInput } from '../src/lib/analysis'
import { openVpp, type Vpp } from '../src/lib/sr1char/vpp'

const GAME = process.env.SR1_PACKFILES || 'C:/Games/SaintsReborn/dist/game/packfiles'
const haveGame = existsSync(join(GAME, 'sr_city_stream.vpp_xbox2'))

const MAPS: [WizardSetting, WizardLayout, number][] = [['downtown', 'blocks', 12], ['industrial', 'blocks', 12], ['rundown', 'neighbourhood', 12], ['downtown', 'crossroads', 10]]

describe.skipIf(!GAME_TESTS || !haveGame)('game pieces from Stilwater modules on a local game install', () => {
  it('builds from modules when there are any, and falls back exactly when there are none', async () => {
    const packs = new Map<string, Vpp>()
    for (const p of ['sr_city_stream', 'mp_city_stream', 'misc2']) if (existsSync(join(GAME, p + '.vpp_xbox2'))) packs.set(p, await openVpp(await openAsBlob(join(GAME, p + '.vpp_xbox2')), p))
    const all: Candidate[] = [], seen = new Set<string>()
    for (const [p, vpp] of packs) for (const n of vpp.list()) {
      const c = n.replace(/\.bbchunk_xbox2$/i, '')
      if (c === n || seen.has(c.toLowerCase())) continue
      seen.add(c.toLowerCase())
      try { all.push(...indexChunk(readChunk(await vpp.read(n)), p, c)) } catch { /* counted by the library's own test */ }
    }
    const lib: GameObjectEntry[] = mergeCandidates(all)
    const byId = new Map(lib.map((e) => [e.id, e]))
    const mods = cityModules(lib), grps = groups(lib)
    const report = [`${lib.length} models; ${mods.length} Stilwater modules, ${grps.length} groups in the library`]
    const health = (s: Parameters<typeof sampleInput>[0]) => analyzeMap(sampleInput(s), { rayBudget: 300_000, trips: 60 }).score
    for (const [setting, layout, players] of MAPS) {
      const o = { setting, layout, players, density: 'packed' as const, seed: 4242 }
      const city = new GameCity(lib, o)
      const s = wizardSample(o, city.pieces)
      const today = wizardSample(o, new GamePieces(lib, o))
      if (!city.used) {
        // Nothing to build from (or nothing fits): single game models, with the same placement rules, exactly.
        expect(s, `${setting} ${layout}`).toEqual(wizardSample(o, new GamePieces(lib, { ...o, rule: city.rule })))
        report.push(`${setting} ${layout}: no modules used (${city.ready ? 'none fit' : 'none in the library'}); fell back to single game models, health ${health(today)}`)
        continue
      }
      // Built from modules: every part a model of this library, put in exactly.
      for (const p of gameParts(s)) expect(byId.has(p.game!.id), p.game!.id).toBe(true)
      for (const a of city.placed) for (const b of city.placed) {
        if (a === b) continue
        const g = Math.max(b.x0 - a.x1, a.x0 - b.x1, b.z0 - a.z1, a.z0 - b.z1)
        const faces = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.05 || Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 0.05
        expect(g).toBeGreaterThan(-0.05)
        if (g <= 0.05) expect(joinOk(a, b), `${a.m.name} / ${b.m.name}`).toBe(true)
        else if (faces) expect(g).toBeGreaterThanOrEqual(ALLEY - 0.05)
      }
      const [W, D] = wizardSize(players, layout)
      const reach = reachability({ W, D, strip: 14 }, city.placed, city.placedGroups)
      expect(reach.middle, `${setting} ${layout}: spawns reach the middle`).toBe(true)
      expect(city.pieces.stats.triangles).toBeLessThanOrEqual(TRI_BUDGET)
      expect(city.pieces.stats.textures).toBeLessThanOrEqual(TEXTURE_BUDGET)
      const cs = city.stats
      report.push(`${setting} ${layout}: ${cs.modules} modules (${cs.names.slice(0, 5).join(', ')}), ${cs.groups} groups, ${cs.wallProps} wall things, ${cs.open} open lots; ` +
        `${Math.round(city.pieces.stats.triangles / 1000)}k triangles, ${city.pieces.stats.textures} textures; health ${health(s)} (single models: ${health(today)})` +
        (city.problems.length ? `\n  found: ${city.problems.join(' ')}` : ''))
    }
    console.log(report.join('\n'))
  }, 900_000)
})
