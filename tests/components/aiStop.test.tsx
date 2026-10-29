// @vitest-environment jsdom
// A real AI reply (runAiActions) over slow loads: stopped by its time limit, its Cancel or another map opened, it
// writes nothing after, its steps are one undo step, and mirror mode doesn't copy its edits. Only the loading is stood
// in for (with delays); the placement, shape, prefab and physics-set code is the real one.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { editJob, useEditor } from '../../src/editor/store'
import { runAiActions } from '../../src/editor/aiActions'
import { newProject, type SceneItem } from '../../src/lib/project'
import type { AiAction } from '../../src/lib/aiChat'

const T = vi.hoisted(() => ({ place: 60, store: 60, sync: 0 }))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

vi.mock('../../src/lib/assets', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/assets')>()), cacheModel: vi.fn(), loadModel: vi.fn(async () => ({})),
}))
vi.mock('../../src/lib/files', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/files')>()),
  storeFile: vi.fn(async (_b: Blob, name: string) => { await sleep(T.store); return { vpath: 'files/' + name, ref: { hash: 'h-' + name, name, type: 'model/obj', size: 1, origin: 'user' } } }),
}))
const GAME = [{ id: 'bench', name: 'Bench', size: [2, 1, 1] }, { id: 'bin', name: 'Bin', size: [1, 1, 1] }, { id: 'tyre', name: 'Tyre', size: [1, 1, 1] }]
vi.mock('../../src/lib/gameObjects/client', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/gameObjects/client')>()),
  loadIndex: vi.fn(async () => { await sleep(20); return GAME }),
  entryById: (id: string) => GAME.find((e) => e.id === id),
}))
vi.mock('../../src/lib/gameObjects/tags', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/gameObjects/tags')>()), varietyPick: () => GAME,
}))
vi.mock('../../src/lib/gameObjects/place', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/gameObjects/place')>()),
  sinkUnits: () => 0,
  gameObjectItem: vi.fn(async (e: { id: string; name: string }, at: [number, number, number]) => {
    await sleep(T.place)
    return { item: { uid: 'g-' + Math.random(), name: e.name, path: 'files/' + e.id + '.obj', position: at, rotation: [0, 0, 0], scale: 1, textures: {} }, files: {} }
  }),
}))
vi.mock('../../src/lib/importers', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/importers')>()),
  importImage: vi.fn(async () => ({ vpath: 'files/t.png', ref: { hash: 'h-t', name: 't.png', type: 'image/png', size: 1, origin: 'user' } })),
}))
vi.mock('../../src/lib/images', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/images')>()), pixelsToPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
}))
vi.mock('../../src/lib/procedural', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/procedural')>()), generate: () => new Uint8ClampedArray(4),
}))
vi.mock('../../src/lib/samples', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/samples')>()),
  materialize: vi.fn(async (parts: unknown[]) => ({
    items: parts.map((_, k) => ({ uid: 'm' + k + Math.random(), name: 'part', path: 'files/p.obj', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, shape: { kind: 'box', size: [1, 1, 1], tile: 1 }, textures: { top: 'files/t.png', side: 'files/s.png' }, alpha: {}, surface_ids: { top: 0 } })),
    files: { 'files/t.png': { hash: 'h-t', name: 't.png', type: 'image/png', size: 1, origin: 'user' } },
  })),
}))
vi.mock('../../src/lib/markerPlacer', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/markerPlacer')>()),
  weaponSpots: (_p: unknown, _b: unknown, n: number) => Array.from({ length: n }, (_, k) => [10 + k * 6, 0, 8]),
}))
vi.mock('../../src/lib/py', () => ({
  py: {
    syncProject: vi.fn(async () => { await sleep(T.sync) }),
    sceneOp: vi.fn(async (_op: string, payload: { item: Record<string, unknown> }) => ({ ...payload.item, native_prop_behavior: 'movable', native_breakable_kind: 'prop' })),
  },
}))

const st = () => useEditor.getState()
function openMap(name = 'A') {
  const p = newProject(name)
  p.scene_items = [{ uid: 'base', name: 'Base', path: 'base.obj', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: { m: 'tex/x.png' } } as unknown as SceneItem]
  st().open(p)
  return p
}
const names = () => st().project!.scene_items.map((it) => it.name)
const labels = () => st().past.map((x) => x.label)
const presets = () => st().project!.scene_items.filter((x) => x.physics_preset).length
const next = () => editJob(async () => { st().update('Next', (d) => { d.name = 'Next' }) })
const reply = (a: object[]) => a as AiAction[]
const fill = reply([{ do: 'fill_game_objects', count: 6, mirror: true }])
const shapes = reply([0, 1, 2, 3, 4].map((k) => ({ do: 'add_shape', shape: 'box', x: 10 + k * 5, z: 4, mirror: true })))
const crates = reply([{ do: 'add_prefab', key: 'crate_tower', x: 20, z: 20 }])
afterEach(() => { st().set({ mirror: false }); st().close(); T.place = 60; T.store = 60; T.sync = 0 })

describe('An AI reply past its time', () => {
  it('fill_game_objects: nothing lands after, and what landed is one undo step', { timeout: 30000 }, async () => {
    openMap()
    const r = await runAiActions(fill, 'AI: fill', { limit: 200 })
    expect(r.stopped).toBe('time')
    const at = { names: names(), labels: labels() }
    await next()
    await sleep(1500)
    expect(names()).toEqual(at.names)
    expect(labels()).toEqual([...at.labels, 'Next'])
    expect(at.labels.length).toBeLessThanOrEqual(1)
    if (at.labels.length) expect(at.labels[0]).toBe('AI: fill')
  })

  it('several add_shape (slow storing): nothing lands after', { timeout: 30000 }, async () => {
    openMap()
    await runAiActions(shapes, 'AI: shapes', { limit: 250 })
    const at = { names: names(), labels: labels() }
    await sleep(1500)
    expect(names()).toEqual(at.names)
    expect(labels()).toEqual(at.labels)
    expect(at.labels.length).toBeLessThanOrEqual(1)
  })

  it('a physics set: no physics props or steps land after (they write by index)', { timeout: 30000 }, async () => {
    openMap()
    T.store = 1
    T.sync = 400
    await runAiActions(crates, 'AI: crates', { limit: 150 })
    const at = { labels: labels(), presets: presets() }
    await next()
    await sleep(1200)
    expect(presets()).toBe(at.presets)
    expect(labels()).toEqual([...at.labels, 'Next'])
  })
})

describe("An AI reply's Cancel", () => {
  it('mid fill: nothing after', { timeout: 30000 }, async () => {
    openMap()
    const cancel = new AbortController()
    const running = runAiActions(fill, 'AI: fill', { signal: cancel.signal })
    await sleep(200)
    cancel.abort()
    expect((await running).stopped).toBe('cancel')
    const at = { names: names(), labels: labels() }
    await sleep(1500)
    expect(names()).toEqual(at.names)
    expect(labels()).toEqual(at.labels)
  })

  it('while a physics set makes its props: nothing after', { timeout: 30000 }, async () => {
    openMap()
    T.store = 1
    T.sync = 600
    const { py } = await import('../../src/lib/py')
    vi.mocked(py.syncProject).mockClear()
    const cancel = new AbortController()
    const running = runAiActions(crates, 'AI: crates', { signal: cancel.signal })
    await vi.waitFor(() => expect(py.syncProject).toHaveBeenCalled(), { timeout: 5000 })
    cancel.abort()
    await running
    const at = { labels: labels(), presets: presets() }
    await next()
    await sleep(1200)
    expect(presets()).toBe(at.presets)
    expect(labels()).toEqual([...at.labels, 'Next'])
  })

  for (const ms of [0, 1, 3, 8, 20, 40]) {
    it(`pressed ${ms} ms into a physics set: nothing after`, { timeout: 30000 }, async () => {
      openMap()
      T.store = 1
      T.sync = 600
      const cancel = new AbortController()
      const running = runAiActions(crates, 'AI: crates', { signal: cancel.signal })
      await sleep(ms)
      cancel.abort()
      await running
      const at = labels()
      await next()
      await sleep(900)
      expect(labels()).toEqual([...at, 'Next'])
    })
  }

  for (const ticks of [0, 1, 2, 3, 4, 6, 10]) {
    it(`pressed ${ticks} microtasks in: nothing after`, async () => {
      st().open(newProject('A'))
      const cancel = new AbortController()
      const running = runAiActions(reply([{ do: 'rename_map', name: 'Late' }, { do: 'set_weather', clear: true }]), 'AI: x', { signal: cancel.signal })
      for (let i = 0; i < ticks; i++) await Promise.resolve()
      cancel.abort()
      await running
      const name = st().project!.settings.display_name
      await next()
      await sleep(50)
      expect(st().project!.settings.display_name).toBe(name)
    })
  }

  it("stops only its own reply: another one keeps going", { timeout: 30000 }, async () => {
    openMap()
    T.place = 5
    const cancel = new AbortController()
    const mine = runAiActions(fill, 'AI: mine', { signal: cancel.signal })
    const other = runAiActions(reply([{ do: 'rename_map', name: 'Other' }]), 'AI: other')
    cancel.abort()
    expect((await mine).stopped).toBe('cancel')
    expect(await other).toEqual({ done: 1, skipped: [] })
    expect(st().project!.settings.display_name).toBe('Other')
  })
})

describe('Another map opened mid-reply', () => {
  it('fill_game_objects: map B untouched', { timeout: 30000 }, async () => {
    openMap('A')
    const running = runAiActions(reply([...fill, { do: 'rename_map', name: 'From A' }]), 'AI: fill')
    await sleep(200)
    const b = openMap('B')
    expect((await running).stopped).toBe('map')
    await sleep(1000)
    expect(st().project).toBe(b)
    expect(names()).toEqual(['Base'])
    expect(labels()).toEqual([])
  })

  it('add_shape x5: map B untouched', { timeout: 30000 }, async () => {
    openMap('A')
    const running = runAiActions(shapes, 'AI: shapes')
    await sleep(250)
    const b = openMap('B')
    await running
    await sleep(1000)
    expect(st().project).toBe(b)
    expect(names()).toEqual(['Base'])
    expect(labels()).toEqual([])
  })

  it('while a physics set makes its props: map B untouched', { timeout: 30000 }, async () => {
    openMap('A')
    T.store = 1
    T.sync = 400
    const running = runAiActions(crates, 'AI: crates')
    await sleep(150)
    const b = openMap('B')
    await running
    await sleep(800)
    expect(st().project).toBe(b)
    expect(names()).toEqual(['Base'])
  })
})

describe('A physics set in an AI reply', () => {
  it('is one undo step, its props made', { timeout: 30000 }, async () => {
    openMap()
    T.store = 1
    await runAiActions(crates, 'AI: crates')
    expect(labels()).toEqual(['AI: crates'])
    expect(presets()).toBeGreaterThan(0)
  })

  it('makes the same objects with mirror mode on as off: the AI places its own twins', { timeout: 30000 }, async () => {
    const made: string[][] = []
    for (const mode of [false, true]) {
      openMap()
      T.store = 1
      st().set({ mirror: mode })
      await runAiActions(reply([{ do: 'add_prefab', key: 'crate_tower', x: 20, z: 20, mirror: true }]), 'AI: pair')
      expect(labels()).toEqual(['AI: pair'])
      made.push(names())
      st().set({ mirror: false })
      st().close()
    }
    expect(made[1]).toEqual(made[0])
  })

  it('in a mixed reply with mirror mode on: AI twins only, one undo step', { timeout: 30000 }, async () => {
    openMap()
    st().set({ mirror: true })
    T.place = 5
    T.store = 1
    await runAiActions(reply([{ do: 'add_game_object', id: 'bench', x: 5, z: 5, mirror: true }, { do: 'add_shape', shape: 'box', x: 9, z: 3, mirror: true }, ...crates]), 'AI: fill')
    expect(labels()).toEqual(['AI: fill'])
    expect(names().filter((n) => n === 'Bench')).toHaveLength(2)
  })
})

describe('A long undo list', () => {
  it('still makes the reply one step when the list is full (150 steps)', { timeout: 30000 }, async () => {
    openMap()
    for (let k = 0; k < 160; k++) st().update('Step ' + k, (d) => { d.name = 'n' + k })
    expect(st().past).toHaveLength(150)
    T.place = 5
    await runAiActions(reply([{ do: 'add_game_object', id: 'bench', x: 5, z: 5, mirror: true }]), 'AI: benches')
    expect(st().past.at(-1)!.label).toBe('AI: benches')
    expect(st().past.at(-2)!.label).toBe('Step 159')
    st().undo()
    expect(names()).toEqual(['Base'])
  })
})
