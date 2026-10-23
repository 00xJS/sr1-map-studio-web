// Prefabs: ready-made pieces built from simple shapes. Each one is a group of
// parts that the builder exports as a single object with several materials
// (walls, trim, glass, roof...), so a detailed building stays one item in the
// editor and one mesh in the game. Used by the sample maps and by the editor's
// Shape tool.
import type { Vec3 } from './project'
import { CY, PB, box, cyl, lying, ramp, stairs, turn, type Part, type Tex } from './sampleKit'

/** A floor of a building, in units (3.5 m). */
export const FLOOR = 7

/** Tags parts as one prefab; the id must be unique in the map (position-based ids are). */
export const group = (id: string, parts: Part[]): Part[] => parts.map((p) => ({ ...p, group: id }))
const gid = (name: string, x: number, y: number, z: number) => `${name}@${+x.toFixed(2)},${+y.toFixed(2)},${+z.toFixed(2)}`

/** Parts given in a local frame (dx, dy, dz from the base) placed and turned as one piece. */
export function local(x: number, y: number, z: number, rot: number, make: (L: (dx: number, dy: number, dz: number) => Vec3) => Part[]): Part[] {
  const L = (dx: number, dy: number, dz: number): Vec3 => { const [ox, oz] = turn(dx, dz, rot); return [x + ox, y + dy, z + oz] }
  return make(L).map((p) => ({ ...p, rot: ((p.rot ?? 0) + rot) % 360 }))
}

// ---------------- buildings ----------------

export type Style = 'brick' | 'darkbrick' | 'plaster' | 'beige' | 'apartment' | 'office' | 'glass' | 'concrete' | 'projects' | 'stone' | 'shop' | 'warehouse' | 'club' | 'cyber' | 'cyberpink'

interface StyleInfo { wall: string; glass: string; bricks?: boolean; across: number; ledges: boolean; store: boolean; tank: boolean; fire: boolean; trim: Tex; roof: Tex; neon?: Tex }
const ROOF: Tex = { lib: 'gravel_concrete_03', surface: 12 }
const STONE: Tex = { lib: 'medieval_blocks_03', surface: 0 }
const STYLES: Record<Style, StyleInfo> = {
  brick: { wall: '#8a3b2a', glass: '#2e3b48', bricks: true, across: 2, ledges: true, store: true, tank: true, fire: true, trim: PB.concrete, roof: ROOF },
  darkbrick: { wall: '#5e3528', glass: '#283440', bricks: true, across: 2, ledges: true, store: true, tank: true, fire: true, trim: PB.concrete, roof: ROOF },
  plaster: { wall: '#c9c2b0', glass: '#32414e', across: 2, ledges: true, store: true, tank: false, fire: false, trim: PB.concrete, roof: ROOF },
  beige: { wall: '#cbb89a', glass: '#33404c', across: 2, ledges: true, store: true, tank: true, fire: false, trim: PB.concrete, roof: ROOF },
  apartment: { wall: '#b9a789', glass: '#2f3c49', across: 3, ledges: true, store: false, tank: true, fire: true, trim: PB.concrete, roof: ROOF },
  office: { wall: '#3c454e', glass: '#46657d', across: 3, ledges: false, store: true, tank: false, fire: false, trim: PB.steel, roof: ROOF },
  glass: { wall: '#2f4a46', glass: '#4f7f86', across: 4, ledges: false, store: false, tank: false, fire: false, trim: PB.steel, roof: ROOF },
  concrete: { wall: '#9a978f', glass: '#2e3740', across: 2, ledges: true, store: false, tank: false, fire: false, trim: PB.concrete, roof: ROOF },
  projects: { wall: '#8d8478', glass: '#2a3138', across: 3, ledges: true, store: false, tank: false, fire: false, trim: PB.concrete, roof: ROOF },
  stone: { wall: '#a59d8c', glass: '#2a3138', across: 2, ledges: true, store: false, tank: false, fire: false, trim: STONE, roof: { lib: 'roof_slates_03', surface: 0 } },
  shop: { wall: '#c4b49a', glass: '#33404c', across: 2, ledges: true, store: true, tank: false, fire: false, trim: PB.concrete, roof: ROOF },
  warehouse: { wall: '#8c949a', glass: '#2c3238', across: 1, ledges: false, store: false, tank: false, fire: false, trim: PB.steel, roof: ROOF },
  club: { wall: '#1b1622', glass: '#ff3dd8', across: 3, ledges: false, store: false, tank: false, fire: false, trim: PB.steel, roof: ROOF, neon: CY.pink },
  cyber: { wall: '#14181f', glass: '#18d8ff', across: 3, ledges: false, store: false, tank: false, fire: false, trim: CY.panelLight, roof: CY.dark, neon: CY.cyan },
  cyberpink: { wall: '#18141f', glass: '#ff5ce1', across: 3, ledges: false, store: false, tank: false, fire: false, trim: CY.panelLight, roof: CY.dark, neon: CY.pink },
}
const SEED: Record<Style, number> = { brick: 301, darkbrick: 302, plaster: 303, beige: 304, apartment: 305, office: 306, glass: 307, concrete: 308, projects: 309, stone: 310, shop: 311, warehouse: 312, club: 313, cyber: 314, cyberpink: 315 }

export const facadeTex = (style: Style): Tex => {
  const st = STYLES[style]
  return { gen: 'facade', tweak: { color: st.wall, accent: st.glass, scale: st.across, wear: 0.3, seed: SEED[style], bricks: !!st.bricks }, surface: st.bricks ? 0 : 5 }
}
const STORE: Tex = { gen: 'storefront', tweak: { seed: 321 } }
const GARAGE: Tex = { gen: 'garage_door', tweak: { seed: 322 } }
const DOOR: Tex = { gen: 'storefront', tweak: { color: '#2a2622', accent: '#1d2024', scale: 1, seed: 323 } }
const AWNINGS: Tex[] = [PB.red, PB.green, PB.blue, PB.orange, PB.yellow]

export interface BuildingOptions {
  x: number; z: number; w: number; d: number; h: number; y?: number
  style: Style
  /** Which side is the street front; default: the side facing the map's center. */
  front?: 'N' | 'S' | 'E' | 'W'
  roof?: Tex
  label?: string
  /** Spots (spawns, pickups) that rooftop clutter must stay away from. */
  keepClear?: Vec3[]
  /** Leave out the awning over the shop front (the map has its own there). */
  noAwning?: boolean
  /** Side the fire escape climbs (default: beside the front), or 'none'. */
  escape?: 'N' | 'S' | 'E' | 'W' | 'none'
}

/** A building with a storefront, window floors, ledges, a cornice, a parapet and rooftop clutter. Stays inside its footprint except for awnings and fire escapes (under 3 units out). */
export function building(o: BuildingOptions): Part[] {
  const st = STYLES[o.style]
  const y = o.y ?? 1
  const { x, z, w, d, h } = o
  const floors = Math.max(1, Math.round(h / FLOOR))
  const front = o.front ?? (Math.abs(x) > Math.abs(z) ? (x > 0 ? 'W' : 'E') : (z > 0 ? 'N' : 'S'))
  // Front face: rotation that turns local +Z toward the front.
  const rot = { S: 0, N: 180, E: 90, W: 270 }[front]
  const fw = front === 'N' || front === 'S' ? w : d // front width
  const fd = front === 'N' || front === 'S' ? d : w // depth behind the front
  const id = gid(o.label ?? 'Building', x, y, z)
  const roof = o.roof ?? st.roof
  const parts: Part[] = [box(o.label ?? 'Building', [w, h, d], [x, y, z], roof, facadeTex(o.style), 0, FLOOR)]
  const L = (dx: number, dy: number, dz: number): Vec3 => { const [ox, oz] = turn(dx, dz, rot); return [x + ox, y + dy, z + oz] }

  // Ground floor: shop windows and a door on the front, an awning over them.
  if (st.store && h >= FLOOR) {
    parts.push(box('Storefront', [fw - 1, 5.5, 0.3], L(0, 0.4, fd / 2 + 0.1), STORE, STORE, rot, 5.5))
    if (!o.noAwning) parts.push(box('Awning', [Math.min(fw - 2, 14), 0.3, 2.6], L(0, 5.2, fd / 2 + 1.4), AWNINGS[Math.abs(Math.round(x + z)) % AWNINGS.length], AWNINGS[Math.abs(Math.round(x * 3 + z)) % AWNINGS.length], rot, 2))
  } else if (o.style === 'warehouse') {
    parts.push(box('Roll-up door', [Math.min(8, fw - 2), 6, 0.3], L(0, 0, fd / 2 + 0.1), GARAGE, GARAGE, rot, 8))
  } else {
    parts.push(box('Door', [3, 5, 0.3], L(0, 0, fd / 2 + 0.1), DOOR, DOOR, rot, 5))
  }
  if (st.neon) parts.push(box('Neon sign', [Math.min(fw - 4, 10), 1.2, 0.3], L(0, Math.min(h - 2, 7), fd / 2 + 0.2), st.neon, st.neon, rot, 2))

  // Ledges between floors and a cornice: the outline of a real facade.
  if (st.ledges) for (let f = 1; f < floors; f++) parts.push(box('Ledge', [w + 0.5, 0.35, d + 0.5], [x, y + f * FLOOR - 0.2, z], st.trim, st.trim, 0, 2))
  // Its top stays a little under the roof: two surfaces at the same height flicker as the camera moves.
  parts.push(box('Cornice', [w + 1, 0.64, d + 1], [x, y + h - 0.7, z], st.trim, st.trim, 0, 2))
  // Parapet round the roof edge.
  const top = y + h
  parts.push(
    box('Parapet', [w, 1.1, 0.5], [x, top, z - d / 2 + 0.25], st.trim, st.trim),
    box('Parapet', [w, 1.1, 0.5], [x, top, z + d / 2 - 0.25], st.trim, st.trim),
    box('Parapet', [0.5, 1.1, d - 1], [x - w / 2 + 0.25, top, z], st.trim, st.trim),
    box('Parapet', [0.5, 1.1, d - 1], [x + w / 2 - 0.25, top, z], st.trim, st.trim),
  )
  // Rooftop clutter near the corners, leaving the middle of the roof clear.
  const clutterFrom = parts.length
  if (w >= 12 && d >= 12) {
    const cx = w / 2 - 3.5, cz = d / 2 - 3.5
    parts.push({ ...box('AC unit', [3, 2, 4], [x - cx, top, z - cz], PB.steel), bevel: 0.2 })
    parts.push(cyl('Vent', 1.2, 1.6, [x + cx, top, z - cz], PB.steel, PB.steel, 10))
    if (st.tank) {
      parts.push(...[[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]].map(([a, b]) => box('Tank leg', [0.4, 3, 0.4], [x + cx - 1 + a, top, z + cz - 1 + b], PB.steel)))
      parts.push(cyl('Water tank', 4, 4.5, [x + cx - 1, top + 3, z + cz - 1], PB.wood, { lib: 'weathered_brown_planks', surface: 21 }, 16))
      parts.push({ ...cyl('Tank roof', 4.4, 1.6, [x + cx - 1, top + 7.5, z + cz - 1], PB.wood, PB.wood, 16), taper: 0 })
    } else {
      parts.push(box('Stair hut', [4, 3.2, 4], [x - cx + 0.5, top, z + cz - 0.5], st.trim, st.trim))
      if (o.style === 'office' || o.style === 'glass' || o.style === 'cyber' || o.style === 'cyberpink') parts.push(cyl('Antenna', 0.3, 8, [x + cx, top, z + cz], PB.steel, PB.steel, 6))
    }
  }
  // Nothing on the roof where a marker stands.
  const clear = (o.keepClear ?? []).filter((m) => Math.abs(m[1] - top) < 0.5)
  if (clear.length) {
    const kept = parts.slice(clutterFrom).filter((p) => clear.every((m) => Math.hypot(m[0] - p.at[0], m[2] - p.at[2]) > Math.max(p.size[0], p.size[2]) / 2 + 2.5))
    parts.splice(clutterFrom, parts.length - clutterFrom, ...kept)
  }
  // Fire escape: a landing per floor down one side.
  if (st.fire && floors >= 2 && o.escape !== 'none') {
    const side = o.escape ?? (front === 'N' || front === 'S' ? 'E' : 'S')
    const srot = { S: 0, N: 180, E: 90, W: 270 }[side]
    const sd = side === 'E' || side === 'W' ? w : d
    for (let f = 1; f < floors; f++) {
      const [ox, oz] = turn(0, sd / 2 + 1.25, srot)
      parts.push(box('Fire escape', [8, 0.25, 2.5], [x + ox, y + f * FLOOR, z + oz], PB.rusty, PB.rusty, srot))
      const [rx, rz] = turn(0, sd / 2 + 2.4, srot)
      parts.push(box('Railing', [8, 1, 0.15], [x + rx, y + f * FLOOR + 0.25, z + rz], PB.rusty, PB.rusty, srot))
      // A ladder up to the next landing, at alternate ends.
      if (f < floors - 1) {
        const end = f % 2 ? 3.2 : -3.2
        for (const a of [-0.4, 0.4]) {
          const [lx, lz] = turn(end + a, sd / 2 + 1.9, srot)
          parts.push(box('Ladder rail', [0.12, FLOOR - 0.25, 0.12], [x + lx, y + f * FLOOR + 0.25, z + lz], PB.rusty, PB.rusty, srot))
        }
        for (let k = 1; k <= 5; k++) {
          const [lx, lz] = turn(end, sd / 2 + 1.9, srot)
          parts.push(box('Ladder rung', [0.8, 0.1, 0.1], [x + lx, y + f * FLOOR + 0.25 + k * 1.15, z + lz], PB.rusty, PB.rusty, srot))
        }
      }
    }
  }
  return group(id, parts)
}

// ---------------- street props ----------------

const CAR_GLASS: Tex = { gen: 'tiles', tweak: { color: '#25313b', accent: '#1a2229', scale: 1, wear: 0, seed: 330 }, surface: 9 }
const HEADLIGHT: Tex = { gen: 'tiles', tweak: { color: '#f4f1e2', accent: '#c9c4ad', scale: 1, wear: 0, seed: 333 }, surface: 9 }
const TAILLIGHT: Tex = { gen: 'tiles', tweak: { color: '#c4161c', accent: '#7a0c10', scale: 1, wear: 0, seed: 334 }, surface: 9 }
const TRIM: Tex = { gen: 'metal_plate', tweak: { color: '#1d1d20', accent: '#1d1d20', scale: 2, wear: 0.1, seed: 335 }, surface: 15 }
const CHROME: Tex = { gen: 'metal_plate', tweak: { color: '#b9bcc0', accent: '#8d9094', scale: 1, wear: 0, seed: 336 }, surface: 15 }

/** Four round wheels with hubcaps, `track` apart side to side, axles at ±`base` along the car. */
export const wheels = (L: (dx: number, dy: number, dz: number) => Vec3, track: number, base: number[], d = 1.3, w = 0.55): Part[] =>
  base.flatMap((b) => [-1, 1].flatMap((sx) => [
    lying('Wheel', d, w, L(sx * track / 2, 0, b), PB.tire, PB.tire, 14),
    lying('Hubcap', d * 0.55, w + 0.06, L(sx * track / 2, (d - d * 0.55) / 2, b), CHROME, CHROME, 10),
  ]))

/** A car: rounded body, glass cabin with a painted roof, lights, bumpers and round wheels. The front is +Z. */
export function car(x: number, z: number, rot: number, paint: Tex, y = 1, len = 8): Part[] {
  const f = len / 2
  return group(gid('Car', x, y, z), local(x, y, z, rot, (L) => [
    { ...box('Car body', [4, 1.35, len], L(0, 0.5, 0), paint, paint), bevel: 0.4 },
    { ...box('Car cabin', [3.5, 1.15, len - 3.8], L(0, 1.85, -0.4), CAR_GLASS, CAR_GLASS), bevel: 0.45 },
    { ...box('Car roof', [3.3, 0.18, len - 4.4], L(0, 3.0, -0.4), paint, paint), bevel: 0.08 },
    { ...box('Bumper', [4.1, 0.45, 0.35], L(0, 0.45, f - 0.05), TRIM, TRIM), bevel: 0.12 },
    { ...box('Bumper', [4.1, 0.45, 0.35], L(0, 0.45, -f + 0.05), TRIM, TRIM), bevel: 0.12 },
    box('Grille', [1.8, 0.45, 0.06], L(0, 0.95, f + 0.02), TRIM),
    ...[-1.45, 1.45].flatMap((a) => [box('Headlight', [0.8, 0.35, 0.06], L(a, 1.1, f + 0.02), HEADLIGHT), box('Tail light', [0.7, 0.35, 0.06], L(a, 1.15, -f - 0.02), TAILLIGHT)]),
    ...[-1, 1].map((sx) => ({ ...box('Mirror', [0.35, 0.25, 0.2], L(sx * 2.1, 1.9, len / 2 - 3), paint, paint), bevel: 0.05 })),
    ...wheels(L, 3.6, [f - 1.4, -f + 1.4]),
  ]))
}

export const carPaint = (color: string, seed: number): Tex => ({ gen: 'metal_plate', tweak: { color, accent: '#333', scale: 1, wear: 0.05, seed }, surface: 15 })

const LEAVES: Tex = { gen: 'grass', tweak: { color: '#2f5e22', accent: '#4c7a2a', scale: 3, wear: 0.2, seed: 84 }, surface: 7 }
const LEAVES2: Tex = { gen: 'grass', tweak: { color: '#3d6e28', accent: '#6a8a34', scale: 3, wear: 0.3, seed: 331 }, surface: 7 }
const BARK: Tex = { gen: 'wood_planks', tweak: { color: '#5a3f2a', accent: '#3a2818', scale: 3, seed: 85 } }

/** A leafy tree (two rounded crowns) or a pine (stacked cones). */
export function tree(x: number, z: number, y = 1, s = 1, pine = false): Part[] {
  const id = gid('Tree', x, y, z)
  if (pine) return group(id, [
    { ...cyl('Trunk', 0.8 * s, 3 * s, [x, y, z], BARK, BARK, 8), taper: 0.7 },
    { ...cyl('Pine', 5 * s, 4 * s, [x, y + 2 * s, z], LEAVES, LEAVES, 10), taper: 0.35 },
    { ...cyl('Pine', 3.8 * s, 3.5 * s, [x, y + 5 * s, z], LEAVES, LEAVES, 10), taper: 0.25 },
    { ...cyl('Pine', 2.4 * s, 3 * s, [x, y + 7.8 * s, z], LEAVES, LEAVES, 10), taper: 0 },
  ])
  return group(id, [
    { ...cyl('Trunk', 0.9 * s, 4.6 * s, [x, y, z], BARK, BARK, 8), taper: 0.6 },
    { ...cyl('Crown', 4 * s, 1.4 * s, [x, y + 3.4 * s, z], LEAVES2, LEAVES2, 10), taper: 1.35 },
    { ...cyl('Crown', 5.4 * s, 2.4 * s, [x, y + 4.8 * s, z], LEAVES, LEAVES, 10), taper: 0.75 },
    { ...cyl('Crown', 4 * s, 1.8 * s, [x, y + 7.2 * s, z], LEAVES2, LEAVES2, 10), taper: 0.3 },
  ])
}

/** A street lamp: pole, arm and head (add a light at lampLight). */
export function lamp(x: number, z: number, y = 1, rot = 0): Part[] {
  return group(gid('Lamp', x, y, z), local(x, y, z, rot, (L) => [
    { ...cyl('Lamp base', 0.8, 0.8, L(0, 0, 0), PB.steel, PB.steel, 8), taper: 0.6 },
    { ...cyl('Lamp post', 0.35, 9, L(0, 0.8, 0), PB.steel, PB.steel, 8), taper: 0.7 },
    box('Lamp arm', [0.25, 0.25, 2.2], L(0, 9.4, 0.9), PB.steel),
    { ...box('Lamp head', [0.9, 0.4, 1.6], L(0, 9.1, 1.8), PB.steel, CY.white), bevel: 0.15 },
  ]))
}

export function bench(x: number, z: number, rot = 0, y = 1): Part[] {
  return group(gid('Bench', x, y, z), local(x, y, z, rot, (L) => [
    box('Seat', [4, 0.25, 1.1], L(0, 0.75, 0), PB.wood),
    box('Backrest', [4, 0.9, 0.2], L(0, 1.05, -0.5), PB.wood),
    box('Bench leg', [0.2, 0.75, 1], L(-1.7, 0, 0), PB.black), box('Bench leg', [0.2, 0.75, 1], L(1.7, 0, 0), PB.black),
  ]))
}

export function dumpster(x: number, z: number, rot = 0, y = 1): Part[] {
  return group(gid('Dumpster', x, y, z), local(x, y, z, rot, (L) => [
    { ...box('Dumpster', [6, 2.6, 3], L(0, 0.3, 0), PB.boxGreen), bevel: 0.15 },
    ramp('Dumpster lid', [6, 0.4, 3.2], L(0, 2.9, 0), PB.black, PB.black, 180),
    ...[[-2.6, -1.2], [2.6, -1.2], [-2.6, 1.2], [2.6, 1.2]].map(([a, b]) => box('Caster', [0.3, 0.3, 0.3], L(a, 0, b), PB.black)),
  ]))
}

export function trafficCone(x: number, z: number, y = 1): Part[] {
  return group(gid('Cone', x, y, z), [box('Cone base', [1, 0.1, 1], [x, y, z], PB.orange), { ...cyl('Traffic cone', 0.8, 1.4, [x, y + 0.1, z], PB.orange, PB.orange, 10), taper: 0.15 }])
}

// ---------------- scenes ----------------

const CANOPY: Tex = { gen: 'tiles', tweak: { color: '#e6e4de', accent: '#b23a2a', scale: 1, wear: 0.1, seed: 340 } }

/** A setting a placed prefab can change afterwards (its size, floors, style, color...). */
export interface ParamDef {
  key: string
  label: string
  /** 'path': data the editor edits in the view (a road's points), not in the settings form. */
  kind: 'number' | 'select' | 'path'
  min?: number
  max?: number
  step?: number
  options?: [string, string][]
  default: number | string
}
export type Params = Record<string, number | string>

export interface PrefabDef {
  label: string
  hint: string
  /** Extra words the prefab browser's search should find it by. */
  keywords?: string[]
  params?: ParamDef[]
  make: (x: number, z: number, rot: number, y: number, p?: Params) => Part[]
}

/** A prefab's settings with every default filled in. */
export const prefabParams = (def: PrefabDef, p: Params = {}): Params =>
  Object.fromEntries((def.params ?? []).map((d) => [d.key, p[d.key] ?? d.default]))

/** Marks parts as one placed prefab, so the editor can rebuild it with new settings. */
export const tagPrefab = (parts: Part[], key: string, params: Params, at: Vec3, rot: number): Part[] => {
  const id = `${key}@${at.map((v) => +v.toFixed(2)).join(',')}`
  return parts.map((q) => ({ ...q, group: id, prefab: { key, params, at, rot } }))
}

const STYLE_OPTIONS: [string, string][] = [
  ['brick', 'Red brick'], ['darkbrick', 'Dark brick'], ['plaster', 'Plaster'], ['beige', 'Beige'], ['apartment', 'Apartments'],
  ['shop', 'Shops'], ['office', 'Office'], ['glass', 'Glass tower'], ['concrete', 'Concrete'], ['projects', 'Projects'],
  ['stone', 'Stone'], ['warehouse', 'Warehouse'], ['club', 'Night club'], ['cyber', 'Cyber cyan'], ['cyberpink', 'Cyber pink'],
]
const FRONT_OPTIONS: [string, string][] = [['S', 'Front toward +Z'], ['N', 'Front toward −Z'], ['E', 'Front toward +X'], ['W', 'Front toward −X']]
const buildingParams = (w: number, d: number, h: number, style: Style): ParamDef[] => [
  { key: 'w', label: 'Width', kind: 'number', min: 6, max: 120, step: 1, default: w },
  { key: 'd', label: 'Depth', kind: 'number', min: 6, max: 120, step: 1, default: d },
  { key: 'h', label: 'Height (7 = one floor)', kind: 'number', min: 4, max: 140, step: 1, default: h },
  { key: 'style', label: 'Style', kind: 'select', options: STYLE_OPTIONS, default: style },
  { key: 'front', label: 'Shop front', kind: 'select', options: FRONT_OPTIONS, default: 'S' },
]
const buildingFrom = (x: number, z: number, rot: number, y: number, p: Params, label: string) =>
  building({ x, z, y, w: +p.w, d: +p.d, h: +p.h, style: p.style as Style, front: (p.front as 'S') ?? rotFront(rot), label })
export const CAR_COLORS: [string, string][] = [['#b8322a', 'Red'], ['#2a5ab8', 'Blue'], ['#d0d0d0', 'Silver'], ['#202020', 'Black'], ['#2f8a3a', 'Green'], ['#e0b020', 'Yellow'], ['#e8e8e8', 'White'], ['#7a2a7a', 'Purple']]

/** Ready-made pieces the editor's Shape tool can stamp down. */
export const PREFABS: Record<string, PrefabDef> = {
  shop: { label: 'Shop building', hint: 'Two floors with a storefront and awning', params: buildingParams(16, 12, 14, 'brick'), make: (x, z, rot, y, p) => buildingFrom(x, z, rot, y, prefabParams(PREFABS.shop, p), 'Building') },
  apartments: { label: 'Apartment block', hint: 'Four floors, fire escape and water tank', params: buildingParams(20, 16, 28, 'apartment'), make: (x, z, rot, y, p) => buildingFrom(x, z, rot, y, prefabParams(PREFABS.apartments, p), 'Apartments') },
  office: { label: 'Office tower', hint: 'A glass office tower', params: buildingParams(22, 22, 42, 'office'), make: (x, z, rot, y, p) => buildingFrom(x, z, rot, y, prefabParams(PREFABS.office, p), 'Office') },
  warehouse: { label: 'Warehouse', hint: 'A big shed with a roll-up door', params: buildingParams(30, 20, 12, 'warehouse'), make: (x, z, rot, y, p) => buildingFrom(x, z, rot, y, prefabParams(PREFABS.warehouse, p), 'Warehouse') },
  car: {
    label: 'Car', hint: 'A parked car', params: [{ key: 'color', label: 'Paint', kind: 'select', options: CAR_COLORS, default: '#b8322a' }, { key: 'len', label: 'Length', kind: 'number', min: 6, max: 16, step: 0.5, default: 8 }],
    make: (x, z, rot, y, p) => { const q = prefabParams(PREFABS.car, p); return car(x, z, rot, carPaint(String(q.color), 341 + CAR_COLORS.findIndex(([c]) => c === q.color)), y, +q.len) },
  },
  tree: {
    label: 'Tree', hint: 'A leafy street tree', params: [{ key: 'size', label: 'Size', kind: 'number', min: 0.5, max: 3, step: 0.1, default: 1 }, { key: 'type', label: 'Kind', kind: 'select', options: [['leafy', 'Leafy'], ['pine', 'Pine']], default: 'leafy' }],
    make: (x, z, _r, y, p) => { const q = prefabParams(PREFABS.tree, p); return tree(x, z, y, +q.size, q.type === 'pine') },
  },
  pine: {
    label: 'Pine tree', hint: 'A tall pine', params: [{ key: 'size', label: 'Size', kind: 'number', min: 0.5, max: 3, step: 0.1, default: 1.2 }],
    make: (x, z, _r, y, p) => tree(x, z, y, +prefabParams(PREFABS.pine, p).size, true),
  },
  lamp: { label: 'Street lamp', hint: 'A lamp post (add a light under its head)', make: (x, z, rot, y) => lamp(x, z, y, rot) },
  bench: { label: 'Bench', hint: 'A park bench', make: (x, z, rot, y) => bench(x, z, rot, y) },
  dumpster: { label: 'Dumpster', hint: 'A dumpster with a lid', make: (x, z, rot, y) => dumpster(x, z, rot, y) },
  cones: { label: 'Traffic cones', hint: 'Three cones', make: (x, z, rot, y) => ([[-1.5, 0], [0, 0.6], [1.5, 0]] as const).flatMap(([a, b]) => { const [ox, oz] = turn(a, b, rot); return trafficCone(x + ox, z + oz, y) }) },
  busstop: {
    label: 'Bus stop', hint: 'A shelter with a bench', make: (x, z, rot, y) => group(gid('Bus stop', x, y, z), local(x, y, z, rot, (L) => [
      box('Shelter back', [8, 3.5, 0.2], L(0, 0, -1.4), STORE, STORE, 0, 3.5),
      box('Shelter side', [0.2, 3.5, 3], L(-4, 0, 0), STORE, STORE, 0, 3.5),
      { ...box('Shelter roof', [8.6, 0.3, 3.4], L(0, 3.5, 0), PB.steel), bevel: 0.1 },
      box('Shelter bench', [6, 0.25, 0.9], L(0, 0.8, -0.8), PB.wood),
    ])),
  },
  stall: {
    label: 'Market stall', hint: 'A counter under a striped canopy', make: (x, z, rot, y) => group(gid('Stall', x, y, z), local(x, y, z, rot, (L) => [
      box('Counter', [6, 1.3, 2], L(0, 0, 0), PB.wood),
      ...[[-2.9, -1.8], [2.9, -1.8], [-2.9, 1.8], [2.9, 1.8]].map(([a, b]) => box('Stall post', [0.2, 4, 0.2], L(a, 0, b), PB.wood)),
      ramp('Canopy', [6.6, 0.8, 4.4], L(0, 4, 0), CANOPY, CANOPY, 0),
      box('Crates', [1.6, 1, 1.2], L(-1.8, 1.3, 0.2), PB.plywood), box('Crates', [1.6, 1, 1.2], L(1.6, 1.3, 0.2), PB.plywood),
    ])),
  },
  gas: {
    label: 'Gas station canopy', hint: 'Canopy on four posts over two pump islands', make: (x, z, rot, y) => group(gid('Gas station', x, y, z), local(x, y, z, rot, (L) => [
      { ...box('Canopy', [24, 1.2, 16], L(0, 7, 0), CY.white, PB.red), bevel: 0.2 },
      ...[[-9, -5], [9, -5], [-9, 5], [9, 5]].map(([a, b]) => box('Canopy post', [0.8, 7, 0.8], L(a, 0, b), PB.steel)),
      ...[-4, 4].flatMap((a) => [
        { ...box('Pump island', [2.4, 0.4, 9], L(a, 0, 0), PB.concrete), bevel: 0.15 },
        { ...box('Pump', [1.2, 2.4, 1.6], L(a, 0.4, -2.5), PB.red, CY.white), bevel: 0.15 },
        { ...box('Pump', [1.2, 2.4, 1.6], L(a, 0.4, 2.5), PB.red, CY.white), bevel: 0.15 },
      ]),
    ])),
  },
  playground: {
    label: 'Playground', hint: 'A slide tower and swings', make: (x, z, rot, y) => group(gid('Playground', x, y, z), local(x, y, z, rot, (L) => [
      box('Play deck', [4, 0.3, 4], L(0, 3, 0), PB.wood), ...[[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]].map(([a, b]) => box('Play post', [0.3, 3, 0.3], L(a, 0, b), PB.red)),
      { ...cyl('Play roof', 5, 2, L(0, 6.2, 0), PB.yellow, PB.yellow, 4, 45), taper: 0 }, ...[[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]].map(([a, b]) => box('Roof post', [0.2, 2.9, 0.2], L(a, 3.3, b), PB.red)),
      ramp('Slide', [1.6, 3.3, 7], L(0, 0, 5.5), PB.yellow, PB.yellow, 180), stairs('Ladder', [1.6, 3.3, 3], L(0, 0, -3.5), PB.blue, PB.blue, 0, 5),
      box('Swing frame', [8, 0.3, 0.3], L(-9, 4.5, 0), PB.steel), box('Swing leg', [0.3, 4.5, 0.3], L(-13, 0, 0), PB.steel), box('Swing leg', [0.3, 4.5, 0.3], L(-5, 0, 0), PB.steel),
      box('Swing seat', [1.2, 0.15, 0.6], L(-11, 1.2, 0), PB.black), box('Swing seat', [1.2, 0.15, 0.6], L(-7, 1.2, 0), PB.black),
    ])),
  },
  scaffold: {
    label: 'Scaffolding', hint: 'Two levels of planks on a pipe frame', make: (x, z, rot, y) => group(gid('Scaffold', x, y, z), local(x, y, z, rot, (L) => [
      ...[-5, 0, 5].flatMap((a) => [-1.95, 1.95].map((b) => box('Scaffold pole', [0.2, 10, 0.2], L(a, 0, b), PB.steel))),
      box('Scaffold deck', [11, 0.25, 4], L(0, 4.5, 0), PB.plywood),
      // The top deck leaves a gap over the stairs up from the first one.
      box('Scaffold deck', [4.5, 0.25, 4], L(-3.25, 9, 0), PB.plywood), box('Scaffold deck', [2.5, 0.25, 4], L(4.25, 9, 0), PB.plywood),
      box('Scaffold deck', [4, 0.25, 2.2], L(1, 9, -0.9), PB.plywood),
      box('Toe board', [4.5, 0.6, 0.1], L(-3.25, 9.25, 1.95), PB.plywood), box('Toe board', [2.5, 0.6, 0.1], L(4.25, 9.25, 1.95), PB.plywood),
      stairs('Scaffold stairs', [2, 4.5, 6], L(-8, 0, 0), PB.steel, PB.steel, 270, 8),
      stairs('Scaffold stairs', [1.6, 4.5, 4], L(1, 4.75, 1.1), PB.steel, PB.steel, 270, 9),
    ])),
  },
  tower: {
    label: 'Guard tower', hint: 'A lookout on legs with stairs', make: (x, z, rot, y) => group(gid('Guard tower', x, y, z), local(x, y, z, rot, (L) => [
      ...[[-2.7, -2.7], [2.7, -2.7], [-2.7, 2.7], [2.7, 2.7]].map(([a, b]) => box('Tower leg', [0.6, 7, 0.6], L(a, 0, b), PB.wood)),
      box('Tower deck', [6.5, 0.5, 6.5], L(0, 7, 0), PB.planks, PB.wood),
      ...[[0, -3.1, 0], [0, 3.1, 0], [-3.1, 0, 90], [3.1, 0, 90]].map(([a, b, r]) => box('Tower rail', [6.5, 1.1, 0.2], L(a, 7.5, b), PB.wood, PB.wood, r)),
      { ...cyl('Tower roof', 8, 2.2, L(0, 10.6, 0), PB.rusty, PB.rusty, 4, 45), taper: 0 },
      ...[[-2.7, -2.7], [2.7, -2.7], [-2.7, 2.7], [2.7, 2.7]].map(([a, b]) => box('Roof post', [0.3, 3.1, 0.3], L(a, 7.5, b), PB.wood)),
      stairs('Tower stairs', [3, 7.5, 10], L(0, 0, 8.25), PB.wood, PB.wood, 0, 9),
    ])),
  },
  containers: {
    label: 'Container stack', hint: 'Three shipping containers', make: (x, z, rot, y) => group(gid('Containers', x, y, z), local(x, y, z, rot, (L) => [
      box('Container', [6, 6, 24], L(0, 0, 0), PB.boxRed), box('Container', [6, 6, 24], L(6.2, 0, 0), PB.boxBlue), box('Container', [6, 6, 24], L(3.1, 6, 0), PB.boxGreen),
    ])),
  },
  foodtruck: {
    label: 'Food truck', hint: 'A food truck with its hatch open', make: (x, z, rot, y) => group(gid('Food truck', x, y, z), local(x, y, z, rot, (L) => [
      { ...box('Truck body', [5, 5.5, 13], L(0, 0.6, 0), CY.white, carPaint('#f07a1a', 342)), bevel: 0.3 },
      { ...box('Truck cab', [4.8, 3, 3], L(0, 0.6, 8), CY.white, carPaint('#f07a1a', 342)), bevel: 0.4 },
      box('Serving hatch', [0.3, 0.3, 6], L(3, 4, -1), PB.steel),
      ...wheels(L, 4.6, [-4, 7.5], 1.5, 0.6),
    ])),
  },
  phone: {
    label: 'Phone booth', hint: 'A red phone booth', make: (x, z, rot, y) => group(gid('Phone booth', x, y, z), local(x, y, z, rot, (L) => [
      { ...box('Phone booth', [2, 4.6, 2], L(0, 0, 0), PB.red, STORE), bevel: 0.12 },
      { ...box('Booth roof', [2.2, 0.4, 2.2], L(0, 4.6, 0), PB.red), bevel: 0.15 },
    ])),
  },
  picnic: {
    label: 'Picnic table', hint: 'A table with two benches', make: (x, z, rot, y) => group(gid('Picnic table', x, y, z), local(x, y, z, rot, (L) => [
      box('Table top', [6, 0.25, 2.2], L(0, 1.45, 0), PB.wood), box('Table leg', [0.25, 1.45, 2], L(-2.4, 0, 0), PB.wood), box('Table leg', [0.25, 1.45, 2], L(2.4, 0, 0), PB.wood),
      box('Bench seat', [6, 0.2, 0.8], L(0, 0.8, -1.7), PB.wood), box('Bench seat', [6, 0.2, 0.8], L(0, 0.8, 1.7), PB.wood),
    ])),
  },
  fountain: {
    label: 'Fountain', hint: 'A tiered stone fountain', make: (x, z, _r, y) => group(gid('Fountain', x, y, z), [
      cyl('Basin', 12, 1.2, [x, y, z], { gen: 'tiles', tweak: { color: '#2a5d7a', accent: '#24506a', scale: 8, wear: 0.3, seed: 89 }, surface: 20 }, STONE, 20),
      cyl('Basin rim', 12.8, 1.4, [x, y, z], STONE, STONE, 20),
      { ...cyl('Column', 1.4, 3.5, [x, y + 1.2, z], STONE, STONE, 12), taper: 0.7 },
      { ...cyl('Bowl', 5, 0.8, [x, y + 4.7, z], STONE, STONE, 16), taper: 1.4 },
      { ...cyl('Spire', 0.8, 2.4, [x, y + 5.5, z], STONE, STONE, 10), taper: 0 },
    ]),
  },
  bunkers: {
    label: 'Paintball bunkers', hint: 'A can, a cake and a dorito', make: (x, z, rot, y) => local(x, y, z, rot, (L) => [
      { ...cyl('Can', 3, 3.5, L(-5, 0, 0), PB.blue), bevel: 0 },
      { ...box('Cake', [5, 2.2, 5], L(1, 0, 0), PB.yellow), bevel: 0.7 },
      cyl('Dorito', 4, 3, L(6.5, 0, 2), PB.orange, PB.orange, 3, 90),
    ]),
  },
}

const rotFront = (rot: number): 'N' | 'S' | 'E' | 'W' => (['S', 'E', 'N', 'W'] as const)[((Math.round(rot / 90) % 4) + 4) % 4]
