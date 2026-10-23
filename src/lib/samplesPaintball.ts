// Urban paintball sample maps. Every field is point-symmetric (mirror()), so
// red at the −Z end and blue at the +Z end get the same layout.
import type { Vec3 } from './project'
import { ALL_MODES, LIGHT, PB, box, cyl, ground, mirror, mirrorLights, perimeter, ramp, stairs, teamMarkers, turn, type Part, type Sample, type Tex } from './sampleKit'

const roofGravel: Tex = { lib: 'gravel_concrete_03', surface: 12 }
const sandbag: Tex = { gen: 'sand', tweak: { color: '#b49a6a', accent: '#8a7550', scale: 2, seed: 9 } }
const court: Tex = { gen: 'tiles', tweak: { color: '#2f6fb0', accent: '#e8e8e8', scale: 2, wear: 0.15, seed: 71 } }
const skylight: Tex = { gen: 'tiles', tweak: { color: '#8fc3e0', accent: '#3d6680', scale: 3, wear: 0.05, seed: 73 }, surface: 15 }
const trainSide: Tex = { gen: 'metal_plate', tweak: { color: '#c8ccd0', accent: '#3060a0', scale: 3, wear: 0.1, seed: 72 } }
const road: Tex = { gen: 'asphalt', tweak: { line: 'white', seed: 2 } }
const slate: Tex = { lib: 'roof_slates_03', surface: 0 }

/** A plywood hut: back and side walls, and a front wall with a 3-unit doorway (front faces +Z before turning). */
function hut(x: number, z: number, w: number, d: number, h: number, rot: number, tex: Tex): Part[] {
  const t = 0.6, seg = (w - 3) / 2
  const walls: [Vec3, number, number][] = [
    [[w, h, t], 0, -d / 2 + t / 2],
    [[t, h, d], -w / 2 + t / 2, 0],
    [[t, h, d], w / 2 - t / 2, 0],
    [[seg, h, t], -w / 2 + seg / 2, d / 2 - t / 2],
    [[seg, h, t], w / 2 - seg / 2, d / 2 - t / 2],
  ]
  return walls.map(([size, dx, dz]) => {
    const [ox, oz] = turn(dx, dz, rot)
    return box('Hut wall', size, [x + ox, 1, z + oz], tex, tex, rot)
  })
}

/** A lookout: four posts, a deck h above the ground and stairs up its +Z side. */
function lookout(x: number, z: number, h: number): Part[] {
  const posts = [[-2.7, -2.7], [2.7, -2.7], [-2.7, 2.7], [2.7, 2.7]].map(([dx, dz]) => box('Post', [0.6, h, 0.6], [x + dx, 1, z + dz], PB.wood))
  return [
    ...posts,
    box('Lookout deck', [6.5, 0.8, 6.5], [x, 1 + h, z], PB.planks, PB.wood),
    stairs('Lookout stairs', [3, h + 0.8, 10], [x, 1, z + 3.25 + 5], PB.wood, PB.wood, 0, Math.round(h + 1)),
  ]
}

/** A market stall: counter, canopy and two posts on its outer side (the side of the street its x is on). */
function stall(x: number, z: number, canopy: Tex): Part[] {
  const s = Math.sign(x)
  return [
    box('Stall counter', [2.5, 1.4, 6], [x, 1, z], PB.wood, PB.planks),
    box('Stall canopy', [4, 0.3, 7], [x + s * 0.75, 4.2, z], canopy),
    cyl('Stall post', 0.3, 3.2, [x + s * 1.8, 1, z - 3.2], PB.wood, PB.wood, 6),
    cyl('Stall post', 0.3, 3.2, [x + s * 1.8, 1, z + 3.2], PB.wood, PB.wood, 6),
  ]
}

const car = (at: Vec3, color: string, seed: number, rot = 0) => box('Car', [4, 3, 8], at, PB.car(color, seed), PB.car(color, seed), rot)

export const PAINTBALL: Sample[] = [
  {
    id: 'pb_speedball', name: 'Speedball Field', icon: '🎯', theme: 'Urban paintball', modes: ALL_MODES,
    description: 'Tournament turf with inflatable bunkers: snake, doritos, cans, a cake, a temple, a maya and the big X in the middle.',
    parts: [
      ground(56, 96, PB.turf, PB.dirt),
      ...perimeter(56, 96, 3, PB.black),
      box('X bunker', [10, 3, 2], [0, 1, 0], PB.red, PB.red, 45),
      box('X bunker', [10, 3, 2], [0, 1, 0], PB.red, PB.red, -45),
      ...mirror(
        box('Snake', [3, 2.2, 11], [19, 1, -24], PB.yellow), box('Snake', [3, 2.2, 11], [19, 1, -10], PB.yellow),
        cyl('Dorito', 4, 3, [-18, 1, -28], PB.orange, PB.orange, 3, 90), cyl('Dorito', 4, 3, [-14, 1, -12], PB.orange, PB.orange, 3, 30),
        cyl('Dorito', 4, 3, [-21, 1, -5], PB.orange, PB.orange, 3, 90),
        cyl('Can', 3, 3.5, [10, 1, -35], PB.blue), cyl('Can', 3, 3.5, [-10, 1, -35], PB.blue),
        box('Cake', [5, 2.2, 5], [8, 1, -20], PB.green),
        box('Temple', [6, 3.5, 1.5], [-6, 1, -22], PB.red), box('Temple', [1.5, 3.5, 5], [-6, 1, -19.5], PB.red),
        box('Maya', [6, 1.5, 6], [0, 1, -14], PB.yellow), box('Maya', [3.5, 1.5, 3.5], [0, 2.5, -14], PB.yellow),
        box('Tombstone', [2, 4, 1.2], [12, 1, -6], PB.green),
      ),
    ],
    markers: teamMarkers({
      red: [[-8, 1, -43], [-3, 1, -43], [3, 1, -43], [8, 1, -43]],
      shared: [[-22, 1, -42], [22, 1, -42], [-23, 1, -1], [24, 1, -30]],
      weapons: [['m16', [0, 1, -8]], ['pump_action_shotgun', [18, 1, -38]], ['mac10', [-16, 1, -20]]],
      drops: [[-12, 1, 2]],
      pimp: [0, 1, -45],
    }),
  },
  {
    id: 'pb_rooftop', name: 'Rooftop Paintball', icon: '🏢', theme: 'Urban paintball', modes: ALL_MODES,
    description: 'A gravel roof with parapets, AC units, vents, stair bulkheads and two water towers you can climb for the high ground.',
    parts: [
      ground(70, 70, roofGravel, PB.cinder),
      ...perimeter(70, 70, 2, PB.cinder),
      box('Skylight', [12, 1.5, 8], [0, 1, 0], skylight, PB.steel),
      ...mirror(
        box('Stair bulkhead', [10, 6, 8], [-20, 1, -26], PB.concrete, PB.cinder),
        box('AC unit', [6, 3, 4], [8, 1, -20], PB.steel), box('AC unit', [4, 3, 6], [-6, 1, -10], PB.steel),
        cyl('Vent', 2, 3, [14, 1, -12], PB.steel, PB.steel, 12), cyl('Vent', 2, 3, [-12, 1, -16], PB.steel, PB.steel, 12),
        box('Tower deck', [8, 4, 8], [22, 1, -4], PB.planks, PB.rusty),
        cyl('Water tank', 4, 6, [21, 5, -6], PB.wood, PB.planks),
        stairs('Tower stairs', [3, 4, 6], [24, 1, 3], PB.steel, PB.steel, 0, 6),
      ),
    ],
    markers: teamMarkers({
      red: [[-8, 1, -31], [-3, 1, -31], [3, 1, -31], [8, 1, -31]],
      shared: [[-28, 1, -30], [29, 1, -30], [-14, 1, -1], [30, 1, -14]],
      weapons: [['sniper_rifle', [24, 5, -2]], ['pump_action_shotgun', [0, 1, -14]], ['mac10', [-29, 1, -12]]],
      drops: [[-20, 1, -14]],
      pimp: [0, 1, -28],
    }),
  },
  {
    id: 'pb_containers', name: 'Container Yard', icon: '🚢', theme: 'Urban paintball', modes: ALL_MODES,
    description: 'Shipping containers in lanes, some stacked two high, with stairs onto a container roof for a sniper spot.',
    parts: [
      ground(100, 100, PB.oldAsphalt, PB.concrete),
      ...perimeter(100, 100, 5, PB.corrugated, PB.steel),
      box('Container', [6, 6, 24], [0, 1, 0], PB.boxRed, PB.boxRed, 90),
      ...mirror(
        box('Container', [6, 6, 24], [-14, 1, -30], PB.boxGreen), box('Container', [6, 6, 24], [-14, 7, -30], PB.boxBlue),
        box('Container', [6, 6, 24], [14, 1, -30], PB.boxBlue),
        box('Container', [6, 6, 24], [-3, 1, -14], PB.boxRed, PB.boxRed, 90),
        box('Container', [6, 6, 24], [-34, 1, -6], PB.boxGreen, PB.boxGreen, 90),
        stairs('Stairs', [4, 6, 10], [14, 1, -13], PB.steel, PB.steel, 0, 10),
        box('Crate', [3, 3, 3], [28, 1, -36], PB.plywood), box('Crate', [3, 3, 3], [31, 1, -36], PB.plywood), box('Crate', [3, 3, 3], [29.5, 4, -36], PB.plywood),
      ),
    ],
    markers: teamMarkers({
      red: [[-6, 1, -46], [-2, 1, -46], [2, 1, -46], [6, 1, -46]],
      shared: [[-40, 1, -40], [40, 1, -42], [-40, 1, 14], [26, 1, -22]],
      weapons: [['sniper_rifle', [14, 7, -36]], ['ak47', [0, 1, -24]], ['pump_action_shotgun', [-34, 1, -16]], ['pipe_bomb', [-28, 1, -30]]],
      drops: [[-25, 1, -20]],
      pimp: [0, 1, -42],
    }),
  },
  {
    id: 'pb_garage', name: 'Parking Garage', icon: '🅿', theme: 'Urban paintball', modes: ALL_MODES,
    description: 'Each team starts on an upper deck with a ramp and stairs down to the parking level, where cars and barriers give cover.',
    parts: [
      ground(70, 100, PB.floorWorn, PB.concrete),
      ...perimeter(70, 100, 4, PB.cinder),
      ...mirror(
        box('Upper deck', [70, 1, 24], [0, 9, -38], PB.floorWorn, PB.concrete),
        box('Deck wall', [50, 2, 1], [-10, 10, -26.5], PB.concrete),
        ...[-24, -8, 8].flatMap((x) => [box('Column', [2, 8, 2], [x, 1, -30], PB.concrete), box('Column', [2, 8, 2], [x, 1, -46], PB.concrete)]),
        ramp('Ramp', [8, 9, 24], [26, 1, -14], PB.floorWorn, PB.concrete),
        stairs('Stairs', [5, 9, 14], [-30, 1, -19], PB.concrete, PB.concrete, 0, 14),
        car([-14, 1, -16], '#d0d0d0', 61), car([-8, 1, -16], '#2f8a3a', 62), car([10, 1, -8], '#b8322a', 63),
        car([-16, 1, -40], '#2a5ab8', 64), car([0, 1, -44], '#e0b020', 65),
        box('Jersey barrier', [10, 2, 1.5], [0, 1, -3], PB.concrete),
      ),
    ],
    markers: teamMarkers({
      red: [[-18, 10, -44], [-6, 10, -44], [6, 10, -44], [18, 10, -44]],
      shared: [[-31, 1, -4], [30, 1, -36], [-4, 1, -24], [-24, 10, -32]],
      weapons: [['sniper_rifle', [0, 10, -30]], ['ak47', [20, 1, -38]], ['tec9', [-20, 1, -6]], ['pump_action_shotgun', [17, 1, -1]]],
      drops: [[-26, 1, -4]],
      pimp: [0, 10, -47],
    }),
    lights: mirrorLights([[-16, 8, -38], LIGHT.warm], [[16, 8, -38], LIGHT.warm]),
  },
  {
    id: 'pb_alley', name: 'Back Alleys', icon: '🏚', theme: 'Urban paintball', modes: ALL_MODES,
    description: 'City blocks with narrow alleys, dumpsters and barrels around a fountain plaza. Fire escapes lead onto two rooftops.',
    parts: [
      ground(92, 92, PB.oldAsphalt, PB.concrete),
      ...perimeter(92, 92, 6, PB.brick),
      cyl('Fountain', 6, 1.5, [0, 1, 0], PB.concrete, PB.cobble), cyl('Statue', 1.5, 5, [0, 2.5, 0], PB.steel),
      ...mirror(
        box('Building', [18, 14, 18], [-28, 1, -28], PB.concrete, PB.brick),
        box('Building', [18, 10, 18], [0, 1, -28], PB.concrete, PB.plaster),
        box('Building', [18, 16, 18], [28, 1, -28], PB.concrete, PB.oldBrick),
        box('Building', [18, 10, 18], [-28, 1, 0], PB.concrete, PB.beige),
        stairs('Fire escape', [4, 10, 14], [-17, 1, -2], PB.rusty, PB.rusty, 180, 10),
        box('Dumpster', [3, 3, 6], [14, 1, -24], PB.boxGreen),
        cyl('Barrel', 1.6, 2, [-14, 1, -34], PB.boxBlue, PB.boxBlue, 12), cyl('Barrel', 1.6, 2, [-15.5, 1, -32], PB.boxBlue, PB.boxBlue, 12),
      ),
    ],
    markers: teamMarkers({
      red: [[-10, 1, -42], [-4, 1, -42], [4, 1, -42], [10, 1, -42]],
      shared: [[-42, 1, -42], [-14, 1, 14], [0, 1, -14], [42, 1, -26]],
      weapons: [['sniper_rifle', [-30, 11, -4]], ['ak47', [0, 1, -9]], ['molotov', [14, 1, -36]], ['tec9', [-42, 1, -14]]],
      drops: [[-42, 1, 10]],
      pimp: [0, 1, -44],
    }),
  },
  {
    id: 'pb_tires', name: 'Tire Yard', icon: '🛞', theme: 'Urban paintball', modes: ALL_MODES,
    description: 'A dirt lot of tire stacks, cable spools, pallets and plywood walls around a big tire pile in the middle.',
    parts: [
      ground(80, 80, PB.dirt),
      ...perimeter(80, 80, 4, PB.plywood),
      cyl('Tire pile', 7, 2, [0, 1, 0], PB.tire), cyl('Tire pile', 5, 2, [0, 3, 0], PB.tire), cyl('Tire pile', 3, 2, [0, 5, 0], PB.tire),
      ...mirror(
        ...([[-15, -20, 2.4], [-12.5, -20, 2.4], [-13.75, -17.8, 4]] as const).map(([x, z, h]) => cyl('Tire stack', 2.4, h, [x, 1, z], PB.tire, PB.tire, 12)),
        ...[8.5, 11, 13.5, 16].map((x) => cyl('Tire stack', 2.4, 2.4, [x, 1, -12], PB.tire, PB.tire, 12)),
        cyl('Cable spool', 5, 3, [-4, 1, -30], PB.wood, PB.planks), cyl('Cable spool', 5, 3, [20, 1, -28], PB.wood, PB.planks),
        box('Plywood wall', [8, 4, 0.6], [0, 1, -16], PB.plywood), box('Plywood wall', [8, 4, 0.6], [-24, 1, -8], PB.plywood, PB.plywood, 90),
        box('Pallets', [3, 1.2, 3], [24, 1, -18], PB.wood), box('Pallets', [3, 1.2, 3], [24, 2.2, -18], PB.wood),
      ),
    ],
    markers: teamMarkers({
      red: [[-9, 1, -36], [-3, 1, -36], [3, 1, -36], [9, 1, -36]],
      shared: [[-34, 1, -34], [34, 1, -30], [-34, 1, -4], [27, 1, -6]],
      weapons: [['pump_action_shotgun', [0, 1, -8]], ['m16', [-15, 1, -28]], ['mac10', [30, 1, -16]]],
      drops: [[-28, 1, 10]],
      pimp: [0, 1, -38],
    }),
  },
  {
    id: 'pb_construction', name: 'Construction Site', icon: '🏗', theme: 'Urban paintball', modes: ALL_MODES,
    description: 'A half-built concrete frame with an open upper floor, beam stacks, sand piles, a cement mixer and plywood barricades.',
    parts: [
      ground(80, 100, PB.gravel, PB.dirt),
      ...perimeter(80, 100, 5, PB.plywood),
      box('Floor slab', [30, 1, 22], [0, 9, 0], PB.concrete),
      ...mirror(
        ...[-12, 0, 12].map((x) => box('Column', [1.5, 8, 1.5], [x, 1, -8], PB.concrete)),
        stairs('Stairs', [4, 9, 12], [21, 1, -6], PB.concrete, PB.concrete, 90, 12),
        box('Steel beams', [10, 1.4, 4.2], [-24, 1, -24], PB.rusty), box('Steel beams', [10, 1.4, 2.8], [-24, 2.4, -24], PB.rusty), box('Steel beams', [10, 1.4, 1.4], [-24, 3.8, -24], PB.rusty),
        cyl('Sand pile', 8, 1.5, [24, 1, -28], PB.sand, PB.sand, 10), cyl('Sand pile', 5, 1.5, [24, 2.5, -28], PB.sand, PB.sand, 10),
        cyl('Cement mixer', 3, 3.5, [-6, 1, -30], PB.orange, PB.steel),
        box('Porta-potty', [3, 5, 3], [30, 1, -40], PB.blue), box('Porta-potty', [3, 5, 3], [34, 1, -40], PB.blue),
        box('Pallets', [3, 1.5, 3], [-20, 1, -38], PB.wood),
        box('Barricade', [8, 3, 0.6], [10, 1, -22], PB.plywood, PB.plywood, 20),
        box('Barricade', [8, 3, 0.6], [-28, 1, -6], PB.plywood, PB.plywood, 90),
      ),
    ],
    markers: teamMarkers({
      red: [[-12, 1, -45], [-4, 1, -45], [4, 1, -45], [12, 1, -45]],
      shared: [[-34, 1, -40], [34, 1, -24], [-30, 1, 2], [0, 1, -20]],
      weapons: [['sniper_rifle', [0, 10, -6]], ['ak47', [-24, 1, -16]], ['pump_action_shotgun', [6, 1, 0]], ['pipe_bomb', [16, 1, -36]]],
      drops: [[-36, 1, -18]],
      pimp: [0, 1, -47],
    }),
  },
  {
    id: 'pb_court', name: 'Street Court', icon: '🏀', theme: 'Urban paintball', modes: ALL_MODES,
    description: 'An open basketball court in the middle (the kill zone), with bleachers, parked cars, dumpsters and brick walls around it.',
    parts: [
      ground(90, 90, PB.oldAsphalt, PB.concrete),
      ...perimeter(90, 90, 8, PB.brick),
      box('Court', [30, 0.2, 50], [0, 1, 0], court),
      ...mirror(
        box('Court wall', [1, 1.5, 18], [16, 1, -14], PB.cinder),
        box('Court wall', [12, 1.5, 1], [-9, 1, -26], PB.cinder),
        cyl('Hoop post', 0.6, 7, [0, 1, -26.5], PB.steel, PB.steel, 8),
        box('Backboard', [4, 3, 0.3], [0, 6, -25.6], PB.tilesWhite, PB.steel),
        stairs('Bleachers', [16, 4, 6], [23, 1, -9], PB.wood, PB.steel, 270, 4),
        car([-30, 1, -20], '#c0c0c0', 66), car([32, 1, -32], '#802020', 67),
        box('Dumpster', [6, 3, 3], [-30, 1, -38], PB.boxGreen),
        box('Brick wall', [10, 4, 1], [-34, 1, 0], PB.brick, PB.brick, 90),
        cyl('Trash can', 1.2, 1.8, [-6, 1.2, -12], PB.steel, PB.steel, 10),
      ),
    ],
    markers: teamMarkers({
      red: [[-12, 1, -38], [-4, 1, -38], [4, 1, -38], [12, 1, -38]],
      shared: [[-38, 1, -36], [37, 1, -14], [0, 1.2, -8], [-24, 1, -12]],
      weapons: [['ak47', [0, 1.2, 0]], ['pump_action_shotgun', [-21, 1, -6]], ['molotov', [32, 1, -42]]],
      drops: [[-8, 1.2, -18]],
      pimp: [0, 1, -41],
    }),
  },
  {
    id: 'pb_subway', name: 'Subway Station', icon: '🚇', theme: 'Urban paintball', modes: ALL_MODES,
    description: 'Two tiled platforms over a sunken track with stopped train cars. Stairs climb from the tracks; pillars line the platforms.',
    parts: [
      ground(56, 100, PB.gravel, PB.concrete),
      ...perimeter(56, 100, 14, PB.tilesWhite, PB.concrete),
      ...mirror(
        box('Platform', [16, 4, 100], [20, 1, 0], PB.floorWorn, PB.cinder),
        box('Train car', [8, 6, 30], [-6, 1, -20], PB.steel, trainSide),
        ...[-40, -24, -8].flatMap((z) => [cyl('Pillar', 2, 10, [20, 5, z], PB.tilesWhite, PB.tilesWhite, 12), cyl('Pillar', 2, 10, [-20, 5, z], PB.tilesWhite, PB.tilesWhite, 12)]),
        stairs('Stairs', [4, 4, 8], [8, 1, -36], PB.concrete, PB.concrete, 270, 6),
        stairs('Stairs', [4, 4, 8], [-8, 1, -40], PB.concrete, PB.concrete, 90, 6),
        box('Bench', [1.5, 1.2, 6], [24, 5, -30], PB.wood),
      ),
    ],
    markers: teamMarkers({
      red: [[-20, 5, -46], [20, 5, -46], [-2, 1, -46], [4, 1, -46]],
      shared: [[24, 5, -16], [-16, 5, -30], [8, 1, -24], [-6, 1, -45]],
      weapons: [['ak47', [0, 1, -12]], ['pump_action_shotgun', [-20, 5, -32]], ['mac10', [22, 5, -37]], ['pipe_bomb', [8, 1, -46]]],
      drops: [[-19, 5, -15]],
      pimp: [1, 1, -48],
    }),
    lights: mirrorLights([[20, 13, -30], LIGHT.cool], [[-20, 13, -10], LIGHT.cool], [[0, 12, -40], LIGHT.white]),
  },
  {
    id: 'pb_skate', name: 'Skate Park', icon: '🛹', theme: 'Urban paintball', modes: ALL_MODES,
    description: 'Quarter pipes, a funbox with ramps on every side, ledges, a rail and a stair set. Fast, flowing fights.',
    parts: [
      ground(80, 80, PB.concrete),
      ...perimeter(80, 80, 3, PB.cinder),
      box('Funbox', [12, 2.5, 12], [0, 1, 0], PB.concrete, PB.cinder),
      ...mirror(
        ramp('Funbox ramp', [12, 2.5, 6], [0, 1, 9], PB.concrete, PB.cinder, 0),
        ramp('Funbox ramp', [12, 2.5, 6], [9, 1, 0], PB.concrete, PB.cinder, 90),
        ramp('Quarter pipe', [20, 4, 6], [-20, 1, -37], PB.concrete, PB.cinder), ramp('Quarter pipe', [20, 4, 6], [20, 1, -37], PB.concrete, PB.cinder),
        box('Ledge', [10, 1.5, 2], [-22, 1, -16], PB.concrete), box('Ledge', [10, 1.5, 2], [18, 1, -18], PB.concrete, PB.concrete, 30),
        stairs('Stair set', [6, 2, 4], [-24, 1, -4], PB.concrete, PB.concrete, 0, 4), box('Platform', [6, 2, 6], [-24, 1, -9], PB.concrete),
        box('Rail', [0.4, 1.2, 8], [-18, 1, -5], PB.steel),
      ),
    ],
    markers: teamMarkers({
      red: [[-6, 1, -30], [-2, 1, -30], [2, 1, -30], [6, 1, -30]],
      shared: [[-34, 1, -26], [34, 1, -10], [-14, 1, -26], [24, 1, -4]],
      weapons: [['ak47', [0, 3.5, 0]], ['tec9', [-24, 3, -9]], ['mac10', [24, 1, -28]]],
      drops: [[-34, 1, 6]],
      pimp: [0, 1, -33],
    }),
  },
  {
    id: 'pb_village', name: 'Bunker Village', icon: '🛖', theme: 'Urban paintball', modes: ALL_MODES,
    description: 'Plywood huts with doorways, sandbag lines and two lookout towers. Clear huts room by room or hold a tower.',
    parts: [
      ground(90, 90, PB.dirt),
      ...perimeter(90, 90, 4, PB.plywood),
      cyl('Well', 4, 1.2, [0, 1, 0], PB.cobble, PB.oldBrick),
      ...mirror(
        ...hut(-20, -26, 10, 8, 4, 0, PB.plywood),
        ...hut(14, -14, 8, 8, 4, 90, PB.planks),
        ...lookout(24, -32, 6),
        box('Sandbags', [8, 1.6, 1.5], [0, 1, -14], sandbag), box('Sandbags', [8, 1.6, 1.5], [-8, 1, -6], sandbag, sandbag, 60),
        box('Crates', [3, 3, 3], [-34, 1, -18], PB.wood),
      ),
    ],
    markers: teamMarkers({
      red: [[-8, 1, -40], [-3, 1, -40], [3, 1, -40], [9, 1, -40]],
      shared: [[-20, 1, -26], [36, 1, -36], [-36, 1, -8], [4, 1, -28]],
      weapons: [['sniper_rifle', [24, 7.8, -32]], ['pump_action_shotgun', [14, 1, -14]], ['ak47', [-34, 1, -30]], ['molotov', [6, 1, -6]]],
      drops: [[-30, 1, 8]],
      pimp: [0, 1, -42],
    }),
  },
  {
    id: 'pb_market', name: 'Night Market', icon: '🏮', theme: 'Urban paintball', modes: ALL_MODES,
    description: 'A cobbled street of market stalls under lanterns, with carts, crates and a pagoda in the middle.',
    parts: [
      ground(90, 100, PB.cobble, PB.concrete),
      ...perimeter(90, 100, 6, PB.oldBrick),
      box('Pagoda roof', [9, 0.8, 9], [0, 5, 0], slate, PB.wood),
      ...mirror(
        cyl('Pagoda post', 0.5, 4, [3, 1, -3], PB.wood, PB.wood, 8), cyl('Pagoda post', 0.5, 4, [-3, 1, -3], PB.wood, PB.wood, 8),
        box('Building', [20, 14, 22], [-35, 1, -36], PB.concrete, PB.brick), box('Building', [20, 18, 22], [35, 1, -36], PB.concrete, PB.plaster),
        box('Building', [20, 12, 22], [-35, 1, -12], PB.concrete, PB.beige), box('Building', [20, 16, 22], [35, 1, -12], PB.concrete, PB.oldBrick),
        ...stall(-16, -36, PB.red), ...stall(16, -36, PB.yellow), ...stall(-16, -24, PB.blue),
        ...stall(16, -24, PB.green), ...stall(-16, -12, PB.orange), ...stall(16, -12, PB.red),
        box('Cart', [3, 2.5, 5], [-5, 1, -34], PB.wood), box('Cart', [3, 2.5, 5], [6, 1, -20], PB.wood),
        box('Crates', [2, 2, 2], [10, 1, -38], PB.plywood),
      ),
    ],
    markers: teamMarkers({
      red: [[-10, 1, -46], [-4, 1, -46], [4, 1, -46], [10, 1, -46]],
      shared: [[-20, 1, -30], [8, 1, -30], [-6, 1, -14], [21, 1, -6]],
      weapons: [['mac10', [-20, 1, -18]], ['pump_action_shotgun', [0, 1, -26]], ['ak47', [0, 1, -9]]],
      drops: [[-12, 1, 0]],
      pimp: [0, 1, -44],
    }),
    lights: mirrorLights([[-16, 5.5, -30], LIGHT.orange], [[16, 5.5, -30], LIGHT.orange], [[-16, 5.5, -6], LIGHT.warm], [[16, 5.5, -6], LIGHT.warm]),
  },
  {
    id: 'pb_overpass', name: 'Overpass', icon: '🌉', theme: 'Urban paintball', modes: ALL_MODES,
    description: 'An elevated highway crosses the middle on pillars. Fight on the deck between stalled cars, or under it behind jersey barriers.',
    parts: [
      ground(100, 100, PB.oldAsphalt, PB.concrete),
      ...perimeter(100, 100, 4, PB.cinder),
      box('Highway deck', [100, 1, 14], [0, 10, 0], road, PB.concrete),
      ...mirror(
        cyl('Pillar', 3, 9, [10, 1, 0], PB.concrete), cyl('Pillar', 3, 9, [30, 1, 0], PB.concrete),
        ramp('On-ramp', [10, 10, 30], [-38, 1, -22], PB.asphalt, PB.concrete, 180),
        box('Deck barrier', [60, 1.5, 0.6], [0, 11, -6.6], PB.concrete),
        car([16, 11, -3], '#d0d0d0', 68, 90),
        box('Jersey barrier', [1.2, 2, 8], [-8, 1, -16], PB.concrete), box('Jersey barrier', [8, 2, 1.2], [20, 1, -26], PB.concrete),
        car([-22, 1, -32], '#2a5ab8', 69), box('Dumpster', [6, 3, 3], [34, 1, -40], PB.boxGreen),
      ),
    ],
    markers: teamMarkers({
      red: [[-16, 1, -44], [-6, 1, -44], [6, 1, -44], [16, 1, -44]],
      shared: [[-46, 1, -44], [24, 1, -30], [0, 1, -20], [-20, 11, -3]],
      weapons: [['sniper_rifle', [0, 11, -3]], ['rpg_launcher', [0, 1, 0]], ['ak47', [-8, 1, -26]], ['pump_action_shotgun', [30, 1, -14]]],
      drops: [[-46, 1, 0]],
      pimp: [0, 1, -46],
    }),
  },
]
