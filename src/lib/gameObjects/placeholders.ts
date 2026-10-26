// The site's own pieces (the prefabs and blocks the wizard and the samples are built from: a dumpster, a bench, a
// shack, a jersey barrier) set beside the real models from the player's game that can stand in for them, closest
// size first, with how far off each is. The wizard swaps by the same kinds (wizardPieces.ts SPOTS); this is the
// list to check that every placeholder has a real piece of the right size, and which ones don't yet.
import { ALL_PREFABS } from '../prefabRegistry'
import { prefabParams } from '../prefabs'
import { UNITS_PER_M } from '../player'
import type { Part } from '../sampleKit'
import type { GameObjectEntry } from './indexer'
import type { CatalogEntry, Role } from './catalog'
import { SPOTS } from './wizardPieces'
import type { PropKind } from './identity'

export interface SiteSize { long: number; short: number; height: number }

export interface Match {
  id: string
  name: string
  title: string
  long: number; short: number; height: number
  /** How far off its size is from the placeholder's, as a share of the placeholder's (0 = the same). */
  off: number
  /** Its name says it is the same kind of thing (a tree for a tree, a dumpster for a dumpster). */
  named: boolean
}

export interface Placeholder {
  key: string
  label: string
  /** What it stands for in the game: prop kinds, or a fence. */
  wants: string[]
  size: SiteSize
  /** The closest real pieces, best first (empty: nothing in the game library to stand in for it). */
  matches: Match[]
}

/** A prefab's size, metres (its parts' box), as built with its default settings. */
export function prefabSize(key: string): SiteSize | null {
  const def = ALL_PREFABS[key]
  if (!def) return null
  let parts: Part[]
  try { parts = def.make(0, 0, 0, 0, prefabParams(def)) } catch { return null }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const p of parts) {
    const t = ((p.rot ?? 0) * Math.PI) / 180, c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t))
    const hx = (p.size[0] / 2) * c + (p.size[2] / 2) * s, hz = (p.size[0] / 2) * s + (p.size[2] / 2) * c
    x0 = Math.min(x0, p.at[0] - hx); x1 = Math.max(x1, p.at[0] + hx); z0 = Math.min(z0, p.at[2] - hz); z1 = Math.max(z1, p.at[2] + hz)
    y0 = Math.min(y0, p.at[1]); y1 = Math.max(y1, p.at[1] + p.size[1])
  }
  if (!Number.isFinite(x0)) return null
  const w = (x1 - x0) / UNITS_PER_M, d = (z1 - z0) / UNITS_PER_M
  return { long: +Math.max(w, d).toFixed(2), short: +Math.min(w, d).toFixed(2), height: +((y1 - y0) / UNITS_PER_M).toFixed(2) }
}

/** Words a game model's name has when it is the same kind of thing as a site piece (besides the piece's own name). */
const ALSO: Record<string, string[]> = {
  tree: ['tree', 'palm', 'oak', 'pine'], bush: ['bush', 'shrub', 'hedge', 'plant'], flowers: ['flower', 'plant', 'planter'], planterbox: ['planter', 'plant'],
  trashcan: ['trash', 'garbage', 'bin', 'litter'], trashbags: ['trash', 'garbage', 'bag', 'rubbish'], binbags: ['trash', 'garbage', 'bag', 'rubbish'], junkpile: ['junk', 'trash', 'rubble', 'debris'],
  foodcart: ['cart', 'vendor', 'hotdog', 'food'], icecart: ['cart', 'vendor', 'ice'], vending: ['vending', 'soda', 'snack'], phone: ['phone', 'payphone'],
  couch: ['couch', 'sofa'], car: ['car', 'sedan', 'coupe', 'taxi', 'van', 'husk'], burnedcar: ['husk', 'wreck', 'burn', 'car'], srcarhusk: ['husk', 'wreck', 'car'], carwreck: ['husk', 'wreck', 'car'],
  jeep: ['jeep', 'truck', 'van'], forklift: ['forklift', 'lift'], palletjack: ['pallet', 'jack'], pallets: ['pallet'], drumpallets: ['drum', 'barrel', 'pallet'], barrels: ['barrel', 'drum'],
  firebarrel: ['barrel', 'drum', 'fire'], srtires: ['tire', 'tyre'], tirestack: ['tire', 'tyre'], spool: ['spool', 'cable', 'reel'], containers: ['container'], containerstack: ['container'], reefer: ['container', 'reefer'],
  srdumpsterlarge: ['dumpster', 'skip'], dumpster: ['dumpster', 'skip'], skip: ['dumpster', 'skip'], cementbags: ['cement', 'bag', 'sack'], brickpallets: ['brick', 'pallet'], concretepipes: ['pipe'],
  generator: ['generator'], fueltank: ['tank', 'fuel'], busstop: ['bus', 'shelter', 'stop'], hydrant: ['hydrant'], meters: ['meter'], bench: ['bench'], mailbox: ['mailbox', 'mail'], newsbox: ['news', 'paper'],
  bikerack: ['bike', 'rack'], bollards: ['bollard', 'post'], trafficlight: ['traffic', 'signal', 'light'], cones: ['cone'], trafficbarrels: ['barrel', 'barrier', 'cone'],
  srchainlink: ['chain', 'fence'], chainfence: ['chain', 'fence'], picketfence: ['picket', 'fence'], hedge: ['hedge', 'bush'], barricade: ['barricade', 'barrier'], roadbarricade: ['barricade', 'barrier'],
  jersey: ['jersey', 'barrier', 'concrete'], lowwall: ['wall'], sandbagwall: ['sandbag', 'bag'], hesco: ['hesco', 'barrier', 'sandbag'], twall: ['wall', 'barrier'],
  fountain: ['fountain'], gazebo: ['gazebo', 'pavilion', 'pavillion', 'shelter'], kiosk: ['kiosk', 'booth', 'stand'], playground: ['playground', 'swing', 'slide'],
  scaffold: ['scaffold'], scaffoldtower: ['scaffold', 'tower'], girders: ['girder', 'beam', 'steel'], excavator: ['excavator', 'digger'], radar: ['radar', 'dish', 'antenna'],
  checkpoint: ['checkpoint', 'booth', 'gate'], helipad: ['helipad', 'heli'], burnedshell: ['burn', 'shell', 'ruin'], buoys: ['buoy'], lifering: ['life', 'ring', 'buoy'], fishnet: ['net'],
  fishcrates: ['crate', 'fish'], srboxes: ['box', 'crate', 'cardboard'], shoppingcart: ['cart', 'trolley'], wheelbarrow: ['wheelbarrow', 'barrow'], rebar: ['rebar', 'steel'], dirtpile: ['dirt', 'pile', 'rubble'],
  ammocrates: ['ammo', 'crate'], cratestack: ['crate'], Bench: ['bench'], Tree: ['tree', 'palm'], Dumpster: ['dumpster'],
}

/** Whether a model's names say it is the kind of thing a site piece is. */
export function sameKind(key: string, label: string, names: string[]): boolean {
  const words = [...(ALSO[key] ?? []), ...label.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4).map((w) => w.replace(/s$/, ''))]
  const hay = names.join(' ').toLowerCase()
  return words.some((w) => hay.includes(w))
}

const ROLE_OF: Record<PropKind, Role> = { cover: 'cover', clutter: 'clutter', street: 'street', nature: 'nature', light: 'light', vehicle: 'vehicle', sign: 'sign', furniture: 'furniture', machine: 'machine' }

/** How far off one size is from another (a share of the wanted size, the worst of its three sides). */
export const sizeOff = (have: SiteSize, want: SiteSize) =>
  Math.max(...(['long', 'short', 'height'] as const).map((k) => Math.abs(have[k] - want[k]) / Math.max(0.2, want[k])))

/**
 * Every site piece the wizard swaps for game models, with the closest real pieces (models standing on their own or
 * with their parts, of the kinds it stands for), at most `count` each.
 */
export function placeholders(entries: GameObjectEntry[], cat: Map<string, CatalogEntry>, count = 5): Placeholder[] {
  const byRole = new Map<Role, CatalogEntry[]>()
  for (const e of entries) {
    const c = cat.get(e.id)
    if (!c || c.form.value !== 'model' || (c.structure.value !== 'standalone' && c.structure.value !== 'assembly')) continue
    const l = byRole.get(c.role.value) ?? []
    l.push(c)
    byRole.set(c.role.value, l)
  }
  const out: Placeholder[] = []
  for (const [key, spot] of Object.entries(SPOTS)) {
    const size = prefabSize(key)
    if (!size) continue
    const wants = spot.role === 'fence' ? ['fence'] : spot.kinds
    const roles: Role[] = spot.role === 'fence' ? ['fence'] : spot.kinds.map((k) => ROLE_OF[k])
    const pool = roles.flatMap((r) => byRole.get(r) ?? [])
    const matches = pool
      .map((c): Match => ({ id: c.id, name: c.name, title: c.title, long: c.measures.long, short: c.measures.short, height: c.measures.height, off: +sizeOff(c.measures, size).toFixed(2), named: sameKind(key, ALL_PREFABS[key]?.label ?? key, [c.name, c.title]) }))
      // The same kind of thing first (within twice the size), then the closest in size.
      .sort((a, b) => Number(b.named && b.off <= 1) - Number(a.named && a.off <= 1) || a.off - b.off || a.id.localeCompare(b.id))
      // One of each model name: copies of one model from different chunks say nothing new.
      .filter((m, i, all) => all.findIndex((x) => x.name === m.name) === i)
      .slice(0, count)
    out.push({ key, label: ALL_PREFABS[key]?.label ?? key, wants, size, matches })
  }
  return out.sort((a, b) => Number(!!b.matches[0]?.named) - Number(!!a.matches[0]?.named) || (a.matches[0]?.off ?? 9) - (b.matches[0]?.off ?? 9) || a.key.localeCompare(b.key))
}
