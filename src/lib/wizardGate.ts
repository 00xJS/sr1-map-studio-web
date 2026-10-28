// The Start dialog's quality gate (MapWizard.tsx), pure: a map scoring under the bar is tried again with other seeds,
// and the best kept. A score only counts for the choices it was checked on: the wizard's options (all but the seed
// and the name) and what it was built with (site pieces, or which game library and labels). Anything else, a
// preview finishing after the player changed something, is ignored.
import type { WizardOptions } from './mapWizard'
import { PASS, TRIES, nextSeeds } from './wizardClient'

/** What a score is about: every choice but the seed and the name, and the pieces it was built with. */
export function choicesKey(o: WizardOptions, pieces: string): string {
  const { seed: _s, name: _n, ...rest } = o
  return JSON.stringify([rest, pieces])
}

export interface Gate {
  /** The choices it is for (choicesKey). */
  key: string
  /** The seed the player got (rerolled to, or chose with), and the seeds tried after it. */
  base: number
  scores: [seed: number, health: number][]
  done: boolean
}

export const newGate = (key: string, base: number): Gate => ({ key, base, scores: [], done: false })

/**
 * A check finished for `seed` on choices `key`. Returns the gate after it and the seed to show next (null: stay).
 * A score for other choices, a seed already scored or a gate already done changes nothing; no score (the check
 * couldn't run) ends the gate where it is.
 */
export function scoreGate(g: Gate, key: string, seed: number, health: number | null): { gate: Gate; next: number | null } {
  if (g.done || key !== g.key || g.scores.some(([s]) => s === seed)) return { gate: g, next: null }
  if (health === null) return { gate: { ...g, done: true }, next: null }
  const scores: Gate['scores'] = [...g.scores, [seed, health]]
  if (health >= PASS) return { gate: { ...g, scores, done: true }, next: null }
  if (scores.length < TRIES) return { gate: { ...g, scores }, next: nextSeeds(g.base, TRIES - 1)[scores.length - 1] }
  const best = scores.reduce((a, b) => (b[1] > a[1] ? b : a))
  return { gate: { ...g, scores, done: true }, next: best[0] !== seed ? best[0] : null }
}

/** The gate's score for a map built on `key` with `seed`, if it has one. */
export const gateScore = (g: Gate, key: string, seed: number): number | undefined =>
  g.key === key ? g.scores.find(([s]) => s === seed)?.[1] : undefined
