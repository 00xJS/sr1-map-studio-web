// Signs with your own words, and photo frames for your own pictures. A sign's
// text is part of its settings and drawn into a generated texture (a recipe,
// so it shares like any other); a frame shows a stand-in picture until you
// choose a photo in its panel. Front of both = +Z; on a wall the back is z = 0.
import { box, cyl, type Part, type Tex } from './sampleKit'
import { group, local, type ParamDef, type Params, type PrefabDef } from './prefabs'
import { SIGN_STYLES, signText, type SignStyle } from './signFont'

type Lf = (dx: number, dy: number, dz: number) => [number, number, number]
type Def = PrefabDef & { category: string }

const id = (name: string, x: number, y: number, z: number) => `${name}@${+x.toFixed(2)},${+y.toFixed(2)},${+z.toFixed(2)}`
const pfp = (name: string, params: ParamDef[], make: (L: Lf, p: Params) => Part[]) => ({
  params,
  make: (x: number, z: number, rot: number, y: number, given?: Params) => {
    const p = Object.fromEntries(params.map((d) => [d.key, given?.[d.key] ?? d.default]))
    return group(id(name, x, y, z), local(x, y, z, rot, (L) => make(L, p)))
  },
})
const num = (key: string, label: string, min: number, max: number, def: number, step = 1): ParamDef => ({ key, label, kind: 'number', min, max, step, default: def })
const sel = (key: string, label: string, options: [string, string][], def: string): ParamDef => ({ key, label, kind: 'select', options, default: def })

const metal = (color: string, seed: number): Tex => ({ gen: 'metal_plate', tweak: { color, accent: color, scale: 1, wear: 0.1, seed }, surface: 15 })
const POLE = metal('#8d9399', 701)
const DARK = metal('#232326', 702)
const WOOD: Tex = { gen: 'wood_planks', tweak: { color: '#4a3324', accent: '#2e1f15', scale: 3, wear: 0.15, seed: 703 }, surface: 21 }

// ---------------- text signs ----------------

/** The rim round a sign's board, by style. */
const RIM: Record<SignStyle, Tex> = {
  street: metal('#a7adb3', 704), shop: WOOD, plaque: metal('#7a6128', 705), neon: DARK,
  plain: { gen: 'paint', tweak: { color: '#d8d5cc', accent: '#c4c0b6', scale: 2, wear: 0.05, seed: 706 }, surface: 17 },
}

/** The board's face: your words drawn into a generated texture. */
export function signFace(p: Params): Tex {
  const style = (Object.hasOwn(SIGN_STYLES, String(p.style)) ? p.style : 'street') as SignStyle
  const own = SIGN_STYLES[style]
  const hex = (v: unknown, def: string) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : def)
  return {
    gen: 'lettering', surface: 15,
    tweak: { text: signText(String(p.text ?? '')), style, color: hex(p.color, own.color), accent: hex(p.letters, own.accent), scale: +Math.max(0.25, Math.min(16, +p.w / +p.h)).toFixed(2), wear: 0, seed: 1 },
  }
}

const STYLE_OPTIONS = Object.entries(SIGN_STYLES).map(([k, v]): [string, string] => [k, v.label])
const look = (p: Params) => SIGN_STYLES[(Object.hasOwn(SIGN_STYLES, String(p.style)) ? p.style : 'street') as SignStyle]
const SIGN_PARAMS: ParamDef[] = [
  { key: 'text', label: 'Text', kind: 'text', default: 'MAIN ST', hint: 'Shows in capitals: two lines of up to 24 letters.' },
  sel('style', 'Style', STYLE_OPTIONS, 'street'),
  { key: 'color', label: 'Background', kind: 'color', default: '', auto: (p) => look(p).color },
  { key: 'letters', label: 'Letters', kind: 'color', default: '', auto: (p) => look(p).accent },
  sel('mount', 'Mounted', [['post', 'On a post'], ['stand', 'Between two posts'], ['wall', 'Flat on a wall'], ['hanging', 'Sticking out from a wall']], 'post'),
  num('w', 'Width', 1, 40, 6, 0.5),
  num('h', 'Height', 0.5, 16, 1.5, 0.25),
  num('lift', 'Height off the ground', 0, 40, 5, 0.5),
]

function signParts(L: Lf, p: Params): Part[] {
  const w = +p.w, h = +p.h, lift = +p.lift, t = 0.14, rim = 0.06
  const face = signFace(p), edge = RIM[(face as { tweak: { style: SignStyle } }).tweak.style]
  const label = 'Sign'
  /** The board centred at (cx, cz), facing +Z (turned by r), with words on the front (and the back). */
  const board = (cx: number, cz: number, r: number, twoSided: boolean): Part[] => {
    const [fx, fz] = r === 90 ? [t / 2 + 0.01, 0] : [0, t / 2 + 0.01]
    const out: Part[] = [box(label + ' board', [w + 2 * rim, h + 2 * rim, t], L(cx, lift - rim, cz), edge, edge, r)]
    out.push({ ...box(label, [w, h, 0.02], L(cx + fx, lift, cz + fz), edge, face, r), fit: true })
    if (twoSided) out.push({ ...box(label + ' back', [w, h, 0.02], L(cx - fx, lift, cz - fz), edge, face, r + 180), fit: true })
    return out
  }
  switch (p.mount) {
    case 'wall': return board(0, t / 2, 0, false)
    case 'stand': return [
      ...board(0, 0, 0, true),
      ...[-1, 1].flatMap((s) => [cyl('Sign post', 0.28, lift + h + rim, L(s * (w / 2 + rim + 0.14), 0, 0), POLE, POLE, 10), box('Post foot', [0.6, 0.08, 0.6], L(s * (w / 2 + rim + 0.14), 0, 0), POLE)]),
    ]
    case 'hanging': {
      // A bracket out from the wall with the board hanging under it, read from up and down the street.
      const z0 = 0.4, cz = z0 + w / 2
      return [
        ...board(0, cz, 90, true),
        box('Bracket', [0.14, 0.14, w + z0 + 0.3], L(0, lift + h + rim + 0.3, (w + z0 + 0.3) / 2), DARK),
        box('Wall plate', [0.6, 0.8, 0.06], L(0, lift + h + rim, 0.03), DARK),
        ...[cz - w * 0.35, cz + w * 0.35].map((z) => box('Hanger', [0.05, 0.3, 0.05], L(0, lift + h + rim, z), DARK)),
      ]
    }
    default: return [
      ...board(0, 0, 0, true),
      cyl('Sign post', 0.24, lift, L(0, 0, 0), POLE, POLE, 10),
      cyl('Post base', 0.5, 0.12, L(0, 0, 0), POLE, POLE, 10),
    ]
  }
}

// ---------------- photo frames ----------------

/** What an empty frame shows. The same for every frame, so a chosen photo stays when the frame is changed. */
export const PICTURE: Tex = { gen: 'picture', tweak: { seed: 1 }, surface: 5 }

const SHAPES: Record<string, [string, number]> = { landscape: ['Landscape (4:3)', 4 / 3], portrait: ['Portrait (3:4)', 3 / 4], square: ['Square', 1], wide: ['Wide (16:9)', 16 / 9] }
/** Width over height of a frame's picture. */
export const photoAspect = (p: Params) => (SHAPES[String(p.shape)] ?? SHAPES.landscape)[1]

const FRAMES: Record<string, Tex> = {
  wood: WOOD, black: DARK, gold: metal('#c9a23a', 707),
  white: { gen: 'paint', tweak: { color: '#ecebe6', accent: '#dcdad3', scale: 2, wear: 0.03, seed: 708 }, surface: 17 },
}

function frameParts(L: Lf, p: Params): Part[] {
  const w = +p.w, h = w / photoAspect(p), b = Math.max(0.12, w * 0.07), d = 0.16
  const lift = p.mount === 'stand' ? Math.max(1.5, +p.lift) : +p.lift
  const fr = FRAMES[String(p.frame)] ?? WOOD
  const cz = d / 2
  const out: Part[] = [
    box('Frame back', [w + 2 * b, h + 2 * b, 0.06], L(0, lift - b, 0.03), fr),
    { ...box('Photo', [w, h, 0.02], L(0, lift, 0.07), fr, PICTURE), fit: true },
    box('Frame', [w + 2 * b, b, d], L(0, lift - b, cz), fr),
    box('Frame', [w + 2 * b, b, d], L(0, lift + h, cz), fr),
    box('Frame', [b, h, d], L(-(w + b) / 2, lift, cz), fr),
    box('Frame', [b, h, d], L((w + b) / 2, lift, cz), fr),
  ]
  if (p.mount === 'stand') {
    // A display stand: two uprights behind the frame and a ledge under it.
    out.push(
      ...[-1, 1].map((s) => box('Stand leg', [0.16, lift + h * 0.7, 0.16], L(s * w * 0.3, 0, -0.1), DARK)),
      box('Stand ledge', [w + 2 * b, 0.1, 0.4], L(0, lift - b - 0.1, 0.1), DARK),
      box('Stand foot', [w * 0.8, 0.08, 1.4], L(0, 0, -0.1), DARK),
    )
  }
  return out
}

const FRAME_PARAMS: ParamDef[] = [
  sel('shape', 'Shape', Object.entries(SHAPES).map(([k, [l]]): [string, string] => [k, l]), 'landscape'),
  num('w', 'Width', 1, 30, 3, 0.5),
  sel('frame', 'Frame', [['wood', 'Wood'], ['black', 'Black'], ['gold', 'Gold'], ['white', 'White']], 'wood'),
  sel('mount', 'Mounted', [['wall', 'On a wall'], ['stand', 'On a stand']], 'wall'),
  num('lift', 'Height off the ground', 0, 40, 3, 0.5),
]

export const SIGN_PREFABS: Record<string, Def> = {
  textsign: {
    category: 'Street', label: 'Sign', hint: 'A sign with your own words: street sign, shop board, plaque or neon, on a post or a wall',
    keywords: ['text', 'label', 'words', 'name', 'street sign', 'shop sign', 'board', 'plaque', 'neon', 'wall'],
    onWall: { mount: 'wall', lift: 0 },
    ...pfp('Sign', SIGN_PARAMS, signParts),
  },
  photoframe: {
    category: 'Furniture', label: 'Photo frame', hint: 'A frame for a photo of your own, on a wall or a stand; choose the photo in its panel',
    keywords: ['picture', 'photo', 'frame', 'painting', 'art', 'wall', 'image'],
    onWall: { mount: 'wall', lift: 0 },
    photo: true,
    ...pfp('Photo frame', FRAME_PARAMS, frameParts),
  },
}
