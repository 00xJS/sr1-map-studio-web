import { describe, expect, it } from 'vitest'
import { analyzeMap, analysisKey, collisionFromProject, mirrorCheck, sampleInput, OPAQUE, SOLID, type HealthReport } from '../src/lib/analysis'
import { Bvh } from '../src/lib/analysis/bvh'
import { PLAYER } from '../src/lib/analysis/floor'
import { CROUCH_EYE, CROUCH_HEIGHT, JUMP_HEIGHT, RADIUS, STAND_EYE, STAND_HEIGHT } from '../src/editor/walk'
import { parseObj } from '../src/lib/geometry'
import { shapeObj } from '../src/lib/shapes'
import { newMarker, newProject, type Vec3 } from '../src/lib/project'
import type { MarkerSpec, Part } from '../src/lib/sampleKit'
import { sampleFor } from '../src/lib/samples'

const T = { lib: 'test', surface: 0 } as const
const box = (size: Vec3, at: Vec3, kind: Part['kind'] = 'box'): Part => ({ label: kind, kind, size, at, top: T, side: T })
/** A 60 × 60 floor with its top at y = 0. */
const ground = () => box([60, 1, 60], [0, -1, 0])
const check = (parts: Part[], markers: MarkerSpec[], cell = 2): HealthReport =>
  analyzeMap(sampleInput({ parts, markers }), { cell, rayBudget: 400_000, trips: 60 })
const spawn = (r: HealthReport, n: number) => r.spawns.find((s) => s.number === n)!
const nodeAt = (r: HealthReport, x: number, z: number, y = 0) => {
  const P = r.grid.pos
  let best = -1, bd = Infinity
  for (let i = 0; i < r.grid.count; i++) {
    const d = Math.hypot(P[i * 3] - x, P[i * 3 + 2] - z) + Math.abs(P[i * 3 + 1] - y)
    if (d < bd) { bd = d; best = i }
  }
  return best
}

describe('ray tree', () => {
  const input = sampleInput({ parts: [box([4, 4, 4], [0, 0, 0])], markers: [] })
  const bvh = new Bvh(input.tris, input.flags)
  it('blocks lines through a box and not around it', () => {
    expect(bvh.blocked(-5, 2, 0, 5, 2, 0, SOLID)).toBe(true)
    expect(bvh.blocked(-5, 5, 0, 5, 5, 0, SOLID)).toBe(false)
    expect(bvh.blocked(-5, 2, 3, 5, 2, 3, SOLID)).toBe(false)
  })
  it('lists every surface down a column, highest first', () => {
    const ys: number[] = [], tris: number[] = []
    bvh.column(0.3, 0.2, 10, -10, SOLID, ys, tris)
    expect(ys.map((y) => +y.toFixed(3))).toEqual([4, 0])
    expect(bvh.normalY(tris[0])).toBeCloseTo(1)
    expect(bvh.normalY(tris[1])).toBeCloseTo(-1)
  })
})

describe('player size', () => {
  it('matches the walk-through', () => {
    expect(PLAYER).toMatchObject({ stand: STAND_HEIGHT, standEye: STAND_EYE, crouch: CROUCH_HEIGHT, crouchEye: CROUCH_EYE, radius: RADIUS, jump: JUMP_HEIGHT })
  })
})

describe('spawn safety', () => {
  const teams: MarkerSpec[] = [['Red team spawn', [10, 0, -20]], ['Blue team spawn', [-10, 0, 20]]]

  it('open ground: each spawn sees the other and is easy to camp', () => {
    const r = check([ground()], teams)
    expect(r.spawns).toHaveLength(2)
    for (const s of r.spawns) {
      expect(s.seenBySpawns).toBe(1)
      expect(s.risk).toBe('campable')
      expect(s.exposure).toBeGreaterThan(0.9)
      // Straight across: about 43 units = 21.5 m.
      expect(s.enemyWalkM).toBeGreaterThanOrEqual(21)
      expect(s.enemyWalkM).toBeLessThanOrEqual(25)
    }
    expect(r.findings[0]).toMatch(/^Spawn 1 can be seen from 1 place: easy to camp\.$/)
  })

  it('a solid wall across the map hides the spawns and cuts the path', () => {
    const r = check([ground(), box([60, 8, 1], [0, 0, 0])], teams)
    for (const s of r.spawns) {
      expect(s.seenBySpawns).toBe(0)
      expect(s.enemyWalkM).toBeNull()
    }
  })

  it('a doorway: hidden, and the walk goes round through the gap', () => {
    const r = check([ground(), box([27, 8, 1], [-16.5, 0, 0]), box([27, 8, 1], [16.5, 0, 0])], [['Red team spawn', [20, 0, -20]], ['Blue team spawn', [20, 0, 20]]])
    for (const s of r.spawns) {
      expect(s.seenBySpawns).toBe(0)
      // Straight across is 20 m; round the end of the wall at x = 3 it is 2 × hypot(17, 20) / 2 = 26.2 m.
      expect(s.enemyWalkM).toBeGreaterThanOrEqual(26)
      expect(s.enemyWalkM).toBeLessThan(33)
    }
  })
})

describe('getting around', () => {
  const base: MarkerSpec[] = [['Shared spawn', [-20, 0, -20]], ['Shared spawn', [20, 0, 20]]]
  const onTop: MarkerSpec = ['Weapon pickup', [0, 3, 0], { weapon: 'ak47' }]

  it('a 1.5 m block with no way up: the weapon on it is out of reach', () => {
    const r = check([ground(), box([10, 3, 10], [0, 0, 0])], [...base, onTop])
    expect(r.unreachable.map((u) => u.type)).toEqual(['Weapon pickup'])
    expect(r.findings[0]).toMatch(/can't be used: no way to walk there/)
  })

  it('a ramp up to it makes it reachable', () => {
    const r = check([ground(), box([10, 3, 10], [0, 0, 0]), box([6, 3, 10], [0, 0, 10], 'ramp')], [...base, onTop])
    expect(r.unreachable).toEqual([])
  })

  it('a ledge low enough to jump onto is reachable; drops are one way', () => {
    // The game's jump gets you onto about 1.1 m: a 1 m ledge is fine, a 1.2 m one is not.
    const r = check([ground(), box([10, 2, 10], [0, 0, 0])], [...base, ['Weapon pickup', [0, 2, 0], { weapon: 'ak47' }]])
    expect(r.unreachable).toEqual([])
    const high = check([ground(), box([10, 2.4, 10], [0, 0, 0])], [...base, ['Weapon pickup', [0, 2.4, 0], { weapon: 'ak47' }]])
    expect(high.unreachable.map((u) => u.type)).toEqual(['Weapon pickup'])
  })

  it('stairs climb', () => {
    const r = check([ground(), box([10, 3, 10], [0, 0, 0]), { ...box([6, 3, 8], [0, 0, 9], 'stairs'), segments: 8 }], [...base, onTop])
    expect(r.unreachable).toEqual([])
  })
})

describe('gaps, drops and walls', () => {
  const kinds = (r: HealthReport) => r.moves.map((mv) => mv.kind)
  /** Two 4 m high platforms `gap` units apart (along X), with spawns on the left one. */
  const platforms = (gap: number) => check([ground(), box([16, 8, 20], [-8 - gap / 2, 0, 0]), box([16, 8, 20], [8 + gap / 2, 0, 0])],
    [['Shared spawn', [-10 - gap / 2, 8, -4]], ['Shared spawn', [-10 - gap / 2, 8, 4]]])

  it('a 2 m gap is a run jump; 4 m takes a sprint; 7 m is too wide', () => {
    expect(kinds(platforms(4))).not.toContain('sprint-gap')
    const sprint = platforms(8)
    const gap = sprint.moves.find((mv) => mv.kind === 'sprint-gap')!
    expect(gap.metres).toBe(4)
    expect(gap.text).toBe('A 4 m gap: only a sprinting jump gets across.')
    expect(gap.to![0]).toBeGreaterThan(0)
    expect(sprint.findings.at(-1)).toMatch(/^Getting around: \d+ gaps? only a sprinting jump crosses/)
    const wide = platforms(16) // 8 m (the grid measures gaps to about a metre)
    expect(kinds(wide)).toContain('wide-gap')
    expect(kinds(wide)).not.toContain('sprint-gap')
  })

  it('drops: 4 m is free, 6 m hurts, 11 m kills', () => {
    const from = (h: number) => check([ground(), box([10, h, 10], [0, 0, 0])], [['Shared spawn', [0, h, 0]], ['Shared spawn', [2, h, 2]]])
    expect(kinds(from(8)).filter((k) => k.endsWith('drop'))).toEqual([])
    const hurt = from(12).moves.filter((mv) => mv.kind === 'hurt-drop')
    expect(hurt.length).toBeGreaterThan(0)
    expect(hurt[0].text).toBe('A 6 m drop: falling costs 150 of 375 health.')
    expect(kinds(from(22))).toContain('kill-drop')
    expect(kinds(from(22))).not.toContain('hurt-drop')
  })

  it('a 2 m wall is no way up in an exported map; with stairs it is', () => {
    const base: MarkerSpec[] = [['Shared spawn', [-20, 0, -20]], ['Shared spawn', [20, 0, 20]], ['Weapon pickup', [0, 4, 0], { weapon: 'ak47' }]]
    const wall = check([ground(), box([10, 4, 10], [0, 0, 0])], base)
    expect(wall.unreachable.map((u) => u.type)).toEqual(['Weapon pickup'])
    const climb = wall.moves.filter((mv) => mv.kind === 'climb-only')
    expect(climb.length).toBeGreaterThan(0)
    expect(climb[0].metres).toBe(2)
    expect(climb[0].text).toMatch(/exported maps can't yet/)
    const stairs = check([ground(), box([10, 4, 10], [0, 0, 0]), { ...box([6, 4, 10], [0, 0, 10], 'stairs'), segments: 16 }], base)
    expect(stairs.unreachable).toEqual([])
    expect(kinds(stairs)).not.toContain('climb-only')
  })
})

describe('sight lines', () => {
  it('a waist-high wall hides a crouching player but not a standing one', () => {
    const r = check([ground(), box([60, 2.6, 1], [0, 0, 0])], [['Shared spawn', [0, 0, -20]], ['Shared spawn', [0, 0, 20]]])
    const n = nodeAt(r, 0, 2)
    expect(r.exposure[n]).toBeGreaterThan(0.8)
    expect(r.exposureCrouch[n]).toBeLessThan(0.6)
  })

  it('glass blocks players but not sight', () => {
    const p = newProject()
    const obj = shapeObj({ kind: 'box', size: [60, 8, 1], tile: 4 })
    const floor = shapeObj({ kind: 'box', size: [60, 1, 60], tile: 4 })
    const models = new Map([['/wall.obj', parseObj(obj)], ['/floor.obj', parseObj(floor)]])
    p.scene_items = [
      { uid: 'f', name: 'floor', path: '/floor.obj', position: [0, -1, 0], rotation: [0, 0, 0], scale: 1, textures: {}, alpha: {} },
      { uid: 'g', name: 'glass', path: '/wall.obj', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: {}, alpha: {}, native_prefab: 'sr1_native_glass_3x3' },
    ]
    p.markers = [newMarker('Red team spawn', [0, 0.1, -20]), newMarker('Blue team spawn', [0, 0.1, 20])]
    const input = collisionFromProject(p, (path) => models.get(path))
    expect(new Set(input.flags.slice(12))).toEqual(new Set([SOLID]))
    const r = analyzeMap(input, { cell: 2, rayBudget: 200_000, trips: 20 })
    expect(r.spawns[0].seenBySpawns).toBe(1)
    expect(r.spawns[0].enemyWalkM).toBeNull()
  })

  it('finds the long lines across an open map', () => {
    const r = check([box([200, 1, 30], [0, -1, 0])], [['Shared spawn', [-90, 0, 0]], ['Shared spawn', [90, 0, 0]]])
    expect(r.lanes.length).toBeGreaterThan(0)
    expect(r.lanes[0].metres).toBeGreaterThanOrEqual(85)
  })
})

describe('collision from a project', () => {
  it('leaves out pass-through objects, excluded faces and water; see-through materials only block players', () => {
    const p = newProject()
    const model = parseObj(shapeObj({ kind: 'box', size: [2, 2, 2], tile: 4 }))
    const tris = model.faces.length / 3
    const item = (uid: string, extra: object) => ({ uid, name: uid, path: '/b.obj', position: [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3, scale: 1, textures: {}, alpha: {}, ...extra })
    p.scene_items = [
      item('a', {}),
      item('b', { collision_disabled: true }),
      item('c', { collision_excluded_faces: [0, 1] }),
      item('d', { swimmable_water: true }),
      item('e', { alpha: { top: true } }),
    ]
    const input = collisionFromProject(p, () => model)
    const top = model.faceMat.filter((m) => model.mats[m] === 'top').length
    expect(input.flags.length).toBe(tris * 3 - 2)
    expect(input.flags.slice(0, tris).every((f) => f === (SOLID | OPAQUE))).toBe(true)
    expect(input.flags.slice(tris * 2 - 2).filter((f) => f === SOLID).length).toBe(top)
  })

  it('the report key changes when a spawn moves, not when a light does', () => {
    const p = newProject()
    p.markers = [newMarker('Shared spawn', [0, 0, 0])]
    const k = analysisKey(p)
    p.lights = [{ uid: 'l', name: 'l', enabled: true, position: [0, 3, 0], color: [1, 1, 1], intensity: 1, inner_range: 1, range: 8 }]
    expect(analysisKey(p)).toBe(k)
    p.markers[0].position = [1, 0, 0]
    expect(analysisKey(p)).not.toBe(k)
  })
})

describe('fairness', () => {
  const sym: MarkerSpec[] = [
    ['Red team spawn', [10, 0, -20]], ['Blue team spawn', [-10, 0, 20]],
    ['Weapon pickup', [15, 0, -5], { weapon: 'rpg_launcher' }], ['Weapon pickup', [-15, 0, 5], { weapon: 'rpg_launcher' }],
  ]
  const cover = [box([8, 6, 2], [0, 0, -8]), box([8, 6, 2], [0, 0, 8])]

  it('a point-symmetric map is fair', () => {
    const r = check([ground(), ...cover], sym)
    expect(r.fairness.basis).toBe('teams')
    expect(r.fairness.unmirrored).toEqual([])
    expect(r.fairness.score).toBeGreaterThanOrEqual(95)
    // Grid spots exactly on a box edge can round a metre either way.
    expect(Math.abs(r.fairness.red!.toPowerM! - r.fairness.blue!.toPowerM!)).toBeLessThanOrEqual(1)
  })

  it('a power weapon on one side only is called out', () => {
    const r = check([ground(), ...cover], [...sym.slice(0, 2), ['Weapon pickup', [12, 0, -15], { weapon: 'sniper_rifle' }]])
    expect(r.fairness.score).toBeLessThan(85)
    expect(r.fairness.reasons.join(' ')).toMatch(/Red gets to a power weapon \d+ m sooner/)
    expect(r.fairness.unmirrored).toHaveLength(1)
  })

  it('mirror check pairs red with blue and weapons by kind', () => {
    const m = (type: string, at: Vec3, weapon?: string) => ({ type, position: at, weapon })
    expect(mirrorCheck([m('Red team spawn', [5, 0, -5]), m('Blue team spawn', [-5, 0, 5])])).toEqual([])
    expect(mirrorCheck([m('Weapon pickup', [5, 0, -5], 'ak47'), m('Weapon pickup', [-5, 0, 5], 'm16')])).toHaveLength(2)
  })
})

describe('bot playtest', () => {
  it('bots run between spawns and weapons, through the doorway', () => {
    const r = check([ground(), box([27, 8, 1], [-16.5, 0, 0]), box([27, 8, 1], [16.5, 0, 0])],
      [['Shared spawn', [0, 0, -20]], ['Shared spawn', [0, 0, 20]], ['Weapon pickup', [0, 0, -10], { weapon: 'ak47' }], ['Weapon pickup', [0, 0, 10], { weapon: 'ak47' }]])
    const P = r.grid.pos
    const door = Array.from({ length: r.grid.count }, (_, i) => i).filter((i) => Math.abs(P[i * 3]) < 3 && Math.abs(P[i * 3 + 2]) < 2)
    expect(Math.max(...door.map((i) => r.traffic[i]))).toBeGreaterThan(0.3)
    expect(r.traffic[nodeAt(r, 25, 0)]).toBe(0) // inside the wall line, away from the door
    expect(r.hotspots.length).toBeGreaterThan(0)
  })
})

describe('a big sample map', () => {
  it('Downtown Crossroads: every spawn reachable, fair, quick enough', () => {
    const t = performance.now()
    const r = analyzeMap(sampleInput(sampleFor('u_downtown')), { rayBudget: 300_000, trips: 100 })
    expect(performance.now() - t).toBeLessThan(20_000)
    expect(r.unreachable).toEqual([])
    expect(r.fairness.basis).toBe('teams')
    expect(r.fairness.unmirrored).toEqual([])
    expect(r.fairness.score).toBeGreaterThanOrEqual(90)
    expect(r.spawns.length).toBe(36)
  }, 30_000)
})
