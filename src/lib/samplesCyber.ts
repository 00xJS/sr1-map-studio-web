// Cyber sample maps: dark floors with glowing grid lines, neon blocks and
// colored lights. Point-symmetric like the paintball maps; red starts at −Z.
import type { Vec3 } from './project'
import { ALL_MODES, CY, LIGHT, box, cyl, ground, mirror, mirrorLights, perimeter, ramp, stairs, teamMarkers, type Part, type Sample, type Tex } from './sampleKit'

const deg = (r: number) => (r * 180) / Math.PI
/** Position on a circle of radius r at angle a (degrees, from +X toward +Z). */
const polar = (r: number, a: number): [number, number] => [+(r * Math.cos((a * Math.PI) / 180)).toFixed(3), +(r * Math.sin((a * Math.PI) / 180)).toFixed(3)]
/** Heading that lays a box's width along the circle's tangent at angle a. */
const tangent = (a: number) => -a - 90
/** Heading that lays a box's width along the radius at angle a. */
const radial = (a: number) => -a
/** Heading that makes a ramp or stairs at angle a rise outward, away from the center. */
const outward = (a: number) => +deg(Math.atan2(-Math.cos((a * Math.PI) / 180), -Math.sin((a * Math.PI) / 180))).toFixed(3)

// Neon Grid: checkerboard of blocks; heights and colors depend only on |i|, |j| so the board is symmetric.
const gridBlocks: Part[] = []
for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
  if ((i + j) % 2 === 0 || (i === 0 && Math.abs(j) === 1)) continue
  const h = 2 + 2 * ((i * i + j * j) % 3)
  const tex = Math.abs(i) % 2 ? CY.cyan : CY.pink
  gridBlocks.push(box('Neon block', [4, h, 4], [12 * i, 1, 12 * j], tex))
}

// Hex Hive: six-sided pillars on a hex lattice.
const HZ = 8.66
const hexes: Part[] = []
const hexColors: Tex[] = [CY.lime, CY.cyan, CY.purple, CY.pink]
for (let k = -3; k <= 3; k++) for (let i = -4; i <= 4; i++) {
  const x = 10 * i + (Math.abs(k) % 2 ? 5 : 0)
  if (Math.abs(x) > 32) continue
  const z = +(HZ * k).toFixed(2)
  const n = x === 0 && z === 0 ? 0 : (Math.round(Math.abs(x)) * 7 + Math.round(Math.abs(z)) * 3) % 4
  const h = [2.5, 4, 6, 9][n]
  hexes.push({ ...cyl('Hex pillar', 7, h, [x, 1, z], CY.dark, hexColors[n], 6), big: true })
}
const c3 = +(HZ / 3).toFixed(3)

// Holo Maze: walls on cell boundaries (cells are 10 units, centered on multiples of 10).
const H = (c: number, b: number, tex: Tex, h = 4): Part => ({ ...box('Maze wall', [10, h, 1], [c, 1, b], CY.dark, tex), big: true })
const V = (b: number, c: number, tex: Tex, h = 4): Part => ({ ...box('Maze wall', [1, h, 10], [b, 1, c], CY.dark, tex), big: true })

const tower = (x: number, z: number, h: number, side: Tex) => box('Tower', [16, h, 16], [x, 1, z], CY.dark, side)

export const CYBER: Sample[] = [
  {
    id: 'cy_grid', name: 'Neon Grid', icon: '🟦', theme: 'Cyber', modes: ALL_MODES,
    description: 'A glowing grid floor with a checkerboard of neon blocks at different heights, and a ramped tower in the middle.',
    parts: [
      ground(80, 80, CY.gridCyan, CY.panel),
      ...perimeter(80, 80, 6, CY.panel, CY.panelLight),
      box('Center tower', [8, 4, 8], [0, 1, 0], CY.dark, CY.purple),
      ...gridBlocks,
      ...mirror(ramp('Ramp', [4, 4, 8], [0, 1, 8], CY.dark, CY.panel, 0)),
    ],
    markers: teamMarkers({
      red: [[-9, 1, -34], [-3, 1, -34], [3, 1, -34], [9, 1, -34]],
      shared: [[-24, 1, -24], [24, 1, -24], [-12, 1, -12], [12, 1, -12]],
      weapons: [['rpg_laser', [0, 5, 0]], ['mac10L', [-24, 1, 0]], ['spas12', [0, 1, -24]]],
      drops: [[-30, 1, -6]],
      pimp: [0, 1, -36],
    }),
    lights: [...mirrorLights([[-24, 8, -24], LIGHT.cyan], [[24, 8, -24], LIGHT.pink]), [[0, 12, 0], LIGHT.purple]],
  },
  {
    id: 'cy_core', name: 'Data Core', icon: '💠', theme: 'Cyber', modes: ALL_MODES,
    description: 'A round arena around a towering data core. Ramps climb to the core ring; glowing conduits and server pillars break up the floor.',
    parts: [
      cyl('Arena floor', 84, 1, [0, 0, 0], CY.gridCyan, CY.panel, 48, 0, 6),
      ...[...Array(24)].map((_, k) => { const a = k * 15, [x, z] = polar(41.5, a); return { ...box('Ring wall', [11, 7, 1], [x, 0, z], CY.panelLight, CY.panel, tangent(a)), big: true } }),
      cyl('Core ring', 18, 3, [0, 1, 0], CY.dark, CY.panel, 24),
      cyl('Data core', 8, 16, [0, 4, 0], CY.cyan, CY.cyan, 24),
      ...[45, 135, 225, 315].map((a) => { const [x, z] = polar(24, a); return box('Conduit', [12, 3, 1.2], [x, 1, z], CY.pink, CY.panel, radial(a)) }),
      ...[0, 90, 180, 270].map((a) => { const [x, z] = polar(30, a); return cyl('Server pillar', 3, 4, [x, 1, z], CY.dark, CY.cyan) }),
      ...mirror(ramp('Ramp', [4, 3, 8], [0, 1, 13], CY.dark, CY.panel, 0), ramp('Ramp', [4, 3, 8], [13, 1, 0], CY.dark, CY.panel, 90)),
    ],
    markers: teamMarkers({
      red: [[-8, 1, -36], [-3, 1, -36], [3, 1, -36], [8, 1, -36]],
      shared: [[-28, 1, -10], [10, 1, -24], [-20, 1, -30], [30, 1, -16]],
      weapons: [['rpg_laser', [0, 4, -7]], ['mac10L', [-35, 1, 0]], ['spas12', [20, 1, -30]]],
      drops: [[-20, 1, 8]],
      pimp: [0, 1, -38],
    }),
    lights: [[[0, 22, 0], LIGHT.cyan], ...mirrorLights([[28, 6, -28], LIGHT.pink], [[-28, 6, -28], LIGHT.cyan])],
  },
  {
    id: 'cy_circuit', name: 'Circuit Board', icon: '🔌', theme: 'Cyber', modes: ALL_MODES,
    description: 'Shrunk down onto a motherboard: chips to climb, capacitors and resistors for cover, gold traces and a CPU with a heat sink.',
    parts: [
      ground(90, 90, CY.board, CY.chip),
      ...perimeter(90, 90, 3, CY.gold, CY.chip),
      box('CPU', [14, 3, 14], [0, 1, 0], CY.chip, CY.gold),
      ...[-4.5, -1.5, 1.5, 4.5].map((x) => box('Heat sink fin', [0.6, 1.5, 12], [x, 4, 0], CY.panelLight)),
      ...mirror(
        box('Chip', [12, 2.5, 8], [-22, 1, -24], CY.chip, CY.gold), box('Step', [3, 1.2, 3], [-22, 1, -18.5], CY.gold),
        box('Chip', [8, 2.5, 8], [18, 1, -28], CY.chip, CY.gold), box('Step', [3, 1.2, 3], [18, 1, -22.5], CY.gold),
        cyl('Capacitor', 3, 5, [6, 1, -32], CY.panelLight, CY.cyan), cyl('Capacitor', 3, 5, [9.5, 1, -32], CY.panelLight, CY.cyan),
        cyl('Capacitor', 3, 5, [-8, 1, -14], CY.panelLight, CY.purple),
        box('Trace', [1.2, 1.2, 20], [-30, 1, -20], CY.gold), box('Trace', [20, 1.2, 1.2], [10, 1, -18], CY.gold),
        cyl('Resistor', 1.5, 3, [24, 1, -10], CY.orange, CY.orange, 8), cyl('Resistor', 1.5, 3, [26.5, 1, -10], CY.orange, CY.orange, 8),
      ),
    ],
    markers: teamMarkers({
      red: [[-10, 1, -40], [-4, 1, -40], [4, 1, -40], [10, 1, -40]],
      shared: [[-36, 1, -36], [36, 1, -36], [-34, 1, -4], [12, 1, -12]],
      weapons: [['mac10L', [0, 1, -12]], ['spas12', [-22, 3.5, -24]], ['sniper_rifle', [18, 3.5, -28]]],
      drops: [[-36, 1, -14]],
      pimp: [0, 1, -42],
    }),
    lights: [...mirrorLights([[-22, 6, -24], LIGHT.lime], [[18, 6, -28], LIGHT.cyan]), [[0, 10, 0], LIGHT.orange]],
  },
  {
    id: 'cy_hex', name: 'Hex Hive', icon: '⬡', theme: 'Cyber', modes: ALL_MODES,
    description: 'A honeycomb of hexagonal pillars at four heights. Weave through the gaps; grab the laser RPG on the low center hex.',
    parts: [
      ground(80, 80, CY.gridPurple, CY.panel),
      ...perimeter(80, 80, 5, CY.panel, CY.panelLight),
      ...hexes,
    ],
    markers: teamMarkers({
      red: [[-9, 1, -36], [-3, 1, -36], [3, 1, -36], [9, 1, -36]],
      shared: [[5, 1, -c3], [-15, 1, -c3], [5, 1, -(HZ * 2 + c3)], [-25, 1, -(HZ + 2 * c3)]],
      weapons: [['rpg_laser', [0, 3.5, 0]], ['mac10L', [15, 1, -c3]], ['spas12', [-5, 1, -(HZ * 2 + c3)]]],
      drops: [[-25, 1, c3]],
      pimp: [0, 1, -37],
    }),
    lights: [[[0, 14, 0], LIGHT.purple], ...mirrorLights([[-20, 10, -20], LIGHT.lime], [[20, 10, -20], LIGHT.pink])],
  },
  {
    id: 'cy_servers', name: 'Server Farm', icon: '🖥', theme: 'Cyber', modes: ALL_MODES,
    description: 'Rows of blinking server racks with tight aisles at both ends, and an open floor with cooling units and a control desk in the middle.',
    parts: [
      ground(80, 90, CY.fineGrid, CY.panel),
      ...perimeter(80, 90, 8, CY.panel, CY.panelLight),
      box('Control desk', [10, 1.5, 4], [0, 1, 0], CY.panelLight, CY.panel),
      ...mirror(
        ...[-27, -19, -11, 11, 19, 27].map((x) => box('Server rack', [2.5, 7, 14], [x, 1, -23], CY.chip, CY.windows)),
        cyl('Cooling unit', 5, 6, [10, 1, 0], CY.panelLight, CY.cyan),
      ),
    ],
    markers: teamMarkers({
      red: [[-6, 1, -42], [-2, 1, -42], [2, 1, -42], [6, 1, -42]],
      shared: [[-23, 1, -23], [-15, 1, -36], [15, 1, -12], [-34, 1, -8]],
      weapons: [['mac10L', [0, 1, -24]], ['spas12', [-23, 1, -34]], ['rpg_laser', [0, 2.5, 0]]],
      drops: [[-36, 1, -30]],
      pimp: [0, 1, -44],
    }),
    lights: [...mirrorLights([[-15, 9, -23], LIGHT.cyan], [[15, 9, -23], LIGHT.cyan]), [[0, 8, 0], LIGHT.purple]],
  },
  {
    id: 'cy_islands', name: 'Sky Islands', icon: '🏝', theme: 'Cyber', modes: ALL_MODES,
    description: 'Floating platforms at different heights over a glowing void floor, joined by neon bridges and ramps.',
    parts: [
      ground(90, 90, CY.gridPurple, CY.panel),
      ...perimeter(90, 90, 1.5, CY.panelLight),
      box('Center island', [16, 7, 16], [0, 1, 0], CY.gridCyan, CY.panel),
      ...mirror(
        box('Base island', [24, 6, 14], [0, 1, -34], CY.gridPink, CY.panel),
        ramp('Ramp', [6, 6, 14], [-19, 1, -34], CY.dark, CY.panel, 270),
        ramp('Bridge', [4, 1, 19], [0, 7, -17.5], CY.cyan, CY.cyan, 180),
        box('Island', [10, 4, 10], [-20, 1, -12], CY.gridCyan, CY.panel),
        stairs('Stairs', [4, 4, 8], [-20, 1, -21], CY.dark, CY.panel, 180, 6),
        box('Tower island', [10, 9, 10], [20, 1, -4], CY.gridPink, CY.panel),
        ramp('Bridge', [3, 2, 7], [11.5, 8, -4], CY.pink, CY.pink, 270),
        box('Floating cube', [3, 3, 3], [-30, 14, -30], CY.pink), box('Floating cube', [2, 2, 2], [28, 18, -24], CY.cyan),
      ),
    ],
    markers: teamMarkers({
      red: [[-8, 7, -36], [-3, 7, -36], [3, 7, -36], [8, 7, -36]],
      shared: [[-30, 1, -30], [30, 1, -30], [-34, 1, 4], [0, 8, 4]],
      weapons: [['rpg_laser', [0, 8, 0]], ['sniper_rifle', [22, 10, -6]], ['mac10L', [-20, 5, -12]], ['spas12', [30, 1, -14]]],
      drops: [[-34, 1, -14]],
      pimp: [0, 7, -38],
    }),
    lights: [[[0, 14, 0], LIGHT.cyan], ...mirrorLights([[0, 12, -34], LIGHT.pink], [[20, 14, -4], LIGHT.purple])],
  },
  {
    id: 'cy_pyramid', name: 'Neon Ziggurat', icon: '🔺', theme: 'Cyber', modes: ALL_MODES,
    description: 'A four-tier stepped pyramid with stairs up every face and a laser RPG on top, ringed by glowing obelisks.',
    parts: [
      ground(90, 90, CY.gridCyan, CY.panel),
      ...perimeter(90, 90, 4, CY.panel, CY.panelLight),
      box('Tier', [30, 3, 30], [0, 1, 0], CY.dark, CY.windows), box('Tier', [22, 3, 22], [0, 4, 0], CY.dark, CY.windowsPink),
      { ...box('Tier', [14, 3, 14], [0, 7, 0], CY.dark, CY.windows), big: true }, { ...box('Tier', [6, 3, 6], [0, 10, 0], CY.pink, CY.pink), big: true },
      ...mirror(
        ...([[17, 1], [13, 4], [9, 7], [5, 10]] as const).flatMap(([r, y]) => [
          stairs('Stairs', [4, 3, 4], [0, y, r], CY.cyan, CY.panel, 0, 4), stairs('Stairs', [4, 3, 4], [r, y, 0], CY.cyan, CY.panel, 90, 4),
        ]),
        cyl('Obelisk', 3, 10, [30, 1, -30], CY.purple, CY.purple, 4, 45), cyl('Obelisk', 3, 10, [-30, 1, -30], CY.purple, CY.purple, 4, 45),
        box('Low wall', [8, 2, 1.2], [-20, 1, -28], CY.panelLight), box('Low wall', [8, 2, 1.2], [18, 1, -31], CY.panelLight),
      ),
    ],
    markers: teamMarkers({
      red: [[-9, 1, -40], [-3, 1, -40], [3, 1, -40], [9, 1, -40]],
      shared: [[-34, 1, -10], [24, 1, -22], [-12, 4, -12], [0, 1, -24]],
      weapons: [['rpg_laser', [0, 13, 0]], ['mac10L', [12, 4, -12]], ['spas12', [-30, 1, 0]], ['sniper_rifle', [-8, 7, -9]]],
      drops: [[-38, 1, -20]],
      pimp: [0, 1, -42],
    }),
    lights: [[[0, 18, 0], LIGHT.pink], ...mirrorLights([[30, 12, -30], LIGHT.purple], [[-30, 12, -30], LIGHT.cyan])],
  },
  {
    id: 'cy_maze', name: 'Holo Maze', icon: '🌀', theme: 'Cyber', modes: ALL_MODES,
    description: 'A maze of glowing walls on a 10-unit grid with short sightlines everywhere. The laser RPG waits in the very center.',
    parts: [
      ground(80, 80, CY.gridPink, CY.panel),
      ...perimeter(80, 80, 6, CY.panel, CY.panelLight),
      ...mirror(
        H(-30, -25, CY.cyan), H(-10, -25, CY.pink), H(20, -25, CY.cyan),
        H(0, -15, CY.pink, 2), H(-20, -15, CY.cyan), H(30, -15, CY.pink),
        H(10, -5, CY.cyan), H(-30, -5, CY.pink),
        V(-15, -30, CY.pink), V(5, -30, CY.cyan), V(25, -20, CY.pink),
        V(-25, -10, CY.cyan), V(15, -10, CY.pink), V(-5, -20, CY.cyan),
        V(5, 0, CY.purple),
      ),
    ],
    markers: teamMarkers({
      red: [[-9, 1, -37.5], [-3, 1, -37.5], [3, 1, -37.5], [9, 1, -37.5]],
      shared: [[-30, 1, -30], [30, 1, -20], [-10, 1, -10], [10, 1, -30]],
      weapons: [['rpg_laser', [0, 1, 0]], ['mac10L', [-20, 1, -10]], ['spas12', [20, 1, -30]]],
      drops: [[-30, 1, 0]],
      pimp: [0, 1, -38],
    }),
    lights: [[[0, 10, 0], LIGHT.cyan], ...mirrorLights([[-30, 8, -30], LIGHT.pink], [[30, 8, -30], LIGHT.cyan])],
  },
  {
    id: 'cy_skyline', name: 'Neon Skyline', icon: '🌃', theme: 'Cyber', modes: ALL_MODES,
    description: 'Glowing towers at different heights linked by sloped neon bridges. Spawn on your home tower; the street far below has stairs back up.',
    parts: [
      ground(100, 100, CY.gridPurple, CY.panel),
      ...perimeter(100, 100, 2, CY.panelLight),
      ...mirror(
        tower(0, -30, 14, CY.windows), tower(-24, -30, 12, CY.windowsPink), tower(24, -30, 12, CY.windowsPink),
        tower(-28, -6, 18, CY.windows), tower(4, -8, 10, CY.windowsPink), tower(26, -10, 12, CY.windows),
        ramp('Bridge', [4, 4, 6], [2, 11, -19], CY.cyan, CY.cyan, 0),
        ramp('Bridge', [4, 2, 8], [-12, 13, -30], CY.pink, CY.pink, 270),
        ramp('Bridge', [4, 2, 8], [12, 13, -30], CY.pink, CY.pink, 90),
        ramp('Bridge', [4, 6, 8], [-26, 13, -18], CY.cyan, CY.cyan, 180),
        ramp('Bridge', [4, 2, 6], [15, 11, -8], CY.cyan, CY.cyan, 270),
        stairs('Stairs', [4, 12, 12], [24, 1, -44], CY.dark, CY.panel, 180, 12),
      ),
    ],
    markers: teamMarkers({
      red: [[-5, 15, -34], [-1, 15, -34], [3, 15, -34], [6, 15, -30]],
      shared: [[-24, 13, -33], [24, 13, -34], [-28, 19, -8], [26, 13, -12]],
      weapons: [['sniper_rifle', [-28, 19, -2]], ['rpg_laser', [0, 11, -4]], ['mac10L', [8, 11, -12]], ['spas12', [-30, 1, -44]]],
      drops: [[-24, 13, -25]],
      pimp: [0, 15, -26],
    }),
    lights: mirrorLights([[0, 20, -30], LIGHT.cyan], [[-28, 24, -6], LIGHT.pink], [[26, 18, -10], LIGHT.purple]),
  },
  {
    id: 'cy_colosseum', name: 'Cyber Colosseum', icon: '🏛', theme: 'Cyber', modes: ALL_MODES,
    description: 'An octagonal pit ringed by tiered neon seating, with a ramped platform in the middle and blocks for cover.',
    parts: [
      cyl('Arena floor', 90, 1, [0, 0, 0], CY.gridPink, CY.panel, 8, 22.5, 6),
      ...[0, 45, 90, 135, 180, 225, 270, 315].map((a) => { const [x, z] = polar(42, a); return box('Outer wall', [35, 9, 1], [x, 0, z], CY.panelLight, CY.panel, tangent(a)) }),
      ...[0, 45, 90, 135, 180, 225, 270, 315].map((a) => { const [x, z] = polar(34, a); return stairs('Seating', [24, 6, 8], [x, 1, z], CY.dark, CY.panelLight, outward(a), 6) }),
      box('Center platform', [10, 3, 10], [0, 1, 0], CY.dark, CY.purple),
      ...mirror(
        ramp('Ramp', [4, 3, 6], [0, 1, 8], CY.dark, CY.panel, 0), ramp('Ramp', [4, 3, 6], [8, 1, 0], CY.dark, CY.panel, 90),
        box('Cover block', [3, 3, 6], [14, 1, -12], CY.cyan), box('Cover block', [3, 3, 6], [-14, 1, -12], CY.pink),
      ),
    ],
    markers: teamMarkers({
      red: [[-9, 1, -26], [-3, 1, -26], [3, 1, -26], [9, 1, -26]],
      shared: [[-20, 1, -14], [20, 1, -14], [0, 1, -18], [-26, 1, 0]],
      weapons: [['rpg_laser', [0, 4, 0]], ['mac10L', [-14, 1, -22]], ['spas12', [22, 1, -16]]],
      drops: [[-24, 1, 10]],
      pimp: [0, 1, -28],
    }),
    lights: [0, 45, 90, 135, 180, 225, 270, 315].map((a, i): [Vec3, Vec3] => { const [x, z] = polar(34, a); return [[x, 10, z], i % 2 ? LIGHT.pink : LIGHT.cyan] }),
  },
  {
    id: 'cy_lanes', name: 'Three Lanes', icon: '🛤', theme: 'Cyber', modes: ALL_MODES,
    description: 'Three long lanes split by glowing walls with gaps to cross between them. Each base has a sniper deck over the middle lane.',
    parts: [
      ground(60, 110, CY.gridCyan, CY.panel),
      ...perimeter(60, 110, 6, CY.panel, CY.panelLight),
      ...mirror(
        box('Divider', [1.5, 6, 21], [-10, 1, -24.5], CY.panel, CY.cyan), box('Divider', [1.5, 6, 21], [-10, 1, 24.5], CY.panel, CY.pink),
        box('Divider', [1.5, 6, 16], [-10, 1, 0], CY.panel, CY.purple),
        box('Base deck', [16, 3, 8], [0, 1, -44], CY.dark, CY.panelLight), ramp('Ramp', [4, 3, 6], [0, 1, -37], CY.dark, CY.panel, 0),
        box('Cover', [4, 3, 4], [0, 1, -20], CY.pink), box('Cover', [4, 3, 4], [-4, 1, -8], CY.cyan),
        box('Low wall', [6, 2, 1], [20, 1, -26], CY.panelLight), box('Low wall', [6, 2, 1], [-20, 1, -12], CY.panelLight, CY.panelLight, 90),
        ramp('Jump ramp', [4, 2, 6], [22, 1, -6], CY.lime, CY.lime, 0),
      ),
    ],
    markers: teamMarkers({
      red: [[-18, 1, -51], [-6, 1, -51], [6, 1, -51], [18, 1, -51]],
      shared: [[-20, 1, -40], [20, 1, -34], [0, 1, -28], [-20, 1, -2]],
      weapons: [['sniper_rifle', [0, 4, -45]], ['mac10L', [-20, 1, -24]], ['rpg_laser', [0, 1, 0]], ['spas12', [26, 1, -20]]],
      drops: [[-25, 1, 14]],
      pimp: [0, 1, -52],
    }),
    lights: mirrorLights([[0, 10, -20], LIGHT.cyan], [[-20, 8, -24], LIGHT.pink], [[20, 8, -24], LIGHT.lime]),
  },
  {
    id: 'cy_reactor', name: 'Reactor', icon: '☢', theme: 'Cyber', modes: ALL_MODES,
    description: 'A glowing reactor core on a ramped platform between two huge cooling towers, with raised pipes, coolant pools and control rooms.',
    parts: [
      ground(100, 100, CY.dark, CY.panel),
      ...perimeter(100, 100, 6, CY.panel, CY.panelLight),
      cyl('Reactor platform', 24, 3, [0, 1, 0], CY.gridLime, CY.panel, 24),
      cyl('Reactor core', 8, 10, [0, 4, 0], CY.lime, CY.lime, 24),
      ...mirror(
        cyl('Coolant tank', 3, 5, [5.66, 4, 5.66], CY.panelLight, CY.cyan), cyl('Coolant tank', 3, 5, [-5.66, 4, 5.66], CY.panelLight, CY.cyan),
        ramp('Ramp', [4, 3, 6], [0, 1, 15], CY.dark, CY.panel, 0), ramp('Ramp', [4, 3, 6], [15, 1, 0], CY.dark, CY.panel, 90),
        cyl('Cooling tower', 20, 24, [-30, 1, -20], CY.panelLight, CY.windows, 24),
        box('Pipe', [30, 1.5, 1.5], [-5, 6, -20], CY.panelLight),
        ...[-12, 0, 8].map((x) => box('Pipe support', [1, 5, 1], [x, 1, -20], CY.dark)),
        box('Coolant pool', [12, 0.2, 8], [24, 1, -30], CY.lime),
        box('Control room', [16, 8, 10], [-30, 1, -42], CY.dark, CY.windows),
      ),
    ],
    markers: teamMarkers({
      red: [[-12, 1, -45], [-4, 1, -45], [4, 1, -45], [12, 1, -45]],
      shared: [[-12, 1, -30], [40, 1, -40], [-44, 1, 0], [16, 1, -10]],
      weapons: [['rpg_laser', [0, 4, -9]], ['mac10L', [-12, 1, -40]], ['spas12', [24, 1, -20]]],
      drops: [[-44, 1, -30]],
      pimp: [0, 1, -47],
    }),
    lights: [[[0, 16, 0], LIGHT.lime], ...mirrorLights([[24, 4, -30], LIGHT.lime], [[-30, 28, -20], LIGHT.cyan])],
  },
]
