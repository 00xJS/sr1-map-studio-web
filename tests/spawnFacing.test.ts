// Which way spawns face: the health check flags a spawn whose eyes meet a wall within 4 m (analyze.ts), and the
// generators turn spawns the way they see farthest (openHeading, markerPlan.ts) with the middle of the map winning
// ties. Also the site's prefabs standing in for the game dressing's names (siteKit.ts).
import { describe, expect, it } from 'vitest'
import { analyzeMap, sampleInput } from '../src/lib/analysis'
import { FACING_WALL_M } from '../src/lib/analysis/analyze'
import { openHeading, towardMiddle } from '../src/lib/markerPlan'
import { partRay } from '../src/lib/sampleScale'
import { SITE_NAMES, SiteKit } from '../src/lib/siteKit'
import { ALL_PREFABS } from '../src/lib/prefabRegistry'
import { KITS } from '../src/lib/gameObjects/areaKits'
import { wizardSample } from '../src/lib/mapWizard'
import type { MarkerSpec, Part } from '../src/lib/sampleKit'
import type { Vec3 } from '../src/lib/project'

const T = { lib: 'test', surface: 0 } as const
const box = (label: string, size: Vec3, at: Vec3): Part => ({ label, kind: 'box', size, at, top: T, side: T })
const ground = box('Ground', [80, 1, 80], [0, -1, 0])
// A wall across −Z, 3 units (1.5 m) in front of a spawn at z = −20 facing −Z (yaw 0).
const wall = box('Wall', [20, 8, 1], [0, 0, -24])
const spawns = (yaw: number): MarkerSpec[] => [['Red team spawn', [0, 0, -20], { yaw }], ['Blue team spawn', [0, 0, 20], { yaw: 0 }]]

describe('spawns facing a wall', () => {
  const check = (yaw: number) => analyzeMap(sampleInput({ parts: [ground, wall], markers: spawns(yaw) }), { cell: 2, rayBudget: 200_000, trips: 20 })

  it('flags a spawn looking straight at a wall a metre or two away', () => {
    const r = check(0)
    const red = r.spawns.find((s) => s.type === 'Red team spawn')!
    expect(red.facesWallM).toBeGreaterThan(0)
    expect(red.facesWallM).toBeLessThanOrEqual(FACING_WALL_M)
    expect(red.risk).not.toBe('ok')
    expect(red.reasons.some((x) => /faces a wall/i.test(x))).toBe(true)
    expect(r.findings.some((f) => /faces a wall/i.test(f))).toBe(true)
  })

  it('leaves one turned toward open ground alone', () => {
    const red = check(180).spawns.find((s) => s.type === 'Red team spawn')!
    expect(red.facesWallM).toBeUndefined()
    expect(red.reasons.some((x) => /faces a wall/i.test(x))).toBe(false)
  })
})

describe('openHeading', () => {
  const ray = partRay([ground, wall])
  it('turns a spawn by a wall away from it', () => {
    expect(Math.abs(openHeading(ray, [0, 3.24, -20]))).toBe(180)
  })
  it('in the open, looks at the middle of the map', () => {
    const open = partRay([ground])
    const at: Vec3 = [-20, 3.24, 0]
    const h = openHeading(open, at)
    expect(Math.abs(((h - towardMiddle(at)) % 360 + 540) % 360 - 180)).toBeLessThanOrEqual(22.5)
  })
})

describe('site kit', () => {
  it('stands in for every name the area kits ask for that it maps, with prefabs that exist', () => {
    for (const keys of Object.values(SITE_NAMES)) for (const k of keys) expect(ALL_PREFABS[k], k).toBeTruthy()
    const kit = new SiteKit()
    // Every setting's cover list has something to hide behind.
    for (const [setting, k] of Object.entries(KITS)) expect(k.cover.some((i) => kit.coverOf(i.name) === 'stand'), setting).toBe(true)
  })

  it("dresses a Site pieces wizard map the game's way: spawn screens, fronts and cover from the site's prefabs", () => {
    const s = wizardSample({ setting: 'downtown', layout: 'blocks', players: 10, density: 'normal', seed: 1 })
    const used = new Set(s.parts.flatMap((p) => (p.prefab ? [p.prefab.key] : [])))
    const kitKeys = new Set(Object.values(SITE_NAMES).flat())
    expect([...used].filter((k) => kitKeys.has(k)).length).toBeGreaterThanOrEqual(4)
  })
})
