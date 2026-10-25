// What a model from the player's game is, in one place: its role (a whole building, a piece of one, a stand-alone
// prop, ground, a fence run, or something never placed), a plain name, what kind of prop it is, which new-map
// settings it suits, and for buildings the facts a layout needs. The library shows it and the new-map wizard
// builds with it ("Game pieces"), so both read the same answer.
//
// This first version is put together from the rules the library already has (classify.ts for categories,
// city/names.ts for names, tags.ts for tags). The indexing overhaul replaces the inside of identify() and keeps
// its shape: callers rely only on GameIdentity.
import type { GameObjectEntry } from './indexer'
import { BUILDINGS, skipName } from './classify'
import { INVISIBLE_TEXTURE } from './textures'
import { displayName, tagsOf } from './tags'
import type { WizardSetting } from '../mapWizard'

export type GameRole =
  /** A whole building: placed on its own, on a plot. */
  | 'building'
  /** Part of a building (a wall, a window, a roof, a door): never placed alone. */
  | 'piece'
  /** Stands on its own and can go anywhere fitting: cover, clutter, street furniture, plants, lights, wrecks, signs. */
  | 'prop'
  /** A ground, road, sidewalk or kerb tile. */
  | 'ground'
  /** A run of fence, wall or barrier: placed along an edge. */
  | 'fence'
  /** Never placed: invisible blockers, shadow and low-detail copies, decals, sky, water surfaces. */
  | 'skip'

export type PropKind = 'cover' | 'clutter' | 'street' | 'nature' | 'light' | 'vehicle' | 'sign' | 'furniture' | 'machine'

export interface BuildingFacts {
  /** Long side and short side, metres (which way each runs in its own frame is for the overhaul to add). */
  footprint: [number, number]
  /** Metres. */
  height: number
  storeys: number
  /** Which side of its own frame the front (main door, shop front) faces; unknown when it can't be told. */
  front?: '+x' | '-x' | '+z' | '-z'
}

export interface GameIdentity {
  role: GameRole
  /** The library category it is shown under (classify.ts CATEGORIES). */
  category: string
  /** A plain name ("Parking block", "4-storey brick apartment block"). */
  name: string
  /** Props: what kind, for the wizard to pick by. */
  kind?: PropKind
  /** New-map settings it suits (empty: any). */
  settings: WizardSetting[]
  /** Buildings only. */
  building?: BuildingFacts
}

const SKIP_NAMES = new Set(['Invisible blocker'])
const PIECE_CATS = new Set(['Building pieces', 'Doors and windows'])
const KIND_BY_CAT: Record<string, PropKind> = {
  'Containers and crates': 'cover', 'Wrecks and vehicles': 'vehicle', 'Street furniture': 'street', 'Nature': 'nature',
  'Lights and signals': 'light', 'Signs and billboards': 'sign', 'Furniture': 'furniture', 'Machines': 'machine',
  'Bottles, glass and small things': 'clutter', 'Other': 'clutter',
}
/** Tags that point at a setting. */
const SETTING_BY_TAG: [string, WizardSetting][] = [
  ['run-down', 'rundown'], ['industrial', 'industrial'], ['industrial', 'docks'], ['construction', 'construction'],
  ['police', 'military'], ['street', 'downtown'], ['shop', 'downtown'], ['home', 'suburbs'], ['nature', 'suburbs'],
]

/** The model's identity. */
export function identify(e: GameObjectEntry): GameIdentity {
  const name = displayName(e)
  const tags = tagsOf(e)
  const settings = [...new Set(SETTING_BY_TAG.filter(([t]) => tags.includes(t)).map(([, s]) => s))]
  const base = { category: e.cat, name, settings }
  const main = (e.tex[0] ?? '').toLowerCase()
  if (SKIP_NAMES.has(name) || e.cat === 'Water and sky' || skipName(e.name.toLowerCase()) || INVISIBLE_TEXTURE.test(main) || /^norender\./.test(main)) {
    return { ...base, role: 'skip' }
  }
  if (e.cat === BUILDINGS) {
    // Entry sizes are [long side, short side, height].
    const [w, d, h] = e.size
    return { ...base, role: 'building', building: { footprint: [w, d], height: h, storeys: Math.max(1, Math.round(h / 3.5)) } }
  }
  if (PIECE_CATS.has(e.cat)) return { ...base, role: 'piece' }
  if (e.cat === 'Ground and roads') return { ...base, role: 'ground' }
  if (e.cat === 'Fences and barriers') return { ...base, role: 'fence' }
  return { ...base, role: 'prop', kind: KIND_BY_CAT[e.cat] ?? 'clutter' }
}
