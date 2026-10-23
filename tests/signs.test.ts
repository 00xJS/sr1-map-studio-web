import { describe, expect, it } from 'vitest'
import { SIGN_STYLES, signText, signTextProblem } from '../src/lib/signFont'
import { defaultParams, generate, type GenParams } from '../src/lib/procedural'
import { cleanRecipe, paramsProblem, pictureSlot, recipeProblem, withoutPhoto } from '../src/lib/recipes'
import { ALL_PREFABS } from '../src/lib/prefabRegistry'
import { prefabParams, type Params } from '../src/lib/prefabs'
import { PICTURE, photoAspect, signFace } from '../src/lib/prefabsSigns'
import { showcasePlan } from '../src/lib/hubRules'
import { newProject, referencedPaths, type FileRef, type SceneItem } from '../src/lib/project'
import type { Part, Tex } from '../src/lib/sampleKit'

const sign = (p: Partial<GenParams>, size = 96): GenParams => ({ ...defaultParams('lettering', size), ...p })
/** Pixels within `tol` of a color. */
const near = (px: Uint8ClampedArray, hex: string, tol = 24) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  let n = 0
  for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - c[0]) + Math.abs(px[i + 1] - c[1]) + Math.abs(px[i + 2] - c[2]) < tol) n++
  return n
}
const genOf = (t: Tex) => ('gen' in t ? t : null)
const lettering = (parts: Part[]) => parts.flatMap((p) => [p.top, p.side]).map(genOf).filter((t) => t?.gen === 'lettering')

describe('sign text', () => {
  it('shows capitals, drops accents and characters the font lacks, two lines of 24 at most', () => {
    expect(signText("Joe's Café")).toBe("JOE'S CAFE")
    expect(signText('  hello   world  ')).toBe('HELLO WORLD')
    expect(signText('a\n\nb\nc')).toBe('A\nB')
    expect(signText('emoji 😀 ok ~ ^')).toBe('EMOJI OK')
    expect(signText('x'.repeat(40))).toBe('X'.repeat(24))
    expect(signText('')).toBe('')
  })

  it('only takes text as signText makes it', () => {
    expect(signTextProblem('MAIN ST\nEXIT 12')).toBeNull()
    expect(signTextProblem('main st')).not.toBeNull()
    expect(signTextProblem('A\nB\nC')).not.toBeNull()
    expect(signTextProblem(12)).not.toBeNull()
  })
})

describe('text sign texture recipe', () => {
  it('is a valid recipe that keeps its words and style', () => {
    const params = sign({ text: 'MAIN ST', style: 'neon' }, 1024)
    expect(paramsProblem(params)).toBeNull()
    const r = cleanRecipe({ kind: 'generated', params: { ...params, extra: 'x' } as GenParams })
    expect(r.kind === 'generated' && r.params).toMatchObject({ kind: 'lettering', text: 'MAIN ST', style: 'neon' })
    expect(r.kind === 'generated' && 'extra' in r.params).toBe(false)
    expect(recipeProblem(r)).toBeNull()
  })

  it('turns down text it cannot show and unknown styles', () => {
    expect(paramsProblem(sign({ text: 'lower case' }))).toMatch(/sign text/)
    expect(paramsProblem(sign({ text: 'TOO\nMANY\nLINES' }))).toMatch(/sign text/)
    expect(paramsProblem(sign({ text: 'A'.repeat(30) }))).toMatch(/sign text/)
    expect(paramsProblem(sign({ style: 'comic' as never }))).toMatch(/sign style/)
  })

  it('draws the words in the letter color, the same every time', () => {
    const p = sign({ text: 'HELLO', style: 'plain', color: '#ffffff', accent: '#000000', scale: 2 })
    const a = generate(p)
    expect(generate(p)).toEqual(a)
    expect(near(a, '#000000')).toBeGreaterThan(200)
    // No words: just the board.
    expect(near(generate({ ...p, text: '' }), '#000000')).toBe(0)
    // Different words, different picture.
    expect(generate({ ...p, text: 'WORLD' })).not.toEqual(a)
  })

  it('every style draws its words', () => {
    for (const style of Object.keys(SIGN_STYLES) as (keyof typeof SIGN_STYLES)[]) {
      const p = sign({ text: 'OPEN\n24/7', style, color: SIGN_STYLES[style].color, accent: SIGN_STYLES[style].accent })
      const px = generate(p), blank = generate({ ...p, text: '' })
      let changed = 0
      for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - blank[i]) + Math.abs(px[i + 1] - blank[i + 1]) + Math.abs(px[i + 2] - blank[i + 2]) > 60) changed++
      expect(changed).toBeGreaterThan(300)
    }
  })
})

describe('Sign prefab', () => {
  const def = ALL_PREFABS.textsign
  const make = (p: Params = {}) => def.make(0, 0, 0, 0, prefabParams(def, p))

  it('is in the Street category with a text setting', () => {
    expect(def.category).toBe('Street')
    expect(def.params!.find((d) => d.key === 'text')?.kind).toBe('text')
    expect(def.onWall).toMatchObject({ mount: 'wall' })
  })

  it('carries its text as a texture recipe, not a picture', () => {
    const [face] = lettering(make({ text: "Joe's pizza", w: 8, h: 2 }))
    expect(face?.tweak).toMatchObject({ text: "JOE'S PIZZA", scale: 4, style: 'street' })
    const params = { ...defaultParams('lettering', 1024), ...face!.tweak, size: 1024 }
    expect(recipeProblem({ kind: 'generated', params })).toBeNull()
  })

  it('a new text changes only the words on the board', () => {
    const a = make({ text: 'ONE' }), b = make({ text: 'TWO' })
    const shape = (ps: Part[]) => ps.map((p) => [p.kind, p.size, p.at, p.rot])
    expect(shape(b)).toEqual(shape(a))
    expect(lettering(b).map((t) => t!.tweak!.text)).toEqual(lettering(a).map(() => 'TWO'))
  })

  it('colors left blank use the style\'s own', () => {
    expect(genOf(signFace(prefabParams(def, { style: 'plaque' })))!.tweak).toMatchObject({ color: SIGN_STYLES.plaque.color, accent: SIGN_STYLES.plaque.accent })
    expect(genOf(signFace(prefabParams(def, { color: '#123456', letters: '#abcdef' })))!.tweak).toMatchObject({ color: '#123456', accent: '#abcdef' })
  })

  it('on a post it reads from both sides; on a wall from the front, its back against the wall', () => {
    const post = make({ mount: 'post' }).filter((p) => p.label.startsWith('Sign') && lettering([p]).length)
    expect(post.map((p) => p.rot)).toEqual([0, 180])
    const wall = make({ mount: 'wall' })
    expect(lettering(wall.filter((p) => genOf(p.side)?.gen === 'lettering').map((p) => p))).toHaveLength(1)
    for (const p of wall) expect(p.at[2] - p.size[2] / 2).toBeGreaterThanOrEqual(-1e-9)
  })

  it('every mount builds', () => {
    for (const mount of ['post', 'stand', 'wall', 'hanging']) {
      const parts = make({ mount })
      expect(parts.length).toBeGreaterThan(1)
      expect(parts.every((p) => [...p.at, ...p.size].every(Number.isFinite))).toBe(true)
      expect(lettering(parts).length).toBeGreaterThan(0)
    }
  })
})

describe('Photo frame prefab', () => {
  const def = ALL_PREFABS.photoframe
  it('shows the stand-in picture until a photo is chosen', () => {
    expect(def.photo).toBe(true)
    const parts = def.make(0, 0, 0, 0, prefabParams(def, { shape: 'portrait', w: 3 }))
    const photo = parts.find((p) => JSON.stringify(p.side) === JSON.stringify(PICTURE))!
    expect(photo.fit).toBe(true)
    expect(photo.size[0] / photo.size[1]).toBeCloseTo(photoAspect({ shape: 'portrait' }))
    for (const p of parts) expect(p.at[2] - p.size[2] / 2).toBeGreaterThanOrEqual(-1e-9)
  })
})

describe('a photo in a frame never leaves the device', () => {
  const H = (c: string) => c.repeat(64)
  const ref = (hash: string, name: string, recipe?: FileRef['recipe']): FileRef => ({ hash, size: 10, name, type: '', origin: 'user', ...(recipe ? { recipe } : {}) })
  const framed = (): { files: Record<string, FileRef>; it: SceneItem } => {
    const files: Record<string, FileRef> = {
      '/work/f/a/prefab.obj': ref(H('a'), 'prefab.obj', { kind: 'shape', shape: { kind: 'box', size: [1, 1, 1], tile: 4 } }),
      '/work/f/b/wood.png': ref(H('b'), 'wood.png', { kind: 'generated', params: defaultParams('wood_planks', 512) }),
      '/work/f/c/picture.png': ref(H('c'), 'picture.png', { kind: 'generated', params: defaultParams('picture', 512) }),
      '/work/f/d/photo.jpg': ref(H('d'), 'photo.jpg'),
    }
    const defaults = { m0: '/work/f/b/wood.png', m1: '/work/f/c/picture.png' }
    const it: SceneItem = {
      uid: 'f', name: 'Photo frame', path: '/work/f/a/prefab.obj', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1,
      textures: { ...defaults, m1: '/work/f/d/photo.jpg' }, alpha: {}, prefab: { key: 'photoframe', params: {}, defaults },
    }
    return { files, it }
  }

  it('finds the picture slot and swaps the photo for the stand-in', () => {
    const { files, it } = framed()
    expect(pictureSlot(it, files)).toBe('m1')
    expect(withoutPhoto(it, files).textures.m1).toBe('/work/f/c/picture.png')
    expect(it.textures.m1).toBe('/work/f/d/photo.jpg')
    const empty = { ...it, textures: { ...it.prefab!.defaults } }
    expect(withoutPhoto(empty, files)).toBe(empty)
  })

  it('keeps the stand-in picture file while a photo is in the frame', () => {
    const { files, it } = framed()
    const p = newProject('Frames')
    p.files = files
    p.scene_items.push(it)
    expect(referencedPaths(p)).toEqual(expect.arrayContaining(['/work/f/c/picture.png', '/work/f/d/photo.jpg', '/work/f/b/wood.png']))
  })

  it('the Showcase takes the map with the stand-in, and no photo in it', () => {
    const { files, it } = framed()
    const p = newProject('Frames')
    p.files = files
    p.scene_items.push(it)
    const plan = showcasePlan(p, new Set())
    expect(plan.blockers).toEqual([])
    expect(Object.values(plan.snapshot.files).map((f) => f.name)).not.toContain('photo.jpg')
    expect(plan.snapshot.scene_items[0].textures.m1).toBe('/work/f/c/picture.png')
  })
})
