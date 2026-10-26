// The new map wizard's "Game pieces": the same layout, spawns and props, filled with models from the player's own
// game instead of the site's shapes and prefabs. Building plots get a whole building that fits the plot, turned to
// fit and front toward the street when that is known; cover, clutter, street furniture, plants and wrecks get a
// prop of the kind the spot had; street lamps get a game light; fence spots and yard walls get fence runs. Where
// nothing fits (or the budget is spent) the site's own piece stays. Models are chosen only from what identify()
// says about them (role, kind, settings, building facts), plus the entry's size, triangles and texture names.
//
// Every model goes in as a stand-in box (a Part with `game`) the size of the model, so the passes that follow
// (dressing, spawns, weapons, lights) work round it; the map builder swaps each stand-in for the model itself
// (wizardBuild.ts). A few models used many times are cheaper to export than many used once, so each kind of spot
// keeps a small palette, and the map keeps to a triangle and texture budget.
import type { Vec3 } from '../project'
import { PB, box, type Part, type Sample } from '../sampleKit'
import { turn } from '../sampleKit'
import { over } from '../sampleScale'
import { rng, type Half, type Rng, type WizardOptions, type WizardSetting } from '../mapWizard'
import { UNITS_PER_M } from '../player'
import { identify, type BuildingFacts, type GameIdentity, type PropKind } from './identity'
import type { GameObjectEntry } from './indexer'
import { withLabels, type GameLabels } from './labels'
import { frameLook, type FrameLook } from './frame'
import { catalogEntry, withCorrections, type CatalogEntry } from './catalog'
import { sameKind } from './placeholders'
import { ALL_PREFABS } from '../prefabRegistry'
import type { PlacementRule, Side } from './cityModules'

/** What a stand-in stands for. */
export interface GamePart {
  /** The library entry. */
  id: string
  /** Its plain name. */
  name: string
  /** Buildings: the heading (degrees, 0 = the stand-in's own +Z) the model's front should face. */
  front?: number
  /**
   * Placed exactly where and as turned as the stand-in is (a part of a Stilwater module or group, wizardModules.ts,
   * or a prop placed by its rule): never turned to fit, nor swapped for a plain block.
   */
  exact?: boolean
  /** The module or group it belongs to (its name). */
  from?: string
  /**
   * Buildings: others that fit the same stand-in, best first. The map builder tries them in turn when this one turns
   * out see-through at eye height or bigger than its footprint said, before falling back to the site's plain block.
   */
  alts?: string[]
}

/** Building from whole Stilwater modules (wizardModules.ts): the layout's big areas, filled before its own plots. */
export interface CityHooks {
  /** Anything to build from. */
  readonly ready: boolean
  /** Fills red's half's big areas with modules and groups; false when there is nothing to build from (the layout's own plots then). */
  fill(h: Half, o: WizardOptions): boolean
  /**
   * Boxes over what was filled, both halves, kept out of while the map is dressed and its spawns and weapons placed
   * (the stand-ins only roughly match the game's models there), then taken away again. Empty when nothing was.
   */
  keepOut(): Part[]
}

/**
 * Most game triangles in one map, both halves. The exporter has no hard limit for static geometry; this keeps a
 * wizard map under the biggest retail map (about 213,000 triangles), with room left for the site's own pieces.
 */
export const TRI_BUDGET = 150_000
/** Share of the triangle budget buildings may take, so props are left some. */
const BUILDING_SHARE = 0.75
/** Most distinct game textures in one map (each one goes into the map's texture file). */
export const TEXTURE_BUDGET = 80
/** Most distinct models per palette. */
const PALETTE: Record<string, number> = { building: 8, fence: 2, light: 1, cover: 4 }
const PROP_PALETTE = 3
/** Heaviest single model worth placing, in triangles. */
const MAX_BUILDING_TRIS = 24_000
const MAX_PROP_TRIS = 4_000
/** Height (metres) of what counts as cover on open ground: a crouching player hides behind it, up to a container. */
const COVER_H: [number, number] = [1.3, 3.5]
/** Runner-up buildings each building stand-in carries (GamePart.alts). */
const ALTS = 6
/** Tallest building, metres, per setting (a 100 m tower would dwarf a 70 m map). */
const MAX_HEIGHT: Record<WizardSetting, number> = {
  downtown: 45, industrial: 25, docks: 25, rundown: 25, suburbs: 15, construction: 30, military: 15, paintball: 12, cyber: 30,
}
/**
 * Names of things that are part of something bigger: never placed on their own as a prop or fence, whatever role the
 * model has been given (the first identity rules still call some panels and kerbs props). Not for buildings: a whole
 * building can be named after one of its parts ("Window") by those rules.
 */
/** Names the first identity rules give some lights, signs and frames they count as buildings: not buildings. */
const NOT_BUILDINGS = new Set(['Light', 'Graffiti', 'Post', 'Fence', 'Sign', 'Billboard', 'Pole', 'Lamp'])
const PART_NAMES = new Set(['Wall', 'Window', 'Door', 'Trim', 'Grass', 'Ground', 'Road', 'Sidewalk', 'Kerb', 'Roof', 'Floor', 'Metal panel', 'Wood panel',
  'Post', 'Highway', 'Tiles', 'Front', 'Handles', 'Building', 'Invisible blocker'])
/**
 * Lowest building, metres: a plot's building is what players hide behind, so a kiosk or a canopy doesn't take one
 * (the map's health check marks spawns seen from everywhere when they do).
 */
const MIN_HEIGHT = 5
/** Least share of its plot a building covers, for the same reason. */
const MIN_FILL = 0.5
/** Metres kept free round a building's footprint when fitting it to a plot (the stand-in includes it). */
export const BUILDING_MARGIN = 0.3
/** Least eye-height cover for a building (see wizardBuild.ts eyeCover): below it players see and shoot through it. */
export const SOLID_COVER = 0.7
/** Settings the option is offered for: the cyber grid has nothing like it in the game. */
export const gamePiecesSuit = (s: WizardSetting) => s !== 'cyber'

type Spot = { role: 'prop'; kinds: PropKind[] } | { role: 'fence' }
const prop = (...kinds: PropKind[]): Spot => ({ role: 'prop', kinds })
const COVER = prop('cover', 'machine'), CLUTTER = prop('clutter', 'cover'), STREET = prop('street'), NATURE = prop('nature'), LIGHT = prop('light'),
  VEHICLE = prop('vehicle'), MACHINE = prop('machine', 'cover'), FURNITURE = prop('furniture', 'clutter'), FENCE: Spot = { role: 'fence' }
/**
 * What each site piece's spot takes from the game, by prefab key or (for pieces placed without one) the name of
 * its group. Pieces not listed (climbable set pieces, tents, decals) stay the site's.
 */
export const SPOTS: Record<string, Spot> = {
  containers: COVER, pallets: COVER, barrels: COVER, srboxes: COVER, srdumpsterlarge: COVER, dumpster: COVER, Dumpster: COVER, drumpallets: COVER,
  concretepipes: COVER, cementbags: COVER, brickpallets: COVER, skip: COVER, ammocrates: COVER, srtires: COVER, tirestack: COVER, cratestack: COVER,
  fishcrates: COVER, spool: COVER, reefer: COVER,
  generator: MACHINE, fueltank: MACHINE,
  trashbags: CLUTTER, binbags: CLUTTER, junkpile: CLUTTER, shoppingcart: CLUTTER, cones: CLUTTER, trafficbarrels: CLUTTER, wheelbarrow: CLUTTER,
  buoys: CLUTTER, lifering: CLUTTER, fishnet: CLUTTER, rebar: CLUTTER, dirtpile: CLUTTER, palletjack: CLUTTER, firebarrel: CLUTTER,
  couch: FURNITURE,
  busstop: STREET, foodcart: STREET, hydrant: STREET, trashcan: STREET, meters: STREET, vending: STREET, bench: STREET, Bench: STREET, phone: STREET,
  mailbox: STREET, bikerack: STREET, icecart: STREET, bollards: STREET, newsbox: STREET,
  trafficlight: LIGHT,
  tree: NATURE, Tree: NATURE, bush: NATURE, flowers: NATURE, planterbox: NATURE,
  car: VEHICLE, burnedcar: VEHICLE, srcarhusk: VEHICLE, forklift: VEHICLE, jeep: VEHICLE, carwreck: VEHICLE,
  // The middle of the map: something big the game has (a fountain or a statue, a kiosk, a crane, a stack of containers).
  fountain: prop('nature', 'street', 'machine'), gazebo: prop('street', 'nature'), kiosk: prop('street', 'machine'), playground: prop('street', 'nature'),
  scaffold: MACHINE, scaffoldtower: MACHINE, girders: MACHINE, excavator: MACHINE, radar: MACHINE, checkpoint: prop('street', 'cover'),
  helipad: MACHINE, containerstack: COVER, burnedshell: prop('vehicle', 'clutter'),
  picketfence: FENCE, srchainlink: FENCE, chainfence: FENCE, hedge: FENCE, barricade: FENCE, roadbarricade: FENCE, lowwall: FENCE, jersey: FENCE,
  sandbagwall: FENCE, hesco: FENCE, twall: FENCE,
}

const M = UNITS_PER_M
const r2 = (v: number) => +v.toFixed(2)

/**
 * A stand-in for a model placed exactly: at `at` (units, its feet), turned `rot`, its box the model's own extents:
 * `ext` (metres across its own X and Z) when known, else the long side along the axis the library says (X when it
 * doesn't).
 */
export function exactStandIn(e: Pick<GameObjectEntry, 'id' | 'name' | 'size' | 'long'>, label: string, at: Vec3, rot: number, from?: string, ext?: [number, number]): Part {
  const [l, s, h] = e.size
  const [sx, sz] = ext ?? (e.long === 'z' ? [s, l] : [l, s])
  const part = box(label, [r2(Math.max(0.1, sx) * M), r2(Math.max(0.05, h) * M), r2(Math.max(0.1, sz) * M)], at.map(r2) as Vec3, PB.concrete, PB.concrete, ((rot % 360) + 360) % 360)
  return { ...part, game: { id: e.id, name: e.name, exact: true, ...(from ? { from } : {}) } }
}

/** Which way (editor X, Z) a side of a model faces once it stands turned `rot`. */
export function facingVec(side: Side, rot: number): [number, number] {
  const [gx, gz] = ({ '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] } as const)[side]
  // The game's +X is the editor's −X.
  return turn(-gx, gz, rot)
}

export interface Cand {
  e: GameObjectEntry
  id: GameIdentity
  /** Metres: long side, short side, height. */
  long: number; short: number; h: number
  /** How well it suits the setting, times how much the game uses it. */
  weight: number
  /** What the catalogue makes of it (catalog.ts): its form, how it's put together, the cover it gives. */
  cat: CatalogEntry
}

export interface Prepared {
  buildings: Cand[]
  fences: Cand[]
  props: Map<PropKind, Cand[]>
}

const prepared = new WeakMap<GameObjectEntry[], Map<string, Prepared>>()
type Identify = (e: GameObjectEntry) => GameIdentity

/**
 * The library sorted into what the wizard can use for one setting, best first (kept per library, setting and
 * labels). The player's labels (labels.ts) come first: a role or settings they gave, a building measured as one
 * players see through left out, a model they checked likelier to be picked.
 */
export function prepare(entries: GameObjectEntry[], setting: WizardSetting, base: Identify = identify, labels?: GameLabels, labelsVersion = 0): Prepared {
  let bySetting = prepared.get(entries)
  if (!bySetting) prepared.set(entries, bySetting = new Map())
  // A custom identify (the tests') is never cached.
  const key = base === identify ? `${setting}:${labels ? labelsVersion : '-'}` : ''
  const hit = key ? bySetting.get(key) : undefined
  if (hit) return hit
  const ident = labels ? withLabels(labels, base) : base
  const out: Prepared = { buildings: [], fences: [], props: new Map() }
  const all = new Map(entries.map((e) => [e.id, e]))
  for (const e of entries) {
    const id = ident(e), l = labels?.[e.id]
    if (id.role !== 'building' && id.role !== 'prop' && id.role !== 'fence') continue
    // Whole pieces only: a real 3D model standing on its own, complete with its parts, or one that stands on its base
    // (placed with it). Never a part, a building's kit piece, a connector, a second copy, a flat sheet or a stand-in;
    // a base alone only as the foot of what stands on it. The player's check overrides.
    const cat = withCorrections(catalogEntry(e, id), l)
    if (!l?.ok && !l?.role && !wizardWhole(cat, e, all)) continue
    // The name rules stand in for a player's check until there is one.
    if (!l?.ok && !l?.role && (id.role !== 'building' ? PART_NAMES.has(id.name) : NOT_BUILDINGS.has(id.name))) continue
    // Players could see through it at eye height (measured by the player, or when the game files were read).
    if (id.role === 'building' && (l?.cover ?? e.eye ?? 1) < SOLID_COVER) continue
    const [a, b, h] = id.role === 'building' && id.building ? [...id.building.footprint, id.building.height] : e.size
    // A building is fitted with a margin all round: its footprint can come out a little smaller than the model cut out.
    const pad = id.role === 'building' ? 2 * BUILDING_MARGIN : 0
    const long = Math.max(a, b) + pad, short = Math.min(a, b) + pad
    const suits = id.settings.includes(setting) ? 2 : id.settings.length ? 0.3 : 1
    const c: Cand = { e, id, cat, long, short, h, weight: suits * (1 + Math.log10(1 + e.seen) / 2) * (l?.ok || l?.role ? 3 : 1) }
    if (id.role === 'building') {
      // Not a pole or a mast: no taller than four times its long side.
      if (short >= 3 && h >= MIN_HEIGHT && h <= MAX_HEIGHT[setting] && h <= 4 * long && e.tris <= MAX_BUILDING_TRIS) out.buildings.push(c)
    } else if (id.role === 'fence') {
      if (long >= 1 && h >= 0.6 && h <= 4 && e.tris <= MAX_PROP_TRIS) out.fences.push(c)
    } else if (id.kind && long >= 0.3 && short >= 0.05 && e.tris <= MAX_PROP_TRIS && e.seen >= 2) {
      const list = out.props.get(id.kind) ?? []
      list.push(c)
      out.props.set(id.kind, list)
    }
  }
  // The best few hundred of each, so a spot isn't measured against every model in the game.
  const top = (l: Cand[]) => l.sort((x, y) => y.weight - x.weight || x.e.id.localeCompare(y.e.id)).slice(0, 400)
  out.buildings = top(out.buildings)
  out.fences = top(out.fences)
  for (const [k, l] of out.props) out.props.set(k, top(l))
  if (key) bySetting.set(key, out)
  return out
}

export interface GamePiecesStats {
  buildings: number
  props: number
  lights: number
  fences: number
  /** Spots that kept the site's own piece (nothing fitted, or the budget was spent). */
  kept: number
  triangles: number
  textures: number
  models: number
}

/**
 * The heading a game model stands at in place of its stand-in. `ex` and `ez` are the model's own extents along X
 * and Z as placed (editor space). Its long side goes the way the stand-in's long side goes; when its front is known
 * and the stand-in asks for one, it is turned round (never across) so the front faces that way.
 */
/**
 * Whether a model with extents `ex` × `ez` (editor units, as stored), turned `rot`, stays inside its stand-in's
 * footprint. The map builder puts the site's plain block in for one that doesn't, so nothing spills off its plot.
 */
export function fitsStandIn(ex: number, ez: number, part: Pick<Part, 'size' | 'rot'>, rot: number): boolean {
  const [ax, az] = turn(ex, ez, rot - (part.rot ?? 0)).map(Math.abs)
  return ax <= part.size[0] + 0.02 && az <= part.size[2] + 0.02
}

export function modelTurn(ex: number, ez: number, part: Pick<Part, 'size' | 'rot' | 'game'>, front?: BuildingFacts['front']): number {
  let rot = part.rot ?? 0
  const square = Math.abs(ex - ez) <= 0.05 * Math.max(ex, ez)
  if (!square && (ex >= ez) !== (part.size[0] >= part.size[2])) rot += 90
  if (front && part.game?.front !== undefined) {
    // The game's +X is the editor's −X (models are mirrored into editor space).
    const [fx, fz] = ({ '+x': [-1, 0], '-x': [1, 0], '+z': [0, 1], '-z': [0, -1] } as const)[front]
    const t = (part.game.front * Math.PI) / 180
    const [wx, wz] = turn(Math.sin(t), Math.cos(t), part.rot ?? 0)
    const dot = (r: number) => { const [x, z] = turn(fx, fz, r); return x * wx + z * wz }
    if (dot(rot + 180) > dot(rot) + 1e-6) rot += 180
  }
  return ((rot % 360) + 360) % 360
}

/** One placed site piece: its parts, where it stands and how big it is. */
interface Piece { key: string; parts: Part[]; at: Vec3; rot: number; radius: number; height: number }

/** The site pieces in a list of parts: prefab instances (and untagged groups like a tree or a bench). */
function piecesOf(parts: Part[]): Piece[] {
  const groups = new Map<string, Part[]>()
  for (const p of parts) if (p.group && !p.game) { const g = groups.get(p.group); if (g) g.push(p); else groups.set(p.group, [p]) }
  const out: Piece[] = []
  for (const [g, ps] of groups) {
    const tag = ps[0].prefab
    const key = tag?.key ?? g.split('@')[0]
    if (!SPOTS[key]) continue
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const p of ps) {
      const rad = Math.hypot(p.size[0], p.size[2]) / 2
      x0 = Math.min(x0, p.at[0] - rad); x1 = Math.max(x1, p.at[0] + rad); z0 = Math.min(z0, p.at[2] - rad); z1 = Math.max(z1, p.at[2] + rad)
      y0 = Math.min(y0, p.at[1]); y1 = Math.max(y1, p.at[1] + p.size[1])
    }
    const at: Vec3 = tag ? tag.at : [r2((x0 + x1) / 2), y0, r2((z0 + z1) / 2)]
    // How far the piece reaches from where it stands.
    let radius = 0
    for (const p of ps) radius = Math.max(radius, Math.hypot(Math.abs(p.at[0] - at[0]) + p.size[0] / 2, Math.abs(p.at[2] - at[2]) + p.size[2] / 2))
    out.push({ key, parts: ps, at, rot: tag ? tag.rot : (ps[0].rot ?? 0), radius, height: y1 - at[1] })
  }
  return out
}

/** The spot's twin on the other team's half (point-symmetric maps), as a key both share. */
const pairKey = (key: string, [x, , z]: Vec3) => {
  const red = z < 0 || (z === 0 && x <= 0)
  return `${key}@${r2(red ? x : -x)},${r2(red ? z : -z)}`
}

export interface PiecesOptions {
  setting: WizardSetting
  seed: number
  /** The model identity to choose by (the tests pass their own). */
  identify?: Identify
  /** The player's labels, and their version (labels.ts). */
  labels?: GameLabels
  labelsVersion?: number
  /** What each model needs to stand right (cityModules.ts placementOf): single props go only where it allows. */
  rule?: (e: GameObjectEntry) => PlacementRule
}

/** Forms the wizard never places, whatever their role. */
const NOT_PLACED = new Set(['flat', 'line', 'water', 'sky', 'light'])

/** Tallest a base under a model may be (m): a lamp's or a post's foot, not a table or a counter. */
const FOOT_H = 0.6

/** Whether the catalogue says the wizard may place this model: a whole thing (see prepare). */
export function wizardWhole(c: CatalogEntry, e: GameObjectEntry, byId?: Map<string, GameObjectEntry>): boolean {
  if (NOT_PLACED.has(c.form.value) || (c.form.value === 'invisible' && e.tex.length)) return false
  if (c.structure.value === 'top') return !!footOf(e, byId)
  return c.structure.value === 'standalone' || c.structure.value === 'assembly'
}

/** The low foot a model stands on (its most used base), when it is one (see FOOT_H). */
function footOf(e: GameObjectEntry, byId?: Map<string, GameObjectEntry>): GameObjectEntry | null {
  const b = e.bases?.[0] && byId?.get(e.bases[0].id)
  return b && e.bases![0].n >= 0.5 * e.seen && b.size[2] <= FOOT_H && b.size[0] <= Math.max(1.5, e.size[0] * 1.5) ? b : null
}

const frames = new WeakMap<GameObjectEntry[], Map<WizardSetting, FrameLook>>()
/** The frame's game surfaces for a setting, worked out once per library. */
function framesFor(entries: GameObjectEntry[], setting: WizardSetting): FrameLook {
  let m = frames.get(entries)
  if (!m) frames.set(entries, m = new Map())
  let f = m.get(setting)
  if (!f) m.set(setting, f = frameLook(entries, setting))
  return f
}

/** Picks game models for one wizard map; a new one per map (it keeps the palettes and the budget). */
export class GamePieces {
  private readonly lib: Prepared
  private readonly r: Rng
  private tris = 0
  private readonly tex = new Set<string>()
  private readonly palettes = new Map<string, Set<string>>()
  /** Pairs of spots on both halves get the same model. */
  private readonly twins = new Map<string, Cand | null>()
  readonly stats: GamePiecesStats = { buildings: 0, props: 0, lights: 0, fences: 0, kept: 0, triangles: 0, textures: 0, models: 0 }
  /** The game's surfaces for the map's frame: its ground, walls, decks and streets (frame.ts). */
  readonly frame: FrameLook
  /** Whole Stilwater modules for the layout's big areas (wizardModules.ts GameCity), when there are any. */
  city?: CityHooks
  private readonly rule?: (e: GameObjectEntry) => PlacementRule
  private readonly byId = new Map<string, GameObjectEntry>()

  constructor(entries: GameObjectEntry[], o: PiecesOptions) {
    this.lib = prepare(entries, o.setting, o.identify ?? identify, o.labels, o.labelsVersion)
    this.frame = framesFor(entries, o.setting)
    this.rule = o.rule
    for (const e of entries) this.byId.set(e.id, e)
    // Its own random numbers, so the layout stays the one the same seed gives without game pieces.
    this.r = rng((o.seed ^ 0x5bd1e995) >>> 0)
  }

  /** Everything usable at all: false when the library has nothing for this setting. */
  get any() { return this.lib.buildings.length + this.lib.fences.length + [...this.lib.props.values()].reduce((a, l) => a + l.length, 0) > 0 }

  /** Triangles and textures spent on modules and groups (wizardModules.ts), from the same budget. */
  spend(tris: number, tex: Iterable<string>) {
    this.tris += tris
    for (const t of tex) this.tex.add(t.toLowerCase())
    this.stats.triangles = this.tris
    this.stats.textures = this.tex.size
  }

  hasTexture(t: string) { return this.tex.has(t.toLowerCase()) }

  /**
   * Whether a model may go in on its own, standing on the ground: its rule says so, it isn't a kit piece for one
   * building, and whatever it needs comes with it (the parts the game always places with it).
   */
  private loose(c: Cand): boolean {
    const rl = this.rule?.(c.e)
    if (!rl) return true
    // On the ground, not a kit piece, and not something the game keeps up a building's stairs.
    if (rl.attach !== 'ground' || rl.onlyOn?.length || rl.reach) return false
    const has = new Set((c.e.assembly ?? []).map((a) => a.id))
    return (rl.needs ?? []).every((id) => has.has(id) && this.byId.has(id))
  }

  /** A model from `list`: a fitting one (fit > 0), the ones already in use far likelier, within the budget. Null when none. */
  private choose(list: Cand[], palette: string, fit: (c: Cand) => number, copies: number | ((c: Cand) => number), limit = TRI_BUDGET): Cand | null {
    const times = typeof copies === 'number' ? () => copies : copies
    const used = this.palettes.get(palette) ?? new Set<string>()
    const cap = PALETTE[palette] ?? PROP_PALETTE
    const ok: [Cand, number][] = []
    let total = 0
    for (const c of list) {
      const f = fit(c)
      if (f <= 0 || this.tris + c.e.tris * times(c) > limit || !this.loose(c)) continue
      const mine = used.has(c.e.id)
      if (!mine) {
        if (used.size >= cap) continue
        const fresh = new Set(c.e.tex.map((t) => t.toLowerCase()).filter((t) => !this.tex.has(t)))
        if (this.tex.size + fresh.size > TEXTURE_BUDGET) continue
      }
      const w = f * c.weight * (mine ? 6 : 1)
      ok.push([c, w]); total += w
    }
    if (!ok.length) return null
    let x = this.r.next() * total
    const pick = ok.find(([, w]) => (x -= w) <= 0)?.[0] ?? ok[ok.length - 1][0]
    this.use(pick, palette, times(pick))
    return pick
  }

  private use(c: Cand, palette: string, copies: number) {
    const used = this.palettes.get(palette) ?? new Set<string>()
    used.add(c.e.id)
    this.palettes.set(palette, used)
    this.tris += c.e.tris * copies
    for (const t of c.e.tex) this.tex.add(t.toLowerCase())
    this.stats.triangles = this.tris
    this.stats.textures = this.tex.size
    this.stats.models = new Set([...this.palettes.values()].flatMap((s) => [...s])).size
  }

  private standIn(c: Cand, label: string, at: Vec3, rot: number, long: number, short: number, front?: number, look?: Part): Part {
    const part = box(label, [r2(long * M), r2(c.h * M), r2(short * M)], at, look?.top ?? PB.concrete, look?.side ?? PB.concrete, rot)
    return { ...part, game: { id: c.e.id, name: c.id.name, ...(front !== undefined ? { front } : {}) } }
  }

  /**
   * A game building for a plot w × d (units) whose bottom centre is at (x, y, z), or null to keep the site's.
   * `front`: the heading the front should face (0 = +Z, the middle of the map from red's half). `copies`: how many
   * times the map will hold it (2 when the plot is mirrored for the other team). `site`: the site's building for
   * the plot, whose look the stand-in keeps (a model players can see through is built as that plain block instead).
   * `room`: the free ground round the plot, same centre, a game building may take (most of the game's buildings are
   * bigger than the site's plots); with `toFront` it stands against the room's front edge rather than in its middle.
   */
  building(x: number, z: number, w: number, d: number, y = 1, front = 0, copies = 2, site: Part[] = [], room?: { w: number; d: number; toFront?: boolean }): Part | null {
    const rw = Math.max(w, room?.w ?? 0), rd = Math.max(d, room?.d ?? 0)
    const rl = Math.max(rw, rd) / M, rs = Math.min(rw, rd) / M
    const plot = (w * d) / (M * M)
    const c = this.choose(this.lib.buildings, 'building', (c) => {
      const area = c.long * c.short
      if (c.long > rl || c.short > rs || area < MIN_FILL * plot) return 0
      // Bigger and taller blocks more sight lines.
      const fill = area / (rl * rs)
      return fill * fill * Math.min(1, c.h / 10)
    }, copies, TRI_BUDGET * BUILDING_SHARE)
    if (!c) { this.stats.kept++; return null }
    this.stats.buildings += copies
    // Long side along the room's long side; turned round now and then, unless the front decides.
    const rot = (rw >= rd ? 0 : 90) + (this.r.chance(0.5) ? 180 : 0)
    // Against the front edge: moved toward the front by the room the model leaves on that side.
    let [bx, bz] = [x, z]
    if (room?.toFront) {
      const t = (front * Math.PI) / 180, fx = Math.round(Math.sin(t)), fz = Math.round(Math.cos(t))
      const [ex, ez] = rw >= rd ? [c.long * M, c.short * M] : [c.short * M, c.long * M]
      bx += (fx * (rw - ex)) / 2; bz += (fz * (rd - ez)) / 2
    }
    const look = [...site].sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2])[0]
    const part = this.standIn(c, 'Game building', [r2(bx), y, r2(bz)], rot % 360, c.long, c.short, ((front - rot) % 360 + 360) % 360, look)
    const alts = this.alternatives(c)
    if (alts.length) part.game!.alts = alts
    return part
  }

  /**
   * Buildings that fit `c`'s stand-in (no longer, no wider, and filling at least half of it), best first: ones the
   * map already uses, then ones bringing fewest new textures, then how well they suit the setting.
   */
  private alternatives(c: Cand): string[] {
    const used = this.palettes.get('building') ?? new Set<string>()
    const fresh = (x: Cand) => x.e.tex.filter((t) => !this.tex.has(t.toLowerCase())).length
    return this.lib.buildings
      .filter((x) => x !== c && x.long <= c.long + 0.01 && x.short <= c.short + 0.01 && x.long * x.short >= 0.5 * c.long * c.short
        && x.e.tris <= Math.max(1.5 * c.e.tris, 4000) && this.loose(x))
      .map((x) => [x, ((used.has(x.e.id) ? 4 : 1) * x.weight * x.long * x.short) / (1 + fresh(x))] as const)
      .sort((a, b) => b[1] - a[1] || a[0].e.id.localeCompare(b[0].e.id))
      .slice(0, ALTS)
      .map(([x]) => x.e.id)
  }

  /**
   * Game cover for open ground at (x, z): something a player can duck or stand behind (a container, a dumpster, a
   * barrier, a parked vehicle; 1.3 to 3.5 m tall) no wider across than `room` units, turned across `across` (degrees,
   * the heading of the long open run it breaks). Null when nothing fits.
   */
  cover(x: number, z: number, room: number, across: number, copies = 2): Part | null {
    const kinds: PropKind[] = ['cover', 'vehicle', 'machine']
    const fit = (c: Cand) => {
      const h = c.h, reach = Math.hypot(c.long, c.short) / 2 * M, cover = c.cat.measures.cover.value
      // Real cover (the catalogue's: tall enough and solid at eye height, not a see-through rack), not a wall of a thing.
      if (cover === 'none' || h > COVER_H[1] || c.long < 1.5 || reach > room / 2) return 0
      // Long and tall enough to hide behind: the bigger, the more it breaks the run; standing cover most, and a
      // crate players can climb onto a little more (it is high ground too).
      return c.long * Math.min(h, 2.5) * (cover === 'stand' ? 1.5 : 1) * (c.cat.measures.standOn ? 1.2 : 1)
    }
    for (const kind of kinds) {
      const c = this.choose(this.lib.props.get(kind) ?? [], 'cover', fit, copies)
      if (!c) continue
      this.stats.props += copies
      return this.standIn(c, 'Game cover', [r2(x), 1, r2(z)], ((across + 90) % 360 + 360) % 360, c.long, c.short)
    }
    return null
  }

  /** A prop for a spot of this kind that reaches `radius` units from where it stands and is about `height` tall. */
  private propFor(spot: Extract<Spot, { role: 'prop' }>, radius: number, height: number, copies: number, light = false, key = ''): Cand | null {
    const label = ALL_PREFABS[key]?.label ?? key
    const fit = (c: Cand) => {
      const reach = (Math.hypot(c.long, c.short) / 2) * M, h = c.h * M
      if (reach > radius * 1.15 + 0.5 || h > Math.max(height * 1.6, height + 2) || h < height * 0.35) return 0
      // The same kind of thing as the site's piece (a dumpster for a dumpster) far likelier than one only its size.
      return (1 + Math.min(1, reach / Math.max(0.5, radius))) * (key && sameKind(key, label, [c.e.name, c.id.name]) ? 6 : 1)
    }
    for (const kind of spot.kinds) {
      const c = this.choose(this.lib.props.get(kind) ?? [], light ? 'light' : 'prop:' + kind, fit, copies)
      if (c) return c
    }
    return null
  }

  /**
   * Fence runs along a wall (a yard wall) w × d units at (x, y, z), copies of one fence model end to end; null to
   * keep the wall. Only fences at least `minH` units tall.
   */
  fence(x: number, z: number, w: number, d: number, y: number, minH: number, copies = 2): Part[] | null {
    const len = Math.max(w, d) / M
    const runs = (c: Cand) => Math.max(1, Math.ceil(len / c.long - 1e-6))
    const c = this.choose(this.lib.fences, 'fence', (c) => (c.long <= len && c.h * M >= minH && c.long >= len / 6 ? c.long / len : 0), (c) => copies * runs(c))
    if (!c) { this.stats.kept++; return null }
    const n = runs(c)
    const along = w >= d, step = n > 1 ? (len - c.long) / (n - 1) : 0
    const out: Part[] = []
    for (let k = 0; k < n; k++) {
      const t = (n > 1 ? -len / 2 + c.long / 2 + k * step : 0) * M
      out.push(this.standIn(c, 'Game fence', [r2(along ? x + t : x), y, r2(along ? z : z + t)], along ? 0 : 90, c.long, c.short))
    }
    this.stats.fences += n * copies
    return out
  }

  /**
   * After dressing: the site's props, plants, wrecks, lights and fences become game models where one fits, the
   * street lamps of any road among them; the rest stay. Spots on both halves get the same model.
   */
  swap(s: Sample): Sample {
    const drop = new Set<Part>()
    const add: Part[] = []
    const pieces = piecesOf(s.parts).sort((a, b) => pairKey(a.key, a.at).localeCompare(pairKey(b.key, b.at)) || a.at[2] - b.at[2])
    for (const p of pieces) {
      const spot = SPOTS[p.key]
      const k = pairKey(p.key, p.at)
      const centre = Math.hypot(p.at[0], p.at[2]) < 0.01
      let c: Cand | null | undefined = this.twins.get(k)
      if (c === undefined) {
        const copies = centre ? 1 : 2
        c = spot.role === 'fence'
          ? this.choose(this.lib.fences, 'fence', (c) => {
            const reach = (Math.hypot(c.long, c.short) / 2) * M
            return reach <= p.radius * 1.1 + 0.5 && c.h * M <= Math.max(p.height * 1.6, p.height + 2) && c.h * M >= p.height * 0.4 ? 1 : 0
          }, copies)
          : this.propFor(spot, p.radius, p.height, copies, spot.kinds[0] === 'light', p.key)
        this.twins.set(k, c)
        if (!c) this.stats.kept += copies
        else if (spot.role === 'fence') this.stats.fences += copies
        else if (spot.kinds[0] === 'light') this.stats.lights += copies
        else this.stats.props += copies
      }
      if (!c) continue
      const made = this.placeLoose(c, spot.role === 'fence' ? 'Game fence' : 'Game prop', p.at, p.rot, s.parts, p.parts)
      // No way to stand it as its rule asks here: the site's piece stays.
      if (!made) { this.stats.kept++; continue }
      p.parts.forEach((q) => drop.add(q))
      add.push(...made)
    }
    const lamps = this.lamps(s.parts)
    lamps.drop.forEach((q) => drop.add(q))
    add.push(...lamps.add)
    if (!drop.size) return s
    const parts = s.parts.filter((q) => !drop.has(q)).map((q) => (lamps.roads.has(q) ? { ...q, prefab: { ...q.prefab!, params: { ...q.prefab!.params, lamps: 0 } } } : q))
    return { ...s, parts: [...parts, ...add] }
  }

  /**
   * Stand-ins for a single model at a site piece's spot, as its rule asks: turned only if it may be, the floor in
   * front of it clear, and the models it needs placed with it, where the game places them. Null when it can't stand
   * there. `parts`: the map so far; `own`: the site piece it replaces (not in the way).
   */
  private placeLoose(c: Cand, label: string, at: Vec3, rot: number, parts: Part[], own: Part[]): Part[] | null {
    // On its foot: the base where the game puts it, and on it one of the variations the game stands there (the same
    // one on both halves of the map, by where it stands), each exactly where the game has it on that base.
    const foot = c.cat.structure.value === 'top' ? footOf(c.e, this.byId) : null
    if (foot) {
      const variants = (foot.tops ?? []).filter((t) => t.n >= Math.max(2, 0.1 * foot.seen) && this.byId.has(t.id) && this.canStand(this.byId.get(t.id)!, c.e))
      const pick = variants.length ? variants[(Math.round(Math.abs(at[0])) * 31 + Math.round(Math.abs(at[2]))) % variants.length] : null
      const top = pick ? this.byId.get(pick.id)! : c.e
      const off = pick ?? foot.tops?.find((t) => t.id === c.e.id)
      if (off) {
        const [dx, dz] = turn(-off.at[0] * M, off.at[2] * M, rot)
        if (top !== c.e) this.spend(top.tris, top.tex)
        this.spend(foot.tris, foot.tex)
        return [exactStandIn(foot, label, at, rot), exactStandIn(top, label, [at[0] + dx, at[1] + off.at[1] * M, at[2] + dz], rot + (off.yaw * 180) / Math.PI)]
      }
    }
    const rl = this.rule?.(c.e)
    if (!rl || (!rl.needs?.length && !rl.clearFront)) return [this.standIn(c, label, at, rot, c.long, c.short)]
    const turns = rl.mayVary.includes('turn') ? [0, 90, 180, 270] : [0]
    for (const t of turns) {
      const r = (rot + t) % 360
      if (rl.clearFront && !this.clearAhead(c.e, rl, at, r, parts, own)) continue
      const out = [exactStandIn(c.e, label, at, r)]
      for (const id of rl.needs ?? []) {
        const a = c.e.assembly!.find((q) => q.id === id)!, e = this.byId.get(id)!
        const [dx, dz] = turn(-a.at[0] * M, a.at[2] * M, r)
        out.push(exactStandIn(e, label, [at[0] + dx, at[1] + a.at[1] * M, at[2] + dz], r + (a.yaw * 180) / Math.PI))
        this.spend(e.tris, e.tex)
      }
      return out
    }
    return null
  }

  /** Whether a variation on a base may stand in for the model chosen (whole, and about its size: a street lamp for a street lamp). */
  private canStand(v: GameObjectEntry, chosen: GameObjectEntry): boolean {
    return v.size[2] >= chosen.size[2] * 0.6 && v.size[2] <= chosen.size[2] * 1.6 && v.size[0] <= chosen.size[0] * 2 + 0.5 && v.tris <= MAX_PROP_TRIS
  }

  /** Clear floor `clearFront` metres out from the model's front (every side, when its rule doesn't say which is the front). */
  private clearAhead(e: GameObjectEntry, rl: PlacementRule, at: Vec3, rot: number, parts: Part[], own: Part[]): boolean {
    const [l, s] = e.size
    const [hx, hz] = e.long === 'z' ? [s / 2, l / 2] : [l / 2, s / 2]
    const mine = new Set(own)
    const sides: Side[] = rl.facing ? [rl.facing] : ['+x', '-x', '+z', '-z']
    for (const side of sides) {
      const [fx, fz] = facingVec(side, rot)
      // Across the front: the model's own width that way.
      const half = (side === '+x' || side === '-x' ? hz : hx) * M, reach = (side === '+x' || side === '-x' ? hx : hz) * M
      const [ax, az] = [-fz, fx]
      for (let d = reach + 0.5; d <= reach + (rl.clearFront ?? 0) * M; d += 1) for (let w = -half; w <= half + 1e-6; w += Math.max(0.5, half)) {
        const x = at[0] + fx * d + ax * w, z = at[2] + fz * d + az * w
        if (parts.some((q) => !mine.has(q) && q.at[1] < at[1] + 3.4 && q.at[1] + q.size[1] > at[1] + 0.35 && over(q, x, z, 0))) return false
      }
    }
    return true
  }

  /** A road's lamp posts become one game street light, standing where each lamp stood. */
  private lamps(parts: Part[]): { drop: Part[]; add: Part[]; roads: Set<Part> } {
    const road = parts.filter((q) => q.prefab?.key === 'road')
    const posts = road.filter((q) => /^Lamp (base|post|arm|head)$/.test(q.label))
    const bases = posts.filter((q) => q.label === 'Lamp base')
    if (!bases.length) return { drop: [], add: [], roads: new Set() }
    const height = Math.max(...posts.map((q) => q.at[1] + q.size[1])) - bases[0].at[1]
    const fit = (c: Cand) => {
      const reach = (Math.hypot(c.long, c.short) / 2) * M, h = c.h * M
      return reach <= 4 && h >= height * 0.5 && h <= height * 2 ? 1 : 0
    }
    // One model for every lamp: its triangles counted for all of them.
    const c = this.choose(this.lib.props.get('light') ?? [], 'light', fit, bases.length)
    if (!c) { this.stats.kept += bases.length; return { drop: [], add: [], roads: new Set() } }
    this.stats.lights += bases.length
    return {
      drop: posts,
      add: bases.flatMap((b) => this.placeLoose(c, 'Game light', b.at, b.rot ?? 0, parts, posts) ?? []),
      roads: new Set(road.filter((q) => !posts.includes(q))),
    }
  }
}

/** A stand-in's footprint across X and Z (units), as it stands. */
export const footprint = (p: Pick<Part, 'size' | 'rot'>): [number, number] => ((p.rot ?? 0) % 180 === 90 ? [p.size[2], p.size[0]] : [p.size[0], p.size[2]])

/** The stand-ins in a map, by model, for the build and the tests. */
export const gameParts = (s: Pick<Sample, 'parts'>) => s.parts.filter((p) => p.game)
