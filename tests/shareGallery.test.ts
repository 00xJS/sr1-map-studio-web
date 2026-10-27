// Play links grown up: how models were made (the gallery rule), link metadata,
// time-trial ghosts and their checks, and racing bots.
import { describe, expect, it } from 'vitest'
import type { RaceGraph } from '../src/lib/analysis/analysis.worker'
import { newMarker, newProject, type Marker, type Vec3 } from '../src/lib/project'
import { SPRINT_SPEED } from '../src/lib/player'
import { RaceBots } from '../src/play/bots'
import { madeKind } from '../src/play/makeShare'
import { availableRuns, newRun, raceScores, stepBot, stepRun, targets } from '../src/play/game'
import { GHOST_MAX, GhostRecorder, checkTime, cleanName, ghostAt, loadGhost, saveGhost, type GhostSample } from '../src/play/ghost'
import { cleanObj, galleryReady, shareMeta, validateShareDoc, type ShareDoc } from '../src/play/share'

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
