// A map's texture file size before export (src/lib/textureBudget.ts): each picture once, sized as the exporter sizes it.
import { describe, expect, it } from 'vitest'
import { TEMPLATE_PEG_BYTES, pictureBytes, textureBudget } from '../src/lib/textureBudget'
import { newProject, type Project, type SceneItem } from '../src/lib/project'

const item = (textures: Record<string, string>, alpha: Record<string, boolean> = {}): SceneItem =>
  ({ uid: 'u' + Math.random(), name: 'x', path: '/a.obj', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures, alpha }) as SceneItem

describe('texture budget', () => {
  it('sizes a picture as the exporter does: powers of two up to 1024, half a byte a pixel (a byte with alpha), mips, 4 KB pages', () => {
    expect(pictureBytes(256, 256, false)).toBe(Math.ceil((256 * 256 * 0.5 * 4) / 3 / 4096) * 4096)
    expect(pictureBytes(300, 200, false)).toBe(pictureBytes(512, 256, false))
    expect(pictureBytes(4096, 4096, true)).toBe(pictureBytes(1024, 1024, true))
    expect(pictureBytes(8, 8, false)).toBe(4096)
  })

  it('counts each picture once, however many materials use it, and flags a map past what the game loads', async () => {
    const p: Project = newProject('t')
    for (let i = 0; i < 300; i++) p.files['/t' + i + '.png'] = { hash: 'h' + i, name: 't.png', size: 1 } as never
    // 3,000 materials over 300 pictures.
    p.scene_items = Array.from({ length: 1000 }, (_, i) => item({ a: '/t' + (i % 300) + '.png', b: '/t' + ((i + 1) % 300) + '.png', c: '/t' + ((i + 2) % 300) + '.png' }))
    const small = await textureBudget(p, async () => [256, 256])
    expect(small.pictures).toBe(300)
    expect(small.materials).toBe(3000)
    expect(small.mb).toBeCloseTo((TEMPLATE_PEG_BYTES + 300 * pictureBytes(256, 256, false)) / 1e6, 1)
    expect(small.over).toBe(false)
    const big = await textureBudget(p, async () => [1024, 1024])
    expect(big.over).toBe(true)
  })
})
