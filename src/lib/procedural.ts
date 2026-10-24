// Generated textures: nothing copied from anywhere, so they're free to share.
// Every pattern repeats exactly across the image (integer grids, noise that
// wraps around), so the result always tiles. Each kind suggests the matching
// physical surface (index into the 22 SR1 surface types).
import { SIGN_STYLES, layoutLine, lineDistance, signText, type SignStyle } from './signFont'

export type TextureKind =
  | 'concrete' | 'asphalt' | 'brick' | 'tiles' | 'metal_plate' | 'diamond_plate'
  | 'wood_planks' | 'grass' | 'dirt' | 'gravel' | 'sand'
  | 'facade' | 'storefront' | 'garage_door' | 'hazard' | 'matrix' | 'water'
  | 'chevrons' | 'emblem' | 'screen' | 'scoreboard' | 'banner'
  | 'poster' | 'graffiti' | 'sign'
  | 'lettering' | 'picture'

export interface GenParams {
  kind: TextureKind
  size: number
  color: string
  accent: string
  /** Pattern repeats across the image (bricks per column, planks, panels...). */
  scale: number
  /** 0..1: stains, rust, cracks and variation. */
  wear: number
  seed: number
  /** Asphalt only: painted center line. */
  line?: 'none' | 'yellow' | 'white'
  /** Windows only: brick wall between the windows. */
  bricks?: boolean
  /** Text signs only: the words (see signText) and the look. */
  text?: string
  style?: SignStyle
}

interface KindInfo { label: string; surface: number; color: string; accent: string; scale: number; wear: number; accentLabel: string; scaleLabel: string }

export const KINDS: Record<TextureKind, KindInfo> = {
  concrete: { label: 'Concrete', surface: 0, color: '#8d8b86', accent: '#5e5a54', scale: 4, wear: 0.4, accentLabel: 'Stains', scaleLabel: 'Patchiness' },
  asphalt: { label: 'Asphalt', surface: 0, color: '#3b3b3d', accent: '#e8c53a', scale: 4, wear: 0.3, accentLabel: 'Line color', scaleLabel: 'Patchiness' },
  brick: { label: 'Brick', surface: 0, color: '#8a3b2a', accent: '#b9b2a6', scale: 8, wear: 0.4, accentLabel: 'Mortar', scaleLabel: 'Rows' },
  tiles: { label: 'Tiles', surface: 3, color: '#d9d4c7', accent: '#8f8a80', scale: 4, wear: 0.2, accentLabel: 'Grout', scaleLabel: 'Tiles per side' },
  metal_plate: { label: 'Metal plates', surface: 15, color: '#7d848a', accent: '#8a4a22', scale: 2, wear: 0.3, accentLabel: 'Rust', scaleLabel: 'Panels per side' },
  diamond_plate: { label: 'Diamond plate', surface: 15, color: '#a5abb0', accent: '#6a7075', scale: 8, wear: 0.2, accentLabel: 'Shadow', scaleLabel: 'Bumps per side' },
  wood_planks: { label: 'Wood planks', surface: 21, color: '#9a6b3f', accent: '#5e3d22', scale: 6, wear: 0.3, accentLabel: 'Grain', scaleLabel: 'Planks' },
  grass: { label: 'Grass', surface: 11, color: '#4f7a2f', accent: '#8b8f3a', scale: 4, wear: 0.4, accentLabel: 'Dry patches', scaleLabel: 'Patchiness' },
  dirt: { label: 'Dirt', surface: 4, color: '#6e5238', accent: '#9a8770', scale: 4, wear: 0.5, accentLabel: 'Pebbles', scaleLabel: 'Patchiness' },
  gravel: { label: 'Gravel', surface: 12, color: '#8a857c', accent: '#4d4943', scale: 16, wear: 0.4, accentLabel: 'Gaps', scaleLabel: 'Stones per side' },
  sand: { label: 'Sand', surface: 19, color: '#d2b98a', accent: '#a8915f', scale: 6, wear: 0.4, accentLabel: 'Ripple shade', scaleLabel: 'Ripples' },
  facade: { label: 'Windows', surface: 0, color: '#b7a58a', accent: '#2e3b48', scale: 2, wear: 0.3, accentLabel: 'Glass', scaleLabel: 'Windows across' },
  storefront: { label: 'Storefront', surface: 15, color: '#2c2c30', accent: '#41617a', scale: 2, wear: 0.15, accentLabel: 'Glass', scaleLabel: 'Panes across' },
  garage_door: { label: 'Garage door', surface: 16, color: '#9aa0a6', accent: '#55595e', scale: 1, wear: 0.3, accentLabel: 'Grooves', scaleLabel: 'Doors across' },
  water: { label: 'Water', surface: 20, color: '#1f5470', accent: '#7fb6c9', scale: 6, wear: 0.4, accentLabel: 'Glints', scaleLabel: 'Ripples' },
  matrix: { label: 'Digital rain', surface: 15, color: '#020a04', accent: '#36ff6b', scale: 24, wear: 0.5, accentLabel: 'Glow', scaleLabel: 'Columns' },
  banner: { label: 'Sign / banner', surface: 15, color: '#1d4fa8', accent: '#ffffff', scale: 4, wear: 0.15, accentLabel: 'Lettering', scaleLabel: 'Width ÷ height' },
  hazard: { label: 'Hazard stripes', surface: 15, color: '#e8b81c', accent: '#1d1d1f', scale: 4, wear: 0.3, accentLabel: 'Stripe', scaleLabel: 'Stripes' },
  chevrons: { label: 'Lane arrows', surface: 15, color: '#0d1118', accent: '#18d8ff', scale: 3, wear: 0, accentLabel: 'Glow', scaleLabel: 'Arrows' },
  emblem: { label: 'Team emblem', surface: 15, color: '#120d14', accent: '#ff3dd8', scale: 8, wear: 0, accentLabel: 'Glow', scaleLabel: 'Grid lines' },
  screen: { label: 'Data screen', surface: 15, color: '#07141a', accent: '#18d8ff', scale: 9, wear: 0.3, accentLabel: 'Glow', scaleLabel: 'Text rows' },
  scoreboard: { label: 'Scoreboard', surface: 15, color: '#e8322b', accent: '#2a7fff', scale: 1, wear: 0, accentLabel: 'Right team', scaleLabel: 'Unused' },
  // Made to be stretched once over a panel (a poster, a sign, a tag on a wall) rather than repeated.
  poster: { label: 'Poster', surface: 5, color: '#c8322b', accent: '#f2c218', scale: 3, wear: 0.25, accentLabel: 'Print', scaleLabel: 'Text lines' },
  graffiti: { label: 'Graffiti tag', surface: 0, color: '#ff3dd8', accent: '#1d1d20', scale: 5, wear: 0.4, accentLabel: 'Outline', scaleLabel: 'Letters' },
  sign: { label: 'Shop sign', surface: 15, color: '#1d1d20', accent: '#f2c218', scale: 6, wear: 0.15, accentLabel: 'Letters', scaleLabel: 'Letters' },
  // Your own words on a board, stretched once over it (scale = its width over its height).
  lettering: { label: 'Text sign', surface: 15, color: '#1f6b3a', accent: '#ffffff', scale: 4, wear: 0, accentLabel: 'Letters', scaleLabel: 'Width ÷ height' },
  // What an empty photo frame shows until you choose a photo.
  picture: { label: 'Picture', surface: 5, color: '#8fb8de', accent: '#4f7a3f', scale: 1, wear: 0, accentLabel: 'Hills', scaleLabel: 'Unused' },
}

/** Kinds made only for one prefab (a photo frame's stand-in), left out of the texture pickers. */
export const PREFAB_ONLY: ReadonlySet<TextureKind> = new Set(['picture'])

export const defaultParams = (kind: TextureKind, size = 512): GenParams => {
  const k = KINDS[kind]
  const p: GenParams = { kind, size, color: k.color, accent: k.accent, scale: k.scale, wear: k.wear, seed: 1, line: kind === 'asphalt' ? 'yellow' : 'none' }
  if (kind === 'lettering') { p.text = 'YOUR TEXT'; p.style = 'street' }
  return p
}

// ---------------- noise that wraps ----------------

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

const mod = (a: number, n: number) => ((a % n) + n) % n
const smooth = (t: number) => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Value noise on a px × py lattice that wraps; u, v in [0, 1). */
function noise(u: number, v: number, px: number, py: number, seed: number): number {
  const x = u * px, y = v * py
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const tx = smooth(x - x0), ty = smooth(y - y0)
  const a = hash(mod(x0, px), mod(y0, py), seed), b = hash(mod(x0 + 1, px), mod(y0, py), seed)
  const c = hash(mod(x0, px), mod(y0 + 1, py), seed), d = hash(mod(x0 + 1, px), mod(y0 + 1, py), seed)
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty)
}

/** Fractal noise; every octave doubles the integer lattice, so it still wraps. */
function fbm(u: number, v: number, period: number, octaves: number, seed: number, stretch = 1): number {
  let sum = 0, amp = 0.5, norm = 0, p = period
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(u, v, p, Math.max(1, Math.round(p * stretch)), seed + o * 101)
    norm += amp; amp *= 0.5; p *= 2
  }
  return sum / norm
}

/** Wrapping cellular noise: distances to the nearest and second-nearest point, and the nearest cell's id. */
function cells(u: number, v: number, n: number, seed: number): [number, number, number] {
  const x = u * n, y = v * n
  const cx = Math.floor(x), cy = Math.floor(y)
  let d1 = 9, d2 = 9, id = 0
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const gx = cx + i, gy = cy + j
    const hx = mod(gx, n), hy = mod(gy, n)
    const px = gx + 0.15 + 0.7 * hash(hx, hy, seed), py = gy + 0.15 + 0.7 * hash(hx, hy, seed + 7)
    const d = Math.hypot(px - x, py - y)
    if (d < d1) { d2 = d1; d1 = d; id = hy * n + hx } else if (d < d2) d2 = d
  }
  return [d1, d2, id]
}

const rgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? parseInt(m[1], 16) : 0x808080
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const mix = (a: number[], b: number[], t: number) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const shade = (c: number[], k: number) => [c[0] * k, c[1] * k, c[2] * k]

// ---------------- lettering ----------------
// Made-up block letters (no font, nothing copied): each is a few of eight
// strokes on a 5 x 7 grid, picked from shapes that read like real letters.

/** Strokes: top, middle, bottom, upper left, lower left, upper right, lower right, centre. */
const STROKES: [number, number, number, number][] = [[0, 0, 1, 0], [0, 0.5, 1, 0.5], [0, 1, 1, 1], [0, 0, 0, 0.5], [0, 0.5, 0, 1], [1, 0, 1, 0.5], [1, 0.5, 1, 1], [0.5, 0, 0.5, 1]]
const LETTERS = [0b00011111, 0b01111010, 0b00011100, 0b01111100, 0b01111101, 0b01111011, 0b10000001, 0b10000101, 0b00011011, 0b00111011, 0b00011101, 0b01001111, 0b01101011, 0b10011100]
const letter = (k: number) => LETTERS[k % LETTERS.length]
/** Is grid cell (gx 0-4, gy 0-6) inked in letter `code`? */
function blockLetter(code: number, gx: number, gy: number): boolean {
  return STROKES.some(([x0, y0, x1, y1], i) => !!(code & (1 << i)) && gx >= x0 * 4 && gx <= x1 * 4 && gy >= y0 * 6 && gy <= y1 * 6)
}
/** Distance from (x, y) to the nearest stroke of a letter, in its 0-1 box. */
function strokeDist(code: number, x: number, y: number): number {
  let d = 9
  STROKES.forEach(([x0, y0, x1, y1], i) => {
    if (!(code & (1 << i))) return
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy
    const t = clamp01(((x - x0) * dx + (y - y0) * dy) / l2)
    d = Math.min(d, Math.hypot(x - x0 - t * dx, y - y0 - t * dy))
  })
  return d
}
const bright = (c: number[]) => (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255

// ---------------- patterns ----------------

/**
 * Made-up wording for signs, banners, flags and logos (the seed picks one; nothing here is a real brand).
 * A long banner (scale = its width over its height) shows it on one line, with a paint-splat mark when it is
 * long enough; a square tile (scale 1, for bunkers) puts a splat over the words.
 */
export const BANNERS = [
  'SPLAT CITY', 'MASKS ON', 'GAME ON', 'PAINT CHECK', 'AIR FILL', 'CHRONO', 'NO BLIND FIRE', 'REF ZONE', 'SAFE ZONE',
  'TEAM RED', 'TEAM BLUE', 'RED 3:2 BLUE', 'FIELD 1', 'BUNKER BROS', 'HOPPER HQ', 'PODS & PAINT', 'BARREL BAGS ON',
  'GO PAINT', 'SPLATTER', 'STAY BACK',
  'EXIT', 'DANGER', 'NO ENTRY', 'OPEN', 'PARKING', 'LEVEL 2', 'MIND THE GAP',
  'KEEP OUT', 'HARD HATS', 'FRESH FISH', 'NOODLES', 'SKATE AT OWN RISK', 'NO PARKING', 'EXIT 12', 'RED', 'BLUE',
  // Just the splat, for things seen from every side (a word would read backwards on half of them).
  '',
  // Street signs (added at the end so earlier picks keep their words).
  'STOP', 'PHONE', 'MAIL', 'BUS STOP', 'ONE WAY', 'SPEED LIMIT 35', 'TAXI', 'POLICE',
]

/** A 5 × 7 pixel font: seven rows of five bits per letter. */
const GLYPHS: Record<string, string> = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110', C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110', E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001', I: '01110 00100 00100 00100 00100 00100 01110',
  J: '00111 00010 00010 00010 00010 10010 01100', K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 11001 10101 10011 10001 10001 10001', O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000', Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100', U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100', W: '10001 10001 10001 10101 10101 10101 01010', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110', 2: '01110 10001 00001 00010 00100 01000 11111',
  3: '11110 00001 00001 01110 00001 00001 11110', 4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000', 8: '01110 10001 10001 01110 10001 10001 01110',
  9: '01110 10001 10001 01111 00001 00010 01100', ':': '00000 00100 00100 00000 00100 00100 00000', '&': '01100 10010 10100 01000 10101 10010 01101',
  '!': '00100 00100 00100 00100 00100 00000 00100', '-': '00000 00000 00000 11111 00000 00000 00000', '.': '00000 00000 00000 00000 00000 00000 00100',
}
const glyphBit = (ch: string, x: number, y: number) => GLYPHS[ch]?.[y * 6 + x] === '1'

/** Words onto lines of at most `max` letters. */
function wrapWords(text: string, max: number): string[] {
  const out: string[] = []
  for (const w of text.split(' ')) {
    if (out.length && out[out.length - 1].length + 1 + w.length <= max) out[out.length - 1] += ' ' + w
    else out.push(w)
  }
  return out
}

function bannerPattern(p: GenParams, base: number[], accent: number[], s: number, wear: number): Pixel {
  const aspect = Math.max(1, Math.min(8, p.scale))
  const pick = Math.abs(Math.round(p.seed)) % BANNERS.length, text = BANNERS[pick]
  // The paintball wording (the first 20) carries a splat; street and site signs are plain; '' is the splat alone.
  const splat = pick < 20 || !text, long = aspect >= 2
  const lines = !text ? [] : long ? [text] : wrapWords(text, 7).slice(0, 2)
  const n = Math.max(1, ...lines.map((l) => l.length))
  // Long banners: a splat mark on the left (when there's room), the words beside it. Tiles: a splat over the words.
  const markW = splat && aspect >= 3 ? 0.8 / aspect : 0
  const room = 0.84 - markW, high = long ? 0.56 : splat ? 0.3 : 0.6
  const ph = Math.min((room * aspect) / (6 * n - 1), high / (8 * lines.length - 1))
  const v0 = (long || !splat ? 0.5 : 0.74) - ((8 * lines.length - 1) * ph) / 2
  const [splatV, splatR] = text ? [0.33, 0.17] : [0.5, 0.26]
  const blob = (u: number, v: number, cu: number, cv: number, r: number) => {
    const dx = (u - cu) * aspect, dy = v - cv, a = Math.atan2(dy, dx)
    const edge = r * (1 + 0.12 * Math.sin(a * 7 + s) + 0.07 * Math.sin(a * 13 + s * 2))
    if (Math.hypot(dx, dy) < edge) return true
    // A few drops thrown off round it.
    for (let k = 0; k < 5; k++) {
      const b = (k / 5) * Math.PI * 2 + hash(k, 3, s) * 0.9, d = r * (1.3 + 0.2 * hash(k, 5, s))
      if (Math.hypot(dx - Math.cos(b) * d, dy - Math.sin(b) * d) < r * (0.08 + 0.08 * hash(k, 7, s))) return true
    }
    return false
  }
  const markU = 0.08 + markW / 2
  return (u, v) => {
    let c = shade(base, 0.95 + 0.08 * noise(u, v, 128, 128, s))
    const e = Math.min(u * aspect, (1 - u) * aspect, v, 1 - v)
    if (e > 0.045 && e < 0.075) c = accent
    if (markW ? blob(u, v, markU, 0.5, 0.26) : splat && (!long || !text) && blob(u, v, 0.5, splatV, splatR)) c = accent
    const li = Math.floor((v - v0) / (8 * ph))
    if (li >= 0 && li < lines.length) {
      const line = lines[li], lw = ((6 * line.length - 1) * ph) / aspect
      const u0 = (markW ? 0.08 + markW : 0) + (1 - (markW ? 0.08 + markW : 0) - lw) / 2 - (markW ? 0.04 : 0)
      const gx = Math.floor(((u - u0) * aspect) / ph), gy = Math.floor((v - v0 - li * 8 * ph) / ph)
      const ch = Math.floor(gx / 6)
      if (gx >= 0 && gy >= 0 && gy < 7 && ch < line.length && gx % 6 < 5 && glyphBit(line[ch], gx % 6, gy)) c = accent
    }
    const grime = clamp01((fbm(u, v, 4, 4, s + 3) - 0.62) * 4) * wear
    return mix(c, [70, 66, 60], grime * 0.5)
  }
}


/** Rounded rectangle inset into a board `aspect` wide and 1 high: negative inside. */
function roundRect(x: number, y: number, aspect: number, inset: number, r: number): number {
  const qx = Math.abs(x - aspect / 2) - (aspect / 2 - inset - r), qy = Math.abs(y - 0.5) - (0.5 - inset - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

/** A text sign: the board (scale = width over height), its border and the words, centred and as big as they fit. */
function letteringPattern(p: GenParams, base: number[], accent: number[], s: number, wear: number): Pixel {
  const style: SignStyle = p.style && Object.hasOwn(SIGN_STYLES, p.style) ? p.style : 'plain'
  const aspect = Math.max(0.25, Math.min(16, p.scale || 4))
  const pen = SIGN_STYLES[style].pen
  const lines = signText(p.text ?? '').split('\n').filter(Boolean).map((l) => layoutLine(l, pen))
  // Room for the words inside the border (board units: the height is 1).
  const margin = style === 'plain' ? 0.1 : style === 'plaque' || style === 'neon' ? 0.17 : 0.15
  const gapY = 2.2
  const textH = lines.length * 6 + (lines.length - 1) * gapY + 2 * pen
  const widest = Math.max(1, ...lines.map((l) => l.width + 2 * pen))
  const k = lines.length ? Math.min((aspect - 2 * margin) / widest, ((1 - 2 * margin) * (lines.length > 1 ? 1 : 0.8)) / textH) : 1
  const top = (1 - (textH - 2 * pen) * k) / 2
  const lx = lines.map((l) => (aspect - l.width * k) / 2), ly = lines.map((_, i) => top + i * (6 + gapY) * k)
  const size = Math.max(16, p.size)
  const aa = Math.max(aspect, 1) / size / k
  const reach = style === 'neon' ? pen + 4 : pen + 1
  /** Distance to the nearest letter stroke, in glyph units. */
  const dist = (x: number, y: number) => {
    let d = Infinity
    lines.forEach((l, i) => {
      const gx = (x - lx[i]) / k, gy = (y - ly[i]) / k
      if (gy < -reach || gy > 6 + reach || gx < -reach || gx > l.width + reach) return
      d = Math.min(d, lineDistance(l, gx, gy, reach))
    })
    return d
  }
  const ink = (d: number, r: number) => clamp01((r - d) / aa + 0.5)
  const white = [255, 255, 255], dark = [20, 18, 16]
  return (u, v) => {
    const x = u * aspect, y = v
    const edge = Math.min(x, aspect - x, y, 1 - y)
    const d = dist(x, y)
    let c: number[]
    if (style === 'street') {
      // Reflective sheet with a rounded border line in the letter color.
      c = shade(base, 0.96 + 0.06 * noise(u, v, 64, 64, s))
      c = mix(c, accent, clamp01((0.022 - Math.abs(roundRect(x, y, aspect, 0.055, 0.12))) / 0.006 + 0.5))
      c = mix(c, accent, ink(d, pen))
    } else if (style === 'shop') {
      // A painted board in a darker frame, letters with a dark edge and a drop shadow.
      c = shade(base, 0.9 + 0.1 * fbm(u, v, 3, 3, s) + 0.05 * noise(u, v, 48, 2, s + 1))
      if (edge < 0.075) c = shade(base, 0.5 + 0.08 * noise(u, v, 2, 64, s + 2))
      else if (edge < 0.09) c = shade(base, 1.25)
      c = mix(c, shade(base, 0.45), ink(dist(x - 0.35 * k, y - 0.45 * k), pen) * 0.8)
      c = mix(c, dark, ink(d, pen + 0.2))
      c = mix(c, accent, ink(d, pen))
    } else if (style === 'plaque') {
      // Brushed metal with a bevelled edge, a fine border, four screws and engraved letters.
      c = shade(base, 1.08 - 0.22 * y + 0.08 * noise(u, v, 2, 256, s))
      if (edge < 0.045) c = shade(base, x < 0.045 || y < 0.045 ? 1.3 : 0.7)
      c = mix(c, shade(base, 0.6), clamp01((0.008 - Math.abs(roundRect(x, y, aspect, 0.085, 0.03))) / 0.004 + 0.5))
      for (const [sx, sy] of [[0.13, 0.15], [aspect - 0.13, 0.15], [0.13, 0.85], [aspect - 0.13, 0.85]]) {
        const r = Math.hypot(x - sx, y - sy)
        if (r < 0.032) c = Math.abs(x - sx) < 0.005 && r < 0.026 ? shade(base, 0.45) : shade(base, 1.2 - 4 * (y - sy))
      }
      c = mix(c, shade(base, 1.4), ink(dist(x, y - 0.25 * k), pen))
      c = mix(c, accent, ink(d, pen))
    } else if (style === 'neon') {
      // Glass tubes on a dark backing: a soft glow, the tube, a hot white core.
      c = shade(base, 0.9 + 0.15 * fbm(u, v, 4, 3, s))
      c = mix(c, accent, 0.6 * Math.exp(-Math.max(0, d - pen) / 1.3))
      c = mix(c, accent, ink(d, pen))
      c = mix(c, mix(accent, white, 0.7), ink(d, pen * 0.4))
    } else {
      c = mix(shade(base, 0.98 + 0.04 * noise(u, v, 32, 32, s)), accent, ink(d, pen))
    }
    const grime = clamp01((fbm(u, v, 4, 4, s + 3) - 0.6) * 4) * wear
    return shade(c, 1 - 0.35 * grime)
  }
}

type Pixel = (u: number, v: number) => number[]

/** Seven-segment digits (segments a..g as bits 6..0), for screens and scoreboards. */
const SEG7 = [0b1111110, 0b0110000, 0b1101101, 0b1111001, 0b0110011, 0b1011011, 0b1011111, 0b1110000, 0b1111111, 0b1111011]
/** Is (x, y), 0..1 across a digit's box, on a lit segment of digit d? */
function seg7(d: number, x: number, y: number, tx = 0.2, ty = tx / 2): boolean {
  if (x < 0 || x > 1 || y < 0 || y > 1) return false
  const on = (k: number) => (SEG7[d] >> (6 - k)) & 1
  const midX = x > tx * 0.7 && x < 1 - tx * 0.7, top = y > ty * 0.7 && y < 0.5 - ty * 0.2, low = y > 0.5 + ty * 0.2 && y < 1 - ty * 0.7
  return (!!on(0) && y < ty && midX) || (!!on(1) && x > 1 - tx && top) || (!!on(2) && x > 1 - tx && low)
    || (!!on(3) && y > 1 - ty && midX) || (!!on(4) && x < tx && low) || (!!on(5) && x < tx && top) || (!!on(6) && Math.abs(y - 0.5) < ty / 2 && midX)
}

function pattern(p: GenParams): Pixel {
  const base = rgb(p.color), accent = rgb(p.accent)
  const s = p.seed * 7919
  const wear = clamp01(p.wear)
  const n = Math.max(1, Math.round(p.scale))
  switch (p.kind) {
    case 'concrete': return (u, v) => {
      let c = shade(base, 0.82 + 0.3 * fbm(u, v, 4, 6, s))
      c = shade(c, 0.94 + 0.12 * noise(u, v, 256, 256, s + 3))
      const stain = clamp01((fbm(u, v, n, 4, s + 9) - 0.62 + wear * 0.25) * 4)
      return mix(c, accent, stain * wear)
    }
    case 'asphalt': return (u, v) => {
      let c = shade(base, 0.85 + 0.3 * noise(u, v, 512, 512, s) * noise(u, v, 128, 128, s + 1))
      if (hash(Math.floor(u * 1024), Math.floor(v * 1024), s) > 0.985) c = shade(c, 1.6)
      const patch = clamp01((fbm(u, v, n, 4, s + 5) - 0.6) * 5) * wear
      c = shade(c, 1 - 0.25 * patch)
      if (p.line && p.line !== 'none' && Math.abs(u - 0.5) < 0.022 && v % 0.5 < 0.3) {
        const paint = p.line === 'white' ? [235, 235, 230] : accent
        c = mix(c, paint, 0.85 - 0.4 * wear * fbm(u, v, 32, 3, s + 11))
      }
      return c
    }
    case 'brick': {
      const rows = Math.max(2, n + (n % 2)) // even, so the half-brick offset repeats
      const cols = Math.max(1, Math.round(rows / 2))
      return (u, v) => {
        const r = Math.floor(v * rows)
        const off = r % 2 ? 0.5 / cols : 0
        const cu = (u + off) % 1
        const cc = Math.floor(cu * cols)
        const fx = cu * cols - cc, fy = v * rows - r
        const mortarX = 0.05, mortarY = 0.1
        if (fx < mortarX || fy < mortarY) return shade(accent, 0.85 + 0.25 * noise(u, v, 128, 128, s + 2))
        const tint = 0.8 + 0.35 * hash(cc, r, s)
        let c = shade(base, tint * (0.85 + 0.25 * fbm(u, v, 16, 4, s + 4)))
        const dirt = clamp01((fbm(u, v, 4, 4, s + 6) - 0.55) * 3) * wear
        c = shade(c, 1 - 0.35 * dirt)
        return c
      }
    }
    case 'tiles': return (u, v) => {
      const fx = (u * n) % 1, fy = (v * n) % 1
      const grout = 0.04
      if (fx < grout || fy < grout) return shade(accent, 0.9 + 0.2 * noise(u, v, 128, 128, s))
      const id = [Math.floor(u * n), Math.floor(v * n)]
      let c = shade(base, 0.94 + 0.1 * hash(id[0], id[1], s) + 0.06 * fbm(u, v, 8, 4, s + 1))
      const dirt = clamp01((fbm(u, v, 4, 4, s + 3) - 0.6) * 4) * wear
      return shade(c, 1 - 0.3 * dirt)
    }
    case 'metal_plate': return (u, v) => {
      const fx = (u * n) % 1, fy = (v * n) % 1
      const brushed = 0.9 + 0.12 * noise(u, v, 512, 8, s)
      let c = shade(base, brushed * (0.92 + 0.12 * fbm(u, v, 4, 4, s + 1)))
      const seam = Math.min(fx, 1 - fx, fy, 1 - fy)
      if (seam < 0.008) c = shade(c, 0.45)
      else if (seam < 0.016) c = shade(c, 1.15)
      for (const [rx, ry] of [[0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95]]) {
        const d = Math.hypot(fx - rx, fy - ry)
        if (d < 0.022) c = shade(base, 1.25 - 12 * (fx - rx + fy - ry))
      }
      const rust = clamp01((fbm(u, v, 4, 5, s + 7) - 0.7 + wear * 0.3) * 4) * wear
      return mix(c, shade(accent, 0.8 + 0.4 * noise(u, v, 64, 64, s + 8)), rust)
    }
    case 'diamond_plate': {
      const m = n + (n % 2) // even, so the alternating bumps repeat
      return (u, v) => {
      const cx = Math.floor(u * m), cy = Math.floor(v * m)
      const fx = u * m - cx - 0.5, fy = v * m - cy - 0.5
      const flip = (cx + cy) % 2 ? -1 : 1
      // Distance to a short diagonal segment through the cell center.
      const along = (fx + flip * fy) / Math.SQRT2, across = (fx - flip * fy) / Math.SQRT2
      const t = Math.max(-0.22, Math.min(0.22, along))
      const d = Math.hypot(along - t, across)
      let c = shade(base, 0.8 + 0.1 * noise(u, v, 256, 256, s))
      if (d < 0.09) c = shade(base, 1.12 + 4 * (0.09 - d) * (across > 0 ? 1 : -1.4))
      else if (d < 0.125) c = mix(c, accent, 0.75)
      const grime = clamp01((fbm(u, v, 4, 4, s + 2) - 0.6) * 4) * wear
      return shade(c, 1 - 0.3 * grime)
      }
    }
    case 'wood_planks': return (u, v) => {
      const pi = Math.floor(u * n)
      const fx = u * n - pi
      const joint = (hash(pi, 0, s) + v) % 1
      if (fx < 0.03 || joint < 0.006) return shade(accent, 0.35)
      const grain = fbm(u, v, n * 2, 4, s + pi, 0.12)
      const rings = 0.5 + 0.5 * Math.sin((grain * 18 + hash(pi, 1, s) * 6) * Math.PI)
      let c = mix(base, accent, 0.55 * rings * 0.8)
      c = shade(c, 0.85 + 0.3 * hash(pi, 2, s))
      const wornOut = clamp01((fbm(u, v, 4, 4, s + 9) - 0.55) * 3) * wear
      return mix(c, [150, 140, 125], 0.35 * wornOut)
    }
    case 'grass': return (u, v) => {
      const blades = noise(u, v, 256, 64, s) * 0.6 + noise(u, v, 512, 128, s + 1) * 0.4
      let c = shade(base, 0.7 + 0.6 * blades)
      const dry = clamp01((fbm(u, v, n, 5, s + 3) - 0.55 + wear * 0.2) * 3)
      return mix(c, shade(accent, 0.8 + 0.4 * blades), dry * wear)
    }
    case 'dirt': return (u, v) => {
      let c = shade(base, 0.75 + 0.45 * fbm(u, v, n, 6, s))
      const [d1, , id] = cells(u, v, 32, s + 5)
      if (hash(id, 3, s) < wear * 0.5 && d1 < 0.22) c = mix(c, shade(accent, 0.8 + 0.4 * hash(id, 4, s)), 0.9)
      return c
    }
    case 'gravel': return (u, v) => {
      const [d1, d2, id] = cells(u, v, n, s)
      const edge = d2 - d1
      const stone = mix(base, [200, 196, 188], 0.4 * hash(id, 1, s))
      let c = shade(stone, 0.7 + 0.5 * (1 - d1) * (0.85 + 0.3 * noise(u, v, 128, 128, s + 2)))
      if (edge < 0.08 + 0.12 * wear) c = mix(accent, c, edge / (0.08 + 0.12 * wear))
      return c
    }
    case 'facade': {
      // One row of windows per repeat (a storey when the repeat is a floor high), `n` across.
      return (u, v) => {
        const cx = Math.floor(u * n), fx = u * n - cx
        let c = shade(base, 0.86 + 0.18 * fbm(u, v, 4, 5, s) + 0.06 * noise(u, v, 256, 256, s + 1))
        if (p.bricks) {
          const r = Math.floor(v * 16), off = r % 2 ? 0.5 : 0
          const bx = (u * n * 4 + off) % 1, by = (v * 16) % 1
          if (bx < 0.06 || by < 0.12) c = shade([196, 190, 178], 0.85 + 0.2 * noise(u, v, 128, 128, s + 2))
          else c = shade(c, 0.85 + 0.3 * hash(Math.floor(u * n * 4 + off), r, s))
        }
        if (v < 0.04 || v > 0.96) c = shade(base, 0.72) // floor band
        const inX = fx > 0.2 && fx < 0.8, inY = v > 0.24 && v < 0.74
        const frame = (fx > 0.17 && fx < 0.83 && v > 0.21 && v < 0.77) && !(inX && inY)
        if (frame) c = shade(base, 1.18)
        if (v > 0.74 && v < 0.79 && fx > 0.15 && fx < 0.85) c = shade(base, 1.3) // sill
        if (inX && inY) {
          const lit = hash(cx, 7, s) < 0.22
          const sky = 0.75 + 0.5 * (1 - (v - 0.24) / 0.5)
          c = lit ? mix([255, 214, 140], accent, 0.25) : shade(accent, sky)
          if (Math.abs(fx - 0.5) < 0.012 || Math.abs(v - 0.46) < 0.012) c = shade(base, 0.9) // mullions
        }
        const streak = clamp01((fbm(u, v, n * 2, 3, s + 5, 4) - 0.55) * 3) * wear * (v > 0.77 ? 1 : 0.3)
        return shade(c, 1 - 0.35 * streak)
      }
    }
    case 'storefront': return (u, v) => {
      const fx = (u * n) % 1
      let c = shade(base, 0.9 + 0.15 * noise(u, v, 128, 128, s))
      if (v > 0.16 && v < 0.78 && fx > 0.04 && fx < 0.96) {
        c = shade(accent, 0.8 + 0.45 * (1 - v) + 0.1 * noise(u, v, 64, 8, s + 2))
        if (Math.abs(fx - 0.5) < 0.01 || Math.abs(v - 0.62) < 0.008) c = shade(base, 1.1)
      }
      if (v >= 0.82) c = shade(base, 1.25 + 0.1 * noise(u, v, 64, 64, s + 3)) // sign band
      const dirt = clamp01((fbm(u, v, 4, 4, s + 4) - 0.6) * 4) * wear * (v < 0.2 ? 1 : 0.3)
      return shade(c, 1 - 0.3 * dirt)
    }
    case 'garage_door': return (u, v) => {
      const fx = (u * n) % 1
      if (fx < 0.05 || fx > 0.95 || v < 0.03) return shade(accent, 0.8)
      const rib = (v * 16) % 1
      let c = shade(base, 0.9 + 0.12 * noise(u, v, 256, 16, s))
      if (rib < 0.12) c = shade(accent, 1.1)
      else if (rib < 0.2) c = shade(base, 1.15)
      const rust = clamp01((fbm(u, v, 4, 5, s + 7) - 0.65 + wear * 0.2) * 4) * wear
      return mix(c, [130, 80, 45], rust * 0.6)
    }
    case 'hazard': return (u, v) => {
      const stripe = ((u + v) * n) % 1 < 0.5
      const c = stripe ? base : accent
      const worn = clamp01((fbm(u, v, 8, 4, s) - 0.6) * 4) * wear
      return mix(shade(c, 0.92 + 0.1 * noise(u, v, 256, 256, s + 1)), [120, 115, 105], worn * 0.6)
    }
    case 'water': return (u, v) => {
      // Soft swells plus fine ripples that catch the light.
      const swell = fbm(u, v, 3, 4, s)
      const warp = fbm(u, v, n, 3, s + 1) * 1.5
      const ripple = 0.5 + 0.5 * Math.sin((u * n * 2 + v * n + warp) * Math.PI * 2)
      const glint = clamp01((ripple - 0.88) * 8) * (0.4 + wear)
      const deep = shade(base, 0.8 + 0.35 * swell)
      return mix(deep, accent, glint * 0.7 + ripple * 0.08)
    }
    case 'matrix': return (u, v) => {
      // Columns of falling glyphs: each column has a bright head and a fading trail; rows wrap so it tiles.
      const cols = Math.max(4, n), rows = cols
      const cx = Math.floor(u * cols), cy = Math.floor(v * rows)
      const fx = u * cols - cx, fy = v * rows - cy
      const head = Math.floor(hash(cx, 11, s) * rows), trail = 4 + Math.floor(hash(cx, 13, s) * (6 + wear * 10))
      const behind = (((head - cy) % rows) + rows) % rows
      const glow = behind === 0 ? 1 : behind < trail ? Math.pow(1 - behind / trail, 1.4) : 0.05 + 0.07 * hash(cx, cy, s + 9)
      // Each cell is a made-up 5 × 7 pixel glyph.
      const gx = Math.floor(((fx - 0.14) / 0.72) * 5), gy = Math.floor(((fy - 0.08) / 0.84) * 7)
      const on = gx >= 0 && gx < 5 && gy >= 0 && gy < 7 && hash(cx * 37 + cy * 101 + gx, gy + 17, s) < 0.46
      if (!on) return shade(base, 1 + glow * 0.6)
      const ink = behind === 0 ? mix(accent, [225, 255, 230], 0.75) : accent
      return mix(base, ink, clamp01(glow * 1.1))
    }
    case 'chevrons': return (u, v) => {
      // Glowing arrows pointing to the top of the image (v 0), a lit line down each side; repeats along v.
      const fu = Math.abs(u - 0.5) * 2, fv = (v * n) % 1
      const d = Math.abs(fv - (0.2 + fu * 0.45))
      const arm = fu < 0.78 ? clamp01(1 - d / 0.09) : 0
      const halo = fu < 0.84 ? clamp01(1 - d / 0.26) * 0.3 : 0
      const side = clamp01(1 - Math.abs(fu - 0.93) / 0.035)
      const c = shade(base, 0.9 + 0.12 * noise(u, v, 128, 128, s))
      return mix(c, accent, clamp01(Math.max(arm, side * 0.85, halo)) * (1 - wear * 0.4 * fbm(u, v, 8, 3, s + 1)))
    }
    case 'emblem': return (u, v) => {
      // A badge: a lit ring, a hexagon and a symbol (star, triangle or double chevron, by seed) on a faint grid.
      const x = u - 0.5, y = v - 0.5, r = Math.hypot(x, y), a = Math.atan2(y, x)
      let hr = -Infinity
      for (let k = 0; k < 6; k++) hr = Math.max(hr, x * Math.cos((k * Math.PI) / 3) + y * Math.sin((k * Math.PI) / 3))
      const kind = p.seed % 3
      const symbol = kind === 0 ? r < 0.075 + 0.12 * Math.pow(0.5 + 0.5 * Math.cos(5 * (a + Math.PI / 2)), 2)
        : kind === 1 ? [90, -30, -150].every((deg) => x * Math.cos((deg * Math.PI) / 180) + y * Math.sin((deg * Math.PI) / 180) < 0.1)
          : Math.abs(x) < 0.15 && (Math.abs(y - (Math.abs(x) * 0.9 - 0.08)) < 0.035 || Math.abs(y - (Math.abs(x) * 0.9 + 0.05)) < 0.035)
      const ring = clamp01(1 - Math.abs(r - 0.41) / 0.03), halo = clamp01(1 - Math.abs(r - 0.41) / 0.09) * 0.3
      const hex = clamp01(1 - Math.abs(hr - 0.29) / 0.018) * 0.85
      const grid = (u * n) % 1 < 0.025 || (v * n) % 1 < 0.025 ? 0.12 : 0
      const glow = symbol ? 1 : Math.max(ring, hex, halo, r < 0.29 ? 0.08 : grid)
      return mix(shade(base, 0.95 + 0.1 * noise(u, v, 64, 64, s)), accent, glow)
    }
    case 'screen': return (u, v) => {
      // A console screen: a lit frame, a title bar, rows of made-up text, a bar chart and scan lines.
      const edge = Math.min(u, 1 - u, v, 1 - v)
      if (edge < 0.02) return shade(accent, 0.5)
      if (edge < 0.032) return shade(base, 0.5)
      const scan = (v * 96) % 1 < 0.5 ? 0.9 : 1.04
      const c = shade(base, scan)
      const glyph = (cx: number, cy: number, gx: number, gy: number) => hash(cx * 31 + gx, cy * 17 + gy, s) < 0.55
      if (v > 0.06 && v < 0.12) {
        const cx = Math.floor(u * 48), fx = u * 48 - cx, fy = (v - 0.06) / 0.06
        const text = u > 0.06 && u < 0.4 && fx > 0.15 && fx < 0.85 && glyph(cx, 99, Math.floor(fx * 3), Math.floor(fy * 5))
        return text ? mix(c, [235, 255, 255], 0.8) : mix(c, accent, 0.35)
      }
      if (u > 0.06 && u < 0.58 && v > 0.17 && v < 0.93) {
        const row = Math.floor(((v - 0.17) / 0.76) * n), fy = (((v - 0.17) / 0.76) * n) % 1
        const cx = Math.floor((u - 0.06) * 60), fx = ((u - 0.06) * 60) % 1
        const len = 0.2 + 0.8 * hash(row, 5, s)
        const on = (u - 0.06) / 0.52 < len && fy > 0.25 && fy < 0.8 && fx > 0.12 && fx < 0.88 && glyph(cx, row, Math.floor(fx * 3), Math.floor(((fy - 0.25) / 0.55) * 5))
        const bright = hash(row, 9, s) < 0.15 + wear * 0.3
        return on ? mix(c, bright ? [255, 220, 120] : accent, 0.9) : c
      }
      if (u > 0.64 && u < 0.94 && v > 0.3 && v < 0.93) {
        const k = Math.floor(((u - 0.64) / 0.3) * 6), fx = (((u - 0.64) / 0.3) * 6) % 1
        const h = 0.2 + 0.75 * hash(k, 21, s)
        return fx > 0.15 && fx < 0.85 && (0.93 - v) / 0.63 < h ? mix(c, accent, 0.55 + 0.4 * ((0.93 - v) / 0.63 / h)) : c
      }
      if (u > 0.64 && u < 0.94 && v > 0.15 && v < 0.25) {
        const g = Math.floor(((u - 0.64) / 0.3) * 4)
        return seg7((p.seed + g * 3) % 10, (((u - 0.64) / 0.3) * 4) % 1 * 1.25 - 0.12, (v - 0.15) / 0.1, 0.2, 0.14) ? mix(c, accent, 0.95) : c
      }
      return c
    }
    case 'scoreboard': return (u, v) => {
      // Two team panels (color left, accent right) with big 00 scores and a 10:00 clock over the middle.
      const dark = [11, 13, 18]
      const edge = Math.min(u, 1 - u, v, 1 - v)
      if (edge < 0.03) return [60, 66, 78]
      const left = u < 0.5, team = left ? base : accent
      let c = mix(dark, team, Math.abs(u - 0.5) < 0.006 ? 0.9 : 0.28 + 0.06 * ((v * 80) % 1 < 0.5 ? 1 : 0))
      const lit = [240, 246, 255]
      for (const x0 of left ? [0.11, 0.27] : [0.61, 0.77]) if (seg7(0, (u - x0) / 0.13, (v - 0.42) / 0.38, 0.22, 0.08)) c = lit
      if (v > 0.08 && v < 0.24) {
        const digits = [1, 0, -1, 0, 0]
        digits.forEach((d, i) => {
          const x0 = 0.375 + i * 0.052
          if (d < 0) { if (Math.abs(u - x0 - 0.02) < 0.009 && (Math.abs(v - 0.13) < 0.012 || Math.abs(v - 0.19) < 0.012)) c = [255, 214, 90]; return }
          if (seg7(d, (u - x0) / 0.042, (v - 0.08) / 0.16, 0.24, 0.1)) c = [255, 214, 90]
        })
      }
      return c
    }
    case 'poster': return (u, v) => {
      // Paper margin (the same all round, so it tiles), a headline, a big motif, small print, and some tearing.
      const paper = [236, 232, 220]
      const m = 0.05
      if (u < m || u > 1 - m || v < m || v > 1 - m) return shade(paper, 0.95 + 0.05 * noise(u, v, 64, 64, s))
      const x = (u - m) / (1 - 2 * m), y = (v - m) / (1 - 2 * m)
      let c = shade(base, 0.92 + 0.12 * fbm(x, y, 3, 3, s))
      const ink = bright(base) > 0.55 ? [30, 30, 34] : [240, 238, 230]
      const motif = Math.floor(hash(1, 2, s) * 3)
      if (y > 0.26 && y < 0.7) {
        const cx = 0.5 + (hash(3, 4, s) - 0.5) * 0.3, cy = 0.48
        if (motif === 0 && Math.hypot(x - cx, (y - cy) * 1.3) < 0.26) c = mix(accent, [255, 255, 255], 0.15 * fbm(x, y, 4, 3, s + 1))
        else if (motif === 1 && x + (y - 0.26) * 0.8 > 0.6) c = shade(accent, 0.9 + 0.2 * noise(x, y, 16, 16, s + 2))
        else if (motif === 2 && x > 0.12 && x < 0.88 && y > 0.3 && y < 0.66) c = shade(mix(accent, base, 0.4 + 0.5 * fbm(x, y, 4, 4, s + 3)), 0.7 + 0.5 * fbm(x, y, 8, 3, s + 4))
      }
      // Headline in block letters.
      if (y > 0.07 && y < 0.23) {
        const cols = 7, gx = Math.floor(x * cols), fx = x * cols - gx
        const lx = Math.floor(((fx - 0.1) / 0.8) * 5), ly = Math.floor(((y - 0.07) / 0.16) * 7)
        if (lx >= 0 && lx < 5 && ly >= 0 && ly < 7 && blockLetter(letter(Math.floor(hash(gx, 9, s) * 99)), lx, ly)) c = motif === 1 ? ink : accent
      }
      // Lines of small print.
      for (let i = 0; i < n; i++) {
        const y0 = 0.76 + i * (0.16 / n)
        if (y > y0 && y < y0 + 0.08 / n + 0.012 && x > 0.08 && x < 0.92 - 0.2 * hash(i, 5, s) && (x * 40) % 1 > 0.18) c = ink
      }
      // Torn and weathered.
      const torn = clamp01((fbm(u, v, 4, 4, s + 6) - 0.72 + wear * 0.15) * 6) * (0.4 + wear)
      return mix(shade(c, 1 - 0.15 * wear * fbm(u, v, 6, 3, s + 7)), paper, torn)
    }
    case 'graffiti': {
      // Bubble letters with a dark outline, a two-tone fill, a shine and drips; see-through everywhere else.
      const letters = Math.max(2, Math.min(8, n))
      const codes = [...Array(letters)].map((_, i) => letter(Math.floor(hash(i, 21, s) * 99)))
      const tilt = (hash(2, 22, s) - 0.5) * 0.3
      return (u, v) => {
        const out = [...base, 0]
        if (u < 0.03 || u > 0.97 || v < 0.03 || v > 0.97) return out
        const wob = (fbm(u, v, 6, 3, s + 1) - 0.5) * 0.06
        const x = ((u - 0.06 + (v - 0.5) * tilt) / 0.88) * letters + wob * 4, y = (v - 0.22) / 0.56 + wob
        const gi = Math.floor(x)
        let d = 9, which = -1
        for (const g of [gi - 1, gi, gi + 1]) {
          if (g < 0 || g >= letters) continue
          const lift = (hash(g, 23, s) - 0.5) * 0.16
          const e = strokeDist(codes[g], (x - g - 0.18) / 0.64, y + lift) * 0.64
          if (e < d) { d = e; which = g }
        }
        const r = 0.17, line = 0.05
        if (d < r) {
          const shine = d < r * 0.35 && y < 0.35 + 0.05 * hash(which, 24, s)
          const c = shine ? mix(base, [255, 255, 255], 0.7) : mix(shade(base, 1.1), shade(base, 0.6), clamp01(y))
          return [...c, 255]
        }
        if (d < r + line) return [...accent, 255]
        // Drips under the letters, and overspray.
        const col = Math.floor(u * 90)
        if (hash(col, 25, s) < 0.12 + wear * 0.15 && y > 0.9 && y < 0.95 + hash(col, 26, s) * 0.6 * (0.5 + wear) && Math.abs(((u * 90) % 1) - 0.5) < 0.22) return [...shade(base, 0.8), 230]
        if (d < r + line + 0.1 && hash(Math.floor(u * 400), Math.floor(v * 400), s + 27) < 0.05 * (1 + wear)) return [...base, 160]
        return out
      }
    }
    case 'sign': return (u, v) => {
      // A frame (the same all round), a lit panel and a row of letters.
      const frame = 0.06
      if (u < frame || u > 1 - frame || v < frame * 1.6 || v > 1 - frame * 1.6) return shade(accent, 0.45 + 0.1 * noise(u, v, 64, 64, s))
      let c = shade(base, 0.95 + 0.1 * fbm(u, v, 3, 3, s))
      const cols = Math.max(2, n), x = ((u - frame) / (1 - 2 * frame)) * cols, gx = Math.floor(x), fx = x - gx
      const y = (v - 0.25) / 0.5
      const lx = Math.floor(((fx - 0.12) / 0.76) * 5), ly = Math.floor(y * 7)
      if (lx >= 0 && lx < 5 && ly >= 0 && ly < 7 && blockLetter(letter(Math.floor(hash(gx, 31, s) * 99)), lx, ly)) c = shade(accent, 0.95 + 0.1 * noise(u, v, 32, 32, s + 1))
      const grime = clamp01((fbm(u, v, 4, 4, s + 2) - 0.6) * 4) * wear
      return shade(c, 1 - 0.3 * grime)
    }
    case 'banner': return bannerPattern(p, base, accent, s, wear)
    case 'lettering': return letteringPattern(p, base, accent, s, wear)
    case 'picture': return (u, v) => {
      // A sunny sky over two rows of hills, on a pale card mount (the same all round, so it tiles): "a photo goes here".
      if (u < 0.04 || u > 0.96 || v < 0.04 || v > 0.96) return shade([236, 232, 222], 0.97 + 0.03 * noise(u, v, 64, 64, s))
      let c = mix(shade(base, 0.85), mix(base, [255, 255, 255], 0.55), v)
      if (Math.hypot(u - 0.7, v - 0.3) < 0.09) c = [255, 238, 176]
      if (v > 0.6 + 0.07 * Math.sin(u * Math.PI * 2 + 0.6)) c = mix(accent, base, 0.35)
      if (v > 0.72 + 0.05 * Math.sin(u * Math.PI * 4 + 2)) c = shade(accent, 0.95 + 0.1 * noise(u, v, 32, 32, s))
      return c
    }
    case 'sand': return (u, v) => {
      const warp = fbm(u, v, 4, 4, s) * 2
      const ripple = 0.5 + 0.5 * Math.sin((v * n + warp) * Math.PI * 2)
      let c = mix(base, accent, ripple * 0.35 * (0.4 + wear))
      return shade(c, 0.9 + 0.15 * noise(u, v, 512, 512, s + 1) + 0.08 * fbm(u, v, 8, 4, s + 2))
    }
  }
}

/** RGBA pixels, size × size. */
export function generate(p: GenParams): Uint8ClampedArray {
  const size = Math.max(16, Math.round(p.size))
  const out = new Uint8ClampedArray(size * size * 4)
  const px = pattern(p)
  for (let y = 0; y < size; y++) {
    const v = y / size
    for (let x = 0; x < size; x++) {
      const c = px(x / size, v)
      const i = (y * size + x) * 4
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = c.length > 3 ? c[3] : 255
    }
  }
  return out
}
