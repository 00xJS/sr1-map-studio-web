import { describe, expect, it } from 'vitest'
import { flattenLighting, jpegOrientation, makeSeamless, textureSize } from '../src/lib/images'
import { KINDS, defaultParams, generate, type TextureKind } from '../src/lib/procedural'

/** Minimal JPEG header with an EXIF orientation tag. */
function jpegWithOrientation(o: number, littleEndian: boolean): Uint8Array {
  const tiff = littleEndian
    ? [0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0, 0, 0, o, 0, 0, 0, 0, 0, 0, 0]
    : [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff] // "Exif\0\0"
  const len = app1.length + 2
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xda, 0, 2])
}

describe('jpegOrientation', () => {
  it('reads the EXIF rotation in both byte orders', () => {
    expect(jpegOrientation(jpegWithOrientation(6, true))).toBe(6)
    expect(jpegOrientation(jpegWithOrientation(8, false))).toBe(8)
  })
  it('defaults to upright', () => {
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(1)
    expect(jpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(1)
  })
})

describe('textureSize', () => {
  it('caps a phone photo and keeps powers of two', () => {
    expect(textureSize(4032, 3024, 2048)).toEqual([2048, 2048])
    expect(textureSize(4032, 3024, 1024)).toEqual([1024, 1024])
    expect(textureSize(1920, 1080, 2048)).toEqual([2048, 1024])
    expect(textureSize(512, 512, 2048)).toEqual([512, 512])
  })
})

/** Mean color difference between two columns (or rows) of an RGBA image. */
function lineDiff(px: Uint8ClampedArray, size: number, a: number, b: number, vertical: boolean) {
  let sum = 0
  for (let i = 0; i < size; i++) {
    const p = vertical ? (i * size + a) * 4 : (a * size + i) * 4
    const q = vertical ? (i * size + b) * 4 : (b * size + i) * 4
    for (let c = 0; c < 3; c++) sum += Math.abs(px[p + c] - px[q + c])
  }
  return sum / size
}

/** The wrap from the last column back to the first is no rougher than the roughest step inside. */
/** `acrossOnly`: only left to right (a sky wraps round the horizon but runs from overhead to the ground). */
function tiles(px: Uint8ClampedArray, size: number, acrossOnly = false) {
  for (const vertical of acrossOnly ? [true] : [true, false]) {
    let worst = 0
    for (let i = 0; i < size - 1; i++) worst = Math.max(worst, lineDiff(px, size, i, i + 1, vertical))
    const wrap = lineDiff(px, size, size - 1, 0, vertical)
    if (wrap > worst * 1.05 + 1) return false
  }
  return true
}

describe('generated textures', () => {
  // (invisible is blank on purpose: see the test below)
  for (const kind of (Object.keys(KINDS) as TextureKind[]).filter((k) => k !== 'invisible')) {
    it(`${kind} tiles and is not flat`, () => {
      const size = 64
      const px = generate({ ...defaultParams(kind, size), seed: 3 })
      expect(px.length).toBe(size * size * 4)
      let min = 255, max = 0
      for (let i = 0; i < px.length; i += 4) { min = Math.min(min, px[i]); max = Math.max(max, px[i]) }
      expect(max - min).toBeGreaterThan(10)
      expect(tiles(px, size, kind === 'sky')).toBe(true)
    })
  }
  it('invisible is fully see-through (the ramps over tall steps)', () => {
    const px = generate({ ...defaultParams('invisible', 16), seed: 1 })
    expect(px.length).toBe(16 * 16 * 4)
    expect(px.every((v) => v === 0)).toBe(true)
  })
})

describe('makeSeamless', () => {
  it('turns a gradient (worst case seam) into a tiling image', () => {
    const size = 64
    const src = new Uint8ClampedArray(size * size * 4)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      src[i] = x * 4; src[i + 1] = y * 4; src[i + 2] = 128; src[i + 3] = 255
    }
    expect(tiles(src, size)).toBe(false)
    expect(tiles(makeSeamless(src, size, size, 0.5), size)).toBe(true)
  })
})

describe('flattenLighting', () => {
  it('removes a brightness gradient', () => {
    const n = 16
    const src = new Uint8ClampedArray(n * 4), blur = new Uint8ClampedArray(n * 4)
    for (let i = 0; i < n; i++) {
      const light = 60 + i * 10
      for (let c = 0; c < 3; c++) { src[i * 4 + c] = light; blur[i * 4 + c] = light }
      src[i * 4 + 3] = blur[i * 4 + 3] = 255
    }
    const out = flattenLighting(src, blur, 1)
    const values = [...Array(n)].map((_, i) => out[i * 4])
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1)
  })
})
