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
    // Steps of height 0.5, 1, 1.5, 2 over equal depths: (1+2+3+4)/4 of the full box.
    expect(volume({ kind: 'stairs', size: [2, 2, 8], segments: 4, tile: 4 }).v).toBeCloseTo(2 * 8 * 2 * (10 / 16), 4)
  })

  it('stairs never get a step taller than the player walks up', () => {
    // 4 m in 4 steps would be 1 m each: built as 16 of 0.25 m, (1+…+16)/16 of the box.
    expect(volume({ kind: 'stairs', size: [2, 8, 8], segments: 4, tile: 4 }).v).toBeCloseTo(2 * 8 * 8 * (136 / 256), 4)
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

  it('a cylinder lying on its side keeps its volume and lies along X', () => {
    const { v, m } = volume({ kind: 'cylinder', size: [6, 2, 2], segments: 64, lie: true, tile: 4 })
    expect(v).toBeCloseTo(Math.PI * 1 * 1 * 6, 1)
    const xs = [], ys = []
    for (let i = 0; i < m.positions.length; i += 3) { xs.push(m.positions[i]); ys.push(m.positions[i + 1]) }
    expect(Math.min(...xs)).toBeCloseTo(-3, 4); expect(Math.max(...xs)).toBeCloseTo(3, 4)
    expect(Math.min(...ys)).toBeCloseTo(0, 4); expect(Math.max(...ys)).toBeCloseTo(2, 4)
  })

  it('a blob is its outline extruded, closed and outward', () => {
    const outline: [number, number][] = [[2, 0], [0, 1], [-2, 0], [0, -1]]
    expect(volume({ kind: 'blob', size: [4, 0.5, 2], outline, tile: 4 }).v).toBeCloseTo(4 * 0.5, 4)
  })

  it('a ball is a smooth closed ellipsoid standing on its lowest point', () => {
    const { v, m } = volume({ kind: 'sphere', size: [4, 2, 6], segments: 32, tile: 4 })
    expect(v / ((4 / 3) * Math.PI * 2 * 1 * 3)).toBeGreaterThan(0.97)
    expect(v / ((4 / 3) * Math.PI * 2 * 1 * 3)).toBeLessThanOrEqual(1)
    expect(Math.min(...m.positions.filter((_, i) => i % 3 === 1))).toBeCloseTo(0, 5)
    expect(m.normals).toBeTruthy()
  })

  it('a ring has a hole: about 2 pi^2 R r^2, lying flat or standing', () => {
    const want = 2 * Math.PI ** 2 * 2 * 1 ** 2
    for (const lie of [false, true]) {
      const { v } = volume({ kind: 'torus', size: lie ? [6, 6, 2] : [6, 2, 6], segments: 48, tile: 4, lie })
      expect(v / want).toBeGreaterThan(0.95)
      expect(v / want).toBeLessThanOrEqual(1.001)
    }
  })

  it('fit stretches the texture once across a face', () => {
    const m = parseObj(shapeObj({ kind: 'box', size: [12, 6, 0.2], fit: true, tile: 4 }))
    const us = [], vs = []
    for (let i = 0; i < m.uvs.length; i += 2) { us.push(m.uvs[i]); vs.push(m.uvs[i + 1]) }
    expect(Math.min(...us)).toBeCloseTo(0, 5); expect(Math.max(...us)).toBeCloseTo(1, 5)
    expect(Math.min(...vs)).toBeCloseTo(0, 5); expect(Math.max(...vs)).toBeCloseTo(1, 5)
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

  it('texture reads left to right on every side of a box', () => {
    // Walk each side face: U must grow toward the viewer's right (outward normal × up), never mirrored.
    const m = parseObj(shapeObj({ kind: 'box', size: [8, 4, 6], tile: 2 }))
    const P = (i: number) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]
    let sides = 0
    for (let f = 0; f < m.faces.length; f += 3) {
      const [a, b, c] = [m.faces[f], m.faces[f + 1], m.faces[f + 2]]
      const [pa, pb, pc] = [P(a), P(b), P(c)]
      const e1 = pb.map((v, k) => v - pa[k]), e2 = pc.map((v, k) => v - pa[k])
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
      if (Math.abs(n[1]) > 1e-6) continue
      const right = [n[2], 0, -n[0]] // the viewer looks along -n with +Y up, so right = -n × up
      for (const [i, j] of [[a, b], [b, c], [a, c]]) {
        const d = P(j).map((v, k) => v - P(i)[k]), along = d[0] * right[0] + d[2] * right[2]
        if (Math.abs(along) > 1e-6) expect(Math.sign(m.uvs[j * 2] - m.uvs[i * 2])).toBe(Math.sign(along))
      }
      sides++
    }
    expect(sides).toBe(8)
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
    expect(n).toBe('Wall 6×3×0.5 m')
    expect(shapeLabel(n)).toBe('Wall')
    expect(shapeLabel('Wall 12.5×6×0.25')).toBe('Wall')
    expect(shapeName('Wall', { kind: 'box', size: [12, 6, 1], tile: 4 }, 1)).toBe('Wall 12×6×1 m')
    expect(shapeLabel('North wall')).toBeNull()
  })
})
