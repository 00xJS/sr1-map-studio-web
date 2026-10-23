import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SAMPLES } from '../src/lib/samples'
import { defaultParams } from '../src/lib/procedural'
import { MAX_SHOTS, checkShots, libraryIdsFrom, prepareShowcase, showcasePlan } from '../src/lib/hubRules'
import { cleanRecipe, recipeProblem, validParams, validShape, type FileRecipe } from '../src/lib/recipes'
import { newProject, type FileRef, type Project, type SceneItem } from '../src/lib/project'

const library = libraryIdsFrom(JSON.parse(readFileSync('public/textures/index.json', 'utf8')))
const HASH = (n: number) => n.toString(16).padStart(64, '0')

function file(n: number, name: string, recipe?: FileRecipe): [string, FileRef] {
  return [`/work/f/${HASH(n)}/${name}`, { hash: HASH(n), size: 100, name, type: '', origin: 'user', ...(recipe ? { recipe } : {}) }]
}
function item(path: string, textures: Record<string, string>, extra: Partial<SceneItem> = {}): SceneItem {
  return { uid: crypto.randomUUID(), name: 'Wall', path, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures, alpha: {}, ...extra }
}
function map(files: [string, FileRef][], items: SceneItem[]): Project {
  const p = newProject('Test')
  p.files = Object.fromEntries(files)
  p.scene_items = items
  return p
}

const shape: FileRecipe = { kind: 'shape', shape: { kind: 'box', size: [4, 3, 1], tile: 4 } }
const brick: FileRecipe = { kind: 'generated', params: defaultParams('brick', 512) }
const lib: FileRecipe = { kind: 'library', id: [...library][0] }

describe('Showcase rules', () => {
  it('takes a map made only of the site’s own pieces', () => {
    const [obj, tex, tex2] = [file(1, 'box.obj', shape), file(2, 'brick.png', brick), file(3, 'lib.jpg', lib)]
    const plan = showcasePlan(map([obj, tex, tex2], [item(obj[0], { top: tex[0], side: tex2[0] })]), library)
    expect(plan.blockers).toEqual([])
    expect(Object.keys(plan.snapshot.files)).toHaveLength(3)
    for (const ref of Object.values(plan.snapshot.files)) expect(ref.recipe).toBeTruthy()
  })

  it('rejects files the user brought, and never puts them in the snapshot', () => {
    const [obj, photo] = [file(1, 'box.obj', shape), file(2, 'my_photo.jpg')]
    const plan = showcasePlan(map([obj, photo], [item(obj[0], { top: photo[0] })]), library)
    expect(plan.blockers.join(' ')).toMatch(/you added yourself.*my_photo\.jpg/)
    expect(Object.values(plan.snapshot.files).some((f) => f.name === 'my_photo.jpg')).toBe(false)
  })

  it('rejects imported models and unknown library ids', () => {
    const [obj, tex] = [file(1, 'ripped.obj'), file(2, 'x.jpg', { kind: 'library', id: 'not_in_library' })]
    const plan = showcasePlan(map([obj, tex], [item(obj[0], { top: tex[0] })]), library)
    expect(plan.blockers.some((b) => /ripped\.obj/.test(b))).toBe(true)
    expect(plan.blockers.some((b) => /unknown starter texture/.test(b))).toBe(true)
  })

  it('drops the library, private paths and rendered pictures from the snapshot', () => {
    const [obj, tex] = [file(1, 'box.obj', shape), file(2, 'brick.png', brick)]
    const p = map([obj, tex], [item(obj[0], { top: tex[0] }, { source_path: obj[0], original_import_path: 'C:/Users/me/Desktop/box.obj' })])
    p.asset_library = [{ uid: 'a', name: 'Mine', path: '/work/f/x/mine.obj', source_path: '', textures: {}, alpha: {}, triangles: 1 }]
    p.settings.minimap_mode = 'auto'
    p.settings.minimap_texture = '/work/f/y/minimap.png'
    const plan = showcasePlan(p, library)
    expect(plan.blockers).toEqual([])
    expect(plan.snapshot.asset_library).toEqual([])
    expect(plan.snapshot.scene_items[0].original_import_path).toBeUndefined()
    expect(plan.snapshot.settings.minimap_texture).toBe('')
  })

  it('validates recipes from untrusted JSON and strips extra fields', () => {
    expect(recipeProblem({ kind: 'shape', shape: { kind: 'box', size: [1, 1, 1e9], tile: 4 } }, library)).toBeTruthy()
    expect(recipeProblem({ kind: 'generated', params: { ...defaultParams('brick'), size: 3000 } }, library)).toBeTruthy()
    expect(recipeProblem({ kind: 'compound', pieces: [] }, library)).toBeTruthy()
    expect(recipeProblem({ kind: 'url', href: 'https://example.com/x.png' }, library)).toBeTruthy()
    const dirty = { kind: 'shape', shape: { kind: 'box', size: [1, 1, 1], tile: 4, data: 'smuggled' } } as unknown as FileRecipe
    expect(JSON.stringify(cleanRecipe(dirty))).not.toMatch(/smuggled/)
  })

  it('prepareShowcase checks title, tags and the project', () => {
    const r = prepareShowcase({ format: 'nope' }, { title: 'ok title', description: '', tags: [] }, library)
    expect(r.problems.join(' ')).toMatch(/not a valid/)
  })

  it('screenshots must be small images', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(checkShots([{ size: 1000, head: png }])).toEqual([])
    expect(checkShots([{ size: 5 * 1024 * 1024, head: png }])).toHaveLength(1)
    expect(checkShots([{ size: 1000, head: new TextEncoder().encode('<html>') }])).toHaveLength(1)
    expect(checkShots(Array.from({ length: MAX_SHOTS + 1 }, () => ({ size: 1000, head: png })))[0]).toMatch(/at most/)
  })
})

describe('every sample map can go in the Showcase', () => {
  const DETAILED = 1024
  for (const s of SAMPLES) {
    it(s.name, () => {
      for (const p of s.parts) {
        expect(validShape({ kind: p.kind, size: p.size, tile: p.tile ?? 4, ...(p.segments ? { segments: p.segments } : {}), ...(p.outline ? { outline: p.outline } : {}) }), p.label).toBe(true)
        for (const t of [p.top, p.side]) {
          if ('gen' in t) for (const size of [512, DETAILED]) expect(validParams({ ...defaultParams(t.gen, size), ...t.tweak, size }), JSON.stringify(t)).toBe(true)
          if ('lib' in t) expect(library.has(t.lib)).toBe(true)
        }
      }
    })
  }
})

describe('every prefab can go in the Showcase', async () => {
  const { ALL_PREFABS } = await import('../src/lib/prefabRegistry')
  const { prefabParams } = await import('../src/lib/prefabs')
  for (const [key, def] of Object.entries(ALL_PREFABS)) {
    it(key, () => {
      const parts = def.make(0, 0, 0, 0, prefabParams(def, {}))
      expect(parts.length).toBeLessThanOrEqual(400)
      for (const p of parts) {
        expect(validShape({ kind: p.kind, size: p.size, tile: p.tile ?? 4, ...(p.segments ? { segments: p.segments } : {}), ...(p.outline ? { outline: p.outline } : {}), ...(p.taper !== undefined ? { taper: p.taper } : {}), ...(p.bevel ? { bevel: p.bevel } : {}) }), `${key} ${p.label}`).toBe(true)
        for (const t of [p.top, p.side]) {
          if ('gen' in t) expect(validParams({ ...defaultParams(t.gen, 512), ...t.tweak, size: 512 }), `${key} ${JSON.stringify(t)}`).toBe(true)
          if ('lib' in t) expect(library.has(t.lib), t.lib).toBe(true)
        }
      }
    })
  }
})
