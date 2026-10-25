// The new map wizard's "Game pieces", built the way Stilwater is built (cityModules.ts): the layout decides only the
// map's shape and fairness (its size, streets or lanes, spawns, mirroring, how busy), and its big areas are filled
// with whole city modules, real pieces of Stilwater kept exactly as the game placed them. Modules stand in rows
// facing the streets, joined edge to edge only where their edges suit each other (street to street, back to
// back) and their openings line up; anywhere else an alley is left between them. Open ground and cover come from
// the groups the game keeps placing together (on the ground, or with their back to a module's wall), and single
// props come last, only where their placement rule allows (wizardPieces.ts swap).
//
// Everything goes in as stand-in boxes (Parts with `game`, `exact`), so the passes that follow (dressing, spawns,
// weapons, lights) work round them; the map builder puts each model exactly where its stand-in says
// (wizardBuild.ts). Until the Stilwater study fills cityModules(), there is nothing to build from and the wizard
// falls back to single game models in the layout's own plots (wizardPieces.ts), as before.
import { PB, box, mirror, turn, type Part } from '../sampleKit'
import { KEEP_OUT, busyness, busyOf, rng, type Half, type Rng, type WizardOptions, type WizardSetting } from '../mapWizard'
import { UNITS_PER_M } from '../player'
import { cityModules, groups as cityGroups, type CityGroup, type CityModule, type EdgeKind, type ModuleEdge, type ModulePart, type PlacementRule, type Side } from './cityModules'
import type { GameObjectEntry } from './indexer'
import { placementRules } from './placement'
import { withCityLabels, withPlacementLabels, type CityLabels } from './labels'
import { GamePieces, TEXTURE_BUDGET, TRI_BUDGET, exactStandIn, type CityHooks, type PiecesOptions } from './wizardPieces'

const M = UNITS_PER_M
const EPS = 0.05
const r2 = (v: number) => +v.toFixed(2)

/** Narrowest gap (units) players can use between two modules that don't join: an alley. */
export const ALLEY = 3 * M
/** Least overlap (units) for two openings to count as lined up. */
const PASS = 1 * M
/** Metres up or down a player gets from one level to the next without stairs (a jump, a drop onto a ledge). */
const JUMP = 1.2
/** Units a module with a fenced-off level keeps from a neighbour players could jump across from. */
const FENCE_GAP = 4 * M
/** Share of the triangle budget modules may take, so groups and props are left some. */
const MODULE_SHARE = 0.75
/** Most distinct modules in one map (reusing a few is cheaper to export than many used once). */
const MODULE_PALETTE = 6
const GROUP_PALETTE = 6
/** Tallest single wall thing that goes in standing on the ground, where its rule gives no height to hang it at. */
const WALL_PROP_MAX_H = 2.5
/** Street width (metres) between areas, per setting. */
const STREET: Record<WizardSetting, number> = {
  downtown: 11, rundown: 10, suburbs: 10, industrial: 10, docks: 10, construction: 9, military: 9, paintball: 7, cyber: 8,
}
/** Block width to aim for (metres) when splitting red's half into areas. */
const BLOCK: Record<WizardSetting, number> = {
  downtown: 34, rundown: 30, suburbs: 30, industrial: 34, docks: 34, construction: 30, military: 28, paintball: 22, cyber: 24,
}

// ---------------- directions ----------------

/** World directions in the editor: east +X, west −X, south +Z (the middle, from red's half), north −Z. */
export type Dir = 'E' | 'W' | 'S' | 'N'
const OPP: Record<Dir, Dir> = { E: 'W', W: 'E', S: 'N', N: 'S' }
const DIRS: Dir[] = ['E', 'W', 'S', 'N']
const SIDES: Side[] = ['+x', '-x', '+z', '-z']
const dirOf = (x: number, z: number): Dir => (Math.abs(x) > Math.abs(z) ? (x > 0 ? 'E' : 'W') : z > 0 ? 'S' : 'N')

/** A game-frame point (metres, in a module's or group's own frame) in the editor, turned `rot` about its origin (units). */
export function gamePoint(gx: number, gz: number, rot: number): [number, number] {
  // The game's +X is the editor's −X (models are mirrored into editor space); turns carry over as they are.
  return turn(-gx * M, gz * M, rot)
}

/** The way a side of a module (its own frame) faces once the module stands turned `rot`. */
export function sideDir(side: Side, rot: number): Dir {
  const [gx, gz] = ({ '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] } as const)[side]
  return dirOf(...gamePoint(gx, gz, rot))
}

/** The turn (0, 90, 180, 270) that makes `side` face `want`. */
export const rotFor = (side: Side, want: Dir) => [0, 90, 180, 270].find((r) => sideDir(side, r) === want)!

/** The side of a thing turned `rot` that faces `want`. */
export const sideFacing = (rot: number, want: Dir) => SIDES.find((s) => sideDir(s, rot) === want)!

const along = (d: Dir) => (d === 'N' || d === 'S' ? 0 : 2)

// ---------------- placed modules ----------------

export interface Rect { x0: number; x1: number; z0: number; z1: number }

/** A module standing on red's half: its middle (units), turn, and footprint as it stands. */
export interface Placed extends Rect {
  m: CityModule
  rot: number
  x: number
  z: number
  /** The area it was placed in (index into the frame's areas). */
  area: number
}

const rectOf = (x: number, z: number, w: number, d: number): Rect => ({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 })

/** A module's footprint (units, across X and Z) standing turned `rot`. */
export function footprintOf(size: [number, number], rot: number): [number, number] {
  const [w, d] = [size[0] * M, size[1] * M]
  return rot % 180 === 90 ? [d, w] : [w, d]
}

export const edgeOf = (m: Pick<CityModule, 'edges'>, side: Side): ModuleEdge =>
  m.edges.find((e) => e.side === side) ?? { side, kind: 'wall', openings: [] }

/** A placed module's edge facing `dir`, with its openings as spans along that side (world units: X for N/S, Z for E/W). */
export function edgeToward(p: Placed, dir: Dir): { kind: EdgeKind; spans: [number, number][]; from: number; to: number; at: number } {
  const side = sideFacing(p.rot, dir), e = edgeOf(p.m, side)
  const [sx, sz] = p.m.size
  const k = along(dir)
  const spans = e.openings.map((o): [number, number] => {
    const [gx, gz] = side === '+x' ? [sx / 2, o.at] : side === '-x' ? [-sx / 2, o.at] : side === '+z' ? [o.at, sz / 2] : [o.at, -sz / 2]
    const [dx, dz] = gamePoint(gx, gz, p.rot)
    const c = k === 0 ? p.x + dx : p.z + dz
    return [c - (o.width * M) / 2, c + (o.width * M) / 2]
  })
  const [from, to] = k === 0 ? [p.x0, p.x1] : [p.z0, p.z1]
  const at = dir === 'E' ? p.x1 : dir === 'W' ? p.x0 : dir === 'S' ? p.z1 : p.z0
  return { kind: e.kind, spans, from, to, at }
}

/** Which edge kinds may touch: street to street, back to back, a yard against a wall. */
export const JOIN: Record<EdgeKind, EdgeKind[]> = {
  street: ['street', 'sidewalk', 'open'],
  sidewalk: ['street', 'sidewalk', 'open'],
  alley: ['alley', 'open', 'yard'],
  yard: ['yard', 'wall', 'open', 'alley'],
  wall: ['wall', 'yard'],
  open: ['street', 'sidewalk', 'alley', 'yard', 'open'],
  water: ['water'],
}

const overlap = (a: [number, number], b: [number, number]) => Math.min(a[1], b[1]) - Math.max(a[0], b[0])

/**
 * Whether openings in `mine` (spans) still let players through where the side meets a neighbour over `shared`:
 * each opening either reaches past the neighbour by a player's width or lines up with one of the neighbour's.
 */
function openingsMeet(mine: [number, number][], theirs: [number, number][], shared: [number, number]): boolean {
  return mine.every((o) => {
    const inside = Math.max(0, overlap(o, shared))
    if (inside <= EPS) return true
    if (o[1] - o[0] - inside >= PASS) return true
    return theirs.some((t) => overlap(o, t) >= Math.min(PASS, o[1] - o[0] - EPS))
  })
}

/** Gap between two footprints (negative: they overlap), and whether they face each other across it. */
function apart(a: Rect, b: Rect): { gap: number; dir: Dir | null; shared: [number, number] } {
  const gx = Math.max(b.x0 - a.x1, a.x0 - b.x1), gz = Math.max(b.z0 - a.z1, a.z0 - b.z1)
  if (gx >= gz) {
    const shared: [number, number] = [Math.max(a.z0, b.z0), Math.min(a.z1, b.z1)]
    return { gap: gx, dir: shared[1] - shared[0] > EPS ? (b.x0 >= a.x1 - EPS ? 'E' : 'W') : null, shared }
  }
  const shared: [number, number] = [Math.max(a.x0, b.x0), Math.min(a.x1, b.x1)]
  return { gap: gz, dir: shared[1] - shared[0] > EPS ? (b.z0 >= a.z1 - EPS ? 'S' : 'N') : null, shared }
}

/** Two placed modules side by side: may they touch where they do? Kinds that suit each other, and openings that meet. */
export function joinOk(a: Placed, b: Placed): boolean {
  const { dir, shared } = apart(a, b)
  if (!dir) return true
  const ea = edgeToward(a, dir), eb = edgeToward(b, OPP[dir])
  if (!JOIN[ea.kind].includes(eb.kind)) return false
  return openingsMeet(ea.spans, eb.spans, shared) && openingsMeet(eb.spans, ea.spans, shared)
}

/** Levels players can get up to, and those fenced off, as heights above the module's ground (metres). */
const levels = (m: CityModule) => m.levels.map((l) => ({ h: l.height - m.floor[0], open: l.reach !== 'none' }))

/** A fenced-off level on one within reach (a jump up or across) of a level players get to on the other. */
function fencedReach(a: CityModule, b: CityModule): boolean {
  const la = levels(a), lb = levels(b)
  const hit = (x: typeof la, y: typeof lb) => x.some((f) => !f.open && f.h > JUMP && y.some((o) => o.open && o.h >= f.h - JUMP))
  return hit(la, lb) || hit(lb, la)
}

// ---------------- the frame: areas to fill, from the layout ----------------

/** What lies beyond an area's side: a street (or other open ground players use), or the map's outer wall. */
export type Beyond = 'lane' | 'edge'

export interface Area extends Rect {
  sides: Record<Dir, Beyond>
  /** Left open: a park or square (groups only). */
  park?: boolean
}

/**
 * Red's half split into areas for modules, with streets between them, from the wizard's layout; null for layouts
 * with no big areas (arena, maze, cover field), which keep the layout's own pieces.
 */
export function cityFrame(h: Pick<Half, 'W' | 'D' | 'strip'>, o: Pick<WizardOptions, 'layout' | 'setting'>): Area[] | null {
  const { W, D, strip } = h
  const X = W / 2 - 3, zBot = -D / 2 + strip + 2
  const S = STREET[o.setting] * M, B = BLOCK[o.setting] * M
  const side = (x0: number, x1: number, z0: number, z1: number): Area => ({
    x0, x1, z0, z1, sides: { W: x0 <= -X + EPS ? 'edge' : 'lane', E: x1 >= X - EPS ? 'edge' : 'lane', S: 'lane', N: 'lane' },
  })
  /** Columns across [a, b], streets between; rows down [z0, z1], a back street between when deep enough. */
  const grid = (a: number, b: number, z0: number, z1: number, cols?: number): Area[] => {
    // At least two across where there's room, so a cross street always runs from the spawns to the middle.
    const n = cols ?? Math.max((b - a - S) / 2 >= 12 * M ? 2 : 1, Math.round((b - a + S) / (B + S)))
    const cw = (b - a - (n - 1) * S) / n
    const deep = z1 - z0 > 2 * 26 * M + S
    const rows: [number, number][] = deep ? [[z0, (z0 + z1 - S) / 2], [(z0 + z1 + S) / 2, z1]] : [[z0, z1]]
    const out: Area[] = []
    for (let i = 0; i < n; i++) for (const [r0, r1] of rows) if (cw >= 8 * M && r1 - r0 >= 8 * M) out.push(side(a + i * (cw + S), a + i * (cw + S) + cw, r0, r1))
    return out
  }
  switch (o.layout) {
    case 'blocks': case 'compounds': case 'heights':
      // An avenue across the middle (half of it on each side), blocks between cross streets.
      return grid(-X, X, zBot, -S / 2)
    case 'neighbourhood': {
      const areas = grid(-X, X, zBot, -S / 2)
      // One block is the park (open ground and groups), as the site's neighbourhood has.
      if (areas.length >= 3) areas[Math.floor(areas.length / 2)].park = true
      return areas
    }
    case 'crossroads':
      // Two wide streets crossing in the middle: a corner block each side of the north-south one.
      return [...grid(-X, -S, zBot, -S, 1), ...grid(S, X, zBot, -S, 1)]
    case 'plaza': {
      // An open square in the middle, blocks round it: a back row, and a block each side reaching toward the middle.
      const R = Math.min(W, D) * 0.22
      const back = grid(-X, X, zBot, -R)
      const sides = X - R - S >= 12 * M ? [...grid(-X, -R - S / 2, -R + S, -S / 2, 1), ...grid(R + S / 2, X, -R + S, -S / 2, 1)] : []
      return [...back, ...sides]
    }
    case 'lanes': {
      // Two long rows of blocks splitting the map into three lanes, with crossings between blocks.
      const aw = Math.max(12 * M, Math.min(24 * M, W / 5))
      const out: Area[] = []
      for (const sx of [-1, 1]) {
        const cx = (sx * W) / 5
        out.push(...grid(cx - aw / 2, cx + aw / 2, zBot, -S / 2, 1).flatMap((a) => {
          // Long areas are cut with crossings every 40 m or so.
          const n = Math.max(1, Math.round((a.z1 - a.z0 + S) / (40 * M + S))), len = (a.z1 - a.z0 - (n - 1) * S) / n
          return [...Array(n)].map((_, k): Area => ({ ...a, z0: a.z0 + k * (len + S), z1: a.z0 + k * (len + S) + len, sides: { ...a.sides, E: 'lane', W: 'lane' } }))
        }))
      }
      return out
    }
    default:
      return null
  }
}

// ---------------- the library, sorted for the wizard ----------------

interface ModuleCand {
  m: CityModule
  tris: number
  tex: Set<string>
  /** How well it suits the setting. */
  weight: number
}

interface GroupCand { g: CityGroup; tris: number; tex: Set<string>; weight: number }

export interface CityStats {
  /** Modules placed (both halves), and how many different ones. */
  modules: number
  kinds: number
  groups: number
  wallProps: number
  /** Areas left open (a park, how busy, nothing fitting, or the budget spent). */
  open: number
  triangles: number
  textures: number
  /** The modules' names, most used first. */
  names: string[]
}

export interface CityOptions extends PiecesOptions {
  /** What to build from (the tests pass their own; by default the Stilwater study's, cityModules.ts). */
  modules?: CityModule[]
  groups?: CityGroup[]
  rule?: (e: GameObjectEntry) => PlacementRule
  /** The player's corrections to modules and groups (labels.ts: the ones marked wrong are left out). */
  cityLabels?: CityLabels
}

/** Every model's placement rule, worked out once per library (placement.ts), with the player's corrections. */
const rulesFor = new WeakMap<GameObjectEntry[], Map<string, PlacementRule>>()
function libraryRule(entries: GameObjectEntry[], o: CityOptions): (e: GameObjectEntry) => PlacementRule {
  let rules = rulesFor.get(entries)
  if (!rules) rulesFor.set(entries, rules = placementRules(entries))
  const base = (e: GameObjectEntry) => rules!.get(e.id) ?? { attach: 'ground', mayVary: ['turn'] } as PlacementRule
  return o.labels ? withPlacementLabels(o.labels, base) : base
}

/** A group standing on red's half. */
export interface PlacedGroup extends Rect { g: CityGroup; rot: number; x: number; z: number; wall?: Dir }

/**
 * Builds wizard maps from city modules and groups; a new one per map (it keeps the palettes and the budget). Its
 * `pieces` go to wizardSample(): they fill the layout's areas with modules (fill), and fall back to single game
 * models in the layout's own plots when there is nothing to build from.
 */
export class GameCity implements CityHooks {
  readonly pieces: GamePieces
  readonly stats: CityStats = { modules: 0, kinds: 0, groups: 0, wallProps: 0, open: 0, triangles: 0, textures: 0, names: [] }
  /** What the build found wrong, in plain words (shown in the wizard's summary). */
  readonly problems: string[] = []
  /** Red's half, as placed (the tests look at it). */
  readonly placed: Placed[] = []
  readonly placedGroups: PlacedGroup[] = []
  areas: Area[] = []
  /** Whether the last map was built from modules (false: it fell back to single game models). */
  used = false
  private readonly lib = new Map<string, GameObjectEntry>()
  private readonly modules: ModuleCand[]
  private readonly groupList: GroupCand[]
  /** Each model's placement rule (placement.ts, with the player's corrections). */
  readonly rule: (e: GameObjectEntry) => PlacementRule
  private readonly r: Rng
  private readonly palette = new Map<string, number>()
  private readonly groupPalette = new Set<string>()

  constructor(entries: GameObjectEntry[], o: CityOptions) {
    for (const e of entries) this.lib.set(e.id, e)
    this.rule = o.rule ?? libraryRule(entries, o)
    this.pieces = new GamePieces(entries, { ...o, rule: this.rule })
    this.pieces.city = this
    this.r = rng((o.seed ^ 0x2c1b3c6d) >>> 0)
    const suits = (s: WizardSetting[]) => (s.includes(o.setting) ? 2 : s.length ? 0 : 1)
    const cost = (parts: ModulePart[]) => {
      const tex = new Set<string>()
      let tris = 0
      for (const p of parts) {
        const e = this.lib.get(p.id)
        if (!e) return null
        tris += e.tris
        for (const t of e.tex) tex.add(t.toLowerCase())
      }
      return { tris, tex }
    }
    this.modules = []
    const cl = o.cityLabels
    for (const m of o.modules ?? (cl ? withCityLabels(cityModules(entries), cl.modules) : cityModules(entries))) {
      const c = cost(m.parts), weight = suits(m.settings)
      // Every part must be in this player's library, or the module isn't whole.
      if (!c || !weight || !m.parts.length) continue
      this.modules.push({ m, tris: Math.max(m.tris, c.tris), tex: c.tex, weight })
    }
    this.groupList = []
    for (const g of o.groups ?? (cl ? withCityLabels(cityGroups(entries), cl.groups) : cityGroups(entries))) {
      const c = cost(g.parts), weight = suits(g.settings)
      if (!c || !weight || !g.parts.length || g.anchor === 'roof') continue
      this.groupList.push({ g, tris: c.tris, tex: c.tex, weight: weight * (1 + Math.log10(1 + g.seen) / 2) })
    }
  }

  /** Anything to build from for this setting: false until the Stilwater study fills cityModules(). */
  get ready() { return this.modules.length > 0 }

  // ---- budget ----

  private fits(tris: number, tex: Set<string>, share = 1) {
    const st = this.pieces.stats
    if (st.triangles + tris > TRI_BUDGET * share) return false
    let fresh = 0
    for (const t of tex) if (!this.pieces.hasTexture(t)) fresh++
    return st.textures + fresh <= TEXTURE_BUDGET
  }

  keepOut(): Part[] {
    if (!this.used) return []
    return mirror(...this.placed.map((p) => box(KEEP_OUT, [r2(p.x1 - p.x0), 8, r2(p.z1 - p.z0)], [r2(p.x), 1, r2(p.z)], PB.concrete)))
  }

  // ---- filling the layout ----

  fill(h: Half, o: WizardOptions): boolean {
    this.used = false
    if (!this.ready) return false
    const areas = cityFrame(h, o)
    if (!areas?.length) return false
    this.areas = areas
    const fill = busyness(busyOf(o)).fill
    // Busier maps build on more of their areas; the rest are open lots.
    const build = Math.min(1, fill + (o.layout === 'heights' ? 0.05 : 0.35))
    areas.forEach((a, i) => {
      if (a.park || !this.r.chance(build)) { this.stats.open++; return }
      if (!this.fillArea(a, i)) this.stats.open++
    })
    if (!this.placed.length) return false
    this.used = true
    for (const p of this.placed) h.take({ x: p.x, z: p.z, w: p.x1 - p.x0, d: p.z1 - p.z0 })
    this.placeGroups(h, fill)
    this.wallProps(h, fill)
    this.check(h)
    for (const p of this.placed) h.parts.push(...this.standIns(p.m.parts, p.x, p.z, 1 - p.m.floor[0] * M, p.rot, p.m.name))
    for (const g of this.placedGroups) h.parts.push(...this.standIns(g.g.parts, g.x, g.z, 1, g.rot, g.g.name))
    const counts = [...this.palette.entries()].sort((a, b) => b[1] - a[1])
    this.stats.kinds = counts.length
    this.stats.names = counts.map(([id]) => this.modules.find((c) => c.m.id === id)!.m.name)
    this.stats.triangles = this.pieces.stats.triangles
    this.stats.textures = this.pieces.stats.textures
    return true
  }

  /** Rows of modules along an area's street sides: the front row facing its main street, a back row facing the other. */
  private fillArea(a: Area, index: number): boolean {
    const before = this.placed.length
    const fronts = (DIRS.filter((d) => a.sides[d] === 'lane') as Dir[])
      // The longest street side first, the middle of the map (south) on a tie.
      .sort((x, y) => sideLen(a, y) - sideLen(a, x) || (y === 'S' ? 1 : 0) - (x === 'S' ? 1 : 0))
    if (!fronts.length) return false
    const F = fronts[0]
    this.row(a, index, F)
    if (a.sides[OPP[F]] === 'lane') this.row(a, index, OPP[F])
    return this.placed.length > before
  }

  /** One row: modules with a street-ish side facing `F`, from one end of the area to the other. */
  private row(a: Area, index: number, F: Dir) {
    const L = sideLen(a, F), Dp = F === 'N' || F === 'S' ? a.z1 - a.z0 : a.x1 - a.x0
    // u runs along the row, v from the front edge into the area.
    const rect = (u0: number, u1: number, v0: number, v1: number): Rect =>
      F === 'S' ? { x0: a.x0 + u0, x1: a.x0 + u1, z0: a.z1 - v1, z1: a.z1 - v0 }
        : F === 'N' ? { x0: a.x1 - u1, x1: a.x1 - u0, z0: a.z0 + v0, z1: a.z0 + v1 }
          : F === 'E' ? { x0: a.x1 - v1, x1: a.x1 - v0, z0: a.z0 + u0, z1: a.z0 + u1 }
            : { x0: a.x0 + v0, x1: a.x0 + v1, z0: a.z1 - u1, z1: a.z1 - u0 }
    let u = 0
    for (let guard = 0; guard < 40 && u < L - 4 * M; guard++) {
      const options: { p: Placed; w: number; width: number }[] = []
      for (const c of this.modules) {
        const fresh = !this.palette.has(c.m.id)
        if (fresh && this.palette.size >= MODULE_PALETTE) continue
        if (!this.fits(c.tris * 2, c.tex, MODULE_SHARE)) continue
        // Its best side for a street faces the street (a shop front, not its back wall).
        const best = Math.max(...SIDES.map((s) => FRONT[edgeOf(c.m, s).kind] ?? 0))
        for (const s of SIDES) {
          const e = edgeOf(c.m, s), pref = FRONT[e.kind]
          if (!pref || pref < best) continue
          const rot = rotFor(s, F)
          const [fw, fd] = footprintOf(c.m.size, rot)
          const [width, depth] = F === 'N' || F === 'S' ? [fw, fd] : [fd, fw]
          if (depth > Dp + EPS) continue
          for (const gap of [0, ALLEY]) {
            if (u + gap + width > L + EPS) continue
            // Against the front street, or against the back when that leaves too thin a slot behind it.
            for (const v0 of Dp - depth < ALLEY ? [0, Dp - depth] : [0]) {
              const r = rect(u + gap, u + gap + width, v0, v0 + depth)
              const p: Placed = { ...r, m: c.m, rot, x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, area: index }
              if (!this.allowed(p, a)) continue
              const fill = (depth / Dp) * Math.min(1, width / Math.max(1, L - u))
              options.push({ p, width: gap + width, w: c.weight * pref * (0.2 + fill) * (gap ? 1 : 1.5) * (fresh ? 1 : 2) })
            }
          }
        }
      }
      if (!options.length) { u += ALLEY; continue }
      let x = this.r.next() * options.reduce((t, q) => t + q.w, 0)
      const pick = options.find((q) => (x -= q.w) <= 0) ?? options[options.length - 1]
      this.place(pick.p)
      u += pick.width
    }
  }

  private place(p: Placed) {
    const c = this.modules.find((q) => q.m.id === p.m.id)!
    this.placed.push(p)
    this.palette.set(p.m.id, (this.palette.get(p.m.id) ?? 0) + 2)
    this.pieces.spend(c.tris * 2, c.tex)
    this.stats.modules += 2
  }

  /**
   * Whether a module may stand here: inside its area, clear of the others (touching only where their edges join, or
   * an alley apart), its openings onto ground players can use, and no fenced-off level within a jump of a neighbour's.
   */
  allowed(p: Placed, a: Area): boolean {
    if (p.x0 < a.x0 - EPS || p.x1 > a.x1 + EPS || p.z0 < a.z0 - EPS || p.z1 > a.z1 + EPS) return false
    for (const q of this.placed) {
      const { gap, dir } = apart(p, q)
      if (gap < -EPS) return false
      if (gap <= EPS) { if (!joinOk(p, q)) return false }
      // Facing each other across a slot too narrow to walk down.
      else if (dir && gap < ALLEY - EPS) return false
      if (dir && gap < FENCE_GAP && fencedReach(p.m, q.m)) return false
    }
    // Each keeps a way out onto open ground: openings that only lead into each other close both in.
    const all = [...this.placed, p]
    for (const x of [p, ...this.placed.filter((q) => apart(p, q).gap <= EPS && apart(p, q).dir)]) if (hasOpenings(x.m) && !freeOpening(x, all)) return false
    // Openings toward the area's outer wall need room to walk out of them.
    for (const d of DIRS) {
      if (a.sides[d] !== 'edge') continue
      const room = d === 'E' ? a.x1 - p.x1 : d === 'W' ? p.x0 - a.x0 : d === 'S' ? a.z1 - p.z1 : p.z0 - a.z0
      if (room + 3 < ALLEY && edgeToward(p, d).spans.length) return false
    }
    return true
  }

  // ---- groups and wall things ----

  /** Open ground the groups and props may take: clear of modules, other groups, the layout's pieces and every opening's way in. */
  private free(h: Half, r: Rect, margin: number, own?: Placed): boolean {
    // Inside red's half, off the spawn strip and the middle, clear of what the layout took (touching is fine).
    if (!h.fits({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, w: r.x1 - r.x0, d: r.z1 - r.z0 }, 0)) return false
    for (const q of this.placed) {
      const { gap } = apart(r, q)
      if (gap < (q === own ? -EPS : margin)) return false
      // The way into every opening stays clear (an alley's width out from it).
      for (const d of DIRS) {
        const e = edgeToward(q, d)
        for (const s of e.spans) {
          const zone: Rect = d === 'N' || d === 'S'
            ? { x0: s[0] - M, x1: s[1] + M, z0: d === 'S' ? q.z1 : q.z0 - ALLEY, z1: d === 'S' ? q.z1 + ALLEY : q.z0 }
            : { x0: d === 'E' ? q.x1 : q.x0 - ALLEY, x1: d === 'E' ? q.x1 + ALLEY : q.x0, z0: s[0] - M, z1: s[1] + M }
          if (apart(r, zone).gap < -EPS) return false
        }
      }
    }
    return this.placedGroups.every((g) => apart(r, g).gap >= margin)
  }

  private pickGroup(anchor: CityGroup['anchor']): GroupCand | null {
    const ok = this.groupList.filter((c) => c.g.anchor === anchor && (this.groupPalette.has(c.g.id) || this.groupPalette.size < GROUP_PALETTE)
      && this.fits(c.tris * 2, c.tex))
    if (!ok.length) return null
    let x = this.r.next() * ok.reduce((t, c) => t + c.weight * (this.groupPalette.has(c.g.id) ? 3 : 1), 0)
    return ok.find((c) => (x -= c.weight * (this.groupPalette.has(c.g.id) ? 3 : 1)) <= 0) ?? ok[ok.length - 1]
  }

  private useGroup(c: GroupCand, pg: PlacedGroup) {
    this.placedGroups.push(pg)
    this.groupPalette.add(c.g.id)
    this.pieces.spend(c.tris * 2, c.tex)
    this.stats.groups += 2
  }

  /** Spots along modules' outside walls (no openings there), facing open ground: where wall groups and wall things go. */
  private wallSpots(): { p: Placed; d: Dir; from: number; to: number }[] {
    const out: { p: Placed; d: Dir; from: number; to: number }[] = []
    for (const p of this.placed) for (const d of DIRS) {
      const e = edgeToward(p, d)
      if (e.kind !== 'wall') continue
      // Runs of the wall between its openings (and a metre clear of each).
      const cuts = [...e.spans].sort((a, b) => a[0] - b[0])
      let from = e.from
      for (const s of [...cuts, [e.to + M, e.to + M] as [number, number]]) {
        const to = Math.min(e.to, s[0] - M)
        if (to - from >= 2 * M) out.push({ p, d, from, to })
        from = Math.max(from, s[1] + M)
      }
    }
    return out
  }

  /** A thing w across and dep deep (units) with its back to `spot`'s wall, at `t` along it. */
  private againstWall(spot: { p: Placed; d: Dir }, t: number, w: number, dep: number): Rect {
    const { p, d } = spot
    return d === 'S' ? { x0: t - w / 2, x1: t + w / 2, z0: p.z1, z1: p.z1 + dep } : d === 'N' ? { x0: t - w / 2, x1: t + w / 2, z0: p.z0 - dep, z1: p.z0 }
      : d === 'E' ? { x0: p.x1, x1: p.x1 + dep, z0: t - w / 2, z1: t + w / 2 } : { x0: p.x0 - dep, x1: p.x0, z0: t - w / 2, z1: t + w / 2 }
  }

  private placeGroups(h: Half, fill: number) {
    if (!this.groupList.length) return
    // Against walls: the group's back to a module's wall, an alley's width left clear in front of it.
    const walls = this.wallSpots()
    const wallCount = Math.round(1 + 4 * fill)
    for (let k = 0, tries = 0; k < wallCount && tries < 40 && walls.length; tries++) {
      const spot = walls[Math.floor(this.r.next() * walls.length)]
      const c = this.pickGroup('wall')
      if (!c) break
      const rot = rotFor(c.g.back ?? '-z', OPP[spot.d])
      const [fw, fd] = footprintOf(c.g.size, rot)
      const w = spot.d === 'N' || spot.d === 'S' ? fw : fd, dep = spot.d === 'N' || spot.d === 'S' ? fd : fw
      if (spot.to - spot.from < w) continue
      const t = spot.from + w / 2 + this.r.next() * (spot.to - spot.from - w)
      const r = this.againstWall(spot, t, w, dep)
      // Room to walk past in front of it.
      const ahead = this.againstWall(spot, t, w, dep + ALLEY)
      if (!this.free(h, r, M, spot.p) || !this.free(h, ahead, 0, spot.p)) continue
      this.useGroup(c, { ...r, g: c.g, rot, x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, wall: spot.d })
      h.take({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, w: r.x1 - r.x0, d: r.z1 - r.z0 })
      k++
    }
    // On open ground: lots, yards, the edges of streets.
    const groundCount = Math.round(2 + 6 * fill)
    const { W, D, strip } = h
    for (let k = 0, tries = 0; k < groundCount && tries < 120; tries++) {
      const c = this.pickGroup('ground')
      if (!c) break
      const rot = [0, 90, 180, 270][Math.floor(this.r.next() * 4)]
      const [fw, fd] = footprintOf(c.g.size, rot)
      const x = this.r.range(-W / 2 + 6 + fw / 2, W / 2 - 6 - fw / 2), z = this.r.range(-D / 2 + strip + 4 + fd / 2, -6 - fd / 2)
      const r = rectOf(x, z, fw, fd)
      if (!this.free(h, r, ALLEY)) continue
      this.useGroup(c, { ...r, g: c.g, rot, x, z })
      h.take({ x, z, w: fw, d: fd })
      k++
    }
  }

  /** Single wall things (their rule says 'wall'), with their back to a module's wall, facing out. */
  private wallProps(h: Half, fill: number) {
    // At the height the game mostly hangs them; standing on the ground (and no taller than a person or so) when it doesn't say.
    const mount = (e: GameObjectEntry) => this.rule(e).mountHeight ?? 0
    const things = [...this.lib.values()].filter((e) => {
      const rl = this.rule(e)
      return rl.attach === 'wall' && !rl.onlyOn?.length && !rl.needs?.length && (rl.mountHeight !== undefined || e.size[2] <= WALL_PROP_MAX_H) && e.seen >= 2 && e.tris <= 4000
    }).sort((a, b) => b.seen - a.seen || a.id.localeCompare(b.id)).slice(0, 40)
    if (!things.length) return
    const walls = this.wallSpots()
    const count = Math.round(2 * fill * 3)
    const used = new Set<string>()
    for (let k = 0, tries = 0; k < count && tries < 40 && walls.length; tries++) {
      const pool = things.filter((e) => used.has(e.id) || used.size < 3)
      const e = pool[Math.floor(this.r.next() * pool.length)], rl = this.rule(e)
      if (!this.fits(e.tris * 2, new Set(e.tex.map((t) => t.toLowerCase())))) continue
      const spot = walls[Math.floor(this.r.next() * walls.length)]
      // Only on a wall tall enough to hold it (its module's roof).
      const top = Math.max(3, ...levels(spot.p.m).map((l) => l.h))
      if (mount(e) + e.size[2] > top) continue
      // The side that faces out from the wall faces away from it.
      const facing = rl.facing ?? '+z'
      const rot = rotFor(facing, spot.d)
      // Its long side along the wall: across its own X when it faces ±Z, across Z when it faces ±X.
      const own: [number, number] = facing === '+x' || facing === '-x' ? [e.size[1], e.size[0]] : [e.size[0], e.size[1]]
      const [fw, fd] = footprintOf(own, rot)
      const w = spot.d === 'N' || spot.d === 'S' ? fw : fd, dep = spot.d === 'N' || spot.d === 'S' ? fd : fw
      if (spot.to - spot.from < w) continue
      const t = spot.from + w / 2 + this.r.next() * (spot.to - spot.from - w)
      const r = this.againstWall(spot, t, w, dep)
      const clear = this.againstWall(spot, t, w, dep + Math.max(ALLEY, (rl.clearFront ?? 0) * M))
      if (!this.free(h, r, M, spot.p) || !this.free(h, clear, 0, spot.p)) continue
      const g: CityGroup = { id: 'wall:' + e.id, name: e.name, kind: 'decor', settings: [], anchor: 'wall', size: own, parts: [{ id: e.id, at: [0, mount(e), 0], yaw: 0, layer: 'prop', ext: own }], seen: e.seen, examples: [] }
      this.placedGroups.push({ ...r, g, rot, x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, wall: spot.d })
      h.take({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, w: r.x1 - r.x0, d: r.z1 - r.z0 })
      this.pieces.spend(e.tris * 2, new Set(e.tex.map((t) => t.toLowerCase())))
      used.add(e.id)
      this.stats.wallProps += 2
      k++
    }
  }

  // ---- checks ----

  /**
   * Every module whose upper levels players can reach must be reachable from the spawns: across open ground to one
   * of its openings, or through a neighbour whose opening lines up with it. Open ground nobody can get to is noted.
   */
  private check(h: Half) {
    const reach = reachability(h, this.placed, this.placedGroups)
    for (const [i, p] of this.placed.entries()) {
      const up = levels(p.m).filter((l) => l.open && l.h > JUMP)
      if (!reach.modules[i] && up.length) this.problems.push(`${p.m.name}: its upper floors can be reached from inside it, but players can't get into it from the rest of the map.`)
    }
    if (!reach.middle) this.problems.push('Modules wall the spawns off from the middle of the map: players can\'t get from one to the other.')
    if (reach.pocketsM2 >= 20) this.problems.push(`About ${Math.round(reach.pocketsM2)} m² of ground on each side is closed in by modules, out of players' reach.`)
    if (this.stats.open && this.pieces.stats.triangles >= TRI_BUDGET * MODULE_SHARE * 0.9) this.problems.push('The triangle budget ran out before every area had a module: the rest are left as open lots.')
  }

  // ---- stand-ins ----

  /** Stand-ins for a module's or group's parts, its frame's origin at (x, y, z) turned `rot` (units, degrees). */
  standIns(parts: ModulePart[], x: number, z: number, y: number, rot: number, from: string): Part[] {
    return parts.map((q) => {
      const [dx, dz] = gamePoint(q.at[0], q.at[2], rot)
      // The box only stands in for the model in the passes that follow; the model itself goes exactly here.
      // Its box the part's own size across, where the study gives it.
      return exactStandIn(this.lib.get(q.id)!, 'Stilwater ' + q.layer, [x + dx, y + q.at[1] * M, z + dz], rot + q.yaw, from, q.ext)
    })
  }
}

/** How well each kind of edge does facing a street. */
const FRONT: Partial<Record<EdgeKind, number>> = { street: 3, sidewalk: 3, open: 1.5, alley: 1, yard: 1, wall: 0.3 }

const sideLen = (a: Rect, d: Dir) => (d === 'N' || d === 'S' ? a.x1 - a.x0 : a.z1 - a.z0)

/**
 * Which modules players can get into from the spawns (red's half): a 2-unit grid of open ground flooded from the
 * spawn strip, through each module reached to every one of its openings, and on through openings that line up.
 * `pocketsM2`: open ground left closed in; `middle`: the middle of the map reached.
 */
export function reachability(h: Pick<Half, 'W' | 'D' | 'strip'>, placed: Placed[], groups: Rect[] = []): { modules: boolean[]; pocketsM2: number; middle: boolean } {
  const C = 2, X = h.W / 2 - 3, z0 = -h.D / 2 + 1, nx = Math.ceil((2 * X) / C), nz = Math.ceil((-z0) / C)
  const idx = (i: number, j: number) => j * nx + i
  const cell = (x: number, z: number): [number, number] => [Math.floor((x + X) / C), Math.floor((z - z0) / C)]
  const blocked = new Uint8Array(nx * nz), seen = new Uint8Array(nx * nz)
  const inside = (r: Rect, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1
  const solids: Rect[] = [...placed, ...groups]
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = -X + (i + 0.5) * C, z = z0 + (j + 0.5) * C
    if (solids.some((r) => inside(r, x, z))) blocked[idx(i, j)] = 1
  }
  const queue: number[] = []
  const push = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= nx || j >= nz) return
    const k = idx(i, j)
    if (blocked[k] || seen[k]) return
    seen[k] = 1; queue.push(k)
  }
  // From the spawn strip (the other team's half is the same ground turned round).
  for (let i = 0; i < nx; i++) push(i, 0)
  const reached = placed.map(() => false)
  const doors = placed.map((p) => DIRS.flatMap((d) => edgeToward(p, d).spans.map((s) => {
    const m = (s[0] + s[1]) / 2, out = C * 0.75
    return d === 'S' ? cell(m, p.z1 + out) : d === 'N' ? cell(m, p.z0 - out) : d === 'E' ? cell(p.x1 + out, m) : cell(p.x0 - out, m)
  })))
  for (let changed = true; changed;) {
    changed = false
    while (queue.length) {
      const k = queue.pop()!, i = k % nx, j = (k - i) / nx
      push(i + 1, j); push(i - 1, j); push(i, j + 1); push(i, j - 1)
    }
    placed.forEach((p, n) => {
      if (reached[n]) return
      const viaGround = doors[n].some(([i, j]) => i >= 0 && j >= 0 && i < nx && j < nz && seen[idx(i, j)])
      const viaNeighbour = placed.some((q, m) => reached[m] && apart(p, q).gap <= EPS && apart(p, q).dir !== null && sharesOpening(p, q))
      if (!viaGround && !viaNeighbour) return
      reached[n] = changed = true
      for (const [i, j] of doors[n]) push(i, j)
    })
  }
  let pockets = 0
  for (let k = 0; k < nx * nz; k++) if (!blocked[k] && !seen[k]) pockets++
  let middle = false
  for (let i = 0; i < nx; i++) if (seen[idx(i, nz - 1)]) middle = true
  return { modules: reached, pocketsM2: (pockets * C * C) / (M * M), middle }
}

const hasOpenings = (m: CityModule) => m.edges.some((e) => e.openings.length)

/** Whether a module has an opening a player's width of which isn't against a touching neighbour. */
function freeOpening(p: Placed, all: Placed[]): boolean {
  return DIRS.some((d) => {
    const covered = all.filter((q) => q !== p).map((q) => apart(p, q)).filter((a) => a.gap <= EPS && a.dir === d).map((a) => a.shared)
    return edgeToward(p, d).spans.some((o) => {
      // What of the opening is left once every neighbour's stretch of the side is taken off.
      let left = o[1] - o[0]
      for (const c of covered) left -= Math.max(0, overlap(o, c))
      return left >= PASS
    })
  })
}

/** Two touching modules with openings that line up across their shared side. */
function sharesOpening(a: Placed, b: Placed): boolean {
  const { dir, shared } = apart(a, b)
  if (!dir) return false
  const ea = edgeToward(a, dir), eb = edgeToward(b, OPP[dir])
  return ea.spans.some((o) => eb.spans.some((t) => overlap(o, t) >= PASS && overlap(o, shared) >= PASS))
}
