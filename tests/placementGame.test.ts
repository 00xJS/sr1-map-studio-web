// Placement rules on a local Saints Reborn install (SR1_PACKFILES, or the default install folder), behind
// `npm run test:game`: indexes the library the way the browser does (with how the game stands each model) and checks
// the rules against what is known about the game's models: posters and switches go on walls, ceiling lights hang,
// chairs and benches stand on the floor, building kits stay on their buildings, lamp bases need their lamp and the
// lamp its base. Nothing from the game is written into the repo.
import { describe, expect, it } from 'vitest'
import { existsSync, openAsBlob } from 'node:fs'
import { join } from 'node:path'
import { GAME_TESTS } from './testMode'
import { readChunk } from '../src/lib/gameObjects/chunk'
import { indexChunk, mergeCandidates, type Candidate, type GameObjectEntry } from '../src/lib/gameObjects/indexer'
import { identify } from '../src/lib/gameObjects/identity'
import { placementRules } from '../src/lib/gameObjects/placement'
import { SIDES } from '../src/lib/gameObjects/sits'
import type { PlacementRule } from '../src/lib/gameObjects/cityModules'
import { openVpp } from '../src/lib/sr1char/vpp'

const GAME = process.env.SR1_PACKFILES || 'C:/Games/SaintsReborn/dist/game/packfiles'
const haveGame = existsSync(join(GAME, 'sr_city_stream.vpp_xbox2'))

describe.skipIf(!GAME_TESTS || !haveGame)('placement rules from a local game install', () => {
  it('places each kind of model the way the game does', async () => {
    const all: Candidate[] = [], seen = new Set<string>()
    for (const p of ['sr_city_stream', 'mp_city_stream', 'misc2']) {
      if (!existsSync(join(GAME, p + '.vpp_xbox2'))) continue
      const vpp = await openVpp(await openAsBlob(join(GAME, p + '.vpp_xbox2')), p)
      for (const n of vpp.list()) {
        const c = n.replace(/\.bbchunk_xbox2$/i, '')
        if (c === n || seen.has(c.toLowerCase())) continue
        seen.add(c.toLowerCase())
        try { all.push(...indexChunk(readChunk(await vpp.read(n)), p, c)) } catch { /* counted by the library's own test */ }
      }
    }
    const lib: GameObjectEntry[] = mergeCandidates(all)
    const byId = new Map(lib.map((e) => [e.id, e]))
    const rules = placementRules(lib)
    // Most models the game places more than once were seen in a street the rays could read.
    const placed = lib.filter((e) => e.seen >= 2 && ['prop', 'piece', 'fence'].includes(identify(e).role))
    expect(placed.filter((e) => e.sits?.n).length / placed.length).toBeGreaterThan(0.6)

    /** Of the models with this name (and enough placements looked at), the share whose rule passes. */
    const share = (name: string, role: string, ok: (r: PlacementRule) => boolean) => {
      const es = lib.filter((e) => identify(e).name === name && identify(e).role === role && (e.sits?.n ?? 0) >= 3)
      expect(es.length, name).toBeGreaterThan(2)
      return es.filter((e) => ok(rules.get(e.id)!)).length / es.length
    }
    const onWall = (r: PlacementRule) => r.attach === 'wall' || r.attach === 'building'
    expect(share('Poster', 'prop', onWall)).toBeGreaterThanOrEqual(0.75)
    expect(share('Light switch', 'piece', onWall)).toBeGreaterThanOrEqual(0.8)
    expect(share('Ceiling light', 'piece', (r) => r.attach === 'hang' || r.attach === 'building')).toBeGreaterThanOrEqual(0.85)
    expect(share('Chair', 'prop', (r) => r.attach === 'ground')).toBeGreaterThanOrEqual(0.95)
    expect(share('Bench', 'prop', (r) => r.attach === 'ground')).toBeGreaterThanOrEqual(0.95)
    expect(share('Table', 'prop', (r) => r.attach === 'ground')).toBeGreaterThanOrEqual(0.85)

    // A building's own pieces stay on it: nearly every kit piece is kept to the buildings the game puts it on
    // (a few furniture and clutter pieces found in one building only are left free).
    const kits = lib.filter((e) => e.kitOf && e.belongsTo?.length && !['prop', 'skip'].includes(identify(e).role))
    expect(kits.length).toBeGreaterThan(1000)
    const kept = kits.filter((e) => { const r = rules.get(e.id)!; return r.attach === 'building' && r.onlyOn?.join() === e.belongsTo!.join() })
    expect(kept.length / kits.length).toBeGreaterThanOrEqual(0.97)

    // A lamp base the lamp nearly always stands on needs that lamp, and the lamp needs it.
    const bases = lib.filter((e) => identify(e).name === 'Street lamp base' && e.partOf && rules.get(e.id)!.needs?.includes(e.partOf))
    expect(bases.length).toBeGreaterThan(3)
    for (const b of bases) {
      expect(rules.get(b.partOf!)!.needs, b.name).toContain(b.id)
      expect(rules.get(b.id)!.attach).toBe(rules.get(b.partOf!)!.attach)
    }
    // Fence panels and their feet: nearly always both ways (a panel can have other feet some of the time).
    const feet = lib.filter((e) => /fence/i.test(identify(e).name) && identify(e).name.endsWith('base') && e.partOf && rules.get(e.id)!.needs?.includes(e.partOf))
    expect(feet.length).toBeGreaterThan(5)
    expect(feet.filter((f) => rules.get(f.partOf!)!.needs?.includes(f.id)).length / feet.length).toBeGreaterThanOrEqual(0.8)

    // Every rule is well formed: known models only, buildings to stand on, a side of its own frame to face.
    for (const e of lib) {
      const r = rules.get(e.id)!
      expect(['ground', 'wall', 'roof', 'hang', 'building']).toContain(r.attach)
      if (r.facing) expect(SIDES).toContain(r.facing)
      for (const n of r.needs ?? []) expect(byId.has(n), e.name).toBe(true)
      for (const b of r.onlyOn ?? []) expect(identify(byId.get(b)!).role, e.name).toBe('building')
    }
  }, 900_000)
})
