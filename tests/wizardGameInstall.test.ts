// The new map wizard's "Game pieces" on a local Saints Reborn install (SR1_PACKFILES, or the default install folder),
// behind `npm run test:game`: indexes the library the way the browser does, builds one map per setting from it, and
// checks every model placed is a building, prop or fence, and that each building, cut out and turned the way the map
// builder turns it, fits its plot. Nothing from the game is written into the repo.
import { describe, expect, it } from 'vitest'
import { existsSync, openAsBlob } from 'node:fs'
import { join } from 'node:path'
import { GAME_TESTS } from './testMode'
import { readChunk, type Chunk } from '../src/lib/gameObjects/chunk'
import { indexChunk, mergeCandidates, type Candidate, type GameObjectEntry } from '../src/lib/gameObjects/indexer'
import { extractObject } from '../src/lib/gameObjects/extract'
import { identify } from '../src/lib/gameObjects/identity'
import { GamePieces, TEXTURE_BUDGET, TRI_BUDGET, gameParts, modelTurn } from '../src/lib/gameObjects/wizardPieces'
import { wizardSample, type WizardLayout, type WizardSetting } from '../src/lib/mapWizard'
import { openVpp, type Vpp } from '../src/lib/sr1char/vpp'
import { turn } from '../src/lib/sampleKit'
import { SOLID_COVER, eyeCover } from '../src/lib/gameObjects/wizardBuild'

const GAME = process.env.SR1_PACKFILES || 'C:/Games/SaintsReborn/dist/game/packfiles'
const haveGame = existsSync(join(GAME, 'sr_city_stream.vpp_xbox2'))

const MAPS: [WizardSetting, WizardLayout, number][] = [
  ['downtown', 'blocks', 10], ['industrial', 'blocks', 10], ['rundown', 'neighbourhood', 12], ['rundown', 'blocks', 10],
  ['suburbs', 'plaza', 10], ['docks', 'crossroads', 10], ['construction', 'blocks', 10], ['military', 'compounds', 12], ['paintball', 'lanes', 8],
]

describe.skipIf(!GAME_TESTS || !haveGame)('game pieces from a local game install', () => {
  it('builds a map per setting from real models that fit', async () => {
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
    const chunks = new Map<string, Chunk>()
    const chunk = async (e: GameObjectEntry) => {
      const k = e.pack + '/' + e.chunk
      if (!chunks.has(k)) chunks.set(k, readChunk(await packs.get(e.pack)!.read(e.chunk + '.bbchunk_xbox2')))
      return chunks.get(k)!
    }
    const byId = new Map(lib.map((e) => [e.id, e]))
    const report: string[] = []
    const covers = new Map<string, number>()
    for (const [setting, layout, players] of MAPS) {
      const o = { setting, layout, players, density: 'packed' as const, seed: 4242 }
      const gp = new GamePieces(lib, o)
      const s = wizardSample(o, gp)
      const game = gameParts(s)
      expect(game.length, setting).toBeGreaterThan(0)
      const st = gp.stats
      expect(st.triangles).toBeLessThanOrEqual(TRI_BUDGET)
      expect(st.textures).toBeLessThanOrEqual(TEXTURE_BUDGET)
      for (const p of game) {
        const e = byId.get(p.game!.id)!
        const id = identify(e)
        expect(['building', 'prop', 'fence'], `${e.name} (${id.role})`).toContain(id.role)
        if (id.role !== 'building') continue
        expect(p.label).toBe('Game building')
        // Cut out, turned as the map builder turns it: its footprint inside the stand-in's (the plot it was chosen for).
        const mesh = extractObject(await chunk(e), e)
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
        for (let i = 0; i < mesh.positions.length; i += 3) {
          x0 = Math.min(x0, mesh.positions[i]); x1 = Math.max(x1, mesh.positions[i]); z0 = Math.min(z0, mesh.positions[i + 2]); z1 = Math.max(z1, mesh.positions[i + 2])
        }
        const ex = (x1 - x0) * 2, ez = (z1 - z0) * 2
        const rot = modelTurn(ex, ez, p, id.building?.front)
        const [ax, az] = turn(ex, ez, rot - (p.rot ?? 0)).map(Math.abs)
        expect(ax, `${e.name} across`).toBeLessThanOrEqual(p.size[0] + 0.6)
        expect(az, `${e.name} deep`).toBeLessThanOrEqual(p.size[2] + 0.6)
        // How solid it is at eye height (editor units: twice the metres); the map builder puts a plain block in for the rest.
        if (!covers.has(e.id)) covers.set(e.id, eyeCover({ positions: mesh.positions.map((v) => v * 2), faces: mesh.triangles }))
      }
      const built = game.filter((p) => p.label === 'Game building')
      const solid = built.filter((p) => covers.get(p.game!.id)! >= SOLID_COVER).length
      const buildings = [...new Set(built.map((p) => `${p.game!.name} [${byId.get(p.game!.id)!.name}] ${covers.get(p.game!.id)!.toFixed(2)}`))].join(', ')
      const names = (role: string) => [...new Set(game.filter((p) => identify(byId.get(p.game!.id)!).role === role).map((p) => p.game!.name))].slice(0, 6).join(', ')
      report.push(`${setting} ${layout}: ${st.buildings} buildings (${solid} solid at eye height), ${st.props} props, ${st.lights} lights, ${st.fences} fences from ${st.models} models; ` +
        `${st.kept} kept the site's; ${Math.round(st.triangles / 1000)}k triangles, ${st.textures} textures\n  buildings (eye cover): ${buildings || '-'}\n  props: ${names('prop') || '-'}`)
    }
    console.log(report.join('\n'))
  }, 900_000)
})
