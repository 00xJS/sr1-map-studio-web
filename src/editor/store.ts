// Editor state: the open project, selection, view options and undo history.
// Changes autosave to IndexedDB shortly after they happen.
import { create } from 'zustand'
import { produce, type Draft } from 'immer'
import { db } from '../lib/db'
import type { Project } from '../lib/project'

export type Selection = { kind: 'item' | 'marker' | 'light'; index: number } | null
export type GizmoMode = 'translate' | 'rotate' | 'scale'
export type PlaceMode = null | 'marker' | 'light' | 'face' | 'decal'
/** Paint-style tools: 'select' shows the gizmo; the others act on every click in the viewport. */
export type Tool = 'select' | 'shape' | 'paint' | 'pick' | 'spawn' | 'weapon' | 'light' | 'erase' | 'sculpt' | 'road'

/** A texture the paint bucket applies: generated, from the starter library, or a file already in the map. */
export interface Swatch {
  key: string
  label: string
  surface: number
  source: { kind: 'generated'; params: import('../lib/procedural').GenParams } | { kind: 'library'; id: string } | { kind: 'file'; vpath: string }
}
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error'

interface HistoryEntry { project: Project; label: string; merge?: string }

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
  tab: string
  /** Advanced mode shows every setting in tabs; simple mode one panel for what's selected. */
  advanced: boolean
  /** Desktop-style free camera instead of orbiting. */
  freeCam: boolean
  open(project: Project): void
  close(): void
  update(label: string, recipe: (d: Draft<Project>) => void, opts?: { merge?: string }): void
  undo(): void
  redo(): void
  select(s: Selection): void
  /** Shift+click: add an object (and its group) to the selection, or take it out. */
  toggleItem(index: number): void
  selectItems(indices: number[]): void
  set(partial: Partial<EditorState>): void
  log(text: string): void
}

const LIMIT = 150

export function readFlag(key: string) { try { return localStorage.getItem(key) === '1' } catch { return false } }
export function writeFlag(key: string, on: boolean) { try { localStorage.setItem(key, on ? '1' : '0') } catch { /* private window */ } }
let lastMerge: { key: string; at: number } | null = null
/** End the current merged edit (e.g. when a gizmo drag is released). */
export const breakMerge = () => { lastMerge = null }

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
  tab: 'scene',
  advanced: readFlag('sr1-advanced'),
  freeCam: readFlag('sr1-freecam'),
  open(project) {
    set({ project, selection: null, multi: [], lastItem: -1, past: [], future: [], saveState: 'saved', placeMode: null, tool: 'select', logs: [] })
  },
  close() { set({ project: null, selection: null, multi: [], past: [], future: [] }) },
  update(label, recipe, opts) {
    const cur = get().project
    if (!cur) return
    const next = produce(cur, recipe)
    if (next === cur) return
    const now = performance.now()
    // Consecutive edits with the same merge key (a gizmo drag, typing in a
    // field) become one undo step.
    const merging = opts?.merge && lastMerge && lastMerge.key === opts.merge && now - lastMerge.at < 1500
    lastMerge = opts?.merge ? { key: opts.merge, at: now } : null
    const past = merging ? get().past : [...get().past, { project: cur, label }].slice(-LIMIT)
    set({ project: next, past, future: [], saveState: 'unsaved' })
  },
  undo() {
    const { past, project, future } = get()
    const prev = past[past.length - 1]
    if (!prev || !project) return
    lastMerge = null
    set({ project: prev.project, multi: keepIn(get().multi, prev.project), past: past.slice(0, -1), future: [{ project, label: prev.label }, ...future], saveState: 'unsaved' })
    get().log('Undo: ' + prev.label)
  },
  redo() {
    const { past, project, future } = get()
    const next = future[0]
    if (!next || !project) return
    lastMerge = null
    set({ project: next.project, multi: keepIn(get().multi, next.project), future: future.slice(1), past: [...past, { project, label: next.label }], saveState: 'unsaved' })
    get().log('Redo: ' + next.label)
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

const keepIn = (multi: number[], p: Project) => { const m = multi.filter((i) => i < p.scene_items.length); return m.length > 1 ? m : [] }

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
  if (s.advanced !== prev.advanced) writeFlag('sr1-advanced', s.advanced)
  if (s.freeCam !== prev.freeCam) writeFlag('sr1-freecam', s.freeCam)
})

if (import.meta.env.DEV) (globalThis as any).__editor = useEditor
