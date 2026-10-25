// Map health state: the last report, whether a check is running, and which
// overlay the 3D view shows. Kept apart from the editor store; the report
// is not saved with the map (it is quick to make again).
import { create } from 'zustand'
import { useEditor } from './store'
import type { Viewer } from './Viewer'
import { analysisKey } from '../lib/analysis/collision'
import { analyzeProject, cancelAnalysis } from '../lib/analysis/client'
import type { HealthReport } from '../lib/analysis/types'
import { buildOverlay, type Overlay, type OverlayKind } from './healthOverlay'
import { textureBudget } from '../lib/textureBudget'
import { db } from '../lib/db'

export type { OverlayKind }

interface HealthState {
  report: HealthReport | null
  /** analysisKey of the map the report is about. */
  key: string
  projectId: string
  running: boolean
  progress: { text: string; done: number } | null
  error: string | null
  overlay: OverlayKind
  /** Spawn (by its number) whose sight lines the overlay draws. */
  focus: number | null
  ms: number
}

export const useHealth = create<HealthState>(() => ({
  report: null, key: '', projectId: '', running: false, progress: null, error: null, overlay: 'off', focus: null, ms: 0,
}))

/** True when the map changed since the report was made. */
export function useHealthStale(): boolean {
  const project = useEditor((s) => s.project)
  const key = useHealth((s) => s.key)
  const has = useHealth((s) => !!s.report)
  return has && !!project && analysisKey(project) !== key
}

export async function runHealthCheck(overlay?: OverlayKind) {
  const project = useEditor.getState().project
  if (!project || useHealth.getState().running) return
  const started = performance.now()
  useHealth.setState({ running: true, error: null, progress: { text: 'Reading the map', done: 0 } })
  try {
    const report = await analyzeProject(project, { onProgress: (text, done) => useHealth.setState({ progress: { text, done } }) })
    // Its textures as the exporter will store them: a map whose textures don't fit the game's memory loads black.
    const tex = await textureBudget(project, pictureSize).catch(() => null)
    if (tex) {
      report.textures = tex
      if (tex.over) {
        report.findings.unshift(`Textures come to about ${tex.mb} MB (${tex.pictures} different pictures): the biggest map known to load has about 25 MB, and past that the game may load none of them, leaving the map black. Use fewer different textures, or a smaller area.`)
        report.score = Math.min(report.score, 20)
      }
    }
    useHealth.setState((s) => ({
      report, key: analysisKey(project), projectId: project.id, running: false, progress: null, ms: Math.round(performance.now() - started),
      overlay: overlay ?? (s.overlay === 'off' ? 'sight' : s.overlay), focus: null,
    }))
  } catch (err) {
    useHealth.setState({ running: false, progress: null, error: (err as Error).message })
  }
}

const sizes = new Map<string, Promise<[number, number] | null>>()
/** A stored picture's width and height (read once per tab). */
function pictureSize(hash: string): Promise<[number, number] | null> {
  let p = sizes.get(hash)
  if (!p) {
    p = (async () => {
      const blob = await db.getBlob(hash)
      if (!blob) return null
      const bmp = await createImageBitmap(blob)
      const wh: [number, number] = [bmp.width, bmp.height]
      bmp.close()
      return wh
    })().catch(() => null)
    sizes.set(hash, p)
  }
  return p
}

export function stopHealthCheck() {
  cancelAnalysis()
  useHealth.setState({ running: false, progress: null })
}

/** Keeps the viewer's overlay in step with the report and the chosen overlay. Returns a function that detaches it. */
export function attachHealthOverlay(viewer: Viewer): () => void {
  let shown: Overlay | null = null
  let last: unknown[] = []
  const sync = () => {
    const h = useHealth.getState()
    const project = useEditor.getState().project
    // Another map opened: its report is gone.
    if (h.report && project && h.projectId !== project.id) { useHealth.setState({ report: null, key: '', overlay: 'off', focus: null }); return }
    const want = [h.report, h.overlay, h.focus]
    if (want.every((v, i) => v === last[i])) return
    last = want
    shown?.dispose()
    shown = h.report && h.overlay !== 'off' ? buildOverlay(h.report, h.overlay, h.focus) : null
    viewer.setOverlay(shown?.object ?? null)
  }
  sync()
  const a = useHealth.subscribe(sync)
  const b = useEditor.subscribe((s, prev) => { if (s.project?.id !== prev.project?.id) sync() })
  return () => { a(); b(); shown?.dispose(); viewer.setOverlay(null) }
}
