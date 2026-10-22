import { describe, expect, it } from 'vitest'
import { parseObj } from '../src/lib/geometry'
import { SHAPE_PRESETS, shapeLabel, shapeName, shapeObj, type Shape } from '../src/lib/shapes'

/** Signed volume from the triangles: positive and right-sized only if every face points outward. */
function volume(s: Shape) {
  const m = parseObj(shapeObj(s))
  let v = 0
  for (let f = 0; f < m.faces.length; f += 3) {
    const [a, b, c] = [m.faces[f], m.faces[f + 1], m.faces[f + 2]].map((i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]])
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
  }
  return { v, m }
}

describe('block-out shapes', () => {
  it('box: closed, outward faces, top and side materials', () => {
    const { v, m } = volume({ kind: 'box', size: [4, 2, 3], tile: 2 })
    expect(v).toBeCloseTo(24, 4)
    expect(m.faces.length / 3).toBe(12)
    expect(m.mats).toEqual(['top', 'side'])
  })

  it('ramp is half a box', () => {
    expect(volume({ kind: 'ramp', size: [6, 3, 10], tile: 4 }).v).toBeCloseTo(90, 4)
  })

  it('stairs add up their steps', () => {
    // Steps of height 1, 2, 3, 4 over equal depths: (1+2+3+4)/4 of the full box.
    expect(volume({ kind: 'stairs', size: [2, 4, 8], segments: 4, tile: 4 }).v).toBeCloseTo(2 * 8 * 4 * (10 / 16), 4)
  })

  it('cylinder approaches pi r^2 h', () => {
    const r = 1, h = 5
    expect(volume({ kind: 'cylinder', size: [2 * r, h, 2 * r], segments: 64, tile: 4 }).v).toBeCloseTo(Math.PI * r * r * h, 1)
  })

  it('every preset is a closed outward solid', () => {
    for (const p of Object.values(SHAPE_PRESETS)) expect(volume(p.shape).v).toBeGreaterThan(0)
  })

  it('textures repeat by world size, not shape size', () => {
    const uRange = (s: Shape) => {
      const { m } = volume(s)
      let lo = Infinity, hi = -Infinity
      for (let i = 0; i < m.uvs.length; i += 2) { lo = Math.min(lo, m.uvs[i]); hi = Math.max(hi, m.uvs[i]) }
      return hi - lo
    }
    expect(uRange({ kind: 'box', size: [8, 1, 8], tile: 4 })).toBeCloseTo(2, 5)
    expect(uRange({ kind: 'box', size: [16, 1, 16], tile: 4 })).toBeCloseTo(4, 5)
  })
})

describe('shape names', () => {
  it('keep the preset label through resizes, but leave user names alone', () => {
    const n = shapeName('Wall', { kind: 'box', size: [12, 6, 1], tile: 4 })
    expect(n).toBe('Wall 12×6×1')
    expect(shapeLabel(n)).toBe('Wall')
    expect(shapeLabel('Wall 12.5×6×0.25')).toBe('Wall')
    expect(shapeLabel('North wall')).toBeNull()
  })
})
