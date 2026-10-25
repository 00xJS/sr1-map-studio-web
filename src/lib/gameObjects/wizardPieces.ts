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
import { rng, type Rng, type WizardSetting } from '../mapWizard'
import { UNITS_PER_M } from '../player'
import { identify, type BuildingFacts, type GameIdentity, type PropKind } from './identity'
import type { GameObjectEntry } from './indexer'
import { withLabels, type GameLabels } from './labels'

/** What a stand-in stands for. */
export interface GamePart {
  /** The library entry. */
  id: string
  /** Its plain name. */
  name: string
  /** Buildings: the heading (degrees, 0 = the stand-in's own +Z) the model's front should face. */
  front?: number
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
const PALETTE: Record<string, number> = { building: 8, fence: 2, light: 1 }
const PROP_PALETTE = 3
/** Heaviest single model worth placing, in triangles. */
const MAX_BUILDING_TRIS = 24_000
const MAX_PROP_TRIS = 4_000
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
  picketfence: FENCE, srchainlink: FENCE, chainfence: FENCE, hedge: FENCE, barricade: FENCE, roadbarricade: FENCE, lowwall: FENCE, jersey: FENCE,
  sandbagwall: FENCE, hesco: FENCE, twall: FENCE,
}

const M = UNITS_PER_M
const r2 = (v: number) => +v.toFixed(2)

export interface Cand {
  e: GameObjectEntry
  id: GameIdentity
  /** Metres: long side, short side, height. */
  long: number; short: number; h: number
  /** How well it suits the setting, times how much the game uses it. */
  weight: number
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
  for (const e of entries) {
    const id = ident(e), l = labels?.[e.id]
    if (id.role !== 'building' && id.role !== 'prop' && id.role !== 'fence') continue
    // The name rules stand in for a player's check until there is one.
    if (!l?.ok && !l?.role && (id.role !== 'building' ? PART_NAMES.has(id.name) : NOT_BUILDINGS.has(id.name))) continue
    if (id.role === 'building' && l?.cover !== undefined && l.cover < SOLID_COVER) continue
    const [a, b, h] = id.role === 'building' && id.building ? [...id.building.footprint, id.building.height] : e.size
    // A building is fitted with a margin all round: its footprint can come out a little smaller than the model cut out.
    const pad = id.role === 'building' ? 2 * BUILDING_MARGIN : 0
    const long = Math.max(a, b) + pad, short = Math.min(a, b) + pad
    const suits = id.settings.includes(setting) ? 2 : id.settings.length ? 0.3 : 1
    const c: Cand = { e, id, long, short, h, weight: suits * (1 + Math.log10(1 + e.seen) / 2) * (l?.ok || l?.role ? 3 : 1) }
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

  constructor(entries: GameObjectEntry[], o: PiecesOptions) {
    this.lib = prepare(entries, o.setting, o.identify ?? identify, o.labels, o.labelsVersion)
    // Its own random numbers, so the layout stays the one the same seed gives without game pieces.
    this.r = rng((o.seed ^ 0x5bd1e995) >>> 0)
  }

  /** Everything usable at all: false when the library has nothing for this setting. */
  get any() { return this.lib.buildings.length + this.lib.fences.length + [...this.lib.props.values()].reduce((a, l) => a + l.length, 0) > 0 }

  /** A model from `list`: a fitting one (fit > 0), the ones already in use far likelier, within the budget. Null when none. */
  private choose(list: Cand[], palette: string, fit: (c: Cand) => number, copies: number | ((c: Cand) => number), limit = TRI_BUDGET): Cand | null {
    const times = typeof copies === 'number' ? () => copies : copies
    const used = this.palettes.get(palette) ?? new Set<string>()
    const cap = PALETTE[palette] ?? PROP_PALETTE
    const ok: [Cand, number][] = []
    let total = 0
    for (const c of list) {
      const f = fit(c)
      if (f <= 0 || this.tris + c.e.tris * times(c) > limit) continue
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
    return this.standIn(c, 'Game building', [r2(bx), y, r2(bz)], rot % 360, c.long, c.short, ((front - rot) % 360 + 360) % 360, look)
  }

  /** A prop for a spot of this kind that reaches `radius` units from where it stands and is about `height` tall. */
  private propFor(spot: Extract<Spot, { role: 'prop' }>, radius: number, height: number, copies: number, light = false): Cand | null {
    const fit = (c: Cand) => {
      const reach = (Math.hypot(c.long, c.short) / 2) * M, h = c.h * M
      if (reach > radius * 1.15 + 0.5 || h > Math.max(height * 1.6, height + 2) || h < height * 0.35) return 0
      return 1 + Math.min(1, reach / Math.max(0.5, radius))
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
          : this.propFor(spot, p.radius, p.height, copies, spot.kinds[0] === 'light')
        this.twins.set(k, c)
        if (!c) this.stats.kept += copies
        else if (spot.role === 'fence') this.stats.fences += copies
        else if (spot.kinds[0] === 'light') this.stats.lights += copies
        else this.stats.props += copies
      }
      if (!c) continue
      p.parts.forEach((q) => drop.add(q))
      add.push(this.standIn(c, spot.role === 'fence' ? 'Game fence' : 'Game prop', p.at, p.rot, c.long, c.short))
    }
    const lamps = this.lamps(s.parts)
    lamps.drop.forEach((q) => drop.add(q))
    add.push(...lamps.add)
    if (!drop.size) return s
    const parts = s.parts.filter((q) => !drop.has(q)).map((q) => (lamps.roads.has(q) ? { ...q, prefab: { ...q.prefab!, params: { ...q.prefab!.params, lamps: 0 } } } : q))
    return { ...s, parts: [...parts, ...add] }
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
      add: bases.map((b) => this.standIn(c, 'Game light', b.at, b.rot ?? 0, c.long, c.short)),
      roads: new Set(road.filter((q) => !posts.includes(q))),
    }
  }
}

/** A stand-in's footprint across X and Z (units), as it stands. */
export const footprint = (p: Pick<Part, 'size' | 'rot'>): [number, number] => ((p.rot ?? 0) % 180 === 90 ? [p.size[2], p.size[0]] : [p.size[0], p.size[2]])

/** The stand-ins in a map, by model, for the build and the tests. */
export const gameParts = (s: Pick<Sample, 'parts'>) => s.parts.filter((p) => p.game)
