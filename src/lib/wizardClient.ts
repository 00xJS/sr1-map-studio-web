// The map wizard's worker from the page's side (wizard.worker.ts): one worker, the newest request wins (an older one
// still running is answered but dropped), and the player's game library goes over only when it changes. Where a
// worker can't start, the map is built here instead (wizardJob.ts), the same build.
import type { WizardOptions } from './mapWizard'
import type { WizardReply, WizardRequest } from './wizard.worker'
import { buildWizard, type CityInfo, type GameLibrary } from './wizardJob'
import type { Sample } from './sampleKit'

export type { CityInfo, GameLibrary }

let worker: Worker | null | undefined
let sentKey = ''
let nextId = 1
const waiting = new Map<number, { resolve: (r: { sample: Sample; city?: CityInfo }) => void; reject: (e: Error) => void }>()

function start(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('./wizard.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WizardReply>) => {
      const m = e.data, w = waiting.get(m.id)
      if (!w) return
      waiting.delete(m.id)
      if (m.kind === 'built') w.resolve({ sample: m.sample, city: m.city })
      else w.reject(new Error(m.message))
    }
    worker.onerror = () => { for (const w of waiting.values()) w.reject(new Error("The map wizard couldn't run")); waiting.clear() }
  } catch {
    worker = null
  }
  return worker
}

/** A map from the wizard's choices, built off the main thread; `game` with the player's library, when given. */
export function wizardBuild(o: WizardOptions, game: GameLibrary | null): Promise<{ sample: Sample; city?: CityInfo }> {
  const w = start()
  if (!w) return new Promise((resolve) => setTimeout(() => resolve(buildWizard(o, game))))
  if (game && game.key !== sentKey) {
    sentKey = game.key
    w.postMessage({ kind: 'library', lib: game } satisfies WizardRequest)
  }
  const id = nextId++
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    w.postMessage({ kind: 'build', id, o, game: !!game } satisfies WizardRequest)
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
