// The invisible ramps over tall steps (src/lib/stairRamps.ts), on stairs made here from boxes (editor units).
import { describe, expect, it } from 'vitest'
import { findStairs, rampPieces, scaleRuns, MAX_RAMP_DEG, SINGLE_DEG, SINGLE_MAX_RISER } from '../src/lib/stairRamps'
import { compoundObj, shapeObj } from '../src/lib/shapes'
import { parseObj } from '../src/lib/geometry'
import { STEP } from '../src/lib/player'
import { cleanRecipe, validShape } from '../src/lib/recipes'

type V = [number, number, number]

/** A box's 12 triangles, turned by `yaw` degrees about the origin. */
function box(lo: V, hi: V, yaw = 0): number[] {
  const t = (yaw * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t)
  const p = (x: number, y: number, z: number): V => [x * c + z * s, y, -x * s + z * c]
  const [x0, y0, z0] = lo, [x1, y1, z1] = hi
  const v = [p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1), p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1)]
  const quads = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]
  const out: number[] = []
  for (const [a, b, cc, d] of quads) out.push(...v[a], ...v[b], ...v[cc], ...v[a], ...v[cc], ...v[d])
  return out
}

/** Ground, then `n` steps rising toward +Z (turned by `yaw`), `width` across, then a landing. */
function stairs(n: number, rise: number, tread: number, width = 4, yaw = 0): Float32Array {
  const out = box([-40, -1, -40], [40, 0, 40], yaw)
  for (let k = 0; k < n; k++) out.push(...box([-width / 2, 0, k * tread], [width / 2, (k + 1) * rise, (k + 1) * tread], yaw))
  out.push(...box([-width / 2, 0, n * tread], [width / 2, n * rise, n * tread + 6], yaw))
  return Float32Array.from(out)
}

describe('ramps over steps too tall to walk up', () => {
  it('finds a flight of tall steps and lays a ramp over the nosings', () => {
    const runs = findStairs(stairs(6, 0.8, 1.2))
    expect(runs).toHaveLength(1)
    const r = runs[0]
    // Six risers, plus the landing's: the landing is the top step's tread.
    expect(r.steps).toBe(6)
    expect(r.rise).toBeCloseTo(0.8, 2)
    expect(r.tread).toBeCloseTo(1.2, 2)
    expect(r.up[0]).toBeCloseTo(0, 3)
    expect(r.up[1]).toBeCloseTo(1, 3)
    expect(r.width).toBeCloseTo(4, 2)
    expect(r.slopeDeg).toBeCloseTo((Math.atan(0.8 / 1.2) * 180) / Math.PI, 1)
    // From the lower floor one tread in front of the first riser to the top of the last one.
    expect(r.from[1]).toBeCloseTo(0.03, 2)
    expect(r.from[2]).toBeCloseTo(-1.2, 2)
    expect(r.to[1]).toBeCloseTo(4.8 + 0.03, 2)
    expect(r.to[2]).toBeCloseTo(5 * 1.2, 2)
  })

  it('works whichever way the stairs face', () => {
    const r = findStairs(stairs(5, 0.9, 1.4, 5, 30))
    expect(r).toHaveLength(1)
    // Up the stairs is +Z turned by 30° (x' = z sin, z' = z cos).
    expect(r[0].up[0]).toBeCloseTo(Math.sin(Math.PI / 6), 2)
    expect(r[0].up[1]).toBeCloseTo(Math.cos(Math.PI / 6), 2)
  })

  it('leaves alone steps the player walks up, a wall and ladder-steep steps', () => {
    expect(findStairs(stairs(8, STEP * 0.7, 1))).toHaveLength(0)
    // Exactly a step (0.28 m), as the site's own stairs are built: walked up, no ramp.
    expect(findStairs(stairs(8, STEP, 0.75, 2))).toHaveLength(0)
    expect(findStairs(Float32Array.from([...box([-40, -1, -40], [40, 0, 40]), ...box([-5, 0, 3], [5, 6, 4])]))).toHaveLength(0)
    // Two steps need stair proportions: a bench-like pair (0.5 m steps) and a steep casing (54°) are left alone,
    // a short flight of real stairs (0.34 m steps, 27°) is not.
    expect(findStairs(stairs(2, 1.02, 0.86))).toHaveLength(0)
    expect(findStairs(stairs(2, 0.68, 0.5))).toHaveLength(0)
    expect(findStairs(stairs(2, 0.68, 1.34))).toHaveLength(1)
    const steep = findStairs(stairs(6, 1.2, 0.6))
    expect(steep.every((r) => r.slopeDeg <= MAX_RAMP_DEG)).toBe(true)
    expect(steep).toHaveLength(0)
  })

  it('gives a single step too tall to walk up a wedge on each open side, and a ledge too tall for one none', () => {
    // One 0.45 m step up to a raised floor (a doorstep, a terrace): front, back and both sides.
    const one = findStairs(stairs(1, 0.9, 2))
    expect(one).toHaveLength(4)
    for (const r of one) {
      expect(r.steps).toBe(1)
      expect(r.slopeDeg).toBe(SINGLE_DEG)
      expect(r.to[1] - r.from[1]).toBeCloseTo(0.9, 2)
    }
    const front = one.find((r) => r.up[1] > 0.9)!
    expect(front.from[2]).toBeCloseTo(-0.9 / Math.tan((SINGLE_DEG * Math.PI) / 180), 2)
    // Taller than a step can be (0.7 m): a ledge to jump, no wedge.
    expect(findStairs(stairs(1, SINGLE_MAX_RISER + 0.1, 2))).toHaveLength(0)
    // Too narrow for a player, or no floor on top: none.
    expect(findStairs(stairs(1, 0.9, 2, 1.5))).toHaveLength(0)
  })

  it("finds the editor's own Stairs shape once it's scaled up past a step, and not before", () => {
    // The shape's own steps are always low enough; an object scaled up (a converted or scaled-up map) is what has tall ones.
    const tris = (size: V, scale = 1) => {
      const m = parseObj(shapeObj({ kind: 'stairs', size, segments: 8, tile: 4 }))
      const out = box([-40, -1, -40], [40, 0, 40])
      for (let f = 0; f < m.faces.length; f++) out.push(m.positions[m.faces[f] * 3] * scale, m.positions[m.faces[f] * 3 + 1] * scale, m.positions[m.faces[f] * 3 + 2] * scale)
      // A landing behind the top step (the shape rises toward −Z), so the last riser has floor behind it.
      out.push(...box([-3 * scale, 0, (-size[2] / 2 - 6) * scale], [3 * scale, size[1] * scale, (-size[2] / 2) * scale]))
      return Float32Array.from(out)
    }
    expect(findStairs(tris([6, 3, 8]))).toHaveLength(0)
    expect(findStairs(tris([6, 6, 8]))).toHaveLength(0)
    const big = findStairs(tris([6, 3, 8], 2))
    expect(big).toHaveLength(1)
    expect(big[0].up[1]).toBeCloseTo(-1, 3)
    expect(big[0].steps).toBeGreaterThanOrEqual(7)
  })

  it('makes open ramps (just the top) that rest on every nosing, as one compound object', () => {
    for (const yaw of [0, 30, -120]) {
      const runs = findStairs(stairs(6, 0.8, 1.2, 4, yaw))
      expect(runs).toHaveLength(1)
      const origin: V = [1, 0, -2]
      const pieces = rampPieces(runs, origin, 'ramp')
      expect(pieces[0].shape.open).toBe(true)
      const model = parseObj(compoundObj(pieces))
      // One sloped quad: two triangles, all facing up.
      expect(model.faces.length / 3).toBe(2)
      // Each nosing (front top edge of step k, middle of the stairs) lies on the ramp, just under it.
      const t = (yaw * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t)
      const P = model.positions
      const tri = [0, 1, 2].map((k) => model.faces[k] * 3).map((i) => [P[i] + origin[0], P[i + 1] + origin[1], P[i + 2] + origin[2]])
      const n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
      const len = Math.hypot(...n)
      const nn = n.map((x) => x / len * Math.sign(n[1]))
      for (let k = 0; k < 6; k++) {
        const z = k * 1.2, y = (k + 1) * 0.8
        const q = [z * s, y, z * c]
        const above = nn[0] * (q[0] - tri[0][0]) + nn[1] * (q[1] - tri[0][1]) + nn[2] * (q[2] - tri[0][2])
        expect(above).toBeLessThanOrEqual(0.001)
        expect(above).toBeGreaterThan(-0.05)
      }
    }
  })
})

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i])
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

describe('ramps travel as recipes', () => {
  it('keeps the open ramp through recipe cleaning and checks (share links, the Showcase)', () => {
    const runs = findStairs(stairs(6, 0.8, 1.2))
    const pieces = rampPieces(runs, [0, 0, 0], 'stair_ramp')
    const clean = cleanRecipe({ kind: 'compound', pieces })
    expect(clean.pieces[0].shape.open).toBe(true)
    expect(validShape(clean.pieces[0].shape)).toBe(true)
    expect(validShape({ ...clean.pieces[0].shape, open: 'yes' })).toBe(false)
    expect(compoundObj(clean.pieces)).toBe(compoundObj(pieces))
  })
})

describe('maps with another world scale', () => {
  it('measures steps in game metres: the same stairs at 0.25 m a unit are found and handed back in its own units', () => {
    // 0.4 m steps on a map at 0.25 m per unit are 1.6 units tall there; the finder works in 0.5 m units.
    const k = 0.25 / 0.5
    const tris = stairs(6, 1.6, 2.4).map((v) => v * k)
    const runs = scaleRuns(findStairs(tris), 1 / k)
    expect(runs).toHaveLength(1)
    expect(runs[0].rise).toBeCloseTo(1.6, 2)
    expect(runs[0].width).toBeCloseTo(4, 2)
    // Read as if it were 0.5 m a unit, the same geometry would be 0.8 m steps, too tall to count: missed (the bug this fixes).
    expect(findStairs(stairs(6, 1.6, 2.4))).toHaveLength(0)
  })
})
