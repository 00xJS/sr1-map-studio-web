// Map health state: the last report, whether a check is running, and which
// overlay the 3D view shows. Kept apart from the editor store; the report
// is not saved with the map (it is quick to make again).
import { create } from 'zustand'
import { mirrorCentreNow, useEditor } from './store'
import type { Viewer } from './Viewer'
import { analysisKey } from '../lib/analysis/collision'
import { analyzeProject, cancelAnalysis } from '../lib/analysis/client'
import type { HealthReport } from '../lib/analysis/types'
import { buildOverlay, type Overlay, type OverlayKind } from './healthOverlay'
import { textureBudget } from '../lib/textureBudget'
import { findStairs, scaleRuns } from '../lib/stairRamps'
import { isRamps, solidTriangles } from './stairActions'
import { db } from '../lib/db'
import { findSlivers, type SliverReport } from '../lib/invisibleWalls'

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
  /** Flights and single steps too tall to walk up that have no ramp over them yet. */
  stairs: number
  /** Paper-thin triangles that act as invisible walls in game (lib/invisibleWalls.ts). */
  slivers: SliverReport | null
}

export const useHealth = create<HealthState>(() => ({
  report: null, key: '', projectId: '', running: false, progress: null, error: null, overlay: 'off', focus: null, ms: 0, stairs: 0, slivers: null,
}))

/** Nothing found yet: a new map's state, so one map's findings never show on another. */
const NONE = { report: null, key: '', stairs: 0, slivers: null, overlay: 'off', focus: null, error: null } as const

// Another map opened: what the last check found was about the other one.
useEditor.subscribe((s, prev) => {
  const id = s.project?.id ?? ''
  if (id !== (prev.project?.id ?? '') && useHealth.getState().projectId !== id) useHealth.setState({ ...NONE, projectId: id })
})

/** What the last check found, when it is about the open map (nothing otherwise). */
export function useFindings(): Pick<HealthState, 'report' | 'stairs' | 'slivers'> {
  const id = useEditor((s) => s.project?.id ?? '')
  const mine = useHealth((s) => s.projectId === id)
  const report = useHealth((s) => s.report)
  const stairs = useHealth((s) => s.stairs)
  const slivers = useHealth((s) => s.slivers)
  return mine ? { report, stairs, slivers } : { report: null, stairs: 0, slivers: null }
}

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
    // In mirror mode, the fairness check pairs markers about the middle mirror mode pinned, as the Build tab counts them.
    const centre = useEditor.getState().mirror ? mirrorCentreNow() ?? undefined : undefined
    const report = await analyzeProject(project, { centre, onProgress: (text, done) => useHealth.setState({ progress: { text, done } }) })
    // Its textures as the exporter will store them: a map whose textures don't fit the game's memory loads black.
    // Steps too tall to walk up (a flight, a doorstep, a terrace) that have no invisible ramp yet: players stop at each.
    const solid = await solidTriangles(project).catch(() => null)
    const stairs = solid ? tallSteps(project, solid) : 0
    const slivers = solid ? findSlivers(solid.tris, solid.flags) : null
    const tex = await textureBudget(project, pictureSize).catch(() => null)
    // Another map was opened while it ran: this report is not about it.
    if (useEditor.getState().project?.id !== project.id) { useHealth.setState({ running: false, progress: null }); return }
    if (tex) {
      report.textures = tex
      if (tex.over) {
        report.findings.unshift(`Textures come to about ${tex.mb} MB (${tex.pictures} different pictures): the biggest map known to load has about 25 MB, and past that the game may load none of them, leaving the map black. Use fewer different textures, or a smaller area.`)
        report.score = Math.min(report.score, 20)
      }
    }
    useHealth.setState((s) => ({
      report, key: analysisKey(project), projectId: project.id, running: false, progress: null, ms: Math.round(performance.now() - started), stairs, slivers,
      overlay: overlay ?? (s.overlay === 'off' ? 'sight' : s.overlay), focus: null,
    }))
  } catch (err) {
    useHealth.setState({ running: false, progress: null, error: (err as Error).message })
  }
}

/**
 * Finds the stairs too tall to walk up, or the invisible walls, now, without the whole health check (the Check
 * tab's "Find stairs" and "Find invisible walls"). Returns what it found, or null when another map opened meanwhile.
 */
export async function findNow(what: 'stairs' | 'walls'): Promise<{ stairs?: number; slivers?: SliverReport } | null> {
  const project = useEditor.getState().project
  if (!project) return null
  const solid = await solidTriangles(project)
  if (useEditor.getState().project?.id !== project.id) return null
  const found = what === 'stairs' ? { stairs: tallSteps(project, solid) } : { slivers: findSlivers(solid.tris, solid.flags) }
  const same = useHealth.getState().projectId === project.id
  useHealth.setState({ ...(same ? {} : NONE), projectId: project.id, ...found })
  return found
}

/** How many flights and single steps too tall to walk up the map has without a ramp over them. */
function tallSteps(project: Parameters<typeof solidTriangles>[0], input: Awaited<ReturnType<typeof solidTriangles>>): number {
  const k = (project.settings.world_scale || 0.5) / 0.5
  const runs = scaleRuns(findStairs(k === 1 ? input.tris : input.tris.map((v) => v * k), input.flags), 1 / k)
  // With the map's ramps in place, the steps under them are covered.
  return project.scene_items.some(isRamps) ? 0 : runs.length
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
    if (project && h.projectId !== project.id && (h.report || h.stairs || h.slivers)) { useHealth.setState({ ...NONE, projectId: project.id }); return }
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
