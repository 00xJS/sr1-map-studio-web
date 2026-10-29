// Editor state: the open project, selection, view options and undo history.
// Changes autosave to IndexedDB shortly after they happen.
import { create } from 'zustand'
import { produce, type Draft } from 'immer'
import { db } from '../lib/db'
import { uid, type Project } from '../lib/project'
import { centreOf, mirrorEdit, mirrorSession, type Centre, type MirrorSession } from '../lib/mirrorEdit'

export type Selection = { kind: 'item' | 'marker' | 'light'; index: number } | null
export type GizmoMode = 'translate' | 'rotate' | 'scale'
export type PlaceMode = null | 'marker' | 'light' | 'face' | 'decal'
/** Paint-style tools: 'select' shows the gizmo; the others act on every click in the viewport. */
export type Tool = 'select' | 'shape' | 'paint' | 'pick' | 'spawn' | 'weapon' | 'light' | 'erase' | 'sculpt' | 'road' | 'measure'

/** A texture the paint bucket applies: generated, from the starter library, or a file already in the map. */
export interface Swatch {
  key: string
  label: string
  surface: number
  source: { kind: 'generated'; params: import('../lib/procedural').GenParams } | { kind: 'library'; id: string } | { kind: 'file'; vpath: string }
}
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error'
export type SideTab = 'build' | 'check' | 'game' | 'ship'

export interface HistoryEntry { project: Project; label: string; merge?: string }

interface EditorState {
  project: Project | null
  selection: Selection
  /** Several objects selected together (indices into scene_items); empty for a single selection. */
  multi: number[]
  lastItem: number
  past: HistoryEntry[]
  future: HistoryEntry[]
  saveState: SaveState
  gizmo: GizmoMode
  step: number
  /** Gizmo moves in `step` units and rotates in 15° steps. */
  snap: boolean
  /** Walking the map at player height (the walk-through). */
  walking: boolean
  /** The Shape tool's turn for the next piece placed, degrees (R / Shift+R). */
  placeRot: number
  wireframe: boolean
  collisionView: 'off' | 'faces'
  soloMaterial: string | null
  placeMode: PlaceMode
  tool: Tool
  toolShape: string
  toolSpawn: string
  toolWeapon: string
  swatch: Swatch | null
  placeMarkerType: string
  faceRange: [number, number]
  logs: string[]
  /** The side panel's tab. */
  tab: SideTab
  /** "Show all settings": every "More settings" disclosure starts open, and the build log shows. */
  allSettings: boolean
  /** Desktop-style free camera instead of orbiting. */
  freeCam: boolean
  /** Plan view: the map from straight above, flat (orthographic), sliding and zooming but not turning. */
  plan: boolean
  /** The view only: the site's own surfaces drawn layered like retail's (even base tile, grime, tint mask). */
  layeredLook: boolean
  /** Mirror mode: every edit is copied across the middle (lib/mirrorEdit.ts), in the same undo step. */
  mirror: boolean
  open(project: Project): void
  close(): void
  /** One undo step. In mirror mode the edit is copied across the middle too, unless `noMirror` (an edit that already
   *  makes both halves, such as make_symmetric), inside a transaction (Fix all's fixes place what they mean to) or
   *  inside withoutMirror (the AI's edits, a single fix). */
  update(label: string, recipe: (d: Draft<Project>) => void, opts?: { merge?: string; noMirror?: boolean }): void
  undo(): void
  redo(): void
  /** Several undo (negative) or redo (positive) steps at once, as one history move. */
  jumpTo(steps: number): void
  /**
   * Runs `fn` with editing locked (`locked`), and makes every edit it made one undo step called `label` (Fix all).
   * It first waits for the edit job running now; with `wait`, for that many ms at most. Says how it ended: 'ran' (fn
   * ran, maybe stopped partway), 'stopped' (Stop or a map opened before it began) or 'busy' (the wait ran out).
   */
  transaction(label: string, fn: () => Promise<void>, opts?: { wait?: number }): Promise<'ran' | 'stopped' | 'busy'>
  /** Ends the running transaction now, keeping what it did so far as its undo step (the cover's Stop). */
  stopTransaction(): void
  /** What a running transaction is doing: undo, redo and the editor's keys are off, and the editor is covered. */
  locked: string | null
  select(s: Selection): void
  /** Shift+click: add an object (and its group) to the selection, or take it out. */
  toggleItem(index: number): void
  selectItems(indices: number[]): void
  set(partial: Partial<EditorState>): void
  log(text: string): void
}

const LIMIT = 150
interface Txn {
  label: string
  /** The map when its edits began (null while it waits for edit jobs to end). */
  start: Project | null
  /** Its edits have begun: they add no undo steps of their own. */
  started: boolean
  /** Stop, or opening a map, ended it: work it started must not edit after. */
  stopped: boolean
  opens: number
  stop: () => void
}
/** The transaction running now, if any (only one runs at a time). */
let txn: Txn | null = null
/** Maps opened (or closed) so far, the same one again included. */
let opens = 0
/** An edit job running (see editJob); stopped when it ran out of time. */
interface Job { stopped: boolean }
/** The edit job running now, if any (one at a time). */
let job: Job | null = null
/**
 * Async work that edits the map: the map it started on, and the transaction (Fix all's fixes) or edit job it is
 * part of. Only that work calls startRun (fixes, the sky, AI edits), so the job running then is its own.
 */
export interface Run { opens: number; txn: Txn | null; job: Job | null }
/** Where async work starts: check `stillCurrent(run)` after each await before editing. */
export const startRun = (): Run => ({ opens, txn: txn?.started ? txn : null, job })
/** The map alone: for an edit anyone may start (placing a prefab), which must not land on a map opened meanwhile. */
export const mapRun = (): Run => ({ opens, txn: null, job: null })
/** Whether the map `run` started on is still the open one (its job or transaction may have stopped). */
export const onSameMap = (run: Run) => run.opens === opens
/** False once a map was opened (the same one again too) since `run`, or its transaction or job was stopped. */
export const isCurrent = (run: Run) => run.opens === opens && !run.txn?.stopped && !run.job?.stopped
/** Throws unless `isCurrent(run)`. */
export function stillCurrent(run: Run) { if (!isCurrent(run)) throw new MapChanged() }
/** What `stillCurrent` throws: the work was for a map no longer open, or a stopped Fix all, so nothing is wrong (quiet). */
export class MapChanged extends Error {
  readonly quiet = true
  constructor() { super('the map changed meanwhile') }
}
/** How long an edit job may run before the ones after it go ahead without it. */
export const JOB_TIME_LIMIT = 120_000
/** What an edit job that ran out of time rejects with; what it does after that changes nothing. */
export class JobTooLong extends Error {
  constructor(readonly limit: number) { super(`Stopped after ${Math.round(limit / 60_000)} minutes: it was taking too long.`) }
}
/** What a cancelled edit job rejects with (its own Cancel was pressed): nothing to report. */
export class JobCancelled extends Error {
  readonly quiet = true
  constructor() { super('cancelled') }
}
/** Resolves once no transaction holds the editor. */
export function whenUnlocked(): Promise<void> {
  if (!useEditor.getState().locked) return Promise.resolve()
  return new Promise((done) => {
    const off = useEditor.subscribe((s) => { if (!s.locked) { off(); done() } })
  })
}

/** The open map's edit jobs: `last` ends when the last one queued ends, `running` when the one running now does. */
interface JobQueue { last: Promise<void>; running: Promise<void> | null }
const newQueue = (): JobQueue => ({ last: Promise.resolve(), running: null })
let jobs = newQueue()
/**
 * Runs `fn`, an edit job that runs alongside the user (AI edits, the stair ramps a game-pieces map gets), in turn:
 * one job at a time, never at the same time as a transaction. Jobs wait for the one before them and for a
 * transaction to end; a transaction waits for the job running when it begins (queued ones wait for it). So no job's
 * edits land in another's undo step, nor in Fix all's. Each map has its own queue.
 */
export async function editJob<T>(fn: () => Promise<T>, opts: EditJobOptions = {}): Promise<T> {
  const { limit = JOB_TIME_LIMIT, signal, onStop } = opts
  const q = jobs, before = q.last
  let end = () => {}
  const mine = new Promise<void>((r) => { end = r })
  q.last = mine
  // Past its time, or cancelled, the queue moves on; a running job's runs are stopped first (and `onStop` runs then),
  // so a late edit of its changes nothing.
  let me: Job | null = null, fail: (err: Error) => void = () => {}
  const stopped = new Promise<never>((_, no) => { fail = no })
  stopped.catch(() => undefined)
  const stop = (err: Error) => {
    if (me) { if (me.stopped) return; me.stopped = true; onStop?.() }
    fail(err)
  }
  const cancel = () => stop(new JobCancelled())
  signal?.addEventListener('abort', cancel, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (signal?.aborted) throw new JobCancelled()
    await Promise.race([before, stopped])
    while (useEditor.getState().locked) await Promise.race([whenUnlocked(), stopped])
    // Queued on a map that was left meanwhile: its edits were for that map.
    if (q !== jobs) throw new MapChanged()
    me = { stopped: false }
    q.running = mine
    job = me
    timer = setTimeout(() => stop(new JobTooLong(limit)), limit)
    try { return await Promise.race([fn(), stopped]) } finally {
      if (job === me) job = null
      if (q.running === mine) q.running = null
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
    // Cancelled while still queued: the ones after it still wait for the ones before it.
    if (me) end()
    else void before.then(end)
  }
}

export interface EditJobOptions {
  /** How long it may run (JOB_TIME_LIMIT). */
  limit?: number
  /** Cancels it, queued or running. */
  signal?: AbortSignal
  /** Runs the moment a running job is stopped (time or cancel), before the next job begins. */
  onStop?: () => void
}

/** One step back to where `t` started, unless nothing changed or a map was opened since; then the editor is free. */
function endTransaction(t: Txn) {
  txn = null
  const { past, project } = useEditor.getState()
  if (t.started && t.start && project && project !== t.start && t.opens === opens) useEditor.setState({ past: [...past, { project: t.start, label: t.label }].slice(-LIMIT), future: [] })
  useEditor.setState({ locked: null })
  lastMerge = null
}

/** The map is being left: a transaction still running belonged to it and ends, adding no step to the next one. */
function leaveMap() {
  const t = txn
  txn = null
  if (t) t.stopped = true
  lastMerge = null
  mirroring = null
  pinned = null
  opens++
  // Jobs still running belong to the map left: the next map's don't wait for them.
  jobs = newQueue()
  return t
}

export function readFlag(key: string) { try { return localStorage.getItem(key) === '1' } catch { return false } }
export function writeFlag(key: string, on: boolean) { try { localStorage.setItem(key, on ? '1' : '0') } catch { /* private window */ } }
let lastMerge: { key: string; at: number } | null = null
/** End the current merged edit (e.g. when a gizmo drag is released). */
export const breakMerge = () => { lastMerge = null }
/** Mirror mode's pairs for the edit going on (kept through a merged edit such as a gizmo drag). */
let mirroring: MirrorSession | null = null
/** The middle mirror mode turns about, found when it's turned on (at its first edit) and kept until it's turned off
 *  or another map opens: edits it doesn't copy (the AI's, a fix moving spawns) mustn't shift it and break the pairs. */
let pinned: { projectId: string; centre: Centre } | null = null

/** The middle mirror mode turns about on the open map (the one it pinned, else where it would pin it now). */
export function mirrorCentreNow(): Centre | null {
  const p = useEditor.getState().project
  if (!p) return null
  return pinned?.projectId === p.id ? pinned.centre : centreOf(p)
}
/** How deep in withoutMirror calls the code running right now is. */
let unmirrored = 0

/**
 * Runs `fn` with mirror mode's copying off for the edits it makes itself: the ones it makes before it returns, and
 * those of the async edit commands it starts (they note mirrorPaused() as they begin and pass it on, see keepQuiet).
 * Only the call itself: the user's own edits meanwhile, while a job awaits, are mirrored as usual. For edits that make
 * both halves themselves (the AI's "and its twin" placements).
 */
export function withoutMirror<T>(fn: () => T): T {
  unmirrored++
  try { return fn() } finally { unmirrored-- }
}

/** Was this edit command called inside withoutMirror? Async commands ask as they begin, before their first await. */
export const mirrorPaused = () => unmirrored > 0

/** The user's own edits, undos and redos so far (not an AI reply's or a fix's, which say noMirror or run unmirrored). */
let manual = 0
/** Compared before and after an AI reply: unchanged, every step since is the reply's own. */
export const manualEdits = () => manual

/** Runs `fn` inside withoutMirror when `quiet` (what an async command noted with mirrorPaused() as it began). */
export const keepQuiet = <T,>(quiet: boolean, fn: () => T): T => (quiet ? withoutMirror(fn) : fn())

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  selection: null,
  multi: [],
  lastItem: -1,
  past: [],
  future: [],
  saveState: 'saved',
  gizmo: 'translate',
  step: 0.5,
  snap: false,
  walking: false,
  placeRot: 0,
  wireframe: false,
  collisionView: 'off',
  soloMaterial: null,
  placeMode: null,
  tool: 'select',
  toolShape: 'wall',
  toolSpawn: 'Shared spawn',
  toolWeapon: 'ak47',
  swatch: null,
  placeMarkerType: 'Shared spawn',
  faceRange: [0, 0],
  logs: [],
  tab: 'build',
  allSettings: readFlag('sr1-advanced'),
  freeCam: readFlag('sr1-freecam'),
  plan: false,
  layeredLook: readFlag('sr1-layered'),
  mirror: false,
  locked: null,
  open(project) {
    const t = leaveMap()
    set({ project, mirror: false, selection: null, multi: [], lastItem: -1, past: [], future: [], saveState: 'saved', placeMode: null, tool: 'select', logs: [], locked: null })
    t?.stop()
  },
  close() {
    const t = leaveMap()
    set({ project: null, selection: null, multi: [], past: [], future: [], locked: null })
    t?.stop()
  },
  update(label, recipe, opts) {
    const cur = get().project
    if (!cur) return
    let replaced = false
    let next = produce(cur, (d) => {
      const r = recipe(d) as unknown
      // A recipe that hands back a whole new project replaces it as it is (and isn't mirrored).
      if (r !== undefined) { replaced = true; return r as Project }
    })
    if (next === cur) return
    if (!unmirrored && !opts?.noMirror) manual++
    const now = performance.now()
    // Consecutive edits with the same merge key (a gizmo drag, typing in a
    // field) become one undo step.
    const merging = opts?.merge && lastMerge && lastMerge.key === opts.merge && now - lastMerge.at < 1500
    lastMerge = opts?.merge ? { key: opts.merge, at: now } : null
    if (get().mirror && !txn && !unmirrored && !opts?.noMirror && !replaced) {
      // The pairs found at the start of a drag hold for all of it.
      if (pinned?.projectId !== cur.id) pinned = { projectId: cur.id, centre: centreOf(cur) }
      if (!merging || mirroring?.projectId !== cur.id) mirroring = mirrorSession(cur, pinned.centre)
      next = mirrorEdit(cur, next, uid, mirroring)
    }
    // Inside a transaction its edits add no steps of their own: it adds one when it ends.
    const past = merging || txn?.started ? get().past : [...get().past, { project: cur, label }].slice(-LIMIT)
    set({ project: next, ...reanchor(get(), cur, next), past, future: [], saveState: 'unsaved' })
  },
  undo() {
    if (get().locked) return
    const { past, project, future } = get()
    const prev = past[past.length - 1]
    if (!prev || !project) return
    lastMerge = null
    manual++
    set({ project: prev.project, ...reanchor(get(), project, prev.project), past: past.slice(0, -1), future: [{ project, label: prev.label }, ...future], saveState: 'unsaved' })
    get().log('Undo: ' + prev.label)
  },
  redo() {
    if (get().locked) return
    const { past, project, future } = get()
    const next = future[0]
    if (!next || !project) return
    lastMerge = null
    manual++
    set({ project: next.project, ...reanchor(get(), project, next.project), future: future.slice(1), past: [...past, { project, label: next.label }], saveState: 'unsaved' })
    get().log('Redo: ' + next.label)
  },
  jumpTo(steps) {
    let { past, project, future } = get()
    if (!project || !steps || get().locked) return
    const from = project
    lastMerge = null
    manual++
    for (; steps < 0 && past.length; steps++) {
      const prev = past[past.length - 1]
      future = [{ project, label: prev.label }, ...future]
      project = prev.project
      past = past.slice(0, -1)
    }
    for (; steps > 0 && future.length; steps--) {
      const next = future[0]
      past = [...past, { project, label: next.label }]
      project = next.project
      future = future.slice(1)
    }
    set({ project, ...reanchor(get(), from, project), past, future, saveState: 'unsaved' })
  },
  async transaction(label, fn, opts) {
    if (txn) { await fn(); return 'ran' }
    let stop = () => {}
    const stopped = new Promise<void>((r) => { stop = r })
    const mine: Txn = { label, start: null, started: false, stopped: false, opens, stop }
    txn = mine
    lastMerge = null
    // Locked at once (the cover shows, no new edit job starts), then it waits for the jobs already running.
    set({ locked: label })
    // Stop (or opening a map) ends it without waiting for `fn`, which may never finish.
    try {
      if (jobs.running) {
        let timer: ReturnType<typeof setTimeout> | undefined
        const late = opts?.wait === undefined ? null : new Promise<'busy'>((r) => { timer = setTimeout(() => r('busy'), opts.wait) })
        const job = jobs.running
        const how = await Promise.race([job.then(() => 'free' as const), stopped.then(() => 'stopped' as const), ...(late ? [late] : [])])
        clearTimeout(timer)
        if (how === 'busy' && txn === mine) { mine.stopped = true; return 'busy' }
      }
      if (txn !== mine) return 'stopped'
      mine.start = get().project
      mine.started = true
      lastMerge = null
      await Promise.race([fn(), stopped])
      return 'ran'
    } finally { if (txn === mine) endTransaction(mine) }
  },
  stopTransaction() {
    const t = txn
    if (!t) return
    t.stopped = true
    endTransaction(t)
    t.stop()
  },
  select(selection) {
    if (selection?.kind !== 'item') { set({ selection, multi: [] }); return }
    // A grouped object brings its whole group.
    const members = groupOf(get().project, selection.index)
    set({ selection, lastItem: selection.index, multi: members.length > 1 ? members : [] })
  },
  toggleItem(index) {
    const { selection, multi, project } = get()
    if (!project?.scene_items[index]) return
    const current = multi.length ? multi : selection?.kind === 'item' ? [selection.index] : []
    const members = groupOf(project, index)
    const has = current.includes(index)
    const next = has ? current.filter((i) => !members.includes(i)) : [...new Set([...current, ...members])]
    if (!next.length) { set({ selection: null, multi: [] }); return }
    const primary = has ? next[next.length - 1] : index
    set({ selection: { kind: 'item', index: primary }, lastItem: primary, multi: next.length > 1 ? next : [] })
  },
  selectItems(all) {
    const n = get().project?.scene_items.length ?? 0
    const indices = [...new Set(all)].filter((i) => i >= 0 && i < n)
    if (!indices.length) { set({ selection: null, multi: [] }); return }
    const primary = indices[indices.length - 1]
    set({ selection: { kind: 'item', index: primary }, lastItem: primary, multi: indices.length > 1 ? indices : [] })
  },
  set(partial) { set(partial as any) },
  log(text) { set((s) => ({ logs: [...s.logs.slice(-499), text] })) },
}))

// ---------------- autosave ----------------

let timer: ReturnType<typeof setTimeout> | null = null
let thumbProvider: (() => Promise<Blob | null>) | null = null
let lastThumbAt = 0
export const setThumbnailProvider = (fn: (() => Promise<Blob | null>) | null) => { thumbProvider = fn }

export async function saveNow(withThumb = false) {
  const { project } = useEditor.getState()
  if (!project) return
  useEditor.setState({ saveState: 'saving' })
  try {
    const existing = await db.getProject(project.id)
    const updated = { ...project, updated_at: new Date().toISOString() }
    let thumbnail = existing?.thumbnail
    if (thumbProvider && (withThumb || !thumbnail || Date.now() - lastThumbAt > 60000)) {
      thumbnail = (await thumbProvider().catch(() => null)) || thumbnail
      lastThumbAt = Date.now()
    }
    await db.putProject({ id: project.id, name: project.name, updated_at: updated.updated_at, project: updated, thumbnail, cloud: existing?.cloud })
    if (useEditor.getState().project === project) useEditor.setState({ saveState: 'saved' })
  } catch (err) {
    useEditor.setState({ saveState: 'error' })
    useEditor.getState().log('Autosave failed: ' + String(err))
  }
}

useEditor.subscribe((s, prev) => {
  if (!s.project || s.project === prev.project || s.saveState !== 'unsaved') return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; void saveNow() }, 800)
})

export const currentProject = () => useEditor.getState().project

type Anchored = Pick<EditorState, 'selection' | 'multi' | 'lastItem'>
type Listed = { uid?: string }

const listOf = (p: Project, kind: 'item' | 'marker' | 'light'): Listed[] =>
  kind === 'item' ? p.scene_items : kind === 'marker' ? p.markers : p.lights

/** Where the thing at `index` in `from` sits in `to`: found by its uid, so adding, removing or reordering
 * (an edit, an undo, a redo) never leaves the selection on a different thing. -1 when it's gone. A thing
 * rebuilt in place under a new uid keeps its spot when the list didn't change length. */
function follow(from: Listed[], to: Listed[], index: number): number {
  const uid = from[index]?.uid
  if (to[index] && to[index].uid === uid) return index
  if (uid) { const i = to.findIndex((x) => x.uid === uid); if (i >= 0) return i }
  return from.length === to.length && index < to.length ? index : -1
}

/** A merge key for edits to one thing, by its uid: index-based keys would merge edits to two different
 * things once a delete or undo shifts the list. */
export function thingKey(kind: 'item' | 'marker' | 'light', index: number): string {
  const p = useEditor.getState().project
  return `${kind}:${(p && listOf(p, kind)[index]?.uid) ?? '#' + index}`
}

/** The selection, multi-selection and last item carried from one version of the project to the next. */
export function reanchor(s: Anchored, from: Project, to: Project): Anchored {
  if (from === to) return { selection: s.selection, multi: s.multi, lastItem: s.lastItem }
  let selection = s.selection
  if (selection) {
    const i = follow(listOf(from, selection.kind), listOf(to, selection.kind), selection.index)
    selection = i >= 0 ? { kind: selection.kind, index: i } : null
  }
  const multi = s.multi.map((i) => follow(from.scene_items, to.scene_items, i)).filter((i) => i >= 0)
  const lastItem = s.lastItem >= 0 ? follow(from.scene_items, to.scene_items, s.lastItem) : -1
  return { selection, multi: multi.length > 1 ? multi : [], lastItem }
}

/** Indices of the objects in the same group as this one (just this one when it isn't grouped). */
export function groupOf(project: Project | null, index: number): number[] {
  const g = project?.scene_items[index]?.group
  if (!project || !g) return [index]
  return project.scene_items.flatMap((it, i) => (it.group === g ? [i] : []))
}

/** The selected objects: several, one, or none. */
export function selectedItems(): number[] {
  const { multi, selection } = useEditor.getState()
  return multi.length ? multi : selection?.kind === 'item' ? [selection.index] : []
}

useEditor.subscribe((s, prev) => {
  // Turned off (or on again): the next time it's on, it finds the middle afresh.
  if (s.mirror !== prev.mirror) { pinned = null; mirroring = null }
  if (s.allSettings !== prev.allSettings) writeFlag('sr1-advanced', s.allSettings)
  if (s.freeCam !== prev.freeCam) writeFlag('sr1-freecam', s.freeCam)
  if (s.layeredLook !== prev.layeredLook) writeFlag('sr1-layered', s.layeredLook)
})

if (import.meta.env.DEV) (globalThis as any).__editor = useEditor
