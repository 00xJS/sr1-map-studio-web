// Interiors, part two: kitchen and bathroom fittings, office, gym, hospital,
// police and garage pieces, club, bar, store, casino, bowling and pool-hall
// sets, home furniture, and the stairs, wall panels, door frames and pillars to
// build rooms of your own. Each piece stands on the ground at y, faces +Z and is
// one object. Sizes in units (1 unit = 0.5 m): a player is about 3.6 tall,
// doors are 4 wide and 5.6 high, stair steps rise 0.6 at most.
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
/** `n` copies of a piece in a row along X, `gap` apart. */
const row = (L: Lf, n: number, gap: number, make: (L: Lf, i: number) => Part[]): Part[] =>
  [...Array(Math.max(1, Math.round(n)))].flatMap((_, i, a) => at(L, (i - (a.length - 1) / 2) * gap, 0, 0, (M) => make(M, i)))
/** Heading that turns a piece's front (+Z) toward the origin from (x, z). */
const facing = (x: number, z: number) => (Math.atan2(-x, -z) * 180) / Math.PI

const num = (key: string, label: string, min: number, max: number, def: number, step = 1): ParamDef => ({ key, label, kind: 'number', min, max, step, default: def })
const sel = (key: string, label: string, options: [string, string][], def: string): ParamDef => ({ key, label, kind: 'select', options, default: def })
const yesNo = (key: string, label: string, def: 'yes' | 'no'): ParamDef => sel(key, label, [['yes', 'Yes'], ['no', 'No']], def)

/** Steps no taller than 0.6 units (0.3 m), so players walk up them. */
const stepsFor = (h: number) => Math.max(2, Math.ceil(h / 0.6 - 1e-6))

// ---------------- materials ----------------

const solid = (color: string, accent: string, seed: number, surface = 17): Tex => ({ gen: 'paint', tweak: { color, accent, scale: 2, wear: 0.06, seed }, surface })
const pattern = (color: string, accent: string, scale: number, seed: number, surface = 17): Tex => ({ gen: 'tiles', tweak: { color, accent, scale, wear: 0.08, seed }, surface })
const wood = (color: string, accent: string, seed: number): Tex => ({ gen: 'wood_planks', tweak: { color, accent, scale: 3, wear: 0.12, seed }, surface: 21 })
const metal = (color: string, accent: string, seed: number, wear = 0.1): Tex => ({ gen: 'metal_plate', tweak: { color, accent, scale: 2, wear, seed }, surface: 15 })

const WHITE = solid('#e8e6e0', '#cfccc4', 600)
const PORCELAIN = solid('#f4f4f0', '#dcdcd6', 601, 3)
const BLACK = solid('#1d1d20', '#141416', 602, 15)
const BRUSHED = metal('#b9bcc0', '#8d9094', 603, 0.02)
const GREY_METAL = metal('#7d838a', '#5d6268', 604)
const BEIGE_METAL = metal('#c9bfa6', '#a89e86', 605)
const DARK_WOOD = wood('#4a3324', '#2e1f15', 606)
const LIGHT_WOOD = wood('#b48a5a', '#8a6640', 607)
const WHITE_WOOD = wood('#e2ded4', '#c4beb0', 608)
const MARBLE: Tex = { lib: 'marble_01', surface: 13 }
const GLASS: Tex = { gen: 'paint', tweak: { color: '#25313b', accent: '#1a2229', scale: 2, wear: 0, seed: 609 }, surface: 9 }
const MIRROR: Tex = { gen: 'paint', tweak: { color: '#a8bcc8', accent: '#d2e0e8', scale: 2, wear: 0, seed: 610 }, surface: 9 }
const SCREEN: Tex = { gen: 'tiles', tweak: { color: '#14191f', accent: '#18d8ff', scale: 3, wear: 0, seed: 611 }, surface: 15 }
const FELT: Tex = pattern('#1f6b3a', '#1a5a31', 4, 612)
const LEATHER = pattern('#3a2620', '#2a1a15', 4, 613)
const RED_LEATHER = pattern('#8a1e22', '#5a1216', 4, 614)
const VELVET = pattern('#5a1430', '#3a0c20', 6, 615)
const FABRIC = pattern('#5d6a78', '#4a5560', 8, 616)
const LINEN = solid('#d9d4c8', '#bdb6a6', 617)
const CURTAIN = pattern('#8fb8b0', '#6a9890', 6, 618)
const CANVAS = solid('#e6e0d0', '#c8c0aa', 619)
const RING_SKIRT = solid('#1f3f8a', '#142a5e', 620)
const ROPE = solid('#c8302a', '#7a1410', 621)
const MAT = pattern('#2a2a30', '#1d1d22', 6, 622, 18)
const WATER_BLUE: Tex = { gen: 'paint', tweak: { color: '#8ec8e8', accent: '#bfe2f2', scale: 2, wear: 0, seed: 623 }, surface: 9 }
const WHITEBOARD = solid('#f6f6f2', '#e2e2dc', 624, 5)
const BOTTLE_GREEN = solid('#2f6a3a', '#1d4424', 625, 9)
const BOTTLE_AMBER = solid('#9a5a1a', '#6a3a0a', 626, 9)
const BOTTLE_CLEAR = solid('#c8d8d8', '#9ab0b0', 627, 9)
const GOLD = metal('#c9a23a', '#a8842a', 628, 0)
const CARPET = pattern('#3a2a5a', '#c9a23a', 8, 629)
const LANE: Tex = { lib: 'wood_floor', surface: 21 }
const CHIPS = [solid('#d8322b', '#7a1612', 630), solid('#2a6fe0', '#123a7a', 631), solid('#f2f2ee', '#c8c8c0', 632), solid('#1d1d20', '#141416', 633)]
const ROULETTE = pattern('#b8201c', '#151515', 6, 634)
const CONCRETE: Tex = PB.concrete
const CELL_BARS = metal('#3a3d42', '#2a2c30', 635, 0.2)
const PARTITION = pattern('#6f7a86', '#5d6670', 10, 636)
const BOOKS: Tex[] = [PB.red, PB.blue, PB.green, PB.yellow, PB.orange, DARK_WOOD]
const GARMENTS: Tex[] = [PB.red, PB.blue, solid('#e8e6e0', '#cfccc4', 637), PB.black, PB.green, solid('#d88aa8', '#a85a78', 638), PB.yellow]

const NEON: Record<string, Tex> = { pink: CY.pink, cyan: CY.cyan, lime: CY.lime, purple: CY.purple, orange: CY.orange, white: CY.white }
const neonParam = (def: string) => sel('color', 'Glow', [['pink', 'Pink'], ['cyan', 'Cyan'], ['lime', 'Lime'], ['purple', 'Purple'], ['orange', 'Orange'], ['white', 'White']], def)
const neon = (p: Params) => NEON[String(p.color)] ?? CY.pink
const WOODS: Record<string, Tex> = { dark: DARK_WOOD, light: LIGHT_WOOD, white: WHITE_WOOD }
const woodParam = (def: string) => sel('wood', 'Finish', [['dark', 'Dark wood'], ['light', 'Light wood'], ['white', 'White']], def)
const woodTex = (p: Params) => WOODS[String(p.wood)] ?? DARK_WOOD
const WALLS: Record<string, Tex> = { plaster: PB.plaster, brick: PB.brick, concrete: PB.cinder, wood: PB.planks, metal: PB.corrugated, tiles: PB.tilesWhite, cyber: CY.panel }
const wallParam = (def: string) => sel('style', 'Walls', [['plaster', 'Plaster'], ['brick', 'Brick'], ['concrete', 'Concrete'], ['wood', 'Wood'], ['metal', 'Metal'], ['tiles', 'Tiles'], ['cyber', 'Cyber']], def)
const wallTex = (p: Params) => WALLS[String(p.style)] ?? PB.plaster
const wallTop = (p: Params) => (p.style === 'cyber' ? CY.panelLight : PB.concrete)

// ---------------- small parts (each in its own frame, base at y 0, facing +Z) ----------------

const legs = (L: Lf, w: number, d: number, h: number, tex: Tex, s = 0.25, y = 0) =>
  [[-w / 2 + s / 2, -d / 2 + s / 2], [w / 2 - s / 2, -d / 2 + s / 2], [-w / 2 + s / 2, d / 2 - s / 2], [w / 2 - s / 2, d / 2 - s / 2]].map(([a, b]) => box('Leg', [s, h, s], L(a, y, b), tex))
const chair = (L: Lf, tex: Tex = DARK_WOOD): Part[] => [
  box('Seat', [1.6, 0.2, 1.6], L(0, 0.9, 0), tex), box('Chair back', [1.6, 1.6, 0.2], L(0, 1.1, -0.7), tex), ...legs(L, 1.6, 1.6, 0.9, tex, 0.15),
]
const officeChair = (L: Lf, tex: Tex = LEATHER): Part[] => [
  cyl('Chair base', 1.4, 0.2, L(0, 0, 0), BLACK, BLACK, 5), cyl('Chair post', 0.25, 0.8, L(0, 0.2, 0), PB.steel, PB.steel, 8),
  { ...box('Seat', [1.7, 0.3, 1.6], L(0, 1, 0), tex), bevel: 0.1 }, { ...box('Chair back', [1.6, 1.8, 0.3], L(0, 1.3, -0.75), tex), bevel: 0.12 },
]
/** A stool `h` high to the top of its seat. */
const stool = (L: Lf, h = 2.15): Part[] => [
  cyl('Stool base', 1, 0.1, L(0, 0, 0), PB.steel, PB.steel, 10), cyl('Stool post', 0.25, h - 0.35, L(0, 0.1, 0), PB.steel, PB.steel, 8), cyl('Stool seat', 1.2, 0.25, L(0, h - 0.25, 0), LEATHER, LEATHER, 12),
]
const monitor = (L: Lf, x: number, y: number, z: number): Part[] => [
  box('Monitor', [2, 1.2, 0.15], L(x, y + 0.5, z), BLACK, SCREEN), box('Monitor stand', [0.3, 0.5, 0.3], L(x, y, z - 0.05), BLACK),
]
/** An oval or round cylinder: `w` across X, `d` across Z. */
const oval = (label: string, w: number, h: number, d: number, at: [number, number, number], top: Tex, side: Tex = top, sides = 20): Part => ({ ...cyl(label, w, h, at, top, side, sides), size: [w, h, d] })
/** A disc facing +Z (a speaker cone, a dial), `d` across, its centre at height cy. */
const disc = (label: string, d: number, t: number, L: Lf, x: number, cy: number, z: number, tex: Tex, sides = 16): Part =>
  lying(label, d, t, L(x, cy - d / 2, z), tex, tex, sides, 90)
const drawers = (L: Lf, w: number, n: number, y0: number, h: number, z: number, tex: Tex = BLACK): Part[] =>
  [...Array(n)].flatMap((_, k) => {
    const dh = h / n, y = y0 + k * dh
    return [box('Drawer line', [w, 0.06, 0.05], L(0, y + dh - 0.03, z), tex), box('Handle', [Math.min(1, w * 0.4), 0.1, 0.12], L(0, y + dh / 2, z + 0.05), BRUSHED)]
  })

// ---------------- wall with openings ----------------

interface Gap { at: number; w: number; h: number; sill?: number }

/** A straight wall along local X from a to b, `t` thick, with openings cut out. */
function wallX(L: Lf, a: number, b: number, h: number, t: number, side: Tex, top: Tex, gaps: Gap[] = [], label = 'Wall'): Part[] {
  const out: Part[] = []
  const piece = (s0: number, s1: number, y0: number, y1: number) => {
    if (s1 - s0 < 0.05 || y1 - y0 < 0.05) return
    out.push(box(label, [s1 - s0, y1 - y0, t], L((s0 + s1) / 2, y0, 0), top, side))
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

// ---------------- kitchen and bathroom ----------------

const KITCHEN_BATH: Record<string, PrefabDef & { category: string }> = {
  stove: { category: 'Furniture', label: 'Stove and hood', hint: 'A cooker with four rings, an oven door and an extractor hood (set it against a wall)', ...pfp('Stove', [sel('finish', 'Finish', [['white', 'White'], ['steel', 'Steel'], ['black', 'Black']], 'steel')], (L, p) => {
    const body = p.finish === 'white' ? WHITE : p.finish === 'black' ? BLACK : BRUSHED
    return [
      { ...box('Stove', [2.6, 1.8, 2.2], L(0, 0, 0), BLACK, body), bevel: 0.05 }, box('Oven door', [2, 1, 0.06], L(0, 0.3, 1.1), GLASS),
      box('Oven handle', [1.8, 0.1, 0.15], L(0, 1.4, 1.15), BRUSHED), box('Control panel', [2.6, 0.5, 0.3], L(0, 1.8, -0.95), body),
      ...[[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.6], [0.6, 0.6]].map(([x, z]) => cyl('Burner', 0.7, 0.06, L(x, 1.8, z), PB.black, PB.black, 12)),
      { ...box('Extractor hood', [2.8, 0.7, 1.8], L(0, 4.4, -0.2), body), bevel: 0.08 }, box('Hood duct', [1, 1.9, 0.8], L(0, 5.1, -0.6), body),
    ]
  }) },
  sinkunit: { category: 'Furniture', label: 'Sink and dishwasher', hint: 'A kitchen sink in its cabinet, with a dishwasher beside it', ...pfp('Sink unit', [woodParam('light')], (L, p) => [
    box('Sink cabinet', [3.2, 1.8, 2], L(-1.1, 0, 0), woodTex(p)), box('Dishwasher', [2.2, 1.75, 2], L(1.6, 0, 0), BRUSHED, BRUSHED),
    box('Dishwasher panel', [2.2, 0.3, 0.06], L(1.6, 1.4, 1.02), BLACK), box('Countertop', [5.6, 0.15, 2.2], L(0.05, 1.8, 0.05), MARBLE),
    box('Sink', [2.2, 0.06, 1.3], L(-1.1, 1.95, 0.1), BRUSHED), box('Drain', [0.3, 0.07, 0.3], L(-1.1, 1.95, 0.1), BLACK),
    cyl('Tap', 0.2, 0.9, L(-1.1, 1.95, -0.75), BRUSHED, BRUSHED, 8), box('Spout', [0.15, 0.15, 0.7], L(-1.1, 2.75, -0.45), BRUSHED),
    ...at(L, -1.1, 0, 0, (M) => drawers(M, 1.4, 1, 0.1, 1.6, 1.02)),
  ]) },
  kitchenisland: { category: 'Furniture', label: 'Kitchen island', hint: 'A big island worktop with a hob and counter stools to hide behind', ...pfp('Kitchen island', [num('len', 'Length', 4, 14, 7), num('stools', 'Stools', 0, 6, 3), woodParam('white')], (L, p) => {
    const len = +p.len
    return [
      box('Island', [len, 1.8, 3], L(0, 0, 0), woodTex(p)), box('Island top', [len + 0.3, 0.15, 3.9], L(0, 1.8, 0.4), MARBLE),
      box('Hob', [2.2, 0.06, 1.4], L(-len / 4, 1.95, -0.5), BLACK), ...at(L, 0, -1.5, 180, (M) => drawers(M, len - 1, 3, 0.1, 1.6, 0)),
      ...(+p.stools > 0 ? row(L, +p.stools, Math.min(2.2, (len - 0.6) / Math.max(1, +p.stools)), (M) => at(M, 0, 2.6, 0, (N) => stool(N, 1.55))) : []),
    ]
  }) },
  toilet: { category: 'Furniture', label: 'Toilet', hint: 'A toilet with its cistern and a paper roll', make: pf('Toilet', (L) => [
    { ...oval('Toilet base', 0.8, 0.5, 1.1, L(0, 0, 0.1), PORCELAIN), taper: 1.3 }, oval('Toilet bowl', 1.2, 0.4, 1.6, L(0, 0.5, 0.2), PORCELAIN),
    oval('Toilet seat', 1.25, 0.08, 1.65, L(0, 0.9, 0.2), WHITE), { ...box('Cistern', [1.4, 1.3, 0.55], L(0, 0.8, -0.85), PORCELAIN), bevel: 0.08 },
    box('Cistern lid', [1.5, 0.1, 0.65], L(0, 2.1, -0.85), PORCELAIN), box('Flush button', [0.3, 0.05, 0.2], L(0, 2.2, -0.85), BRUSHED),
    box('Roll holder', [0.1, 0.1, 0.4], L(1.2, 1.4, -0.4), BRUSHED), lying('Paper roll', 0.45, 0.5, L(1.2, 1.2, -0.4), WHITE, WHITE, 10, 90),
    box('Roll stand', [0.1, 1.4, 0.1], L(1.2, 0, -0.65), BRUSHED),
  ]) },
  bathsinks: { category: 'Furniture', label: 'Bathroom sinks', hint: 'A vanity with one to six basins and a long mirror (set it against a wall)', ...pfp('Bathroom sinks', [num('n', 'Basins', 1, 6, 2), woodParam('white')], (L, p) => {
    const n = Math.round(+p.n), len = n * 2.6
    return [
      box('Vanity', [len, 1.7, 1.8], L(0, 0, 0), woodTex(p)), box('Vanity top', [len + 0.2, 0.15, 2], L(0, 1.7, 0.05), MARBLE),
      box('Mirror', [len, 2.6, 0.08], L(0, 2.8, -0.9), MIRROR, MIRROR), box('Backsplash', [len + 0.2, 0.9, 0.15], L(0, 1.85, -0.85), MARBLE),
      ...row(L, n, 2.6, (M) => [
        oval('Basin', 1.6, 0.12, 1.1, M(0, 1.85, 0.15), PORCELAIN), cyl('Drain', 0.25, 0.13, M(0, 1.85, 0.15), BLACK, BLACK, 8),
        cyl('Tap', 0.18, 0.6, M(0, 1.85, -0.6), BRUSHED, BRUSHED, 8), box('Spout', [0.12, 0.12, 0.5], M(0, 2.35, -0.4), BRUSHED),
        box('Cabinet door line', [0.06, 1.4, 0.05], M(0, 0.15, 0.92), BLACK),
      ]),
    ]
  }) },
  bathtub: { category: 'Furniture', label: 'Bathtub', hint: 'A tub on feet you can climb into, with taps and a shower curtain rail', make: pf('Bathtub', (L) => [
    ...[[-1.1, -2.4], [1.1, -2.4], [-1.1, 2.4], [1.1, 2.4]].map(([x, z]) => cyl('Tub foot', 0.45, 0.35, L(x, 0, z), GOLD, GOLD, 8)),
    box('Tub floor', [2.8, 0.3, 5.6], L(0, 0.35, 0), PORCELAIN),
    ...[-1, 1].map((s) => ({ ...box('Tub side', [0.3, 1.1, 5.6], L(s * 1.25, 0.65, 0), PORCELAIN), bevel: 0.1 })),
    ...[-1, 1].map((s) => ({ ...box('Tub end', [2.2, 1.1, 0.3], L(0, 0.65, s * 2.65), PORCELAIN), bevel: 0.1 })),
    cyl('Tap', 0.2, 0.7, L(-0.4, 1.75, -2.65), BRUSHED, BRUSHED, 8), cyl('Tap', 0.2, 0.7, L(0.4, 1.75, -2.65), BRUSHED, BRUSHED, 8),
    box('Spout', [0.15, 0.15, 0.6], L(0, 2.3, -2.3), BRUSHED),
    box('Curtain rod post', [0.12, 6.4, 0.12], L(1.45, 0, 2.85), BRUSHED), box('Curtain rod post', [0.12, 6.4, 0.12], L(1.45, 0, -2.85), BRUSHED),
    box('Curtain rod', [0.1, 0.1, 5.82], L(1.45, 6.3, 0), BRUSHED), box('Shower curtain', [0.06, 3.6, 2.2], L(1.45, 2.7, -1.7), CURTAIN),
  ]) },
  showerstall: { category: 'Furniture', label: 'Shower stall', hint: 'A tiled corner shower with a glass screen and a door gap', make: pf('Shower stall', (L) => [
    box('Shower tray', [3.4, 0.2, 3.4], L(0, 0, 0), PORCELAIN), cyl('Drain', 0.3, 0.21, L(0, 0, 0), BRUSHED, BRUSHED, 8),
    box('Shower wall', [3.4, 6, 0.2], L(0, 0, -1.8), PB.tilesWhite, PB.tilesWhite, 0, 2), box('Shower wall', [0.2, 6, 3.6], L(-1.8, 0, -0.1), PB.tilesWhite, PB.tilesWhite, 0, 2),
    box('Glass screen', [0.08, 5, 3.4], L(1.66, 0.2, 0), GLASS, GLASS), box('Glass screen', [1.4, 5, 0.08], L(-0.9, 0.2, 1.66), GLASS, GLASS),
    box('Screen frame', [3.6, 0.15, 0.15], L(0, 5.2, 1.66), BRUSHED), box('Screen frame', [0.15, 0.15, 3.4], L(1.66, 5.2, 0), BRUSHED),
    box('Shower pipe', [0.12, 2.2, 0.12], L(0, 3.4, -1.62), BRUSHED), box('Shower arm', [0.12, 0.12, 0.8], L(0, 5.5, -1.3), BRUSHED),
    cyl('Shower head', 0.8, 0.12, L(0, 5.4, -0.9), BRUSHED, BRUSHED, 12), box('Mixer', [0.5, 0.5, 0.15], L(0, 2.6, -1.62), BRUSHED),
  ]) },
}

// ---------------- office, hospital, police, garage ----------------

const deskTop = (L: Lf, w: number, d: number, tex: Tex, h = 1.4): Part[] => [
  box('Desk top', [w, 0.2, d], L(0, h, 0), tex), ...[-1, 1].map((sx) => box('Desk side', [0.2, h, d], L(sx * (w / 2 - 0.1), 0, 0), tex)),
  box('Modesty panel', [w - 0.4, h * 0.6, 0.12], L(0, h * 0.4, -d / 2 + 0.2), tex),
]

const WORK: Record<string, PrefabDef & { category: string }> = {
  cubicles: { category: 'Furniture', label: 'Office cubicles', hint: 'A cluster of cubicles: chest-high partitions to crouch behind, desks, computers and chairs', ...pfp('Cubicles', [num('n', 'Cubicles per side', 1, 6, 3), sel('rows', 'Sides', [['2', 'Back to back'], ['1', 'One row']], '2')], (L, p) => {
    const n = Math.round(+p.n), two = p.rows !== '1', W = 5, D = 5, H = 2.8, len = n * W
    const parts: Part[] = [box('Partition', [len + 0.2, H, 0.2], L(0, 0, 0), PB.steel, PARTITION, 0, 3)]
    for (const side of two ? [1, -1] : [1]) {
      for (let i = 0; i <= n; i++) parts.push(box('Partition', [0.2, H, D - 0.1], L(-len / 2 + i * W, 0, side * (D / 2 + 0.05)), PB.steel, PARTITION, 0, 3))
      for (let i = 0; i < n; i++) {
        const x = -len / 2 + W / 2 + i * W
        parts.push(...at(L, x, side * 1.25, side > 0 ? 0 : 180, (M) => [
          box('Desk top', [4.4, 0.2, 2.2], M(0, 1.4, 0), LIGHT_WOOD), box('Desk leg', [0.2, 1.4, 2.2], M(-2.1, 0, 0), PB.steel),
          box('Drawer pedestal', [1.4, 1.4, 2], M(1.4, 0, 0), PB.steel), ...at(M, 1.4, 0, 0, (N) => drawers(N, 1.2, 3, 0.05, 1.3, 1.02)),
          ...monitor(M, -0.4, 1.6, -0.6), box('Keyboard', [1.6, 0.06, 0.5], M(-0.4, 1.6, 0.3), BLACK),
          ...at(M, -0.4, 2, 180, (N) => officeChair(N, FABRIC)),
        ]))
      }
    }
    return parts
  }) },
  printer: { category: 'Furniture', label: 'Photocopier', hint: 'An office copier with paper trays and a control panel', make: pf('Photocopier', (L) => [
    { ...box('Copier', [2.6, 1.9, 2], L(0, 0, 0), BLACK, WHITE), bevel: 0.08 }, box('Scanner lid', [2.6, 0.2, 2], L(0, 1.9, 0), PB.steel),
    ...[0.3, 0.8, 1.3].map((y) => box('Paper tray', [2.3, 0.08, 0.06], L(0, y, 1.02), PB.steel)),
    box('Control panel', [0.9, 0.18, 0.6], L(0.75, 2.1, 0.6), BLACK, SCREEN), box('Output tray', [1, 0.08, 1.4], L(-1.7, 1.2, 0), PB.steel),
    box('Paper stack', [0.8, 0.2, 1.1], L(-1.7, 1.28, 0), WHITE),
  ]) },
  watercooler: { category: 'Furniture', label: 'Water cooler', hint: 'A water cooler with its big blue bottle and a cup dispenser', make: pf('Water cooler', (L) => [
    { ...box('Cooler', [1.2, 2.4, 1.2], L(0, 0, 0), WHITE), bevel: 0.08 }, box('Tap panel', [0.8, 0.5, 0.1], L(0, 1.5, 0.62), PB.steel),
    box('Tap', [0.15, 0.2, 0.2], L(-0.2, 1.5, 0.72), PB.blue), box('Tap', [0.15, 0.2, 0.2], L(0.2, 1.5, 0.72), PB.red),
    cyl('Water bottle', 1, 1.5, L(0, 2.4, 0), WATER_BLUE, WATER_BLUE, 14),{ ...cyl('Bottle neck', 1, 0.3, L(0, 3.9, 0), WATER_BLUE, WATER_BLUE, 14), taper: 0.4 },
    cyl('Cup dispenser', 0.35, 1, L(0.75, 1.2, 0), WHITE, WHITE, 8),
  ]) },
  filingcabinets: { category: 'Furniture', label: 'Filing cabinets', hint: 'A row of four-drawer filing cabinets', ...pfp('Filing cabinets', [num('n', 'Cabinets', 1, 10, 3), sel('color', 'Color', [['grey', 'Grey'], ['beige', 'Beige'], ['black', 'Black']], 'grey')], (L, p) => {
    const tex = p.color === 'beige' ? BEIGE_METAL : p.color === 'black' ? BLACK : GREY_METAL
    return row(L, +p.n, 1.75, (M) => [{ ...box('Filing cabinet', [1.7, 2.8, 2.2], M(0, 0, 0), tex), bevel: 0.03 }, ...drawers(M, 1.4, 4, 0.1, 2.6, 1.11)])
  }) },
  whiteboard: { category: 'Furniture', label: 'Whiteboard', hint: 'A whiteboard on a wheeled stand, for planning the attack', ...pfp('Whiteboard', [num('w', 'Width', 3, 10, 6, 0.5)], (L, p) => {
    const w = +p.w
    return [
      box('Whiteboard', [w, 3.4, 0.15], L(0, 2.2, 0), PB.steel, WHITEBOARD), box('Pen tray', [w, 0.12, 0.45], L(0, 2.2, 0.25), PB.steel),
      ...[-1, 1].flatMap((s) => [box('Stand leg', [0.2, 5.7, 0.2], L(s * (w / 2 + 0.1), 0.3, 0), PB.steel), box('Stand foot', [0.3, 0.15, 2.2], L(s * (w / 2 + 0.1), 0.15, 0), PB.steel),
        ...[-0.9, 0.9].map((z) => cyl('Caster', 0.3, 0.15, L(s * (w / 2 + 0.1), 0, z), BLACK, BLACK, 8))]),
      box('Pen', [0.5, 0.1, 0.1], L(-w / 4, 2.32, 0.25), PB.blue), box('Pen', [0.5, 0.1, 0.1], L(-w / 4 + 0.7, 2.32, 0.25), PB.red),
    ]
  }) },
  conftable: { category: 'Furniture', label: 'Conference table', hint: 'A long boardroom table with office chairs down both sides and at the ends', ...pfp('Conference table', [num('seats', 'Seats per side', 2, 8, 4), woodParam('dark')], (L, p) => {
    const n = Math.round(+p.seats), len = n * 2.4 + 1.2
    return [
      { ...box('Table top', [len, 0.25, 4.4], L(0, 1.3, 0), woodTex(p)), bevel: 0.1 },
      ...[-1, 1].map((s) => box('Table base', [1.2, 1.3, 2.4], L(s * len / 4, 0, 0), BLACK)),
      ...row(L, n, 2.4, (M) => [...at(M, 0, 3.1, 180, officeChair), ...at(M, 0, -3.1, 0, officeChair)]),
      ...[-1, 1].flatMap((s) => at(L, s * (len / 2 + 1.3), 0, s > 0 ? 270 : 90, officeChair)),
      ...row(L, Math.max(1, n - 1), 3, (M) => [box('Notepad', [0.8, 0.04, 1.1], M(0, 1.55, 1.2), WHITE), box('Notepad', [0.8, 0.04, 1.1], M(0, 1.55, -1.2), WHITE)]),
    ]
  }) },
  hospitalbed: { category: 'Furniture', label: 'Hospital bed', hint: 'A wheeled bed with a raised back, side rails, a drip stand and a privacy screen', make: pf('Hospital bed', (L) => [
    ...[[-1.2, -2.8], [1.2, -2.8], [-1.2, 2.8], [1.2, 2.8]].flatMap(([x, z]) => [box('Bed leg', [0.2, 1.1, 0.2], L(x, 0.4, z), BRUSHED), cyl('Bed wheel', 0.45, 0.4, L(x, 0, z), BLACK, BLACK, 8)]),
    box('Bed frame', [3, 0.3, 6.4], L(0, 1.5, 0), BRUSHED), box('Mattress', [2.8, 0.5, 4.4], L(0, 1.8, 1), LINEN),
    box('Back rest', [2.8, 0.5, 2.2], L(0, 1.8, -2.1), LINEN),{ ...box('Raised back', [2.8, 1.4, 0.5], L(0, 2.3, -2.9), LINEN), bevel: 0.15 },
    box('Pillow', [2, 0.35, 0.9], L(0, 2.3, -2.2), WHITE), box('Sheet', [2.9, 0.12, 3.2], L(0, 2.3, 1.4), CURTAIN),
    box('Headboard', [3, 2.2, 0.2], L(0, 1.5, -3.25), WHITE), box('Footboard', [3, 1.4, 0.2], L(0, 1.5, 3.25), WHITE),
    ...[-1, 1].map((s) => box('Side rail', [0.1, 0.6, 2.8], L(s * 1.5, 2.3, -0.6), BRUSHED)),
    cyl('Drip stand base', 1.1, 0.12, L(2.4, 0, -2.4), BRUSHED, BRUSHED, 5), cyl('Drip stand', 0.12, 4.8, L(2.4, 0.12, -2.4), BRUSHED, BRUSHED, 6),
    box('Drip bag', [0.5, 0.8, 0.2], L(2.4, 4, -2.25), WATER_BLUE),
    ...[[-2.6, 2.2, 90], [-2.6, -1.6, 90], [-1.2, -4.4, 0]].flatMap(([x, z, r]) => at(L, x, z, r, (M) => [
      box('Screen panel', [3.6, 3.6, 0.08], M(0, 0.6, 0), CURTAIN), box('Screen frame', [3.8, 0.12, 0.12], M(0, 4.2, 0), BRUSHED),
      ...[-1, 1].flatMap((s) => [box('Screen post', [0.12, 4.3, 0.12], M(s * 1.85, 0, 0), BRUSHED), box('Screen foot', [0.15, 0.1, 1.2], M(s * 1.85, 0, 0), BRUSHED)]),
    ])),
  ]) },
  wheelchair: { category: 'Furniture', label: 'Wheelchair', hint: 'A wheelchair with big push wheels', make: pf('Wheelchair', (L) => [
    ...[-1, 1].flatMap((s) => [lying('Wheel', 2, 0.15, L(s * 0.95, 0, -0.2), PB.tire, BRUSHED, 16), lying('Caster', 0.5, 0.12, L(s * 0.6, 0, 0.9), BLACK, BLACK, 10),
      box('Frame', [0.1, 1, 0.1], L(s * 0.7, 0.5, 0.9), BRUSHED), box('Frame', [0.1, 0.1, 1.6], L(s * 0.7, 0.9, 0.1), BRUSHED),
      box('Arm rest', [0.15, 0.12, 1.2], L(s * 0.75, 1.7, 0), BLACK), box('Arm post', [0.1, 0.7, 0.1], L(s * 0.75, 1, 0.5), BRUSHED),
      box('Push handle', [0.1, 2.1, 0.1], L(s * 0.7, 0.9, -0.75), BRUSHED)]),
    box('Seat', [1.4, 0.15, 1.4], L(0, 1, 0), BLACK), box('Back', [1.4, 1.3, 0.12], L(0, 1.4, -0.72), BLACK),
    box('Foot rest', [1.2, 0.08, 0.5], L(0, 0.4, 1.2), BLACK),
  ]) },
  receptiondesk: { category: 'Furniture', label: 'Reception desk', hint: 'A front desk with a high counter, a computer and a chair behind (hospital, hotel or office)', ...pfp('Reception desk', [num('len', 'Length', 6, 16, 8), sel('style', 'Style', [['white', 'Clinic white'], ['wood', 'Hotel wood'], ['steel', 'Police steel']], 'white')], (L, p) => {
    const len = +p.len, tex = p.style === 'wood' ? DARK_WOOD : p.style === 'steel' ? GREY_METAL : WHITE, top = p.style === 'steel' ? BLACK : MARBLE
    return [
      box('Counter front', [len, 2.4, 0.5], L(0, 0, 1.25), tex), box('Counter ledge', [len + 0.3, 0.15, 1.1], L(0, 2.4, 1.25), top),
      ...[-1, 1].map((s) => box('Counter return', [0.5, 2.4, 3], L(s * (len / 2 - 0.25), 0, -0.25), tex)),
      box('Work top', [len - 1, 0.15, 1.8], L(0, 1.4, 0.1), top), ...monitor(L, -len / 4, 1.55, -0.3), ...monitor(L, len / 4, 1.55, -0.3),
      box('Phone', [0.6, 0.25, 0.5], L(0, 1.55, 0.4), BLACK), ...at(L, -len / 4, -1.6, 0, officeChair), ...at(L, len / 4, -1.6, 0, officeChair),
      box('Bell', [0.3, 0.2, 0.3], L(len / 3, 2.55, 1.3), GOLD),
    ]
  }) },
  policedesk: { category: 'Furniture', label: 'Police desks', hint: 'Bullpen desks with computers, case files, a lamp and a suspect chair', ...pfp('Police desks', [num('n', 'Desks', 1, 6, 2)], (L, p) => row(L, +p.n, 7, (M) => [
    ...deskTop(M, 5, 2.6, GREY_METAL), box('Drawer pedestal', [1.4, 1.4, 2.2], M(1.6, 0, 0), GREY_METAL), ...at(M, 1.6, 0, 0, (N) => drawers(N, 1.2, 3, 0.1, 1.2, 1.12)),
    ...monitor(M, -1, 1.6, -0.6), box('Keyboard', [1.6, 0.06, 0.5], M(-1, 1.6, 0.3), BLACK),
    box('Case files', [1, 0.5, 1.3], M(1.4, 1.6, -0.3), BEIGE_METAL), box('Case files', [1, 0.3, 1.3], M(1.5, 2.1, -0.3), solid('#d8c89a', '#b8a87a', 639)),
    cyl('Lamp base', 0.5, 0.1, M(2, 1.6, 0.6), BLACK, BLACK, 8), box('Lamp arm', [0.1, 1, 0.1], M(2, 1.7, 0.6), BLACK), box('Lamp head', [0.7, 0.3, 0.4], M(1.8, 2.7, 0.6), PB.green),
    ...at(M, -0.6, -2, 0, officeChair), ...at(M, 0, 2.4, 180, (N) => chair(N, GREY_METAL)),
  ])) },
  toolchest: { category: 'Furniture', label: 'Tool chest', hint: 'A rolling mechanic’s tool chest with a top box', ...pfp('Tool chest', [sel('color', 'Color', [['red', 'Red'], ['blue', 'Blue'], ['black', 'Black']], 'red')], (L, p) => {
    const tex = p.color === 'blue' ? PB.boxBlue : p.color === 'black' ? BLACK : PB.boxRed
    return [
      ...[[-1.3, -0.6], [1.3, -0.6], [-1.3, 0.6], [1.3, 0.6]].map(([x, z]) => cyl('Caster', 0.4, 0.3, L(x, 0, z), BLACK, BLACK, 8)),
      { ...box('Tool cabinet', [3.2, 2.3, 1.7], L(0, 0.3, 0), BLACK, tex), bevel: 0.05 }, ...drawers(L, 2.9, 5, 0.4, 2.1, 0.86, BLACK),
      { ...box('Top box', [3.2, 1.4, 1.5], L(0, 2.6, -0.1), BLACK, tex), bevel: 0.05 }, ...drawers(L, 2.9, 3, 2.65, 1.25, 0.66, BLACK),
      box('Side handle', [0.15, 0.15, 1.2], L(1.75, 2, 0), BRUSHED),
    ]
  }) },
  workbench: { category: 'Furniture', label: 'Workbench', hint: 'A heavy bench with a vice, pegboard and tools', ...pfp('Workbench', [num('len', 'Length', 4, 16, 8)], (L, p) => {
    const len = +p.len
    return [
      box('Bench top', [len, 0.35, 2.6], L(0, 1.55, 0), LIGHT_WOOD), ...legs(L, len - 0.2, 2.4, 1.55, GREY_METAL, 0.3),
      box('Lower shelf', [len - 0.6, 0.15, 2.2], L(0, 0.4, 0), GREY_METAL), box('Pegboard', [len, 3.4, 0.15], L(0, 1.9, -1.25), PB.plywood, PB.plywood),
      { ...box('Vice', [0.8, 0.6, 1.2], L(len / 2 - 0.8, 1.9, 0.5), PB.boxBlue), bevel: 0.08 }, box('Vice handle', [0.1, 0.1, 1], L(len / 2 - 0.8, 2.1, 1.4), BRUSHED),
      box('Toolbox', [1.8, 0.8, 0.9], L(-len / 4, 1.9, 0.3), PB.red), box('Wrench', [0.12, 1.2, 0.05], L(-1, 3.6, -1.15), BRUSHED),
      box('Hammer', [0.15, 1, 0.05], L(-0.4, 3.7, -1.15), LIGHT_WOOD), box('Saw', [1.6, 0.6, 0.05], L(0.8, 3.9, -1.15), BRUSHED),
      box('Paint cans', [1.4, 0.7, 0.8], L(len / 4, 0.55, 0.2), PB.yellow),
    ]
  }) },
  carlift: { category: 'Furniture', label: 'Car lift', hint: 'A two-post garage lift, with or without a car raised high enough to walk under', ...pfp('Car lift', [num('lift', 'Raised to', 0, 4.5, 4, 0.5), yesNo('car', 'Car on it', 'yes')], (L, p) => {
    const h = Math.min(4.5, +p.lift), paint = PB.car('#2a5ab8', 640)
    const parts: Part[] = [
      ...[-1, 1].flatMap((s) => [box('Lift post', [0.9, 8.4, 0.9], L(s * 3.6, 0, 0), PB.yellow), box('Post foot', [1.6, 0.2, 1.6], L(s * 3.6, 0, 0), PB.steel),
        box('Lift carriage', [1.2, 1, 1.2], L(s * 3.6, h, 0), BLACK),
        ...[-1, 1].map((t) => box('Lift arm', [2.2, 0.3, 0.4], L(s * 2.4, h + 0.2, t * 1.4), PB.yellow)),
        ...[-1, 1].map((t) => cyl('Lift pad', 0.6, 0.15, L(s * 1.5, h + 0.5, t * 1.4), BLACK, BLACK, 8))]),
      box('Top beam', [8.1, 0.6, 0.9], L(0, 8.4, 0), PB.yellow), box('Hydraulic unit', [0.8, 1.6, 0.8], L(4.6, 0.2, 0), PB.red),
    ]
    if (p.car === 'yes') {
      // The car points along Z, between the posts.
      parts.push(...at(L, 0, 0, 0, (M) => [
        { ...box('Car body', [4, 1.35, 8], M(0, h + 0.65 + 0.5, 0), paint), bevel: 0.4 },
        { ...box('Car cabin', [3.5, 1.15, 4.2], M(0, h + 0.65 + 1.85, -0.4), GLASS), bevel: 0.45 },
        ...wheels((dx, dy, dz) => M(dx, h + 0.65 + dy, dz), 3.6, [2.6, -2.6]),
      ]))
    }
    return parts
  }) },
  garagetires: { category: 'Furniture', label: 'Garage tire rack', hint: 'A two-tier rack of tyres standing on edge', ...pfp('Tire rack', [num('len', 'Length', 4, 16, 8)], (L, p) => {
    const len = +p.len, n = Math.max(1, Math.floor((len - 0.6) / 0.85))
    return [
      ...[-1, 1].flatMap((s) => [box('Rack post', [0.25, 5, 0.25], L(s * len / 2, 0, -0.9), PB.boxRed), box('Rack post', [0.25, 5, 0.25], L(s * len / 2, 0, 0.9), PB.boxRed)]),
      ...[0.3, 2.8].flatMap((y) => [box('Rack rail', [len, 0.2, 0.2], L(0, y, -0.6), PB.boxRed), box('Rack rail', [len, 0.2, 0.2], L(0, y, 0.6), PB.boxRed)]),
      ...[0.5, 3].flatMap((y) => [...Array(n)].map((_, i) => lying('Tire', 2.1, 0.75, L(-len / 2 + 0.6 + i * 0.85 + 0.375, y, 0), PB.tire, PB.tire, 14))),
    ]
  }) },
}

// ---------------- gym ----------------

const GYM: Record<string, PrefabDef & { category: string }> = {
  benchpress: { category: 'Venues', label: 'Bench press', hint: 'A weight bench with a loaded bar on its rack', make: pf('Bench press', (L) => [
    { ...box('Bench pad', [1.1, 0.35, 4], L(0, 1, 0.4), LEATHER), bevel: 0.1 }, box('Bench frame', [0.3, 1, 3], L(0, 0, 0.4), BLACK),
    box('Bench foot', [1.4, 0.15, 0.3], L(0, 0, 2.1), BLACK), box('Rack base', [3.2, 0.15, 0.4], L(0, 0, -1.6), BLACK),
    ...[-1, 1].flatMap((s) => [box('Upright', [0.25, 3.3, 0.25], L(s * 1.3, 0, -1.6), BLACK), box('J-hook', [0.3, 0.3, 0.4], L(s * 1.3, 2.9, -1.4), BRUSHED),
      lying('Plate', 1.8, 0.3, L(s * 2, 3.15 - 0.9, -1.4), BLACK, BLACK, 16), lying('Plate', 1.4, 0.2, L(s * 1.75, 3.15 - 0.7, -1.4), PB.red, PB.red, 16)]),
    lying('Bar', 0.15, 5.4, L(0, 3.1, -1.4), BRUSHED, BRUSHED, 8),
  ]) },
  treadmills: { category: 'Venues', label: 'Treadmills', hint: 'A row of treadmills with consoles', ...pfp('Treadmills', [num('n', 'Treadmills', 1, 8, 3)], (L, p) => row(L, +p.n, 2.8, (M) => [
    { ...box('Treadmill deck', [1.9, 0.5, 5], M(0, 0, 0), BLACK), bevel: 0.1 }, box('Belt', [1.4, 0.06, 4.6], M(0, 0.5, 0.1), PB.tire),
    ...[-1, 1].flatMap((s) => [box('Upright', [0.2, 2.8, 0.3], M(s * 0.85, 0.5, -2.2), BRUSHED), box('Hand rail', [0.15, 0.15, 1.6], M(s * 0.85, 2.7, -1.5), BRUSHED)]),
    { ...box('Console', [1.9, 0.8, 0.6], M(0, 3.1, -2.2), BLACK), bevel: 0.1 }, box('Console screen', [1.2, 0.5, 0.06], M(0, 3.25, -1.88), SCREEN),
  ])) },
  weightrack: { category: 'Venues', label: 'Dumbbell rack', hint: 'A two-tier rack of dumbbells with a mirror wall behind', ...pfp('Dumbbell rack', [num('len', 'Length', 4, 14, 7), yesNo('mirror', 'Mirror', 'yes')], (L, p) => {
    const len = +p.len, n = Math.max(1, Math.floor(len / 1.1))
    const parts: Part[] = [
      ...[-1, 1].flatMap((s) => [box('Rack end', [0.25, 2.6, 2.2], L(s * (len / 2 - 0.125), 0, 0), BLACK)]),
      box('Rack tier', [len, 0.15, 1], L(0, 1.1, 0.5), BLACK), box('Rack tier', [len, 0.15, 1], L(0, 2.1, -0.5), BLACK),
    ]
    for (const [y, z] of [[1.25, 0.5], [2.25, -0.5]]) for (let i = 0; i < n; i++) {
      const x = -len / 2 + 0.75 + (i * (len - 1.5)) / Math.max(1, n - 1), d = 0.45 + (i / n) * 0.3
      parts.push(...[-1, 1].map((s) => lying('Dumbbell head', d, 0.3, L(x, y, z + s * 0.45), BLACK, BLACK, 10, 90)), lying('Dumbbell grip', 0.15, 0.62, L(x, y + d / 2 - 0.075, z), BRUSHED, BRUSHED, 6, 90))
    }
    if (p.mirror === 'yes') parts.push(box('Mirror', [len, 5, 0.1], L(0, 0.6, -1.3), MIRROR, MIRROR))
    return parts
  }) },
  punchingbag: { category: 'Venues', label: 'Punching bags', hint: 'Heavy bags hanging from a stand', ...pfp('Punching bags', [num('n', 'Bags', 1, 6, 2)], (L, p) => {
    const n = Math.round(+p.n), len = n * 3.4
    return [
      ...[-1, 1].flatMap((s) => [box('Stand post', [0.4, 7.2, 0.4], L(s * len / 2, 0, 0), BLACK), box('Stand foot', [0.5, 0.2, 3], L(s * len / 2, 0, 0), BLACK)]),
      box('Stand beam', [len + 0.4, 0.4, 0.4], L(0, 7.2, 0), BLACK),
      ...row(L, n, 3.4, (M, i) => [box('Chain', [0.08, 1.4, 0.08], M(0, 5.8, 0), BRUSHED), { ...cyl('Heavy bag', 1.5, 3.4, M(0, 2.4, 0), BLACK, i % 2 ? RED_LEATHER : LEATHER, 14), bevel: 0 }]),
      box('Floor mat', [len + 2, 0.08, 4], L(0, 0, 0), MAT),
    ]
  }) },
  boxingring: { category: 'Venues', label: 'Boxing ring', hint: 'A raised ring with ropes, corner posts and steps up to a gap in the ropes: a one-on-one arena', ...pfp('Boxing ring', [num('size', 'Size', 12, 28, 18, 2)], (L, p) => {
    const S = +p.size, h = 2, e = S / 2 - 0.5, R = [h + 1.3, h + 2.1, h + 2.9]
    const gate = 4.4
    return [
      box('Ring', [S, h, S], L(0, 0, 0), CANVAS, RING_SKIRT), box('Apron', [S + 0.6, 0.1, S + 0.6], L(0, h - 0.1, 0), RING_SKIRT),
      ...[[-1, -1, PB.red], [1, -1, PB.blue], [-1, 1, WHITE], [1, 1, WHITE]].flatMap(([sx, sz, t]) => [
        cyl('Corner post', 0.5, 3.4, L((sx as number) * e, h, (sz as number) * e), BRUSHED, BRUSHED, 8), { ...box('Corner pad', [0.6, 2.4, 0.6], L((sx as number) * e, h + 0.8, (sz as number) * e), t as Tex), bevel: 0.15 }]),
      // Ropes on all four sides, with a gap in the front ones over the steps: players can't duck through ropes.
      ...R.flatMap((y) => [
        box('Rope', [2 * e, 0.15, 0.15], L(0, y, -e), ROPE), box('Rope', [0.15, 0.15, 2 * e], L(-e, y, 0), ROPE),
        box('Rope', [0.15, 0.15, 2 * e], L(e, y, 0), ROPE), box('Rope', [2 * e - gate, 0.15, 0.15], L(-gate / 2, y, e), ROPE),
      ]),
      cyl('Gate post', 0.4, 3.2, L(e - gate, h, e), BRUSHED, BRUSHED, 8),
      stairs('Ring steps', [3, h, 2.4], L(e - gate / 2, 0, S / 2 + 1.5), PB.steel, PB.steel, 0, stepsFor(h)),
      ...[-1, 1].map((s) => at(L, s * (S / 2 + 2), 0, s > 0 ? 270 : 90, (M) => stool(M, 1.4))).flat(),
    ]
  }) },
}

// ---------------- club, bar, store, casino, bowling, pool hall ----------------

const VENUES: Record<string, PrefabDef & { category: string }> = {
  djbooth: { category: 'Venues', label: 'DJ booth', hint: 'A DJ riser with decks, a mixer, a laptop and glowing front, steps up the back', ...pfp('DJ booth', [neonParam('pink')], (L, p) => [
    box('Riser', [10, 1.2, 6], L(0, 0, 0), PB.diamond, BLACK), { ...box('Booth', [7, 2.6, 1.2], L(0, 1.2, 1.8), BLACK), bevel: 0.08 },
    box('Booth glow', [6.6, 0.4, 0.1], L(0, 2.6, 2.42), neon(p)), box('Booth glow', [6.6, 0.4, 0.1], L(0, 1.6, 2.42), neon(p)),
    ...[-1.8, 1.8].flatMap((x) => [box('Deck', [1.8, 0.25, 1.4], L(x, 3.8, 1.8), BLACK), cyl('Platter', 1.3, 0.08, L(x, 4.05, 1.8), PB.black, BRUSHED, 16)]),
    box('Mixer', [1.2, 0.3, 1], L(0, 3.8, 1.8), BLACK, SCREEN), box('Laptop', [1.3, 0.06, 0.9], L(0, 4.1, 1.4), PB.steel), box('Laptop screen', [1.3, 0.85, 0.06], L(0, 4.16, 0.95), PB.steel, SCREEN),
    stairs('Steps', [3, 1.2, 2], L(-3, 0, -4), PB.diamond, PB.steel, 180, stepsFor(1.2)),
    ...[-1, 1].map((s) => ({ ...box('Monitor speaker', [1.4, 2, 1.2], L(s * 4.2, 1.2, 1.8), BLACK), bevel: 0.1 })),
  ]) },
  speakerstack: { category: 'Venues', label: 'Speaker stack', hint: 'Stacked sound-system cabinets with big cones: chunky cover by a stage', ...pfp('Speaker stack', [num('cols', 'Columns', 1, 4, 2), num('tiers', 'Tiers', 1, 4, 3)], (L, p) => {
    const parts: Part[] = []
    const cols = Math.round(+p.cols), tiers = Math.round(+p.tiers)
    for (let c = 0; c < cols; c++) for (let t = 0; t < tiers; t++) {
      const x = (c - (cols - 1) / 2) * 3, big = t < 2, h = big ? 2.8 : 1.8, y = t < 2 ? t * 2.8 : 5.6 + (t - 2) * 1.8
      parts.push({ ...box('Speaker cabinet', [2.9, h, 2.4], L(x, y, 0), BLACK, BLACK), bevel: 0.06 })
      if (big) parts.push(disc('Woofer', 2.1, 0.12, L, x, y + h / 2, 1.21, PB.tire), disc('Dust cap', 0.6, 0.18, L, x, y + h / 2, 1.24, BRUSHED, 10))
      else parts.push(...[-0.7, 0.7].map((dx) => disc('Mid cone', 1.1, 0.12, L, x + dx, y + h / 2, 1.21, PB.tire, 12)))
    }
    return parts
  }) },
  dancefloor: { category: 'Venues', label: 'Dance floor', hint: 'A light-up floor of glowing tiles', ...pfp('Dance floor', [num('n', 'Tiles across', 2, 10, 6), sel('colors', 'Colors', [['party', 'Party mix'], ['pinkcyan', 'Pink and cyan'], ['white', 'White']], 'party')], (L, p) => {
    const n = Math.round(+p.n), T = 3
    const set = p.colors === 'white' ? [CY.white, CY.panel] : p.colors === 'pinkcyan' ? [CY.pink, CY.cyan] : [CY.pink, CY.cyan, CY.lime, CY.purple, CY.orange]
    const parts: Part[] = [box('Floor base', [n * T + 0.6, 0.15, n * T + 0.6], L(0, 0, 0), BLACK, BRUSHED)]
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) parts.push(box('Light tile', [T - 0.15, 0.12, T - 0.15], L((i - (n - 1) / 2) * T, 0.15, (j - (n - 1) / 2) * T), set[(i * 2 + j * 3 + ((i * j) % 2)) % set.length], BLACK))
    return parts
  }) },
  vipbooth: { category: 'Venues', label: 'VIP booth', hint: 'A raised U-shaped velvet booth with a table, behind a rope line', make: pf('VIP booth', (L) => [
    box('Booth floor', [10, 0.6, 9], L(0, 0, 0), CARPET, GOLD),
    box('Seat', [8, 1, 2], L(0, 0.6, -2.6), VELVET), { ...box('Back', [9, 2.4, 0.7], L(0, 0.6, -3.75), VELVET), bevel: 0.25 },
    ...[-1, 1].flatMap((s) => [box('Seat', [2, 1, 4.2], L(s * 3.5, 0.6, 0.5), VELVET), { ...box('Back', [0.7, 2.4, 6.6], L(s * 4.5, 0.6, -0.3), VELVET), bevel: 0.25 }]),
    cyl('Table', 3.4, 0.2, L(0, 1.9, 0.2), MARBLE, GOLD, 18), cyl('Table post', 0.5, 1.3, L(0, 0.6, 0.2), GOLD, GOLD, 10),
    { ...cyl('Ice bucket', 0.8, 0.8, L(0.6, 2.1, 0.1), BRUSHED, BRUSHED, 12), taper: 1.2 }, cyl('Bottle', 0.3, 1, L(0.6, 2.3, 0.1), BOTTLE_GREEN, BOTTLE_GREEN, 8),
    ...[-4.6, -1.8, 1.8, 4.6].map((x) => cyl('Rope post', 0.4, 2.2, L(x, 0.6, 4.2), GOLD, GOLD, 10)),
    ...[-1, 1].map((s) => box('Velvet rope', [2.6, 0.2, 0.2], L(s * 3.2, 2.2, 4.2), RED_LEATHER)),
  ]) },
  stagetruss: { category: 'Venues', label: 'Stage with light truss', hint: 'A concert stage with steps at both front corners and a lighting truss overhead', ...pfp('Stage', [num('w', 'Width', 12, 40, 20, 2), num('d', 'Depth', 8, 20, 10, 2), neonParam('purple')], (L, p) => {
    const w = +p.w, d = +p.d, h = 2.4, T = 10
    const lights = Math.max(2, Math.floor(w / 4))
    return [
      box('Stage', [w, h, d], L(0, 0, 0), PB.planks, BLACK), box('Stage lip', [w, 0.3, 0.3], L(0, h - 0.3, d / 2 + 0.15), neon(p)),
      ...[-1, 1].map((s) => stairs('Stage steps', [3, h, 2.6], L(s * (w / 2 - 2), 0, d / 2 + 1.3), PB.steel, PB.steel, 0, stepsFor(h))),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box('Truss post', [0.7, T, 0.7], L(sx * (w / 2 - 0.5), h, sz * (d / 2 - 0.5)), BRUSHED))),
      ...[-1, 1].map((sz) => box('Truss', [w - 0.3, 0.7, 0.7], L(0, h + T, sz * (d / 2 - 0.5)), BRUSHED)),
      ...[-1, 1].map((sx) => box('Truss', [0.7, 0.7, d - 1.7], L(sx * (w / 2 - 0.5), h + T, 0), BRUSHED)),
      ...[...Array(lights)].map((_, i) => ({ ...cyl('Stage light', 0.7, 0.9, L(-w / 2 + 2 + (i * (w - 4)) / (lights - 1), h + T - 0.9, d / 2 - 0.5), BLACK, i % 2 ? neon(p) : CY.white, 10), taper: 0.7 })),
      box('Backdrop', [w - 1.4, T - 1, 0.2], L(0, h, -d / 2 + 0.5), BLACK, neon(p), 0, 6),
      cyl('Mic stand', 0.15, 3.2, L(0, h, d / 2 - 2), BLACK, BLACK, 6), cyl('Mic stand foot', 0.9, 0.08, L(0, h, d / 2 - 2), BLACK, BLACK, 5),
    ]
  }) },
  backbar: { category: 'Venues', label: 'Back bar', hint: 'Bar shelving full of bottles with a mirror and a glowing strip (set it behind a bar counter)', ...pfp('Back bar', [num('len', 'Length', 6, 24, 12, 2), neonParam('pink')], (L, p) => {
    const len = +p.len, n = Math.max(3, Math.floor(len / 0.75)), kinds = [BOTTLE_GREEN, BOTTLE_AMBER, BOTTLE_CLEAR, BOTTLE_AMBER]
    return [
      box('Back bar cabinet', [len, 2.3, 1.6], L(0, 0, 0), DARK_WOOD), box('Cabinet top', [len + 0.2, 0.12, 1.7], L(0, 2.3, 0), MARBLE),
      box('Mirror back', [len, 4.2, 0.2], L(0, 2.42, -0.7), MIRROR, DARK_WOOD), ...[-1, 1].map((s) => box('Shelf end', [0.25, 4.2, 1], L(s * (len / 2 - 0.125), 2.42, -0.2), DARK_WOOD)),
      ...[3.6, 4.8].map((y) => box('Glass shelf', [len - 0.5, 0.1, 0.9], L(0, y, -0.2), GLASS)),
      ...[2.42, 3.7, 4.9].flatMap((y, t) => [...Array(n)].map((_, i) => cyl('Bottle', 0.35, 0.9 - ((i + t) % 3) * 0.12, L(-len / 2 + 0.6 + (i * (len - 1.2)) / (n - 1), y, -0.25 + (i % 2) * 0.2), kinds[(i + t) % 4], kinds[(i + t) % 4], 8))),
      box('Neon strip', [len - 0.6, 0.25, 0.15], L(0, 6.3, -0.55), neon(p)), ...[-0.3, 0.6].map((x) => cyl('Beer tap', 0.2, 0.9, L(x * len / 2, 2.42, 0.4), GOLD, GOLD, 8)),
    ]
  }) },
  kegs: { category: 'Venues', label: 'Beer kegs', hint: 'A stack of steel kegs, one on its side', ...pfp('Kegs', [num('n', 'Kegs', 1, 6, 5)], (L, p) => {
    const spots: [number, number, number, boolean][] = [[-1.75, 0, 0, false], [0, 0, 0, false], [1.75, 0, 0, false], [-0.88, 2, 0, false], [0.88, 2, 0, false], [0.2, 0, 2.1, true]]
    return spots.slice(0, Math.round(+p.n)).flatMap(([x, y, z, side]) => side
      ? [lying('Keg', 1.6, 2, L(x, y + 0.06, z), BRUSHED, BRUSHED, 14), ...[-0.55, 0.55].map((dx) => lying('Keg rib', 1.72, 0.15, L(x + dx, y, z), GREY_METAL, GREY_METAL, 14))]
      : [cyl('Keg', 1.6, 2, L(x, y, z), BRUSHED, BRUSHED, 14), ...[0.4, 1.45].map((dy) => cyl('Keg rib', 1.72, 0.15, L(x, y + dy, z), GREY_METAL, GREY_METAL, 14)), cyl('Keg valve', 0.3, 0.15, L(x, y + 2, z), BLACK, BLACK, 8)])
  }) },
  hightables: { category: 'Venues', label: 'High tables', hint: 'Round standing tables with bar stools', ...pfp('High tables', [num('n', 'Tables', 1, 6, 3), yesNo('stools', 'Stools', 'yes')], (L, p) => row(L, +p.n, 5, (M) => [
    cyl('Table foot', 1.4, 0.1, M(0, 0, 0), BLACK, BLACK, 12), cyl('Table post', 0.25, 2.3, M(0, 0.1, 0), BRUSHED, BRUSHED, 8), cyl('Table top', 2.2, 0.15, M(0, 2.4, 0), DARK_WOOD, BLACK, 16),
    ...(p.stools === 'yes' ? [...at(M, -1.6, 0.4, 0, stool), ...at(M, 1.6, -0.4, 0, stool)] : []),
  ])) },
  clothesrack: { category: 'Venues', label: 'Clothes rail', hint: 'A rolling clothes rail full of shirts and coats', ...pfp('Clothes rail', [num('len', 'Length', 3, 12, 6, 0.5)], (L, p) => {
    const len = +p.len, n = Math.max(2, Math.floor((len - 0.6) / 0.45))
    return [
      ...[-1, 1].flatMap((s) => [box('Rail upright', [0.15, 4, 0.15], L(s * len / 2, 0.3, 0), BRUSHED), box('Rail foot', [0.15, 0.15, 1.8], L(s * len / 2, 0.3, 0), BRUSHED),
        ...[-0.8, 0.8].map((z) => cyl('Caster', 0.3, 0.3, L(s * len / 2, 0, z), BLACK, BLACK, 8))]),
      lying('Rail', 0.15, len, L(0, 4.15, 0), BRUSHED, BRUSHED, 8),
      ...[...Array(n)].map((_, i) => box('Garment', [0.3, 2 + (i % 3) * 0.4, 1.5], L(-len / 2 + 0.5 + (i * (len - 1)) / (n - 1), 4.2 - (2 + (i % 3) * 0.4), 0), GARMENTS[i % GARMENTS.length])),
    ]
  }) },
  mannequins: { category: 'Venues', label: 'Mannequins', hint: 'Shop-window mannequins in a row, dressed in colours', ...pfp('Mannequins', [num('n', 'Mannequins', 1, 6, 3)], (L, p) => row(L, +p.n, 2.6, (M, i) => {
    const top = GARMENTS[i % GARMENTS.length], bottom = [PB.black, PB.blue, LINEN][i % 3]
    return [
      cyl('Stand', 1.2, 0.1, M(0, 0, 0), BLACK, BLACK, 12),
      ...[-1, 1].map((s) => box('Leg', [0.4, 1.6, 0.45], M(s * 0.25, 0.1, 0), bottom)),
      { ...oval('Torso', 1.3, 1.2, 0.7, M(0, 1.7, 0), top, top, 12), taper: 1.15 },
      ...[-1, 1].map((s) => box('Arm', [0.28, 1.4, 0.32], M(s * 0.86, 1.5, 0), top)),
      cyl('Neck', 0.3, 0.25, M(0, 2.9, 0), WHITE, WHITE, 8), { ...oval('Head', 0.6, 0.65, 0.7, M(0, 3.15, 0), WHITE, WHITE, 12), taper: 0.8 },
    ]
  })) },
  checkout: { category: 'Venues', label: 'Checkout lanes', hint: 'Supermarket checkouts with belts, tills and bagging areas', ...pfp('Checkouts', [num('n', 'Lanes', 1, 6, 2)], (L, p) => row(L, +p.n, 6, (M, i) => [
    box('Checkout', [2.4, 1.8, 7], M(0, 0, 0), BLACK, WHITE), box('Belt', [1.6, 0.06, 4.4], M(0, 1.8, 1.1), PB.tire),
    box('Scanner', [1.4, 0.1, 1], M(0, 1.8, -1.7), GLASS), box('Bagging shelf', [2.4, 0.1, 1.6], M(0, 1.8, -2.7), BRUSHED),
    box('Till', [1.2, 0.6, 1], M(-1.1, 1.8, -1.6), BLACK), box('Till screen', [0.9, 0.7, 0.1], M(-1.2, 2.4, -1.9), BLACK, SCREEN),
    cyl('Lane light pole', 0.15, 2.8, M(1, 1.8, -3.2), BRUSHED, BRUSHED, 6), box('Lane number', [0.8, 0.8, 0.15], M(1, 4.6, -3.2), CY.white, i % 2 ? PB.green : PB.red),
    box('Cashier mat', [1.6, 0.06, 2.4], M(-2.2, 0, -1.8), MAT),
  ])) },
  endcap: { category: 'Venues', label: 'Shelf end display', hint: 'A promo end-cap display with stepped shelves and a sale sign', ...pfp('End display', [sel('color', 'Sign', [['red', 'Red'], ['yellow', 'Yellow'], ['blue', 'Blue']], 'red')], (L, p) => {
    const sign = p.color === 'yellow' ? PB.yellow : p.color === 'blue' ? PB.blue : PB.red, goods = [PB.red, PB.blue, PB.yellow, PB.green, PB.orange, WHITE]
    return [
      box('Display base', [5, 0.5, 2.6], L(0, 0, 0), PB.steel), box('Display back', [5, 5, 0.2], L(0, 0.5, -1.2), PB.steel, sign),
      // Shelves stepping back toward the top, each fixed to the back panel.
      ...[[0.5, 2.4], [1.9, 1.7], [3.3, 1.1]].flatMap(([y, dd], k) => [
        box('Shelf', [5, 0.12, dd], L(0, y, -1.1 + dd / 2), PB.steel),
        ...[-1.9, -0.65, 0.65, 1.9].map((x, j) => box('Goods', [1.1, 1 - (j % 2) * 0.2, dd - 0.2], L(x, y + 0.12, -1.1 + dd / 2), goods[(k + j) % goods.length])),
      ]),
      box('Sale sign', [5, 1.2, 0.3], L(0, 5.5, -1.2), sign, sign), box('Sign stripe', [4, 0.3, 0.06], L(0, 5.95, -1.02), WHITE),
    ]
  }) },
  cardtable: { category: 'Venues', label: 'Card table', hint: 'An oval casino card table with chips and chairs round it', ...pfp('Card table', [num('seats', 'Seats', 3, 9, 7)], (L, p) => {
    const n = Math.round(+p.seats)
    return [
      oval('Table rim', 8, 0.3, 5, L(0, 1.25, 0), LEATHER, LEATHER), oval('Felt', 7.2, 0.32, 4.2, L(0, 1.26, 0), FELT, LEATHER),
      { ...oval('Pedestal', 2.4, 1.25, 1.4, L(0, 0, 0), BLACK), taper: 1.4 },
      ...[...Array(n)].flatMap((_, i) => {
        // Round the table except the dealer's side (−Z).
        const a = Math.PI * (-0.25 + (1.5 * i) / Math.max(1, n - 1)), x = Math.cos(a) * 5.4, z = Math.sin(a) * 3.8
        const cx = Math.cos(a) * 3, cz = Math.sin(a) * 1.7
        return [...at(L, x, z, facing(x, z), (M) => chair(M, RED_LEATHER)), ...[0, 1, 2].map((k) => cyl('Chips', 0.4, 0.12 + k * 0.08, L(cx + k * 0.42 - 0.42, 1.58, cz), CHIPS[(i + k) % 4], CHIPS[(i + k) % 4], 10))]
      }),
      box('Dealer tray', [1.8, 0.1, 0.7], L(0, 1.58, -1.6), BLACK), ...at(L, 0, -3.6, 0, (M) => stool(M, 2)),
    ]
  }) },
  roulette: { category: 'Venues', label: 'Roulette table', hint: 'A roulette wheel at the head of a betting table, chairs down one side', make: pf('Roulette', (L) => [
    box('Table', [4.4, 1.4, 9.6], L(0, 0, 0), DARK_WOOD), box('Betting felt', [3.8, 0.1, 6], L(0, 1.4, 1.4), FELT),
    box('Number grid', [2.4, 0.11, 4.8], L(0, 1.41, 1.6), pattern('#1f6b3a', '#f2f2ee', 12, 641)), box('Rail', [4.6, 0.25, 9.8], L(0, 1.15, 0), LEATHER),
    cyl('Wheel bowl', 3.6, 0.5, L(0, 1.4, -3), DARK_WOOD, DARK_WOOD, 20), cyl('Wheel', 3, 0.15, L(0, 1.9, -3), ROULETTE, GOLD, 20),
    cyl('Spindle', 0.3, 0.6, L(0, 2.05, -3), GOLD, GOLD, 8), box('Spindle arm', [1, 0.08, 0.08], L(0, 2.55, -3), GOLD),
    ...[-0.6, 1.6, 3.8].flatMap((z) => at(L, 3.4, z, 270, (M) => chair(M, RED_LEATHER))), ...at(L, -3.2, -3, 90, (M) => stool(M, 2)),
    ...[0, 1, 2].map((k) => cyl('Chips', 0.4, 0.2, L(1.3, 1.5, 1 + k * 1.4), CHIPS[k], CHIPS[k], 10)),
  ]) },
  slotmachines: { category: 'Venues', label: 'Slot machines', hint: 'A bank of glowing slot machines with stools', ...pfp('Slot machines', [num('n', 'Machines', 1, 8, 4), neonParam('orange'), yesNo('stools', 'Stools', 'yes')], (L, p) => row(L, +p.n, 2.3, (M, i) => [
    { ...box('Slot machine', [2.1, 3.6, 1.8], M(0, 0, 0), BLACK, i % 2 ? PB.red : BLACK), bevel: 0.08 },
    box('Reels', [1.5, 1.1, 0.1], M(0, 2, 0.9), SCREEN), box('Topper', [2.1, 1.1, 1.4], M(0, 3.6, -0.1), neon(p), BLACK),
    box('Button deck', [2.1, 0.25, 0.7], M(0, 1.5, 1.1), BLACK), ...[-0.5, 0, 0.5].map((x) => box('Button', [0.3, 0.08, 0.3], M(x, 1.75, 1.2), PB.yellow)),
    box('Lever', [0.12, 1.2, 0.12], M(1.12, 2, 0.4), BRUSHED), cyl('Lever knob', 0.35, 0.35, M(1.12, 3.15, 0.4), PB.red, PB.red, 10),
    ...(p.stools === 'yes' ? at(M, 0, 2, 0, (N) => stool(N, 1.6)) : []),
  ])) },
  bowlingalley: { category: 'Venues', label: 'Bowling alley', hint: 'Bowling lanes with gutters, pins, ball returns and seats (static: the Physics set has a lane with pins that fall)', ...pfp('Bowling alley', [num('n', 'Lanes', 1, 6, 2), num('len', 'Lane length', 16, 40, 28, 2)], (L, p) => {
    const n = Math.round(+p.n), len = +p.len, LW = 2.4, G = 0.5, P = LW + 2 * G + 0.5, W = n * P
    // Lanes run along Z with the pins at −Z; the approach, ball returns and seats are at +Z.
    const parts: Part[] = [
      box('Alley floor', [W + 0.5, 0.15, len + 13], L(0, 0, 3.5), BLACK, BLACK), box('Approach', [W + 0.5, 0.2, 8], L(0, 0.15, len / 2 + 4), LANE),
      box('Pin deck wall', [W + 0.5, 6, 1], L(0, 0, -len / 2 - 1.5), BLACK, CY.purple),
      box('Masking panel', [W + 0.5, 1.5, 3], L(0, 4.5, -len / 2 + 0.5), CY.purple, BLACK),
    ]
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + P / 2 + i * P
      parts.push(box('Lane', [LW, 0.2, len], L(x, 0.15, 0), LANE), box('Divider', [0.5, 0.45, len], L(x + P / 2 - 0.25, 0.15, 0), BRUSHED))
      if (i === 0) parts.push(box('Divider', [0.5, 0.45, len], L(x - P / 2 + 0.25, 0.15, 0), BRUSHED))
      for (let r = 0; r < 4; r++) for (let k = 0; k <= r; k++) parts.push({ ...cyl('Pin', 0.36, 1.2, L(x + (k - r / 2) * 0.55, 0.35, -len / 2 + 2.4 - r * 0.5), WHITE, WHITE, 8), taper: 0.6 })
      parts.push({ ...box('Ball return', [1, 1.3, 2.6], L(x + P / 2 - 0.25, 0.35, len / 2 + 3), BLACK, PB.blue), bevel: 0.3 },
        ...[0, 1].map((k) => ({ ...cyl('Bowling ball', 0.7, 0.7, L(x + P / 2 - 0.25, 1.65, len / 2 + 2.4 + k * 0.8), PB.red, PB.red, 10), taper: 0.6 })),
        ...at(L, x, len / 2 + 7, 180, (M) => [box('Bench seat', [2.6, 1, 1.4], M(0, 0.35, 0), RED_LEATHER), box('Bench back', [2.6, 1.6, 0.3], M(0, 1.35, -0.55), RED_LEATHER)]))
    }
    return parts
  }) },
  poolhall: { category: 'Venues', label: 'Pool hall set', hint: 'Pool tables under hanging lamps, a cue rack and high stools', ...pfp('Pool hall', [num('n', 'Tables', 1, 4, 2)], (L, p) => [
    ...row(L, +p.n, 9, (M) => [
      { ...box('Pool table', [4.4, 1.5, 8], M(0, 0.2, 0), DARK_WOOD), bevel: 0.15 }, box('Felt', [3.8, 0.12, 7.4], M(0, 1.7, 0), FELT),
      ...[-1, 1].map((sx) => box('Rail', [0.3, 0.3, 8], M(sx * 2.05, 1.7, 0), DARK_WOOD)), ...[-1, 1].map((sz) => box('Rail', [4.4, 0.3, 0.3], M(0, 1.7, sz * 3.85), DARK_WOOD)),
      ...legs(M, 4, 7.4, 0.2, DARK_WOOD, 0.6), ...[[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]].map(([a, b]) => cyl('Pocket', 0.5, 0.31, M(a * 1.95, 1.72, b * 3.75), BLACK, BLACK, 8)),
      { ...box('Table lamp', [2.4, 0.5, 6], M(0, 6.1, 0), PB.green, PB.green), bevel: 0.15 }, ...[-2, 2].map((z) => box('Lamp cord', [0.06, 0.4, 0.06], M(0, 6.6, z), BLACK)),
    ]),
    ...at(L, 0, -6.6, 0, (M) => [
      box('Cue rack', [3.6, 4.4, 0.3], M(0, 0, 0), DARK_WOOD), ...[...Array(7)].map((_, i) => box('Cue', [0.1, 4.6, 0.1], M(-1.5 + i * 0.5, 0.2, 0.25), LIGHT_WOOD)),
    ]),
    ...[-1, 1].flatMap((s) => at(L, s * (+p.n * 4.5 + 1.5), 0, 0, stool)),
  ]) },
}

// ---------------- home ----------------

const HOME: Record<string, PrefabDef & { category: string }> = {
  tvwall: { category: 'Furniture', label: 'TV wall unit', hint: 'A media wall with a big TV, cabinets, shelves of books and a games console', ...pfp('TV wall', [woodParam('dark')], (L, p) => {
    const tex = woodTex(p)
    return [
      box('Back panel', [11, 6, 0.3], L(0, 0, -0.95), tex), box('Media cabinet', [7, 1.4, 1.6], L(0, 0, 0), tex), ...drawers(L, 6.6, 1, 0.1, 1.2, 0.81),
      box('TV', [5.6, 3.2, 0.25], L(0, 2.1, -0.67), BLACK, SCREEN), box('Sound bar', [3.4, 0.35, 0.5], L(0, 1.4, 0.2), BLACK), box('Console', [1.2, 0.35, 1], L(2.4, 1.4, 0.1), WHITE),
      ...[-1, 1].flatMap((s) => [
        ...[-1, 1].map((t) => box('Shelf side', [0.15, 6, 1.4], L(s * 4.5 + t * 0.925, 0, -0.1), tex)),
        ...[0, 1.4, 2.9, 4.4, 5.88].map((y) => box('Shelf', [1.7, 0.12, 1.4], L(s * 4.5, y, -0.1), tex)),
        ...[1.4, 2.9, 4.4].flatMap((y, k) => [0, 1].map((j) => box('Books', [0.75, 1.1 - ((k + j) % 2) * 0.25, 1], L(s * 4.5 + (j - 0.5) * 0.8, y + 0.12, -0.1), BOOKS[(k * 2 + j + (s > 0 ? 3 : 0)) % BOOKS.length]))),
      ]),
    ]
  }) },
  bunkbeds: { category: 'Furniture', label: 'Bunk beds', hint: 'Bunk beds with a ladder, in a row for a dorm or barracks', ...pfp('Bunk beds', [num('n', 'Bunks', 1, 6, 1), sel('frame', 'Frame', [['metal', 'Metal'], ['wood', 'Wood']], 'metal')], (L, p) => {
    const tex = p.frame === 'wood' ? LIGHT_WOOD : GREY_METAL
    return row(L, +p.n, 4.6, (M, i) => [
      ...legs(M, 3.4, 6.8, 6.4, tex, 0.25),
      ...[0.9, 3.9].flatMap((y) => [box('Bunk frame', [3.4, 0.3, 6.8], M(0, y, 0), tex), { ...box('Mattress', [3, 0.5, 6.4], M(0, y + 0.3, 0), LINEN), bevel: 0.15 },
        box('Blanket', [3.1, 0.12, 4], M(0, y + 0.8, 1), [PB.blue, PB.green, PB.red][i % 3]), box('Pillow', [2, 0.3, 0.9], M(0, y + 0.8, -2.5), WHITE)]),
      box('Guard rail', [0.15, 0.8, 4], M(-1.6, 4.7, -1), tex),
      box('Ladder rail', [0.12, 4.8, 0.12], M(1.75, 0, 2.2), tex), box('Ladder rail', [0.12, 4.8, 0.12], M(1.75, 0, 3.2), tex),
      ...[1, 2, 3, 4].map((k) => box('Rung', [0.12, 0.12, 1], M(1.75, k * 1.1, 2.7), tex)),
    ])
  }) },
  wardrobe: { category: 'Furniture', label: 'Wardrobe', hint: 'A tall two-door wardrobe (good for hide and seek, if only it opened)', ...pfp('Wardrobe', [num('w', 'Width', 2, 8, 4, 0.5), woodParam('dark')], (L, p) => {
    const w = +p.w, tex = woodTex(p)
    return [
      { ...box('Wardrobe', [w, 6.2, 2.2], L(0, 0.2, 0), tex), bevel: 0.04 }, box('Plinth', [w - 0.2, 0.2, 2], L(0, 0, 0), BLACK),
      box('Cornice', [w + 0.3, 0.3, 2.5], L(0, 6.4, 0), tex), box('Door line', [0.06, 5.8, 0.05], L(0, 0.4, 1.11), BLACK),
      ...[-1, 1].map((s) => box('Handle', [0.12, 0.8, 0.12], L(s * 0.35, 2.8, 1.15), GOLD)),
    ]
  }) },
  rug: { category: 'Furniture', label: 'Rug', hint: 'A floor rug with a border, square or round', ...pfp('Rug', [num('w', 'Width', 2, 20, 8, 0.5), num('d', 'Length', 2, 20, 6, 0.5), sel('shape', 'Shape', [['rect', 'Rectangle'], ['round', 'Round']], 'rect'),
    sel('color', 'Colors', [['red', 'Red and gold'], ['blue', 'Blue and cream'], ['green', 'Green and tan'], ['grey', 'Grey']], 'red')], (L, p) => {
    const w = +p.w, d = +p.d
    const [main, edge] = ({ red: [pattern('#8a1e22', '#c9a23a', 6, 642), solid('#c9a23a', '#8a6a1a', 643)], blue: [pattern('#2a4a7a', '#e6dcc4', 6, 644), solid('#e6dcc4', '#c4b89e', 645)],
      green: [pattern('#2f5a3a', '#b89a6a', 6, 646), solid('#b89a6a', '#8a7048', 647)], grey: [pattern('#5d6268', '#8d9298', 8, 648), solid('#2a2c30', '#1d1d20', 649)] } as Record<string, Tex[]>)[String(p.color)] ?? []
    if (p.shape === 'round') return [oval('Rug border', w, 0.04, d, L(0, 0, 0), edge ?? WHITE, edge ?? WHITE, 24), oval('Rug', Math.max(0.5, w - 0.8), 0.08, Math.max(0.5, d - 0.8), L(0, 0, 0), main ?? WHITE, edge ?? WHITE, 24)]
    return [box('Rug border', [w, 0.04, d], L(0, 0, 0), edge ?? WHITE), box('Rug', [Math.max(0.5, w - 0.8), 0.08, Math.max(0.5, d - 0.8)], L(0, 0, 0), main ?? WHITE, edge ?? WHITE)]
  }) },
  libraryshelves: { category: 'Furniture', label: 'Library stacks', hint: 'Rows of tall double-sided bookshelves with aisles between', ...pfp('Library stacks', [num('rows', 'Rows', 1, 6, 3), num('len', 'Length', 4, 20, 10, 2)], (L, p) => {
    const len = +p.len, rows = Math.round(+p.rows), blocks = Math.max(1, Math.round(len / 3.3))
    return [...Array(rows)].flatMap((_, r) => at(L, 0, (r - (rows - 1) / 2) * 6, 0, (M) => [
      box('Stack back', [len, 6, 0.2], M(0, 0, 0), DARK_WOOD), ...[-1, 1].map((s) => box('Stack end', [0.3, 6.2, 2.6], M(s * (len / 2 + 0.15), 0, 0), DARK_WOOD)),
      box('Stack top', [len, 0.2, 2.6], M(0, 6, 0), DARK_WOOD),
      ...[0, 1.5, 3, 4.5].flatMap((y, k) => [-1, 1].flatMap((s) => [
        box('Shelf', [len, 0.15, 1.2], M(0, y, s * 0.7), DARK_WOOD),
        ...[...Array(blocks)].map((_, b) => box('Books', [len / blocks - 0.3, 1.1 - ((b + k) % 2) * 0.2, 1], M(-len / 2 + (b + 0.5) * (len / blocks), y + 0.15, s * 0.7), BOOKS[(b + k * 2 + r + (s > 0 ? 1 : 0)) % BOOKS.length])),
      ])),
    ]))
  }) },
}

// ---------------- building pieces: stairs, walls, frames, cells ----------------

/** A rail post and a level rail piece above every step, so the rail climbs with the stairs. */
function stepRails(L: Lf, w: number, h: number, len: number, n: number, sides: number[]): Part[] {
  const rise = h / n, run = len / n
  return sides.flatMap((s) => [...Array(n)].flatMap((_, i) => {
    const z = len / 2 - (i + 0.5) * run, top = (i + 1) * rise
    return [box('Rail post', [0.12, 2, 0.12], L(s * (w / 2 - 0.1), top, z), BRUSHED), box('Handrail', [0.18, 0.15, run + 0.05], L(s * (w / 2 - 0.1), top + 2, z), DARK_WOOD)]
  }))
}

const BUILD: Record<string, PrefabDef & { category: string }> = {
  stairsrail: { category: 'Rooms', label: 'Staircase', hint: 'A straight flight with handrails, steps low enough to walk up, and an optional landing block at the top', ...pfp('Staircase', [num('h', 'Height', 1, 16, 7, 0.5), num('w', 'Width', 3, 10, 4, 0.5),
    sel('rails', 'Handrails', [['both', 'Both sides'], ['left', 'Left'], ['right', 'Right'], ['none', 'None']], 'both'), yesNo('landing', 'Landing at the top', 'no'), sel('mat', 'Material', [['concrete', 'Concrete'], ['wood', 'Wood'], ['steel', 'Steel']], 'concrete')], (L, p) => {
    const h = +p.h, w = +p.w, n = stepsFor(h), len = n * 0.9
    const tex = p.mat === 'wood' ? LIGHT_WOOD : p.mat === 'steel' ? PB.diamond : CONCRETE, side = p.mat === 'steel' ? PB.steel : p.mat === 'wood' ? DARK_WOOD : PB.darkConcrete
    const sides = p.rails === 'both' ? [-1, 1] : p.rails === 'left' ? [-1] : p.rails === 'right' ? [1] : []
    return [
      stairs('Stairs', [w, h, len], L(0, 0, 0), tex, side, 0, n), ...stepRails(L, w, h, len, n, sides),
      ...(p.landing === 'yes' ? [box('Landing', [w, h, 4], L(0, 0, -len / 2 - 2), tex, side)] : []),
    ]
  }) },
  lstairs: { category: 'Rooms', label: 'L-shaped stairs', hint: 'Two flights turning at a landing on posts, rising to a top platform', ...pfp('L stairs', [num('h', 'Height', 3, 16, 7, 0.5), num('w', 'Width', 3, 8, 4, 0.5), sel('turn', 'Turns', [['left', 'Left'], ['right', 'Right']], 'left'),
    sel('mat', 'Material', [['concrete', 'Concrete'], ['wood', 'Wood'], ['steel', 'Steel']], 'steel')], (L, p) => {
    const h = +p.h, w = +p.w, h1 = Math.round(h / 1.2) * 0.6 || 0.6, h2 = h - h1, s = p.turn === 'right' ? 1 : -1
    const n1 = stepsFor(h1), n2 = stepsFor(h2), l1 = n1 * 0.9, l2 = n2 * 0.9
    const tex = p.mat === 'wood' ? LIGHT_WOOD : p.mat === 'steel' ? PB.diamond : CONCRETE, side = p.mat === 'steel' ? PB.steel : p.mat === 'wood' ? DARK_WOOD : PB.darkConcrete
    const lz = -l1 - w / 2 // landing centre
    const parts: Part[] = [
      stairs('Stairs', [w, h1, l1], L(0, 0, -l1 / 2), tex, side, 0, n1),
      box('Landing', [w, 0.4, w], L(0, h1 - 0.4, lz), tex, side), ...legs((dx, dy, dz) => L(dx, dy, lz + dz), w, w, h1 - 0.4, side, 0.4),
      stairs('Stairs', [w, h2, l2], L(s * (w / 2 + l2 / 2), h1, lz), tex, side, s > 0 ? 270 : 90, n2),
      box('Top platform', [3, 0.4, w], L(s * (w / 2 + l2 + 1.5), h - 0.4, lz), tex, side),
      ...[-1, 1].map((t) => box('Platform post', [0.4, h - 0.4, 0.4], L(s * (w / 2 + l2 + 2.8), 0, lz + t * (w / 2 - 0.2)), side)),
      ...[-1, 1].map((t) => box('Stair post', [0.4, h1, 0.4], L(s * (w / 2 + l2 - 0.3), 0, lz + t * (w / 2 - 0.2)), side)),
      // Rails taller than a step, so nobody walks straight off the landing.
      box('Landing rail', [w, 1.8, 0.15], L(0, h1, lz - w / 2 + 0.08), BRUSHED), box('Landing rail', [0.15, 1.8, w], L(-s * (w / 2 - 0.08), h1, lz), BRUSHED),
    ]
    return parts
  }) },
  spiralstairs: { category: 'Rooms', label: 'Spiral staircase', hint: 'Steps winding round a central post, with an outer rail and a landing at the top', ...pfp('Spiral stairs', [num('h', 'Height', 3, 24, 8, 0.5), sel('dir', 'Winds', [['ccw', 'Counter-clockwise'], ['cw', 'Clockwise']], 'ccw'),
    sel('mat', 'Material', [['steel', 'Steel'], ['wood', 'Wood'], ['cyber', 'Cyber']], 'steel')], (L, p) => {
    const h = +p.h, n = stepsFor(h), rise = h / n, R = 4.2, step = (p.dir === 'cw' ? -1 : 1) * 30
    const tex = p.mat === 'wood' ? LIGHT_WOOD : p.mat === 'cyber' ? CY.gridCyan : PB.diamond, post = p.mat === 'cyber' ? CY.panel : PB.steel
    const parts: Part[] = [cyl('Centre post', 1.2, h + 2.2, L(0, 0, 0), post, post, 12)]
    for (let i = 0; i < n; i++) {
      const a = i * step, top = (i + 1) * rise, [x, z] = turn(R / 2 + 0.4, 0, a), [rx, rz] = turn(R + 0.3, 0, a)
      parts.push(box('Step', [R, 0.35, 2.4], L(x, top - 0.35, z), tex, post, a))
      parts.push(box('Rail post', [0.12, 2.2, 0.12], L(rx, top, rz), BRUSHED))
    }
    const a = n * step, [x, z] = turn(R / 2 + 0.4, 0, a)
    parts.push(box('Top landing', [R + 0.8, 0.4, 3.4], L(x, h - 0.4, z), tex, post, a))
    return parts
  }) },
  interiorwall: { category: 'Rooms', label: 'Wall panel', hint: 'A modular interior wall: plain, with a door, a window, a double door or a wide archway. Butt them together to make rooms', ...pfp('Wall panel', [num('len', 'Length', 2, 40, 10, 1), num('h', 'Height', 3, 16, 7, 0.5),
    sel('opening', 'Opening', [['none', 'None'], ['door', 'Door'], ['window', 'Window'], ['doorwindow', 'Door and window'], ['double', 'Double door'], ['wide', 'Wide archway'], ['slot', 'Shooting slot']], 'door'),
    num('t', 'Thickness', 0.3, 2, 0.5, 0.1), wallParam('plaster')], (L, p) => {
    const len = +p.len, h = +p.h, t = +p.t, gaps: Gap[] = ({
      none: [], door: [{ at: 0, w: 4, h: 5.6 }], window: [{ at: 0, w: Math.min(len - 2, 4), h: 2.6, sill: 2.4 }],
      doorwindow: [{ at: -len / 4, w: 4, h: 5.6 }, { at: len / 4, w: Math.min(len / 2 - 2, 4), h: 2.6, sill: 2.4 }],
      double: [{ at: 0, w: 7, h: 5.8 }], wide: [{ at: 0, w: Math.max(2, len - 2), h: Math.min(h - 0.6, 6.5) }], slot: [{ at: 0, w: Math.min(len - 2, 3), h: 0.8, sill: 3 }],
    } as Record<string, Gap[]>)[String(p.opening)] ?? []
    return wallX(L, -len / 2, len / 2, h, t, wallTex(p), wallTop(p), gaps, 'Wall')
  }) },
  doorframe: { category: 'Rooms', label: 'Door frame', hint: 'A freestanding doorway or arch: square, round-topped (stepped) or a glowing gate', ...pfp('Door frame', [num('w', 'Opening width', 3, 14, 4, 0.5), num('h', 'Opening height', 4, 12, 5.6, 0.2),
    sel('shape', 'Shape', [['square', 'Square'], ['arch', 'Arched']], 'square'), sel('mat', 'Material', [['wood', 'Wood'], ['stone', 'Stone'], ['steel', 'Steel'], ['neon', 'Neon']], 'wood')], (L, p) => {
    const w = +p.w, h = +p.h, J = 0.7, D = 1.2
    const tex = p.mat === 'stone' ? { lib: 'medieval_blocks_03', surface: 0 } as Tex : p.mat === 'steel' ? PB.steel : p.mat === 'neon' ? CY.cyan : DARK_WOOD
    const parts: Part[] = [...[-1, 1].map((s) => box('Jamb', [J, h + J, D], L(s * (w / 2 + J / 2), 0, 0), tex)), box('Threshold', [w, 0.1, D], L(0, 0, 0), tex)]
    if (p.shape === 'arch') {
      // A round top built from upright slices, its crown at the opening height.
      const r = Math.min(w / 2, h - 0.5), k = 8, spring = h - r
      for (let i = 0; i < k; i++) {
        const x0 = -r + (i * w) / k, x1 = x0 + w / k, xm = Math.max(Math.abs(x0), Math.abs(x1))
        const y = spring + Math.sqrt(Math.max(0, r * r - xm * xm))
        parts.push(box('Arch stone', [w / k + 0.02, h + J - y, D], L((x0 + x1) / 2, y, 0), tex))
      }
    } else parts.push(box('Lintel', [w + 2 * J, J, D], L(0, h, 0), tex))
    return parts
  }) },
  pillar: { category: 'Rooms', label: 'Pillar', hint: 'A square or round column with a base and capital, for halls and lobbies; good cover too', ...pfp('Pillar', [num('h', 'Height', 3, 30, 7, 0.5), num('w', 'Thickness', 1, 6, 2, 0.5), sel('shape', 'Shape', [['square', 'Square'], ['round', 'Round']], 'square'),
    sel('mat', 'Material', [['concrete', 'Concrete'], ['marble', 'Marble'], ['brick', 'Brick'], ['steel', 'Steel'], ['cyber', 'Cyber']], 'marble')], (L, p) => {
    const h = +p.h, w = +p.w, tex = ({ concrete: CONCRETE, marble: MARBLE, brick: PB.brick, steel: PB.steel, cyber: CY.panel } as Record<string, Tex>)[String(p.mat)] ?? MARBLE
    const trim = p.mat === 'cyber' ? CY.cyan : p.mat === 'brick' ? CONCRETE : tex
    const shaft: Part = p.shape === 'round' ? cyl('Pillar', w, h - 0.8, L(0, 0.4, 0), tex, tex, 16) : box('Pillar', [w, h - 0.8, w], L(0, 0.4, 0), tex, tex)
    return [box('Pillar base', [w + 0.6, 0.4, w + 0.6], L(0, 0, 0), trim), shaft, box('Capital', [w + 0.6, 0.4, w + 0.6], L(0, h - 0.4, 0), trim)]
  }) },
  jailcell: { category: 'Rooms', label: 'Jail cells', hint: 'A row of barred cells with open doors, bunks and toilets', ...pfp('Jail cells', [num('n', 'Cells', 1, 6, 3), yesNo('roof', 'Ceiling', 'yes')], (L, p) => {
    const n = Math.round(+p.n), W = 8, D = 8, H = 7, t = 0.5, len = n * W
    const parts: Part[] = [box('Back wall', [len + t, H, t], L(0, 0, -D / 2), CONCRETE, PB.cinder), box('Floor', [len, 0.15, D], L(0, 0, 0), PB.floorWorn)]
    for (let i = 0; i <= n; i++) parts.push(box('Cell wall', [t, H, D], L(-len / 2 + i * W, 0, 0), CONCRETE, PB.cinder))
    for (let i = 0; i < n; i++) {
      const x0 = -len / 2 + i * W, door0 = x0 + W - 4.5, door1 = door0 + 3.6
      for (let bx = x0 + 0.7; bx < x0 + W - 0.3; bx += 0.75) if (bx < door0 || bx > door1) parts.push(box('Bar', [0.18, H - 0.6, 0.18], L(bx, 0.15, D / 2 - 0.2), CELL_BARS))
      parts.push(box('Bar rail', [door0 - x0 - 0.25, 0.25, 0.25], L((x0 + 0.25 + door0) / 2, 2.6, D / 2 - 0.2), CELL_BARS), box('Bar rail', [x0 + W - 0.25 - door1, 0.25, 0.25], L((door1 + x0 + W - 0.25) / 2, 2.6, D / 2 - 0.2), CELL_BARS))
      parts.push(box('Bar header', [W - t, 0.6, 0.3], L(x0 + W / 2, H - 0.6, D / 2 - 0.2), CELL_BARS))
      // The open door, swung out into the corridor.
      parts.push(...[0.4, 1.2, 2, 2.8].map((dz) => box('Door bar', [0.15, H - 1.2, 0.15], L(door1 + 0.1, 0.3, D / 2 + dz), CELL_BARS)), box('Door rail', [0.2, 0.25, 3.2], L(door1 + 0.1, 2.6, D / 2 + 1.6), CELL_BARS))
      parts.push(box('Bunk', [5, 0.4, 2.2], L(x0 + 3, 1.2, -D / 2 + 1.4), GREY_METAL), ...[-2.2, 2.2].map((dx) => box('Bunk leg', [0.3, 1.05, 2], L(x0 + 3 + dx, 0.15, -D / 2 + 1.4), GREY_METAL)),{ ...box('Thin mattress', [4.8, 0.3, 2], L(x0 + 3, 1.6, -D / 2 + 1.4), LINEN), bevel: 0.1 })
      parts.push(oval('Steel toilet', 1.1, 1, 1.4, L(x0 + W - 1.2, 0.15, -D / 2 + 1.2), BRUSHED, BRUSHED, 12))
    }
    if (p.roof === 'yes') parts.push(box('Ceiling', [len + t, 0.4, D + t], L(0, H, 0), CONCRETE))
    return parts
  }) },
}

export const INTERIOR2_PREFABS: Record<string, PrefabDef & { category: string }> = { ...KITCHEN_BATH, ...WORK, ...GYM, ...VENUES, ...HOME, ...BUILD }
