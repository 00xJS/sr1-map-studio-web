// Export progress with a time estimate. Python reports its stages (py/export_runner.py);
// the editor adds its own before and after. The estimate comes from how long each
// stage took last time on this device, and from the item count inside a stage
// that reports one (textures).

export interface StageInfo { id: string; label: string }

/** Python's stages, in order (same ids as py/export_runner.py STAGES). */
export const PY_STAGES: StageInfo[] = [
  { id: 'check', label: 'Checking the scene' },
  { id: 'geometry', label: 'Building geometry and collision' },
  { id: 'textures', label: 'Encoding textures' },
  { id: 'sidecars', label: 'Writing the city, height map and spawns' },
  { id: 'verify', label: 'Checking the map files' },
  { id: 'package', label: 'Finishing the map files' },
  { id: 'extras', label: 'Adding map extras' },
]

export function exportStages(opts: { boot: boolean; install: boolean }): StageInfo[] {
  return [
    ...(opts.boot ? [{ id: 'boot', label: 'Starting the map builder' }] : []),
    { id: 'prepare', label: 'Preparing files' },
    ...PY_STAGES,
    { id: 'pack', label: 'Packing the map' },
    ...(opts.install ? [{ id: 'install', label: 'Installing into your game' }] : []),
  ]
}

export interface ProgressView {
  label: string
  /** 1-based step number and the number of steps. */
  step: number
  steps: number
  /** "120/382" inside a stage that counts items. */
  detail: string
  /** 0..1 for the progress bar. */
  fraction: number
  elapsed: number
  /** Seconds left, or null before there is anything to go on. */
  remaining: number | null
}

export type StageTimes = Record<string, number>

const STORE = 'sr1ms.exportStageTimes'

export function loadStageTimes(): StageTimes {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}') as StageTimes } catch { return {} }
}

export function saveStageTimes(t: StageTimes) {
  try { localStorage.setItem(STORE, JSON.stringify(t)) } catch { /* private mode: no estimate next time */ }
}

export class ExportTimer {
  private start: number
  private stageStart: number
  private current = 0
  private done: number | null = null
  private total: number | null = null
  private took: StageTimes = {}

  constructor(readonly stages: StageInfo[], private history: StageTimes = {}, private now: () => number = () => performance.now() / 1000) {
    this.start = this.stageStart = now()
  }

  /** Move to a stage (later stages only; skipped stages keep their time from last run for next time). */
  enter(id: string, done: number | null = null, total: number | null = null) {
    const i = this.stages.findIndex((s) => s.id === id)
    if (i < 0) return
    if (i > this.current) {
      const t = this.now()
      this.took[this.stages[this.current].id] = t - this.stageStart
      this.current = i
      this.stageStart = t
    }
    if (i === this.current) { this.done = done; this.total = total }
  }

  /** Waits for something that is not export work (a question to the user); its time is left out. */
  async outside<T>(work: Promise<T>): Promise<T> {
    const t = this.now()
    try { return await work } finally {
      const away = this.now() - t
      this.start += away
      this.stageStart += away
    }
  }

  view(): ProgressView {
    const t = this.now()
    const stage = this.stages[this.current]
    const inStage = t - this.stageStart
    // With no earlier run there is no estimate; a stage that run never reached counts as instant.
    const known = Object.keys(this.history).length > 0
    const last = (id: string) => this.history[id] ?? 0
    let left: number | null
    if (this.done && this.total && this.done <= this.total) left = inStage / this.done * (this.total - this.done)
    else left = known ? Math.max(0, last(stage.id) - inStage) : null
    if (left !== null && known) for (const s of this.stages.slice(this.current + 1)) left += last(s.id)
    else if (!known) left = null
    const elapsed = t - this.start
    const fraction = left !== null && elapsed + left > 0 ? elapsed / (elapsed + left) : this.current / this.stages.length
    return {
      label: stage.label, step: this.current + 1, steps: this.stages.length,
      detail: this.done !== null && this.total ? `${this.done}/${this.total}` : '',
      fraction: Math.min(1, Math.max(0, fraction)), elapsed, remaining: left,
    }
  }

  /** Stage times for next time: this run's, keeping earlier values for stages it never reached. */
  finish(): StageTimes {
    const t = this.now()
    this.took[this.stages[this.current].id] = t - this.stageStart
    return { ...this.history, ...this.took }
  }
}

/** "about 40 s left", "about 2 min left". */
export function formatRemaining(s: number | null): string {
  if (s === null) return ''
  if (s < 5) return 'almost done'
  if (s < 60) return `about ${Math.round(s / 5) * 5} s left`
  return `about ${Math.round(s / 60)} min left`
}

export const formatElapsed = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
