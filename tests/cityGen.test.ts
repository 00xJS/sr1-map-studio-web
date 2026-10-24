import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CITY_SIZES, DISTRICTS, citySample, type CitySize } from '../src/lib/cityGen'
import { blocker, support } from '../src/lib/sampleScale'
import { checkModes } from '../src/lib/levels'
import { newMarker } from '../src/lib/project'
import { KINDS } from '../src/lib/procedural'
import { catalogs } from '../src/lib/catalogs'
import { parsePath, type Pt } from '../src/lib/roads'
import type { Part, Sample } from '../src/lib/sampleKit'

/** Each city is built once and shared by the tests that look at it. */
const built = new Map<string, Sample>()
const city = (size: CitySize, seed: number) => {
  const k = `${size} ${seed}`
  if (!built.has(k)) built.set(k, citySample({ size, seed }))
  return built.get(k)!
}

const library = new Set((JSON.parse(readFileSync('public/textures/index.json', 'utf8')).textures as { id: string }[]).map((t) => t.id))

/** The street centrelines of a city (its one road prefab). */
const streets = (s: Sample) => parsePath(s.parts.find((p) => p.prefab?.key === 'road')!.prefab!.params.path)
const segments = (s: Sample) => streets(s).flatMap((l) => l.slice(1).map((q, k): [Pt, Pt] => [l[k], q]))
const dist = ([x, z]: Pt, [a, b]: [Pt, Pt]) => {
  const ex = b[0] - a[0], ez = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez)))
  return Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t)
}
/** A part's outline seen from above. */
const outline = (p: Part): Pt[] => {
  const t = ((p.rot ?? 0) * Math.PI) / 180, turn = ([x, z]: Pt): Pt => [p.at[0] + x * Math.cos(t) + z * Math.sin(t), p.at[2] - x * Math.sin(t) + z * Math.cos(t)]
  if (p.kind === 'blob' && p.outline) return p.outline.map(turn)
  const w = p.size[0] / 2, d = p.size[2] / 2
  return ([[-w, -d], [w, -d], [w, d], [-w, d]] as Pt[]).map(turn)
}

describe('the Stilwater-style city', () => {
  for (const size of Object.keys(CITY_SIZES) as CitySize[]) {
    it(`${size}: every marker on the street with head room, modes ready, textures and lights valid`, () => {
      for (const seed of [1, 42]) {
        const s = city(size, seed)
        const problems = s.markers.filter(([, p]) => support(s.parts, p) < 0 || blocker(s.parts, p)).map(([t, p]) => `${t} at ${p}`)
        expect(problems, `seed ${seed}`).toEqual([])
        const markers = s.markers.map(([type, at, patch]) => ({ ...newMarker(type, at), ...patch }))
        expect(checkModes({ modes: s.modes }, markers).errors).toEqual([])
        for (const p of s.parts) for (const t of [p.top, p.side]) {
          if ('lib' in t) expect(library.has(t.lib), t.lib).toBe(true)
          else expect('gen' in t && KINDS[t.gen], JSON.stringify(t)).toBeTruthy()
        }
        expect(s.lights!.length).toBeLessThanOrEqual(catalogs.limits.max_lights)
        expect(s.parts.some((p) => p.water)).toBe(true)
      }
    })
  }

  it('a city has every district, and the same seed gives the same city', () => {
    for (const size of ['city', 'big'] as const) for (const seed of [1, 2, 3, 4, 5, 6, 9]) {
      const s = city(size, seed)
      const lots = new Set(s.parts.map((p) => p.label).filter((l) => / lot$/.test(l)))
      for (const d of Object.values(DISTRICTS)) expect(lots, `${size} seed ${seed}: ${d.label}`).toContain(`${d.label} lot`)
    }
    for (const size of Object.keys(CITY_SIZES) as CitySize[]) {
      expect(JSON.stringify(citySample({ size, seed: 3 }))).toBe(JSON.stringify(city(size, 3)))
      expect(JSON.stringify(city(size, 3))).not.toBe(JSON.stringify(city(size, 4)))
    }
  })

  it('the streets are not a perfect grid: a diagonal, a bend, wedge-shaped blocks', () => {
    for (const size of Object.keys(CITY_SIZES) as CitySize[]) for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = city(size, seed), segs = segments(s)
      const angle = ([a, b]: [Pt, Pt]) => { const t = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI) % 90; return Math.min(t, 90 - t) }
      const length = (k: [Pt, Pt][]) => k.reduce((sum, [a, b]) => sum + Math.hypot(b[0] - a[0], b[1] - a[1]), 0)
      // A diagonal (20° or more off the grid), and street that bends or leans a little.
      expect(segs.some((q) => angle(q) > 20), `${size} seed ${seed}: a diagonal`).toBe(true)
      expect(segs.some((q) => angle(q) > 1 && angle(q) < 16), `${size} seed ${seed}: a bend`).toBe(true)
      // Some street length off the two main directions.
      expect(length(segs.filter((q) => angle(q) > 1)) / length(segs), `${size} seed ${seed}`).toBeGreaterThan(0.06)
      // Wedge-shaped blocks where the diagonal cuts across.
      expect(s.parts.some((p) => / lot$/.test(p.label) && p.outline!.length === 3), `${size} seed ${seed}: a wedge`).toBe(true)
    }
  })

  it('buildings stay off the streets and sidewalks; the river, bridges and freeway are kept', () => {
    for (const size of Object.keys(CITY_SIZES) as CitySize[]) for (const seed of [1, 2, 3]) {
      const s = city(size, seed), segs = segments(s)
      // Every building's footprint is a sidewalk's width (21 units) or more from every street's middle.
      const near = s.parts.filter((p) => p.label === 'Building' || p.label === 'Flatiron' || p.label === 'Corner building').flatMap((p) => outline(p).filter((q) => segs.some((g) => dist(q, g) < 20.5)).map((q) => `${p.label} at ${p.at} (${q.map((v) => v.toFixed(1))})`))
      expect(near, `${size} seed ${seed}`).toEqual([])
      expect(s.parts.filter((p) => p.label === 'Bridge deck').length, `${size} seed ${seed}`).toBeGreaterThanOrEqual(2)
      expect(s.parts.filter((p) => p.label === 'Freeway ramp').length).toBe(2)
      expect(s.parts.some((p) => p.label === 'Freeway deck')).toBe(true)
      expect(s.parts.filter((p) => p.label === 'Quay').length).toBe(2)
    }
  })

  it('each district has its own colours', () => {
    const walls = new Map<string, Set<string>>()
    for (const seed of [1, 2, 3]) {
      const s = city('big', seed)
      for (const p of s.parts) {
        const t = p.side as { gen?: string; tweak?: { color?: string } }
        if (t.gen === 'facade' && t.tweak?.color) walls.set(p.label, (walls.get(p.label) ?? new Set()).add(t.tweak.color))
      }
    }
    const used = new Set([...walls.values()].flatMap((w) => [...w]))
    for (const [key, d] of Object.entries(DISTRICTS)) for (const paint of d.paints) if (paint.wall) expect(used, `${key}: ${paint.wall}`).toContain(paint.wall)
    // Downtown is grey, glass and stone: no brick towers.
    const towers = [...walls.entries()].filter(([l]) => l === 'Flatiron').flatMap(([, w]) => [...w])
    expect(towers.length).toBeGreaterThan(0)
    for (const c of towers) expect(['#8a3b2a', '#5e3528']).not.toContain(c)
  })
})
