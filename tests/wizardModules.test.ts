// The new map wizard's "Game pieces" built from city modules and groups (src/lib/gameObjects/wizardModules.ts),
// with made-up modules, groups, placement rules and library: no game data. Modules join only where their edges
// suit each other, their openings reach the streets, fenced-off roofs stay out of reach, single props keep to
// their rules, the budget holds, and with nothing to build from the wizard falls back to single game models.
import { describe, expect, it } from 'vitest'
import type { GameObjectEntry } from '../src/lib/gameObjects/indexer'
import type { GameIdentity } from '../src/lib/gameObjects/identity'
import type { CityGroup, CityModule, ModuleEdge, PlacementRule, Side } from '../src/lib/gameObjects/cityModules'
import { ALLEY, GameCity, cityFrame, onItsWall, settle, edgeToward, footprintOf, gamePoint, joinOk, reachability, rotFor, sideDir, sideFacing, type Dir, type Placed } from '../src/lib/gameObjects/wizardModules'
import { GamePieces, TEXTURE_BUDGET, TRI_BUDGET, facingVec, gameParts } from '../src/lib/gameObjects/wizardPieces'
import { wizardSample, wizardSize, type WizardOptions } from '../src/lib/mapWizard'
import { over } from '../src/lib/sampleScale'
import { PB, box } from '../src/lib/sampleKit'

// ---- a made-up library ----
type Who = Omit<GameIdentity, 'category' | 'name'>
const who = new Map<string, Who>()
const entries: GameObjectEntry[] = []
const add = (id: string, size: [number, number, number], w: Who, extra: Partial<GameObjectEntry> = {}) => {
  who.set(id, w)
  entries.push({ id, name: id, cat: 'Other', profile: '', pack: 'sr_city_stream', chunk: 'c1', record: 0, size, tris: 600, tex: [id + '_co.tga'], seen: 4, ...extra })
}
add('shop', [12, 10, 9], { role: 'building', settings: ['downtown'], building: { footprint: [12, 10], height: 9, storeys: 3 } }, { tris: 4000 })
add('flats', [10, 9, 14], { role: 'building', settings: ['downtown'], building: { footprint: [10, 9], height: 14, storeys: 4 } }, { tris: 5000 })
add('garage', [12, 10, 5], { role: 'building', settings: [], building: { footprint: [12, 10], height: 5, storeys: 1 } }, { tris: 2000 })
add('walk', [12, 3, 0.2], { role: 'ground', settings: [] }, { tris: 40 })
add('stairs', [3, 1.5, 5], { role: 'piece', settings: [] }, { tris: 300 })
add('wideshop', [16, 14, 9], { role: 'building', settings: ['downtown'], building: { footprint: [16, 14], height: 9, storeys: 3 } }, { tris: 4000 })
add('shed', [14, 12, 6], { role: 'building', settings: ['industrial'], building: { footprint: [14, 12], height: 6, storeys: 1 } })
// Props for groups and the dressing pass.
add('bench', [1.8, 0.6, 0.9], { role: 'prop', kind: 'street', settings: [] })
add('bin', [0.7, 0.7, 1.1], { role: 'prop', kind: 'street', settings: [] })
add('dumpster', [2, 1.2, 1.4], { role: 'prop', kind: 'cover', settings: [] })
add('boxes', [1.2, 1.2, 1.2], { role: 'prop', kind: 'cover', settings: [] })
add('lampbase', [0.6, 0.6, 0.4], { role: 'piece', settings: [] })
add('lamp', [0.6, 1.8, 7], { role: 'prop', kind: 'light', settings: [] }, { assembly: [{ id: 'lampbase', at: [0, 0, 0.6], yaw: 0, share: 1 }] })
add('lonelamp', [0.6, 1.8, 7], { role: 'prop', kind: 'light', settings: [] })
add('wallsign', [1.4, 0.2, 1], { role: 'prop', kind: 'sign', settings: [] })
add('acunit', [1, 0.8, 0.9], { role: 'prop', kind: 'machine', settings: [] })
add('shopdoor', [1.2, 0.3, 2.2], { role: 'prop', kind: 'clutter', settings: [] })
add('tree', [3, 3, 6], { role: 'prop', kind: 'nature', settings: [] })
const identify = (e: GameObjectEntry): GameIdentity => ({ category: 'Other', name: e.id, ...who.get(e.id)! })
const byId = new Map(entries.map((e) => [e.id, e]))

// ---- made-up rules (phase B's shape) ----
const RULES: Record<string, PlacementRule> = {
  wallsign: { attach: 'wall', facing: '+z', mountHeight: 2.2, mayVary: [] },
  acunit: { attach: 'wall', facing: '+z', mayVary: ['nudge'] },
  lamp: { attach: 'ground', needs: ['lampbase'], mayVary: ['turn'] },
  lonelamp: { attach: 'ground', needs: ['lampbase'], mayVary: ['turn'] },
  shopdoor: { attach: 'building', onlyOn: ['shop'], mayVary: [] },
  bench: { attach: 'ground', facing: '+z', clearFront: 1.5, mayVary: ['turn'] },
}
const rule = (e: GameObjectEntry): PlacementRule => RULES[e.id] ?? { attach: 'ground', mayVary: ['turn'] }

// ---- made-up modules and groups (phase A's shape) ----
const edge = (side: Side, kind: ModuleEdge['kind'], ...openings: [number, number][]): ModuleEdge => ({ side, kind, openings: openings.map(([at, width]) => ({ at, width })) })
const mod = (id: string, size: [number, number], edges: ModuleEdge[], o: Partial<CityModule> = {}): CityModule => ({
  id, name: id, kind: 'block', district: 'test', settings: ['downtown'], source: { pack: 'p', chunk: 'c', rect: [0, 0, size[0], size[1]] },
  size, floor: [0, 0], edges, entrances: [], levels: [], tris: 0,
  parts: [{ id: 'shop', at: [0, 0, -1], yaw: 0, layer: 'shell' }, { id: 'walk', at: [0, 0, size[1] / 2 - 1.5], yaw: 0, layer: 'ground' }],
  ...o,
})
const MODULES: CityModule[] = [
  // A shop on the street, walls on three sides, a roof reached by its own stairs.
  mod('corner', [16, 14], [edge('+z', 'street', [0, 4]), edge('-z', 'wall'), edge('+x', 'wall'), edge('-x', 'wall')], { levels: [{ height: 9, reach: 'stairs' }],
    parts: [{ id: 'shop', at: [0, 0, -1], yaw: 0, layer: 'shell' }, { id: 'stairs', at: [-7, 0, -5], yaw: 90, layer: 'detail' }, { id: 'walk', at: [0, 0, 5.5], yaw: 0, layer: 'ground' }] }),
  // An alley down one side, its mouth on the street and a gap out the back.
  mod('alley', [14, 14], [edge('+z', 'street', [4, 4]), edge('+x', 'alley', [0, 3]), edge('-x', 'wall'), edge('-z', 'alley', [4, 3])]),
  // A flat roof nobody may climb onto.
  mod('fenced', [14, 12], [edge('+z', 'sidewalk', [0, 3]), edge('-z', 'wall'), edge('+x', 'wall'), edge('-x', 'wall')], { levels: [{ height: 6, reach: 'none' }],
    parts: [{ id: 'flats', at: [0, 0, 0], yaw: 0, layer: 'shell' }] }),
  // A garage with a deck players can climb to, just under the fenced roof's height.
  mod('garage', [12, 12], [edge('+z', 'street', [0, 6]), edge('-z', 'wall'), edge('+x', 'wall'), edge('-x', 'wall')], { levels: [{ height: 5.5, reach: 'stairs' }],
    parts: [{ id: 'garage', at: [0, 0, 0], yaw: 0, layer: 'shell' }] }),
  // A courtyard open front and back.
  mod('court', [18, 16], [edge('+z', 'street', [0, 6]), edge('-z', 'yard', [0, 6]), edge('+x', 'wall'), edge('-x', 'wall')]),
  // Industrial only: never in a downtown map.
  mod('shedyard', [16, 14], [edge('+z', 'street', [0, 6]), edge('-z', 'wall'), edge('+x', 'wall'), edge('-x', 'wall')], { settings: ['industrial'], parts: [{ id: 'shed', at: [0, 0, 0], yaw: 0, layer: 'shell' }] }),
  // A quay: water on every side, no street to face.
  mod('quay', [12, 12], [edge('+z', 'water'), edge('-z', 'water'), edge('+x', 'water'), edge('-x', 'water')]),
  // Needs a model this player's library doesn't have: never used.
  mod('missing', [12, 12], [edge('+z', 'street', [0, 6])], { parts: [{ id: 'not-in-library', at: [0, 0, 0], yaw: 0, layer: 'shell' }] }),
]
const grp = (id: string, anchor: CityGroup['anchor'], size: [number, number], parts: [string, number, number, number][], back?: Side): CityGroup => ({
  id, name: id, kind: anchor === 'wall' ? 'alley' : 'street', settings: [], anchor, back, size, seen: 12, examples: [],
  parts: parts.map(([pid, x, z, yaw]) => ({ id: pid, at: [x, 0, z], yaw, layer: 'prop' })),
})
const GROUPS: CityGroup[] = [
  grp('dumpster corner', 'wall', [4, 2], [['dumpster', -1, 0, 0], ['boxes', 1.4, 0.2, 15]], '-z'),
  grp('bench and bin', 'ground', [3.5, 1.5], [['bench', 0, 0, 0], ['bin', 1.6, 0, 0]]),
  grp('trees', 'ground', [7, 3], [['tree', -2, 0, 0], ['tree', 2, 0, 0]]),
]

const opts = (o: Partial<WizardOptions> = {}): WizardOptions => ({ setting: 'downtown', layout: 'blocks', players: 10, density: 'packed', seed: 7, ...o })
const city = (o: WizardOptions, extra: Partial<ConstructorParameters<typeof GameCity>[1]> = {}) =>
  new GameCity(entries, { setting: o.setting, seed: o.seed, identify, modules: MODULES, groups: GROUPS, rule, ...extra })

const place = (m: CityModule, x: number, z: number, rot: number): Placed => {
  const [w, d] = footprintOf(m.size, rot)
  return { m, rot, x, z, x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, area: 0 }
}
const M_ = (id: string) => MODULES.find((m) => m.id === id)!
const gap = (a: Placed, b: Placed) => Math.max(b.x0 - a.x1, a.x0 - b.x1, b.z0 - a.z1, a.z0 - b.z1)
const facing = (a: Placed, b: Placed) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.05 || Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 0.05

describe('city modules: frames and sides', () => {
  it('turns each side to face each way, mirroring the game frame into the editor', () => {
    for (const s of ['+x', '-x', '+z', '-z'] as Side[]) for (const d of ['E', 'W', 'S', 'N'] as Dir[]) {
      expect(sideDir(s, rotFor(s, d))).toBe(d)
      expect(sideFacing(rotFor(s, d), d)).toBe(s)
    }
    // The game's +X is the editor's −X; metres to units.
    expect(gamePoint(1, 0, 0)).toEqual([-2, 0])
    expect(sideDir('+x', 0)).toBe('W')
    expect(sideDir('+z', 0)).toBe('S')
    expect(facingVec('+z', 0).map((v) => Math.round(v) + 0)).toEqual([0, 1])
  })

  it('splits red\'s half into areas with streets between, by layout', () => {
    for (const layout of ['blocks', 'neighbourhood', 'crossroads', 'plaza', 'lanes', 'compounds', 'heights'] as const) {
      const [W, D] = wizardSize(10, layout)
      const areas = cityFrame({ W, D, strip: 14 }, { layout, setting: 'downtown' })!
      expect(areas.length, layout).toBeGreaterThan(0)
      for (const a of areas) {
        expect(a.x0).toBeGreaterThanOrEqual(-W / 2 + 3 - 1e-6)
        expect(a.x1).toBeLessThanOrEqual(W / 2 - 3 + 1e-6)
        expect(a.z0).toBeGreaterThanOrEqual(-D / 2 + 14)
        expect(a.z1).toBeLessThanOrEqual(-2)
      }
      // Areas never overlap: a street lies between any two.
      for (const a of areas) for (const b of areas) if (a !== b) expect(Math.max(b.x0 - a.x1, a.x0 - b.x1, b.z0 - a.z1, a.z0 - b.z1)).toBeGreaterThan(0)
    }
    for (const layout of ['arena', 'maze', 'scatter'] as const) expect(cityFrame({ W: 136, D: 136, strip: 14 }, { layout, setting: 'downtown' })).toBeNull()
  })
})

describe('city modules: edges join where they suit each other', () => {
  it('back to back and wall to wall touch; an alley with an opening never runs into a wall', () => {
    const corner = M_('corner'), alley = M_('alley'), court = M_('court')
    // Two corner shops side by side (walls together), both facing south.
    const a = place(corner, 0, 0, rotFor('+z', 'S')), b = place(corner, 16, 0, rotFor('+z', 'S'))
    expect(joinOk(a, b)).toBe(true)
    // Back to back: one facing south, one north, walls touching.
    expect(joinOk(place(corner, 0, 0, rotFor('+z', 'S')), place(corner, 0, -28, rotFor('+z', 'N')))).toBe(true)
    // The alley's open side against a shop wall: blocked.
    const al = place(alley, 0, 0, rotFor('+z', 'S'))
    const east = edgeToward(al, 'E').kind === 'alley' ? 'E' : 'W'
    const wallNext = place(corner, east === 'E' ? 15 : -15, 0, rotFor('+z', 'S'))
    expect(joinOk(al, wallNext)).toBe(false)
    // A courtyard's open back against a corner shop's back wall: blocked (the opening leads nowhere); yard to wall
    // with no opening in the way would do.
    expect(joinOk(place(court, 0, 0, rotFor('+z', 'S')), place(corner, 0, -30, rotFor('+z', 'N')))).toBe(false)
  })

  it('openings line up across a shared side', () => {
    const alley = M_('alley')
    // Two alley modules alley side to alley side: the openings meet in the middle.
    const a = place(alley, 0, 0, rotFor('+z', 'S'))
    const sideA = edgeToward(a, 'E').kind === 'alley' ? 'E' : 'W'
    // The second one turned so its alley faces the first.
    const rot = [0, 90, 180, 270].find((r) => { const p = place(alley, 0, 0, r); return edgeToward(p, sideA === 'E' ? 'W' : 'E').kind === 'alley' })!
    const b = place(alley, sideA === 'E' ? 28 : -28, 0, rot)
    const fp = footprintOf(alley.size, rot)
    const bb = place(alley, (sideA === 'E' ? 1 : -1) * ((a.x1 - a.x0) / 2 + fp[0] / 2), 0, rot)
    const ea = edgeToward(a, sideA), eb = edgeToward(bb, sideA === 'E' ? 'W' : 'E')
    const lined = ea.spans.some((s) => eb.spans.some((t) => Math.min(s[1], t[1]) - Math.max(s[0], t[0]) >= 2))
    expect(joinOk(a, bb)).toBe(lined)
    expect(b).toBeTruthy()
  })
})

describe('city modules: a downtown map built from them', () => {
  const o = opts()
  const c = city(o)
  const s = wizardSample(o, c.pieces)
  const [W, D] = wizardSize(o.players, o.layout)

  it('fills the blocks with whole modules that suit the setting', () => {
    expect(c.used).toBe(true)
    expect(c.placed.length).toBeGreaterThan(1)
    for (const p of c.placed) {
      expect(p.m.settings, p.m.id).toContain('downtown')
      expect(['missing', 'quay', 'shedyard']).not.toContain(p.m.id)
      // Inside its area.
      const a = c.areas[p.area]
      expect(p.x0).toBeGreaterThanOrEqual(a.x0 - 0.05); expect(p.x1).toBeLessThanOrEqual(a.x1 + 0.05)
      expect(p.z0).toBeGreaterThanOrEqual(a.z0 - 0.05); expect(p.z1).toBeLessThanOrEqual(a.z1 + 0.05)
    }
    expect(c.stats.modules).toBe(c.placed.length * 2)
  })

  it('joins modules only where their edges suit, or leaves an alley between', () => {
    for (const a of c.placed) for (const b of c.placed) {
      if (a === b) continue
      const g = gap(a, b)
      expect(g, `${a.m.id}/${b.m.id}`).toBeGreaterThan(-0.05)
      if (g <= 0.05) expect(joinOk(a, b), `${a.m.id} touching ${b.m.id}`).toBe(true)
      else if (facing(a, b)) expect(g, `${a.m.id} near ${b.m.id}`).toBeGreaterThanOrEqual(ALLEY - 0.05)
    }
  })

  it('faces each module\'s street side onto a street, and every opening leads to ground players reach', () => {
    for (const p of c.placed) {
      // Some side of every module is a street-ish edge on the area's edge, facing the street beyond it.
      const a = c.areas[p.area]
      const onStreet = (['E', 'W', 'S', 'N'] as Dir[]).some((d) => a.sides[d] === 'lane' && ['street', 'sidewalk', 'open', 'alley', 'yard'].includes(edgeToward(p, d).kind)
        && Math.abs(d === 'E' ? p.x1 - a.x1 : d === 'W' ? p.x0 - a.x0 : d === 'S' ? p.z1 - a.z1 : p.z0 - a.z0) < ALLEY)
      expect(onStreet, p.m.id).toBe(true)
    }
    const reach = reachability({ W, D, strip: 14 }, c.placed, c.placedGroups)
    c.placed.forEach((p, i) => { if (p.m.edges.some((e) => e.openings.length)) expect(reach.modules[i], p.m.id).toBe(true) })
    expect(c.problems.filter((t) => /can't get into/.test(t))).toEqual([])
  })

  it('keeps fenced-off roofs out of a jump from anything players climb', () => {
    for (const a of c.placed) for (const b of c.placed) {
      if (a.m.id !== 'fenced' || b.m.id !== 'garage') continue
      if (facing(a, b)) expect(gap(a, b)).toBeGreaterThanOrEqual(8 - 0.05)
    }
  })

  it('puts every module part in exactly where the game had it, mirrored for the other team', () => {
    const game = gameParts(s)
    const fromModules = game.filter((p) => p.label.startsWith('Stilwater'))
    const expected = c.placed.reduce((n, p) => n + p.m.parts.length, 0) + c.placedGroups.reduce((n, g) => n + g.g.parts.length, 0)
    expect(fromModules.length).toBe(expected * 2)
    for (const p of fromModules) expect(p.game!.exact).toBe(true)
    // Every part on red's half has its twin turned round the middle.
    for (const p of fromModules.filter((q) => q.at[2] < 0)) {
      const twin = fromModules.find((q) => q.game!.id === p.game!.id && Math.abs(q.at[0] + p.at[0]) < 0.01 && Math.abs(q.at[2] + p.at[2]) < 0.01)
      expect(twin, p.game!.id).toBeTruthy()
      expect(((twin!.rot! - p.rot! + 360) % 360)).toBeCloseTo(180)
    }
    // A part's place in its module: the module's middle plus the part's offset, turned with it.
    const corner = c.placed.find((p) => p.m.id === 'corner')
    if (corner) {
      const [dx, dz] = gamePoint(-7, -5, corner.rot)
      expect(fromModules.some((q) => q.game!.id === 'stairs' && Math.abs(q.at[0] - (corner.x + dx)) < 0.02 && Math.abs(q.at[2] - (corner.z + dz)) < 0.02 && q.rot === (corner.rot + 90) % 360)).toBe(true)
    }
  })

  it('stands wall groups with their back to a module wall and keeps groups off modules and doorways', () => {
    expect(c.placedGroups.length).toBeGreaterThan(0)
    for (const g of c.placedGroups) {
      const r = { ...g, m: MODULES[0], area: 0 }
      for (const p of c.placed) expect(gap(r, p), `${g.g.id} on ${p.m.id}`).toBeGreaterThan(-0.05)
      if (!g.wall) continue
      const own = c.placed.find((p) => gap(r, p) <= 0.05 && facing(r, p) && edgeToward(p, g.wall!).kind === 'wall')
      expect(own, g.g.id).toBeTruthy()
    }
  })

  it('places single props only where their rules allow', () => {
    const game = gameParts(s)
    // A kit piece for one building is never placed on its own.
    expect(game.some((p) => p.game!.id === 'shopdoor')).toBe(false)
    // A lamp comes with its base; one whose base isn't with it in the game never goes in.
    expect(game.some((p) => p.game!.id === 'lonelamp')).toBe(false)
    // Wall things only against a module wall, on the wizard's wall pass (exact, from the module wall).
    for (const p of game.filter((q) => q.game!.id === 'wallsign' || q.game!.id === 'acunit')) expect(p.game!.from, p.game!.id).toBeTruthy()
    // At the height the game hangs it (2.2 m up), on the ground where the rule gives none.
    for (const p of game.filter((q) => q.game!.id === 'wallsign')) expect(p.at[1]).toBeCloseTo(1 + 2.2 * 2)
    for (const p of game.filter((q) => q.game!.id === 'acunit')) expect(p.at[1]).toBeCloseTo(1)
    // A bench keeps the floor in front of it clear.
    for (const b of game.filter((q) => q.game!.id === 'bench' && q.label === 'Game prop')) {
      const [fx, fz] = facingVec('+z', b.rot ?? 0)
      const tip: [number, number] = [b.at[0] + fx * (b.size[2] / 2 + 2), b.at[2] + fz * (b.size[2] / 2 + 2)]
      expect(s.parts.some((q) => q !== b && q.at[1] < b.at[1] + 3.4 && q.at[1] + q.size[1] > b.at[1] + 0.35 && over(q, tip[0], tip[1], 0))).toBe(false)
    }
  })

  it('keeps to the triangle and texture budget', () => {
    expect(c.pieces.stats.triangles).toBeLessThanOrEqual(TRI_BUDGET)
    expect(c.pieces.stats.textures).toBeLessThanOrEqual(TEXTURE_BUDGET)
    // A few modules used again and again rather than many used once.
    expect(c.stats.kinds).toBeLessThanOrEqual(6)
  })

  it('places spawns and weapons round the modules, and the same seed builds the same map', () => {
    expect(s.markers.filter(([t]) => t === 'Red team spawn').length).toBeGreaterThan(2)
    // Never inside a module (on either half): its stand-ins only roughly match the game's models.
    for (const [type, [x, , z]] of s.markers) for (const p of c.placed) for (const k of [1, -1]) {
      const inside = k * x > p.x0 + 0.5 && k * x < p.x1 - 0.5 && k * z > p.z0 + 0.5 && k * z < p.z1 - 0.5
      expect(inside, `${type} at ${x},${z} in ${p.m.id} ${[p.x0, p.x1, p.z0, p.z1]} k${k}`).toBe(false)
    }
    expect(s.parts.some((p) => /Keep out/.test(p.label))).toBe(false)
    const again = wizardSample(o, city(o).pieces)
    expect(again.parts.map((p) => [p.label, p.at, p.game?.id])).toEqual(s.parts.map((p) => [p.label, p.at, p.game?.id]))
  })
})

describe('city modules: other layouts, settings and limits', () => {
  it('builds every layout with big areas from modules, and leaves the others to the layout', () => {
    for (const layout of ['blocks', 'neighbourhood', 'crossroads', 'plaza', 'lanes', 'compounds'] as const) {
      const o = opts({ layout, players: 12 }), c = city(o)
      wizardSample(o, c.pieces)
      expect(c.used, layout).toBe(true)
    }
    for (const layout of ['arena', 'maze', 'scatter'] as const) {
      const o = opts({ layout }), c = city(o)
      wizardSample(o, c.pieces)
      expect(c.used, layout).toBe(false)
    }
  })

  it('falls back to single game models where no module suits the setting', () => {
    const o = opts({ setting: 'suburbs' }), c = city(o, { modules: MODULES.filter((m) => !m.settings.includes('suburbs') && m.settings.length) })
    const s = wizardSample(o, c.pieces)
    expect(c.ready).toBe(false)
    expect(c.used).toBe(false)
    expect(s.parts.some((p) => p.label.startsWith('Stilwater'))).toBe(false)
  })

  it('hangs wall things at the height the game has them, only on walls tall enough', () => {
    // Its walls out to the module's sides (a wall thing goes only where the module's own models are behind it).
    const walled = { ...M_('corner'), parts: [{ id: 'wideshop', at: [0, 0, 0] as [number, number, number], yaw: 0, layer: 'shell' as const }] }
    const o = opts({ players: 12, busy: 100 }), c = city(o, { modules: [walled], groups: [] })
    const s = wizardSample(o, c.pieces)
    const signs = gameParts(s).filter((q) => q.game!.id === 'wallsign')
    expect(signs.length).toBeGreaterThan(0)
    for (const p of signs) expect(p.at[1]).toBeCloseTo(1 + 2.2 * 2)
  })

  it('sizes a part\'s stand-in by its own size across when the study gives it', () => {
    // A fence 6 m along its own Z: without `ext` the box would lie along X (the library's long side default).
    const fenced = mod('yardfence', [16, 14], [edge('+z', 'street', [0, 6]), edge('-z', 'wall'), edge('+x', 'wall'), edge('-x', 'wall')],
      { parts: [{ id: 'shop', at: [0, 0, -2], yaw: 0, layer: 'shell' }, { id: 'walk', at: [7, 0, 0], yaw: 0, layer: 'fence', ext: [0.2, 6] }] })
    const o = opts(), c = city(o, { modules: [fenced] })
    const s = wizardSample(o, c.pieces)
    const walk = gameParts(s).filter((p) => p.game!.id === 'walk' && p.label === 'Stilwater fence')
    expect(walk.length).toBeGreaterThan(0)
    for (const p of walk) expect([p.size[0], p.size[2]]).toEqual([0.4, 12])
  })

  it('stops at the triangle budget and says so', () => {
    const heavy = MODULES.map((m) => ({ ...m, tris: 40_000 }))
    const o = opts({ players: 12, busy: 100 }), c = city(o, { modules: heavy })
    wizardSample(o, c.pieces)
    expect(c.pieces.stats.triangles).toBeLessThanOrEqual(TRI_BUDGET)
    expect(c.placed.length * 2 * 40_000).toBeLessThanOrEqual(TRI_BUDGET * 0.75)
    expect(c.stats.open).toBeGreaterThan(0)
  })

  it('stops at the texture budget', () => {
    // Each module with its own 30 textures.
    const lib = entries.map((e) => (e.id === 'shop' ? { ...e, tex: [...Array(30)].map((_, i) => `shop${i}.tga`) } : e))
    const many = [0, 1, 2, 3, 4].map((k) => ({ ...M_('corner'), id: 'corner' + k, parts: [{ id: 'shop', at: [0, 0, 0] as [number, number, number], yaw: 0, layer: 'shell' as const }] }))
    const tex = lib.map((e) => (e.id === 'garage' ? e : e))
    const o = opts()
    const c = new GameCity(tex, { setting: o.setting, seed: o.seed, identify, modules: many, groups: GROUPS, rule })
    wizardSample(o, c.pieces)
    expect(c.pieces.stats.textures).toBeLessThanOrEqual(TEXTURE_BUDGET)
  })

  it('says when a module with floors players climb to can\'t be got into', () => {
    // Only a sealed block on offer: walls all round, a roof reached by stairs inside.
    const sealed = mod('sealed', [14, 12], [edge('+z', 'wall'), edge('-z', 'wall'), edge('+x', 'wall'), edge('-x', 'wall')], { levels: [{ height: 8, reach: 'stairs' }] })
    const o = opts(), c = city(o, { modules: [sealed] })
    wizardSample(o, c.pieces)
    expect(c.used).toBe(true)
    expect(c.problems.some((t) => t.startsWith('sealed'))).toBe(true)
  })

  it('finds modules only reachable through a neighbour, and ground closed in', () => {
    const [W, D] = [136, 136]
    const corner = M_('corner'), alley = M_('alley')
    // An alley module whose mouth faces the street, and a shop behind it reached only through the alley's back gap.
    const front = place(alley, 0, -20, rotFor('+z', 'S'))
    const back = place(corner, front.x, front.z0 - 7, rotFor('+z', 'N'))
    const reach = reachability({ W, D, strip: 14 }, [front, back])
    expect(reach.modules).toEqual([true, true])
  })
})

describe('city modules: falling back', () => {
  it('with nothing to build from builds the single-model game pieces map, with the same rules, exactly', () => {
    for (const layout of ['blocks', 'neighbourhood', 'crossroads'] as const) {
      const o = opts({ layout })
      // No modules or groups in this library (none of its entries carry any), and the library's own rules.
      const c = new GameCity(entries, { setting: o.setting, seed: o.seed, identify })
      expect(c.ready).toBe(false)
      const s = wizardSample(o, c.pieces)
      const today = wizardSample(o, new GamePieces(entries, { setting: o.setting, seed: o.seed, identify, rule: c.rule }))
      expect(s).toEqual(today)
      expect(c.used).toBe(false)
    }
  })

  it('with modules but none that fit, builds today\'s map exactly too', () => {
    const huge = MODULES.map((m) => ({ ...m, size: [300, 300] as [number, number] }))
    for (const layout of ['blocks', 'neighbourhood', 'plaza'] as const) {
      const o = opts({ layout }), c = new GameCity(entries, { setting: o.setting, seed: o.seed, identify, modules: huge, groups: GROUPS })
      expect(c.ready).toBe(true)
      const s = wizardSample(o, c.pieces)
      expect(c.used, layout).toBe(false)
      expect(s, layout).toEqual(wizardSample(o, new GamePieces(entries, { setting: o.setting, seed: o.seed, identify, rule: c.rule })))
    }
  })

  it('lets each loose prop keep the needs its rule gives it', () => {
    // A neighbourhood's street lamps become game lamps: with their base, as the game places them.
    const o = opts({ layout: 'neighbourhood' })
    const gp = new GamePieces(entries, { setting: o.setting, seed: o.seed, identify, rule })
    const s = wizardSample(o, gp)
    const lamps = gameParts(s).filter((p) => p.game!.id === 'lamp')
    expect(lamps.length).toBeGreaterThan(0)
    for (const l of lamps) expect(gameParts(s).some((q) => q.game!.id === 'lampbase' && Math.hypot(q.at[0] - l.at[0], q.at[2] - l.at[2]) <= 1.3)).toBe(true)
    expect(gameParts(s).some((p) => p.game!.id === 'lonelamp')).toBe(false)
    expect(byId.size).toBe(entries.length)
  })
})

describe('city modules: set down on a flat floor', () => {
  // Units (2 per metre); the floor at y = 1. A house whose yard stood 0.9 m above its feet on a sloped street.
  const b = (label: string, at: [number, number, number], size: [number, number, number]) => ({ ...box(label, size, at, PB.concrete, PB.concrete, 0) })
  it('sinks the building to its yard and brings yard things down onto the floor, with what stands on them', () => {
    const house = b('house', [0, 1, 0], [20, 20, 20])
    const table = b('table', [20, 1 + 1.8, 0], [4, 1.5, 2])
    const cup = b('cup', [20, 1 + 1.8 + 1.5, 0], [0.4, 0.4, 0.4])
    const fence = b('fence', [0, 1 + 1.8, 16], [16, 2.4, 0.2])
    const sign = b('sign', [0, 1 + 3, 16.1], [2, 1, 0.1])
    const lamp = b('lamp', [0, 1 + 6, 0], [1, 1, 1])
    const out = settle([house, table, cup, fence, sign, lamp], ['shell', 'prop', 'detail', 'fence', 'detail', 'detail'], (p) => (p.label === 'sign' ? 'wall' : 'ground'))
    const at = (l: string) => out.find((p) => p.label === l)!.at[1]
    expect(at('house')).toBeCloseTo(1 - 1.8)
    expect(at('table')).toBeCloseTo(1)
    expect(at('cup')).toBeCloseTo(1 + 1.5)
    expect(at('fence')).toBeCloseTo(1)
    expect(at('sign')).toBeCloseTo(1 + 3 - 1.8)
    // Inside the building: with it.
    expect(at('lamp')).toBeCloseTo(1 + 6 - 1.8)
  })
  it('goes down no more than 1.2 m, and never up', () => {
    const house = b('house', [0, 1, 0], [20, 20, 20])
    const high = settle([house, b('bin', [14, 1 + 6, 0], [1, 1, 1])], ['shell', 'prop'], () => 'ground')
    expect(high[0].at[1]).toBeCloseTo(1 - 2.4)
    expect(high[1].at[1]).toBeCloseTo(1)
    const low = settle([house, b('bin', [14, 1 - 1, 0], [1, 1, 1])], ['shell', 'prop'], () => 'ground')
    expect(low[0].at[1]).toBeCloseTo(1)
    expect(low[1].at[1]).toBeCloseTo(1)
  })
  it('leaves out wall things with nothing of the module behind them', () => {
    const house = b('house', [0, 1, 0], [20, 20, 20])
    const out = settle([house, b('poster', [30, 4, 0], [1, 1, 0.1]), b('onhouse', [10.1, 4, 0], [0.1, 1, 1])], ['shell', 'prop', 'prop'], (p) => (p.label === 'house' ? 'ground' : 'wall'))
    expect(out.map((p) => p.label)).toEqual(['house', 'onhouse'])
  })
})

describe('city groups: wall things go on a wall', () => {
  it('puts nothing against a side the study calls a wall where the building stands back from it', () => {
    // The shop (12 x 10) stands 2 m in from the corner module's sides.
    const o = opts({ players: 12, busy: 100 }), c = city(o, { modules: [M_('corner')], groups: [] })
    expect(gameParts(wizardSample(o, c.pieces)).some((q) => q.game!.id === 'wallsign')).toBe(false)
  })
  const group = (parts: [string, number, number][]): CityGroup => ({ id: 'g', name: 'g', kind: 'cover', settings: [], anchor: 'ground', size: [4.4, 6], seen: 3, examples: [],
    parts: parts.map(([id, x, z]) => ({ id, at: [x, 0.5, z], yaw: 0, layer: 'prop' })) })
  const onWall = (id: string) => id.startsWith('poster')
  it('turns the group so its side with them is against a wall', () => {
    const g = onItsWall(group([['crate', -1, 1], ['poster1', 2.15, -1], ['poster2', 2.2, 1]]), onWall)!
    expect([g.anchor, g.back]).toEqual(['wall', '+x'])
  })
  it('leaves them out when they are not along one side, and the group when too little is left', () => {
    expect(onItsWall(group([['crate', -1, 1], ['crate', 1, 1], ['poster1', 0, 0]]), onWall)!.parts.map((p) => p.id)).toEqual(['crate', 'crate'])
    expect(onItsWall(group([['crate', -1, 1], ['poster1', 0, 0]]), onWall)).toBeNull()
    const plain = group([['crate', -1, 1], ['crate', 1, 1]])
    expect(onItsWall(plain, onWall)).toBe(plain)
  })
})
