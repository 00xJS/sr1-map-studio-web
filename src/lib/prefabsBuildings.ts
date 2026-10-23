// Buildings and neighbourhood life: homes, shops, civic and industrial
// buildings (most of them hollow, so a fight can move through them) and the
// street-corner pieces that make a block feel lived in. Walls are real solids
// with door gaps (doors 4 wide and 5.6 high; players are about 3.6 tall), a
// floor is 7 units (3.5 m) and floors sit at ground level, so every prefab
// places like the others. Signs are plain colored panels: no names or logos.
import { CY, PB, box, cyl, lying, ramp, stairs, turn, type Part, type Tex } from './sampleKit'
import { FLOOR, facadeTex, group, local, wheels, type ParamDef, type Params, type PrefabDef, type Style } from './prefabs'
import { poolParts } from './prefabsMore'

type Lf = (dx: number, dy: number, dz: number) => [number, number, number]
type Def = PrefabDef & { category: string }

const id = (name: string, x: number, y: number, z: number) => `${name}@${+x.toFixed(2)},${+y.toFixed(2)},${+z.toFixed(2)}`
const pf = (name: string, make: (L: Lf) => Part[]) =>
  (x: number, z: number, rot: number, y: number) => group(id(name, x, y, z), local(x, y, z, rot, make))
const pfp = (name: string, params: ParamDef[], make: (L: Lf, p: Params) => Part[]) => ({
  params,
  make: (x: number, z: number, rot: number, y: number, given?: Params) => {
    const p = Object.fromEntries(params.map((d) => [d.key, given?.[d.key] ?? d.default]))
    return group(id(name, x, y, z), local(x, y, z, rot, (L) => make(L, p)))
  },
})

/** Builds a piece (in its own frame) at (x, z), turned by r, inside another piece's frame. */
const at = (L: Lf, x: number, z: number, r: number, make: (L: Lf) => Part[], y = 0): Part[] => {
  const L2: Lf = (dx, dy, dz) => { const [ox, oz] = turn(dx, dz, r); return L(x + ox, y + dy, z + oz) }
  return make(L2).map((p) => ({ ...p, rot: ((p.rot ?? 0) + r) % 360 }))
}
/** n copies of a piece in a row along X, `gap` apart and centered. */
const row = (L: Lf, n: number, gap: number, make: (L: Lf, i: number) => Part[], z = 0, r = 0, y = 0): Part[] =>
  [...Array(Math.max(0, n))].flatMap((_, i) => at(L, (i - (n - 1) / 2) * gap, z, r, (M) => make(M, i), y))

const num = (key: string, label: string, min: number, max: number, def: number, step = 1): ParamDef => ({ key, label, kind: 'number', min, max, step, default: def })
const sel = (key: string, label: string, options: [string, string][], def: string): ParamDef => ({ key, label, kind: 'select', options, default: def })
const yesNo = (key: string, label: string, def: 'yes' | 'no'): ParamDef => sel(key, label, [['yes', 'Yes'], ['no', 'No']], def)

// ---------------- materials ----------------

const solid = (color: string, accent: string, seed: number, surface = 17): Tex => ({ gen: 'tiles', tweak: { color, accent, scale: 1, wear: 0.06, seed }, surface })
const DARK_WOOD: Tex = { gen: 'wood_planks', tweak: { color: '#4a3324', accent: '#2e1f15', scale: 3, wear: 0.15, seed: 400 }, surface: 21 }
const LIGHT_WOOD: Tex = { gen: 'wood_planks', tweak: { color: '#b48a5a', accent: '#8a6640', scale: 4, wear: 0.1, seed: 401 }, surface: 21 }
const FLOOR_WOOD: Tex = { lib: 'wood_floor', surface: 21 }
const FABRIC: Tex = { gen: 'tiles', tweak: { color: '#5a3a4a', accent: '#4a2f3d', scale: 6, wear: 0.1, seed: 402 }, surface: 17 }
const LEATHER: Tex = { gen: 'tiles', tweak: { color: '#3a2620', accent: '#2a1a15', scale: 4, wear: 0.2, seed: 403 }, surface: 17 }
const WHITE = solid('#e8e6e0', '#cfccc4', 404)
const LINEN = solid('#d9d4c8', '#bdb6a6', 405)
const BLACK = solid('#1d1d20', '#141416', 406, 15)
const GLASS: Tex = { gen: 'tiles', tweak: { color: '#25313b', accent: '#1a2229', scale: 1, wear: 0, seed: 407 }, surface: 9 }
const SCREEN: Tex = { gen: 'tiles', tweak: { color: '#14191f', accent: '#18d8ff', scale: 3, wear: 0, seed: 408 }, surface: 15 }
const FELT: Tex = { gen: 'tiles', tweak: { color: '#1f6b3a', accent: '#1a5a31', scale: 4, wear: 0.05, seed: 409 }, surface: 17 }
const CHALK: Tex = { gen: 'tiles', tweak: { color: '#1f3a2a', accent: '#2c4a36', scale: 2, wear: 0.3, seed: 410 }, surface: 5 }
const MARBLE: Tex = { lib: 'marble_01', surface: 13 }
const STONE: Tex = { lib: 'medieval_blocks_03', surface: 0 }
const SLATE: Tex = { lib: 'roof_slates_03', surface: 0 }
const ROOF: Tex = { lib: 'gravel_concrete_03', surface: 12 }
const BIG_TILES: Tex = { lib: 'large_floor_tiles_02', surface: 3 }
const CHAIN: Tex = { gen: 'tiles', tweak: { color: '#3a3d40', accent: '#8d9094', scale: 16, wear: 0.2, seed: 430 }, surface: 14 }
const HAZARD: Tex = { gen: 'hazard', tweak: { seed: 415 } }
const POT: Tex = { gen: 'concrete', tweak: { color: '#9a5a3a', accent: '#6a3a22', wear: 0.3, seed: 413 } }
const LEAVES: Tex = { gen: 'grass', tweak: { color: '#2f6e28', accent: '#4c8a2a', scale: 3, wear: 0.2, seed: 412 }, surface: 7 }
// This file's own (seeds 600 and up).
const CURTAIN: Tex = { gen: 'tiles', tweak: { color: '#3f6479', accent: '#b9c8d2', scale: 6, wear: 0, seed: 600 }, surface: 9 }
const CHECKER: Tex = { gen: 'tiles', tweak: { color: '#e6e2d8', accent: '#202024', scale: 6, wear: 0.15, seed: 601 }, surface: 3 }
const CHAR: Tex = { gen: 'concrete', tweak: { color: '#45403c', accent: '#151312', wear: 0.9, seed: 602 } }
const SOOT: Tex = { gen: 'brick', tweak: { color: '#4e2c24', accent: '#2a2420', scale: 8, wear: 0.9, seed: 603 } }
const BARBER: Tex = { gen: 'hazard', tweak: { color: '#e8e6e0', accent: '#c8322b', scale: 3, wear: 0, seed: 604 } }
const MIRROR = solid('#c9d6de', '#9fb0ba', 605, 9)
const LINE = solid('#efefea', '#d8d8d2', 606, 0)
const COURT = solid('#2f5a7a', '#284e6a', 607, 0)
const PURPLE = solid('#5b2b8c', '#3a1a5a', 608)
const DOUGH = solid('#c98a4a', '#a86a32', 609)
const FROSTING = solid('#f27ab8', '#d85a9a', 610)
const STEEL_DOOR = solid('#4a5058', '#3a3f45', 611, 15)
const RUST_RED = solid('#8a3a2a', '#5a2418', 612, 15)
const TARP = solid('#2a5fc0', '#1d4a9a', 613)
const WATER: Tex = { gen: 'water', tweak: { color: '#2a8fc0', accent: '#bfe8f5', seed: 614 }, surface: 20 }
const GRASS: Tex = { gen: 'grass', tweak: { color: '#4f7a2f', accent: '#8b8f3a', wear: 0.5, seed: 615 } }
const DRY_GRASS: Tex = { gen: 'grass', tweak: { color: '#7a7a3a', accent: '#5a4a2a', wear: 0.8, seed: 616 } }
const CASH = solid('#4a8a4a', '#2f5f2f', 617)
const FIRE = solid('#ff8a1f', '#ffd23a', 618)
const PLYWOOD = PB.plywood
const GOODS: Tex[] = [PB.red, PB.blue, PB.yellow, PB.green, PB.orange, WHITE]
const BOTTLES: Tex[] = [solid('#3a6a2a', '#1f3a16', 619, 9), solid('#6a3a1a', '#3a1f0e', 620, 9), solid('#c9c4a8', '#8a856a', 621, 9)]

/** Murals and graffiti: bold diagonal bands in two colors. */
const MURALS: Record<string, Tex> = {
  sunset: { gen: 'hazard', tweak: { color: '#f07a1a', accent: '#7a2a8a', scale: 3, wear: 0.25, seed: 630 } },
  ocean: { gen: 'hazard', tweak: { color: '#2ab8c8', accent: '#1d3a7a', scale: 5, wear: 0.25, seed: 631 } },
  purple: { gen: 'hazard', tweak: { color: '#9b5cff', accent: '#f2c218', scale: 2, wear: 0.3, seed: 632 } },
  jungle: { gen: 'hazard', tweak: { color: '#2fbf4a', accent: '#f2c218', scale: 4, wear: 0.3, seed: 633 } },
  fire: { gen: 'hazard', tweak: { color: '#d8322b', accent: '#2a2a2e', scale: 3, wear: 0.35, seed: 634 } },
}
const muralParam = (def: string) => sel('mural', 'Mural', [['sunset', 'Sunset'], ['ocean', 'Ocean'], ['purple', 'Purple & gold'], ['jungle', 'Jungle'], ['fire', 'Red & black']], def)

const WALLS: Record<string, Tex> = { brick: PB.brick, oldbrick: PB.oldBrick, plaster: PB.plaster, beige: PB.beige, concrete: PB.cinder, wood: PB.planks, metal: PB.corrugated, stone: STONE }
const wallParam = (def: string) => sel('walls', 'Walls', [['brick', 'Red brick'], ['oldbrick', 'Old brick'], ['plaster', 'Plaster'], ['beige', 'Beige'], ['concrete', 'Concrete'], ['wood', 'Wood'], ['metal', 'Metal'], ['stone', 'Stone']], def)
const wallTex = (p: Params) => WALLS[String(p.walls)] ?? PB.brick

const siding = (color: string, seed: number): Tex => ({ gen: 'wood_planks', tweak: { color, accent: color, scale: 10, wear: 0.15, seed }, surface: 21 })
const SIDING: Record<string, Tex> = {
  white: siding('#e4e0d4', 640), blue: siding('#7a9ab8', 641), yellow: siding('#d8c27a', 642), green: siding('#8aa87a', 643),
  pink: siding('#d8a0a8', 644), grey: siding('#9a9a96', 645), brick: PB.brick,
}
const sidingParam = (def: string) => sel('color', 'Siding', [['white', 'White'], ['blue', 'Blue'], ['yellow', 'Yellow'], ['green', 'Green'], ['pink', 'Pink'], ['grey', 'Grey'], ['brick', 'Brick']], def)
const sidingTex = (p: Params) => SIDING[String(p.color)] ?? SIDING.white

/** Sign panels: painted, or glowing neon. */
const SIGNS: Record<string, Tex> = {
  red: PB.red, yellow: PB.yellow, blue: PB.blue, green: PB.green, white: WHITE, orange: PB.orange,
  pink: CY.pink, cyan: CY.cyan, purple: CY.purple, lime: CY.lime, neonorange: CY.orange,
}
const signParam = (def: string) => sel('sign', 'Sign', [['red', 'Red'], ['yellow', 'Yellow'], ['blue', 'Blue'], ['green', 'Green'], ['white', 'White'], ['orange', 'Orange'],
  ['pink', 'Neon pink'], ['cyan', 'Neon cyan'], ['purple', 'Neon purple'], ['lime', 'Neon lime'], ['neonorange', 'Neon orange']], def)
const signTex = (p: Params) => SIGNS[String(p.sign)] ?? PB.red
const AWNINGS: Record<string, Tex | null> = { red: PB.red, green: PB.green, blue: PB.blue, yellow: PB.yellow, orange: PB.orange, black: PB.black, none: null }
const awningParam = (def: string) => sel('awning', 'Awning', [['red', 'Red'], ['green', 'Green'], ['blue', 'Blue'], ['yellow', 'Yellow'], ['orange', 'Orange'], ['black', 'Black'], ['none', 'None']], def)
const awningTex = (p: Params) => (String(p.awning) in AWNINGS ? AWNINGS[String(p.awning)] : PB.red)
const UPPER: [string, string][] = [['brick', 'Red brick'], ['darkbrick', 'Dark brick'], ['plaster', 'Plaster'], ['beige', 'Beige'], ['apartment', 'Apartments'], ['concrete', 'Concrete'], ['projects', 'Projects'], ['office', 'Office']]
/** Floors over a shop: how many and their look. */
const upperParams = (floors: number, style: string): ParamDef[] => [num('floors', 'Floors above', 0, 5, floors), sel('upper', 'Upper floors', UPPER, style)]
const COLORS: Record<string, Tex> = { red: PB.red, blue: PB.blue, green: PB.green, yellow: PB.yellow, orange: PB.orange, black: PB.black, white: WHITE, purple: PURPLE }
const colorParam = (key: string, label: string, def: string) => sel(key, label, [['red', 'Red'], ['blue', 'Blue'], ['green', 'Green'], ['yellow', 'Yellow'], ['orange', 'Orange'], ['black', 'Black'], ['white', 'White'], ['purple', 'Purple']], def)
const colorTex = (p: Params, key: string) => COLORS[String(p[key])] ?? PB.red

// ---------------- walls with openings ----------------

const T = 0.5 // wall thickness
const FL = 0.15 // furniture stands on the 0.15-thick floor

interface Gap { at: number; w: number; h: number; sill?: number }
const DOOR = (at: number, w = 4, h = 5.6, sill = 0): Gap => ({ at, w, h, sill })
const WIN = (at: number, w = 3, h = 2.6, sill = 2.4): Gap => ({ at, w, h, sill })
/** A shop window: wide and low, from waist height up. */
const SHOWCASE = (at: number, w = 5): Gap => ({ at, w, h: 3.6, sill: 1.2 })

/** A straight wall from a to b along local X (at z = c) or along Z (at x = c), with doors and windows cut out. */
function wall(L: Lf, axis: 'x' | 'z', a: number, b: number, c: number, h: number, t: number, side: Tex, top: Tex, gaps: Gap[] = [], y = 0, label = 'Wall'): Part[] {
  const out: Part[] = []
  const piece = (s0: number, s1: number, y0: number, y1: number) => {
    if (s1 - s0 < 0.05 || y1 - y0 < 0.05) return
    const mid = (s0 + s1) / 2, len = s1 - s0
    out.push(axis === 'x' ? box(label, [len, y1 - y0, t], L(mid, y + y0, c), top, side) : box(label, [t, y1 - y0, len], L(c, y + y0, mid), top, side))
  }
  let cur = a
  for (const g of [...gaps].sort((p, q) => p.at - q.at)) {
    const g0 = Math.max(a, g.at - g.w / 2), g1 = Math.min(b, g.at + g.w / 2)
    if (g1 - g0 < 0.5 || g0 < cur - 0.01) continue
    const s = Math.min(h, g.sill ?? 0)
    piece(cur, g0, 0, h)
    piece(g0, g1, 0, s)
    piece(g0, g1, Math.min(h, s + g.h), h)
    cur = g1
  }
  piece(cur, b, 0, h)
  return out
}

/** Evenly spaced windows along a wall, kept clear of its doors. */
function windowsAlong(a: number, b: number, doors: Gap[], every = 6.5, sill = 2.4): Gap[] {
  const n = Math.floor((b - a - 2) / every)
  const out: Gap[] = []
  for (let i = 0; i < n; i++) {
    const pos = a + ((b - a) * (i + 0.5)) / n
    if (doors.every((d) => Math.abs(d.at - pos) > d.w / 2 + 2)) out.push(WIN(+pos.toFixed(2), 3, 2.6, sill))
  }
  return out
}

interface ShellOptions {
  w: number; d: number; h: number
  side: Tex; top?: Tex
  floor?: Tex | null; roof?: Tex | null
  front?: Gap[]; back?: Gap[]; left?: Gap[]; right?: Gap[]
  windows?: boolean
  /** Sill height of the automatic windows. */
  sill?: number
  y?: number
}

/** Four walls (front is +Z), an optional floor at ground level and an optional flat roof. */
function shell(L: Lf, s: ShellOptions): Part[] {
  const top = s.top ?? PB.concrete, y = s.y ?? 0
  const hw = s.w / 2, hd = s.d / 2
  const win = (a: number, b: number, g: Gap[] = []) => (s.windows ? [...g, ...windowsAlong(a, b, g, 6.5, s.sill)] : g)
  const parts = [
    ...wall(L, 'x', -hw, hw, hd - T / 2, s.h, T, s.side, top, win(-hw, hw, s.front), y, 'Front wall'),
    ...wall(L, 'x', -hw, hw, -hd + T / 2, s.h, T, s.side, top, win(-hw, hw, s.back), y, 'Back wall'),
    ...wall(L, 'z', -hd + T, hd - T, -hw + T / 2, s.h, T, s.side, top, win(-hd + T, hd - T, s.left), y, 'Side wall'),
    ...wall(L, 'z', -hd + T, hd - T, hw - T / 2, s.h, T, s.side, top, win(-hd + T, hd - T, s.right), y, 'Side wall'),
  ]
  if (s.floor) parts.push(box('Floor', [s.w - 2 * T, 0.15, s.d - 2 * T], L(0, y, 0), s.floor, s.floor, 0, 4))
  if (s.roof) parts.push(box('Roof', [s.w + 0.4, 0.4, s.d + 0.4], L(0, y + s.h, 0), s.roof, top))
  return parts
}

/** A low wall round a roof's edge. */
const parapet = (L: Lf, w: number, d: number, y: number, tex: Tex, h = 1.1): Part[] => [
  box('Parapet', [w, h, 0.5], L(0, y, -d / 2 + 0.25), tex), box('Parapet', [w, h, 0.5], L(0, y, d / 2 - 0.25), tex),
  box('Parapet', [0.5, h, d - 1], L(-w / 2 + 0.25, y, 0), tex), box('Parapet', [0.5, h, d - 1], L(w / 2 - 0.25, y, 0), tex),
]
/** A flat roof slab on walls, with a parapet. */
const flatRoof = (L: Lf, w: number, d: number, y: number, trim: Tex = PB.concrete): Part[] =>
  [box('Roof', [w + 0.4, 0.4, d + 0.4], L(0, y, 0), ROOF, trim), ...parapet(L, w + 0.4, d + 0.4, y + 0.4, trim)]
/** A pitched roof, its ridge along X (or Z), centered at (x, z). */
const gable = (L: Lf, x: number, z: number, w: number, d: number, h: number, y: number, tex: Tex, ends: Tex, alongZ = false): Part =>
  ({ ...box('Roof', alongZ ? [d, h, w] : [w, h, d], L(x, y, z), tex, ends, alongZ ? 90 : 0), kind: 'roof' })

/** Solid upper floors (windows painted on) over a hollow ground floor: ledges, a cornice and a parapet. */
function upperFloors(L: Lf, w: number, d: number, y: number, floors: number, style: Style, trim: Tex = PB.concrete): Part[] {
  if (floors < 1) return parapet(L, w + 0.4, d + 0.4, y, trim)
  const h = floors * FLOOR
  const out = [box('Upper floors', [w, h, d], L(0, y, 0), ROOF, facadeTex(style), 0, FLOOR)]
  for (let f = 1; f < floors; f++) out.push(box('Ledge', [w + 0.5, 0.35, d + 0.5], L(0, y + f * FLOOR - 0.2, 0), trim))
  out.push(box('Cornice', [w + 1, 0.64, d + 1], L(0, y + h - 0.7, 0), trim), ...parapet(L, w, d, y + h, trim))
  return out
}

interface StoreyOptions {
  w: number; d: number; n: number
  /** A raised ground floor (a stoop leads up to it). */
  base?: number
  side: Tex; top: Tex; floor: Tex
  /** Openings per floor (k = 0 is the ground floor); sills are lifted onto a raised ground floor. */
  front?: (k: number) => Gap[]; back?: (k: number) => Gap[]; left?: (k: number) => Gap[]; right?: (k: number) => Gap[]
  windows?: boolean
  /** The wall the stairs climb along, and whether a last flight goes up onto the roof. */
  stairSide?: 'left' | 'right'; toRoof?: boolean
  roof?: 'flat' | 'gable' | 'none'; roofTex?: Tex
}

/**
 * Hollow floors stacked n high, joined by switchback stairs along one side
 * wall: even flights climb toward the back, odd ones toward the front, in
 * two lanes side by side, each floor open (and railed) over the flight below.
 * Needs a depth of at least 16.
 */
function storeys(L: Lf, o: StoreyOptions): Part[] {
  const H = FLOOR, b = o.base ?? 0, sw = 3.5, hw = o.w / 2, hd = o.d / 2
  const z0 = -hd + T, z1 = hd - T, xL = -hw + T, xR = hw - T
  const lane = (s: number): [number, number] => {
    const a = xL + s * sw, c = a + sw
    return o.stairSide === 'right' ? [-c, -a] : [a, c]
  }
  const lift = (g: Gap[], by: number) => g.map((q) => ({ ...q, sill: (q.sill ?? 0) + by }))
  const parts: Part[] = [b > 0
    ? box('Raised floor', [o.w - 2 * T, b, o.d - 2 * T], L(0, 0, 0), o.floor, PB.concrete)
    : box('Floor', [o.w - 2 * T, 0.15, o.d - 2 * T], L(0, 0, 0), o.floor, o.floor, 0, 4)]
  for (let k = 0; k < o.n; k++) {
    const by = k === 0 ? b : 0
    parts.push(...shell(L, { w: o.w, d: o.d, h: k === 0 ? b + H : H, y: k === 0 ? 0 : b + k * H, side: o.side, top: o.top, windows: o.windows, sill: 2.4 + by,
      front: lift(o.front?.(k) ?? [], by), back: lift(o.back?.(k) ?? [], by), left: lift(o.left?.(k) ?? [], by), right: lift(o.right?.(k) ?? [], by) }))
  }
  const flights = o.n - 1 + (o.toRoof ? 1 : 0)
  for (let k = 0; k < flights; k++) {
    const [a, c] = lane(k % 2)
    parts.push(stairs('Stairs', [sw, H, 10], L((a + c) / 2, b + k * H, z0 + 7), PB.concrete, PB.darkConcrete, k % 2 ? 180 : 0, 12))
  }
  const slab = (j: number, tex: Tex, label: string): Part[] => {
    const y = b + j * H - 0.3, out: Part[] = []
    const piece = (x0: number, x1: number, za: number, zb: number) => {
      if (x1 - x0 > 0.05 && zb - za > 0.05) out.push(box(label, [x1 - x0, 0.3, zb - za], L((x0 + x1) / 2, y, (za + zb) / 2), tex, PB.concrete))
    }
    const [ha, hb] = lane((j - 1) % 2)
    piece(xL, ha, z0, z1); piece(hb, xR, z0, z1); piece(ha, hb, z0, z0 + 2); piece(ha, hb, z0 + 12, z1)
    // Railings round the opening, open where the flight arrives.
    if (ha > xL + 0.05) out.push(box('Railing', [0.15, 1.1, 10], L(ha + 0.08, y + 0.3, z0 + 7), PB.steel))
    if (hb < xR - 0.05) out.push(box('Railing', [0.15, 1.1, 10], L(hb - 0.08, y + 0.3, z0 + 7), PB.steel))
    out.push(box('Railing', [hb - ha, 1.1, 0.15], L((ha + hb) / 2, y + 0.3, (j - 1) % 2 ? z0 + 2.08 : z0 + 11.92), PB.steel))
    return out
  }
  for (let j = 1; j < o.n; j++) parts.push(...slab(j, o.floor, 'Upper floor'))
  const top = b + o.n * H
  if (o.toRoof) parts.push(...slab(o.n, ROOF, 'Roof'), ...parapet(L, o.w, o.d, top, o.top))
  else if (o.roof === 'gable') parts.push(gable(L, 0, 0, o.w + 1.2, o.d + 1.2, Math.min(7, o.d * 0.35), top, o.roofTex ?? SLATE, o.side))
  else if (o.roof !== 'none') parts.push(...flatRoof(L, o.w, o.d, top, o.top))
  return parts
}

/** Height of floor k's top in a storeys() building. */
const floorY = (k: number, base = 0) => (k === 0 ? FL + base : base + k * FLOOR)

interface ShopOptions {
  w: number; d: number; h?: number
  doors: Gap[]; display?: number[]; displayW?: number
  back?: Gap[]; left?: Gap[]; right?: Gap[]
  walls: Tex; floor: Tex; trim?: Tex
  sign?: Tex | null; signW?: number; awning?: Tex | null
  floors: number; style: Style
  /** Security bars over the shop windows. */
  bars?: boolean
}

/** A shop: a hollow ground floor with shop windows, a sign band and an awning, under solid upper floors. */
function shopShell(L: Lf, o: ShopOptions): Part[] {
  const h = o.h ?? 7, trim = o.trim ?? PB.concrete, dw = o.displayW ?? 5, hd = o.d / 2
  const display = o.display ?? []
  const parts = shell(L, { w: o.w, d: o.d, h, side: o.walls, top: trim, floor: o.floor, front: [...o.doors, ...display.map((x) => SHOWCASE(x, dw))], back: o.back, left: o.left, right: o.right })
  parts.push(box('Ceiling', [o.w + 0.4, 0.4, o.d + 0.4], L(0, h, 0), ROOF, trim))
  if (o.sign) parts.push(box('Sign', [o.signW ?? Math.min(o.w - 2, 14), 1.2, 0.3], L(0, h - 1.25, hd + 0.15), o.sign, trim))
  if (o.awning && display.length) {
    const x0 = Math.min(...display) - dw / 2 - 0.5, x1 = Math.max(...display) + dw / 2 + 0.5
    parts.push(ramp('Awning', [x1 - x0, 0.8, 2.4], L((x0 + x1) / 2, 4.85, hd + 1.2), o.awning, o.awning))
  }
  if (o.bars) for (const x of display) for (let i = 0; i < 6; i++) parts.push(box('Bar', [0.12, 3.6, 0.12], L(x - dw / 2 + (dw * (i + 0.5)) / 6, 1.2, hd + 0.12), PB.steel))
  parts.push(...upperFloors(L, o.w, o.d, h + 0.4, o.floors, o.style, trim))
  return parts
}
/** The upper-floor settings of a shop prefab, read back. */
const upperOf = (p: Params) => ({ floors: +p.floors, style: String(p.upper) as Style })

// ---------------- props (each in its own frame, base at y 0, facing +Z) ----------------

const legs = (L: Lf, w: number, d: number, h: number, tex: Tex, s = 0.25) =>
  [[-w / 2 + s, -d / 2 + s], [w / 2 - s, -d / 2 + s], [-w / 2 + s, d / 2 - s], [w / 2 - s, d / 2 - s]].map(([a, b]) => box('Leg', [s, h, s], L(a, 0, b), tex))
const table = (L: Lf, w = 4, d = 2.6, tex: Tex = DARK_WOOD): Part[] => [box('Table top', [w, 0.25, d], L(0, 1.3, 0), tex), ...legs(L, w, d, 1.3, tex)]
/** A café table on one post. */
const roundTable = (L: Lf, d = 2.6, tex: Tex = WHITE): Part[] => [cyl('Table base', 1.2, 0.1, L(0, 0, 0), PB.steel, PB.steel, 8), cyl('Table post', 0.25, 1.3, L(0, 0.1, 0), PB.steel, PB.steel, 6), cyl('Table top', d, 0.15, L(0, 1.4, 0), tex, tex, 12)]
const chair = (L: Lf, tex: Tex = DARK_WOOD): Part[] => [box('Seat', [1.6, 0.2, 1.6], L(0, 0.9, 0), tex), box('Chair back', [1.6, 1.6, 0.2], L(0, 1.1, -0.7), tex), ...legs(L, 1.6, 1.6, 0.9, tex, 0.15)]
/** A molded plastic chair: seat and back on a block base (cheap). */
const plasticChair = (L: Lf, tex: Tex = PB.blue): Part[] => [box('Chair base', [1.3, 0.9, 1.3], L(0, 0, 0), PB.steel), box('Seat', [1.6, 0.2, 1.6], L(0, 0.9, 0), tex), box('Chair back', [1.6, 1.5, 0.2], L(0, 1.1, -0.7), tex)]
const stool = (L: Lf, tex: Tex = LEATHER): Part[] => [cyl('Stool post', 0.3, 1.9, L(0, 0, 0), PB.steel, PB.steel, 6), cyl('Stool seat', 1.2, 0.25, L(0, 1.9, 0), tex, tex, 10)]
const couch = (L: Lf, w = 6, tex: Tex = FABRIC): Part[] => [
  box('Couch base', [w, 1, 2.4], L(0, 0, 0), tex), box('Couch back', [w, 1.5, 0.7], L(0, 1, -0.85), tex),
  ...[-1, 1].map((sx) => box('Couch arm', [0.6, 1.6, 2.4], L(sx * (w / 2 - 0.3), 0, 0), tex)),
]
const bed = (L: Lf, cover: Tex = FABRIC): Part[] => [
  box('Bed frame', [4.2, 0.8, 6.6], L(0, 0, 0), DARK_WOOD), box('Mattress', [4, 0.6, 6.2], L(0, 0.8, 0.1), LINEN),
  box('Pillow', [3, 0.35, 1], L(0, 1.4, -2.4), WHITE), box('Blanket', [4.1, 0.15, 3.6], L(0, 1.4, 1.2), cover), box('Headboard', [4.2, 2.6, 0.3], L(0, 0, -3.3), DARK_WOOD),
]
const tv = (L: Lf): Part[] => [box('TV stand', [5, 1.4, 1.6], L(0, 0, 0), DARK_WOOD), box('TV', [4.4, 2.6, 0.25], L(0, 1.4, -0.2), BLACK, SCREEN)]
/** A counter, optionally with a till at its right end. */
const counter = (L: Lf, len: number, top: Tex = MARBLE, side: Tex = DARK_WOOD, till = true): Part[] => [
  box('Counter', [len, 2.1, 2], L(0, 0, 0), top, side),
  ...(till ? [box('Register', [1.3, 0.6, 1], L(len / 2 - 1.2, 2.1, 0), BLACK), box('Register screen', [0.9, 0.6, 0.12], L(len / 2 - 1.2, 2.7, -0.3), BLACK, SCREEN)] : []),
]
/** Shelves against a wall (back at −Z), stocked. */
const wallShelf = (L: Lf, len: number, stock: Tex[] = GOODS, h = 5): Part[] => [
  box('Shelf back', [len, h, 0.15], L(0, 0, -0.65), DARK_WOOD),
  ...[0, 1.6, 3.2].filter((y) => y < h - 1).flatMap((y, i) => [box('Shelf', [len, 0.15, 1.3], L(0, y, 0), DARK_WOOD), box('Goods', [len - 0.4, 1.1, 0.9], L(0, y + 0.15, 0.05), stock[i % stock.length])]),
]
/** A double-sided shop aisle. */
const aisle = (L: Lf, len: number): Part[] => [
  box('Aisle base', [len, 0.4, 2.4], L(0, 0, 0), PB.steel), box('Aisle divider', [len, 4.2, 0.2], L(0, 0.4, 0), PB.steel),
  ...[1.6, 3.0].flatMap((y) => [-0.65, 0.65].map((z) => box('Shelf', [len, 0.12, 1.1], L(0, y, z), PB.steel))),
  ...[0.4, 1.72, 3.12].flatMap((y, i) => [-0.65, 0.65].map((z, j) => box('Goods', [len - 0.4, 0.9, 0.8], L(0, y, z), GOODS[(i * 2 + j) % GOODS.length]))),
]
const cooler = (L: Lf, n = 3): Part[] => [
  box('Coolers', [3 * n, 5, 2.2], L(0, 0, 0), WHITE, PB.steel), box('Cooler glass', [3 * n - 0.4, 3.8, 0.1], L(0, 0.7, 1.1), GLASS),
  ...[1.4, 2.8].map((y, i) => box('Drinks', [3 * n - 0.8, 0.9, 0.9], L(0, y, 0.4), GOODS[i])),
]
/** A glass-topped display case. */
const showcase = (L: Lf, len: number, inside: Tex = PB.yellow): Part[] => [
  box('Display case', [len, 2, 1.8], L(0, 0, 0), DARK_WOOD), box('Case goods', [len - 0.6, 0.3, 1.2], L(0, 2, 0), inside), box('Case glass', [len, 1.1, 1.8], L(0, 2.3, 0), GLASS),
]
/** A diner booth: two high-backed benches and a table between them, along X. */
const booth = (L: Lf, w = 4, tex: Tex = LEATHER): Part[] => [
  ...[-1, 1].flatMap((s) => [box('Booth seat', [w, 1, 1.6], L(0, 0, s * 2.2), tex), box('Booth back', [w, 2.6, 0.5], L(0, 0, s * 3.2), tex)]),
  box('Booth table', [w, 0.2, 2], L(0, 1.4, 0), WHITE), box('Table post', [0.4, 1.4, 0.4], L(0, 0, 0), PB.steel),
]
const pottedPlant = (L: Lf, s = 1): Part[] => [
  { ...cyl('Pot', 1.4 * s, 1.3 * s, L(0, 0, 0), PB.dirt, POT, 10), taper: 1.25 },
  { ...cyl('Leaves', 2.4 * s, 2.6 * s, L(0, 1.3 * s, 0), LEAVES, LEAVES, 8), taper: 0.35 },
]
const lockers = (L: Lf, n: number, tex: Tex = PB.boxBlue): Part[] => [box('Lockers', [1.5 * n, 4.6, 1.6], L(0, 0, 0), PB.steel, tex), ...[...Array(n)].map((_, i) => box('Locker vent', [0.8, 0.4, 0.05], L((i - (n - 1) / 2) * 1.5, 3.8, 0.8), BLACK))]
const crate = (L: Lf, s = 2.4): Part[] => [box('Crate', [s, s, s], L(0, 0, 0), PB.planks)]
const milkCrate = (L: Lf, tex: Tex = PB.red): Part[] => [box('Milk crate', [1.3, 1, 1.3], L(0, 0, 0), BLACK, tex)]
const barrel = (L: Lf, tex: Tex = PB.boxBlue): Part[] => [cyl('Barrel', 1.6, 2.2, L(0, 0, 0), tex, tex, 10)]
const trashBags = (L: Lf): Part[] => [[0, 0, 1], [1.1, 0.4, 0.85], [0.4, -1, 0.9]].map(([x, z, s]) => ({ ...cyl('Trash bag', 1.4 * s, 1.2 * s, L(x, 0, z), BLACK, BLACK, 7), taper: 0.5 }))
const grill = (L: Lf): Part[] => [
  ...[-0.5, 0.5].map((x) => box('Grill leg', [0.15, 2, 0.15], L(x, 0, 0), BLACK)),
  { ...cyl('Grill', 1.8, 0.9, L(0, 1.9, 0), BLACK, BLACK, 10), taper: 1.4 }, { ...cyl('Grill lid', 2.4, 0.7, L(0, 2.8, 0), BLACK, BLACK, 10), taper: 0.4 },
]
const boombox = (L: Lf): Part[] => [box('Boombox', [2.2, 1, 0.6], L(0, 0, 0), PB.steel), ...[-0.6, 0.6].map((x) => lying('Speaker', 0.7, 0.1, L(x, 0.15, 0.32), BLACK, BLACK, 10, 90)), box('Handle', [1.6, 0.15, 0.15], L(0, 1, 0), BLACK)]
const foldingChair = (L: Lf, tex: Tex = PB.green): Part[] => [box('Chair frame', [1.4, 0.9, 1.3], L(0, 0, 0), PB.steel), box('Seat', [1.5, 0.15, 1.4], L(0, 0.9, 0), tex), box('Chair back', [1.5, 1.4, 0.15], L(0, 1, -0.65), tex)]
const picnicCooler = (L: Lf, tex: Tex = PB.blue): Part[] => [box('Cooler', [2, 1.2, 1.2], L(0, 0, 0), WHITE, tex)]
/** A sedan: body, cabin and wheels (no lights), front +Z. */
const sedan = (L: Lf, paint: Tex, wheelsOn = true): Part[] => [
  { ...box('Car body', [4, 1.35, 8], L(0, 0.5, 0), paint), bevel: 0.35 }, { ...box('Car cabin', [3.5, 1.15, 4.2], L(0, 1.85, -0.4), GLASS, paint), bevel: 0.4 },
  ...(wheelsOn ? wheels(L, 3.6, [2.6, -2.6]) : [-2.6, 2.6].flatMap((z) => [-1.4, 1.4].map((x) => box('Block', [1, 0.5, 1], L(x, 0, z), PB.cinder)))),
]
const CAR_PAINTS = [PB.car('#b8322a', 341), PB.car('#2a5ab8', 342), PB.car('#d0d0d0', 343), PB.car('#202020', 344), PB.car('#7a2a7a', 348)]
/** A stoop: steps up to a raised door, with side walls. */
const stoopParts = (L: Lf, h: number, w = 4, tex: Tex = STONE): Part[] => [
  stairs('Stoop', [w, h, h * 1.8], L(0, 0, h * 0.9), tex, tex, 0, Math.max(2, Math.ceil(h / 0.5))),
  ...[-1, 1].map((s) => box('Stoop wall', [0.4, h + 0.8, h * 1.8], L(s * (w / 2 + 0.2), 0, h * 0.9), tex)),
]
/** A tall sign on a pole: a lit panel with a bright border. */
const poleSign = (L: Lf, h: number, panel: Tex, w = 8, ph = 4): Part[] => [
  cyl('Sign pole', 0.8, h, L(0, 0, 0), PB.steel, PB.steel, 8), box('Sign panel', [w, ph, 0.8], L(0, h, 0), BLACK, panel),
  box('Sign border', [w + 0.4, 0.4, 1], L(0, h + ph, 0), CY.white), box('Sign border', [w + 0.4, 0.4, 1], L(0, h - 0.4, 0), CY.white),
]
const flagpole = (L: Lf, h = 14, flag: Tex = PB.blue): Part[] => [cyl('Flag pole', 0.3, h, L(0, 0, 0), PB.steel, PB.steel, 6), box('Flag', [3, 2, 0.1], L(1.6, h - 2.4, 0), flag)]

const STOREFRONT: Tex = { gen: 'storefront', tweak: { seed: 321 } }
const GARAGE_DOOR: Tex = { gen: 'garage_door', tweak: { seed: 322 } }

// ---------------- homes ----------------

const HOMES: Record<string, Def> = {
  rowhouses: {
    category: 'Buildings', label: 'Row houses', hint: 'A terrace of narrow houses with stoops, bay windows and cornices (solid: use Townhouse for one you can enter)',
    ...pfp('Row houses', [num('n', 'Houses', 2, 8, 4), num('floors', 'Floors', 2, 4, 3),
      sel('style', 'Style', [['mixed', 'Mixed'], ['brick', 'Red brick'], ['darkbrick', 'Dark brick'], ['beige', 'Beige'], ['plaster', 'Plaster']], 'mixed')], (L, p) => {
      const n = +p.n, W = 10, D = 16, fl = +p.floors
      const styles: Style[] = p.style === 'mixed' ? ['brick', 'beige', 'darkbrick', 'plaster'] : [p.style as Style]
      return [...Array(n)].flatMap((_, i) => {
        const x = (i - (n - 1) / 2) * W, h = fl * FLOOR + 1.6 + (i % 3 === 1 ? 1 : 0), st = styles[i % styles.length], dx = i % 2 ? 2.5 : -2.5
        return [
          box('Row house', [W, h, D], L(x, 0, 0), ROOF, facadeTex(st), 0, FLOOR),
          box('Cornice', [W - 0.05, 0.8, 1], L(x, h - 1, D / 2 + 0.5), PB.concrete),
          box('Parapet', [W - 0.05, 0.9, 0.4], L(x, h, D / 2 - 0.2), PB.concrete),
          box('Front door', [2.4, 4.2, 0.2], L(x + dx, 1.6, D / 2 + 0.1), DARK_WOOD),
          box('Door hood', [3.2, 0.3, 1.2], L(x + dx, 6, D / 2 + 0.6), PB.concrete),
          ...at(L, x + dx, D / 2, 0, (M) => stoopParts(M, 1.6, 3)),
          box('Bay window', [4, FLOOR * (fl - 1) - 1, 1.4], L(x - dx * 0.8, FLOOR + 0.6, D / 2 + 0.7), PB.concrete, facadeTex(st), 0, FLOOR),
        ]
      })
    }),
  },
  townhouse: {
    category: 'Buildings', label: 'Townhouse', hint: 'A townhouse you can enter: a stoop up to the door, stairs inside to every floor (and the roof), a furnished flat on each floor',
    ...pfp('Townhouse', [num('floors', 'Floors', 2, 4, 3), wallParam('brick'), yesNo('roof', 'Stairs to the roof', 'yes'), yesNo('furniture', 'Furniture', 'yes')], (L, p) => {
      const n = +p.floors, w = 14, d = 20, b = 1.6, top = b + n * FLOOR
      const parts = storeys(L, { w, d, n, base: b, side: wallTex(p), top: PB.concrete, floor: FLOOR_WOOD, windows: true,
        front: (k) => (k === 0 ? [DOOR(3), WIN(-3)] : [WIN(-3), WIN(3)]), back: (k) => (k === 0 ? [DOOR(3, 3.6)] : []), toRoof: p.roof === 'yes' })
      parts.push(...at(L, 3, d / 2, 0, (M) => stoopParts(M, b, 4.4)), box('Door hood', [5, 0.3, 1.4], L(3, b + 6, d / 2 + 0.7), PB.concrete),
        box('Cornice', [w + 0.6, 0.6, 0.8], L(0, top - 0.8, d / 2 + 0.4), PB.concrete))
      if (p.furniture === 'yes') for (let k = 0; k < n; k++) {
        const y = k === 0 ? b : floorY(k, b)
        parts.push(...(k % 2 === 0
          ? [...at(L, 5.2, -3, 270, (M) => couch(M, 5), y), ...at(L, 1.6, -3, 90, tv, y), ...at(L, 3.5, -8.4, 0, (M) => counter(M, 5, MARBLE, LIGHT_WOOD, false), y)]
          : [...at(L, 4, -5, 0, bed, y), ...at(L, 5.5, 7.5, 0, pottedPlant, y), ...at(L, 2, 7.6, 180, (M) => wallShelf(M, 4, GOODS, 4), y)]))
      }
      return parts
    }),
  },
  suburbhouse: {
    category: 'Buildings', label: 'Suburban house', hint: 'A two-storey family house you can enter, with a porch, a pitched roof, stairs and an attached garage',
    ...pfp('Suburban house', [sidingParam('blue'), yesNo('garage', 'Garage', 'yes'), yesNo('car', 'Car in the garage', 'yes'), yesNo('furniture', 'Furniture', 'yes')], (L, p) => {
      const w = 18, d = 16, side = sidingTex(p)
      const parts = storeys(L, { w, d, n: 2, side, top: WHITE, floor: FLOOR_WOOD, windows: true, roof: 'gable',
        front: (k) => (k === 0 ? [DOOR(2)] : []), back: (k) => (k === 0 ? [DOOR(-2, 3.6)] : []) })
      parts.push(
        box('Porch', [10, 0.6, 4], L(2, 0, d / 2 + 2), PB.planks, WHITE), stairs('Porch steps', [3, 0.6, 1.2], L(2, 0, d / 2 + 4.6), PB.planks, WHITE, 0, 2),
        ...[-2.6, 6.6].map((x) => box('Porch post', [0.4, 5.6, 0.4], L(x, 0.6, d / 2 + 3.7), WHITE)), box('Porch roof', [10.6, 0.3, 4.4], L(2, 6.2, d / 2 + 2.1), SLATE, WHITE),
        cyl('Mailbox post', 0.3, 2.6, L(-6, 0, d / 2 + 9), PB.wood, PB.wood, 6), box('Mailbox', [0.8, 0.8, 1.4], L(-6, 2.6, d / 2 + 9), PB.black),
      )
      if (p.garage === 'yes') {
        parts.push(...at(L, 15, 0, 0, (M) => shell(M, { w: 12, d, h: 7, side, top: WHITE, floor: PB.floorWorn, front: [DOOR(0, 9, 6.2)], back: [DOOR(3, 3.6)] })),
          gable(L, 15, 0, 12.8, d + 1.2, 3.6, 7, SLATE, side, true), box('Garage door', [9, 0.8, 0.2], L(15, 6.2, d / 2 - 0.6), GARAGE_DOOR),
          box('Driveway', [10, 0.1, 10], L(15, 0, d / 2 + 5), PB.concrete))
        if (p.car === 'yes') parts.push(...at(L, 15, -0.5, 0, (M) => sedan(M, CAR_PAINTS[1]), FL))
      }
      if (p.furniture === 'yes') parts.push(
        ...at(L, 6.2, -2, 270, (M) => couch(M, 5), FL), ...at(L, 1.4, -2, 90, tv, FL), ...at(L, 4, -6, 0, (M) => counter(M, 7, MARBLE, LIGHT_WOOD, false), FL),
        ...at(L, 6, 4.6, 0, (M) => table(M, 3.6, 2.4), FL), ...at(L, 5, -3.5, 0, bed, floorY(1)), ...at(L, 5, 4.1, 180, bed, floorY(1)),
      )
      return parts
    }),
  },
  bungalow: {
    category: 'Buildings', label: 'Bungalow', hint: 'A one-storey house you can walk through: porch, front and back doors, pitched roof, living room, kitchen and bedroom',
    ...pfp('Bungalow', [sidingParam('yellow'), yesNo('furniture', 'Furniture', 'yes')], (L, p) => {
      const w = 20, d = 14, side = sidingTex(p)
      const parts = [
        ...shell(L, { w, d, h: 7, side, top: WHITE, floor: FLOOR_WOOD, front: [DOOR(-3)], back: [DOOR(-7, 3.6)], windows: true }),
        ...wall(L, 'z', -d / 2 + T, d / 2 - T, 3, 7, 0.3, PB.plaster, PB.plaster, [DOOR(-2, 3.2)], 0, 'Inner wall'),
        gable(L, 0, 0, w + 1.6, d + 2, 5, 7, SLATE, side),
        box('Porch', [10, 0.6, 3.6], L(-3, 0, d / 2 + 1.8), PB.planks, WHITE), stairs('Porch steps', [3, 0.6, 1.2], L(-3, 0, d / 2 + 4.2), PB.planks, WHITE, 0, 2),
        ...[-7.6, 1.6].map((x) => box('Porch post', [0.4, 5.8, 0.4], L(x, 0.6, d / 2 + 3.3), WHITE)), box('Porch roof', [10.6, 0.3, 4], L(-3, 6.4, d / 2 + 1.9), SLATE, WHITE),
      ]
      if (p.furniture === 'yes') parts.push(
        ...at(L, -8.2, 0, 90, (M) => couch(M, 6), FL), ...at(L, -2, 0, 270, tv, FL), ...at(L, -1.5, -5.6, 0, (M) => counter(M, 6, MARBLE, LIGHT_WOOD, false), FL),
        ...at(L, 6.5, -2.8, 0, bed, FL), ...at(L, 8.5, 5, 0, pottedPlant, FL),
      )
      return parts
    }),
  },
  mobilehome: {
    category: 'Buildings', label: 'Mobile home', hint: 'A trailer home you can step into: single or double-wide, tidy or run-down, with a deck and an awning',
    ...pfp('Mobile home', [sel('size', 'Size', [['single', 'Single-wide'], ['double', 'Double-wide']], 'single'), sel('state', 'State', [['tidy', 'Tidy'], ['rundown', 'Run-down']], 'tidy'),
      sidingParam('white'), yesNo('deck', 'Deck and awning', 'yes'), yesNo('furniture', 'Furniture', 'yes')], (L, p) => {
      const w = 26, d = p.size === 'double' ? 14 : 8.5, b = 1.2, h = 6.4, hd = d / 2
      const rough = p.state === 'rundown', side = rough ? PB.rusty : sidingTex(p)
      const front = [DOOR(3, 3.4, 5, b), WIN(-8, 3, 2.2, b + 2), WIN(-2.5, 3, 2.2, b + 2), WIN(9, 3, 2.2, b + 2)]
      const parts = [
        box('Skirting', [w + 0.2, b - 0.05, d + 0.2], L(0, 0, 0), PB.corrugated),
        box('Trailer floor', [w - 2 * T, b, d - 2 * T], L(0, 0, 0), FABRIC, PB.concrete),
        ...shell(L, { w, d, h: b + h, side, top: WHITE, front, back: [WIN(-8, 3, 2.2, b + 2), WIN(6, 3, 2.2, b + 2)], left: [WIN(0, 2.4, 2.2, b + 2)] }),
        { ...box('Trailer roof', [w + 0.4, 0.5, d + 0.4], L(0, b + h, 0), WHITE, side), bevel: 0.2 },
        ...wall(L, 'z', -hd + T, hd - T, -5, h, 0.25, PB.plaster, PB.plaster, [DOOR(0, 3, 5)], b, 'Inner wall'),
        box('Stripe', [w / 2 + 3 - 1.7, 0.5, 0.06], L((-w / 2 + 3 - 1.7) / 2, b + 1.2, hd + 0.03), PB.blue),
        box('Stripe', [w / 2 - 3 - 1.7, 0.5, 0.06], L((w / 2 + 3 + 1.7) / 2, b + 1.2, hd + 0.03), PB.blue),
        box('Hitch', [3, 0.5, 1], L(-w / 2 - 1.5, 0.3, 0), BLACK),
      ]
      if (p.deck === 'yes') parts.push(
        box('Deck', [8, b, 5], L(3, 0, hd + 2.5), PB.planks, PB.wood), stairs('Deck steps', [3, b, 2], L(3, 0, hd + 6), PB.planks, PB.wood, 0, 3),
        ...[-1, 1].map((s) => box('Deck rail', [2.4, 1.1, 0.2], L(3 + s * 2.8, b, hd + 4.9), PB.wood)),
        ...[-1, 1].map((s) => box('Awning post', [0.3, 5.6, 0.3], L(3 + s * 3.8, b, hd + 4.8), PB.steel)),
        box('Awning', [9, 0.2, 5.4], L(3, b + 5.6, hd + 2.6), rough ? TARP : PB.green, PB.steel),
      )
      else parts.push(stairs('Steps', [3, b, 2], L(3, 0, hd + 1), PB.concrete, PB.concrete, 0, 3))
      if (rough) parts.push(
        box('Boarded window', [3.6, 2.8, 0.2], L(-8, b + 1.7, hd + 0.1), PLYWOOD), box('Roof tarp', [8, 0.15, d - 1], L(-6, b + h + 0.5, 0), TARP),
        ...[-1, 1].map((s) => cyl('Tire', 2.4, 0.8, L(-6 + s * 2.5, b + h + 0.65, 0), PB.tire, PB.tire, 10)), ...at(L, -10, hd + 1.5, 0, trashBags),
      )
      if (p.furniture === 'yes') parts.push(
        ...at(L, -9.5, 0, 0, bed, b), ...at(L, 6.5, -hd + 1.5, 0, (M) => couch(M, 6), b), ...at(L, 6.5, hd - 1, 180, tv, b),
        ...at(L, 11.4, 0, 270, (M) => counter(M, Math.min(6, d - 2), MARBLE, LIGHT_WOOD, false), b),
      )
      return parts
    }),
  },
  crib: {
    category: 'Buildings', label: 'Crib', hint: 'A gang hideout: a loft with a garage, lounge, bar and pool table, rooms upstairs and a roof deck with a hot tub. Purple trim, no logos',
    ...pfp('Crib', [num('floors', 'Floors', 2, 3, 2), colorParam('trim', 'Trim', 'purple'), yesNo('car', 'Car in the garage', 'yes')], (L, p) => {
      const n = +p.floors, w = 28, d = 20, trim = colorTex(p, 'trim'), glow = p.trim === 'purple' ? CY.purple : trim, top = n * FLOOR
      const parts = storeys(L, { w, d, n, side: PB.oldBrick, top: PB.concrete, floor: FLOOR_WOOD, windows: true, toRoof: true,
        front: (k) => (k === 0 ? [DOOR(-2), DOOR(8, 9, 6.2)] : []), back: (k) => (k === 0 ? [DOOR(4, 3.6)] : []) })
      parts.push(
        box('Trim', [w + 0.6, 0.8, 0.5], L(0, top - 0.9, d / 2 + 0.25), trim), box('Sign band', [10, 1.2, 0.3], L(-2, 5.8, d / 2 + 0.15), glow),
        ramp('Awning', [6, 0.8, 2.4], L(-2, 4.6, d / 2 + 1.2), trim), box('Garage door', [9, 0.8, 0.2], L(8, 6.2, d / 2 - 0.6), GARAGE_DOOR),
        // Ground floor: garage on the right, lounge and bar.
        ...at(L, 1.6, -4, 90, (M) => [box('Pool table', [4.4, 1.5, 8], M(0, 0.2, 0), DARK_WOOD), box('Felt', [3.8, 0.12, 7.4], M(0, 1.7, 0), FELT), ...legs(M, 4, 7.4, 0.2, DARK_WOOD, 0.6)], FL),
        ...at(L, 7, -8.2, 0, (M) => counter(M, 9, MARBLE, PURPLE, false), FL), box('Bottle shelf', [9, 3, 0.6], L(7, 2.4, -9.4), DARK_WOOD, BOTTLES[0]),
        ...at(L, 7, -6.4, 0, (M) => row(M, 4, 2.2, (N) => stool(N, PURPLE)), FL),
        box('Neon strip', [w - 2, 0.25, 0.15], L(0, 6.2, -d / 2 + 0.6), glow),
        ...at(L, -5.5, 6.8, 90, tv, FL), ...at(L, 0.5, 6.8, 270, (M) => couch(M, 5, LEATHER), FL),
      )
      if (p.car === 'yes') parts.push(...at(L, 8.5, 2, 0, (M) => sedan(M, CAR_PAINTS[4]), FL))
      // Upstairs: bedroom, lounge, the stash.
      const y1 = floorY(1)
      parts.push(...at(L, 9, -5, 0, (M) => bed(M, PURPLE), y1), ...at(L, 2, 4, 180, (M) => couch(M, 6, PURPLE), y1), ...at(L, 2, 8.4, 180, tv, y1),
        box('Safe', [2.4, 3, 2.2], L(12, y1, 7.6), PB.steel, BLACK), box('Cash stack', [2, 1, 1.4], L(12, y1 + 3, 7.6), CASH),
        ...at(L, 12.6, -1, 270, (M) => lockers(M, 3, PURPLE), y1))
      // Roof deck: hot tub and loungers.
      parts.push(cyl('Hot tub', 6, 2.2, L(8, top, -3), WATER, PURPLE, 14), ...[0, 3].map((x) => ramp('Lounger', [2, 1, 5], L(2 + x, top, 5), WHITE, PB.steel)))
      return parts
    }),
  },
  penthouse: {
    category: 'Buildings', label: 'Rooftop penthouse', hint: 'A glass-walled penthouse on a roof deck with a pool, loungers and a bar. Raise it onto a tower roof (its height), or use it as a rooftop arena',
    ...pfp('Penthouse', [yesNo('pool', 'Pool', 'yes')], (L, p) => {
      const W = 36, D = 28
      const parts = [
        box('Roof deck', [W, 0.6, D], L(0, 0, 0), LIGHT_WOOD, PB.concrete),
        ...[[0, -D / 2 + 0.15, W, 0], [0, D / 2 - 0.15, W, 0], [-W / 2 + 0.15, 0, D - 0.6, 90], [W / 2 - 0.15, 0, D - 0.6, 90]].map(([x, z, len, r]) => box('Glass railing', [len, 1.4, 0.3], L(x, 0.6, z), PB.steel, GLASS, r)),
        ...at(L, -7, -4, 0, (M) => shell(M, { w: 20, d: 16, h: 8, side: GLASS, top: CY.white, floor: MARBLE, front: [DOOR(-4, 5, 6.4), DOOR(4, 5, 6.4)], right: [DOOR(3, 4, 6.4)] }), 0.6),
        { ...box('Penthouse roof', [22, 0.6, 18], L(-7, 8.6, -4), ROOF, CY.white), bevel: 0.1 },
        ...[-14, -7, 0].map((x) => box('Mullion', [0.3, 8, 0.3], L(x - 2.5, 0.6, 4.1), CY.white)),
        ...at(L, -9, -7, 0, (M) => couch(M, 7, WHITE), 0.75), ...at(L, -9, -1.5, 180, (M) => table(M, 3, 2, MARBLE), 0.75), ...at(L, -14, -9.6, 0, bed, 0.75),
        ...at(L, -1, -10.6, 0, (M) => counter(M, 6, MARBLE, BLACK, false), 0.75), ...at(L, -16, 2.5, 0, pottedPlant, 0.75),
        ...[0, 3.2, 6.4].map((x) => ramp('Lounger', [2, 1, 5], L(-10 + x, 0.6, 9.5), WHITE, PB.steel)),
        ...at(L, 7, 10, 0, (M) => roundTable(M, 2.6), 0.6),
      ]
      if (p.pool === 'yes') parts.push(...at(L, 11, -2, 0, (M) => poolParts(M, 8, 12, 3), 0.6))
      return parts
    }),
  },
  projects: {
    category: 'Buildings', label: 'Projects block', hint: 'A housing-projects block: open walkways along every floor, an open stair tower up to each walkway and onto the roof',
    ...pfp('Projects', [num('floors', 'Floors', 2, 6, 4), num('w', 'Width', 24, 60, 36, 4), sel('style', 'Style', [['projects', 'Projects'], ['concrete', 'Concrete'], ['brick', 'Red brick'], ['beige', 'Beige']], 'projects')], (L, p) => {
      const n = +p.floors, W = +p.w, D = 14, G = 4, top = n * FLOOR, zf = D / 2 + G
      const parts: Part[] = [box('Projects block', [W, top, D], L(0, 0, 0), ROOF, facadeTex(p.style as Style), 0, FLOOR)]
      for (let k = 0; k < n; k++) {
        for (let x = -W / 2 + 4; x < W / 2 - 2; x += 8) parts.push(box('Flat door', [2.4, 4.6, 0.15], L(x, k * FLOOR, D / 2 + 0.07), STEEL_DOOR))
        if (k > 0) parts.push(box('Walkway', [W, 0.4, G], L(0, k * FLOOR - 0.4, D / 2 + G / 2), PB.concrete), box('Walkway wall', [W, 1.2, 0.3], L(0, k * FLOOR, zf - 0.15), PB.concrete))
      }
      for (let x = -W / 2 + 0.3; x < W / 2; x += 8) parts.push(box('Walkway post', [0.6, top - 0.4, 0.6], L(x, 0, zf - 0.3), PB.concrete))
      parts.push(box('Walkway roof', [W, 0.4, G], L(0, top - 0.4, D / 2 + G / 2), ROOF, PB.concrete),
        // Roof edge, left open toward the stair tower so both roofs join.
        box('Parapet', [W, 1.1, 0.5], L(0, top, -D / 2 + 0.25), PB.concrete), box('Parapet', [W, 1.1, 0.5], L(0, top, zf - 0.25), PB.concrete),
        box('Parapet', [0.5, 1.1, zf + D / 2 - 1], L(-W / 2 + 0.25, top, (zf - D / 2) / 2), PB.concrete))
      // The stair tower: its lanes along the far wall, a corridor to each walkway door.
      parts.push(...at(L, W / 2 + 5, 3, 0, (M) => storeys(M, { w: 10, d: 16, n, side: PB.cinder, top: PB.concrete, floor: PB.floorWorn, stairSide: 'right', toRoof: true,
        front: (k) => (k === 0 ? [DOOR(-1.5)] : []), left: (k) => (k === 0 ? [] : [DOOR(6, 3)]) })))
      return parts
    }),
  },
  apartmenttower: {
    category: 'Buildings', label: 'Apartment tower', hint: 'A high-rise of flats with balconies up the front, a lobby entrance under a canopy and rooftop water tanks',
    ...pfp('Apartment tower', [num('floors', 'Floors', 5, 24, 12), num('w', 'Width', 20, 40, 24, 2),
      sel('style', 'Style', [['apartment', 'Apartments'], ['concrete', 'Concrete'], ['beige', 'Beige'], ['brick', 'Red brick'], ['projects', 'Projects']], 'apartment'), yesNo('balconies', 'Balconies', 'yes')], (L, p) => {
      const n = +p.floors, W = +p.w, D = 20, top = n * FLOOR, hd = D / 2
      const parts: Part[] = [
        box('Apartment tower', [W, top, D], L(0, 0, 0), ROOF, facadeTex(p.style as Style), 0, FLOOR),
        box('Lobby doors', [8, 5.6, 0.2], L(0, 0, hd + 0.1), STOREFRONT), box('Canopy', [11, 0.5, 5.5], L(0, 6, hd + 2.75), PB.steel),
        ...[-5, 5].map((x) => box('Canopy post', [0.4, 6, 0.4], L(x, 0, hd + 5.2), PB.steel)),
        ...parapet(L, W, D, top, PB.concrete),
        ...[[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]].map(([a, b]) => box('Tank leg', [0.4, 3, 0.4], L(W / 2 - 5 + a, top, -hd + 5 + b), PB.steel)),
        cyl('Water tank', 4.5, 4.5, L(W / 2 - 5, top + 3, -hd + 5), PB.wood, PB.planks, 14), { ...cyl('Tank roof', 4.9, 1.6, L(W / 2 - 5, top + 7.5, -hd + 5), PB.wood, PB.wood, 14), taper: 0 },
        box('Stair hut', [4, 3.2, 4], L(-W / 2 + 4, top, -hd + 4), PB.concrete), box('AC unit', [3, 2, 4], L(-W / 2 + 4, top, hd - 4), PB.steel),
      ]
      if (p.balconies === 'yes') for (let k = 1; k < n; k++) for (const bx of [-W / 4, W / 4]) {
        const x = bx + (k % 2 ? 1 : -1), y = k * FLOOR
        parts.push(box('Balcony', [6, 0.35, 2.6], L(x, y - 0.35, hd + 1.3), PB.concrete), box('Balcony rail', [6, 1.2, 0.2], L(x, y, hd + 2.5), PB.steel),
          ...[-1, 1].map((s) => box('Balcony rail', [0.2, 1.2, 2.4], L(x + s * 2.9, y, hd + 1.3), PB.steel)))
      }
      return parts
    }),
  },
}


// ---------------- shops and food ----------------

const STEEL_SIDING: Tex = { gen: 'metal_plate', tweak: { color: '#c8ccd0', accent: '#9aa0a6', scale: 6, wear: 0.05, seed: 650 }, surface: 15 }
const BUCKET: Tex = { gen: 'hazard', tweak: { color: '#c8322b', accent: '#f2efe6', scale: 6, wear: 0.1, seed: 651 } }
const CLUB_WALL = solid('#1b1622', '#120e18', 652, 15)
const PRINT_CLOTH: Tex = { gen: 'tiles', tweak: { color: '#c8322b', accent: '#f2efe6', scale: 4, wear: 0.1, seed: 654 }, surface: 17 }
const FRYER: Tex = { gen: 'metal_plate', tweak: { color: '#b9bcc0', accent: '#8d9094', scale: 2, wear: 0.2, seed: 653 }, surface: 15 }

/** The settings every shop shares: floors over it, walls, sign and awning. */
const shopParams = (o: { floors?: number; upper?: string; walls?: string; sign?: string; awning?: string } = {}): ParamDef[] => [
  ...upperParams(o.floors ?? 1, o.upper ?? 'brick'), wallParam(o.walls ?? 'brick'), signParam(o.sign ?? 'red'), awningParam(o.awning ?? 'red'),
]
/** A shop prefab from its shell options (given the settings) and its fittings. */
const shop = (name: string, label: string, hint: string, defaults: Parameters<typeof shopParams>[0], extra: ParamDef[],
  o: (p: Params) => Omit<ShopOptions, 'walls' | 'sign' | 'awning' | 'floors' | 'style'> & Partial<ShopOptions>, fit: (L: Lf, p: Params) => Part[]): Def => ({
  category: 'Shops', label, hint,
  ...pfp(name, [...shopParams(defaults), ...extra], (L, p) => [
    ...shopShell(L, { walls: wallTex(p), sign: signTex(p), awning: awningTex(p), ...upperOf(p), ...o(p) }),
    ...fit(L, p),
  ]),
})

const washer = (L: Lf, y = 0): Part[] => [
  box('Washer', [2.2, 2.6, 2.2], L(0, y, 0), WHITE), lying('Washer door', 1.5, 0.12, L(0, y + 0.55, 1.12), MIRROR, MIRROR, 12, 90),
  box('Control panel', [2.2, 0.5, 0.4], L(0, y + 2.6, -0.9), PB.steel),
]
const barberChair = (L: Lf, tex: Tex = LEATHER): Part[] => [
  cyl('Chair base', 1.6, 0.3, L(0, 0, 0), PB.steel, PB.steel, 10), cyl('Chair post', 0.4, 1.2, L(0, 0.3, 0), PB.steel, PB.steel, 8),
  box('Seat', [1.8, 0.5, 1.8], L(0, 1.5, 0), tex), box('Chair back', [1.8, 2.2, 0.3], L(0, 1.8, -0.8), tex),
  ...[-1, 1].map((s) => box('Armrest', [0.25, 0.25, 1.6], L(s * 1, 2.4, 0), PB.steel)), box('Footrest', [1.4, 0.2, 0.8], L(0, 0.5, 1.3), PB.steel),
]
const hoodDryer = (L: Lf): Part[] => [...plasticChair(L, FROSTING), cyl('Dryer post', 0.3, 3.4, L(0, 0, -1.1), PB.steel, PB.steel, 6), { ...cyl('Dryer hood', 1.8, 1.2, L(0, 3.3, -0.4), WHITE, WHITE, 10), taper: 0.6 }]
const ropeLine = (L: Lf, n: number, gap: number, post: Tex = CY.gold, rope: Tex = PB.red): Part[] => [
  ...[...Array(n)].map((_, i) => cyl('Rope post', 0.4, 2.8, L((i - (n - 1) / 2) * gap, 0, 0), post, post, 8)),
  box('Rope', [(n - 1) * gap, 0.2, 0.2], L(0, 2.3, 0), rope),
]
const iceChest = (L: Lf): Part[] => [box('Ice chest', [5, 4, 2.4], L(0, 0, 0), WHITE, PB.blue), box('Ice chest band', [5.05, 0.8, 2.45], L(0, 2.8, 0), CY.white)]
const propaneCage = (L: Lf): Part[] => [
  box('Cage', [4, 4.4, 2], L(0, 0, 0), PB.steel, CHAIN),
]
const picnicTable = (L: Lf, tex: Tex = PB.wood): Part[] => [
  box('Table top', [6, 0.25, 2.2], L(0, 1.45, 0), tex), ...[-2.4, 2.4].map((x) => box('Table leg', [0.25, 1.45, 2], L(x, 0, 0), tex)),
  ...[-1.7, 1.7].map((z) => box('Bench seat', [6, 0.2, 0.8], L(0, 0.8, z), tex)),
]
const umbrella = (L: Lf, tex: Tex): Part[] => [cyl('Umbrella pole', 0.15, 4.4, L(0, 0, 0), PB.steel, PB.steel, 6), { ...cyl('Umbrella', 6, 1, L(0, 4.4, 0), tex, tex, 8), taper: 0 }]
const trashCan = (L: Lf): Part[] => [{ ...cyl('Trash can', 1.4, 2, L(0, 0, 0), PB.black, PB.boxGreen, 10), taper: 1.1 }]

const SHOPS: Record<string, Def> = {
  liquorstore: shop('Liquor store', 'Liquor store', 'A corner liquor store: barred windows, doors on two sides, aisles, coolers and a counter behind thick glass', { sign: 'neonorange', awning: 'none' }, [],
    () => ({ w: 20, d: 16, doors: [DOOR(-6)], right: [DOOR(4)], display: [1, 6.5], displayW: 4.5, floor: PB.tilesWhite, bars: true }),
    (L) => [
      ...at(L, 6, -2.5, 0, (M) => counter(M, 7), FL), box('Security glass', [7, 3, 0.15], L(6, FL + 2.1, -1.6), GLASS),
      ...at(L, 5.5, -7.1, 0, (M) => wallShelf(M, 8, BOTTLES), FL),
      ...at(L, -5.6, -0.5, 90, (M) => aisle(M, 8), FL), ...at(L, -1.8, -0.5, 90, (M) => aisle(M, 8), FL),
      ...at(L, -8.3, -1, 90, (M) => cooler(M, 3), FL),
    ]),
  laundromat: shop('Laundromat', 'Laundromat', 'Rows of washers and stacked dryers, a folding table and plastic chairs', { sign: 'cyan', awning: 'blue', walls: 'beige' }, [],
    () => ({ w: 20, d: 18, doors: [DOOR(0)], display: [-6, 6], displayW: 6, floor: PB.tilesWhite }),
    (L) => [
      ...at(L, -8.2, 0, 90, (M) => row(M, 6, 2.4, (N) => washer(N)), FL),
      ...at(L, 1.5, -7.3, 0, (M) => row(M, 5, 2.4, (N) => [...washer(N), ...washer(N, 2.6)]), FL),
      ...at(L, 1, -1, 0, (M) => table(M, 8, 2.6, WHITE), FL),
      ...at(L, 8.4, 0, 270, (M) => row(M, 4, 2, (N) => plasticChair(N, PB.orange)), FL),
    ]),
  barbershop: shop('Barbershop', 'Barbershop', 'Barber chairs facing a long mirror, waiting chairs and a striped pole by the door', { floors: 1, sign: 'white', awning: 'red' }, [],
    () => ({ w: 14, d: 14, doors: [DOOR(-4)], display: [3], displayW: 5, floor: CHECKER }),
    (L) => [
      cyl('Barber pole', 0.7, 3.2, L(-1.2, 2, 7.6), BARBER, BARBER, 10), cyl('Pole cap', 0.9, 0.4, L(-1.2, 5.2, 7.6), PB.steel, PB.steel, 10), cyl('Pole cap', 0.9, 0.4, L(-1.2, 1.6, 7.6), PB.steel, PB.steel, 10),
      box('Mirror', [0.1, 2.6, 10], L(6.35, 2.6, -1), MIRROR), box('Mirror shelf', [0.9, 0.2, 10], L(6, 2.2, -1), MARBLE),
      ...[-5, -1.5, 2].flatMap((z) => at(L, 4.2, z, 90, (M) => barberChair(M), FL)),
      ...at(L, -5.6, -1.5, 90, (M) => row(M, 4, 2, (N) => plasticChair(N, PB.red)), FL),
      box('TV', [3.6, 2.2, 0.25], L(-2, 4, -6.4), BLACK, SCREEN),
    ]),
  beautysalon: shop('Beauty salon', 'Beauty salon', 'Styling chairs at mirrors, hood dryers along the back and a wash basin', { floors: 1, sign: 'pink', awning: 'black', walls: 'plaster' }, [],
    () => ({ w: 16, d: 14, doors: [DOOR(-5)], display: [1.5], displayW: 6, floor: BIG_TILES }),
    (L) => [
      box('Mirror', [0.1, 2.6, 9], L(7.35, 2.6, 0), MIRROR),
      ...[-3, 0.5, 4].flatMap((z) => at(L, 5.2, z, 90, (M) => barberChair(M, FROSTING), FL)),
      ...at(L, -1, -5.2, 0, (M) => row(M, 3, 2.6, hoodDryer), FL),
      ...at(L, -6, -5.2, 0, (M) => [box('Wash basin', [3, 2.2, 1.8], M(0, 0, 0), WHITE), box('Basin', [1.6, 0.1, 1], M(0, 2.2, 0.2), PB.steel)], FL),
      ...at(L, -6.4, 1, 90, (M) => couch(M, 4, FROSTING), FL),
    ]),
  tattooparlor: shop('Tattoo parlor', 'Tattoo parlor', 'A tattoo bench and the artist’s stool, flash art all over the walls, a glass counter and neon', { floors: 1, sign: 'cyan', awning: 'black', walls: 'oldbrick' }, [],
    () => ({ w: 14, d: 14, doors: [DOOR(-4)], display: [3], displayW: 5, floor: PB.floorWorn }),
    (L) => [
      ...at(L, 3, -3, 90, (M) => [box('Tattoo bench', [2, 1.8, 6], M(0, 0, 0), LEATHER), ramp('Headrest', [2, 1, 2], M(0, 1.8, -2), LEATHER)], FL),
      ...at(L, 1.5, -0.8, 0, (M) => stool(M), FL), box('Tool cart', [1.6, 2.4, 1], L(0.6, FL, -5.2), PB.steel),
      ...[-4.5, -1.5, 1.5].map((z, i) => box('Flash art', [0.1, 2.4, 2.4], L(-6.35, 2.4, z), Object.values(MURALS)[i])),
      ...[-4, 0, 4].map((x, i) => box('Flash art', [3, 2, 0.1], L(x, 3, -6.35), Object.values(MURALS)[i + 2])),
      ...at(L, -3.5, -4, 0, (M) => showcase(M, 5, MURALS.purple), FL), box('Neon strip', [12, 0.25, 0.15], L(0, 6.2, -6.4), CY.cyan),
      ...at(L, 4.8, 3.8, 270, (M) => couch(M, 4, LEATHER), FL),
    ]),
  pawnshop: shop('Pawn shop', 'Pawn shop', 'Barred windows, glass cases of jewelry, guitars on the wall and a stack of second-hand TVs', { sign: 'yellow', awning: 'none' }, [],
    () => ({ w: 20, d: 16, doors: [DOOR(-6)], display: [1, 6.5], displayW: 4.5, floor: PB.floorWorn, bars: true }),
    (L) => [
      ...at(L, 3.5, -2.5, 0, (M) => showcase(M, 9, CY.gold), FL), ...at(L, 8.4, 2, 270, (M) => showcase(M, 6, PB.yellow), FL),
      ...[-3, -1.2, 0.6, 2.4, 4.2].map((x, i) => box('Guitar', [1.2, 3, 0.3], L(x + 2, 3.2, -7.35), [PB.red, PB.black, PB.yellow, PB.blue, DARK_WOOD][i])),
      ...at(L, -8.8, -2, 90, (M) => wallShelf(M, 9, [SCREEN, BLACK, PB.steel]), FL),
      ...at(L, -4.5, -5.5, 0, (M) => [box('TV stack', [4, 2.6, 2], M(0, 0, 0), BLACK, SCREEN), box('TV stack', [3, 2.2, 1.8], M(0.3, 2.6, 0), BLACK, SCREEN)], FL),
      box('Register', [1.3, 0.6, 1], L(6, FL + 2.3, -2.5), BLACK),
    ]),
  checkcashing: shop('Check cashing', 'Check cashing', 'Teller windows behind thick glass, a rope line, an ATM and a bench to wait on', { floors: 1, sign: 'green', awning: 'green', walls: 'beige' }, [],
    () => ({ w: 16, d: 14, doors: [DOOR(-4)], display: [3.5], displayW: 5, floor: BIG_TILES }),
    (L) => [
      ...wall(L, 'x', -7.5, 7.5, -2, 7, 0.3, PB.plaster, PB.concrete, [DOOR(-6, 2.4, 5.4), WIN(-2, 2.4, 2.2, 2.1), WIN(1.5, 2.4, 2.2, 2.1), WIN(5, 2.4, 2.2, 2.1)], FL, 'Teller wall'),
      ...[-2, 1.5, 5].flatMap((x) => [box('Teller glass', [2.4, 2.2, 0.08], L(x, FL + 2.1, -2), GLASS), box('Teller ledge', [2.6, 0.15, 1], L(x, FL + 2, -1.4), MARBLE)]),
      ...at(L, 1.5, 1.5, 0, (M) => ropeLine(M, 4, 2.6, PB.steel), FL),
      box('ATM', [2.2, 4.4, 1.6], L(-6.6, FL, 4.2), PB.steel, PB.blue, 90), box('ATM screen', [1.2, 0.8, 0.1], L(-5.75, FL + 2.8, 4.2), SCREEN, SCREEN, 90),
      box('Bench', [4, 0.9, 1.4], L(-5.4, FL, 0.2), DARK_WOOD), box('Safe', [3, 4, 2.4], L(4, FL, -5.6), PB.steel, BLACK),
    ]),
  bailbonds: shop('Bail bonds', 'Bail bonds office', 'A cramped storefront office: a desk, client chairs, filing cabinets and a neon sign', { floors: 1, sign: 'neonorange', awning: 'none', walls: 'plaster' }, [],
    () => ({ w: 12, d: 12, doors: [DOOR(-3)], display: [2.6], displayW: 4, floor: PB.floorWorn }),
    (L) => [
      ...at(L, 1, -2.5, 0, (M) => [...table(M, 5, 2.4, LIGHT_WOOD), box('Monitor', [2, 1.2, 0.15], M(0, 1.55, -0.6), BLACK, SCREEN), ...at(M, 0, -1.9, 0, chair)], FL),
      ...[-0.5, 2.5].flatMap((x) => at(L, x, 0.6, 180, chair, FL)),
      ...[-4.6, -2.8].map((x) => box('Filing cabinet', [1.6, 4, 1.8], L(x, FL, -4.6), PB.steel)), box('Wanted board', [3, 2.4, 0.1], L(-3.6, 3, -5.4), CHALK),
    ]),
  chickenshack: shop('Chicken shack', 'Fried chicken shack', 'A fry counter with a menu board and fryers, booths by the windows and a giant striped bucket on the roof', { floors: 0, sign: 'red', awning: 'red', walls: 'plaster' }, [],
    () => ({ w: 18, d: 16, doors: [DOOR(-5)], display: [1, 6], displayW: 4, floor: CHECKER }),
    (L, p) => {
      const top = 7.4 + +p.floors * FLOOR
      return [
        ...at(L, -1, -2, 0, (M) => counter(M, 10, PB.steel, PB.red), FL), box('Menu board', [9, 2, 0.2], L(-1, 4.4, -7.4), BLACK, PB.yellow),
        ...[-5, -2, 1].map((x) => box('Fryer', [2.4, 2.4, 2], L(x, FL, -6.3), FRYER, BLACK)), box('Heat shelf', [4, 1.4, 1.6], L(4.4, FL, -6.5), PB.steel, PB.orange),
        ...[1, 6].flatMap((x) => at(L, x, 4.1, 0, (M) => booth(M, 4, PB.red), FL)),
        { ...cyl('Rooftop bucket', 5, 5, L(4, top, -3), WHITE, BUCKET, 12), taper: 1.25 }, cyl('Bucket rim', 6.6, 0.5, L(4, top + 5, -3), WHITE, PB.red, 12),
      ]
    }),
  tacostand: {
    category: 'Shops', label: 'Taco stand', hint: 'A walk-up food stand with a service window and a shade roof, picnic tables under umbrellas',
    ...pfp('Taco stand', [colorParam('color', 'Paint', 'orange'), colorParam('umbrellas', 'Umbrellas', 'green')], (L, p) => [
      ...shell(L, { w: 10, d: 8, h: 6.5, side: colorTex(p, 'color'), top: WHITE, floor: PB.floorWorn, front: [WIN(0, 6, 2.6, 2.6)], back: [DOOR(3, 3.2, 5.4)] }),
      box('Shade roof', [12, 0.4, 11], L(0, 6.5, 1.5), WHITE, PB.green), box('Sign band', [9, 1.1, 0.3], L(0, 6.9, 7.2), PB.yellow),
      box('Service ledge', [6.4, 0.2, 1.2], L(0, 2.6, 4.4), PB.steel), box('Griddle', [4, 2.6, 1.8], L(0, FL, -2.6), FRYER, BLACK), box('Prep fridge', [2.4, 2.4, 1.8], L(-3, FL, 0), PB.steel),
      ...[[-6, 13], [6, 13]].flatMap(([x, z]) => [...at(L, x, z, 90, (M) => picnicTable(M, PB.red)), ...at(L, x, z, 0, (M) => umbrella(M, colorTex(p, 'umbrellas')), 1.7)]),
      ...at(L, 9, 6, 0, trashCan),
    ]),
  },
  pizzaplace: shop('Pizza place', 'Pizza place', 'A slice counter with a domed brick oven, tables with checked cloths and a checkered floor', { floors: 1, sign: 'green', awning: 'green' }, [],
    () => ({ w: 18, d: 16, doors: [DOOR(5)], display: [-4], displayW: 7, floor: CHECKER }),
    (L) => [
      ...at(L, 3, -2, 0, (M) => [...counter(M, 10, MARBLE, PB.green), box('Pizza', [1.8, 0.1, 1.8], M(-2, 2.1, 0), PB.orange), box('Pizza', [1.8, 0.1, 1.8], M(0.5, 2.1, 0), PB.yellow)], FL),
      box('Oven base', [5, 2, 3.4], L(4, FL, -5.8), PB.brick), { ...cyl('Pizza oven', 4.6, 2.6, L(4, FL + 2, -5.8), PB.brick, PB.brick, 12), taper: 0.35 },
      box('Oven mouth', [1.6, 1, 0.2], L(4, FL + 2.2, -3.95), BLACK), box('Prep table', [4, 2, 2], L(-1.5, FL, -6.2), PB.steel),
      ...[[-5, 4.2], [-5, -1.2]].flatMap(([x, z]) => [...at(L, x, z, 0, (M) => table(M, 3, 2.4, PRINT_CLOTH), FL), ...at(L, x, z + 2, 180, chair, FL), ...at(L, x, z - 2, 0, chair, FL)]),
    ]),
  noodlebar: shop('Noodle bar', 'Noodle bar', 'A counter with stools looking into an open kitchen, red lanterns hanging from the ceiling', { floors: 1, sign: 'pink', awning: 'red', walls: 'plaster' }, [],
    () => ({ w: 14, d: 14, doors: [DOOR(-4)], display: [3], displayW: 5, floor: FLOOR_WOOD }),
    (L) => [
      ...at(L, 1, -2, 0, (M) => counter(M, 10, LIGHT_WOOD, DARK_WOOD, false), FL), ...at(L, 1, -0.2, 0, (M) => row(M, 4, 2.4, (N) => stool(N, PB.red)), FL),
      box('Stove', [6, 2.2, 1.8], L(1, FL, -5.6), FRYER, BLACK), ...[-1, 1, 3].map((x) => cyl('Pot', 1, 1, L(x, FL + 2.2, -5.6), PB.steel, PB.steel, 8)),
      ...[[-3, 2], [1, 2], [5, 2], [-3, -4], [5, -4]].flatMap(([x, z]) => [box('Lantern cord', [0.08, 1.2, 0.08], L(x, 5.8, z), BLACK), cyl('Lantern', 1, 1.2, L(x, 4.6, z), PB.red, PB.red, 8)]),
      ...at(L, 4, 3.5, 0, (M) => [...table(M, 2.6, 2.4, LIGHT_WOOD), ...at(M, -1.9, 0, 90, (N) => stool(N, PB.red)), ...at(M, 1.9, 0, 90, (N) => stool(N, PB.red))], FL),
    ]),
  roadsidediner: {
    category: 'Shops', label: 'Diner (walk-in)', hint: 'A chrome diner you can walk into: a long counter with stools, the grill behind it, booths by the windows and a sign on the roof',
    ...pfp('Walk-in diner', [signParam('pink')], (L, p) => {
      const w = 30, d = 14
      return [
        ...shell(L, { w, d, h: 7, side: STEEL_SIDING, top: PB.steel, floor: CHECKER, front: [DOOR(2), ...[-12, -6.5, 7, 12.5].map((x) => SHOWCASE(x, 4.5))], back: [DOOR(-12, 3.6)], left: [SHOWCASE(0, 6)], right: [SHOWCASE(0, 6)] }),
        { ...box('Diner roof', [w + 0.6, 0.8, d + 0.6], L(0, 7, 0), ROOF, STEEL_SIDING), bevel: 0.35 },
        ...[[-w / 2 - 0.05, 0], [4, w / 2 + 0.05]].map(([a, b]) => box('Trim stripe', [b - a, 0.4, 0.1], L((a + b) / 2, 1, d / 2 + 0.05), PB.red)),
        ...[-4, 4].map((x) => box('Sign leg', [0.4, 1.6, 0.4], L(x, 7.8, 0), PB.steel)), box('Diner sign', [12, 2.4, 0.5], L(0, 9.4, 0), signTex(p), CY.white),
        ...at(L, -2, -2.6, 0, (M) => counter(M, 16, MARBLE, STEEL_SIDING), FL), ...at(L, -2, -0.8, 0, (M) => row(M, 6, 2.6, (N) => stool(N, PB.red)), FL),
        box('Grill', [6, 2.4, 1.8], L(-4, FL, -5.6), FRYER, BLACK), box('Pie case', [3, 2, 1.6], L(4, FL, -5.6), PB.steel, GLASS), box('Coffee machine', [1.6, 1.2, 1], L(5, FL + 2.1, -2.6), BLACK),
        ...[-10.5, -3.5, 8.5].flatMap((x) => at(L, x, 4.2, 90, (M) => booth(M, 4, PB.red), FL)),
      ]
    }),
  },
  donutshop: shop('Donut shop', 'Donut shop', 'A display counter of donuts, a coffee machine, café tables and a giant donut on the roof', { floors: 0, sign: 'pink', awning: 'orange', walls: 'plaster' }, [],
    () => ({ w: 14, d: 14, doors: [DOOR(-4)], display: [3], displayW: 5, floor: BIG_TILES }),
    (L, p) => {
      const top = 7.4 + +p.floors * FLOOR
      return [
        ...at(L, 1.5, -2.5, 0, (M) => showcase(M, 8, FROSTING), FL), box('Coffee machine', [1.6, 1.4, 1.2], L(-1, FL + 2, -5.9), BLACK, PB.steel), box('Back counter', [8, 2, 1.6], L(1.5, FL, -5.9), WHITE),
        ...[[-0.5, 3], [4.2, 3]].flatMap(([x, z]) => [...at(L, x, z, 0, (M) => roundTable(M, 2.4), FL), ...at(L, x - 1.6, z, 90, (M) => stool(M, PB.orange), FL), ...at(L, x + 1.6, z, 90, (M) => stool(M, PB.orange), FL)]),
        ...[-1.8, 1.8].map((x) => box('Donut stand', [0.5, 2, 0.5], L(x, top, 0), PB.steel)),
        lying('Giant donut', 8, 2, L(0, top + 1.8, 0), DOUGH, FROSTING, 16, 90), lying('Donut hole', 2.6, 2.1, L(0, top + 4.5, 0), DOUGH, BLACK, 12, 90),
      ]
    }),
  convenience: shop('Convenience store', 'Convenience store', 'A glass-fronted corner store: aisles, a wall of coolers, the counter by the door, an ice chest and propane cage outside', { floors: 0, sign: 'red', awning: 'red', walls: 'beige' }, [],
    () => ({ w: 22, d: 16, doors: [DOOR(-7)], display: [-1.5, 3.5, 8.5], displayW: 4.5, floor: PB.tilesWhite }),
    (L) => [
      ...at(L, -8, -2, 90, (M) => counter(M, 6), FL), ...at(L, -10.15, -2, 90, (M) => wallShelf(M, 6, GOODS, 4.4), FL),
      ...[-3, 1.5, 6].flatMap((x) => at(L, x, -0.5, 90, (M) => aisle(M, 6), FL)),
      ...at(L, 2, -6.4, 0, (M) => cooler(M, 5), FL),
      ...at(L, 3.5, 10.6, 0, iceChest), ...at(L, 9, 10.2, 0, propaneCage), ...at(L, -3.6, 9.4, 0, trashCan),
    ]),
  stripmall: {
    category: 'Shops', label: 'Strip mall', hint: 'A row of small shops you can enter, under one long canopy with signs above, and a parking lot in front',
    ...pfp('Strip mall', [num('n', 'Units', 2, 7, 4), wallParam('beige'), yesNo('parking', 'Parking lot', 'yes')], (L, p) => {
      const n = +p.n, uw = 14, d = 18, W = n * uw, hd = d / 2, signs = [PB.red, CY.cyan, PB.yellow, CY.pink, PB.green, CY.orange, PB.blue]
      const front: Gap[] = []
      for (let i = 0; i < n; i++) { const x = -W / 2 + uw * (i + 0.5); front.push(DOOR(x - 3.6, 3.6), SHOWCASE(x + 2.6, 6)) }
      const parts = [
        ...shell(L, { w: W, d, h: 7, side: wallTex(p), top: PB.concrete, floor: PB.tilesWhite, front, back: [...Array(n)].map((_, i) => DOOR(-W / 2 + uw * (i + 0.5), 3.6)) }),
        ...[...Array(n - 1)].flatMap((_, i) => wall(L, 'z', -hd + T, hd - T, -W / 2 + uw * (i + 1), 7, 0.3, PB.plaster, PB.concrete, [], 0, 'Unit wall')),
        box('Ceiling', [W + 0.4, 0.4, d + 0.4], L(0, 7, 0), ROOF, PB.concrete), box('Fascia', [W + 0.8, 2.6, 0.6], L(0, 7.4, hd + 0.05), PB.concrete),
        ...parapet(L, W + 0.4, d + 0.4, 7.4, PB.concrete),
        box('Canopy', [W + 0.4, 0.4, 5], L(0, 6.2, hd + 2.5), PB.concrete, PB.steel), ...[...Array(n + 1)].map((_, i) => box('Canopy post', [0.5, 6.2, 0.5], L(-W / 2 + uw * i, 0, hd + 4.7), PB.steel)),
        ...[...Array(n)].flatMap((_, i) => [box('Shop sign', [9, 1.6, 0.3], L(-W / 2 + uw * (i + 0.5), 7.9, hd + 0.5), signs[i % signs.length], PB.steel),
          ...at(L, -W / 2 + uw * (i + 0.5) + 3, -5, 0, (M) => counter(M, 6), FL)]),
      ]
      if (p.parking === 'yes') for (let i = 0; i <= Math.floor(W / 6); i++) {
        const x = -W / 2 + i * 6
        parts.push(box('Parking line', [0.3, 0.05, 10], L(x, 0, hd + 12), LINE))
        if (i < Math.floor(W / 6)) parts.push(box('Wheel stop', [3, 0.4, 0.6], L(x + 3, 0, hd + 7.8), PB.concrete))
      }
      return parts
    }),
  },
  gasstop: {
    category: 'Shops', label: 'Gas station', hint: 'A complete gas station: canopy over four pumps, a kiosk store you can enter, a price sign, air pump and ice chest',
    ...pfp('Gas station', [signParam('red'), colorParam('stripe', 'Canopy stripe', 'red')], (L, p) => [
      { ...box('Canopy', [26, 1.4, 16], L(0, 7.6, 6), CY.white, colorTex(p, 'stripe')), bevel: 0.2 },
      ...[[-10, 0], [10, 0], [-10, 12], [10, 12]].map(([x, z]) => box('Canopy post', [0.9, 7.6, 0.9], L(x, 0, z), PB.steel)),
      ...[-5, 5].flatMap((x) => [
        box('Pump island', [2.4, 0.4, 10], L(x, 0, 6), PB.concrete, HAZARD),
        ...[3, 9].flatMap((z) => [box('Pump', [1.4, 3.2, 1.8], L(x, 0.4, z), CY.white, signTex(p)), box('Pump screen', [1.45, 0.6, 1], L(x, 2.6, z), SCREEN)]),
        ...at(L, x, 6, 0, trashCan, 0.4),
      ]),
      ...at(L, 0, -12, 0, (M) => [
        ...shopShell(M, { w: 18, d: 12, doors: [DOOR(-4)], display: [3.5], displayW: 6, walls: PB.beige, floor: PB.tilesWhite, sign: signTex(p), awning: null, floors: 0, style: 'shop' }),
        ...at(M, 5, -1.6, 0, (N) => counter(N, 6), FL), ...at(M, -2.5, -1.4, 90, (N) => aisle(N, 5), FL), ...at(M, 1, -4.6, 0, (N) => cooler(N, 3), FL),
      ]),
      ...at(L, 15, 15, 0, (M) => [box('Price sign base', [4, 1.4, 1.6], M(0, 0, 0), PB.brick), box('Price sign', [3.4, 10, 0.8], M(0, 1.4, 0), CY.white, signTex(p)),
        ...[0, 1, 2].map((i) => box('Price', [2.8, 1.4, 0.9], M(0, 2.4 + i * 2, 0), BLACK, CY.orange))]),
      box('Air pump', [1.4, 2.6, 1.2], L(-11, 0, -4), PB.red), ...at(L, -9, -4.2, 0, iceChest),
    ]),
  },
  carwash: {
    category: 'Shops', label: 'Car wash', hint: 'A drive-through car wash tunnel with spinning brushes, a guide rail, entry lights and a vacuum stand',
    ...pfp('Car wash', [colorParam('color', 'Walls', 'blue'), signParam('cyan')], (L, p) => {
      const len = 30, side = colorTex(p, 'color')
      return [
        ...[-6.3, 6.3].map((x) => box('Tunnel wall', [0.6, 8, len], L(x, 0, 0), WHITE, side)), box('Tunnel roof', [13.2, 0.6, len], L(0, 8, 0), ROOF, side),
        box('Wash floor', [12, 0.1, len], L(0, 0, 0), PB.floorWorn), box('Guide rail', [0.4, 0.4, len - 4], L(-1.8, 0.1, 0), PB.yellow),
        ...[-6, 4].flatMap((z) => [-3.8, 3.8].map((x) => cyl('Brush', 2.2, 6, L(x, 0.4, z), PB.blue, FABRIC, 10))),
        ...[-6, 4].map((z) => box('Brush mount', [12, 0.4, 0.6], L(0, 6.6, z), PB.steel)),
        lying('Top brush', 2.2, 9, L(0, 4.6, -1), PB.blue, FABRIC, 10), box('Dryer hood', [12, 1.2, 2], L(0, 6.8, 10), PB.steel),
        box('Car wash sign', [10, 2, 0.4], L(0, 8.6, len / 2 - 0.4), signTex(p), CY.white),
        ...[-1, 1].map((s) => box('Entry light', [0.8, 1.6, 0.6], L(s * 5.4, 4.6, -len / 2 - 0.3), BLACK, s < 0 ? PB.red : PB.green)),
        ...at(L, 11, -6, 0, (M) => [cyl('Vacuum post', 0.6, 6, M(0, 0, 0), PB.steel, PB.steel, 8), box('Vacuum', [2, 2, 2], M(0, 0, 1.4), PB.yellow), box('Vacuum arm', [4, 0.4, 0.4], M(1.8, 5.6, 0), PB.steel)]),
      ]
    }),
  },
  chopshop: {
    category: 'Shops', label: 'Chop shop', hint: 'A body shop with two bays: a car up on a lift, one stripped on blocks, tire racks, an engine hoist and a workbench',
    ...pfp('Chop shop', [wallParam('metal'), signParam('neonorange')], (L, p) => {
      const w = 30, d = 24, hd = d / 2
      return [
        ...shell(L, { w, d, h: 9, side: wallTex(p), top: PB.steel, floor: PB.floorWorn, front: [DOOR(-7, 10, 7.6), DOOR(7, 10, 7.6)], right: [DOOR(6)], back: [DOOR(-10, 3.6)] }),
        ...flatRoof(L, w, d, 9, PB.steel), box('Sign', [12, 1.2, 0.3], L(0, 7.8, hd + 0.15), signTex(p), PB.steel),
        // Left bay: a car up on the lift.
        ...[[-10, -4], [-4, -4], [-10, 4], [-4, 4]].map(([x, z]) => box('Lift post', [0.7, 6, 0.7], L(x, FL, z), PB.yellow)),
        ...[-4, 4].map((z) => box('Lift arm', [6.7, 0.4, 0.8], L(-7, 3.6, z), PB.yellow)), ...at(L, -7, 0, 0, (M) => sedan(M, CAR_PAINTS[0]), 4),
        // Right bay: a stripped car on blocks, its doors leaning on the wall.
        ...at(L, 7, 1, 0, (M) => sedan(M, PB.rusty, false), FL), ...[9, 11].map((z, i) => box('Car door', [0.3, 2.6, 3.4], L(14.2, FL, -z + 4 * i), PB.car('#2a5ab8', 342))),
        // Tire racks, workbench, hoist, compressor.
        ...[-8, -2].flatMap((z) => [box('Tire rack', [2.4, 6, 4.6], L(-13.3, FL, z), PB.steel, CHAIN), ...[0.4, 2.4, 4.4].map((y) => lying('Tire', 1.6, 1.8, L(-13.3, FL + y, z), PB.tire, PB.tire, 10, 90))]),
        ...at(L, 2, -10.4, 0, (M) => [...table(M, 8, 2, PB.steel), box('Toolboard', [8, 3, 0.15], M(0, 2.5, -0.95), PLYWOOD), box('Tool chest', [2.4, 3.4, 1.6], M(5.6, 0, 0), PB.red)], FL),
        ...at(L, 10, -8, 0, (M) => [box('Hoist base', [3, 0.4, 4], M(0, 0, 0), PB.red), box('Hoist mast', [0.5, 6, 0.5], M(0, 0.4, -1.6), PB.red), box('Hoist boom', [0.5, 0.5, 4], M(0, 6, 0), PB.red), box('Engine', [2, 1.6, 2], M(0, 2.4, 1.4), BLACK)], FL),
        cyl('Compressor tank', 1.6, 3, L(13.5, FL, -10.5), PB.red, PB.red, 10), box('Paint drums', [2, 2.2, 2], L(13, FL, 9.5), PB.boxBlue),
      ]
    }),
  },
  motel: {
    category: 'Shops', label: 'Motel', hint: 'A row of motel rooms you can enter (one or two floors with a walkway and stairs), an office and a tall neon sign',
    ...pfp('Motel', [num('n', 'Rooms per floor', 2, 8, 5), num('floors', 'Floors', 1, 2, 2), wallParam('beige'), signParam('pink')], (L, p) => {
      const n = +p.n, fl = +p.floors, rw = 10, d = 16, W = n * rw, hd = d / 2, side = wallTex(p)
      const parts: Part[] = []
      for (let f = 0; f < fl; f++) {
        const y = f * 7.4, front: Gap[] = []
        for (let i = 0; i < n; i++) { const x = -W / 2 + rw * (i + 0.5); front.push(DOOR(x - 2.5, 3.6), WIN(x + 2.4, 3.4)) }
        parts.push(...shell(L, { w: W, d, h: 7, y, side, top: PB.concrete, floor: f === 0 ? PB.floorWorn : null, front, back: [...Array(n)].map((_, i) => WIN(-W / 2 + rw * (i + 0.5) - 2, 2, 1.6, 3.6)) }),
          box(f === fl - 1 ? 'Roof' : 'Ceiling', [W + 0.4, 0.4, d + 0.4], L(0, y + 7, 0), f === fl - 1 ? ROOF : PB.floorWorn, PB.concrete),
          ...[...Array(n - 1)].flatMap((_, i) => wall(L, 'z', -hd + T, hd - T, -W / 2 + rw * (i + 1), 7, 0.3, PB.plaster, PB.concrete, [], y, 'Room wall')),
          ...[...Array(n)].flatMap((_, i) => at(L, -W / 2 + rw * (i + 0.5) + 1.8, -3.6, 0, (M) => bed(M, i % 2 ? PB.blue : FABRIC), y + (f ? 0 : FL))))
      }
      parts.push(...parapet(L, W + 0.4, d + 0.4, fl * 7.4, PB.concrete))
      if (fl > 1) parts.push(
        box('Walkway', [W + 4, 0.4, 4], L(2, 7, hd + 2), PB.concrete), box('Walkway rail', [W + 4, 1.1, 0.2], L(2, 7.4, hd + 3.9), PB.steel),
        ...[...Array(n + 1)].map((_, i) => box('Walkway post', [0.4, 7, 0.4], L(-W / 2 + rw * i, 0, hd + 3.7), PB.steel)),
        stairs('Stairs', [3.5, 7.4, 11], L(W / 2 + 2, 0, hd - 5.5), PB.concrete, PB.darkConcrete, 180, 12), box('Walkway rail', [0.2, 1.1, 4], L(W / 2 + 3.9, 7.4, hd + 2), PB.steel),
      )
      parts.push(...at(L, -W / 2 - 6, 0, 0, (M) => [
        ...shell(M, { w: 12, d, h: 7, side, top: PB.concrete, floor: PB.tilesWhite, front: [DOOR(-2.5), SHOWCASE(3, 4)] }), box('Office roof', [11.8, 0.6, d + 0.4], M(-0.1, 7, 0), ROOF, PB.concrete),
        ...at(M, 1, -2, 0, (N) => counter(N, 7), FL), box('Key board', [3, 2, 0.15], M(1, 3, -7.4), DARK_WOOD), ...at(M, -3.8, 3, 90, (N) => couch(N, 4), FL),
      ]), ...at(L, -W / 2 - 14, hd + 4, 0, (M) => [...poleSign(M, 14, signTex(p), 9, 5), box('Sign arrow', [6, 1.6, 0.6], M(2, 11, 0.2), CY.orange)]))
      return parts
    }),
  },
  hotel: shop('Hotel', 'Hotel', 'A cheap downtown hotel: a lobby you can enter with a front desk, couches and elevators, a long canopy to the curb and a blade sign', { floors: 4, upper: 'beige', sign: 'pink', awning: 'none', walls: 'stone' }, [],
    () => ({ w: 26, d: 18, h: 8, doors: [DOOR(0, 6)], display: [-8, 8], displayW: 6, floor: MARBLE, sign: null, back: [DOOR(-11.5, 2.6)] }),
    (L, p) => [
      ...at(L, 0, -5, 0, (M) => counter(M, 8, MARBLE, DARK_WOOD), FL), box('Key board', [4, 2.2, 0.15], L(0, 3.4, -8.4), DARK_WOOD),
      ...[-7.5, 7.5].map((x) => box('Elevator doors', [3.4, 5.6, 0.2], L(x, FL, -8.4), PB.steel)),
      ...at(L, -8, 2, 90, (M) => couch(M, 6, LEATHER), FL), ...at(L, 8, 2, 270, (M) => couch(M, 6, LEATHER), FL), box('Rug', [8, 0.05, 6], L(0, FL, 2), PB.red),
      ...[-11.5, 11.5].flatMap((x) => at(L, x, 7.2, 0, (M) => pottedPlant(M, 1.2), FL)),
      box('Canopy', [8, 0.5, 9], L(0, 6.6, 13.5), PB.red, CY.gold), ...[-3.6, 3.6].map((x) => box('Canopy post', [0.3, 6.6, 0.3], L(x, 0, 17.6), CY.gold)),
      box('Blade sign', [0.6, Math.max(4, +p.floors * FLOOR - 2), 3], L(13.3, 9, 7), BLACK, signTex(p)),
    ]),
  nightclub: {
    category: 'Shops', label: 'Nightclub', hint: 'A club to fight through: velvet rope and bouncer podium outside, a dance floor, DJ riser, bar and raised VIP lounge inside',
    ...pfp('Nightclub', [signParam('pink'), num('floors', 'Floors above', 0, 4, 0), sel('upper', 'Upper floors', UPPER, 'darkbrick')], (L, p) => {
      const w = 30, d = 24, hd = d / 2, glow = signTex(p)
      return [
        ...shell(L, { w, d, h: 9, side: CLUB_WALL, top: PB.steel, floor: PB.floorWorn, front: [DOOR(-8)], back: [DOOR(10, 3.6)], left: [DOOR(9, 3.6)] }),
        box('Ceiling', [w + 0.4, 0.4, d + 0.4], L(0, 9, 0), ROOF, PB.steel), ...upperFloors(L, w, d, 9.4, +p.floors, String(p.upper) as Style),
        box('Neon band', [w - 4, 0.6, 0.3], L(2, 7.2, hd + 0.15), glow), box('Club sign', [8, 2.4, 0.4], L(-8, 6.2, hd + 0.2), BLACK, glow),
        ...at(L, -8, hd + 3, 0, (M) => ropeLine(M, 5, 2), 0), box('Bouncer podium', [1.4, 2.6, 1.2], L(-4.6, 0, hd + 1.2), BLACK, CY.gold),
        // Inside.
        box('Dance floor', [12, 0.1, 10], L(2, FL, 0), CY.gridPink), cyl('Mirror ball', 1.4, 1.4, L(2, 6.6, 0), MIRROR, MIRROR, 8), box('Ball cord', [0.08, 1, 0.08], L(2, 8, 0), BLACK),
        box('DJ riser', [10, 1.4, 4], L(2, FL, -9.5), BLACK, CY.purple), stairs('Riser steps', [2.4, 1.4, 2], L(5.6, FL, -6.5), BLACK, BLACK, 0, 3),
        box('DJ desk', [5, 1.6, 1.4], L(2, FL + 1.4, -8.4), BLACK, glow), ...[-4.4, 8.4].map((x) => box('Speaker stack', [2.6, 6, 2.4], L(x, FL, -9.4), BLACK, SCREEN)),
        ...at(L, -12.6, -1, 90, (M) => counter(M, 14, MARBLE, BLACK, false), FL), box('Bottle shelf', [0.6, 3, 14], L(-14.3, 2.4, -1), DARK_WOOD, BOTTLES[2]),
        ...at(L, -10.4, -1, 90, (M) => row(M, 5, 2.6, (N) => stool(N, PURPLE)), FL),
        box('VIP deck', [9, 1.4, 9], L(10, FL, 6.5), CY.dark, CY.purple), stairs('VIP steps', [3, 1.4, 2], L(4.5, FL, 4), CY.dark, CY.dark, 270, 3),
        box('VIP rail', [9, 1.1, 0.2], L(10, FL + 1.4, 2.1), CY.gold), ...at(L, 11, 9.6, 180, (M) => couch(M, 7, PURPLE), FL + 1.4), ...at(L, 11, 6, 0, (M) => table(M, 3, 1.6, BLACK), FL + 1.4),
        ...[-hd + 0.4, hd - 0.4].map((z) => box('Neon strip', [w - 2, 0.25, 0.15], L(0, 7.6, z), glow)),
      ]
    }),
  },
  divebar: shop('Dive bar', 'Dive bar', 'A neighbourhood bar: neon in the windows, a bar with stools down one side, a pool table, a jukebox and a dartboard', { floors: 1, sign: 'neonorange', awning: 'black', walls: 'oldbrick' }, [],
    () => ({ w: 18, d: 14, doors: [DOOR(-5)], display: [2, 6.2], displayW: 3.5, floor: FLOOR_WOOD }),
    (L) => [
      ...[2, 6.2].map((x, i) => box('Window neon', [1.8, 0.9, 0.12], L(x, 2.8, 6.3), i ? CY.cyan : CY.pink)),
      ...at(L, 7, -1.5, 270, (M) => counter(M, 9, MARBLE, DARK_WOOD, false), FL), box('Bottle shelf', [0.6, 3, 9], L(8.4, 2.4, -1.5), DARK_WOOD, BOTTLES[1]),
      ...at(L, 5, -1.5, 270, (M) => row(M, 4, 2.2, (N) => stool(N)), FL),
      ...at(L, -3, -2, 90, (M) => [box('Pool table', [4.4, 1.5, 8], M(0, 0.2, 0), DARK_WOOD), box('Felt', [3.8, 0.12, 7.4], M(0, 1.7, 0), FELT), ...legs(M, 4, 7.4, 0.2, DARK_WOOD, 0.6)], FL),
      ...at(L, -7.2, -5.6, 0, (M) => [box('Jukebox', [2.6, 3.4, 1.4], M(0, 0, 0), DARK_WOOD, CY.orange), box('Jukebox glow', [2, 0.4, 0.1], M(0, 2.4, 0.72), CY.pink)], FL),
      lying('Dartboard', 1.6, 0.15, L(-8.4, 3.6, 2), BLACK, PB.red, 12), box('Booth', [3, 2.4, 1.6], L(-7.6, FL, 1.8), LEATHER),
    ]),
}


// ---------------- civic buildings and towers ----------------

const STAINED: Tex = { gen: 'tiles', tweak: { color: '#2a4a9a', accent: '#d8a02a', scale: 6, wear: 0, seed: 655 }, surface: 9 }
const LOUVRE: Tex = { gen: 'wood_planks', tweak: { color: '#2e2a26', accent: '#141210', scale: 12, wear: 0.2, seed: 662 }, surface: 21 }
const CANVAS = solid('#2a5fc0', '#1d4a9a', 656)
const TINTS: Record<string, Tex> = {
  blue: CURTAIN,
  green: { gen: 'tiles', tweak: { color: '#3d6a5e', accent: '#b9d2c8', scale: 6, wear: 0, seed: 657 }, surface: 9 },
  bronze: { gen: 'tiles', tweak: { color: '#6a5238', accent: '#c9b89a', scale: 6, wear: 0, seed: 658 }, surface: 9 },
  dark: { gen: 'tiles', tweak: { color: '#1f262e', accent: '#5a6672', scale: 6, wear: 0, seed: 659 }, surface: 9 },
}

const pew = (L: Lf, len = 8): Part[] => [
  box('Pew seat', [len, 0.3, 1.4], L(0, 1, 0), DARK_WOOD), box('Pew back', [len, 1.8, 0.25], L(0, 1, -0.6), DARK_WOOD),
  ...[-1, 1].map((sx) => box('Pew end', [0.25, 2.6, 1.6], L(sx * (len / 2), 0, 0), DARK_WOOD)),
]
const schoolDesk = (L: Lf): Part[] => [box('School desk', [2.4, 1.6, 1.4], L(0, 0, 0), LIGHT_WOOD), box('Seat', [1.6, 1, 1.4], L(0, 0, 1.6), PB.blue), box('Seat back', [1.6, 1.6, 0.2], L(0, 1, 2.3), PB.blue)]
const fireTruck = (L: Lf): Part[] => [
  box('Truck body', [5, 4.2, 13], L(0, 1, -2.5), PB.red, PB.steel), { ...box('Truck cab', [5, 4.6, 4.4], L(0, 1, 6.2), PB.red), bevel: 0.3 },
  box('Cab glass', [4.6, 1.4, 0.1], L(0, 3.6, 8.42), GLASS), box('Ladder', [1.6, 0.4, 13], L(0, 5.2, -1.5), PB.steel), box('Light bar', [3, 0.4, 0.6], L(0, 5.6, 6.4), PB.red, CY.white),
  box('Bumper', [5.2, 0.6, 0.4], L(0, 1, 8.5), PB.steel), ...wheels(L, 4.8, [-6.5, -3.5, 6], 1.8, 0.6),
]
const ambulance = (L: Lf): Part[] => [
  box('Ambulance box', [5, 5.2, 9], L(0, 1, -2), WHITE), box('Ambulance stripe', [5.06, 0.8, 9.06], L(0, 2.6, -2), PB.red),
  { ...box('Ambulance cab', [4.8, 4, 4], L(0, 1, 4.5), WHITE), bevel: 0.3 }, box('Cab glass', [4.4, 1.3, 0.1], L(0, 3.2, 6.52), GLASS),
  box('Light bar', [3, 0.4, 0.6], L(0, 5, 5), PB.red, PB.blue), ...wheels(L, 4.6, [-4.5, 4.5], 1.7, 0.6),
]
/** A wheelchair: seat, back and two big wheels. */
const wheelchair = (L: Lf): Part[] => [box('Seat', [1.6, 0.3, 1.6], L(0, 1.2, 0), BLACK), box('Chair back', [1.6, 1.6, 0.2], L(0, 1.5, -0.8), BLACK), ...[-1, 1].map((s) => lying('Wheel', 2, 0.15, L(s * 0.9, 0, -0.2), PB.steel, BLACK, 12))]
/** Pallet racks: posts, two beams and loads. */
const rack = (L: Lf, len = 6): Part[] => [
  ...[-1, 1].flatMap((s) => [box('Rack post', [0.3, 7, 0.3], L(s * len / 2, 0, -1.1), PB.boxBlue), box('Rack post', [0.3, 7, 0.3], L(s * len / 2, 0, 1.1), PB.boxBlue)]),
  ...[2.5, 5].map((y) => box('Rack beam', [len + 0.3, 0.25, 2.5], L(0, y, 0), PB.orange)),
  ...[0, 2.75, 5.25].flatMap((y, i) => [box('Pallet load', [2.4, 1.8, 2.2], L(-1.4, y, 0), i % 2 ? PB.boxGreen : PLYWOOD), box('Pallet load', [2.4, 1.6, 2.2], L(1.4, y, 0), PLYWOOD)]),
]
/** Tall gothic window gaps along a wall, with stained glass in them. */
const gothicWindows = (L: Lf, axis: 'x' | 'z', at: number[], c: number, sill: number, h: number): Part[] =>
  at.map((s) => (axis === 'z' ? box('Stained glass', [0.1, h, 2.6], L(c, sill, s), STAINED) : box('Stained glass', [2.6, h, 0.1], L(s, sill, c), STAINED)))

const CIVIC: Record<string, Def> = {
  gothicchurch: {
    category: 'Buildings', label: 'Gothic church', hint: 'A big stone church you can enter: twin towers with spires, a rose window, buttresses, stained glass, pews and an altar',
    ...pfp('Gothic church', [wallParam('stone'), yesNo('towers', 'Towers', 'yes')], (L, p) => {
      const W = 24, D = 44, H = 16, hw = W / 2, hd = D / 2, side = wallTex(p), wins = [-16, -8, 0, 8, 16]
      const parts = [
        ...shell(L, { w: W, d: D, h: H, side, top: STONE, floor: BIG_TILES, front: [DOOR(0, 6, 9)],
          left: [...wins.map((z) => WIN(z, 2.6, 8, 4)), DOOR(19.5, 3.6)], right: wins.map((z) => WIN(z, 2.6, 8, 4)) }),
        ...gothicWindows(L, 'z', wins, -hw + T / 2, 4, 8), ...gothicWindows(L, 'z', wins, hw - T / 2, 4, 8),
        gable(L, 0, 0, W + 1.6, D + 1, 12, H, SLATE, side, true),
        lying('Rose window', 6, 0.4, L(0, 9.6, hd + 0.1), STAINED, STAINED, 16, 90),
        ...[-20, -12, -4, 4, 12].flatMap((z) => [-1, 1].flatMap((s) => [
          box('Buttress', [2, 11, 1.6], L(s * (hw + 1), 0, z), STONE), ramp('Buttress cap', [1.6, 2.4, 2], L(s * (hw + 1), 11, z), SLATE, STONE, s > 0 ? 90 : 270),
        ])),
        // Altar end: a raised chancel with steps, the altar and a pulpit.
        box('Chancel', [16, 1.2, 8], L(0, FL, -hd + 4.5), MARBLE, STONE), stairs('Chancel steps', [8, 1.2, 2], L(0, FL, -hd + 9.5), MARBLE, STONE, 0, 3),
        box('Altar', [6, 2.4, 2.4], L(0, FL + 1.2, -hd + 3), MARBLE, LINEN), box('Pulpit', [2.4, 3.4, 2.4], L(6, FL + 1.2, -hd + 7), DARK_WOOD),
        ...[-3.5, 3.5].map((x) => cyl('Candle stand', 0.5, 4, L(x, FL + 1.2, -hd + 3), CY.gold, CY.gold, 6)),
        ...[-6.5, 6.5].flatMap((x) => [...Array(7)].flatMap((_, i) => at(L, x, 15 - i * 3.6, 180, (M) => pew(M, 8), FL))),
      ]
      if (p.towers === 'yes') parts.push(...[-1, 1].flatMap((s) => [
        box('Tower', [7, 30, 7], L(s * 9.5, 0, hd + 3.5), STONE, side), box('Belfry', [7.4, 4, 7.4], L(s * 9.5, 22, hd + 3.5), STONE, LOUVRE),
        box('Tower parapet', [8, 1, 8], L(s * 9.5, 30, hd + 3.5), STONE), { ...cyl('Spire', 7, 14, L(s * 9.5, 31, hd + 3.5), SLATE, SLATE, 4, 45), taper: 0 },
      ]))
      return parts
    }),
  },
  whitechapel: {
    category: 'Buildings', label: 'White chapel', hint: 'A small white wooden chapel you can enter: a steeple with a bell, tall windows, pews and an altar',
    ...pfp('White chapel', [sidingParam('white')], (L, p) => {
      const W = 14, D = 24, H = 9, hd = D / 2, side = sidingTex(p)
      return [
        ...shell(L, { w: W, d: D, h: H, side, top: WHITE, floor: FLOOR_WOOD, front: [DOOR(0, 4, 6.4)], left: [-6, 0, 6].map((z) => WIN(z, 2.4, 4, 2.6)), right: [-6, 0, 6].map((z) => WIN(z, 2.4, 4, 2.6)) }),
        gable(L, 0, 0, W + 1.4, D + 1, 6, H, SLATE, side, true),
        box('Steeple', [4.5, 8, 4.5], L(0, H, hd - 2.25), side, side), ...[[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]].map(([a, b]) => box('Belfry post', [0.5, 3.6, 0.5], L(a, H + 8, hd - 2.25 + b), WHITE)),
        { ...cyl('Bell', 1.8, 1.6, L(0, H + 9.6, hd - 2.25), CY.gold, CY.gold, 10), taper: 0.5 }, box('Belfry roof', [5, 0.4, 5], L(0, H + 11.6, hd - 2.25), WHITE),
        { ...cyl('Spire', 5.4, 7, L(0, H + 12, hd - 2.25), SLATE, SLATE, 4, 45), taper: 0 },
        box('Front step', [6, 0.4, 2], L(0, 0, hd + 1), PB.concrete),
        box('Altar', [4, 2.4, 2], L(0, FL, -hd + 2.5), WHITE, LINEN), box('Cross', [0.4, 3, 0.3], L(0, 3.4, -hd + 0.7), CY.gold), box('Cross arm', [1.6, 0.4, 0.3], L(0, 5.4, -hd + 0.7), CY.gold),
        ...[-3.4, 3.4].flatMap((x) => [...Array(5)].flatMap((_, i) => at(L, x, 7 - i * 3.2, 180, (M) => pew(M, 5), FL))),
      ]
    }),
  },
  school: {
    category: 'Buildings', label: 'School', hint: 'A two-storey school you can enter: lockers down the hall, a classroom upstairs, an entrance canopy and a flagpole',
    ...pfp('School', [wallParam('brick'), num('w', 'Width', 32, 60, 40, 4)], (L, p) => {
      const w = +p.w, d = 20, hd = d / 2, y1 = floorY(1)
      return [
        ...storeys(L, { w, d, n: 2, side: wallTex(p), top: PB.concrete, floor: PB.tilesWhite, windows: true, toRoof: true,
          front: (k) => (k === 0 ? [DOOR(0, 6)] : []), back: (k) => (k === 0 ? [DOOR(w / 2 - 6)] : []) }),
        box('School sign', [12, 1.4, 0.3], L(0, 12.2, hd + 0.15), WHITE, PB.blue),
        box('Entrance canopy', [10, 0.5, 6], L(0, 6.2, hd + 3), PB.concrete), ...[-4.6, 4.6].map((x) => box('Canopy post', [0.5, 6.2, 0.5], L(x, 0, hd + 5.7), PB.steel)),
        ...at(L, -9, hd + 6, 0, (M) => flagpole(M, 16, PB.blue)),
        ...at(L, 0, -8.7, 0, (M) => lockers(M, 12, PB.boxBlue), FL), ...at(L, w / 2 - 1.3, -2, 270, (M) => lockers(M, 6, PB.boxRed), FL),
        box('Trophy case', [6, 4, 1.4], L(-8, FL, 8.6), DARK_WOOD, GLASS),
        box('Chalkboard', [12, 3.4, 0.15], L(4, y1 + 2.2, -9.4), CHALK, DARK_WOOD), ...at(L, 4, -6.4, 0, (M) => table(M, 5, 2.4, LIGHT_WOOD), y1),
        ...[-2, 2.5, 7, 11.5].flatMap((x) => [-2.5, 2, 6].flatMap((z) => at(L, x, z - 1, 0, schoolDesk, y1))),
      ]
    }),
  },
  boxinggym: {
    category: 'Buildings', label: 'Boxing gym', hint: 'An old boxing gym you can enter: a raised ring with ropes, heavy bags, weights, lockers and a mirror wall',
    ...pfp('Boxing gym', [wallParam('oldbrick'), signParam('red')], (L, p) => {
      const w = 28, d = 22, hd = d / 2, high = (xs: number[]) => xs.map((x) => WIN(x, 4, 2, 5.5))
      const r = 5.75, ry = FL + 1.4
      return [
        ...shell(L, { w, d, h: 9, side: wallTex(p), top: PB.concrete, floor: FLOOR_WOOD, front: [DOOR(-8), ...high([0, 8])], back: high([-8, 0, 8]), left: [DOOR(6)] }),
        ...flatRoof(L, w, d, 9), box('Sign', [12, 1.4, 0.3], L(2, 7.4, hd + 0.15), signTex(p), PB.steel),
        // The ring: open under the top rope on the side with the steps.
        box('Ring', [12, 1.4, 12], L(4, FL, -2), CANVAS, PB.red), stairs('Ring steps', [3, 1.4, 2], L(4, FL, 5), PB.steel, PB.steel, 0, 3),
        ...[[-r, -r], [r, -r], [-r, r], [r, r]].map(([a, b]) => box('Corner post', [0.5, 4.4, 0.5], L(4 + a, ry, -2 + b), PB.red, CY.white)),
        ...[1.2, 2.4, 3.6].flatMap((y) => [
          box('Rope', [11.5, 0.15, 0.15], L(4, ry + y, -2 - r), CY.white), box('Rope', [0.15, 0.15, 11.5], L(4 - r, ry + y, -2), CY.white), box('Rope', [0.15, 0.15, 11.5], L(4 + r, ry + y, -2), CY.white),
        ]), box('Rope', [11.5, 0.15, 0.15], L(4, ry + 3.6, -2 + r), CY.white),
        // Heavy bags hanging from a beam, weights and lockers.
        box('Bag beam', [0.5, 0.5, 16], L(-9, 8.4, -1), PB.steel), ...[-7, -3, 1, 5].flatMap((z) => [box('Bag chain', [0.1, 2.8, 0.1], L(-9, 5.6, z), PB.steel), cyl('Heavy bag', 1.4, 3.4, L(-9, 2.2, z), LEATHER, PB.red, 10)]),
        box('Weight bench', [1.4, 1.4, 4], L(-4, FL, 8), LEATHER), ...[-1, 1].map((s) => box('Bench upright', [0.2, 3, 0.2], L(-4 + s * 1, FL, 6.4), PB.steel)), lying('Barbell', 0.2, 5, L(-4, FL + 2.8, 6.4), PB.steel, PB.steel, 6),
        ...[-1, 1].map((s) => lying('Weight plate', 1.6, 0.3, L(-4 + s * 2.1, FL + 2.1, 6.4), BLACK, BLACK, 10)),
        ...at(L, 12.6, 1, 270, (M) => lockers(M, 6, PB.boxRed), FL), box('Mirror wall', [0.1, 3.4, 10], L(-13.4, 1.6, 2), MIRROR),
      ]
    }),
  },
  firestation: {
    category: 'Buildings', label: 'Fire station', hint: 'A firehouse with two open bays and a fire engine, gear lockers, a fire pole, crew floors above and a hose tower',
    ...pfp('Fire station', [num('floors', 'Floors above', 0, 3, 1), yesNo('truck', 'Fire engine', 'yes')], (L, p) => {
      const w = 30, d = 24, hd = d / 2
      const parts = [
        ...shell(L, { w, d, h: 9, side: PB.brick, top: PB.concrete, floor: PB.floorWorn, front: [DOOR(-6.5, 10, 7.8), DOOR(6.5, 10, 7.8)], left: [DOOR(6)], back: [DOOR(-10, 3.6)] }),
        box('Ceiling', [w + 0.4, 0.4, d + 0.4], L(0, 9, 0), ROOF, PB.concrete), ...upperFloors(L, w, d, 9.4, +p.floors, 'brick'),
        ...[-6.5, 6.5].map((x) => box('Bay number', [2.4, 0.9, 0.2], L(x, 8, hd + 0.1), CY.white, PB.red)), box('Sign band', [26, 0.8, 0.3], L(0, 7.9, hd + 0.35), PB.red, CY.gold),
        box('Apron', [w, 0.1, 10], L(0, 0, hd + 5), PB.concrete), ...[-12, -1, 1, 12].map((x) => box('Apron line', [0.4, 0.2, 10], L(x, 0, hd + 5), PB.yellow)),
        ...at(L, 13.2, -2, 270, (M) => lockers(M, 8, PB.yellow), FL), cyl('Fire pole', 0.4, 9, L(10, 0, -9), CY.gold, CY.gold, 8),
        box('Hose rack', [0.6, 3, 6], L(-14.2, 1.4, -6), PB.steel, PB.red),
        box('Hose tower', [6, 30, 6], L(w / 2 + 3, 0, -hd + 3), PB.concrete, facadeTex('brick'), 0, FLOOR), box('Tower cap', [7, 1, 7], L(w / 2 + 3, 30, -hd + 3), PB.concrete),
        ...at(L, -w / 2 - 3, hd + 4, 0, (M) => flagpole(M, 16, PB.red)),
      ]
      if (p.truck === 'yes') parts.push(...at(L, -6.5, -0.5, 0, fireTruck, FL))
      return parts
    }),
  },
  policestation: {
    category: 'Buildings', label: 'Police station', hint: 'A precinct house you can enter: entrance portico with blue lamps, a front desk, holding cells at the back, offices above',
    ...pfp('Police station', [wallParam('beige'), num('floors', 'Floors above', 0, 3, 1), yesNo('car', 'Patrol car', 'yes')], (L, p) => {
      const w = 32, d = 22, hd = d / 2, cz = -hd + T + 3.5
      const parts = [
        ...shell(L, { w, d, h: 8, side: wallTex(p), top: PB.concrete, floor: BIG_TILES, front: [DOOR(0, 5)], back: [DOOR(12, 3.6)], windows: true }),
        box('Ceiling', [w + 0.4, 0.4, d + 0.4], L(0, 8, 0), ROOF, PB.concrete), ...upperFloors(L, w, d, 8.4, +p.floors, 'concrete'),
        box('Entrance deck', [14, 0.4, 5], L(0, 0, hd + 2.5), PB.concrete), stairs('Entrance steps', [10, 0.4, 1.2], L(0, 0, hd + 5.6), PB.concrete, PB.concrete, 0, 2),
        ...[-6, -2.4, 2.4, 6].map((x) => cyl('Column', 1.2, 7, L(x, 0.4, hd + 4.2), PB.concrete, PB.concrete, 10)), box('Portico', [14, 0.8, 5.4], L(0, 7.4, hd + 2.7), PB.concrete),
        ...[-3.4, 3.4].flatMap((x) => [box('Lamp post', [0.3, 4, 0.3], L(x, 0.4, hd + 0.8), BLACK), cyl('Blue lamp', 1, 1, L(x, 4.4, hd + 0.8), PB.blue, PB.blue, 10)]),
        box('Sign band', [12, 1, 0.3], L(0, 8.2, hd + 5.25), PB.blue, CY.white),
        // Front desk and a bench; holding cells along the back wall.
        ...at(L, 0, 0, 0, (M) => counter(M, 10, DARK_WOOD, DARK_WOOD), FL), box('Desk screen', [10, 2, 0.12], L(0, FL + 2.1, -0.9), GLASS),
        box('Bench', [6, 0.9, 1.4], L(-11, FL, 5), DARK_WOOD),
        ...[-14.5, -8.5, -2.5].map((x) => box('Cell wall', [0.4, 8, 7], L(x + 0.2, 0, cz), PB.cinder)),
        ...[-11.5, -5.5].flatMap((x) => [...[...Array(8)].map((_, i) => box('Cell bar', [0.15, 8, 0.15], L(x - 2.6 + i * 0.75, 0, cz + 3.5), PB.steel)), box('Cell bench', [4, 1.2, 1.4], L(x, FL, -hd + T + 0.7), PB.steel)]),
        ...[4, 9].map((x) => at(L, x, -6, 0, (M) => [...table(M, 4, 2.4, PB.steel), box('Monitor', [1.8, 1.2, 0.15], M(0, 1.55, -0.6), BLACK, SCREEN), ...at(M, 0, -1.8, 0, chair)], FL)).flat(),
        ...at(L, -14, hd + 7, 0, (M) => flagpole(M, 16, PB.blue)),
      ]
      if (p.car === 'yes') parts.push(...at(L, 11, hd + 8, 90, (M) => [...sedan(M, WHITE), box('Car stripe', [4.06, 0.5, 8.06], M(0, 1.1, 0), BLACK), box('Light bar', [3, 0.4, 0.8], M(0, 3.05, -0.4), PB.red, PB.blue)]))
      return parts
    }),
  },
  hospital: {
    category: 'Buildings', label: 'Hospital', hint: 'A hospital front: a lobby you can enter (desk, waiting chairs, elevators), a drive-through canopy with an ambulance, wards above, a helipad on the roof',
    ...pfp('Hospital', [num('floors', 'Floors above', 1, 8, 4), sel('upper', 'Upper floors', UPPER, 'plaster'), yesNo('ambulance', 'Ambulance', 'yes')], (L, p) => {
      const w = 36, d = 24, hd = d / 2, top = 8.4 + +p.floors * FLOOR
      const parts = [
        ...shopShell(L, { w, d, h: 8, doors: [DOOR(-4, 6)], display: [-13, 5, 12], displayW: 6, walls: PB.cinder, floor: PB.tilesWhite, sign: PB.red, signW: 10, awning: null, floors: +p.floors, style: String(p.upper) as Style, back: [DOOR(14)] }),
        ...[-1, 1].map((s) => box('Sliding door', [3, 5.6, 0.12], L(-4 + s * 4.4, 0, hd - 0.7), GLASS)),
        box('Drive canopy', [16, 0.8, 12], L(-4, 7, hd + 6), PB.concrete, CY.white), ...[-11, 3].map((x) => box('Canopy post', [0.8, 7, 0.8], L(x, 0, hd + 11.4), PB.concrete)),
        ...at(L, 0, -3, 0, (M) => counter(M, 10, WHITE, PB.blue), FL),
        ...[2, 5].flatMap((z) => at(L, -12, z, 0, (M) => row(M, 5, 2, (N) => plasticChair(N, PB.blue)), FL)), ...at(L, 13, 0, 0, wheelchair, FL),
        ...[-6, 6].map((x) => box('Elevator doors', [3.4, 5.6, 0.2], L(x, FL, -hd + 0.6), PB.steel)), ...[-16.4, 16.4].flatMap((x) => at(L, x, -9.6, 0, pottedPlant, FL)),
        cyl('Helipad', 12, 0.4, L(0, top, 0), PB.yellow, PB.yellow, 20), cyl('Helipad center', 10.4, 0.5, L(0, top, 0), PB.darkConcrete, PB.darkConcrete, 20),
      ]
      if (p.ambulance === 'yes') parts.push(...at(L, -4, hd + 6, 0, ambulance))
      return parts
    }),
  },
  parkinggarage: {
    category: 'Buildings', label: 'Parking garage', hint: 'A multi-storey car park: open decks on columns, ramps between every level (drivable), parapets and painted bays',
    ...pfp('Parking garage', [num('levels', 'Levels', 2, 5, 3), yesNo('cars', 'Parked cars', 'yes')], (L, p) => {
      const n = +p.levels, W = 44, D = 36, hw = W / 2, hd = D / 2, H = FLOOR, lane = (s: number) => -hd + 1 + s * 8 + 4 // lane centers along Z
      const parts: Part[] = [box('Ground deck', [W, 0.2, D], L(0, 0, 0), PB.floorWorn, PB.concrete)]
      for (let k = 0; k <= n; k++) {
        const y0 = k * H + (k ? 0 : 0.2)
        // Ramp k: up from level k to k + 1, in lane k % 2, climbing toward +X on even levels and −X on odd ones.
        if (k < n) parts.push(ramp('Ramp', [8, H, 24], L(0, y0, lane(k % 2)), PB.floorWorn, PB.concrete, k % 2 ? 90 : 270))
        if (k > 0) {
          const y = k * H - 0.6, hz0 = lane((k - 1) % 2) - 4, hz1 = hz0 + 8
          parts.push(
            box('Deck', [W, 0.6, hz0 + hd], L(0, y, (-hd + hz0) / 2), PB.floorWorn, PB.concrete),
            box('Deck', [W, 0.6, hd - hz1], L(0, y, (hz1 + hd) / 2), PB.floorWorn, PB.concrete),
            box('Deck', [hw - 12, 0.6, 8], L(-(hw + 12) / 2, y, (hz0 + hz1) / 2), PB.floorWorn, PB.concrete),
            box('Deck', [hw - 12, 0.6, 8], L((hw + 12) / 2, y, (hz0 + hz1) / 2), PB.floorWorn, PB.concrete),
            ...parapet(L, W, D, k * H, PB.concrete, 1.2),
          )
        }
        if (k < n) for (const [x, z] of [[-hw + 0.5, -hd + 0.5], [hw - 0.5, -hd + 0.5], [-hw + 0.5, hd - 0.5], [hw - 0.5, hd - 0.5], [-hw + 0.5, -9], [hw - 0.5, -9], [-hw + 0.5, -1], [hw - 0.5, -1], [-6, 9], [6, 9]])
          parts.push(box('Column', [1, H - 0.6 - (k ? 0 : 0.2), 1], L(x, y0, z), PB.concrete, PB.concrete))
        for (let i = 0; i <= 6; i++) parts.push(box('Bay line', [0.25, 0.1, 6], L(-18 + i * 6, y0, 13), LINE))
      }
      parts.push(...[-hw + 1, hw - 1].flatMap((x) => [cyl('Light pole', 0.4, 8, L(x, n * H, hd - 1), PB.steel, PB.steel, 6), box('Light head', [1.6, 0.4, 0.8], L(x, n * H + 8, hd - 1.4), PB.steel, CY.white)]))
      if (p.cars === 'yes') parts.push(...[-15, -3, 9].flatMap((x, i) => at(L, x, 12, 180, (M) => sedan(M, CAR_PAINTS[i]), 0.2)))
      return parts
    }),
  },
  officeglass: {
    category: 'Buildings', label: 'Glass office tower', hint: 'An office tower in a glass curtain wall with steel fins, a lobby you can enter (desk, turnstiles, elevators) and a rooftop crown',
    ...pfp('Glass office', [num('floors', 'Floors', 4, 30, 14), sel('tint', 'Glass', [['blue', 'Blue'], ['green', 'Green'], ['bronze', 'Bronze'], ['dark', 'Dark']], 'blue')], (L, p) => {
      const w = 28, d = 24, hd = d / 2, n = +p.floors, glass = TINTS[String(p.tint)] ?? CURTAIN, top = 9.4 + n * FLOOR
      return [
        ...shell(L, { w, d, h: 9, side: PB.steel, top: PB.steel, floor: MARBLE, front: [DOOR(-3), DOOR(3), SHOWCASE(-9.5, 7), SHOWCASE(9.5, 7)], back: [DOOR(-9)] }),
        box('Ceiling', [w + 1, 0.4, d + 1], L(0, 9, 0), ROOF, PB.steel),
        box('Tower', [w, n * FLOOR, d], L(0, 9.4, 0), ROOF, glass, 0, FLOOR),
        ...[-11.2, -5.6, 0, 5.6, 11.2].flatMap((x) => [-1, 1].map((s) => box('Fin', [0.5, n * FLOOR, 0.8], L(x, 9.4, s * (hd + 0.4)), PB.steel))),
        ...[-6, 0, 6].flatMap((z) => [-1, 1].map((s) => box('Fin', [0.8, n * FLOOR, 0.5], L(s * (w / 2 + 0.4), 9.4, z), PB.steel))),
        ...parapet(L, w, d, top, PB.steel, 1.4), box('Crown', [18, 5, 14], L(0, top, 0), PB.steel, glass), cyl('Antenna', 0.4, 12, L(4, top + 5, 2), PB.steel, PB.steel, 6),
        ...at(L, 0, -4, 0, (M) => counter(M, 8, MARBLE, BLACK), FL),
        ...[-6, -3, 3, 6].map((x) => box('Turnstile', [0.6, 2.4, 2.4], L(x, FL, -7), PB.steel, GLASS)),
        ...[-9, -4.5, 4.5, 9].map((x) => box('Elevator doors', [3.4, 5.6, 0.2], L(x, FL, -hd + 0.6), PB.steel)),
        ...[-12.4, 12.4].flatMap((x) => at(L, x, 2, 0, (M) => pottedPlant(M, 1.3), FL)), ...at(L, -9, 4, 90, (M) => couch(M, 5, LEATHER), FL),
      ]
    }),
  },
  skyscraperbase: {
    category: 'Buildings', label: 'Skyscraper', hint: 'A stepped stone skyscraper: a colonnade and a marble lobby you can enter at the bottom, setback tiers and a spire',
    ...pfp('Skyscraper', [num('floors', 'Tower floors', 8, 40, 24), sel('style', 'Tiers', [['beige', 'Beige'], ['stone', 'Stone'], ['office', 'Office'], ['darkbrick', 'Dark brick']], 'beige')], (L, p) => {
      const w = 32, d = 28, hd = d / 2, n = +p.floors, st = p.style as Style, t1 = Math.ceil(n * 0.5), t2 = Math.ceil(n * 0.3), t3 = n - t1 - t2
      const y0 = 9.4 + 2 * FLOOR, y1 = y0 + t1 * FLOOR, y2 = y1 + t2 * FLOOR, y3 = y2 + Math.max(1, t3) * FLOOR
      return [
        ...shell(L, { w, d, h: 9, side: STONE, top: STONE, floor: MARBLE, front: [DOOR(-5), DOOR(5), SHOWCASE(-12, 5), SHOWCASE(12, 5)], back: [DOOR(-10)] }),
        box('Ceiling', [w + 1, 0.4, d + 1], L(0, 9, 0), ROOF, STONE), box('Podium', [w, 2 * FLOOR, d], L(0, 9.4, 0), ROOF, facadeTex('stone'), 0, FLOOR),
        box('Cornice', [w + 1.6, 1, d + 1.6], L(0, y0 - 1, 0), STONE),
        ...[-14, -9, -1.5, 1.5, 9, 14].map((x) => cyl('Column', 1.6, 9, L(x, 0, hd + 2.4), STONE, STONE, 10)), box('Colonnade roof', [w + 1, 1, 4], L(0, 9, hd + 2.4), STONE),
        cyl('Revolving door', 3.6, 5.6, L(0, 0, hd + 0.6), CY.gold, GLASS, 12),
        box('Tier', [24, t1 * FLOOR, 20], L(0, y0, 0), ROOF, facadeTex(st), 0, FLOOR), box('Tier', [17, t2 * FLOOR, 13], L(0, y1, 0), ROOF, facadeTex(st), 0, FLOOR),
        box('Tier', [10, Math.max(1, t3) * FLOOR, 8], L(0, y2, 0), ROOF, facadeTex(st), 0, FLOOR), { ...cyl('Spire', 6, 14, L(0, y3, 0), CY.gold, PB.steel, 8), taper: 0 },
        ...at(L, 0, -3, 0, (M) => counter(M, 10, MARBLE, DARK_WOOD), FL), ...[-8, -3, 3, 8].map((x) => box('Elevator doors', [3.4, 5.6, 0.2], L(x, FL, -hd + 0.6), CY.gold)),
        ...[-13.4, 13.4].flatMap((x) => at(L, x, -1, 0, (M) => pottedPlant(M, 1.4), FL)), box('Rug', [10, 0.05, 8], L(0, FL, 6), PB.red),
      ]
    }),
  },
}

// ---------------- works, towers and ruins ----------------

const WORKS: Record<string, Def> = {
  brickwarehouse: {
    category: 'Buildings', label: 'Brick warehouse', hint: 'An old brick warehouse you can enter: a loading opening, tall windows high up, pallet racks and crates inside',
    ...pfp('Brick warehouse', [num('w', 'Width', 30, 60, 40, 2), num('d', 'Depth', 20, 40, 28, 2), wallParam('oldbrick'), yesNo('racks', 'Racks and crates', 'yes')], (L, p) => {
      const w = +p.w, d = +p.d, hw = w / 2, hd = d / 2
      const high = (a: number, b: number) => windowsAlong(a, b, [], 8, 7).map((g) => ({ ...g, w: 3.4, h: 3 }))
      const parts = [
        ...shell(L, { w, d, h: 12, side: wallTex(p), top: PB.concrete, floor: PB.floorWorn, front: [DOOR(-hw / 2, 10, 9), DOOR(hw / 2), ...high(-hw / 2 + 6, hw / 2 - 3)], back: [DOOR(hw - 6), ...high(-hw, hw - 10)], left: high(-hd, hd), right: [DOOR(-hd / 2), ...high(0, hd)] }),
        ...flatRoof(L, w, d, 12), box('Loading door', [10, 1.2, 0.3], L(-hw / 2, 9, hd + 0.15), GARAGE_DOOR), box('Sign', [14, 1.6, 0.3], L(hw / 2 - 2, 9.6, hd + 0.15), CY.white, PB.black),
      ]
      if (p.racks === 'yes') parts.push(...[-hd / 2, hd / 4].flatMap((z) => at(L, -hw + 2, z, 90, (M) => rack(M, 8), FL)), ...[[4, -4], [7, -2], [5, 1]].flatMap(([x, z], i) => at(L, x, z, i * 20, crate, FL)))
      return parts
    }),
  },
  metalshed: {
    category: 'Buildings', label: 'Metal shed', hint: 'A corrugated metal shed with a pitched roof and a wide roll-up opening; workbench, drums and crates inside',
    ...pfp('Metal shed', [num('w', 'Width', 20, 48, 32, 2), num('d', 'Depth', 14, 36, 24, 2)], (L, p) => {
      const w = +p.w, d = +p.d, hw = w / 2, hd = d / 2
      return [
        ...shell(L, { w, d, h: 9, side: PB.corrugated, top: PB.steel, floor: PB.floorWorn, front: [DOOR(-hw / 3, Math.min(12, w / 2.6), 8), DOOR(hw / 2)], right: [DOOR(0)] }),
        gable(L, 0, 0, w + 1, d + 1, Math.max(3, d * 0.16), 9, PB.corrugated, PB.corrugated),
        lying('Roll-up drum', 1, Math.min(12, w / 2.6), L(-hw / 3, 8, hd - 1), PB.steel, PB.steel, 8),
        ...at(L, hw / 3, -hd + 1.6, 0, (M) => [...table(M, 8, 2, PB.steel), box('Toolboard', [8, 3, 0.15], M(0, 2.5, -0.95), PLYWOOD)], FL),
        ...[[-hw + 2, -hd + 2], [-hw + 3.8, -hd + 2.3], [-hw + 2.4, -hd + 4]].flatMap(([x, z], i) => at(L, x, z, 0, (M) => barrel(M, i % 2 ? PB.red : PB.boxBlue), FL)),
        ...[[hw - 3, -6], [hw - 3, -3.4]].flatMap(([x, z]) => at(L, x, z, 10, crate, FL)),
      ]
    }),
  },
  loadingdock: {
    category: 'Buildings', label: 'Loading dock', hint: 'A warehouse with a raised dock: three dock doors at truck height, bumpers, a canopy, steps and a forklift ramp, and a trailer backed up',
    ...pfp('Loading dock', [wallParam('metal'), yesNo('trailer', 'Trailer at the dock', 'yes')], (L, p) => {
      const w = 40, d = 28, hd = d / 2, b = 2.4
      const parts = [
        box('Dock floor', [w - 2 * T, b, d - 2 * T], L(0, 0, 0), PB.floorWorn, PB.concrete),
        ...shell(L, { w, d, h: 12, side: wallTex(p), top: PB.steel, front: [-12, 0, 12].map((x) => DOOR(x, 7, 7, b)), back: [DOOR(10, 3.6)] }),
        ...flatRoof(L, w, d, 12, PB.steel),
        box('Dock', [36, b, 5], L(0, 0, hd + 2.5), PB.concrete, PB.darkConcrete), box('Dock edge', [36, 0.3, 0.4], L(0, b - 0.3, hd + 5.2), PB.yellow),
        ...[-12, 0, 12].flatMap((x) => [-1, 1].map((s) => box('Dock bumper', [0.8, 1.2, 0.5], L(x + s * 3.2, 0.9, hd + 5.25), BLACK))),
        box('Dock canopy', [38, 0.5, 7], L(0, 10, hd + 3.5), PB.steel), ...[-12, 0, 12].map((x) => box('Dock light', [0.6, 0.6, 1], L(x - 4.4, 8.8, hd + 0.5), PB.yellow)),
        stairs('Dock steps', [3.5, b, 4], L(-20, 0, hd + 2.5), PB.concrete, PB.concrete, 270, 5), ramp('Forklift ramp', [4, b, 10], L(23, 0, hd + 2.5), PB.concrete, PB.concrete, 90),
        ...[[-14, -8], [-6, -9], [4, -8]].flatMap(([x, z]) => at(L, x, z, 0, (M) => [box('Pallet', [4, 0.6, 4], M(0, 0, 0), PB.wood), box('Boxes', [3.6, 2.4, 3.6], M(0, 0.6, 0), PLYWOOD)], b)),
        ...at(L, 14, -9, 0, (M) => rack(M, 8), b),
      ]
      if (p.trailer === 'yes') parts.push(...at(L, -12, hd + 5.4 + 14, 0, (M) => [
        box('Trailer', [8, 8.6, 28], M(0, 2.4, 0), WHITE, PB.steel), box('Trailer frame', [6, 1, 26], M(0, 1.4, 0), BLACK),
        ...[-1, 1].map((s) => box('Landing leg', [0.4, 2.4, 0.4], M(s * 3, 0, 8), PB.steel)), ...wheels(M, 7, [-10.5, -8], 1.8, 0.8),
      ]))
      return parts
    }),
  },
  factory: {
    category: 'Buildings', label: 'Factory', hint: 'A brick factory you can enter: a sawtooth roof, a tall chimney, machines, a conveyor and a catwalk with stairs',
    ...pfp('Factory', [wallParam('brick'), num('chimney', 'Chimney height', 20, 70, 44, 2)], (L, p) => {
      const w = 44, d = 30, hd = d / 2, hw = w / 2
      const high = (a: number, b: number) => windowsAlong(a, b, [], 8, 7).map((g) => ({ ...g, w: 3.4, h: 3 }))
      return [
        ...shell(L, { w, d, h: 12, side: wallTex(p), top: PB.concrete, floor: PB.floorWorn, front: [DOOR(-12, 10, 9), DOOR(6), ...high(10, hw)], back: [DOOR(14), ...high(-hw, 10)], left: [DOOR(0), ...high(-hd, -4)], right: high(-hd, hd) }),
        ...[-12, -6, 0, 6, 12].map((z) => ramp('Sawtooth', [w + 0.4, 4, 6], L(0, 12, z + 0.0), PB.corrugated, GLASS)),
        box('Chimney base', [7, 4, 7], L(hw + 4, 0, -hd + 5), PB.brick), { ...cyl('Chimney', 5, +p.chimney, L(hw + 4, 4, -hd + 5), PB.black, PB.brick, 14), taper: 0.7 },
        // Machines, a conveyor and a catwalk along the back wall.
        ...[[-14, -4], [-4, -4], [6, -4]].flatMap(([x, z]) => [box('Machine', [6, 4, 4], L(x, FL, z), PB.boxGreen, PB.steel), lying('Machine pipe', 0.8, 6, L(x, FL + 4, z), PB.steel, PB.steel, 8)]),
        box('Conveyor', [24, 0.6, 2.4], L(-4, 2.4, 4), BLACK, PB.steel), ...[-14, -4, 6].flatMap((x) => [-1, 1].map((s) => box('Conveyor leg', [0.3, 2.25, 0.3], L(x, FL, 4 + s), PB.steel))),
        ...[-12, -2, 5].map((x) => box('Crate', [1.8, 1.4, 1.8], L(x, 3, 4), PLYWOOD)),
        box('Catwalk', [30, 0.4, 3], L(-4, 6, -hd + 2), PB.diamond, PB.steel), box('Catwalk rail', [30, 1.1, 0.15], L(-4, 6.4, -hd + 3.4), PB.yellow),
        ...[-18, -4, 10].map((x) => box('Catwalk leg', [0.4, 5.85, 0.4], L(x, FL, -hd + 3.2), PB.steel)), stairs('Catwalk stairs', [3, 6.25, 9], L(15.5, FL, -hd + 2), PB.diamond, PB.steel, 90, 10),
      ]
    }),
  },
  rooftoptank: {
    category: 'Buildings', label: 'Rooftop water tank', hint: 'A wooden water tank on a steel stand with a ladder, the classic city rooftop piece (raise it onto a roof)',
    ...pfp('Water tank', [num('size', 'Size', 0.6, 2, 1, 0.1)], (L, p) => {
      const s = +p.size, legH = 5 * s, r = 2.6 * s
      return [
        ...[[-r, -r], [r, -r], [-r, r], [r, r]].map(([a, b]) => box('Tank leg', [0.5 * s, legH, 0.5 * s], L(a, 0, b), PB.steel)),
        ...[-r, r].map((b) => box('Brace', [2 * r, 0.3 * s, 0.3 * s], L(0, legH * 0.45, b), PB.steel)), ...[-r, r].map((a) => box('Brace', [0.3 * s, 0.3 * s, 2 * r], L(a, legH * 0.45, 0), PB.steel)),
        box('Tank deck', [2 * r + 1, 0.4 * s, 2 * r + 1], L(0, legH, 0), PB.planks, PB.steel),
        cyl('Water tank', 6 * s, 6 * s, L(0, legH + 0.4 * s, 0), PB.wood, PB.planks, 16), ...[0.25, 0.75].map((f) => cyl('Tank hoop', 6.1 * s, 0.25 * s, L(0, legH + 0.4 * s + 6 * s * f, 0), PB.steel, PB.steel, 16)),
        { ...cyl('Tank roof', 6.6 * s, 2.4 * s, L(0, legH + 6.4 * s, 0), PB.wood, PB.wood, 16), taper: 0 },
        box('Ladder', [1, legH + 6.4 * s, 0.2], L(0, 0, 3.1 * s + 0.2), PB.rusty),
      ]
    }),
  },
  radiotower: {
    category: 'Industrial', label: 'Radio mast', hint: 'A red-and-white lattice radio mast with a beacon on top and an equipment hut at its foot',
    ...pfp('Radio mast', [num('h', 'Height', 20, 100, 48, 2)], (L, p) => {
      const h = +p.h, r = 2.4, pts = [90, 210, 330].map((a) => [r * Math.cos((a * Math.PI) / 180), r * Math.sin((a * Math.PI) / 180)])
      const parts: Part[] = [box('Mast base', [6, 0.8, 6], L(0, 0, 0), PB.concrete), ...pts.map(([x, z]) => cyl('Mast leg', 0.5, h, L(x, 0.8, z), PB.steel, PB.steel, 6))]
      for (let y = 4, i = 0; y < h; y += 4, i++) for (let k = 0; k < 3; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[(k + 1) % 3]
        parts.push(box('Mast brace', [Math.hypot(bx - ax, bz - az), 0.25, 0.25], L((ax + bx) / 2, 0.8 + y, (az + bz) / 2), i % 2 ? CY.white : PB.red, i % 2 ? CY.white : PB.red, (Math.atan2(-(bz - az), bx - ax) * 180) / Math.PI))
      }
      parts.push(cyl('Beacon', 1.2, 1.2, L(0, h + 0.8, 0), PB.red, PB.red, 8), cyl('Top antenna', 0.3, 6, L(0, h + 2, 0), PB.steel, PB.steel, 6),
        box('Equipment hut', [6, 4.4, 5], L(0, 0, -7), PB.concrete, PB.cinder), box('Hut door', [2.2, 3.8, 0.15], L(1, 0, -4.45), STEEL_DOOR), box('Hut AC', [1.6, 1.4, 1.2], L(-1.6, 1.6, -4), PB.steel))
      return parts
    }),
  },
  celltower: {
    category: 'Industrial', label: 'Cell tower', hint: 'A phone mast: a monopole with antenna panels, equipment cabinets on a pad and a chain-link fence round it',
    ...pfp('Cell tower', [num('h', 'Height', 16, 60, 34, 2)], (L, p) => {
      const h = +p.h, f = 7
      return [
        box('Pad', [14, 0.4, 14], L(0, 0, 0), PB.concrete), { ...cyl('Monopole', 1.8, h, L(0, 0.4, 0), PB.steel, PB.steel, 10), taper: 0.5 },
        ...[0, 120, 240].flatMap((a) => {
          const [dx, dz] = turn(0, 2, a)
          return [box('Antenna arm', [0.3, 0.3, 4], L(dx / 2, h - 1, dz / 2), PB.steel, PB.steel, a), ...[-1, 0, 1].map((k) => { const [ox, oz] = turn(k * 1.2, 2.2, a); return box('Antenna panel', [0.9, 3.4, 0.4], L(ox, h - 3, oz), CY.white, CY.white, a) })]
        }),
        ...[-3, 0, 3].map((x) => box('Cabinet', [2.2, 3.6, 1.8], L(x, 0.4, -4.4), PB.steel, CY.white)),
        ...wall(L, 'x', -f, f, -f, 6, 0.1, CHAIN, PB.steel, [], 0.4, 'Fence'), ...wall(L, 'x', -f, f, f, 6, 0.1, CHAIN, PB.steel, [DOOR(3, 4, 6)], 0.4, 'Fence'),
        ...wall(L, 'z', -f, f, -f, 6, 0.1, CHAIN, PB.steel, [], 0.4, 'Fence'), ...wall(L, 'z', -f, f, f, 6, 0.1, CHAIN, PB.steel, [], 0.4, 'Fence'),
        ...[[-f, -f], [f, -f], [-f, f], [f, f], [1, f], [5, f]].map(([x, z]) => cyl('Fence post', 0.3, 6.2, L(x, 0.4, z), PB.steel, PB.steel, 6)),
      ]
    }),
  },
  rooftopbillboard: {
    category: 'Buildings', label: 'Rooftop billboard', hint: 'A big billboard on a steel frame for a rooftop: a catwalk, lamps on arms and a painted ad panel (no brands)',
    ...pfp('Rooftop billboard', [muralParam('sunset'), num('w', 'Width', 10, 30, 18, 1)], (L, p) => {
      const w = +p.w, xs = [-w / 2 + 0.5, -w / 6, w / 6, w / 2 - 0.5]
      return [
        ...[-1.5, 1.5].map((z) => box('Base beam', [w, 0.6, 0.6], L(0, 0, z), PB.rusty)),
        ...xs.flatMap((x) => [box('Upright', [0.5, 14, 0.5], L(x, 0.6, 0), PB.rusty), box('Strut', [0.4, 6, 0.4], L(x, 0.6, -1.5), PB.rusty)]),
        ...[3, 6.2].map((y) => box('Cross beam', [w, 0.4, 0.4], L(0, y, -0.3), PB.rusty)),
        box('Catwalk', [w, 0.2, 1.6], L(0, 6, 1.1), PB.diamond), box('Catwalk rail', [w, 1, 0.15], L(0, 6.2, 1.85), PB.steel),
        box('Billboard', [w, 7.4, 0.4], L(0, 7, 0.1), PB.steel, MURALS[String(p.mural)] ?? MURALS.sunset, 0, 7.4),
        ...xs.slice(0, 3).map((x, i) => box('Lamp arm', [0.2, 0.2, 2.4], L(x + (i + 1) * 0.8, 14.4, 1.4), PB.steel)), ...xs.slice(0, 3).map((x, i) => box('Lamp', [1, 0.5, 0.6], L(x + (i + 1) * 0.8, 14.2, 2.6), PB.steel, CY.white)),
      ]
    }),
  },
  burnedshell: {
    category: 'Buildings', label: 'Burned-out building', hint: 'The charred shell of a two-storey building: broken walls at odd heights, a half-fallen floor you can climb, rubble and debris',
    ...pfp('Burned shell', [num('seed', 'Shape', 1, 9, 1)], (L, p) => {
      const W = 24, D = 18, hw = W / 2, hd = D / 2, k = +p.seed
      const hgt = (i: number) => [13, 9, 5.5, 11, 3.5, 14, 7.5, 2.4][(((i * 3 + k) % 8) + 8) % 8]
      // Wall runs as (start, end, height), so window holes show as low sills.
      const run = (axis: 'x' | 'z', c: number, from: number, to: number, skip: number[] = []): Part[] => {
        const out: Part[] = [], n = Math.round((to - from) / 4)
        for (let i = 0; i < n; i++) {
          const a = from + ((to - from) * i) / n, b = from + ((to - from) * (i + 1)) / n, h = skip.includes(i) ? 0 : hgt(i + Math.round(c))
          if (h <= 0) continue
          out.push(axis === 'x' ? box('Charred wall', [b - a, h, 0.8], L((a + b) / 2, 0, c), CHAR, SOOT) : box('Charred wall', [0.8, h, b - a], L(c, 0, (a + b) / 2), CHAR, SOOT))
        }
        return out
      }
      return [
        box('Burned floor', [W - 1.6, 0.15, D - 1.6], L(0, 0, 0), CHAR, CHAR),
        ...run('x', hd - 0.4, -hw, hw, [2]), ...run('x', -hd + 0.4, -hw, hw, [4]), ...run('z', -hw + 0.4, -hd + 0.8, hd - 0.8), ...run('z', hw - 0.4, -hd + 0.8, hd - 0.8, [1]),
        box('Upper floor', [11, 0.5, D - 1.6], L(-hw + 6.3, 7, 0), CHAR, SOOT), ramp('Fallen floor', [9, 7.35, 9], L(4.3, FL, -1), CHAR, SOOT, 90),
        ...[[-3, 4, 0], [6, 5, 30], [5, -5, 70], [-8, -4, 15]].map(([x, z, r]) => ({ ...box('Rubble', [3.6, 1.4, 2.6], L(x, FL, z), CHAR, SOOT, r), bevel: 0.5 })),
        ...[[2, 6, 20], [-6, 2, 75], [8, 1, 140]].map(([x, z, r]) => box('Charred beam', [7, 0.6, 0.6], L(x, FL, z), DARK_WOOD, CHAR, r)),
        ...at(L, 8, 6, 0, (M) => [...barrel(M, PB.rusty), cyl('Fire', 1.4, 0.4, M(0, 2.2, 0), FIRE, FIRE, 10)], FL),
      ]
    }),
  },
  buildingframe: {
    category: 'Buildings', label: 'Steel frame', hint: 'A building going up: a steel skeleton with plank decks on each floor, stairs to the top, safety rails and site clutter',
    ...pfp('Steel frame', [num('floors', 'Floors', 2, 6, 3)], (L, p) => {
      const n = +p.floors, H = FLOOR, xs = [-11.5, -3.8, 3.8, 11.5], zs = [-7.5, 0, 7.5], top = n * H
      const parts: Part[] = [box('Ground slab', [24, 0.2, 16], L(0, 0, 0), PB.concrete),
        ...xs.flatMap((x) => zs.map((z) => box('Column', [0.7, top, 0.7], L(x, 0.2, z), RUST_RED)))]
      // Stairs in the right bay: a switchback between two lanes, landings at both ends.
      const lane = (s: number): [number, number] => [4.15 + s * 3.4, 4.15 + (s + 1) * 3.4]
      for (let k = 1; k <= n; k++) {
        const y = k * H
        // The middle beam stops short of the stair bay, so there is headroom over the flights.
        parts.push(...zs.map((z) => (z ? box('Beam', [23.7, 0.7, 0.5], L(0, y - 0.7, z), RUST_RED) : box('Beam', [15.9, 0.7, 0.5], L(-3.9, y - 0.7, z), RUST_RED))),
          ...xs.map((x) => box('Beam', [0.5, 0.7, 15.5], L(x, y - 0.7, 0), RUST_RED)))
        if (k === n) continue
        const [a, c] = lane((k - 1) % 2), [e, f] = lane(k % 2)
        parts.push(box('Deck', [15.3, 0.3, 15], L(-3.85, y, 0), PLYWOOD, PB.wood), box('Deck', [f - e, 0.3, 15], L((e + f) / 2, y, 0), PLYWOOD, PB.wood),
          box('Deck', [c - a, 0.3, 2.5], L((a + c) / 2, y, -6.25), PLYWOOD, PB.wood), box('Deck', [c - a, 0.3, 2.5], L((a + c) / 2, y, 6.25), PLYWOOD, PB.wood),
          box('Safety rail', [24, 1.1, 0.15], L(0, y + 0.3, -7.9), HAZARD), box('Safety rail', [24, 1.1, 0.15], L(0, y + 0.3, 7.9), HAZARD), ...[-11.9, 11.9].map((x) => box('Safety rail', [0.15, 1.1, 15.6], L(x, y + 0.3, 0), HAZARD)))
      }
      for (let k = 0; k < n - 1; k++) { const [a, c] = lane(k % 2); parts.push(stairs('Site stairs', [c - a, H, 10], L((a + c) / 2, k * H + (k ? 0.3 : 0.2), 0), PB.diamond, PB.steel, k % 2 ? 180 : 0, 12)) }
      parts.push(...at(L, -6, 11, 0, (M) => [box('Pallet', [4, 0.6, 4], M(0, 0, 0), PB.wood), box('Blocks', [3.6, 2, 3.6], M(0, 0.6, 0), PB.cinder)]),
        ...[0, 1, 2].map((i) => lying('Rebar', 0.3, 10, L(4, i * 0.3, 11 + i * 0.35), RUST_RED, RUST_RED, 6)), box('Site sign', [4, 3, 0.2], L(-12, 2, 9), HAZARD))
      return parts
    }),
  },
  boardedstore: shop('Boarded store', 'Boarded-up storefront', 'A shut-down shop: plywood over the windows (gaps to shoot through), graffiti, a bare awning frame and a trashed interior', { floors: 1, upper: 'darkbrick', sign: 'white', awning: 'none', walls: 'oldbrick' }, [muralParam('fire')],
    () => ({ w: 18, d: 14, doors: [DOOR(-5)], display: [1, 6], displayW: 4, floor: PB.floorWorn }),
    (L, p) => [
      ...[1, 6].flatMap((x) => [box('Boards', [4.4, 2, 0.2], L(x, 1.1, 7.15), PLYWOOD), box('Boards', [4.4, 0.8, 0.2], L(x, 4, 7.15), PLYWOOD)]),
      box('Graffiti', [5, 3, 0.1], L(-3.5 + 8, 1, -7.05), MURALS[String(p.mural)] ?? MURALS.fire), box('Graffiti', [0.1, 3.4, 6], L(9.05, 1, 0), MURALS.purple),
      ...[-1, 1].map((s) => box('Awning frame', [0.2, 0.2, 2.4], L(3.5 + s * 5, 4.9, 8.2), PB.rusty)), box('Awning frame', [10, 0.2, 0.2], L(3.5, 4.9, 9.3), PB.rusty),
      ...at(L, -6.5, 9, 0, trashBags), box('Mattress', [3, 4.4, 0.6], L(-1.5, 0, 7.6), LINEN),
      ...[[-3, -3, 20], [3, 2, 75]].map(([x, z, r]) => box('Fallen shelf', [6, 1.4, 2], L(x, FL, z), DARK_WOOD, DARK_WOOD, r)), ...[[5, -4, 10], [-5, 3, 50], [1, -5, 80]].map(([x, z, r]) => ({ ...box('Debris', [2, 0.8, 1.6], L(x, FL, z), CHAR, SOOT, r), bevel: 0.3 })),
      box('Counter', [6, 2.1, 2], L(4, FL, -4.4), DARK_WOOD),
    ]),
  boardedhouse: {
    category: 'Buildings', label: 'Abandoned house', hint: 'A boarded-up house: plywood over the front, a sagging porch, a tarp on the roof, junk in the yard; the back door is open',
    ...pfp('Abandoned house', [sel('walls', 'Walls', [['wood', 'Weathered wood'], ['brick', 'Old brick']], 'wood')], (L, p) => {
      const w = 20, d = 14, side = p.walls === 'brick' ? PB.oldBrick : PB.planks, front = [DOOR(-3), ...windowsAlong(-10, 10, [DOOR(-3)])]
      return [
        ...shell(L, { w, d, h: 7, side, top: DARK_WOOD, floor: PB.planks, front, back: [DOOR(6, 3.6), WIN(-4)], left: [WIN(0)], right: [WIN(-2)] }),
        gable(L, 0, 0, w + 1.6, d + 2, 5, 7, SLATE, side), box('Roof tarp', [7, 0.2, 6], L(4, 9.6, -2.5), TARP),
        ...front.map((g) => box('Boards', [g.w + 0.6, g.h + 0.4, 0.2], L(g.at, g.sill ?? 0, d / 2 + 0.1), PLYWOOD)),
        ramp('Sagging porch', [10, 0.6, 3.6], L(-3, 0, d / 2 + 1.8), PB.planks, DARK_WOOD), box('Porch post', [0.4, 5.6, 0.4], L(-7.6, 0, d / 2 + 3.3), DARK_WOOD),
        box('Porch roof', [10.6, 0.3, 4], L(-3, 6.2, d / 2 + 1.9), SLATE, DARK_WOOD),
        box('Dead lawn', [w + 6, 0.08, 10], L(0, 0, d / 2 + 5.5), DRY_GRASS), ...at(L, 6, d / 2 + 6, 30, (M) => couch(M, 5, FABRIC)), ...[0, 1].map((i) => cyl('Tire', 2.4, 0.8, L(-9, i * 0.8, d / 2 + 7), PB.tire, PB.tire, 10)),
        box('Mattress', [4, 0.6, 6], L(5, FL, -2), LINEN), box('Overturned table', [4, 2.6, 0.3], L(-5, FL, -2), DARK_WOOD), ...at(L, -7, -4, 0, trashBags, FL),
      ]
    }),
  },
}


// ---------------- neighbourhood life ----------------

const CARDBOARD = solid('#a8834f', '#8a6a3a', 660)
const UMBRELLA_STRIPES: Tex = { gen: 'hazard', tweak: { color: '#f2c218', accent: '#2a6fe0', scale: 4, wear: 0, seed: 661 } }
const LAUNDRY: Tex[] = [WHITE, PB.blue, PB.red, PB.yellow, LINEN, PB.green]

const hoop = (L: Lf): Part[] => [
  cyl('Hoop pole', 0.6, 7.4, L(0, 0, 0), PB.steel, PB.steel, 8), box('Hoop arm', [0.4, 0.4, 2.2], L(0, 7, 1.1), PB.steel),
  box('Backboard', [3.6, 2.4, 0.2], L(0, 6.4, 2.3), CY.white), { ...cyl('Rim', 1.6, 0.12, L(0, 6.2, 3.2), PB.orange, PB.orange, 12), taper: 1 },
]
/** A chain-link fence along one side, on posts, with optional gaps. */
const chainRun = (L: Lf, axis: 'x' | 'z', a: number, b: number, c: number, h: number, gaps: Gap[] = []): Part[] => [
  ...wall(L, axis, a, b, c, h, 0.1, CHAIN, PB.steel, gaps, 0, 'Fence'),
  ...[...Array(Math.round((b - a) / 6) + 1)].map((_, i) => { const s = a + ((b - a) * i) / Math.round((b - a) / 6); return cyl('Fence post', 0.3, h + 0.2, axis === 'x' ? L(s, 0, c) : L(c, 0, s), PB.steel, PB.steel, 6) }),
]
/** A wooden privacy fence along one side. */
const woodRun = (L: Lf, axis: 'x' | 'z', a: number, b: number, c: number, h: number, gaps: Gap[] = [], tex: Tex = PB.planks): Part[] => wall(L, axis, a, b, c, h, 0.3, tex, PB.wood, gaps, 0, 'Fence')

const LIFE: Record<string, Def> = {
  bballcourt: {
    category: 'Neighbourhood', label: 'Basketball court', hint: 'A painted outdoor court with hoops at the ends, a chain-link fence with gates and a bench',
    ...pfp('Basketball court', [sel('size', 'Court', [['full', 'Full court'], ['half', 'Half court']], 'full'), yesNo('fence', 'Fence', 'yes')], (L, p) => {
      const full = p.size === 'full', W = 30, D = full ? 56 : 30, hw = W / 2, hd = D / 2, F = 4, y = 0.2
      const ends = full ? [-1, 1] : [-1]
      const parts: Part[] = [
        box('Court base', [W + 2 * F, 0.1, D + 2 * F], L(0, 0, 0), PB.asphalt), box('Court', [W, y, D], L(0, 0, 0), COURT, COURT),
        ...[-1, 1].map((s) => box('Sideline', [0.3, 0.05, D], L(s * (hw - 0.15), y, 0), LINE)), ...[-1, 1].map((s) => box('Baseline', [W, 0.05, 0.3], L(0, y, s * (hd - 0.15)), LINE)),
        ...(full ? [box('Center line', [W, 0.05, 0.3], L(0, y, 0), LINE)] : []),
        ...ends.flatMap((s) => [
          ...[-3, 3].map((x) => box('Key line', [0.3, 0.05, 11], L(x, y, s * (hd - 5.8)), LINE)), box('Free-throw line', [6.3, 0.05, 0.3], L(0, y, s * (hd - 11.15)), LINE),
          ...at(L, 0, s * (hd + 1), s > 0 ? 180 : 0, hoop),
        ]),
        box('Bench', [6, 0.9, 1.4], L(hw + 2, 0, 4), PB.wood),
      ]
      if (p.fence === 'yes') {
        const fw = hw + F, fd = hd + F
        parts.push(...chainRun(L, 'x', -fw, fw, -fd, 8), ...chainRun(L, 'x', -fw, fw, fd, 8), ...chainRun(L, 'z', -fd, fd, -fw, 8, [DOOR(0, 4, 8)]), ...chainRun(L, 'z', -fd, fd, fw, 8, [DOOR(full ? -12 : 0, 4, 8)]))
      }
      return parts
    }),
  },
  cornerhangout: {
    category: 'Neighbourhood', label: 'Corner hangout', hint: 'An old couch dragged out to the sidewalk: an armchair, a grill, a boombox on a milk crate, crates to sit on and a cooler',
    ...pfp('Hangout', [sel('cover', 'Couch', [['fabric', 'Faded fabric'], ['leather', 'Cracked leather'], ['purple', 'Purple']], 'fabric')], (L, p) => {
      const cover = p.cover === 'leather' ? LEATHER : p.cover === 'purple' ? PURPLE : FABRIC
      return [
        ...couch(L, 6, cover), ...at(L, 5, 1.8, -35, (M) => couch(M, 2.6, cover)), ...at(L, -5, 2.4, 0, grill),
        ...at(L, 1.8, 4.2, 0, (M) => [...milkCrate(M, PB.blue), ...boombox((dx, dy, dz) => M(dx, dy + 1, dz))]),
        ...[[-2.4, 5.4, 15], [3.8, 6, -20], [0, 7.2, 40]].flatMap(([x, z, r], i) => at(L, x, z, r, (M) => milkCrate(M, [PB.red, PB.yellow, PB.green][i]))),
        ...at(L, -3, 7.4, 160, foldingChair), ...at(L, 6.4, 5, 0, (M) => picnicCooler(M, PB.red)), ...at(L, -7, -0.6, 0, trashCan),
        box('Cardboard', [3, 0.1, 2.2], L(1, 0, 2.6), CARDBOARD),
      ]
    }),
  },
  dicegame: {
    category: 'Neighbourhood', label: 'Dice game', hint: 'A dice game against a tagged wall: cardboard, dice and cash on the ground, crates to crouch on and a fire barrel',
    ...pfp('Dice game', [muralParam('purple')], (L, p) => [
      box('Wall', [12, 7, 1], L(0, 0, -3), PB.oldBrick), box('Wall cap', [12.4, 0.3, 1.3], L(0, 7, -3), PB.concrete),
      box('Graffiti', [7, 3.6, 0.1], L(-1, 1, -2.45), MURALS[String(p.mural)] ?? MURALS.purple),
      box('Cardboard', [3.4, 0.1, 2.6], L(0, 0, 1.4), CARDBOARD), ...[[-0.4, 1.2], [0.5, 1.6]].map(([x, z]) => box('Die', [0.35, 0.35, 0.35], L(x, 0.1, z), WHITE)),
      ...[[1.2, 0.8], [-1.1, 2.1]].map(([x, z]) => box('Cash', [0.8, 0.25, 0.4], L(x, 0.1, z), CASH)),
      ...[[-2.6, 1, 10], [2.6, 1.4, -15], [0, 4, 0]].flatMap(([x, z, r], i) => at(L, x, z, r, (M) => milkCrate(M, [PB.red, PB.blue, PB.black][i]))),
      ...at(L, 5, 2, 0, (M) => [...barrel(M, PB.rusty), cyl('Fire', 1.4, 0.4, M(0, 2.2, 0), FIRE, FIRE, 10)]),
      cyl('Bottle', 0.3, 0.9, L(-3.4, 0, 2.6), BOTTLES[1], BOTTLES[1], 6), ...at(L, -5, 0, 0, trashBags),
    ]),
  },
  fruitstand: {
    category: 'Neighbourhood', label: 'Fruit stand', hint: 'A sidewalk produce stand: tilted crates of fruit under a striped awning, stacked crates and a scale',
    ...pfp('Fruit stand', [colorParam('awning', 'Awning', 'green')], (L, p) => [
      box('Stand', [9, 2, 3.6], L(0, 0, 0), PB.wood), ...[-3.3, -1.1, 1.1, 3.3].map((x, i) => ramp('Fruit crate', [2, 0.9, 3.2], L(x, 2, 0.1), [PB.red, PB.orange, PB.yellow, PB.green][i], PB.wood)),
      ...[[-4.4, -1.9], [4.4, -1.9], [-4.4, 1.9], [4.4, 1.9]].map(([x, z]) => box('Awning post', [0.3, 6, 0.3], L(x, 0, z), PB.steel)),
      ramp('Awning', [10, 1, 5], L(0, 6, 0.6), colorTex(p, 'awning'), CY.white),
      ...[[-6, 0.6], [-6, 2.8], [6.2, 0.4]].flatMap(([x, z], i) => [box('Crate', [1.8, 1.2, 1.8], L(x, 0, z), PB.planks), box('Fruit', [1.6, 0.4, 1.6], L(x, 1.2, z), [PB.red, PB.green, PB.yellow][i])]),
      box('Scale', [0.8, 0.6, 0.8], L(4, 2, -1.2), PB.steel), box('Cash box', [0.8, 0.4, 0.6], L(-4, 2, -1.2), PB.green),
    ]),
  },
  newsstand: {
    category: 'Neighbourhood', label: 'Newsstand', hint: 'A sidewalk news kiosk: magazines on racks, papers on the counter, a cooler and a little overhanging roof',
    ...pfp('Newsstand', [colorParam('color', 'Paint', 'green')], (L, p) => [
      ...shell(L, { w: 7, d: 4.6, h: 6, side: colorTex(p, 'color'), top: PB.steel, floor: PB.floorWorn, front: [WIN(0, 5, 2.6, 2.2)], back: [DOOR(2, 2.4, 5)] }),
      box('Kiosk roof', [8.4, 0.4, 6.4], L(0, 6, 0.6), PB.steel, colorTex(p, 'color')), box('Sign band', [7, 1, 0.3], L(0, 6.4, 3.6), PB.yellow, PB.steel),
      box('Counter', [5.4, 0.2, 1.2], L(0, 2.2, 2.7), PB.wood), ...[-1.8, 0, 1.8].map((x, i) => box('Papers', [1.2, 0.3, 0.9], L(x, 2.4, 2.7), [WHITE, LINEN, WHITE][i])),
      ...[-1, 1].flatMap((s) => [0, 1, 2].map((k) => box('Magazines', [0.3, 1, 3.6], L(s * 3.7, 1.2 + k * 1.2, 0), [PB.red, PB.blue, PB.yellow][(k + (s > 0 ? 1 : 0)) % 3]))),
      box('Drinks cooler', [1.6, 3, 1.6], L(-2.4, 0, -0.9), WHITE, PB.blue),
    ]),
  },
  icecart: {
    category: 'Neighbourhood', label: 'Ice cream cart', hint: 'A push cart with a cold box, a striped umbrella and two wheels',
    ...pfp('Ice cream cart', [colorParam('color', 'Paint', 'blue')], (L, p) => [
      box('Cart', [4, 2.4, 2.2], L(0, 0.6, 0), WHITE, colorTex(p, 'color')), ...[-0.9, 0.9].map((x) => box('Lid', [1.7, 0.15, 2], L(x, 3, 0), PB.steel)),
      ...[-1, 1].map((s) => lying('Wheel', 1.2, 0.3, L(-1.2, 0, s * 1.25), PB.tire, PB.tire, 12, 90)), box('Cart leg', [0.3, 0.6, 1.6], L(1.6, 0, 0), PB.steel),
      box('Handle', [0.2, 0.2, 2], L(2.4, 3.2, 0), PB.steel), ...[-0.8, 0.8].map((z) => box('Handle arm', [0.6, 0.2, 0.2], L(2.15, 3, z), PB.steel)),
      cyl('Umbrella pole', 0.15, 3.6, L(-1, 3, 0), PB.steel, PB.steel, 6), { ...cyl('Umbrella', 5, 0.9, L(-1, 6.4, 0), UMBRELLA_STRIPES, UMBRELLA_STRIPES, 8), taper: 0 },
    ]),
  },
  icechest: {
    category: 'Neighbourhood', label: 'Ice chest & propane', hint: 'The two things outside every corner store: an ice merchandiser and a caged propane rack',
    make: pf('Ice chest', (L) => [...at(L, -3, 0, 0, iceChest), ...at(L, 3, 0, 0, (M) => [...propaneCage(M), ...[-1.2, 0, 1.2].map((x) => cyl('Propane tank', 1, 1.8, M(x, 0.1, 0), WHITE, WHITE, 8))])]),
  },
  stoop: {
    category: 'Neighbourhood', label: 'Stoop', hint: 'Front steps up to a raised door, with a landing and side walls: back it against any building',
    ...pfp('Stoop', [num('h', 'Height', 1, 4, 2, 0.2), num('w', 'Width', 3, 8, 4, 0.5), sel('tex', 'Stone', [['stone', 'Brownstone'], ['concrete', 'Concrete'], ['brick', 'Brick']], 'stone')], (L, p) => {
      const h = +p.h, w = +p.w, tex = p.tex === 'concrete' ? PB.concrete : p.tex === 'brick' ? PB.brick : STONE
      return [box('Landing', [w + 0.8, h, 2.2], L(0, 0, 1.1), tex), ...at(L, 0, 2.2, 0, (M) => stoopParts(M, h, w, tex)),
        ...[-1, 1].map((s) => box('Newel post', [0.5, 1.4, 0.5], L(s * (w / 2 + 0.2), h + 0.8, 2.2 + h * 1.8 - 0.25), tex))]
    }),
  },
  firebarrel: {
    category: 'Neighbourhood', label: 'Fire barrel', hint: 'A burning oil drum with crates and a pallet round it to warm up by',
    make: pf('Fire barrel', (L) => [
      ...barrel(L, PB.rusty), cyl('Fire', 1.4, 0.5, L(0, 2.2, 0), FIRE, FIRE, 10),
      ...[[-2.2, 0.4, 20], [1.8, 1.8, -30]].flatMap(([x, z, r]) => at(L, x, z, r, (M) => milkCrate(M, PB.red))), box('Pallet', [3, 3.6, 0.4], L(0.4, 0, -2), PB.wood, PB.wood, 10),
    ]),
  },
  laundryline: {
    category: 'Neighbourhood', label: 'Clothesline', hint: 'Laundry hung out between two T-posts, with a basket',
    ...pfp('Clothesline', [num('len', 'Length', 6, 24, 12)], (L, p) => {
      const len = +p.len, n = Math.floor(len / 2.2)
      return [
        ...[-1, 1].flatMap((s) => [box('Line post', [0.3, 6, 0.3], L(s * len / 2, 0, 0), PB.steel), box('Crossbar', [0.25, 0.25, 2.4], L(s * len / 2, 5.6, 0), PB.steel)]),
        ...[-0.9, 0.9].map((z) => box('Line', [len, 0.06, 0.06], L(0, 5.7, z), CY.white)),
        ...[...Array(n)].map((_, i) => box('Laundry', [1.4 + (i % 2) * 0.6, 1.6 + (i % 3) * 0.6, 0.06], L(-len / 2 + 1.4 + i * 2.2, 5.7 - 1.6 - (i % 3) * 0.6, i % 2 ? 0.9 : -0.9), LAUNDRY[i % LAUNDRY.length])),
        box('Laundry basket', [1.8, 1, 1.2], L(len / 2 - 2, 0, 1.6), WHITE),
      ]
    }),
  },
  backyard: {
    category: 'Neighbourhood', label: 'Backyard', hint: 'A fenced yard: lawn, a grill and picnic table, a kiddie pool, lawn chairs and a tool shed',
    ...pfp('Backyard', [num('w', 'Width', 14, 40, 22), num('d', 'Depth', 12, 30, 18)], (L, p) => {
      const w = +p.w, d = +p.d, hw = w / 2, hd = d / 2
      return [
        box('Lawn', [w, 0.1, d], L(0, 0, 0), GRASS),
        ...woodRun(L, 'x', -hw, hw, -hd, 5), ...woodRun(L, 'z', -hd, hd, -hw, 5, [DOOR(hd - 3, 3, 5)]), ...woodRun(L, 'z', -hd, hd, hw, 5),
        ...at(L, -hw + 3, -hd + 2.5, 0, grill, 0.1), ...at(L, -hw + 7, -1, 0, picnicTable, 0.1),
        cyl('Kiddie pool', 6, 0.8, L(hw - 5, 0.1, 2), WATER, PB.blue, 14), ...[[-2, 4, 160], [2, 5, 200]].flatMap(([x, z, r]) => at(L, x, z, r, foldingChair, 0.1)),
        box('Shed', [5, 5.6, 4], L(hw - 3.5, 0.1, -hd + 2.5), PB.planks, PB.planks), ramp('Shed roof', [5.6, 1, 4.6], L(hw - 3.5, 5.7, -hd + 2.6), PB.rusty, PB.planks),
        box('Shed door', [2.2, 4.4, 0.15], L(hw - 3.5, 0.1, -hd + 4.55), DARK_WOOD),
      ]
    }),
  },
  picketfence: {
    category: 'Neighbourhood', label: 'Picket fence', hint: 'A picket fence with an optional gate gap; pick its length, height and paint',
    ...pfp('Picket fence', [num('len', 'Length', 4, 40, 16, 1), num('h', 'Height', 2, 4, 2.6, 0.2), sel('paint', 'Paint', [['white', 'White'], ['wood', 'Bare wood'], ['green', 'Green']], 'white'), yesNo('gate', 'Gate gap', 'yes')], (L, p) => {
      const len = +p.len, h = +p.h, tex = p.paint === 'wood' ? PB.wood : p.paint === 'green' ? PB.green : WHITE, gap = p.gate === 'yes' && len >= 8 ? 3 : 0
      const out: Part[] = []
      for (let x = -len / 2 + 0.3; x <= len / 2 - 0.3; x += 0.9) if (Math.abs(x) > gap / 2) out.push(box('Picket', [0.5, h, 0.15], L(x, 0, 0), tex))
      for (const s of gap ? [-1, 1] : [0]) {
        const a = gap ? (s < 0 ? -len / 2 : gap / 2) : -len / 2, b = gap ? (s < 0 ? -gap / 2 : len / 2) : len / 2
        out.push(...[0.5, h - 0.8].map((y) => box('Fence rail', [b - a, 0.3, 0.15], L((a + b) / 2, y, -0.15), tex)))
      }
      if (gap) out.push(...[-1, 1].map((s) => box('Gate post', [0.5, h + 0.4, 0.5], L(s * (gap / 2 + 0.25), 0, -0.1), tex)))
      return out
    }),
  },
  muralwall: {
    category: 'Neighbourhood', label: 'Mural wall', hint: 'A freestanding brick wall with a big painted mural on its face (no logos)',
    ...pfp('Mural wall', [muralParam('sunset'), num('len', 'Length', 6, 40, 16), num('h', 'Height', 4, 14, 8, 0.5)], (L, p) => [
      box('Wall', [+p.len, +p.h, 1], L(0, 0, 0), PB.concrete, PB.oldBrick), box('Mural', [+p.len - 1, +p.h - 1.2, 0.1], L(0, 0.6, 0.55), MURALS[String(p.mural)] ?? MURALS.sunset, MURALS[String(p.mural)] ?? MURALS.sunset, 0, +p.h),
      box('Wall cap', [+p.len + 0.4, 0.3, 1.4], L(0, +p.h, 0), PB.concrete),
    ]),
  },
  fireescape: {
    category: 'Neighbourhood', label: 'Fire escape', hint: 'Iron landings and switchback stairs from the street up to every floor: back it against a building wall to climb it',
    ...pfp('Fire escape', [num('floors', 'Floors', 2, 7, 4)], (L, p) => {
      const n = +p.floors, H = FLOOR, lane = (s: number) => 1.1 + s * 1.8
      const parts: Part[] = []
      for (let k = 0; k < n - 1; k++) parts.push(stairs('Fire stairs', [1.7, H, 10], L(0, k * H, lane(k % 2)), PB.rusty, PB.rusty, k % 2 ? 270 : 90, 12))
      for (let k = 1; k < n; k++) {
        const y = k * H - 0.25, hole = lane((k - 1) % 2), full = lane(k % 2)
        parts.push(box('Landing', [14, 0.25, 1.8], L(0, y, full), PB.rusty), ...[-6, 6].map((x) => box('Landing', [2, 0.25, 1.8], L(x, y, hole), PB.rusty)),
          box('Railing', [14, 1.1, 0.12], L(0, y + 0.25, 3.94), PB.rusty), ...[-1, 1].map((s) => box('Railing', [0.12, 1.1, 3.8], L(s * 6.94, y + 0.25, 2), PB.rusty)),
          ...[-6.5, 6.5].map((x) => box('Bracket', [0.3, 1.4, 3.8], L(x, y - 1.4, 2), PB.rusty)))
      }
      parts.push(box('Roof ladder', [1.2, H, 0.2], L(4.5, (n - 1) * H, 0.2), PB.rusty))
      return parts
    }),
  },
  rooftopkit: {
    category: 'Neighbourhood', label: 'Rooftop clutter', hint: 'A roof’s worth of kit: a stair hut with a door, AC units, vents, a satellite dish, an antenna and a skylight (raise it onto a roof)',
    make: pf('Rooftop kit', (L) => [
      box('Stair hut', [6, 6.6, 6], L(-6, 0, -4), PB.concrete, PB.cinder), box('Hut door', [2.4, 5, 0.15], L(-6, 0, -0.95), STEEL_DOOR), box('Hut roof', [6.6, 0.4, 6.6], L(-6, 6.6, -4), ROOF, PB.concrete),
      ...[[3, -5], [3, -0.5]].flatMap(([x, z]) => [box('AC unit', [4, 2.4, 3], L(x, 0, z), PB.steel), cyl('Fan grille', 2.2, 0.15, L(x, 2.4, z), BLACK, PB.steel, 12)]),
      ...[[8, -6, 3], [9, -3, 2], [7.6, 3, 4]].map(([x, z, h]) => cyl('Vent pipe', 0.8, h, L(x, 0, z), PB.steel, PB.steel, 8)),
      cyl('Dish post', 0.3, 2, L(-1, 0, 5), PB.steel, PB.steel, 6), { ...cyl('Satellite dish', 2.6, 0.8, L(-1, 2, 5), CY.white, CY.white, 12), taper: 1.8 },
      cyl('Antenna', 0.25, 10, L(-8.5, 6.6, -6.5), PB.steel, PB.steel, 6), box('Skylight', [5, 1.2, 4], L(4, 0, 5.6), PB.steel, GLASS), box('Skylight glass', [4.6, 0.1, 3.6], L(4, 1.2, 5.6), GLASS),
    ]),
  },
  parkinglot: {
    category: 'Neighbourhood', label: 'Parking lot', hint: 'An asphalt lot with painted bays, wheel stops, a curb, a light pole and a few parked cars',
    ...pfp('Parking lot', [num('stalls', 'Bays per row', 3, 16, 8), num('rows', 'Rows', 1, 2, 2), num('cars', 'Parked cars', 0, 6, 2), yesNo('light', 'Light pole', 'yes')], (L, p) => {
      const n = +p.stalls, rows = +p.rows, W = n * 6, D = rows * 10 + 8, hd = D / 2
      const parts: Part[] = [box('Lot', [W + 2, 0.1, D], L(0, 0, 0), PB.asphalt, PB.concrete), box('Curb', [W + 2, 0.6, 0.8], L(0, 0, -hd - 0.4), PB.concrete)]
      const rowZ = rows === 2 ? [-hd + 5, hd - 5] : [-hd + 5]
      rowZ.forEach((z, r) => {
        for (let i = 0; i <= n; i++) parts.push(box('Bay line', [0.3, 0.2, 9], L(-W / 2 + i * 6, 0, z), LINE))
        for (let i = 0; i < n; i++) parts.push(box('Wheel stop', [3, 0.45, 0.6], L(-W / 2 + 3 + i * 6, 0, z + (r ? 3.8 : -3.8)), PB.concrete))
      })
      for (let c = 0; c < Math.min(+p.cars, n * rows); c++) {
        const r = c % rows, i = (c * 3 + 1) % n
        parts.push(...at(L, -W / 2 + 3 + i * 6, rowZ[r], r ? 0 : 180, (M) => sedan(M, CAR_PAINTS[c % CAR_PAINTS.length]), 0.1))
      }
      if (p.light === 'yes') parts.push(cyl('Light pole', 0.6, 14, L(W / 2 + 1.5, 0, 0), PB.steel, PB.steel, 8), box('Light arm', [3, 0.3, 0.3], L(W / 2, 13.6, 0), PB.steel), box('Light head', [1.6, 0.5, 1], L(W / 2 - 1.4, 13.2, 0), PB.steel, CY.white))
      return parts
    }),
  },
}

export const BUILDING_PREFABS: Record<string, Def> = { ...HOMES, ...SHOPS, ...CIVIC, ...WORKS, ...LIFE }
