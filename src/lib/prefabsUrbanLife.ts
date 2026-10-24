// Life for the city maps. Multiplayer has no pedestrians or traffic, so the
// streets have to look lived in on their own: parked cars of every kind,
// signals and signs at the junctions, kerbside clutter, what hangs on walls
// and sits on roofs, and the working pieces of markets, docks, rail yards,
// churches, schools and back yards. Each is one object placed with its base
// at y, its front toward local +Z (the way a bench or machine faces), turned
// by rot. Flat pieces (manholes, drains, puddles, litter) are paint-thin, so
// players and cars cross them.
import { PB, blob, box, cyl, sack, lying, organic, ramp, turn, type Part, type Tex } from './sampleKit'
import { car, carPaint, group, local, wheels, type ParamDef, type Params, type PrefabDef } from './prefabs'

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
/** A piece (in its own frame) at (x, z) turned by r inside another piece's frame. */
const at = (L: Lf, x: number, z: number, r: number, make: (L: Lf) => Part[], y = 0): Part[] => {
  const L2: Lf = (dx, dy, dz) => { const [ox, oz] = turn(dx, dz, r); return L(x + ox, y + dy, z + oz) }
  return make(L2).map((p) => ({ ...p, rot: ((p.rot ?? 0) + r) % 360 }))
}
const num = (key: string, label: string, min: number, max: number, def: number, step = 1): ParamDef => ({ key, label, kind: 'number', min, max, step, default: def })
const sel = (key: string, label: string, options: [string, string][], def: string): ParamDef => ({ key, label, kind: 'select', options, default: def })

// ---------------- materials ----------------

const solid = (color: string, accent: string, seed: number, surface = 17): Tex => ({ gen: 'paint', tweak: { color, accent, scale: 2, wear: 0.06, seed }, surface })
const WHITE = solid('#e8e6e0', '#cfccc4', 460)
const BLACK = solid('#1d1d20', '#141416', 461, 15)
const GREY = solid('#7d8288', '#5d6268', 462, 15)
const ORANGE = solid('#f07a1a', '#b8560c', 463)
const SIGN_GREEN = solid('#1f6b3a', '#e8e6e0', 464, 15)
const SIGN_BLUE = solid('#1f4f9a', '#e8e6e0', 465, 15)
const SIGN_RED = solid('#c4161c', '#e8e6e0', 466, 15)
const BRASS = { gen: 'metal_plate', tweak: { color: '#b8923a', accent: '#8a6a22', scale: 1, wear: 0.05, seed: 467 }, surface: 15 } as Tex
const GLASS: Tex = { gen: 'paint', tweak: { color: '#25313b', accent: '#1a2229', scale: 2, wear: 0, seed: 330 }, surface: 9 }
const HEADLIGHT: Tex = { gen: 'paint', tweak: { color: '#f4f1e2', accent: '#c9c4ad', scale: 2, wear: 0, seed: 333 }, surface: 9 }
const TAILLIGHT: Tex = { gen: 'paint', tweak: { color: '#c4161c', accent: '#7a0c10', scale: 2, wear: 0, seed: 334 }, surface: 9 }
const LAMP_RED: Tex = { gen: 'paint', tweak: { color: '#e02020', accent: '#801010', scale: 2, wear: 0, seed: 468 }, surface: 17 }
const LAMP_AMBER: Tex = { gen: 'paint', tweak: { color: '#f0a020', accent: '#905a10', scale: 2, wear: 0, seed: 469 }, surface: 17 }
const LAMP_GREEN: Tex = { gen: 'paint', tweak: { color: '#20d060', accent: '#107030', scale: 2, wear: 0, seed: 470 }, surface: 17 }
const LAMP_BLUE: Tex = { gen: 'paint', tweak: { color: '#2050f0', accent: '#102a80', scale: 2, wear: 0, seed: 471 }, surface: 17 }
const IRON: Tex = { gen: 'diamond_plate', tweak: { color: '#45474b', accent: '#26282b', scale: 10, wear: 0.4, seed: 472 }, surface: 15 }
const GRATE: Tex = { gen: 'tiles', tweak: { color: '#1e2022', accent: '#3d4044', scale: 10, wear: 0.3, seed: 473 }, surface: 15 }
const PUDDLE: Tex = { gen: 'water', tweak: { color: '#3c444c', accent: '#7d8a96', scale: 2, wear: 0, seed: 474 }, surface: 0 }
const PAPER = solid('#e9e4d6', '#c9c2ae', 475, 5)
const NEWSPRINT: Tex = { gen: 'tiles', tweak: { color: '#d8d4ca', accent: '#5a5852', scale: 6, wear: 0.2, seed: 476 }, surface: 5 }
const BAG: Tex = { gen: 'concrete', tweak: { color: '#1e1f22', accent: '#3a3c40', wear: 0.5, seed: 477 }, surface: 17 }
const TERRACOTTA: Tex = { gen: 'concrete', tweak: { color: '#a45a3a', accent: '#6a3a22', wear: 0.3, seed: 478 } }
const FLOWERS: Tex = { gen: 'grass', tweak: { color: '#3d6e28', accent: '#e24a7a', scale: 10, wear: 0.85, seed: 479 }, surface: 7 }
const ROPE: Tex = { gen: 'wood_planks', tweak: { color: '#b8a47a', accent: '#8a7550', scale: 12, wear: 0.2, seed: 480 }, surface: 21 }
const SLEEPER: Tex = { gen: 'wood_planks', tweak: { color: '#4a3a2c', accent: '#2a2018', scale: 2, wear: 0.5, seed: 481 }, surface: 21 }
const NET: Tex = { gen: 'tiles', tweak: { color: '#2e3b2e', accent: '#a0a07a', scale: 18, wear: 0.3, seed: 482 }, surface: 14 }
const MESH: Tex = { gen: 'tiles', tweak: { color: '#3a3d40', accent: '#8d9094', scale: 16, wear: 0.2, seed: 430 }, surface: 14 }
const WAX = solid('#f2ead2', '#d8ccaa', 483, 5)
const FLAME: Tex = { gen: 'paint', tweak: { color: '#ffc25a', accent: '#ff8a1a', scale: 2, wear: 0, seed: 484 }, surface: 17 }
const LANTERN_RED: Tex = { gen: 'paint', tweak: { color: '#e0302a', accent: '#ffb070', scale: 3, wear: 0, seed: 543 }, surface: 17 }
const LANTERN_GOLD: Tex = { gen: 'paint', tweak: { color: '#f2b83a', accent: '#fff0b0', scale: 3, wear: 0, seed: 544 }, surface: 17 }
const LANTERN_WHITE: Tex = { gen: 'paint', tweak: { color: '#f4ecd8', accent: '#ffffff', scale: 3, wear: 0, seed: 545 }, surface: 17 }
const DARK_WOOD: Tex = { gen: 'wood_planks', tweak: { color: '#4a3324', accent: '#2e1f15', scale: 3, wear: 0.15, seed: 400 }, surface: 21 }
const CRATE: Tex = { lib: 'weathered_brown_planks', surface: 21 }
const BOARD = solid('#22382a', '#1a2c20', 485, 5)
const CHALK: Tex = { gen: 'paint', tweak: { color: '#2c3a30', accent: '#d8d8c8', scale: 5, wear: 0.4, seed: 486 }, surface: 5 }
/** Striped canvas for café umbrellas and market awnings. */
const stripes = (color: string, seed: number): Tex => ({ gen: 'hazard', tweak: { color, accent: '#f2efe6', scale: 6, wear: 0.05, seed }, surface: 17 })
const STRIPES: Record<string, Tex> = { red: stripes('#c8322b', 487), green: stripes('#2f7a3a', 488), blue: stripes('#2a5fc0', 489), yellow: stripes('#e8b81c', 490) }
const stripeParam = (def: string) => sel('color', 'Canvas', [['red', 'Red'], ['green', 'Green'], ['blue', 'Blue'], ['yellow', 'Yellow']], def)
/** Bumpy rows of fruit and vegetables, seen from above. */
const produce = (color: string, accent: string, seed: number): Tex => ({ gen: 'tiles', tweak: { color, accent, scale: 12, wear: 0.35, seed }, surface: 17 })
const PRODUCE = [produce('#c8302a', '#7a1612', 491), produce('#f08a1a', '#a05a10', 492), produce('#6aa02a', '#3a6a14', 493), produce('#f2d23a', '#a08a1a', 494), produce('#6a2a6a', '#3a143a', 495), produce('#8ab83a', '#5a7a1a', 496)]
const CLOTHES = [solid('#c8322b', '#a02020', 497, 5), solid('#2a5fc0', '#1f4a9a', 498, 5), WHITE, solid('#e8c84a', '#c8a830', 499, 5), solid('#3a8a5a', '#2a6a42', 500, 5), solid('#d878a8', '#b85a88', 501, 5)]
/** Printed posters and ads (bold blocks of color with a white margin). */
const posterTex = (color: string, accent: string, seed: number): Tex => ({ gen: 'poster', tweak: { color, accent, scale: 3, wear: 0.25, seed }, surface: 5 })
export const POSTERS: Tex[] = [posterTex('#c8322b', '#f2c218', 502), posterTex('#2a5fc0', '#f2efe6', 503), posterTex('#1d1d20', '#ff3dd8', 504), posterTex('#2f8a3a', '#f2efe6', 505), posterTex('#f2c218', '#1d1d20', 506), posterTex('#7a2a7a', '#18d8ff', 507)]
/** Spray-painted tags, see-through round the letters. */
const tagTex = (color: string, accent: string, seed: number): Tex => ({ gen: 'graffiti', tweak: { color, accent, scale: 5, wear: 0.4, seed }, surface: 0, alpha: true })
export const TAGS: Tex[] = [tagTex('#ff3dd8', '#1d1d20', 508), tagTex('#18d8ff', '#14191f', 509), tagTex('#f2c218', '#7a1612', 510), tagTex('#6ad02a', '#1d1d20', 511), tagTex('#f07a1a', '#2a1a4a', 512), tagTex('#e8e6e0', '#c8322b', 513)]
/** Shop signs: a lettered band. */
const signTex = (color: string, accent: string, seed: number): Tex => ({ gen: 'sign', tweak: { color, accent, scale: 6, wear: 0.15, seed }, surface: 15 })
export const SIGNS: Tex[] = [signTex('#c8322b', '#f2efe6', 514), signTex('#1d1d20', '#f2c218', 515), signTex('#2f6b8f', '#f2efe6', 516), signTex('#f2efe6', '#2a5fc0', 517), signTex('#2f7a3a', '#f2efe6', 518), signTex('#1b1622', '#ff3dd8', 519)]
const pick = <T,>(list: T[], key: string | number): T => list[Math.abs(typeof key === 'number' ? Math.round(key) : [...key].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % list.length]

// ---------------- vehicles ----------------

const PAINTS: [string, string][] = [['#b8322a', 'Red'], ['#2a5ab8', 'Blue'], ['#d0d0d0', 'Silver'], ['#202020', 'Black'], ['#e8e8e8', 'White'], ['#2f5a3a', 'Green'], ['#6a5a4a', 'Brown'], ['#8a2a2a', 'Maroon']]
const paintParam = (def: string) => sel('color', 'Paint', PAINTS, def)
const paint = (p: Params, seed: number) => carPaint(String(p.color), seed + PAINTS.findIndex(([c]) => c === p.color))
/** Lights and bumpers at both ends of a body `len` long, `w` wide, lights at height y. */
const ends = (L: Lf, w: number, len: number, y: number): Part[] => [
  ...[-1, 1].flatMap((s) => [box('Headlight', [0.8, 0.4, 0.06], L(s * (w / 2 - 0.55), y, len / 2 + 0.02), HEADLIGHT), box('Tail light', [0.6, 0.5, 0.06], L(s * (w / 2 - 0.45), y + 0.1, -len / 2 - 0.02), TAILLIGHT)]),
  ...[-1, 1].map((s) => ({ ...box('Bumper', [w + 0.1, 0.45, 0.35], L(0, y - 0.6, s * (len / 2 - 0.05)), BLACK, BLACK), bevel: 0.12 })),
]

/** A sedan with extra parts on it (a taxi sign, a light bar), as one object. */
const sedanWith = (name: string, body: Tex, extra: (L: Lf) => Part[], len = 8.4) => (x: number, z: number, rot: number, y: number) =>
  group(id(name, x, y, z), [...car(x, z, rot, body, y, len), ...local(x, y, z, rot, extra)])

const VEHICLES: Record<string, PrefabDef & { category: string }> = {
  citytaxi: { category: 'Vehicles', label: 'Taxi', hint: 'A yellow cab with its roof sign', make: sedanWith('Taxi', carPaint('#f2c218', 520), (L) => [
    { ...box('Taxi sign', [1.6, 0.55, 0.6], L(0, 3.18, -0.4), WHITE, solid('#f2c218', '#1d1d20', 521)), bevel: 0.1 },
    box('Checker stripe', [4.06, 0.3, 3.6], L(0, 1.45, -0.2), { gen: 'hazard', tweak: { color: '#1d1d20', accent: '#f2c218', scale: 10, wear: 0, seed: 522 }, surface: 15 }),
  ]) },
  cruiser: { category: 'Vehicles', label: 'Police car', hint: 'A black-and-white cruiser with a light bar', make: sedanWith('Police car', carPaint('#1d1d20', 523), (L) => [
    { ...box('Door panel', [4.08, 1.0, 3.4], L(0, 0.75, -0.2), carPaint('#e8e8e8', 524)), bevel: 0.2 },
    box('Light bar', [2.6, 0.2, 0.6], L(0, 3.18, -0.2), BLACK), box('Red lamp', [1.2, 0.3, 0.55], L(-0.65, 3.38, -0.2), LAMP_RED), box('Blue lamp', [1.2, 0.3, 0.55], L(0.65, 3.38, -0.2), LAMP_BLUE),
    box('Push bar', [2.6, 1.0, 0.25], L(0, 0.5, 4.45), BLACK),
  ]) },
  citypickup: { category: 'Vehicles', label: 'Pickup truck', hint: 'A pickup with an open bed', ...pfp('Pickup', [paintParam('#2a5ab8')], (L, p) => {
    const c = paint(p, 525)
    return [
      { ...box('Truck body', [4.2, 1.5, 9.4], L(0, 0.7, 0), c), bevel: 0.35 },
      { ...box('Cab', [3.9, 1.4, 3.2], L(0, 2.2, 1.0), GLASS), bevel: 0.3 }, { ...box('Cab roof', [3.7, 0.2, 2.8], L(0, 3.6, 1.0), c), bevel: 0.08 },
      ...[-1, 1].map((s) => box('Bed side', [0.25, 0.9, 4.2], L(s * 1.95, 2.2, -2.5), c)), box('Tailgate', [4.1, 0.9, 0.25], L(0, 2.2, -4.6), c),
      box('Bed liner', [3.6, 0.06, 4.2], L(0, 2.21, -2.5), BLACK),
      ...ends(L, 4.2, 9.4, 1.4), ...wheels(L, 3.8, [3.0, -3.0], 1.6, 0.6),
    ]
  }) },
  cityvan: { category: 'Vehicles', label: 'Van', hint: 'A tall panel van', ...pfp('Van', [paintParam('#e8e8e8')], (L, p) => {
    const c = paint(p, 527)
    return [
      { ...box('Van body', [4.4, 3.8, 9.6], L(0, 0.6, -0.2), c), bevel: 0.5 },
      box('Windshield', [3.8, 1.3, 0.1], L(0, 2.8, 4.62), GLASS), ...[-1, 1].map((s) => box('Cab window', [0.08, 1.2, 1.6], L(s * 2.2, 2.9, 3.4), GLASS)),
      box('Side door', [0.06, 2.8, 3], L(2.21, 0.9, 0.6), solid('#9aa0a6', '#7d8288', 528, 15)),
      ...ends(L, 4.4, 9.6, 1.3), ...wheels(L, 4.0, [3.1, -3.3], 1.5, 0.6),
    ]
  }) },
  cityschoolbus: { category: 'Vehicles', label: 'School bus', hint: 'A yellow school bus with its stop arm', make: pf('School bus', (L) => {
    const yellow = carPaint('#f2b818', 529)
    return [
      { ...box('Bus body', [5.2, 5.2, 21], L(0, 0.9, -1.5), WHITE, yellow), bevel: 0.45 },
      { ...box('Bus hood', [4.6, 2.4, 3.4], L(0, 0.9, 10.7), yellow), bevel: 0.5 }, box('Grille', [2.4, 1.4, 0.08], L(0, 1.4, 12.42), BLACK),
      box('Bus windows', [5.26, 1.6, 17], L(0, 3.4, -2), GLASS), box('Windshield', [4.6, 2.2, 0.1], L(0, 3.2, 9.0), GLASS),
      ...[2.5, 5.2].map((y) => box('Black stripe', [5.24, 0.2, 21], L(0, y, -1.5), BLACK)),
      box('Stop arm', [0.12, 1.1, 1.1], L(-2.75, 3.6, 7.6), SIGN_RED), box('Bus door', [0.1, 3.8, 2], L(2.62, 1.0, 7.8), GLASS),
      ...ends(L, 5.2, 24.6, 1.8).map((q) => ({ ...q, at: [q.at[0], q.at[1], q.at[2] + 0.4] as [number, number, number] })),
      ...wheels(L, 5.0, [8.6, -7.5], 1.9, 0.7),
    ]
  }) },
}

// ---------------- signals and signs ----------------

/** A signal head: three lamps facing +X, a backplate behind. */
const head = (L: Lf, z: number, y: number): Part[] => [
  { ...box('Signal head', [0.7, 2.4, 0.9], L(0, y, z), BLACK), bevel: 0.1 }, box('Backplate', [0.08, 2.9, 1.4], L(-0.4, y - 0.25, z), BLACK),
  box('Red', [0.1, 0.55, 0.55], L(0.38, y + 1.7, z), LAMP_RED), box('Amber', [0.1, 0.55, 0.55], L(0.38, y + 1.0, z), LAMP_AMBER), box('Green', [0.1, 0.55, 0.55], L(0.38, y + 0.3, z), LAMP_GREEN),
]

const SIGNS_STREET: Record<string, PrefabDef & { category: string }> = {
  // Like a real mast arm: the arm reaches over the lanes (+Z), the lights look along the road (+X) at the drivers they stop.
  signal: { category: 'Street', label: 'Traffic signal', hint: 'A mast arm over the road with two signal heads (lights face +X), a street sign and a walk signal', ...pfp('Signal', [num('len', 'Arm length', 4, 16, 9, 0.5)], (L, p) => {
    const len = +p.len
    return [
      { ...cyl('Signal pole', 0.55, 8.2, L(0, 0, 0), BLACK, BLACK, 10), taper: 0.8 }, box('Pole base', [1, 0.5, 1], L(0, 0, 0), GREY),
      box('Mast arm', [0.3, 0.3, len], L(0, 7.6, len / 2), BLACK),
      ...head(L, len * 0.5, 5.0), ...head(L, len - 0.6, 5.0),
      box('Street sign', [0.06, 0.7, 3.4], L(0, 8.3, 2.4), SIGN_GREEN),
      box('Walk signal', [0.7, 0.9, 0.7], L(0.6, 3.0, 0), BLACK), box('Walk lamp', [0.06, 0.6, 0.5], L(0.97, 3.15, 0), LAMP_AMBER),
      box('Push button', [0.25, 0.35, 0.25], L(0.35, 1.8, -0.2), PB.yellow),
    ]
  }) },
  streetsign: { category: 'Street', label: 'Street sign', hint: 'A post with crossed street-name blades, or a parking or one-way sign', ...pfp('Street sign', [sel('kind', 'Sign', [['names', 'Street names'], ['noparking', 'No parking'], ['oneway', 'One way'], ['bus', 'Bus stop'], ['parking', 'Parking']], 'names')], (L, p) => {
    const k = String(p.kind)
    const out: Part[] = [cyl('Sign post', 0.2, k === 'names' ? 6.4 : 5.2, L(0, 0, 0), GREY, GREY, 6)]
    if (k === 'names') out.push(box('Name blade', [3.4, 0.6, 0.06], L(0, 5.6, 0), SIGN_GREEN), box('Name blade', [0.06, 0.6, 3.4], L(0, 6.3, 0), SIGN_GREEN))
    else if (k === 'oneway') out.push(box('One way', [2.6, 0.8, 0.06], L(0, 4.2, 0.08), BLACK), box('Arrow', [2.0, 0.3, 0.07], L(0, 4.45, 0.09), WHITE))
    else out.push(box('Sign plate', [1.4, 1.8, 0.06], L(0, 3.4, 0.08), k === 'noparking' ? SIGN_RED : SIGN_BLUE), box('Sign mark', [0.7, 0.7, 0.07], L(0, 3.9, 0.1), WHITE))
    return out
  }) },
  newsbox: { category: 'Street', label: 'Newspaper boxes', hint: 'A row of coin-op newspaper boxes', ...pfp('Newspaper boxes', [num('n', 'Boxes', 1, 4, 3)], (L, p) => [...Array(+p.n)].flatMap((_, i) => {
    const x = (i - (+p.n - 1) / 2) * 1.7, t = [SIGN_BLUE, SIGN_RED, PB.yellow, SIGN_GREEN][i % 4]
    return [
      { ...box('Newspaper box', [1.4, 1.5, 1.2], L(x, 0.6, 0), t), bevel: 0.08 }, box('Box window', [1.0, 0.6, 0.05], L(x, 1.3, 0.62), NEWSPRINT),
      ...[-0.55, 0.55].map((a) => box('Box leg', [0.12, 0.6, 1], L(x + a, 0, 0), GREY)),
    ]
  })) },
  bikerack: { category: 'Street', label: 'Bike rack', hint: 'Steel hoops with a couple of bikes locked up', ...pfp('Bike rack', [num('n', 'Hoops', 2, 6, 4), num('bikes', 'Bikes', 0, 4, 2)], (L, p) => {
    const n = +p.n, out: Part[] = []
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 1.8
      out.push(...[-0.7, 0.7].map((z) => cyl('Hoop leg', 0.12, 1.7, L(x, 0, z), GREY, GREY, 6)), lying('Hoop top', 0.12, 1.5, L(x, 1.62, 0), GREY, GREY, 6, 90))
    }
    for (let i = 0; i < Math.min(+p.bikes, n); i++) {
      const x = (i * 2 - (n - 1) / 2) * 1.8 + 0.35
      out.push(...at(L, x, 0, 90, (M) => [
        ...[-1.1, 1.1].map((a) => lying('Bike wheel', 1.4, 0.08, M(0, 0, a), BLACK, BLACK, 12, 90)),
        box('Bike frame', [0.1, 0.1, 2.0], M(0, 1.0, 0), pick([SIGN_RED, SIGN_BLUE, PB.yellow, SIGN_GREEN], i)), box('Bike seat', [0.2, 0.1, 0.5], M(0, 1.45, -0.6), BLACK),
        box('Handlebar', [0.8, 0.08, 0.08], M(0, 1.5, 0.9), GREY), box('Seat post', [0.08, 0.5, 0.08], M(0, 1.0, -0.6), GREY),
      ]))
    }
    return out
  }) },
  busstopsign: { category: 'Street', label: 'Bus stop sign', hint: 'A bus stop flag on a pole with a timetable', make: pf('Bus stop sign', (L) => [
    cyl('Sign post', 0.22, 6, L(0, 0, 0), GREY, GREY, 6), box('Bus flag', [1.6, 1.4, 0.08], L(0.8, 4.4, 0), SIGN_BLUE), box('Bus mark', [0.9, 0.5, 0.09], L(0.8, 4.9, 0), WHITE),
    box('Timetable', [0.9, 1.3, 0.12], L(0, 2.0, 0.16), WHITE),
  ]) },
  roadbarricade: { category: 'Street', label: 'Road barricade', hint: 'A striped barricade on A-frame legs, with a warning lamp', make: pf('Barricade', (L) => [
    ...[-1.8, 1.8].flatMap((x) => [box('Barricade leg', [0.15, 1.9, 0.15], L(x, 0, -0.45), GREY), box('Barricade leg', [0.15, 1.9, 0.15], L(x, 0, 0.45), GREY), box('Barricade foot', [0.2, 0.15, 1.2], L(x, 0, 0), GREY)]),
    ...[0.9, 1.6].map((y) => box('Barricade board', [4.4, 0.45, 0.12], L(0, y, 0), { gen: 'hazard', tweak: { color: '#f07a1a', accent: '#f2efe6', scale: 6, wear: 0.15, seed: 530 }, surface: 15 })),
    { ...cyl('Warning lamp', 0.45, 0.4, L(1.9, 2.05, 0), LAMP_AMBER, LAMP_AMBER, 8), taper: 0.8 },
  ]) },
  bollardrow: { category: 'Street', label: 'Street bollards', hint: 'A row of steel posts that keep cars off the sidewalk', ...pfp('Street bollards', [num('n', 'Posts', 2, 10, 4), num('gap', 'Spacing', 2, 8, 3)], (L, p) => [...Array(+p.n)].flatMap((_, i) => {
    const x = (i - (+p.n - 1) / 2) * +p.gap
    return [cyl('Bollard', 0.55, 2.2, L(x, 0, 0), BLACK, BLACK, 10), cyl('Bollard band', 0.58, 0.25, L(x, 1.6, 0), PB.yellow, PB.yellow, 10)]
  })) },
}

// ---------------- kerbside and ground clutter ----------------

const GROUND: Record<string, PrefabDef & { category: string }> = {
  manholecover: { category: 'Street', label: 'Manhole cover', hint: 'An iron cover flush with the road', make: pf('Manhole', (L) => [cyl('Manhole', 2.2, 0.04, L(0, 0, 0), IRON, IRON, 14)]) },
  stormdrain: { category: 'Street', label: 'Storm drain', hint: 'A grate in the gutter against the kerb (the kerb at its back, −Z)', make: pf('Storm drain', (L) => [
    box('Drain grate', [3, 0.04, 1.3], L(0, 0, 0), GRATE, GRATE), box('Drain inlet', [3, 0.12, 0.08], L(0, 0.04, -0.66), BLACK),
  ]) },
  puddle: { category: 'Street', label: 'Puddle', hint: 'A shallow rain puddle (not water you can swim in)', ...pfp('Puddle', [num('w', 'Width', 2, 14, 5, 0.5), num('d', 'Depth', 2, 14, 3, 0.5), num('shape', 'Shape', 1, 99, 5)], (L, p) => [
    blob('Puddle', organic(+p.w, +p.d, +p.shape, 18, 0.3), 0.025, L(0, 0, 0), PUDDLE, PUDDLE, 6),
  ]) },
  litter: { category: 'Street', label: 'Litter', hint: 'Paper, a cup and crushed cans in the gutter', make: pf('Litter', (L) => [
    ...[[0, 0, 20], [1.4, 0.8, 70], [-1.2, 0.5, 130], [0.6, -0.9, 160]].map(([x, z, r]) => box('Litter paper', [0.7, 0.02, 0.9], L(x, 0, z), PAPER, PAPER, r)),
    box('Litter news', [1.2, 0.03, 0.9], L(-0.4, 0, -1.2), NEWSPRINT, NEWSPRINT, 35),
    lying('Litter can', 0.28, 0.5, L(1.0, 0, -0.4), SIGN_RED, GREY, 8, 50), lying('Litter can', 0.28, 0.5, L(-1.6, 0, -0.2), SIGN_GREEN, GREY, 8, 110),
    { ...cyl('Litter cup', 0.35, 0.5, L(0.3, 0, 1.4), WHITE, WHITE, 8), taper: 1.3 },
  ]) },
  binbags: { category: 'Street', label: 'Trash bags', hint: 'A heap of black bin bags put out for collection', make: pf('Trash bags', (L) => [
    ...[[-0.9, 0, 0, 1.3, 1.0], [0.6, 0, 0.3, 1.2, 1.1], [-0.1, 0, -0.8, 1.1, 0.9], [1.5, 0, -0.6, 1.0, 0.8], [-0.2, 0.85, -0.1, 1.0, 0.8]].map(([x, y, z, s, h], i) =>
      sack(L(x, y, z), s, h, BAG, i * 40)).flat(),
    ...sack(L(0.3, 0, 1.0), 1.3, 0.8, BAG, 20),
  ]) },
  bins: { category: 'Street', label: 'Wheelie bins', hint: 'A row of trash and recycling bins, handles to the wall (−Z)', ...pfp('Wheelie bins', [num('n', 'Bins', 1, 5, 3)], (L, p) => [...Array(+p.n)].flatMap((_, i) => {
    const x = (i - (+p.n - 1) / 2) * 1.9, t = [solid('#2f6a3a', '#1f4a28', 531, 17), solid('#2a4f9a', '#1a3a7a', 532, 17), BLACK, solid('#8a6a2a', '#6a4a1a', 533, 17)][i % 4]
    return [
      { ...box('Bin', [1.6, 2.2, 1.6], L(x, 0.15, 0.05), t), bevel: 0.1 }, { ...box('Bin lid', [1.7, 0.15, 1.8], L(x, 2.35, 0), t), bevel: 0.05 },
      lying('Bin wheel', 0.5, 1.5, L(x, 0, -0.65), BLACK, BLACK, 8),
    ]
  })) },
  cafe: { category: 'Street', label: 'Café table', hint: 'A round table, two chairs and a striped umbrella', ...pfp('Cafe table', [stripeParam('red')], (L, p) => [
    cyl('Table base', 0.9, 0.1, L(0, 0, 0), GREY, GREY, 10), cyl('Table leg', 0.15, 1.4, L(0, 0.1, 0), GREY, GREY, 6), cyl('Table top', 2.2, 0.1, L(0, 1.5, 0), WHITE, GREY, 14),
    ...[-1, 1].flatMap((s) => at(L, s * 1.9, 0, s > 0 ? 270 : 90, (M) => [
      box('Chair seat', [1.0, 0.12, 1.0], M(0, 0.9, 0), BRASS), box('Chair back', [1.0, 1.0, 0.1], M(0, 1.0, -0.5), BRASS),
      ...[[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]].map(([a, b]) => box('Chair leg', [0.08, 0.9, 0.08], M(a, 0, b), BLACK)),
    ])),
    cyl('Umbrella pole', 0.12, 4.0, L(0, 1.6, 0), WHITE, WHITE, 6), { ...cyl('Umbrella', 6.4, 0.9, L(0, 5.0, 0), STRIPES[String(p.color)] ?? STRIPES.red, STRIPES[String(p.color)] ?? STRIPES.red, 8), taper: 0 },
  ]) },
  drinkfountain: { category: 'Street', label: 'Drinking fountain', hint: 'A park drinking fountain', make: pf('Drinking fountain', (L) => [
    { ...cyl('Fountain post', 1.0, 2.2, L(0, 0, 0), GREY, PB.concrete, 10), taper: 0.8 }, { ...cyl('Fountain bowl', 1.5, 0.4, L(0, 2.2, 0), GREY, GREY, 12), taper: 1.2 },
  ]) },
}

// ---------------- on walls and roofs ----------------
// These hang on a facade: their back (local −Z) is the wall, base at the bottom of the piece.

const WALL: Record<string, PrefabDef & { category: string }> = {
  wallac: { category: 'Street', label: 'Window AC unit', hint: 'An air conditioner sticking out of a window (its back against the wall)', make: pf('Window AC', (L) => [
    box('AC bracket', [2.2, 0.12, 1.2], L(0, 0, 0.6), PB.rusty),
    box('Window AC', [2.4, 1.5, 1.4], L(0, 0.12, 0.7), GREY, PB.steel), box('AC grille', [2.0, 1.1, 0.05], L(0, 0.32, 1.42), BLACK),
  ]) },
  windowbox: { category: 'Street', label: 'Window box', hint: 'Flowers in a box under a window', make: pf('Window box', (L) => [
    box('Window box', [3, 0.7, 0.8], L(0, 0, 0.4), TERRACOTTA, TERRACOTTA), box('Window flowers', [2.8, 0.5, 0.6], L(0, 0.7, 0.4), FLOWERS, FLOWERS),
  ]) },
  satdish: { category: 'Street', label: 'Satellite dish', hint: 'A dish on a wall bracket, aimed out (+Z)', make: pf('Satellite dish', (L) => [
    box('Dish bracket', [0.3, 1.2, 0.3], L(0, 0, 0.15), GREY), box('Dish arm', [0.2, 0.2, 1.0], L(0, 0.9, 0.6), GREY),
    { ...lying('Dish', 2.0, 0.35, L(0, 0.2, 1.2), WHITE, WHITE, 14, 90), taper: 0.35 }, box('Dish feed', [0.1, 0.1, 1.1], L(0, 1.15, 1.9), GREY),
  ]) },
  shopsign: { category: 'Street', label: 'Hanging shop sign', hint: 'A sign on a bracket, sticking out from the wall so passers-by see it', ...pfp('Shop sign', [num('look', 'Look', 0, 5, 0)], (L, p) => [
    box('Sign bracket', [0.12, 0.12, 2.6], L(0, 2.3, 1.3), BLACK), box('Sign plate', [0.2, 2.0, 2.0], L(0, 0, 1.6), SIGNS[+p.look % SIGNS.length], SIGNS[+p.look % SIGNS.length]),
  ]) },
  posters: { category: 'Street', label: 'Posters', hint: 'Ads and flyers pasted on a wall', ...pfp('Posters', [num('n', 'Posters', 1, 4, 3), num('look', 'Look', 0, 5, 0)], (L, p) => [...Array(+p.n)].map((_, i) => {
    const w = [2.2, 1.6, 2.0, 1.4][i], h = [3.0, 2.2, 2.8, 2.0][i], x = [-2.4, 0, 2.2, 4.2][i] - (+p.n - 1) * 0.6
    return { ...box('Poster', [w, h, 0.05], L(x, [0.4, 1.0, 0.6, 1.2][i], 0.03), POSTERS[(+p.look + i) % POSTERS.length]), fit: true }
  })) },
  graffiti: { category: 'Street', label: 'Graffiti', hint: 'A spray-painted tag on a wall (see-through round the letters)', ...pfp('Graffiti', [num('w', 'Width', 3, 20, 8, 0.5), num('look', 'Look', 0, 5, 0)], (L, p) => [
    { ...box('Graffiti', [+p.w, +p.w * 0.42, 0.04], L(0, 0, 0.03), TAGS[+p.look % TAGS.length]), fit: true },
  ]) },
  laundry: { category: 'Street', label: 'Laundry line', hint: 'Washing strung along X between two walls across an alley; the line is 1.7 above the base', ...pfp('Laundry line', [num('len', 'Length', 4, 30, 12)], (L, p) => {
    const len = +p.len, n = Math.max(2, Math.floor(len / 1.8))
    const out: Part[] = [box('Washing line', [len, 0.05, 0.05], L(0, 1.7, 0), WHITE)]
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + (i + 0.6) * (len / (n + 0.2)), [w, h] = [[1.0, 1.3], [1.3, 0.9], [0.7, 1.6]][(i * 7 + n) % 3]
      out.push(box('Washing', [w, h, 0.04], L(x, 1.7 - h, 0), CLOTHES[(i * 5 + 1) % CLOTHES.length]))
    }
    return out
  }) },
  roofac: { category: 'Industrial', label: 'Rooftop AC', hint: 'A rooftop air-handling unit with ducts', make: pf('Rooftop AC', (L) => [
    { ...box('Air handler', [5, 2.4, 3.2], L(0, 0.3, 0), PB.steel), bevel: 0.1 }, box('Handler curb', [5.4, 0.3, 3.6], L(0, 0, 0), PB.concrete),
    cyl('Fan', 1.8, 0.2, L(-1.2, 2.7, 0), BLACK, GREY, 12), cyl('Fan', 1.8, 0.2, L(1.2, 2.7, 0), BLACK, GREY, 12),
    lying('Duct', 1.0, 3.0, L(4.0, 1.2, 0), PB.steel, PB.steel, 10),
  ]) },
  antenna: { category: 'Street', label: 'TV antenna', hint: 'A rooftop TV aerial on a mast', make: pf('TV antenna', (L) => [
    cyl('Aerial mast', 0.15, 5, L(0, 0, 0), GREY, GREY, 6), ...[3.6, 4.2, 4.8].map((y, i) => box('Aerial', [2.6 - i * 0.5, 0.06, 0.06], L(0, y, 0), GREY)), box('Aerial boom', [0.06, 0.06, 2.2], L(0, 4.2, 0), GREY),
  ]) },
}

// ---------------- markets, docks, rails, churches, schools, yards ----------------

const crate = (L: Lf, x: number, y: number, z: number, top: Tex, r = 0): Part[] => at(L, x, z, r, (M) => [
  box('Produce crate', [1.8, 0.7, 1.3], M(0, 0, 0), top, CRATE), box('Crate rim', [1.9, 0.08, 1.4], M(0, 0.62, 0), CRATE, CRATE),
], y)

const PLACES: Record<string, PrefabDef & { category: string }> = {
  produce: { category: 'Street', label: 'Produce stand', hint: 'A trestle of fruit and vegetable crates under a striped awning, customers on the +Z side', ...pfp('Produce stand', [stripeParam('green'), num('look', 'Look', 0, 5, 0)], (L, p) => {
    const s = +p.look
    return [
      box('Trestle', [7, 0.2, 2.6], L(0, 1.4, 0), PB.wood), ...[[-3.2, -1.1], [3.2, -1.1], [-3.2, 1.1], [3.2, 1.1]].map(([a, b]) => box('Trestle leg', [0.2, 1.4, 0.2], L(a, 0, b), PB.wood)),
      ...[-2.3, 0, 2.3].flatMap((x, i) => crate(L, x, 1.6, 0.3, PRODUCE[(s + i) % PRODUCE.length], (i - 1) * 4)),
      ...[-1.2, 1.2].flatMap((x, i) => crate(L, x, 0, 1.8, PRODUCE[(s + i + 3) % PRODUCE.length], i * 8)),
      ...[[-3.4, -1.6], [3.4, -1.6]].map(([a, b]) => box('Awning post', [0.2, 4.6, 0.2], L(a, 0, b), PB.wood)),
      ramp('Awning', [7.6, 0.8, 4], L(0, 4.6, 0.3), STRIPES[String(p.color)] ?? STRIPES.green, STRIPES[String(p.color)] ?? STRIPES.green, 180),
    ]
  }) },
  fruitcrates: { category: 'Street', label: 'Fruit crates', hint: 'Crates of produce stacked on the ground', ...pfp('Fruit crates', [num('look', 'Look', 0, 5, 0)], (L, p) => [
    ...crate(L, -1, 0, 0, PRODUCE[+p.look % 6], 5), ...crate(L, 1, 0, 0.2, PRODUCE[(+p.look + 1) % 6], -6), ...crate(L, 0, 0.72, 0.1, PRODUCE[(+p.look + 2) % 6], 12), ...crate(L, -0.4, 0, -1.6, PRODUCE[(+p.look + 3) % 6], 85),
  ]) },
  lifering: { category: 'Industrial', label: 'Life ring', hint: 'A life ring on a post at the water’s edge', make: pf('Life ring', (L) => [
    box('Ring post', [0.4, 3.6, 0.4], L(0, 0, 0), PB.planks), box('Ring board', [1.8, 1.8, 0.12], L(0, 1.6, 0.26), WHITE),
    lying('Life ring', 1.6, 0.3, L(0, 1.7, 0.48), { gen: 'hazard', tweak: { color: '#f07a1a', accent: '#f2efe6', scale: 4, wear: 0.1, seed: 534 }, surface: 17 }, ORANGE, 12, 90),
    lying('Ring hole', 0.7, 0.32, L(0, 2.15, 0.48), WHITE, WHITE, 10, 90),
  ]) },
  fishnet: { category: 'Industrial', label: 'Net rack', hint: 'Fishing nets hung to dry on a frame, floats along the bottom', make: pf('Net rack', (L) => [
    ...[-3.2, 3.2].map((x) => box('Rack post', [0.3, 4.2, 0.3], L(x, 0, 0), PB.planks)), box('Rack bar', [7, 0.25, 0.25], L(0, 4.0, 0), PB.planks),
    box('Fishing net', [6.2, 3.4, 0.08], L(0, 0.6, 0), NET, NET), ...[-2.4, -0.8, 0.8, 2.4].map((x) => cyl('Float', 0.45, 0.45, L(x, 0.4, 0.2), ORANGE, ORANGE, 8)),
  ]) },
  buoys: { category: 'Industrial', label: 'Buoys', hint: 'Mooring buoys and a coil of rope on the quay', make: pf('Buoys', (L) => [
    { ...cyl('Buoy', 1.4, 1.6, L(-1, 0, 0), ORANGE, ORANGE, 10), taper: 0.6 }, { ...cyl('Buoy', 1.1, 1.3, L(0.6, 0, 0.6), SIGN_RED, WHITE, 10), taper: 0.6 },
    lying('Buoy', 1.2, 1.6, L(0.4, 0, -1.2), WHITE, ORANGE, 10, 30), cyl('Rope coil', 1.8, 0.35, L(1.8, 0, -0.5), ROPE, ROPE, 12), cyl('Rope coil', 1.3, 0.3, L(1.8, 0.35, -0.5), ROPE, ROPE, 12),
  ]) },
  fishcrates: { category: 'Industrial', label: 'Fish boxes', hint: 'Stacks of plastic fish boxes', make: pf('Fish boxes', (L) => [[-1.1, 0, 0], [1.1, 0, 0], [-1.1, 0.8, 0], [1.1, 0.8, 0], [0, 1.6, 0], [0, 0, 1.6]].map(([x, y, z], i) =>
    ({ ...box('Fish box', [2, 0.8, 1.4], L(x, y, z), solid(i % 2 ? '#2a6fe0' : '#e8e6e0', '#1a4a9a', 535 + (i % 2), 17), solid(i % 2 ? '#2a6fe0' : '#e8e6e0', '#1a4a9a', 535 + (i % 2), 17), (i % 3) * 3), bevel: 0.06 }))) },
  sleepers: { category: 'Industrial', label: 'Sleeper stack', hint: 'Spare railway sleepers stacked in layers', make: pf('Sleepers', (L) => [0, 1, 2].flatMap((k) => [-1.5, -0.5, 0.5, 1.5].map((z) => box('Sleeper', [8, 0.5, 0.75], L(0, k * 0.5, z + (k % 2) * 0.2), SLEEPER, SLEEPER)))) },
  railswitch: { category: 'Industrial', label: 'Switch lever', hint: 'A trackside points lever with its target', make: pf('Switch lever', (L) => [
    box('Switch stand', [1.4, 0.7, 1.0], L(0, 0, 0), PB.rusty), box('Lever', [0.15, 1.8, 0.15], L(0.4, 0.7, 0), PB.rusty),
    cyl('Target post', 0.2, 2.6, L(-0.4, 0.7, 0), PB.rusty, PB.rusty, 6), lying('Switch target', 1.0, 0.1, L(-0.4, 2.8, 0), SIGN_RED, PB.yellow, 10, 90),
  ]) },
  // The contact wire hangs 11 above the base (about 5.5 m, over boxcars); run it along the track as one long thin box.
  catenary: { category: 'Industrial', label: 'Catenary mast', hint: 'An overhead-line mast with its cantilever over the track (+Z); the wire hangs 11 up', ...pfp('Catenary mast', [num('reach', 'Reach', 3, 14, 6, 0.5)], (L, p) => [
    box('Mast', [0.55, 13, 0.55], L(0, 0, 0), PB.steel, GREY), box('Mast foot', [1.2, 0.6, 1.2], L(0, 0, 0), PB.concrete),
    box('Cantilever', [0.18, 0.18, +p.reach + 0.6], L(0, 12.2, (+p.reach) / 2), GREY), box('Stay', [0.12, 0.12, +p.reach], L(0, 11.6, (+p.reach) / 2), GREY),
    cyl('Insulator', 0.3, 0.6, L(0, 12.4, 0.4), WHITE, WHITE, 8), box('Dropper', [0.06, 1.2, 0.06], L(0, 11.0, +p.reach), GREY),
  ]) },
  lanternstring: { category: 'Street', label: 'Lantern string', hint: 'Paper lanterns strung along X (hang it between two walls, high over a street); the line is 1.6 above the base', ...pfp('Lanterns', [num('len', 'Length', 6, 70, 30), sel('color', 'Lanterns', [['red', 'Red'], ['mixed', 'Mixed'], ['white', 'White']], 'red')], (L, p) => {
    const len = +p.len, n = Math.max(2, Math.round(len / 3.2)), out: Part[] = [box('Lantern line', [len, 0.05, 0.05], L(0, 1.6, 0), BLACK)]
    const tex = (i: number) => p.color === 'white' ? LANTERN_WHITE : p.color === 'mixed' ? [LANTERN_RED, LANTERN_GOLD, LANTERN_WHITE][i % 3] : LANTERN_RED
    for (let i = 0; i < n; i++) out.push({ ...cyl('Lantern', 0.9, 1.1, L(-len / 2 + (i + 0.5) * (len / n), 0.3, 0), tex(i), tex(i), 8), taper: 0.75 }, cyl('Lantern cap', 0.5, 0.2, L(-len / 2 + (i + 0.5) * (len / n), 1.4, 0), BLACK, BLACK, 8))
    return out
  }) },
  bufferstop: { category: 'Industrial', label: 'Buffer stop', hint: 'The steel stop at the end of a track (buffers to +Z)', make: pf('Buffer stop', (L) => [
    ...[-1.6, 1.6].flatMap((x) => [box('Stop frame', [0.4, 2.2, 2.6], L(x, 0, -0.6), PB.rusty), lying('Buffer', 0.7, 0.8, L(x * 0.8, 1.3, 0.9), PB.steel, BLACK, 10, 90)]),
    box('Stop beam', [5, 0.9, 0.6], L(0, 1.0, 0.3), { gen: 'hazard', tweak: { color: '#c8322b', accent: '#f2efe6', scale: 4, wear: 0.2, seed: 537 }, surface: 15 }),
  ]) },
  relaybox: { category: 'Industrial', label: 'Trackside cabinet', hint: 'A grey relay cabinet', make: pf('Relay cabinet', (L) => [{ ...box('Relay cabinet', [1.8, 2.6, 1.2], L(0, 0, 0), GREY, solid('#8d939a', '#6d737a', 538, 15)), bevel: 0.06 }, box('Cabinet roof', [2.0, 0.15, 1.4], L(0, 2.6, 0), GREY)]) },
  candles: { category: 'Furniture', label: 'Candle stand', hint: 'A votive stand with rows of lit candles', make: pf('Candle stand', (L) => {
    const out: Part[] = [box('Candle stand', [3.2, 1.3, 1.0], L(0, 0, 0), DARK_WOOD), box('Candle tier', [3.2, 0.25, 0.5], L(0, 1.3, -0.25), DARK_WOOD)]
    for (let i = 0; i < 6; i++) for (const [y, z] of [[1.3, 0.25], [1.55, -0.25]] as const) {
      if ((i + (z > 0 ? 0 : 1)) % 3 === 2) continue
      const x = -1.3 + i * 0.52
      out.push(cyl('Candle', 0.16, 0.35, L(x, y, z), FLAME, WAX, 6))
    }
    return out
  }) },
  noticeboard: { category: 'Street', label: 'Notice board', hint: 'A board on two posts under a little roof (read from +Z)', make: pf('Notice board', (L) => [
    ...[-2, 2].map((x) => box('Board post', [0.35, 5, 0.35], L(x, 0, 0), DARK_WOOD)), box('Notice board', [4.4, 2.6, 0.25], L(0, 1.8, 0), DARK_WOOD, BOARD),
    box('Notices', [3.6, 1.8, 0.05], L(0, 2.2, 0.15), CHALK), ramp('Board roof', [5, 0.6, 1.2], L(0, 4.6, -0.3), PB.planks, PB.planks, 180),
  ]) },
  streetflagpole: { category: 'Street', label: 'Flagpole', hint: 'A tall pole with its flag flying along X', ...pfp('Flagpole', [num('h', 'Height', 8, 30, 16), sel('flag', 'Flag', [['stars', 'Stars and stripes'], ['blue', 'Blue'], ['red', 'Red'], ['green', 'Green']], 'stars')], (L, p) => {
    const h = +p.h
    const flag = p.flag === 'stars' ? { gen: 'hazard', tweak: { color: '#b8222a', accent: '#f2efe6', scale: 7, wear: 0.05, seed: 539 }, surface: 17 } as Tex : ({ blue: SIGN_BLUE, red: SIGN_RED, green: SIGN_GREEN } as Record<string, Tex>)[String(p.flag)] ?? SIGN_BLUE
    return [
      box('Flag base', [1.4, 0.6, 1.4], L(0, 0, 0), PB.concrete), { ...cyl('Flagpole', 0.35, h, L(0, 0.6, 0), WHITE, WHITE, 8), taper: 0.6 }, cyl('Finial', 0.5, 0.5, L(0, h + 0.6, 0), BRASS, BRASS, 8),
      box('Flag', [4.2, 2.6, 0.05], L(2.2, h - 2.6, 0), flag, flag), ...(p.flag === 'stars' ? [box('Flag canton', [1.8, 1.4, 0.06], L(1.0, h - 1.4, 0), SIGN_BLUE)] : []),
    ]
  }) },
  grill: { category: 'Furniture', label: 'Barbecue grill', hint: 'A kettle grill on three legs', make: pf('Grill', (L) => [
    ...[0, 120, 240].map((a) => { const [x, z] = turn(0, 0.6, a); return box('Grill leg', [0.1, 1.6, 0.1], L(x, 0, z), GREY) }),
    { ...cyl('Grill bowl', 1.8, 0.8, L(0, 1.6, 0), BLACK, BLACK, 12), taper: 1.3 }, { ...cyl('Grill lid', 2.3, 0.7, L(0, 2.4, 0), BLACK, BLACK, 12), taper: 0.4 },
  ]) },
  lawnchairs: { category: 'Furniture', label: 'Lawn chairs', hint: 'Two folding lawn chairs facing +Z', make: pf('Lawn chairs', (L) => [-1.2, 1.2].flatMap((x, i) => at(L, x, 0, i ? -15 : 15, (M) => [
    box('Chair seat', [1.4, 0.12, 1.3], M(0, 0.8, 0), CLOTHES[i * 3 + 1]), box('Chair back', [1.4, 1.4, 0.12], M(0, 0.9, -0.7), CLOTHES[i * 3 + 1]),
    ...[-0.65, 0.65].map((a) => box('Chair frame', [0.08, 0.8, 1.3], M(a, 0, 0), GREY)),
  ]))) },
  washingline: { category: 'Street', label: 'Clothesline', hint: 'Two T-posts with washing hung between them', make: pf('Clothesline', (L) => {
    const out: Part[] = [...[-5, 5].flatMap((x) => [box('Line post', [0.25, 4.4, 0.25], L(x, 0, 0), GREY), box('Line arm', [0.2, 0.2, 2], L(x, 4.4, 0), GREY)])]
    for (const z of [-0.8, 0.8]) {
      out.push(box('Washing line', [10, 0.04, 0.04], L(0, 4.35, z), WHITE))
      for (let i = 0; i < 4; i++) {
        const k = (i + (z > 0 ? 1 : 0)) % 3, [w, h] = [[1.1, 1.4], [1.5, 1.0], [0.8, 1.6]][k]
        out.push(box('Washing', [w, h, 0.04], L(-3.6 + i * 2.4, 4.35 - h, z), CLOTHES[(i * 2 + (z > 0 ? 1 : 0)) % CLOTHES.length]))
      }
    }
    return out
  }) },
  postbox: { category: 'Street', label: 'House mailbox', hint: 'A curbside mailbox on a post, its door toward the road (+Z)', make: pf('House mailbox', (L) => [
    box('Mailbox post', [0.3, 2.4, 0.3], L(0, 0, 0), PB.wood), { ...box('House mailbox', [0.9, 0.9, 1.7], L(0, 2.4, 0.2), GREY), bevel: 0.3 }, box('Mailbox flag', [0.06, 0.6, 0.12], L(0.48, 2.8, -0.2), SIGN_RED),
  ]) },
  velvetrope: { category: 'Street', label: 'Velvet rope', hint: 'Brass posts and a red rope for a club queue (along X)', ...pfp('Velvet rope', [num('n', 'Posts', 2, 8, 4)], (L, p) => {
    const n = +p.n, gap = 2.4, out: Part[] = []
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * gap
      out.push(cyl('Rope stand', 0.7, 0.12, L(x, 0, 0), BRASS, BRASS, 10), cyl('Rope post', 0.2, 2.0, L(x, 0.12, 0), BRASS, BRASS, 8), cyl('Post top', 0.32, 0.3, L(x, 2.1, 0), BRASS, BRASS, 8))
      if (i < n - 1) out.push(lying('Velvet rope', 0.16, gap - 0.3, L(x + gap / 2, 1.75, 0), SIGN_RED, SIGN_RED, 6))
    }
    return out
  }) },
  airpump: { category: 'Street', label: 'Air pump', hint: 'A coin-op air and water machine', make: pf('Air pump', (L) => [
    { ...box('Air pump', [1.3, 2.6, 0.9], L(0, 0.3, 0), SIGN_RED, WHITE), bevel: 0.08 }, box('Pump base', [1.5, 0.3, 1.1], L(0, 0, 0), PB.concrete), cyl('Hose coil', 0.8, 0.2, L(0.75, 1.4, 0), BLACK, BLACK, 10),
  ]) },
  icemachine: { category: 'Street', label: 'Ice chest', hint: 'An outdoor ice freezer, doors to +Z', make: pf('Ice chest', (L) => [
    { ...box('Ice chest', [4, 3.2, 2], L(0, 0.2, 0), WHITE, solid('#3a7ac8', '#e8e6e0', 540, 15)), bevel: 0.1 }, ...[-1, 1].map((s) => box('Ice door', [1.8, 2.2, 0.06], L(s * 0.95, 0.6, 1.02), solid('#d8e8f0', '#a8c0d0', 541, 9))),
    box('Ice sign', [3.2, 0.6, 0.06], L(0, 2.8, 1.03), solid('#2a5fc0', '#f2efe6', 542, 15)),
  ]) },
  propanecage: { category: 'Street', label: 'Propane cage', hint: 'A locked cage of propane bottles', make: pf('Propane cage', (L) => [
    box('Cage floor', [3.4, 0.2, 1.6], L(0, 0, 0), GREY), box('Cage', [3.4, 2.6, 1.6], L(0, 0.2, 0), GREY, MESH), box('Cage roof', [3.6, 0.15, 1.8], L(0, 2.8, 0), SIGN_RED),
  ]) },
  tirerack: { category: 'Street', label: 'Tire rack', hint: 'Used tires standing in a rack', make: pf('Tire rack', (L) => [
    box('Rack rail', [6, 0.15, 0.15], L(0, 0.2, -0.5), GREY), box('Rack rail', [6, 0.15, 0.15], L(0, 0.2, 0.5), GREY),
    ...[-2.4, -1.6, -0.8, 0, 0.8, 1.6, 2.4].map((x) => lying('Tire', 2.0, 0.7, L(x, 0.05, 0), PB.tire, PB.tire, 12)),
  ]) },
}

export const URBAN_LIFE_PREFABS: Record<string, PrefabDef & { category: string }> = { ...VEHICLES, ...SIGNS_STREET, ...GROUND, ...WALL, ...PLACES }

/** Pieces that hang on a facade: placed against a wall at a given height. */
export const ON_WALL = new Set(['wallac', 'windowbox', 'satdish', 'shopsign', 'posters', 'graffiti'])
/** Paint-thin pieces players and cars cross (they never need room). */
export const FLAT_PIECES = new Set(['manholecover', 'stormdrain', 'puddle', 'litter'])

// ---------------- life on a building ----------------

const LIVED_IN = new Set(['brick', 'darkbrick', 'plaster', 'beige', 'apartment', 'projects', 'shop'])
const STORES = new Set(['brick', 'darkbrick', 'plaster', 'beige', 'shop', 'office'])
const BOXES = new Set(['brick', 'plaster', 'beige', 'apartment', 'shop'])
const AERIALS = new Set(['brick', 'darkbrick', 'plaster', 'beige', 'apartment', 'projects'])

export interface FacadeOptions {
  x: number; y: number; z: number; w: number; d: number; h: number
  style: string; front: 'N' | 'S' | 'E' | 'W'; escape: 'N' | 'S' | 'E' | 'W' | 'none'
  /** Spots (rooftop spawns, pickups) to keep clear. */
  keepClear?: [number, number, number][]
}

/**
 * Everyday life on a city building, in world space, to join its object:
 * window AC units and flower boxes in some upper windows (lined up with the
 * windows its facade texture draws, one floor = 7 units), a satellite dish,
 * a hanging sign beside the shop door and an aerial on the roof. Nothing at
 * head height on the street, and nothing on the fire escape side's landings.
 */
export function facadeLife(o: FacadeOptions): Part[] {
  const out: Part[] = []
  const floors = Math.max(1, Math.round(o.h / 7))
  const across = { apartment: 3, office: 3, glass: 4, projects: 3, warehouse: 1 }[o.style] ?? 2
  const seed = Math.abs(Math.round(o.x * 13 + o.z * 7 + o.h))
  const hash = (a: number, b: number) => { const v = Math.sin(seed * 12.9898 + a * 78.233 + b * 37.719) * 43758.5453; return v - Math.floor(v) }
  const SIDE: Record<string, [number, number]> = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] }
  const place = (key: string, lx: number, lz: number, face: string, dy: number, params?: Params) => {
    const [nx, nz] = SIDE[face]
    const rot = { S: 0, N: 180, E: 90, W: 270 }[face]!
    // Along the face: x for N/S faces, z for E/W faces.
    const x = o.x + (nz ? lx : nx * (o.w / 2)), z = o.z + (nx ? lz : nz * (o.d / 2))
    const def = URBAN_LIFE_PREFABS[key]
    out.push(...def.make(x, z, rot, o.y + dy, params))
  }
  let ac = 0, boxes = 0
  if (LIVED_IN.has(o.style) || o.style === 'office') {
    for (const face of ['S', 'N', 'E', 'W'] as const) {
      const len = face === 'N' || face === 'S' ? o.w : o.d
      // Window centres, as the facade texture draws them (it repeats every 7 units from the block's middle).
      const cols: number[] = []
      for (let k = -20; k <= 20; k++) { const c = (7 * (k + 0.5)) / across; if (Math.abs(c) <= len / 2 - 1.6) cols.push(c) }
      for (let f = 1; f < floors; f++) for (const c of cols) {
        if (o.y + f * 7 + 3.6 > o.y + o.h - 0.8) continue
        if (face === o.escape && Math.abs(c) < 5.5) continue
        const r = hash(f * 31 + c, face.charCodeAt(0))
        if (r < 0.2 && ac < 5 && o.style !== 'office') { place('wallac', c, c, face, f * 7 + 1.95); ac++ }
        else if (r > 0.86 && boxes < 4 && face === o.front && BOXES.has(o.style)) { place('windowbox', c, c, face, f * 7 + 0.8); boxes++ }
      }
    }
  }
  // A dish on a side wall of the flats, high up.
  if ((o.style === 'apartment' || o.style === 'projects') && floors >= 3) {
    const face = o.front === 'N' || o.front === 'S' ? (o.escape === 'E' ? 'W' : 'E') : (o.escape === 'S' ? 'N' : 'S')
    place('satdish', 0, 0, face, (floors - 1) * 7 + 0.4)
  }
  // A hanging sign beside the shop door, above the awning.
  if (STORES.has(o.style) && floors >= 2 && o.h >= 12) {
    const fw = o.front === 'N' || o.front === 'S' ? o.w : o.d
    const off = (fw / 2 - 1.6) * (hash(3, 9) < 0.5 ? -1 : 1)
    place('shopsign', off, off, o.front, 5.9, { look: seed % 6 })
  }
  // An aerial on the roof, clear of spawns.
  if (AERIALS.has(o.style) && o.w >= 12 && o.d >= 12) {
    const ax = o.x + (hash(5, 1) - 0.5) * (o.w - 8), az = o.z + (hash(6, 2) - 0.5) * (o.d - 8)
    if ((o.keepClear ?? []).every((m) => Math.abs(m[1] - (o.y + o.h)) > 0.5 || Math.hypot(m[0] - ax, m[2] - az) > 3)) out.push(...URBAN_LIFE_PREFABS.antenna.make(ax, az, 0, o.y + o.h))
  }
  return out
}
