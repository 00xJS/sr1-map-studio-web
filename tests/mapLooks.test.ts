// A finished map's materials as the editor brings them in (mapFolder/scene.ts materialPlan, read.ts planPicture):
// glow kept, tints, additive pictures and light-pool decals folded into one picture. Small chunks built here.
import { describe, expect, it } from 'vitest'
import { buildChunk, type Spec } from './chunkBuilder'
import { readChunk } from '../src/lib/gameObjects/chunk'
import { chunkSoup } from '../src/lib/mapFolder/scene'
import { planPicture } from '../src/lib/mapFolder/read'
import type { PegImage } from '../src/lib/sr1char/peg'

const quad = (uvSets: number) => ({
  verts: [0, 1, 2, 3].map((i) => [i & 1, 0, i >> 1, ...Array.from({ length: 2 * uvSets }, (_, k) => (k + 1) * 0.25 + i * 0.5)]),
  indices: [0, 1, 2, 3], uvSets,
})

const spec = (): Spec => ({
  strings: ['neutralco.tga', 'circularlight.tga', 'lamp_lit.tga', 'flare.tga', 'brick_co.tga', 'flat-normalmap.tgn'],
  vbs: [quad(2)],
  materials: [
    // Retail lobby's light pool: a plain base, the circle as a decal on UV set 1.
    { shader: 'bb-standard-ns_s', flags: 3, slots: [['Diffuse_Map', 0], ['Decal_Map_1', 1], ['Normal_Map', 5]], consts: [['Decal_Map_1_Opacity', [1]], ['Self_Illumination', [0]]] },
    // A lamp's glowing glass.
    { shader: 'bb-simple1_s', flags: 0xb, slots: [['Diffuse_Map', 2], ['Normal_Map', 5]], consts: [['Self_Illumination', [0.8]]] },
    // A flare drawn added to what is behind it.
    { shader: 'bb-additivedecal1_s', slots: [['Decal_Map_1', 3]], consts: [['Decal_Map_1_Opacity', [1]]] },
    // A tinted wall.
    { shader: 'bb-standard_s', flags: 3, slots: [['Diffuse_Map', 4]], consts: [['Diffuse_Color', [0.5, 1, 1, 1]], ['Self_Illumination', [0]]] },
  ],
  meshes: [0, 1, 2, 3].map((m) => ({ subs: [{ vb: 0, batches: [[0, 4, m]] }] })),
  instances: [0, 1, 2, 3].map((m) => ({ pos: [m * 3, 0, 0], mesh: m })),
  records: [0, 1, 2, 3].map((m) => ({ name: 'piece' + m, instance: m })),
})

describe('an opened map\'s materials', () => {
  const ch = readChunk(buildChunk(spec()))

  it('keeps glow, tints and additive pictures, and bakes light-pool decals over a plain base onto their own UV set', () => {
    const { soup } = chunkSoup(ch, (n) => n === 'neutralco.tga')
    expect(soup.plans).toEqual([
      { tex: 'circularlight.tga', uv: 1, base: 'neutralco.tga', decals: [{ tex: 'circularlight.tga', opacity: 1 }] },
      { tex: 'lamp_lit.tga', uv: 0, glow: 0.8 },
      { tex: 'flare.tga', uv: 1, additive: true, glow: 1 },
      { tex: 'brick_co.tga', uv: 0, tint: [0.5, 1, 1] },
    ])
    // The baked pool reads UV set 1; the rest UV0.
    const first = (m: number) => { const t = [...soup.mat].indexOf(m); return [...soup.uv.slice(6 * t, 6 * t + 2)].map((v) => +v.toFixed(2)) }
    expect(first(0)).toEqual([0.75, 1])
    expect(first(1)).toEqual([0.25, 0.5])
  })

  it('leaves the decals out when the base is a real picture (it can\'t be baked onto another UV set)', () => {
    const { soup } = chunkSoup(ch)
    expect(soup.plans[0]).toEqual({ tex: 'neutralco.tga', uv: 0 })
  })
})

describe('an opened map\'s pictures', () => {
  const img = (w: number, h: number, px: (i: number) => number[]): PegImage => ({ width: w, height: h, rgba: new Uint8Array(Array.from({ length: w * h }, (_, i) => px(i)).flat()) })
  const pics: Record<string, PegImage> = {
    'grey.tga': img(4, 4, () => [100, 100, 100, 255]),
    'circle.tga': img(2, 1, (i) => (i ? [255, 240, 200, 0] : [255, 240, 200, 255])),
    'flare.tga': img(1, 1, () => [128, 64, 0, 255]),
    'brick.tga': img(1, 1, () => [200, 200, 200, 255]),
  }
  const find = (n: string) => pics[n] ?? null
  const px = (t: { rgba: ArrayBuffer } | null, i: number) => [...new Uint8Array(t!.rgba).slice(4 * i, 4 * i + 4)]

  it('bakes the decal over the base\'s colour', () => {
    const t = planPicture({ tex: 'circle.tga', uv: 1, base: 'grey.tga', decals: [{ tex: 'circle.tga', opacity: 1 }] }, find, 1024)
    expect([t!.width, t!.height, t!.alpha]).toEqual([2, 1, false])
    expect(px(t, 0)).toEqual([255, 240, 200, 255])
    expect(px(t, 1)).toEqual([100, 100, 100, 255])
  })
  it('turns an additive picture into a blended one, and multiplies in a tint', () => {
    const f = planPicture({ tex: 'flare.tga', uv: 1, additive: true, glow: 1 }, find, 1024)
    expect(px(f, 0)).toEqual([255, 128, 0, 128])
    expect(px(planPicture({ tex: 'brick.tga', uv: 0, tint: [0.5, 1, 1] }, find, 1024), 0)).toEqual([100, 200, 200, 255])
    expect(planPicture({ tex: 'nowhere.tga', uv: 0 }, find, 1024)).toBeNull()
  })
})
