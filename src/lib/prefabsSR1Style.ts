// "Saints Row style" pieces: an original street kit made here from simple
// shapes, generated textures and the CC0 starter library, with plain generic
// names, sized and proportioned like the objects of the first game's city so
// a custom map reads at the right scale next to the game's own player.
//
// Everything below is written in game metres and turned into editor units
// (1 unit = 0.5 m) as it is built. The numbers follow the city as the game
// builds it, not the real world: doors, storeys, poles and lamps run about
// 1.15 times real size (doors 2.3-2.5 m, storeys 5.2 m, tall street lights
// 13.5 m), while cars match real cars. The player is 1.78 m tall.
//
// Each piece is one object placed with its base at y and its front toward
// local +Z (the way a bench or shop faces), turned by rot. Vehicles are parked
// props with the nose at +Z, like the street car.
import type { Vec3 } from './project'
import { BANNERS } from './procedural'
import { CY, PB, box, cyl, sack, lying, ramp, stairs, turn, type Part, type Tex } from './sampleKit'
import { CAR_COLORS, carPaint, group, local, wheels, type ParamDef, type Params, type PrefabDef } from './prefabs'

type Lf = (dx: number, dy: number, dz: number) => Vec3
type Def = PrefabDef & { category: string }

/** Editor units per game metre. */
const S = 2
const CAT = 'Saints Row style'

const gid = (name: string, x: number, y: number, z: number) => `${name}@${+x.toFixed(2)},${+y.toFixed(2)},${+z.toFixed(2)}`

/**
 * A prefab with settings, written in metres: `L` takes metres; `Lu` is the same
 * frame in editor units, for helpers that work in units (wheels()).
 */
const pfm = (name: string, params: ParamDef[], make: (L: Lf, p: Params, Lu: Lf) => Part[]) => ({
  params,
  make: (x: number, z: number, rot: number, y: number, given?: Params) => {
    const p = Object.fromEntries(params.map((d) => [d.key, given?.[d.key] ?? d.default]))
    return group(gid(name, x, y, z), local(x, y, z, rot, (Lu) => make((a, b, c) => Lu(a * S, b * S, c * S), p, Lu)))
  },
})
const sr = (label: string, hint: string, params: ParamDef[], make: (L: Lf, p: Params, Lu: Lf) => Part[], keywords?: string[]): Def =>
  ({ category: CAT, label, hint, ...(keywords ? { keywords } : {}), ...pfm(label, params, make) })

/** A piece (in its own frame) at (x, z) metres, turned by r, inside another piece's frame. */
const sub = (L: Lf, x: number, z: number, r: number, make: (L: Lf) => Part[], y = 0): Part[] => {
  const L2: Lf = (dx, dy, dz) => { const [ox, oz] = turn(dx, dz, r); return L(x + ox, y + dy, z + oz) }
  return make(L2).map((p) => ({ ...p, rot: ((p.rot ?? 0) + r) % 360 }))
}
/** n copies along X, `gap` metres apart and centered. */
const row = (L: Lf, n: number, gap: number, make: (L: Lf, i: number) => Part[], z = 0, r = 0): Part[] =>
  [...Array(Math.max(0, n))].flatMap((_, i) => sub(L, (i - (n - 1) / 2) * gap, z, r, (M) => make(M, i)))

const num = (key: string, label: string, min: number, max: number, def: number, step = 1): ParamDef => ({ key, label, kind: 'number', min, max, step, default: def })
const sel = (key: string, label: string, options: [string, string][], def: string): ParamDef => ({ key, label, kind: 'select', options, default: def })
const yesNo = (key: string, label: string, def: 'yes' | 'no'): ParamDef => sel(key, label, [['yes', 'Yes'], ['no', 'No']], def)

// ---------------- shapes in metres ----------------

const m3 = (v: Vec3): Vec3 => [v[0] * S, v[1] * S, v[2] * S]
/** Box: size in metres; `tile` = metres per texture repeat. */
const B = (label: string, size: Vec3, at: Vec3, top: Tex, side: Tex = top, rot = 0, tile = 2): Part => box(label, m3(size), at, top, side, rot, tile * S)
/** Round (or n-sided) column, diameter d and height h in metres. */
const C = (label: string, d: number, h: number, at: Vec3, top: Tex, side: Tex = top, sides = 12, rot = 0): Part => cyl(label, d * S, h * S, at, top, side, sides, rot, 4)
/** A cylinder on its side along X: wheels, pipes, lenses facing ±X. `top` paints the upper curve only; the ends take `side`. */
const Y = (label: string, d: number, len: number, at: Vec3, top: Tex, side: Tex = top, sides = 12, rot = 0): Part => lying(label, d * S, len * S, at, top, side, sides, rot)
/** Ramp rising toward −Z. */
const R = (label: string, size: Vec3, at: Vec3, top: Tex, side: Tex = top, rot = 0): Part => ramp(label, m3(size), at, top, side, rot, 4)
/** Stairs rising toward −Z. */
const St = (label: string, size: Vec3, at: Vec3, top: Tex, side: Tex = top, rot = 0, steps = 8): Part => stairs(label, m3(size), at, top, side, rot, steps)
/** Rounded edges, `b` metres, kept under half the piece's thinnest side. */
const bv = (p: Part, b: number): Part => ({ ...p, bevel: +Math.min(b * S, 0.45 * Math.min(...p.size)).toFixed(3) })
const tp = (p: Part, t: number): Part => ({ ...p, taper: t })
/** Texture stretched once over each face (signs, posters, shop fronts). */
const fit = (p: Part): Part => ({ ...p, fit: true })

// ---------------- materials (seeds 900 and up) ----------------

const solid = (color: string, accent: string, seed: number, surface = 17): Tex => ({ gen: 'paint', tweak: { color, accent, scale: 2, wear: 0.06, seed }, surface })
const metal = (color: string, seed: number, wear = 0.25, surface = 15, scale = 2, accent = '#6a3a22'): Tex => ({ gen: 'metal_plate', tweak: { color, accent, scale, wear, seed }, surface })
const conc = (color: string, seed: number, wear = 0.4, accent = '#5e5a54'): Tex => ({ gen: 'concrete', tweak: { color, accent, wear, seed }, surface: 0 })
const wood = (color: string, seed: number, scale = 6, wear = 0.3): Tex => ({ gen: 'wood_planks', tweak: { color, accent: '#4a3624', scale, wear, seed }, surface: 21 })
const grid = (color: string, accent: string, seed: number, scale: number, surface = 14): Tex => ({ gen: 'tiles', tweak: { color, accent, scale, wear: 0.2, seed }, surface })
const poster = (color: string, accent: string, seed: number): Tex => ({ gen: 'poster', tweak: { color, accent, scale: 3, wear: 0.2, seed }, surface: 5 })
const signTex = (color: string, accent: string, seed: number, letters = 6): Tex => ({ gen: 'sign', tweak: { color, accent, scale: letters, wear: 0.12, seed }, surface: 15 })
const tag = (color: string, accent: string, seed: number): Tex => ({ gen: 'graffiti', tweak: { color, accent, scale: 5, wear: 0.4, seed }, surface: 0, alpha: true })
/** A plain printed sign with one of the stock words (see BANNERS). */
const words = (text: string, aspect: number, color: string, accent: string, surface = 16): Tex =>
  ({ gen: 'banner', tweak: { seed: Math.max(0, BANNERS.indexOf(text)), scale: aspect, color, accent, wear: 0.08 }, surface })

// The street car's glass, lights and trim, so they share one texture each.
const GLASS: Tex = { gen: 'paint', tweak: { color: '#25313b', accent: '#1a2229', scale: 2, wear: 0, seed: 330 }, surface: 9 }
const HEADLIGHT: Tex = { gen: 'paint', tweak: { color: '#f4f1e2', accent: '#c9c4ad', scale: 2, wear: 0, seed: 333 }, surface: 9 }
const TAILLIGHT: Tex = { gen: 'paint', tweak: { color: '#c4161c', accent: '#7a0c10', scale: 2, wear: 0, seed: 334 }, surface: 9 }
const TRIM: Tex = { gen: 'metal_plate', tweak: { color: '#1d1d20', accent: '#1d1d20', scale: 2, wear: 0.1, seed: 335 }, surface: 15 }
const CHROME: Tex = { gen: 'metal_plate', tweak: { color: '#b9bcc0', accent: '#8d9094', scale: 1, wear: 0, seed: 336 }, surface: 15 }

const BLACK = solid('#1d1d20', '#141416', 900, 15)
const WHITE = solid('#e8e6e0', '#cfccc4', 901)
const STEEL = metal('#8a9096', 902, 0.2)
const DARK_METAL = metal('#3b3c3d', 903, 0.25)
const HYDRANT = metal('#a8342a', 904, 0.35, 15, 1, '#5a1a14')
const HYDRANT_CAP = metal('#c9c4b8', 905, 0.3, 15, 1)
const NEWSPRINT: Tex = { gen: 'poster', tweak: { color: '#e4dfd2', accent: '#26262a', scale: 6, wear: 0.15, seed: 906 }, surface: 9 }
const MAIL_BLUE = metal('#24477a', 907, 0.2, 16, 1)
const BENCH_SLAT = wood('#3f5a3a', 908, 4, 0.35)
const BENCH_WOOD = wood('#8a6a48', 909, 4, 0.3)
const CAST_IRON = metal('#2a2d2e', 910, 0.2)
const CEMENT = conc('#a9a69e', 911, 0.35)
const PERFORATED = grid('#5f6466', '#3a3d3f', 912, 14, 16)
const BIN_METAL = metal('#6f726f', 913, 0.35, 16)
const STREET_BIN = metal('#3e4038', 914, 0.3)
const BIN_PLASTIC = solid('#3a6688', '#2a4a66', 915)
const BIN_LID = solid('#2a4a66', '#1e3a52', 916)
const METER_GREY = metal('#59585a', 917, 0.25)
const PLANTER = conc('#9a968e', 918, 0.35)
const SOIL: Tex = { gen: 'dirt', tweak: { color: '#4a3a2a', accent: '#2e241a', wear: 0.4, seed: 919 }, surface: 4 }
const SHRUB: Tex = { gen: 'grass', tweak: { color: '#2f5e22', accent: '#4c7a2a', scale: 3, wear: 0.2, seed: 920 }, surface: 7 }
const BARK: Tex = wood('#5a3f2a', 921, 3, 0.4)
const GRATE = grid('#4a4038', '#605444', 922, 10, 15)
const MANHOLE: Tex = { gen: 'diamond_plate', tweak: { color: '#4a4644', accent: '#2a2826', scale: 10, wear: 0.4, seed: 923 }, surface: 15 }
const UTILITY_BOX = metal('#bdbcb5', 924, 0.3, 16)
const POLE_WOOD = wood('#5a4a3a', 925, 2, 0.5)
const POLE_GREY = metal('#7a858a', 926, 0.2)
const POLE_BROWN = metal('#585654', 927, 0.25)
const POLE_NAVY = metal('#232d3e', 928, 0.15)
const POLE_BRONZE = metal('#4a4a44', 929, 0.2)
const LENS: Tex = CY.white
const SIGNAL_BODY = metal('#c99a24', 930, 0.25, 15, 1)
const LAMP_RED = solid('#e02020', '#801010', 931)
const LAMP_AMBER = solid('#f0a020', '#905a10', 932)
const LAMP_GREEN = solid('#20d060', '#107030', 933)
const STOP_FACE = words('STOP', 1, '#c42a22', '#f4f2ee')
const STREET_BLADE = signTex('#1f6a3a', '#f2f2ee', 934, 8)
const CONE_ORANGE = solid('#e8641e', '#b84a10', 935)
const CONE_WHITE = solid('#f2f2ee', '#d8d8d2', 936)
const STRIPES: Tex = { gen: 'hazard', tweak: { color: '#e8641e', accent: '#f2f2ee', scale: 4, wear: 0.25, seed: 937 }, surface: 17 }
const RUBBER: Tex = PB.tire
const JERSEY = conc('#9a9086', 938, 0.45)
const SAFETY_YELLOW = conc('#b5a24e', 939, 0.4, '#6a5a2a')
const GUARD = metal('#8c939a', 940, 0.3, 16)
const CHAIN = grid('#3a3d40', '#8d9094', 941, 16, 14)
const PICKET = wood('#dbd3c0', 942, 10, 0.25)
const FENCE_BOARD = wood('#6e6050', 943, 8, 0.35)
const IRON = metal('#2e3134', 944, 0.2)
const FENCE_CONC = conc('#959796', 945, 0.35)
const DUMP_BLUE = metal('#3d4a6a', 946, 0.45)
const DUMP_RUST = metal('#3a3434', 947, 0.8, 15, 2, '#7a3e1e')
const LID_BLACK = solid('#26262a', '#18181b', 948)
const SKIP_GREY = metal('#c8c4bc', 949, 0.5, 15, 3)
const CRATE_WOOD = wood('#b49c7b', 950, 5, 0.25)
const PALLET_WOOD = wood('#7a726e', 951, 3, 0.5)
const CARDBOARD = solid('#c49a64', '#a87e4c', 952, 1)
const SPOOL_WOOD = wood('#897b73', 953, 4, 0.35)
const LUMBER = wood('#c29f76', 954, 8, 0.2)
const PIPE_CONC = conc('#96938c', 955, 0.35)
const PIPE_HOLE = solid('#2a2826', '#1a1816', 956, 0)
const TRASH_BAG: Tex = { gen: 'concrete', tweak: { color: '#2a2b2f', accent: '#3d3f44', wear: 0.5, seed: 957 }, surface: 17 }
const BURNT = metal('#3a2a22', 958, 0.9, 15, 2, '#7a3e1e')
const SOOT = conc('#1e1c1b', 959, 0.6, '#0e0d0c')
const GAS_BOTTLE = metal('#c4c0bb', 960, 0.25, 15, 1)
const PORTA = solid('#3f7f8c', '#2e5f6a', 961)
const PATIO_METAL = metal('#62514c', 962, 0.25)
const CANVAS = solid('#b8322a', '#8a2420', 963)
const PUMP_WHITE = solid('#e4e2dc', '#c8c6c0', 964)
const PUMP_RED = solid('#c42a22', '#8a1a14', 965)
const SCREEN: Tex = { gen: 'tiles', tweak: { color: '#14191f', accent: '#18d8ff', scale: 3, wear: 0, seed: 966 }, surface: 15 }
const SODA_FRONT = poster('#b8302a', '#f2f2ee', 967)
const SNACK_GOODS = grid('#d8b02a', '#c8322b', 968, 6, 9)
const STAIR_CONC = conc('#91918a', 969, 0.4)
const ROOF: Tex = { lib: 'gravel_concrete_03', surface: 12 }
const CORRUGATED: Tex = PB.corrugated
const RUSTY: Tex = PB.rusty
const SHUTTER: Tex = { gen: 'garage_door', tweak: { color: '#9aa0a6', accent: '#55595e', scale: 1, wear: 0.35, seed: 970 }, surface: 16 }
const DOOR_WOOD = wood('#4a3324', 971, 3, 0.2)
const DOOR_METAL = metal('#4a5058', 972, 0.3)
const TRIM_STONE = conc('#b8b2a4', 973, 0.3)
const ESCAPE = metal('#2e2a28', 974, 0.5, 15, 2, '#7a3e1e')
const TANK_WOOD = wood('#6a5038', 1049, 10, 0.4)

/** Shop signs: lettering on a colored band (no real names; the letters are made up). */
const SIGNS: Record<string, [string, string]> = {
  red: ['#b8322a', '#f4e8c8'], blue: ['#1f4f9a', '#f2f2ee'], green: ['#1f6b3a', '#f2e08a'], yellow: ['#e0b020', '#1d1d20'],
  black: ['#1d1d20', '#f2c218'], white: ['#e8e6e0', '#b8322a'], neon: ['#14191f', '#ff3dd8'],
}
const signParam = (def: string) => sel('sign', 'Sign', [['red', 'Red'], ['blue', 'Blue'], ['green', 'Green'], ['yellow', 'Yellow'], ['black', 'Black'], ['white', 'White'], ['neon', 'Neon']], def)
const shopSign = (key: string, seed: number): Tex => { const [c, a] = SIGNS[key] ?? SIGNS.red; return signTex(c, a, 980 + seed, 7) }
const AWNING: Record<string, Tex | null> = { red: PB.red, green: PB.green, blue: PB.blue, yellow: PB.yellow, black: PB.black, stripes: { gen: 'hazard', tweak: { color: '#e8e6e0', accent: '#b8322a', scale: 6, wear: 0.2, seed: 975 }, surface: 17 }, none: null }
const awningParam = (def: string) => sel('awning', 'Awning', [['red', 'Red'], ['green', 'Green'], ['blue', 'Blue'], ['yellow', 'Yellow'], ['black', 'Black'], ['stripes', 'Striped'], ['none', 'None']], def)
const awningOf = (p: Params) => (String(p.awning) in AWNING ? AWNING[String(p.awning)] : PB.red)
const POSTERS: Tex[] = [poster('#c8322b', '#f2c218', 990), poster('#1f4f9a', '#f2f2ee', 991), poster('#1d1d20', '#ff3dd8', 992), poster('#e0b020', '#1d1d20', 993), poster('#2f8a3a', '#f2f2ee', 994)]
const TAGS: Tex[] = [tag('#ff3dd8', '#1d1d20', 995), tag('#18d8ff', '#14191f', 996), tag('#f2c218', '#7a1612', 997), tag('#6ad02a', '#1d1d20', 998)]
const COLORS: Record<string, string> = { red: '#b02a24', blue: '#25509a', yellow: '#d8b02a', green: '#2f6e3a', white: '#d8d8d2', black: '#26262a', orange: '#e0701e' }
const colorParam = (def: string, keys = ['red', 'blue', 'yellow', 'green', 'white', 'black']) =>
  sel('color', 'Color', keys.map((k): [string, string] => [k, k[0].toUpperCase() + k.slice(1)]), def)
const painted = (p: Params, seed: number, surface = 16, scale = 1): Tex => metal(COLORS[String(p.color)] ?? COLORS.red, seed + Object.keys(COLORS).indexOf(String(p.color)), 0.25, surface, scale)

/** Walls of the building kit: the game's facade materials, painted on as windows. */
const STYLE: Record<string, { wall: string; glass: string; bricks: boolean; surface: number }> = {
  brick: { wall: '#8a3b2a', glass: '#2e3b48', bricks: true, surface: 0 },
  darkbrick: { wall: '#5e3528', glass: '#283440', bricks: true, surface: 0 },
  tan: { wall: '#b9a789', glass: '#2f3c49', bricks: false, surface: 5 },
  plaster: { wall: '#c9c2b0', glass: '#32414e', bricks: false, surface: 5 },
  concrete: { wall: '#9a978f', glass: '#2e3740', bricks: false, surface: 0 },
  office: { wall: '#3c454e', glass: '#46657d', bricks: false, surface: 0 },
  glass: { wall: '#2f4a46', glass: '#4f7f86', bricks: false, surface: 9 },
}
const styleParam = (def: string) => sel('style', 'Walls', [['brick', 'Red brick'], ['darkbrick', 'Dark brick'], ['tan', 'Tan'], ['plaster', 'Plaster'], ['concrete', 'Concrete'], ['office', 'Office'], ['glass', 'Glass']], def)
/** One texture repeat covers a storey square with `across` windows. */
const facade = (style: string, across: number): Tex => {
  const st = STYLE[style] ?? STYLE.brick, k = Object.keys(STYLE).indexOf(style)
  return { gen: 'facade', tweak: { color: st.wall, accent: st.glass, scale: across, wear: 0.3, seed: 1000 + k * 4 + across, bricks: st.bricks }, surface: st.surface }
}
const STOREFRONT: Tex = { gen: 'storefront', tweak: { color: '#2c2c30', accent: '#41617a', scale: 4, wear: 0.15, seed: 1040 }, surface: 9 }
const ENTRY_GLASS: Tex = { gen: 'storefront', tweak: { color: '#1f1f22', accent: '#3a5a70', scale: 1, wear: 0.1, seed: 1041 }, surface: 9 }
const pitchParam = (def: number) => sel('pitch', 'Storey height', [['5.2', '5.2 m (most common)'], ['4.8', '4.8 m'], ['4', '4.0 m (offices)']], String(def))

// ---------------- street furniture ----------------

const FURNITURE: Record<string, Def> = {
  srhydrant: sr('Fire hydrant (city)', 'A squat red hydrant with side and front outlets, 0.96 m tall', [], (L) => [
    C('Hydrant flange', 0.37, 0.08, L(0, 0, 0), HYDRANT, HYDRANT, 10),
    tp(C('Hydrant barrel', 0.3, 0.62, L(0, 0.08, 0), HYDRANT, HYDRANT, 10), 0.92),
    C('Hydrant collar', 0.34, 0.06, L(0, 0.7, 0), HYDRANT, HYDRANT, 10),
    tp(C('Hydrant bonnet', 0.3, 0.16, L(0, 0.76, 0), HYDRANT, HYDRANT, 10), 0.55),
    C('Operating nut', 0.07, 0.04, L(0, 0.92, 0), HYDRANT_CAP, HYDRANT_CAP, 5),
    Y('Side outlets', 0.1, 0.51, L(0, 0.46, 0), HYDRANT, HYDRANT_CAP, 8),
    Y('Pumper outlet', 0.15, 0.12, L(0, 0.37, 0.18), HYDRANT, HYDRANT_CAP, 8, 90),
  ], ['hydrant', 'fire plug']),

  srnewsboxtall: sr('Newspaper box (tall)', 'A coin-op paper box on a pedestal with a window, 1.42 m', [colorParam('blue')], (L, p) => {
    const t = painted(p, 1050)
    return [
      B('Pedestal', [0.36, 0.42, 0.36], L(0, 0, 0), DARK_METAL),
      bv(B('Newspaper box', [0.56, 0.92, 0.5], L(0, 0.42, 0), t), 0.03),
      fit(B('Paper window', [0.42, 0.36, 0.02], L(0, 0.86, 0.255), NEWSPRINT)),
      B('Coin slot', [0.12, 0.06, 0.03], L(0.16, 1.22, 0.255), STEEL),
      bv(B('Box hood', [0.56, 0.08, 0.56], L(0, 1.34, 0.02), t), 0.03),
    ]
  }, ['news', 'paper']),
  srnewsboxshort: sr('Newspaper box (short)', 'A low paper box on legs, 1.10 m', [colorParam('red')], (L, p) => {
    const t = painted(p, 1060)
    return [
      ...[-0.25, 0.25].flatMap((x) => [-0.22, 0.22].map((z) => B('Box leg', [0.04, 0.32, 0.04], L(x, 0, z), DARK_METAL))),
      bv(B('Newspaper box', [0.62, 0.7, 0.55], L(0, 0.32, 0), t), 0.03),
      fit(B('Paper window', [0.48, 0.3, 0.02], L(0, 0.62, 0.28), NEWSPRINT)),
      bv(B('Box lid', [0.62, 0.08, 0.57], L(0, 1.02, 0), t), 0.03),
    ]
  }, ['news', 'paper']),
  srpayphone: sr('Payphone (post)', 'A pay phone under a small hood on a post, 1.81 m', [], (L) => [
    B('Phone base', [0.38, 0.21, 0.38], L(0, 0, 0), DARK_METAL),
    B('Phone post', [0.1, 0.85, 0.1], L(0, 0.21, -0.12), STEEL),
    bv(B('Phone housing', [0.62, 0.72, 0.3], L(0, 1.0, 0.0), STEEL), 0.03),
    fit(B('Phone sign', [0.62, 0.14, 0.3], L(0, 1.62, -0.02), words('PHONE', 4, '#1f4f9a', '#f2f2ee', 15))),
    bv(B('Phone hood', [0.65, 0.05, 0.53], L(0, 1.76, 0.08), STEEL), 0.02),
    B('Hood side', [0.03, 0.62, 0.45], L(-0.31, 1.14, 0.08), STEEL), B('Hood side', [0.03, 0.62, 0.45], L(0.31, 1.14, 0.08), STEEL),
    bv(B('Handset', [0.06, 0.24, 0.07], L(-0.2, 1.2, 0.18), BLACK), 0.02),
    B('Keypad', [0.16, 0.2, 0.02], L(0.06, 1.25, 0.16), BLACK),
  ], ['phone', 'telephone']),
  srmailbox: sr('Mailbox (street)', 'A blue curbside letter box with a rounded top, 1.31 m', [], (L) => [
    ...[-0.24, 0.24].flatMap((x) => [-0.2, 0.2].map((z) => B('Mailbox leg', [0.05, 0.3, 0.05], L(x, 0, z), MAIL_BLUE))),
    B('Mailbox', [0.55, 0.72, 0.5], L(0, 0.3, 0), MAIL_BLUE),
    { ...Y('Mailbox top', 0.55, 0.5, L(0, 0.73, 0), MAIL_BLUE, MAIL_BLUE, 14, 90), size: m3([0.5, 0.58, 0.55]) },
    B('Mail slot', [0.36, 0.06, 0.02], L(0, 1.06, 0.33), BLACK),
    fit(B('Mail label', [0.3, 0.14, 0.02], L(0, 0.75, 0.26), words('MAIL', 3, '#24477a', '#f2f2ee', 16))),
  ], ['post box', 'mail']),
  srbusshelter: sr('Bus shelter', 'An open-front shelter with glass back, an ad panel and a bench, 4.65 m long and 3.16 m tall', [sel('ad', 'Ad poster', [['0', 'Red'], ['1', 'Blue'], ['2', 'Night'], ['3', 'Yellow'], ['4', 'Green']], '1')], (L, p) => {
    const ad = POSTERS[+p.ad] ?? POSTERS[1], lw = 4.65, ld = 2.65
    return [
      ...[-lw / 2 + 0.1, lw / 2 - 0.1].flatMap((x) => [-ld / 2 + 0.15, ld / 2 - 0.3].map((z) => B('Shelter post', [0.1, 2.95, 0.1], L(x, 0, z), DARK_METAL))),
      bv(B('Shelter roof', [lw, 0.14, ld], L(0, 2.95, 0), DARK_METAL), 0.04),
      B('Roof fascia', [lw, 0.07, 0.04], L(0, 3.09, ld / 2 - 0.02), DARK_METAL),
      B('Back glass', [lw - 0.3, 2.3, 0.03], L(0, 0.35, -ld / 2 + 0.15), GLASS),
      B('Back rail', [lw - 0.2, 0.06, 0.06], L(0, 0.3, -ld / 2 + 0.15), DARK_METAL),
      fit(B('Ad panel', [0.18, 1.85, 1.3], L(lw / 2 - 0.1, 0.4, -0.35), DARK_METAL, ad)),
      B('Side glass', [0.03, 2.3, 0.95], L(-lw / 2 + 0.1, 0.35, -0.5), GLASS),
      B('Shelter bench', [2.6, 0.06, 0.42], L(-0.4, 0.45, -ld / 2 + 0.45), STEEL),
      ...[-1.5, 0.7].map((x) => B('Bench leg', [0.06, 0.45, 0.35], L(x, 0, -ld / 2 + 0.45), DARK_METAL)),
    ]
  }, ['bus stop', 'shelter']),
  srbench: sr('Street bench', 'A city bench: green slats on iron ends (2.59 m), wood on cement ends (2.49 m) or perforated metal (3.11 m)', [sel('style', 'Style', [['park', 'Park (green slats)'], ['cement', 'Cement ends'], ['metal', 'Perforated metal']], 'park')], (L, p) => {
    if (p.style === 'cement') {
      const len = 2.49
      return [
        ...[-1, 1].map((s) => bv(B('Bench end', [0.22, 0.45, 0.62], L(s * (len / 2 - 0.25), 0, 0.05), CEMENT), 0.04)),
        ...[0.25, 0.08, -0.09].map((z) => bv(B('Seat slat', [len, 0.06, 0.14], L(0, 0.45, z), BENCH_WOOD), 0.015)),
        ...[-1, 1].map((s) => B('Back post', [0.08, 0.56, 0.08], L(s * (len / 2 - 0.25), 0.45, -0.28), CEMENT)),
        ...[0.72, 0.88].map((y) => bv(B('Back slat', [len, 0.12, 0.05], L(0, y, -0.36), BENCH_WOOD), 0.015)),
      ]
    }
    if (p.style === 'metal') {
      const len = 3.11
      return [
        ...[-1, 0, 1].map((s) => B('Bench leg', [0.06, 0.45, 0.6], L(s * (len / 2 - 0.15), 0, 0), CAST_IRON)),
        bv(B('Perforated seat', [len, 0.04, 0.52], L(0, 0.45, 0.05), PERFORATED), 0.015),
        ...[-1, 0, 1].map((s) => B('Back post', [0.06, 0.5, 0.05], L(s * (len / 2 - 0.15), 0.45, -0.33), CAST_IRON)),
        bv(B('Perforated back', [len, 0.4, 0.04], L(0, 0.58, -0.36), PERFORATED), 0.015),
      ]
    }
    const len = 2.59
    return [
      ...[-1, 1].flatMap((s) => [B('Iron end', [0.07, 0.45, 0.68], L(s * (len / 2 - 0.2), 0, 0.02), CAST_IRON), B('Iron back', [0.07, 0.53, 0.07], L(s * (len / 2 - 0.2), 0.45, -0.32), CAST_IRON)]),
      B('Iron end', [0.07, 0.45, 0.6], L(0, 0, 0.02), CAST_IRON),
      ...[0.3, 0.16, 0.02, -0.12].map((z) => bv(B('Seat slat', [len, 0.05, 0.11], L(0, 0.45, z), BENCH_SLAT), 0.012)),
      ...[0.62, 0.76, 0.9].map((y) => bv(B('Back slat', [len, 0.08, 0.04], L(0, y, -0.36), BENCH_SLAT), 0.012)),
    ]
  }, ['bench', 'seat']),
  srpicnic: sr('Picnic table (park)', 'A park picnic table with attached benches, 2.21 × 1.92 m', [], (L) => [
    bv(B('Table top', [2.21, 0.06, 0.78], L(0, 0.69, 0), BENCH_WOOD), 0.015),
    ...[-1, 1].map((s) => bv(B('Bench seat', [2.21, 0.05, 0.3], L(0, 0.42, s * 0.81), BENCH_WOOD), 0.012)),
    ...[-0.85, 0.85].flatMap((x) => [B('Table frame', [0.08, 0.69, 0.08], L(x, 0, 0), PATIO_METAL), B('Bench frame', [0.06, 0.06, 1.92], L(x, 0.36, 0), PATIO_METAL),
      ...[-1, 1].map((s) => B('Bench leg', [0.06, 0.36, 0.06], L(x, 0, s * 0.81), PATIO_METAL))]),
  ], ['picnic', 'table']),
  srtrashcan: sr('Trash can (metal)', 'A round metal street can with a domed lid, 1.04 m', [], (L) => [
    tp(C('Trash can', 0.6, 0.86, L(0, 0, 0), BLACK, BIN_METAL, 14), 1.08),
    C('Can rim', 0.67, 0.06, L(0, 0.86, 0), BIN_METAL, BIN_METAL, 14),
    tp(C('Can lid', 0.64, 0.12, L(0, 0.92, 0), BIN_METAL, BIN_METAL, 14), 0.5),
  ], ['bin', 'garbage']),
  srstreetbin: sr('Street bin (anchored)', 'A square sidewalk bin with a hooded top and a mouth on each side, 1.12 m', [], (L) => [
    bv(B('Bin body', [0.68, 0.86, 0.68], L(0, 0, 0), STREET_BIN), 0.04),
    ...[0, 90].map((r) => B('Bin mouth', [0.4, 0.16, 0.7], L(0, 0.66, 0), BLACK, BLACK, r)),
    C('Bin hood', 1.06, 0.26, L(0, 0.86, 0), STREET_BIN, STREET_BIN, 4, 45),
  ], ['bin', 'garbage']),
  srwheeliebin: sr('Wheelie bin', 'A big residential plastic bin with a hinged lid and back wheels, 1.27 m', [], (L) => [
    bv(B('Bin body', [0.86, 1.1, 0.8], L(0, 0.07, 0.02), BIN_PLASTIC), 0.05),
    bv(B('Bin lid', [0.96, 0.07, 0.9], L(0, 1.17, 0.03), BIN_LID), 0.02),
    B('Lid hinge', [0.9, 0.06, 0.06], L(0, 1.15, -0.43), BIN_LID),
    ...[-1, 1].map((s) => Y('Wheel', 0.25, 0.06, L(s * 0.4, 0, -0.38), RUBBER, RUBBER, 10)),
    Y('Axle', 0.04, 0.78, L(0, 0.105, -0.38), DARK_METAL, DARK_METAL, 6),
  ], ['bin', 'garbage', 'trash']),
  srparkingmeter: sr('Parking meter', 'A twin-head parking meter on a post, 1.20 m', [num('n', 'Meters', 1, 8, 1)], (L, p) => row(L, +p.n, 2.6, (M) => [
    C('Meter post', 0.07, 0.92, M(0, 0, 0), METER_GREY, METER_GREY, 6),
    B('Meter yoke', [0.55, 0.06, 0.12], M(0, 0.92, 0), METER_GREY),
    ...[-0.15, 0.15].flatMap((x) => [bv(B('Meter head', [0.22, 0.2, 0.2], M(x, 0.97, 0), METER_GREY), 0.04), fit(B('Meter dial', [0.12, 0.08, 0.02], M(x, 1.06, 0.105), SCREEN))]),
  ]), ['meter', 'parking']),
  srplanterpot: sr('Round planter', 'A round concrete planter with a shrub, 1.17 m across', [], (L) => [
    tp(C('Planter', 1.17, 0.56, L(0, 0, 0), SOIL, PLANTER, 14), 1.06),
    tp(C('Shrub', 0.9, 0.5, L(0, 0.52, 0), SHRUB, SHRUB, 9), 1.2), tp(C('Shrub', 1.0, 0.45, L(0, 1.02, 0), SHRUB, SHRUB, 9), 0.35),
  ], ['planter', 'pot', 'plant']),
  srplanterbox: sr('Planter box', 'A long low concrete planter with shrubs, 4.41 × 1.90 m', [num('len', 'Length (m)', 2, 12, 4.41, 0.01)], (L, p) => {
    const len = +p.len, n = Math.max(1, Math.round(len / 1.4))
    return [
      bv(B('Planter box', [len, 0.48, 1.9], L(0, 0, 0), SOIL, PLANTER), 0.04),
      ...row(L, n, (len - 0.6) / n, (M) => [tp(C('Shrub', 1.0, 0.55, M(0, 0.46, 0), SHRUB, SHRUB, 8), 0.6)]),
    ]
  }, ['planter', 'hedge']),
  srtreeguard: sr('Street tree with guard', 'A sidewalk tree in an iron cage on a grate (cage 0.92 m, 1.32 m tall)', [yesNo('tree', 'Tree', 'yes')], (L, p) => [
    B('Tree grate', [1.3, 0.03, 1.3], L(0, 0, 0), GRATE),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => B('Guard post', [0.04, 1.32, 0.04], L(sx * 0.44, 0.03, sz * 0.44), IRON))),
    ...[0.5, 1.28].flatMap((y) => [[0, 0.44, 0], [0, -0.44, 0], [0.44, 0, 90], [-0.44, 0, 90]].map(([x, z, r]) => B('Guard ring', [0.92, 0.035, 0.035], L(x, 0.03 + y, z), IRON, IRON, r))),
    ...(p.tree === 'yes' ? [tp(C('Trunk', 0.18, 3.4, L(0, 0.03, 0), BARK, BARK, 7), 0.7), tp(C('Crown', 2.6, 1.6, L(0, 2.7, 0), SHRUB, SHRUB, 10), 1.25), tp(C('Crown', 3.2, 2.2, L(0, 4.3, 0), SHRUB, SHRUB, 10), 0.3)] : []),
  ], ['tree', 'grate']),
  srmanhole: sr('Manhole cover', 'A flat iron manhole cover, 1.06 m across (paint-thin: cars and players cross it)', [], (L) => [C('Manhole cover', 1.06, 0.01, L(0, 0, 0), MANHOLE, MANHOLE, 16)], ['sewer', 'cover']),
  srelecbox: sr('Utility cabinet', 'A pale utility box on a concrete pad, 1.83 m tall', [], (L) => [
    B('Cabinet pad', [1.1, 0.1, 0.62], L(0, 0, 0), CEMENT),
    bv(B('Utility cabinet', [0.94, 1.66, 0.46], L(0, 0.1, 0), UTILITY_BOX), 0.02),
    bv(B('Cabinet cap', [0.98, 0.07, 0.5], L(0, 1.76, 0), UTILITY_BOX), 0.02),
    B('Door seam', [0.01, 1.4, 0.47], L(0, 0.22, 0), BLACK),
    ...[-0.25, 0.25].map((x) => B('Vent', [0.3, 0.12, 0.47], L(x, 1.4, 0), BLACK)),
  ], ['electrical', 'box', 'transformer']),
  srutilitypole: sr('Utility pole', 'A tall wooden power pole with crossarms and a transformer, 17.9 m', [], (L) => [
    tp(C('Utility pole', 0.32, 17.5, L(0, 0, 0), POLE_WOOD, POLE_WOOD, 8), 0.7),
    B('Crossarm', [5.0, 0.12, 0.12], L(0, 17.0, 0.2), POLE_WOOD), B('Crossarm', [3.0, 0.12, 0.12], L(0, 15.8, 0.2), POLE_WOOD),
    ...[-2.3, -1.1, 1.1, 2.3].map((x) => C('Insulator', 0.1, 0.22, L(x, 17.12, 0.2), CY.white, CY.white, 6)),
    ...[-1.3, 1.3].map((x) => C('Insulator', 0.1, 0.2, L(x, 15.92, 0.2), CY.white, CY.white, 6)),
    C('Transformer', 0.6, 1.0, L(0, 13.0, 0.5), GAS_BOTTLE, GAS_BOTTLE, 10), B('Bracket', [0.3, 0.12, 0.3], L(0, 13.3, 0.2), DARK_METAL),
    C('Pole top', 0.24, 0.38, L(0, 17.5, 0), POLE_WOOD, POLE_WOOD, 8),
  ], ['power', 'pole', 'wires']),
  srpatioset: sr('Patio table set', 'A café table under an umbrella with four chairs (table 1.43 m, chairs 1.06 m)', [yesNo('umbrella', 'Umbrella', 'yes')], (L, p) => [
    C('Table foot', 0.6, 0.04, L(0, 0, 0), PATIO_METAL, PATIO_METAL, 10), C('Table post', 0.07, 0.8, L(0, 0.04, 0), PATIO_METAL, PATIO_METAL, 6),
    C('Table top', 1.43, 0.04, L(0, 0.8, 0), PATIO_METAL, PATIO_METAL, 16),
    ...(p.umbrella === 'yes' ? [C('Umbrella pole', 0.05, 1.7, L(0, 0.84, 0), STEEL, STEEL, 6), tp(C('Umbrella', 2.74, 0.42, L(0, 2.12, 0), CANVAS, CANVAS, 8), 0.05)] : []),
    ...[0, 90, 180, 270].flatMap((r) => sub(L, ...turn(0, 1.05, r), r + 180, (M) => [
      B('Chair seat', [0.5, 0.04, 0.48], M(0, 0.45, 0), PATIO_METAL),
      ...[-0.22, 0.22].flatMap((x) => [B('Chair leg', [0.03, 0.45, 0.03], M(x, 0, 0.2), PATIO_METAL), B('Chair leg', [0.03, 1.06, 0.03], M(x, 0, -0.22), PATIO_METAL)]),
      B('Chair back', [0.48, 0.4, 0.03], M(0, 0.64, -0.23), PATIO_METAL),
    ])),
  ], ['cafe', 'patio', 'umbrella']),
}

// ---------------- lights and traffic ----------------

/** A light head: housing with a glowing underside. */
const lampHead = (L: Lf, x: number, y: number, z: number, len: number, w: number, tex: Tex, r = 0): Part[] => [
  bv(B('Lamp head', [w, 0.22, len], L(x, y, z), tex, tex, r), 0.05), B('Lamp lens', [w * 0.8, 0.03, len * 0.8], L(x, y - 0.03, z), LENS, LENS, r),
]
/** A signal head (0.57 wide, 0.49 deep, 1.79 tall) with three lenses facing +X. */
const signalHead = (L: Lf, x: number, y: number, z: number): Part[] => [
  bv(B('Signal head', [0.38, 1.79, 0.57], L(x, y, z), SIGNAL_BODY), 0.04),
  B('Backplate', [0.04, 1.79, 0.57], L(x - 0.21, y, z), BLACK),
  ...[[1.42, LAMP_RED], [0.9, LAMP_AMBER], [0.38, LAMP_GREEN]].flatMap(([dy, t]) => [
    Y('Signal lens', 0.3, 0.04, L(x + 0.2, y + (dy as number) - 0.15 + 0.1, z), t as Tex, t as Tex, 12),
    B('Visor', [0.16, 0.04, 0.4], L(x + 0.28, y + (dy as number) + 0.27, z), BLACK),
  ]),
]

const TRAFFIC: Record<string, Def> = {
  srstreetlight: sr('Street light (tall)', 'A 13.5 m street light with its arm out over the road (+Z) and a footing', [num('arm', 'Arm reach (m)', 1.5, 6, 3.85, 0.05)], (L, p) => {
    const reach = +p.arm
    return [
      tp(C('Light footing', 0.65, 1.22, L(0, 0, 0), POLE_GREY, POLE_GREY, 10), 0.85),
      tp(C('Light pole', 0.42, 13.54, L(0, 0, 0), POLE_GREY, POLE_GREY, 10), 0.45),
      B('Light arm', [0.11, 0.11, reach - 0.25], L(0, 13.3, (reach - 0.25) / 2), POLE_GREY),
      B('Arm brace', [0.08, 0.08, reach * 0.4], L(0, 12.75, reach * 0.2), POLE_GREY),
      ...lampHead(L, 0, 13.25, reach - 0.35, 0.9, 0.53, POLE_GREY),
    ]
  }, ['lamp', 'street lamp', 'pole']),
  srlotlight: sr('Lot light', 'A parking-lot light, 11.7 m, with two or four flat heads', [sel('heads', 'Heads', [['1', 'One'], ['2', 'Two'], ['4', 'Four']], '2')], (L, p) => {
    const n = +p.heads
    return [
      C('Lot light base', 0.62, 0.7, L(0, 0, 0), CEMENT, CEMENT, 10),
      tp(C('Lot light pole', 0.3, 10.9, L(0, 0.7, 0), POLE_BROWN, POLE_BROWN, 8), 0.6),
      ...[0, 180, 90, 270].slice(0, n).flatMap((r) => sub(L, 0, 0, r, (M) => [B('Head arm', [0.08, 0.08, 0.45], M(0, 11.45, 0.22), POLE_BROWN), ...lampHead(M, 0, 11.48, 0.55 + (n === 1 ? 0 : 0.05), 0.6, 0.72, POLE_BROWN)])),
    ]
  }, ['lamp', 'parking', 'light']),
  srblocklamp: sr('Block lamp', 'A short downtown post lamp with a lantern top, 3.68 m', [], (L) => [
    tp(C('Lamp base', 0.45, 0.6, L(0, 0, 0), POLE_NAVY, POLE_NAVY, 8), 0.6),
    C('Lamp post', 0.13, 2.4, L(0, 0.6, 0), POLE_NAVY, POLE_NAVY, 8),
    tp(C('Lantern seat', 0.3, 0.12, L(0, 3.0, 0), POLE_NAVY, POLE_NAVY, 8), 1.5),
    C('Lantern glass', 0.34, 0.42, L(0, 3.12, 0), LENS, LENS, 8),
    tp(C('Lantern cap', 0.45, 0.14, L(0, 3.54, 0), POLE_NAVY, POLE_NAVY, 8), 0.2),
  ], ['lamp', 'lantern']),
  srornlamp: sr('Banner lamp', 'An ornamental double lamp with two banners, 5.04 m tall and 2.03 m across', [sel('banner', 'Banners', [['blue', 'Blue'], ['red', 'Red'], ['green', 'Green'], ['none', 'None']], 'blue')], (L, p) => {
    const flag = p.banner === 'red' ? PB.red : p.banner === 'green' ? PB.green : PB.blue
    return [
      tp(C('Lamp base', 0.5, 0.8, L(0, 0, 0), POLE_BRONZE, POLE_BRONZE, 10), 0.55),
      tp(C('Lamp post', 0.18, 4.1, L(0, 0.8, 0), POLE_BRONZE, POLE_BRONZE, 8), 0.7),
      B('Lamp arms', [2.03, 0.07, 0.07], L(0, 4.7, 0), POLE_BRONZE),
      ...[-0.95, 0.95].flatMap((x) => [tp(C('Lamp globe', 0.32, 0.36, L(x, 4.3, 0), LENS, LENS, 8), 0.6), tp(C('Globe cap', 0.36, 0.12, L(x, 4.66, 0), POLE_BRONZE, POLE_BRONZE, 8), 0.3)]),
      C('Finial', 0.12, 0.3, L(0, 4.9, 0), POLE_BRONZE, POLE_BRONZE, 6),
      ...(p.banner === 'none' ? [] : [-1, 1].flatMap((s) => [B('Banner arm', [0.03, 0.03, 0.62], L(0, 3.9 - (s > 0 ? 0 : 1.4), s * 0.36), POLE_BRONZE), B('Banner', [0.02, 1.2, 0.56], L(0, 2.68 - (s > 0 ? 0 : 1.4) + 0.02, s * 0.4), flag)])),
    ]
  }, ['lamp', 'banner']),
  srsignalmast: sr('Traffic signal (mast arm)', 'A 6.09 m signal pole with a mast arm out over the road (+Z); the heads face +X, toward the drivers', [sel('arm', 'Mast arm', [['long', 'Long (9.98 m, two heads)'], ['short', 'Short (5.26 m, one head)']], 'long')], (L, p) => {
    const reach = p.arm === 'short' ? 5.26 : 9.98
    const heads = p.arm === 'short' ? [reach - 0.6] : [reach * 0.55, reach - 0.6]
    return [
      bv(B('Signal base', [0.53, 0.66, 0.46], L(0, 0, 0), CEMENT), 0.04),
      tp(C('Signal pole', 0.33, 6.09, L(0, 0, 0), DARK_METAL, DARK_METAL, 10), 0.75),
      B('Mast arm', [0.2, 0.2, reach - 0.15], L(0, 5.72, (reach - 0.15) / 2 + 0.1), DARK_METAL),
      B('Arm brace', [0.06, 0.06, reach * 0.35], L(0, 5.2, reach * 0.18), DARK_METAL),
      ...heads.flatMap((z) => [B('Head hanger', [0.05, 0.12, 0.05], L(0, 5.6, z), DARK_METAL), ...signalHead(L, 0, 3.81, z)]),
      fit(B('Street blade', [0.03, 0.3, 1.6], L(0, 5.2, 2.2), STREET_BLADE)),
    ]
  }, ['traffic light', 'signal', 'junction']),
  srsignalpost: sr('Traffic signal (post)', 'A corner signal on its own post: one head 2.6 m up, facing +X', [], (L) => [
    bv(B('Signal base', [0.53, 0.66, 0.46], L(0, 0, 0), CEMENT), 0.04),
    C('Signal post', 0.16, 2.6, L(0, 0, 0), DARK_METAL, DARK_METAL, 8),
    ...signalHead(L, 0.05, 2.6, 0),
  ], ['traffic light', 'signal']),
  srstopsign: sr('Stop sign (post)', 'An eight-sided stop sign facing +Z on a post, 2.85 m', [], (L) => [
    B('Sign post', [0.06, 2.55, 0.06], L(0, 0, -0.02), STEEL),
    { ...Y('Stop sign', 0.83, 0.03, L(0, 2.02, 0.02), CONE_WHITE, STOP_FACE, 8, 90), fit: true },
  ], ['stop', 'sign']),
  srpostsign: sr('Road sign (post)', 'A sign panel on a post facing +Z: speed limit, bus stop, one way or no parking (about 2.8 m)', [sel('kind', 'Sign', [['speed', 'Speed limit'], ['bus', 'Bus stop'], ['oneway', 'One way'], ['noparking', 'No parking']], 'speed')], (L, p) => {
    const [w, h, face] = p.kind === 'bus' ? [0.52, 0.66, words('BUS STOP', 1, '#f2f2ee', '#1f4f9a')]
      : p.kind === 'oneway' ? [0.9, 0.3, words('ONE WAY', 3, '#1d1d20', '#f2f2ee')]
        : p.kind === 'noparking' ? [0.46, 0.6, words('NO PARKING', 1, '#f2f2ee', '#c42a22')]
          : [0.62, 0.78, words('SPEED LIMIT 35', 1, '#f2f2ee', '#1d1d20')]
    const top = p.kind === 'bus' ? 2.75 : 2.8
    return [B('Sign post', [0.06, top - 0.05, 0.06], L(0, 0, -0.02), STEEL), fit(B('Sign panel', [w as number, h as number, 0.02], L(0, top - (h as number), 0.02), STEEL, face as Tex))]
  }, ['sign', 'speed limit', 'bus stop', 'one way']),
  srstreetname: sr('Street name sign', 'Two crossed green street-name blades on a 3 m post', [], (L) => [
    B('Sign post', [0.06, 2.95, 0.06], L(0, 0, 0), STEEL),
    fit(B('Street blade', [0.9, 0.2, 0.02], L(0, 2.72, 0), STREET_BLADE)), fit(B('Street blade', [0.02, 0.2, 0.9], L(0, 2.5, 0), STREET_BLADE)),
    C('Post cap', 0.08, 0.05, L(0, 2.95, 0), STEEL, STEEL, 6),
  ], ['street sign', 'name']),
  srcone: sr('Traffic cone (small)', 'A 0.56 m cone with a white band; set a row of them', [num('n', 'Cones', 1, 12, 1)], (L, p) => row(L, +p.n, 0.9, (M) => [
    B('Cone base', [0.36, 0.03, 0.36], M(0, 0, 0), CONE_ORANGE),
    tp(C('Cone', 0.28, 0.24, M(0, 0.03, 0), CONE_ORANGE, CONE_ORANGE, 10), 0.6), tp(C('Cone band', 0.17, 0.1, M(0, 0.27, 0), CONE_WHITE, CONE_WHITE, 10), 0.8),
    tp(C('Cone tip', 0.136, 0.19, M(0, 0.37, 0), CONE_ORANGE, CONE_ORANGE, 10), 0.3),
  ]), ['cone', 'roadworks']),
  srconebarrel: sr('Construction barrel', 'A striped drum on a rubber base ring, 1.32 m', [num('n', 'Barrels', 1, 8, 1)], (L, p) => row(L, +p.n, 1.3, (M) => [
    C('Barrel base', 0.98, 0.1, M(0, 0, 0), RUBBER, RUBBER, 12),
    tp(C('Barrel', 0.6, 1.12, M(0, 0.1, 0), CONE_ORANGE, STRIPES, 12), 0.88),
    tp(C('Barrel top', 0.52, 0.1, M(0, 1.22, 0), CONE_ORANGE, CONE_ORANGE, 12), 0.7),
  ]), ['barrel', 'drum', 'roadworks']),
  srbarricade: sr('Road barricade (A-frame)', 'A striped A-frame barricade, 3.15 m wide and 2.28 m tall, with a warning light', [], (L) => {
    const h = 2.28, half = 0.6
    return [
      ...[-1.4, 1.4].flatMap((x) => [R('A-frame leg', [0.08, h - 0.2, half], L(x, 0, half / 2), STEEL, STEEL, 0), R('A-frame leg', [0.08, h - 0.2, half], L(x, 0, -half / 2), STEEL, STEEL, 180)]),
      ...[0.9, 1.35, 1.8].flatMap((y) => [-1, 1].map((s) => bv(fit(B('Striped board', [3.15, 0.22, 0.025], L(0, y, s * (half * (1 - (y + 0.11) / (h - 0.2)) + 0.02)), CONE_WHITE, STRIPES)), 0.005))),
      Y('Warning light', 0.18, 0.08, L(1.4, h - 0.2, 0), LAMP_AMBER, LAMP_AMBER, 10, 90),
    ]
  }, ['barrier', 'roadworks', 'detour']),
  srjersey: sr('Jersey barrier', 'Concrete road barriers, 4.84 m long and 1.34 m tall', [num('n', 'Barriers', 1, 8, 1)], (L, p) => row(L, +p.n, 4.9, (M) => [
    B('Barrier foot', [4.84, 0.3, 1.11], M(0, 0, 0), JERSEY), B('Barrier core', [4.84, 0.25, 0.5], M(0, 0.3, 0), JERSEY),
    R('Barrier slope', [4.84, 0.25, 0.3], M(0, 0.3, 0.4), JERSEY, JERSEY, 0), R('Barrier slope', [4.84, 0.25, 0.3], M(0, 0.3, -0.4), JERSEY, JERSEY, 180),
    bv(B('Barrier top', [4.84, 0.79, 0.4], M(0, 0.55, 0), JERSEY), 0.04),
  ]), ['barrier', 'concrete', 'k-rail']),
  srbollards: sr('Concrete bollards', 'A row of yellow concrete posts, 1.30 m tall', [num('n', 'Bollards', 1, 12, 4), num('gap', 'Spacing (m)', 0.8, 4, 1.5, 0.1)], (L, p) => row(L, +p.n, +p.gap, (M) => [
    C('Bollard', 0.24, 1.2, M(0, 0, 0), SAFETY_YELLOW, SAFETY_YELLOW, 10), tp(C('Bollard cap', 0.24, 0.1, M(0, 1.2, 0), SAFETY_YELLOW, SAFETY_YELLOW, 10), 0.4),
  ]), ['bollard', 'post']),
  srcurbstop: sr('Parking curb block', 'Wheel stops for a parking row, 2.32 m long', [num('n', 'Blocks', 1, 12, 1), num('gap', 'Bay width (m)', 2.4, 4, 2.7, 0.1)], (L, p) => row(L, +p.n, +p.gap, (M) => [
    bv(B('Curb block', [2.32, 0.23, 0.3], M(0, 0, 0), SAFETY_YELLOW), 0.05),
  ]), ['parking', 'wheel stop']),
  srguardrail: sr('Guard rail', 'Steel W-beam guard rail on posts, 3.10 m sections, 1.38 m tall', [num('n', 'Sections', 1, 12, 1)], (L, p) => {
    const n = +p.n, len = 3.1 * n
    return [
      ...[...Array(n + 1)].map((_, i) => B('Rail post', [0.15, 1.38, 0.12], L(-len / 2 + i * 3.1, 0, -0.1), GUARD)),
      bv(B('W-beam', [len, 0.33, 0.1], L(0, 0.92, 0.07), GUARD), 0.02),
      B('Blockout', [len, 0.14, 0.05], L(0, 1.0, -0.02), GUARD),
    ]
  }, ['guardrail', 'barrier']),
}

// ---------------- fences ----------------

const FENCES: Record<string, Def> = {
  srchainlink: sr('Chain-link fence', 'Chain-link panels on posts, 2.39 m tall (4.21 m panels)', [num('n', 'Panels', 1, 12, 1), sel('panel', 'Panel', [['4.21', '4.21 m'], ['3.17', '3.17 m (short)']], '4.21')], (L, p) => {
    const n = +p.n, pw = +p.panel, len = n * pw
    return [
      ...[...Array(n + 1)].map((_, i) => C('Fence post', 0.1, 2.39, L(-len / 2 + i * pw, 0, 0), STEEL, STEEL, 8)),
      B('Top rail', [len, 0.05, 0.05], L(0, 2.3, 0), STEEL),
      B('Chain-link mesh', [len, 2.28, 0.02], L(0, 0.04, 0), CHAIN, CHAIN, 0, 1),
    ]
  }, ['fence', 'chain link', 'mesh']),
  srpicket: sr('Picket fence', 'A white picket fence, 2.45 m panels, 1.29 m tall', [num('n', 'Panels', 1, 10, 1)], (L, p) => {
    const n = +p.n, len = n * 2.45, k = Math.round(len / 0.16)
    return [
      ...[...Array(n + 1)].map((_, i) => B('Fence post', [0.09, 1.29, 0.09], L(-len / 2 + i * 2.45, 0, 0), PICKET)),
      ...[0.3, 0.95].map((y) => B('Fence rail', [len, 0.07, 0.04], L(0, y, -0.05), PICKET)),
      ...[...Array(k)].flatMap((_, i) => { const x = -len / 2 + (i + 0.5) * (len / k); return [B('Picket', [0.08, 1.12, 0.02], L(x, 0.05, 0.0), PICKET), tp(C('Picket point', 0.08, 0.1, L(x, 1.17, 0), PICKET, PICKET, 4, 45), 0)] }),
    ]
  }, ['fence', 'picket', 'yard']),
  srwoodfence: sr('Board fence', 'A tall wooden board fence, 4.16 m panels, 2.67 m tall', [num('n', 'Panels', 1, 10, 1), yesNo('tags', 'Graffiti', 'no')], (L, p) => {
    const n = +p.n, len = n * 4.16
    return [
      ...[...Array(n + 1)].map((_, i) => B('Fence post', [0.12, 2.67, 0.12], L(-len / 2 + i * 4.16, 0, -0.04), FENCE_BOARD)),
      ...[0.4, 2.2].map((y) => B('Fence rail', [len, 0.1, 0.05], L(0, y, -0.06), FENCE_BOARD)),
      B('Fence boards', [len, 2.6, 0.03], L(0, 0.04, 0.02), FENCE_BOARD, FENCE_BOARD, 0, 2.6),
      ...(p.tags === 'yes' ? [...Array(n)].map((_, i) => fit(B('Tag', [2.6, 1.3, 0.01], L(-len / 2 + (i + 0.5) * 4.16, 0.5, 0.04), TAGS[i % TAGS.length]))) : []),
    ]
  }, ['fence', 'wood']),
  srsheetfence: sr('Sheet-metal fence', 'Corrugated sheet panels on posts, 5.26 m panels, 2.67 m tall', [num('n', 'Panels', 1, 10, 1)], (L, p) => {
    const n = +p.n, len = n * 5.26
    return [
      ...[...Array(n + 1)].map((_, i) => B('Fence post', [0.1, 2.67, 0.1], L(-len / 2 + i * 5.26, 0, -0.05), RUSTY)),
      B('Sheet panels', [len, 2.6, 0.04], L(0, 0.03, 0.03), CORRUGATED, CORRUGATED, 0, 2.6),
    ]
  }, ['fence', 'metal', 'corrugated']),
  srironfence: sr('Iron fence', 'A black iron bar fence: tall (5.25 m panels, 3.45 m) or low (1.32 m panels, 0.90 m)', [sel('kind', 'Height', [['tall', 'Tall (3.45 m)'], ['low', 'Low (0.90 m)']], 'tall'), num('n', 'Panels', 1, 10, 1)], (L, p) => {
    const tall = p.kind !== 'low', pw = tall ? 5.25 : 1.32, h = tall ? 3.45 : 0.9, n = +p.n, len = n * pw, k = Math.round(len / (tall ? 0.24 : 0.16))
    return [
      ...[...Array(n + 1)].map((_, i) => [B('Fence post', [0.13, h, 0.13], L(-len / 2 + i * pw, 0, 0), IRON), tp(C('Post finial', 0.15, 0.12, L(-len / 2 + i * pw, h, 0), IRON, IRON, 4, 45), 0)]).flat(),
      ...[0.12, h - 0.25].map((y) => B('Fence rail', [len, 0.05, 0.05], L(0, y, 0), IRON)),
      ...[...Array(k)].map((_, i) => B('Fence bar', [0.025, h - 0.1, 0.025], L(-len / 2 + (i + 0.5) * (len / k), 0.02, 0), IRON)),
    ]
  }, ['fence', 'iron', 'railing']),
  srconcretefence: sr('Concrete wall panels', 'Precast concrete fence panels, 2.44 m wide and 1.98 m tall', [num('n', 'Panels', 1, 12, 3), yesNo('tags', 'Graffiti', 'yes')], (L, p) => row(L, +p.n, 2.46, (M, i) => [
    B('Wall panel', [2.44, 1.86, 0.25], M(0, 0, 0), FENCE_CONC), bv(B('Panel cap', [2.44, 0.12, 0.31], M(0, 1.86, 0), FENCE_CONC), 0.03),
    ...(p.tags === 'yes' && i % 2 === 0 ? [fit(B('Tag', [2.0, 1.1, 0.01], M(0, 0.35, 0.13), TAGS[(i / 2) % TAGS.length]))] : []),
  ]), ['wall', 'fence', 'concrete']),
}

// ---------------- containers, crates and junk ----------------

const JUNK: Record<string, Def> = {
  srdumpstersmall: sr('Dumpster (small)', 'A blue front-load dumpster with a black lid, 2.10 × 1.88 m and 1.75 m tall', [yesNo('tags', 'Graffiti', 'no')], (L, p) => [
    ...[-0.85, 0.85].flatMap((x) => [-0.6, 0.6].map((z) => B('Caster', [0.12, 0.14, 0.12], L(x, 0, z), BLACK))),
    bv(B('Dumpster', [2.1, 1.38, 1.6], L(0, 0.14, -0.05), DUMP_BLUE), 0.04),
    R('Dumpster lid', [2.1, 0.23, 1.68], L(0, 1.52, -0.05), LID_BLACK, LID_BLACK, 180),
    ...[-1, 1].map((s) => B('Fork pocket', [0.14, 0.18, 1.88], L(s * 0.72, 1.0, -0.05), DUMP_BLUE)),
    ...(p.tags === 'yes' ? [fit(B('Tag', [1.6, 0.8, 0.01], L(0, 0.4, 0.76), TAGS[0]))] : []),
  ], ['dumpster', 'skip', 'trash']),
  srdumpsterlarge: sr('Dumpster (large)', 'A big rusty dumpster with a lid, 3.48 × 2.00 m and 2.06 m tall', [yesNo('tags', 'Graffiti', 'yes')], (L, p) => [
    ...[-1.5, 1.5].flatMap((x) => [-0.75, 0.75].map((z) => B('Caster', [0.14, 0.16, 0.14], L(x, 0, z), BLACK))),
    bv(B('Dumpster', [3.48, 1.64, 1.86], L(0, 0.16, 0), DUMP_RUST), 0.04),
    R('Dumpster lid', [3.48, 0.26, 1.94], L(0, 1.8, 0), LID_BLACK, LID_BLACK, 180),
    ...[-1, 1].map((s) => B('Side bar', [3.52, 0.1, 0.07], L(0, 1.2, s * 0.96), DUMP_RUST)),
    ...(p.tags === 'yes' ? [fit(B('Tag', [2.6, 1.0, 0.01], L(0, 0.4, 0.94), TAGS[1]))] : []),
  ], ['dumpster', 'trash']),
  srskip: sr('Construction skip', 'An open steel skip for rubble, 5.10 × 3.15 m and 1.67 m tall', [], (L) => [
    B('Skip floor', [4.6, 0.12, 2.65], L(0, 0, 0), SKIP_GREY),
    B('Skip side', [5.1, 1.55, 0.1], L(0, 0.12, 1.52), SKIP_GREY), B('Skip side', [5.1, 1.55, 0.1], L(0, 0.12, -1.52), SKIP_GREY),
    B('Skip end', [0.1, 1.55, 2.95], L(2.5, 0.12, 0), SKIP_GREY), B('Skip end', [0.1, 1.55, 2.95], L(-2.5, 0.12, 0), SKIP_GREY),
    B('Rubble', [4.6, 0.7, 2.6], L(0, 0.12, 0), conc('#8a847a', 1042, 0.8, '#4a463e')),
    ...[-1, 1].map((s) => B('Lifting lug', [0.2, 0.3, 0.12], L(s * 2.0, 1.37, 1.6), STEEL)),
  ], ['skip', 'rubble', 'construction']),
  srcontainer: sr('Shipping container', 'A 10 m steel shipping container, 3.08 m wide and 2.92 m tall, doors at −X', [colorParam('blue', ['red', 'blue', 'green', 'white', 'orange']), yesNo('tags', 'Graffiti', 'no')], (L, p) => {
    const t = metal(COLORS[String(p.color)] ?? COLORS.blue, 1044 + ['red', 'blue', 'green', 'white', 'orange'].indexOf(String(p.color)), 0.35, 15, 10)
    return [
      B('Container', [10.06, 2.82, 3.08], L(0, 0.1, 0), t, t, 0, 3),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => B('Corner casting', [0.2, 0.1, 0.2], L(sx * 4.93, 0, sz * 1.44), DARK_METAL))),
      ...[-0.75, 0.75].map((z) => B('Door bar', [0.05, 2.6, 0.06], L(-5.05, 0.2, z), STEEL)),
      B('Door seam', [0.02, 2.7, 0.03], L(-5.04, 0.15, 0), DARK_METAL),
      ...(p.tags === 'yes' ? [fit(B('Tag', [5, 1.6, 0.01], L(1, 0.5, 1.545), TAGS[2]))] : []),
    ]
  }, ['container', 'cargo', 'shipping']),
  srcrate: sr('Shipping crate', 'A wooden crate: large 2.13 × 1.80 × 1.63 m, medium 1.98 × 1.32 × 1.20 m or low 1.61 × 1.36 × 0.82 m', [sel('size', 'Size', [['large', 'Large'], ['medium', 'Medium'], ['low', 'Low']], 'medium')], (L, p) => {
    const [l, w, h] = p.size === 'large' ? [2.13, 1.8, 1.63] : p.size === 'low' ? [1.61, 1.36, 0.82] : [1.98, 1.32, 1.2]
    return [
      ...[-1, 1].map((s) => B('Crate skid', [l, 0.1, 0.12], L(0, 0, s * (w / 2 - 0.12)), CRATE_WOOD)),
      B('Shipping crate', [l, h - 0.1, w], L(0, 0.1, 0), CRATE_WOOD, CRATE_WOOD, 0, 1.2),
      ...[-1, 1].flatMap((s) => [B('Crate batten', [0.1, h - 0.1, w + 0.04], L(s * (l / 2 - 0.05), 0.1, 0), CRATE_WOOD), B('Crate batten', [l + 0.04, 0.1, w + 0.04], L(0, s > 0 ? h - 0.1 : 0.1, 0), CRATE_WOOD)]),
    ]
  }, ['crate', 'box', 'cover']),
  srpallets: sr('Pallet stack', 'Big wooden pallets, 2.16 × 1.89 m, stacked', [num('n', 'Pallets', 1, 10, 3)], (L, p) => [...Array(+p.n)].flatMap((_, i) => {
    const y = i * 0.23, r = i % 2 ? 2 : -2
    return [
      ...[-0.8, 0, 0.8].map((z) => B('Pallet block', [2.16, 0.1, 0.15], L(0, y, z), PALLET_WOOD, PALLET_WOOD, r)),
      B('Pallet deck', [2.16, 0.13, 1.89], L(0, y + 0.1, 0), PALLET_WOOD, PALLET_WOOD, r, 1),
    ]
  }), ['pallet', 'skid']),
  srboxes: sr('Cardboard boxes', 'A pile of cardboard boxes (0.44 m and 0.84 m)', [], (L) => [
    B('Box', [0.84, 0.77, 0.79], L(0, 0, 0), CARDBOARD), B('Box', [0.84, 0.77, 0.79], L(0.86, 0, 0.1), CARDBOARD, CARDBOARD, 8),
    B('Box', [0.84, 0.77, 0.79], L(0.4, 0.77, 0.05), CARDBOARD, CARDBOARD, -6),
    B('Box', [0.44, 0.44, 0.44], L(-0.75, 0, 0.3), CARDBOARD, CARDBOARD, 15), B('Box', [0.44, 0.44, 0.44], L(-0.7, 0, -0.3), CARDBOARD, CARDBOARD, -10),
    B('Box', [0.44, 0.44, 0.44], L(-0.72, 0.44, 0), CARDBOARD, CARDBOARD, 30),
  ], ['boxes', 'cardboard', 'moving']),
  srdrums: sr('Oil drums', '55-gallon drums, 0.78 m across and 1.04 m tall', [num('n', 'Drums', 1, 8, 3), colorParam('blue', ['blue', 'red', 'green', 'yellow', 'white', 'black'])], (L, p) => {
    const t = painted(p, 1070, 16, 1), spots = [[0, 0], [0.8, 0.05], [0.4, 0.7], [-0.4, 0.7], [-0.8, 0], [1.2, 0.75], [0, 1.4], [-1.2, 0.75]]
    return spots.slice(0, +p.n).flatMap(([x, z]) => [C('Oil drum', 0.76, 1.04, L(x, 0, z), t, t, 12), ...[0.33, 0.7].map((y) => C('Drum hoop', 0.78, 0.03, L(x, y, z), t, t, 12))])
  }, ['barrel', 'drum', 'oil']),
  srspool: sr('Cable spool', 'A big wooden cable spool lying flat, 1.66 m across and 1.04 m tall', [], (L) => [
    C('Spool flange', 1.66, 0.12, L(0, 0, 0), SPOOL_WOOD, SPOOL_WOOD, 14), C('Spool core', 0.9, 0.8, L(0, 0.12, 0), SPOOL_WOOD, PB.black, 12), C('Spool flange', 1.66, 0.12, L(0, 0.92, 0), SPOOL_WOOD, SPOOL_WOOD, 14),
  ], ['spool', 'reel', 'table']),
  srcinder: sr('Cinder blocks', 'A stack of cinder blocks (0.66 × 0.29 × 0.31 m)', [num('rows', 'Rows', 1, 6, 3)], (L, p) => [...Array(+p.rows)].flatMap((_, k) =>
    [-0.67, 0, 0.67].slice(0, 3 - (k % 2)).map((x) => B('Cinder block', [0.66, 0.31, 0.29], L(x + (k % 2) * 0.335, k * 0.31, 0), PB.cinder))), ['blocks', 'cinder']),
  srlumber: sr('Lumber stack', 'Banded lumber on bearers, 2.44 × 1.43 m and 1.12 m tall', [], (L) => [
    ...[-0.9, 0, 0.9].map((x) => B('Bearer', [0.1, 0.1, 1.43], L(x, 0, 0), PALLET_WOOD)),
    ...[0, 1].map((k) => B('Lumber', [2.44, 0.5, 1.43], L(0, 0.1 + k * 0.51, 0), LUMBER, LUMBER, 0, 1)),
    ...[-0.6, 0.6].map((x) => B('Strap', [0.04, 1.03, 1.45], L(x, 0.1, 0), BLACK)),
  ], ['lumber', 'wood', 'planks']),
  srsewerpipe: sr('Concrete pipe', 'A 3.65 m concrete drain pipe lying on the ground, 1.27 m across', [num('n', 'Pipes', 1, 4, 1)], (L, p) => [...Array(+p.n)].flatMap((_, i) => {
    const z = (i - (+p.n - 1) / 2) * 1.32
    return [Y('Concrete pipe', 1.27, 3.65, L(0, 0, z), PIPE_CONC, PIPE_CONC, 14), ...[-1, 1].map((s) => Y('Pipe opening', 0.95, 0.02, L(s * 1.83, 0.16, z), PIPE_HOLE, PIPE_HOLE, 14))]
  }), ['pipe', 'culvert', 'cover']),
  srtrashbags: sr('Trash bags', 'A heap of black garbage bags (0.78 m each)', [num('n', 'Bags', 1, 9, 5)], (L, p) => {
    const spots = [[0, 0, 0], [0.7, 0.15, 0], [-0.65, 0.2, 0], [0.3, -0.55, 0], [0.2, 0.05, 0.55], [-0.4, -0.5, 0], [1.2, -0.4, 0], [-1.1, -0.3, 0], [-0.3, 0.1, 0.55]]
    return spots.slice(0, +p.n).flatMap(([x, z, y], i) => sack(L(x, y, z), (0.78 - (i % 3) * 0.06) * S, (0.72 - (i % 2) * 0.12) * S, TRASH_BAG, i * 23))
  }, ['garbage', 'bags', 'trash']),
  srtires: sr('Old tires', 'Tires lying flat, 0.83 m across, stacked', [num('n', 'Tires', 1, 8, 4)], (L, p) => [...Array(+p.n)].map((_, i) => C('Tire', 0.83, 0.23, L((i % 2) * 0.06, i * 0.23, 0), BLACK, RUBBER, 14)), ['tires', 'tyres', 'junk']),
  srcarhusk: sr('Burned car shell', 'A burned-out car shell sitting on the ground, 3.76 × 1.76 m', [], (L) => [
    bv(B('Car shell', [1.76, 0.62, 3.76], L(0, 0.1, 0), BURNT), 0.1),
    bv(B('Burned cabin', [1.6, 0.6, 1.9], L(0, 0.72, -0.3), SOOT, BURNT), 0.08),
    bv(B('Shell roof', [1.5, 0.07, 1.6], L(0, 1.32, -0.35), BURNT), 0.02),
    ...[-1.2, 1.2].flatMap((z) => [-0.72, 0.72].map((x) => Y('Bare rim', 0.4, 0.1, L(x, 0, z), DARK_METAL, DARK_METAL, 8))),
  ], ['wreck', 'burned car', 'husk']),
  srgascylinders: sr('Gas cylinders', 'Tall welding gas bottles (0.26 m, 1.63 m) and small propane tanks', [], (L) => [
    ...[[0, 0], [0.3, 0.05], [0.15, 0.3]].flatMap(([x, z]) => [C('Gas cylinder', 0.26, 1.48, L(x, 0, z), GAS_BOTTLE, GAS_BOTTLE, 10), tp(C('Cylinder neck', 0.26, 0.1, L(x, 1.48, z), GAS_BOTTLE, GAS_BOTTLE, 10), 0.4), C('Valve', 0.07, 0.05, L(x, 1.58, z), STEEL, STEEL, 6)]),
    ...[[-0.55, 0.1], [-0.6, 0.55]].flatMap(([x, z]) => [C('Propane tank', 0.38, 0.42, L(x, 0, z), WHITE, WHITE, 10), tp(C('Tank top', 0.38, 0.09, L(x, 0.42, z), WHITE, WHITE, 10), 0.4)]),
  ], ['gas', 'propane', 'welding']),
  srportapotty: sr('Portable toilet', 'A site toilet cabin, 1.71 m square and 2.93 m tall, door at +Z', [], (L) => [
    B('Toilet skid', [1.71, 0.12, 1.71], L(0, 0, 0), PORTA),
    bv(B('Toilet cabin', [1.6, 2.5, 1.6], L(0, 0.12, 0), PORTA), 0.04),
    tp(C('Toilet roof', 2.3, 0.3, L(0, 2.62, 0), WHITE, WHITE, 4, 45), 0.62),
    B('Toilet door', [0.93, 2.3, 0.05], L(0, 0.2, 0.81), solid('#2e5f6a', '#24505a', 1043)),
    B('Vent stack', [0.12, 0.4, 0.12], L(0.55, 2.6, -0.55), PORTA),
  ], ['toilet', 'porta', 'site']),
}

// ---------------- shop, patio and big signs ----------------

const SHOP: Record<string, Def> = {
  srgaspump: sr('Gas pump', 'A gas pump with a lit price panel and two hoses, 2.66 m', [num('n', 'Pumps', 1, 4, 1)], (L, p) => [
    bv(B('Pump island', [Math.max(1.8, +p.n * 2.2), 0.18, 1.3], L(0, 0, 0), CEMENT), 0.04),
    ...row(L, +p.n, 2.2, (M) => [
      bv(B('Pump body', [1.25, 1.75, 0.6], M(0, 0.18, 0), PUMP_WHITE), 0.05),
      bv(B('Pump top', [1.39, 0.5, 0.66], M(0, 1.93, 0), PUMP_RED), 0.05),
      ...[-1, 1].flatMap((s) => [fit(B('Price screen', [0.6, 0.3, 0.02], M(0, 1.45, s * 0.31), SCREEN)), B('Nozzle', [0.12, 0.25, 0.1], M(0.5, 1.0, s * 0.33), BLACK), B('Hose', [0.04, 0.8, 0.04], M(0.62, 0.3, s * 0.36), BLACK)]),
      fit(B('Pump sign', [0.9, 0.18, 0.7], M(0, 2.43, 0), PUMP_RED, words('OPEN', 3, '#c42a22', '#f2f2ee', 15))),
    ]),
  ], ['gas station', 'fuel', 'pump']),
  srsodamachine: sr('Soda machine', 'A drinks machine with a printed front, 1.08 × 0.66 m and 2.04 m tall', [], (L) => [
    bv(B('Soda machine', [1.08, 2.04, 0.62], L(0, 0, 0), PUMP_RED), 0.03),
    fit(B('Soda front', [0.72, 1.6, 0.03], L(-0.12, 0.3, 0.32), SODA_FRONT)),
    B('Selection panel', [0.2, 0.9, 0.03], L(0.38, 0.8, 0.32), BLACK), B('Dispense slot', [0.5, 0.16, 0.04], L(-0.12, 0.08, 0.33), BLACK),
  ], ['vending', 'drinks', 'soda']),
  srsnackmachine: sr('Snack machine', 'A glass-front snack machine, 1.36 × 0.83 m and 2.29 m tall', [], (L) => [
    bv(B('Snack machine', [1.36, 2.29, 0.8], L(0, 0, 0), BLACK), 0.03),
    B('Snack goods', [0.9, 1.5, 0.05], L(-0.15, 0.55, 0.39), SNACK_GOODS, SNACK_GOODS, 0, 0.75),
    B('Snack glass', [0.94, 1.56, 0.02], L(-0.15, 0.52, 0.42), GLASS), fit(B('Keypad', [0.22, 0.35, 0.02], L(0.5, 1.1, 0.41), SCREEN)),
    B('Pickup slot', [0.9, 0.2, 0.03], L(-0.15, 0.15, 0.41), DARK_METAL),
  ], ['vending', 'snacks']),
  srfoldtable: sr('Folding table', 'A long plastic folding table, 3.50 × 1.00 m and 0.88 m tall', [], (L) => [
    bv(B('Table top', [3.5, 0.05, 1.0], L(0, 0.83, 0), WHITE), 0.015),
    ...[-1.55, 1.55].flatMap((x) => [-0.4, 0.4].map((z) => B('Table leg', [0.04, 0.83, 0.04], L(x, 0, z), STEEL))),
    ...[-1.55, 1.55].map((x) => B('Leg brace', [0.03, 0.03, 0.8], L(x, 0.15, 0), STEEL)),
  ], ['table', 'market']),
  srbillboard: sr('Billboard', 'A roadside billboard with a poster: ground frame (7.55 m wide, 3.50 m tall) or pole sign (14.4 m wide, 21.6 m tall)', [sel('kind', 'Kind', [['small', 'Ground frame'], ['tall', 'Tall pole sign']], 'small'), sel('ad', 'Poster', [['0', 'Red'], ['1', 'Blue'], ['2', 'Night'], ['3', 'Yellow'], ['4', 'Green']], '0')], (L, p) => {
    const ad = POSTERS[+p.ad] ?? POSTERS[0]
    if (p.kind === 'tall') return [
      C('Billboard footing', 1.6, 1.0, L(0, 0, 0), CEMENT, CEMENT, 10),
      tp(C('Billboard pole', 1.0, 16.4, L(0, 1.0, 0), STEEL, STEEL, 10), 0.8),
      B('Head frame', [10, 0.5, 0.5], L(0, 16.9, -0.3), DARK_METAL),
      fit(B('Billboard', [14.4, 4.6, 0.35], L(0, 17.0, 0), DARK_METAL, ad)),
      B('Catwalk', [14.4, 0.08, 1.2], L(0, 16.85, 0.75), PB.diamond),
      B('Catwalk rail', [14.4, 0.04, 0.04], L(0, 17.85, 1.33), STEEL),
      ...[-6, -2, 2, 6].map((x) => B('Billboard lamp', [0.3, 0.2, 0.5], L(x, 21.4, 0.45), DARK_METAL, LENS)),
    ]
    return [
      ...[-2.5, 2.5].flatMap((x) => [B('Billboard leg', [0.2, 3.5, 0.2], L(x, 0, 0), POLE_WOOD), R('Brace', [0.12, 1.8, 2.0], L(x, 0, -1.1), POLE_WOOD, POLE_WOOD, 180)]),
      fit(B('Billboard', [7.55, 2.6, 0.18], L(0, 0.9, 0.2), FENCE_BOARD, ad)),
      B('Billboard trim', [7.6, 0.12, 0.24], L(0, 3.38, 0.2), FENCE_BOARD),
    ]
  }, ['billboard', 'advert', 'sign']),
  srstairblock: sr('Exterior stairs', 'A concrete stair block up to a 2.13 m landing with a rail, 4.83 × 4.38 m', [], (L) => [
    B('Landing', [4.83, 2.13, 1.8], L(0, 0, -1.29), STAIR_CONC),
    St('Steps', [1.4, 2.13, 2.58], L(-1.7, 0, 0.9), STAIR_CONC, STAIR_CONC, 0, 12),
    B('Step wall', [0.2, 2.6, 2.58], L(-0.9, 0, 0.9), STAIR_CONC),
    B('Landing rail', [3.4, 0.05, 0.05], L(0.715, 3.1, -0.42), STEEL),
    ...[-0.95, 0.7, 2.39].map((x) => B('Rail post', [0.05, 0.97, 0.05], L(x, 2.13, -0.42), STEEL)),
  ], ['stairs', 'steps', 'landing']),
}

// ---------------- vehicles ----------------

interface Body {
  /** Length, width with mirrors and roof height, metres. */
  len: number; w: number; h: number
  /** Wheel radius and tire width. */
  r: number; tw: number
  /** Body bottom above the ground (default: half the wheel radius). */
  ride?: number
  /** Belt line (top of the doors) as a share of the height above the body bottom. */
  belt?: number
  /** Glass cabin from c0 (rear) to c1 (front), metres along the car; none when equal. */
  cab?: [number, number]
  /** Wheelbase; the axles sit a little forward of the middle. */
  wb?: number
  mirror?: number
  bumper?: Tex; glass?: Tex
  noWheels?: boolean
}

/** A car-shaped body: lower body, glass cabin and painted roof, mirrors, bumpers, lights and round wheels. Nose at +Z. */
function carBody(L: Lf, Lu: Lf, paint: Tex, o: Body): Part[] {
  const mir = o.mirror ?? 0.1, bw = o.w - 2 * mir, f = o.len / 2
  const ride = o.ride ?? Math.max(0.16, o.r * 0.5)
  const belt = ride + (o.h - ride) * (o.belt ?? 0.52)
  const [c0, c1] = o.cab ?? [-f * 0.62, f * 0.22]
  const wb = o.wb ?? o.len * 0.58, front = f - (o.len - wb) * 0.47, rear = front - wb
  const out: Part[] = [bv(B('Body', [bw, belt - ride, o.len], L(0, ride, 0), paint), 0.14)]
  if (c1 > c0) out.push(
    bv(B('Cabin', [bw - 0.14, o.h - belt - 0.05, c1 - c0], L(0, belt, (c0 + c1) / 2), o.glass ?? GLASS), 0.16),
    bv(B('Roof', [bw - 0.2, 0.05, c1 - c0 - 0.24], L(0, o.h - 0.05, (c0 + c1) / 2), paint), 0.02),
    ...[-1, 1].map((sx) => bv(B('Mirror', [mir + 0.03, 0.1, 0.16], L(sx * (bw / 2 + mir / 2), belt - 0.02, c1 - 0.12), paint), 0.02)),
  )
  const bump = o.bumper ?? TRIM
  out.push(
    ...[-1, 1].map((k) => bv(B('Bumper', [bw + 0.04, 0.2, 0.16], L(0, Math.max(0.02, ride - 0.04), k * (f - 0.06)), bump), 0.05)),
    B('Grille', [bw * 0.42, 0.18, 0.03], L(0, ride + 0.2, f + 0.01), TRIM),
    ...[-1, 1].flatMap((sx) => [
      B('Headlight', [0.34, 0.14, 0.03], L(sx * (bw / 2 - 0.3), belt - 0.22, f + 0.01), HEADLIGHT),
      B('Tail light', [0.3, 0.16, 0.03], L(sx * (bw / 2 - 0.27), belt - 0.22, -f - 0.01), TAILLIGHT),
    ]),
  )
  if (!o.noWheels) out.push(...wheels(Lu, (bw - o.tw) * S, [front * S, rear * S], 2 * o.r * S, o.tw * S))
  return out
}

/** A tall box body (vans, trucks, buses): one box from the ride height up, a windshield band and wheels. */
function boxBody(L: Lf, Lu: Lf, paint: Tex, o: { len: number; w: number; h: number; r: number; tw: number; ride?: number; axles: number[]; mirror?: number; windows?: [number, number, number, number] }): Part[] {
  const mir = o.mirror ?? 0.22, bw = o.w - 2 * mir, f = o.len / 2, ride = o.ride ?? o.r * 0.75
  const out: Part[] = [bv(B('Body', [bw, o.h - ride, o.len], L(0, ride, 0), paint), 0.12)]
  if (o.windows) { const [y0, y1, z0, z1] = o.windows; out.push(B('Side windows', [bw + 0.02, y1 - y0, z1 - z0], L(0, y0, (z0 + z1) / 2), GLASS)) }
  out.push(
    ...[-1, 1].map((sx) => B('Mirror', [mir + 0.02, 0.32, 0.08], L(sx * (bw / 2 + mir / 2), Math.min(o.h - 0.8, 1.9), f - 0.4), BLACK)),
    ...[-1, 1].map((k) => bv(B('Bumper', [bw + 0.04, 0.25, 0.18], L(0, Math.max(0.05, ride - 0.1), k * (f - 0.05)), TRIM), 0.05)),
    ...[-1, 1].flatMap((sx) => [B('Headlight', [0.34, 0.2, 0.03], L(sx * (bw / 2 - 0.3), ride + 0.35, f + 0.01), HEADLIGHT), B('Tail light', [0.2, 0.4, 0.03], L(sx * (bw / 2 - 0.15), ride + 0.4, -f - 0.01), TAILLIGHT)]),
    ...wheels(Lu, (bw - o.tw) * S, o.axles.map((a) => a * S), 2 * o.r * S, o.tw * S),
  )
  return out
}
const lightBar = (L: Lf, y: number, z: number, w = 1.2): Part[] => [
  B('Light bar', [w, 0.06, 0.26], L(0, y, z), TRIM),
  bv(B('Beacon', [w / 2 - 0.04, 0.1, 0.22], L(-w / 4, y + 0.06, z), LAMP_RED), 0.03), bv(B('Beacon', [w / 2 - 0.04, 0.1, 0.22], L(w / 4, y + 0.06, z), solid('#2050ff', '#102080', 1045)), 0.03),
]

/** Paint by color: the street car's palette shares its textures. */
const paint = (c: string): Tex => { const i = CAR_COLORS.findIndex(([k]) => k === c); return carPaint(c, i >= 0 ? 341 + i : 1046 + (parseInt(c.slice(1), 16) % 40)) }
const paintParam = (def: string, options: [string, string][] = CAR_COLORS) => sel('color', 'Paint', options, def)
const P = (p: Params) => paint(String(p.color))

/** Trailers: box, tanker or flatbed, nose at +Z with the king pin 1 m behind it. */
function trailerParts(L: Lf, Lu: Lf, kind: string): Part[] {
  if (kind === 'tank') {
    const len = 15.25, f = len / 2
    return [
      B('Tank frame', [1.0, 0.25, len - 1], L(0, 1.1, 0), TRIM),
      Y('Tank', 2.25, len - 0.6, L(0, 1.32, 0), CHROME, CHROME, 16, 90),
      B('Tank walkway', [0.6, 0.05, len - 3], L(0, 3.57, 0), PB.diamond),
      ...[-1, 1].map((s) => B('Landing leg', [0.12, 1.1, 0.12], L(s * 0.9, 0, f - 3), STEEL)),
      ...wheels(Lu, (2.6 - 0.72) * S, [(-f + 1.6) * S, (-f + 2.9) * S], 2 * 0.589 * S, 0.72 * S),
    ]
  }
  if (kind === 'flat') {
    const len = 15.7, f = len / 2
    return [
      B('Flatbed deck', [2.6, 0.3, len], L(0, 1.25, 0), PB.planks, TRIM),
      ...[-1, 1].map((s) => B('Landing leg', [0.12, 1.25, 0.12], L(s * 0.9, 0, f - 3), STEEL)),
      ...[-4, 0, 4].map((z) => B('Load', [2.3, 1.1, 2.4], L(0, 1.55, z), CRATE_WOOD)),
      ...wheels(Lu, (2.6 - 0.72) * S, [(-f + 1.6) * S, (-f + 2.9) * S], 2 * 0.58 * S, 0.72 * S),
    ]
  }
  const len = 16.24, f = len / 2
  return [
    B('Trailer chassis', [1.0, 0.3, len - 1], L(0, 1.0, 0), TRIM),
    bv(B('Box trailer', [2.6, 2.77, len], L(0, 1.3, 0), { gen: 'metal_plate', tweak: { color: '#e4e4e0', accent: '#9a9a96', scale: 8, wear: 0.15, seed: 711 }, surface: 15 }), 0.05),
    B('Rear doors', [2.5, 2.6, 0.04], L(0, 1.38, -f - 0.01), STEEL),
    ...[-1, 1].map((s) => B('Landing leg', [0.12, 1.0, 0.12], L(s * 0.9, 0, f - 3), STEEL)),
    ...[-1, 1].map((s) => B('Side skirt', [0.04, 0.5, 6], L(s * 1.28, 0.6, 0), TRIM)),
    ...wheels(Lu, (2.6 - 0.72) * S, [(-f + 1.5) * S, (-f + 2.8) * S], 2 * 0.574 * S, 0.72 * S),
  ]
}
/** A semi tractor 9.1 m long (front bumper at z +4.55); its fifth wheel is at z −2.55. */
function semiCab(L: Lf, Lu: Lf, body: Tex): Part[] {
  const f = 4.55
  return [
    B('Frame', [1.0, 0.35, 9.0], L(0, 0.8, 0), TRIM),
    bv(B('Bumper', [2.6, 0.45, 0.3], L(0, 0.5, f - 0.15), CHROME), 0.08),
    bv(B('Hood', [2.3, 1.2, 2.0], L(0, 0.95, f - 1.3), body), 0.2),
    fit(B('Grille', [1.3, 1.05, 0.04], L(0, 1.0, f - 0.29), CHROME)),
    ...[-1, 1].map((s) => B('Headlight', [0.36, 0.22, 0.04], L(s * 0.95, 1.2, f - 0.29), HEADLIGHT)),
    bv(B('Cab', [2.55, 1.85, 2.0], L(0, 1.15, f - 3.3), body), 0.15),
    B('Windshield', [2.3, 0.85, 0.04], L(0, 2.1, f - 2.29), GLASS), B('Side windows', [2.57, 0.7, 1.0], L(0, 2.2, f - 2.9), GLASS),
    bv(B('Sleeper', [2.55, 2.6, 1.7], L(0, 1.15, f - 5.15), body), 0.15),
    ...[-1, 1].flatMap((s) => [C('Exhaust stack', 0.18, 3.1, L(s * 1.37, 1.15, -1.0), CHROME, CHROME, 8), Y('Fuel tank', 0.62, 1.3, L(s * 1.0, 0.4, f - 3.6), CHROME, CHROME, 12, 90),
      B('Mirror', [0.32, 0.45, 0.08], L(s * 1.44, 2.1, f - 2.2), BLACK)]),
    B('Fifth wheel', [1.2, 0.12, 1.0], L(0, 1.15, -2.55), TRIM),
    ...wheels(Lu, (2.5 - 0.36) * S, [(f - 1.4) * S], 2 * 0.595 * S, 0.36 * S),
    ...wheels(Lu, (2.5 - 0.72) * S, [-2.0 * S, -3.35 * S], 2 * 0.595 * S, 0.72 * S),
  ]
}

const CHECKER: Tex = { gen: 'tiles', tweak: { color: '#e6e2d8', accent: '#202024', scale: 6, wear: 0.1, seed: 1047 }, surface: 15 }
const YELLOW_PAINT = carPaint('#e0b020', 346)
const BLACK_PAINT = carPaint('#202020', 344)
const WHITE_PAINT = carPaint('#e8e8e8', 347)

const VEHICLES: Record<string, Def> = {
  srcompact: sr('Compact car (city)', 'A small two-door hatch: 4.18 m long, 2.08 m wide, 1.40 m tall', [paintParam('#2f8a3a')], (L, p, Lu) =>
    carBody(L, Lu, P(p), { len: 4.18, w: 2.08, h: 1.4, r: 0.33, tw: 0.26, cab: [-1.85, 0.55], belt: 0.5, wb: 2.5 }), ['car', 'hatchback']),
  srsedan: sr('Sedan (city)', 'A standard four-door: 4.93 m long, 2.06 m wide, 1.39 m tall', [paintParam('#2a5ab8')], (L, p, Lu) =>
    carBody(L, Lu, P(p), { len: 4.93, w: 2.06, h: 1.39, r: 0.36, tw: 0.28, cab: [-1.45, 0.75], wb: 2.85 }), ['car']),
  srcruiser: sr('Full-size cruiser', 'A long American two-tone cruiser: 5.51 m long, 2.04 m wide, 1.28 m tall', [paintParam('#7a2a7a')], (L, p, Lu) => [
    ...carBody(L, Lu, P(p), { len: 5.51, w: 2.04, h: 1.28, r: 0.37, tw: 0.29, cab: [-1.6, 0.55], belt: 0.55, wb: 3.05, bumper: CHROME }),
    B('Chrome strip', [1.86, 0.04, 5.0], L(0, 0.55, 0), CHROME),
  ], ['car', 'muscle', 'classic']),
  srsports: sr('Sports coupe (city)', 'A low wide sports car: 4.98 m long, 2.30 m wide, 1.19 m tall', [paintParam('#e0b020')], (L, p, Lu) => [
    ...carBody(L, Lu, P(p), { len: 4.98, w: 2.3, h: 1.19, r: 0.38, tw: 0.33, ride: 0.14, cab: [-1.25, 0.35], belt: 0.5, wb: 2.75 }),
    ...[-1, 1].map((s) => B('Wing strut', [0.06, 0.18, 0.1], L(s * 0.6, 0.66, -2.25), TRIM)),
    bv(B('Rear wing', [1.8, 0.04, 0.32], L(0, 0.84, -2.25), P(p)), 0.015),
  ], ['car', 'sports']),
  srwagon: sr('Station wagon', 'A long-roof wagon: 4.83 m long, 2.06 m wide, 1.51 m tall', [paintParam('#d0d0d0')], (L, p, Lu) => [
    ...carBody(L, Lu, P(p), { len: 4.83, w: 2.06, h: 1.51, r: 0.37, tw: 0.27, cab: [-2.2, 0.75], wb: 2.85 }),
    ...[-0.7, 0.7].map((x) => B('Roof rail', [0.05, 0.05, 2.4], L(x, 1.51, -0.7), TRIM)),
  ], ['car', 'estate']),
  srsuv: sr('SUV (city)', 'A tall four-by-four: 5.49 m long with the spare wheel, 2.25 m wide, 1.87 m tall, on big wheels', [paintParam('#202020')], (L, p, Lu) => [
    ...carBody(L, Lu, P(p), { len: 5.24, w: 2.25, h: 1.87, r: 0.46, tw: 0.35, ride: 0.3, cab: [-2.35, 0.85], belt: 0.5, wb: 3.0 }),
    ...[-0.8, 0.8].map((x) => B('Roof rail', [0.06, 0.08, 2.6], L(x, 1.87, -0.75), TRIM)),
    Y('Spare wheel', 0.82, 0.25, L(0, 0.55, -2.745), RUBBER, RUBBER, 12, 90),
  ], ['suv', '4x4', 'truck']),
  srpickup: sr('Pickup (city)', 'A full-size pickup with an open bed: 5.42 m long, 2.23 m wide, 1.75 m tall', [paintParam('#b8322a'), sel('load', 'Load', [['none', 'Empty'], ['boxes', 'Boxes'], ['tires', 'Tires']], 'none')], (L, p, Lu) => {
    const c = P(p), f = 2.71, bw = 2.03, ride = 0.3, belt = 1.05, bed0 = -f, bed1 = -0.35
    return [
      bv(B('Front body', [bw, belt - ride, f - bed1], L(0, ride, (f + bed1) / 2), c), 0.12),
      bv(B('Cab glass', [bw - 0.14, 1.75 - belt - 0.05, 1.5], L(0, belt, bed1 + 0.8), GLASS), 0.14),
      bv(B('Cab roof', [bw - 0.2, 0.05, 1.3], L(0, 1.7, bed1 + 0.8), c), 0.02),
      B('Bed floor', [bw, 0.3, bed1 - bed0], L(0, ride, (bed0 + bed1) / 2), PB.diamond, c),
      ...[-1, 1].map((s) => B('Bed side', [0.06, belt - ride - 0.3, bed1 - bed0], L(s * (bw / 2 - 0.03), ride + 0.3, (bed0 + bed1) / 2), c)),
      B('Tailgate', [bw, belt - ride - 0.3, 0.06], L(0, ride + 0.3, bed0 + 0.03), c),
      ...(p.load === 'boxes' ? [B('Box', [0.8, 0.6, 0.7], L(-0.4, ride + 0.3, -1.6), CARDBOARD), B('Box', [0.7, 0.5, 0.7], L(0.45, ride + 0.3, -1.3), CARDBOARD, CARDBOARD, 10)]
        : p.load === 'tires' ? [C('Tire', 0.75, 0.22, L(-0.45, ride + 0.3, -1.5), BLACK, RUBBER, 12), C('Tire', 0.75, 0.22, L(-0.45, ride + 0.52, -1.5), BLACK, RUBBER, 12), C('Tire', 0.75, 0.22, L(0.45, ride + 0.3, -1.1), BLACK, RUBBER, 12)] : []),
      ...[-1, 1].map((k) => bv(B('Bumper', [bw + 0.04, 0.22, 0.16], L(0, 0.28, k * (f - 0.06)), CHROME), 0.05)),
      ...[-1, 1].flatMap((sx) => [B('Headlight', [0.34, 0.16, 0.03], L(sx * 0.72, 0.85, f + 0.01), HEADLIGHT), B('Tail light', [0.12, 0.3, 0.03], L(sx * 0.95, 0.72, -f - 0.01), TAILLIGHT),
        B('Mirror', [0.13, 0.12, 0.16], L(sx * 1.08, 1.02, 0.4), c)]),
      B('Grille', [1.0, 0.3, 0.03], L(0, 0.55, f + 0.01), CHROME),
      ...wheels(Lu, (bw - 0.36) * S, [1.75 * S, -1.6 * S], 2 * 0.43 * S, 0.36 * S),
    ]
  }, ['pickup', 'truck']),
  srminivan: sr('Minivan (city)', 'A family people-carrier: 5.17 m long, 2.20 m wide, 1.58 m tall', [paintParam('#d0d0d0')], (L, p, Lu) =>
    carBody(L, Lu, P(p), { len: 5.17, w: 2.2, h: 1.58, r: 0.37, tw: 0.28, ride: 0.2, cab: [-2.35, 1.2], belt: 0.45, wb: 3.0 }), ['van', 'minivan']),
  srvan: sr('Full-size van', 'A tall panel van with a short nose: 5.98 m long, 2.45 m wide, 2.07 m tall', [paintParam('#e8e8e8')], (L, p, Lu) => {
    const c = P(p), f = 2.99
    return [
      ...sub(L, 0, -0.45, 0, (M) => boxBody(M, Lu, c, { len: 5.08, w: 2.45, h: 2.07, r: 0.48, tw: 0.4, ride: 0.32, mirror: 0.15, axles: [], windows: [1.25, 1.85, 0.9, 2.1] })),
      bv(B('Van nose', [2.15, 0.8, 0.9], L(0, 0.32, f - 0.45), c), 0.12),
      R('Windshield', [2.05, 0.8, 0.6], L(0, 1.12, f - 1.2), GLASS, GLASS, 180),
      B('Grille', [1.0, 0.3, 0.03], L(0, 0.55, f + 0.01), TRIM),
      ...[-1, 1].map((sx) => B('Headlight', [0.3, 0.18, 0.03], L(sx * 0.75, 0.82, f + 0.01), HEADLIGHT)),
      B('Sliding door seam', [2.17, 1.4, 0.03], L(0, 0.4, 0.4), TRIM),
      ...wheels(Lu, (2.15 - 0.4) * S, [(f - 1.1) * S, (-f + 1.3) * S], 2 * 0.48 * S, 0.4 * S),
    ]
  }, ['van', 'delivery']),
  srtaxi: sr('Taxi (city)', 'A yellow cab with a roof sign and checker band: 5.35 m long, 2.33 m wide, 1.68 m to the sign', [], (L, _p, Lu) => [
    ...carBody(L, Lu, YELLOW_PAINT, { len: 5.35, w: 2.33, h: 1.45, r: 0.345, tw: 0.27, mirror: 0.14, cab: [-1.55, 0.8], wb: 2.95 }),
    ...[-1, 1].map((s) => B('Checker band', [0.02, 0.14, 2.4], L(s * 1.025, 0.62, -0.3), CHECKER)),
    fit(B('Taxi sign', [0.8, 0.23, 0.28], L(0, 1.45, -0.3), YELLOW_PAINT, words('TAXI', 3, '#f2d040', '#1d1d20', 17))),
  ], ['taxi', 'cab']),
  srpolice: sr('Police cruiser', 'A black-and-white patrol car with a light bar and push bar: 5.47 m long, 2.33 m wide, 1.50 m tall', [], (L, _p, Lu) => [
    ...carBody(L, Lu, BLACK_PAINT, { len: 5.47, w: 2.33, h: 1.36, r: 0.35, tw: 0.28, mirror: 0.14, cab: [-1.6, 0.8], wb: 3.0 }),
    ...[-1, 1].map((s) => B('White door', [0.02, 0.5, 2.3], L(s * 1.03, 0.25, -0.3), WHITE_PAINT)),
    B('White roof', [1.82, 0.02, 1.95], L(0, 1.36, -0.4), WHITE_PAINT),
    ...lightBar(L, 1.38, -0.2),
    B('Push bar', [1.0, 0.5, 0.08], L(0, 0.25, 2.8), BLACK), fit(B('Door word', [0.02, 0.18, 1.0], L(1.045, 0.5, -0.3), words('POLICE', 5, '#e8e8e8', '#1d1d20', 15))),
  ], ['police', 'cop', 'patrol']),
  srlimo: sr('Stretch limo', 'A black stretched limousine: 7.49 m long, 2.11 m wide, 1.45 m tall', [paintParam('#202020', [['#202020', 'Black'], ['#e8e8e8', 'White']])], (L, p, Lu) =>
    carBody(L, Lu, P(p), { len: 7.49, w: 2.11, h: 1.45, r: 0.384, tw: 0.28, cab: [-2.6, 0.9], wb: 4.9, bumper: CHROME, glass: solid('#14181c', '#0e1114', 1048, 9) }), ['limo', 'limousine']),
  srstepvan: sr('Step van', 'A boxy delivery truck: 6.44 m long, 2.45 m wide, 2.40 m tall', [paintParam('#e8e8e8')], (L, p, Lu) => [
    ...boxBody(L, Lu, P(p), { len: 6.44, w: 2.45, h: 2.4, r: 0.47, tw: 0.36, ride: 0.35, mirror: 0.2, axles: [2.2, -1.7] }),
    B('Windshield', [1.9, 0.8, 0.03], L(0, 1.35, 3.23), GLASS), B('Side door', [0.02, 1.8, 0.8], L(1.035, 0.4, 2.2), GLASS),
    B('Roll-up door', [1.8, 1.8, 0.03], L(0, 0.45, -3.23), SHUTTER),
  ], ['truck', 'delivery', 'box truck']),
  srambulance: sr('Ambulance (city)', 'A wide box ambulance with light bars: 6.65 m long, 3.01 m wide, 2.35 m tall', [], (L, _p, Lu) => [
    ...boxBody(L, Lu, WHITE_PAINT, { len: 6.65, w: 3.01, h: 2.2, r: 0.44, tw: 0.33, ride: 0.35, mirror: 0.25, axles: [2.3, -1.9] }),
    B('Windshield', [2.2, 0.75, 0.03], L(0, 1.35, 3.335), GLASS),
    ...[-1, 1].map((s) => B('Red stripe', [0.02, 0.22, 6.0], L(s * 1.265, 1.0, 0), LAMP_RED)),
    ...lightBar(L, 2.2, 2.9, 1.6), ...lightBar(L, 2.2, -3.1, 1.6),
  ], ['ambulance', 'medic', 'ems']),
  srgarbagetruck: sr('Garbage truck (city)', 'A refuse truck with a compactor body: 8.36 m long, 2.95 m wide, 4.25 m tall', [paintParam('#2f8a3a', [['#2f8a3a', 'Green'], ['#e8e8e8', 'White'], ['#e0b020', 'Yellow']])], (L, p, Lu) => {
    const c = P(p), f = 4.18
    return [
      B('Frame', [1.0, 0.35, 8.2], L(0, 0.75, 0), TRIM),
      bv(B('Cab', [2.5, 2.2, 2.0], L(0, 0.7, f - 1.0), c), 0.15), B('Windshield', [2.2, 0.9, 0.03], L(0, 1.85, f + 0.01), GLASS),
      bv(B('Compactor body', [2.5, 3.15, 4.9], L(0, 1.1, -0.65), c), 0.12),
      bv(B('Hopper', [2.5, 2.6, 1.3], L(0, 0.9, -f + 0.65), DARK_METAL), 0.1),
      ...[-1, 1].flatMap((s) => [B('Mirror', [0.25, 0.45, 0.08], L(s * 1.35, 1.8, f - 0.1), BLACK), B('Headlight', [0.3, 0.2, 0.03], L(s * 0.9, 1.0, f + 0.01), HEADLIGHT)]),
      ...wheels(Lu, (2.5 - 0.36) * S, [(f - 1.3) * S], 2 * 0.527 * S, 0.36 * S),
      ...wheels(Lu, (2.5 - 0.66) * S, [-1.6 * S, -2.9 * S], 2 * 0.527 * S, 0.66 * S),
    ]
  }, ['garbage', 'refuse', 'truck']),
  srbus: sr('City bus', 'A 13.37 m transit bus, 3.61 m across the mirrors and 3.20 m tall, doors on the right', [paintParam('#e8e8e8', [['#e8e8e8', 'White'], ['#2a5ab8', 'Blue'], ['#b8322a', 'Red'], ['#e0b020', 'Yellow']])], (L, p, Lu) => {
    const c = P(p), f = 6.685
    return [
      ...boxBody(L, Lu, c, { len: 13.37, w: 3.61, h: 2.95, r: 0.61, tw: 0.37, ride: 0.35, mirror: 0.5, axles: [f - 2.6], windows: [1.3, 2.5, -f + 0.8, f - 0.4] }),
      ...wheels(Lu, (2.6 - 0.74) * S, [(-f + 3.4) * S], 2 * 0.61 * S, 0.74 * S),
      B('Windshield', [2.4, 1.6, 0.03], L(0, 1.1, f + 0.01), GLASS),
      fit(B('Route sign', [1.8, 0.28, 0.03], L(0, 2.6, f + 0.02), words('BUS STOP', 4, '#1d1d20', '#f2a020', 15))),
      ...[f - 1.7, 0.6].map((z) => B('Bus door', [0.03, 2.3, 1.2], L(1.31, 0.35, z), GLASS)),
      B('Roof unit', [1.8, 0.25, 2.6], L(0, 2.95, -2.5), WHITE),
    ]
  }, ['bus', 'transit']),
  srsemi: sr('Semi truck (cab)', 'A 9.1 m semi tractor, 4.25 m to the stacks; hitch a trailer or run bobtail', [paintParam('#b8322a'), sel('trailer', 'Trailer', [['none', 'None'], ['box', 'Box (16.2 m)'], ['tank', 'Tanker (15.3 m)'], ['flat', 'Flatbed']], 'none')], (L, p, Lu) => [
    ...semiCab(L, Lu, P(p)),
    ...(p.trailer === 'none' ? [] : (() => { const len = p.trailer === 'tank' ? 15.25 : p.trailer === 'flat' ? 15.7 : 16.24, cz = -2.55 - (len / 2 - 1.0); return sub(L, 0, cz, 0, (M) => trailerParts(M, (a, b, c) => Lu(a, b, c + cz * S), String(p.trailer))) })()),
  ], ['semi', 'truck', 'tractor', 'rig']),
  srtrailer: sr('Semi trailer', 'A trailer on its landing legs: box 16.24 × 2.90 × 4.07 m, tanker 15.25 m or flatbed', [sel('kind', 'Kind', [['box', 'Box'], ['tank', 'Tanker'], ['flat', 'Flatbed']], 'box')], (L, p, Lu) => trailerParts(L, Lu, String(p.kind)), ['trailer', 'semi']),
  srbuggy: sr('Parking patrol buggy', 'A tiny parking-enforcement cart: 2.74 m long, 1.40 m wide, 1.48 m tall', [], (L, _p, Lu) => [
    ...carBody(L, Lu, WHITE_PAINT, { len: 2.74, w: 1.4, h: 1.32, r: 0.296, tw: 0.18, ride: 0.18, cab: [-1.0, 0.9], belt: 0.45, wb: 1.8, mirror: 0.06 }),
    ...lightBar(L, 1.32, 0, 0.8),
  ], ['cart', 'meter', 'parking']),
}

// ---------------- building kit ----------------

/** A shop front module on a wall face at z, centered at x: pilasters, glass, door, sign band and awning. Depth sticks out toward +Z. */
function shopFront(L: Lf, x: number, z: number, w: number, depth: number, sign: Tex | null, awning: Tex | null, shutter: boolean, h = 4.04, signH = 0.9): Part[] {
  const glassW = w - 0.9, door = 1.65
  return [
    ...[-1, 1].map((s) => B('Pilaster', [0.45, h, depth], L(x + s * (w / 2 - 0.225), 0, z + depth / 2), TRIM_STONE)),
    B('Kick plate', [glassW, 0.5, depth - 0.1], L(x, 0, z + depth / 2 - 0.05), TRIM_STONE),
    fit(B(shutter ? 'Shutter' : 'Shop window', [glassW, h - 0.85, depth - 0.15], L(x, 0.5, z + depth / 2 - 0.075), TRIM_STONE, shutter ? SHUTTER : STOREFRONT)),
    ...(shutter ? [] : [fit(B('Shop door', [door, 2.5, 0.04], L(x + glassW / 2 - door / 2 - 0.4, 0, z + depth - 0.12), ENTRY_GLASS))]),
    B('Transom', [w, 0.35, depth], L(x, h - 0.35, z + depth / 2), TRIM_STONE),
    ...(sign && signH >= 0.3 ? [fit(B('Shop sign', [w - 0.4, signH, 0.2], L(x, h + 0.08, z + 0.1 + (depth > 1 ? depth - 0.3 : 0)), BLACK, sign))] : []),
    ...(awning ? [R('Awning', [w - 0.5, 0.55, 1.4], L(x, h - 0.6, z + depth + 0.7), awning, awning, 0)] : []),
  ]
}

/** A fire escape on a wall at z 0 (its own frame, out toward +Z): landings every storey, stair flights and a ladder from the ground. */
function fireEscape(L: Lf, floors: number, P: number, w = 3.52, d = 1.35): Part[] {
  const out: Part[] = []
  for (let k = 1; k < floors; k++) {
    const y = k * P
    out.push(
      B('Landing', [w, 0.06, d], L(0, y, d / 2), PB.diamond, ESCAPE),
      B('Rail', [w, 0.04, 0.04], L(0, y + 1.11, d - 0.02), ESCAPE), B('Rail', [w, 0.04, 0.04], L(0, y + 0.55, d - 0.02), ESCAPE),
      ...[-1, 1].flatMap((s) => [B('Rail post', [0.04, 1.15, 0.04], L(s * (w / 2 - 0.02), y, d - 0.02), ESCAPE), B('Side rail', [0.04, 0.04, d], L(s * (w / 2 - 0.02), y + 1.11, d / 2), ESCAPE)]),
      B('Bracket', [0.08, 0.5, d], L(0, y - 0.5, d / 2), ESCAPE),
    )
    if (k < floors - 1) out.push(St('Escape stairs', [0.55, P, w - 0.6], L(0, y, d - 0.3), ESCAPE, ESCAPE, k % 2 ? 90 : 270, 14))
  }
  // A ladder from the ground to the first landing.
  const lx = -w / 2 + 0.35
  out.push(...[-0.2, 0.2].map((a) => B('Ladder rail', [0.04, P, 0.04], L(lx + a, 0, d - 0.12), ESCAPE)))
  for (let i = 1; i < Math.floor(P / 0.4); i++) out.push(B('Ladder rung', [0.4, 0.03, 0.03], L(lx, i * 0.4, d - 0.12), ESCAPE))
  return out
}

/** Rooftop clutter: AC units, a vent and a water tank on legs, kept inside w × d. */
function roofKit(L: Lf, w: number, d: number, y: number, tank: boolean): Part[] {
  if (w < 8 || d < 8) return []
  const cx = w / 2 - 2.2, cz = d / 2 - 2.2
  const out: Part[] = [
    bv(B('AC unit', [1.6, 1.1, 2.0], L(-cx, y, -cz), STEEL), 0.05), B('AC fan', [1.0, 0.04, 1.0], L(-cx, y + 1.1, -cz), BLACK),
    C('Vent', 0.6, 0.9, L(cx, y, -cz), STEEL, STEEL, 10), tp(C('Vent cap', 0.8, 0.2, L(cx, y + 0.9, -cz), STEEL, STEEL, 10), 0.3),
  ]
  if (tank) out.push(
    ...[-0.8, 0.8].flatMap((a) => [-0.8, 0.8].map((b) => B('Tank leg', [0.15, 2.0, 0.15], L(cx - 1.0 + a, y, cz - 1.0 + b), ESCAPE))),
    C('Water tank', 2.4, 2.6, L(cx - 1.0, y + 2.0, cz - 1.0), TANK_WOOD, TANK_WOOD, 14),
    tp(C('Tank roof', 2.6, 0.9, L(cx - 1.0, y + 4.6, cz - 1.0), TANK_WOOD, TANK_WOOD, 14), 0),
  )
  else out.push(B('Stair hut', [2.6, 2.6, 2.6], L(-cx + 0.4, y, cz - 0.4), CEMENT))
  return out
}

/** Ledges at every storey line, a cornice and a parapet round the roof. */
function hullTrim(L: Lf, w: number, d: number, floors: number, P: number, trim: Tex = TRIM_STONE): Part[] {
  const H = floors * P
  return [
    ...[...Array(Math.max(0, floors - 1))].map((_, i) => B('Ledge', [w + 0.24, 0.22, d + 0.24], L(0, (i + 1) * P - 0.12, 0), trim)),
    B('Cornice', [w + 0.5, 0.4, d + 0.5], L(0, H - 0.6, 0), trim),
    ...[[0, d / 2 - 0.15, w, 0.3], [0, -d / 2 + 0.15, w, 0.3]].map(([x, z, a, b]) => B('Parapet', [a, 0.7, b], L(x, H, z), trim)),
    ...[-1, 1].map((s) => B('Parapet', [0.3, 0.7, d - 0.6], L(s * (w / 2 - 0.15), H, 0), trim)),
  ]
}

interface BlockOptions { w: number; d: number; floors: number; pitch: number; style: string; across: number; ground: string; escape: string; sign: string; awning: Tex | null; roof: boolean }
/** A city block building: a solid shell (windows painted on, a row per storey), ground floor shops or doors, ledges, cornice, parapet, fire escape and roof clutter. */
function blockParts(L: Lf, o: BlockOptions): Part[] {
  const H = o.floors * o.pitch, hd = o.d / 2
  const st = STYLE[o.style] ?? STYLE.brick
  const parts: Part[] = [B('Building', [o.w, H, o.d], L(0, 0, 0), ROOF, facade(o.style, o.across), 0, o.pitch)]
  if (o.ground === 'shops') {
    const n = Math.max(1, Math.floor((o.w - 0.6) / 12.25)), mw = Math.min(11.65, (o.w - 0.6 * (n + 1)) / n)
    for (let i = 0; i < n; i++) {
      const x = -o.w / 2 + 0.6 + mw / 2 + i * (mw + (o.w - 0.6 - n * mw) / n)
      parts.push(...shopFront(L, x, hd, mw, 0.4, shopSign(o.sign, i), o.awning, false, Math.min(4.04, o.pitch - 0.4), Math.min(0.9, o.pitch - 4.04 - 0.3)))
    }
  } else if (o.ground === 'doors') {
    const n = Math.max(1, Math.floor(o.w / 12))
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * (o.w / n)
      parts.push(
        B('Door frame', [2.1, 2.85, 0.3], L(x, 0.45, hd + 0.15), TRIM_STONE), fit(B('Door', [1.65, 2.5, 0.04], L(x, 0.45, hd + 0.31), DOOR_WOOD)),
        St('Stoop', [2.4, 0.45, 1.2], L(x, 0, hd + 0.9), TRIM_STONE, TRIM_STONE, 0, 3),
        B('Door canopy', [2.4, 0.12, 0.9], L(x, 3.35, hd + 0.45), BLACK),
      )
    }
  }
  parts.push(...hullTrim(L, o.w, o.d, o.floors, o.pitch, st.bricks ? TRIM_STONE : CEMENT))
  if (o.escape !== 'none' && o.floors >= 2) {
    parts.push(...(o.escape === 'front'
      ? sub(L, o.w / 2 - 3.0, hd + 0.12, 0, (M) => fireEscape(M, o.floors, o.pitch))
      : sub(L, o.w / 2 + 0.12, Math.min(0, -hd + 3), 90, (M) => fireEscape(M, o.floors, o.pitch))))
  }
  if (o.roof) parts.push(...roofKit(L, o.w, o.d, H, st.bricks))
  return parts
}
const blockParams = (w: number, d: number, floors: number, style: string, ground: string, escape: string, pitch = 5.2): ParamDef[] => [
  num('w', 'Width (m)', 8, 80, w, 0.1), num('d', 'Depth (m)', 8, 60, d, 0.1), num('floors', 'Storeys', 1, 12, floors),
  pitchParam(pitch), styleParam(style), sel('across', 'Windows per bay', [['1', 'One (wide)'], ['2', 'Two']], '1'),
  sel('ground', 'Ground floor', [['shops', 'Shop fronts'], ['doors', 'Doors'], ['blank', 'Plain']], ground),
  sel('escape', 'Fire escape', [['side', 'On the side'], ['front', 'On the front'], ['none', 'None']], escape),
  signParam('red'), awningParam('red'), yesNo('roof', 'Roof clutter', 'yes'),
]
const blockFrom = (L: Lf, p: Params) => blockParts(L, { w: +p.w, d: +p.d, floors: +p.floors, pitch: +p.pitch, style: String(p.style), across: +p.across, ground: String(p.ground), escape: String(p.escape), sign: String(p.sign), awning: awningOf(p), roof: p.roof === 'yes' })

const BUILDINGS: Record<string, Def> = {
  srblock: sr('City block building', 'A parametric downtown building: 5.2 m storeys, 11.65 m shop fronts 4.04 m high, 2.5 m doors, ledges, cornice, fire escape and roof clutter', blockParams(25, 16.6, 4, 'brick', 'shops', 'side'), (L, p) => blockFrom(L, p), ['building', 'shops', 'block', 'downtown']),
  srtenement: sr('Tenement', 'A narrow brick walk-up, 13.9 × 9.5 m, four storeys with a fire escape on the front and doors at street level', blockParams(13.9, 9.5, 4, 'darkbrick', 'doors', 'front', 4.8), (L, p) => blockFrom(L, p), ['building', 'apartments', 'walk-up']),
  srhull: sr('Building shell', 'A plain city building shell at the median size, 20.7 × 16.6 m and four 5.2 m storeys, with double front doors', [
    num('w', 'Width (m)', 8, 80, 20.7, 0.1), num('d', 'Depth (m)', 8, 60, 16.6, 0.1), num('floors', 'Storeys', 1, 12, 4), pitchParam(5.2), styleParam('tan'),
    sel('across', 'Windows per bay', [['1', 'One (wide)'], ['2', 'Two']], '2'), yesNo('roof', 'Roof clutter', 'yes'),
  ], (L, p) => {
    const w = +p.w, d = +p.d, floors = +p.floors, P = +p.pitch, hd = d / 2
    return [
      B('Building', [w, floors * P, d], L(0, 0, 0), ROOF, facade(String(p.style), +p.across), 0, P),
      B('Entrance', [4.0, 3.1, 0.35], L(0, 0, hd + 0.17), TRIM_STONE), fit(B('Front doors', [3.07, 2.3, 0.04], L(0, 0.3, hd + 0.36), ENTRY_GLASS)),
      St('Entrance steps', [4.0, 0.3, 0.9], L(0, 0, hd + 0.8), TRIM_STONE, TRIM_STONE, 0, 2),
      B('Entrance canopy', [4.6, 0.18, 1.6], L(0, 3.1, hd + 0.8), DARK_METAL),
      ...hullTrim(L, w, d, floors, P, STYLE[String(p.style)]?.bricks ? TRIM_STONE : CEMENT),
      ...(p.roof === 'yes' ? roofKit(L, w, d, floors * P, false) : []),
    ]
  }, ['building', 'hull', 'shell']),
  srtower: sr('Downtown tower', 'A glass office tower on a two-storey lobby podium, 4.0 m office storeys', [
    num('w', 'Width (m)', 12, 60, 26, 0.5), num('d', 'Depth (m)', 12, 60, 26, 0.5), num('floors', 'Storeys', 6, 60, 20), styleParam('glass'),
  ], (L, p) => {
    const w = +p.w, d = +p.d, floors = +p.floors, P = 4.0, pod = 2 * 5.2, H = pod + (floors - 2) * P
    return [
      B('Lobby podium', [w + 4, pod, d + 4], L(0, 0, 0), ROOF, STOREFRONT, 0, 5.2),
      fit(B('Lobby doors', [6.14, 2.3, 0.04], L(0, 0, d / 2 + 2.01), ENTRY_GLASS)),
      B('Podium cornice', [w + 4.4, 0.5, d + 4.4], L(0, pod - 0.5, 0), CEMENT),
      B('Tower', [w, H - pod, d], L(0, pod, 0), ROOF, facade(String(p.style), 2), 0, P),
      ...[...Array(Math.floor((floors - 2) / 5))].map((_, i) => B('Band', [w + 0.2, 0.3, d + 0.2], L(0, pod + (i + 1) * 5 * P - 0.15, 0), CEMENT)),
      B('Mechanical floor', [w * 0.6, 3.5, d * 0.6], L(0, H, 0), CEMENT),
      C('Antenna', 0.4, 12, L(0, H + 3.5, 0), STEEL, STEEL, 6),
    ]
  }, ['tower', 'office', 'skyscraper', 'downtown']),
  srindustrial: sr('Industrial shed', 'A corrugated warehouse shell with 5.02 m roll-up doors and a man door (default 50 × 30 m, 12 m tall)', [
    num('w', 'Width (m)', 15, 120, 50, 1), num('d', 'Depth (m)', 10, 80, 30, 1), num('h', 'Height (m)', 6, 24, 12, 0.5), num('doors', 'Roll-up doors', 0, 8, 3),
  ], (L, p) => {
    const w = +p.w, d = +p.d, h = +p.h, n = Math.min(+p.doors, Math.floor((w - 4) / 7)), hd = d / 2
    return [
      B('Shed', [w, h, d], L(0, 0, 0), ROOF, CORRUGATED, 0, 2.6),
      B('Plinth', [w + 0.2, 0.8, d + 0.2], L(0, 0, 0), PB.cinder),
      B('Roof edge', [w + 0.6, 0.35, d + 0.6], L(0, h - 0.2, 0), DARK_METAL),
      ...row(L, n, Math.min(8, (w - 4) / Math.max(1, n)), (M) => [fit(B('Roll-up door', [5.02, 4.6, 0.08], M(0, 0, 0.04), SHUTTER)), B('Door frame', [5.4, 0.3, 0.2], M(0, 4.6, 0.1), DARK_METAL),
        ...[-1, 1].map((s) => bv(B('Dock bumper', [0.25, 0.4, 0.2], M(s * 1.8, 0.9, 0.12), BLACK), 0.04))], hd),
      fit(B('Man door', [1.34, 2.4, 0.06], L(w / 2 - 2.5, 0, hd + 0.03), DOOR_METAL)),
      ...row(L, Math.max(1, Math.floor(w / 12)), 12, (M) => [B('Roof vent', [1.2, 0.8, 1.2], M(0, h, 0), STEEL)]),
    ]
  }, ['warehouse', 'industrial', 'factory', 'shed']),
  srstorefront: sr('Shop front', 'A 11.65 m shop front panel, 4.04 m high and 2.04 m deep, with a sign band and awning, to set against a wall', [
    num('w', 'Width (m)', 4, 16, 11.65, 0.05), signParam('blue'), awningParam('stripes'), yesNo('shutter', 'Shutter down', 'no'), yesNo('posters', 'Posters', 'no'),
  ], (L, p) => [
    B('Wall behind', [+p.w, 5.2, 0.2], L(0, 0, -1.02), CEMENT),
    ...shopFront(L, 0, -1.02 + 0.1, +p.w, 1.94, shopSign(String(p.sign), 6), awningOf(p), p.shutter === 'yes'),
    ...(p.posters === 'yes' ? [-1, 1].map((s, i) => fit(B('Poster', [0.01, 1.2, 0.85], L(s * (+p.w / 2 + 0.005), 1.2, 0.3), POSTERS[i + 2]))) : []),
  ], ['shop', 'storefront', 'store']),
  srdoor: sr('Door set', 'A door in a frame with a step, against a wall: single 1.65 × 2.50 m, double 3.07 × 2.30 m, steel or a 5.02 m garage door', [sel('kind', 'Door', [['single', 'Single (wood)'], ['double', 'Double (glass)'], ['metal', 'Steel'], ['garage', 'Garage']], 'single')], (L, p) => {
    const [w, h, t] = p.kind === 'double' ? [3.07, 2.3, ENTRY_GLASS] : p.kind === 'metal' ? [1.34, 2.4, DOOR_METAL] : p.kind === 'garage' ? [5.02, 3.2, SHUTTER] : [1.65, 2.5, DOOR_WOOD]
    return [
      B('Wall behind', [(w as number) + 1.2, (h as number) + 1.2, 0.2], L(0, 0, -0.1), CEMENT),
      B('Door frame', [(w as number) + 0.3, (h as number) + 0.15, 0.12], L(0, 0, 0.06), TRIM_STONE),
      fit(B('Door', [w as number, h as number, 0.05], L(0, p.kind === 'garage' ? 0 : 0.15, 0.13), t as Tex)),
      ...(p.kind === 'garage' ? [] : [B('Door step', [(w as number) + 0.4, 0.15, 0.5], L(0, 0, 0.37), TRIM_STONE)]),
    ]
  }, ['door', 'entrance', 'garage']),
  srfireescape: sr('Fire escape', 'A black iron fire escape for a wall: 3.52 m landings every storey with stairs and a ladder from the street', [num('floors', 'Storeys', 2, 12, 4), pitchParam(5.2)], (L, p) => [
    B('Wall strip', [3.6, +p.floors * +p.pitch, 0.1], L(0, 0, -0.05), PB.brick),
    ...fireEscape(L, +p.floors, +p.pitch),
  ], ['fire escape', 'ladder', 'balcony']),
  srrooftop: sr('Rooftop kit', 'Roof clutter to set on a flat roof: AC unit, a vent and a water tank or stair hut', [yesNo('tank', 'Water tank', 'yes')], (L, p) => roofKit(L, 10, 10, 0, p.tank === 'yes'), ['roof', 'ac', 'water tank']),
}

export const SR1_STYLE_PREFABS: Record<string, Def> = { ...FURNITURE, ...TRAFFIC, ...FENCES, ...JUNK, ...SHOP, ...VEHICLES, ...BUILDINGS }
