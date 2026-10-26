// The player's own labels for models from their game ("Check game pieces"): what a model really is when the rules
// got it wrong (a light rig called a building, a wall panel called a prop), which settings it suits, that it was
// checked and is right, for buildings how solid it is at eye height once measured, and corrections to its
// placement rule (on a wall, not the ground; never without its base). Also the player's corrections to the city's
// groups and modules (cityModules.ts). Kept in this browser with the library (never uploaded); the new map wizard
// picks by them, on top of identify(), placementOf(), groups() and cityModules().
import { create } from 'zustand'
import { openDb } from '../db'
import type { WizardSetting } from '../mapWizard'
import type { GameObjectEntry } from './indexer'
import { identify, type GameIdentity, type GameRole, type PropKind } from './identity'
import { placementOf, type PlacementRule, type Side } from './cityModules'
import type { Library } from './placement'

export interface GameLabel {
  /** Checked by the player and right as it is. */
  ok?: boolean
  role?: GameRole
  kind?: PropKind
  settings?: WizardSetting[]
  /** Buildings: share of the model solid at eye height, seen side-on (wizardBuild.ts eyeCover). */
  cover?: number
  /** What it is to look at, and how it is put together, when the catalogue got it wrong (catalog.ts). */
  form?: import('./catalog').Form
  structure?: import('./catalog').Structure
  /** Corrections to its placement rule: each field set replaces the rules' (null clears it). */
  place?: PlacementFix
}

/** Corrections to a placement rule; `ok`: checked and right as the rules have it. */
export interface PlacementFix {
  ok?: boolean
  attach?: PlacementRule['attach']
  facing?: Side | null
  needs?: string[]
  onlyOn?: string[]
  clearFront?: number | null
  reach?: PlacementRule['reach'] | null
  mayVary?: PlacementRule['mayVary']
  coverHeight?: number | null
  seeThrough?: boolean | null
  mountHeight?: number | null
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

/** placementOf() with the player's corrections on top. */
export function withPlacementLabels(labels: GameLabels, base: (e: GameObjectEntry, lib?: Library) => PlacementRule = placementOf): (e: GameObjectEntry, lib?: Library) => PlacementRule {
  return (e, lib) => {
    const rule = base(e, lib)
    const fix = labels[e.id]?.place
    return fix ? fixRule(rule, fix) : rule
  }
}

/** A rule with corrections applied (a list left empty and a null clear the rules' answer). */
export function fixRule(rule: PlacementRule, fix: PlacementFix): PlacementRule {
  const out: PlacementRule = { ...rule }
  for (const [k, v] of Object.entries(fix) as [keyof PlacementFix, unknown][]) {
    if (k === 'ok' || v === undefined) continue
    const key = k as keyof PlacementRule
    if (v === null || (Array.isArray(v) && !v.length && key !== 'mayVary')) delete out[key]
    else (out as unknown as Record<string, unknown>)[key] = v
  }
  return out
}

// ---------------- groups and modules ----------------

/** The player's correction to one of the city's groups or modules. */
export interface CityLabel {
  /** Checked and right as it is. */
  ok?: boolean
  /** Wrong: never build with it. */
  drop?: boolean
  name?: string
  kind?: string
  settings?: WizardSetting[]
  note?: string
}

export interface CityLabels { groups: Record<string, CityLabel>; modules: Record<string, CityLabel> }

const CITY_KEY = 'gameObjects:cityLabels'

export const useCityLabels = create<CityLabels & { version: number }>(() => ({ groups: {}, modules: {}, version: 0 }))

let cityLoading: Promise<CityLabels> | null = null

/** The stored corrections to groups and modules (read once per tab). */
export function loadCityLabels(): Promise<CityLabels> {
  return (cityLoading ??= (async () => {
    let stored: Partial<CityLabels> = {}
    try { stored = (await req((await store('readonly')).get(CITY_KEY)) as Partial<CityLabels> | undefined) ?? {} } catch { /* storage blocked: this tab only */ }
    useCityLabels.setState((s) => ({ groups: { ...stored.groups, ...s.groups }, modules: { ...stored.modules, ...s.modules }, version: s.version + 1 }))
    const { groups, modules } = useCityLabels.getState()
    return { groups, modules }
  })())
}

/** Changes the corrections to some groups or modules (undefined fields are cleared; null removes one) and keeps them. */
export async function setCityLabels(which: keyof CityLabels, patch: Record<string, CityLabel | null>) {
  const now = useCityLabels.getState()
  const list = { ...now[which] }
  for (const [id, l] of Object.entries(patch)) {
    if (l === null) { delete list[id]; continue }
    const next = Object.fromEntries(Object.entries({ ...list[id], ...l }).filter(([, v]) => v !== undefined)) as CityLabel
    if (Object.keys(next).length) list[id] = next
    else delete list[id]
  }
  useCityLabels.setState((s) => ({ ...s, [which]: list, version: s.version + 1 }))
  const { groups, modules } = useCityLabels.getState()
  try { await req((await store('readwrite')).put({ groups, modules }, CITY_KEY)) } catch { /* storage blocked: this tab only */ }
}

/** Groups or modules with the player's corrections: the ones marked wrong left out, names, kinds and settings fixed. */
export function withCityLabels<T extends { id: string; name: string; kind: string; settings: WizardSetting[] }>(items: T[], labels: Record<string, CityLabel>): T[] {
  return items.flatMap((x) => {
    const l = labels[x.id]
    if (!l) return [x]
    if (l.drop) return []
    return [{ ...x, ...(l.name ? { name: l.name } : {}), ...(l.kind ? { kind: l.kind } : {}), ...(l.settings ? { settings: l.settings } : {}) }]
  })
}
