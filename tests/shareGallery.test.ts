// Play links grown up: how models were made (the gallery rule) and the
// rebuild that checks it, link metadata, time-trial ghosts and their checks,
// and racing bots.
import { describe, expect, it } from 'vitest'
import type { RaceGraph } from '../src/lib/analysis/analysis.worker'
import { newMarker, newProject, type Marker, type Vec3 } from '../src/lib/project'
import { SPRINT_SPEED } from '../src/lib/player'
import { RaceBots } from '../src/play/bots'
import { madeKind, modelBuild } from '../src/play/makeShare'
import { ALL_PREFABS } from '../src/lib/prefabRegistry'
import { prefabParams, tagPrefab } from '../src/lib/prefabs'
import { prefabModel } from '../src/lib/prefabModel'
import { compoundObj, shapeObj, type CompoundPiece, type Shape } from '../src/lib/shapes'
import { terrainShape } from '../src/lib/terrain'
import { galleryProblems, shapeLines } from '../src/play/shareBuilds'
import { buildKeysOk } from '../src/play/shareSchema'
import { availableRuns, newRun, raceScores, stepBot, stepRun, targets } from '../src/play/game'
import { GHOST_MAX, GhostRecorder, checkTime, cleanName, ghostAt, loadGhost, saveGhost, type GhostSample } from '../src/play/ghost'
import { cleanObj, galleryReady, previewProblem, shareMeta, validateShareDoc, type ModelBuild, type ShareDoc } from '../src/play/share'
import { fakeWebp } from './fakeWebp'

const OBJ = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'
const at = (type: string, p: Vec3, patch: Partial<Marker> = {}) => ({ ...newMarker(type, p), ...patch })

function doc(made?: ShareDoc['made']): ShareDoc {
  const p = newProject('Gallery test')
  for (const [i, path] of ['mesh/0', 'mesh/1'].entries()) {
    p.scene_items.push({ uid: 'i' + i, name: 'Box', path, position: [i * 4, 0, 0], rotation: [0, 0, 0], scale: 1, textures: {}, alpha: {} })
  }
  p.markers.push(at('Shared spawn', [0, 0, 0]), at('Red team spawn', [5, 0, 0]), at('Weapon pickup', [10, 0, 0], { weapon: 'ak47' }))
  return {
    format: 'sr1-map-studio-share', version: 1, title: 'Gallery test', created_at: '2026-10-27T00:00:00Z', project: p,
    models: { 'mesh/0': cleanObj(OBJ)!, 'mesh/1': cleanObj(OBJ)! }, textures: {}, ...(made ? { made } : {}),
  }
}

describe('the gallery takes only maps made on the site', () => {
  it('lists shapes, compounds and prefabs', () => {
    expect(galleryReady(doc({ 'mesh/0': 'shape', 'mesh/1': 'prefab' }))).toBe(true)
    expect(galleryReady(doc({ 'mesh/0': 'compound', 'mesh/1': 'shape' }))).toBe(true)
  })
  it('refuses imported models, and links made before models were labelled', () => {
    expect(galleryReady(doc({ 'mesh/0': 'shape', 'mesh/1': 'import' }))).toBe(false)
    expect(galleryReady(doc({ 'mesh/0': 'shape' }))).toBe(false)
    expect(galleryReady(doc())).toBe(false)
  })
  it('checks the labels when a share carries them', () => {
    expect(validateShareDoc(doc({ 'mesh/0': 'shape', 'mesh/1': 'prefab' })).problems).toEqual([])
    expect(validateShareDoc(doc()).problems).toEqual([])
    expect(validateShareDoc(doc({ 'mesh/0': 'shape', 'mesh/1': 'stolen' as never })).problems.join()).toMatch(/how models were made/)
    expect(validateShareDoc(doc({ 'mesh/9': 'shape' })).problems.join()).toMatch(/how models were made/)
    expect(validateShareDoc({ ...doc(), made: [] as never }).problems.join()).toMatch(/how models were made/)
  })
  it('tells how each model was made: its recipe first, then the prefab that placed it', () => {
    const ref = (recipe?: object) => ({ hash: 'h', size: 1, name: 'm.obj', type: 'model/obj', origin: 'user' as const, ...(recipe ? { recipe: recipe as never } : {}) })
    expect(madeKind(ref({ kind: 'shape', shape: { kind: 'box' } }), false)).toBe('shape')
    expect(madeKind(ref({ kind: 'compound', pieces: [] }), true)).toBe('compound')
    expect(madeKind(ref(), true)).toBe('prefab')
    expect(madeKind(ref(), false)).toBe('import')
    expect(madeKind(undefined, false)).toBe('import')
  })
  it('works out what a link preview shows', () => {
    expect(shareMeta(doc())).toEqual({ modes: ['roam', 'weapons'], players: 2 })
    const d = doc()
    d.project.markers.push(at('Chains drop-off', [0, 0, 20]), at('Chains drop-off', [0, 0, 40]))
    // One weapon: a race would be for that one weapon, so none is offered.
    expect(shareMeta(d).modes).toEqual(['roam', 'weapons', 'dropoffs'])
    d.project.markers.push(at('Weapon pickup', [30, 0, 0], { weapon: 'shotgun' }))
    expect(shareMeta(d).modes).toEqual(['roam', 'weapons', 'dropoffs', 'race'])
  })
})

describe('the gallery rebuilds every model from its settings', () => {
  const one = (obj: string, build: ModelBuild) => galleryProblems({ models: { m: cleanObj(obj)! }, made: { m: build.kind }, builds: { m: build } })
  const shape: Shape = { kind: 'cylinder', size: [2, 6, 2], tile: 4, segments: 12, taper: 0.5 }
  const pieces: CompoundPiece[] = [
    { shape: { kind: 'box', size: [4, 1, 4], tile: 4 }, at: [0, 0, 0], rot: 0, top: 'm0', side: 'm1' },
    { shape: { kind: 'ramp', size: [2, 1, 3], tile: 2 }, at: [3, 1, 0], rot: 90, top: 'm0', side: 'm2' },
  ]

  it('accepts shapes and compounds that come out as the model in the share', () => {
    expect(one(shapeObj(shape), { kind: 'shape', shape })).toEqual([])
    expect(one(compoundObj(pieces), { kind: 'compound', pieces })).toEqual([])
  })
  it('refuses a model its settings don’t make', () => {
    expect(one(shapeObj({ ...shape, segments: 13 }), { kind: 'shape', shape }).join()).toMatch(/doesn’t match/)
    const moved = pieces.map((pc, i) => (i ? { ...pc, at: [3, 1.2, 0] as Vec3 } : pc))
    expect(one(compoundObj(moved), { kind: 'compound', pieces }).join()).toMatch(/doesn’t match/)
    expect(one(OBJ, { kind: 'shape', shape }).join()).toMatch(/doesn’t match/)
  })
  it('refuses settings out of range before building anything', () => {
    expect(one(shapeObj(shape), { kind: 'shape', shape: { ...shape, segments: 100000 } }).join()).toMatch(/out of range/)
    const many = Array.from({ length: 20001 }, () => pieces[0])
    expect(one(compoundObj(pieces), { kind: 'compound', pieces: many }).join()).toMatch(/too many/)
    expect(one(OBJ, { kind: 'prefab', key: 'no-such-prefab', params: {}, at: [0, 0, 0], rot: 0 }).join()).toMatch(/doesn’t have/)
    // A cheap model can't hide an expensive rebuild: the whole share has a budget.
    const ball: Shape = { kind: 'sphere', size: [1, 1, 1], tile: 1, segments: 128 }
    const heavy = { models: {} as Record<string, string>, made: {} as Record<string, 'shape'>, builds: {} as Record<string, ModelBuild> }
    for (let i = 0; i < 200; i++) { heavy.models['m' + i] = OBJ; heavy.made['m' + i] = 'shape'; heavy.builds['m' + i] = { kind: 'shape', shape: ball } }
    expect(galleryProblems(heavy).join()).toMatch(/too many models to check/)
  })
  it('rebuilds a prefab from its key and settings, wherever it stands', () => {
    const def = ALL_PREFABS.shop
    const params = prefabParams(def, {})
    const built = cleanObj(compoundObj(prefabModel(tagPrefab(def.make(10, 20, 30, 0, params), 'shop', params, [10, 0, 20], 30)).pieces))!
    expect(one(built, { kind: 'prefab', key: 'shop', params, at: [10, 0, 20], rot: 30 })).toEqual([])
    expect(one(built, { kind: 'prefab', key: 'shop', params, at: [-50, 0, 5], rot: 30 })).toEqual([])
    const num = def.params!.find((d) => d.kind === 'number' && d.max !== undefined)!
    expect(one(built, { kind: 'prefab', key: 'shop', params: { ...params, [num.key]: num.max! + 1 }, at: [10, 0, 20], rot: 30 }).join()).toMatch(/out of range/)
    expect(one(built, { kind: 'prefab', key: 'shop', params: { ...params, nonsense: 1 }, at: [10, 0, 20], rot: 30 }).join()).toMatch(/doesn’t have/)
  })
  it('never rebuilds a road from its points (only from its pieces), and bounds a sign’s text and colors', () => {
    const params = prefabParams(ALL_PREFABS.road, {})
    expect(one(OBJ, { kind: 'prefab', key: 'road', params, at: [0, 0, 0], rot: 0 }).join()).toMatch(/for a road/)
    const sign = prefabParams(ALL_PREFABS.textsign, {})
    expect(one(OBJ, { kind: 'prefab', key: 'textsign', params: { ...sign, text: 'x'.repeat(201) }, at: [0, 0, 0], rot: 0 }).join()).toMatch(/out of range/)
    expect(one(OBJ, { kind: 'prefab', key: 'textsign', params: { ...sign, color: 'red; junk' }, at: [0, 0, 0], rot: 0 }).join()).toMatch(/out of range/)
    expect(one(OBJ, { kind: 'prefab', key: 'textsign', params: { ...sign, color: '#a0b0c0' }, at: [0, 0, 0], rot: 0 }).join()).toMatch(/doesn’t match/)
  })

  it('counts the lines a shape writes without overstating them, so an honest model is never turned away', () => {
    const lines = (o: string) => o.split('\n').filter((l) => /^(v|vt|vn|f) /.test(l)).length
    const shapes: Shape[] = [
      { kind: 'box', size: [3, 2, 1], tile: 2 }, { kind: 'box', size: [8, 3, 8], tile: 2, bevel: 1 }, { kind: 'ramp', size: [4, 2, 6], tile: 2, open: true },
      { kind: 'stairs', size: [4, 3, 6], tile: 2, segments: 9 }, { kind: 'stairs', size: [4, 3, 6], tile: 2 }, { kind: 'roof', size: [6, 3, 5], tile: 2 },
      { kind: 'cylinder', size: [2, 5, 2], tile: 2, segments: 128, taper: 0.3, lie: true }, { kind: 'sphere', size: [3, 3, 3], tile: 2, segments: 128 },
      { kind: 'torus', size: [4, 4, 1], tile: 2, segments: 7, lie: true }, { kind: 'blob', size: [5, 2, 5], tile: 2, outline: [[0, 2], [2, 0], [0, -2], [-1, -1], [-2, 1]] },
    ]
    for (const sh of shapes) expect(shapeLines(sh, false).least).toBe(lines(shapeObj(sh)))
    const ground = terrainShape(30, 20, { cell: 2 }) as Shape
    expect(shapeLines(ground, false).least).toBeLessThanOrEqual(lines(shapeObj(ground)))
    expect(shapeLines(ground, false).most).toBeGreaterThanOrEqual(lines(shapeObj(ground)))
    expect(shapeLines(ground, true).least).toBe(lines(compoundObj([{ shape: ground, at: [0, 0, 0], rot: 0, top: 'a', side: 'b' }])))
  })

  it('refuses a share that is costly to check before doing the work, and stops at its deadline', () => {
    const tiny = cleanObj('v 0 0 0\nf 1 1 1\n')!
    const many = (n: number, build: (i: number) => ModelBuild, obj: (b: ModelBuild) => string = () => tiny) => {
      const d = { models: {} as Record<string, string>, made: {} as Record<string, 'shape' | 'compound' | 'prefab'>, builds: {} as Record<string, ModelBuild> }
      for (let i = 0; i < n; i++) { const b = build(i); d.models['m' + i] = obj(b); d.made['m' + i] = b.kind; d.builds['m' + i] = b }
      return d
    }
    const ball = (i: number): ModelBuild => ({ kind: 'shape', shape: { kind: 'sphere', size: [1 + i / 1000, 1, 1], tile: 1, segments: 128 } })
    const boxes = (i: number): ModelBuild => ({ kind: 'compound', pieces: Array.from({ length: 20000 }, (_, j) => ({ shape: { kind: 'box', size: [1 + j / 1e5, 1, 1 + i / 1e5], tile: 1 }, at: [j % 100, 0, Math.floor(j / 100)], rot: 0, top: 'a', side: 'b' })) })
    const shop = (i: number): ModelBuild => ({ kind: 'prefab', key: 'srblock', params: prefabParams(ALL_PREFABS.srblock, {}), at: [i, 0, 0], rot: 0 })
    const pad = cleanObj('v 0 0 0\n'.repeat(300_001) + 'f 1 2 3\n')!
    for (const [d, why] of [
      [many(4000, ball), /doesn’t match/], // each would write far more than its model holds: never built
      [many(15, ball, (b) => cleanObj(shapeObj((b as { shape: Shape }).shape))!), /too many models/], // honest, but too much in all
      [many(20, boxes), /too many models/],
      [many(400, shop), /doesn’t match|too many models/],
      [many(2, shop, () => pad), /too many models/], // models padded so nothing can fail early: refused by their size
    ] as const) expect(galleryProblems(d).join()).toMatch(why)
    // Past its deadline the check gives up at once.
    expect(galleryProblems(many(15, ball, (b) => cleanObj(shapeObj((b as { shape: Shape }).shape))!), { deadline: performance.now() - 1 }).join()).toMatch(/too many models/)
  })

  it('needs a build for every model the share says the site made', () => {
    expect(galleryProblems({ models: { m: cleanObj(shapeObj(shape))! }, made: { m: 'shape' } }).join()).toMatch(/no settings/)
    expect(galleryProblems({ models: { m: cleanObj(shapeObj(shape))! }, made: { m: 'compound' }, builds: { m: { kind: 'shape', shape } } }).join()).toMatch(/no settings/)
    expect(galleryProblems({ models: { m: cleanObj(shapeObj(shape))! }, made: { m: 'import' }, builds: { m: { kind: 'shape', shape } } }).join()).toMatch(/imported/)
  })
  it('takes a terrain’s heights from the object when its file’s recipe leaves them out', () => {
    const ground = { ...terrainShape(20, 20, { cell: 5 }), heights: undefined as number[] | undefined }
    const full = terrainShape(20, 20, { cell: 5 })
    full.heights = full.heights!.map((_, i) => (i % 3) * 0.5)
    const obj = cleanObj(shapeObj(full))!
    const item = { uid: 't', name: 'Ground', path: 'p', position: [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3, scale: 1, textures: {}, alpha: {}, shape: full }
    const b = modelBuild(obj, { name: 'terrain.obj', hash: 'h', size: 1, origin: 'user', recipe: { kind: 'shape', shape: ground as Shape } } as any, [item])
    expect(b).toEqual({ kind: 'shape', shape: full })
    expect(modelBuild(obj, { name: 'terrain.obj', hash: 'h', size: 1, origin: 'user', recipe: { kind: 'shape', shape: ground as Shape } } as any, [])).toBeNull()
  })
})

describe('what a share may hold', () => {
  it('keeps only the fields a share has, cleaned', () => {
    const p: any = newProject('Fields')
    p.scene_items.push({ uid: 'a', name: 'Box', path: 'mesh/0', position: [1, 2, 3], rotation: [0, 0, 0], scale: 1, textures: { top: 'tex/0', junk: 7 }, alpha: {}, junk: 'x', game_object: { path: 'x' }, shape: { kind: 'box', size: [1, 1, 1], tile: 1, junk: 1 } })
    p.markers.push({ ...newMarker('Shared spawn'), junk: 'x', yaw: 'not a number' })
    p.lights.push({ uid: 'l', name: 'Lamp', enabled: true, position: [0, 3, 0], color: [1, 1, 1], intensity: 1, inner_range: 1, range: 3, junk: 1 })
    p.junk = 'x'
    p.settings.junk = 'x'
    const raw = { format: 'sr1-map-studio-share', version: 1, title: 'Fields', created_at: 'now', project: p, models: { 'mesh/0': OBJ }, textures: { 'tex/0': { kind: 'library', id: 'concrete' } }, junk: 'x' }
    const { doc, problems } = validateShareDoc(raw)
    expect(problems).toEqual([])
    const it0 = doc!.project.scene_items[0] as any
    expect(it0.junk).toBeUndefined()
    expect(it0.game_object).toBeUndefined()
    expect(it0.textures).toEqual({ top: 'tex/0' })
    expect(it0.shape).toEqual({ kind: 'box', size: [1, 1, 1], tile: 1 })
    expect(it0.position).toEqual([1, 2, 3])
    expect((doc!.project.markers[0] as any).junk).toBeUndefined()
    expect('yaw' in doc!.project.markers[0]).toBe(false)
    expect((doc!.project.lights[0] as any).junk).toBeUndefined()
    expect((doc!.project as any).junk).toBeUndefined()
    expect((doc!.project.settings as any).junk).toBeUndefined()
    expect((doc as any).junk).toBeUndefined()
  })
  it('takes model settings with only the keys a build has', () => {
    const box: Shape = { kind: 'box', size: [1, 1, 1], tile: 1 }
    expect(buildKeysOk({ kind: 'shape', shape: box })).toBe(true)
    expect(buildKeysOk({ kind: 'shape', shape: box, extra: 1 })).toBe(false)
    expect(buildKeysOk({ kind: 'shape', shape: { ...box, extra: 1 } })).toBe(false)
    expect(buildKeysOk({ kind: 'compound', pieces: [{ shape: box, at: [0, 0, 0], rot: 0, top: 'a', side: 'b' }] })).toBe(true)
    expect(buildKeysOk({ kind: 'compound', pieces: [{ shape: box, at: [0, 0, 0], rot: 0, top: 'a', side: 'b', extra: 1 }] })).toBe(false)
    expect(buildKeysOk({ kind: 'prefab', key: 'shop', params: { w: 10 }, at: [0, 0, 0], rot: 0 })).toBe(true)
    expect(buildKeysOk({ kind: 'prefab', key: 'shop', params: { w: { deep: 1 } }, at: [0, 0, 0], rot: 0 })).toBe(false)
    expect(buildKeysOk({ kind: 'prefab', key: 'shop', params: {}, at: [0, 0, 0], rot: 0, extra: 1 })).toBe(false)
  })
})

describe('preview pictures', () => {
  it('takes only a plain 640×360 WebP', () => {
    expect(previewProblem(fakeWebp())).toBeNull()
    expect(previewProblem(fakeWebp(640, 360, [['VP8X', [0x10, 0, 0, 0, 127, 2, 0, 103, 1, 0]], ['ALPH', [0, 1, 2]]]))).toBeNull()
    expect(previewProblem(fakeWebp(1280, 720))).toMatch(/640×360/)
    expect(previewProblem(fakeWebp(640, 360, [['XMP ', [1]]]))).toMatch(/more than a picture/)
    expect(previewProblem(fakeWebp(640, 360, [['VP8X', [0x02, 0, 0, 0, 127, 2, 0, 103, 1, 0]]]))).toMatch(/more than a picture/)
    expect(previewProblem(new Uint8Array([...fakeWebp(), 0, 0]))).toMatch(/not a WebP/)
    expect(previewProblem(new Uint8Array(300 * 1024))).toMatch(/too large/)
  })
})

describe('ghost recorder', () => {
  it('keeps a sample every 100 ms and the finishing one', () => {
    const r = new GhostRecorder()
    for (let t = 0; t <= 1000; t += 16) r.add(t, [t / 100, 0, 0], 0)
    r.finish(1003, [10, 0, 0], 0.5)
    const ts = r.samples.map((s) => s[0])
    expect(ts[0]).toBe(0)
    expect(ts.at(-1)).toBe(1003)
    expect(ts.length).toBeGreaterThanOrEqual(10)
    expect(ts.length).toBeLessThanOrEqual(12)
    for (let i = 1; i < ts.length - 1; i++) expect(ts[i] - ts[i - 1]).toBeGreaterThanOrEqual(100)
  })
  it('thins itself out on a long run instead of growing past the cap', () => {
    const r = new GhostRecorder()
    for (let t = 0; t <= 30 * 60_000; t += 16) r.add(t, [0, 0, 0], 0)
    expect(r.samples.length).toBeLessThan(GHOST_MAX)
    expect(r.samples.at(-1)![0]).toBeGreaterThan(29 * 60_000)
  })
  it('rounds positions so a ghost stays small', () => {
    const r = new GhostRecorder()
    r.add(0, [1.234567, 2.345678, 3.456789], 0.123456)
    expect(r.samples[0]).toEqual([0, 1.23, 2.35, 3.46, 0.123])
  })
  it('plays back between samples, turning the short way round', () => {
    const g: GhostSample[] = [[0, 0, 0, 0, 3], [100, 10, 0, 0, -3]]
    const mid = ghostAt(g, 50)!
    expect(mid.at[0]).toBeCloseTo(5)
    expect(Math.abs(mid.heading)).toBeGreaterThan(3) // through ±π, not through 0
    expect(ghostAt(g, -5)!.at[0]).toBe(0)
    expect(ghostAt(g, 999)!.at[0]).toBe(10)
    expect(ghostAt([], 0)).toBeNull()
  })
  it('keeps your best ghost per map and run', () => {
    const mem = new Map<string, string>()
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
    expect(loadGhost(store, 'm', 'weapons')).toBeNull()
    saveGhost(store, 'm', 'weapons', [[0, 0, 0, 0, 0], [10, 1, 0, 0, 0]])
    expect(loadGhost(store, 'm', 'weapons')).toHaveLength(2)
    expect(loadGhost(store, 'm', 'dropoffs')).toBeNull()
  })
})

describe('board times are checked against the map', () => {
  const ms: Marker[] = [at('Shared spawn', [0, 0, 0]), at('Weapon pickup', [20, 0, 0], { weapon: 'ak47' }), at('Weapon pickup', [20, 0, 20], { weapon: 'shotgun' })]
  /** Running from the spawn through both weapons at `speed` units/s, sampled every 100 ms. */
  function run(speed: number): { ms: number; ghost: GhostSample[] } {
    const path: Vec3[] = [[0.4, 0, 0], [20, 0, 0], [20, 0, 20]]
    const r = new GhostRecorder()
    let t = 0
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1], path[i]]
      const len = Math.hypot(b[0] - a[0], b[2] - a[2])
      for (let d = 0; d < len; d += speed * 0.1, t += 100) r.add(t, [a[0] + ((b[0] - a[0]) * d) / len, 0, a[2] + ((b[2] - a[2]) * d) / len], 0)
    }
    r.finish(t, path[2], 0)
    return { ms: t, ghost: r.samples }
  }
  const ok = run(9)
  const entry = (patch: object = {}) => ({ mode: 'weapons' as const, name: 'Ace', ...ok, ...patch })

  it('passes an honest run', () => expect(checkTime(entry(), ms)).toEqual([]))
  it('refuses a run faster than a sprint', () => {
    const fast = run(SPRINT_SPEED * 2)
    expect(checkTime(entry(fast), ms).join()).toMatch(/faster than a player/)
  })
  it('refuses a time that its recording does not match', () => {
    expect(checkTime(entry({ ms: ok.ms - 2000 }), ms).join()).toMatch(/doesn't match the time/)
  })
  it('refuses a run that skips a weapon', () => {
    const skip = ok.ghost.filter((s) => s[3] < 5)
    const end = skip.at(-1)![0]
    expect(checkTime(entry({ ghost: skip, ms: end }), ms).join()).toMatch(/never reaches every weapon/)
  })
  it('refuses a run that starts away from the spawns', () => {
    const moved = ok.ghost.map((s) => [s[0], s[1] + 50, s[2], s[3], s[4]] as GhostSample)
    expect(checkTime(entry({ ghost: moved }), ms).join()).toMatch(/start at a spawn/)
  })
  it('allows pressing R to go back to the spawn', () => {
    // Halfway to the first weapon, back to the spawn in one frame, then the whole run again.
    const half = ok.ghost.filter((s) => s[1] <= 10)
    const t = half.at(-1)![0] + 100
    const again = ok.ghost.map((s) => [s[0] + t, s[1], s[2], s[3], s[4]] as GhostSample)
    expect(checkTime(entry({ ghost: [...half, ...again], ms: ok.ms + t }), ms)).toEqual([])
    // Jumping anywhere else is not allowed.
    const away = again.map((s) => [s[0], s[1], s[2], s[3] + 6, s[4]] as GhostSample)
    expect(checkTime(entry({ ghost: [...half, ...away], ms: ok.ms + t }), ms).join()).toMatch(/faster than a player/)
  })
  it('needs a name, a real run and a well-formed recording', () => {
    expect(checkTime(entry({ name: '' }), ms).join()).toMatch(/name/)
    expect(checkTime(entry({ mode: 'roam' }), ms).join()).toMatch(/Only weapon and drop-off runs/)
    expect(checkTime(entry({ mode: 'dropoffs' }), ms).join()).toMatch(/no such run/)
    expect(checkTime(entry({ ghost: 'x' }), ms).join()).toMatch(/missing/)
    expect(checkTime(entry({ ghost: [[0, 0, 0, 0], [1, 2, 3, 4]] }), ms).join()).toMatch(/not valid/)
    expect(checkTime(entry({ ghost: [[0, 0, 0, 0, 0], [5, NaN, 0, 0, 0]] }), ms).join()).toMatch(/not valid/)
    expect(checkTime(entry({ ms: 500 }), ms).join()).toMatch(/out of range/)
  })
  it('cleans names for the board', () => {
    expect(cleanName('  Big \n  Boss  ')).toBe('Big Boss')
    expect(cleanName('x'.repeat(40))).toHaveLength(24)
    expect(cleanName(42)).toBe('')
  })
})

describe('race the bots', () => {
  const ms: Marker[] = [at('Shared spawn', [0, 0, 0]), at('Weapon pickup', [20, 0, 0], { weapon: 'ak47' }), at('Weapon pickup', [-20, 0, 0], { weapon: 'shotgun' })]

  it('is offered once a map has two things to race for', () => {
    expect(availableRuns(ms).map((r) => r.mode)).toContain('race')
    expect(availableRuns(ms.slice(0, 2)).map((r) => r.mode)).not.toContain('race')
  })
  it('is offered for the set it races: weapons when there are any, else drop-offs', () => {
    const drops = [at('Chains drop-off', [0, 0, 20]), at('Chains drop-off', [0, 0, 40])]
    const oneWeapon = [ms[0], ms[1], ...drops]
    expect(availableRuns(oneWeapon).map((r) => r.mode)).not.toContain('race')
    expect(availableRuns([ms[0], ...drops]).find((r) => r.mode === 'race')?.count).toBe(2)
    expect(newRun([ms[0], ...drops], 'race', [0, 0, 0]).race).toBe('dropoff')
  })
  it('lets a bot give up on a marker it can’t reach from the floor', () => {
    const high = [ms[0], at('Weapon pickup', [8, 20, 0], { weapon: 'ak47' }), at('Weapon pickup', [-20, 0, 0], { weapon: 'shotgun' })]
    const n = 21
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) pos[i * 3] = -20 + i * 2
    const edgeStart = new Int32Array(n + 1), to: number[] = [], cost: number[] = []
    for (let i = 0; i < n; i++) { edgeStart[i] = to.length; for (const j of [i - 1, i + 1]) if (j >= 0 && j < n) { to.push(j); cost.push(2) } }
    edgeStart[n] = to.length
    const field = (goal: number) => Float32Array.from({ length: n }, (_, i) => Math.abs(i - goal) * 2)
    // The high weapon's node is right under it (x = 8): touching it would need the bot 20 units up.
    const g: RaceGraph = { pos, edgeStart, edgeTo: Int32Array.from(to), edgeCost: Float32Array.from(cost), goals: Int32Array.from([14, 0]), fields: [field(14), field(0)], starts: Int32Array.from([12]) }
    const r = newRun(high, 'race', [0, 0, 0])
    const bots = new RaceBots(g, targets(r).map((p) => p.id), 1, [12])
    stepRun(r, [0.5, 0, 0], 0)
    let took = false
    for (let k = 0; k < 80 && !took; k++) { bots.step(0.1, r); took = stepBot(r, 1, bots.bots[0].at, k).length > 0 }
    expect(took).toBe(true)
    expect(targets(r).find((p) => p.weapon === 'shotgun')!.by).toBe(1)
  })
  it('gives each pickup to whoever reaches it first and ends when all are taken', () => {
    const r = newRun(ms, 'race', [0, 0, 0])
    expect(targets(r)).toHaveLength(2)
    stepRun(r, [0.5, 0, 0], 0) // the clock starts
    expect(stepBot(r, 1, [20, 0, 0], 10).map((e) => e.type)).toEqual(['bot'])
    expect(stepBot(r, 2, [20, 0, 0], 11)).toEqual([]) // already taken
    const end = stepRun(r, [-20, 0, 0], 20)
    expect(end.map((e) => e.type)).toEqual(['weapon', 'finish'])
    expect(raceScores(r, 3)).toEqual([1, 1, 0, 0])
  })
  it('keeps bots still until the player moves', () => {
    const r = newRun(ms, 'race', [0, 0, 0])
    expect(stepBot(r, 1, [20, 0, 0], 0)).toEqual([])
  })
  it('walks bots downhill on the walking-cost field to the nearest pickup', () => {
    // A straight corridor of 21 nodes, 2 units apart, from x = -20 to 20.
    const n = 21
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) pos[i * 3] = -20 + i * 2
    const edgeStart = new Int32Array(n + 1), to: number[] = [], cost: number[] = []
    for (let i = 0; i < n; i++) { edgeStart[i] = to.length; for (const j of [i - 1, i + 1]) if (j >= 0 && j < n) { to.push(j); cost.push(2) } }
    edgeStart[n] = to.length
    const field = (goal: number) => Float32Array.from({ length: n }, (_, i) => Math.abs(i - goal) * 2)
    const g: RaceGraph = { pos, edgeStart, edgeTo: Int32Array.from(to), edgeCost: Float32Array.from(cost), goals: Int32Array.from([20, 0]), fields: [field(20), field(0)], starts: Int32Array.from([13]) }
    const r = newRun(ms, 'race', [0, 0, 0])
    const ids = targets(r).map((p) => p.id)
    const bots = new RaceBots(g, ids, 1, [13])
    expect(bots.bots[0].at[0]).toBe(6)
    bots.step(1, r)
    expect(bots.bots[0].at[0]).toBe(6) // the clock hasn't started
    stepRun(r, [0.5, 0, 0], 0)
    let taken = false
    for (let k = 0; k < 40 && !taken; k++) { bots.step(0.1, r); taken = stepBot(r, 1, bots.bots[0].at, k).length > 0 }
    expect(taken).toBe(true)
    expect(targets(r).find((p) => p.weapon === 'ak47')!.by).toBe(1)
    expect(bots.bots[0].heading).toBeCloseTo(-Math.PI / 2) // facing +X
    // Then it turns round for the other one.
    for (let k = 0; k < 10; k++) bots.step(0.1, r)
    expect(bots.bots[0].at[0]).toBeLessThan(18)
  })
})
