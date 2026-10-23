import { describe, expect, it } from 'vitest'
import { ALL_PREFABS } from '../src/lib/prefabRegistry'
import { fights, unflicker, NUDGE } from '../src/lib/zfight'
import type { Part } from '../src/lib/sampleKit'

const tex = { gen: 'concrete' } as Part['top']
const box = (label: string, size: [number, number, number], at: [number, number, number], rot = 0): Part => ({ label, kind: 'box', size, at, rot, top: tex, side: tex })

describe('flicker (z-fighting)', () => {
  it('finds a crate rim level with the fruit in it, and lifts the smaller piece', () => {
    const crate = [box('Produce crate', [1.8, 0.7, 1.3], [0, 0, 0], 5), box('Crate rim', [1.9, 0.08, 1.4], [0, 0.62, 0], 5)]
    expect(fights(crate)).toHaveLength(1)
    const fixed = unflicker(crate)
    expect(fights(fixed)).toEqual([])
    expect(fixed[1].size[1]).toBeCloseTo(0.08 + NUDGE)
    expect(fixed[0]).toEqual(crate[0])
  })

  it('pulls flush sides apart, turned boxes too, and leaves separate pieces alone', () => {
    const flush = [box('Wall', [4, 3, 0.4], [0, 0, 0], 30), box('Trim', [1, 1, 0.4], [0.5 * Math.cos(Math.PI / 6), 1, -0.5 * Math.sin(Math.PI / 6)], 30)]
    expect(fights(flush).length).toBeGreaterThan(0)
    expect(fights(unflicker(flush))).toEqual([])
    const apart = [box('A', [1, 1, 1], [0, 0, 0]), box('B', [1, 1, 1], [3, 0, 0])]
    expect(unflicker(apart)).toBe(apart)
  })

  it('a row of identical pieces moves only a few centimetres', () => {
    const row = [...Array(12)].map((_, i) => box('Rail', [2, 0.2, 0.2], [i * 1.5, 1, 0]))
    const fixed = unflicker(row)
    expect(fights(fixed)).toEqual([])
    const grown = Math.max(...fixed.map((p, i) => Math.max(...p.size.map((v, k) => v - row[i].size[k]))))
    expect(grown).toBeLessThanOrEqual(3 * NUDGE + 1e-9)
  })

  it('leaves almost no flicker in any prefab, and moves nothing far', () => {
    let left = 0, worst = 0
    for (const def of Object.values(ALL_PREFABS)) {
      const parts = def.make(0, 0, 0, 0)
      const fixed = unflicker(parts)
      left += fights(fixed).length
      fixed.forEach((p, i) => { for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(p.size[k] - parts[i].size[k]), Math.abs(p.at[k] - parts[i].at[k])) })
    }
    // What's left is ramps and tilted logs, which can't be nudged.
    expect(left).toBeLessThanOrEqual(40)
    expect(worst).toBeLessThanOrEqual(0.3)
    console.log(`flicker left ${left}, largest change ${worst.toFixed(3)} units`)
  }, 120000)
})
