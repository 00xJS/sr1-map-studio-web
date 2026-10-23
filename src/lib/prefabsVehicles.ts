// Vehicle prefabs: cars of every shape, service and work trucks, semis and
// their trailers, two-wheelers, carts, aircraft, boats and rail cars. All are
// parked props built like the street car: the front is +Z, the body sits on
// round wheels standing on the ground, and paint is a setting where it makes
// sense. Shapes only turn about the vertical, so frames and tubes are made of
// level and upright pieces.
import { CY, PB, box, cyl, lying, ramp, type Part, type Tex } from './sampleKit'
import { CAR_COLORS, carPaint, group, local, wheels, type ParamDef, type Params, type PrefabDef } from './prefabs'

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

const sel = (key: string, label: string, options: [string, string][], def: string): ParamDef => ({ key, label, kind: 'select', options, default: def })
const yesNo = (key: string, label: string, def: 'yes' | 'no'): ParamDef => sel(key, label, [['yes', 'Yes'], ['no', 'No']], def)
const paintParam = (def: string, options: [string, string][] = CAR_COLORS) => sel('color', 'Paint', options, def)

// ---------------- materials ----------------

// Same settings as the street car's, so they share one texture each.
const GLASS: Tex = { gen: 'tiles', tweak: { color: '#25313b', accent: '#1a2229', scale: 1, wear: 0, seed: 330 }, surface: 9 }
const HEADLIGHT: Tex = { gen: 'tiles', tweak: { color: '#f4f1e2', accent: '#c9c4ad', scale: 1, wear: 0, seed: 333 }, surface: 9 }
const TAILLIGHT: Tex = { gen: 'tiles', tweak: { color: '#c4161c', accent: '#7a0c10', scale: 1, wear: 0, seed: 334 }, surface: 9 }
const TRIM: Tex = { gen: 'metal_plate', tweak: { color: '#1d1d20', accent: '#1d1d20', scale: 2, wear: 0.1, seed: 335 }, surface: 15 }
const CHROME: Tex = { gen: 'metal_plate', tweak: { color: '#b9bcc0', accent: '#8d9094', scale: 1, wear: 0, seed: 336 }, surface: 15 }

const solid = (color: string, accent: string, seed: number, surface = 17): Tex => ({ gen: 'tiles', tweak: { color, accent, scale: 1, wear: 0.06, seed }, surface })
const glow = (color: string, accent: string, seed: number): Tex => ({ gen: 'tiles', tweak: { color, accent, scale: 1, wear: 0, seed }, surface: 17 })
const LIGHT_RED = glow('#e02020', '#801010', 701)
const LIGHT_BLUE = glow('#2050ff', '#102080', 702)
const LIGHT_AMBER = glow('#ffa020', '#a05a10', 703)
const SEAT: Tex = { gen: 'tiles', tweak: { color: '#2a2420', accent: '#1e1a17', scale: 4, wear: 0.15, seed: 704 }, surface: 17 }
const TAN_SEAT: Tex = { gen: 'tiles', tweak: { color: '#c8b08a', accent: '#a8906a', scale: 4, wear: 0.1, seed: 705 }, surface: 17 }
const SOFT_TOP: Tex = { gen: 'tiles', tweak: { color: '#1e1e22', accent: '#141416', scale: 6, wear: 0.1, seed: 706 }, surface: 17 }
const WHITE = carPaint('#e8e8e8', 347)
const BLACK = carPaint('#202020', 344)
const YELLOW = carPaint('#e0b020', 346)
const RED = carPaint('#b8322a', 341)
const STRIPE_WHITE = solid('#f2f2f0', '#dcdcd8', 707)
const STRIPE_BLACK = solid('#1d1d20', '#141416', 708, 15)
const CHAR: Tex = { gen: 'metal_plate', tweak: { color: '#2e2926', accent: '#7a3e1e', scale: 2, wear: 0.9, seed: 709 }, surface: 15 }
const SOOT: Tex = { gen: 'concrete', tweak: { color: '#1e1c1b', accent: '#0e0d0c', wear: 0.6, seed: 710 } }
const TRAILER: Tex = { gen: 'metal_plate', tweak: { color: '#e4e4e0', accent: '#9a9a96', scale: 8, wear: 0.15, seed: 711 }, surface: 15 }
const SHUTTER: Tex = { gen: 'garage_door', tweak: { color: '#b4b8bc', accent: '#6a6e72', scale: 1, wear: 0.1, seed: 712 }, surface: 15 }
const SILVER: Tex = { gen: 'metal_plate', tweak: { color: '#a8adb2', accent: '#7a7f84', scale: 10, wear: 0.1, seed: 713 }, surface: 15 }
const WIRE: Tex = { gen: 'tiles', tweak: { color: '#3a3c40', accent: '#c8cacc', scale: 10, wear: 0, seed: 714 }, surface: 15 }
const WOOD_HULL: Tex = { gen: 'wood_planks', tweak: { color: '#8a5a32', accent: '#5a3a1e', scale: 6, wear: 0.3, seed: 715 }, surface: 21 }
const DIRT_LOAD: Tex = { gen: 'dirt', tweak: { color: '#5a4430', accent: '#3a2a1c', wear: 0.5, seed: 716 } }
const SCOOP: Tex = solid('#f0a0c8', '#d080a8', 717)
const CONE: Tex = { gen: 'wood_planks', tweak: { color: '#c89850', accent: '#9a7034', scale: 8, seed: 718 } }
const CINDER: Tex = PB.cinder
const RAIL_PAINT: Record<string, Tex> = { red: PB.boxRed, blue: PB.boxBlue, green: PB.boxGreen, rust: PB.rusty }
const railParam = (def: string) => sel('color', 'Paint', [['red', 'Rust red'], ['blue', 'Blue'], ['green', 'Green'], ['rust', 'Rusty']], def)

/** Paint by color: the street car's palette shares its textures; other colors get their own. */
const paint = (c: string): Tex => { const i = CAR_COLORS.findIndex(([k]) => k === c); return carPaint(c, i >= 0 ? 341 + i : 720 + (parseInt(c.slice(1), 16) % 61)) }
const paintOf = (p: Params) => paint(String(p.color))

const CANDY: [string, string][] = [['#9a0f2a', 'Candy red'], ['#5a1a7a', 'Candy purple'], ['#127a7a', 'Teal'], ['#b8902a', 'Gold'], ['#1a2a6a', 'Midnight blue'], ['#e8dcb0', 'Cream']]

// ---------------- building blocks ----------------

interface Auto {
  len: number; w?: number; ride?: number; bodyH?: number
  /** Cabin (glass with a painted roof) from c0 (rear) to c1 (front) along the car; no cabin when cabH is 0. */
  cab?: [number, number]; cabH?: number
  wheel?: number; tire?: number; axles?: number[]
  bumper?: Tex; glass?: Tex; noWheels?: boolean
}

/** A car-like body: rounded body, glass cabin and roof, bumpers, lights, mirrors and wheels. Front is +Z. */
function auto(L: Lf, body: Tex, o: Auto): Part[] {
  const w = o.w ?? 4, ride = o.ride ?? 0.5, bh = o.bodyH ?? 1.35, f = o.len / 2, top = ride + bh
  const [c0, c1] = o.cab ?? [-f + 1.6, f - 2.4], ch = o.cabH ?? 1.15, bump = o.bumper ?? TRIM, glass = o.glass ?? GLASS
  const out: Part[] = [{ ...box('Body', [w, bh, o.len], L(0, ride, 0), body, body), bevel: Math.min(0.4, bh / 2 - 0.05) }]
  if (ch > 0) out.push(
    { ...box('Cabin', [w - 0.5, ch, c1 - c0], L(0, top, (c0 + c1) / 2), glass, glass), bevel: Math.min(0.45, ch / 2 - 0.05) },
    { ...box('Roof', [w - 0.7, 0.18, c1 - c0 - 0.6], L(0, top + ch, (c0 + c1) / 2), body, body), bevel: 0.08 },
    ...[-1, 1].map((sx) => ({ ...box('Mirror', [0.35, 0.25, 0.2], L(sx * (w / 2 + 0.1), top + 0.05, c1 - 0.6), body, body), bevel: 0.05 })),
  )
  out.push(
    ...[-1, 1].map((k) => ({ ...box('Bumper', [w + 0.1, 0.45, 0.35], L(0, Math.max(0, ride - 0.05), k * (f - 0.05)), bump, bump), bevel: 0.12 })),
    box('Grille', [w * 0.45, 0.45, 0.06], L(0, ride + 0.45, f + 0.02), TRIM),
    ...[-1, 1].flatMap((sx) => [box('Headlight', [0.8, 0.35, 0.06], L(sx * (w / 2 - 0.55), ride + 0.6, f + 0.02), HEADLIGHT), box('Tail light', [0.7, 0.35, 0.06], L(sx * (w / 2 - 0.55), ride + 0.65, -f - 0.02), TAILLIGHT)]),
  )
  if (!o.noWheels) out.push(...wheels(L, w - 0.4, o.axles ?? [f - 1.4, -f + 1.4], o.wheel ?? 1.3, o.tire ?? 0.55))
  return out
}

/** A van body: a tall box with a short nose and a sloped windshield. Front is +Z. */
function van(L: Lf, body: Tex, len = 10, w = 4.6, h = 4.4, ride = 0.8, wheel = 1.6): Part[] {
  const f = len / 2, nose = 2.2
  return [
    { ...box('Van body', [w, h, len - nose], L(0, ride, -nose / 2), body, body), bevel: 0.35 },
    { ...box('Van nose', [w, h * 0.42, nose], L(0, ride, f - nose / 2), body, body), bevel: 0.3 },
    ramp('Windshield', [w - 0.3, h * 0.5, 1.6], L(0, ride + h * 0.42, f - nose + 0.8), GLASS, GLASS),
    box('Side windows', [w + 0.06, h * 0.3, 1.8], L(0, ride + h * 0.55, f - nose - 1.1), GLASS),
    ...[-1, 1].map((k) => ({ ...box('Bumper', [w + 0.1, 0.5, 0.35], L(0, ride - 0.1, k * (f - 0.05)), TRIM, TRIM), bevel: 0.12 })),
    ...[-1, 1].flatMap((sx) => [box('Headlight', [0.8, 0.4, 0.06], L(sx * (w / 2 - 0.6), ride + 0.7, f + 0.02), HEADLIGHT), box('Tail light', [0.5, 0.9, 0.06], L(sx * (w / 2 - 0.4), ride + 0.9, -f - 0.02), TAILLIGHT)]),
    ...wheels(L, w - 0.4, [f - 1.7, -f + 1.8], wheel, 0.6),
  ]
}

/** A light bar on a roof at height y. */
const lightBar = (L: Lf, y: number, z: number, w = 2.8, a: Tex = LIGHT_RED, b: Tex = LIGHT_BLUE): Part[] => [
  box('Light bar', [w, 0.2, 0.6], L(0, y, z), TRIM),
  { ...box('Beacon', [w / 2 - 0.1, 0.35, 0.5], L(-w / 4, y + 0.2, z), a, a), bevel: 0.1 },
  { ...box('Beacon', [w / 2 - 0.1, 0.35, 0.5], L(w / 4, y + 0.2, z), b, b), bevel: 0.1 },
]

/** A pointed bow: a three-sided prism `w` wide at its back edge (at z), with its tip toward +Z. */
const bow = (L: Lf, label: string, w: number, h: number, z: number, top: Tex, side: Tex, y = 0): Part =>
  cyl(label, (2 * w) / Math.sqrt(3), h, L(0, y, z + w / (2 * Math.sqrt(3))), top, side, 3, 270)

/** A single wheel turning about X (bikes, carts), with a rim. */
const wheel1 = (L: Lf, x: number, z: number, d: number, w: number, rim: Tex = CHROME, y = 0): Part[] => [
  lying('Wheel', d, w, L(x, y, z), PB.tire, PB.tire, 14),
  lying('Rim', d * 0.6, w + 0.04, L(x, y + d * 0.2, z), rim, rim, 10),
]

/** A rail bogie: a frame and two axles on a 2.9-unit gauge. */
const bogie = (L: Lf, z: number): Part[] => [box('Bogie', [3.6, 0.7, 4.8], L(0, 0.55, z), TRIM), ...wheels(L, 2.9, [z - 1.6, z + 1.6], 1.5, 0.4)]

/** Cargo for a flat deck at height y, `len` long. */
function cargo(L: Lf, kind: string, y: number, len: number, z = 0): Part[] {
  switch (kind) {
    case 'crates': return [...Array(Math.max(1, Math.floor(len / 4.2)))].flatMap((_, i, a) => {
      const cz = z + (i - (a.length - 1) / 2) * 4.2
      return [{ ...box('Crate', [4.6, 3.2, 3.8], L(0, y, cz), PB.plywood), bevel: 0.08 }, ...(i % 2 ? [] : [{ ...box('Crate', [3.6, 2.6, 3.2], L(0, y + 3.2, cz), PB.plywood), bevel: 0.08 }])]
    })
    case 'pipes': return [-1.5, 0, 1.5, -0.75, 0.75, 0].map((x, i) => lying('Pipe', 1.4, len - 1, L(x, y + (i < 3 ? 0 : i < 5 ? 1.25 : 2.5), z), PB.rusty, PB.steel, 10, 90))
    case 'lumber': return [0, 1, 2].flatMap((k) => [-1.3, 1.3].map((x) => ({ ...box('Lumber', [2.4, 1.1, len - 2], L(x, y + k * 1.15, z), PB.wood, { lib: 'weathered_brown_planks', surface: 21 }) }))).concat([box('Strap', [5.2, 3.5, 0.3], L(0, y, z), TRIM)])
    case 'container': return [box('Container', [5.4, 5.8, Math.min(24, len - 1)], L(0, y, z), PB.boxRed)]
    default: return []
  }
}
const cargoParam = (def: string) => sel('cargo', 'Cargo', [['crates', 'Crates'], ['pipes', 'Pipes'], ['lumber', 'Lumber'], ['container', 'Container'], ['none', 'Empty']], def)

/** A semi tractor whose front bumper is at z 20; the fifth wheel is near z 6. */
function tractor(L: Lf, body: Tex): Part[] {
  return [
    box('Frame', [3.4, 0.7, 15], L(0, 1.2, 12.5), TRIM),
    { ...box('Bumper', [5, 0.9, 0.5], L(0, 0.9, 20), CHROME, CHROME), bevel: 0.15 },
    { ...box('Hood', [4.8, 2.6, 4.4], L(0, 1.9, 17.6), body, body), bevel: 0.5 },
    box('Grille', [2.6, 2.2, 0.1], L(0, 2.0, 19.82), CHROME),
    ...[-1, 1].map((sx) => box('Headlight', [0.8, 0.5, 0.08], L(sx * 1.9, 2.4, 19.82), HEADLIGHT)),
    { ...box('Cab', [5.2, 5.2, 4], L(0, 1.9, 13.4), body, body), bevel: 0.4 },
    box('Windshield', [4.6, 1.8, 0.1], L(0, 4.6, 15.42), GLASS), box('Side windows', [5.26, 1.4, 1.6], L(0, 4.8, 14.2), GLASS),
    { ...box('Sleeper', [5.2, 5.8, 3], L(0, 1.9, 9.9), body, body), bevel: 0.4 },
    ...[-1, 1].flatMap((sx) => [cyl('Exhaust stack', 0.5, 8.6, L(sx * 2.9, 1.6, 11.2), CHROME, CHROME, 8), lying('Fuel tank', 1.5, 3, L(sx * 2.4, 0.8, 13.4), CHROME, CHROME, 12, 90)]),
    box('Fifth wheel', [3, 0.3, 2.4], L(0, 1.9, 6.4), TRIM),
    ...wheels(L, 5, [17.4, 7.6, 5.2], 2.1, 0.8),
  ]
}
const trailerWheels = (L: Lf): Part[] => [box('Trailer chassis', [3.4, 0.5, 6.4], L(0, 1.9, -20.8), TRIM), ...wheels(L, 5, [-19.6, -22], 2.1, 0.8), ...[-1, 1].map((sx) => box('Landing leg', [0.3, 2.4, 0.3], L(sx * 2, 0, 2), PB.steel))]

// ---------------- prefabs ----------------

const CARS: Record<string, PrefabDef & { category: string }> = {
  sedan: { category: 'Vehicles', label: 'Sedan', hint: 'A four-door family car', ...pfp('Sedan', [paintParam('#2a5ab8')], (L, p) => auto(L, paintOf(p), { len: 9, cab: [-2.6, 1.4] })) },
  hatchback: { category: 'Vehicles', label: 'Hatchback', hint: 'A short city car with a hatch at the back', ...pfp('Hatchback', [paintParam('#2f8a3a')], (L, p) => [
    ...auto(L, paintOf(p), { len: 7.4, cab: [-3.3, 0.9], cabH: 1.25 }),
    box('Rear wiper', [0.8, 0.08, 0.08], L(0, 2.3, -3.42), TRIM),
  ]) },
  coupe: { category: 'Vehicles', label: 'Coupe', hint: 'A two-door car with a long hood and a short, low cabin', ...pfp('Coupe', [paintParam('#d0d0d0')], (L, p) => [
    ...auto(L, paintOf(p), { len: 8.6, bodyH: 1.2, cab: [-2.6, 0.6], cabH: 1.0 }),
    { ...box('Lip spoiler', [3.4, 0.15, 0.5], L(0, 1.7, -4.0), paintOf(p), paintOf(p)), bevel: 0.05 },
  ]) },
  sportscar: { category: 'Vehicles', label: 'Sports car', hint: 'A low, wide supercar with side intakes and a rear wing', ...pfp('Sports car', [paintParam('#e0b020')], (L, p) => {
    const c = paintOf(p)
    return [
      ...auto(L, c, { len: 8.8, w: 4.3, ride: 0.35, bodyH: 1.05, cab: [-1.9, 0.6], cabH: 0.85, wheel: 1.35, tire: 0.65, axles: [2.9, -2.9] }),
      ...[-1, 1].map((sx) => box('Side intake', [0.08, 0.5, 1.4], L(sx * 2.17, 0.6, -1.4), TRIM)),
      ...[-1, 1].map((sx) => box('Wing strut', [0.2, 0.6, 0.3], L(sx * 1.3, 1.4, -3.9), TRIM)),
      { ...box('Rear wing', [4, 0.15, 0.9], L(0, 2.0, -3.9), c, c), bevel: 0.05 },
      box('Hood vent', [1.6, 0.05, 1.2], L(0, 1.4, 2.6), TRIM),
    ]
  }) },
  musclecar: { category: 'Vehicles', label: 'Muscle car', hint: 'A long-hooded muscle car with a hood scoop and racing stripes', ...pfp('Muscle car', [paintParam('#b8322a'), yesNo('stripes', 'Racing stripes', 'yes')], (L, p) => {
    const c = paintOf(p), st = p.color === '#e8e8e8' || p.color === '#d0d0d0' || p.color === '#e0b020' ? STRIPE_BLACK : STRIPE_WHITE
    const top = 0.5 + 1.4, roof = top + 1.0 + 0.18
    return [
      ...auto(L, c, { len: 9.6, w: 4.2, bodyH: 1.4, cab: [-2.8, 0.2], cabH: 1.0, wheel: 1.45, tire: 0.65 }),
      { ...box('Hood scoop', [1.4, 0.4, 1.6], L(0, top, 2.6), c, TRIM), bevel: 0.12 },
      ...(p.stripes === 'yes' ? [-0.45, 0.45].flatMap((x) => [box('Stripe', [0.45, 0.03, 4.0], L(x, top, 2.6), st, st), box('Stripe', [0.45, 0.03, 1.4], L(x, roof, -1.3), st, st), box('Stripe', [0.45, 0.03, 1.6], L(x, top, -3.8), st, st)]) : []),
    ]
  }) },
  lowrider: { category: 'Vehicles', label: 'Lowrider', hint: 'A long, slammed cruiser on small chrome wheels with chrome trim', ...pfp('Lowrider', [paintParam('#5a1a7a', CANDY)], (L, p) => {
    const c = paintOf(p), f = 5.2
    return [
      ...auto(L, c, { len: 10.4, w: 4.2, ride: 0.2, bodyH: 1.25, cab: [-3.0, 1.0], cabH: 1.0, bumper: CHROME, noWheels: true }),
      box('Chrome trim', [4.26, 0.12, 9.4], L(0, 0.95, 0), CHROME), box('Chrome grille', [2.2, 0.55, 0.08], L(0, 0.55, f + 0.04), CHROME),
      ...[f - 1.6, -f + 1.6].flatMap((z) => [-1, 1].flatMap((sx) => [lying('Wheel', 1.1, 0.5, L(sx * 1.85, 0, z), PB.tire, PB.tire, 14), lying('Wire rim', 0.85, 0.54, L(sx * 1.85, 0.125, z), CHROME, CHROME, 12), lying('Knock-off', 0.3, 0.62, L(sx * 1.85, 0.4, z), CHROME, CHROME, 6)])),
    ]
  }) },
  convertible: { category: 'Vehicles', label: 'Convertible', hint: 'An open-top car with seats you can see; put the soft top up or down', ...pfp('Convertible', [paintParam('#b8322a'), sel('top', 'Top', [['down', 'Down'], ['up', 'Up']], 'down')], (L, p) => {
    const c = paintOf(p), ride = 0.5, f = 4.6, c0 = -2.4, c1 = 1.2, w = 4.1
    return [
      { ...box('Body', [w, 0.9, 9.2], L(0, ride, 0), c, c), bevel: 0.3 },
      { ...box('Hood', [w, 0.45, f - c1], L(0, ride + 0.9, (f + c1) / 2), c, c), bevel: 0.15 },
      { ...box('Trunk', [w, 0.45, c0 + f], L(0, ride + 0.9, (c0 - f) / 2), c, c), bevel: 0.15 },
      ...[-1, 1].map((sx) => box('Door', [0.3, 0.45, c1 - c0], L(sx * (w / 2 - 0.15), ride + 0.9, (c0 + c1) / 2), c, c)),
      ...[-0.9, 0.9].flatMap((x) => [box('Seat', [1.3, 0.5, 1.2], L(x, ride + 0.9, 0.1), TAN_SEAT), box('Seat back', [1.3, 1.1, 0.3], L(x, ride + 0.9, -0.6), TAN_SEAT)]),
      box('Rear seat', [3.2, 0.5, 1.0], L(0, ride + 0.9, -1.8), TAN_SEAT), box('Dashboard', [3.4, 0.6, 0.5], L(0, ride + 1.35, c1 - 0.25), TRIM),
      ramp('Windshield', [w - 0.4, 1.0, 0.7], L(0, ride + 1.35, c1 - 0.35), GLASS, GLASS),
      p.top === 'up' ? { ...box('Soft top', [w - 0.4, 1.1, c1 - c0 - 0.7], L(0, ride + 1.35, (c0 + c1) / 2 - 0.35), SOFT_TOP, SOFT_TOP), bevel: 0.3 } : { ...box('Folded top', [w - 0.6, 0.45, 0.8], L(0, ride + 1.35, c0 - 0.4), SOFT_TOP, SOFT_TOP), bevel: 0.15 },
      ...[-1, 1].map((k) => ({ ...box('Bumper', [w + 0.1, 0.45, 0.35], L(0, ride - 0.05, k * (f - 0.05)), CHROME, CHROME), bevel: 0.12 })),
      ...[-1, 1].flatMap((sx) => [box('Headlight', [0.8, 0.35, 0.06], L(sx * 1.5, ride + 0.6, f + 0.02), HEADLIGHT), box('Tail light', [0.7, 0.35, 0.06], L(sx * 1.5, ride + 0.65, -f - 0.02), TAILLIGHT)]),
      ...wheels(L, w - 0.4, [f - 1.4, -f + 1.4]),
    ]
  }) },
  suv: { category: 'Vehicles', label: 'SUV', hint: 'A tall four-by-four with a roof rack and a spare wheel on the back', ...pfp('SUV', [paintParam('#202020')], (L, p) => [
    ...auto(L, paintOf(p), { len: 9.6, w: 4.4, ride: 0.9, bodyH: 1.8, cab: [-4.4, 1.4], cabH: 1.5, wheel: 1.9, tire: 0.7, axles: [3.2, -3.0] }),
    ...[-1, 1].map((sx) => box('Roof rail', [0.15, 0.3, 5], L(sx * 1.6, 4.38, -1.5), TRIM)), box('Rack bar', [3.4, 0.12, 0.2], L(0, 4.68, -0.2), TRIM), box('Rack bar', [3.4, 0.12, 0.2], L(0, 4.68, -2.8), TRIM),
    lying('Spare wheel', 1.8, 0.6, L(0, 1.6, -5.1), PB.tire, PB.tire, 14, 90),
    ...[-1, 1].map((sx) => box('Side step', [0.5, 0.15, 3.6], L(sx * 2.35, 0.75, 0), TRIM)),
  ]) },
  pickup: { category: 'Vehicles', label: 'Pickup truck', hint: 'A pickup with an open bed; load it with crates or leave it empty', ...pfp('Pickup', [paintParam('#2a5ab8'), sel('load', 'Load', [['none', 'Empty'], ['crates', 'Crates'], ['tires', 'Tires']], 'none')], (L, p) => {
    const c = paintOf(p), top = 0.8 + 1.6, bz = -3.0
    return [
      ...auto(L, c, { len: 10.4, w: 4.3, ride: 0.8, bodyH: 1.6, cab: [-0.6, 2.0], cabH: 1.4, wheel: 1.8, tire: 0.65, axles: [3.4, -3.4] }),
      box('Bed liner', [3.7, 0.05, 4.2], L(0, top, bz), TRIM),
      ...[-1, 1].map((sx) => box('Bed side', [0.25, 1.1, 4.2], L(sx * 2.02, top, bz), c, c)),
      box('Bed front', [4.3, 1.1, 0.25], L(0, top, -0.95), c, c), box('Tailgate', [4.3, 1.1, 0.25], L(0, top, -5.07), c, c),
      ...(p.load === 'crates' ? [{ ...box('Crate', [1.8, 1.4, 1.8], L(-0.8, top + 0.05, -2.2), PB.plywood), bevel: 0.06 }, { ...box('Crate', [1.6, 1.2, 1.6], L(0.9, top + 0.05, -3.8), PB.plywood), bevel: 0.06 }]
        : p.load === 'tires' ? [0, 1, 2].map((k) => ({ ...cyl('Tire', 1.9, 0.6, L(-0.6 + (k % 2) * 1.2, top + 0.05 + (k === 2 ? 0.6 : 0), -3), PB.tire, PB.tire, 12), taper: 1 })) : []),
    ]
  }) },
  van: { category: 'Vehicles', label: 'Panel van', hint: 'A tall delivery van with a sliding side door', ...pfp('Van', [paintParam('#e8e8e8')], (L, p) => [
    ...van(L, paintOf(p)),
    box('Sliding door', [4.66, 3.4, 2.6], L(0, 1.0, 0.6), paintOf(p), TRIM), box('Rear doors', [4.0, 3.6, 0.06], L(0, 1.1, -5.03), TRIM),
  ]) },
  minivan: { category: 'Vehicles', label: 'Minivan', hint: 'A rounded family people-carrier', ...pfp('Minivan', [paintParam('#d0d0d0')], (L, p) => [
    ...auto(L, paintOf(p), { len: 9.4, w: 4.3, ride: 0.6, bodyH: 1.6, cab: [-4.3, 1.6], cabH: 1.5, wheel: 1.5, tire: 0.6 }),
    box('Door rail', [4.34, 0.1, 3], L(0, 3.5, -1.8), TRIM),
  ]) },
  taxi: { category: 'Vehicles', label: 'Taxi', hint: 'A cab with a roof sign and a black stripe', ...pfp('Taxi', [paintParam('#e0b020', [['#e0b020', 'Yellow'], ['#e8e8e8', 'White'], ['#2f8a3a', 'Green']])], (L, p) => [
    ...auto(L, paintOf(p), { len: 9, cab: [-2.6, 1.4] }),
    { ...box('Taxi sign', [1.8, 0.6, 0.7], L(0, 3.03, -0.6), YELLOW, glow('#fff2b0', '#d8c060', 721)), bevel: 0.12 },
    box('Taxi stripe', [4.04, 0.3, 7], L(0, 1.15, -0.2), STRIPE_BLACK),
  ]) },
  policecar: { category: 'Vehicles', label: 'Police car', hint: 'A patrol car with a light bar and a push bar', ...pfp('Police car', [sel('livery', 'Livery', [['bw', 'Black and white'], ['blue', 'White and blue'], ['white', 'All white']], 'bw')], (L, p) => {
    const body = p.livery === 'bw' ? BLACK : WHITE, door = p.livery === 'blue' ? paint('#2a5ab8') : WHITE
    return [
      ...auto(L, body, { len: 9, cab: [-2.6, 1.4] }),
      box('Door panel', [4.04, 1.0, 4.0], L(0, 0.6, -0.6), door, door),
      ...lightBar(L, 3.03, -0.4),
      box('Push bar', [2.6, 1.0, 0.25], L(0, 0.5, 4.75), TRIM),
    ]
  }) },
  limo: { category: 'Vehicles', label: 'Limousine', hint: 'A stretched limo with tinted windows', ...pfp('Limo', [paintParam('#202020', [['#202020', 'Black'], ['#e8e8e8', 'White'], ['#e070b0', 'Pink']])], (L, p) => {
    const c = paintOf(p)
    return [
      ...auto(L, c, { len: 16, w: 4.2, cab: [-6.4, 2.4], cabH: 1.1, axles: [6.4, -6.4], bumper: CHROME }),
      ...[-3.6, -0.8].map((z) => box('Pillar', [3.76, 1.1, 0.3], L(0, 1.85, z), c, c)),
    ]
  }) },
  burnedcar: { category: 'Vehicles', label: 'Burned-out car', hint: 'A torched wreck sitting on its rims, no glass left', make: pf('Burned car', (L) => [
    { ...box('Burned body', [4, 1.3, 8.6], L(0, 0.3, 0), CHAR, CHAR), bevel: 0.35 },
    box('Gutted interior', [3.4, 0.4, 3.8], L(0, 1.6, -0.6), SOOT),
    ...[[-1.6, -2.4], [1.6, -2.4], [-1.6, 1.2], [1.6, 1.2]].map(([x, z]) => box('Pillar', [0.2, 1.1, 0.2], L(x, 1.6, z), CHAR)),
    { ...box('Burned roof', [3.4, 0.15, 3.8], L(0, 2.7, -0.6), CHAR, CHAR, 3), bevel: 0.05 },
    box('Hood', [3.8, 0.12, 2.6], L(0.2, 1.62, 2.9), CHAR, CHAR, 6),
    ...[2.9, -2.9].flatMap((z) => [-1.85, 1.85].map((x) => lying('Bare rim', 0.95, 0.4, L(x, 0, z), PB.rusty, PB.rusty, 10))),
  ]) },
  caronblocks: { category: 'Vehicles', label: 'Car on blocks', hint: 'A stripped car up on cinder blocks, a loose tire on the ground', ...pfp('Car on blocks', [paintParam('#7a2a7a')], (L, p) => [
    ...auto(L, paintOf(p), { len: 9, ride: 1.5, cab: [-2.6, 1.4], noWheels: true }),
    ...[3.1, -3.1].flatMap((z) => [-1.4, 1.4].flatMap((x) => [box('Cinder block', [1.0, 1.5, 1.4], L(x, 0, z), CINDER), lying('Brake disc', 0.8, 0.2, L(x * 1.35, 1.0, z), PB.rusty, PB.rusty, 10)])),
    { ...cyl('Loose tire', 1.4, 0.55, L(-3.6, 0, 1.6), PB.tire, PB.tire, 14), taper: 1 },
    box('Jack', [0.5, 0.9, 1.2], L(1.0, 0, 0.4), PB.red),
  ]) },
}

const TRUCKS: Record<string, PrefabDef & { category: string }> = {
  ambulance: { category: 'Vehicles', label: 'Ambulance', hint: 'A boxy ambulance with a red stripe and light bars', make: pf('Ambulance', (L) => [
    ...van(L, WHITE, 11, 4.8, 5, 0.8, 1.7),
    box('Stripe', [4.86, 0.45, 8.6], L(0, 2.3, -1.1), RED), box('Rear doors', [4.0, 3.8, 0.06], L(0, 1.2, -5.53), STRIPE_WHITE),
    ...[[4.88, 1.8, 0.5], [4.88, 0.5, 1.8]].map(([w, h, d]) => box('Red cross', [w, h, d], L(0, 3.0 + (1.8 - h) / 2, -2.4), RED)),
    ...lightBar(L, 5.8, 2.8, 4), ...lightBar(L, 5.8, -5.2, 3.4),
  ]) },
  icecreamtruck: { category: 'Vehicles', label: 'Ice-cream truck', hint: 'A van with a serving window, an awning and a giant cone on the roof', ...pfp('Ice-cream truck', [paintParam('#e8e8e8', [['#e8e8e8', 'White'], ['#f0a0c8', 'Pink'], ['#9ad0f0', 'Sky blue']])], (L, p) => [
    ...van(L, paintOf(p), 11, 4.8, 5, 0.8, 1.6),
    box('Serving window', [0.1, 1.6, 3.6], L(2.42, 2.8, -1.4), GLASS), box('Counter', [0.6, 0.15, 3.6], L(2.7, 2.65, -1.4), CHROME),
    box('Awning', [1.4, 0.15, 4.2], L(3.0, 4.6, -1.4), STRIPE_WHITE, SCOOP),
    box('Menu board', [0.08, 1.2, 2], L(2.42, 2.8, 1.6), solid('#f2c218', '#c8a010', 722)),
    { ...cyl('Cone', 0.5, 1.8, L(0, 5.8, -2), CONE, CONE, 10), taper: 3 }, { ...cyl('Scoop', 1.6, 1.3, L(0, 7.6, -2), SCOOP, SCOOP, 10), taper: 0.35 },
  ]) },
  firetruck: { category: 'Vehicles', label: 'Fire truck', hint: 'A fire engine with locker shutters, a turntable and a ladder', make: pf('Fire truck', (L) => [
    { ...box('Cab', [5.4, 5, 5], L(0, 1.2, 10), RED, RED), bevel: 0.4 }, box('Windshield', [4.8, 1.8, 0.1], L(0, 3.8, 12.52), GLASS),
    box('Side windows', [5.46, 1.6, 3], L(0, 4, 10), GLASS), { ...box('Bumper', [5.6, 0.8, 0.5], L(0, 0.9, 12.6), CHROME, CHROME), bevel: 0.15 },
    ...[-1, 1].map((sx) => box('Headlight', [0.8, 0.5, 0.08], L(sx * 2, 1.9, 12.52), HEADLIGHT)), ...lightBar(L, 6.2, 10, 4.2, LIGHT_RED, LIGHT_RED),
    { ...box('Body', [5.4, 4.4, 18.4], L(0, 1.4, -2), RED, RED), bevel: 0.25 },
    ...[-8, -3, 2].map((z) => box('Locker', [5.5, 2.8, 4], L(0, 1.9, z), SHUTTER, SHUTTER)),
    cyl('Turntable', 3, 0.6, L(0, 5.8, -8), CHROME, CHROME, 12),
    ...[-6, 6].flatMap((z) => [-1.1, 1.1].map((x) => box('Ladder rest', [0.4, 0.6, 0.4], L(x, 5.8, z), CHROME))),
    ...[-1.1, 1.1].map((x) => box('Ladder rail', [0.3, 0.4, 22], L(x, 6.4, 0), CHROME)),
    ...[...Array(13)].map((_, i) => box('Rung', [2.2, 0.15, 0.2], L(0, 6.55, -9.6 + i * 1.6), CHROME)),
    ...wheels(L, 5.2, [9.6, -5.6, -8.2], 1.9, 0.7),
  ]) },
  towtruck: { category: 'Vehicles', label: 'Tow truck', hint: 'A wrecker with a boom, a hanging hook and a wheel-lift', ...pfp('Tow truck', [paintParam('#e0b020')], (L, p) => {
    const c = paintOf(p), top = 0.9 + 1.6
    return [
      ...auto(L, c, { len: 12, w: 4.4, ride: 0.9, bodyH: 1.6, cab: [0.6, 3.4], cabH: 1.5, wheel: 1.9, tire: 0.7, axles: [4.2, -3.8] }),
      ...lightBar(L, top + 1.68, 2.0, 3, LIGHT_AMBER, LIGHT_AMBER),
      box('Deck', [4.4, 0.3, 5.2], L(0, top, -3.2), PB.diamond),
      { ...box('Boom tower', [1.2, 4, 1.2], L(0, top + 0.3, -1.2), c, c), bevel: 0.1 },
      box('Boom', [0.7, 0.7, 6], L(0, top + 3.6, -3.8), c, c), box('Cable', [0.08, 2.6, 0.08], L(0, top + 1.0, -6.6), TRIM),
      box('Hook', [0.4, 0.6, 0.15], L(0, top + 0.4, -6.6), PB.steel),
      box('Wheel-lift', [3.6, 0.3, 0.6], L(0, 0.6, -6.6), TRIM), box('Lift arm', [0.5, 0.4, 1.4], L(0, 0.6, -6.0), TRIM),
    ]
  }) },
  garbagetruck: { category: 'Vehicles', label: 'Garbage truck', hint: 'A refuse truck with a compactor body and a rear hopper', ...pfp('Garbage truck', [paintParam('#2f8a3a', [['#2f8a3a', 'Green'], ['#e8e8e8', 'White'], ['#e0b020', 'Yellow'], ['#2a5ab8', 'Blue']])], (L, p) => {
    const c = paintOf(p)
    return [
      { ...box('Cab', [5.2, 4.8, 4.6], L(0, 1.0, 9.4), WHITE, WHITE), bevel: 0.4 }, box('Windshield', [4.6, 2.2, 0.1], L(0, 3.0, 11.72), GLASS),
      { ...box('Bumper', [5.4, 0.8, 0.5], L(0, 0.8, 11.8), TRIM, TRIM), bevel: 0.15 },
      ...[-1, 1].map((sx) => box('Headlight', [0.8, 0.5, 0.08], L(sx * 1.9, 1.7, 11.72), HEADLIGHT)), ...lightBar(L, 5.8, 9.4, 3, LIGHT_AMBER, LIGHT_AMBER),
      box('Chassis', [3.6, 0.8, 18], L(0, 0.8, 1.5), TRIM),
      { ...box('Compactor body', [5.6, 6.4, 13], L(0, 1.4, 0), c, c), bevel: 0.3 },
      box('Hopper', [5.6, 3, 3.4], L(0, 1.0, -8.2), c, c), ramp('Hopper lid', [5.6, 2.6, 3.4], L(0, 4.0, -8.2), c, c, 180),
      box('Hopper mouth', [4.4, 1.6, 0.08], L(0, 2.2, -9.94), SOOT),
      ...wheels(L, 5.2, [9.6, -2.8, -5.4], 1.9, 0.7),
    ]
  }) },
  semitruck: { category: 'Vehicles', label: 'Semi truck', hint: 'A tractor unit pulling a long box trailer', ...pfp('Semi truck', [paintParam('#b8322a')], (L, p) => [
    ...tractor(L, paintOf(p)),
    { ...box('Box trailer', [5.6, 8.4, 31], L(0, 2.4, -8.5), TRAILER, TRAILER), bevel: 0.2 },
    box('Trailer doors', [5.0, 7.6, 0.08], L(0, 2.8, -24.04), PB.steel), ...trailerWheels(L),
  ]) },
  tankertruck: { category: 'Vehicles', label: 'Tanker truck', hint: 'A tractor unit pulling a fuel tanker trailer with a catwalk', ...pfp('Tanker truck', [paintParam('#e8e8e8')], (L, p) => [
    ...tractor(L, paintOf(p)),
    box('Tanker frame', [3.4, 0.6, 29], L(0, 2.2, -9), TRIM),
    lying('Tank', 5.4, 28, L(0, 2.4, -9), CHROME, CHROME, 18, 90),
    ...[5.1, -23.1].map((z) => lying('Tank end', 5, 0.6, L(0, 2.6, z), CHROME, CHROME, 18, 90)),
    box('Catwalk', [1.2, 0.15, 20], L(0, 7.75, -9), PB.diamond), ...[-15, -9, -3].map((z) => cyl('Hatch', 1.4, 0.4, L(0, 7.6, z), CHROME, CHROME, 10)),
    box('Hazard plate', [0.06, 1, 1.4], L(2.72, 4.6, -22), solid('#f07a1a', '#c05a10', 723)),
    ...trailerWheels(L),
  ]) },
  flatbedtruck: { category: 'Vehicles', label: 'Flatbed truck', hint: 'A tractor unit pulling a flatbed trailer; pick the load', ...pfp('Flatbed truck', [paintParam('#2a5ab8'), cargoParam('pipes')], (L, p) => [
    ...tractor(L, paintOf(p)),
    box('Flatbed', [5.6, 0.6, 31], L(0, 2.4, -8.5), PB.planks, TRIM),
    ...[-20, -12, -4, 4].flatMap((z) => [-1, 1].map((sx) => box('Stake', [0.25, 1.4, 0.25], L(sx * 2.7, 3.0, z), PB.steel))),
    ...cargo(L, String(p.cargo), 3.0, 28, -9),
    ...trailerWheels(L),
  ]) },
  schoolbus: { category: 'Vehicles', label: 'School bus', hint: 'A yellow school bus with a long hood, black stripes and a stop arm', make: pf('School bus', (L) => [
    { ...box('Hood', [5, 2.8, 3.6], L(0, 1.0, 13.2), YELLOW, YELLOW), bevel: 0.4 }, box('Grille', [2.6, 1.8, 0.08], L(0, 1.4, 15.02), CHROME),
    ...[-1, 1].map((sx) => box('Headlight', [0.7, 0.6, 0.08], L(sx * 1.9, 2.2, 15.02), HEADLIGHT)),
    { ...box('Bumper', [5.6, 0.7, 0.5], L(0, 0.8, 15.2), STRIPE_BLACK, STRIPE_BLACK), bevel: 0.1 },
    { ...box('Bus body', [5.6, 5.6, 23], L(0, 1.0, -0.1), WHITE, YELLOW), bevel: 0.35 },
    box('Window band', [5.66, 1.8, 19], L(0, 3.6, 0.4), GLASS), box('Windshield', [5, 2, 0.1], L(0, 3.5, 11.42), GLASS),
    ...[1.5, 2.6].map((y) => box('Stripe', [5.68, 0.18, 22.6], L(0, y, -0.1), STRIPE_BLACK)),
    box('Bus door', [0.1, 4, 2.2], L(2.82, 1.1, 10), GLASS), box('Stop arm', [0.1, 1, 1], L(-3.0, 3.2, 9.6), PB.red),
    ...[-1, 1].flatMap((sx) => [box('Flasher', [0.6, 0.5, 0.1], L(sx * 2, 6.0, 11.42), LIGHT_RED), box('Flasher', [0.6, 0.5, 0.1], L(sx * 2, 6.0, -11.62), LIGHT_AMBER)]),
    ...wheels(L, 5.2, [12.6, -6.4], 1.9, 0.65),
  ]) },
  golfcart: { category: 'Vehicles', label: 'Golf cart', hint: 'A two-seat cart with a canopy roof and a golf bag on the back', ...pfp('Golf cart', [paintParam('#e8e8e8')], (L, p) => {
    const c = paintOf(p)
    return [
      { ...box('Cart body', [3.2, 0.9, 6], L(0, 0.5, 0), c, c), bevel: 0.3 }, { ...box('Cowl', [3.2, 0.8, 1.6], L(0, 1.4, 2.2), c, c), bevel: 0.3 },
      box('Seat', [3, 0.8, 1.4], L(0, 1.4, -0.6), TAN_SEAT), box('Seat back', [3, 1.3, 0.3], L(0, 2.2, -1.4), TAN_SEAT),
      ...[[-1.5, 1.8], [1.5, 1.8], [-1.5, -1.6], [1.5, -1.6]].map(([x, z]) => box('Roof post', [0.15, 4.0, 0.15], L(x, 1.4, z), TRIM)),
      { ...box('Canopy', [3.6, 0.2, 4.8], L(0, 5.4, 0.1), c, c), bevel: 0.08 }, box('Windscreen', [3.0, 2.0, 0.08], L(0, 3.0, 1.84), GLASS),
      cyl('Steering column', 0.2, 1.2, L(-0.7, 2.2, 1.4), TRIM, TRIM, 6), { ...cyl('Steering wheel', 0.9, 0.1, L(-0.7, 3.4, 1.4), TRIM, TRIM, 10) },
      box('Bag rack', [2.4, 0.2, 1.2], L(0, 1.4, -2.6), TRIM), cyl('Golf bag', 1, 2.6, L(0, 1.6, -2.6), PB.blue, PB.blue, 10),
      ...[-0.25, 0.25].map((x) => box('Club', [0.12, 0.6, 0.3], L(x, 4.2, -2.6), CHROME)),
      ...wheels(L, 3.0, [2.0, -2.0], 1.1, 0.5),
    ]
  }) },
  farmtractor: { category: 'Vehicles', label: 'Farm tractor', hint: 'A tractor with big rear wheels and a glass cab', ...pfp('Farm tractor', [paintParam('#2f8a3a', [['#2f8a3a', 'Green'], ['#b8322a', 'Red'], ['#2a5ab8', 'Blue'], ['#f07a1a', 'Orange']])], (L, p) => {
    const c = paintOf(p)
    return [
      box('Chassis', [1.8, 1.0, 7], L(0, 0.9, 0.6), TRIM),
      { ...box('Hood', [2, 2, 4.4], L(0, 1.6, 2.4), c, c), bevel: 0.3 }, box('Grille', [1.6, 1.4, 0.08], L(0, 1.8, 4.62), TRIM),
      { ...box('Cab base', [2.8, 1.2, 3], L(0, 1.6, -1.8), c, c), bevel: 0.15 },
      { ...box('Tractor cab', [3, 3, 3], L(0, 2.8, -1.8), GLASS, GLASS), bevel: 0.15 }, { ...box('Cab roof', [3.4, 0.3, 3.4], L(0, 5.8, -1.8), c, c), bevel: 0.1 },
      ...[-1, 1].map((sx) => ({ ...box('Fender', [1.5, 0.3, 4.4], L(sx * 2.35, 4.25, -2), c, c), bevel: 0.1 })),
      cyl('Exhaust', 0.35, 3, L(0.6, 3.6, 3.8), TRIM, TRIM, 6),
      ...[-1, 1].flatMap((sx) => [...wheel1(L, sx * 2.35, -2, 4.2, 1.3, PB.yellow), ...wheel1(L, sx * 1.6, 3.6, 2.2, 0.7, PB.yellow)]),
    ]
  }) },
}

const SMALL: Record<string, PrefabDef & { category: string }> = {
  scooter: { category: 'Vehicles', label: 'Delivery scooter', hint: 'A moped with a delivery box on the back', ...pfp('Scooter', [paintParam('#b8322a')], (L, p) => {
    const c = paintOf(p)
    return [
      ...wheel1(L, 0, 1.5, 1.2, 0.4), ...wheel1(L, 0, -1.4, 1.2, 0.4),
      box('Floorboard', [1.1, 0.35, 2.2], L(0, 0.5, 0.2), TRIM), { ...box('Rear cowl', [1.3, 1.1, 1.8], L(0, 0.7, -1.1), c, c), bevel: 0.35 },
      { ...box('Seat', [1, 0.3, 1.5], L(0, 1.8, -0.9), SEAT), bevel: 0.1 }, { ...box('Leg shield', [1.2, 1.8, 0.35], L(0, 0.6, 1.2), c, c), bevel: 0.15 },
      cyl('Steering column', 0.25, 1.4, L(0, 1.6, 1.3), TRIM, TRIM, 6), box('Handlebar', [1.8, 0.15, 0.15], L(0, 3.0, 1.3), TRIM),
      box('Headlight', [0.5, 0.35, 0.1], L(0, 2.6, 1.4), HEADLIGHT),
      { ...box('Delivery box', [1.8, 1.6, 1.8], L(0, 2.1, -1.4), WHITE, c), bevel: 0.12 },
    ]
  }) },
  motorcycle: { category: 'Vehicles', label: 'Motorcycle', hint: 'A cruiser or a sport bike', ...pfp('Motorcycle', [paintParam('#202020'), sel('style', 'Style', [['cruiser', 'Cruiser'], ['sport', 'Sport']], 'cruiser')], (L, p) => {
    const c = paintOf(p), sport = p.style === 'sport'
    return [
      ...wheel1(L, 0, 2.4, 2.0, 0.5), ...wheel1(L, 0, -2.4, 2.1, 0.6),
      box('Frame', [0.35, 0.35, 4], L(0, 1.4, 0), TRIM), { ...box('Engine', [0.9, 1.1, 1.4], L(0, 0.75, 0), CHROME, CHROME), bevel: 0.15 },
      { ...box('Tank', [0.9, 0.6, 1.6], L(0, 2.0, 0.7), c, c), bevel: 0.25 },
      { ...box('Seat', [0.9, 0.3, 1.8], L(0, sport ? 2.3 : 1.9, -0.9), SEAT), bevel: 0.1 },
      ...[-0.35, 0.35].map((x) => box('Fork', [0.12, 2.2, 0.12], L(x, 1.0, 2.25), CHROME)),
      box('Handlebar', [sport ? 1.6 : 2.2, 0.12, 0.12], L(0, sport ? 2.8 : 3.2, 1.9), CHROME),
      lying('Exhaust', 0.3, 3, L(0.55, 0.55, -1.2), CHROME, CHROME, 8, 90),
      ...(sport
        ? [{ ...box('Fairing', [1.0, 1.4, 1.6], L(0, 1.7, 1.7), c, c), bevel: 0.4 }, box('Windscreen', [0.7, 0.5, 0.1], L(0, 3.1, 2.1), GLASS), { ...box('Tail', [0.7, 0.6, 1.4], L(0, 2.2, -2.2), c, c), bevel: 0.2 }]
        : [{ ...box('Rear fender', [0.6, 0.3, 1.8], L(0, 2.1, -2.3), c, c), bevel: 0.1 }, lying('Headlight', 0.6, 0.3, L(0, 2.5, 2.45), HEADLIGHT, CHROME, 10, 90)]),
    ]
  }) },
  dirtbike: { category: 'Vehicles', label: 'Dirt bike', hint: 'A tall off-road bike with a number plate', ...pfp('Dirt bike', [paintParam('#e0b020', [['#e0b020', 'Yellow'], ['#f07a1a', 'Orange'], ['#2f8a3a', 'Green'], ['#2a5ab8', 'Blue'], ['#b8322a', 'Red']])], (L, p) => {
    const c = paintOf(p)
    return [
      ...wheel1(L, 0, 2.3, 2.2, 0.45, TRIM), ...wheel1(L, 0, -2.3, 2.2, 0.5, TRIM),
      box('Frame', [0.3, 0.3, 3.4], L(0, 1.8, 0), TRIM), { ...box('Engine', [0.8, 1, 1.2], L(0, 0.9, 0), TRIM, TRIM), bevel: 0.1 },
      { ...box('Shroud', [0.9, 0.8, 1.4], L(0, 2.1, 0.7), c, c), bevel: 0.25 }, { ...box('Seat', [0.7, 0.25, 2.4], L(0, 2.8, -0.6), SEAT), bevel: 0.08 },
      ...[-0.3, 0.3].map((x) => box('Fork', [0.12, 2.4, 0.12], L(x, 1.1, 2.3), CHROME)),
      { ...box('Front fender', [0.5, 0.15, 1.4], L(0, 2.6, 2.4), c, c), bevel: 0.05 }, { ...box('Rear fender', [0.5, 0.2, 1.6], L(0, 2.9, -2.2), c, c), bevel: 0.05 },
      box('Number plate', [1, 0.9, 0.1], L(0, 2.9, 2.0), STRIPE_WHITE), box('Handlebar', [1.9, 0.12, 0.12], L(0, 3.5, 2.0), TRIM),
    ]
  }) },
  bicycle: { category: 'Vehicles', label: 'Bicycle', hint: 'A city bike', ...pfp('Bicycle', [paintParam('#2a5ab8')], (L, p) => {
    const c = paintOf(p)
    return [
      ...wheel1(L, 0, 1.9, 2.6, 0.14, TRIM), ...wheel1(L, 0, -1.9, 2.6, 0.14, TRIM),
      box('Chainstay', [0.14, 0.14, 1.9], L(0, 1.24, -0.95), c), box('Seat tube', [0.14, 1.5, 0.14], L(0, 1.3, 0), c),
      box('Top tube', [0.14, 0.14, 1.8], L(0, 2.6, 0.9), c), box('Head tube', [0.16, 1.2, 0.16], L(0, 1.7, 1.8), c),
      box('Fork', [0.1, 0.5, 0.1], L(0, 1.25, 1.9), c), box('Seat post', [0.1, 0.4, 0.1], L(0, 2.8, 0), CHROME),
      { ...box('Saddle', [0.45, 0.15, 0.8], L(0, 3.2, -0.1), SEAT), bevel: 0.05 }, box('Handlebar', [1.6, 0.1, 0.1], L(0, 2.9, 1.8), CHROME),
      lying('Chainring', 0.7, 0.1, L(0.12, 0.9, 0), CHROME, CHROME, 10),
    ]
  }) },
  shoppingcart: { category: 'Vehicles', label: 'Shopping cart', hint: 'A wire supermarket trolley', make: pf('Shopping cart', (L) => [
    box('Basket floor', [2.4, 0.08, 3.4], L(0, 1.6, 0), WIRE),
    ...[-1, 1].map((sx) => box('Basket side', [0.06, 1.8, 3.4], L(sx * 1.2, 1.6, 0), WIRE)),
    box('Basket front', [2.4, 1.6, 0.06], L(0, 1.6, 1.7), WIRE), box('Basket back', [2.4, 1.8, 0.06], L(0, 1.6, -1.7), WIRE),
    box('Handle', [2.6, 0.18, 0.18], L(0, 3.6, -2.05), PB.red), ...[-1.1, 1.1].map((x) => box('Handle arm', [0.08, 0.1, 0.45], L(x, 3.4, -1.9), CHROME)),
    ...[-0.95, 0.95].map((x) => box('Base rail', [0.1, 0.1, 3.4], L(x, 0.5, -0.1), CHROME)),
    ...[[-0.95, -1.5], [0.95, -1.5], [-0.95, 1.3], [0.95, 1.3]].flatMap(([x, z]) => [box('Leg', [0.1, 1.1, 0.1], L(x, 0.5, z), CHROME), lying('Caster', 0.5, 0.2, L(x, 0, z), PB.black, PB.black, 8)]),
  ]) },
  wheelbarrow: { category: 'Vehicles', label: 'Wheelbarrow', hint: 'A builder’s barrow full of dirt', make: pf('Wheelbarrow', (L) => [
    { ...box('Tray', [2.6, 1.0, 3.2], L(0, 1.2, 0.3), DIRT_LOAD, PB.green), bevel: 0.3 },
    ...wheel1(L, 0, 2.4, 1.4, 0.35, PB.steel),
    ...[-0.3, 0.3].map((x) => box('Wheel bracket', [0.1, 0.6, 1.0], L(x, 0.6, 2.1), PB.steel)),
    ...[-0.9, 0.9].flatMap((x) => [box('Handle', [0.15, 0.15, 5], L(x, 1.0, -0.4), PB.wood), box('Leg', [0.15, 1.0, 0.15], L(x, 0, -1.2), PB.steel), box('Grip', [0.2, 0.2, 0.6], L(x, 1.0, -3.0), PB.black)]),
  ]) },
}

const AIR_SEA_RAIL: Record<string, PrefabDef & { category: string }> = {
  helicopter: { category: 'Vehicles', label: 'Helicopter', hint: 'A parked light helicopter on skids', ...pfp('Helicopter', [paintParam('#2a5ab8')], (L, p) => {
    const c = paintOf(p)
    return [
      ...[-1, 1].flatMap((sx) => [lying('Skid', 0.35, 9, L(sx * 2.2, 0, 0.4), TRIM, TRIM, 8, 90), ...[-1.6, 2.4].map((z) => box('Skid strut', [0.2, 1.0, 0.2], L(sx * 2.0, 0.3, z), TRIM))]),
      { ...box('Fuselage', [4, 4.2, 6.4], L(0, 1.2, 0.4), c, c), bevel: 0.9 },
      { ...box('Cockpit glass', [3.6, 2.6, 1.8], L(0, 2.2, 3.9), GLASS, GLASS), bevel: 0.7 },
      { ...lying('Tail boom', 1.3, 9, L(0, 3.0, -6.8), c, c, 10, 90), taper: 0.45 },
      box('Tail fin', [0.25, 2.6, 1.6], L(0, 3.3, -10.8), c, c), box('Stabilizer', [3, 0.15, 0.8], L(0, 3.4, -9.8), c, c),
      lying('Tail rotor', 2.2, 0.12, L(0.3, 2.9, -10.8), TRIM, TRIM, 10),
      cyl('Mast', 0.5, 0.9, L(0, 5.35, 0.6), TRIM, TRIM, 8), cyl('Rotor hub', 1.1, 0.45, L(0, 6.2, 0.6), TRIM, TRIM, 8),
      ...[45, 135].map((a) => box('Rotor blade', [0.5, 0.1, 22], L(0, 6.4, 0.6), TRIM, TRIM, a)),
    ]
  }) },
  smallplane: { category: 'Vehicles', label: 'Small plane', hint: 'A parked high-wing light aircraft', ...pfp('Small plane', [paintParam('#b8322a')], (L, p) => {
    const c = paintOf(p)
    return [
      ...wheel1(L, -2, 0.6, 1.2, 0.5, STRIPE_WHITE), ...wheel1(L, 2, 0.6, 1.2, 0.5, STRIPE_WHITE), ...wheel1(L, 0, 5.2, 1.0, 0.4, STRIPE_WHITE),
      ...[-1.6, 1.6].map((x) => box('Gear leg', [0.2, 1.2, 0.3], L(x, 0.5, 0.6), TRIM)), box('Nose gear', [0.2, 1.1, 0.2], L(0, 0.5, 5.2), TRIM),
      { ...lying('Fuselage', 2.8, 12, L(0, 1.2, -1.6), WHITE, WHITE, 12, 90), taper: 0.3 },
      { ...lying('Cowling', 2.6, 1.8, L(0, 1.3, 5.1), c, c, 12, 270), taper: 0.7 },
      { ...lying('Spinner', 0.7, 0.6, L(0, 2.3, 6.3), CHROME, CHROME, 8, 270), taper: 0.3 }, box('Propeller', [0.35, 4.2, 0.12], L(0, 0.55, 6.25), TRIM),
      { ...box('Cabin glass', [2.2, 1.3, 3.2], L(0, 3.4, 1.8), GLASS, GLASS), bevel: 0.4 },
      { ...box('Wing', [22, 0.35, 3.2], L(0, 4.6, 1.6), c, WHITE), bevel: 0.12 },
      ...[-1, 1].map((sx) => box('Wing strut', [0.15, 2.4, 0.3], L(sx * 4.5, 2.3, 1.6), TRIM)),
      box('Tail fin', [0.25, 2.8, 2.2], L(0, 2.4, -6.8), c, c), box('Tailplane', [6.4, 0.2, 1.6], L(0, 2.3, -6.8), WHITE, c),
      box('Cheat line', [2.86, 0.25, 9], L(0, 2.4, -0.6), c, c),
    ]
  }) },
  speedboat: { category: 'Vehicles', label: 'Speedboat', hint: 'A fast runabout with a windshield, seats and an outboard; on a trailer or not', ...pfp('Speedboat', [paintParam('#b8322a'), yesNo('trailer', 'On a trailer', 'yes')], (L, p) => {
    const c = paintOf(p), y = p.trailer === 'yes' ? 1.3 : 0
    return [
      { ...box('Hull', [4.6, 2.1, 9], L(0, y, -2), WHITE, WHITE), bevel: 0.5 }, bow(L, 'Bow', 4.6, 2.1, 2.5, WHITE, WHITE, y),
      box('Hull stripe', [4.66, 0.4, 8.6], L(0, y + 1.0, -2), c, c),
      ramp('Windshield', [4.0, 0.9, 1.2], L(0, y + 2.1, 1.0), GLASS, GLASS),
      ...[-1, 1].flatMap((sx) => [{ ...box('Seat', [1.4, 0.7, 1.2], L(sx * 1, y + 2.1, -0.8), TAN_SEAT), bevel: 0.15 }, box('Seat back', [1.4, 1.0, 0.3], L(sx * 1, y + 2.1, -1.5), TAN_SEAT)]),
      { ...box('Rear bench', [3.6, 0.8, 1.2], L(0, y + 2.1, -4.6), TAN_SEAT), bevel: 0.15 },
      { ...box('Outboard', [1.2, 2.4, 1.0], L(0, y + 0.6, -7.0), STRIPE_BLACK, STRIPE_BLACK), bevel: 0.2 },
      ...(y ? [
        ...[-1.2, 1.2].map((x) => box('Trailer rail', [0.3, 0.3, 12], L(x, 1.0, -1), PB.steel)),
        box('Tongue', [0.3, 0.3, 4], L(0, 1.0, 6.6), PB.steel), box('Jack post', [0.2, 1.0, 0.2], L(0, 0, 8.2), PB.steel),
        ...wheels(L, 4.4, [-2.4], 1.4, 0.45),
      ] : []),
    ]
  }) },
  rowboat: { category: 'Vehicles', label: 'Rowboat', hint: 'An open wooden rowboat with benches and oars', ...pfp('Rowboat', [sel('color', 'Hull', [['wood', 'Bare wood'], ['green', 'Green'], ['white', 'White'], ['red', 'Red']], 'wood')], (L, p) => {
    const hull = ({ wood: WOOD_HULL, green: PB.green, white: STRIPE_WHITE, red: PB.red } as Record<string, Tex>)[String(p.color)] ?? WOOD_HULL
    return [
      box('Boat floor', [2.6, 0.3, 6], L(0, 0, -0.4), PB.planks, hull),
      ...[-1, 1].map((sx) => box('Gunwale', [0.3, 1.2, 6], L(sx * 1.15, 0, -0.4), WOOD_HULL, hull)),
      box('Transom', [2.6, 1.2, 0.3], L(0, 0, -3.25), WOOD_HULL, hull), bow(L, 'Bow', 2.6, 1.3, 2.6, WOOD_HULL, hull),
      ...[0.6, -2].map((z) => box('Bench', [2.2, 0.2, 0.8], L(0, 0.9, z), PB.planks)),
      ...[-0.5, 0.5].map((x) => box('Oar', [0.15, 0.12, 5.4], L(x, 0.3, -0.6), PB.wood, PB.wood, x * 6)),
    ]
  }) },
  jetski: { category: 'Vehicles', label: 'Jet ski', hint: 'A sit-down personal watercraft', ...pfp('Jet ski', [paintParam('#e0b020', [['#e0b020', 'Yellow'], ['#2a5ab8', 'Blue'], ['#b8322a', 'Red'], ['#2f8a3a', 'Green'], ['#202020', 'Black']])], (L, p) => {
    const c = paintOf(p)
    return [
      { ...box('Hull', [2, 1, 4.6], L(0, 0, -0.4), WHITE, c), bevel: 0.35 }, bow(L, 'Bow', 2, 1, 1.9, c, c),
      { ...box('Jet seat', [0.9, 0.5, 2], L(0, 1, -0.9), SEAT), bevel: 0.2 }, { ...box('Console', [1.2, 0.9, 1.2], L(0, 1, 1.0), c, c), bevel: 0.3 },
      box('Handlebar', [1.8, 0.12, 0.12], L(0, 2.0, 0.8), TRIM), box('Jet nozzle', [0.6, 0.5, 0.4], L(0, 0.2, -2.85), TRIM),
    ]
  }) },
  boxcar: { category: 'Vehicles', label: 'Train boxcar', hint: 'A freight boxcar on two bogies, with sliding doors', ...pfp('Boxcar', [railParam('red')], (L, p) => {
    const c = RAIL_PAINT[String(p.color)] ?? PB.boxRed
    return [
      ...bogie(L, -10), ...bogie(L, 10), box('Underframe', [4, 0.6, 27], L(0, 1.4, 0), TRIM),
      box('Boxcar', [6, 7.4, 28], L(0, 2.0, 0), c, c, 0, 6), { ...box('Boxcar roof', [6.3, 0.3, 28.3], L(0, 9.4, 0), PB.steel), bevel: 0.1 },
      box('Sliding door', [6.12, 6.2, 5.2], L(0, 2.4, 0), PB.rusty, PB.rusty),
      ...[-1, 1].flatMap((k) => [box('Coupler', [0.8, 0.8, 1.2], L(0, 1.6, k * 14.5), TRIM), box('Ladder', [0.8, 6, 0.1], L(2.4, 2.4, k * 14.05), PB.steel)]),
    ]
  }) },
  flatcar: { category: 'Vehicles', label: 'Train flatcar', hint: 'A flat railcar; pick its load', ...pfp('Flatcar', [cargoParam('container')], (L, p) => [
    ...bogie(L, -10), ...bogie(L, 10), box('Flatcar deck', [6, 0.8, 28], L(0, 1.9, 0), PB.planks, TRIM),
    ...[-1, 1].map((k) => box('Coupler', [0.8, 0.8, 1.2], L(0, 1.6, k * 14.5), TRIM)),
    ...cargo(L, String(p.cargo), 2.7, 26),
  ]) },
  tankcar: { category: 'Vehicles', label: 'Train tank car', hint: 'A railway tank wagon with a dome and a walkway', ...pfp('Tank car', [sel('color', 'Paint', [['black', 'Black'], ['white', 'White'], ['silver', 'Silver']], 'black')], (L, p) => {
    const c = ({ black: STRIPE_BLACK, white: STRIPE_WHITE, silver: SILVER } as Record<string, Tex>)[String(p.color)] ?? STRIPE_BLACK
    return [
      ...bogie(L, -9), ...bogie(L, 9), box('Underframe', [3.6, 0.8, 26], L(0, 1.4, 0), TRIM),
      lying('Tank', 5.6, 24, L(0, 2.2, 0), c, c, 18, 90), ...[-1, 1].map((k) => lying('Tank end', 5.0, 0.8, L(0, 2.5, k * 12.3), c, c, 18, 90)),
      cyl('Dome', 1.8, 0.9, L(0, 7.7, 0), c, c, 12), box('Walkway', [6.4, 0.15, 2], L(0, 2.2, 0), PB.diamond),
      ...[-1, 1].map((k) => box('Coupler', [0.8, 0.8, 1.2], L(0, 1.6, k * 13.5), TRIM)),
    ]
  }) },
  subwaycar: { category: 'Vehicles', label: 'Subway car', hint: 'A stainless metro car with sliding doors and a color stripe', ...pfp('Subway car', [sel('color', 'Stripe', [['blue', 'Blue'], ['red', 'Red'], ['green', 'Green'], ['orange', 'Orange']], 'blue')], (L, p) => {
    const st = ({ blue: PB.blue, red: PB.red, green: PB.green, orange: PB.orange } as Record<string, Tex>)[String(p.color)] ?? PB.blue
    return [
      ...bogie(L, -11), ...bogie(L, 11), box('Underframe', [4, 0.6, 32], L(0, 1.4, 0), TRIM),
      { ...box('Subway body', [6, 7, 34], L(0, 1.9, 0), PB.steel, SILVER), bevel: 0.5 },
      box('Window band', [6.06, 2, 30], L(0, 4.6, 0), GLASS), box('Color stripe', [6.08, 0.5, 33], L(0, 3.6, 0), st),
      ...[-12, -4, 4, 12].map((z) => box('Doors', [6.1, 5.2, 2.6], L(0, 2.1, z), SILVER, glow('#3a4048', '#2a2e34', 724))),
      ...[-1, 1].flatMap((k) => [box('End window', [3.6, 2, 0.08], L(0, 4.6, k * 17.02), GLASS), ...[-1.8, 1.8].map((x) => box(k > 0 ? 'Headlight' : 'Tail light', [0.6, 0.4, 0.08], L(x, 2.8, k * 17.02), k > 0 ? HEADLIGHT : TAILLIGHT))]),
      box('Destination sign', [2.6, 0.5, 0.08], L(0, 7.6, 17.02), CY.orange),
      ...[-9, 9].map((z) => ({ ...box('Roof unit', [3.6, 0.8, 5], L(0, 8.9, z), PB.steel), bevel: 0.2 })),
    ]
  }) },
}

export const VEHICLE_PREFABS: Record<string, PrefabDef & { category: string }> = { ...CARS, ...TRUCKS, ...SMALL, ...AIR_SEA_RAIL }
