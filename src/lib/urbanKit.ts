// Street furniture and city pieces for the urban sample maps. Ground level is
// y 1; raised sidewalks and plazas are 0.3 higher (y 1.3).
import type { Vec3 } from './project'
import { LIGHT, PB, box, cyl, ramp, stairs, turn, type Part, type Tex } from './sampleKit'
import { lamp as prefabLamp, tree as prefabTree } from './prefabs'

export const G = 1
export const S = 1.3

export const U = {
  road: { gen: 'asphalt', tweak: { line: 'none', seed: 81 } } as Tex,
  roadLine: { gen: 'asphalt', tweak: { line: 'yellow', seed: 82 } } as Tex,
  roadWhite: { gen: 'asphalt', tweak: { line: 'white', seed: 90 } } as Tex,
  walk: { gen: 'tiles', tweak: { color: '#a29e95', accent: '#77736c', scale: 4, wear: 0.25, seed: 83 } } as Tex,
  plazaTiles: { lib: 'large_floor_tiles_02', surface: 3 } as Tex,
  grass: { gen: 'grass', tweak: { color: '#4a7a2c', accent: '#7d8a3a', scale: 4, wear: 0.3, seed: 98 } } as Tex,
  leaves: { gen: 'grass', tweak: { color: '#2f5e22', accent: '#4c7a2a', scale: 3, wear: 0.2, seed: 84 }, surface: 7 } as Tex,
  hedge: { gen: 'grass', tweak: { color: '#2a4f1d', accent: '#3d6a26', scale: 6, wear: 0.1, seed: 91 }, surface: 7 } as Tex,
  bark: { gen: 'wood_planks', tweak: { color: '#5a3f2a', accent: '#3a2818', scale: 3, seed: 85 } } as Tex,
  office: { gen: 'tiles', tweak: { color: '#2d4152', accent: '#b9c0c6', scale: 6, wear: 0.05, seed: 86 }, surface: 15 } as Tex,
  officeGreen: { gen: 'tiles', tweak: { color: '#2e4a44', accent: '#a8b3ad', scale: 8, wear: 0.05, seed: 92 }, surface: 15 } as Tex,
  apartments: { gen: 'tiles', tweak: { color: '#c9b79a', accent: '#5d4a3a', scale: 5, wear: 0.2, seed: 87 }, surface: 5 } as Tex,
  projects: { gen: 'tiles', tweak: { color: '#8d8478', accent: '#3d3833', scale: 6, wear: 0.4, seed: 93 }, surface: 0 } as Tex,
  shopfront: { gen: 'tiles', tweak: { color: '#3d5c72', accent: '#2a2a2a', scale: 2, wear: 0.1, seed: 88 }, surface: 15 } as Tex,
  roof: { lib: 'gravel_concrete_03', surface: 12 } as Tex,
  slate: { lib: 'roof_slates_03', surface: 0 } as Tex,
  water: { gen: 'water', tweak: { seed: 89 }, surface: 20 } as Tex,
  white: { gen: 'paint', tweak: { color: '#e6e4de', accent: '#c9c6bd', scale: 2, wear: 0.1, seed: 94 }, surface: 0 } as Tex,
  marble: { lib: 'marble_01', surface: 13 } as Tex,
  stone: { lib: 'medieval_blocks_03', surface: 0 } as Tex,
  rock: { lib: 'rock_face_03', surface: 0 } as Tex,
  burnt: { gen: 'concrete', tweak: { color: '#3a3532', accent: '#1c1a19', wear: 0.8, seed: 95 } } as Tex,
  rubble: { lib: 'rocks_ground_02', surface: 12 } as Tex,
  turf: PB.turf,
  neonPink: { gen: 'paint', tweak: { color: '#ff3dd8', accent: '#661457', scale: 2, wear: 0, seed: 52 }, surface: 17 } as Tex,
  neonCyan: { gen: 'paint', tweak: { color: '#18d8ff', accent: '#0a5566', scale: 2, wear: 0, seed: 51 }, surface: 17 } as Tex,
  neonPurple: { gen: 'paint', tweak: { color: '#9b5cff', accent: '#3a1f66', scale: 2, wear: 0, seed: 55 }, surface: 17 } as Tex,
  clubWall: { gen: 'tiles', tweak: { color: '#1b1622', accent: '#ff3dd8', scale: 6, wear: 0, seed: 96 }, surface: 15 } as Tex,
  clubWall2: { gen: 'tiles', tweak: { color: '#14191f', accent: '#18d8ff', scale: 6, wear: 0, seed: 97 }, surface: 15 } as Tex,
}

/** Surfaces cars drive on: streets, lots and forecourts. */
export const ROAD_SURFACES: Tex[] = [U.road, U.roadLine, U.roadWhite, PB.asphalt, PB.oldAsphalt]

/** A building: a solid block with its roof material on top. */
export const bldg = (x: number, z: number, w: number, d: number, h: number, facade: Tex, y = S, roof: Tex = U.roof, label = 'Building'): Part =>
  box(label, [w, h, d], [x, y, z], roof, facade, 0, 6)

/** A street tree (a pine now and then). */
export const tree = (x: number, z: number, y = S, s = 1): Part[] => prefabTree(x, z, y, s, Math.abs(Math.round(x * 7 + z * 3)) % 5 === 0)

/** A street lamp (its light is added separately with lampLight). */
export const lamp = (x: number, z: number, y = S): Part[] => prefabLamp(x, z, y)
export const lampLight = (x: number, z: number, y = S, c: Vec3 = LIGHT.warm): [Vec3, Vec3?] => [[x, y + 8.6, z + 1.8], c]

export const car = (x: number, z: number, rot: number, color: string, seed: number, y = G): Part =>
  box('Car', [4, 3, 8], [x, y, z], PB.car(color, seed), PB.car(color, seed), rot)
export const bench = (x: number, z: number, rot = 0, y = S): Part => box('Bench', [4, 1, 1.2], [x, y, z], PB.wood, PB.wood, rot)
export const dumpster = (x: number, z: number, rot = 0, y = S): Part => box('Dumpster', [6, 3, 3], [x, y, z], PB.boxGreen, PB.boxGreen, rot)
export const barrier = (x: number, z: number, rot = 0, y = G): Part => box('Jersey barrier', [8, 2, 1.2], [x, y, z], PB.concrete, PB.concrete, rot)
export const hydrant = (x: number, z: number, y = S): Part => cyl('Hydrant', 0.8, 1.6, [x, y, z], PB.red, PB.red, 8)
export const planter = (x: number, z: number, y = S): Part[] => [box('Planter', [4, 1.2, 4], [x, y, z], U.hedge, PB.concrete), ...tree(x, z, y + 1.2, 0.8)]
export const fence = (x: number, z: number, len: number, rot = 0, h = 3, tex: Tex = PB.corrugated, y = G): Part => box('Fence', [len, h, 0.4], [x, y, z], tex, tex, rot)

/** Parts given in a local frame (offsets dx, dz, and y above the base) placed and turned as one piece. */
export function piece(x: number, z: number, rot: number, y: number, parts: [string, Vec3, [number, number, number], Tex, Tex?, ('box' | 'cyl')?][]): Part[] {
  return parts.map(([label, size, [dx, dy, dz], top, side, kind]) => {
    const [ox, oz] = turn(dx, dz, rot)
    const at: Vec3 = [x + ox, y + dy, z + oz]
    return kind === 'cyl' ? cyl(label, size[0], size[1], at, top, side ?? top, 12, rot) : box(label, size, at, top, side ?? top, rot)
  })
}

/** Bus shelter: back panel, roof and a bench; open to the front (+Z before turning). */
export const busStop = (x: number, z: number, rot = 0, y = S): Part[] => piece(x, z, rot, y, [
  ['Shelter back', [8, 3.5, 0.3], [0, 0, -1.4], U.shopfront],
  ['Shelter roof', [8.4, 0.3, 3.2], [0, 3.5, 0], PB.steel],
  ['Shelter bench', [6, 1, 1], [0, 0, -0.6], PB.wood],
])

/** Billboard on two posts, facing +Z before turning. */
export const billboard = (x: number, z: number, rot: number, face: Tex, y = G): Part[] => piece(x, z, rot, y, [
  ['Billboard post', [0.6, 8, 0.6], [-4, 0, 0], PB.steel, PB.steel, 'cyl'],
  ['Billboard post', [0.6, 8, 0.6], [4, 0, 0], PB.steel, PB.steel, 'cyl'],
  ['Billboard', [13, 5, 0.6], [0, 8, 0], PB.steel, face],
])

/** Awning on a shop front (sticks out 3 units toward +Z before turning). */
export const awning = (x: number, z: number, w: number, rot: number, tex: Tex, y = S): Part => {
  const [ox, oz] = turn(0, 1.5, rot)
  return box('Awning', [w, 0.3, 3], [x + ox, y + 4.4, z + oz], tex, tex, rot)
}

/** Painted crosswalk stripes across a road (stripes run along Z before turning). */
export const crosswalk = (x: number, z: number, width: number, rot = 0, y = G): Part[] => {
  const out: Part[] = []
  for (let i = -width / 2 + 1; i <= width / 2 - 1; i += 2.5) {
    const [ox, oz] = turn(i, 0, rot)
    out.push(box('Crosswalk', [1.2, 0.04, 6], [x + ox, y, z + oz], U.white, U.white, rot))
  }
  return out
}

/** Stairs up the side of something, rising toward −Z before turning; rise and run in units. */
export const climb = (x: number, z: number, rise: number, run: number, rot = 0, y = G, w = 4, tex: Tex = PB.concrete): Part =>
  stairs('Stairs', [w, rise, run], [x, y, z], tex, tex, rot, Math.max(2, Math.round(rise / 0.8)))

/** A ramp rising toward −Z before turning. */
export const slope = (x: number, z: number, w: number, rise: number, run: number, rot = 0, y = G, top: Tex = PB.concrete, side: Tex = PB.concrete): Part =>
  ramp('Ramp', [w, rise, run], [x, y, z], top, side, rot)
