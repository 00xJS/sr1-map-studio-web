// The map wizard's worker from the page's side (wizard.worker.ts): one worker building one map at a time. The newest
// request wins: one waiting to be sent when a newer comes in is dropped (its promise rejects as superseded), so
// dragging the busy slider builds the last step, not every one. The player's game library goes over only when it
// changes. Where a worker can't start, or stops with an error, the map is built here instead (wizardJob.ts), the
// same build.
import type { WizardOptions } from './mapWizard'
import type { WizardReply, WizardRequest } from './wizard.worker'
import { buildWizard, type CityInfo, type GameLibrary } from './wizardJob'
import type { Sample } from './sampleKit'

export type { CityInfo, GameLibrary }

type Built = { sample: Sample; city?: CityInfo }
interface Job { o: WizardOptions; game: GameLibrary | null; resolve: (r: Built) => void; reject: (e: Error) => void }

let worker: Worker | null | undefined
let sentKey = ''
let nextId = 1
/** The request the worker is building, and the newest one waiting for it. */
let running: (Job & { id: number }) | null = null
let queued: Job | null = null

/** Rejects a request a newer one replaced. */
export class Superseded extends Error { constructor() { super('A newer map was asked for') } }
export const isSuperseded = (e: unknown) => e instanceof Superseded

/** Builds on the main thread, a tick later (the worker's stand-in). */
const here = (j: Job) => setTimeout(() => { try { j.resolve(buildWizard(j.o, j.game)) } catch (e) { j.reject(e instanceof Error ? e : new Error(String(e))) } })

function start(): Worker | null {
  if (worker !== undefined) return worker
  try {
    const w = new Worker(new URL('./wizard.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WizardReply>) => {
      const m = e.data, j = running
      if (!j || j.id !== m.id) return
      running = null
      if (m.kind === 'built') j.resolve({ sample: m.sample, city: m.city })
      else j.reject(new Error(m.message))
      next()
    }
    // A worker that can't load (or dies) is dropped for good: what it had, and everything after, is built here.
    w.onerror = () => {
      w.terminate()
      worker = null
      const left = [running, queued].filter((j): j is Job => !!j)
      running = queued = null
      left.forEach(here)
    }
    worker = w
  } catch {
    worker = null
  }
  return worker
}

/** Sends the waiting request, once the worker is free. */
function next() {
  const w = worker
  if (running || !queued) return
  const j = queued
  queued = null
  if (!w) { here(j); return }
  if (j.game && j.game.key !== sentKey) {
    sentKey = j.game.key
    w.postMessage({ kind: 'library', lib: j.game } satisfies WizardRequest)
  }
  running = { ...j, id: nextId++ }
  w.postMessage({ kind: 'build', id: running.id, o: j.o, game: !!j.game } satisfies WizardRequest)
}

/** A map from the wizard's choices, built off the main thread; `game` with the player's library, when given. */
export function wizardBuild(o: WizardOptions, game: GameLibrary | null): Promise<Built> {
  return new Promise((resolve, reject) => {
    const job: Job = { o, game, resolve, reject }
    if (!start()) { here(job); return }
    queued?.reject(new Superseded())
    queued = job
    next()
  })
}

/** The Start dialog's quality gate: a map scoring this or more passes; under it, up to TRIES seeds are tried (the first included). */
export const PASS = 80, TRIES = 5

/** Seeds tried after `seed` when a map scores under the bar: the same every time for the same first seed. */
export function nextSeeds(seed: number, n: number): number[] {
  const out: number[] = []
  let h = seed >>> 0
  for (let i = 0; i < n; i++) { h = (Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0; out.push(h >>> 1) }
  return out
}

/** The health score as a school grade. */
export function grade(score: number): 'A' | 'B' | 'C' | 'D' | 'E' {
  return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 55 ? 'D' : 'E'
}
