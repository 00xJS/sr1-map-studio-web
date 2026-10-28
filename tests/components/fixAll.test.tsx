// @vitest-environment jsdom
// Fix all (editor/checkFixes.ts): one undo step with the real addStairRamps, a fix that throws doesn't stop the
// others, the editor is locked while it runs, a fix that never finishes can be stopped (or times out) without writing
// later, opening a map ends it, and one map's findings never show on another.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JobTooLong, MapChanged, editJob, startRun, stillCurrent, useEditor, whenUnlocked } from '../../src/editor/store'
import { storeFile } from '../../src/lib/files'
import { addShape } from '../../src/editor/act/shapes'
import { runMapChecks } from '../../src/editor/mapChecks'
import { cancelAiEdits } from '../../src/editor/aiActions'
import { gameObjectItem } from '../../src/lib/gameObjects/place'
import { loadIndex } from '../../src/lib/gameObjects/client'
import { runAiActions } from '../../src/editor/aiActions'
import { loadModel } from '../../src/lib/assets'
import { skyFile } from '../../src/lib/samples'
import { addDefaultSky } from '../../src/editor/actions'
import { useHealth } from '../../src/editor/health'
import { handleKey } from '../../src/editor/shortcuts'
import { FIX_TIME_LIMIT, fixAll } from '../../src/editor/checkFixes'
import { applySpawnFix, fixSpawnsAndWeapons } from '../../src/editor/spawnActions'
import { parseObj } from '../../src/lib/geometry'
import { newMarker, newProject, type SceneItem } from '../../src/lib/project'

type V = [number, number, number]

/** A box's 12 triangles. */
function box([x0, y0, z0]: V, [x1, y1, z1]: V): number[] {
  const v: V[] = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]
  const out: number[] = []
  for (const [a, b, c, d] of [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]) out.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d])
  return out
}

/** Ground, six steps 0.8 units high (0.4 m: too tall to walk up), and a landing, as an OBJ model. */
function stairsModel() {
  const t = box([-40, -1, -40], [40, 0, 40])
  for (let k = 0; k < 6; k++) t.push(...box([-2, 0, k * 1.2], [2, (k + 1) * 0.8, (k + 1) * 1.2]))
  t.push(...box([-2, 0, 7.2], [2, 4.8, 13.2]))
  const lines = ['usemtl m']
  for (let i = 0; i < t.length; i += 3) lines.push(`v ${t[i]} ${t[i + 1]} ${t[i + 2]}`)
  for (let i = 1; i <= t.length / 3; i += 3) lines.push(`f ${i} ${i + 1} ${i + 2}`)
  return parseObj(lines.join('\n'))
}

// Only the file reading and writing is stood in for: the stair finder and addStairRamps itself are the real ones.
vi.mock('../../src/lib/assets', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/assets')>()),
  loadModel: vi.fn(async () => stairsModel()),
  cacheModel: vi.fn(),
}))
vi.mock('../../src/lib/files', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/files')>()),
  storeFile: vi.fn(async (_b: Blob, name: string) => ({ vpath: 'files/' + name, ref: { hash: 'h-' + name, name, type: 'model/obj', size: 1, origin: 'user' } })),
  storeFileIf: vi.fn(async (_b: Blob, name: string, keep: () => boolean) => keep() ? { vpath: 'files/' + name, ref: { hash: 'h-' + name, name, type: 'model/obj', size: 1, origin: 'user' } } : null),
}))
// The game object library: its index and an object's files, stood in for; placeGameObject is the real one.
const GAME = [{ id: 'bench', name: 'Bench', size: [2, 1, 1] }, { id: 'bin', name: 'Bin', size: [1, 1, 1] }] as never[]
vi.mock('../../src/lib/gameObjects/client', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/gameObjects/client')>()),
  loadIndex: vi.fn(async () => GAME),
  entryById: (id: string) => (GAME as { id: string }[]).find((e) => e.id === id),
}))
vi.mock('../../src/lib/gameObjects/tags', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/gameObjects/tags')>()),
  varietyPick: () => GAME,
}))
vi.mock('../../src/lib/gameObjects/place', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/gameObjects/place')>()),
  sinkUnits: () => 0,
  gameObjectItem: vi.fn(async (e: { id: string; name: string }, at: [number, number, number]) => ({
    item: { uid: 'g-' + Math.random(), name: e.name, path: 'files/' + e.id + '.obj', position: at, rotation: [0, 0, 0], scale: 1, textures: {} },
    files: {},
  })),
}))
vi.mock('../../src/lib/importers', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/importers')>()),
  importImage: vi.fn(async () => ({ vpath: 'files/invisible.png', ref: { hash: 'h-inv', name: 'invisible.png', type: 'image/png', size: 1, origin: 'user' } })),
}))
vi.mock('../../src/lib/images', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/images')>()),
  pixelsToPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
}))
vi.mock('../../src/lib/samples', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/samples')>()),
  skyFile: vi.fn(async () => ({ vpath: 'files/sky.png', ref: { hash: 'h-sky', name: 'sky.png', type: 'image/png', size: 1, origin: 'user' } })),
}))
vi.mock('../../src/editor/spawnActions', async (orig) => ({
  ...(await orig<typeof import('../../src/editor/spawnActions')>()),
  fixSpawnsAndWeapons: vi.fn(),
}))
vi.mock('../../src/editor/health', async (orig) => ({ ...(await orig<typeof import('../../src/editor/health')>()), runHealthCheck: vi.fn(async () => {}) }))

function openMap() {
  const p = newProject('Fix all')
  p.scene_items = [{ uid: 'stairs', name: 'Stairs', path: 'stairs.obj', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: { m: 'tex/x.png' } } as unknown as SceneItem]
  p.markers = [newMarker('Shared spawn', [0, 0, -10])]
  p.settings.remove_invisible_walls = false
  useEditor.getState().open(p)
  return p
}

const spawnFix = vi.mocked(fixSpawnsAndWeapons)
afterEach(() => { useEditor.getState().close(); spawnFix.mockReset(); vi.clearAllMocks() })

/** Makes the next model read hang until the returned function is called (a stuck IndexedDB read). */
function hangModelRead() {
  let release = () => {}
  vi.mocked(loadModel).mockImplementationOnce(() => new Promise((r) => { release = () => r(stairsModel()) }))
  return () => release()
}
/** Ctrl+`key` pressed on the page (not in a field). */
function keyOnPage(key: string) {
  const e = new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true })
  Object.defineProperty(e, 'target', { value: document.body })
  return e
}
const settle = () => new Promise((r) => setTimeout(r, 50))

describe('Fix all', () => {
  it('lays the real stair ramps and the setting as one undo step', { timeout: 30000 }, async () => {
    openMap()
    const { done, failed } = await fixAll([{ kind: 'ramps' }, { kind: 'walls' }])
    expect(failed).toEqual([])
    expect(done[0]).toMatch(/invisible ramp/)
    const st = useEditor.getState()
    expect(st.project!.scene_items.map((it) => it.name)).toEqual(['Stairs', 'Invisible stair ramps'])
    expect(st.past.map((x) => x.label)).toEqual(['Fix all'])
    st.undo()
    expect(useEditor.getState().project!.scene_items).toHaveLength(1)
    expect(useEditor.getState().project!.settings.remove_invisible_walls).toBe(false)
  })

  it('keeps going past a fix that throws, and says which', { timeout: 30000 }, async () => {
    openMap()
    spawnFix.mockRejectedValue(new Error('the planner fell over'))
    const { done, failed } = await fixAll([{ kind: 'walls' }, { kind: 'spawns' }])
    expect(done).toEqual(['invisible walls left out at export'])
    expect(failed).toEqual(['spawns and weapons (the planner fell over)'])
    expect(useEditor.getState().project!.settings.remove_invisible_walls).toBe(true)
    expect(useEditor.getState().past.map((x) => x.label)).toEqual(['Fix all'])
    expect(useEditor.getState().locked).toBeNull()
  })

  it('locks the editor while it runs: Undo and the editor keys do nothing', async () => {
    openMap()
    useEditor.getState().update('Before', (d) => { d.name = 'Before' })
    let finish = () => {}
    spawnFix.mockImplementation(async () => {
      useEditor.getState().update('Fix spawns and weapons', (d) => { d.markers.push(newMarker('Shared spawn', [5, 0, 5])) })
      await new Promise<void>((r) => { finish = r })
      return { moved: 0, added: { spawns: 1, weapons: 0 }, reasons: [], floor: 10 }
    })
    const running = fixAll([{ kind: 'spawns' }])
    await vi.waitFor(() => expect(useEditor.getState().project!.markers).toHaveLength(2))
    const st = useEditor.getState()
    expect(st.locked).toBe('Fix all')
    // Mid-run, Undo (the button or Ctrl+Z) changes nothing.
    st.undo()
    const e = keyOnPage('z')
    expect(handleKey(e, useEditor.getState())).toBe(true)
    expect(e.defaultPrevented).toBe(true)
    // The browser's own keys aren't the editor's to block.
    const find = keyOnPage('f')
    expect(handleKey(find, useEditor.getState())).toBe(false)
    expect(find.defaultPrevented).toBe(false)
    expect(useEditor.getState().project!.markers).toHaveLength(2)
    expect(useEditor.getState().project!.name).toBe('Before')
    finish()
    await running
    expect(useEditor.getState().locked).toBeNull()
    expect(useEditor.getState().past.map((x) => x.label)).toEqual(['Before', 'Fix all'])
    useEditor.getState().undo()
    expect(useEditor.getState().project!.markers).toHaveLength(1)
    expect(useEditor.getState().project!.name).toBe('Before')
  })
})

describe('Fix all that never finishes', () => {
  it('Stop ends it: what was fixed stays as one undo step, and the stuck fix writes nothing when it wakes', { timeout: 30000 }, async () => {
    openMap()
    const release = hangModelRead()
    const running = fixAll([{ kind: 'walls' }, { kind: 'ramps' }, { kind: 'spawns' }])
    await vi.waitFor(() => expect(loadModel).toHaveBeenCalled())
    let free = false
    void whenUnlocked().then(() => { free = true })
    await settle()
    expect(useEditor.getState().locked).toBe('Fix all')
    expect(free).toBe(false)

    useEditor.getState().stopTransaction()
    const { done, failed } = await running
    expect(done).toEqual(['invisible walls left out at export'])
    expect(failed).toEqual(['stair ramps (stopped)', 'spawns and weapons (stopped)'])
    expect(spawnFix).not.toHaveBeenCalled()
    expect(useEditor.getState().locked).toBeNull()
    expect(free).toBe(true)
    expect(useEditor.getState().past.map((x) => x.label)).toEqual(['Fix all'])

    release()
    await settle()
    expect(useEditor.getState().project!.scene_items.map((it) => it.name)).toEqual(['Stairs'])
    expect(useEditor.getState().past.map((x) => x.label)).toEqual(['Fix all'])
  })

  it('stops by itself when a fix takes too long', { timeout: 30000 }, async () => {
    openMap()
    const release = hangModelRead()
    const { done, failed } = await fixAll([{ kind: 'ramps' }, { kind: 'walls' }], 100)
    expect(done).toEqual([])
    expect(failed[0]).toMatch(/^stair ramps \(took over .*, so Fix all stopped\)$/)
    expect(failed[1]).toBe('invisible walls (stopped)')
    expect(useEditor.getState().locked).toBeNull()
    expect(useEditor.getState().past).toEqual([])
    release()
    await settle()
    expect(useEditor.getState().project!.scene_items).toHaveLength(1)
  })

  it('ends when the same map is opened again: no undo step over the reloaded map, and the fixes left stop', { timeout: 30000 }, async () => {
    const p = openMap()
    const release = hangModelRead()
    const running = fixAll([{ kind: 'walls' }, { kind: 'ramps' }, { kind: 'spawns' }])
    await vi.waitFor(() => expect(loadModel).toHaveBeenCalled())
    useEditor.getState().open(p)
    expect(useEditor.getState().locked).toBeNull()
    const { failed } = await running
    expect(failed).toEqual(['stair ramps (stopped)', 'spawns and weapons (stopped)'])
    release()
    await settle()
    const st = useEditor.getState()
    expect(st.project).toBe(p)
    expect(st.past).toEqual([])
    expect(spawnFix).not.toHaveBeenCalled()
  })

  it('leaves the sky of a map opened while the sky picture loaded alone', async () => {
    openMap()
    let release = () => {}
    vi.mocked(skyFile).mockImplementationOnce(() => new Promise((r) => { release = () => r({ vpath: 'files/sky.png', ref: { hash: 'h-sky', name: 'sky.png', type: 'image/png', size: 1, origin: 'user' } as never }) }))
    const adding = addDefaultSky()
    await vi.waitFor(() => expect(skyFile).toHaveBeenCalled())
    const b = openMap()
    release()
    // A map change, not a failure: the checklist says nothing for it.
    await expect(adding).rejects.toBeInstanceOf(MapChanged)
    expect(useEditor.getState().project).toBe(b)
    expect(useEditor.getState().past).toEqual([])
  })
})

describe('Fix all and the edits running beside it', () => {
  const realSpawnFix = async () => (await vi.importActual<typeof import('../../src/editor/spawnActions')>('../../src/editor/spawnActions')).fixSpawnsAndWeapons()

  it("waits for a spawn plan running in the background, and Stop doesn't cancel that plan", { timeout: 30000 }, async () => {
    openMap()
    // Place spawns automatically (the Install dialog's checklist) runs on after the dialog closes.
    const release = hangModelRead()
    const background = editJob(realSpawnFix)
    await vi.waitFor(() => expect(loadModel).toHaveBeenCalled())
    const running = fixAll([{ kind: 'walls' }])
    await settle()
    // Covered at once, but its edits wait for the plan.
    expect(useEditor.getState().locked).toBe('Fix all')
    expect(useEditor.getState().project!.settings.remove_invisible_walls).toBe(false)

    useEditor.getState().stopTransaction()
    expect(await running).toEqual({ done: [], failed: ['invisible walls (stopped)'] })
    release()
    const placed = await background
    expect(placed.floor).toBeGreaterThan(0)
    expect(placed.added.spawns + placed.added.weapons + placed.moved).toBeGreaterThan(0)
    expect(useEditor.getState().past.map((x) => x.label)).toEqual(['Fix spawns and weapons'])
  })

  it('runs after a background spawn plan lands, as its own undo step', { timeout: 30000 }, async () => {
    openMap()
    const release = hangModelRead()
    const background = editJob(realSpawnFix)
    await vi.waitFor(() => expect(loadModel).toHaveBeenCalled())
    const running = fixAll([{ kind: 'walls' }])
    release()
    await background
    expect((await running).done).toEqual(['invisible walls left out at export'])
    expect(useEditor.getState().past.map((x) => x.label)).toEqual(['Fix spawns and weapons', 'Fix all'])
    useEditor.getState().undo()
    expect(useEditor.getState().project!.settings.remove_invisible_walls).toBe(false)
    expect(useEditor.getState().project!.markers.length).toBeGreaterThan(1)
  })

  it('makes AI edits arriving mid-run wait, so undoing Fix all keeps them and they keep their own step', { timeout: 30000 }, async () => {
    openMap()
    let finish = () => {}
    spawnFix.mockImplementation(async () => {
      useEditor.getState().update('Fix spawns and weapons', (d) => { d.markers.push(newMarker('Shared spawn', [5, 0, 5])) })
      await new Promise<void>((r) => { finish = r })
      return { moved: 0, added: { spawns: 1, weapons: 0 }, reasons: [], floor: 10 }
    })
    const running = fixAll([{ kind: 'spawns' }])
    await vi.waitFor(() => expect(useEditor.getState().project!.markers).toHaveLength(2))
    // An AI reply comes in while Fix all holds the editor.
    const ai = runAiActions([{ do: 'rename_map', name: 'Harbor Rumble' }], 'AI extras')
    await settle()
    expect(useEditor.getState().project!.settings.display_name).not.toBe('Harbor Rumble')
    finish()
    await running
    expect((await ai).done).toBe(1)
    expect(useEditor.getState().past.map((x) => x.label)).toEqual(['Fix all', 'AI extras'])
    // Undo the AI's step, then Fix all's: each takes back only its own.
    useEditor.getState().undo()
    expect(useEditor.getState().project!.markers).toHaveLength(2)
    useEditor.getState().undo()
    expect(useEditor.getState().project!.markers).toHaveLength(1)
  })
})

/** An edit job that makes one edit called `label`, then waits until the returned function is called. */
function stuckJob(label: string) {
  let release = () => {}
  const done = editJob(async () => {
    useEditor.getState().update(label, (d) => { d.name = label })
    await new Promise<void>((r) => { release = r })
  })
  return { done, release: () => release() }
}

describe('Edit jobs take turns', () => {
  it("runs AI edits after the job before them, so each keeps its own undo step", { timeout: 30000 }, async () => {
    openMap()
    // The map checks' stair ramps (or a checklist job) are still going when an AI reply comes in.
    const job = editJob(async () => {
      useEditor.getState().update('Add invisible stair ramps', (d) => { d.markers.push(newMarker('Shared spawn', [5, 0, 5])) })
      await settle()
      useEditor.getState().update('Add invisible stair ramps', (d) => { d.markers.push(newMarker('Shared spawn', [9, 0, 9])) })
    })
    const ai = runAiActions([{ do: 'rename_map', name: 'Harbor Rumble' }], 'AI extras')
    await job
    expect((await ai).done).toBe(1)
    expect(useEditor.getState().past.map((x) => x.label)).toEqual(['Add invisible stair ramps', 'Add invisible stair ramps', 'AI extras'])
    // Undoing the AI's step keeps the ramps.
    useEditor.getState().undo()
    expect(useEditor.getState().project!.markers).toHaveLength(3)
  })

  it("doesn't tie a job's work to a Fix all still waiting for it, so Stop leaves it alone", { timeout: 30000 }, async () => {
    openMap()
    let step = () => {}, landed = false
    const job = editJob(async () => {
      await new Promise<void>((r) => { step = r })
      // Starts its work while Fix all waits for it.
      const run = startRun()
      await new Promise<void>((r) => { step = r })
      stillCurrent(run)
      useEditor.getState().update('Job', (d) => { d.name = 'Job' })
      landed = true
    })
    await settle()
    const running = fixAll([{ kind: 'walls' }])
    step()
    await settle()
    useEditor.getState().stopTransaction()
    await running
    step()
    await job
    expect(landed).toBe(true)
    expect(useEditor.getState().past.map((x) => x.label)).toEqual(['Job'])
  })

  it("gives up after the time limit when a job never ends, fixing nothing", { timeout: 30000 }, async () => {
    openMap()
    const job = stuckJob('Stuck job')
    await settle()
    const r = await fixAll([{ kind: 'walls' }, { kind: 'spawns' }], FIX_TIME_LIMIT, 100)
    expect(r.done).toEqual([])
    expect(r.failed).toEqual([
      "invisible walls (other changes to the map took over 0 minutes, so Fix all didn't start)",
      "spawns and weapons (other changes to the map took over 0 minutes, so Fix all didn't start)",
    ])
    expect(useEditor.getState().locked).toBeNull()
    expect(useEditor.getState().project!.settings.remove_invisible_walls).toBe(false)
    expect(useEditor.getState().past.map((x) => x.label)).toEqual(['Stuck job'])
    job.release()
    await job.done
  })

  it("doesn't make Fix all on one map wait for a job left over from the map before", { timeout: 30000 }, async () => {
    openMap()
    const job = stuckJob('Stuck job')
    await settle()
    openMap()
    const r = await fixAll([{ kind: 'walls' }])
    expect(r.done).toEqual(['invisible walls left out at export'])
    expect(useEditor.getState().past.map((x) => x.label)).toEqual(['Fix all'])
    job.release()
    await job.done
  })

  it("leaves out the AI edits left when another map opens mid-reply", { timeout: 30000 }, async () => {
    openMap()
    let release = () => {}
    vi.mocked(skyFile).mockImplementationOnce(() => new Promise((r) => { release = () => r({ vpath: 'files/sky.png', ref: { hash: 'h-sky', name: 'sky.png', type: 'image/png', size: 1, origin: 'user' } as never }) }))
    const ai = runAiActions([{ do: 'set_map', sky_picture: true }, { do: 'rename_map', name: 'Harbor Rumble' }], 'AI extras')
    await vi.waitFor(() => expect(skyFile).toHaveBeenCalled())
    const b = openMap()
    release()
    const { skipped } = await ai
    expect(skipped).toContain('another map was opened')
    const st = useEditor.getState()
    expect(st.project).toBe(b)
    expect(st.past).toEqual([])
  })
})

describe('Work queued or loading when another map opens', () => {
  it("drops an AI reply queued behind a job on the map before: none of its edits land on the new map", { timeout: 30000 }, async () => {
    openMap()
    const job = stuckJob('Stuck job')
    await settle()
    const ai = runAiActions([{ do: 'rename_map', name: 'Harbor Rumble' }], 'AI extras for A')
    const b = openMap()
    job.release()
    await job.done
    expect(await ai).toEqual({ done: 0, skipped: ['another map was opened'] })
    const st = useEditor.getState()
    expect(st.project).toBe(b)
    expect(st.project!.settings.display_name).not.toBe('Harbor Rumble')
    expect(st.past).toEqual([])
  })

  it('keeps a shape whose files were still being stored off a map opened meanwhile, in an AI reply too', { timeout: 30000 }, async () => {
    openMap()
    let release = () => {}
    vi.mocked(storeFile).mockImplementationOnce((_b, name) => new Promise((r) => { release = () => r({ vpath: 'files/' + name, ref: { hash: 'h-' + name, name, type: 'model/obj', size: 1, origin: 'user' } }) }))
    const ai = runAiActions([{ do: 'add_shape', shape: 'wall', x: 0, z: 0 }, { do: 'rename_map', name: 'Harbor Rumble' }], 'AI extras')
    await vi.waitFor(() => expect(storeFile).toHaveBeenCalled())
    const b = openMap()
    release()
    expect(await ai).toEqual({ done: 0, skipped: ['another map was opened'] })
    expect(useEditor.getState().project).toBe(b)
    expect(b.scene_items).toHaveLength(1)
    expect(useEditor.getState().past).toEqual([])
    // Placed by hand, the same: it is quietly left out.
    vi.mocked(storeFile).mockImplementationOnce((_b, name) => new Promise((r) => { release = () => r({ vpath: 'files/' + name, ref: { hash: 'h-' + name, name, type: 'model/obj', size: 1, origin: 'user' } }) }))
    const placing = addShape('wall', [0, 0, 0], 0)
    await vi.waitFor(() => expect(storeFile).toHaveBeenCalledTimes(2))
    openMap()
    release()
    await expect(placing).rejects.toBeInstanceOf(MapChanged)
    expect(useEditor.getState().past).toEqual([])
  })

  it("stops the map checks of a map left while its ramps were made: the new map's tab stays as it is", { timeout: 30000 }, async () => {
    openMap()
    const release = hangModelRead()
    const checks = runMapChecks(['found by the wizard'])
    await vi.waitFor(() => expect(loadModel).toHaveBeenCalled())
    openMap()
    useEditor.setState({ tab: 'build' })
    release()
    expect(await checks).toEqual([])
    expect(useEditor.getState().tab).toBe('build')
    expect(useEditor.getState().past).toEqual([])
  })
})

/** Makes the next game object's files hang until the returned function is called. */
function hangGameObject() {
  let release = () => {}
  vi.mocked(gameObjectItem).mockImplementationOnce((e, at) => new Promise((r) => { release = () => r({ item: { uid: 'late', name: (e as { name: string }).name, path: 'files/late.obj', position: at, rotation: [0, 0, 0], scale: 1, textures: {} } as never, files: {} }) }))
  return () => release()
}
const names = () => useEditor.getState().project!.scene_items.map((it) => it.name)

describe('An AI reply stopped partway', () => {
  it('places nothing more once its time runs out, even mid-loop, and what it did is one undo step', { timeout: 30000 }, async () => {
    openMap()
    // The first object lands, the second (its mirrored twin) waits on its files past the reply's time.
    let calls = 0
    vi.mocked(gameObjectItem).mockImplementation(async (e, at) => {
      if (++calls === 2) await new Promise((r) => setTimeout(r, 300))
      return { item: { uid: 'g' + calls, name: (e as { name: string }).name, path: 'files/g.obj', position: at, rotation: [0, 0, 0], scale: 1, textures: {} } as never, files: {} }
    })
    const r = await runAiActions([{ do: 'add_game_object', id: 'bench', x: 5, z: 5, mirror: true }], 'AI: benches', 100)
    expect(r.skipped).toContain('the rest (it took over 0 minutes)')
    expect(r.done).toBe(1)
    // The next job runs at once; the stuck placement wakes after it and writes nothing.
    await editJob(async () => { useEditor.getState().update('Next', (d) => { d.name = 'Next' }) })
    await new Promise((res) => setTimeout(res, 400))
    expect(names()).toEqual(['Stairs', 'Bench'])
    expect(useEditor.getState().past.map((x) => x.label)).toEqual(['AI: benches', 'Next'])
    vi.mocked(gameObjectItem).mockReset()
  })

  it('stops at Cancel the same way', { timeout: 30000 }, async () => {
    openMap()
    const release = hangGameObject()
    const reply = runAiActions([{ do: 'add_game_object', id: 'bench', x: 5, z: 5, mirror: true }], 'AI: bench')
    await vi.waitFor(() => expect(gameObjectItem).toHaveBeenCalled())
    cancelAiEdits()
    expect(await reply).toEqual({ done: 0, skipped: ['the rest (cancelled)'] })
    release()
    await settle()
    expect(names()).toEqual(['Stairs'])
    expect(useEditor.getState().past).toEqual([])
  })

  it('writes nothing to a map opened while the game object library loaded', { timeout: 30000 }, async () => {
    openMap()
    let release = () => {}
    vi.mocked(loadIndex).mockImplementationOnce(() => new Promise((r) => { release = () => r(GAME as never) }))
    const reply = runAiActions([{ do: 'fill_game_objects', count: 2 }, { do: 'rename_map', name: 'Harbor Rumble' }], 'AI: benches')
    await vi.waitFor(() => expect(loadIndex).toHaveBeenCalled())
    const b = openMap()
    release()
    expect(await reply).toEqual({ done: 0, skipped: ['another map was opened'] })
    expect(useEditor.getState().project).toBe(b)
    expect(names()).toEqual(['Stairs'])
    expect(useEditor.getState().past).toEqual([])
  })
})

describe('An edit job past its time', () => {
  it('lets the queue go on, and what it does after that changes nothing', { timeout: 30000 }, async () => {
    openMap()
    let release = () => {}, wrote = false
    const slow = editJob(async () => {
      const run = startRun()
      await new Promise<void>((r) => { release = r })
      stillCurrent(run)
      useEditor.getState().update('Late', (d) => { d.name = 'Late' })
      wrote = true
    }, { limit: 100 })
    const next = editJob(async () => { useEditor.getState().update('Next', (d) => { d.name = 'Next' }) })
    await expect(slow).rejects.toBeInstanceOf(JobTooLong)
    await next
    expect(useEditor.getState().past.map((x) => x.label)).toEqual(['Next'])
    release()
    await settle()
    expect(wrote).toBe(false)
    expect(useEditor.getState().project!.name).toBe('Next')
  })
})

describe('Findings belong to their map', () => {
  it("clears the stairs and invisible walls found on one map when another opens", () => {
    const a = openMap()
    useHealth.setState({ projectId: a.id, stairs: 2, slivers: { count: 3, places: [[0, 0, 0]] } as never })
    const b = openMap()
    expect(b.id).not.toBe(a.id)
    const h = useHealth.getState()
    expect(h.projectId).toBe(b.id)
    expect(h.stairs).toBe(0)
    expect(h.slivers).toBeNull()
    expect(h.report).toBeNull()
  })
})

describe('Spawn fix plan', () => {
  it('moves markers by uid, so a marker added or reordered since planning moves only itself', () => {
    const p = newProject('Plan')
    const [s1, s2] = [newMarker('Shared spawn', [0, 0, 0]), newMarker('Shared spawn', [1, 0, 0])]
    p.markers = [s1, s2]
    const plan = { plan: { moved: [{ index: 1, to: [9, 0, 9], why: 'inside a wall' }], added: [], floor: 1 }, scale: 1, uids: [s1.uid, s2.uid] } as never
    // Since the plan: a marker was put in front of them.
    p.markers.unshift(newMarker('Weapon pickup', [3, 0, 3]))
    applySpawnFix(p, plan)
    expect(p.markers.find((m) => m.uid === s2.uid)!.position).toEqual([9, 0, 9])
    expect(p.markers.find((m) => m.uid === s1.uid)!.position).toEqual([0, 0, 0])
    expect(p.markers[0].position).toEqual([3, 0, 3])
  })
})
