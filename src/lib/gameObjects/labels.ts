// The player's own labels for models from their game ("Check game pieces"): what a model really is when the rules
// got it wrong (a light rig called a building, a wall panel called a prop), which settings it suits, that it was
// checked and is right, and, for buildings, how solid it is at eye height once measured. Kept in this browser with
// the library (never uploaded); the new map wizard picks by them, on top of identify().
import { create } from 'zustand'
import { openDb } from '../db'
import type { WizardSetting } from '../mapWizard'
import type { GameObjectEntry } from './indexer'
import { identify, type GameIdentity, type GameRole, type PropKind } from './identity'

export interface GameLabel {
  /** Checked by the player and right as it is. */
  ok?: boolean
  role?: GameRole
  kind?: PropKind
  settings?: WizardSetting[]
  /** Buildings: share of the model solid at eye height, seen side-on (wizardBuild.ts eyeCover). */
  cover?: number
}

export type GameLabels = Record<string, GameLabel>

const KEY = 'gameObjects:labels'

interface LabelsState {
  labels: GameLabels
  /** Bumped on every change, so what is worked out from the labels is worked out again. */
  version: number
  loaded: boolean
}

export const useGameLabels = create<LabelsState>(() => ({ labels: {}, version: 0, loaded: false }))

const req = <T>(r: IDBRequest<T>) => new Promise<T>((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
const store = async (mode: IDBTransactionMode) => (await openDb()).transaction('meta', mode).objectStore('meta')

let loading: Promise<GameLabels> | null = null

/** The stored labels (read once per tab). */
export function loadLabels(): Promise<GameLabels> {
  return (loading ??= (async () => {
    let labels: GameLabels = {}
    try { labels = (await req((await store('readonly')).get(KEY)) as GameLabels | undefined) ?? {} } catch { /* storage blocked: this tab only */ }
    useGameLabels.setState((s) => ({ labels: { ...labels, ...s.labels }, version: s.version + 1, loaded: true }))
    return useGameLabels.getState().labels
  })())
}

/** Changes some models' labels (undefined fields are cleared; null removes a label) and keeps them. */
export async function setLabels(patch: Record<string, GameLabel | null>) {
  const labels = { ...useGameLabels.getState().labels }
  for (const [id, l] of Object.entries(patch)) {
    if (l === null) { delete labels[id]; continue }
    const next = Object.fromEntries(Object.entries({ ...labels[id], ...l }).filter(([, v]) => v !== undefined)) as GameLabel
    if (Object.keys(next).length) labels[id] = next
    else delete labels[id]
  }
  useGameLabels.setState((s) => ({ labels, version: s.version + 1, loaded: true }))
  try { await req((await store('readwrite')).put(labels, KEY)) } catch { /* storage blocked: this tab only */ }
}

/** identify() with the player's labels on top. */
export function withLabels(labels: GameLabels, base: (e: GameObjectEntry) => GameIdentity = identify): (e: GameObjectEntry) => GameIdentity {
  return (e) => {
    const id = base(e)
    const l = labels[e.id]
    if (!l || (!l.role && !l.kind && !l.settings)) return id
    const role = l.role ?? id.role
    const out: GameIdentity = { ...id, role, ...(l.settings ? { settings: l.settings } : {}) }
    if (role === 'prop') out.kind = l.kind ?? id.kind ?? 'clutter'
    else delete out.kind
    if (role === 'building' && !out.building) {
      const [w, d, h] = e.size
      out.building = { footprint: [Math.max(w, d), Math.min(w, d)], height: h, storeys: Math.max(1, Math.round(h / 3.5)) }
    } else if (role !== 'building') delete out.building
    return out
  }
}
