// Saved camera views, per map: up to nine places to look from (Alt+1 … 9 or Shift+1 … 9 goes to one). They're kept in this
// browser under the map's id, not in the map: a view isn't part of the map, and saving one isn't an undo step.
import { create } from 'zustand'
import { useEditor } from './store'
import type { CameraView } from './viewer/camera'
import { getViewer } from './Viewport'

export interface SavedView { name: string; view: CameraView }
export const MAX_VIEWS = 9

const key = (mapId: string) => 'sr1-views:' + mapId

/** The map's saved views (none when storage is off or holds something else). */
export function loadViews(mapId: string): SavedView[] {
  try {
    const list = JSON.parse(localStorage.getItem(key(mapId)) ?? '[]')
    return Array.isArray(list) ? list.filter((v) => v && typeof v.name === 'string' && v.view && Array.isArray(v.view.target)).slice(0, MAX_VIEWS) : []
  } catch { return [] }
}

function storeViews(mapId: string, views: SavedView[]) {
  try { if (views.length) localStorage.setItem(key(mapId), JSON.stringify(views)); else localStorage.removeItem(key(mapId)) } catch { /* private window */ }
}

/** The list with `view` added at the end, named "View n" (the first free number) unless named; the oldest goes when
 *  it's full. */
export function withView(list: SavedView[], view: CameraView, name?: string): SavedView[] {
  let n = 1
  while (list.some((v) => v.name === `View ${n}`)) n++
  return [...list, { name: name?.trim() || `View ${n}`, view }].slice(-MAX_VIEWS)
}

interface ViewsState { mapId: string | null; views: SavedView[]; open: boolean }
/** The open map's saved views, and whether their list is showing. */
export const useSavedViews = create<ViewsState>(() => ({ mapId: null, views: [], open: false }))

function setViews(views: SavedView[]) {
  const { mapId } = useSavedViews.getState()
  if (!mapId) return
  storeViews(mapId, views)
  useSavedViews.setState({ views })
}

// Each map brings its own views.
useEditor.subscribe((s) => {
  const id = s.project?.id ?? null
  if (id !== useSavedViews.getState().mapId) useSavedViews.setState({ mapId: id, views: id ? loadViews(id) : [] })
})

/** Saves where the camera is now; returns its name. */
export function saveView(view: CameraView, name?: string): string {
  const views = withView(useSavedViews.getState().views, view, name)
  setViews(views)
  return views[views.length - 1].name
}

export function removeView(i: number) { setViews(useSavedViews.getState().views.filter((_, k) => k !== i)) }

/** Looks from saved view `i` again (switching the plan view to match); false when there's no such view. */
export function goToView(i: number): boolean {
  const v = useSavedViews.getState().views[i]
  const viewer = getViewer()
  if (!v || !viewer) return false
  useEditor.getState().set({ plan: v.view.plan })
  viewer.setCameraView(v.view)
  return true
}

/** Saves the editor camera's view now; returns its name, or null with no viewer. */
export function saveCurrentView(): string | null {
  const viewer = getViewer()
  return viewer ? saveView(viewer.cameraView()) : null
}
