// Gameplay pieces: cover walls and barricades, sniper nests and spawn bunkers,
// team bases, flags and capture points, look-alike pickup stations, a shooting
// range, and obstacles: parkour, jump puzzles, mazes, tunnels, ramps and
// bridges. Each piece stands on the ground at y, faces +Z and is one object.
// Sized for players (1 unit = 0.5 m): a player is 3.56 tall and 2.22 crouched,
// jumps about 1.7, climbs ledges up to about 6 on their own and walks up steps of
// 0.6 at most. Low cover hides a crouching player; high cover hides a standing one.
import { CY, PB, box, cyl, lying, ramp, stairs, turn, type Part, type Tex } from './sampleKit'
import { group, local, type ParamDef, type Params, type PrefabDef } from './prefabs'

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
const row = (L: Lf, n: number, gap: number, make: (L: Lf, i: number) => Part[]): Part[] =>
  [...Array(Math.max(1, Math.round(n)))].flatMap((_, i, a) => at(L, (i - (a.length - 1) / 2) * gap, 0, 0, (M) => make(M, i)))
/** A piece placed round an arc of radius r about the origin, at heading a (its local −Z points outward). */
const onArc = (L: Lf, r: number, a: number, make: (L: Lf) => Part[], y = 0): Part[] => { const [x, z] = turn(0, -r, a); return at(L, x, z, a, make, y) }

const num = (key: string, label: string, min: number, max: number, def: number, step = 1): ParamDef => ({ key, label, kind: 'number', min, max, step, default: def })
const sel = (key: string, label: string, options: [string, string][], def: string): ParamDef => ({ key, label, kind: 'select', options, default: def })

/** Player sizes in units. */
const LOW = 2.4, HIGH = 4.8
/** Steps no taller than 0.6 units (0.3 m), so players walk up them. */
const stepsFor = (h: number) => Math.max(2, Math.ceil(h / 0.6 - 1e-6))

// ---------------- materials ----------------

const solid = (color: string, accent: string, seed: number, surface = 17): Tex => ({ gen: 'tiles', tweak: { color, accent, scale: 1, wear: 0.08, seed }, surface })
const SANDBAG: Tex = { gen: 'sand', tweak: { color: '#b49a6a', accent: '#8a7550', scale: 2, seed: 9 } }
const OLIVE: Tex = { gen: 'metal_plate', tweak: { color: '#4f5a32', accent: '#3a4224', scale: 2, wear: 0.25, seed: 700 }, surface: 15 }
const CAMO: Tex = { gen: 'grass', tweak: { color: '#4f5a32', accent: '#7a6a42', scale: 3, wear: 0.5, seed: 701 }, surface: 7 }
const BERM: Tex = { gen: 'dirt', tweak: { color: '#6a543a', accent: '#4a3a28', wear: 0.4, seed: 702 } }
const ROPE = solid('#b89a6a', '#8a7048', 703, 21)
const WHITE = solid('#e8e6e0', '#cfccc4', 704)
const FIRST_AID = solid('#1f9a4a', '#147038', 705)
const STRAW: Tex = { gen: 'sand', tweak: { color: '#d8b85a', accent: '#a8873a', scale: 6, seed: 706 }, surface: 21 }
const TARGET: Tex = { gen: 'tiles', tweak: { color: '#f2f2ee', accent: '#c8302a', scale: 3, wear: 0, seed: 707 }, surface: 17 }
const GLASS: Tex = { gen: 'tiles', tweak: { color: '#25313b', accent: '#1a2229', scale: 1, wear: 0, seed: 708 }, surface: 9 }
const MAT = solid('#2a4a8a', '#1a3060', 709, 18)
const HOLDS = [PB.red, PB.yellow, PB.green, PB.blue, PB.orange]
const LEAVES: Tex = { gen: 'grass', tweak: { color: '#2f5e22', accent: '#4c7a2a', scale: 3, wear: 0.2, seed: 84 }, surface: 7 }
const HAZARD: Tex = { gen: 'hazard', tweak: { seed: 710 } }
const GIRDER: Tex = { gen: 'metal_plate', tweak: { color: '#8a3a22', accent: '#5a2414', scale: 3, wear: 0.3, seed: 711 }, surface: 15 }

const MATS: Record<string, [Tex, Tex]> = {
  concrete: [PB.concrete, PB.darkConcrete], brick: [PB.brick, PB.concrete], wood: [PB.planks, PB.wood], metal: [PB.corrugated, PB.steel],
  sandbag: [SANDBAG, SANDBAG], cyber: [CY.panel, CY.cyan], paint: [PB.red, PB.yellow],
}
const matParam = (def: string) => sel('mat', 'Material', [['concrete', 'Concrete'], ['brick', 'Brick'], ['wood', 'Wood'], ['metal', 'Metal'], ['sandbag', 'Sandbags'], ['cyber', 'Cyber'], ['paint', 'Paintball red']], def)
/** Wall and cap textures from the material setting. */
const mat = (p: Params): [Tex, Tex] => MATS[String(p.mat)] ?? MATS.concrete
const heightParam = (def: 'low' | 'high') => sel('h', 'Height', [['low', 'Low: crouch behind it'], ['high', 'High: full cover']], def)
const coverH = (p: Params) => (p.h === 'high' ? HIGH : LOW)

const TEAMS: Record<string, Tex> = { red: PB.red, blue: PB.blue, yellow: PB.yellow, green: PB.green }
const teamParam = (def: string) => sel('team', 'Team', [['red', 'Red'], ['blue', 'Blue'], ['yellow', 'Yellow'], ['green', 'Green']], def)
const team = (p: Params) => TEAMS[String(p.team)] ?? PB.red
const NEON: Record<string, Tex> = { cyan: CY.cyan, pink: CY.pink, lime: CY.lime, purple: CY.purple, orange: CY.orange, white: CY.white }
const neonParam = (def: string) => sel('color', 'Glow', [['cyan', 'Cyan'], ['pink', 'Pink'], ['lime', 'Lime'], ['purple', 'Purple'], ['orange', 'Orange'], ['white', 'White']], def)
const neon = (p: Params) => NEON[String(p.color)] ?? CY.cyan

// ---------------- building blocks ----------------

/** A cover wall along local X, `h` high including its cap, centred on the origin. */
const coverWall = (L: Lf, len: number, h: number, [side, cap]: [Tex, Tex], t = 1): Part[] => [
  box('Cover wall', [len, h - 0.2, t], L(0, 0, 0), side, side), { ...box('Wall cap', [len + 0.2, 0.2, t + 0.3], L(0, h - 0.2, 0), cap), bevel: 0.05 },
]
/** A wall along local X with openings cut out ({ at, w, h, sill }). */
function slotWall(L: Lf, len: number, h: number, t: number, side: Tex, top: Tex, gaps: { at: number; w: number; h: number; sill: number }[]): Part[] {
  const out: Part[] = []
  const piece = (s0: number, s1: number, y0: number, y1: number) => { if (s1 - s0 > 0.05 && y1 - y0 > 0.05) out.push(box('Wall', [s1 - s0, y1 - y0, t], L((s0 + s1) / 2, y0, 0), top, side)) }
  let cur = -len / 2
  for (const g of [...gaps].sort((a, b) => a.at - b.at)) {
    const g0 = Math.max(cur, g.at - g.w / 2), g1 = Math.min(len / 2, g.at + g.w / 2)
    if (g1 - g0 < 0.5) continue
    piece(cur, g0, 0, h); piece(g0, g1, 0, g.sill); piece(g0, g1, g.sill + g.h, h)
    cur = g1
  }
  piece(cur, len / 2, 0, h)
  return out
}
/** Sandbags laid in staggered courses along local X. */
function sandbags(L: Lf, len: number, rows: number, z = 0, y = 0): Part[] {
  const out: Part[] = []
  const BL = 1.8, n = Math.max(1, Math.round(len / BL))
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? BL / 2 : 0, count = r % 2 ? n - 1 : n
    for (let i = 0; i < count; i++) out.push({ ...box('Sandbag', [BL - 0.05, 0.8, 1.2], L(-((n - 1) * BL) / 2 + off + i * BL, y + r * 0.8, z), SANDBAG, SANDBAG), bevel: 0.3 })
  }
  return out
}
const posts4 = (L: Lf, w: number, d: number, h: number, tex: Tex, s = 0.5, y = 0) =>
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box('Post', [s, h, s], L(a * (w / 2 - s / 2), y, b * (d / 2 - s / 2)), tex))
/** A flag on a pole, `h` tall, flying toward +X. */
const flag = (L: Lf, x: number, z: number, h: number, tex: Tex): Part[] => [
  cyl('Flag pole', 0.3, h, L(x, 0, z), PB.steel, PB.steel, 8), box('Flag', [3.2, 2, 0.1], L(x + 1.75, h - 2.3, z), tex), cyl('Pole top', 0.5, 0.4, L(x, h, z), PB.yellow, PB.yellow, 8),
]

// ---------------- cover ----------------

const COVER: Record<string, PrefabDef & { category: string }> = {
  coverlow: { category: 'Cover', label: 'Low cover wall', hint: 'A waist-high wall (1.2 m): crouch behind it, stand to shoot over it', ...pfp('Low cover', [num('len', 'Length', 2, 40, 8), matParam('concrete')], (L, p) => coverWall(L, +p.len, LOW, mat(p))) },
  coverhigh: { category: 'Cover', label: 'High cover wall', hint: 'A 2.4 m wall that hides a standing player; low enough to climb onto', ...pfp('High cover', [num('len', 'Length', 2, 40, 8), matParam('concrete')], (L, p) => coverWall(L, +p.len, HIGH, mat(p))) },
  coverangled: { category: 'Cover', label: 'Angled cover', hint: 'A V-shaped wall pointing at the enemy (+Z): cover from the front and both flanks', ...pfp('Angled cover', [num('arm', 'Arm length', 3, 16, 6), sel('angle', 'Angle', [['30', 'Wide'], ['45', 'Medium'], ['60', 'Narrow']], '30'), heightParam('low'), matParam('concrete')], (L, p) => {
    const a = +p.arm, th = +p.angle, h = coverH(p), t = (th * Math.PI) / 180
    return [
      ...[-1, 1].flatMap((s) => at(L, s * (a / 2) * Math.cos(t), 1 - (a / 2) * Math.sin(t), s * th, (M) => coverWall(M, a, h, mat(p)))),
      // A post at the point, a little taller than the caps, hides where the two arms cross.
      cyl('Corner post', 2.8, h + 0.15, L(0, 0, 0.6), mat(p)[1], mat(p)[0], 8, 22.5),
    ]
  }) },
  coverslot: { category: 'Cover', label: 'Firing-slot wall', hint: 'A 2.5 m wall with slots at eye height: shoot through standing, duck below them', ...pfp('Slot wall', [num('len', 'Length', 4, 40, 12), num('n', 'Slots', 1, 6, 2), matParam('concrete')], (L, p) => {
    const len = +p.len, n = Math.round(+p.n), [side, cap] = mat(p)
    const gaps = [...Array(n)].map((_, i) => ({ at: -len / 2 + (len * (i + 0.5)) / n, w: Math.min(2.4, len / n - 1), h: 0.9, sill: 2.6 }))
    return [...slotWall(L, len, 5, 1, side, cap, gaps), { ...box('Wall cap', [len + 0.2, 0.2, 1.3], L(0, 5, 0), cap), bevel: 0.05 },
      ...gaps.map((g) => box('Slot sill', [g.w, 0.12, 1.4], L(g.at, g.sill - 0.08, 0), PB.steel))]
  }) },
  covercorner: { category: 'Cover', label: 'Corner cover', hint: 'An L-shaped wall: cover from two sides at once', ...pfp('Corner cover', [num('arm', 'Arm length', 3, 20, 8), heightParam('low'), matParam('concrete')], (L, p) => {
    const a = +p.arm, h = coverH(p), [side, cap] = mat(p)
    // The second arm's cap starts where the first one's ends, so no two tops overlap.
    return [...at(L, a / 2 - 0.5, 0, 0, (M) => coverWall(M, a, h, mat(p))), box('Cover wall', [1, h - 0.2, a - 1], L(0, 0, a / 2), side, side),
      { ...box('Wall cap', [1.3, 0.2, a - 1.05], L(0, h - 0.2, (a + 0.25) / 2), cap), bevel: 0.05 }]
  }) },
  covert: { category: 'Cover', label: 'T cover', hint: 'A T-shaped wall: three fighting positions round one block', ...pfp('T cover', [num('arm', 'Bar length', 4, 24, 10), heightParam('high'), matParam('concrete')], (L, p) => {
    const a = +p.arm, h = coverH(p), [side, cap] = mat(p)
    return [...coverWall(L, a, h, mat(p)), box('Cover wall', [1, h - 0.2, a / 2], L(0, 0, 0.5 + a / 4), side, side),
      { ...box('Wall cap', [1.3, 0.2, a / 2 - 0.05], L(0, h - 0.2, 0.65 + (a / 2 - 0.05) / 2), cap), bevel: 0.05 }]
  }) },
  barricadewood: { category: 'Cover', label: 'Wooden barricade', hint: 'Boards nailed across posts, chest high, with gaps to peek through', ...pfp('Wood barricade', [num('len', 'Length', 3, 24, 8)], (L, p) => {
    const len = +p.len, posts = Math.max(2, Math.round(len / 4) + 1)
    return [
      ...[...Array(posts)].map((_, i) => box('Post', [0.5, 3.6, 0.5], L(-len / 2 + 0.25 + (i * (len - 0.5)) / (posts - 1), 0, -0.4), PB.wood)),
      ...[0.3, 1.1, 1.9, 2.7].map((y, k) => box('Board', [len + (k % 2 ? 0.4 : -0.2), 0.6, 0.25], L((k % 2 ? 0.2 : -0.1), y, 0), PB.planks, PB.planks, (k - 1.5) * 1.2)),
      ...[-1, 1].map((s) => box('Brace', [0.4, 0.5, 2], L(s * (len / 2 - 0.6), 0, -1.2), PB.wood)),
    ]
  }) },
  sandbagline: { category: 'Cover', label: 'Sandbag line', hint: 'A straight wall of staggered sandbags: three courses hide a crouching player', ...pfp('Sandbag line', [num('len', 'Length', 2, 30, 9), num('rows', 'Courses', 1, 6, 3)], (L, p) => sandbags(L, +p.len, Math.round(+p.rows))) },
  cardoors: { category: 'Cover', label: 'Car-door barricade', hint: 'Car doors propped up on blocks and tyres: improvised street cover', ...pfp('Car doors', [num('n', 'Doors', 2, 6, 3)], (L, p) => row(L, +p.n, 3.9, (M, i) => {
    const paint = PB.car(['#b8322a', '#2a5ab8', '#d0d0d0', '#202020', '#2f8a3a', '#e0b020'][i % 6], 712 + i)
    return at(M, 0, 0, (i % 2 ? 1 : -1) * 8, (N) => [
      box('Block', [3.4, 0.4, 0.8], N(0, 0, 0), PB.cinder), { ...box('Car door', [3.6, 2, 0.3], N(0, 0.4, 0), paint), bevel: 0.1 },
      box('Window frame', [3.2, 0.15, 0.3], N(0, 3.6, 0), paint), box('Door glass', [3, 1.2, 0.12], N(0, 2.4, 0), GLASS),
      box('Window post', [0.2, 1.2, 0.3], N(1.5, 2.4, 0), paint), lying('Tyre prop', 1.8, 0.7, N(0, 0, -1), PB.tire, PB.tire, 14),
    ])
  })) },
  snipernest: { category: 'Cover', label: 'Sniper nest', hint: 'A sandbagged platform on stilts with a camo roof, and steep steps up the back', ...pfp('Sniper nest', [num('h', 'Platform height', 6, 16, 10, 1)], (L, p) => {
    const h = +p.h, S = 7, n = stepsFor(h), run = 0.75
    return [
      ...posts4(L, S - 0.4, S - 0.4, h - 0.5, PB.wood, 0.6), box('Platform', [S, 0.5, S], L(0, h - 0.5, 0), PB.planks, PB.wood),
      ...[-1, 1].flatMap((s) => [box('Brace', [S - 0.6, 0.4, 0.3], L(0, h / 2, s * (S / 2 - 0.3)), PB.wood), box('Brace', [0.3, 0.4, S - 0.6], L(s * (S / 2 - 0.3), h / 2, 0), PB.wood)]),
      // Sandbags round three sides and the left half of the back, where the steps come up.
      ...sandbags(L, S, 3, -S / 2 + 0.6, h), ...at(L, -S / 2 + 0.6, 0, 90, (M) => sandbags(M, S - 2.4, 3), h), ...at(L, S / 2 - 0.6, 0, 90, (M) => sandbags(M, S - 2.4, 3), h),
      ...sandbags((dx, dy, dz) => L(dx - 1.8, dy, dz), 3.6, 3, S / 2 - 0.6, h),
      ...posts4(L, S - 0.4, S - 0.4, 4.4, PB.wood, 0.3, h), box('Camo roof', [S + 1, 0.3, S + 1], L(0, h + 4.4, 0), CAMO, CAMO),
      stairs('Steps', [2.6, h, n * run], L(S / 2 - 1.5, 0, S / 2 + (n * run) / 2), PB.wood, PB.wood, 0, n),
    ]
  }) },
  watchpost: { category: 'Cover', label: 'Watch post', hint: 'A raised firing step with a sandbag parapet and a tin roof, steps at the back', make: pf('Watch post', (L) => {
    const h = 3, n = stepsFor(h)
    return [
      box('Firing step', [9, h, 6], L(0, 0, 0), PB.planks, PB.cinder), stairs('Steps', [3, h, n * 0.9], L(-2.5, 0, -3 - (n * 0.9) / 2), PB.concrete, PB.cinder, 180, n),
      ...sandbags(L, 9, 3, 2.4, h), ...at(L, -3.9, 0.6, 90, (M) => sandbags(M, 3.6, 3), h), ...at(L, 3.9, 0, 90, (M) => sandbags(M, 4.8, 3), h),
      ...posts4(L, 9, 6, 4.6, PB.wood, 0.3, h), { ...box('Tin roof', [10, 0.25, 7], L(0, h + 4.6, 0), PB.corrugated, PB.rusty), bevel: 0 },
    ]
  }) },
  spawnbunker: { category: 'Cover', label: 'Spawn bunker', hint: 'A roofed concrete bunker with three exits and a blast wall inside the front door, so nobody can shoot straight in at a spawn', ...pfp('Spawn bunker', [teamParam('red')], (L, p) => {
    const W = 16, D = 14, H = 6, t = 1, tex = PB.concrete
    return [
      box('Floor', [W - 2 * t, 0.15, D - 2 * t], L(0, 0, 0), PB.floorWorn),
      ...at(L, 0, D / 2 - t / 2, 0, (M) => slotWall(M, W, H, t, tex, tex, [{ at: 0, w: 5, h: 5, sill: 0 }])),
      ...at(L, 0, -D / 2 + t / 2, 0, (M) => slotWall(M, W, H, t, tex, tex, [{ at: -4, w: 2.4, h: 0.9, sill: 2.6 }, { at: 4, w: 2.4, h: 0.9, sill: 2.6 }])),
      // Side doors toward the back (a heading of 90 turns the wall's +X to −Z).
      ...[-1, 1].flatMap((s) => at(L, s * (W / 2 - t / 2), 0, 90, (M) => slotWall(M, D - 2 * t, H, t, tex, tex, [{ at: 2.5, w: 4, h: 5, sill: 0 }]))),
      box('Blast wall', [8, H - 0.2, 0.8], L(0, 0, D / 2 - 4), tex), box('Roof', [W + 1, 0.8, D + 1], L(0, H, 0), PB.darkConcrete, tex),
      box('Team stripe', [W + 1.1, 0.5, D + 1.1], L(0, H + 0.15, 0), team(p)), box('Door stripe', [5.4, 0.5, 1.1], L(0, 5, D / 2 - t / 2), HAZARD),
    ]
  }) },
}

// ---------------- team play: bases, flags, zones, stations, targets ----------------

const TEAM: Record<string, PrefabDef & { category: string }> = {
  teambase: { category: 'Fun & games', label: 'Team base', hint: 'A raised base in team colours: low walls round the back and sides, steps at the front, a flag stand in the middle', ...pfp('Team base', [teamParam('red'), num('size', 'Size', 14, 30, 20, 2)], (L, p) => {
    const S = +p.size, D = S * 0.8, h = 1.2, n = stepsFor(h)
    return [
      box('Base deck', [S, h, D], L(0, 0, 0), PB.diamond, team(p)), box('Deck edge', [S + 0.2, 0.2, D + 0.2], L(0, h - 0.2, 0), team(p)),
      stairs('Steps', [8, h, n * 0.9], L(0, 0, D / 2 + (n * 0.9) / 2), PB.concrete, team(p), 0, n),
      ...at(L, 0, -D / 2 + 0.5, 0, (M) => coverWall(M, S, LOW, [PB.concrete, team(p)]), h),
      ...[-1, 1].flatMap((s) => [
        ...at(L, s * (S / 2 - 0.5), -D / 4, 90, (M) => coverWall(M, D / 2 - 2, LOW, [PB.concrete, team(p)]), h),
        ...at(L, s * (S / 2 - 0.5), D / 2 - 2, 90, (M) => coverWall(M, 3, LOW, [PB.concrete, team(p)]), h),
      ]),
      cyl('Flag stand', 3, 0.5, L(0, h, -1), PB.steel, team(p), 12), ...at(L, 0, -1, 0, (M) => flag(M, 0, 0, 9, team(p)), h + 0.5),
      ...[-1, 1].map((s) => ({ ...box('Supply crate', [2.4, 2.4, 2.4], L(s * (S / 2 - 3), h, -D / 2 + 2.6), team(p), PB.planks), bevel: 0.1 })),
    ]
  }) },
  flagstand: { category: 'Fun & games', label: 'Flag stand', hint: 'A team flag on a pole with a glowing ring round its base: mark the spot to capture', ...pfp('Flag stand', [teamParam('blue')], (L, p) => [
    cyl('Glow ring', 6, 0.1, L(0, 0, 0), team(p), team(p), 20), cyl('Stand', 3, 0.6, L(0, 0.1, 0), PB.steel, team(p), 12), ...at(L, 0, 0, 0, (M) => flag(M, 0, 0, 9, team(p)), 0.7),
  ]) },
  capturepad: { category: 'Fun & games', label: 'Capture point', hint: 'A raised eight-sided zone, one step up, with glowing rim and four pylons: hold it to win', ...pfp('Capture point', [num('size', 'Size', 8, 30, 14, 2), neonParam('lime')], (L, p) => {
    const S = +p.size
    return [
      cyl('Capture pad', S, 0.5, L(0, 0, 0), CY.dark, CY.panel, 8, 22.5), cyl('Glow rim', S - 1, 0.52, L(0, 0, 0), neon(p), neon(p), 8, 22.5),
      cyl('Pad centre', S - 2.4, 0.54, L(0, 0, 0), CY.gridCyan, CY.dark, 8, 22.5),
      ...[45, 135, 225, 315].flatMap((a) => onArc(L, S / 2 + 1.2, a, (M) => [cyl('Pylon', 1, 4.6, M(0, 0, 0), CY.panel, CY.panel, 6), { ...cyl('Pylon light', 1, 1.2, M(0, 4.6, 0), neon(p), neon(p), 6), taper: 0.3 }])),
    ]
  }) },
  weaponrack: { category: 'Fun & games', label: 'Weapon rack', hint: 'Rifles standing in a rack, with ammo cans (decoration: add a weapon pickup next to it)', ...pfp('Weapon rack', [num('n', 'Rifles', 2, 10, 6)], (L, p) => {
    const n = Math.round(+p.n), w = n * 0.9 + 1
    return [
      box('Rack base', [w, 0.4, 1.6], L(0, 0, 0), OLIVE), box('Rack back', [w, 4.4, 0.3], L(0, 0, -0.65), OLIVE), box('Barrel rest', [w, 0.3, 0.9], L(0, 3.6, -0.3), OLIVE),
      ...row(L, n, 0.9, (M) => [box('Stock', [0.3, 1.1, 0.6], M(0, 0.4, -0.05), PB.wood), box('Receiver', [0.25, 1.5, 0.4], M(0, 1.5, -0.15), PB.black),
        box('Magazine', [0.2, 0.6, 0.3], M(0, 1.8, 0.15), PB.black), box('Barrel', [0.12, 1.4, 0.12], M(0, 3, -0.2), PB.black)]),
      ...[-1, 1].map((s) => box('Ammo can', [1.2, 0.8, 0.7], L(s * (w / 2 + 0.7), 0, 0), OLIVE)), box('Ammo can', [1.2, 0.8, 0.7], L(-(w / 2 + 0.7), 0.8, 0.1), OLIVE),
    ]
  }) },
  ammostation: { category: 'Fun & games', label: 'Ammo station', hint: 'Stacked ammo crates under a yellow sign (decoration: add an ammo or weapon pickup by it)', make: pf('Ammo station', (L) => [
    ...[[-1.4, 0, 0], [1.4, 0, 0], [0, 1.7, 0], [-1.3, 0, 2.4]].map(([x, y, z]) => ({ ...box('Ammo crate', [2.6, 1.7, 2], L(x, y, z), OLIVE, OLIVE), bevel: 0.08 })),
    ...[[-1.4, 0], [1.4, 0], [0, 1.7]].map(([x, y]) => box('Crate band', [2.62, 0.3, 2.02], L(x, y + 0.7, 0), PB.yellow)),
    box('Open crate', [2.6, 1, 2], L(1.5, 0, 2.6), OLIVE), ...[-0.6, 0, 0.6].map((dx) => box('Ammo box', [0.5, 0.4, 1.6], L(1.5 + dx, 1, 2.6), solid('#c9a23a', '#8a6a1a', 713, 15))),
    box('Sign post', [0.3, 5.5, 0.3], L(-3.4, 0, -0.6), PB.steel), box('Ammo sign', [2.6, 1.6, 0.15], L(-3.4, 5.5, -0.6), PB.yellow, PB.black),
  ]) },
  healthstation: { category: 'Fun & games', label: 'Health station', hint: 'A first-aid cabinet with a green cross on a stand (decoration: add a health pickup by it)', make: pf('Health station', (L) => [
    box('Stand', [1.6, 2, 1.2], L(0, 0, 0), PB.steel), { ...box('First-aid cabinet', [2.6, 2.6, 1.2], L(0, 2, 0), WHITE), bevel: 0.1 },
    box('Cross', [1.6, 0.5, 0.08], L(0, 3.05, 0.62), FIRST_AID), box('Cross', [0.5, 1.6, 0.08], L(0, 2.5, 0.62), FIRST_AID),
    box('Stretcher', [2.2, 0.15, 6], L(3, 0.9, 0.5), FIRST_AID), ...[[-0.9, -2.6], [0.9, -2.6], [-0.9, 3.4], [0.9, 3.4]].map(([x, z]) => box('Stretcher leg', [0.15, 0.9, 0.15], L(3 + x, 0, 0.5 + z), PB.steel)),
  ]) },
  targetdummies: { category: 'Fun & games', label: 'Target dummies', hint: 'Straw dummies with targets on their chests, for target practice', ...pfp('Target dummies', [num('n', 'Dummies', 1, 8, 3), num('gap', 'Spacing', 2, 10, 4, 0.5)], (L, p) => row(L, +p.n, +p.gap, (M) => [
    box('Dummy base', [1.6, 0.3, 1.6], M(0, 0, 0), PB.wood), cyl('Dummy post', 0.3, 1.7, M(0, 0.3, 0), PB.wood, PB.wood, 6),
    { ...box('Dummy body', [1.4, 1.8, 0.6], M(0, 2, 0), STRAW), bevel: 0.25 }, box('Arms', [2.6, 0.4, 0.4], M(0, 3.1, 0), STRAW),
    { ...cyl('Dummy head', 0.85, 0.8, M(0, 3.8, 0), STRAW, STRAW, 10), taper: 0.8 }, lying('Target', 0.9, 0.06, M(0, 2.5, 0.3), TARGET, TARGET, 16, 90),
  ])) },
  shootingrange: { category: 'Fun & games', label: 'Shooting range', hint: 'Booths at a counter, lanes with targets downrange and an earth backstop', ...pfp('Shooting range', [num('n', 'Lanes', 1, 8, 4), num('len', 'Range length', 16, 80, 36, 2)], (L, p) => {
    const n = Math.round(+p.n), len = +p.len, LW = 5, W = n * LW
    const parts: Part[] = [
      box('Counter', [W, 2.2, 1.2], L(0, 0, 0), PB.wood, PB.concrete), box('Range floor', [W, 0.1, len], L(0, 0, -0.6 - len / 2), PB.gravel),
      box('Backstop', [W + 4, 8, 4], L(0, 0, -len - 2.6), BERM, BERM), box('Booth roof', [W + 0.4, 0.4, 5], L(0, 6, 2), PB.corrugated, PB.steel),
      ...[-1, 1].flatMap((s) => [box('Roof post', [0.4, 6, 0.4], L(s * (W / 2), 0, 4.2), PB.steel), box('Roof post', [0.4, 3.8, 0.4], L(s * (W / 2), 2.2, -0.3), PB.steel)]),
    ]
    for (let i = 0; i <= n; i++) parts.push(box('Booth divider', [0.25, 5, 3.2], L(-W / 2 + i * LW, 0, 2.4), PB.plywood))
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + LW / 2 + i * LW
      parts.push(box('Target stand', [0.2, 4.4, 0.2], L(x - 1.3, 0, -len + 2), PB.wood), box('Target stand', [0.2, 4.4, 0.2], L(x + 1.3, 0, -len + 2), PB.wood),
        box('Target board', [2.4, 3, 0.15], L(x, 1.4, -len + 2), PB.plywood, TARGET), box('Lane number', [0.8, 0.8, 0.1], L(x, 5.2, 0.5), WHITE, PB.black))
    }
    return parts
  }) },
  kothtiers: { category: 'Fun & games', label: 'King of the hill tiers', hint: 'A stepped pyramid of four tiers with stairs up every side and a flag on top', ...pfp('KOTH tiers', [num('size', 'Base size', 20, 48, 28, 2), teamParam('yellow')], (L, p) => {
    const S = +p.size, h = 1.8, n = stepsFor(h), run = n * 0.9
    // Each tier leaves room on the one below for its stairs.
    const sizes: number[] = []
    for (let s = S; s >= 5 && sizes.length < 4; s -= 2 * (run + 0.6)) sizes.push(s)
    const parts: Part[] = sizes.map((s, k) => box('Tier', [s, h, s], L(0, k * h, 0), k === sizes.length - 1 ? team(p) : PB.concrete, k % 2 ? PB.darkConcrete : PB.concrete))
    sizes.forEach((s, k) => {
      for (const [r, dx, dz] of [[0, 0, 1], [180, 0, -1], [90, 1, 0], [270, -1, 0]]) parts.push(stairs('Stairs', [4, h, run], L(dx * (s / 2 + run / 2), k * h, dz * (s / 2 + run / 2)), PB.concrete, team(p), r, n))
    })
    parts.push(...at(L, 0, 0, 0, (M) => flag(M, 0, 0, 8, team(p)), sizes.length * h))
    return parts
  }) },
  arenawall: { category: 'Fun & games', label: 'Arena wall', hint: 'A curved wall section round an arena; set the angle to 360 for a whole ring. Placed at the arena centre', ...pfp('Arena wall', [num('r', 'Radius', 12, 100, 30, 2), num('arc', 'Angle', 20, 360, 90, 10), num('h', 'Height', 2, 14, 6, 0.5), matParam('cyber')], (L, p) => {
    const r = +p.r, arc = +p.arc, h = +p.h, [side, cap] = mat(p)
    // Straight sections that meet at their outer corners.
    const k = Math.max(2, Math.ceil(((arc / 360) * 2 * Math.PI * r) / 6)), da = arc / k, seg = 2 * (r + 0.5) * Math.sin((da * Math.PI) / 360)
    return [...Array(k)].flatMap((_, i) => onArc(L, r, -arc / 2 + (i + 0.5) * da, (M) => [box('Arena wall', [seg, h, 1], M(0, 0, 0), cap, side)]))
  }) },
}

// ---------------- obstacles: parkour, jumps, mazes, tunnels, bridges ----------------

const PARKOUR: Record<string, [Tex, Tex]> = { concrete: [PB.concrete, PB.darkConcrete], cyber: [CY.gridCyan, CY.panel], paint: [PB.yellow, PB.blue], wood: [PB.planks, PB.wood] }
const parkourParam = (def: string) => sel('style', 'Style', [['concrete', 'Concrete'], ['cyber', 'Cyber'], ['paint', 'Bright paint'], ['wood', 'Wood']], def)
const pk = (p: Params) => PARKOUR[String(p.style)] ?? PARKOUR.concrete
const MAZE: Record<string, [Tex, Tex]> = { cyber: [CY.dark, CY.cyan], hedge: [LEAVES, LEAVES], concrete: [PB.cinder, PB.concrete], brick: [PB.brick, PB.concrete] }
const mazeParams = [num('h', 'Wall height', 3, 12, 7, 0.5), sel('style', 'Style', [['cyber', 'Cyber'], ['hedge', 'Hedge'], ['concrete', 'Concrete'], ['brick', 'Brick']], 'cyber')]
/** A 10 x 10 maze tile with walls on the given edges (n = −Z, s = +Z, w = −X, e = +X), kept inside the tile so tiles butt together. */
function mazeTile(L: Lf, p: Params, edges: string): Part[] {
  const T = 10, t = 0.5, h = +p.h, [side, top] = MAZE[String(p.style)] ?? MAZE.cyber
  const out: Part[] = [box('Maze floor', [T, 0.1, T], L(0, 0, 0), p.style === 'cyber' ? CY.fineGrid : PB.gravel)]
  if (edges.includes('n')) out.push(box('Maze wall', [T, h, t], L(0, 0, -T / 2 + t / 2), top, side))
  if (edges.includes('s')) out.push(box('Maze wall', [T, h, t], L(0, 0, T / 2 - t / 2), top, side))
  const z0 = -T / 2 + (edges.includes('n') ? t : 0), z1 = T / 2 - (edges.includes('s') ? t : 0)
  if (edges.includes('w')) out.push(box('Maze wall', [t, h, z1 - z0], L(-T / 2 + t / 2, 0, (z0 + z1) / 2), top, side))
  if (edges.includes('e')) out.push(box('Maze wall', [t, h, z1 - z0], L(T / 2 - t / 2, 0, (z0 + z1) / 2), top, side))
  if (!edges) out.push(...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box('Maze post', [t, h, t], L(a * (T / 2 - t / 2), 0, b * (T / 2 - t / 2)), top, side)))
  return out
}

const OBSTACLES: Record<string, PrefabDef & { category: string }> = {
  balancebeam: { category: 'Obstacles', label: 'Balance beam', hint: 'A narrow raised beam with steps at each end and crash mats below', ...pfp('Balance beam', [num('len', 'Length', 8, 40, 16, 2), num('h', 'Height', 1.2, 6, 2.4, 0.6)], (L, p) => {
    const len = +p.len, h = +p.h, n = stepsFor(h), posts = Math.max(2, Math.round(len / 5) + 1)
    return [
      box('Beam', [1, 0.4, len], L(0, h - 0.4, 0), HAZARD, PB.wood), ...[...Array(posts)].map((_, i) => box('Beam post', [0.5, h - 0.4, 0.5], L(0, 0, -len / 2 + 0.25 + (i * (len - 0.5)) / (posts - 1)), PB.steel)),
      stairs('Steps', [2, h, n * 0.9], L(0, 0, len / 2 + (n * 0.9) / 2), PB.wood, PB.wood, 0, n), stairs('Steps', [2, h, n * 0.9], L(0, 0, -len / 2 - (n * 0.9) / 2), PB.wood, PB.wood, 180, n),
      ...[-1, 1].map((s) => box('Crash mat', [3, 0.4, len], L(s * 2.2, 0, 0), MAT)),
    ]
  }) },
  climbingwall: { category: 'Obstacles', label: 'Climbing wall', hint: 'A wall with coloured holds, low enough to clamber up (3 m at most), a deck on top and steps down the back', ...pfp('Climbing wall', [num('h', 'Height', 3, 6, 6, 0.5), num('w', 'Width', 4, 20, 8)], (L, p) => {
    const h = +p.h, w = +p.w, n = stepsFor(h), holds = Math.max(4, Math.round(w * h / 5))
    return [
      box('Climbing wall', [w, h, 1], L(0, 0, 0), PB.plywood, PB.plywood), box('Top deck', [w, 0.4, 4], L(0, h - 0.4, -2.5), PB.planks, PB.wood),
      ...[-1, 1].map((s) => box('Deck post', [0.5, h - 0.4, 0.5], L(s * (w / 2 - 0.25), 0, -4.25), PB.wood)),
      ...[...Array(holds)].map((_, i) => ({ ...box('Hold', [0.5, 0.4, 0.3], L(-w / 2 + 0.6 + ((i * 2.618) % 1) * (w - 1.2), 0.5 + ((i * 0.618) % 1) * (h - 1), 0.62), HOLDS[i % HOLDS.length], HOLDS[i % HOLDS.length], (i * 37) % 90), bevel: 0.1 })),
      stairs('Steps', [3, h, n * 0.9], L(w / 2 - 1.5, 0, -4.5 - (n * 0.9) / 2), PB.wood, PB.wood, 180, n), box('Crash mat', [w, 0.4, 3], L(0, 0, 2), MAT),
    ]
  }) },
  monkeybars: { category: 'Obstacles', label: 'Monkey bars', hint: 'Rungs between two platforms with steps: walk the rungs across, or drop off', ...pfp('Monkey bars', [num('len', 'Span', 6, 24, 12, 1), num('h', 'Height', 3, 8, 4, 0.5)], (L, p) => {
    const len = +p.len, h = +p.h, n = stepsFor(h), rungs = Math.max(2, Math.round(len / 0.9))
    return [
      ...[-1, 1].flatMap((s) => [
        box('Platform', [4, 0.4, 4], L(0, h - 0.4, s * (len / 2 + 2)), PB.planks, PB.wood), ...posts4((dx, dy, dz) => L(dx, dy, s * (len / 2 + 2) + dz), 4, 4, h - 0.4, PB.steel, 0.3),
        stairs('Steps', [3, h, n * 0.9], L(0, 0, s * (len / 2 + 4 + (n * 0.9) / 2)), PB.wood, PB.wood, s > 0 ? 0 : 180, n),
        box('Side rail', [0.3, 0.3, len + 0.4], L(s * 1.5, h - 0.3, 0), PB.yellow),
      ]),
      ...[...Array(rungs)].map((_, i) => box('Rung', [3, 0.25, 0.3], L(0, h - 0.25, -len / 2 + 0.45 + (i * (len - 0.9)) / (rungs - 1)), PB.steel)),
    ]
  }) },
  tirerun: { category: 'Obstacles', label: 'Tire run', hint: 'Two staggered rows of tyres lying flat: high-knees through them', ...pfp('Tire run', [num('n', 'Tyres per row', 3, 12, 6)], (L, p) => {
    const n = Math.round(+p.n)
    return [-1, 1].flatMap((s) => [...Array(n)].flatMap((_, i) => {
      const x = s * 1.15, z = (i - (n - 1) / 2) * 2.3 + (s > 0 ? 1.15 : 0)
      return [cyl('Tyre', 2.2, 0.8, L(x, 0, z), PB.tire, PB.tire, 14), cyl('Tyre hole', 1.1, 0.82, L(x, 0, z), PB.black, PB.tire, 12)]
    }))
  }) },
  steppingstones: { category: 'Obstacles', label: 'Jump puzzle', hint: 'Stepping-stone pillars climbing in a zigzag, each a short jump from the last, with a flag on the top one', ...pfp('Jump puzzle', [num('n', 'Stones', 3, 20, 8), num('rise', 'Rise per stone', 0, 1.4, 0.8, 0.1), num('gap', 'Gap', 0.5, 4, 2, 0.5), parkourParam('cyber')], (L, p) => {
    const n = Math.round(+p.n), rise = +p.rise, gap = +p.gap, [a, b] = pk(p)
    const parts: Part[] = []
    for (let i = 0; i < n; i++) {
      const last = i === n - 1, s = last ? 5 : 3, h = 1 + i * rise, z = -i * (3 + gap) - (last ? 1 : 0)
      parts.push({ ...box(last ? 'Goal stone' : 'Stone', [s, h, s], L(i % 2 ? 1.5 : -1.5, 0, z), i % 2 ? b : a, PB.darkConcrete), bevel: 0.15 })
      if (last) parts.push(...flag((dx, dy, dz) => L(dx, dy + h, dz), i % 2 ? 1.5 : -1.5, z, 6, PB.yellow))
    }
    return parts
  }) },
  parkourblocks: { category: 'Obstacles', label: 'Parkour blocks', hint: 'Blocks from knee to 3 m high, laid out to vault, climb and leap between', ...pfp('Parkour blocks', [parkourParam('paint')], (L, p) => {
    const [a, b] = pk(p)
    // [x, z, w, d, h]: a climb up from the front, a gap leap, a high wall to clamber and a vault box.
    const blocks: [number, number, number, number, number][] = [
      [0, 8, 4, 3, 1.2], [0, 5, 4, 3, 2.4], [0, 2, 4, 3, 3.6], [4.5, 2, 3, 3, 4.8], [9, 2, 4, 4, 6], [9, -3.5, 4, 3, 4.8], [9, -8.5, 3, 3, 3.6],
      [3.5, -8.5, 4, 3, 3.6], [-2, -8.5, 3, 3, 2.4], [-6, -5, 3, 6, 1.6], [-6, 2, 2, 8, 6], [-10, 6, 3, 3, 1.2],
    ]
    return [...blocks.map(([x, z, w, d, h], i) => ({ ...box('Parkour block', [w, h, d], L(x, 0, z), i % 2 ? b : a, PB.darkConcrete), bevel: 0.1 })),
      ramp('Ramp', [3, 1.6, 4], L(-9.5, 0, -5), a, PB.darkConcrete, 270)]
  }) },
  jumpgap: { category: 'Obstacles', label: 'Jump gap', hint: 'A launch ramp and a landing ramp with a gap between: jump it on foot or in a car (drive toward −Z)', ...pfp('Jump gap', [num('h', 'Ramp height', 1.5, 8, 4, 0.5), num('gap', 'Gap', 2, 50, 16, 1), num('w', 'Width', 4, 16, 8)], (L, p) => {
    const h = +p.h, gap = +p.gap, w = +p.w, l1 = h * 2.5, l2 = h * 3.5
    return [
      ramp('Launch ramp', [w, h, l1], L(0, 0, gap / 2 + l1 / 2), HAZARD, PB.steel), ramp('Landing ramp', [w, h * 0.8, l2], L(0, 0, -gap / 2 - l2 / 2), PB.steel, PB.steel, 180),
      ...[-1, 1].map((s) => box('Edge marker', [0.4, 0.4, 0.4], L(s * (w / 2 - 0.2), h - 0.3, gap / 2 + 0.2), PB.orange)),
    ]
  }) },
  bankedturn: { category: 'Obstacles', label: 'Banked turn', hint: 'A quarter-circle of banked track for cars, rising toward the outside; placed at the centre of the turn', ...pfp('Banked turn', [num('r', 'Radius', 12, 60, 24, 2), num('w', 'Track width', 6, 20, 10), num('h', 'Bank height', 1, 8, 3, 0.5)], (L, p) => {
    const r = +p.r, w = +p.w, h = +p.h, k = 9, da = 90 / k, seg = 2 * (r + w / 2) * Math.sin((da * Math.PI) / 360) + 0.4
    return [...Array(k)].flatMap((_, i) => onArc(L, r, (i + 0.5) * da, (M) => [ramp('Banked track', [seg, h, w], M(0, 0, 0), PB.asphalt, PB.concrete)]))
  }) },
  quarterpipe: { category: 'Obstacles', label: 'Quarter pipe', hint: 'A curved ramp that steepens toward the top, with a deck behind', ...pfp('Quarter pipe', [num('h', 'Height', 2, 10, 5, 0.5), num('w', 'Width', 4, 24, 10)], (L, p) => {
    const h = +p.h, w = +p.w, k = 6, ys = [...Array(k + 1)].map((_, i) => h - Math.sqrt(Math.max(0, h * h - ((i * h) / k) ** 2)))
    const parts: Part[] = []
    for (let i = 0; i < k; i++) {
      const z = h / 2 - ((i + 0.5) * h) / k, dz = h / k
      if (ys[i] > 0.01) parts.push(box('Pipe base', [w, ys[i], dz], L(0, 0, z), PB.concrete))
      parts.push(ramp('Pipe', [w, ys[i + 1] - ys[i], dz], L(0, ys[i], z), PB.concrete, PB.concrete))
    }
    parts.push(box('Deck', [w, h, 3], L(0, 0, -h / 2 - 1.5), PB.concrete), box('Coping', [w, 0.3, 0.3], L(0, h, -h / 2 - 0.15), PB.steel))
    return parts
  }) },
  tunnel: { category: 'Obstacles', label: 'Tunnel', hint: 'A straight covered tunnel, wide enough for cars, with lights along the ceiling', ...pfp('Tunnel', [num('len', 'Length', 8, 80, 24, 2), num('w', 'Width', 6, 24, 12), num('h', 'Height', 5, 14, 8, 0.5), sel('mat', 'Material', [['concrete', 'Concrete'], ['brick', 'Brick'], ['metal', 'Metal'], ['cyber', 'Cyber']], 'concrete')], (L, p) => {
    const len = +p.len, w = +p.w, h = +p.h, [side, cap] = mat(p)
    return [
      ...[-1, 1].map((s) => box('Tunnel wall', [1, h, len], L(s * (w / 2 + 0.5), 0, 0), cap, side)), box('Tunnel roof', [w + 2, 1, len], L(0, h, 0), cap, side),
      box('Ceiling lights', [0.5, 0.15, len - 2], L(0, h - 0.15, 0), p.mat === 'cyber' ? CY.cyan : CY.white),
      ...[-1, 1].map((s) => box('Portal', [w + 3, 1.6, 0.8], L(0, h - 0.6, s * (len / 2 + 0.4)), cap, cap)),
    ]
  }) },
  tunnelbend: { category: 'Obstacles', label: 'Tunnel bend', hint: 'A quarter turn of covered tunnel, to join straight tunnels; placed at the centre of the turn', ...pfp('Tunnel bend', [num('r', 'Radius', 10, 50, 20, 2), num('w', 'Width', 6, 24, 12), num('h', 'Height', 5, 14, 8, 0.5), sel('mat', 'Material', [['concrete', 'Concrete'], ['brick', 'Brick'], ['metal', 'Metal'], ['cyber', 'Cyber']], 'concrete')], (L, p) => {
    const r = +p.r, w = +p.w, h = +p.h, [side, cap] = mat(p), k = 9, da = 90 / k
    const chord = (rr: number) => 2 * rr * Math.sin((da * Math.PI) / 360) + 0.3
    return [...Array(k)].flatMap((_, i) => {
      const a = (i + 0.5) * da
      return [
        ...onArc(L, r - w / 2 - 0.5, a, (M) => [box('Tunnel wall', [chord(r - w / 2), h, 1], M(0, 0, 0), cap, side)]),
        ...onArc(L, r + w / 2 + 0.5, a, (M) => [box('Tunnel wall', [chord(r + w / 2 + 1), h, 1], M(0, 0, 0), cap, side)]),
        ...onArc(L, r, a, (M) => [box('Tunnel roof', [chord(r + w / 2 + 1), 1, w + 2], M(0, h, 0), cap, side), box('Ceiling lights', [chord(r), 0.15, 0.5], M(0, h - 0.15, 0), p.mat === 'cyber' ? CY.cyan : CY.white)]),
      ]
    })
  }) },
  mazestraight: { category: 'Obstacles', label: 'Maze corridor', hint: 'Maze kit, 10 x 10 tile: a straight corridor along Z. Tiles butt together on a 10 grid', ...pfp('Maze corridor', mazeParams, (L, p) => mazeTile(L, p, 'we')) },
  mazecorner: { category: 'Obstacles', label: 'Maze corner', hint: 'Maze kit, 10 x 10 tile: a corner from +Z round to +X', ...pfp('Maze corner', mazeParams, (L, p) => mazeTile(L, p, 'nw')) },
  mazet: { category: 'Obstacles', label: 'Maze T-junction', hint: 'Maze kit, 10 x 10 tile: open on three sides, a wall at −Z', ...pfp('Maze T', mazeParams, (L, p) => mazeTile(L, p, 'n')) },
  mazecross: { category: 'Obstacles', label: 'Maze crossing', hint: 'Maze kit, 10 x 10 tile: open on all four sides, posts at the corners', ...pfp('Maze cross', mazeParams, (L, p) => mazeTile(L, p, '')) },
  mazedeadend: { category: 'Obstacles', label: 'Maze dead end', hint: 'Maze kit, 10 x 10 tile: walled on three sides, open at +Z', ...pfp('Maze dead end', mazeParams, (L, p) => mazeTile(L, p, 'nwe')) },
  ropebridge: { category: 'Obstacles', label: 'Rope bridge', hint: 'A sagging plank bridge with rope rails between two platforms with steps', ...pfp('Rope bridge', [num('len', 'Span', 8, 48, 16, 2), num('h', 'Height', 3, 14, 6, 0.5)], (L, p) => {
    const len = +p.len, h = +p.h, n = stepsFor(h), sag = Math.min(1.2, len / 20), planks = Math.max(4, Math.round(len / 0.9)), posts = Math.max(2, Math.round(len / 4) + 1)
    const dip = (z: number) => sag * (1 - (2 * z / len) ** 2)
    return [
      ...[-1, 1].flatMap((s) => [
        box('Platform', [5, 0.5, 5], L(0, h - 0.5, s * (len / 2 + 2.5)), PB.planks, PB.wood), ...posts4((dx, dy, dz) => L(dx, dy, s * (len / 2 + 2.5) + dz), 5, 5, h - 0.5, PB.wood, 0.5),
        stairs('Steps', [3, h, n * 0.9], L(0, 0, s * (len / 2 + 5 + (n * 0.9) / 2)), PB.wood, PB.wood, s > 0 ? 0 : 180, n),
      ]),
      ...[...Array(planks)].map((_, i) => { const z = -len / 2 + 0.45 + (i * (len - 0.9)) / (planks - 1); return box('Plank', [3, 0.25, 0.8], L(0, h - 0.25 - dip(z), z), PB.planks, PB.wood, (i % 3) - 1) }),
      ...[-1, 1].flatMap((s) => [...Array(posts)].flatMap((_, i) => {
        const z = -len / 2 + (i * len) / (posts - 1), y = h - 0.25 - dip(z), z2 = -len / 2 + ((i + 1) * len) / (posts - 1)
        return [box('Rope post', [0.25, 2.4, 0.25], L(s * 1.6, y, z), PB.wood), ...(i < posts - 1 ? [box('Rope', [0.15, 0.15, z2 - z], L(s * 1.6, h + 1.95 - (dip(z) + dip(z2)) / 2, (z + z2) / 2), ROPE)] : [])]
      })),
    ]
  }) },
  girderbridge: { category: 'Obstacles', label: 'Girder bridge', hint: 'A steel girder bridge for cars and players, ramps at both ends, high enough to walk under', ...pfp('Girder bridge', [num('len', 'Span', 12, 80, 30, 2), num('w', 'Width', 6, 20, 10), num('h', 'Deck height', 5.5, 12, 6, 0.5)], (L, p) => {
    const len = +p.len, w = +p.w, h = +p.h, rl = h * 3, stiff = Math.max(2, Math.round(len / 4))
    return [
      box('Deck', [w, 0.6, len], L(0, h - 0.6, 0), PB.asphalt, PB.steel),
      ...[-1, 1].flatMap((s) => [
        box('Girder', [0.8, 2.6, len], L(s * (w / 2 + 0.4), h - 1.2, 0), GIRDER), box('Girder flange', [1.4, 0.3, len], L(s * (w / 2 + 0.4), h + 1.4, 0), GIRDER),
        ...[...Array(stiff + 1)].map((_, i) => box('Stiffener', [0.3, 2.6, 0.3], L(s * (w / 2 + 0.95), h - 1.2, -len / 2 + (i * len) / stiff), GIRDER)),
        ramp('Ramp', [w, h, rl], L(0, 0, s * (len / 2 + rl / 2)), PB.asphalt, PB.concrete, s > 0 ? 0 : 180),
      ]),
      ...(len > 24 ? [box('Pier', [w, h - 0.6, 2], L(0, 0, 0), PB.concrete)] : []),
    ]
  }) },
  laddertower: { category: 'Obstacles', label: 'Lookout tower', hint: 'An open tower of platforms joined by steep ladder-like stairs, switching sides at every level', ...pfp('Lookout tower', [num('floors', 'Levels', 2, 6, 3), num('fh', 'Level height', 4, 6, 5, 0.5)], (L, p) => {
    // Flights end short of the corner posts, so players step off sideways onto each platform.
    const floors = Math.round(+p.floors), fh = +p.fh, S = 6, n = stepsFor(fh), run = Math.min(0.6, (S - 1.6) / n), top = floors * fh
    const parts: Part[] = [...posts4(L, S, S, top + 3.6, PB.steel, 0.5), box('Tower roof', [S + 1, 0.4, S + 1], L(0, top + 3.6, 0), PB.corrugated, PB.steel)]
    for (let k = 1; k <= floors; k++) parts.push(box('Platform', [S, 0.4, S], L(0, k * fh - 0.4, 0), PB.diamond, PB.steel))
    for (let k = 0; k < floors; k++) {
      const s = k % 2 ? -1 : 1
      parts.push(stairs('Steep stairs', [2.4, fh, n * run], L(s * (S / 2 + 1.2), k * fh, 0), PB.diamond, PB.steel, k % 2 ? 180 : 0, n),
        // A rail across the top end: step off sideways onto the platform, not straight off the stairs.
        box('Stop rail', [2.4, 1.8, 0.2], L(s * (S / 2 + 1.2), (k + 1) * fh, (k % 2 ? 1 : -1) * ((n * run) / 2 + 0.1)), PB.yellow),
        box('Rail post', [0.2, fh + 1.8, 0.2], L(s * (S / 2 + 2.3), k * fh, (k % 2 ? 1 : -1) * ((n * run) / 2 + 0.1)), PB.steel))
    }
    parts.push(...[-1, 1].map((t) => box('Top rail', [S, 1.2, 0.2], L(0, top, t * (S / 2 - 0.1)), PB.yellow)))
    return parts
  }) },
}

export const GAMEPLAY_PREFABS: Record<string, PrefabDef & { category: string }> = { ...COVER, ...TEAM, ...OBSTACLES }
