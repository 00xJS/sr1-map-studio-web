// Building maps the way Stilwater is built: the shared shapes three pieces of work meet on.
//
//   - City modules: real pieces of Stilwater kept exactly as the game placed them (a corner shop with its
//     sidewalk, an alley, a gas station, a row of houses), with the edges they can join on and where players get
//     in and out. The big, fixed parts of a map.
//   - Groups: things the game keeps placing together in the same arrangement (a bus stop: shelter, bench, sign,
//     trash can; a back alley: dumpster, boxes, light), to fill open ground and give cover the way the city does.
//   - Placement rules: what each single model needs (stands on the ground, hangs on a wall facing out, only with
//     its own building, never alone, needs floor in front, needs stairs to reach) and what can't change.
//
// Phase A (the Stilwater study) fills cityModules() and groups() from the city chunks; phase B fills placementOf()
// and the review page; phase C builds new maps from them in the map wizard. Each reads only these shapes, so
// they can be done side by side. Everything here comes from the player's own game files at run time (origin
// 'game'): never stored in the repository, never shared.
import type { Vec3 } from '../project'
import type { WizardSetting } from '../mapWizard'
import type { GameObjectEntry } from './indexer'

/** A side of a module or group in its own frame. */
export type Side = '+x' | '-x' | '+z' | '-z'

/** What a model is in a module: the building's shell, its own kit, a detail layer on it, or something standing on its own. */
export type PartLayer = 'shell' | 'kit' | 'detail' | 'prop' | 'ground' | 'fence'

/** One placed model in a module or group, in that module's or group's own frame (metres, game frame). */
export interface ModulePart {
  /** The library entry (GameObjectEntry.id). */
  id: string
  at: Vec3
  /** Turn about the vertical, degrees. */
  yaw: number
  layer: PartLayer
  /** Its size across x and z in its own (cut-out) frame, metres: what it covers before it is turned. */
  ext?: [number, number]
}

/** What a module's edge is, so modules join where they make sense (street to street, back to back). */
export type EdgeKind = 'street' | 'sidewalk' | 'alley' | 'yard' | 'wall' | 'open' | 'water'

export interface ModuleEdge {
  side: Side
  kind: EdgeKind
  /** Where along the side (metres from its middle) players can pass, and how wide; empty: they can't. */
  openings: { at: number; width: number }[]
}

export type ModuleKind = 'block' | 'corner' | 'street' | 'alley' | 'yard' | 'plaza' | 'lot' | 'landmark'

/** A real piece of Stilwater, as the game placed it. */
export interface CityModule {
  id: string
  /** A plain name ("Corner shop with sidewalk", "Back alley with fire escapes"). */
  name: string
  kind: ModuleKind
  /** The Stilwater district it was cut from, and the new-map settings it suits. */
  district: string
  settings: WizardSetting[]
  /**
   * Where it was cut from: packfile, chunk and the rectangle (game metres, [minX, minZ, maxX, maxZ]); `y`: the height
   * in the game of the module's floor (its own y = 0, the building's feet).
   */
  source: { pack: string; chunk: string; rect: [number, number, number, number]; y?: number }
  /** Across (x) and deep (z), metres, in its own frame; floor height range. */
  size: [number, number]
  floor: [number, number]
  edges: ModuleEdge[]
  /** Points (own frame) players can stand on that connect to the rest of the map: doors, gaps, stair tops. */
  entrances: Vec3[]
  parts: ModulePart[]
  /** Upper floors or roofs players can reach, and how (stairs, ramp, fire escape, ladder: 'none' means fenced off). */
  levels: { height: number; reach: 'stairs' | 'ramp' | 'fire escape' | 'ladder' | 'jump' | 'none' }[]
  /** Triangles, for the export budget. */
  tris: number
}

export type GroupKind = 'street' | 'cover' | 'alley' | 'shop front' | 'yard' | 'industrial' | 'parking' | 'decor' | 'other'

/** Things the game keeps placing together in the same arrangement. */
export interface CityGroup {
  id: string
  /** A plain name ("Bus stop", "Dumpster and boxes"). */
  name: string
  kind: GroupKind
  settings: WizardSetting[]
  /** Where it goes: on open ground, against a wall (its back to the wall on `back`), on a roof. */
  anchor: 'ground' | 'wall' | 'roof'
  back?: Side
  size: [number, number]
  parts: ModulePart[]
  /** How many times the game places it, and a few of them (pack, chunk, where), to look at. */
  seen: number
  examples: { pack: string; chunk: string; at: Vec3 }[]
  /**
   * 'fixed' (or absent): the game places the parts at these spots and turns every time. 'varies': the same things
   * stand together, but where each stands varies (a bus stop's sign at one end or the other); the parts are one
   * real example.
   */
  arrangement?: 'fixed' | 'varies'
}

/** What a single model needs to stand right, and what about it can't change. */
export interface PlacementRule {
  /** Where it goes: on the ground, mounted on a wall, on a roof, hanging from above, or only on its own building. */
  attach: 'ground' | 'wall' | 'roof' | 'hang' | 'building'
  /** For wall and building parts: which side of the model faces out from the wall. */
  facing?: Side
  /** Models it is never placed without (ids): a lamp's pole and base, a fence panel's feet. */
  needs?: string[]
  /** Only on these buildings (ids): its kit. */
  onlyOn?: string[]
  /** Needs this much clear floor in front (metres): doors, shop counters, stairs. */
  clearFront?: number
  /** Players reach it only by stairs, a ramp or a ladder (a roof, an upper floor). */
  reach?: 'stairs' | 'ramp' | 'ladder'
  /** What may vary when it is placed (turned, mirrored, a colour variant, nudged); everything else stays as the game has it. */
  mayVary: ('turn' | 'mirror' | 'variant' | 'nudge')[]
  /** For cover and sight: how high it is and whether players can see or shoot through it. */
  coverHeight?: number
  seeThrough?: boolean
}

/**
 * The city's modules (phase A): each building of Stilwater's streets cut out with what stands on and around it,
 * as the library found them while reading the city chunks (cityStudy.ts). Only modules whose every part is in
 * `entries` are given; empty for a library built before the study.
 */
export function cityModules(entries: GameObjectEntry[]): CityModule[] {
  const have = new Set(entries.map((e) => e.id))
  return entries.flatMap((e) => e.modules ?? []).filter((m) => m.parts.every((p) => have.has(p.id)))
}

/** The city's recurring groups (phase A), most seen first; see cityStudy.ts findGroups(). Only groups whose every part is in `entries`. */
export function groups(entries: GameObjectEntry[]): CityGroup[] {
  const have = new Set(entries.map((e) => e.id))
  return entries.flatMap((e) => e.groups ?? []).filter((g) => g.parts.every((p) => have.has(p.id))).sort((a, b) => b.seen - a.seen)
}

/** A model's placement rule (phase B). Until it is filled in: stands on the ground, may turn. */
export function placementOf(_entry: GameObjectEntry): PlacementRule {
  return { attach: 'ground', mayVary: ['turn'] }
}
