import { describe, expect, it } from 'vitest'
import {
  CAMERA_FOV, FALL, FOG, GRAVITY, JUMP_HEIGHT, JUMP_SPEED, LETHAL_FALL_M, MANTLE, MAX_HP, RUN_SPEED, SPRINT, SPRINT_SPEED, STEP,
  PICKUP_RESPAWN_MS, SprintMeter, fallDamage, pickupRespawnMs,
} from '../src/lib/player'
import { Bvh } from '../src/lib/analysis/bvh'
import { buildFloor, dijkstra, FREE_DROP, LETHAL_DROP, nodeNear, PLAYER, type FloorGraph } from '../src/lib/analysis/floor'
import { sampleInput } from '../src/lib/analysis'
import { withPickupRespawns } from '../src/lib/exporter'
import type { Part } from '../src/lib/sampleKit'
import type { Vec3 } from '../src/lib/project'

const T = { lib: 'test', surface: 0 } as const
const box = (size: Vec3, at: Vec3, kind: Part['kind'] = 'box'): Part => ({ label: kind, kind, size, at, top: T, side: T })
const ground = () => box([60, 1, 60], [0, -1, 0])
function floor(parts: Part[]): FloorGraph {
  const input = sampleInput({ parts, markers: [] })
  return buildFloor(new Bvh(input.tris, input.flags), 1, LETHAL_DROP)
}
/** Walking cost from one spot to another (Infinity: no way). */
function cost(g: FloorGraph, a: Vec3, b: Vec3): number {
  const from = nodeNear(g, ...a), to = nodeNear(g, ...b)
  expect(from).toBeGreaterThanOrEqual(0)
  expect(to).toBeGreaterThanOrEqual(0)
  return dijkstra(g, [from])[to]
}

describe("the game's player numbers", () => {
  it('in metres and seconds', () => {
    const m = (u: number) => u / 2
    expect(m(STEP)).toBeCloseTo(0.28)
    expect(m(JUMP_HEIGHT)).toBeCloseTo(0.85)
    expect(m(GRAVITY)).toBeCloseTo(14.7)
    expect(m(JUMP_SPEED)).toBeCloseTo(5, 1)
    expect((2 * JUMP_SPEED) / GRAVITY).toBeCloseTo(0.68, 2) // time in the air
    expect(m(MANTLE)).toBeCloseTo(1.1)
    expect(m(RUN_SPEED)).toBe(4.5)
    expect(m(SPRINT_SPEED)).toBe(10.6)
    expect(CAMERA_FOV).toBeCloseTo((2 * Math.atan(0.75 * Math.tan(Math.PI / 6)) * 180) / Math.PI, 1)
    expect(FOG.max).toBeLessThan(1)
    expect(PLAYER.step).toBe(STEP)
  })

  it('falls: free to 4 m, then 75 HP a metre, 9 m kills', () => {
    expect(fallDamage(4)).toBe(0)
    expect(fallDamage(5)).toBeCloseTo(75)
    expect(fallDamage(8)).toBeCloseTo(300)
    expect(fallDamage(LETHAL_FALL_M)).toBeCloseTo(MAX_HP)
    expect(LETHAL_FALL_M).toBe(9)
    expect(FREE_DROP).toBe(FALL.freeM * 2)
    expect(LETHAL_DROP).toBe(18)
  })

  it('the sprint meter: 3 s of sprint, refills 2 s later over 6 s, a jump costs 20 %', () => {
    const s = new SprintMeter()
    let t = 0
    while (s.update(0.1, true)) t += 0.1
    expect(t).toBeCloseTo(SPRINT.useS, 0)
    expect(s.empty).toBe(true)
    // Still holding Shift: no more sprint, even once it refills a little.
    for (let i = 0; i < 40; i++) expect(s.update(0.1, true)).toBe(false)
    expect(s.level).toBeGreaterThan(0)
    // Let go: 2 s with no refill counted from the last sprint, then 6 s to full.
    const r = new SprintMeter()
    while (r.update(0.1, true));
    for (let i = 0; i < 18; i++) r.update(0.1, false)
    expect(r.level).toBe(0)
    for (let i = 0; i < 62; i++) r.update(0.1, false)
    expect(r.level).toBe(1)
    r.jump()
    expect(r.level).toBeCloseTo(0.8)
    expect(r.update(0.1, true)).toBe(true)
  })
})

describe('weapon pickup respawn in exported maps', () => {
  const cts = [
    '#Items', '',
    '$Item:\t\t"keep_me"', '$Item type:\t"ak47"', '$Start nav:\t"keep_me"', '',
    '$Item:\t\t"map__studio_$item000"', '$Item type:\t"ak47"', '$Start nav:\t"map__studio_$item000"', '',
    '$Item:\t\t"map__studio_$item001"', '$Item type:\t"sniper_rifle"', '$Start nav:\t"map__studio_$item001"', '',
    '$Item:\t\t"map__studio_$item002"', '$Item type:\t"rpg_launcher"', '$Start nav:\t"map__studio_$item002"', '',
    '#Triggers', '',
  ].join('\r\n')
  const ms = [
    { type: 'Shared spawn', weapon: '', label: '' },
    { type: 'Weapon pickup', weapon: 'ak47', label: 'ak47' },
    { type: 'Weapon pickup', weapon: 'sniper_rifle', label: 'sniper_rifle' },
    { type: 'Weapon pickup', weapon: 'rpg_launcher', label: 'rpg_launcher', respawn_ms: 45000 },
  ]

  it("writes each pickup's time: the game's default, or the marker's own", () => {
    const out = withPickupRespawns(cts, ms)
    expect(out.match(/\$Respawn Delay:\t\d+/g)).toEqual(['$Respawn Delay:\t15000', '$Respawn Delay:\t20000', '$Respawn Delay:\t45000'])
    expect(out).toContain('$Start nav:\t"map__studio_$item001"\r\n$Respawn Delay:\t20000\r\n\r\n')
    // The template's own items are left alone, and running it twice adds nothing.
    expect(out).toContain('$Start nav:\t"keep_me"\r\n\r\n')
    expect(withPickupRespawns(out, ms)).toBe(out)
    expect(pickupRespawnMs('rpg_laser')).toBe(PICKUP_RESPAWN_MS.launcher)
    expect(pickupRespawnMs('tec9', 0)).toBe(PICKUP_RESPAWN_MS.normal)
  })
})

describe('getting around like the game', () => {
  it('walks up a 0.25 m kerb, has to jump a 0.4 m one, and cannot get onto 1.2 m', () => {
    const at: Vec3 = [-10, 0.1, 0]
    const kerb = (h: number) => floor([ground(), box([20, h, 30], [10, 0, 0])])
    const walk = cost(kerb(0.5), at, [10, 0.6, 0])
    const jump = cost(kerb(0.8), at, [10, 0.9, 0])
    expect(Number.isFinite(walk)).toBe(true)
    expect(jump).toBeGreaterThan(walk + 1) // a jump costs more than walking
    expect(Number.isFinite(cost(kerb(2), at, [10, 2.1, 0]))).toBe(true)
    expect(cost(kerb(2.4), at, [10, 2.5, 0])).toBe(Infinity)
  })

  it('walks up a 45° ramp and stairs with low steps, not a 65° slope; tall steps take a jump each', () => {
    const top: Vec3 = [0, 6.1, -10]
    const platform = box([10, 6, 10], [0, 0, -10])
    const up = (part: Part) => cost(floor([ground(), platform, part]), [0, 0.1, 20], top)
    expect(up(box([6, 6, 6], [0, 0, -2], 'ramp'))).toBeLessThan(Infinity)
    expect(up(box([6, 6, 2.8], [0, 0, -3.6], 'ramp'))).toBe(Infinity)
    const low = up({ ...box([6, 6, 12], [0, 0, 1], 'stairs'), segments: 16 }) // 0.19 m steps
    // The Stairs shape never makes a step the player can't walk up: asked for 6 (0.5 m each), it builds 12.
    const asked = up({ ...box([6, 6, 12], [0, 0, 1], 'stairs'), segments: 6 })
    // Steps of 0.5 m built one by one: a jump each.
    const steps = [0, 1, 2, 3, 4, 5].map((i) => box([6, i + 1, 2], [0, 0, 6 - 2 * i]))
    const tall = cost(floor([ground(), platform, ...steps]), [0, 0.1, 20], top)
    expect(low).toBeLessThan(Infinity)
    expect(asked).toBeLessThan(low + 2)
    expect(tall).toBeGreaterThan(low + 6)
  })

  it('drops: free to 4 m, costly to 9 m, never one that kills', () => {
    const from = (h: number) => cost(floor([ground(), box([10, h, 10], [0, 0, 0])]), [0, h + 0.1, 0], [0, 0.1, 15])
    const low = from(6), hurt = from(14)
    expect(Number.isFinite(low)).toBe(true)
    expect(hurt).toBeGreaterThan(low + 10)
    expect(from(20)).toBe(Infinity)
  })
})
