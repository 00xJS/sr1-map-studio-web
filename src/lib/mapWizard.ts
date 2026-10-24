// New map wizard: builds a fresh, fair map from a few choices (setting,
// layout, players, how busy) and a seed, so "Reroll" gives a different map
// of the same kind. Everything is laid out on red's half (−Z) and turned
// 180° for blue, like the hand-made samples; the usual passes then add
// building detail, themed props, spawns, weapons and lights.
import type { Vec3 } from './project'
import { ALL_MODES, CY, PB, box, cyl, ground, mirror, perimeter, ramp, teamMarkers, type Part, type Sample, type Tex, type Theme } from './sampleKit'
import { U, car } from './urbanKit'
import { ALL_PREFABS } from './prefabRegistry'
import { prefabParams, tagPrefab } from './prefabs'
import { detailize } from './sampleDetail'
import { dress, type DressOptions } from './sampleDress'
import { populate, type PopulateTargets } from './samplePopulate'
import { neighbourhood } from './neighbourhood'

export type WizardSetting = 'downtown' | 'industrial' | 'paintball' | 'cyber' | 'suburbs' | 'docks' | 'construction' | 'military'
export type WizardLayout = 'blocks' | 'plaza' | 'lanes' | 'arena' | 'heights' | 'neighbourhood' | 'crossroads' | 'compounds' | 'maze' | 'scatter'
export type WizardDensity = 'open' | 'normal' | 'packed'

export interface WizardOptions {
  setting: WizardSetting
  layout: WizardLayout
  players: number
  density: WizardDensity
  /** How busy, 0 (open) to 100 (about three times "Packed"); when left out, the density's own level. */
  busy?: number
  seed: number
  name?: string
  /** Neighbourhood: hills along the side walls and a raised plaza (default on). */
  terrain?: boolean
}

export const SETTINGS: Record<WizardSetting, { label: string; icon: string; hint: string }> = {
  downtown: { label: 'Downtown', icon: '🏙️', hint: 'Streets, shops and apartment blocks, parked cars and street clutter.' },
  industrial: { label: 'Industrial', icon: '🏭', hint: 'Warehouses, loading decks, containers, forklifts and pipe racks.' },
  paintball: { label: 'Paintball', icon: '🎯', hint: 'A turf field with shacks, decks and inflatable bunkers.' },
  cyber: { label: 'Cyber', icon: '🟪', hint: 'A glowing grid with neon blocks, platforms and jump pads.' },
  suburbs: { label: 'Suburbs', icon: '🏡', hint: 'Lawns, houses and hedges, picket fences, mailboxes and parked cars.' },
  docks: { label: 'Docks', icon: '⚓', hint: 'A quayside of container stacks, rusty sheds, bollards and buoys.' },
  construction: { label: 'Construction', icon: '🚧', hint: 'A dirt site of concrete shells, scaffolding, pipes, skips and diggers.' },
  military: { label: 'Military', icon: '🪖', hint: 'A sandy base of bunkers, barriers, sandbags, tents and jeeps.' },
}

export const LAYOUTS: Record<WizardLayout, { label: string; hint: string }> = {
  blocks: { label: 'City blocks', hint: 'A grid of blocks with streets between: lots of corners and sight lines.' },
  plaza: { label: 'Big plaza', hint: 'An open middle with a centrepiece, ringed by buildings.' },
  lanes: { label: 'Three lanes', hint: 'Long map, two walls of cover splitting it into three lanes with crossings.' },
  arena: { label: 'Ring arena', hint: 'A broken ring of walls round a raised middle.' },
  heights: { label: 'High ground', hint: 'Raised decks with ramps to fight over.' },
  neighbourhood: { label: 'Neighbourhood', hint: 'Real streets with sidewalks, crossings and street lamps round blocks of buildings, alleys and a park; hills at the edges and a raised plaza if you like.' },
  crossroads: { label: 'Crossroads', hint: 'Two wide streets cross in the middle of the map, with buildings and alleys in each corner.' },
  compounds: { label: 'Compounds', hint: 'Walled yards with a building and two gates each; fight in the streets between, then break in.' },
  maze: { label: 'Maze', hint: 'A grid of walls with gaps at every corner: short sight lines and lots of corners.' },
  scatter: { label: 'Cover field', hint: 'No buildings: an open field of low walls and blocks to duck behind.' },
}

/** The three named levels on the busy scale (0 to 100). */
export const DENSITY: Record<WizardDensity, { label: string; busy: number }> = {
  open: { label: 'Open', busy: 0 },
  normal: { label: 'Normal', busy: 35 },
  packed: { label: 'Packed', busy: 55 },
}

/** Busy scale stops: [busy, share of plots built on, floor area per prop pair, gap between props, most prop pairs]. 100 is about three times Packed. */
const BUSY: [number, number, number, number, number][] = [
  [0, 0.4, 2400, 3, 10],
  [35, 0.55, 1300, 2.5, 22],
  [55, 0.72, 650, 2, 40],
  [100, 1.5, 220, 1.4, 120],
]

export const busyOf = (o: Pick<WizardOptions, 'busy' | 'density'>) => Math.max(0, Math.min(100, o.busy ?? DENSITY[o.density]?.busy ?? 35))

/** A name for a point on the busy scale. */
export const busyLabel = (b: number) => (b < 18 ? 'Open' : b < 45 ? 'Normal' : b < 65 ? 'Packed' : b < 85 ? 'Crowded' : 'Jammed')

/** The named density nearest a point on the busy scale (for the AI and older saved choices). */
export const densityFor = (b: number): WizardDensity => (b < 18 ? 'open' : b < 45 ? 'normal' : 'packed')

/** How full to build and dress the map at this point on the busy scale. */
export function busyness(b: number): { fill: number; dress: DressOptions } {
  const k = Math.max(1, BUSY.findIndex(([at]) => at >= b))
  const [a0, f0, p0, g0, m0] = BUSY[k - 1], [a1, f1, p1, g1, m1] = BUSY[k]
  const t = Math.max(0, Math.min(1, (b - a0) / (a1 - a0)))
  const lerp = (x: number, y: number) => x + (y - x) * t
  return { fill: lerp(f0, f1), dress: { perArea: Math.round(p0 * (p1 / p0) ** t), gap: +lerp(g0, g1).toFixed(2), maxPairs: Math.round(lerp(m0, m1)) } }
}

/** Repeatable random numbers from a seed (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (lo: number, hi: number) => lo + (hi - lo) * next(),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  }
}
export type Rng = ReturnType<typeof rng>

export const newSeed = () => Math.floor(Math.random() * 2 ** 31)

// ---------------- the look of each setting ----------------

export interface Look {
  theme: Theme
  ground: Tex[]
  wall: Tex; wallTop: Tex; wallH: number
  /** Building heights to pick from, on open layouts and in the neighbourhood's blocks. */
  heights: number[]; hoodHeights: number[]
  /** Solid block of the given size (a building, a shack, a neon block). */
  structure(r: Rng, x: number, z: number, w: number, d: number, h: number): Part[]
  deck: { top: Tex; side: Tex }
  /** Small things along streets and open ground, before the dressing pass. */
  extras?(r: Rng, x: number, z: number, rot: number): Part[]
  centre: string[]
  dress: string[]
}

/** A building players can walk into (a room or a two-storey shell), sized to the plot, door toward the middle of the map. */
function walkIn(key: string, x: number, z: number, w: number, d: number, extra: Record<string, string | number> = {}, y = 1): Part[] {
  const def = ALL_PREFABS[key]
  if (!def) return []
  const lim = (k: string, v: number) => { const pd = def.params?.find((q) => q.key === k); return pd ? Math.max(pd.min ?? v, Math.min(pd.max ?? v, v)) : v }
  const params = prefabParams(def, { w: lim('w', Math.round(w)), d: lim('d', Math.round(d)), ...extra })
  // Plots sit on red's half (−Z), so the front (+Z) faces the middle.
  return tagPrefab(def.make(x, z, 0, y, params), key, params, [x, y, z], 0)
}

const FACADES = [PB.brick, PB.oldBrick, PB.plaster, PB.beige, U.apartments, U.office, U.officeGreen, U.shopfront, U.projects]
const NEON = [CY.cyan, CY.pink, CY.lime, CY.purple, CY.orange, CY.matrix]
const CAR_COLORS = ['#a8322b', '#2f5f8f', '#d8d4cc', '#2a2a2e', '#c9a23a', '#3f7a3a', '#7a7f86']

const LOOKS: Record<WizardSetting, Look> = {
  downtown: {
    theme: 'Urban', ground: [U.road], wall: PB.brick, wallTop: PB.concrete, wallH: 12, heights: [10, 14, 18, 24, 30], hoodHeights: [14, 18, 24, 30],
    structure: (r, x, z, w, d, h) => (w >= 14 && d >= 14 && r.chance(0.3)
      ? walkIn(r.pick(['twostory', 'room']), x, z, w, d, { style: r.pick(['brick', 'plaster', 'concrete']) })
      : [box('Building', [w, h, d], [x, 1, z], U.roof, r.pick(FACADES), 0, 6)]),
    deck: { top: PB.concrete, side: PB.darkConcrete },
    extras: (r, x, z, rot) => (r.chance(0.6) ? [car(x, z, rot, r.pick(CAR_COLORS), r.int(1, 99))] : []),
    centre: ['fountain', 'gazebo', 'kiosk'],
    dress: ['busstop', 'foodcart', 'trafficlight', 'hydrant', 'trashcan', 'meters', 'vending', 'bench', 'phone', 'tree', 'bush', 'jersey'],
  },
  industrial: {
    theme: 'Urban', ground: [PB.oldAsphalt, PB.floorWorn], wall: PB.corrugated, wallTop: PB.steel, wallH: 8, heights: [6, 8, 10, 12], hoodHeights: [8, 10, 12],
    structure: (r, x, z, w, d, h) => r.chance(0.35) && h < 12
      ? [box('Container', [w, Math.min(h, 5), d], [x, 1, z], PB.steel, r.pick([PB.boxRed, PB.boxBlue, PB.boxGreen]), 0, 6)]
      : w >= 16 && d >= 16 && r.chance(0.3) ? walkIn('room', x, z, w, d, { style: 'metal', h: 9 })
        : [box('Warehouse', [w, h, d], [x, 1, z], U.roof, r.pick([PB.corrugated, PB.cinder, PB.oldBrick]), 0, 6)],
    deck: { top: PB.diamond, side: PB.steel },
    extras: (r, x, z, rot) => (r.chance(0.3) ? [car(x, z, rot, r.pick(CAR_COLORS), r.int(1, 99))] : []),
    centre: ['containers', 'fueltank', 'scaffold'],
    dress: ['containers', 'forklift', 'piperack', 'pallets', 'barrels', 'generator', 'fueltank', 'jersey', 'cones', 'dumpster'],
  },
  paintball: {
    theme: 'Urban paintball', ground: [PB.turf, PB.dirt], wall: PB.plywood, wallTop: PB.planks, wallH: 4, heights: [4, 5, 6, 8], hoodHeights: [5, 6, 8],
    structure: (r, x, z, w, d, h) => [box('Shack', [w, Math.min(h, 7), d], [x, 1, z], PB.planks, r.pick([PB.plywood, PB.planks, PB.corrugated]), 0, 6)],
    deck: { top: PB.planks, side: PB.plywood },
    centre: ['koth', 'tower', 'bunker'],
    dress: ['snake', 'xbunker', 'maya', 'temple', 'cake', 'dorito', 'can', 'tombstone', 'palletwall', 'spool', 'tirestack', 'hay'],
  },
  cyber: {
    theme: 'Cyber', ground: [CY.gridCyan, CY.gridPink, CY.gridPurple, CY.gridLime, CY.matrix], wall: CY.panel, wallTop: CY.panelLight, wallH: 6, heights: [4, 5, 6, 8], hoodHeights: [5, 6, 8],
    structure: (r, x, z, w, d, h) => [{ ...box('Neon block', [w, Math.min(h, 14), d], [x, 1, z], CY.dark, r.pick(NEON)), big: true }],
    deck: { top: CY.panel, side: CY.purple },
    centre: ['datacore', 'neonpillar', 'holocore'],
    // Jump pads and light gates are left out: dropped at random turns they lead nowhere.
    dress: ['floatplat', 'codepillar', 'neonpillar', 'holowall', 'neoncube', 'terminal', 'hexpillar', 'serverrow'],
  },
  suburbs: {
    theme: 'Urban', ground: [U.grass], wall: U.hedge, wallTop: U.leaves, wallH: 4, heights: [6, 7, 8, 9], hoodHeights: [6, 8, 9],
    structure: (r, x, z, w, d, h) => (w >= 14 && d >= 14 && r.chance(0.35)
      ? walkIn(r.pick(['twostory', 'room']), x, z, w, d, { style: r.pick(['brick', 'plaster']) })
      : [box('House', [w, h, d], [x, 1, z], U.slate, r.pick([PB.plaster, PB.beige, PB.brick, U.apartments]), 0, 6)]),
    deck: { top: PB.wood, side: PB.planks },
    extras: (r, x, z, rot) => (r.chance(0.5) ? [car(x, z, rot, r.pick(CAR_COLORS), r.int(1, 99))] : []),
    centre: ['gazebo', 'fountain', 'playground'],
    dress: ['picketfence', 'mailbox', 'hydrant', 'tree', 'bush', 'trashcan', 'bench', 'bikerack', 'flowers', 'planterbox', 'icecart', 'hedge'],
  },
  docks: {
    theme: 'Urban', ground: [PB.oldAsphalt, PB.concrete, PB.cracked], wall: PB.rusty, wallTop: PB.steel, wallH: 6, heights: [5, 6, 8, 10], hoodHeights: [8, 10, 12],
    structure: (r, x, z, w, d, h) => r.chance(0.5) && h < 12
      ? [box('Container', [w, Math.min(h, 5), d], [x, 1, z], PB.steel, r.pick([PB.boxRed, PB.boxBlue, PB.boxGreen]), 0, 6)]
      : [box('Shed', [w, h, d], [x, 1, z], U.roof, r.pick([PB.rusty, PB.corrugated]), 0, 6)],
    deck: { top: PB.diamond, side: PB.rusty },
    extras: (r, x, z, rot) => (r.chance(0.25) ? [car(x, z, rot, r.pick(CAR_COLORS), r.int(1, 99))] : []),
    centre: ['containerstack', 'reefer', 'containers'],
    dress: ['containers', 'reefer', 'forklift', 'pallets', 'barrels', 'bollards', 'buoys', 'lifering', 'fishnet', 'drumpallets', 'palletjack', 'cones'],
  },
  construction: {
    theme: 'Urban', ground: [PB.dirt, PB.gravel], wall: PB.plywood, wallTop: PB.planks, wallH: 5, heights: [6, 8, 12, 16], hoodHeights: [8, 12, 16],
    structure: (r, x, z, w, d, h) => [box(r.chance(0.5) ? 'Concrete shell' : 'Site building', [w, h, d], [x, 1, z], PB.concrete, r.pick([PB.cinder, PB.cracked, PB.concrete, PB.brick]), 0, 6)],
    deck: { top: PB.planks, side: PB.steel },
    centre: ['scaffoldtower', 'girders', 'excavator'],
    dress: ['concretepipes', 'cementbags', 'brickpallets', 'skip', 'dirtpile', 'barricade', 'trafficbarrels', 'wheelbarrow', 'rebar', 'girders', 'sitecabin', 'cones'],
  },
  military: {
    theme: 'Urban', ground: [PB.sand, PB.dirt], wall: PB.darkConcrete, wallTop: PB.concrete, wallH: 5, heights: [4, 5, 6, 8], hoodHeights: [5, 6, 8],
    structure: (r, x, z, w, d, h) => (w >= 14 && d >= 14 && r.chance(0.3)
      ? walkIn('room', x, z, w, d, { style: 'concrete' })
      : [box('Bunker', [w, Math.min(h, 6), d], [x, 1, z], PB.darkConcrete, r.pick([PB.concrete, PB.cinder, PB.darkConcrete]), 0, 6)]),
    deck: { top: PB.planks, side: PB.darkConcrete },
    centre: ['radar', 'checkpoint', 'helipad'],
    dress: ['sandbagwall', 'hesco', 'twall', 'ammocrates', 'camonet', 'armytent', 'jeep', 'dragonteeth', 'hedgehogs', 'wirecoil', 'fieldgun', 'flagpole'],
  },
}

// ---------------- layout on red's half ----------------

interface Rect { x: number; z: number; w: number; d: number }
const DECK = [3, 6] as const

class Half {
  parts: Part[] = []
  weapons: [string, Vec3][] = []
  taken: Rect[] = []
  constructor(readonly W: number, readonly D: number, readonly strip: number, readonly look: Look, readonly r: Rng) {}

  /** Inside red's half, clear of the spawn strip and the middle, and `gap` away from everything placed. */
  fits(q: Rect, gap = 4) {
    const { W, D, strip } = this
    if (Math.abs(q.x) + q.w / 2 > W / 2 - 3 || q.z - q.d / 2 < -D / 2 + strip || q.z + q.d / 2 > -2) return false
    return this.taken.every((t) => Math.abs(t.x - q.x) * 2 >= t.w + q.w + 2 * gap || Math.abs(t.z - q.z) * 2 >= t.d + q.d + 2 * gap)
  }

  take(q: Rect) { this.taken.push(q) }

  structure(q: Rect, h: number) {
    if (!this.fits(q)) return false
    this.parts.push(...this.look.structure(this.r, q.x, q.z, q.w, q.d, h))
    this.take(q)
    return true
  }

  /** A raised deck with a ramp up one side; a weapon waits on top. */
  deck(q: Rect, h: number, weapon: string) {
    const run = Math.round(h * 2.6)
    const sides = [[0, 1, 0], [0, -1, 180], [1, 0, 90], [-1, 0, 270]] as const
    for (const [sx, sz, rot] of this.r.chance(0.5) ? sides : [...sides].reverse()) {
      const rw = 4
      const along = sz !== 0
      const ramp_: Rect = along
        ? { x: q.x, z: q.z + sz * (q.d / 2 + run / 2), w: rw, d: run }
        : { x: q.x + sx * (q.w / 2 + run / 2), z: q.z, w: run, d: rw }
      // Room for the deck, its ramp, and a landing at the ramp's foot.
      const foot: Rect = along ? { ...ramp_, z: ramp_.z + sz * (run / 2 + 2), d: 4 } : { ...ramp_, x: ramp_.x + sx * (run / 2 + 2), w: 4 }
      if (!this.fits(q) || !this.fits(ramp_, 2) || !this.fits(foot, 0)) continue
      const { top, side } = this.look.deck
      this.parts.push(box('Platform', [q.w, h, q.d], [q.x, 1, q.z], top, side))
      this.parts.push(ramp('Ramp', [rw, h, run], [ramp_.x, 1, ramp_.z], top, side, rot))
      this.take(q); this.take(ramp_); this.take(foot)
      this.weapons.push([weapon, [q.x, 1 + h, q.z]])
      return true
    }
    return false
  }
}

const WEAPONS_HIGH = ['sniper_rifle', 'rpg_launcher']
const CYBER_HIGH = ['sniper_rifle', 'rpg_laser']

function lay(h: Half, o: WizardOptions) {
  const { W, D, r } = h
  const fill = busyness(busyOf(o)).fill
  const high = o.setting === 'cyber' ? CYBER_HIGH : WEAPONS_HIGH
  const height = () => r.pick(h.look.heights)
  const centreClear = Math.min(W, D) * (o.layout === 'plaza' ? 0.22 : 0.1)
  h.take({ x: 0, z: 0, w: centreClear * 2, d: centreClear * 2 })

  if (o.layout === 'blocks') {
    // A grid fitted to red's half between the spawn strip and the middle; streets run between the cells.
    const C = o.setting === 'downtown' ? 38 : 30
    const cols = Math.max(2, Math.round((W - 6) / C)), rows = Math.max(1, Math.round((D / 2 - h.strip - 2) / C))
    const cw = (W - 6) / cols, cd = (D / 2 - h.strip - 2) / rows
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = -W / 2 + 3 + (i + 0.5) * cw, z = -2 - (j + 0.5) * cd
      if (!r.chance(fill + 0.2)) continue
      const w = Math.round(r.range(0.55, 0.72) * cw), d = Math.round(r.range(0.55, 0.72) * cd)
      if (r.chance(0.18)) { h.deck({ x, z, w: Math.min(w, 14), d: Math.min(d, 14) }, r.pick(DECK), r.pick(high)); continue }
      // Bigger cells sometimes hold two buildings with an alley between.
      if (w > 22 && r.chance(0.4)) {
        const half = Math.round((w - 5) / 2)
        h.structure({ x: x - (half + 5) / 2, z, w: half, d }, height())
        h.structure({ x: x + (half + 5) / 2, z, w: half, d }, height())
      } else h.structure({ x: x + r.range(-2, 2), z: z + r.range(-2, 2), w, d }, height())
    }
  } else if (o.layout === 'plaza') {
    const R = Math.min(W, D) * 0.34
    const count = Math.round(3 + fill * 5)
    for (let k = 0; k < count; k++) {
      const a = Math.PI + (Math.PI * (k + 0.5)) / count + r.range(-0.12, 0.12)
      const w = r.int(14, 26), d = r.int(12, 20)
      const q = { x: Math.cos(a) * R, z: Math.sin(a) * R, w, d }
      if (r.chance(0.25)) h.deck({ ...q, w: 12, d: 12 }, r.pick(DECK), r.pick(high)); else h.structure(q, height())
    }
  } else if (o.layout === 'lanes') {
    for (const sx of [-1, 1]) {
      let z = -D / 2 + h.strip + 6
      while (z < -8) {
        const len = r.int(16, 28)
        const q = { x: sx * W / 6, z: Math.min(z + len / 2, -4 - len / 2), w: r.int(8, 12), d: len }
        if (r.chance(fill + 0.25)) h.structure(q, height())
        z += len + r.int(8, 12)
      }
    }
    // Side lanes get a deck now and then.
    for (const sx of [-1, 1]) if (r.chance(0.7)) h.deck({ x: sx * W * 0.36, z: -D * r.range(0.15, 0.3), w: 10, d: 10 }, r.pick(DECK), r.pick(high))
  } else if (o.layout === 'arena') {
    // A ring of wall segments turned along the circle, every other one sometimes left out as a doorway.
    const R = Math.min(W, D) * 0.27
    const segs = 7
    const len = 2 * R * Math.sin(Math.PI / (2 * segs)) * 1.5
    for (let k = 0; k < segs; k++) {
      if (k % 2 === 1 && !r.chance(fill)) continue
      const a = Math.PI + (Math.PI * (k + 0.5)) / segs
      const x = Math.cos(a) * R, z = Math.sin(a) * R
      const rot = -((a * 180) / Math.PI) - 90
      // Its footprint, square to the axes, for spacing.
      const c = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a))
      const q = { x, z, w: len * sn + 3 * c, d: len * c + 3 * sn }
      if (!h.fits(q, 2)) continue
      const wall = h.look.structure(r, 0, 0, len, 3, o.setting === 'downtown' ? 6 : 4)[0]
      h.parts.push({ ...wall, label: o.setting === 'cyber' ? 'Neon block' : 'Ring wall', at: [x, 1, z], rot })
      h.take(q)
    }
  } else if (o.layout === 'crossroads') {
    // Two wide streets crossing in the middle of the map; a block in each corner (two per side), split by alleys.
    const S = 8
    h.take({ x: 0, z: -D / 4, w: 2 * S, d: D / 2 })
    h.take({ x: 0, z: 0, w: W, d: 2 * S })
    for (const sx of [-1, 1]) {
      const x0 = sx < 0 ? -W / 2 + 6 : S + 4, x1 = sx < 0 ? -S - 4 : W / 2 - 6
      const z0 = -D / 2 + h.strip + 4, z1 = -S - 4
      // Up to three buildings across each corner, more when busier.
      const n = Math.max(1, Math.min(3, Math.round(((x1 - x0) / 22) * Math.min(1.2, fill + 0.3))))
      const cw = (x1 - x0 - (n - 1) * 5) / n
      for (let k = 0; k < n; k++) {
        const q = { x: x0 + cw / 2 + k * (cw + 5), z: (z0 + z1) / 2, w: Math.round(cw), d: Math.round((z1 - z0) * r.range(0.55, 0.75)) }
        if (q.w < 6 || q.d < 6) continue
        if (r.chance(0.15)) h.deck({ ...q, w: Math.min(q.w, 12), d: Math.min(q.d, 12) }, r.pick(DECK), r.pick(high)); else h.structure(q, height())
      }
    }
  } else if (o.layout === 'compounds') {
    // Walled yards (low enough to climb) with a gate front and back, a building and room to fight inside.
    const n = W >= 150 ? 3 : 2
    const yw = Math.min(44, (W - 12) / n - 10), yd = Math.min(40, D / 2 - h.strip - 16)
    for (let k = 0; k < n; k++) {
      const cx = -W / 2 + 6 + (W - 12) * (k + 0.5) / n, cz = -D / 4 - 2 + r.range(-3, 3)
      const wallH = 4, t = 1, gate = 7
      const walls: Rect[] = [
        { x: cx - yw / 2, z: cz, w: t, d: yd }, { x: cx + yw / 2, z: cz, w: t, d: yd },
        ...[-1, 1].flatMap((sz) => [{ x: cx - (yw + gate) / 4, z: cz + sz * yd / 2, w: (yw - gate) / 2, d: t }, { x: cx + (yw + gate) / 4, z: cz + sz * yd / 2, w: (yw - gate) / 2, d: t }]),
      ]
      if (!walls.every((q) => h.fits(q, 0))) continue
      for (const q of walls) { h.parts.push(box('Yard wall', [q.w, wallH, q.d], [q.x, 1, q.z], h.look.wallTop, h.look.wall)); h.take(q) }
      // Inside: a building on one side, and a deck or a second building on the other when it's busy.
      const side = r.pick([-1, 1])
      h.structure({ x: cx + side * yw / 4.5, z: cz, w: Math.round(yw * 0.34), d: Math.round(yd * 0.5) }, height())
      if (r.chance(Math.min(0.9, fill))) h.deck({ x: cx - side * yw / 4, z: cz, w: 10, d: 10 }, r.pick(DECK), r.pick(high))
    }
  } else if (o.layout === 'maze') {
    // Walls along a grid, each shorter than its cell so every corner is open: no dead pockets, nothing sealed off.
    const C = 16, t = 1.2, wallH = Math.max(5, Math.min(8, h.look.wallH))
    const x0 = -W / 2 + 4, z0 = -D / 2 + h.strip + 4
    const cols = Math.floor((W - 8) / C), rows = Math.floor((-4 - z0) / C)
    const ox = x0 + (W - 8 - cols * C) / 2
    const odds = 0.3 + 0.35 * Math.min(1, fill)
    for (let i = 0; i <= cols; i++) for (let j = 0; j <= rows; j++) {
      const px = ox + i * C, pz = z0 + j * C
      const runs: Rect[] = []
      if (i < cols && r.chance(odds)) runs.push({ x: px + C / 2, z: pz, w: C - 5, d: t })
      if (j < rows && r.chance(odds)) runs.push({ x: px, z: pz + C / 2, w: t, d: C - 5 })
      for (const q of runs) if (h.fits(q, 0.5)) { h.parts.push(box('Maze wall', [q.w, wallH, q.d], [q.x, 1, q.z], h.look.wallTop, h.look.wall)); h.take(q) }
    }
  } else if (o.layout === 'scatter') {
    // Low walls and blocks, waist to chest high, turned across or along the map.
    const count = Math.round((W * D) / 2 / 260 * Math.min(1.6, fill))
    const { top, side } = h.look.deck
    for (let k = 0, placed = 0; k < count * 6 && placed < count; k++) {
      const along = r.chance(0.5), len = r.int(3, 9), thick = r.pick([1, 1.5, 2])
      const q = { x: r.range(-W / 2 + 6, W / 2 - 6), z: r.range(-D / 2 + h.strip + 4, -5), w: along ? thick : len, d: along ? len : thick }
      if (!h.fits(q, 3)) continue
      h.parts.push(box('Cover', [q.w, r.pick([2, 2.6, 3.2]), q.d], [q.x, 1, q.z], top, r.chance(0.5) ? side : h.look.wall))
      h.take(q)
      placed++
    }
  }
  // Every layout: raised decks and blocks in whatever room is left.
  const decks = o.layout === 'heights' ? 5 : o.layout === 'maze' ? 1 : 2
  for (let k = 0, placed = 0; k < 40 && placed < decks; k++) {
    const s = r.int(10, 16)
    if (h.deck({ x: r.range(-W / 2 + 12, W / 2 - 12), z: r.range(-D / 2 + h.strip + 10, -10), w: s, d: s }, o.layout === 'heights' ? r.pick([3, 6, 6]) : r.pick(DECK), r.pick(high))) placed++
  }
  // Open ground stays open on the maze and the cover field.
  const extra = o.layout === 'maze' || o.layout === 'scatter' ? 0 : Math.round(fill * (o.layout === 'heights' ? 4 : 6))
  for (let k = 0, placed = 0; k < 60 && placed < extra; k++) {
    const q = { x: r.range(-W / 2 + 10, W / 2 - 10), z: r.range(-D / 2 + h.strip + 8, -8), w: r.int(8, 18), d: r.int(8, 18) }
    if (h.structure(q, o.layout === 'heights' ? r.pick([4, 5]) : height())) placed++
  }
  // Parked cars and the like in the gaps.
  if (h.look.extras && o.layout !== 'maze') for (let k = 0, placed = 0; k < 80 && placed < 3 + Math.round(fill * 6); k++) {
    const rot = r.pick([0, 90])
    const q = { x: r.range(-W / 2 + 8, W / 2 - 8), z: r.range(-D / 2 + h.strip + 4, -6), w: rot ? 9 : 4, d: rot ? 4 : 9 }
    if (!h.fits(q, 2)) continue
    const ps = h.look.extras(r, q.x, q.z, rot + r.pick([0, 180]))
    if (ps.length) { h.parts.push(...ps); h.take(q); placed++ }
  }
}

/** A point-symmetric centrepiece: a raised middle with two ramps, or a themed prefab. */
function centre(o: WizardOptions, look: Look, r: Rng): { parts: Part[]; weapon?: [string, Vec3] } {
  if (o.layout === 'arena' || o.layout === 'heights') {
    const hgt = o.layout === 'arena' ? 4 : 6, s = 12, run = Math.round(hgt * 2.6)
    return {
      parts: [box('Platform', [s, hgt, s], [0, 1, 0], look.deck.top, look.deck.side), ...mirror(ramp('Ramp', [4, hgt, run], [0, 1, -(s / 2 + run / 2)], look.deck.top, look.deck.side, 180))],
      weapon: [o.setting === 'cyber' ? 'rpg_laser' : 'rpg_launcher', [0, 1 + hgt, 0]],
    }
  }
  const key = look.centre.find((k) => ALL_PREFABS[k] && r.chance(0.7)) ?? look.centre.find((k) => ALL_PREFABS[k])
  if (!key) return { parts: [] }
  const def = ALL_PREFABS[key], params = prefabParams(def)
  return { parts: tagPrefab(def.make(0, 0, 0, 1, params), key, params, [0, 1, 0], 0) }
}

/** Width and depth (editor units) for this many players at about retail spacing. */
export function wizardSize(players: number, layout: WizardLayout): [number, number] {
  // 450 m² of floor per player (1 unit = 0.5 m); full 12-player maps get retail-like room to spare.
  const side = 2 * Math.sqrt(players * 450) * (players >= 12 ? 1.25 : 1)
  const r8 = (v: number) => Math.max(64, Math.round(v / 8) * 8)
  return layout === 'lanes' ? [r8(side / 1.2), r8(side * 1.2)] : [r8(side), r8(side)]
}

/** The map before detail, props and markers are added (exported for tests). */
export function wizardLayout(o: WizardOptions): Sample {
  const r = rng(o.seed)
  const look = LOOKS[o.setting]
  const [W, D] = wizardSize(o.players, o.layout)
  const strip = 14
  if (o.layout === 'neighbourhood') return neighbourhoodSample(o, look, r, W, D, strip)
  const h = new Half(W, D, strip, look, r)
  lay(h, o)
  const mid = centre(o, look, r)
  const gTex = r.pick(look.ground)
  // Red's spawn strip: four spots across the end of the map.
  const sz = -D / 2 + strip / 2
  const red: Vec3[] = [-0.3, -0.1, 0.1, 0.3].map((f) => [Math.round(f * W), 1, sz])
  const weapons = [...h.weapons, ...(mid.weapon ? [mid.weapon] : [])]
  const name = o.name?.trim() || `${SETTINGS[o.setting].label} ${LAYOUTS[o.layout].label}`
  return {
    id: `wiz_${o.setting}_${o.layout}`,
    name, icon: SETTINGS[o.setting].icon, theme: look.theme, modes: ALL_MODES, size: 'full',
    description: `${LAYOUTS[o.layout].label} in a ${SETTINGS[o.setting].label.toLowerCase()} setting for about ${o.players} players (seed ${o.seed}).`,
    parts: [
      ground(W, D, gTex, PB.concrete, 8),
      ...perimeter(W, D, look.wallH, look.wall, look.wallTop),
      ...mid.parts,
      ...mirror(...h.parts),
      // Low kerbs mark each team's spawn strip.
      ...mirror(box('Kerb', [W - 8, 0.3, 1], [0, 1, -D / 2 + strip], PB.concrete)),
      ...(o.setting === 'cyber' ? mirror(cyl('Neon pillar', 2, 8, [-W / 2 + 4, 1, -D / 2 + 4], CY.dark, r.pick(NEON), 6)) : []),
    ],
    markers: teamMarkers({ red, shared: [], weapons, drops: [], pimp: [0, 1, sz] }),
    dressWith: look.dress.filter((k) => ALL_PREFABS[k]),
  }
}

/** Streets, blocks, a park and hills (see neighbourhood.ts), with spawns at each end. */
function neighbourhoodSample(o: WizardOptions, look: Look, r: Rng, W: number, D: number, strip: number): Sample {
  const height = () => r.pick(look.hoodHeights)
  const hood = neighbourhood({ o, look, r, W, D, strip, height, walkIn, high: o.setting === 'cyber' ? CYBER_HIGH : WEAPONS_HIGH })
  const sz = -D / 2 + strip / 2
  const red: Vec3[] = [-0.3, -0.1, 0.1, 0.3].map((f) => [Math.round(f * W), 1, sz])
  const name = o.name?.trim() || `${SETTINGS[o.setting].label} ${LAYOUTS[o.layout].label}`
  return {
    id: `wiz_${o.setting}_${o.layout}`,
    name, icon: SETTINGS[o.setting].icon, theme: look.theme, modes: ALL_MODES, size: 'full',
    description: `${LAYOUTS[o.layout].label} in a ${SETTINGS[o.setting].label.toLowerCase()} setting for about ${o.players} players (seed ${o.seed}).`,
    parts: [
      ground(W, D, o.setting === 'cyber' ? r.pick(look.ground) : PB.concrete, PB.concrete, 8),
      ...perimeter(W, D, hood.wallH, look.wall, look.wallTop),
      ...hood.centre,
      ...mirror(...hood.half),
    ],
    markers: teamMarkers({ red, shared: [], weapons: hood.weapons, drops: [], pimp: [0, 1, sz] }),
    lights: hood.lights,
    dressWith: look.dress.filter((k) => ALL_PREFABS[k]),
  }
}

/** The finished map: layout, then building detail, themed props, spawns, weapons and lights. */
export function wizardSample(o: WizardOptions): Sample {
  const p = Math.max(2, Math.min(12, o.players))
  const targets: PopulateTargets = {
    perTeam: Math.max(4, Math.min(10, Math.round(p / 2) + 2)),
    shared: Math.max(10, Math.min(24, p + 8)),
    weapons: Math.max(12, Math.min(26, p + 10)),
    drops: 4,
    lights: o.setting === 'cyber' ? 28 : 22,
  }
  return populate(dress(detailize(wizardLayout(o)), busyness(busyOf(o)).dress), targets)
}
