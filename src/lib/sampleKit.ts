// Building blocks for sample maps: shape helpers, symmetry, team markers and
// shared texture palettes. Coordinates are editor units (the default world
// scale of 0.5 halves them in game); a 1-unit-thick floor at y 0 puts the
// ground at y 1. Red is always the −Z end, blue the +Z end.
import type { GameMode, Marker, Vec3 } from './project'
import type { ShapeKind } from './shapes'
import type { GenParams, TextureKind } from './procedural'

/** A generated texture (optionally with its own surface type) or one from the starter library. */
export type Tex = { gen: TextureKind; tweak?: Partial<GenParams>; surface?: number } | { lib: string; surface: number }

export interface Part {
  label: string
  kind: ShapeKind
  size: Vec3
  /** Bottom center. */
  at: Vec3
  /** Heading in degrees. */
  rot?: number
  top: Tex
  side: Tex
  tile?: number
  segments?: number
}

export type Theme = 'Starter' | 'Urban paintball' | 'Cyber'
export type MarkerSpec = [string, Vec3, Partial<Marker>?]

export interface Sample {
  id: string
  name: string
  icon: string
  theme: Theme
  description: string
  modes: GameMode[]
  parts: Part[]
  markers: MarkerSpec[]
  lights?: [Vec3, Vec3?][]
}

export const ALL_MODES: GameMode[] = ['Gangsta Brawl', 'Team Gangsta Brawl', 'Big Ass Chains', 'Team Big Ass Chains', 'Protect Tha Pimp']
export const GB: GameMode[] = ['Gangsta Brawl', 'Team Gangsta Brawl']

// ---------------- shapes ----------------

export const box = (label: string, size: Vec3, at: Vec3, top: Tex, side: Tex = top, rot = 0, tile = 4): Part => ({ label, kind: 'box', size, at, top, side, rot, tile })
export const ramp = (label: string, size: Vec3, at: Vec3, top: Tex, side: Tex = top, rot = 0, tile = 4): Part => ({ label, kind: 'ramp', size, at, top, side, rot, tile })
export const stairs = (label: string, size: Vec3, at: Vec3, top: Tex, side: Tex = top, rot = 0, steps = 8): Part => ({ label, kind: 'stairs', size, at, top, side, rot, segments: steps, tile: 4 })
/** Round (or 3-, 6-, 8-sided) column; `d` is the diameter. */
export const cyl = (label: string, d: number, h: number, at: Vec3, top: Tex, side: Tex = top, sides = 16, rot = 0, tile = 4): Part =>
  ({ label, kind: 'cylinder', size: [d, h, d], at, top, side, segments: sides, rot, tile })
/** A ground slab w × d, 1 thick, top at y 1. */
export const ground = (w: number, d: number, top: Tex, side: Tex = top, tile = 6): Part => box('Ground', [w, 1, d], [0, 0, 0], top, side, 0, tile)

/** Four walls standing h above the ground, just outside a w × d ground slab. */
export function perimeter(w: number, d: number, h: number, tex: Tex, top: Tex = tex): Part[] {
  return [
    box('Wall', [w + 2, h + 1, 1], [0, 0, -d / 2 - 0.5], top, tex),
    box('Wall', [w + 2, h + 1, 1], [0, 0, d / 2 + 0.5], top, tex),
    box('Wall', [1, h + 1, d], [-w / 2 - 0.5, 0, 0], top, tex),
    box('Wall', [1, h + 1, d], [w / 2 + 0.5, 0, 0], top, tex),
  ]
}

/** Local offset (dx, dz) turned by a heading, as the editor turns objects. */
export function turn(dx: number, dz: number, deg: number): [number, number] {
  const t = (deg * Math.PI) / 180
  return [dx * Math.cos(t) + dz * Math.sin(t), -dx * Math.sin(t) + dz * Math.cos(t)]
}

// ---------------- symmetry ----------------

const half = (p: Part): Part => ({ ...p, at: [-p.at[0], p.at[1], -p.at[2]], rot: ((p.rot ?? 0) + 180) % 360 })
/** The parts plus a copy turned 180° around the map's center, so both teams get the same field. */
export const mirror = (...parts: Part[]): Part[] => parts.flatMap((p) => [p, half(p)])

/** The parts plus a left-right reflection (x → −x). Triangles reflect with a different heading. */
export const flipX = (...parts: Part[]): Part[] => parts.flatMap((p) => {
  const r = p.rot ?? 0
  const odd = p.kind === 'cylinder' && (p.segments ?? 16) % 2 === 1
  return [p, { ...p, at: [-p.at[0], p.at[1], p.at[2]] as Vec3, rot: odd ? 180 - r : -r }]
})

// ---------------- markers ----------------

const opposite = (p: Vec3): Vec3 => [-p[0], p[1], -p[2]]
const pair = (p: Vec3): Vec3[] => (p[0] === 0 && p[2] === 0 ? [p] : [p, opposite(p)])
/** Heading that looks at the map's center (yaw 0 faces −Z). */
const lookAtCenter = (p: Vec3) => +((Math.atan2(-p[0], p[2]) * 180) / Math.PI).toFixed(1)

export interface TeamMarkers {
  /** Red team spawns (−Z end); blue gets the same spots turned 180°. */
  red: Vec3[]
  /** Free-for-all spawns; each is also placed on the opposite side. */
  shared: Vec3[]
  /** Weapons; each is also placed on the opposite side (except at the exact center). */
  weapons: [string, Vec3][]
  /** Chains drop-offs; each is also placed on the opposite side. */
  drops: Vec3[]
  /** Where the pimp starts in Protect Tha Pimp (red's end). */
  pimp: Vec3
}

/** Markers for every mode on a symmetric map. Positions are the ground height they stand on. */
export function teamMarkers(m: TeamMarkers): MarkerSpec[] {
  return [
    ...m.red.map((p): MarkerSpec => ['Red team spawn', p, { yaw: 180 }]),
    ...m.red.map((p): MarkerSpec => ['Blue team spawn', opposite(p), { yaw: 0 }]),
    ...m.shared.flatMap(pair).map((p): MarkerSpec => ['Shared spawn', p, { yaw: lookAtCenter(p) }]),
    ...m.weapons.flatMap(([id, p]) => pair(p).map((q): MarkerSpec => ['Weapon pickup', q, { weapon: id }])),
    ...m.drops.flatMap(pair).map((p): MarkerSpec => ['Chains drop-off', p]),
    ['Pimp entrance', m.pimp],
  ]
}

/** Lights, each also placed on the opposite side. */
export const mirrorLights = (...ls: [Vec3, Vec3?][]): [Vec3, Vec3?][] => ls.flatMap(([p, c]) => pair(p).map((q): [Vec3, Vec3?] => [q, c]))

// ---------------- palettes ----------------

const solid = (color: string, accent: string, seed: number, surface = 17): Tex => ({ gen: 'tiles', tweak: { color, accent, scale: 1, wear: 0.08, seed }, surface })
const neon = (color: string, accent: string, seed: number): Tex => ({ gen: 'tiles', tweak: { color, accent, scale: 1, wear: 0, seed }, surface: 17 })
const grid = (accent: string, seed: number, color = '#121219', scale = 4): Tex => ({ gen: 'tiles', tweak: { color, accent, scale, wear: 0, seed }, surface: 15 })

/** Urban paintball: turf, plywood, inflatable-bunker colors, containers, tires. */
export const PB = {
  turf: { gen: 'grass', tweak: { color: '#3f8a2c', accent: '#6a9a3a', wear: 0.15, seed: 3 } } as Tex,
  dirt: { gen: 'dirt' } as Tex,
  gravel: { gen: 'gravel' } as Tex,
  sand: { gen: 'sand' } as Tex,
  asphalt: { gen: 'asphalt', tweak: { line: 'none' } } as Tex,
  oldAsphalt: { lib: 'asphalt_02', surface: 0 } as Tex,
  concrete: { gen: 'concrete' } as Tex,
  darkConcrete: { gen: 'concrete', tweak: { color: '#6f6d69', seed: 4, wear: 0.6 } } as Tex,
  floorWorn: { lib: 'concrete_floor_worn_001', surface: 0 } as Tex,
  cinder: { lib: 'concrete_wall_003', surface: 0 } as Tex,
  cracked: { lib: 'cracked_concrete_wall', surface: 0 } as Tex,
  cobble: { lib: 'cobblestone_floor_04', surface: 0 } as Tex,
  plywood: { lib: 'plywood', surface: 21 } as Tex,
  planks: { lib: 'weathered_brown_planks', surface: 21 } as Tex,
  wood: { gen: 'wood_planks' } as Tex,
  brick: { lib: 'red_brick', surface: 0 } as Tex,
  oldBrick: { lib: 'brick_4', surface: 0 } as Tex,
  plaster: { lib: 'painted_plaster_wall', surface: 5 } as Tex,
  beige: { lib: 'beige_wall_001', surface: 5 } as Tex,
  tilesWhite: { lib: 'floor_tiles_06', surface: 3 } as Tex,
  corrugated: { lib: 'corrugated_iron', surface: 16 } as Tex,
  rusty: { lib: 'rusty_metal_02', surface: 15 } as Tex,
  steel: { gen: 'metal_plate', tweak: { wear: 0.15 } } as Tex,
  diamond: { gen: 'diamond_plate' } as Tex,
  red: solid('#d8322b', '#7a1612', 11),
  blue: solid('#2a6fe0', '#123a7a', 12),
  yellow: solid('#f2c218', '#7a5f08', 13),
  green: solid('#2fbf4a', '#155a22', 14),
  orange: solid('#f07a1a', '#7a3a08', 15),
  black: solid('#2a2a2e', '#141416', 16),
  tire: { gen: 'concrete', tweak: { color: '#26262a', accent: '#121214', wear: 0.3, seed: 8 }, surface: 18 } as Tex,
  boxRed: { gen: 'metal_plate', tweak: { color: '#a8432b', accent: '#5a2a18', scale: 6, wear: 0.35, seed: 31 } } as Tex,
  boxBlue: { gen: 'metal_plate', tweak: { color: '#2f6b8f', accent: '#5a3a28', scale: 6, wear: 0.3, seed: 32 } } as Tex,
  boxGreen: { gen: 'metal_plate', tweak: { color: '#3f7a3a', accent: '#5a3a28', scale: 6, wear: 0.3, seed: 33 } } as Tex,
  car: (color: string, seed: number): Tex => ({ gen: 'metal_plate', tweak: { color, accent: '#333', scale: 1, wear: 0.05, seed }, surface: 15 }),
}

/** Cyber: dark floors with glowing grid lines, steel panels and solid neon blocks. */
export const CY = {
  gridCyan: grid('#00e5ff', 21),
  gridPink: grid('#ff2bd6', 22),
  gridLime: grid('#39ff88', 23),
  gridPurple: grid('#9b5cff', 24, '#100c18'),
  fineGrid: grid('#00e5ff', 25, '#15161d', 8),
  windows: grid('#3de7ff', 26, '#151a26', 6),
  windowsPink: grid('#ff5ce1', 27, '#1a1424', 6),
  board: grid('#d4af37', 28, '#0f3d2a', 8),
  panel: { gen: 'metal_plate', tweak: { color: '#232a36', accent: '#232a36', scale: 2, wear: 0, seed: 41 } } as Tex,
  panelLight: { gen: 'metal_plate', tweak: { color: '#3a4558', accent: '#3a4558', scale: 2, wear: 0, seed: 42 } } as Tex,
  dark: { gen: 'diamond_plate', tweak: { color: '#2b3038', accent: '#14171c', wear: 0.05, seed: 43 } } as Tex,
  chip: { gen: 'metal_plate', tweak: { color: '#1a1a1e', accent: '#1a1a1e', scale: 1, wear: 0, seed: 44 } } as Tex,
  gold: { gen: 'metal_plate', tweak: { color: '#c9a23a', accent: '#c9a23a', scale: 4, wear: 0, seed: 45 } } as Tex,
  cyan: neon('#18d8ff', '#0a5566', 51),
  pink: neon('#ff3dd8', '#661457', 52),
  lime: neon('#8cff3a', '#2f5c12', 53),
  orange: neon('#ff9a1f', '#6b3a05', 54),
  purple: neon('#9b5cff', '#3a1f66', 55),
  white: neon('#e8f6ff', '#5a7a8a', 56),
}

export const LIGHT = {
  warm: [1, 0.82, 0.6] as Vec3,
  white: [1, 1, 1] as Vec3,
  cool: [0.7, 0.85, 1] as Vec3,
  cyan: [0.2, 0.9, 1] as Vec3,
  pink: [1, 0.25, 0.85] as Vec3,
  lime: [0.5, 1, 0.3] as Vec3,
  purple: [0.6, 0.35, 1] as Vec3,
  orange: [1, 0.55, 0.15] as Vec3,
}
