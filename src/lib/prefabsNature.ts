// Nature and landscape prefabs: tree kinds, palms, cacti, hedges and garden
// beds, grass and reeds, rocks, cliffs, a cave, dunes and mounds, log piles,
// and outdoor scenes (campfire, beach, picnic, a tree line for map edges).
// Shapes only turn about the vertical, so trunks and logs lie flat or stand
// upright; crowns are stacked, tapered cylinders like the street tree.
import { CY, PB, blob, box, cyl, lying, organic, turn, type Part, type Tex } from './sampleKit'
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

const num = (key: string, label: string, min: number, max: number, def: number, step = 1): ParamDef => ({ key, label, kind: 'number', min, max, step, default: def })
const sel = (key: string, label: string, options: [string, string][], def: string): ParamDef => ({ key, label, kind: 'select', options, default: def })
const sizeParam = (def = 1) => num('size', 'Size', 0.5, 3, def, 0.1)
const seedParam = (def: number) => num('seed', 'Variation', 1, 99, def)

/** Repeatable pseudo-random numbers in [0, 1) from a seed. */
const rng = (seed: number) => {
  let s = (Math.abs(Math.round(seed)) * 7919 + 104729) % 233280 || 1
  return () => (s = (s * 9301 + 49297) % 233280) / 233280
}

// ---------------- materials ----------------

const leaves = (color: string, accent: string, seed: number): Tex => ({ gen: 'grass', tweak: { color, accent, scale: 3, wear: 0.25, seed }, surface: 7 })
const LEAVES: Tex = { gen: 'grass', tweak: { color: '#2f5e22', accent: '#4c7a2a', scale: 3, wear: 0.2, seed: 84 }, surface: 7 }
const LEAVES2: Tex = { gen: 'grass', tweak: { color: '#3d6e28', accent: '#6a8a34', scale: 3, wear: 0.3, seed: 331 }, surface: 7 }
const BARK: Tex = { gen: 'wood_planks', tweak: { color: '#5a3f2a', accent: '#3a2818', scale: 3, seed: 85 } }
const PALM: Tex = { gen: 'grass', tweak: { color: '#3f7a2a', accent: '#8a9a3a', scale: 6, wear: 0.3, seed: 350 }, surface: 7 }
const LOG_END: Tex = { gen: 'wood_planks', tweak: { color: '#b08a5a', accent: '#7a5a38', scale: 1, seed: 337 } }
const DEAD: Tex = { gen: 'wood_planks', tweak: { color: '#6a6058', accent: '#3a332e', scale: 3, seed: 351 } }
const ROCK: Tex = { lib: 'rock_face_03', surface: 0 }
const STONE: Tex = { lib: 'medieval_blocks_03', surface: 0 }
const MUD: Tex = { gen: 'dirt', tweak: { color: '#4a3a2a', accent: '#2e241a', wear: 0.4, seed: 338 } }
const REED: Tex = { gen: 'grass', tweak: { color: '#5d7a2c', accent: '#3d5a1c', scale: 2, wear: 0.2, seed: 339 }, surface: 7 }
const POND_WATER: Tex = { gen: 'water', tweak: { color: '#2a5a52', accent: '#9cc4b8', seed: 340 }, surface: 20 }

const AUTUMN: Record<string, [Tex, Tex]> = {
  green: [LEAVES, LEAVES2],
  red: [leaves('#9a2a1e', '#c8502a', 601), leaves('#b8381e', '#d8782a', 602)],
  orange: [leaves('#c86a1a', '#e09a2a', 603), leaves('#d8862a', '#b85a1a', 604)],
  yellow: [leaves('#c8a81e', '#e0c84a', 605), leaves('#b8981a', '#8a9a2a', 606)],
}
const leafParam = (def: string) => sel('leaves', 'Leaves', [['green', 'Summer green'], ['red', 'Autumn red'], ['orange', 'Autumn orange'], ['yellow', 'Autumn yellow']], def)
const leafTex = (p: Params) => AUTUMN[String(p.leaves)] ?? AUTUMN.green

const BIRCH: Tex = { gen: 'wood_planks', tweak: { color: '#e4e0d4', accent: '#2a2826', scale: 8, wear: 0.5, seed: 607 } }
const BIRCH_LEAVES = leaves('#5a8a2e', '#9ab040', 608)
const WILLOW = leaves('#6a8a34', '#a0b048', 609)
const CYPRESS = leaves('#1e3e1a', '#2e5a22', 610)
const PALM_BARK: Tex = { gen: 'wood_planks', tweak: { color: '#8a7255', accent: '#5a4630', scale: 10, seed: 611 } }
const COCONUT: Tex = { gen: 'wood_planks', tweak: { color: '#5a4026', accent: '#3a2816', scale: 2, seed: 612 } }
const CACTUS: Tex = { gen: 'grass', tweak: { color: '#3f6e3a', accent: '#6a8a52', scale: 8, wear: 0.15, seed: 613 }, surface: 7 }
const PEAR: Tex = { gen: 'grass', tweak: { color: '#5a8a3a', accent: '#8aa04a', scale: 3, wear: 0.2, seed: 614 }, surface: 7 }
const BLOOM: Tex = { gen: 'paint', tweak: { color: '#e04a8a', accent: '#b02a6a', scale: 2, wear: 0, seed: 615 }, surface: 17 }
const MULCH: Tex = { gen: 'dirt', tweak: { color: '#5a3a22', accent: '#3a2414', scale: 6, wear: 0.6, seed: 616 } }
const SOIL: Tex = { gen: 'dirt', tweak: { color: '#3e2c1e', accent: '#5a4430', scale: 8, wear: 0.5, seed: 617 } }
const LAWN: Tex = { gen: 'grass', tweak: { color: '#4a8a2e', accent: '#6aa03a', scale: 4, wear: 0.15, seed: 618 }, surface: 11 }
const DRY_GRASS: Tex = { gen: 'grass', tweak: { color: '#a89a4a', accent: '#7a8a3a', scale: 2, wear: 0.4, seed: 619 }, surface: 7 }
const CATTAIL: Tex = { gen: 'wood_planks', tweak: { color: '#5a3a1e', accent: '#3a2412', scale: 2, seed: 620 } }
const LILY: Tex = { gen: 'grass', tweak: { color: '#3a7a2a', accent: '#5a9a3a', scale: 2, wear: 0.1, seed: 621 }, surface: 7 }
const SAND: Tex = { gen: 'sand', tweak: { color: '#d8bf8a', accent: '#b09a68', scale: 6, wear: 0.4, seed: 622 } }
const RED_SAND: Tex = { gen: 'sand', tweak: { color: '#c08050', accent: '#9a6038', scale: 6, wear: 0.4, seed: 623 } }
const GRASSY_ROCK: Tex = { lib: 'aerial_grass_rock', surface: 0 }
const CAVE_DARK: Tex = { gen: 'concrete', tweak: { color: '#2a2622', accent: '#1a1714', wear: 0.6, seed: 624 } }
const MOSS = leaves('#3a5a22', '#5a7a2e', 625)
const MUSH_CAP: Tex = { gen: 'paint', tweak: { color: '#c42a1e', accent: '#f0e8d8', scale: 3, wear: 0.6, seed: 626 }, surface: 17 }
const MUSH_BROWN: Tex = { gen: 'paint', tweak: { color: '#8a5a32', accent: '#b08a5a', scale: 3, wear: 0.4, seed: 627 }, surface: 17 }
const MUSH_STEM: Tex = { gen: 'paint', tweak: { color: '#ece4d2', accent: '#d8ccb4', scale: 2, wear: 0.1, seed: 628 }, surface: 17 }
const BAMBOO: Tex = { gen: 'wood_planks', tweak: { color: '#8aa03a', accent: '#5a7a22', scale: 1, wear: 0.2, seed: 629 } }
const BAMBOO_LEAVES = leaves('#4a8a2a', '#7aaa3a', 630)
const EMBER: Tex = CY.orange
const ASH: Tex = { gen: 'concrete', tweak: { color: '#3a3634', accent: '#1e1c1a', wear: 0.7, seed: 631 } }
const solid = (color: string, accent: string, seed: number): Tex => ({ gen: 'paint', tweak: { color, accent, scale: 2, wear: 0.06, seed }, surface: 17 })
const WHITE = solid('#eeece6', '#d4d0c6', 632)
const CHECKER: Tex = { gen: 'tiles', tweak: { color: '#c8282a', accent: '#f2eee6', scale: 6, wear: 0.05, seed: 633 }, surface: 17 }
const WICKER: Tex = { gen: 'wood_planks', tweak: { color: '#b88a4a', accent: '#8a6030', scale: 10, seed: 634 } }
const STRIPES: Record<string, Tex> = {
  red: { gen: 'hazard', tweak: { color: '#d8322b', accent: '#f2eee6', scale: 6, wear: 0, seed: 635 } },
  blue: { gen: 'hazard', tweak: { color: '#2a6fe0', accent: '#f2eee6', scale: 6, wear: 0, seed: 636 } },
  yellow: { gen: 'hazard', tweak: { color: '#f2c218', accent: '#f2eee6', scale: 6, wear: 0, seed: 637 } },
  green: { gen: 'hazard', tweak: { color: '#2fbf4a', accent: '#f2eee6', scale: 6, wear: 0, seed: 638 } },
}
const TOWELS: Tex[] = [solid('#2a8fd0', '#1a6aa0', 639), solid('#f07a1a', '#c05a10', 640), solid('#e04a8a', '#b02a6a', 641)]

const FLOWER_TEX: Record<string, Tex> = {
  pink: { gen: 'grass', tweak: { color: '#3d6e28', accent: '#d24a8a', scale: 8, wear: 0.8, seed: 353 }, surface: 7 },
  red: { gen: 'grass', tweak: { color: '#3d6e28', accent: '#c8282a', scale: 8, wear: 0.8, seed: 642 }, surface: 7 },
  yellow: { gen: 'grass', tweak: { color: '#3d6e28', accent: '#e8c020', scale: 8, wear: 0.8, seed: 643 }, surface: 7 },
  white: { gen: 'grass', tweak: { color: '#3d6e28', accent: '#f0eee8', scale: 8, wear: 0.8, seed: 644 }, surface: 7 },
  purple: { gen: 'grass', tweak: { color: '#3d6e28', accent: '#8a4ac8', scale: 8, wear: 0.8, seed: 645 }, surface: 7 },
}
const flowerParam = (def: string) => sel('flowers', 'Flowers', [['pink', 'Pink'], ['red', 'Red'], ['yellow', 'Yellow'], ['white', 'White'], ['purple', 'Purple']], def)
const flowerTex = (p: Params) => FLOWER_TEX[String(p.flowers)] ?? FLOWER_TEX.pink

// ---------------- building blocks ----------------

/** A round, tapered mass (crown, bush, rock, mound): a cylinder with its own width and depth. */
const mass = (L: Lf, label: string, w: number, h: number, d: number, x: number, y: number, z: number, tex: Tex, taper: number, sides = 10, yaw = 0, side: Tex = tex): Part =>
  ({ ...cyl(label, w, h, L(x, y, z), tex, side, sides, yaw), size: [w, h, d], taper })

const rock = (L: Lf, x: number, z: number, w: number, h: number, d: number, yaw: number, y = 0, tex = ROCK): Part => mass(L, 'Rock', w, h, d, x, y, z, tex, 0.55, 6, yaw)

/** A palm head: a ring of fronds stepping down at the tips, a crown and coconuts. */
function palmTop(L: Lf, x: number, y: number, z: number, s: number, frond = 5): Part[] {
  const out: Part[] = [{ ...cyl('Palm crown', 1.5 * s, 1.1 * s, L(x, y - 0.8 * s, z), PALM, PALM, 8), taper: 0.5 }]
  for (let k = 0; k < 8; k++) {
    const a = k * 45 + 10
    const [ox, oz] = turn(0, frond * s * 0.5 + 0.3, a)
    const [tx, tz] = turn(0, frond * s * 1.1 + 0.3, a)
    out.push(box('Frond', [0.9 * s, 0.18, frond * s], L(x + ox, y + 0.16, z + oz), PALM, PALM, a))
    out.push(box('Frond tip', [0.7 * s, 0.16, frond * s * 0.45], L(x + tx, y, z + tz), PALM, PALM, a))
  }
  for (const a of [0, 120, 240]) {
    const [cx, cz] = turn(0, 0.55 * s, a)
    out.push(cyl('Coconut', 0.55 * s, 0.55 * s, L(x + cx, y - 1.0 * s, z + cz), COCONUT, COCONUT, 6))
  }
  return out
}

/** A palm whose ringed trunk bends `lean` units to +X over its height. */
function palm(L: Lf, h: number, lean: number, s = 1, frond = 5): Part[] {
  const n = 5, seg = h / n
  const off = (k: number) => lean * (k / n) ** 2
  const out: Part[] = [...Array(n)].map((_, k) => ({ ...cyl('Palm trunk', (1.1 - k * 0.07) * s, seg + 0.05, L(off(k), k * seg, 0), PALM_BARK, PALM_BARK, 8), taper: 0.92 }))
  return [...out, ...palmTop(L, off(n), h + 0.6 * s, 0, s, frond)]
}

/** A hedge wall `len` long along X. */
const hedge = (L: Lf, len: number, h: number, x: number, z: number, along: 'x' | 'z' = 'x', tex = LEAVES): Part =>
  ({ ...box('Hedge', along === 'x' ? [len, h, 1.8] : [1.8, h, len], L(x, 0, z), tex, tex), bevel: 0.4 })

/** A shrub: two stacked rounded masses. */
const shrub = (L: Lf, x: number, z: number, s: number, tex = LEAVES, top: Tex = LEAVES2): Part[] => [
  mass(L, 'Shrub', 2.6 * s, 1 * s, 2.6 * s, x, 0, z, tex, 1.25, 9),
  mass(L, 'Shrub', 3.2 * s, 1.2 * s, 3.2 * s, x, 1 * s, z, top, 0.35, 9),
]

/** A leafy tree in the backdrop style: trunk and two crowns. */
const backTree = (L: Lf, x: number, z: number, h: number, pine: boolean): Part[] => pine
  ? [{ ...cyl('Trunk', 0.7, h * 0.25, L(x, 0, z), BARK, BARK, 6), taper: 0.7 }, mass(L, 'Pine', h * 0.42, h * 0.8, h * 0.42, x, h * 0.2, z, CYPRESS, 0.05, 8)]
  : [{ ...cyl('Trunk', 0.8, h * 0.45, L(x, 0, z), BARK, BARK, 6), taper: 0.7 }, mass(L, 'Crown', h * 0.55, h * 0.35, h * 0.55, x, h * 0.35, z, LEAVES2, 1.15, 9), mass(L, 'Crown', h * 0.62, h * 0.35, h * 0.62, x, h * 0.7, z, LEAVES, 0.35, 9)]

// Hedge maze tile: which sides of the 20 × 20 tile are open (a 8-wide gap).
const MAZE: Record<string, string> = { straight: 'NS', corner: 'SE', tee: 'SEW', cross: 'NSEW', deadend: 'S', closed: '' }

// ---------------- prefabs ----------------

export const NATURE_PREFABS: Record<string, PrefabDef & { category: string }> = {
  // ---- trees ----
  oak: { category: 'Nature', label: 'Oak tree', hint: 'A broad oak with a wide, lumpy crown', ...pfp('Oak', [sizeParam(1), leafParam('green')], (L, p) => {
    const s = +p.size, [a, b] = leafTex(p)
    return [
      { ...cyl('Root flare', 2.4 * s, 0.7 * s, L(0, 0, 0), BARK, BARK, 8), taper: 0.6 },
      { ...cyl('Trunk', 1.5 * s, 5 * s, L(0, 0.6 * s, 0), BARK, BARK, 8), taper: 0.65 },
      box('Branch', [0.5 * s, 0.5 * s, 3.4 * s], L(1.2 * s, 4.2 * s, 0.6 * s), BARK, BARK, 60), box('Branch', [0.45 * s, 0.45 * s, 3 * s], L(-1 * s, 4.6 * s, -0.8 * s), BARK, BARK, 230),
      mass(L, 'Crown', 6.5 * s, 1.6 * s, 6 * s, 0, 4.6 * s, 0, b, 1.4, 10),
      mass(L, 'Crown', 9 * s, 2.6 * s, 8.4 * s, 0, 6.2 * s, 0, a, 0.8, 10),
      mass(L, 'Crown', 7.2 * s, 2 * s, 6.8 * s, 0.3 * s, 8.8 * s, 0, b, 0.45, 10),
      mass(L, 'Crown', 4.6 * s, 2.4 * s, 4.2 * s, 3 * s, 6.4 * s, 1.2 * s, a, 0.5, 8),
      mass(L, 'Crown', 4.2 * s, 2.2 * s, 4.4 * s, -2.8 * s, 6.8 * s, -1.4 * s, b, 0.5, 8),
    ]
  }) },
  maple: { category: 'Nature', label: 'Maple tree', hint: 'A tall, round maple; pick summer or autumn leaves', ...pfp('Maple', [sizeParam(1), leafParam('red')], (L, p) => {
    const s = +p.size, [a, b] = leafTex(p)
    return [
      { ...cyl('Trunk', 1.1 * s, 5.6 * s, L(0, 0, 0), BARK, BARK, 8), taper: 0.6 },
      mass(L, 'Crown', 5 * s, 2 * s, 5 * s, 0, 4 * s, 0, b, 1.5, 10),
      mass(L, 'Crown', 7.6 * s, 3 * s, 7.4 * s, 0, 6 * s, 0, a, 0.85, 10),
      mass(L, 'Crown', 6.4 * s, 2.6 * s, 6.2 * s, 0, 9 * s, 0, b, 0.5, 10),
      mass(L, 'Crown', 3.2 * s, 1.4 * s, 3.2 * s, 0, 11.6 * s, 0, a, 0.2, 10),
    ]
  }) },
  birch: { category: 'Nature', label: 'Birch trees', hint: 'Two slim white-barked birches with light, airy crowns', ...pfp('Birch', [sizeParam(1)], (L, p) => {
    const s = +p.size
    const one = (x: number, z: number, k: number): Part[] => [
      { ...cyl('Birch trunk', 0.75 * s * k, 9.5 * s * k, L(x, 0, z), BIRCH, BIRCH, 8), taper: 0.55 },
      mass(L, 'Crown', 3.6 * s * k, 2.4 * s * k, 3.4 * s * k, x, 5 * s * k, z, BIRCH_LEAVES, 1.15, 9),
      mass(L, 'Crown', 4.2 * s * k, 3 * s * k, 4 * s * k, x, 7.4 * s * k, z, BIRCH_LEAVES, 0.55, 9),
      mass(L, 'Crown', 2.4 * s * k, 2 * s * k, 2.4 * s * k, x, 10.4 * s * k, z, BIRCH_LEAVES, 0.1, 9),
    ]
    return [...one(-1.2 * s, 0, 1), ...one(1.4 * s, 1 * s, 0.8)]
  }) },
  willow: { category: 'Nature', label: 'Weeping willow', hint: 'A willow whose leaves hang down like a curtain', ...pfp('Willow', [sizeParam(1)], (L, p) => {
    const s = +p.size
    return [
      { ...cyl('Trunk', 1.7 * s, 6 * s, L(0, 0, 0), BARK, BARK, 8), taper: 0.7 },
      mass(L, 'Hanging leaves', 10 * s, 4.4 * s, 10 * s, 0, 1.8 * s, 0, WILLOW, 0.86, 12),
      mass(L, 'Crown', 8.8 * s, 2.4 * s, 8.8 * s, 0, 6.2 * s, 0, WILLOW, 0.55, 12),
      mass(L, 'Crown', 4.6 * s, 1.2 * s, 4.6 * s, 0, 8.6 * s, 0, LEAVES2, 0.25, 10),
    ]
  }) },
  cypress: { category: 'Nature', label: 'Cypress', hint: 'A tall, narrow dark cypress for avenues and graveyards', ...pfp('Cypress', [sizeParam(1)], (L, p) => {
    const s = +p.size
    return [
      { ...cyl('Trunk', 0.7 * s, 1.6 * s, L(0, 0, 0), BARK, BARK, 6), taper: 0.8 },
      mass(L, 'Cypress', 3.2 * s, 4 * s, 3.2 * s, 0, 1.2 * s, 0, CYPRESS, 0.9, 9),
      mass(L, 'Cypress', 2.9 * s, 9 * s, 2.9 * s, 0, 5.2 * s, 0, CYPRESS, 0.12, 9),
    ]
  }) },
  palmtall: { category: 'Nature', label: 'Tall palm', hint: 'A tall palm with a curving ringed trunk', ...pfp('Tall palm', [num('h', 'Height', 8, 30, 16), num('lean', 'Lean', 0, 6, 2.5, 0.5)], (L, p) => palm(L, +p.h, +p.lean, 1, 5.5)) },
  palmcluster: { category: 'Nature', label: 'Palm cluster', hint: 'Three palms of different heights leaning apart', make: pf('Palm cluster', (L) => [
    ...at(L, 0, 0, 0, (M) => palm(M, 15, 2, 1, 5.2)),
    ...at(L, -1.6, 1, 140, (M) => palm(M, 11, 2.6, 0.9, 4.6)),
    ...at(L, 1, -1.6, 250, (M) => palm(M, 8, 1.6, 0.8, 4.2)),
  ]) },
  palmshort: { category: 'Nature', label: 'Fan palm', hint: 'A short, stout palm with a big head of fronds', make: pf('Fan palm', (L) => [
    { ...cyl('Palm trunk', 2, 2.4, L(0, 0, 0), PALM_BARK, PALM_BARK, 10), taper: 0.8 },
    { ...cyl('Palm trunk', 1.6, 1.6, L(0, 2.35, 0), PALM_BARK, PALM_BARK, 10), taper: 0.9 },
    ...palmTop(L, 0, 4.8, 0, 1.3, 4.6),
  ]) },
  fallentree: { category: 'Nature', label: 'Fallen tree', hint: 'A toppled trunk with its root plate up: cover to crouch behind', ...pfp('Fallen tree', [num('len', 'Length', 8, 30, 16)], (L, p) => {
    const len = +p.len
    return [
      lying('Root plate', 4.6, 1, L(-len / 2 - 0.4, 0, 0), MUD, MUD, 9),
      ...[-1, 1].map((k) => box('Root', [0.5, 0.5, 2.2], L(-len / 2 - 0.4, 0.4, k * 2.4), MUD, MUD, k * 20)),
      { ...lying('Fallen trunk', 1.8, len, L(0, 0, 0), LOG_END, BARK, 10), taper: 0.55 },
      box('Branch', [0.4, 0.4, 3], L(len * 0.1, 0.5, 1.8), DEAD, DEAD, 35), box('Branch', [0.35, 0.35, 2.6], L(len * 0.3, 0.4, -1.6), DEAD, DEAD, 150),
      mass(L, 'Dead leaves', 4, 1.2, 3.6, len / 2 + 1, 0, 0.4, DRY_GRASS, 0.5, 8),
    ]
  }) },
  stump: { category: 'Nature', label: 'Tree stump', hint: 'A cut stump with roots and an axe stuck in it', make: pf('Stump', (L) => [
    { ...cyl('Stump', 2.6, 1.6, L(0, 0, 0), LOG_END, BARK, 10), taper: 0.85 },
    ...[20, 110, 200, 290].map((a) => { const [x, z] = turn(0, 1.6, a); return { ...box('Root', [0.6, 0.5, 1.6], L(x, 0, z), BARK, BARK, a), bevel: 0.15 } }),
    box('Axe head', [0.15, 0.6, 0.9], L(0.2, 1.6, 0.1), PB.steel), box('Axe handle', [0.2, 0.2, 2.6], L(0.2, 2.0, -1.1), PB.wood),
  ]) },
  sapling: { category: 'Nature', label: 'Sapling in a guard', hint: 'A young street tree inside a post-and-rail guard', make: pf('Sapling', (L) => [
    cyl('Mulch', 3.4, 0.15, L(0, 0, 0), MULCH, MULCH, 12),
    { ...cyl('Sapling trunk', 0.35, 4.6, L(0, 0.15, 0), BARK, BARK, 6), taper: 0.7 },
    mass(L, 'Crown', 2.2, 1, 2.2, 0, 3, 0, LEAVES2, 1.3, 8), mass(L, 'Crown', 2.8, 1.6, 2.8, 0, 4, 0, LEAVES, 0.3, 8),
    ...[[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]].map(([a, b]) => box('Guard post', [0.25, 3.2, 0.25], L(a, 0, b), PB.wood)),
    ...[1, 2.6].flatMap((y) => [box('Guard rail', [2.6, 0.2, 0.15], L(0, y, -1.2), PB.wood), box('Guard rail', [2.6, 0.2, 0.15], L(0, y, 1.2), PB.wood), box('Guard rail', [0.15, 0.2, 2.2], L(-1.2, y, 0), PB.wood), box('Guard rail', [0.15, 0.2, 2.2], L(1.2, y, 0), PB.wood)]),
  ]) },
  bamboo: { category: 'Nature', label: 'Bamboo grove', hint: 'A dense clump of tall bamboo canes', ...pfp('Bamboo', [num('n', 'Canes', 6, 30, 14), seedParam(5)], (L, p) => {
    const r = rng(+p.seed), out: Part[] = [cyl('Bamboo bed', 5, 0.2, L(0, 0, 0), MULCH, MULCH, 10)]
    for (let i = 0; i < +p.n; i++) {
      const a = r() * 360, d = Math.sqrt(r()) * 2.1, h = 8 + r() * 6
      const [x, z] = turn(0, d, a)
      out.push(cyl('Cane', 0.32, h, L(x, 0.2, z), BAMBOO, BAMBOO, 6))
      if (i % 3 === 0) out.push(mass(L, 'Bamboo leaves', 2.4, 1.6, 1.6, x, h - 1.2, z, BAMBOO_LEAVES, 0.2, 6, a))
    }
    return out
  }) },

  // ---- desert ----
  cactus: { category: 'Nature', label: 'Saguaro cactus', hint: 'A tall cactus with up to three arms', ...pfp('Saguaro', [num('arms', 'Arms', 0, 3, 2), num('h', 'Height', 5, 16, 10)], (L, p) => {
    const h = +p.h
    const arm = (a: number, y: number, up: number): Part[] => {
      const [x, z] = turn(1.4, 0, a), [tx, tz] = turn(2.2, 0, a)
      return [lying('Cactus arm', 0.9, 1.8, L(x, y, z), CACTUS, CACTUS, 8, a), { ...cyl('Cactus arm', 0.9, up, L(tx, y + 0.3, tz), CACTUS, CACTUS, 8), taper: 0.75 }]
    }
    return [
      { ...cyl('Saguaro', 1.5, h, L(0, 0, 0), CACTUS, CACTUS, 10), taper: 0.7 },
      ...[arm(0, h * 0.35, h * 0.3), arm(180, h * 0.5, h * 0.25), arm(90, h * 0.42, h * 0.2)].slice(0, +p.arms).flat(),
    ]
  }) },
  cactusgarden: { category: 'Nature', label: 'Desert plants', hint: 'Barrel cacti, prickly pears and an agave on a sandy bed', make: pf('Desert plants', (L) => [
    blob('Sand bed', organic(10, 7, 31), 0.12, L(0, 0, 0), RED_SAND, RED_SAND, 6),
    ...[[-3, -1, 1.4], [-1.8, 1.5, 1], [2.8, 1.8, 1.2]].flatMap(([x, z, s]) => [mass(L, 'Barrel cactus', 1.6 * s, 1.3 * s, 1.6 * s, x, 0.1, z, CACTUS, 0.6, 12), cyl('Cactus flower', 0.5 * s, 0.25, L(x, 0.1 + 1.3 * s, z), BLOOM, BLOOM, 6)]),
    ...[[0.6, -0.8, 0, 20], [1.4, -0.6, 1.2, 70], [0.2, -1.2, 1.4, 120], [1.1, -1, 2.5, 160]].map(([x, z, y, a]) => ({ ...box('Prickly pear', [1.4, 1.4, 0.35], L(x, 0.1 + y, z), PEAR, PEAR, a), bevel: 0.3 })),
    ...[0, 60, 120, 180, 240, 300].map((a) => { const [x, z] = turn(0, 0.7, a); return { ...box('Agave leaf', [0.4, 1.6, 1.6], L(-0.4 + x, 0.1, 2.6 + z), PEAR, PEAR, a), bevel: 0.15 } }),
  ]) },

  // ---- hedges and gardens ----
  hedgecorner: { category: 'Nature', label: 'Hedge corner', hint: 'An L-shaped trimmed hedge', ...pfp('Hedge corner', [num('len', 'Arm length', 4, 40, 10), num('h', 'Height', 1, 6, 2.4, 0.2)], (L, p) => {
    const n = +p.len, h = +p.h
    return [hedge(L, n, h, n / 2 - 0.9, 0), hedge(L, n - 1.8, h, 0, (n - 1.8) / 2 + 0.9, 'z')]
  }) },
  hedgemaze: { category: 'Nature', label: 'Hedge maze tile', hint: 'A 20 x 20 maze cell with hedge walls; pick which sides open, then tile them', ...pfp('Hedge maze', [
    sel('layout', 'Openings', [['straight', 'Straight'], ['corner', 'Corner'], ['tee', 'T junction'], ['cross', 'Crossroads'], ['deadend', 'Dead end'], ['closed', 'Closed']], 'corner'),
    num('h', 'Height', 2, 8, 5, 0.5),
  ], (L, p) => {
    const open = MAZE[String(p.layout)] ?? '', h = +p.h, out: Part[] = []
    const side = (along: 'x' | 'z', at: number, o: boolean) => {
      if (!o) { out.push(hedge(L, along === 'x' ? 20 : 16.4, h, along === 'x' ? 0 : at, along === 'x' ? at : 0, along)); return }
      for (const k of [-1, 1]) {
        const len = along === 'x' ? 6 : 4.2, c = along === 'x' ? k * 7 : k * 6.1
        out.push(hedge(L, len, h, along === 'x' ? c : at, along === 'x' ? at : c, along))
      }
    }
    side('x', 9.1, open.includes('S')); side('x', -9.1, open.includes('N'))
    side('z', 9.1, open.includes('E')); side('z', -9.1, open.includes('W'))
    return out
  }) },
  topiary: { category: 'Nature', label: 'Topiary', hint: 'A clipped garden shrub in a stone pot: ball, cone, tiers or spiral', ...pfp('Topiary', [sel('shape', 'Shape', [['ball', 'Ball'], ['cone', 'Cone'], ['tiers', 'Tiers'], ['spiral', 'Spiral']], 'tiers')], (L, p) => {
    const pot: Part[] = [{ ...cyl('Pot', 2.4, 1.6, L(0, 0, 0), SOIL, STONE, 10), taper: 1.25 }, cyl('Pot rim', 3.1, 0.3, L(0, 1.6, 0), STONE, STONE, 10)]
    const ball = (y: number, d: number): Part[] => [mass(L, 'Topiary', d, d / 2, d, 0, y, 0, LEAVES, 1.4, 10), mass(L, 'Topiary', d * 1.4, d / 2, d * 1.4, 0, y + d / 2, 0, LEAVES, 0.5, 10)]
    const stem = (h: number): Part => cyl('Stem', 0.3, h, L(0, 1.9, 0), BARK, BARK, 6)
    switch (p.shape) {
      case 'ball': return [...pot, stem(1.5), ...ball(3, 2.4)]
      case 'cone': return [...pot, mass(L, 'Topiary', 2.6, 6, 2.6, 0, 1.9, 0, LEAVES, 0, 10)]
      case 'spiral': return [...pot, ...[...Array(8)].map((_, i) => { const [x, z] = turn(0, 0.5, i * 70); return mass(L, 'Topiary', 2.6 - i * 0.22, 0.75, 2.6 - i * 0.22, x, 1.9 + i * 0.75, z, LEAVES, 0.7, 9) })]
      default: return [...pot, stem(6), ...ball(2.2, 2.2), ...ball(4.6, 1.6), ...ball(6.5, 1.1)]
    }
  }) },
  shrubrow: { category: 'Nature', label: 'Shrub row', hint: 'A row of round shrubs, plain or flowering', ...pfp('Shrubs', [num('n', 'Shrubs', 1, 12, 4), sel('bloom', 'Flowers', [['none', 'None'], ['pink', 'Pink'], ['white', 'White'], ['yellow', 'Yellow']], 'none')], (L, p) => {
    const n = +p.n, top = p.bloom === 'none' ? LEAVES2 : FLOWER_TEX[String(p.bloom)] ?? LEAVES2
    return [...Array(n)].flatMap((_, i) => shrub(L, (i - (n - 1) / 2) * 3.2, (i % 2) * 0.5, 0.9 + (i % 3) * 0.12, LEAVES, top))
  }) },
  planterbox: { category: 'Nature', label: 'Planter box', hint: 'A raised planter of flowers; pick wood, concrete or stone', ...pfp('Planter', [num('len', 'Length', 3, 20, 6), sel('mat', 'Box', [['wood', 'Wood'], ['concrete', 'Concrete'], ['stone', 'Stone'], ['brick', 'Brick']], 'wood'), flowerParam('red')], (L, p) => {
    const len = +p.len, mat = ({ wood: PB.planks, concrete: PB.concrete, stone: STONE, brick: PB.brick } as Record<string, Tex>)[String(p.mat)] ?? PB.planks
    const n = Math.max(2, Math.round(len / 1.5))
    return [
      { ...box('Planter', [len, 1.6, 2.4], L(0, 0, 0), SOIL, mat), bevel: 0.08 },
      ...[...Array(n)].map((_, i) => mass(L, 'Flowers', 1.4, 0.9, 1.6, (i - (n - 1) / 2) * (len - 1.4) / (n - 1), 1.6, (i % 2) * 0.3 - 0.15, flowerTex(p), 0.6, 8, i * 37, LEAVES)),
    ]
  }) },
  flowerround: { category: 'Nature', label: 'Round flower bed', hint: 'A round bed with a stone edge and a mound of flowers', ...pfp('Round bed', [num('d', 'Diameter', 4, 24, 9), flowerParam('yellow')], (L, p) => {
    const d = +p.d
    return [cyl('Bed edge', d, 0.6, L(0, 0, 0), SOIL, STONE, 18), mass(L, 'Flowers', d - 1, 0.8, d - 1, 0, 0.6, 0, flowerTex(p), 0.55, 16), mass(L, 'Shrub', d / 4, 1.4, d / 4, 0, 1.4, 0, LEAVES, 0.4, 9)]
  }) },
  vegpatch: { category: 'Nature', label: 'Vegetable garden', hint: 'Rows of crops in tilled soil: cabbages, tomato stakes and corn', ...pfp('Vegetable garden', [num('rows', 'Rows', 2, 8, 4), num('len', 'Row length', 6, 30, 12)], (L, p) => {
    const rows = +p.rows, len = +p.len, out: Part[] = []
    for (let r = 0; r < rows; r++) {
      const z = (r - (rows - 1) / 2) * 3
      out.push({ ...box('Crop row', [len, 0.5, 1.8], L(0, 0, z), SOIL, SOIL), bevel: 0.2 })
      const n = Math.max(2, Math.floor(len / 2))
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * (len - 1.5) / (n - 1)
        if (r % 3 === 0) out.push(mass(L, 'Cabbage', 1.2, 0.8, 1.2, x, 0.5, z, LEAVES2, 0.55, 8))
        else if (r % 3 === 1) out.push(box('Tomato stake', [0.12, 2.8, 0.12], L(x, 0.5, z), PB.wood), mass(L, 'Tomato plant', 1, 1.8, 1, x, 0.5, z, LEAVES, 0.5, 6))
        else out.push(cyl('Corn', 0.3, 4, L(x, 0.5, z), REED, REED, 5), mass(L, 'Corn leaves', 1.2, 0.8, 0.6, x, 2.6, z, REED, 0.2, 5, i * 50))
      }
    }
    const w = len + 2, d = rows * 3 + 1
    out.push(...[[0, -d / 2, w, 0], [0, d / 2, w, 0], [-w / 2, 0, d, 90], [w / 2, 0, d, 90]].map(([x, z, l, r]) => box('Garden edge', [l, 0.6, 0.25], L(x, 0, z), PB.planks, PB.planks, r)))
    return out
  }) },
  sprinklerlawn: { category: 'Nature', label: 'Lawn and sprinkler', hint: 'A patch of mown lawn with a sprinkler and its hose', ...pfp('Lawn', [num('w', 'Width', 8, 60, 20), num('d', 'Depth', 8, 60, 14), seedParam(3)], (L, p) => [
    blob('Lawn', organic(+p.w, +p.d, +p.seed, 28, 0.08), 0.12, L(0, 0, 0), LAWN, SOIL, 6),
    cyl('Sprinkler base', 0.7, 0.3, L(0, 0.12, 0), PB.green, PB.green, 8), cyl('Sprinkler', 0.2, 0.7, L(0, 0.42, 0), PB.steel, PB.steel, 6),
    box('Sprinkler arm', [1.6, 0.12, 0.12], L(0, 1.05, 0), PB.steel, PB.steel, 30),
    lying('Hose', 0.25, +p.w / 2 - 0.4, L(+p.w / 4, 0.12, 0), PB.green, PB.green, 6),
  ]) },
  meadow: { category: 'Nature', label: 'Wildflower meadow', hint: 'A patch of long grass dotted with wildflower clumps', ...pfp('Meadow', [num('w', 'Width', 8, 60, 18), num('d', 'Depth', 8, 60, 12), flowerParam('purple'), seedParam(9)], (L, p) => {
    const w = +p.w, d = +p.d, r = rng(+p.seed), out: Part[] = [blob('Meadow', organic(w, d, +p.seed), 0.2, L(0, 0, 0), DRY_GRASS, SOIL, 6)]
    for (let i = 0; i < Math.round(w * d / 25); i++) {
      const x = (r() - 0.5) * w * 0.7, z = (r() - 0.5) * d * 0.7
      out.push(mass(L, i % 2 ? 'Flowers' : 'Long grass', 1.2 + r(), 0.6 + r() * 0.8, 1 + r(), x, 0.2, z, i % 2 ? flowerTex(p) : REED, 0.4, 6, r() * 90))
    }
    return out
  }) },

  // ---- grass and water plants ----
  tallgrass: { category: 'Nature', label: 'Tall grass', hint: 'A clump of tall grass blades to hide in', ...pfp('Tall grass', [num('n', 'Blades', 8, 60, 24), num('h', 'Height', 1, 6, 3, 0.5), seedParam(11)], (L, p) => {
    const r = rng(+p.seed), n = +p.n, rad = Math.sqrt(n) * 0.45
    return [mass(L, 'Grass base', rad * 2, 0.5, rad * 2, 0, 0, 0, DRY_GRASS, 0.7, 8), ...[...Array(n)].map((_, i) => {
      const [x, z] = turn(0, Math.sqrt(r()) * rad, r() * 360)
      return { ...cyl('Grass blade', 0.35, +p.h * (0.6 + r() * 0.6), L(x, 0, z), i % 3 ? REED : DRY_GRASS, i % 3 ? REED : DRY_GRASS, 3, r() * 120), taper: 0 }
    })]
  }) },
  cattails: { category: 'Nature', label: 'Reeds and cattails', hint: 'Reeds in a muddy patch, some with brown cattail heads', ...pfp('Cattails', [num('n', 'Reeds', 6, 40, 18), seedParam(4)], (L, p) => {
    const r = rng(+p.seed), n = +p.n, rad = Math.sqrt(n) * 0.5, out: Part[] = [blob('Mud', organic(rad * 2 + 2, rad * 2 + 1.4, +p.seed), 0.1, L(0, 0, 0), MUD, MUD, 4)]
    for (let i = 0; i < n; i++) {
      const [x, z] = turn(0, Math.sqrt(r()) * rad, r() * 360), h = 2.4 + r() * 2.4
      out.push({ ...cyl('Reed', 0.18, h, L(x, 0.1, z), REED, REED, 4), taper: i % 3 ? 0.4 : 1 })
      if (i % 3 === 0) out.push(cyl('Cattail', 0.36, 0.9, L(x, 0.1 + h, z), CATTAIL, CATTAIL, 6), { ...cyl('Cattail spike', 0.1, 0.5, L(x, 1 + h, z), REED, REED, 4), taper: 0 })
    }
    return out
  }) },
  lilypads: { category: 'Nature', label: 'Lily pond', hint: 'A small still pond covered in lily pads and flowers (not deep enough to swim)', ...pfp('Lily pond', [num('w', 'Width', 6, 40, 14), num('d', 'Depth', 6, 40, 10), seedParam(6)], (L, p) => {
    const w = +p.w, d = +p.d, r = rng(+p.seed)
    const out: Part[] = [blob('Pond bank', organic(w + 2, d + 2, +p.seed + 1), 0.06, L(0, 0, 0), MUD, MUD, 4), blob('Pond', organic(w, d, +p.seed), 0.14, L(0, 0, 0), POND_WATER, MUD, 8)]
    for (let i = 0; i < Math.round(w * d / 12); i++) {
      const x = (r() - 0.5) * w * 0.6, z = (r() - 0.5) * d * 0.6, s = 0.8 + r() * 0.8
      out.push(cyl('Lily pad', 1.4 * s, 0.05, L(x, 0.14, z), LILY, LILY, 9, r() * 360))
      if (i % 3 === 0) out.push({ ...cyl('Water lily', 0.5, 0.3, L(x + 0.2, 0.19, z), BLOOM, WHITE, 6), taper: 1.6 })
    }
    return out
  }) },

  // ---- rocks and landforms ----
  pebbles: { category: 'Nature', label: 'Small rocks', hint: 'A scatter of small stones and pebbles', ...pfp('Small rocks', [seedParam(2)], (L, p) => {
    const r = rng(+p.seed)
    return [...Array(9)].map((_, i) => { const [x, z] = turn(0, r() * 3, r() * 360); return rock(L, x, z, 0.6 + r() * 0.9, 0.3 + r() * 0.5, 0.5 + r() * 0.8, i * 47) })
  }) },
  rockpile: { category: 'Nature', label: 'Rock pile', hint: 'A medium heap of rocks, knee to chest high', ...pfp('Rock pile', [seedParam(7)], (L, p) => {
    const r = rng(+p.seed)
    return [
      rock(L, 0, 0, 4.4, 2.6, 3.8, 15), rock(L, 2.6, 0.8, 2.8, 1.8, 2.4, 50), rock(L, -2.4, 1.4, 2.4, 1.4, 2.2, 80),
      ...[...Array(5)].map((_, i) => { const [x, z] = turn(0, 2.6 + r() * 1.2, i * 72 + r() * 30); return rock(L, x, z, 1 + r(), 0.6 + r() * 0.6, 0.9 + r(), r() * 360) }),
      rock(L, 0.4, -0.2, 2.6, 1.4, 2.2, 40, 2.4),
    ]
  }) },
  outcrop: { category: 'Nature', label: 'Rock outcrop', hint: 'A big stepped rock mass you can climb on', ...pfp('Outcrop', [sizeParam(1), seedParam(13)], (L, p) => {
    const s = +p.size, r = rng(+p.seed)
    return [
      mass(L, 'Outcrop', 14 * s, 3 * s, 11 * s, 0, 0, 0, GRASSY_ROCK, 0.8, 7, 10, ROCK),
      mass(L, 'Outcrop', 9 * s, 3 * s, 7 * s, -1.5 * s, 3 * s, 0.8 * s, GRASSY_ROCK, 0.75, 7, 35, ROCK),
      mass(L, 'Outcrop', 5 * s, 2.6 * s, 4 * s, -2.4 * s, 6 * s, 1 * s, GRASSY_ROCK, 0.6, 6, 60, ROCK),
      ...[...Array(4)].map((_, i) => { const [x, z] = turn(0, 7 * s, i * 90 + 30 + r() * 40); return rock(L, x, z, (2 + r() * 2) * s, (1 + r()) * s, (1.6 + r() * 1.6) * s, r() * 360) }),
    ]
  }) },
  boulderfield: { category: 'Nature', label: 'Boulder field', hint: 'Scattered big boulders: cover across open ground', ...pfp('Boulders', [num('n', 'Boulders', 2, 12, 5), num('spread', 'Spread', 8, 60, 24), seedParam(8)], (L, p) => {
    const r = rng(+p.seed), sp = +p.spread
    return [...Array(+p.n)].flatMap((_, i) => {
      const x = (r() - 0.5) * sp, z = (r() - 0.5) * sp, w = 4 + r() * 4, h = 2 + r() * 2.5, a = r() * 360
      return [mass(L, 'Boulder', w, h * 0.5, w * 0.85, x, 0, z, ROCK, 1.12, 7, a), mass(L, 'Boulder', w * 1.1, h * 0.5, w * 0.95, x, h * 0.5, z, ROCK, 0.5, 7, a + 20 + i)]
    })
  }) },
  cliffwall: { category: 'Nature', label: 'Cliff wall', hint: 'A rugged rock-face wall piece to close off a map edge', ...pfp('Cliff', [num('len', 'Length', 8, 80, 24), num('h', 'Height', 6, 40, 16), seedParam(21)], (L, p) => {
    const r = rng(+p.seed), len = +p.len, h = +p.h, n = Math.max(2, Math.round(len / 5)), step = len / n, out: Part[] = []
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + step * (i + 0.5), hh = h * (0.8 + r() * 0.35)
      out.push({ ...box('Cliff', [step * (1.15 + r() * 0.3), hh, 5 + r() * 3], L(x, 0, r() * 1.4 - 0.7), GRASSY_ROCK, ROCK, r() * 16 - 8, 6), bevel: 0.8 })
      if (i % 2 === 0) out.push({ ...box('Cliff ledge', [step * 0.9, hh * 0.35, 3], L(x + r() - 0.5, 0, 3.2 + r()), GRASSY_ROCK, ROCK, r() * 20 - 10, 6), bevel: 0.6 })
    }
    out.push(...[...Array(Math.ceil(n / 2))].map(() => rock(L, -len / 2 + r() * len, 5.5 + r() * 1.5, 1.5 + r() * 2, 0.8 + r(), 1.4 + r() * 1.5, r() * 360)))
    return out
  }) },
  cliffcorner: { category: 'Nature', label: 'Cliff corner', hint: 'A rounded outside corner for joining cliff walls', ...pfp('Cliff corner', [num('h', 'Height', 6, 40, 16), seedParam(22)], (L, p) => {
    const r = rng(+p.seed), h = +p.h
    return [0, 30, 60, 90].map((a, i) => {
      const [x, z] = turn(0, 4, a - 45)
      return { ...box('Cliff', [6.5, h * (0.85 + r() * 0.3), 6], L(x, 0, z), GRASSY_ROCK, ROCK, a - 45 + r() * 10, 6), bevel: 0.8 + i * 0.05 }
    })
  }) },
  rockarch: { category: 'Nature', label: 'Rock arch', hint: 'A natural stone arch to run under (8 wide, 8 high)', make: pf('Rock arch', (L) => [
    mass(L, 'Arch leg', 5, 4, 4.4, -6, 0, 0, ROCK, 0.85, 7, 10), mass(L, 'Arch leg', 4.6, 4.4, 4, -6.2, 4, 0.2, ROCK, 0.85, 7, 40),
    mass(L, 'Arch leg', 5.4, 4.2, 4.6, 6, 0, 0, ROCK, 0.85, 7, 25), mass(L, 'Arch leg', 4.8, 4, 4, 6.1, 4.2, -0.2, ROCK, 0.85, 7, 55),
    { ...box('Arch span', [17, 2.6, 4], L(0, 8, 0), GRASSY_ROCK, ROCK, 3), bevel: 1 },
    { ...box('Arch span', [9, 1.6, 3.2], L(-1, 10.6, 0.2), GRASSY_ROCK, ROCK, -4), bevel: 0.7 },
    rock(L, -8.6, 2.6, 2.4, 1.4, 2, 30), rock(L, 8.8, -2.4, 2.8, 1.6, 2.2, 70),
  ]) },
  cave: { category: 'Nature', label: 'Cave entrance', hint: 'A rocky cave mouth 7 wide and 7 high, 10 deep, closed at the back', make: pf('Cave', (L) => [
    blob('Cave floor', organic(8, 12, 17), 0.12, L(0, 0, -0.5), MUD, MUD, 4),
    { ...box('Cave wall', [5, 8, 13], L(-6, 0, -1), ROCK, ROCK, 4), bevel: 0.6 }, { ...box('Cave wall', [5, 8, 13], L(6, 0, -1), ROCK, ROCK, -3), bevel: 0.6 },
    { ...box('Cave back', [8, 7.2, 2.4], L(0, 0, -6.4), CAVE_DARK, CAVE_DARK), bevel: 0.3 },
    { ...box('Cave roof', [17, 3.2, 14], L(0, 7, -1), GRASSY_ROCK, ROCK), bevel: 1 },
    mass(L, 'Hill', 15, 4, 12, 0, 10.2, -1.6, GRASSY_ROCK, 0.45, 8, 20, ROCK),
    rock(L, -8.6, 5.4, 3.4, 2.4, 2.8, 15), rock(L, 8.4, 5, 3, 3, 2.6, 60), rock(L, -3.6, 6.6, 1.6, 0.8, 1.2, 40),
  ]) },
  dune: { category: 'Nature', label: 'Sand dune', hint: 'A smooth sand dune to climb over', ...pfp('Dune', [num('w', 'Length', 10, 80, 30), num('d', 'Width', 8, 60, 16), num('h', 'Height', 2, 14, 5, 0.5)], (L, p) => {
    const w = +p.w, d = +p.d, h = +p.h
    return [
      mass(L, 'Dune', w, h * 0.6, d, 0, 0, 0, SAND, 0.65, 18),
      mass(L, 'Dune', w * 0.62, h * 0.4, d * 0.5, w * 0.06, h * 0.6, -d * 0.08, SAND, 0.4, 16),
      mass(L, 'Dune', w * 0.4, h * 0.3, d * 0.5, -w * 0.3, 0, d * 0.25, SAND, 0.5, 12),
    ]
  }) },
  dirtmound: { category: 'Nature', label: 'Dirt mound', hint: 'A heap of earth for jumps and cover', ...pfp('Dirt mound', [num('d', 'Size', 4, 30, 10), num('h', 'Height', 1, 10, 3.5, 0.5)], (L, p) => [
    mass(L, 'Dirt mound', +p.d, +p.h * 0.65, +p.d * 0.8, 0, 0, 0, PB.dirt, 0.55, 12),
    mass(L, 'Dirt mound', +p.d * 0.5, +p.h * 0.35, +p.d * 0.45, -0.3, +p.h * 0.65, 0.2, PB.dirt, 0.4, 10),
    rock(L, +p.d * 0.38, +p.d * 0.2, 1, 0.5, 0.8, 30),
  ]) },
  gravelpile: { category: 'Nature', label: 'Gravel pile', hint: 'A conical heap of gravel', ...pfp('Gravel pile', [num('d', 'Size', 3, 24, 8), sel('mat', 'Material', [['gravel', 'Gravel'], ['sand', 'Sand'], ['dirt', 'Dirt']], 'gravel')], (L, p) => {
    const tex = ({ gravel: PB.gravel, sand: SAND, dirt: PB.dirt } as Record<string, Tex>)[String(p.mat)] ?? PB.gravel
    return [mass(L, 'Pile', +p.d, +p.d * 0.42, +p.d, 0, 0, 0, tex, 0.12, 14), mass(L, 'Spill', +p.d * 0.5, +p.d * 0.12, +p.d * 0.4, +p.d * 0.4, 0, 0.2, tex, 0.4, 10)]
  }) },

  // ---- wood ----
  firewood: { category: 'Nature', label: 'Firewood rack', hint: 'Split logs stacked between posts under a small roof', ...pfp('Firewood', [num('len', 'Length', 4, 16, 8)], (L, p) => {
    const len = +p.len, out: Part[] = [box('Rack base', [len, 0.4, 2.2], L(0, 0, 0), PB.planks)]
    for (let row = 0; row < 4; row++) for (let i = 0; i < Math.floor((len - 0.6) / 0.8); i++) {
      const x = -len / 2 + 0.7 + i * 0.8 + (row % 2) * 0.4
      if (x < len / 2 - 0.4) out.push(lying('Split log', 0.8, 2, L(x, 0.4 + row * 0.75, 0), LOG_END, BARK, 6, 90))
    }
    out.push(...[-1, 1].map((k) => box('Rack post', [0.3, 4.2, 0.3], L(k * len / 2, 0, 0), PB.wood)), { ...box('Rack roof', [len + 1, 0.25, 2.8], L(0, 4.2, 0), PB.corrugated, PB.wood) })
    return out
  }) },
  timber: { category: 'Nature', label: 'Timber stack', hint: 'Long felled logs stacked in a pyramid, with chocks', ...pfp('Timber', [num('rows', 'Rows', 1, 5, 3), num('len', 'Log length', 6, 30, 16)], (L, p) => {
    const rows = +p.rows, len = +p.len, out: Part[] = []
    for (let r = 0; r < rows; r++) for (let i = 0; i < rows - r; i++) out.push(lying('Log', 1.5, len - r * 0.3 + (i % 2) * 0.4, L(0, r * 1.3, (i - (rows - r - 1) / 2) * 1.5), LOG_END, BARK, 10, 90))
    out.push(...[-1, 1].map((k) => box('Chock', [0.5, 0.8, 0.4], L(k * (rows * 0.75 + 0.3), 0, len * 0.3), PB.wood)))
    return out
  }) },
  mushrooms: { category: 'Nature', label: 'Mushroom ring', hint: 'A fairy ring of toadstools around a mossy patch', ...pfp('Mushrooms', [num('d', 'Ring size', 4, 20, 8), num('big', 'Toadstool size', 0.5, 4, 1, 0.1)], (L, p) => {
    const d = +p.d, s = +p.big, n = Math.max(6, Math.round(d * 1.3))
    return [blob('Moss', organic(d + 1, d + 1, 23, 20, 0.1), 0.08, L(0, 0, 0), MOSS, MOSS, 4), ...[...Array(n)].flatMap((_, i) => {
      const [x, z] = turn(0, d / 2, (i * 360) / n), k = s * (0.6 + ((i * 7) % 5) * 0.15), cap = i % 3 === 0 ? MUSH_BROWN : MUSH_CAP
      return [{ ...cyl('Mushroom stem', 0.4 * k, 0.9 * k, L(x, 0.08, z), MUSH_STEM, MUSH_STEM, 6), taper: 0.8 }, { ...cyl('Mushroom cap', 1.4 * k, 0.6 * k, L(x, 0.08 + 0.9 * k, z), cap, cap, 8), taper: 0.25 }]
    })]
  }) },
  vinewall: { category: 'Nature', label: 'Vine-covered wall', hint: 'A garden wall overgrown with climbing vines', ...pfp('Vine wall', [num('len', 'Length', 4, 40, 12), num('h', 'Height', 2, 14, 6, 0.5), sel('wall', 'Wall', [['brick', 'Brick'], ['stone', 'Stone'], ['concrete', 'Concrete']], 'brick'), seedParam(14)], (L, p) => {
    const len = +p.len, h = +p.h, r = rng(+p.seed), wall = ({ brick: PB.brick, stone: STONE, concrete: PB.cinder } as Record<string, Tex>)[String(p.wall)] ?? PB.brick
    const out: Part[] = [box('Wall', [len, h, 1], L(0, 0, 0), PB.concrete, wall), box('Wall cap', [len + 0.4, 0.3, 1.3], L(0, h, 0), PB.concrete)]
    for (let i = 0; i < Math.round(len / 2); i++) {
      const x = (r() - 0.5) * (len - 2), w = 1.2 + r() * 2.4, top = h * (0.5 + r() * 0.5)
      out.push(box('Vines', [w, top, 0.15], L(x, 0, 0.55 + (i % 3) * 0.03), LEAVES, LEAVES, 0, 3))
      out.push(box('Vine strand', [0.25, h * 0.3 + r() * h * 0.2, 0.12], L(x + w / 2, 0, 0.6), LEAVES2, LEAVES2))
    }
    out.push(box('Vines', [len * 0.6, 0.6, 1.5], L((r() - 0.5) * len * 0.3, h + 0.3, 0), LEAVES2, LEAVES2, 0, 3))
    return out
  }) },

  // ---- outdoor scenes ----
  beachset: { category: 'Nature', label: 'Beach umbrella', hint: 'A striped umbrella, towels and a cooler on a patch of sand', ...pfp('Beach umbrella', [sel('color', 'Stripes', [['red', 'Red'], ['blue', 'Blue'], ['yellow', 'Yellow'], ['green', 'Green']], 'blue')], (L, p) => {
    const st = STRIPES[String(p.color)] ?? STRIPES.blue
    return [
      blob('Sand', organic(12, 9, 27), 0.1, L(0, 0, 0), SAND, SAND, 6),
      cyl('Umbrella pole', 0.18, 5, L(0, 0.1, 0), WHITE, WHITE, 6),
      { ...cyl('Umbrella', 7, 1.4, L(0, 4.4, 0), st, st, 8), taper: 0.05 },
      ...TOWELS.slice(0, 2).map((t, i) => box('Towel', [1.8, 0.06, 3.6], L(-1.4 + i * 2.8, 0.1, 1.6), t, t, i * 8 - 4)),
      { ...box('Cooler', [1.6, 1.1, 1], L(2.6, 0.1, -1.6), PB.blue, CY.white), bevel: 0.12 },
      cyl('Beach ball', 0.9, 0.9, L(-2.8, 0.1, -1.8), STRIPES.red, STRIPES.yellow, 8),
    ]
  }) },
  campfirering: { category: 'Nature', label: 'Campfire', hint: 'A stone fire ring with glowing embers and log seats', make: pf('Campfire', (L) => [
    cyl('Ash', 2.6, 0.12, L(0, 0, 0), ASH, ASH, 10),
    ...[...Array(9)].map((_, i) => { const [x, z] = turn(0, 1.6, i * 40); return rock(L, x, z, 0.9, 0.6, 0.7, i * 40, 0, STONE) }),
    cyl('Embers', 1.4, 0.3, L(0, 0.12, 0), EMBER, EMBER, 8),
    ...[0, 90, 180, 270].map((a) => { const [x, z] = turn(0, 0.35, a); return { ...cyl('Fire log', 0.5, 1.8, L(x, 0.12, z), BARK, BARK, 6, a), taper: 0 } }),
    ...[0, 120, 240].map((a) => { const [x, z] = turn(0, 4.2, a + 30); return lying('Log seat', 1.1, 3.6, L(x, 0, z), LOG_END, BARK, 10, a + 30) }),
  ]) },
  picnicblanket: { category: 'Nature', label: 'Picnic blanket', hint: 'A checked blanket with a basket, plates and a bottle', make: pf('Picnic', (L) => [
    box('Blanket', [5, 0.06, 4], L(0, 0, 0), CHECKER, CHECKER, 6),
    { ...box('Basket', [1.6, 1, 1.1], L(1.4, 0.06, -0.8), WICKER, WICKER), bevel: 0.1 }, box('Basket handle', [0.12, 0.6, 1], L(1.4, 1.06, -0.8), WICKER),
    ...[[-1.2, 0.8], [0, 1.1], [-1.4, -0.6]].map(([x, z]) => cyl('Plate', 0.9, 0.06, L(x, 0.06, z), WHITE, WHITE, 10)),
    cyl('Bottle', 0.35, 1, L(0.3, 0.06, -0.4), PB.green, PB.green, 6),
  ]) },
  treeline: { category: 'Nature', label: 'Tree line', hint: 'A thick row of trees to fence off a map edge', ...pfp('Tree line', [num('len', 'Length', 10, 120, 40), num('h', 'Height', 8, 30, 14), sel('mix', 'Trees', [['mixed', 'Mixed'], ['leafy', 'Leafy'], ['pine', 'Pines']], 'mixed'), seedParam(19)], (L, p) => {
    const len = +p.len, h = +p.h, r = rng(+p.seed), n = Math.max(2, Math.round(len / (h * 0.42))), out: Part[] = []
    for (let i = 0; i < n; i++) {
      const pine = p.mix === 'pine' || (p.mix === 'mixed' && r() < 0.45)
      out.push(...backTree(L, -len / 2 + (len / n) * (i + 0.5) + (r() - 0.5) * 1.5, (i % 2) * 2.4 - 1.2 + (r() - 0.5), h * (0.8 + r() * 0.35), pine))
    }
    out.push(...[...Array(Math.ceil(n / 2))].flatMap((_, i) => shrub(L, -len / 2 + (len / Math.ceil(n / 2)) * (i + 0.5), 3, 1.1)))
    return out
  }) },
}
