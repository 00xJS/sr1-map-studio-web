// Paintball park life: what a real field has besides its bunkers (referee
// towers, a scoreboard, team flags and start boxes, spectator stands, gear
// tables, air fill and chrono stations, team pits, paint boxes, sponsor
// banners, warning signs, floodlights) and the clutter of the urban fields
// (trash bags, a parking gate and bay lines, turnstiles, lantern strings,
// produce crates, rooftop dishes, a grind rail, a
// clothesline, a fire pit). Each is one object placed with its base at y and
// turned by rot; pieces with a front face +Z. Signs and banners use the
// generated 'banner' texture, so nothing here needs an image file.
import { CY, PB, box, cyl, sack, lying, stairs, type Part, type Tex } from './sampleKit'
import { type ParamDef, type Params, type PrefabDef } from './prefabs'
import { BANNERS } from './procedural'
import { pf, pfp, type Lf as L } from './prefabKit'


/** Wording on a sign: one of the generated banner texture's slogans ('' for the splat alone), stretched once over a face `aspect` times wider than tall. The print reads right on the face toward +Z. */
export const say = (text: string, aspect: number, color: string, accent: string, wear = 0.1): Tex =>
  ({ gen: 'banner', tweak: { seed: Math.max(0, BANNERS.indexOf(text)), scale: aspect, color, accent, wear }, surface: 15 })
/** A thin panel showing a sign on both faces. */
const panel = (label: string, w: number, h: number, at: [number, number, number], tex: Tex, rot = 0): Part =>
  ({ ...box(label, [w, h, 0.06], at, tex, tex, rot), fit: true })

const TEAM: Record<string, [Tex, string, string]> = {
  red: [PB.red, '#d8322b', 'TEAM RED'], blue: [PB.blue, '#2a6fe0', 'TEAM BLUE'], yellow: [PB.yellow, '#f2c218', 'GO PAINT'], green: [PB.green, '#2fbf4a', 'SPLATTER'],
}
const teamParam = (d: string): ParamDef => ({ key: 'color', label: 'Team', kind: 'select', options: [['red', 'Red'], ['blue', 'Blue'], ['yellow', 'Yellow'], ['green', 'Green']], default: d })
const team = (p: Params) => TEAM[String(p.color)] ?? TEAM.red
const SPONSOR = ['SPLAT CITY', 'GAME ON', 'BUNKER BROS', 'HOPPER HQ', 'PODS & PAINT', 'GO PAINT', 'SPLATTER', 'FIELD 1']
const WARN = ['MASKS ON', 'NO BLIND FIRE', 'BARREL BAGS ON', 'SAFE ZONE', 'STAY BACK', 'KEEP OUT', 'DANGER', 'HARD HATS', 'NO ENTRY', 'MIND THE GAP', 'SKATE AT OWN RISK', 'NO PARKING']
const wording = (list: string[], d: string): ParamDef => ({ key: 'text', label: 'Wording', kind: 'select', options: list.map((t) => [t, t[0] + t.slice(1).toLowerCase()]), default: d })
const BANNER_COLORS: Record<string, [string, string]> = {
  blue: ['#1d4fa8', '#ffffff'], black: ['#141416', '#ffd23a'], red: ['#c22a22', '#ffffff'], yellow: ['#f2c218', '#141416'], green: ['#1f7a34', '#ffffff'],
}
const bannerColor = (d: string): ParamDef => ({ key: 'color', label: 'Colors', kind: 'select', options: [['blue', 'Blue'], ['black', 'Black'], ['red', 'Red'], ['yellow', 'Yellow'], ['green', 'Green']], default: d })

const NET: Tex = { gen: 'tiles', tweak: { color: '#1d1d1f', accent: '#3a3a40', scale: 16, wear: 0, seed: 354 }, surface: 14 }
const PLASTIC: Tex = { gen: 'paint', tweak: { color: '#e4e4e0', accent: '#c8c8c2', scale: 2, wear: 0.05, seed: 470 }, surface: 17 }
const CARDBOARD: Tex = { gen: 'paint', tweak: { color: '#a8834f', accent: '#8a6a3c', scale: 2, wear: 0.2, seed: 471 }, surface: 21 }
const BAG: Tex = { gen: 'concrete', tweak: { color: '#1e1f22', accent: '#3a3c40', scale: 6, wear: 0.4, seed: 472 }, surface: 17 }
const GLOW: Tex = { gen: 'paint', tweak: { color: '#fff3c8', accent: '#ffe08a', scale: 2, wear: 0, seed: 473 }, surface: 17 }
const LANTERN: Tex = { gen: 'paint', tweak: { color: '#e0402a', accent: '#ff9a4a', scale: 2, wear: 0, seed: 474 }, surface: 17 }
const TANK_GREEN: Tex = { gen: 'metal_plate', tweak: { color: '#2f6a3a', accent: '#1d3f24', scale: 1, wear: 0.1, seed: 475 } }
const LINEN = (color: string, seed: number): Tex => ({ gen: 'paint', tweak: { color, accent: color, scale: 2, wear: 0.05, seed }, surface: 21 })
const PAINT_LINE: Tex = { gen: 'paint', tweak: { color: '#e8e8e0', accent: '#d0d0c8', scale: 2, wear: 0.3, seed: 477 } }
const ROCK: Tex = { lib: 'rock_face_03', surface: 0 }
const EMBER: Tex = { gen: 'paint', tweak: { color: '#ff7a1a', accent: '#a02a08', scale: 3, wear: 0.4, seed: 478 }, surface: 17 }

/** A paintball marker lying on a table: body, barrel and hopper. */
const marker = (L: L, x: number, y: number, z: number, tex: Tex): Part[] => [
  { ...box('Marker', [0.4, 0.55, 1.5], L(x, y, z), tex), bevel: 0.1 }, lying('Barrel', 0.2, 1.4, L(x, y + 0.3, z + 1.4), PB.black, PB.black, 8, 90),
  { ...cyl('Hopper', 0.75, 0.7, L(x, y + 0.55, z - 0.2), CY.white, CY.white, 10), taper: 0.8 },
]
/** A mask: face shell with a dark lens. */
const mask = (L: L, x: number, y: number, z: number, tex: Tex): Part[] => [
  { ...box('Mask', [0.6, 0.65, 0.45], L(x, y, z), tex), bevel: 0.15 }, box('Lens', [0.5, 0.2, 0.05], L(x, y + 0.38, z + 0.24), PB.black),
]

/** Pieces with a front, for the dressing pass: where the front points (degrees from +Z), the open floor it needs, the heading step. */
export const LIFE_FRONTS: Record<string, [number, number, number]> = {
  reftower: [0, 6, 90], scoreboard: [0, 10, 90], spectatorstand: [0, 8, 90], geartable: [0, 3, 90], airstation: [0, 3, 90],
  chrono: [0, 3, 90], teampit: [0, 4, 90], parkinggate: [0, 6, 90], turnstiles: [0, 4, 90],
}

export const LIFE_PREFABS: Record<string, PrefabDef & { category: string }> = {
  // ---------------- the field ----------------
  reftower: { category: 'Paintball', label: 'Referee tower', hint: 'A raised referee chair on legs, with a ladder and a sunshade; it faces the field', make: pf('Referee tower', (L) => [
    ...[[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]].map(([a, b]) => box('Tower leg', [0.25, 5, 0.25], L(a, 0, b), PB.steel)),
    box('Brace', [2.4, 0.15, 0.15], L(0, 2.4, -1.1), PB.steel), box('Brace', [2.4, 0.15, 0.15], L(0, 2.4, 1.1), PB.steel),
    box('Ref floor', [3, 0.25, 3], L(0, 5, 0), PB.planks, PB.wood),
    box('Rail', [3, 1, 0.12], L(0, 5.25, 1.44), PB.steel), box('Rail', [0.12, 1, 3], L(-1.44, 5.25, 0), PB.steel), box('Rail', [0.12, 1, 3], L(1.44, 5.25, 0), PB.steel),
    panel('Ref sign', 2.6, 0.8, L(0, 5.35, 1.53), say('REF ZONE', 3.25, '#141416', '#ffd23a')),
    box('Seat', [1, 0.15, 1], L(0, 5.95, -0.3), PB.black), box('Seat back', [1, 1.1, 0.15], L(0, 6.1, -0.8), PB.black),
    cyl('Shade pole', 0.12, 3.4, L(1.1, 5.25, -1.1), PB.steel, PB.steel, 6), { ...cyl('Sunshade', 3.6, 0.7, L(1.1, 8.65, -1.1), PB.orange, PB.yellow, 8), taper: 0 },
    box('Ladder rail', [0.12, 5.3, 0.12], L(-0.45, 0, -1.6), PB.steel), box('Ladder rail', [0.12, 5.3, 0.12], L(0.45, 0, -1.6), PB.steel),
    ...[0.5, 1.1, 1.7, 2.3, 2.9, 3.5, 4.1, 4.7].map((h) => box('Rung', [0.8, 0.1, 0.1], L(0, h, -1.6), PB.steel)),
  ]) },
  scoreboard: { category: 'Paintball', label: 'Scoreboard', hint: 'A field scoreboard on two posts; it faces the field', make: pf('Scoreboard', (L) => [
    ...[-4.5, 4.5].map((a) => cyl('Board post', 0.4, 9.6, L(a, 0, -0.1), PB.steel, PB.steel, 8)),
    box('Scoreboard', [10, 3.6, 0.5], L(0, 5.6, 0), PB.black, PB.black),
    panel('Score', 9.4, 3, L(0, 5.9, 0.28), say('RED 3:2 BLUE', 3.13, '#111114', '#ffd23a', 0.05)),
    box('Board header', [7.2, 0.9, 0.4], L(0, 9.2, 0), PB.black), panel('Header', 7, 0.8, L(0, 9.25, 0.23), say('FIELD 1', 8, '#c22a22', '#ffffff', 0.05)),
  ]) },
  teamflag: { category: 'Paintball', label: 'Team flag', hint: 'A team flag on a tall pole', ...pfp('Team flag', [teamParam('red')], (L, p) => {
    const [, color, text] = team(p)
    return [
      { ...cyl('Flag base', 1.2, 0.4, L(0, 0, 0), PB.concrete, PB.concrete, 10), taper: 0.8 }, cyl('Flag pole', 0.2, 10, L(0, 0.4, 0), PB.steel, PB.steel, 8),
      { ...cyl('Pole cap', 0.4, 0.3, L(0, 10.4, 0), PB.yellow, PB.yellow, 8), taper: 0.3 },
      panel('Flag', 3.4, 2.2, L(1.8, 7.8, 0), say(text, 1.55, color, '#ffffff', 0.05)),
    ]
  }) },
  startbox: { category: 'Paintball', label: 'Start box', hint: 'A team start box: a painted outline, a buzzer post and the team name; players start in it facing +Z', ...pfp('Start box', [teamParam('red')], (L, p) => {
    const [tex, color, text] = team(p)
    const line = (w: number, d: number, x: number, z: number) => box('Start box paint', [w, 0.05, d], L(x, 0, z), tex, tex)
    return [
      line(14, 0.5, 0, -3.75), line(14, 0.5, 0, 3.75), line(0.5, 7, -6.75, 0), line(0.5, 7, 6.75, 0),
      cyl('Buzzer post', 0.25, 3.2, L(7.6, 0, -3.75), PB.steel, PB.steel, 8), { ...box('Buzzer', [0.6, 0.6, 0.6], L(7.6, 3.2, -3.75), tex), bevel: 0.15 },
      cyl('Sign post', 0.2, 2.4, L(-7.6, 0, -3.75), PB.steel, PB.steel, 6), panel('Team sign', 2.8, 1.1, L(-7.6, 2.4, -3.75), say(text, 2.55, color, '#ffffff')),
    ]
  }) },
  spectatorstand: { category: 'Paintball', label: 'Spectator stand', hint: 'Four rows of seats behind a safety net; it faces the field', ...pfp('Spectator stand', [{ key: 'w', label: 'Width', kind: 'number', min: 8, max: 40, step: 1, default: 14 }], (L, p) => {
    const w = +p.w
    return [
      stairs('Bleachers', [w, 4, 6.4], L(0, 0, 0), PB.wood, PB.steel, 0, 4), box('Back rail', [w, 1.2, 0.15], L(0, 4, -3.2), PB.steel),
      box('Safety net', [w + 0.6, 6, 0.08], L(0, 0.2, 4.4), NET, NET), ...[-w / 2 - 0.3, 0, w / 2 + 0.3].map((a) => cyl('Net pole', 0.3, 6.6, L(a, 0, 4.4), PB.steel, PB.steel, 6)),
    ]
  }) },
  geartable: { category: 'Paintball', label: 'Gear table', hint: 'A folding table of markers, masks and paint pods; players stand on its +Z side', make: pf('Gear table', (L) => [
    box('Table top', [6, 0.15, 2.4], L(0, 1.6, 0), PLASTIC), ...[[-2.7, -1], [2.7, -1], [-2.7, 1], [2.7, 1]].map(([a, b]) => box('Table leg', [0.12, 1.6, 0.12], L(a, 0, b), PB.steel)),
    ...marker(L, -2, 1.75, -0.2, PB.black), ...marker(L, -1, 1.75, -0.2, PB.blue), ...marker(L, 1.6, 1.75, -0.2, PB.red),
    ...mask(L, 0.3, 1.75, 0.5, PB.black), ...mask(L, 2.6, 1.75, 0.5, PB.red),
    ...[0, 0.35, 0.7].map((d) => lying('Paint pod', 0.35, 0.9, L(0.4, 1.75 + 0.01, -0.6 + d), PB.yellow, CY.white, 8, 90)),
  ]) },
  airstation: { category: 'Paintball', label: 'Air fill station', hint: 'Tall air tanks chained to a board, with a fill panel and its sign; faces +Z', make: pf('Air fill station', (L) => [
    ...[-1.6, 1.6].map((a) => box('Board post', [0.25, 5, 0.25], L(a, 0, -0.3), PB.steel)), box('Board', [3.6, 2.6, 0.2], L(0, 1.4, -0.3), PB.plywood),
    panel('Air sign', 3.4, 1, L(0, 4, -0.18), say('AIR FILL', 3.4, '#f2c218', '#141416')),
    ...[[-1.1, TANK_GREEN], [0, PB.black], [1.1, TANK_GREEN]].map(([a, t]) => ({ ...cyl('Air tank', 0.8, 4.4, L(a as number, 0, 0.3), t as Tex, t as Tex, 12), bevel: 0 })),
    box('Tank chain', [3.2, 0.12, 0.12], L(0, 3, 0.72), PB.steel),
    { ...box('Fill panel', [1.2, 0.8, 0.3], L(0, 1.8, -0.05), PB.steel), bevel: 0.05 }, ...[-0.3, 0.3].map((a) => cyl('Gauge', 0.3, 0.05, L(a, 2.15, 0.1), CY.white, CY.white, 10)),
    lying('Fill hose', 0.12, 1.6, L(0.9, 1.6, 0.15), PB.black, PB.black, 6, 90),
  ]) },
  chrono: { category: 'Paintball', label: 'Chrono station', hint: 'Where markers have their speed checked: a stand, a chrono and its sign; faces +Z', make: pf('Chrono station', (L) => [
    box('Chrono stand', [1.6, 1.4, 1], L(0, 0, 0), PB.plywood), { ...box('Chrono', [0.8, 0.4, 0.5], L(0, 1.4, 0), PB.black), bevel: 0.08 },
    cyl('Sign post', 0.15, 3, L(-1.2, 0, -0.3), PB.steel, PB.steel, 6), panel('Chrono sign', 2, 0.8, L(-1.2, 3, -0.3), say('CHRONO', 2.5, '#1d4fa8', '#ffffff')),
    { ...cyl('Barrel bag bin', 1, 1.2, L(1.4, 0, 0.2), PB.orange, PB.orange, 10), taper: 1.15 },
  ]) },
  teampit: { category: 'Paintball', label: 'Team pit', hint: 'A team canopy over a bench, with paint boxes and a cooler; open to +Z', ...pfp('Team pit', [teamParam('red')], (L, p) => {
    const [tex] = team(p)
    return [
      ...[[-3, -3], [3, -3], [-3, 3], [3, 3]].map(([a, b]) => box('Canopy leg', [0.15, 4.4, 0.15], L(a, 0, b), PB.steel)),
      box('Canopy', [6.6, 0.3, 6.6], L(0, 4.4, 0), tex), { ...cyl('Canopy peak', 9.3, 1.2, L(0, 4.7, 0), tex, tex, 4, 45), taper: 0 },
      box('Back screen', [6, 2.4, 0.06], L(0, 1.6, -3), tex),
      box('Bench seat', [5, 0.25, 1.1], L(0, 0.8, -2), PB.wood), ...[-2.2, 2.2].map((a) => box('Bench leg', [0.2, 0.8, 1], L(a, 0, -2), PB.black)),
      { ...box('Cooler', [1.4, 1, 0.9], L(2.2, 0, 1.6), CY.white, PB.blue), bevel: 0.12 },
      { ...box('Paint box', [1.8, 1.1, 1.3], L(-2, 0, 1.4), CARDBOARD), bevel: 0.05 }, { ...box('Paint box', [1.8, 1.1, 1.3], L(-2, 1.1, 1.4), CARDBOARD), bevel: 0.05 },
    ]
  }) },
  paintboxes: { category: 'Paintball', label: 'Paint boxes', hint: 'Cases of paintballs stacked on a pallet', make: pf('Paint boxes', (L) => [
    box('Pallet', [4, 0.5, 3], L(0, 0, 0), PB.wood),
    ...[[-1, -0.7, 0], [1, -0.7, 0], [-1, 0.7, 0], [1, 0.7, 0], [-1, -0.7, 1], [0.9, 0.6, 1], [0, 0, 2]].map(([a, b, k]) =>
      ({ ...box('Paint box', [1.8, 1.1, 1.3], L(a, 0.5 + k * 1.1, b), CARDBOARD, say('', 1.6, '#a8834f', '#2b2014', 0.3)), bevel: 0.05, fit: true })),
  ]) },
  banner: { category: 'Paintball', label: 'Sponsor banner', hint: 'A sponsor banner on two posts (both faces printed)', ...pfp('Sponsor banner', [wording(SPONSOR, 'SPLAT CITY'), bannerColor('blue')], (L, p) => {
    const [bg, ink] = BANNER_COLORS[String(p.color)] ?? BANNER_COLORS.blue
    return [
      ...[-4.1, 4.1].map((a) => cyl('Banner post', 0.2, 3.6, L(a, 0, 0), PB.steel, PB.steel, 6)),
      panel('Sponsor banner', 8, 2, L(0, 1.3, 0), say(String(p.text), 4, bg, ink)),
    ]
  }) },
  warningsign: { category: 'Paintball', label: 'Warning sign', hint: 'A sign on a post: masks on, no blind fire, keep out…', ...pfp('Warning sign', [wording(WARN, 'MASKS ON'), bannerColor('yellow')], (L, p) => {
    const [bg, ink] = BANNER_COLORS[String(p.color)] ?? BANNER_COLORS.yellow
    return [cyl('Sign post', 0.2, 3.4, L(0, 0, 0), PB.steel, PB.steel, 6), panel('Warning sign', 2.6, 1.3, L(0, 2.1, 0.13), say(String(p.text), 2, bg, ink))]
  }) },
  floodlight: { category: 'Paintball', label: 'Floodlight pole', hint: 'A tall pole with three lamps facing +Z (add a light in front of it)', make: pf('Floodlight', (L) => [
    { ...cyl('Light pole', 0.7, 16, L(0, 0, 0), PB.steel, PB.steel, 10), taper: 0.6 }, box('Lamp bar', [5, 0.35, 0.35], L(0, 15.6, 0.3), PB.steel),
    ...[-1.8, 0, 1.8].flatMap((a) => [{ ...box('Lamp', [1.3, 1, 0.6], L(a, 15, 0.7), PB.black), bevel: 0.1 }, box('Lamp glass', [1.1, 0.8, 0.05], L(a, 15.1, 1.02), GLOW)]),
  ]) },

  roadsign: { category: 'Street', label: 'Road sign', hint: 'A big green road sign on two posts', make: pf('Road sign', (L) => [
    ...[-3, 3].map((a) => cyl('Sign post', 0.35, 6.4, L(a, 0, 0), PB.steel, PB.steel, 8)),
    panel('Road sign', 7.2, 2.5, L(0, 4.2, 0.22), say('EXIT 12', 2.9, '#1f6a3a', '#ffffff', 0.15)),
  ]) },

  // ---------------- city fields ----------------
  trashbags: { category: 'Street', label: 'Trash bags', hint: 'A heap of black trash bags', make: pf('Trash bags', (L) => [
    ...[[0, 0, 1.6, 1.2], [1.3, 0.4, 1.4, 1], [-1.2, 0.5, 1.5, 1.1], [0.4, -1.1, 1.3, 0.9], [0.2, 0.2, 1.2, 0.8]].map(([a, b, d, h], i) =>
      sack(L(a, i === 4 ? 1 : 0, b), d, h, BAG, i * 37)).flat(),
  ]) },
  parkinggate: { category: 'Street', label: 'Parking gate', hint: 'A ticket booth with a striped barrier arm across +Z of it', make: pf('Parking gate', (L) => [
    { ...box('Ticket booth', [2.6, 3.4, 2.6], L(-1.6, 0, 0), PB.concrete, CY.white), bevel: 0.1 }, box('Booth window', [2.7, 1.2, 1.8], L(-1.6, 1.6, 0), { gen: 'paint', tweak: { color: '#25313b', accent: '#1a2229', scale: 2, wear: 0, seed: 330 }, surface: 9 }),
    box('Booth roof', [3.2, 0.3, 3.2], L(-1.6, 3.4, 0), PB.steel),
    { ...box('Gate post', [0.6, 1.4, 0.6], L(0.6, 0, 0), PB.yellow), bevel: 0.08 }, lying('Barrier arm', 0.25, 7, L(4.3, 1.15, 0), { gen: 'hazard', tweak: { color: '#e8e8e0', accent: '#c22a22', seed: 479 } }, CY.white, 8),
    panel('Exit sign', 2, 0.7, L(-1.6, 3.9, 1.3), say('EXIT', 2.85, '#1f7a34', '#ffffff')),
  ]) },
  parkingbay: { category: 'Street', label: 'Parking bays', hint: 'Painted bay lines with wheel stops (walk over them)', ...pfp('Parking bays', [{ key: 'n', label: 'Bays', kind: 'number', min: 1, max: 10, step: 1, default: 4 }], (L, p) => {
    const n = +p.n, w = 6
    return [
      ...[...Array(n + 1)].map((_, i) => box('Bay line paint', [0.3, 0.04, 10], L((i - n / 2) * w, 0, 0), PAINT_LINE)),
      ...[...Array(n)].map((_, i) => ({ ...box('Wheel stop', [3, 0.28, 0.5], L((i - n / 2 + 0.5) * w, 0, -4.2), PB.concrete), bevel: 0.06 })),
    ]
  }) },
  turnstiles: { category: 'Street', label: 'Turnstiles', hint: 'A row of ticket gates to walk through along Z', make: pf('Turnstiles', (L) => [
    ...[-3.9, -1.3, 1.3, 3.9].map((a) => ({ ...box('Gate post', [0.7, 2, 1.8], L(a, 0, 0), PB.steel), bevel: 0.1 })),
    ...[-2.6, 0, 2.6].map((a) => box('Gate arm', [1.6, 0.12, 0.12], L(a, 1.4, 0.5), PB.steel)),
    ...[-3.9, -1.3, 1.3, 3.9].map((a) => box('Ticket light', [0.4, 0.1, 0.3], L(a, 2, 0.6), { gen: 'paint', tweak: { color: '#20c040', accent: '#106020', scale: 2, wear: 0, seed: 357 }, surface: 17 })),
  ]) },
  lanterns: { category: 'Street', label: 'Lantern string', hint: 'Paper lanterns on a line between two poles', ...pfp('Lantern string', [{ key: 'len', label: 'Length', kind: 'number', min: 6, max: 40, step: 1, default: 14 }], (L, p) => {
    const len = +p.len, n = Math.max(2, Math.round(len / 2.4))
    return [
      ...[-len / 2, len / 2].map((a) => cyl('Lantern pole', 0.3, 7, L(a, 0, 0), PB.wood, PB.wood, 8)),
      lying('Lantern line', 0.06, len, L(0, 6.6, 0), PB.black, PB.black, 4),
      ...[...Array(n)].map((_, i) => ({ ...cyl('Lantern', 0.8, 1, L(-len / 2 + (len * (i + 0.5)) / n, 5.5, 0), LANTERN, LANTERN, 10), bevel: 0 })),
    ]
  }) },
  producecrates: { category: 'Street', label: 'Produce crates', hint: 'Stacked crates of fruit and vegetables', make: pf('Produce crates', (L) => [
    ...[[-1.1, 0, 0, '#e07a1a'], [1.1, 0, 0, '#3f8a2c'], [0, 0, 1.6, '#c8322a'], [-0.6, 1.2, 0.4, '#f2c218']].flatMap(([a, y, b, c], i) => [
      box('Crate', [2, 1.2, 1.5], L(a as number, y as number, b as number), PB.wood, PB.planks),
      box('Produce', [1.8, 0.12, 1.3], L(a as number, (y as number) + 1.2, b as number), { gen: 'gravel', tweak: { color: c as string, accent: '#3a2a18', scale: 12, wear: 0.2, seed: 480 + i } }),
    ]),
  ]) },
  dish: { category: 'Industrial', label: 'Satellite dish', hint: 'A rooftop satellite dish on a frame', make: pf('Satellite dish', (L) => [
    box('Dish frame', [1.6, 0.4, 1.6], L(0, 0, 0), PB.steel), cyl('Dish post', 0.3, 2, L(0, 0.4, 0), PB.steel, PB.steel, 8),
    { ...cyl('Dish', 3, 0.8, L(0, 2.2, 0), CY.white, CY.white, 16), taper: 0.35 }, cyl('Dish arm', 0.1, 1.4, L(0, 3, 0), PB.steel, PB.steel, 6),
  ]) },
  grindrail: { category: 'Fun & games', label: 'Grind rail', hint: 'A low skate rail on legs', make: pf('Grind rail', (L) => [
    lying('Rail', 0.3, 10, L(0, 1.1, 0), PB.steel, PB.steel, 8), ...[-4.2, 0, 4.2].flatMap((a) => [box('Rail leg', [0.2, 1.1, 0.2], L(a, 0, 0), PB.steel), box('Rail foot', [0.8, 0.1, 0.8], L(a, 0, 0), PB.steel)]),
  ]) },
  clothesline: { category: 'Street', label: 'Clothesline', hint: 'Washing hung on a line between two posts', make: pf('Clothesline', (L) => [
    ...[-5, 5].map((a) => box('Line post', [0.25, 4.4, 0.25], L(a, 0, 0), PB.wood)), lying('Clothes line', 0.05, 10, L(0, 4.1, 0), PB.black, PB.black, 4),
    ...[[-3.4, '#e8e4dc'], [-1.4, '#5a8ac8'], [0.6, '#c8504a'], [2.6, '#e8d070']].map(([a, c], i) => box('Washing', [1.6, 1.8, 0.04], L(a as number, 2.25, 0), LINEN(c as string, 481 + i))),
  ]) },
  firepit: { category: 'Nature', label: 'Fire pit', hint: 'A ring of stones round charred logs', make: pf('Fire pit', (L) => [
    ...[...Array(9)].map((_, i) => { const a = (i / 9) * Math.PI * 2; return { ...cyl('Stone', 0.8, 0.5, L(Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5), ROCK, ROCK, 6, i * 40), taper: 0.6 } }),
    cyl('Embers', 2, 0.1, L(0, 0, 0), EMBER, EMBER, 12), lying('Log', 0.4, 2, L(0, 0.1, 0), PB.wood, PB.wood, 8, 30), lying('Log', 0.4, 2, L(0, 0.35, 0), PB.wood, PB.wood, 8, 120),
  ]) },
}
