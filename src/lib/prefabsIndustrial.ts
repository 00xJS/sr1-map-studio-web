// Military, construction and industrial prefabs: checkpoints, fortifications and
// army vehicles; site machinery, materials and structures; plant from power
// lines to tank farms. Each is one object (a group) placed with its base at y
// and turned by rot. Parts only turn about the vertical, so slanted pieces
// (booms, braces, blades, tripod legs) are runs of small boxes (see strut).
import { PB, box, cyl, lying, ramp, stairs, turn, type Part, type Tex } from './sampleKit'
import { group, local, wheels, type ParamDef, type Params, type PrefabDef } from './prefabs'

type Lf = (dx: number, dy: number, dz: number) => [number, number, number]
type V3 = [number, number, number]

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

/**
 * A straight beam from a to b (local points) as a run of overlapping boxes, `w` thick
 * in the plane of the slope and `t` across it. Pieces never dip below the lower end.
 */
function strut(L: Lf, label: string, a: V3, b: V3, w: number, tex: Tex, t = w, maxSteps = 24): Part[] {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]
  const run = Math.hypot(dx, dz)
  if (run < 1e-6) return [box(label, [w, Math.abs(dy) + w, t], L(a[0], Math.min(a[1], b[1]), a[2]), tex)]
  const n = Math.max(1, Math.min(maxSteps, Math.ceil(Math.min(run, Math.abs(dy)) / w)))
  const rot = (Math.atan2(dx, dz) * 180) / Math.PI
  return [...Array(n)].map((_, i) => {
    const m = (i + 0.5) / n
    const y0 = a[1] + (dy * i) / n, y1 = a[1] + (dy * (i + 1)) / n
    return box(label, [t, Math.abs(dy) / n + w, run / n + w], L(a[0] + dx * m, Math.min(y0, y1), a[2] + dz * m), tex, tex, rot)
  })
}

/**
 * Zig-zag stair flights in two lanes side by side (each `lane` wide, centred on x0), one
 * flight per `rise`, `run` long along Z, with landings `land` deep at alternate ends.
 * Even flights climb toward +Z in the −X lane, odd ones toward −Z in the +X lane.
 */
function flights(L: Lf, x0: number, n: number, rise: number, run: number, lane: number, land: number, top: Tex, side: Tex): Part[] {
  const out: Part[] = []
  for (let k = 0; k < n; k++) {
    const up = k % 2 === 0
    out.push(stairs('Stairs', [lane, rise, run], L(x0 + (up ? -lane / 2 : lane / 2), k * rise, 0), top, side, up ? 180 : 0, Math.max(4, Math.round(rise / 0.75))))
    out.push(box('Landing', [lane * 2, 0.4, land], L(x0, (k + 1) * rise - 0.4, (up ? 1 : -1) * (run / 2 + land / 2)), top, side))
  }
  return out
}

const posts = (L: Lf, w: number, d: number, h: number, tex: Tex, s = 0.3, y = 0) =>
  [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].map(([a, b]) => box('Post', [s, h, s], L(a, y, b), tex))

// ---------------- materials ----------------

const solid = (color: string, accent: string, seed: number, surface = 17): Tex => ({ gen: 'paint', tweak: { color, accent, scale: 2, wear: 0.08, seed }, surface })
const paint = (color: string, seed: number, wear = 0.25, scale = 2): Tex => ({ gen: 'metal_plate', tweak: { color, accent: '#5a3a24', scale, wear, seed }, surface: 15 })
const OLIVE = paint('#4f5a2e', 600)
const OLIVE_DARK = paint('#3b4423', 601)
const CAMO: Tex = { gen: 'dirt', tweak: { color: '#4d5a2c', accent: '#2c3318', scale: 3, wear: 0.8, seed: 603 }, surface: 17 }
const CANVAS: Tex = { gen: 'paint', tweak: { color: '#6b6a48', accent: '#5c5b3c', scale: 3, wear: 0.35, seed: 604 }, surface: 17 }
const SANDBAG: Tex = { gen: 'sand', tweak: { color: '#b49a6a', accent: '#8a7550', scale: 2, seed: 9 } }
const HESCO: Tex = { gen: 'tiles', tweak: { color: '#b8a57a', accent: '#5e605a', scale: 5, wear: 0.4, seed: 605 }, surface: 14 }
const WIRE: Tex = { gen: 'metal_plate', tweak: { color: '#7a7e82', accent: '#5a4a3a', scale: 1, wear: 0.4, seed: 606 }, surface: 15 }
const COIL: Tex = { gen: 'tiles', tweak: { color: '#2a2c2e', accent: '#9a9ea2', scale: 10, wear: 0.3, seed: 607 }, surface: 14 }
const MESH: Tex = { gen: 'tiles', tweak: { color: '#3a3d40', accent: '#8d9094', scale: 16, wear: 0.2, seed: 430 }, surface: 14 }
const NETTING: Tex = { gen: 'tiles', tweak: { color: '#2f6a3a', accent: '#1d4a26', scale: 12, wear: 0.1, seed: 608 }, surface: 14 }
const GLASS: Tex = { gen: 'paint', tweak: { color: '#25313b', accent: '#1a2229', scale: 2, wear: 0, seed: 407 }, surface: 9 }
const WHITE = solid('#e8e6e0', '#cfccc4', 404)
const BLACK = solid('#1d1d20', '#141416', 406, 15)
const RED = solid('#c8302a', '#7a1612', 646)
const LAMP = solid('#f4f1e2', '#c9c4ad', 609)
const GREEN_LIGHT = solid('#20c040', '#106020', 632)
const HAZARD: Tex = { gen: 'hazard', tweak: { seed: 358 } }
const RED_WHITE: Tex = { gen: 'hazard', tweak: { color: '#c8302a', accent: '#eeeeee', scale: 3, wear: 0.15, seed: 610 } }
const ORANGE_WHITE: Tex = { gen: 'hazard', tweak: { color: '#f07a1a', accent: '#f2f2f2', scale: 3, wear: 0.15, seed: 611 } }
const ORANGE = solid('#f07a1a', '#7a3a08', 612)
const SITE_YELLOW = paint('#e2a91a', 613, 0.2, 1)
const GALV: Tex = { gen: 'metal_plate', tweak: { color: '#a9afb3', accent: '#7a7f84', scale: 3, wear: 0.1, seed: 614 }, surface: 15 }
const TRACK: Tex = { gen: 'diamond_plate', tweak: { color: '#303032', accent: '#18181a', scale: 6, wear: 0.25, seed: 615 } }
const LATTICE: Tex = { gen: 'tiles', tweak: { color: '#26262a', accent: '#e2a91a', scale: 3, wear: 0.15, seed: 616 }, surface: 15 }
const GREY_LATTICE: Tex = { gen: 'tiles', tweak: { color: '#2a2c2e', accent: '#a9afb3', scale: 3, wear: 0.1, seed: 647 }, surface: 15 }
const PAD: Tex = { gen: 'concrete', tweak: { color: '#5c5f61', accent: '#3e4042', seed: 617 } }
const SOLAR: Tex = { gen: 'tiles', tweak: { color: '#1b2c4d', accent: '#9aa8bc', scale: 6, wear: 0, seed: 618 }, surface: 9 }
const BELT: Tex = { gen: 'diamond_plate', tweak: { color: '#222224', accent: '#111112', scale: 10, wear: 0.1, seed: 619 } }
const CARDBOARD = solid('#b08a5a', '#8a6a40', 620, 21)
const PAPER = solid('#c9c2ae', '#a8a08a', 621)
const WRAP = solid('#c8ccd0', '#aab0b6', 636)
const OLIVE_WOOD: Tex = { gen: 'wood_planks', tweak: { color: '#55603a', accent: '#3a4228', scale: 3, seed: 622 }, surface: 21 }
const OSB: Tex = { gen: 'wood_planks', tweak: { color: '#c4a56a', accent: '#9a7a48', scale: 8, wear: 0.3, seed: 637 }, surface: 21 }
const DRAIN_WATER: Tex = { gen: 'water', tweak: { color: '#3a4a3e', accent: '#7a8a7a', seed: 624 }, surface: 20 }
const DIRT: Tex = { gen: 'dirt', tweak: { color: '#6e5238', accent: '#9a8770', wear: 0.5, seed: 625 } }
const RUBBLE: Tex = { gen: 'gravel', tweak: { color: '#7a746a', accent: '#4a453e', scale: 10, seed: 626 } }
const PRIMER = paint('#8a3a22', 627, 0.35)
const FAN: Tex = { gen: 'tiles', tweak: { color: '#2a2e32', accent: '#8a9096', scale: 6, wear: 0.1, seed: 628 }, surface: 15 }
const PLATE: Tex = { gen: 'metal_plate', tweak: { color: '#5a5e62', accent: '#6a4a2a', scale: 1, wear: 0.5, seed: 635 }, surface: 15 }
const COVER: Tex = { gen: 'diamond_plate', tweak: { color: '#4a4c4e', accent: '#2a2c2e', scale: 6, seed: 642 } }
const PORCELAIN = solid('#b8b2a6', '#8a8478', 648)
const GREEN_BOX = paint('#3f6a4a', 638, 0.15)
const GREY_BOX = paint('#7a8086', 649, 0.15)

const CT: Record<string, Tex> = {
  red: PB.boxRed, blue: PB.boxBlue, green: PB.boxGreen,
  orange: paint('#c8641e', 629, 0.3, 6), grey: paint('#7a7f84', 630, 0.3, 6), white: paint('#d8d8d4', 631, 0.2, 6),
}
const ctColor = (d: string) => sel('color', 'Color', [['red', 'Red'], ['blue', 'Blue'], ['green', 'Green'], ['orange', 'Orange'], ['grey', 'Grey'], ['white', 'White']], d)
const FLAG: Record<string, Tex> = {
  red: RED, blue: solid('#2a5ab8', '#123a7a', 650), green: solid('#2f8a3a', '#155a22', 651),
  yellow: solid('#f2c218', '#7a5f08', 652), white: WHITE, black: BLACK, olive: solid('#4f5a2e', '#3b4423', 653),
}
const T = (table: Record<string, Tex>, key: unknown, fallback: Tex) => table[String(key)] ?? fallback

// ---------------- shared pieces ----------------

/** A walk-in guard booth, door on +Z, windows on the other three sides. */
const booth = (L: Lf): Part[] => [
  box('Booth floor', [6, 0.3, 6], L(0, 0, 0), PB.concrete),
  box('Booth wall', [6, 2.6, 0.3], L(0, 0.3, -2.85), WHITE), box('Booth window', [6, 2.4, 0.2], L(0, 2.9, -2.85), GLASS), box('Booth wall', [6, 1.1, 0.3], L(0, 5.3, -2.85), WHITE),
  ...[-2.85, 2.85].flatMap((x) => [box('Booth wall', [0.3, 2.6, 5.4], L(x, 0.3, 0), WHITE), box('Booth window', [0.2, 2.4, 5.4], L(x, 2.9, 0), GLASS), box('Booth wall', [0.3, 1.1, 5.4], L(x, 5.3, 0), WHITE)]),
  ...[-2.1, 2.1].map((x) => box('Booth wall', [1.8, 6.1, 0.3], L(x, 0.3, 2.85), WHITE)), box('Lintel', [2.4, 0.9, 0.3], L(0, 5.5, 2.85), WHITE),
  { ...box('Booth roof', [7.2, 0.5, 7.2], L(0, 6.4, 0), PB.steel, RED_WHITE), bevel: 0.1 },
  box('Booth desk', [4.4, 1.9, 1.1], L(0, 0.3, -2.1), PB.steel),
]

/** A boom barrier: housing at the origin, the arm reaching `len` along +X (or raised). */
const boom = (L: Lf, len: number, open: boolean): Part[] => [
  { ...box('Gate housing', [1.4, 3, 1.4], L(0, 0, 0), WHITE, RED), bevel: 0.15 },
  box('Counterweight', [1, 0.8, 0.6], L(-0.9, 2.2, 0), BLACK),
  open ? box('Boom', [0.4, len, 0.4], L(0.9, 2.4, 0), RED_WHITE, RED_WHITE, 0, 2) : box('Boom', [len, 0.4, 0.4], L(0.7 + len / 2, 2.4, 0), RED_WHITE, RED_WHITE, 0, 2),
  box('Boom rest', [0.4, 2.4, 0.4], L(len + 0.5, 0, 0), WHITE),
]

/** A short stack of insulator discs from y upward. */
const insulator = (L: Lf, x: number, y: number, z: number, n: number, d = 0.9): Part[] =>
  [...Array(n)].map((_, i) => cyl('Insulator', d, 0.3, L(x, y + i * 0.42, z), PORCELAIN, PORCELAIN, 8))

const sandbags = (label: string, size: V3, at: V3, rot = 0): Part => ({ ...box(label, size, at, SANDBAG, SANDBAG, rot), bevel: Math.min(0.35, size[1] / 3) })

// ---------------- military ----------------

const MILITARY: Record<string, PrefabDef & { category: string }> = {
  steeltower: { category: 'Military', label: 'Steel watchtower', hint: 'A tall braced lookout with a walled cabin and stairs up', ...pfp('Steel watchtower', [num('h', 'Deck height', 8, 24, 12)], (L, p) => {
    const h = +p.h, s = 2.6, run = (h + 0.4) * 1.25, bay = Math.min(5, h) - 0.3
    const rings = [5, 10, 15, 20].filter((y) => y < h - 1)
    return [
      ...[[-s, -s], [s, -s], [-s, s], [s, s]].map(([a, b]) => box('Tower leg', [0.5, h, 0.5], L(a, 0, b), OLIVE)),
      ...rings.flatMap((y) => [box('Brace', [2 * s + 0.5, 0.3, 0.3], L(0, y, -s), OLIVE), box('Brace', [2 * s + 0.5, 0.3, 0.3], L(0, y, s), OLIVE), box('Brace', [0.3, 0.3, 2 * s], L(-s, y, 0), OLIVE), box('Brace', [0.3, 0.3, 2 * s], L(s, y, 0), OLIVE)]),
      ...strut(L, 'Brace', [-s, 0.5, -s], [s, bay, -s], 0.3, OLIVE), ...strut(L, 'Brace', [-s, 0.5, s], [-s, bay, -s], 0.3, OLIVE), ...strut(L, 'Brace', [s, 0.5, -s], [s, bay, s], 0.3, OLIVE),
      box('Cabin floor', [7, 0.4, 7], L(0, h, 0), PB.diamond, OLIVE),
      box('Cabin wall', [7, 2, 0.3], L(0, h + 0.4, -3.35), OLIVE_DARK), ...[-2.4, 2.4].map((x) => box('Cabin wall', [2.2, 2, 0.3], L(x, h + 0.4, 3.35), OLIVE_DARK)),
      ...[-3.35, 3.35].map((x) => box('Cabin wall', [0.3, 2, 6.4], L(x, h + 0.4, 0), OLIVE_DARK)),
      ...posts(L, 6.7, 6.7, 3.4, OLIVE_DARK, 0.3, h + 2.4),
      { ...box('Cabin roof', [8, 0.4, 8], L(0, h + 5.8, 0), OLIVE, OLIVE), bevel: 0.1 },
      stairs('Tower stairs', [2.4, h + 0.4, run], L(0, 0, 3.5 + run / 2), PB.diamond, OLIVE, 0, Math.round((h + 0.4) / 0.8)),
    ]
  }) },
  sniperperch: { category: 'Military', label: 'Sniper nest', hint: 'A high platform ringed with sandbags under a camo net, with stairs up', ...pfp('Sniper nest', [num('h', 'Height', 6, 20, 12)], (L, p) => {
    const h = +p.h, run = (h + 0.4) * 1.25
    return [
      ...posts(L, 3.6, 3.6, h, PB.wood, 0.5),
      ...[h / 3, (2 * h) / 3].flatMap((y) => [box('Brace', [4.1, 0.3, 0.3], L(0, y, -1.8), PB.wood), box('Brace', [4.1, 0.3, 0.3], L(0, y, 1.8), PB.wood)]),
      box('Platform', [6, 0.4, 6], L(0, h, 0), PB.planks, PB.wood),
      sandbags('Sandbags', [6, 1.4, 0.9], L(0, h + 0.4, -2.55)), sandbags('Sandbags', [0.9, 1.4, 4.2], L(-2.55, h + 0.4, 0)), sandbags('Sandbags', [0.9, 1.4, 4.2], L(2.55, h + 0.4, 0)),
      ...[-2.1, 2.1].map((x) => sandbags('Sandbags', [1.8, 1.4, 0.9], L(x, h + 0.4, 2.55))),
      ...posts(L, 5.6, 5.6, 3.2, PB.wood, 0.2, h + 0.4),
      { ...cyl('Camo net', 7 * Math.SQRT2, 1.2, L(0, h + 3.6, 0), CAMO, CAMO, 4, 45), taper: 0 },
      stairs('Stairs', [2.4, h + 0.4, run], L(0, 0, 3 + run / 2), PB.planks, PB.wood, 0, Math.round((h + 0.4) / 0.8)),
    ]
  }) },
  guardbooth: { category: 'Military', label: 'Guard booth', hint: 'A walk-in booth with windows on three sides', make: pf('Guard booth', booth) },
  boomgate: { category: 'Military', label: 'Boom barrier', hint: 'A striped barrier arm on a housing; raise or lower it', ...pfp('Boom barrier', [num('len', 'Arm length', 6, 20, 10), yesNo('open', 'Raised', 'no')], (L, p) => boom(L, +p.len, p.open === 'yes')) },
  checkpoint: { category: 'Military', label: 'Checkpoint', hint: 'A guard booth, boom barrier, speed bump and barriers across an 11-wide lane', make: pf('Checkpoint', (L) => [
    ...at(L, -9, 0, 90, booth),
    ...at(L, -5.6, -4, 0, (M) => boom(M, 10, false)),
    ...[-8.4, 0, 8.4].map((z) => ({ ...box('Jersey barrier', [1.2, 2, 8], L(7, 0, z), PB.concrete), bevel: 0.3 })),
    { ...box('Speed bump', [11, 0.3, 1.2], L(0, 0, 6), HAZARD, HAZARD), bevel: 0.12 },
    sandbags('Sandbags', [5, 1.6, 1.2], L(-9, 0, 4.6)),
    cyl('Sign post', 0.2, 4, L(-5.6, 0, 8), PB.steel, PB.steel, 6), { ...lying('Stop sign', 1.6, 0.1, L(-5.6, 3.4, 8.1), RED, RED, 8, 90), rot: 90 },
    cyl('Lamp post', 0.3, 8, L(-12.6, 0, -3), PB.steel, PB.steel, 6), box('Floodlight', [0.8, 0.6, 1], L(-12.6, 8, -2.6), LAMP),
  ]) },
  wirefence: { category: 'Military', label: 'Barbed wire fence', hint: 'Posts with chain-link or wire strands and razor wire along the top', ...pfp('Barbed wire fence', [num('len', 'Length', 8, 60, 24, 2), num('h', 'Height', 3, 7, 4.5, 0.5), yesNo('mesh', 'Chain-link mesh', 'yes')], (L, p) => {
    const len = +p.len, h = +p.h, n = Math.max(1, Math.round(len / 4))
    return [
      ...[...Array(n + 1)].map((_, i) => box('Fence post', [0.25, h + 0.4, 0.25], L(-len / 2 + (i * len) / n, 0, 0), WIRE)),
      ...(p.mesh === 'yes' ? [box('Fence mesh', [len, h - 0.2, 0.08], L(0, 0.2, 0), WIRE, MESH, 0, 4)] : [0.8, 1.8, 2.8, 3.8, 4.8, 5.8].filter((y) => y < h - 0.4).map((y) => box('Wire', [len, 0.06, 0.06], L(0, y, 0), WIRE))),
      box('Top wire', [len, 0.12, 0.12], L(0, h, 0), WIRE),
      lying('Razor wire', 1.2, len, L(0, h + 0.1, 0), COIL, COIL, 6),
    ]
  }) },
  wirecoil: { category: 'Military', label: 'Concertina wire', hint: 'Coils of razor wire on pickets, one or two rows high', ...pfp('Concertina wire', [num('len', 'Length', 4, 40, 12), num('tiers', 'Rows high', 1, 2, 2)], (L, p) => {
    const len = +p.len, n = Math.max(2, Math.ceil(len / 6) + 1)
    return [
      ...[-1.05, 1.05].map((z) => lying('Concertina wire', 2.2, len, L(0, 0, z), COIL, COIL, 8)),
      ...(+p.tiers > 1 ? [lying('Concertina wire', 2.2, len, L(0, 1.9, 0), COIL, COIL, 8)] : []),
      ...[...Array(n)].map((_, i) => box('Picket', [0.15, +p.tiers > 1 ? 4.2 : 2.4, 0.15], L(-len / 2 + 0.3 + ((len - 0.6) * i) / (n - 1), 0, 0), WIRE)),
    ]
  }) },
  hesco: { category: 'Military', label: 'Hesco barrier', hint: 'Mesh-and-sand barrier cells in a row, one or two high', ...pfp('Hesco', [num('n', 'Cells', 1, 12, 4), num('tiers', 'Tiers', 1, 2, 1)], (L, p) => {
    const n = +p.n
    return [...Array(+p.tiers)].flatMap((_, t) => [...Array(n)].map((_, i) => box('Hesco cell', [3, 3.4, 3], L((i - (n - 1) / 2) * 3, t * 3.4, 0), SANDBAG, HESCO, 0, 3)))
  }) },
  twall: { category: 'Military', label: 'Concrete T-walls', hint: 'Tall blast-wall panels on T footings', ...pfp('T-walls', [num('n', 'Panels', 1, 10, 4), num('h', 'Height', 5, 14, 9, 0.5)], (L, p) => [...Array(+p.n)].flatMap((_, i) => {
    const x = (i - (+p.n - 1) / 2) * 3.1
    return [box('T-wall base', [3, 1, 4], L(x, 0, 0), PB.concrete), box('T-wall', [3, +p.h - 1, 0.8], L(x, 1, 0), PB.concrete, PB.concrete, 0, 3)]
  })) },
  pillbox: { category: 'Military', label: 'Pillbox', hint: 'A six-sided concrete pillbox with a firing slit all round', make: pf('Pillbox', (L) => [
    cyl('Pillbox', 10, 2.2, L(0, 0, 0), PB.concrete, PB.concrete, 6),
    cyl('Firing slit', 9, 0.9, L(0, 2.2, 0), BLACK, BLACK, 6),
    ...[0, 60, 120, 180, 240, 300].map((a) => box('Pier', [1.1, 0.9, 1.1], L(4.6 * Math.cos((a * Math.PI) / 180), 2.2, 4.6 * Math.sin((a * Math.PI) / 180)), PB.concrete)),
    cyl('Pillbox roof', 10.6, 1.4, L(0, 3.1, 0), PB.concrete, PB.concrete, 6),
    { ...cyl('Roof cap', 7, 0.8, L(0, 4.5, 0), PB.concrete, PB.concrete, 6), taper: 0.7 },
    box('Steel door', [2.4, 2, 0.15], L(0, 0, -4.36), BLACK), box('Blast wall', [5, 2.2, 0.8], L(0, 0, -6.6), PB.concrete),
  ]) },
  foxhole: { category: 'Military', label: 'Sandbag foxhole', hint: 'A ring of sandbags to crouch in, open at the back, with a machine gun', make: pf('Foxhole', (L) => {
    const out: Part[] = [cyl('Foxhole floor', 7.4, 0.15, L(0, 0, 0), DIRT, DIRT, 10)]
    for (let i = 0; i < 8; i++) {
      if (i === 4) continue
      const a = i * 45, [x, z] = turn(0, 3.7, a)
      out.push(sandbags('Sandbags', [3, 1, 1.3], L(x, 0, z), a))
      if (i !== 3) { const b = a + 22.5, [x2, z2] = turn(0, 3.6, b); out.push(sandbags('Sandbags', [3, 1, 1.3], L(x2, 1, z2), b)) }
    }
    out.push(box('Gun body', [0.4, 0.4, 1.4], L(0, 2, 3.2), BLACK), { ...lying('Gun barrel', 0.2, 2, L(0, 2.1, 4.8), BLACK, BLACK, 6), rot: 90 }, box('Ammo crate', [1.6, 0.9, 1], L(-1.6, 0.15, 1.4), OLIVE_WOOD))
    return out
  }) },
  hedgehogs: { category: 'Military', label: 'Tank traps', hint: 'Steel hedgehogs of three crossed beams', ...pfp('Tank traps', [num('n', 'Traps', 1, 8, 3)], (L, p) => [...Array(+p.n)].flatMap((_, i) =>
    at(L, (i - (+p.n - 1) / 2) * 4.6, (i % 2) * 1.2 - 0.6, i * 37, (M) => [0, 60, 120].flatMap((r) => {
      const [ax, az] = turn(-1.6, 0, r), [bx, bz] = turn(1.6, 0, r)
      return strut(M, 'Hedgehog beam', [ax, 0, az], [bx, 3, bz], 0.4, PB.rusty)
    })))) },
  dragonteeth: { category: 'Military', label: "Dragon's teeth", hint: 'Rows of concrete pyramids that stop vehicles', ...pfp("Dragon's teeth", [num('n', 'Per row', 2, 12, 5), num('rows', 'Rows', 1, 4, 2)], (L, p) => {
    const n = +p.n, rows = +p.rows
    return [...Array(rows)].flatMap((_, r) => [...Array(n)].map((_, i) => ({ ...cyl('Tooth', 3.2, 2.6, L((i - (n - 1) / 2) * 3.4 + (r % 2) * 1.7, 0, (r - (rows - 1) / 2) * 3.4), PB.concrete, PB.concrete, 4, 45), taper: 0.3 })))
  }) },
  tank: { category: 'Military', label: 'Battle tank', hint: 'A parked tank (scenery): tracks, turret and a long gun', make: pf('Tank', (L) => [
    ...[-1, 1].flatMap((s) => [
      { ...box('Track', [1.7, 2.2, 13], L(s * 3.3, 0, 0), TRACK, TRACK), bevel: 0.6 },
      ...[-4.4, -2.2, 0, 2.2, 4.4].map((z) => lying('Road wheel', 1.5, 1.8, L(s * 3.3, 0.15, z), OLIVE_DARK, OLIVE_DARK, 10)),
    ]),
    box('Hull', [4.9, 1.8, 12.4], L(0, 0.6, 0), OLIVE),
    box('Upper hull', [8.5, 1, 10], L(0, 2.4, -1), OLIVE), ramp('Glacis', [8.5, 1, 3], L(0, 2.4, 5.5), OLIVE, OLIVE),
    { ...box('Turret', [5.4, 1.8, 6], L(0, 3.4, -1.2), OLIVE, OLIVE), bevel: 0.6 },
    box('Mantlet', [2, 1.2, 1], L(0, 3.7, 2.1), OLIVE_DARK),
    lying('Gun barrel', 0.55, 9, L(0, 4, 6.4), OLIVE_DARK, OLIVE_DARK, 10, 90), lying('Muzzle', 0.8, 1, L(0, 3.88, 10.6), OLIVE_DARK, OLIVE_DARK, 10, 90),
    cyl('Hatch', 1.6, 0.4, L(-1.2, 5.2, -2), OLIVE_DARK, OLIVE_DARK, 10), box('Stowage box', [4, 1, 1.2], L(0, 3.8, -4.6), OLIVE_DARK),
  ]) },
  apc: { category: 'Military', label: 'Armored carrier', hint: 'An eight-wheeled armored personnel carrier with a small turret', make: pf('APC', (L) => [
    { ...box('Hull', [6, 3, 14], L(0, 1.2, -0.5), OLIVE, OLIVE), bevel: 0.5 },
    ramp('Nose', [6, 1.8, 2.6], L(0, 1.2, 7.8), OLIVE, OLIVE),
    cyl('Turret', 2.6, 1, L(0, 4.2, 1.5), OLIVE_DARK, OLIVE_DARK, 10), lying('Turret gun', 0.3, 4, L(0, 4.55, 4.5), BLACK, BLACK, 8, 90),
    box('Rear door', [3, 2.4, 0.1], L(0, 1.5, -7.55), OLIVE_DARK),
    ...[-1.6, 1.6].map((x) => box('Vision block', [1, 0.5, 0.1], L(x, 3.2, 6.52), GLASS)),
    ...wheels(L, 6.2, [-4.6, -1.6, 1.6, 4.6], 2.2, 0.9),
  ]) },
  jeep: { category: 'Military', label: 'Army jeep', hint: 'An open-top jeep with a roll bar and spare wheel', make: pf('Jeep', (L) => [
    { ...box('Jeep body', [4.4, 1.6, 8], L(0, 1, 0), OLIVE, OLIVE), bevel: 0.25 },
    { ...box('Hood', [4, 0.4, 2.6], L(0, 2.6, 2.5), OLIVE), bevel: 0.15 },
    box('Windshield', [4, 1.6, 0.15], L(0, 2.6, 1.1), GLASS, OLIVE_DARK),
    ...[-1.9, 1.9].map((x) => box('Roll bar', [0.2, 2.2, 0.2], L(x, 2.6, -2), OLIVE_DARK)), box('Roll bar', [4, 0.2, 0.2], L(0, 4.8, -2), OLIVE_DARK),
    ...[-1, 1].map((x) => box('Seat', [1.4, 1, 1.4], L(x, 2.6, -0.2), CANVAS)),
    lying('Spare tire', 1.8, 0.6, L(0, 1.4, -4.3), PB.tire, PB.tire, 12, 90),
    box('Grille', [2.6, 1, 0.1], L(0, 1.4, 4.02), BLACK), ...[-1.4, 1.4].map((x) => box('Headlight', [0.5, 0.5, 0.06], L(x, 1.9, 4.02), LAMP)),
    ...wheels(L, 4.4, [-2.6, 2.6], 1.9, 0.7),
  ]) },
  armytruck: { category: 'Military', label: 'Army truck', hint: 'A six-wheeled cargo truck with a canvas cover', make: pf('Army truck', (L) => [
    box('Chassis', [3.6, 0.8, 18], L(0, 1, 0), BLACK),
    { ...box('Cab', [5, 3.4, 3.8], L(0, 1.8, 5.8), OLIVE), bevel: 0.3 }, box('Cab glass', [4.6, 1.3, 0.1], L(0, 3.6, 7.72), GLASS),
    { ...box('Hood', [4.2, 2.2, 3], L(0, 1.8, 9.1), OLIVE), bevel: 0.3 }, box('Bumper', [5, 0.6, 0.4], L(0, 1.4, 10.7), BLACK),
    box('Cargo bed', [5.6, 1.4, 11], L(0, 1.8, -2.5), OLIVE_WOOD, OLIVE),
    { ...box('Canvas cover', [5.6, 3.6, 10.6], L(0, 3.2, -2.7), CANVAS, CANVAS), bevel: 0.8 },
    ...wheels(L, 4.8, [-6, -3.2, 8.2], 2.1, 0.8),
  ]) },
  armyheli: { category: 'Military', label: 'Military helicopter', hint: 'A parked military helicopter on skids (scenery)', make: pf('Military helicopter', (L) => [
    ...[-1, 1].flatMap((s) => [lying('Skid', 0.35, 10, L(s * 2.2, 0, 0), OLIVE_DARK, OLIVE_DARK, 6, 90), box('Skid strut', [0.25, 1.3, 0.25], L(s * 2.1, 0.2, 2.5), OLIVE_DARK), box('Skid strut', [0.25, 1.3, 0.25], L(s * 2.1, 0.2, -2.5), OLIVE_DARK)]),
    { ...box('Fuselage', [4, 3.6, 8], L(0, 1.4, -0.5), OLIVE), bevel: 0.9 },
    { ...box('Cockpit', [3.6, 2.8, 2.6], L(0, 1.5, 3.8), GLASS, GLASS), bevel: 0.8 },
    box('Tail boom', [1, 1, 10], L(0, 3.4, -9.4), OLIVE), box('Tail fin', [0.3, 3.2, 1.8], L(0, 3.6, -13.8), OLIVE),
    box('Stabilizer', [3.2, 0.2, 1], L(0, 3.9, -12.6), OLIVE), box('Tail rotor', [0.1, 3.2, 0.5], L(0.3, 3.6, -13.6), BLACK),
    { ...box('Engine', [2.4, 0.9, 3.4], L(0, 5, -1.2), OLIVE), bevel: 0.3 },
    cyl('Rotor mast', 0.6, 0.7, L(0, 5.9, -0.5), BLACK, BLACK, 8), cyl('Rotor hub', 1, 0.3, L(0, 6.6, -0.5), BLACK, BLACK, 8),
    box('Rotor blade', [22, 0.15, 0.8], L(0, 6.6, -0.5), BLACK, BLACK, 45), box('Rotor blade', [22, 0.15, 0.8], L(0, 6.6, -0.5), BLACK, BLACK, 135),
  ]) },
  helipad: { category: 'Military', label: 'Helipad', hint: 'A landing pad with a ringed H and edge lights', ...pfp('Helipad', [num('size', 'Size', 16, 40, 24)], (L, p) => {
    const s = +p.size, e = s / 2 - 0.6
    return [
      box('Helipad', [s, 0.3, s], L(0, 0, 0), PAD, PB.concrete),
      cyl('Pad ring', s * 0.84, 0.35, L(0, 0, 0), WHITE, WHITE, 24), cyl('Pad center', s * 0.84 - 1.2, 0.4, L(0, 0, 0), PAD, PAD, 24),
      box('H', [1.2, 0.45, s * 0.36], L(-s * 0.12, 0, 0), WHITE), box('H', [1.2, 0.45, s * 0.36], L(s * 0.12, 0, 0), WHITE), box('H', [s * 0.24, 0.45, 1.2], L(0, 0, 0), WHITE),
      ...[[-e, -e], [0, -e], [e, -e], [-e, 0], [e, 0], [-e, e], [0, e], [e, e]].map(([x, z]) => cyl('Edge light', 0.5, 0.6, L(x, 0, z), GREEN_LIGHT, GREEN_LIGHT, 8)),
    ]
  }) },
  radar: { category: 'Military', label: 'Radar dish', hint: 'A big dish on a pedestal with an equipment hut', make: pf('Radar', (L) => [
    box('Radar base', [5, 1.2, 5], L(0, 0, 0), PB.concrete),
    { ...cyl('Pedestal', 2.4, 5, L(0, 1.2, 0), GALV, GALV, 10), taper: 0.6 }, box('Yoke', [3.4, 1, 1.2], L(0, 6.2, 0), GALV),
    { ...cyl('Dish', 3, 2, L(0, 7.2, 0), WHITE, WHITE, 16), taper: 3 },
    cyl('Feed post', 0.25, 3, L(0, 9.2, 0), GALV, GALV, 6), box('Feed horn', [0.6, 0.6, 0.6], L(0, 12.2, 0), GALV),
    box('Equipment hut', [4, 3, 3], L(5, 0, 1), PB.steel, WHITE), box('Door', [1.6, 2.4, 0.08], L(5, 0, 2.54), BLACK),
  ]) },
  radome: { category: 'Military', label: 'Radar dome', hint: 'A white radar ball on a concrete tower', make: pf('Radome', (L) => [
    box('Radome tower', [8, 8, 8], L(0, 0, 0), PB.concrete, PB.cinder), box('Door', [2.4, 4, 0.15], L(0, 0, 4.02), BLACK),
    { ...cyl('Radome', 7, 1.6, L(0, 8, 0), WHITE, WHITE, 16), taper: 1.33 },
    { ...cyl('Radome', 9.3, 2.2, L(0, 9.6, 0), WHITE, WHITE, 16), taper: 1.08 },
    { ...cyl('Radome', 10, 2.2, L(0, 11.8, 0), WHITE, WHITE, 16), taper: 0.8 },
    { ...cyl('Radome', 8, 1.8, L(0, 14, 0), WHITE, WHITE, 16), taper: 0.5 },
    { ...cyl('Radome', 4, 0.9, L(0, 15.8, 0), WHITE, WHITE, 16), taper: 0 },
    ...[[0, -3.9, 0], [0, 3.9, 0], [-3.9, 0, 90], [3.9, 0, 90]].map(([x, z, r]) => box('Roof rail', [8, 1, 0.15], L(x, 8, z), GALV, GALV, r)),
  ]) },
  antennamast: { category: 'Military', label: 'Antenna mast', hint: 'A tall banded comms mast with dishes and an equipment shelter', ...pfp('Antenna mast', [num('h', 'Height', 16, 60, 36, 2)], (L, p) => {
    const h = +p.h, seg = 6, out: Part[] = [box('Mast base', [4, 0.8, 4], L(0, 0, 0), PB.concrete)]
    for (let i = 0; i < seg; i++) {
      const d0 = 2.6 - i * 0.3
      out.push({ ...cyl('Mast', d0, h / seg, L(0, 0.8 + (i * h) / seg, 0), GALV, i % 2 ? WHITE : RED, 3), taper: (d0 - 0.3) / d0 })
    }
    out.push(
      ...[0.5, 0.7].flatMap((f, i) => [lying('Dish antenna', 1.6, 0.7, L(1, 0.8 + h * f, 0), WHITE, GALV, 10), lying('Dish antenna', 1.6, 0.7, L(-0.6, 0.8 + h * f - 2, 0.6), WHITE, GALV, 10, 120 + i * 60)]),
      ...[0, 120, 240].map((r) => { const [x, z] = turn(0, 0.7, r); return box('Panel antenna', [0.5, 2.4, 0.3], L(x, h - 2.6, z), WHITE, WHITE, r) }),
      cyl('Whip', 0.12, 3, L(0, h + 0.8, 0), GALV, GALV, 4), cyl('Beacon', 0.4, 0.4, L(0, h + 3.8, 0), RED, RED, 6),
      box('Equipment shelter', [6, 3.6, 4], L(6, 0, 0), PB.steel, WHITE), box('Door', [1.6, 3, 0.08], L(6, 0, 2.04), BLACK),
    )
    return out
  }) },
  ammocrates: { category: 'Military', label: 'Ammo crates', hint: 'Olive crates stacked on a pallet, with ammo cans and a long crate', make: pf('Ammo crates', (L) => [
    box('Pallet', [4.4, 0.5, 3.6], L(0, 0, 0), PB.wood),
    ...[[-1.05, -0.85], [1.05, -0.85], [-1.05, 0.85], [1.05, 0.85]].map(([x, z]) => ({ ...box('Ammo crate', [2, 1.1, 1.6], L(x, 0.5, z), OLIVE_WOOD, OLIVE_WOOD), bevel: 0.08 })),
    ...[-1.05, 1.05].map((x) => ({ ...box('Ammo crate', [2, 1.1, 1.6], L(x, 1.6, 0), OLIVE_WOOD, OLIVE_WOOD), bevel: 0.08 })),
    { ...box('Ammo crate', [2, 1.1, 1.6], L(0, 2.7, 0), OLIVE_WOOD, OLIVE_WOOD, 90), bevel: 0.08 },
    ...[0.5, -0.8].map((z) => box('Ammo can', [0.6, 0.8, 1.2], L(3, 0, z), OLIVE)), box('Ammo can', [0.6, 0.8, 1.2], L(3, 0.8, -0.1), OLIVE),
    { ...box('Long crate', [5, 1, 1.4], L(0, 0, 3), OLIVE_WOOD, OLIVE_WOOD), bevel: 0.08 },
  ]) },
  camonet: { category: 'Military', label: 'Camo net canopy', hint: 'A camouflage net over poles to hide a vehicle or a position', ...pfp('Camo net', [num('w', 'Length', 8, 30, 14), num('d', 'Width', 6, 24, 10), num('h', 'Height', 4, 8, 5.5, 0.5)], (L, p) => {
    const w = +p.w, d = +p.d, h = +p.h
    return [
      ...posts(L, w - 1, d - 1, h, PB.wood, 0.3), ...[-w / 2 + 1, w / 2 - 1].map((x) => box('Ridge pole', [0.3, h + 1.2, 0.3], L(x, 0, 0), PB.wood)),
      { ...box('Camo net', [w, 1.4, d], L(0, h, 0), CAMO, CAMO), kind: 'roof' },
      ...[-1, 1].map((s) => box('Net skirt', [w, 1.6, 0.1], L(0, h - 1.6, s * d / 2), CAMO, CAMO)),
      ...[-1, 1].map((s) => box('Net skirt', [0.1, 1.6, d], L(s * w / 2, h - 1.6, 0), CAMO, CAMO)),
    ]
  }) },
  armytent: { category: 'Military', label: 'Army tent', hint: 'A canvas ridge tent with a door at one end', ...pfp('Army tent', [num('w', 'Length', 8, 30, 14), num('d', 'Width', 6, 16, 9)], (L, p) => {
    const w = +p.w, d = +p.d
    return [
      box('Tent walls', [w, 2.6, d], L(0, 0, 0), CANVAS, CANVAS),
      { ...box('Tent roof', [w + 0.4, 2.8, d + 0.6], L(0, 2.6, 0), CANVAS, CANVAS), kind: 'roof' },
      box('Tent door', [0.1, 2.4, 2.4], L(w / 2 + 0.05, 0, 0), BLACK),
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box('Tent peg', [0.3, 0.4, 0.3], L(a * (w / 2 + 0.8), 0, b * (d / 2 + 1.2)), PB.wood)),
    ]
  }) },
  barracks: { category: 'Military', label: 'Barracks hut', hint: 'A long raised hut with a tin roof, windows and steps', make: pf('Barracks', (L) => [
    ...[-10, -3.3, 3.3, 10].flatMap((x) => [-4, 4].map((z) => box('Pier', [1, 0.8, 1], L(x, 0, z), PB.concrete))),
    box('Barracks', [24, 5, 10], L(0, 0.8, 0), PB.planks, PB.planks),
    { ...box('Roof', [25, 3, 11.4], L(0, 5.8, 0), PB.corrugated, PB.corrugated), kind: 'roof' },
    ...[-8, -4, 0, 4, 8].flatMap((x) => [-1, 1].map((s) => box('Window', [2, 1.6, 0.1], L(x, 3, s * 5.03), GLASS))),
    box('Door', [0.1, 4, 2.4], L(12.03, 0.8, 0), PB.wood), stairs('Steps', [3, 0.8, 1.6], L(12.8, 0, 0), PB.wood, PB.wood, 90, 2),
    cyl('Stove pipe', 0.5, 2.6, L(-6, 7.4, 2), BLACK, BLACK, 8),
  ]) },
  flagpole: { category: 'Military', label: 'Flag pole', hint: 'A tall pole on a plinth with a flag', ...pfp('Flag pole', [num('h', 'Height', 8, 30, 18), sel('color', 'Flag', [['red', 'Red'], ['blue', 'Blue'], ['green', 'Green'], ['yellow', 'Yellow'], ['white', 'White'], ['black', 'Black'], ['olive', 'Olive']], 'red')], (L, p) => {
    const h = +p.h, flag = T(FLAG, p.color, RED)
    return [
      { ...cyl('Flag base', 2.4, 0.6, L(0, 0, 0), PB.concrete, PB.concrete, 8), taper: 0.8 },
      { ...cyl('Flag pole', 0.35, h, L(0, 0.6, 0), GALV, GALV, 8), taper: 0.6 }, cyl('Finial', 0.5, 0.4, L(0, h + 0.6, 0), FLAG.yellow, FLAG.yellow, 8),
      box('Flag', [5, 3.2, 0.08], L(2.6, h - 3, 0), flag, flag, 0, 5),
    ]
  }) },
  searchlight: { category: 'Military', label: 'Searchlight', hint: 'A big lamp drum on a tripod', make: pf('Searchlight', (L) => [
    ...[0, 120, 240].flatMap((r) => { const [x, z] = turn(0, 1.6, r); return strut(L, 'Tripod leg', [x, 0, z], [0, 2.6, 0], 0.2, OLIVE_DARK) }),
    cyl('Turntable', 1, 0.3, L(0, 2.6, 0), OLIVE_DARK, OLIVE_DARK, 10),
    ...[-1.05, 1.05].map((x) => box('Yoke', [0.2, 1.4, 0.4], L(x, 2.9, 0), OLIVE_DARK)),
    lying('Lamp drum', 1.8, 2, L(0, 3, 0), LAMP, OLIVE, 12, 90),
  ]) },
  fieldgun: { category: 'Military', label: 'Field gun', hint: 'A towed artillery piece with a shield and split trails', make: pf('Field gun', (L) => [
    ...[-2, 2].map((x) => lying('Gun wheel', 2.6, 0.45, L(x, 0, 0), OLIVE_DARK, PB.tire, 12)), lying('Axle', 0.3, 4, L(0, 1.15, 0), OLIVE_DARK, OLIVE_DARK, 6),
    box('Gun shield', [3.6, 2.4, 0.2], L(0, 0.8, 0.8), OLIVE), box('Cradle', [0.9, 0.8, 3], L(0, 1.4, 0.2), OLIVE),
    lying('Barrel', 0.45, 6.5, L(0, 1.8, 4.2), OLIVE_DARK, OLIVE_DARK, 10, 90), lying('Muzzle brake', 0.7, 0.7, L(0, 1.67, 7.5), OLIVE_DARK, OLIVE_DARK, 10, 90),
    ...strut(L, 'Trail', [-0.3, 1.1, -0.4], [-1.2, 0, -6], 0.35, OLIVE), ...strut(L, 'Trail', [0.3, 1.1, -0.4], [1.2, 0, -6], 0.35, OLIVE),
  ]) },
}

// ---------------- construction ----------------

const PILE: Record<string, Tex> = { dirt: DIRT, sand: { gen: 'sand', tweak: { color: '#c9ad78', accent: '#a08655', scale: 6, seed: 654 } }, gravel: { gen: 'gravel', tweak: { seed: 655 } }, rubble: RUBBLE }
const BANNER: Record<string, Tex> = { green: solid('#2f6a3a', '#1d4a26', 656), blue: solid('#2a4f8a', '#1a3460', 657), orange: ORANGE }
const SKIP: Record<string, Tex> = { yellow: SITE_YELLOW, blue: paint('#2f5f9a', 658, 0.35), green: paint('#3f6a3a', 659, 0.35), red: paint('#a8302a', 660, 0.35) }
const CABIN: Record<string, Tex> = { white: paint('#dcdcd6', 661, 0.15, 4), blue: paint('#2f5f9a', 662, 0.15, 4), green: paint('#3f6a3a', 663, 0.15, 4), yellow: SITE_YELLOW }

const ibeam = (L: Lf, len: number, x: number, y: number, z: number, tex: Tex): Part[] => [
  box('Girder flange', [1, 0.15, len], L(x, y, z), tex), box('Girder web', [0.15, 0.9, len], L(x, y + 0.15, z), tex), box('Girder flange', [1, 0.15, len], L(x, y + 1.05, z), tex),
]
const trafficBarrel = (L: Lf, x: number, z: number): Part[] => [
  cyl('Barrel base', 1.6, 0.2, L(x, 0, z), BLACK, BLACK, 8),
  ...[0, 1, 2, 3].map((i) => ({ ...cyl('Traffic barrel', 1.3 - i * 0.05, 0.45, L(x, 0.2 + i * 0.45, z), i % 2 ? WHITE : ORANGE, i % 2 ? WHITE : ORANGE, 8), taper: (1.25 - i * 0.05) / (1.3 - i * 0.05) })),
  cyl('Barrel lid', 1.1, 0.1, L(x, 2, z), ORANGE, ORANGE, 8),
]
const sawhorse = (L: Lf): Part[] => [
  ...[-2, 2].flatMap((x) => [...strut(L, 'Barricade leg', [x, 0, -0.8], [x, 2.8, 0], 0.25, WHITE), ...strut(L, 'Barricade leg', [x, 0, 0.8], [x, 2.8, 0], 0.25, WHITE)]),
  box('Barricade board', [5.4, 0.6, 0.12], L(0, 2.1, 0.3), ORANGE_WHITE, ORANGE_WHITE, 0, 3),
  box('Barricade board', [5.4, 0.6, 0.12], L(0, 1.1, 0.6), ORANGE_WHITE, ORANGE_WHITE, 0, 3),
]
/** A portable site cabin, door on +Z at doorX. */
const cabin = (L: Lf, tex: Tex, y: number, doorX: number): Part[] => [
  box('Site cabin', [16, 5.4, 6], L(0, y + 0.4, 0), PB.steel, tex),
  ...[-5.5, -1.5, 2.5, 6].filter((x) => Math.abs(x - doorX) > 2).map((x) => box('Window', [2.4, 1.6, 0.1], L(x, y + 3, 3.03), GLASS)),
  box('Door', [2, 4.2, 0.1], L(doorX, y + 0.5, 3.03), PB.steel),
]

const CONSTRUCTION: Record<string, PrefabDef & { category: string }> = {
  towercrane: { category: 'Construction', label: 'Tower crane', hint: 'A lattice tower crane with jib, counterweight and a hook', ...pfp('Tower crane', [num('h', 'Height', 20, 80, 40, 2), num('jib', 'Jib length', 16, 60, 34, 2)], (L, p) => {
    const h = +p.h, j = +p.jib, top = h + 1.6, hz = j * 0.55
    return [
      box('Crane base', [8, 1.6, 8], L(0, 0, 0), PB.concrete),
      box('Crane mast', [2.4, h - 1.6, 2.4], L(0, 1.6, 0), LATTICE, LATTICE, 0, 2.4),
      box('Slewing unit', [3, 1.6, 3], L(0, h, 0), SITE_YELLOW), box('Crane cab', [2.2, 2.4, 2.6], L(2.4, h - 0.6, 1.4), SITE_YELLOW, GLASS),
      box('Jib', [2, 1.6, j], L(0, top, 1.5 + j / 2), LATTICE, LATTICE, 0, 2), box('Counter jib', [2, 1.2, 11], L(0, top, -7), LATTICE, LATTICE, 0, 2),
      box('Counterweight', [3, 3, 3], L(0, top - 1.4, -11), PB.concrete),
      box('Tower head', [1.2, 7, 1.2], L(0, top, 0), SITE_YELLOW),
      ...strut(L, 'Pendant', [0, top + 7, 0.6], [0, top + 1.6, j * 0.7], 0.25, SITE_YELLOW),
      ...strut(L, 'Pendant', [0, top + 7, -0.6], [0, top + 1.2, -11], 0.25, SITE_YELLOW),
      box('Trolley', [2.2, 0.8, 2], L(0, top - 0.8, hz), SITE_YELLOW), box('Hoist cable', [0.12, 10, 0.12], L(0, top - 10.8, hz), BLACK),
      { ...box('Hook block', [1, 1.4, 0.6], L(0, top - 12.2, hz), SITE_YELLOW), bevel: 0.1 },
    ]
  }) },
  excavator: { category: 'Construction', label: 'Excavator', hint: 'A tracked digger with its boom out and bucket down', make: pf('Excavator', (L) => [
    ...[-2.5, 2.5].map((x) => ({ ...box('Track', [1.6, 1.5, 8.4], L(x, 0, 0), TRACK, TRACK), bevel: 0.6 })),
    box('Undercarriage', [3.4, 1, 5], L(0, 0.5, 0), BLACK), cyl('Slewing ring', 3.6, 0.4, L(0, 1.5, 0), BLACK, BLACK, 12),
    { ...box('House', [5.2, 2.6, 6], L(0.2, 1.9, -0.6), SITE_YELLOW), bevel: 0.25 },
    { ...box('Counterweight', [5.2, 2, 1.6], L(0.2, 1.9, -4.2), SITE_YELLOW), bevel: 0.4 },
    { ...box('Cab', [2.2, 3, 2.6], L(-1.4, 4.5, 1), SITE_YELLOW, GLASS), bevel: 0.15 },
    cyl('Exhaust', 0.3, 1.4, L(1.6, 4.5, -2.6), BLACK, BLACK, 6),
    ...strut(L, 'Boom', [0.9, 3.6, 2], [0.9, 8.6, 6.5], 1, SITE_YELLOW, 0.9),
    ...strut(L, 'Stick', [0.9, 8.4, 6.6], [0.9, 2.2, 8.6], 0.8, SITE_YELLOW, 0.7),
    { ...box('Bucket', [2.4, 1.8, 1.8], L(0.9, 0.3, 8.8), SITE_YELLOW, BLACK), bevel: 0.25 }, box('Bucket teeth', [2.4, 0.3, 0.5], L(0.9, 0, 9.6), BLACK),
  ]) },
  bulldozer: { category: 'Construction', label: 'Bulldozer', hint: 'A tracked dozer with a front blade and a rear ripper', make: pf('Bulldozer', (L) => [
    ...[-2.6, 2.6].map((x) => ({ ...box('Track', [1.6, 2, 8], L(x, 0, 0), TRACK, TRACK), bevel: 0.7 })),
    { ...box('Body', [3.8, 2.2, 6.4], L(0, 0.9, -0.6), SITE_YELLOW), bevel: 0.2 },
    { ...box('Engine hood', [3.2, 1.4, 3], L(0, 3.1, 1.2), SITE_YELLOW), bevel: 0.2 }, cyl('Exhaust', 0.35, 1.6, L(1, 4.5, 2), BLACK, BLACK, 8),
    { ...box('Cab', [3.2, 3.2, 2.8], L(0, 3.1, -2.2), SITE_YELLOW, GLASS), bevel: 0.15 }, box('Cab roof', [3.6, 0.3, 3.2], L(0, 6.3, -2.2), SITE_YELLOW),
    ...[-2.6, 2.6].map((x) => box('Push arm', [0.5, 0.7, 3.8], L(x, 1, 3.6), SITE_YELLOW)),
    { ...box('Blade', [7.6, 2.8, 0.6], L(0, 0.2, 5.6), SITE_YELLOW, SITE_YELLOW), bevel: 0.15 }, box('Cutting edge', [7.6, 0.3, 0.8], L(0, 0, 5.8), BLACK),
    box('Ripper frame', [3, 0.6, 1.2], L(0, 1.8, -4.2), BLACK), ...strut(L, 'Ripper', [0, 2.2, -4], [0, 0, -5.2], 0.5, BLACK),
  ]) },
  dumptruck: { category: 'Construction', label: 'Dump truck', hint: 'A six-wheeled tipper loaded with dirt', make: pf('Dump truck', (L) => [
    box('Chassis', [3.6, 0.9, 18], L(0, 1, 0.5), BLACK),
    { ...box('Cab', [5, 3.8, 4], L(0, 1.4, 7.4), ORANGE), bevel: 0.35 }, box('Cab glass', [4.6, 1.4, 0.1], L(0, 3.4, 9.42), GLASS), box('Bumper', [5, 0.7, 0.4], L(0, 1, 9.6), BLACK),
    { ...box('Dump bed', [5.6, 3.2, 11.6], L(0, 1.9, -2.4), DIRT, SITE_YELLOW), bevel: 0.2 },
    ...wheels(L, 4.8, [-6.2, -3.4, 7.6], 2.2, 0.8),
  ]) },
  roller: { category: 'Construction', label: 'Road roller', hint: 'A ride-on roller with a steel drum and a canopy', make: pf('Road roller', (L) => [
    lying('Roller drum', 3.4, 5, L(0, 0, 3.8), SITE_YELLOW, PB.steel, 16),
    box('Drum frame', [5.6, 1, 3.8], L(0, 3.2, 3.8), SITE_YELLOW), ...[-2.75, 2.75].map((x) => box('Frame side', [0.3, 2.6, 2.4], L(x, 0.9, 3.8), SITE_YELLOW)),
    { ...box('Body', [4, 2.4, 5.6], L(0, 1, -1.8), SITE_YELLOW), bevel: 0.3 }, box('Seat', [1.4, 1, 1.4], L(0, 3.4, -1.4), BLACK),
    ...[-1.8, 1.8].flatMap((x) => [-0.4, -3.2].map((z) => box('ROPS post', [0.25, 3.8, 0.25], L(x, 3.4, z), BLACK))), box('Canopy', [4.2, 0.3, 3.4], L(0, 7.2, -1.8), SITE_YELLOW),
    ...wheels(L, 4.4, [-3.2], 2.6, 1.1),
  ]) },
  rebar: { category: 'Construction', label: 'Rebar bundles', hint: 'Bundles of reinforcing bar on timbers, with loose bars', make: pf('Rebar', (L) => [
    ...[-4, 4].map((x) => box('Timber', [0.8, 0.6, 5], L(x, 0, 0), PB.wood)),
    ...[-1.5, 0, 1.5].map((z) => lying('Rebar bundle', 1.3, 12, L(0, 0.6, z), PB.rusty, PB.rusty, 8)),
    ...[-0.75, 0.75].map((z) => lying('Rebar bundle', 1.3, 12.6, L(0.4, 1.73, z), PB.rusty, PB.rusty, 8)),
    ...[0, 1, 2, 3].map((i) => lying('Rebar', 0.2, 11 + i * 0.5, L(-0.5 + i * 0.3, 0, 3 + i * 0.3), PB.rusty, PB.rusty, 4)),
  ]) },
  girders: { category: 'Construction', label: 'Steel girders', hint: 'Two layers of I-beams on timber dunnage', make: pf('Girders', (L) => [
    ...[-5, 5].map((z) => box('Dunnage', [5.6, 0.5, 0.6], L(0, 0, z), PB.wood)),
    ...[-1.8, -0.6, 0.6, 1.8].flatMap((x) => ibeam(L, 14, x, 0.5, 0, PRIMER)),
    ...[-4, 4].map((z) => box('Dunnage', [5.6, 0.4, 0.6], L(0, 1.7, z), PB.wood)),
    ...[-1.2, 0, 1.2].flatMap((x) => ibeam(L, 13, x, 2.1, 0.4, PRIMER)),
  ]) },
  concretepipes: { category: 'Construction', label: 'Concrete pipes', hint: 'Big drain pipes stacked in a pyramid with chocks', ...pfp('Concrete pipes', [num('layers', 'Layers', 1, 3, 2)], (L, p) => [
    ...[...Array(+p.layers)].flatMap((_, l) => [...Array(3 - l)].map((_, i) => lying('Concrete pipe', 3.2, 5, L((i - (2 - l) / 2) * 3.3, l * 2.86, 0), BLACK, PB.concrete, 12, 90))),
    ...[-5.4, 5.4].map((x) => box('Chock', [0.8, 0.7, 4], L(x, 0, 0), PB.wood)),
  ]) },
  sitecabin: { category: 'Construction', label: 'Site cabin', hint: 'A portable site office; stack two with stairs and a balcony', ...pfp('Site cabin', [num('floors', 'Floors', 1, 2, 1), sel('color', 'Color', [['white', 'White'], ['blue', 'Blue'], ['green', 'Green'], ['yellow', 'Yellow']], 'white')], (L, p) => {
    const t = T(CABIN, p.color, CABIN.white)
    const out: Part[] = [...[-7, 7].map((x) => box('Skid', [0.6, 0.4, 6], L(x, 0, 0), PB.steel)), ...cabin(L, t, 0, 6), box('Step', [2.4, 0.4, 1], L(6, 0, 3.5), PB.diamond)]
    if (+p.floors > 1) out.push(
      ...cabin(L, t, 5.4, 1),
      box('Balcony', [16, 0.3, 1.8], L(0, 5.5, 3.9), PB.diamond, PB.steel), box('Landing', [2.4, 0.3, 2.4], L(1, 5.5, 6), PB.diamond, PB.steel),
      stairs('Cabin stairs', [2.2, 5.8, 7.6], L(-4, 0, 6), PB.diamond, PB.steel, 270, 8),
      box('Railing', [7.8, 1, 0.12], L(-4.1, 5.8, 4.74), PB.steel), box('Railing', [5.8, 1, 0.12], L(5.1, 5.8, 4.74), PB.steel),
    )
    return out
  }) },
  sitefence: { category: 'Construction', label: 'Site fence', hint: 'Mesh fence panels on feet, with an optional banner', ...pfp('Site fence', [num('len', 'Length', 6, 60, 24, 2), sel('banner', 'Banner', [['green', 'Green'], ['blue', 'Blue'], ['orange', 'Orange'], ['none', 'None']], 'green')], (L, p) => {
    const len = +p.len, n = Math.max(1, Math.round(len / 4.6)), pw = len / n
    return [
      ...[...Array(n)].map((_, i) => box('Fence panel', [pw - 0.1, 3.8, 0.08], L(-len / 2 + pw * (i + 0.5), 0.5, 0), GALV, MESH, 0, 4)),
      ...[...Array(n + 1)].flatMap((_, i) => [box('Fence foot', [0.6, 0.5, 1.6], L(-len / 2 + pw * i, 0, 0), ORANGE), box('Fence post', [0.15, 4, 0.15], L(-len / 2 + pw * i, 0.5, 0), GALV)]),
      ...(p.banner === 'none' ? [] : [box('Banner', [Math.max(2, len * 0.8), 2, 0.05], L(0, 1.6, 0.08), T(BANNER, p.banner, BANNER.green), T(BANNER, p.banner, BANNER.green), 0, 4)]),
    ]
  }) },
  trafficbarrels: { category: 'Construction', label: 'Traffic barrels', hint: 'Striped road-work drums in a row', ...pfp('Traffic barrels', [num('n', 'Barrels', 1, 8, 4)], (L, p) => [...Array(+p.n)].flatMap((_, i) => trafficBarrel(L, (i - (+p.n - 1) / 2) * 2, (i % 2) * 0.5))) },
  roadplates: { category: 'Construction', label: 'Road plates', hint: 'Steel plates over a road dig, with patched edges', ...pfp('Road plates', [num('n', 'Plates', 1, 4, 2)], (L, p) => [...Array(+p.n)].flatMap((_, i) => {
    const z = (i - (+p.n - 1) / 2) * 5.8, h = 0.2 + (i % 2) * 0.04, x = (i % 2) * 0.3
    return [box('Road plate', [8, h, 6], L(x, 0, z), PLATE, PLATE, 0, 3), ramp('Patch', [6, h, 0.8], L(x + 4.4, 0, z), PB.asphalt, PB.asphalt, 90), ramp('Patch', [6, h, 0.8], L(x - 4.4, 0, z), PB.asphalt, PB.asphalt, 270)]
  })) },
  dirtpile: { category: 'Construction', label: 'Dirt pile', hint: 'A heap of dirt, sand, gravel or rubble', ...pfp('Dirt pile', [num('size', 'Size', 0.5, 3, 1, 0.1), sel('kind', 'Material', [['dirt', 'Dirt'], ['sand', 'Sand'], ['gravel', 'Gravel'], ['rubble', 'Rubble']], 'dirt')], (L, p) => {
    const s = +p.size, t = T(PILE, p.kind, DIRT)
    return [
      { ...cyl('Pile', 14 * s, 2 * s, L(0, 0, 0), t, t, 9, 10), taper: 0.72 },
      { ...cyl('Pile', 10 * s, 1.8 * s, L(0.6 * s, 2 * s, -0.4 * s), t, t, 9, 30), taper: 0.6 },
      { ...cyl('Pile', 6 * s, 1.4 * s, L(0.9 * s, 3.8 * s, -0.2 * s), t, t, 8, 50), taper: 0.3 },
    ]
  }) },
  trench: { category: 'Construction', label: 'Trench line', hint: 'A planked trench between earth berms, topped with sandbags', ...pfp('Trench', [num('len', 'Length', 8, 60, 20, 2)], (L, p) => {
    const len = +p.len
    return [
      box('Duckboards', [2.8, 0.3, len], L(0, 0, 0), PB.planks, PB.wood),
      ...[-1, 1].flatMap((s) => [
        box('Revetment', [0.4, 3.2, len], L(s * 1.7, 0, 0), PB.planks, PB.wood),
        ramp('Earth berm', [len, 3.4, 5], L(s * 4.4, 0, 0), DIRT, DIRT, s > 0 ? 90 : 270),
        sandbags('Sandbags', [1.6, 0.9, len], L(s * 2.6, 2.9, 0)),
      ]),
    ]
  }) },
  scaffoldtower: { category: 'Construction', label: 'Mobile scaffold', hint: 'A narrow scaffold tower on casters with a guarded top deck', ...pfp('Mobile scaffold', [num('levels', 'Levels', 1, 4, 2)], (L, p) => {
    const n = +p.levels, lv = 4.4, top = 0.8 + n * lv, w = 4, d = 3
    return [
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].flatMap(([a, b]) => [cyl('Caster', 0.7, 0.8, L((a * w) / 2, 0, (b * d) / 2), BLACK, BLACK, 8), box('Scaffold post', [0.2, top + 1.4, 0.2], L((a * w) / 2, 0.8, (b * d) / 2), GALV)]),
      ...[...Array(n)].flatMap((_, i) => { const y = 0.8 + (i + 0.5) * lv; return [box('Ledger', [w, 0.15, 0.15], L(0, y, -d / 2), GALV), box('Ledger', [w, 0.15, 0.15], L(0, y, d / 2), GALV), box('Ledger', [0.15, 0.15, d], L(-w / 2, y, 0), GALV), box('Ledger', [0.15, 0.15, d], L(w / 2, y, 0), GALV)] }),
      box('Scaffold deck', [w, 0.25, d], L(0, top - 0.25, 0), PB.plywood, PB.plywood),
      ...[1, 2].flatMap((r) => [box('Guardrail', [w, 0.12, 0.12], L(0, top + r, -d / 2), GALV), box('Guardrail', [w, 0.12, 0.12], L(0, top + r, d / 2), GALV)]),
      stairs('Ladder', [1.2, n * lv, 0.6], L(w / 2 - 0.9, 0.8, -d / 2 + 0.4), GALV, GALV, 0, Math.round((n * lv) / 0.7)),
    ]
  }) },
  scaffoldwall: { category: 'Construction', label: 'Scaffold facade', hint: 'Scaffolding along a wall with plank decks, safety netting and stairs to the first lift', ...pfp('Scaffold facade', [num('len', 'Length', 6, 40, 20), num('levels', 'Lifts', 1, 6, 3), yesNo('net', 'Safety netting', 'yes')], (L, p) => {
    const len = +p.len, n = +p.levels, lv = 4.4, nb = Math.max(1, Math.round(len / 5)), d = 2.6, H = n * lv + 2.2
    return [
      ...[-1, 1].map((s) => box('Sole board', [len, 0.15, 0.8], L(0, 0, (s * d) / 2), PB.wood)),
      ...[...Array(nb + 1)].flatMap((_, i) => [-1, 1].map((s) => box('Standard', [0.2, H, 0.2], L(-len / 2 + (i * len) / nb, 0.15, (s * d) / 2), GALV))),
      ...[...Array(n)].flatMap((_, k) => { const y = (k + 1) * lv; return [
        box('Scaffold deck', [len, 0.2, d], L(0, y - 0.2, 0), PB.planks, PB.wood), box('Toe board', [len, 0.5, 0.06], L(0, y, d / 2), PB.planks),
        box('Guardrail', [len, 0.12, 0.12], L(0, y + 2, d / 2), GALV), box('Guardrail', [len, 0.12, 0.12], L(0, y + 1, d / 2), GALV),
      ] }),
      ...(p.net === 'yes' ? [box('Safety netting', [len, H, 0.05], L(0, 0.15, d / 2 + 0.2), NETTING, NETTING, 0, 4)] : []),
      stairs('Scaffold stairs', [2, lv, 6], L(-len / 2 - 3, 0, 0), PB.diamond, GALV, 270, 6),
    ]
  }) },
  skip: { category: 'Construction', label: 'Skip bin', hint: 'A builder skip with sloped ends, empty or full of rubble', ...pfp('Skip', [sel('color', 'Color', [['yellow', 'Yellow'], ['blue', 'Blue'], ['green', 'Green'], ['red', 'Red']], 'yellow'), yesNo('full', 'Full of rubble', 'yes')], (L, p) => {
    const t = T(SKIP, p.color, SITE_YELLOW)
    return [
      box('Skip', [6, 2.6, 3.6], L(0, 0, 0), p.full === 'yes' ? RUBBLE : BLACK, t),
      ...strut(L, 'Skip end', [3, 0, 0], [4.4, 2.3, 0], 0.3, t, 3.6), ...strut(L, 'Skip end', [-3, 0, 0], [-4.4, 2.3, 0], 0.3, t, 3.6),
      ...(p.full === 'yes' ? [box('Rubble', [8, 0.3, 3.4], L(0, 2.4, 0), RUBBLE, RUBBLE)] : []),
      ...[-2.4, 2.4].map((x) => box('Lifting lug', [0.4, 0.6, 4], L(x, 1.6, 0), t)),
    ]
  }) },
  cementbags: { category: 'Construction', label: 'Cement bags', hint: 'Bags of cement crossed on a pallet, and a wrapped pallet', make: pf('Cement bags', (L) => {
    const out: Part[] = [box('Pallet', [4, 0.5, 3.4], L(-2.4, 0, 0), PB.wood), box('Pallet', [4, 0.5, 3.4], L(2.4, 0, 0), PB.wood)]
    for (let l = 0; l < 4; l++) for (let i = 0; i < 2; i++) {
      const across = l % 2 === 1
      out.push({ ...box('Cement bag', across ? [1.8, 0.5, 3.2] : [3.8, 0.5, 1.6], L(-2.4 + (across ? (i - 0.5) * 1.9 : 0), 0.5 + l * 0.5, across ? 0 : (i - 0.5) * 1.65), PAPER, PAPER), bevel: 0.15 })
    }
    out.push(box('Wrapped bags', [3.8, 2, 3.2], L(2.4, 0.5, 0), WRAP, WRAP), { ...box('Cement bag', [1.6, 0.5, 1], L(0.4, 0, 2.6), PAPER, PAPER, 20), bevel: 0.15 })
    return out
  }) },
  brickpallets: { category: 'Construction', label: 'Brick pallets', hint: 'Four pallets of bricks, one half used', make: pf('Brick pallets', (L) => [[-2.3, -2], [2.3, -2], [-2.3, 2], [2.3, 2]].flatMap(([x, z], i) => [
    box('Pallet', [4, 0.5, 3.6], L(x, 0, z), PB.wood), box('Bricks', [3.6, i === 3 ? 1 : 2.4, 3.2], L(x, 0.5, z), PB.brick, PB.brick, 0, 2),
  ])) },
  lighttower: { category: 'Construction', label: 'Light tower', hint: 'A trailer with a tall mast of floodlights', make: pf('Light tower', (L) => [
    { ...box('Trailer', [3.2, 2.4, 6], L(0, 1, 0), SITE_YELLOW, SITE_YELLOW), bevel: 0.2 }, ...wheels(L, 3.6, [0.8], 1.6, 0.5),
    box('Drawbar', [0.4, 0.4, 3], L(0, 1, 4.4), BLACK), box('Jack stand', [0.3, 1, 0.3], L(0, 0, 5.6), BLACK),
    ...[-1, 1].flatMap((s) => [box('Outrigger', [2, 0.3, 0.3], L(s * 2.4, 1.2, -2.4), BLACK), box('Outrigger foot', [0.5, 1.2, 0.5], L(s * 3.3, 0, -2.4), BLACK)]),
    box('Light mast', [0.5, 14, 0.5], L(0, 3.4, -2.2), GALV), box('Lamp bar', [4.4, 0.4, 0.4], L(0, 17.2, -2.2), GALV),
    ...[-1.6, -0.55, 0.55, 1.6].flatMap((x) => [16.2, 17.7].map((y) => box('Floodlight', [0.9, 0.8, 0.5], L(x, y, -1.8), LAMP))),
  ]) },
  barricade: { category: 'Construction', label: 'Road barricades', hint: 'Striped sawhorse barricades', ...pfp('Barricades', [num('n', 'Barricades', 1, 6, 2)], (L, p) => [...Array(+p.n)].flatMap((_, i) => at(L, (i - (+p.n - 1) / 2) * 6, 0, 0, sawhorse))) },
  wheelbarrow: { category: 'Construction', label: 'Wheelbarrow', hint: 'A barrow full of dirt', make: pf('Wheelbarrow', (L) => [
    lying('Wheel', 1.2, 0.35, L(0, 0, 1.8), PB.tire, PB.tire, 10),
    { ...box('Tray', [2.2, 1, 2.6], L(0, 0.8, 0.4), DIRT, paint('#3f6a3a', 664, 0.3)), bevel: 0.35 },
    ...[-0.7, 0.7].map((x) => box('Handle', [0.15, 0.15, 4.4], L(x, 1, -0.4), PB.wood)), ...[-0.7, 0.7].map((x) => box('Leg', [0.15, 0.9, 0.15], L(x, 0, -1), BLACK)),
  ]) },
  framehouse: { category: 'Construction', label: 'House frame', hint: 'A timber-framed house going up: studs, a doorway, roof trusses and some sheathing', make: pf('House frame', (L) => {
    const W = 16, D = 12, H = 6, y0 = 0.8
    const out: Part[] = [
      ...[-7.5, 0, 7.5].flatMap((x) => [-5.5, 5.5].map((z) => box('Pier', [0.8, 0.5, 0.8], L(x, 0, z), PB.concrete))),
      box('Subfloor', [W, 0.3, D], L(0, 0.5, 0), OSB, PB.wood),
    ]
    // Studs every 2 units; the front leaves a doorway 4 wide in the middle.
    for (const x of [-7.85, -6, -4, -2.15, 0, 2.15, 4, 6, 7.85]) {
      if (x !== 0) out.push(box('Stud', [0.3, H, 0.5], L(x, y0, D / 2 - 0.25), PB.wood))
      out.push(box('Stud', [0.3, H, 0.5], L(x, y0, -D / 2 + 0.25), PB.wood))
    }
    for (let z = -D / 2 + 2; z <= D / 2 - 2; z += 2) for (const s of [-1, 1]) out.push(box('Stud', [0.5, H, 0.3], L(s * (W / 2 - 0.25), y0, z), PB.wood))
    out.push(
      box('Top plate', [W, 0.3, 0.5], L(0, y0 + H, D / 2 - 0.25), PB.wood), box('Top plate', [W, 0.3, 0.5], L(0, y0 + H, -D / 2 + 0.25), PB.wood),
      ...[-1, 1].map((s) => box('Top plate', [0.5, 0.3, D], L(s * (W / 2 - 0.25), y0 + H, 0), PB.wood)),
      box('Door header', [4.6, 0.8, 0.5], L(0, y0 + 4.6, D / 2 - 0.25), PB.wood),
      ...[-8, -4, 0, 4, 8].map((x) => ({ ...box('Truss', [0.3, 4, D + 1], L(Math.max(-W / 2 + 0.15, Math.min(W / 2 - 0.15, x)), y0 + H + 0.3, 0), PB.wood), kind: 'roof' as const })),
      box('Ridge board', [W, 0.3, 0.3], L(0, y0 + H + 4, 0), PB.wood),
      box('Sheathing', [W / 2, H, 0.15], L(-W / 4, y0, -D / 2 - 0.08), OSB, OSB),
      ...[0, 1, 2].map((i) => box('Lumber', [10, 0.4, 2], L(0, i * 0.4, D / 2 + 3), PB.wood)),
    )
    return out
  }) },
  steelframe: { category: 'Construction', label: 'Steel frame', hint: 'A steel building skeleton with concrete decks and stair flights up the side', ...pfp('Steel frame', [num('floors', 'Floors', 1, 5, 3), num('bays', 'Bays', 2, 5, 3)], (L, p) => {
    const n = +p.floors, bx = +p.bays, B = 8, W = bx * B, D = 16, fh = 7
    const xs = [...Array(bx + 1)].map((_, i) => -W / 2 + i * B), zs = [-D / 2, 0, D / 2]
    const out: Part[] = [box('Slab', [W + 2, 0.3, D + 2], L(0, 0, 0), PB.concrete)]
    for (const x of xs) for (const z of zs) out.push(box('Column', [0.8, n * fh, 0.8], L(x, 0.3, z), PRIMER))
    for (let f = 1; f <= n; f++) {
      const y = f * fh + 0.3
      out.push(box('Deck', [W, 0.4, D], L(0, y - 0.4, 0), PB.concrete, PB.steel))
      for (const z of zs) out.push(box('Beam', [W, 0.8, 0.5], L(0, y - 1.2, z), PRIMER))
      for (const x of xs) out.push(box('Beam', [0.5, 0.8, D], L(x, y - 1.2, 0), PRIMER))
    }
    out.push(...flights((dx, dy, dz) => L(dx, dy + 0.3, dz), -W / 2 - 3, n, fh, 9, 3, 3, PB.diamond, GALV))
    return out
  }) },
}

// ---------------- industrial ----------------

const PIPE: Record<string, Tex> = { steel: GALV, yellow: paint('#d0a418', 639, 0.2), red: paint('#a8302a', 665, 0.2), rust: PB.rusty }
const JACK = paint('#5a7a9a', 640, 0.2)
const DRUMS = [paint('#2f5f9a', 666, 0.3, 1), paint('#a8302a', 667, 0.3, 1), paint('#3f7a3a', 668, 0.3, 1)]
const WATER_TANK = paint('#8aa0b0', 643, 0.2)
const CRUSH_RED = paint('#a8302a', 645, 0.3)

const transformerBox = (L: Lf): Part[] => [
  box('Pad', [5.2, 0.4, 4.4], L(0, 0, 0), PB.concrete),
  { ...box('Transformer', [4, 3.6, 3], L(0, 0.4, 0), GREEN_BOX), bevel: 0.1 },
  ...[-2.3, 2.3].map((x) => box('Cooling fins', [0.6, 2.6, 2.4], L(x, 0.8, 0), GREEN_BOX, FAN)),
  box('Warning sign', [0.9, 0.9, 0.05], L(0, 2.4, 1.52), HAZARD),
]

const PLANT: Record<string, PrefabDef & { category: string }> = {
  transformer: { category: 'Industrial', label: 'Transformer box', hint: 'A green pad-mounted transformer with cooling fins', make: pf('Transformer', transformerBox) },
  substation: { category: 'Industrial', label: 'Substation', hint: 'A fenced yard with two transformers, a line gantry and a control room', ...pfp('Substation', [num('w', 'Width', 20, 48, 30, 2), num('d', 'Depth', 16, 36, 22, 2)], (L, p) => {
    const w = +p.w, d = +p.d, fh = 5, gx = w / 2 - 6
    return [
      box('Gravel yard', [w, 0.2, d], L(0, 0, 0), PB.gravel, PB.concrete),
      box('Fence', [w, fh, 0.08], L(0, 0, -d / 2), GALV, MESH, 0, 4), ...[-1, 1].map((s) => box('Fence', [0.08, fh, d], L((s * w) / 2, 0, 0), GALV, MESH, 0, 4)),
      box('Fence', [w - 9, fh, 0.08], L(-4.5, 0, d / 2), GALV, MESH, 0, 4), box('Fence', [3, fh, 0.08], L(w / 2 - 1.5, 0, d / 2), GALV, MESH, 0, 4),
      ...[gx - 3, gx + 3].map((x) => box('Gate post', [0.3, fh + 0.4, 0.3], L(x, 0, d / 2), GALV)),
      lying('Razor wire', 1, w, L(0, fh, -d / 2), COIL, COIL, 6),
      ...[-w / 4, w / 4].flatMap((x) => at(L, x, -d / 2 + 5, 0, (M) => [
        box('Pad', [7, 0.5, 6], M(0, 0.2, 0), PB.concrete),
        { ...box('Power transformer', [5, 5, 4], M(0, 0.7, 0), GREY_BOX), bevel: 0.15 },
        ...[-2.9, 2.9].map((x2) => box('Radiator', [0.8, 4, 3.6], M(x2, 0.9, 0), GREY_BOX, FAN)),
        ...[-1.4, 0, 1.4].flatMap((x2) => [cyl('Bushing', 0.3, 2.6, M(x2, 5.7, 0), PORCELAIN, PORCELAIN, 6), ...insulator(M, x2, 5.7, 0, 5)]),
      ])),
      ...[-1, 1].flatMap((s) => [box('Gantry column', [0.8, 12, 0.8], L(s * (w / 2 - 3), 0.2, 0.5), GALV)]),
      box('Gantry beam', [w - 5, 0.8, 0.8], L(0, 12.2, 0.5), GALV),
      ...[-w / 4, 0, w / 4].flatMap((x) => insulator(L, x, 10.6, 0.5, 4, 0.8)),
      box('Control room', [8, 5, 5], L(-w / 2 + 5.5, 0.2, d / 2 - 4), PB.concrete, PB.cinder), box('Door', [2, 4, 0.1], L(-w / 2 + 7.5, 0.2, d / 2 - 1.45), PB.steel),
    ]
  }) },
  pylon: { category: 'Industrial', label: 'Power pylon', hint: 'A lattice steel pylon with two crossarms and insulator strings', ...pfp('Pylon', [num('h', 'Height', 24, 80, 48, 2)], (L, p) => {
    const h = +p.h, b = 3.4, waist = h * 0.62, t = 1.1
    const half = (y: number) => b + ((t - b) * (y - 0.6)) / (waist - 0.6)
    return [
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].flatMap(([a, c]) => [box('Footing', [1.4, 0.6, 1.4], L(a * b, 0, c * b), PB.concrete), ...strut(L, 'Pylon leg', [a * b, 0.6, c * b], [a * t, waist, c * t], 0.5, GALV)]),
      ...[1, 2].flatMap((k) => { const y = 0.6 + ((waist - 0.6) * k) / 3, s = half(y); return [box('Brace', [2 * s, 0.3, 0.3], L(0, y, -s), GALV), box('Brace', [2 * s, 0.3, 0.3], L(0, y, s), GALV), box('Brace', [0.3, 0.3, 2 * s], L(-s, y, 0), GALV), box('Brace', [0.3, 0.3, 2 * s], L(s, y, 0), GALV)] }),
      box('Pylon body', [2 * t + 0.5, h - waist, 2 * t + 0.5], L(0, waist, 0), GREY_LATTICE, GREY_LATTICE, 0, 2),
      box('Crossarm', [16, 0.8, 1.2], L(0, h * 0.72, 0), GREY_LATTICE, GREY_LATTICE, 0, 2), box('Crossarm', [12, 0.8, 1.2], L(0, h * 0.86, 0), GREY_LATTICE, GREY_LATTICE, 0, 2),
      ...[-7.5, 7.5].flatMap((x) => insulator(L, x, h * 0.72 - 2.6, 0, 6, 0.7)), ...[-5.5, 5.5].flatMap((x) => insulator(L, x, h * 0.86 - 2.6, 0, 6, 0.7)),
      { ...cyl('Peak', (2 * t + 0.5) * Math.SQRT2, 3, L(0, h, 0), GALV, GALV, 4, 45), taper: 0 },
    ]
  }) },
  windturbine: { category: 'Industrial', label: 'Wind turbine', hint: 'A tall white turbine with three blades', ...pfp('Wind turbine', [num('h', 'Hub height', 30, 90, 50, 2)], (L, p) => {
    const h = +p.h, R = h * 0.42, hub: V3 = [0, h + 1.2, 3.4]
    return [
      cyl('Footing', 6, 0.8, L(0, 0, 0), PB.concrete, PB.concrete, 12),
      { ...cyl('Turbine tower', 3.4, h - 0.8, L(0, 0.8, 0), WHITE, WHITE, 12), taper: 0.55 },
      { ...box('Nacelle', [2.6, 2.6, 7], L(0, h, -0.8), WHITE, WHITE), bevel: 0.6 },
      lying('Hub', 2.2, 1.6, L(0, h + 0.1, 3.5), WHITE, WHITE, 12, 90),
      ...[90, 210, 330].flatMap((a) => strut(L, 'Blade', hub, [Math.cos((a * Math.PI) / 180) * R, hub[1] + Math.sin((a * Math.PI) / 180) * R, hub[2]], 0.9, WHITE, 0.35)),
    ]
  }) },
  solarpanels: { category: 'Industrial', label: 'Solar array', hint: 'Rows of tilted solar panels on legs', ...pfp('Solar array', [num('rows', 'Rows', 1, 6, 3), num('len', 'Row length', 6, 40, 16, 2)], (L, p) => {
    const n = +p.rows, len = +p.len
    return [
      ...[...Array(n)].flatMap((_, i) => { const z = (i - (n - 1) / 2) * 6.5; return [
        ...[-len / 2 + 0.6, 0, len / 2 - 0.6].flatMap((x) => [-1.2, 1.2].map((dz) => box('Panel leg', [0.25, 1, 0.25], L(x, 0, z + dz), GALV))),
        ramp('Solar panels', [len, 1.8, 3.6], L(0, 1, z), SOLAR, GALV, 0, 3.6),
      ] }),
      box('Inverter', [1.6, 2.4, 1], L(len / 2 + 1.6, 0, 0), WHITE, PB.steel),
    ]
  }) },
  coolingtower: { category: 'Industrial', label: 'Cooling tower', hint: 'A waisted concrete cooling tower on legs', ...pfp('Cooling tower', [num('size', 'Size', 0.4, 1.5, 1, 0.1)], (L, p) => {
    const s = +p.size
    return [
      ...[...Array(12)].map((_, i) => { const [x, z] = turn(0, 19 * s, i * 30); return box('Tower leg', [1.2 * s, 2.4 * s, 1.2 * s], L(x, 0, z), PB.concrete) }),
      { ...cyl('Cooling tower', 40 * s, 22 * s, L(0, 2.4 * s, 0), PB.concrete, PB.concrete, 24), taper: 0.62 },
      { ...cyl('Cooling tower', 24.8 * s, 13 * s, L(0, 24.4 * s, 0), BLACK, PB.concrete, 24), taper: 1.14 },
    ]
  }) },
  chimney: { category: 'Industrial', label: 'Chimney stack', hint: 'A tall tapered factory chimney, brick or banded red and white', ...pfp('Chimney', [num('h', 'Height', 16, 100, 50, 2), sel('style', 'Style', [['brick', 'Brick'], ['bands', 'Red and white']], 'brick')], (L, p) => {
    const h = +p.h, d0 = Math.max(3, h * 0.11), bands = p.style === 'bands', n = bands ? 7 : 1, seg = (h - 3) / n
    const dAt = (i: number) => d0 * (1 - (0.4 * i) / n)
    return [
      box('Chimney base', [d0 + 2, 3, d0 + 2], L(0, 0, 0), PB.concrete, bands ? PB.concrete : PB.oldBrick),
      ...[...Array(n)].map((_, i) => ({ ...cyl('Chimney', dAt(i), seg, L(0, 3 + i * seg, 0), BLACK, bands ? (i % 2 ? WHITE : RED) : PB.oldBrick, 12), taper: dAt(i + 1) / dAt(i) })),
      cyl('Chimney rim', d0 * 0.6 + 0.6, 0.8, L(0, h, 0), BLACK, bands ? RED : PB.concrete, 12),
      cyl('Beacon', 0.4, 0.5, L(d0 * 0.3, h + 0.8, 0), RED, RED, 6),
    ]
  }) },
  silo: { category: 'Industrial', label: 'Grain silos', hint: 'A row of corrugated silos with cone roofs and a catwalk across', ...pfp('Silos', [num('n', 'Silos', 1, 4, 2), num('h', 'Height', 10, 36, 20)], (L, p) => {
    const n = +p.n, h = +p.h, d = 8, gap = 9
    return [
      box('Silo pad', [n * gap + 2, 0.4, d + 2], L(0, 0, 0), PB.concrete),
      ...[...Array(n)].flatMap((_, i) => { const x = (i - (n - 1) / 2) * gap; return [
        cyl('Silo', d, h, L(x, 0.4, 0), GALV, PB.corrugated, 16), { ...cyl('Silo roof', d + 0.4, 2.6, L(x, h + 0.4, 0), GALV, GALV, 16), taper: 0.12 },
        box('Ladder', [0.7, h + 0.6, 0.15], L(x, 0.4, d / 2 + 0.15), WIRE),
      ] }),
      ...(n > 1 ? [box('Catwalk', [(n - 1) * gap, 0.4, 1.6], L(0, h + 2.6, 0), PB.diamond, GALV), ...[-0.8, 0.8].map((z) => box('Railing', [(n - 1) * gap, 1, 0.1], L(0, h + 3, z), GALV))] : []),
    ]
  }) },
  tankfarm: { category: 'Industrial', label: 'Tank farm', hint: 'Storage tanks in a walled bund with a pipe run between the rows', ...pfp('Tank farm', [num('n', 'Tanks', 2, 6, 4)], (L, p) => {
    const n = +p.n, cols = Math.ceil(n / 2), sp = 13, W = cols * sp + 2, D = 2 * sp + 2
    return [
      box('Bund floor', [W, 0.2, D], L(0, 0, 0), PB.concrete),
      box('Bund wall', [W, 1.8, 0.6], L(0, 0, -D / 2), PB.concrete), ...[-1, 1].map((s) => box('Bund wall', [0.6, 1.8, D], L((s * W) / 2, 0, 0), PB.concrete)),
      ...[-1, 1].map((s) => box('Bund wall', [W / 2 - 1.5, 1.8, 0.6], L(s * (W / 4 + 0.75), 0, D / 2), PB.concrete)),
      ...[...Array(n)].flatMap((_, i) => { const x = (Math.floor(i / 2) - (cols - 1) / 2) * sp, z = ((i % 2) - 0.5) * sp; return [
        cyl('Storage tank', 10, 7, L(x, 0.2, z), WHITE, WHITE, 16), { ...cyl('Tank roof', 10, 1.2, L(x, 7.2, z), WHITE, WHITE, 16), taper: 0.25 },
        box('Ladder', [0.7, 7.4, 0.15], L(x, 0.2, z + (i % 2 ? -5.1 : 5.1)), WIRE),
      ] }),
      ...[-0.7, 0.7].flatMap((z) => [lying('Pipe', 0.9, W - 3, L(0, 0.7, z), GALV, PIPE.yellow, 10)]),
      ...[...Array(cols + 1)].map((_, i) => box('Pipe sleeper', [0.6, 0.6, 2.4], L(-W / 2 + 1.5 + ((W - 3) * i) / cols, 0.2, 0), PB.concrete)),
    ]
  }) },
  pipeline: { category: 'Industrial', label: 'Pipeline', hint: 'A raised pipe on saddles with flanges and handwheel valves', ...pfp('Pipeline', [num('len', 'Length', 8, 80, 32, 2), num('d', 'Pipe width', 0.8, 4, 2, 0.2), sel('color', 'Paint', [['steel', 'Steel'], ['yellow', 'Yellow'], ['red', 'Red'], ['rust', 'Rusty']], 'yellow')], (L, p) => {
    const len = +p.len, d = +p.d, y = 1.2, ns = Math.max(1, Math.round(len / 8)), t = T(PIPE, p.color, GALV), nv = Math.max(1, Math.floor(len / 24))
    const support = (i: number) => -len / 2 + 1 + ((len - 2) * i) / ns
    return [
      lying('Pipe', d, len, L(0, y, 0), t, t, 12),
      ...[...Array(ns + 1)].flatMap((_, i) => [box('Pipe support', [0.8, y + d * 0.3, d + 0.8], L(support(i), 0, 0), PB.concrete), lying('Flange', d * 1.25, 0.4, L(Math.min(support(i) + 0.8, len / 2 - 0.4), y - d * 0.125, 0), t, t, 12)]),
      // Valves halfway between supports, spread along the run.
      ...[...Array(nv)].flatMap((_, i) => { const j = Math.floor(((i + 0.5) * ns) / nv), xv = (support(j) + support(j + 1)) / 2; return [
        box('Valve body', [1.4, d * 1.3, d * 1.3], L(xv, y - d * 0.15, 0), RED), cyl('Valve stem', 0.25, d * 0.6 + 0.6, L(xv, y + d * 1.15, 0), GALV, GALV, 6),
        cyl('Handwheel', d * 0.9 + 0.6, 0.18, L(xv, y + d * 1.75 + 0.6, 0), RED, RED, 12),
      ] }),
    ]
  }) },
  pumpjack: { category: 'Industrial', label: 'Pump jack', hint: 'An oil-well pump with a walking beam and horse head', make: pf('Pump jack', (L) => [
    box('Skid', [3.4, 0.8, 15], L(0, 0, -0.5), PB.steel),
    ...strut(L, 'Samson post', [-1.4, 0.8, -1.4], [-0.3, 8, 0], 0.5, JACK), ...strut(L, 'Samson post', [1.4, 0.8, -1.4], [0.3, 8, 0], 0.5, JACK), ...strut(L, 'Samson post', [0, 0.8, 2.4], [0, 8, 0.3], 0.5, JACK),
    box('Walking beam', [0.9, 1.1, 13], L(0, 8, 0.6), JACK),
    { ...box('Horse head', [1.1, 3.8, 1.6], L(0, 5.6, 7.6), PIPE.yellow), bevel: 0.45 },
    box('Bridle', [0.12, 3.8, 0.12], L(0, 1.8, 8.5), BLACK), cyl('Wellhead', 1, 1.8, L(0, 0, 8.6), GALV, GALV, 8), lying('Flow line', 0.4, 3, L(1.5, 0.6, 8.6), GALV, GALV, 6),
    box('Gearbox', [2.4, 2.4, 2.4], L(0, 0.8, -4.2), JACK),
    ...[-1.5, 1.5].flatMap((x) => [box('Crank', [0.35, 2.4, 1], L(x, 1.6, -4.6), JACK), box('Counterweight', [0.6, 2, 2.6], L(x * 1.15, 0.9, -4.6), RED), box('Pitman arm', [0.25, 4.4, 0.3], L(x, 3.6, -5.4), JACK)]),
    box('Equalizer', [3.4, 0.4, 0.5], L(0, 8, -5.4), JACK), box('Motor', [1.6, 1.4, 2.4], L(0, 0.8, -7), GREY_BOX),
  ]) },
  conveyor: { category: 'Industrial', label: 'Conveyor', hint: 'A belt conveyor on legs, flat or climbing, with a feed hopper', ...pfp('Conveyor', [num('len', 'Length', 8, 40, 20, 2), num('rise', 'Rise', 0, 14, 6, 0.5)], (L, p) => {
    const len = +p.len, rise = +p.rise, y0 = 1.6, nl = Math.max(2, Math.round(len / 5) + 1)
    return [
      ...(rise > 0 ? strut(L, 'Belt', [0, y0, -len / 2], [0, y0 + rise, len / 2], 0.5, BELT, 2.4) : [box('Belt', [2.4, 0.5, len], L(0, y0, 0), BELT, GALV)]),
      ...[...Array(nl)].flatMap((_, i) => { const f = i / (nl - 1), z = -len / 2 + 0.5 + (len - 1) * f; return [-1.1, 1.1].map((x) => box('Conveyor leg', [0.3, y0 + rise * f, 0.3], L(x, 0, z), GALV)) }),
      lying('Head pulley', 1.2, 2.8, L(0, y0 + rise - 0.2, len / 2), GALV, GALV, 10),
      { ...cyl('Feed hopper', 2.83, 1.4, L(0, y0 + 0.4, -len / 2 + 0.8), GALV, GALV, 4, 45), taper: 1.8 },
      { ...cyl('Spill pile', 4, 1.6, L(0, 0, len / 2 + 2), RUBBLE, RUBBLE, 8), taper: 0.3 },
    ]
  }) },
  hopper: { category: 'Industrial', label: 'Gravel hopper', hint: 'A raised aggregate bin with a chute to load trucks under it', make: pf('Hopper', (L) => [
    ...[[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6]].map(([x, z]) => box('Hopper leg', [0.8, 11, 0.8], L(x, 0, z), SITE_YELLOW)),
    ...[4, 8].flatMap((y) => [box('Brace', [8, 0.4, 0.4], L(0, y, -3.6), SITE_YELLOW), box('Brace', [8, 0.4, 0.4], L(0, y, 3.6), SITE_YELLOW)]),
    { ...cyl('Hopper cone', (8 * Math.SQRT2) / 3, 3, L(0, 8, 0), GALV, GALV, 4, 45), taper: 3 },
    box('Hopper bin', [8.4, 4, 8.4], L(0, 11, 0), RUBBLE, GALV), box('Chute', [1.4, 1.2, 1.4], L(0, 6.8, 0), GALV),
    box('Ladder', [0.8, 15, 0.15], L(0, 0, -4.3), WIRE), ...[-4.15, 4.15].map((z) => box('Top rail', [8.4, 1, 0.12], L(0, 15, z), GALV)),
  ]) },
  boiler: { category: 'Industrial', label: 'Pressure tank', hint: 'A horizontal pressure vessel on concrete saddles', make: pf('Pressure tank', (L) => [
    ...[-4.5, 4.5].map((x) => box('Saddle', [1.2, 2, 4.4], L(x, 0, 0), PB.concrete)),
    lying('Pressure vessel', 5, 14, L(0, 1, 0), WHITE, WHITE, 16),
    ...[-1, 1].map((s) => ({ ...lying('Vessel head', 5, 1.2, L(s * 7.6, 1, 0), WHITE, WHITE, 16, s > 0 ? 0 : 180), taper: 0.55 })),
    cyl('Manway', 1.4, 0.8, L(-3, 5.8, 0), WHITE, WHITE, 10), cyl('Safety valve', 0.4, 1.2, L(3, 5.9, 0), RED, RED, 6),
    lying('Outlet pipe', 0.6, 4, L(0, 0.6, 2.8), GALV, GALV, 8, 90), box('Gauge', [0.6, 0.6, 0.2], L(5, 3.2, 2.5), WHITE),
  ]) },
}

const containerShell = (L: Lf, t: Tex, doors: 'open' | 'shut'): Part[] => [
  box('Container floor', [6, 0.3, 24], L(0, 0, 0), { lib: 'wood_floor', surface: 21 }, t),
  ...[-2.875, 2.875].map((x) => box('Container side', [0.25, 5.4, 24], L(x, 0.3, 0), t)),
  box('Container end', [5.5, 5.4, 0.25], L(0, 0.3, -11.875), t), box('Container roof', [6, 0.3, 24], L(0, 5.7, 0), t),
  ...(doors === 'open' ? [-3, 3].map((x) => box('Container door', [0.2, 5.6, 2.9], L(x, 0.2, 13.45), t)) : [-1.5, 1.5].map((x) => box('Container door', [2.9, 5.6, 0.2], L(x, 0.2, 12.1), t))),
]
const gateLeaf = (L: Lf, w: number, h: number): Part[] => [
  box('Gate frame', [w, 0.2, 0.2], L(w / 2, 0.4, 0), GALV), box('Gate frame', [w, 0.2, 0.2], L(w / 2, h, 0), GALV),
  box('Gate frame', [0.2, h - 0.4, 0.2], L(0.1, 0.4, 0), GALV), box('Gate frame', [0.2, h - 0.4, 0.2], L(w - 0.1, 0.4, 0), GALV),
  box('Gate mesh', [w - 0.3, h - 0.5, 0.06], L(w / 2, 0.55, 0), GALV, MESH, 0, 4),
]
const gasBottle = (L: Lf, x: number, z: number, t: Tex): Part[] => [cyl('Gas cylinder', 0.6, 2.8, L(x, 0.3, z), t, t, 10), { ...cyl('Cylinder shoulder', 0.6, 0.4, L(x, 3.1, z), GALV, t, 10), taper: 0.45 }]
const GAS = [paint('#3f6a3a', 669, 0.2, 1), paint('#c8302a', 670, 0.2, 1), paint('#202022', 671, 0.2, 1), paint('#d8d8d4', 672, 0.2, 1), paint('#2f5f9a', 673, 0.2, 1)]

const YARD: Record<string, PrefabDef & { category: string }> = {
  containeropen: { category: 'Industrial', label: 'Open container', hint: 'A shipping container you can walk into, doors open or shut', ...pfp('Open container', [ctColor('blue'), yesNo('doors', 'Doors open', 'yes')], (L, p) => containerShell(L, T(CT, p.color, PB.boxBlue), p.doors === 'yes' ? 'open' : 'shut')) },
  reefer: { category: 'Industrial', label: 'Reefer container', hint: 'A white refrigerated container with its cooling unit', make: pf('Reefer', (L) => [
    box('Reefer', [6, 6, 24], L(0, 0, 0), CT.white, CT.white),
    box('Cooling unit', [5.2, 5.2, 0.6], L(0, 0.4, 12.2), FAN, FAN), box('Control panel', [1.6, 1.6, 0.08], L(-1.4, 3, 12.52), BLACK),
    ...[-2.1, -0.6, 0.6, 2.1].map((x) => box('Lock rod', [0.12, 5.6, 0.12], L(x, 0.2, -12.06), GALV)),
  ]) },
  containerstack: { category: 'Industrial', label: 'Container yard stack', hint: 'Rows of shipping containers stacked up to five high, colors mixed', ...pfp('Container yard', [num('cols', 'Rows', 1, 5, 2), num('tiers', 'Tiers', 1, 5, 3), num('seed', 'Color mix', 1, 9, 1)], (L, p) => {
    const cols = +p.cols, tiers = +p.tiers, seed = +p.seed, list = Object.values(CT), out: Part[] = []
    for (let c = 0; c < cols; c++) {
      const hgt = Math.max(1, tiers - ((c * 5 + seed) % 3 === 0 ? 1 : 0))
      for (let t = 0; t < hgt; t++) out.push(box('Container', [6, 6, 24], L((c - (cols - 1) / 2) * 6.2, t * 6, 0), list[(c * 3 + t * 5 + seed) % list.length]))
    }
    return out
  }) },
  racking: { category: 'Industrial', label: 'Pallet racking', hint: 'Warehouse racks with loaded pallets on each level', ...pfp('Racking', [num('bays', 'Bays', 1, 6, 3), num('levels', 'Levels', 2, 5, 4)], (L, p) => {
    const nb = +p.bays, nl = +p.levels, bw = 6, lh = 3.4, d = 3.2, W = nb * bw, frame = paint('#2f5f9a', 674, 0.1, 1), beam = paint('#e0701a', 675, 0.1, 1), out: Part[] = []
    for (let i = 0; i <= nb; i++) for (const s of [-1, 1]) out.push(box('Upright', [0.3, nl * lh - 0.6, 0.3], L(-W / 2 + i * bw, 0, (s * d) / 2), frame))
    for (let l = 1; l < nl; l++) for (const s of [-1, 1]) out.push(box('Beam', [W, 0.4, 0.2], L(0, l * lh - 0.4, (s * d) / 2), beam))
    for (let b = 0; b < nb; b++) for (let l = 0; l < nl; l++) {
      if ((b * 3 + l * 2) % 5 === 1) continue
      const x = -W / 2 + (b + 0.5) * bw
      out.push(box('Pallet', [5, 0.4, 3], L(x, l * lh, 0), PB.wood), box('Load', [4.6, 2.2, 2.8], L(x, l * lh + 0.4, 0), (b + l) % 2 ? CARDBOARD : WRAP))
    }
    return out
  }) },
  palletjack: { category: 'Industrial', label: 'Pallet jack', hint: 'A hand pallet truck carrying a wrapped load', make: pf('Pallet jack', (L) => [
    ...[-0.9, 0.9].map((x) => box('Fork', [0.6, 0.3, 4], L(x, 0, 0.6), RED)), { ...box('Jack body', [2.4, 1, 0.8], L(0, 0, -1.6), RED), bevel: 0.15 },
    ...strut(L, 'Handle', [0, 1, -1.8], [0, 3.6, -3], 0.2, BLACK), box('Handle grip', [1, 0.2, 0.2], L(0, 3.6, -3.1), BLACK),
    box('Pallet', [3, 0.5, 3.6], L(0, 0.3, 0.8), PB.wood), box('Load', [2.8, 2, 3.2], L(0, 0.8, 0.8), WRAP),
  ]) },
  drumpallets: { category: 'Industrial', label: 'Drum pallets', hint: 'Oil drums on pallets and more lying in a cradle', make: pf('Drum pallets', (L) => [
    ...[-2.3, 2.3].flatMap((x, k) => [box('Pallet', [4, 0.5, 4], L(x, 0, 0), PB.wood), ...[[-0.95, -0.95], [0.95, -0.95], [-0.95, 0.95], [0.95, 0.95]].map(([a, b], i) => cyl('Oil drum', 1.8, 2.6, L(x + a, 0.5, b), GALV, DRUMS[(k * 4 + i) % 3], 12))]),
    ...[-0.9, 0.9].map((dz) => box('Cradle rail', [6.6, 0.5, 0.4], L(0, 0, 3.6 + dz), PB.wood)),
    ...[-2, 0, 2].map((x, i) => lying('Oil drum', 1.8, 2.6, L(x, 0.5, 3.6), GALV, DRUMS[i], 12, 90)), ...[-1, 1].map((x, i) => lying('Oil drum', 1.8, 2.6, L(x, 2.2, 3.6), GALV, DRUMS[i + 1], 12, 90)),
  ]) },
  gascage: { category: 'Industrial', label: 'Gas cylinder cage', hint: 'A mesh cage of gas bottles, open at the front with a chain', make: pf('Gas cage', (L) => [
    box('Cage floor', [6, 0.3, 3], L(0, 0, 0), PB.diamond, GALV),
    box('Cage back', [6, 4.4, 0.08], L(0, 0.3, -1.46), GALV, MESH, 0, 4), ...[-2.96, 2.96].map((x) => box('Cage side', [0.08, 4.4, 3], L(x, 0.3, 0), GALV, MESH, 0, 4)),
    ...posts(L, 5.9, 2.9, 4.4, GALV, 0.2, 0.3), box('Cage roof', [6.2, 0.2, 3.2], L(0, 4.7, 0), GALV), box('Safety chain', [5.8, 0.08, 0.08], L(0, 2.6, 1.45), PIPE.yellow),
    ...[-2.2, -1.1, 0, 1.1, 2.2].flatMap((x, i) => gasBottle(L, x, -0.8, GAS[i % GAS.length])), ...[-1.6, -0.5, 0.6, 1.7].flatMap((x, i) => gasBottle(L, x, 0.3, GAS[(i + 2) % GAS.length])),
  ]) },
  manhole: { category: 'Industrial', label: 'Open manhole', hint: 'An open manhole behind guard rails, its cover beside it', make: pf('Manhole', (L) => [
    cyl('Manhole frame', 3, 0.1, L(0, 0, 0), PB.steel, PB.steel, 16), cyl('Manhole', 2.4, 0.16, L(0, 0, 0), BLACK, BLACK, 16),
    cyl('Manhole cover', 2.4, 0.18, L(3.6, 0, 0), COVER, COVER, 16),
    ...[[-2, -2], [2, -2], [-2, 2], [2, 2]].map(([x, z]) => box('Rail post', [0.25, 2.2, 0.25], L(x, 0, z), WHITE)),
    ...[[0, -2, 0], [0, 2, 0], [-2, 0, 90], [2, 0, 90]].map(([x, z, r]) => box('Guard rail', [4, 0.4, 0.1], L(x, 1.7, z), ORANGE_WHITE, ORANGE_WHITE, r, 2)),
  ]) },
  culvert: { category: 'Industrial', label: 'Sewer outlet', hint: 'A concrete headwall with a barred pipe mouth and a trickle of water', make: pf('Sewer outlet', (L) => [
    box('Headwall', [16, 7, 2], L(0, 0, 0), PB.concrete, PB.cracked), ...[-7.2, 7.2].map((x) => ramp('Wing wall', [1.6, 7, 6], L(x, 0, 4), PB.concrete, PB.cracked)),
    lying('Outlet pipe', 5, 3, L(0, 0.6, 1.4), BLACK, PB.concrete, 16, 90),
    ...[-1.6, -0.8, 0, 0.8, 1.6].map((x) => box('Grate bar', [0.25, 4.6, 0.25], L(x, 0.8, 3), PB.rusty)),
    box('Apron', [10, 0.3, 6], L(0, 0, 5), PB.concrete), box('Drain water', [3.6, 0.4, 7], L(0, 0, 5.5), DRAIN_WATER, DRAIN_WATER),
  ]) },
  watertower: { category: 'Industrial', label: 'Water tower', hint: 'A tank on braced legs with a balcony ring and a ladder', ...pfp('Water tower', [num('h', 'Leg height', 10, 40, 22)], (L, p) => {
    const h = +p.h, b = 5.4, t = 3.6, m = (b + t) / 2
    return [
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].flatMap(([a, c]) => [box('Footing', [1.4, 0.5, 1.4], L(a * b, 0, c * b), PB.concrete), ...strut(L, 'Tower leg', [a * b, 0.5, c * b], [a * t, h, c * t], 0.8, WATER_TANK)]),
      box('Brace', [2 * m, 0.4, 0.4], L(0, h / 2, -m), WATER_TANK), box('Brace', [2 * m, 0.4, 0.4], L(0, h / 2, m), WATER_TANK), box('Brace', [0.4, 0.4, 2 * m], L(-m, h / 2, 0), WATER_TANK), box('Brace', [0.4, 0.4, 2 * m], L(m, h / 2, 0), WATER_TANK),
      cyl('Riser pipe', 1.2, h - 2, L(0, 0, 0), GALV, GALV, 8),
      { ...cyl('Tank bottom', 4, 2.2, L(0, h - 2.2, 0), WATER_TANK, WATER_TANK, 16), taper: 2.75 },
      cyl('Balcony', 13, 0.3, L(0, h - 0.3, 0), PB.diamond, WATER_TANK, 16), cyl('Balcony rail', 13, 0.15, L(0, h + 1.2, 0), WATER_TANK, WATER_TANK, 16),
      cyl('Water tank', 11, 7, L(0, h, 0), WATER_TANK, WATER_TANK, 16), { ...cyl('Tank roof', 11.6, 2.8, L(0, h + 7, 0), WATER_TANK, WATER_TANK, 16), taper: 0 },
      box('Ladder', [0.8, h, 0.15], L(0, 0, 4.5), WIRE),
    ]
  }) },
  junkpile: { category: 'Industrial', label: 'Scrap heap', hint: 'A mound of scrap: a car hulk, tires, drums, sheet metal and a girder', make: pf('Scrap heap', (L) => [
    { ...cyl('Scrap mound', 14, 2.4, L(0, 0, 0), RUBBLE, RUBBLE, 9, 20), taper: 0.6 },
    { ...box('Car hulk', [4, 1.6, 8], L(-1, 2, 0.5), PB.rusty, PB.car('#6a4a3a', 644), 25), bevel: 0.35 },
    box('Scrap', [3, 1.2, 2], L(2.4, 1.6, -2.4), PB.rusty, PB.rusty, 50),
    ramp('Sheet metal', [3.4, 2.4, 3], L(4.2, 0, 2.6), PB.corrugated, PB.rusty, 200),
    ...[[-5.6, 2.2], [-5.4, -1.2]].map(([x, z]) => cyl('Tire', 2, 0.7, L(x, 0, z), PB.tire, PB.tire, 10)), cyl('Tire', 2, 0.7, L(-5.5, 0.7, 0.5), PB.tire, PB.tire, 10),
    lying('Drum', 1.6, 2.4, L(5, 0, -1.6), PB.rusty, PB.rusty, 10, 70), cyl('Drum', 1.6, 2.2, L(-2.4, 1.6, -3), PB.rusty, DRUMS[0], 10),
    box('Old fridge', [1.8, 3, 1.6], L(0.8, 2.4, -1.4), WHITE, WHITE, 15),
    box('Girder', [0.6, 0.6, 9], L(-2.6, 2.6, -0.4), PB.rusty, PB.rusty, -35),
    box('Pallet', [3.2, 0.4, 3.2], L(4.6, 0, 5.4), PB.wood, PB.wood, 10),
  ]) },
  carcrusher: { category: 'Industrial', label: 'Car crusher', hint: 'A hydraulic press bed with a flattened car, power unit and control booth', make: pf('Car crusher', (L) => [
    box('Crusher bed', [8, 1.6, 16], L(0, 0, 0), PB.diamond, CRUSH_RED), ...[-3.6, 3.6].map((x) => box('Crusher wall', [0.8, 3, 16], L(x, 1.6, 0), CRUSH_RED, CRUSH_RED)),
    ...[[-3.6, -7.2], [3.6, -7.2], [-3.6, 7.2], [3.6, 7.2]].map(([x, z]) => cyl('Hydraulic ram', 1, 7, L(x, 4.6, z), GALV, GALV, 10)),
    box('Press plate', [8.4, 1.4, 16.4], L(0, 7.6, 0), CRUSH_RED, HAZARD), ...[-7.2, 7.2].map((z) => box('Top frame', [8.4, 0.8, 1.6], L(0, 11.6, z), CRUSH_RED)),
    { ...box('Crushed car', [5.8, 1.6, 9], L(0, 1.6, 1), PB.rusty, PB.car('#2f5f8f', 676)), bevel: 0.3 },
    box('Power unit', [4, 3, 3], L(6.5, 0, -5), SITE_YELLOW), box('Control booth', [3, 4.6, 3], L(6.5, 0, 3), WHITE, GLASS),
  ]) },
  chaingate: { category: 'Industrial', label: 'Chain-link gate', hint: 'A double swing gate between posts, shut, ajar or open', ...pfp('Chain-link gate', [num('w', 'Opening', 6, 24, 14), num('h', 'Height', 4, 8, 5.5, 0.5), sel('open', 'Gate', [['shut', 'Shut'], ['ajar', 'Ajar'], ['open', 'Open']], 'shut')], (L, p) => {
    const w = +p.w, h = +p.h, a = ({ shut: 0, ajar: 35, open: 85 } as Record<string, number>)[String(p.open)] ?? 0, lw = w / 2 - 0.4
    return [
      ...[-1, 1].map((s) => cyl('Gate post', 0.6, h + 1, L((s * w) / 2, 0, 0), GALV, GALV, 8)),
      ...at(L, -w / 2 + 0.3, 0, -a, (M) => gateLeaf(M, lw, h)),
      ...at(L, w / 2 - 0.3, 0, 180 + a, (M) => gateLeaf(M, lw, h)),
    ]
  }) },
  stairtower: { category: 'Industrial', label: 'Stair tower', hint: 'A steel stair tower with landings at every level and a railed top', ...pfp('Stair tower', [num('levels', 'Levels', 1, 6, 3)], (L, p) => {
    const n = +p.levels, rise = 6, run = 9, lane = 3, land = 3, H = n * rise, lastUp = (n - 1) % 2 === 0, e = run / 2 + land
    return [
      ...flights(L, 0, n, rise, run, lane, land, PB.diamond, GALV),
      box('Top deck', [lane, 0.4, run], L(lastUp ? lane / 2 : -lane / 2, H - 0.4, 0), PB.diamond, GALV),
      box('Top landing', [lane * 2, 0.4, land], L(0, H - 0.4, (lastUp ? -1 : 1) * (run / 2 + land / 2)), PB.diamond, GALV),
      ...[-lane, lane].flatMap((x) => [-e, -run / 2, run / 2, e].map((z) => box('Tower post', [0.4, H + 3.4, 0.4], L(x, 0, z), SITE_YELLOW))),
      ...[1.5, 3].flatMap((r) => [box('Rail', [0.12, 0.12, 2 * e], L(-lane, H + r, 0), SITE_YELLOW), box('Rail', [0.12, 0.12, 2 * e], L(lane, H + r, 0), SITE_YELLOW), box('Rail', [2 * lane, 0.12, 0.12], L(0, H + r, -e), SITE_YELLOW), box('Rail', [2 * lane, 0.12, 0.12], L(0, H + r, e), SITE_YELLOW)]),
    ]
  }) },
}

export const INDUSTRIAL_PREFABS: Record<string, PrefabDef & { category: string }> = {
  ...MILITARY,
  ...CONSTRUCTION,
  ...PLANT,
  ...YARD,
}
