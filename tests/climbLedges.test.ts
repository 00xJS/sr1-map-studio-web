// The health checks' climb ledges (src/lib/analysis/ledges.ts) against the export's (py/climb.py): the same numbers, and
// the same answers on the cases tests/climb_check.py runs through the Python side.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Bvh } from '../src/lib/analysis/bvh'
import { LEDGE_RULES, plan, segments, topEdges } from '../src/lib/analysis/ledges'
import { SOLID } from '../src/lib/analysis/types'
import { UNITS_PER_M } from '../src/lib/player'

interface Case {
  name: string
  verts: number[][]
  marked: number[][]
  other: number[][]
  expect: { segments: number; kept: number; short: number; metres: number; rated: Record<string, number> }
}
const { cases } = JSON.parse(readFileSync('tests/fixtures/climb_ledges.json', 'utf8')) as { cases: Case[] }

/** Every `NAME = value` (and `A, B = x, y`) at the top of py/climb.py. */
function pythonNumbers(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of readFileSync('py/climb.py', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+(?:, [A-Z_]+)*) = ([\d._]+(?:, [\d._]+)*)(?:\s|$)/)
    if (!m) continue
    const names = m[1].split(', '), values = m[2].split(', ')
    names.forEach((n, i) => { out[n] = Number(values[i].replace(/_/g, '')) })
  }
  return out
}

describe('climb ledges: health checks and export agree', () => {
  it('uses the same numbers', () => {
    const py = pythonNumbers()
    for (const [name, value] of Object.entries(LEDGE_RULES)) expect(py[name], name).toBe(value)
  })

  it('has every number the export finds edges by', () => {
    // LOTS is only a warning in the export's log.
    const missing = Object.keys(pythonNumbers()).filter((n) => n !== 'LOTS' && !(n in LEDGE_RULES))
    expect(missing).toEqual([])
  })

  it('covers the cases that went wrong', () => {
    const names = cases.map((c) => c.name).join('\n')
    for (const word of ['0.6 m', '39 degrees', '27 degrees', 'deck']) expect(names).toContain(word)
  })

  for (const c of cases) {
    it(c.name, () => {
      const flat = (faces: number[][]) => faces.flatMap((t) => t.flatMap((i) => c.verts[i]))
      const segs = segments(topEdges(flat(c.marked)))
      // The rays work in the map's units.
      const tris = Float32Array.from(flat([...c.marked, ...c.other]).map((v) => v * UNITS_PER_M))
      const bvh = new Bvh(tris, new Uint8Array(tris.length / 9).fill(SOLID))
      const got = plan(bvh, segs)
      const rated: Record<string, number> = {}
      for (const r of got.rated) rated[r] = (rated[r] ?? 0) + 1
      expect({ segments: segs.length, kept: got.keep.length, short: got.short, rated }).toEqual({
        segments: c.expect.segments, kept: c.expect.kept, short: c.expect.short, rated: c.expect.rated,
      })
      expect(got.metres).toBeCloseTo(c.expect.metres, 2)
    })
  }
})
