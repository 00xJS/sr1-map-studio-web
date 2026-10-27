// More prefabs, by theme, for building fun game maps: paintball fields, cyber
// arenas, obstacle courses, king-of-the-hill towers, forts, street scenes.
// Each is one object (a group) placed with its base at y and turned by rot.
import { CY, PB, ball, blob, box, cyl, lying, organic, ramp, stairs, turn, type Part, type Tex } from './sampleKit'
import { wheels, type ParamDef, type Params, type PrefabDef } from './prefabs'
import { statusParen } from './featureStatus'
import { pf, pfp } from './prefabKit'

/** Shorthand: a prefab whose parts are given in its local frame. */

/** A prefab with settings: returns its params and a make that fills in defaults. */
const BUNKER_TEX: Record<string, Tex> = { red: PB.red, blue: PB.blue, yellow: PB.yellow, green: PB.green, orange: PB.orange, black: PB.black }
const bunkerColor = (d: string): ParamDef => ({ key: 'color', label: 'Color', kind: 'select', options: [['red', 'Red'], ['blue', 'Blue'], ['yellow', 'Yellow'], ['green', 'Green'], ['orange', 'Orange'], ['black', 'Black']], default: d })
const NEON_TEX: Record<string, Tex> = { cyan: CY.cyan, pink: CY.pink, purple: CY.purple, lime: CY.lime, orange: CY.orange, white: CY.white }
const neonColor = (d: string): ParamDef => ({ key: 'color', label: 'Glow', kind: 'select', options: [['cyan', 'Cyan'], ['pink', 'Pink'], ['purple', 'Purple'], ['lime', 'Lime'], ['orange', 'Orange'], ['white', 'White']], default: d })
const B = (p: Params) => BUNKER_TEX[String(p.color)] ?? PB.red
const N = (p: Params) => NEON_TEX[String(p.color)] ?? CY.cyan

const STONE: Tex = { lib: 'medieval_blocks_03', surface: 0 }
const SLATE: Tex = { lib: 'roof_slates_03', surface: 0 }
const POND_WATER: Tex = { gen: 'water', tweak: { color: '#2a5a52', accent: '#9cc4b8', seed: 340 }, surface: 20 }
const MUD: Tex = { gen: 'dirt', tweak: { color: '#4a3a2a', accent: '#2e241a', wear: 0.4, seed: 338 } }
const REED: Tex = { gen: 'grass', tweak: { color: '#5d7a2c', accent: '#3d5a1c', scale: 2, wear: 0.2, seed: 339 }, surface: 7 }

/** A pond with a natural edge: a muddy bank, the water, rocks and reeds round the rim. */
export function pondParts(L: (dx: number, dy: number, dz: number) => [number, number, number], w: number, d: number, seed: number): Part[] {
  const edge = organic(w, d, seed)
  const bank = edge.map(([x, z]): [number, number] => [+(x * 1.12 + Math.sign(x) * 0.6).toFixed(3), +(z * 1.12 + Math.sign(z) * 0.6).toFixed(3)])
  const out: Part[] = [blob('Pond bank', bank, 0.06, L(0, 0, 0), MUD, MUD, 4), blob('Pond', edge, 0.14, L(0, 0, 0), POND_WATER, MUD, 8)]
  edge.forEach(([x, z], i) => {
    if (i % 3 === 0) out.push({ ...cyl('Rock', 1 + ((i * 7) % 5) * 0.25, 0.5 + ((i * 3) % 4) * 0.15, L(x * 1.08, 0, z * 1.08), ROCK, ROCK, 7), taper: 0.6 })
    else if (i % 3 === 1) out.push(...[0, 1, 2].map((k) => cyl('Reed', 0.12, 1.4 + k * 0.4, L(x * 1.05 + k * 0.25, 0, z * 1.05 - k * 0.2), REED, REED, 4)))
  })
  return out
}

const ROCK: Tex = { lib: 'rock_face_03', surface: 0 }
const LEAVES: Tex = { gen: 'grass', tweak: { color: '#2f5e22', accent: '#4c7a2a', scale: 3, wear: 0.2, seed: 84 }, surface: 7 }
const PALM: Tex = { gen: 'grass', tweak: { color: '#3f7a2a', accent: '#8a9a3a', scale: 6, wear: 0.3, seed: 350 }, surface: 7 }
/** Cut log ends: pale wood with rings. */
const LOG_END: Tex = { gen: 'wood_planks', tweak: { color: '#b08a5a', accent: '#7a5a38', scale: 1, seed: 337 } }
const BARK: Tex = { gen: 'wood_planks', tweak: { color: '#5a3f2a', accent: '#3a2818', scale: 3, seed: 85 } }
const DEAD: Tex = { gen: 'wood_planks', tweak: { color: '#6a6058', accent: '#3a332e', scale: 3, seed: 351 } }
const HAY: Tex = { gen: 'sand', tweak: { color: '#d8b85a', accent: '#a8873a', scale: 10, seed: 352 }, surface: 21 }
const FLOWERS: Tex = { gen: 'grass', tweak: { color: '#3d6e28', accent: '#d24a8a', scale: 8, wear: 0.8, seed: 353 }, surface: 7 }
const SANDBAG: Tex = { gen: 'sand', tweak: { color: '#b49a6a', accent: '#8a7550', scale: 2, seed: 9 } }
const NET: Tex = { gen: 'tiles', tweak: { color: '#1d1d1f', accent: '#3a3a40', scale: 16, wear: 0, seed: 354 }, surface: 14 }
const SCREEN: Tex = { gen: 'tiles', tweak: { color: '#14191f', accent: '#18d8ff', scale: 3, wear: 0, seed: 355 }, surface: 15 }
const RED_LIGHT: Tex = { gen: 'paint', tweak: { color: '#d02020', accent: '#601010', scale: 2, wear: 0, seed: 356 }, surface: 17 }
const GREEN_LIGHT: Tex = { gen: 'paint', tweak: { color: '#20c040', accent: '#106020', scale: 2, wear: 0, seed: 357 }, surface: 17 }
const HAZARD: Tex = { gen: 'hazard', tweak: { seed: 358 } }

const posts4 = (L: (a: number, b: number, c: number) => [number, number, number], w: number, d: number, h: number, tex: Tex, s = 0.3, y = 0) =>
  [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].map(([a, b]) => box('Post', [s, h, s], L(a, y, b), tex))

// ---------------- swimming pool ----------------
// Sizes in editor units (1 unit = 0.5 m). The pool stands on the ground, so the
// water sits inside a raised basin. Players climb ledges by themselves up to
// about 3 m, so the rim stays under that from the ground; steps lead up to the
// rim outside and down into the water inside.

const POOL_WATER: Tex = { gen: 'water', tweak: { color: '#2a8fc0', accent: '#bfe8f5', seed: 361 }, surface: 20 }
const POOL_TILE: Tex = { gen: 'tiles', tweak: { color: '#e8eef0', accent: '#9ab8c4', scale: 8, wear: 0.1, seed: 362 }, surface: 3 }
/** Floor slab under the water. */
export const POOL_FLOOR = 0.4
/** Rim above the water line. */
export const POOL_FREEBOARD = 0.4
export const POOL_WALL = 1
/** Deepest water offered: keeps the rim (floor + water + freeboard) under 6 units (3 m) from the ground. */
export const POOL_MAX_DEPTH = 5
/** Steps no taller than 0.5 units (0.25 m) each. */
const stepsFor = (h: number) => Math.max(2, Math.ceil(h / 0.5))

export function poolParts(L: (dx: number, dy: number, dz: number) => [number, number, number], w: number, d: number, depth: number): Part[] {
  const rim = POOL_FLOOR + depth + POOL_FREEBOARD
  const t = POOL_WALL
  const outer = d / 2 + t
  return [
    box('Pool floor', [w + 2 * t, POOL_FLOOR, d + 2 * t], L(0, 0, 0), POOL_TILE, PB.concrete),
    box('Pool wall', [t, rim, d + 2 * t], L(-(w + t) / 2, 0, 0), PB.concrete, POOL_TILE),
    box('Pool wall', [t, rim, d + 2 * t], L((w + t) / 2, 0, 0), PB.concrete, POOL_TILE),
    box('Pool wall', [w, rim, t], L(0, 0, -(d + t) / 2), PB.concrete, POOL_TILE),
    box('Pool wall', [w, rim, t], L(0, 0, (d + t) / 2), PB.concrete, POOL_TILE),
    // The water fills the basin up to just under the rim.
    // A hair smaller than the basin, so its sides don't flicker against the walls.
    { ...box('Pool water', [w - 0.04, depth, d - 0.04], L(0, POOL_FLOOR, 0), POOL_WATER, POOL_WATER), water: true },
    // Steps up to the rim outside the front wall, and down into the water inside it.
    stairs('Pool steps', [4, rim, rim * 1.6], L(0, 0, outer + rim * 0.8), PB.concrete, PB.concrete, 0, stepsFor(rim)),
    stairs('Pool steps', [4, depth, depth * 1.4], L(0, POOL_FLOOR, d / 2 - depth * 0.7), POOL_TILE, POOL_TILE, 180, stepsFor(depth)),
  ]
}

export const MORE_PREFABS: Record<string, PrefabDef & { category: string }> = {
  // ---------------- buildings ----------------
  house: { category: 'Buildings', label: 'House', hint: 'A house with a pitched roof and porch', make: pf('House', (L) => [
    box('House', [16, 8, 12], L(0, 0, 0), PB.wood, PB.beige),
    { ...box('Roof', [17, 4, 13], L(0, 8, 0), SLATE, SLATE), kind: 'roof' },
    box('Porch', [8, 0.6, 4], L(0, 0, 8), PB.planks, PB.wood), ...posts4(L, 7.4, 3.4, 4, PB.wood, 0.3, 0.6),
    box('Porch roof', [8.4, 0.3, 4.4], L(0, 4.6, 8), SLATE),
    box('Chimney', [1.6, 4, 1.6], L(5, 9, -2), PB.brick),
  ]) },
  garage: { category: 'Buildings', label: 'Garage', hint: 'A one-car garage', make: pf('Garage', (L) => [
    box('Garage', [8, 6, 10], L(0, 0, 0), PB.concrete, PB.plaster), { ...box('Roof', [8.6, 2, 10.6], L(0, 6, 0), SLATE), kind: 'roof' },
    box('Garage door', [6, 4.6, 0.2], L(0, 0, 5.05), { gen: 'garage_door', tweak: { seed: 322 } }),
  ]) },
  gazebo: { category: 'Buildings', label: 'Gazebo', hint: 'An eight-sided gazebo', make: pf('Gazebo', (L) => [
    cyl('Gazebo floor', 10, 0.8, L(0, 0, 0), PB.planks, PB.wood, 8),
    ...[0, 45, 90, 135, 180, 225, 270, 315].map((a) => { const [dx, dz] = [4.2 * Math.cos(a * Math.PI / 180), 4.2 * Math.sin(a * Math.PI / 180)]; return box('Gazebo post', [0.4, 4, 0.4], L(dx, 0.8, dz), CY.white) }),
    { ...cyl('Gazebo roof', 11, 3, L(0, 4.8, 0), SLATE, SLATE, 8), taper: 0 },
  ]) },
  church: { category: 'Buildings', label: 'Chapel', hint: 'A small stone chapel with a spire', make: pf('Chapel', (L) => [
    box('Chapel', [12, 9, 20], L(0, 0, 0), STONE, STONE), { ...box('Roof', [13, 5, 21], L(0, 9, 0), SLATE), kind: 'roof', rot: 90 },
    box('Tower', [5, 16, 5], L(0, 0, 11), STONE), { ...cyl('Spire', 5.6, 7, L(0, 16, 11), SLATE, SLATE, 4, 45), taper: 0 },
    box('Door', [3, 5, 0.2], L(0, 0, 13.6), PB.wood),
  ]) },
  kiosk: { category: 'Buildings', label: 'Kiosk', hint: 'A small kiosk with a sloped roof', make: pf('Kiosk', (L) => [
    { ...box('Kiosk', [5, 3.5, 4], L(0, 0, 0), PB.yellow, PB.yellow), bevel: 0.2 }, ramp('Kiosk roof', [6, 1, 5], L(0, 3.5, 0), PB.red, PB.red, 180),
    box('Counter', [4, 0.3, 1], L(0, 1.5, 2.3), PB.wood),
  ]) },
  diner: { category: 'Buildings', label: 'Diner', hint: 'A chrome roadside diner', make: pf('Diner', (L) => [
    { ...box('Diner', [24, 6, 10], L(0, 0, 0), PB.steel, { gen: 'storefront', tweak: { color: '#c8ccd0', accent: '#3a5a70', scale: 6, seed: 359 } }), bevel: 1.2 },
    box('Diner sign', [10, 2, 0.4], L(0, 6.5, 0), CY.pink, CY.pink), box('Sign post', [0.4, 0.6, 0.4], L(0, 6, 0), PB.steel),
  ]) },

  // ---------------- street ----------------
  // The arm reaches out over the road (+Z); the lights face along the road (+X), toward the drivers they stop.
  trafficlight: { category: 'Street', label: 'Traffic light', hint: 'A pole with an arm over the road; the lights face +X', make: pf('Traffic light', (L) => [
    cyl('Signal pole', 0.6, 12.2, L(0, 0, 0), PB.black, PB.black, 8), box('Signal arm', [0.36, 0.36, 10.2], L(0, 11.4, 5.1), PB.black),
    { ...box('Signal head', [1, 3.6, 1.14], L(0, 7.7, 9.6), PB.black), bevel: 0.15 }, box('Red', [0.1, 0.6, 0.6], L(0.55, 10.2, 9.6), RED_LIGHT), box('Green', [0.1, 0.6, 0.6], L(0.55, 8.2, 9.6), GREEN_LIGHT),
  ]) },
  stopsign: { category: 'Street', label: 'Stop sign', hint: 'An eight-sided stop sign', make: pf('Stop sign', (L) => [
    cyl('Sign post', 0.2, 5.1, L(0, 0, 0), PB.steel, PB.steel, 6), lying('Stop sign', 1.66, 0.1, L(0, 4.04, 0.15), PB.red, PB.red, 8, 90),
  ]) },
  hydrant: { category: 'Street', label: 'Fire hydrant', hint: 'A red hydrant', make: pf('Hydrant', (L) => [
    // A squat barrel on a flange, a collar and a domed bonnet, with capped outlets either side and to the front.
    cyl('Hydrant flange', 0.76, 0.16, L(0, 0, 0), PB.red, PB.red, 14), { ...cyl('Hydrant barrel', 0.62, 1.22, L(0, 0.16, 0), PB.red, PB.red, 14), taper: 0.92 },
    cyl('Hydrant collar', 0.7, 0.12, L(0, 1.36, 0), PB.red, PB.red, 14), ball('Hydrant bonnet', [0.58, 0.6, 0.58], L(0, 1.18, 0), PB.red, PB.red),
    cyl('Operating nut', 0.14, 0.12, L(0, 1.74, 0), PB.steel, PB.steel, 5),
    lying('Side outlets', 0.22, 1.02, L(0, 0.8, 0), PB.red, PB.steel, 10), lying('Pumper outlet', 0.32, 0.3, L(0, 0.62, 0.36), PB.red, PB.steel, 10, 90),
  ]) },
  mailbox: { category: 'Street', label: 'Mailbox', hint: 'A blue mailbox', make: pf('Mailbox', (L) => [
    { ...box('Mailbox', [1.4, 2.4, 1.4], L(0, 0.4, 0), PB.blue), bevel: 0.25 }, ...posts4(L, 1.1, 1.1, 0.4, PB.black, 0.2),
  ]) },
  vending: { category: 'Street', label: 'Vending machine', hint: 'A glowing drinks machine', make: pf('Vending', (L) => [
    { ...box('Vending machine', [2.2, 4, 1.6], L(0, 0, 0), PB.red, PB.red), bevel: 0.1 }, box('Vending front', [1.5, 2.6, 0.1], L(-0.2, 1, 0.8), SCREEN),
  ]) },
  trashcan: { category: 'Street', label: 'Trash can', hint: 'A street bin', make: pf('Trash can', (L) => [
    { ...cyl('Trash can', 1.4, 2, L(0, 0, 0), PB.black, PB.boxGreen, 12), taper: 1.1 }, cyl('Lid', 1.6, 0.2, L(0, 2, 0), PB.black, PB.black, 12),
  ]) },
  meters: { category: 'Street', label: 'Parking meters', hint: 'A row of three meters', make: pf('Meters', (L) => [-4, 0, 4].flatMap((a) => [
    cyl('Meter post', 0.2, 1.7, L(a, 0, 0), PB.steel, PB.steel, 6), { ...box('Meter', [0.6, 0.7, 0.4], L(a, 1.7, 0), PB.steel), bevel: 0.15 },
  ])) },
  atm: { category: 'Street', label: 'ATM', hint: 'A cash machine kiosk', make: pf('ATM', (L) => [
    { ...box('ATM', [2.4, 4.4, 1.8], L(0, 0, 0), PB.steel, PB.blue), bevel: 0.15 }, box('Screen', [1.2, 0.8, 0.1], L(0, 2.8, 0.9), SCREEN),
  ]) },
  foodcart: { category: 'Street', label: 'Food cart', hint: 'A hot dog cart with an umbrella', make: pf('Food cart', (L) => [
    { ...box('Cart', [4, 2.2, 2], L(0, 0.4, 0), PB.steel, PB.yellow), bevel: 0.15 },
    lying('Wheel', 1, 0.3, L(-2.15, 0, 0), PB.tire, PB.tire, 12), lying('Wheel', 1, 0.3, L(2.15, 0, 0), PB.tire, PB.tire, 12),
    cyl('Umbrella pole', 0.15, 3, L(0, 2.6, 0), PB.steel, PB.steel, 6), { ...cyl('Umbrella', 5, 0.9, L(0, 5.2, 0), PB.red, PB.yellow, 8), taper: 0 },
  ]) },
  jersey: { category: 'Street', label: 'Barrier line', hint: 'Three jersey barriers', ...pfp('Barriers', [{ key: 'n', label: 'Barriers', kind: 'number', min: 1, max: 8, step: 1, default: 3 }], (L, p) => [...Array(+p.n)].map((_, i) => ({ ...box('Jersey barrier', [9.6, 2.6, 1.6], L((i - (+p.n - 1) / 2) * 9.9, 0, 0), PB.concrete), bevel: 0.3 }))) },

  // ---------------- nature ----------------
  palm: { category: 'Nature', label: 'Palm tree', hint: 'A tall palm', make: pf('Palm', (L) => [
    { ...cyl('Palm trunk', 1, 4, L(0, 0, 0), BARK, BARK, 8), taper: 0.85 }, { ...cyl('Palm trunk', 0.85, 4, L(0.4, 4, 0), BARK, BARK, 8), taper: 0.85 },
    { ...cyl('Palm trunk', 0.72, 3, L(0.9, 8, 0), BARK, BARK, 8), taper: 0.8 },
    { ...cyl('Fronds', 8, 1.6, L(0.9, 10.6, 0), PALM, PALM, 6), taper: 0.15 }, { ...cyl('Fronds', 6, 1, L(0.9, 10.2, 0), PALM, PALM, 6), taper: 1.6 },
  ]) },
  deadtree: { category: 'Nature', label: 'Dead tree', hint: 'A bare tree', make: pf('Dead tree', (L) => [
    { ...cyl('Trunk', 1.2, 6, L(0, 0, 0), DEAD, DEAD, 7), taper: 0.5 },
    { ...box('Branch', [0.4, 0.4, 3.5], L(0.9, 4, 0.9), DEAD, DEAD, 45) }, { ...box('Branch', [0.35, 0.35, 3], L(-0.9, 5, -0.6), DEAD, DEAD, -30) },
  ]) },
  bush: { category: 'Nature', label: 'Bush', hint: 'A round bush', make: pf('Bush', (L) => [
    { ...cyl('Bush', 3.2, 1.2, L(0, 0, 0), LEAVES, LEAVES, 9), taper: 1.2 }, { ...cyl('Bush', 3.8, 1.2, L(0, 1.2, 0), LEAVES, LEAVES, 9), taper: 0.4 },
  ]) },
  hedge: { category: 'Nature', label: 'Hedge', hint: 'A trimmed hedge row', ...pfp('Hedge', [{ key: 'len', label: 'Length', kind: 'number', min: 2, max: 60, step: 1, default: 10 }, { key: 'h', label: 'Height', kind: 'number', min: 1, max: 6, step: 0.2, default: 2.4 }], (L, p) => [{ ...box('Hedge', [+p.len, +p.h, 1.8], L(0, 0, 0), LEAVES, LEAVES), bevel: 0.4 }]) },
  rocks: { category: 'Nature', label: 'Rocks', hint: 'A cluster of rocks', make: pf('Rocks', (L) => [
    { ...cyl('Rock', 4, 2.4, L(0, 0, 0), ROCK, ROCK, 6, 10), taper: 0.5 }, { ...cyl('Rock', 2.6, 1.6, L(3, 0, 1), ROCK, ROCK, 5, 40), taper: 0.4 },
    { ...cyl('Rock', 1.8, 1, L(-2.4, 0, 1.6), ROCK, ROCK, 5, 70), taper: 0.5 },
  ]) },
  // Not swimmable: the pond lies on solid ground, so its water could only be ankle-deep.
  pond: { category: 'Nature', label: 'Pond', hint: 'A pond with a natural edge, rocks and reeds. Too shallow to swim in (the ground under it is solid): use the Swimming pool for that', ...pfp('Pond', [
    { key: 'w', label: 'Width', kind: 'number', min: 6, max: 80, step: 1, default: 24 },
    { key: 'd', label: 'Depth', kind: 'number', min: 6, max: 80, step: 1, default: 16 },
    { key: 'shape', label: 'Shape', kind: 'number', min: 1, max: 99, step: 1, default: 7 },
  ], (L, p) => pondParts(L, +p.w, +p.d, +p.shape)) },
  boulder: { category: 'Nature', label: 'Boulder', hint: 'A big boulder to hide behind', make: pf('Boulder', (L) => [
    { ...cyl('Boulder', 7, 2.5, L(0, 0, 0), ROCK, ROCK, 7, 15), taper: 1.15 }, { ...cyl('Boulder', 8, 2.5, L(0, 2.5, 0), ROCK, ROCK, 7, 35), taper: 0.45 },
  ]) },
  flowers: { category: 'Nature', label: 'Flower bed', hint: 'A raised flower bed', make: pf('Flowers', (L) => [{ ...box('Flower bed', [8, 0.9, 3], L(0, 0, 0), FLOWERS, STONE), bevel: 0.15 }]) },
  logs: { category: 'Nature', label: 'Log pile', hint: 'Stacked logs', make: pf('Logs', (L) => [
    ...[-1.1, 0, 1.1].map((a) => lying('Log', 1.1, 6, L(0, 0, a), LOG_END, BARK, 10)),
    ...[-0.55, 0.55].map((a) => lying('Log', 1.1, 6.2, L(0, 0.95, a), LOG_END, BARK, 10)), lying('Log', 1.1, 5.8, L(0, 1.9, 0), LOG_END, BARK, 10),
  ]) },
  hay: { category: 'Nature', label: 'Hay bales', hint: 'Stacked hay bales', make: pf('Hay', (L) => [
    ...[-1.6, 1.6].map((a) => ({ ...box('Hay bale', [3, 1.6, 2], L(a, 0, 0), HAY, HAY), bevel: 0.2 })), { ...box('Hay bale', [3, 1.6, 2], L(0, 1.6, 0), HAY, HAY), bevel: 0.2 },
  ]) },

  // ---------------- paintball ----------------
  snake: { category: 'Paintball', label: 'Snake', hint: 'Long low bunker to crawl behind', ...pfp('Snake', [bunkerColor('yellow'), { key: 'len', label: 'Length', kind: 'number', min: 6, max: 40, step: 1, default: 14 }], (L, p) => [{ ...box('Snake', [3, 2, +p.len], L(0, 0, 0), B(p)), bevel: 0.8 }]) },
  dorito: { category: 'Paintball', label: 'Dorito', hint: 'Triangle bunker', ...pfp('Dorito', [bunkerColor('orange')], (L, p) => [cyl('Dorito', 4.2, 3.2, L(0, 0, 0), B(p), B(p), 3, 90)]) },
  can: { category: 'Paintball', label: 'Can', hint: 'Tall round bunker', ...pfp('Can', [bunkerColor('blue'), { key: 'h', label: 'Height', kind: 'number', min: 2, max: 8, step: 0.5, default: 4 }], (L, p) => [cyl('Can', 3, +p.h, L(0, 0, 0), B(p), B(p), 16)]) },
  cake: { category: 'Paintball', label: 'Cake', hint: 'Low round-cornered block', ...pfp('Cake', [bunkerColor('green')], (L, p) => [{ ...box('Cake', [5, 2.2, 5], L(0, 0, 0), B(p)), bevel: 0.8 }]) },
  temple: { category: 'Paintball', label: 'Temple', hint: 'T-shaped bunker', ...pfp('Temple', [bunkerColor('red')], (L, p) => [{ ...box('Temple', [6, 3.5, 1.6], L(0, 0, 0), B(p)), bevel: 0.6 }, { ...box('Temple', [1.6, 3.5, 5], L(0, 0, 2.4), B(p)), bevel: 0.6 }]) },
  maya: { category: 'Paintball', label: 'Maya', hint: 'Stepped pyramid bunker', ...pfp('Maya', [bunkerColor('yellow')], (L, p) => [{ ...box('Maya', [6, 1.6, 6], L(0, 0, 0), B(p)), bevel: 0.5 }, { ...box('Maya', [3.6, 1.6, 3.6], L(0, 1.6, 0), B(p)), bevel: 0.5 }]) },
  xbunker: { category: 'Paintball', label: 'X bunker', hint: 'Crossed center bunker', ...pfp('X bunker', [bunkerColor('red')], (L, p) => [{ ...box('X bunker', [10, 3, 2], L(0, 0, 0), B(p), B(p), 45), bevel: 0.7 }, { ...box('X bunker', [10, 3, 2], L(0, 0, 0), B(p), B(p), -45), bevel: 0.7 }]) },
  tombstone: { category: 'Paintball', label: 'Tombstone', hint: 'Tall thin bunker', ...pfp('Tombstone', [bunkerColor('green')], (L, p) => [{ ...box('Tombstone', [2.2, 4.4, 1.3], L(0, 0, 0), B(p)), bevel: 0.5 }]) },
  wedge: { category: 'Paintball', label: 'Wedge', hint: 'A ramp-shaped bunker', ...pfp('Wedge', [bunkerColor('blue')], (L, p) => [ramp('Wedge', [4, 3, 5], L(0, 0, 0), B(p), B(p))]) },
  pin: { category: 'Paintball', label: 'Pin', hint: 'A cone-shaped bunker', ...pfp('Pin', [bunkerColor('orange')], (L, p) => [{ ...cyl('Pin', 3, 5, L(0, 0, 0), B(p), B(p), 16), taper: 0.25 }]) },
  spool: { category: 'Paintball', label: 'Cable spool', hint: 'A big wooden spool', make: pf('Spool', (L) => [cyl('Spool', 5, 0.5, L(0, 0, 0), PB.planks, PB.wood), cyl('Spool core', 2.6, 2.5, L(0, 0.5, 0), PB.wood), cyl('Spool', 5, 0.5, L(0, 3, 0), PB.planks, PB.wood)]) },
  tirestack: { category: 'Paintball', label: 'Tire wall', hint: 'Three stacks of tires', make: pf('Tire wall', (L) => [-2.5, 0, 2.5].flatMap((a, i) => [0, 1, 2].slice(0, 2 + (i % 2)).map((k) => ({ ...cyl('Tire', 2.4, 0.8, L(a, k * 0.8, 0), PB.tire, PB.tire, 12), taper: 1 })))) },
  palletwall: { category: 'Paintball', label: 'Pallet wall', hint: 'Pallets stood up as a wall', make: pf('Pallet wall', (L) => [-2.4, 0, 2.4].map((a) => box('Pallet', [2.2, 3.6, 0.4], L(a, 0, 0), PB.wood, PB.wood, 0, 2))) },
  netting: { category: 'Paintball', label: 'Netting', hint: 'A field netting panel on poles', make: pf('Netting', (L) => [box('Net', [12, 6, 0.1], L(0, 0, 0), NET, NET, 0, 4), cyl('Net pole', 0.3, 6.5, L(-6, 0, 0), PB.steel, PB.steel, 6), cyl('Net pole', 0.3, 6.5, L(6, 0, 0), PB.steel, PB.steel, 6)]) },

  // ---------------- cyber ----------------
  neonpillar: { category: 'Cyber', label: 'Neon pillar', hint: 'A glowing octagonal pillar', ...pfp('Neon pillar', [neonColor('cyan'), { key: 'h', label: 'Height', kind: 'number', min: 2, max: 30, step: 1, default: 8 }], (L, p) => [cyl('Pillar base', 3.2, 0.8, L(0, 0, 0), CY.dark, CY.panel, 8), cyl('Neon pillar', 2.2, +p.h, L(0, 0.8, 0), N(p), N(p), 8), cyl('Pillar cap', 3.2, 0.6, L(0, 0.8 + +p.h, 0), CY.dark, CY.panel, 8)]) },
  hexpillar: { category: 'Cyber', label: 'Hex pillar', hint: 'A six-sided block', ...pfp('Hex pillar', [neonColor('purple'), { key: 'h', label: 'Height', kind: 'number', min: 1, max: 30, step: 0.5, default: 4 }], (L, p) => [cyl('Hex pillar', 6, +p.h, L(0, 0, 0), CY.dark, N(p), 6)]) },
  lightgate: { category: 'Cyber', label: 'Light gate', hint: 'A glowing arch to run through', ...pfp('Light gate', [neonColor('pink')], (L, p) => [
    { ...box('Gate leg', [1.2, 7, 1.2], L(-4, 0, 0), N(p)), bevel: 0.2 }, { ...box('Gate leg', [1.2, 7, 1.2], L(4, 0, 0), N(p)), bevel: 0.2 }, { ...box('Gate top', [9.2, 1.2, 1.2], L(0, 7, 0), N(p)), bevel: 0.2 },
  ]) },
  jumppad: { category: 'Cyber', label: 'Jump pad', hint: 'A glowing launch ramp', make: pf('Jump pad', (L) => [ramp('Jump pad', [4, 1.6, 6], L(0, 0, 0), CY.lime, CY.panel), box('Pad lip', [4, 0.3, 0.6], L(0, 1.3, -3.2), CY.lime)]) },
  holowall: { category: 'Cyber', label: 'Energy wall', hint: 'A glowing wall panel in a frame', ...pfp('Energy wall', [neonColor('cyan')], (L, p) => [box('Energy wall', [8, 4, 0.3], L(0, 0, 0), N(p), N(p)), box('Wall frame', [8.6, 0.4, 0.6], L(0, 4, 0), CY.dark), box('Wall frame', [8.6, 0.4, 0.6], L(0, -0.01, 0), CY.dark)]) },
  floatplat: { category: 'Cyber', label: 'Sky platform', hint: 'A raised platform with a ramp up', make: pf('Sky platform', (L) => [
    { ...box('Platform', [10, 1, 10], L(0, 5, 0), CY.gridCyan, CY.panel), bevel: 0.2 }, ...posts4(L, 8, 8, 5, CY.dark, 0.8), ramp('Ramp', [3, 6, 12], L(0, 0, 11), CY.dark, CY.panel),
  ]) },
  datacore: { category: 'Cyber', label: 'Data core', hint: 'A tall glowing core on a base', make: pf('Data core', (L) => [cyl('Core base', 8, 1.2, L(0, 0, 0), CY.dark, CY.panel, 12), cyl('Data core', 4, 10, L(0, 1.2, 0), CY.purple, CY.purple, 12), { ...cyl('Core tip', 4, 2, L(0, 11.2, 0), CY.purple, CY.purple, 12), taper: 0 }]) },
  serverrow: { category: 'Cyber', label: 'Server racks', hint: 'A row of blinking racks', make: pf('Servers', (L) => [-3.2, 0, 3.2].map((a) => box('Server rack', [3, 7, 2.5], L(a, 0, 0), CY.chip, CY.windows))) },
  neoncube: { category: 'Cyber', label: 'Neon crates', hint: 'Stacked glowing cubes', make: pf('Neon crates', (L) => [{ ...box('Neon crate', [3, 3, 3], L(-1.6, 0, 0), CY.pink), bevel: 0.25 }, { ...box('Neon crate', [3, 3, 3], L(1.6, 0, 0), CY.cyan), bevel: 0.25 }, { ...box('Neon crate', [3, 3, 3], L(0, 3, 0), CY.lime), bevel: 0.25 }]) },

  // ---------------- fun & games ----------------
  halfpipe: { category: 'Fun & games', label: 'Half-pipe', hint: 'Two ramps facing each other', make: pf('Half-pipe', (L) => [ramp('Ramp', [10, 4, 7], L(0, 0, -8), PB.concrete, PB.concrete, 0), ramp('Ramp', [10, 4, 7], L(0, 0, 8), PB.concrete, PB.concrete, 180), box('Deck', [10, 4, 2], L(0, 0, -12.5), PB.concrete), box('Deck', [10, 4, 2], L(0, 0, 12.5), PB.concrete)]) },
  jumpramp: { category: 'Fun & games', label: 'Jump ramp', hint: 'A kicker ramp for cars or players', make: pf('Jump ramp', (L) => [ramp('Kicker', [6, 3, 10], L(0, 0, 0), HAZARD, PB.steel)]) },
  koth: { category: 'Fun & games', label: 'King of the hill', hint: 'A tall tower with stairs to a fenced top', make: pf('King of the hill', (L) => [
    box('Hill tower', [10, 10, 10], L(0, 0, 0), CY.gridPink, PB.concrete), stairs('Stairs', [3, 10, 14], L(0, 0, 12), PB.concrete, PB.concrete, 0, 14),
    ...[[0, -4.8, 0], [-4.8, 0, 90], [4.8, 0, 90]].map(([a, b, r]) => box('Top rail', [10, 1.2, 0.4], L(a, 10, b), HAZARD, HAZARD, r)),
    cyl('Flag pole', 0.3, 6, L(3.5, 10, -3.5), PB.steel, PB.steel, 6), box('Flag', [2.4, 1.6, 0.1], L(4.8, 14.2, -3.5), PB.red),
  ]) },
  ladder: { category: 'Fun & games', label: 'Climbing tower', hint: 'Platforms at two heights with stairs between', make: pf('Climbing tower', (L) => [
    box('Level 1', [8, 0.6, 8], L(0, 4, 0), PB.planks, PB.wood), box('Level 2', [5, 0.6, 5], L(1.5, 8, 1.5), PB.planks, PB.wood),
    ...posts4(L, 7.6, 7.6, 4, PB.wood, 0.5), ...posts4(L, 4.6, 4.6, 3.4, PB.wood, 0.4, 4.6),
    stairs('Stairs', [3, 4, 6], L(-2.5, 0, 7), PB.wood, PB.wood, 0, 6), stairs('Stairs', [2, 3.4, 4], L(-2.5, 4.6, -1), PB.wood, PB.wood, 180, 5),
  ]) },
  mazetile: { category: 'Fun & games', label: 'Maze tile', hint: 'A 20 x 20 maze section', make: pf('Maze tile', (L) => [
    ...[[-10, 0, 20, 0], [10, 0, 20, 0], [0, -10, 12, 90], [-4, 4, 8, 90], [4, -2, 8, 0]].map(([a, b, len, r]) => box('Maze wall', [len, 4, 1], L(a, 0, b), CY.dark, CY.cyan, r)),
  ]) },
  capture: { category: 'Fun & games', label: 'Capture ring', hint: 'A glowing ring on the floor to mark a zone', make: pf('Capture ring', (L) => [cyl('Capture ring', 12, 0.12, L(0, 0, 0), CY.lime, CY.lime, 24), cyl('Ring center', 10, 0.13, L(0, 0, 0), CY.dark, CY.dark, 24)]) },
  hurdles: { category: 'Fun & games', label: 'Hurdles', hint: 'Three low hurdles to vault', make: pf('Hurdles', (L) => [-6, 0, 6].flatMap((a) => [box('Hurdle', [6, 0.3, 0.3], L(0, 1.6, a), HAZARD), box('Hurdle leg', [0.3, 1.6, 0.3], L(-2.8, 0, a), PB.steel), box('Hurdle leg', [0.3, 1.6, 0.3], L(2.8, 0, a), PB.steel)])) },
  spawnroom: { category: 'Fun & games', label: 'Spawn room', hint: 'A walled room with a doorway, to protect a team start', make: pf('Spawn room', (L) => [
    box('Wall', [14, 5, 0.8], L(0, 0, -6), PB.concrete), box('Wall', [0.8, 5, 12], L(-7, 0, 0), PB.concrete), box('Wall', [0.8, 5, 12], L(7, 0, 0), PB.concrete),
    box('Wall', [5, 5, 0.8], L(-4.5, 0, 6), PB.concrete), box('Wall', [5, 5, 0.8], L(4.5, 0, 6), PB.concrete), box('Lintel', [4, 1, 0.8], L(0, 4, 6), HAZARD),
    box('Roof', [14.8, 0.6, 12.8], L(0, 5, 0), PB.concrete),
  ]) },
  bridge: { category: 'Fun & games', label: 'Plank bridge', hint: 'A raised walkway with ramps at both ends', make: pf('Plank bridge', (L) => [
    box('Bridge deck', [3, 0.5, 16], L(0, 4, 0), PB.planks, PB.wood), ramp('Ramp', [3, 4, 8], L(0, 0, 12), PB.planks, PB.wood, 0), ramp('Ramp', [3, 4, 8], L(0, 0, -12), PB.planks, PB.wood, 180),
    box('Rail', [0.2, 1, 16], L(-1.4, 4.5, 0), PB.wood), box('Rail', [0.2, 1, 16], L(1.4, 4.5, 0), PB.wood),
  ]) },

  // ---------------- military & industrial ----------------
  bunker: { category: 'Military', label: 'Concrete bunker', hint: 'A pillbox with a firing slot', make: pf('Bunker', (L) => [
    box('Bunker wall', [10, 2, 8], L(0, 0, 0), PB.concrete), box('Bunker wall', [10, 1.4, 8], L(0, 2.8, 0), PB.concrete),
    box('Slot post', [1, 0.8, 8], L(-4.5, 2, 0), PB.concrete), box('Slot post', [1, 0.8, 8], L(4.5, 2, 0), PB.concrete),
  ]) },
  sandbagwall: { category: 'Military', label: 'Sandbag wall', hint: 'A curved sandbag position', make: pf('Sandbags', (L) => [-30, 0, 30].map((r, i) => {
    const [dx, dz] = turn(0, -4, r); return { ...box('Sandbags', [4.4, 1.8, 1.4], L(dx, 0, dz + 4 - (i === 1 ? 0 : 0.6)), SANDBAG, SANDBAG, r), bevel: 0.35 }
  })) },
  barrels: { category: 'Industrial', label: 'Barrels', hint: 'A cluster of oil drums', make: pf('Barrels', (L) => [[0, 0, PB.boxBlue], [1.8, 0.4, PB.red], [0.9, 1.7, PB.boxGreen], [-1.6, 1, PB.boxBlue]].map(([a, b, t]) => cyl('Barrel', 1.6, 2.2, L(a as number, 0, b as number), t as Tex, t as Tex, 12))) },
  fueltank: { category: 'Industrial', label: 'Fuel tank', hint: 'A big tank with a ladder', make: pf('Fuel tank', (L) => [cyl('Tank', 10, 8, L(0, 0, 0), PB.steel, PB.steel, 20), { ...cyl('Tank roof', 10, 1.4, L(0, 8, 0), PB.steel, PB.steel, 20), taper: 0.3 }, box('Ladder', [0.8, 9, 0.2], L(0, 0, 5.05), PB.rusty)]) },
  piperack: { category: 'Industrial', label: 'Pipe rack', hint: 'Pipes on a raised frame to walk under', make: pf('Pipe rack', (L) => [
    ...[-8, 0, 8].flatMap((a) => [box('Rack leg', [0.6, 6, 0.6], L(a, 0, -2), PB.steel), box('Rack leg', [0.6, 6, 0.6], L(a, 0, 2), PB.steel), box('Rack beam', [0.5, 0.5, 4.6], L(a, 6, 0), PB.steel)]),
    ...[-1.2, 0, 1.2].map((b, i) => lying('Pipe', 0.9, 18, L(0, 6.5, b), [PB.steel, PB.rusty, PB.yellow][i], [PB.steel, PB.rusty, PB.yellow][i], 12)),
  ]) },
  catwalk: { category: 'Industrial', label: 'Catwalk', hint: 'A raised walkway with stairs', make: pf('Catwalk', (L) => [
    box('Catwalk', [16, 0.4, 3], L(0, 6, 0), PB.diamond, PB.steel), ...[-7.5, 7.5].flatMap((a) => [box('Leg', [0.4, 6, 0.4], L(a, 0, -1.3), PB.steel), box('Leg', [0.4, 6, 0.4], L(a, 0, 1.3), PB.steel)]),
    box('Rail', [16, 1, 0.15], L(0, 6.4, 1.4), PB.yellow), stairs('Stairs', [3, 6.4, 8], L(-12, 0, 0), PB.diamond, PB.steel, 270, 9),
  ]) },
  generator: { category: 'Industrial', label: 'Generator', hint: 'A diesel generator on skids', make: pf('Generator', (L) => [{ ...box('Generator', [6, 3, 3], L(0, 0.4, 0), PB.yellow, PB.yellow), bevel: 0.2 }, box('Skid', [6.4, 0.4, 0.4], L(0, 0, -1.2), PB.steel), box('Skid', [6.4, 0.4, 0.4], L(0, 0, 1.2), PB.steel), cyl('Exhaust', 0.4, 2, L(2, 3.4, 0), PB.black, PB.black, 8)]) },
  forklift: { category: 'Industrial', label: 'Forklift', hint: 'A forklift with raised forks', make: pf('Forklift', (L) => [
    { ...box('Forklift', [3, 2, 4.5], L(0, 0.4, 0), PB.yellow), bevel: 0.25 }, box('Mast', [2.6, 5, 0.3], L(0, 0.4, 2.5), PB.black), box('Forks', [2, 0.2, 2.4], L(0, 1.6, 3.8), PB.steel),
    ...posts4(L, 2.6, 2.4, 2.4, PB.black, 0.15, 2.4), box('Cab roof', [2.8, 0.2, 2.6], L(0, 4.8, 0), PB.black),
    ...wheels(L, 3.1, [-1.4, 1.4], 1.1, 0.5),
  ]) },
  pallets: { category: 'Industrial', label: 'Pallet stack', hint: 'Pallets with boxes', make: pf('Pallet stack', (L) => [box('Pallet', [4, 0.6, 4], L(0, 0, 0), PB.wood), { ...box('Boxes', [3.6, 2.4, 3.6], L(0, 0.6, 0), PB.plywood), bevel: 0.1 }, box('Pallet', [4, 0.6, 4], L(0, 3, 0), PB.wood)]) },

  // ---------------- sports ----------------
  hoop: { category: 'Sports', label: 'Basketball hoop', hint: 'A hoop on a pole', make: pf('Hoop', (L) => [cyl('Hoop pole', 0.5, 7, L(0, 0, 0), PB.steel, PB.steel, 8), box('Backboard', [4, 3, 0.3], L(0, 6, 0.8), CY.white), { ...cyl('Rim', 1.6, 0.15, L(0, 6.2, 1.8), PB.orange, PB.orange, 12), taper: 1 }]) },
  goal: { category: 'Sports', label: 'Soccer goal', hint: 'A goal frame with netting', make: pf('Goal', (L) => [box('Goal post', [0.4, 4.6, 0.4], L(-7, 0, 0), CY.white), box('Goal post', [0.4, 4.6, 0.4], L(7, 0, 0), CY.white), box('Crossbar', [14.4, 0.4, 0.4], L(0, 4.6, 0), CY.white), box('Goal net', [14, 4.6, 0.1], L(0, 0, -3), NET, NET, 0, 4)]) },
  bleachers: { category: 'Sports', label: 'Bleachers', hint: 'Five rows of seats', ...pfp('Bleachers', [{ key: 'rows', label: 'Rows', kind: 'number', min: 2, max: 12, step: 1, default: 5 }, { key: 'w', label: 'Width', kind: 'number', min: 6, max: 60, step: 1, default: 16 }], (L, p) => [stairs('Bleachers', [+p.w, +p.rows, +p.rows * 1.6], L(0, 0, 0), PB.wood, PB.steel, 0, +p.rows)]) },
  pool: { category: 'Sports', label: 'Swimming pool', hint: 'A raised pool you can swim in' + statusParen('water') + ', with steps in and out and walls low enough to climb', ...pfp('Pool', [
    { key: 'w', label: 'Width', kind: 'number', min: 6, max: 60, step: 1, default: 16 },
    { key: 'd', label: 'Length', kind: 'number', min: 8, max: 80, step: 1, default: 24 },
    { key: 'depth', label: 'Water depth', kind: 'number', min: 3, max: POOL_MAX_DEPTH, step: 0.5, default: 4 },
  ], (L, p) => poolParts(L, +p.w, +p.d, +p.depth)) },
}
