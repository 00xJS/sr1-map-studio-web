import { describe, expect, it } from 'vitest'
import { ExportTimer, exportStages, formatRemaining } from '../src/lib/exportProgress'

const clock = () => { let t = 0; return { now: () => t, go: (s: number) => { t += s } } }

describe('export progress', () => {
  it('lists the editor and Python stages', () => {
    const ids = exportStages({ boot: true, install: true }).map((s) => s.id)
    expect(ids[0]).toBe('boot')
    expect(ids).toContain('textures')
    expect(ids.at(-1)).toBe('install')
    expect(exportStages({ boot: false, install: false }).map((s) => s.id)).not.toContain('install')
  })

  it('has no estimate the first time, then uses last run and item counts', () => {
    const c = clock()
    const stages = exportStages({ boot: false, install: false })
    const first = new ExportTimer(stages, {}, c.now)
    first.enter('prepare'); c.go(2)
    first.enter('geometry'); c.go(10)
    expect(first.view().remaining).toBeNull()
    first.enter('textures', 1, 4); c.go(5)
    first.enter('textures', 2, 4)
    const v = first.view()
    expect(v.detail).toBe('2/4')
    expect(v.label).toBe('Encoding textures')
    first.enter('pack'); c.go(1)
    const times = first.finish()
    expect(times).toMatchObject({ prepare: 2, geometry: 10, textures: 5, pack: 1 })

    const second = new ExportTimer(stages, times, c.now)
    second.enter('prepare')
    // Whole run of last time still to go.
    expect(second.view().remaining).toBeCloseTo(18)
    c.go(1)
    second.enter('textures', 3, 6)
    c.go(3)
    // Textures: 3 of 6 took 3 s, so 3 s more, then pack's 1 s.
    expect(second.view().remaining).toBeCloseTo(4)
    expect(second.view().fraction).toBeGreaterThan(0.4)
  })

  it('leaves time spent waiting on the user out', async () => {
    const c = clock()
    const t = new ExportTimer(exportStages({ boot: false, install: true }), {}, c.now)
    t.enter('pack'); c.go(1)
    await t.outside(new Promise<void>((done) => setTimeout(() => { c.go(30); done() }, 0)))
    t.enter('install'); c.go(2)
    const times = t.finish()
    expect(times.pack).toBeCloseTo(1)
    expect(times.install).toBeCloseTo(2)
  })

  it('keeps earlier times for stages a run skipped', () => {
    const c = clock()
    const t = new ExportTimer(exportStages({ boot: false, install: false }), { geometry: 9, textures: 20 }, c.now)
    t.enter('prepare'); c.go(1)
    t.enter('extras'); c.go(1)
    expect(t.finish()).toMatchObject({ geometry: 9, textures: 20, prepare: 1, extras: 1 })
  })

  it('formats the estimate', () => {
    expect(formatRemaining(null)).toBe('')
    expect(formatRemaining(3)).toBe('almost done')
    expect(formatRemaining(42)).toBe('about 40 s left')
    expect(formatRemaining(150)).toBe('about 3 min left')
  })
})
