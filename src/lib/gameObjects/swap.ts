// The object swapper: what else could stand where a placed object stands (a game model, a site prefab or a shape).
// Best first: the same thing in other art (its size, other pictures), other versions of it (the same name), things
// of the same kind, then anything that fits its footprint and is about its height, even of another shape. Game
// models are only whole things that may stand alone, as the wizard places them (wizardWhole): never a part, a
// connector, a decal, a graffiti layer, a door or a railing. Sizes are metres throughout.
import { ALL_PREFABS } from '../prefabRegistry'
import { prefabParams } from '../prefabs'
import { isPhysicsSet } from '../prefabsPhysics'
import type { Vec3 } from '../project'
import type { Part } from '../sampleKit'
import { identify, type GameIdentity } from './identity'
import type { GameObjectEntry } from './indexer'
import { catalogEntry } from './catalog'
import { sameKind, sizeOff } from './placeholders'
import { NOT_BUILDINGS, PART_NAMES, wizardWhole } from './wizardPieces'

/** Where the object to swap stands: its size as it stands, and what it is. */
export interface SwapSpot {
  /** Metres: its long side, short side and height. */
  long: number; short: number; h: number
  /** Its name. */
  label: string
  /** A placed game model: its library entry. */
  entry?: GameObjectEntry
  /** A site prefab: its key. */
  prefab?: string
}

/** Why an option is offered, best first. */
export type SwapWhy = 'art' | 'version' | 'kind' | 'fits'
export const SWAP_WHY: SwapWhy[] = ['art', 'version', 'kind', 'fits']
export const SWAP_HEADINGS: Record<SwapWhy, string> = {
  art: 'Same shape, other look', version: 'Other versions', kind: 'Same kind of thing', fits: 'Other things that fit',
}

export interface SwapOption {
  /** "game:<id>" or "prefab:<key>" (its thumbnail key too). */
  key: string
  label: string
  why: SwapWhy
  /** Metres: long side, short side, height. */
  long: number; short: number; h: number
  /** How far off its size is from the spot's (placeholders.ts sizeOff: 0 = the same). */
  off: number
}

/** A game model the swapper may offer. */
export interface SwapModel {
  e: GameObjectEntry
  id: GameIdentity
  long: number; short: number; h: number
  /** Its size and pictures: two models with the same look are copies of one. */
  look: string
  /** Its name without copy numbers and variant letters ("14mailboxA01" -> "mailbox"). */
  stem: string
}

/** A site prefab the swapper may offer, as built with its default settings. */
export interface SwapPrefab { key: string; label: string; category: string; long: number; short: number; h: number }

type Identify = (e: GameObjectEntry) => GameIdentity

/** Heaviest model worth offering, in triangles (the wizard's biggest building). */
const MAX_TRIS = 24_000
/** Names of things that never stand alone, whatever role the rules gave them. */
const NEVER = /railing|graffiti|decal|(^|\s)door$/i
/** Most options per heading. */
const CAP: Record<SwapWhy, number> = { art: 8, version: 12, kind: 16, fits: 24 }
/** Most options of one name per heading (a wall of crates says nothing new). */
const PER_NAME = 3

const lookOf = (e: GameObjectEntry) => `${e.size.map((v) => v.toFixed(1)).join(',')}|${[...e.tex].map((t) => t.toLowerCase()).sort().join(',')}`

/** A model's name without its copy numbers and variant letter: "14mailboxA01", "mailbox_b" and "MailboxC" are all "mailbox". */
export function stemOf(name: string): string {
  const s = name.replace(/\.[a-z0-9]+$/i, '').replace(/^\d+/, '').replace(/(?:[A-Z]|_[A-Za-z])\d*[a-z]?$|\d+[a-z]?$/, '')
  return s.toLowerCase().replace(/[^a-z]+/g, '')
}

const pools = new WeakMap<GameObjectEntry[], SwapModel[]>()

/**
 * The library's models the swapper may offer: whole things that stand alone (buildings, props and fences), one of
 * each look (the city's copy over a multiplayer map's, then the most used). Kept per library.
 */
export function swapPool(entries: GameObjectEntry[], ident: Identify = identify): SwapModel[] {
  const hit = ident === identify ? pools.get(entries) : undefined
  if (hit) return hit
  const byId = new Map(entries.map((e) => [e.id, e]))
  const byLook = new Map<string, SwapModel>()
  for (const e of entries) {
    if (e.tris > MAX_TRIS) continue
    const id = ident(e)
    if (id.role !== 'building' && id.role !== 'prop' && id.role !== 'fence') continue
    if (NEVER.test(id.name) || (id.role === 'building' ? NOT_BUILDINGS.has(id.name) : PART_NAMES.has(id.name))) continue
    if (!wizardWhole(catalogEntry(e, id), e, byId)) continue
    const look = lookOf(e)
    const old = byLook.get(look)
    const city = (x: GameObjectEntry) => (!x.where?.length || x.where.includes('city') ? 1 : 0)
    if (old && (city(old.e) > city(e) || (city(old.e) === city(e) && old.e.seen >= e.seen))) continue
    const [long, short, h] = e.size
    byLook.set(look, { e, id, long, short, h, look, stem: stemOf(e.name) })
  }
  const out = [...byLook.values()]
  if (ident === identify) pools.set(entries, out)
  return out
}

/** Bottom-to-top box of a set of parts (units, as they stand). */
export function partsBox(parts: Pick<Part, 'at' | 'size' | 'rot'>[]): { min: Vec3; max: Vec3 } | null {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const p of parts) {
    const t = ((p.rot ?? 0) * Math.PI) / 180, c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t))
    const hx = (p.size[0] / 2) * c + (p.size[2] / 2) * s, hz = (p.size[0] / 2) * s + (p.size[2] / 2) * c
    x0 = Math.min(x0, p.at[0] - hx); x1 = Math.max(x1, p.at[0] + hx); z0 = Math.min(z0, p.at[2] - hz); z1 = Math.max(z1, p.at[2] + hz)
    y0 = Math.min(y0, p.at[1]); y1 = Math.max(y1, p.at[1] + p.size[1])
  }
  return Number.isFinite(x0) ? { min: [x0, y0, z0], max: [x1, y1, z1] } : null
}

const boxes = new Map<string, { min: Vec3; max: Vec3 } | null>()

/** A prefab's box in its own frame (units), built with these settings (its defaults when none). */
export function prefabBox(key: string, params?: Record<string, number | string>): { min: Vec3; max: Vec3 } | null {
  const def = ALL_PREFABS[key]
  if (!def) return null
  const k = key + (params ? JSON.stringify(params) : '')
  if (boxes.has(k)) return boxes.get(k)!
  let box: { min: Vec3; max: Vec3 } | null = null
  try { box = partsBox(def.make(0, 0, 0, 0, prefabParams(def, params))) } catch { /* a prefab that can't be built alone */ }
  boxes.set(k, box)
  return box
}

let prefabList: { ws: number; list: SwapPrefab[] } | null = null

/** Every prefab that can be swapped in (not a road network or a physics set), sized at `ws` metres per unit. */
export function swapPrefabs(ws: number): SwapPrefab[] {
  if (prefabList?.ws === ws) return prefabList.list
  const list: SwapPrefab[] = []
  for (const [key, def] of Object.entries(ALL_PREFABS)) {
    if (key === 'road' || isPhysicsSet(def)) continue
    const b = prefabBox(key)
    if (!b) continue
    const w = (b.max[0] - b.min[0]) * ws, d = (b.max[2] - b.min[2]) * ws, h = (b.max[1] - b.min[1]) * ws
    if (Math.min(w, d) <= 0 || h <= 0) continue
    list.push({ key, label: def.label, category: def.category, long: Math.max(w, d), short: Math.min(w, d), h })
  }
  prefabList = { ws, list }
  return list
}

/** Within its footprint (a little over is fine) and about its height: fits the spot as it is. */
function fits(c: { long: number; short: number; h: number }, s: SwapSpot): boolean {
  return c.long <= s.long * 1.05 + 0.05 && c.short <= s.short * 1.05 + 0.05 && c.long * c.short >= 0.4 * s.long * s.short
    && c.h >= 0.5 * s.h && c.h <= Math.max(1.6 * s.h, s.h + 1)
}
/** Near enough its size for the same thing in another version (a longer bench, a taller lamp). */
function near(c: { long: number; short: number; h: number }, s: SwapSpot): boolean {
  return c.long <= s.long * 1.3 + 0.2 && c.short <= s.short * 1.3 + 0.2 && c.long * c.short >= 0.25 * s.long * s.short
    && c.h >= 0.4 * s.h && c.h <= Math.max(2 * s.h, s.h + 1.5)
}
/** The same size, every side within a few centimetres. */
const same = (c: { long: number; short: number; h: number }, s: SwapSpot) =>
  Math.abs(c.long - s.long) <= 0.04 * s.long + 0.05 && Math.abs(c.short - s.short) <= 0.04 * s.short + 0.05 && Math.abs(c.h - s.h) <= 0.04 * s.h + 0.05

/**
 * What could stand where `spot` stands, best first: under each heading (SWAP_WHY) the closest in size first. Game
 * models come from `models` (swapPool), site prefabs from `prefabs` (swapPrefabs).
 */
export function swapOptions(spot: SwapSpot, o: { models?: SwapModel[]; prefabs?: SwapPrefab[]; identify?: Identify } = {}): SwapOption[] {
  const want = { long: spot.long, short: spot.short, height: spot.h }
  const offOf = (c: { long: number; short: number; h: number }) => +sizeOff({ long: c.long, short: c.short, height: c.h }, want).toFixed(3)
  const own = spot.entry, ownId = own ? (o.identify ?? identify)(own) : undefined
  const ownLook = own && lookOf(own), ownStem = own && stemOf(own.name)
  const ownPrefab = spot.prefab ? ALL_PREFABS[spot.prefab] : undefined
  const found: (SwapOption & { name: string; seen: number })[] = []
  for (const m of o.models ?? []) {
    if (own && (m.e.id === own.id || m.look === ownLook)) continue
    let why: SwapWhy | null = null
    if (own && ownId) {
      const named = m.id.name === ownId.name || (!!ownStem && ownStem.length >= 3 && m.stem === ownStem)
      // The same mesh in other pictures: the same size, and its name or its triangles say it is the same model.
      if (same(m, spot) && (named || m.e.tris === own.tris)) why = 'art'
      else if (named && near(m, spot)) why = 'version'
      else if (m.id.role === ownId.role && (m.id.kind ?? '') === (ownId.kind ?? '') && near(m, spot)) why = 'kind'
    } else if (spot.prefab && sameKind(spot.prefab, spot.label, [m.e.name, m.id.name]) && near(m, spot)) why = 'kind'
    if (!why && fits(m, spot)) why = 'fits'
    if (why) found.push({ key: 'game:' + m.e.id, label: m.id.name, why, long: m.long, short: m.short, h: m.h, off: offOf(m), name: m.id.name, seen: m.e.seen })
  }
  for (const p of o.prefabs ?? []) {
    if (p.key === spot.prefab) continue
    let why: SwapWhy | null = null
    const kin = ownPrefab
      ? p.category === ownPrefab.category || sameKind(spot.prefab!, spot.label, [p.key, p.label])
      : own && ownId ? sameKind(p.key, p.label, [own.name, ownId.name]) : false
    if (kin && near(p, spot)) why = 'kind'
    else if (fits(p, spot)) why = 'fits'
    if (why) found.push({ key: 'prefab:' + p.key, label: p.label, why, long: p.long, short: p.short, h: p.h, off: offOf(p), name: p.label, seen: 0 })
  }
  found.sort((a, b) => SWAP_WHY.indexOf(a.why) - SWAP_WHY.indexOf(b.why) || a.off - b.off || b.seen - a.seen || a.key.localeCompare(b.key))
  const out: SwapOption[] = []
  const count = new Map<string, number>()
  for (const x of found) {
    const n = count.get(x.why) ?? 0, k = x.why + '|' + x.name, ofName = count.get(k) ?? 0
    if (n >= CAP[x.why] || (x.why !== 'art' && x.why !== 'version' && ofName >= PER_NAME)) continue
    count.set(x.why, n + 1)
    count.set(k, ofName + 1)
    out.push({ key: x.key, label: x.label, why: x.why, long: x.long, short: x.short, h: x.h, off: x.off })
  }
  return out
}

/**
 * The heading for something `ex` × `ez` (its own X and Z) standing where something `ox` × `oz` turned `rot` stood:
 * its long side the way the old one's went (unless either is about square).
 */
export function fitTurn(ox: number, oz: number, rot: number, ex: number, ez: number): number {
  const square = (a: number, b: number) => Math.abs(a - b) <= 0.05 * Math.max(a, b)
  const r = !square(ox, oz) && !square(ex, ez) && (ex >= ez) !== (ox >= oz) ? rot + 90 : rot
  return +(((r % 360) + 360) % 360).toFixed(3)
}
