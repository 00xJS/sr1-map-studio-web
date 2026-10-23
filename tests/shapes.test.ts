import { describe, expect, it } from 'vitest'
import { parseObj } from '../src/lib/geometry'
import { SHAPE_PRESETS, compoundObj, shapeLabel, shapeName, shapeObj, type Shape } from '../src/lib/shapes'

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

  it('cone is a third of its cylinder, a frustum in between', () => {
    const cyl = Math.PI * 4 * 6
    expect(volume({ kind: 'cylinder', size: [4, 6, 4], segments: 64, taper: 0, tile: 4 }).v).toBeCloseTo(cyl / 3, 0)
    // Frustum with top radius half the bottom: pi h (R² + Rr + r²) / 3.
    expect(volume({ kind: 'cylinder', size: [4, 6, 4], segments: 64, taper: 0.5, tile: 4 }).v).toBeCloseTo(Math.PI * 6 * (4 + 2 + 1) / 3, 0)
  })

  it('roof is half its box, sloped faces on top', () => {
    const { v, m } = volume({ kind: 'roof', size: [12, 4, 10], tile: 4 })
    expect(v).toBeCloseTo(240, 4)
    expect(m.mats).toContain('top')
  })

  it('bevel trims a little off a box and stays closed', () => {
    const { v } = volume({ kind: 'box', size: [4, 3, 4], tile: 3, bevel: 0.4 })
    expect(v).toBeGreaterThan(40)
    expect(v).toBeLessThan(48)
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

describe('prefab objects', () => {
  it('several shapes become one closed object with shared material names', () => {
    const obj = compoundObj([
      { shape: { kind: 'box', size: [4, 2, 3], tile: 2 }, at: [0, 0, 0], rot: 0, top: 'm0', side: 'm1' },
      { shape: { kind: 'box', size: [2, 2, 2], tile: 2 }, at: [10, 0, 0], rot: 45, top: 'm0', side: 'm2' },
    ])
    const m = parseObj(obj)
    let v = 0
    for (let f = 0; f < m.faces.length; f += 3) {
      const [a, b, c] = [m.faces[f], m.faces[f + 1], m.faces[f + 2]].map((i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]])
      v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    }
    expect(v).toBeCloseTo(24 + 8, 4)
    expect([...m.mats].sort()).toEqual(['m0', 'm1', 'm2'])
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
