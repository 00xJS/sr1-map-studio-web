// Editor state: the open project, selection, view options and undo history.
// Changes autosave to IndexedDB shortly after they happen.
import { create } from 'zustand'
import { produce, type Draft } from 'immer'
import { db } from '../lib/db'
import type { Project } from '../lib/project'

export type Selection = { kind: 'item' | 'marker' | 'light'; index: number } | null
export type GizmoMode = 'translate' | 'rotate' | 'scale'
export type PlaceMode = null | 'marker' | 'light' | 'face'
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error'

interface HistoryEntry { project: Project; label: string; merge?: string }

interface EditorState {
  project: Project | null
  selection: Selection
  lastItem: number
  past: HistoryEntry[]
  future: HistoryEntry[]
  saveState: SaveState
  gizmo: GizmoMode
  step: number
  wireframe: boolean
  collisionView: 'off' | 'faces'
  soloMaterial: string | null
  placeMode: PlaceMode
  placeMarkerType: string
  faceRange: [number, number]
  logs: string[]
  tab: string
  open(project: Project): void
  close(): void
  update(label: string, recipe: (d: Draft<Project>) => void, opts?: { merge?: string }): void
  undo(): void
  redo(): void
  select(s: Selection): void
  set(partial: Partial<EditorState>): void
  log(text: string): void
}

const LIMIT = 150
let lastMerge: { key: string; at: number } | null = null
/** End the current merged edit (e.g. when a gizmo drag is released). */
export const breakMerge = () => { lastMerge = null }

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  selection: null,
  lastItem: -1,
  past: [],
  future: [],
  saveState: 'saved',
  gizmo: 'translate',
  step: 0.5,
  wireframe: false,
  collisionView: 'off',
  soloMaterial: null,
  placeMode: null,
  placeMarkerType: 'Shared spawn',
  faceRange: [0, 0],
  logs: [],
  tab: 'scene',
  open(project) {
    set({ project, selection: null, lastItem: -1, past: [], future: [], saveState: 'saved', placeMode: null, logs: [] })
  },
  close() { set({ project: null, selection: null, past: [], future: [] }) },
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
    set({ project: prev.project, past: past.slice(0, -1), future: [{ project, label: prev.label }, ...future], saveState: 'unsaved' })
    get().log('Undo: ' + prev.label)
  },
  redo() {
    const { past, project, future } = get()
    const next = future[0]
    if (!next || !project) return
    lastMerge = null
    set({ project: next.project, future: future.slice(1), past: [...past, { project, label: next.label }], saveState: 'unsaved' })
    get().log('Redo: ' + next.label)
  },
  select(selection) { set(selection?.kind === 'item' ? { selection, lastItem: selection.index } : { selection }) },
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
