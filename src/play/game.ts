// Play mode rules: weapon pickups you walk over, Chains drop-offs to touch,
// and timed runs ("collect every weapon", "touch every drop-off").
// Pure module: positions in editor units (1 unit = 0.5 m), times in ms.
import { catalogs } from '../lib/catalogs'
import type { Marker, Vec3 } from '../lib/project'

export type RunMode = 'roam' | 'weapons' | 'dropoffs'

export const RUN_LABELS: Record<RunMode, string> = {
  roam: 'Free roam',
  weapons: 'Collect every weapon',
  dropoffs: 'Touch every drop-off',
}

/** How close (horizontally) the player's feet must come to a pickup, editor units: about 1.1 m. */
export const PICKUP_RADIUS = 2.2
/** Smallest drop-off zone, editor units (1.5 m across each way). */
export const DROP_RADIUS = 3
/** Feet this far below or above a marker still count as touching it (it sits on the floor). */
const REACH_DOWN = 1.5
const REACH_UP = 3.6
/** The run's clock starts once the player has moved this far from the spawn. */
const START_MOVE = 0.3
/** Weapons come back this long after being picked up in free roam, unless the marker says otherwise. */
const RESPAWN_MS = 10000

export interface Pickup {
  id: string
  kind: 'weapon' | 'dropoff'
  at: Vec3
  label: string
  /** Weapon id (catalog name), for weapon pickups. */
  weapon?: string
  radius: number
  /** Taken in this run (weapons) or touched (drop-offs). */
  taken: boolean
  /** Free roam: when a taken weapon comes back. */
  back?: number
}

export interface RunState {
  mode: RunMode
  pickups: Pickup[]
  /** Where the run began (the spawn). */
  origin: Vec3
  /** When the clock started (the first step away from the spawn), or null. */
  started: number | null
  /** When the last target was reached, or null. */
  finished: number | null
  /** Weapons picked up, first one first, each once. */
  inventory: string[]
  /** The weapon picked up last. */
  current: string | null
}

export type GameEvent =
  | { type: 'weapon'; pickup: Pickup; first: boolean }
  | { type: 'dropoff'; pickup: Pickup; left: number }
  | { type: 'start' }
  | { type: 'finish'; time: number }

const WEAPON_NAMES = new Map(catalogs.weapons.map(([label, id]) => [id.toLowerCase(), label]))

/** "ak47" -> "AK-47"; unknown ids are shown as they are. */
export function weaponName(id: string): string {
  return WEAPON_NAMES.get(id.toLowerCase()) ?? id.replace(/_/g, ' ')
}

/** The map's pickups and drop-offs (disabled-for-export flags don't matter here). */
export function pickupsOf(markers: Marker[]): Pickup[] {
  const out: Pickup[] = []
  for (const m of markers) {
    if (m.type === 'Weapon pickup') {
      const weapon = m.weapon || m.label || 'weapon'
      out.push({ id: m.uid, kind: 'weapon', at: m.position, weapon, label: weaponName(weapon), radius: PICKUP_RADIUS, taken: false })
    } else if (m.type === 'Chains drop-off') {
      out.push({ id: m.uid, kind: 'dropoff', at: m.position, label: m.label || 'Drop-off', radius: Math.max(DROP_RADIUS, (m.radius || 0) * 2), taken: false })
    }
  }
  return out
}

/** Runs this map can offer, with how many targets each has. Free roam is always there. */
export function availableRuns(markers: Marker[]): { mode: RunMode; label: string; count: number }[] {
  const p = pickupsOf(markers)
  const weapons = p.filter((x) => x.kind === 'weapon').length
  const drops = p.filter((x) => x.kind === 'dropoff').length
  const out: { mode: RunMode; label: string; count: number }[] = [{ mode: 'roam', label: RUN_LABELS.roam, count: 0 }]
  if (weapons) out.push({ mode: 'weapons', label: RUN_LABELS.weapons, count: weapons })
  if (drops) out.push({ mode: 'dropoffs', label: RUN_LABELS.dropoffs, count: drops })
  return out
}

export function newRun(markers: Marker[], mode: RunMode, origin: Vec3): RunState {
  return { mode, pickups: pickupsOf(markers), origin, started: null, finished: null, inventory: [], current: null }
}

/** Targets of a timed run (none in free roam). */
export function targets(s: RunState): Pickup[] {
  if (s.mode === 'roam') return []
  return s.pickups.filter((p) => p.kind === (s.mode === 'weapons' ? 'weapon' : 'dropoff'))
}

export function progress(s: RunState): { done: number; total: number } {
  const t = targets(s)
  return { done: t.filter((p) => p.taken).length, total: t.length }
}

/** Milliseconds on the clock at `now`. */
export function elapsed(s: RunState, now: number): number {
  if (s.started === null) return 0
  return (s.finished ?? now) - s.started
}

export function touches(p: Pickup, feet: Vec3): boolean {
  const dy = feet[1] - p.at[1]
  return dy >= -REACH_DOWN && dy <= REACH_UP && Math.hypot(feet[0] - p.at[0], feet[2] - p.at[2]) <= p.radius
}

/** Whether a pickup is on show right now. */
export function visible(p: Pickup, now: number): boolean {
  return p.kind === 'dropoff' || !p.taken || (p.back !== undefined && now >= p.back)
}

/**
 * Advances the run to the player's feet at `now`. Mutates `s` and returns what
 * happened, for the HUD. `respawnMs` overrides how long free-roam weapons stay away.
 */
export function stepRun(s: RunState, feet: Vec3, now: number, respawnMs = RESPAWN_MS): GameEvent[] {
  const events: GameEvent[] = []
  if (s.started === null && s.mode !== 'roam' && Math.hypot(feet[0] - s.origin[0], feet[2] - s.origin[2]) > START_MOVE) {
    s.started = now
    events.push({ type: 'start' })
  }
  for (const p of s.pickups) {
    if (p.kind === 'weapon') {
      // Free roam: weapons come back after a while, as they do in a match.
      if (s.mode === 'roam' && p.taken && p.back !== undefined && now >= p.back) { p.taken = false; p.back = undefined }
      if (p.taken || !touches(p, feet)) continue
      p.taken = true
      if (s.mode === 'roam') p.back = now + respawnMs
      const first = !s.inventory.includes(p.weapon!)
      if (first) s.inventory.push(p.weapon!)
      s.current = p.weapon!
      events.push({ type: 'weapon', pickup: p, first })
    } else {
      // Only a drop-off run keeps score of them.
      if (s.mode !== 'dropoffs' || p.taken || !touches(p, feet)) continue
      p.taken = true
      events.push({ type: 'dropoff', pickup: p, left: targets(s).filter((x) => !x.taken).length })
    }
  }
  if (s.finished === null && s.started !== null && s.mode !== 'roam') {
    const { done, total } = progress(s)
    if (total && done === total) {
      s.finished = now
      events.push({ type: 'finish', time: s.finished - s.started })
    }
  }
  return events
}

/** Free roam: whether the player stands in a drop-off zone (for the HUD). */
export function inDropoff(s: RunState, feet: Vec3): Pickup | null {
  return s.pickups.find((p) => p.kind === 'dropoff' && touches(p, feet)) ?? null
}

/** "1:02.35" */
export function formatTime(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 10))
  const cs = t % 100, s = Math.floor(t / 100) % 60, m = Math.floor(t / 6000)
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

// ---------------- best times ----------------

export interface TimeStore { getItem(k: string): string | null; setItem(k: string, v: string): void }

const bestKey = (map: string, mode: RunMode) => `sr1-play-best:${map}:${mode}`

export function bestTime(store: TimeStore | null, map: string, mode: RunMode): number | null {
  try {
    const v = Number(store?.getItem(bestKey(map, mode)))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch { return null }
}

/** Keeps `time` if it beats the stored best. Returns true for a new record. */
export function recordTime(store: TimeStore | null, map: string, mode: RunMode, time: number): boolean {
  const old = bestTime(store, map, mode)
  if (old !== null && old <= time) return false
  try { store?.setItem(bestKey(map, mode), String(Math.round(time))) } catch { /* storage blocked: no record kept */ }
  return true
}
