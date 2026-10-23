// Rooms you can walk into, furniture to fill them, and the street, dock,
// rail and site pieces the sample maps were missing. Walls are real solids
// with door gaps (doors 4 wide and 5.6 high; players are about 3.6 tall) and
// floors sit at ground level, so every prefab places like the others.
import { CY, PB, box, cyl, lying, stairs, turn, type Part, type Tex } from './sampleKit'
import { group, local, wheels, type ParamDef, type Params, type PrefabDef } from './prefabs'

type Lf = (dx: number, dy: number, dz: number) => [number, number, number]

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
const BLUE_PLASTIC = solid('#2a6fe0', '#1a4a9a', 411)
const SKIN_GREEN: Tex = { gen: 'grass', tweak: { color: '#2f6e28', accent: '#4c8a2a', scale: 3, wear: 0.2, seed: 412 }, surface: 7 }
const POT: Tex = { gen: 'concrete', tweak: { color: '#9a5a3a', accent: '#6a3a22', wear: 0.3, seed: 413 } }
const SHADE: Tex = solid('#f2e6c8', '#d8c8a0', 414)
const STONE: Tex = { lib: 'medieval_blocks_03', surface: 0 }
const MARBLE: Tex = { lib: 'marble_01', surface: 13 }
const HAZARD: Tex = { gen: 'hazard', tweak: { seed: 415 } }
const RED_LIGHT: Tex = { gen: 'tiles', tweak: { color: '#d02020', accent: '#601010', scale: 1, wear: 0, seed: 416 }, surface: 17 }
const GREEN_LIGHT: Tex = { gen: 'tiles', tweak: { color: '#20c040', accent: '#106020', scale: 1, wear: 0, seed: 417 }, surface: 17 }
const WATER_HULL = solid('#e9ecef', '#2a5d7a', 418)

const WALLS: Record<string, Tex> = { plaster: PB.plaster, brick: PB.brick, concrete: PB.cinder, wood: PB.planks, metal: PB.corrugated, cyber: CY.panel }
const FLOORS: Record<string, Tex> = { wood: FLOOR_WOOD, tiles: PB.tilesWhite, concrete: PB.floorWorn, marble: MARBLE, cyber: CY.fineGrid }
const styleParam = (def: string) => sel('style', 'Walls', [['plaster', 'Plaster'], ['brick', 'Brick'], ['concrete', 'Concrete'], ['wood', 'Wood'], ['metal', 'Metal'], ['cyber', 'Cyber']], def)
const floorParam = (def: string) => sel('floor', 'Floor', [['wood', 'Wood'], ['tiles', 'Tiles'], ['concrete', 'Concrete'], ['marble', 'Marble'], ['cyber', 'Cyber grid']], def)
const wallTex = (p: Params) => WALLS[String(p.style)] ?? PB.plaster
const floorTex = (p: Params) => FLOORS[String(p.floor)] ?? PB.floorWorn
const wallTop = (p: Params) => (p.style === 'cyber' ? CY.panelLight : PB.concrete)

const PRINTS: Record<string, Tex> = {
  red: { gen: 'tiles', tweak: { color: '#c8322b', accent: '#f2c218', scale: 2, wear: 0.15, seed: 420 }, surface: 5 },
  blue: { gen: 'tiles', tweak: { color: '#2a5fc0', accent: '#e8e6e0', scale: 3, wear: 0.15, seed: 421 }, surface: 5 },
  green: { gen: 'tiles', tweak: { color: '#2f8a3a', accent: '#f2f2f2', scale: 2, wear: 0.15, seed: 422 }, surface: 5 },
  pink: { gen: 'tiles', tweak: { color: '#ff3dd8', accent: '#1b1622', scale: 3, wear: 0.05, seed: 423 }, surface: 5 },
  yellow: { gen: 'tiles', tweak: { color: '#f2c218', accent: '#2a2a2e', scale: 2, wear: 0.15, seed: 424 }, surface: 5 },
}
const printParam = (def: string) => sel('color', 'Print', [['red', 'Red'], ['blue', 'Blue'], ['green', 'Green'], ['pink', 'Pink'], ['yellow', 'Yellow']], def)
const COLORS: Record<string, Tex> = { grey: PB.steel, blue: PB.boxBlue, red: PB.boxRed, green: PB.boxGreen, yellow: PB.yellow }
const colorParam = (def: string) => sel('color', 'Color', [['grey', 'Grey'], ['blue', 'Blue'], ['red', 'Red'], ['green', 'Green'], ['yellow', 'Yellow']], def)

// ---------------- walls with openings ----------------

interface Gap { at: number; w: number; h: number; sill?: number }
const DOOR = (at: number, w = 4, h = 5.6): Gap => ({ at, w, h })
const WIN = (at: number, w = 3, h = 2.6, sill = 2.4): Gap => ({ at, w, h, sill })

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
function windowsAlong(a: number, b: number, doors: Gap[], every = 6.5): Gap[] {
  const n = Math.floor((b - a - 2) / every)
  const out: Gap[] = []
  for (let i = 0; i < n; i++) {
    const pos = a + ((b - a) * (i + 0.5)) / n
    if (doors.every((d) => Math.abs(d.at - pos) > d.w / 2 + 2)) out.push(WIN(+pos.toFixed(2)))
  }
  return out
}

interface ShellOptions {
  w: number; d: number; h: number; t?: number
  side: Tex; top?: Tex
  floor?: Tex | null; roof?: Tex | null
  front?: Gap[]; back?: Gap[]; left?: Gap[]; right?: Gap[]
  windows?: boolean
  y?: number
}

/** Four walls (front is +Z), an optional floor at ground level and an optional flat roof. */
function shell(L: Lf, s: ShellOptions): Part[] {
  const t = s.t ?? 0.5, top = s.top ?? PB.concrete, y = s.y ?? 0
  const hw = s.w / 2, hd = s.d / 2
  const win = (a: number, b: number, g: Gap[] = []) => (s.windows ? [...g, ...windowsAlong(a, b, g)] : g)
  const parts = [
    ...wall(L, 'x', -hw, hw, hd - t / 2, s.h, t, s.side, top, win(-hw, hw, s.front), y, 'Front wall'),
    ...wall(L, 'x', -hw, hw, -hd + t / 2, s.h, t, s.side, top, win(-hw, hw, s.back), y, 'Back wall'),
    ...wall(L, 'z', -hd + t, hd - t, -hw + t / 2, s.h, t, s.side, top, win(-hd + t, hd - t, s.left), y, 'Side wall'),
    ...wall(L, 'z', -hd + t, hd - t, hw - t / 2, s.h, t, s.side, top, win(-hd + t, hd - t, s.right), y, 'Side wall'),
  ]
  if (s.floor) parts.push(box('Floor', [s.w - 2 * t, 0.15, s.d - 2 * t], L(0, y, 0), s.floor, s.floor, 0, 4))
  if (s.roof) parts.push(box('Roof', [s.w + 0.4, 0.4, s.d + 0.4], L(0, y + s.h, 0), s.roof, top))
  return parts
}

const FL = 0.15 // furniture stands on the 0.15-thick floor

/** Front doors from a setting: none, centre, left, right, two or a wide opening. */
function frontDoors(kind: string, w: number): Gap[] {
  switch (kind) {
    case 'none': return []
    case 'left': return [DOOR(-w / 4)]
    case 'right': return [DOOR(w / 4)]
    case 'two': return [DOOR(-w / 4), DOOR(w / 4)]
    case 'wide': return [DOOR(0, Math.min(10, w - 3), 6.5)]
    default: return [DOOR(0)]
  }
}
const doorParam = (key: string, label: string, def: string, wide = true) =>
  sel(key, label, [['none', 'None'], ['center', 'Middle'], ['left', 'Left'], ['right', 'Right'], ['two', 'Two'], ...(wide ? [['wide', 'Wide opening'] as [string, string]] : [])], def)

// ---------------- furniture (each in its own frame, base at y 0, facing +Z) ----------------

const legs = (L: Lf, w: number, d: number, h: number, tex: Tex, s = 0.25) =>
  [[-w / 2 + s, -d / 2 + s], [w / 2 - s, -d / 2 + s], [-w / 2 + s, d / 2 - s], [w / 2 - s, d / 2 - s]].map(([a, b]) => box('Leg', [s, h, s], L(a, 0, b), tex))

const table = (L: Lf, w = 5, d = 3, tex: Tex = DARK_WOOD): Part[] => [
  { ...box('Table top', [w, 0.25, d], L(0, 1.3, 0), tex), bevel: 0.08 }, ...legs(L, w, d, 1.3, tex),
]
const chair = (L: Lf, tex: Tex = DARK_WOOD): Part[] => [
  box('Seat', [1.6, 0.2, 1.6], L(0, 0.9, 0), tex), box('Chair back', [1.6, 1.6, 0.2], L(0, 1.1, -0.7), tex), ...legs(L, 1.6, 1.6, 0.9, tex, 0.15),
]
const officeChair = (L: Lf): Part[] => [
  cyl('Chair base', 1.4, 0.2, L(0, 0, 0), BLACK, BLACK, 5), cyl('Chair post', 0.25, 0.8, L(0, 0.2, 0), PB.steel, PB.steel, 8),
  { ...box('Seat', [1.7, 0.3, 1.6], L(0, 1, 0), LEATHER), bevel: 0.1 }, { ...box('Chair back', [1.6, 1.8, 0.3], L(0, 1.3, -0.75), LEATHER), bevel: 0.12 },
]
const couch = (L: Lf, w = 6, tex: Tex = FABRIC): Part[] => [
  { ...box('Couch base', [w, 1, 2.4], L(0, 0, 0), tex), bevel: 0.2 },
  { ...box('Couch back', [w, 1.5, 0.7], L(0, 1, -0.85), tex), bevel: 0.25 },
  ...[-1, 1].map((sx) => ({ ...box('Couch arm', [0.6, 1.6, 2.4], L(sx * (w / 2 - 0.3), 0, 0), tex), bevel: 0.2 })),
]
const bed = (L: Lf): Part[] => [
  box('Bed frame', [4.2, 0.8, 6.6], L(0, 0, 0), DARK_WOOD), { ...box('Mattress', [4, 0.6, 6.2], L(0, 0.8, 0.1), LINEN), bevel: 0.2 },
  { ...box('Pillow', [3, 0.35, 1], L(0, 1.4, -2.4), WHITE), bevel: 0.15 }, { ...box('Blanket', [4.1, 0.15, 3.6], L(0, 1.4, 1.2), FABRIC), bevel: 0.05 },
  box('Headboard', [4.2, 2.6, 0.3], L(0, 0, -3.3), DARK_WOOD),
]
const desk = (L: Lf): Part[] => [
  box('Desk top', [5, 0.2, 2.4], L(0, 1.4, 0), LIGHT_WOOD), ...[-1, 1].map((sx) => box('Desk side', [0.2, 1.4, 2.4], L(sx * 2.4, 0, 0), LIGHT_WOOD)),
  box('Monitor', [2, 1.2, 0.15], L(0, 2.1, -0.7), BLACK, SCREEN), box('Monitor stand', [0.3, 0.5, 0.3], L(0, 1.6, -0.75), BLACK),
  box('Keyboard', [1.6, 0.06, 0.5], L(0, 1.6, 0.3), BLACK), ...at(L, 0, 1.9, 180, officeChair),
]
const bookshelf = (L: Lf, w = 4): Part[] => {
  const books = [PB.red, PB.blue, PB.green, PB.yellow, PB.orange, DARK_WOOD]
  return [
    box('Shelf back', [w, 6, 0.15], L(0, 0, -0.6), DARK_WOOD), ...[-1, 1].map((sx) => box('Shelf side', [0.2, 6, 1.4], L(sx * (w / 2 - 0.1), 0, 0), DARK_WOOD)),
    ...[0, 1.5, 3, 4.5, 5.85].map((y) => box('Shelf', [w, 0.15, 1.4], L(0, y, 0), DARK_WOOD)),
    ...[0.15, 1.65, 3.15, 4.65].flatMap((y, i) => [0, 1, 2].map((k) => box('Books', [w / 3 - 0.4, 1.1 - (k % 2) * 0.2, 1], L((k - 1) * (w / 3), y, 0), books[(i + k) % books.length]))),
  ]
}
const storeShelf = (L: Lf, len = 8): Part[] => {
  const goods = [PB.red, PB.blue, PB.yellow, PB.green, PB.orange, WHITE]
  return [
    box('Shelf base', [len, 0.4, 2.4], L(0, 0, 0), PB.steel), box('Shelf divider', [len, 4.4, 0.2], L(0, 0.4, 0), PB.steel),
    ...[1.4, 2.6, 3.8].flatMap((y) => [-0.65, 0.65].map((z) => box('Shelf', [len, 0.12, 1.1], L(0, y, z), PB.steel))),
    ...[0.4, 1.52, 2.72, 3.92].flatMap((y, i) => [-0.65, 0.65].flatMap((z, j) => [...Array(Math.max(1, Math.floor(len / 2)))].map((_, k) =>
      box('Goods', [1.6, 0.8 - ((i + k) % 2) * 0.2, 0.8], L(-len / 2 + 1 + k * 2, y, z), goods[(i + j + k) % goods.length])))),
  ]
}
const fridge = (L: Lf): Part[] => [
  { ...box('Fridge', [2.4, 4.4, 2.2], L(0, 0, 0), WHITE), bevel: 0.1 }, box('Fridge door line', [2.42, 0.06, 2.22], L(0, 2.9, 0), BLACK),
  box('Handle', [0.12, 1.4, 0.15], L(0.9, 1.2, 1.15), PB.steel), box('Handle', [0.12, 0.8, 0.15], L(0.9, 3.2, 1.15), PB.steel),
]
const cooler = (L: Lf): Part[] => [
  box('Cooler', [3, 5, 2.2], L(0, 0, 0), WHITE, PB.steel), box('Cooler glass', [2.6, 3.8, 0.1], L(0, 0.7, 1.1), GLASS),
  ...[1.6, 2.9].map((y) => box('Drinks', [2.4, 0.9, 0.9], L(0, y, 0.4), PRINTS.red)), box('Cooler sign', [3, 0.5, 0.15], L(0, 4.5, 1.1), PRINTS.blue),
]
const shopCounter = (L: Lf, len = 7): Part[] => [
  { ...box('Counter', [len, 2.1, 2], L(0, 0, 0), MARBLE, LIGHT_WOOD), bevel: 0.08 },
  box('Register', [1.3, 0.6, 1], L(len / 2 - 1.2, 2.1, 0), BLACK), box('Register screen', [0.9, 0.6, 0.12], L(len / 2 - 1.2, 2.7, -0.3), BLACK, SCREEN),
]
const stool = (L: Lf): Part[] => [
  cyl('Stool base', 1, 0.1, L(0, 0, 0), PB.steel, PB.steel, 10), cyl('Stool post', 0.25, 1.8, L(0, 0.1, 0), PB.steel, PB.steel, 8), cyl('Stool seat', 1.2, 0.25, L(0, 1.9, 0), LEATHER, LEATHER, 12),
]
const poolTable = (L: Lf): Part[] => [
  { ...box('Pool table', [4.4, 1.5, 8], L(0, 0.2, 0), DARK_WOOD), bevel: 0.15 }, box('Felt', [3.8, 0.12, 7.4], L(0, 1.7, 0), FELT),
  ...[-1, 1].map((sx) => box('Rail', [0.3, 0.3, 8], L(sx * 2.05, 1.7, 0), DARK_WOOD)), ...[-1, 1].map((sz) => box('Rail', [4.4, 0.3, 0.3], L(0, 1.7, sz * 3.85), DARK_WOOD)),
  ...legs(L, 4, 7.4, 0.2, DARK_WOOD, 0.6),
]
const arcade = (L: Lf, tex: Tex = PB.black): Part[] => [
  { ...box('Arcade cabinet', [2.2, 4.2, 2], L(0, 0, 0), BLACK, tex), bevel: 0.08 },
  box('Arcade screen', [1.7, 1.4, 0.1], L(0, 2.3, 1.0), SCREEN), box('Controls', [2.2, 0.35, 0.9], L(0, 1.8, 1.3), BLACK),
  box('Marquee', [2.2, 0.6, 0.3], L(0, 4.2, 0.85), CY.pink),
]
const jukebox = (L: Lf): Part[] => [
  { ...box('Jukebox', [2.6, 2.6, 1.4], L(0, 0, 0), DARK_WOOD), bevel: 0.15 }, lying('Jukebox top', 2.6, 1.4, L(0, 1.3, 0), CY.orange, DARK_WOOD, 16, 90),
  box('Jukebox glow', [2, 0.3, 0.1], L(0, 1.8, 0.7), CY.pink), box('Jukebox panel', [1.6, 0.9, 0.1], L(0, 0.6, 0.7), CY.orange),
]
const tvStand = (L: Lf): Part[] => [
  box('TV stand', [5, 1.4, 1.6], L(0, 0, 0), DARK_WOOD), box('TV', [4.4, 2.6, 0.25], L(0, 1.6, -0.2), BLACK, SCREEN), box('TV foot', [1, 0.2, 0.8], L(0, 1.4, -0.2), BLACK),
]
const lockers = (L: Lf, n = 5, tex: Tex = PB.boxBlue): Part[] => [...Array(n)].flatMap((_, i) => {
  const x = (i - (n - 1) / 2) * 1.5
  return [{ ...box('Locker', [1.4, 4.6, 1.6], L(x, 0, 0), PB.steel, tex), bevel: 0.04 }, box('Locker vent', [0.8, 0.4, 0.05], L(x, 3.8, 0.8), BLACK), box('Locker handle', [0.1, 0.5, 0.1], L(x + 0.45, 2.2, 0.82), PB.steel)]
})
const kitchen = (L: Lf, len = 10): Part[] => [
  box('Cabinets', [len, 1.8, 2], L(0, 0, 0), LIGHT_WOOD), box('Countertop', [len + 0.2, 0.15, 2.2], L(0, 1.8, 0.05), MARBLE),
  box('Sink', [2, 0.06, 1.3], L(-len / 4, 1.95, 0.1), PB.steel), cyl('Tap', 0.2, 0.8, L(-len / 4, 1.95, -0.7), PB.steel, PB.steel, 8),
  box('Stove', [2.2, 0.08, 1.7], L(len / 4, 1.95, 0.1), BLACK), box('Upper cabinets', [len, 1.8, 1], L(0, 3.6, -0.5), LIGHT_WOOD),
]
const toiletStall = (L: Lf): Part[] => [
  ...[-1, 1].map((sx) => box('Stall wall', [0.15, 4, 3.6], L(sx * 1.6, 0.3, 0), PB.steel)), box('Stall back', [3.35, 4.3, 0.15], L(0, 0, -1.8), PB.tilesWhite),
  box('Stall door', [1.6, 3.6, 0.1], L(-0.8, 0.5, 1.8), PB.steel),
  cyl('Toilet bowl', 1.1, 0.9, L(0, 0, -0.6), WHITE, WHITE, 12), box('Toilet tank', [1.2, 1.2, 0.5], L(0, 0.8, -1.4), WHITE),
]
const pottedPlant = (L: Lf, s = 1): Part[] => [
  { ...cyl('Pot', 1.4 * s, 1.3 * s, L(0, 0, 0), PB.dirt, POT, 12), taper: 1.25 },
  cyl('Plant stem', 0.2 * s, 1.2 * s, L(0, 1.3 * s, 0), PB.wood, PB.wood, 6),
  { ...cyl('Leaves', 2.4 * s, 2.4 * s, L(0, 2.1 * s, 0), SKIN_GREEN, SKIN_GREEN, 9), taper: 0.35 },
]
const floorLamp = (L: Lf): Part[] => [
  cyl('Lamp base', 1, 0.15, L(0, 0, 0), BLACK, BLACK, 12), cyl('Lamp pole', 0.15, 3.4, L(0, 0.15, 0), PB.steel, PB.steel, 8),
  { ...cyl('Lamp shade', 1.5, 1, L(0, 3.3, 0), SHADE, SHADE, 14), taper: 0.6 },
]
const crate = (L: Lf, s = 2.4): Part[] => [{ ...box('Crate', [s, s, s], L(0, 0, 0), PB.planks, PB.planks), bevel: 0.08 }]
const pew = (L: Lf, len = 8): Part[] => [
  box('Pew seat', [len, 0.3, 1.4], L(0, 1, 0), DARK_WOOD), box('Pew back', [len, 1.8, 0.25], L(0, 1, -0.6), DARK_WOOD),
  ...[-1, 1].map((sx) => box('Pew end', [0.25, 2.6, 1.6], L(sx * (len / 2), 0, 0), DARK_WOOD)),
]

// ---------------- rooms and buildings you can walk into ----------------

/**
 * Two storeys with stairs up the left wall, an upper floor with a railed stair
 * opening, and an optional flat roof with a parapet.
 */
function twoStorey(L: Lf, o: { w: number; d: number; side: Tex; top: Tex; floor: Tex; front: Gap[]; upper: 'none' | 'back' | 'right'; roof: boolean; windows: boolean }): Part[] {
  const t = 0.5, H = 7, hw = o.w / 2, hd = o.d / 2
  const z0 = -hd + t, z1 = hd - t, xL = -hw + t, sw = 3.5
  const parts: Part[] = [
    ...shell(L, { w: o.w, d: o.d, h: H, side: o.side, top: o.top, floor: o.floor, front: o.front, windows: o.windows }),
    ...shell(L, { w: o.w, d: o.d, h: H, side: o.side, top: o.top, y: H, windows: o.windows,
      back: o.upper === 'back' ? [DOOR(o.w / 4)] : [], right: o.upper === 'right' ? [DOOR(0)] : [] }),
    // Stairs up the left wall, rising toward the back; a 2-unit landing at the top.
    stairs('Stairs', [sw, H, 10], L(xL + sw / 2, 0, z0 + 7), PB.concrete, PB.darkConcrete, 0, 10),
    // Upper floor around the stair opening.
    box('Upper floor', [o.w - 2 * t - sw, 0.3, o.d - 2 * t], L(xL + sw + (o.w - 2 * t - sw) / 2, H - 0.3, 0), o.floor, PB.concrete),
    box('Landing', [sw, 0.3, 2], L(xL + sw / 2, H - 0.3, z0 + 1), o.floor, PB.concrete),
    box('Railing', [0.15, 1.1, 10], L(xL + sw + 0.08, H, z0 + 7), PB.steel),
  ]
  if (z1 - (z0 + 12) > 0.3) parts.push(box('Upper floor', [sw, 0.3, z1 - (z0 + 12)], L(xL + sw / 2, H - 0.3, (z1 + z0 + 12) / 2), o.floor, PB.concrete),
    box('Railing', [sw, 1.1, 0.15], L(xL + sw / 2, H, z0 + 12.08), PB.steel))
  if (o.roof) {
    parts.push(box('Roof', [o.w + 0.4, 0.4, o.d + 0.4], L(0, 2 * H, 0), PB.concrete, o.top))
    parts.push(...[-1, 1].map((s) => box('Parapet', [o.w + 0.4, 1, 0.4], L(0, 2 * H + 0.4, s * (hd)), o.top, o.side)),
      ...[-1, 1].map((s) => box('Parapet', [0.4, 1, o.d - 0.4], L(s * hw, 2 * H + 0.4, 0), o.top, o.side)))
  }
  return parts
}

const ROOMS: Record<string, PrefabDef & { category: string }> = {
  room: {
    category: 'Rooms', label: 'Room', hint: 'A room you can walk into: pick its size, doors, windows and roof',
    ...pfp('Room', [num('w', 'Width', 8, 60, 16), num('d', 'Depth', 8, 60, 14), num('h', 'Height', 6, 16, 7), doorParam('front', 'Front door', 'center'),
      doorParam('back', 'Back door', 'none', false), sel('sides', 'Side doors', [['none', 'None'], ['left', 'Left'], ['right', 'Right'], ['both', 'Both']], 'none'),
      yesNo('windows', 'Windows', 'yes'), yesNo('roof', 'Roof', 'yes'), styleParam('plaster'), floorParam('wood')],
    (L, p) => {
      const w = +p.w, d = +p.d
      const side = (s: string) => (p.sides === s || p.sides === 'both' ? [DOOR(0)] : [])
      return shell(L, { w, d, h: +p.h, side: wallTex(p), top: wallTop(p), floor: floorTex(p), roof: p.roof === 'yes' ? PB.concrete : null,
        front: frontDoors(String(p.front), w), back: frontDoors(String(p.back), w), left: side('left'), right: side('right'), windows: p.windows === 'yes' })
    }),
  },
  corridor: {
    category: 'Rooms', label: 'Corridor', hint: 'A hallway, open at both ends',
    ...pfp('Corridor', [num('len', 'Length', 8, 60, 24), num('width', 'Width', 5, 12, 6), sel('sides', 'Side doors', [['none', 'None'], ['left', 'Left'], ['right', 'Right'], ['both', 'Both']], 'none'),
      yesNo('roof', 'Roof', 'yes'), styleParam('concrete'), floorParam('tiles')],
    (L, p) => {
      const len = +p.len, w = +p.width, t = 0.5, door = (s: string) => (p.sides === s || p.sides === 'both' ? [DOOR(0)] : [])
      const parts = [
        ...wall(L, 'z', -len / 2, len / 2, -w / 2 + t / 2, 7, t, wallTex(p), wallTop(p), door('left'), 0, 'Corridor wall'),
        ...wall(L, 'z', -len / 2, len / 2, w / 2 - t / 2, 7, t, wallTex(p), wallTop(p), door('right'), 0, 'Corridor wall'),
        box('Floor', [w - 2 * t, 0.15, len], L(0, 0, 0), floorTex(p)),
      ]
      if (p.roof === 'yes') parts.push(box('Ceiling', [w, 0.4, len], L(0, 7, 0), PB.concrete, wallTop(p)))
      return parts
    }),
  },
  stairwell: {
    category: 'Rooms', label: 'Stairwell', hint: 'A stair tower up to a second floor with a door out at the top',
    ...pfp('Stairwell', [sel('upper', 'Upper door', [['right', 'Side'], ['back', 'Back'], ['none', 'None']], 'right'), yesNo('roof', 'Roof', 'yes'), styleParam('concrete')],
      (L, p) => twoStorey(L, { w: 10, d: 14, side: wallTex(p), top: wallTop(p), floor: PB.floorWorn, front: [DOOR(1.8, 3.6)], upper: p.upper as 'none', roof: p.roof === 'yes', windows: false })),
  },
  twostory: {
    category: 'Rooms', label: 'Two-storey building', hint: 'A hollow two-floor building with stairs inside, windows and a rooftop',
    ...pfp('Two-storey', [num('w', 'Width', 14, 40, 20), num('d', 'Depth', 14, 30, 16), doorParam('front', 'Front door', 'center', false),
      sel('upper', 'Upper door', [['none', 'None'], ['back', 'Back'], ['right', 'Side']], 'none'), yesNo('windows', 'Windows', 'yes'), yesNo('roof', 'Roof', 'yes'), styleParam('brick'), floorParam('wood')],
    (L, p) => twoStorey(L, { w: +p.w, d: +p.d, side: wallTex(p), top: wallTop(p), floor: floorTex(p), front: frontDoors(String(p.front), +p.w), upper: p.upper as 'none', roof: p.roof === 'yes', windows: p.windows === 'yes' })),
  },
  shopint: {
    category: 'Rooms', label: 'Corner shop', hint: 'A shop to walk into: counter and till, aisles, drinks coolers',
    ...pfp('Corner shop', [yesNo('roof', 'Roof', 'yes'), styleParam('brick')], (L, p) => [
      ...shell(L, { w: 20, d: 16, h: 7, side: wallTex(p), top: wallTop(p), floor: PB.tilesWhite, roof: p.roof === 'yes' ? PB.concrete : null, front: [DOOR(0)], windows: true }),
      ...[-7.5, -4.5, -1.5, 1.5, 4.5].flatMap((x) => at(L, x, -6.3, 0, cooler, FL)),
      ...at(L, -5.5, 0.5, 90, (M) => storeShelf(M, 8), FL), ...at(L, -0.5, 0.5, 90, (M) => storeShelf(M, 8), FL),
      ...at(L, 6.5, 3, 270, (M) => shopCounter(M, 6), FL), ...at(L, 8.3, -6.4, 0, fridge, FL),
    ]),
  },
  barint: {
    category: 'Rooms', label: 'Bar', hint: 'A bar to fight through: bar counter and stools, pool table, booths and a jukebox',
    ...pfp('Bar', [yesNo('roof', 'Roof', 'yes'), styleParam('brick')], (L, p) => [
      ...shell(L, { w: 24, d: 18, h: 7, side: wallTex(p), top: wallTop(p), floor: FLOOR_WOOD, roof: p.roof === 'yes' ? PB.concrete : null, front: [DOOR(-5)], right: [DOOR(-3)], windows: true }),
      { ...box('Bar counter', [12, 2.2, 2], L(-2, FL, -5.2), DARK_WOOD), bevel: 0.1 }, box('Bar top', [12.3, 0.15, 2.3], L(-2, FL + 2.2, -5.2), MARBLE),
      box('Bottle shelf', [12, 3, 0.8], L(-2, FL + 1.5, -8.1), DARK_WOOD, PRINTS.green), box('Neon strip', [10, 0.25, 0.15], L(-2, 5.5, -8.6), CY.pink),
      ...[-6.5, -4, -1.5, 1, 3.5].flatMap((x) => at(L, x, -3.2, 0, stool, FL)),
      ...at(L, -6, 4, 90, poolTable, FL), ...at(L, 10.6, -7.6, 0, jukebox, FL),
      ...at(L, 9.7, 1, 270, (M) => couch(M, 5, LEATHER), FL), ...at(L, 9.7, 6.5, 270, (M) => couch(M, 5, LEATHER), FL), ...at(L, 6.8, 3.8, 0, (M) => table(M, 2.6, 4), FL),
    ]),
  },
  officeint: {
    category: 'Rooms', label: 'Office', hint: 'An office floor with desks and computers, shelves and plants',
    ...pfp('Office', [yesNo('roof', 'Roof', 'yes'), styleParam('plaster')], (L, p) => [
      ...shell(L, { w: 22, d: 16, h: 7, side: wallTex(p), top: wallTop(p), floor: PB.floorWorn, roof: p.roof === 'yes' ? PB.concrete : null, front: [DOOR(-6)], windows: true }),
      ...[[-4, -3], [4, -3], [-4, 2.5], [4, 2.5]].flatMap(([x, z]) => at(L, x, z, 0, desk, FL)),
      ...at(L, -7, -6.9, 0, bookshelf, FL), ...at(L, 0, -6.9, 0, bookshelf, FL), ...at(L, 9.3, -6.6, 0, (M) => pottedPlant(M), FL), ...at(L, 9.3, 6.5, 0, (M) => pottedPlant(M), FL),
    ]),
  },
  apartmentint: {
    category: 'Rooms', label: 'Apartment', hint: 'A lived-in flat: bed, sofa and TV, kitchen, dining table',
    ...pfp('Apartment', [yesNo('roof', 'Roof', 'yes'), styleParam('plaster')], (L, p) => [
      ...shell(L, { w: 20, d: 16, h: 7, side: wallTex(p), top: wallTop(p), floor: FLOOR_WOOD, roof: p.roof === 'yes' ? PB.concrete : null, front: [DOOR(-6.5)], windows: true }),
      ...at(L, -6.4, -4.2, 0, bed, FL), ...at(L, 3.5, 3.6, 180, couch, FL), ...at(L, 3.5, -1.4, 0, tvStand, FL),
      ...at(L, 8.6, -1, 270, (M) => kitchen(M, 9), FL), ...at(L, -5, 3.5, 0, (M) => [...table(M, 4, 2.6), ...at(M, -1, 2, 180, chair), ...at(M, 1, 2, 180, chair), ...at(M, -1, -2, 0, chair), ...at(M, 1, -2, 0, chair)], FL),
      ...at(L, 0, -6.8, 0, floorLamp, FL),
    ]),
  },
  garagebay: {
    category: 'Rooms', label: 'Garage bay', hint: 'A workshop bay with a wide door, workbench, tool chests and tyres',
    ...pfp('Garage bay', [yesNo('roof', 'Roof', 'yes'), styleParam('concrete')], (L, p) => [
      ...shell(L, { w: 16, d: 20, h: 8, side: wallTex(p), top: wallTop(p), floor: PB.floorWorn, roof: p.roof === 'yes' ? PB.corrugated : null, front: [DOOR(0, 10, 6.8)], left: [DOOR(-5)] }),
      ...at(L, 0, -8.6, 0, (M) => [...table(M, 8, 2, PB.steel), box('Toolboard', [8, 3, 0.15], M(0, 2.5, -0.95), PB.plywood), box('Tools', [1.2, 0.5, 0.8], M(-2, 1.55, 0), PB.red), box('Tools', [1.6, 0.4, 0.8], M(2, 1.55, 0.2), PB.yellow)], FL),
      ...at(L, 6.6, -4, 270, (M) => lockers(M, 3, PB.boxRed), FL),
      ...[0, 1, 2].map((k) => cyl('Tire', 1.6, 0.6, L(-6.5, FL + k * 0.6, 3), PB.tire, PB.tire, 14)),
      ...[-1, 1].map((sx) => box('Lift post', [0.6, 6, 0.6], L(sx * 3.4, FL, -2), PB.yellow)),
    ]),
  },
  warehouseint: {
    category: 'Rooms', label: 'Warehouse interior', hint: 'A big hall with loading doors, pallet racks and a mezzanine with stairs',
    ...pfp('Warehouse interior', [yesNo('roof', 'Roof', 'yes'), styleParam('metal')], (L, p) => {
      const W = 40, D = 30
      const high = [-14, -6, 6, 14].map((x) => WIN(x, 4, 2, 8.5))
      const parts = [
        ...shell(L, { w: W, d: D, h: 12, side: wallTex(p), top: wallTop(p), floor: PB.floorWorn, roof: p.roof === 'yes' ? PB.corrugated : null,
          front: [DOOR(-10, 8, 8), DOOR(10, 8, 8)], back: high, left: [DOOR(4)], right: [DOOR(8)] }),
        // Mezzanine along the back wall, with a railing, posts and stairs up from the right.
        box('Mezzanine', [W - 1, 0.4, 8], L(0, 6, -10.5), PB.diamond, PB.steel),
        box('Railing', [W - 7, 1.1, 0.15], L(-3, 6.4, -6.55), PB.yellow),
        ...[-15, -5, 5, 15].map((x) => box('Mezzanine post', [0.5, 6, 0.5], L(x, 0, -6.8), PB.steel)),
        stairs('Stairs', [3.5, 6.4, 9], L(17, 0, -2), PB.diamond, PB.steel, 0, 9),
      ]
      // Pallet racks down the left side.
      for (const z of [-2, 6]) {
        parts.push(...[-1, 1].flatMap((s) => [box('Rack post', [0.3, 7, 0.3], L(-18.5, FL, z + s * 3), PB.boxBlue), box('Rack post', [0.3, 7, 0.3], L(-16.3, FL, z + s * 3), PB.boxBlue)]))
        for (const y of [2.5, 5]) parts.push(box('Rack beam', [2.6, 0.25, 6.3], L(-17.4, FL + y, z), PB.orange))
        for (const y of [0, 2.75, 5.25]) parts.push(box('Pallet load', [2.2, 1.8, 2.4], L(-17.4, FL + y, z - 1.4), PB.plywood), box('Pallet load', [2.2, 1.6, 2.4], L(-17.4, FL + y, z + 1.4), PB.boxGreen))
      }
      return parts
    }),
  },
  classroom: {
    category: 'Rooms', label: 'Classroom', hint: 'Rows of desks, a teacher’s desk and a chalkboard',
    ...pfp('Classroom', [yesNo('roof', 'Roof', 'yes'), styleParam('plaster')], (L, p) => [
      ...shell(L, { w: 22, d: 18, h: 7, side: wallTex(p), top: wallTop(p), floor: PB.tilesWhite, roof: p.roof === 'yes' ? PB.concrete : null, front: [DOOR(7.5)], windows: true }),
      box('Chalkboard', [10, 3.4, 0.15], L(0, 2.2, -8.6), CHALK, DARK_WOOD),
      ...at(L, 0, -5.6, 0, (M) => table(M, 5, 2.4, LIGHT_WOOD), FL), ...at(L, 0, -7.2, 180, chair, FL),
      ...[-6, -2, 2, 6].flatMap((x) => [-1.5, 2, 5.5].flatMap((z) => [...at(L, x, z, 0, (M) => table(M, 2.6, 1.8, LIGHT_WOOD), FL), ...at(L, x, z + 1.6, 180, chair, FL)])),
      ...at(L, -9.8, 4, 90, (M) => lockers(M, 4), FL),
    ]),
  },
}

// ---------------- furniture prefabs ----------------

const FURNITURE: Record<string, PrefabDef & { category: string }> = {
  diningset: { category: 'Furniture', label: 'Dining set', hint: 'A table with four chairs', make: pf('Dining set', (L) => [...table(L), ...at(L, -1.2, 2.1, 180, chair), ...at(L, 1.2, 2.1, 180, chair), ...at(L, -1.2, -2.1, 0, chair), ...at(L, 1.2, -2.1, 0, chair)]) },
  chair: { category: 'Furniture', label: 'Chair', hint: 'A wooden chair', make: pf('Chair', (L) => chair(L)) },
  couch: { category: 'Furniture', label: 'Couch', hint: 'A sofa; pick its length and cover', ...pfp('Couch', [num('len', 'Length', 3, 10, 6, 0.5), sel('cover', 'Cover', [['fabric', 'Fabric'], ['leather', 'Leather']], 'fabric')], (L, p) => couch(L, +p.len, p.cover === 'leather' ? LEATHER : FABRIC)) },
  bed: { category: 'Furniture', label: 'Bed', hint: 'A double bed with a headboard', make: pf('Bed', bed) },
  desk: { category: 'Furniture', label: 'Desk', hint: 'A desk with a computer and an office chair', make: pf('Desk', desk) },
  bookshelf: { category: 'Furniture', label: 'Bookshelf', hint: 'A tall bookcase full of books', ...pfp('Bookshelf', [num('w', 'Width', 2, 10, 4, 0.5)], (L, p) => bookshelf(L, +p.w)) },
  storeshelf: { category: 'Furniture', label: 'Store shelves', hint: 'A double-sided supermarket aisle', ...pfp('Store shelves', [num('len', 'Length', 4, 24, 8, 2)], (L, p) => storeShelf(L, +p.len)) },
  fridge: { category: 'Furniture', label: 'Fridge', hint: 'A kitchen fridge-freezer', make: pf('Fridge', fridge) },
  coolers: { category: 'Furniture', label: 'Drinks coolers', hint: 'A row of glass-door drinks fridges', ...pfp('Drinks coolers', [num('n', 'Coolers', 1, 8, 3)], (L, p) => [...Array(+p.n)].flatMap((_, i) => at(L, (i - (+p.n - 1) / 2) * 3, 0, 0, cooler))) },
  shopcounter: { category: 'Furniture', label: 'Shop counter', hint: 'A counter with a cash register', ...pfp('Shop counter', [num('len', 'Length', 4, 14, 7)], (L, p) => shopCounter(L, +p.len)) },
  barstools: { category: 'Furniture', label: 'Bar stools', hint: 'A row of bar stools', ...pfp('Bar stools', [num('n', 'Stools', 1, 10, 4)], (L, p) => [...Array(+p.n)].flatMap((_, i) => at(L, (i - (+p.n - 1) / 2) * 2.4, 0, 0, stool))) },
  pooltable: { category: 'Furniture', label: 'Pool table', hint: 'A pool table', make: pf('Pool table', poolTable) },
  arcade: { category: 'Furniture', label: 'Arcade machines', hint: 'A row of arcade cabinets', ...pfp('Arcade', [num('n', 'Machines', 1, 6, 3)], (L, p) => [...Array(+p.n)].flatMap((_, i) => at(L, (i - (+p.n - 1) / 2) * 2.6, 0, 0, (M) => arcade(M, [PB.red, PB.blue, PB.green, PB.orange, PB.yellow, PB.black][i % 6])))) },
  jukebox: { category: 'Furniture', label: 'Jukebox', hint: 'A glowing jukebox', make: pf('Jukebox', jukebox) },
  tvstand: { category: 'Furniture', label: 'TV', hint: 'A big TV on a stand', make: pf('TV', tvStand) },
  lockers: { category: 'Furniture', label: 'Lockers', hint: 'A row of metal lockers', ...pfp('Lockers', [num('n', 'Lockers', 1, 12, 5), colorParam('blue')], (L, p) => lockers(L, +p.n, COLORS[String(p.color)] ?? PB.boxBlue)) },
  kitchen: { category: 'Furniture', label: 'Kitchen', hint: 'Cabinets, worktop, sink, stove and wall cupboards', ...pfp('Kitchen', [num('len', 'Length', 6, 16, 10)], (L, p) => kitchen(L, +p.len)) },
  toiletstall: { category: 'Furniture', label: 'Toilet stall', hint: 'A toilet in its stall', make: pf('Toilet stall', toiletStall) },
  pottedplant: { category: 'Furniture', label: 'Potted plant', hint: 'A plant in a clay pot', ...pfp('Potted plant', [num('size', 'Size', 0.5, 2.5, 1, 0.1)], (L, p) => pottedPlant(L, +p.size)) },
  floorlamp: { category: 'Furniture', label: 'Floor lamp', hint: 'A standing lamp with a shade', make: pf('Floor lamp', floorLamp) },
  cratestack: { category: 'Furniture', label: 'Crate stack', hint: 'Wooden crates, stacked', ...pfp('Crates', [num('n', 'Crates', 1, 6, 4)], (L, p) => {
    const spots: [number, number, number][] = [[-1.3, 0, 0], [1.3, 0, 0.2], [0, 0, -2.5], [0, 2.4, 0], [-1.3, 2.4, -2.4], [0.1, 4.8, -0.1]]
    return spots.slice(0, +p.n).flatMap(([x, y, z], i) => at(L, x, z, (i * 17) % 30 - 10, crate, y))
  }) },
  poster: { category: 'Furniture', label: 'Wall poster', hint: 'A poster to hang on a wall (it floats until you put it against one)', ...pfp('Poster', [printParam('red'), num('w', 'Width', 1, 8, 3, 0.5), num('h', 'Height', 1, 8, 4, 0.5)], (L, p) => [box('Poster', [+p.w, +p.h, 0.08], L(0, 2, 0), PRINTS[String(p.color)] ?? PRINTS.red, WHITE)]) },
  pews: { category: 'Furniture', label: 'Church pews', hint: 'Rows of wooden pews', ...pfp('Pews', [num('rows', 'Rows', 1, 10, 4), num('len', 'Length', 4, 14, 8)], (L, p) => [...Array(+p.rows)].flatMap((_, i) => at(L, 0, (i - (+p.rows - 1) / 2) * 3, 0, (M) => pew(M, +p.len)))) },
}

// ---------------- street, rail, dock, site and vehicles ----------------

const STREET: Record<string, PrefabDef & { category: string }> = {
  billboard: { category: 'Street', label: 'Billboard', hint: 'A big roadside billboard on posts, with a catwalk', ...pfp('Billboard', [printParam('yellow')], (L, p) => [
    ...[-4.5, 4.5].map((x) => cyl('Billboard post', 0.7, 10, L(x, 0, 0), PB.steel, PB.steel, 10)),
    box('Billboard', [14, 6, 0.4], L(0, 10, 0), PB.steel, PRINTS[String(p.color)] ?? PRINTS.yellow, 0, 6), box('Catwalk', [14, 0.2, 1.4], L(0, 9.6, 0.9), PB.diamond),
  ]) },
  utilitypole: { category: 'Street', label: 'Utility pole', hint: 'A wooden power pole with a crossarm and transformer', make: pf('Utility pole', (L) => [
    cyl('Pole', 0.7, 16, L(0, 0, 0), PB.wood, PB.wood, 10), box('Crossarm', [5, 0.4, 0.4], L(0, 14.5, 0), PB.wood),
    ...[-2, 0, 2].map((x) => cyl('Insulator', 0.3, 0.6, L(x, 14.9, 0), WHITE, WHITE, 8)), cyl('Transformer', 1.3, 2, L(0, 10.5, 0.9), PB.steel, PB.steel, 12),
  ]) },
  chainfence: { category: 'Street', label: 'Chain-link fence', hint: 'A fence on posts; pick its length and height', ...pfp('Chain fence', [num('len', 'Length', 4, 48, 16, 2), num('h', 'Height', 3, 8, 5, 0.5)], (L, p) => {
    const len = +p.len, h = +p.h, n = Math.max(1, Math.round(len / 4))
    return [
      box('Fence mesh', [len, h - 0.2, 0.08], L(0, 0.2, 0), PB.steel, { gen: 'tiles', tweak: { color: '#3a3d40', accent: '#8d9094', scale: 16, wear: 0.2, seed: 430 }, surface: 14 }),
      lying('Top rail', 0.2, len, L(0, h - 0.1, 0), PB.steel, PB.steel, 8),
      ...[...Array(n + 1)].map((_, i) => cyl('Fence post', 0.3, h + 0.2, L(-len / 2 + (i * len) / n, 0, 0), PB.steel, PB.steel, 8)),
    ]
  }) },
  lowwall: { category: 'Street', label: 'Low wall', hint: 'A garden or yard wall with a cap', ...pfp('Low wall', [num('len', 'Length', 2, 40, 10), num('h', 'Height', 1, 5, 2.5, 0.5), sel('style', 'Style', [['brick', 'Brick'], ['stone', 'Stone'], ['concrete', 'Concrete']], 'brick')], (L, p) => {
    const tex = p.style === 'stone' ? STONE : p.style === 'concrete' ? PB.concrete : PB.brick
    return [box('Low wall', [+p.len, +p.h, 1], L(0, 0, 0), tex, tex), { ...box('Wall cap', [+p.len + 0.2, 0.25, 1.3], L(0, +p.h, 0), PB.concrete), bevel: 0.06 }]
  }) },
  tollbooth: { category: 'Street', label: 'Toll booth', hint: 'A highway toll booth with a canopy and barrier arm', make: pf('Toll booth', (L) => [
    { ...box('Toll booth', [3.6, 5.6, 5], L(0, 0.3, 0), PB.concrete, WHITE), bevel: 0.1 }, box('Booth windows', [3.7, 1.8, 4], L(0, 2.8, 0), GLASS),
    box('Island', [4.6, 0.3, 9], L(0, 0, 0), PB.concrete, HAZARD), ...[-1, 1].map((s) => box('Canopy post', [0.5, 7, 0.5], L(0, 0, s * 4.2), PB.steel)),
    box('Canopy', [10, 0.6, 10], L(0, 7, 0), WHITE, PB.red), box('Barrier box', [0.8, 2, 0.8], L(2.6, 0, 3.6), PB.yellow),
    lying('Barrier arm', 0.25, 8, L(6.6, 1.8, 3.6), HAZARD, HAZARD, 8),
  ]) },
  gravestones: { category: 'Street', label: 'Gravestones', hint: 'A small graveyard plot', make: pf('Gravestones', (L) => [[-3, -2, 0], [0, -2, 1], [3, -2, 2], [-3, 2, 1], [0, 2, 2], [3, 2, 0]].flatMap(([x, z, k]) => k === 2
    ? [box('Cross post', [0.4, 3, 0.4], L(x, 0, z), STONE), box('Cross arm', [1.6, 0.4, 0.4], L(x, 2, z), STONE)]
    : [{ ...box('Headstone', [1.6, k ? 2.2 : 1.6, 0.4], L(x, 0, z), STONE), bevel: k ? 0.3 : 0.1 }, box('Grave', [1.8, 0.2, 3], L(x, 0, z + 1.8), PB.dirt)])) },
}

const INDUSTRIAL: Record<string, PrefabDef & { category: string }> = {
  railsignal: { category: 'Industrial', label: 'Railway signal', hint: 'A trackside signal with red and green lights', make: pf('Rail signal', (L) => [
    box('Signal base', [1.2, 0.6, 1.2], L(0, 0, 0), PB.concrete), cyl('Signal pole', 0.4, 8, L(0, 0.6, 0), PB.steel, PB.steel, 10),
    { ...box('Signal head', [1.2, 2.8, 0.8], L(0, 6.6, 0), BLACK), bevel: 0.1 },
    lying('Red lamp', 0.6, 0.2, L(0, 8.2, 0.45), RED_LIGHT, RED_LIGHT, 12, 90), lying('Green lamp', 0.6, 0.2, L(0, 7.0, 0.45), GREEN_LIGHT, GREEN_LIGHT, 12, 90),
  ]) },
  bollards: { category: 'Industrial', label: 'Dock bollards', hint: 'Mooring bollards along a quay', ...pfp('Bollards', [num('n', 'Bollards', 1, 10, 4), num('gap', 'Spacing', 3, 16, 8)], (L, p) => [...Array(+p.n)].flatMap((_, i) => {
    const x = (i - (+p.n - 1) / 2) * +p.gap
    return [cyl('Bollard', 1.2, 1.4, L(x, 0, 0), BLACK, BLACK, 12), cyl('Bollard cap', 1.7, 0.35, L(x, 1.4, 0), BLACK, PB.yellow, 12)]
  })) },
  dockcrane: { category: 'Industrial', label: 'Dock crane', hint: 'A gantry crane you can walk under, with a hanging container', make: pf('Dock crane', (L) => [
    ...[[-7, -5], [7, -5], [-7, 5], [7, 5]].map(([x, z]) => box('Crane leg', [1, 20, 1], L(x, 0, z), PB.yellow, PB.yellow)),
    ...[-5, 5].map((z) => box('Crane beam', [15, 1.2, 1], L(0, 20, z), PB.yellow)), ...[-7, 7].map((x) => box('Crane beam', [1, 1.2, 11], L(x, 20, 0), PB.yellow)),
    box('Boom', [2, 1.5, 34], L(0, 21.2, 6), PB.yellow, HAZARD), box('Crane cab', [3, 3, 3], L(0, 17.5, 4), WHITE, GLASS),
    box('Hoist cable', [0.15, 9, 0.15], L(0, 12.2, 16), BLACK), box('Spreader', [3, 0.5, 6], L(0, 11.7, 16), PB.yellow),
    box('Hanging container', [5, 5, 12], L(0, 6.6, 16), PB.boxBlue, PB.boxBlue, 90, 6),
    ...[[-7, -5], [7, -5], [-7, 5], [7, 5]].map(([x, z]) => box('Rail bogie', [1.6, 0.8, 2.4], L(x, 0, z), PB.steel)),
  ]) },
  acunit: { category: 'Industrial', label: 'AC unit', hint: 'A rooftop air-conditioning unit', make: pf('AC unit', (L) => [
    { ...box('AC unit', [4, 2.4, 3], L(0, 0.2, 0), PB.steel), bevel: 0.1 }, box('AC feet', [3.6, 0.2, 2.6], L(0, 0, 0), BLACK),
    cyl('Fan grille', 2.4, 0.15, L(0, 2.6, 0), BLACK, PB.steel, 16), lying('Duct', 0.8, 2.4, L(-3.2, 0.9, 0), PB.steel, PB.steel, 10),
  ]) },
  portapotty: { category: 'Industrial', label: 'Portable toilet', hint: 'A building-site portable toilet', ...pfp('Portable toilet', [num('n', 'Toilets', 1, 6, 1)], (L, p) => [...Array(+p.n)].flatMap((_, i) => {
    const x = (i - (+p.n - 1) / 2) * 3.4
    return [{ ...box('Portable toilet', [3, 5.2, 3], L(x, 0, 0), WHITE, BLUE_PLASTIC), bevel: 0.15 }, box('Toilet door', [2, 4.2, 0.1], L(x, 0.3, 1.52), solid('#1a4a9a', '#123a7a', 431)), cyl('Vent', 0.3, 0.8, L(x + 1, 5.2, -1), BLACK, BLACK, 8)]
  })) },
}

const VEHICLES: Record<string, PrefabDef & { category: string }> = {
  citybus: { category: 'Vehicles', label: 'City bus', hint: 'A city bus with round wheels and a window band', ...pfp('City bus', [sel('color', 'Paint', [['yellow', 'Yellow'], ['white', 'White'], ['red', 'Red'], ['blue', 'Blue']], 'yellow')], (L, p) => {
    const paint = ({ yellow: PB.yellow, white: WHITE, red: PB.red, blue: PB.blue } as Record<string, Tex>)[String(p.color)] ?? PB.yellow
    return [
      { ...box('Bus body', [5.4, 5.4, 24], L(0, 0.8, 0), WHITE, paint), bevel: 0.4 }, box('Bus windows', [5.5, 1.8, 20], L(0, 3.2, -1), GLASS),
      box('Windshield', [4.8, 2.4, 0.1], L(0, 2.8, 12.02), GLASS), box('Bus door', [0.1, 3.8, 2.4], L(2.72, 0.9, 9), GLASS), box('Destination sign', [3.6, 0.6, 0.1], L(0, 5.5, 12.02), CY.orange),
      ...wheels(L, 5.2, [-8, 8], 1.7, 0.6),
    ]
  }) },
  boxtruck: { category: 'Vehicles', label: 'Box truck', hint: 'A delivery truck with a box body', make: pf('Box truck', (L) => [
    { ...box('Truck cab', [5, 4.4, 4.4], L(0, 0.8, 8.2), PB.red), bevel: 0.35 }, box('Cab glass', [4.6, 1.6, 0.1], L(0, 3.2, 10.42), GLASS),
    box('Chassis', [3.6, 0.6, 18], L(0, 0.8, 0.5), BLACK), { ...box('Box body', [5.6, 6, 13], L(0, 1.4, -1.5), WHITE), bevel: 0.1 },
    box('Roll door', [4.8, 5, 0.1], L(0, 1.6, -8.02), PB.corrugated), ...wheels(L, 4.8, [-5, 8.2], 1.7, 0.6),
  ]) },
  cementmixer: { category: 'Vehicles', label: 'Cement mixer', hint: 'A cement mixer truck with its drum', make: pf('Cement mixer', (L) => [
    { ...box('Truck cab', [5, 4.4, 4.4], L(0, 0.8, 8.2), WHITE), bevel: 0.35 }, box('Cab glass', [4.6, 1.6, 0.1], L(0, 3.2, 10.42), GLASS),
    box('Chassis', [3.6, 0.8, 18], L(0, 0.8, 0.5), BLACK),
    { ...lying('Mixer drum', 4.6, 10, L(0, 1.8, -1.5), PB.orange, PB.orange, 16, 90), taper: 0.65 },
    box('Chute', [1, 0.4, 3], L(0, 2.4, -8), PB.steel), ...wheels(L, 4.8, [-5.5, -2.5, 8.2], 1.7, 0.6),
  ]) },
  boat: { category: 'Vehicles', label: 'Motorboat', hint: 'A small motorboat with a cabin, for docks and trailers', ...pfp('Motorboat', [sel('color', 'Hull', [['white', 'White'], ['blue', 'Blue'], ['red', 'Red']], 'white')], (L, p) => {
    const hull = ({ white: WATER_HULL, blue: PB.blue, red: PB.red } as Record<string, Tex>)[String(p.color)] ?? WATER_HULL
    return [
      { ...box('Hull', [5, 2.2, 11], L(0, 0, -1), WHITE, hull), bevel: 0.6 }, { ...box('Bow', [3.6, 2.2, 3.6], L(0, 0, 4.6), WHITE, hull, 45), bevel: 0.4 },
      box('Deck', [4.2, 0.2, 9], L(0, 2.2, -1.2), LIGHT_WOOD), { ...box('Cabin', [3.4, 1.8, 3.6], L(0, 2.4, 0.6), WHITE), bevel: 0.3 },
      box('Windshield', [3.2, 1, 0.1], L(0, 4.2, 2.42), GLASS), box('Outboard motor', [1, 2.4, 1.2], L(0, 1.2, -7), BLACK),
    ]
  }) },
  trailerhome: { category: 'Vehicles', label: 'Trailer home', hint: 'A mobile home on blocks, with steps to the door', make: pf('Trailer home', (L) => [
    { ...box('Trailer', [8, 5, 22], L(0, 1, 0), PB.steel, solid('#e6dcc4', '#c9bc9e', 432)), bevel: 0.3 },
    box('Trailer stripe', [8.06, 0.5, 22.06], L(0, 2.6, 0), PB.blue), box('Skirting', [7.6, 1, 21.6], L(0, 0, 0), PB.corrugated),
    ...[-7, -2, 6].map((z) => box('Window', [8.1, 1.4, 2.4], L(0, 3.3, z), GLASS)), box('Trailer door', [0.1, 3.6, 2], L(4.05, 1.3, 2), solid('#7a5a3a', '#5a3f2a', 433)),
    stairs('Steps', [2.2, 1.3, 2.4], L(5.3, 0, 2), PB.concrete, PB.concrete, 270, 3), box('Hitch', [1, 0.6, 3], L(0, 0.4, 12.4), BLACK),
  ]) },
  carwreck: { category: 'Vehicles', label: 'Crushed cars', hint: 'A stack of crushed car hulks for a junkyard', ...pfp('Crushed cars', [num('n', 'Cars', 1, 5, 3)], (L, p) => {
    const paints = [PB.car('#8a3a2b', 440), PB.car('#2f5f8f', 441), PB.car('#7a7f86', 442), PB.car('#3f7a3a', 443), PB.rusty]
    return [...Array(+p.n)].flatMap((_, i) => at(L, (i % 2) * 0.6 - 0.3, (i % 3) * 0.4, (i * 23) % 40 - 20, (M) => [{ ...box('Crushed car', [4, 1.3, 8], M(0, 0, 0), PB.rusty, paints[i % paints.length]), bevel: 0.3 }], i * 1.3))
  }) },
}

export const INTERIOR_PREFABS: Record<string, PrefabDef & { category: string }> = { ...ROOMS, ...FURNITURE, ...STREET, ...INDUSTRIAL, ...VEHICLES }
