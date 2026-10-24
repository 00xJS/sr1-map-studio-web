// The lettering on text signs: a made-up stroke font (no font files, nothing
// copied), so a sign's words draw the same on every computer and a sign can be
// rebuilt anywhere from its text alone. Letters are lines and arcs on a grid
// 6 high (y down); the renderer thickens them by the sign style's pen width.
// Pure module (the share and publish functions check sign text with it).

export type SignStyle = 'street' | 'shop' | 'plaque' | 'neon' | 'plain'

export const SIGN_STYLES: Record<SignStyle, { label: string; color: string; accent: string; pen: number }> = {
  street: { label: 'Street sign', color: '#1f6b3a', accent: '#ffffff', pen: 0.52 },
  shop: { label: 'Shop board', color: '#7a1f1f', accent: '#f3e3b5', pen: 0.66 },
  plaque: { label: 'Plaque', color: '#b08d3c', accent: '#3a2a10', pen: 0.36 },
  neon: { label: 'Neon', color: '#15121c', accent: '#ff3dd8', pen: 0.4 },
  plain: { label: 'Plain', color: '#f2f0ea', accent: '#1d1d20', pen: 0.46 },
}

/** At most two lines of this many letters. */
export const SIGN_LINES = 2
export const SIGN_LINE_LENGTH = 24

type Pt = [number, number]
interface Glyph { w: number; strokes: Pt[][] }

/** An elliptical arc from angle a0 to a1 (degrees; 0 = right, 90 = down). */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): Pt[] {
  const n = Math.max(3, Math.ceil(Math.abs(a1 - a0) / 15))
  return [...Array(n + 1)].map((_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]
  })
}
/** A polyline from flat x, y pairs. */
const P = (...xy: number[]): Pt[] => [...Array(xy.length >> 1)].map((_, i) => [xy[i * 2], xy[i * 2 + 1]])
const dot = (x: number, y = 5.9): Pt[] => P(x, y, x, y + 0.1)
const g = (w: number, ...strokes: Pt[][]): Glyph => ({ w, strokes })

const GLYPHS: Record<string, Glyph> = {
  A: g(4, P(0, 6, 2, 0, 4, 6), P(0.7, 4, 3.3, 4)),
  B: g(4, P(0, 0, 0, 6), [...P(0, 0, 2.4, 0), ...arc(2.4, 1.5, 1.3, 1.5, -90, 90), ...P(2.4, 3, 0, 3)], [...P(0, 3, 2.6, 3), ...arc(2.6, 4.5, 1.4, 1.5, -90, 90), ...P(2.6, 6, 0, 6)]),
  C: g(4, arc(2, 3, 2, 3, 40, 320)),
  D: g(4, [...P(0, 0, 0, 6, 1.5, 6), ...arc(1.5, 3, 2.5, 3, 90, -90), ...P(1.5, 0, 0, 0)]),
  E: g(3.6, P(3.6, 0, 0, 0, 0, 6, 3.6, 6), P(0, 3, 3, 3)),
  F: g(3.6, P(3.6, 0, 0, 0, 0, 6), P(0, 3, 3, 3)),
  G: g(4, arc(2, 3, 2, 3, 0, 320), P(2.2, 3, 4, 3, 4, 3.6)),
  H: g(4, P(0, 0, 0, 6), P(4, 0, 4, 6), P(0, 3, 4, 3)),
  I: g(2, P(1, 0, 1, 6), P(0, 0, 2, 0), P(0, 6, 2, 6)),
  J: g(4, [...P(4, 0, 4, 4.2), ...arc(2, 4.2, 2, 1.8, 0, 180)]),
  K: g(4, P(0, 0, 0, 6), P(4, 0, 0, 3.8), P(1.5, 2.7, 4, 6)),
  L: g(3.6, P(0, 0, 0, 6, 3.6, 6)),
  M: g(5, P(0, 6, 0, 0, 2.5, 4, 5, 0, 5, 6)),
  N: g(4, P(0, 6, 0, 0, 4, 6, 4, 0)),
  O: g(4.4, arc(2.2, 3, 2.2, 3, 0, 360)),
  P: g(4, [...P(0, 6, 0, 0, 2.4, 0), ...arc(2.4, 1.6, 1.6, 1.6, -90, 90), ...P(2.4, 3.2, 0, 3.2)]),
  Q: g(4.4, arc(2.2, 3, 2.2, 3, 0, 360), P(2.6, 4.2, 4.4, 6.2)),
  R: g(4, [...P(0, 6, 0, 0, 2.4, 0), ...arc(2.4, 1.6, 1.6, 1.6, -90, 90), ...P(2.4, 3.2, 0, 3.2)], P(2, 3.2, 4, 6)),
  S: g(4, [...arc(2, 1.5, 1.9, 1.5, 330, 90), ...arc(2, 4.5, 2, 1.5, 270, 510)]),
  T: g(4, P(0, 0, 4, 0), P(2, 0, 2, 6)),
  U: g(4, [...P(0, 0, 0, 4), ...arc(2, 4, 2, 2, 180, 0), ...P(4, 4, 4, 0)]),
  V: g(4, P(0, 0, 2, 6, 4, 0)),
  W: g(5.4, P(0, 0, 1.35, 6, 2.7, 1.6, 4.05, 6, 5.4, 0)),
  X: g(4, P(0, 0, 4, 6), P(4, 0, 0, 6)),
  Y: g(4, P(0, 0, 2, 3, 4, 0), P(2, 3, 2, 6)),
  Z: g(4, P(0, 0, 4, 0, 0, 6, 4, 6)),
  0: g(3.6, arc(1.8, 3, 1.8, 3, 0, 360)),
  1: g(2, P(0, 1.2, 1.4, 0, 1.4, 6)),
  2: g(4, [...arc(2, 1.8, 2, 1.8, 200, 380), ...P(0, 6, 4, 6)]),
  3: g(4, [...arc(2, 1.5, 1.8, 1.5, 200, 450), ...arc(2, 4.5, 2, 1.5, 270, 520)]),
  4: g(4, P(3, 6, 3, 0, 0, 4.2, 4, 4.2)),
  5: g(4, [...P(3.8, 0, 0.6, 0, 0.6, 2.9), ...arc(2, 4.2, 1.9, 1.8, 225, 500)]),
  6: g(4, arc(2, 4.2, 2, 1.8, 0, 360), arc(3.2, 4.2, 3.2, 4.2, 180, 255)),
  7: g(4, P(0, 0, 4, 0, 1.5, 6)),
  8: g(4, arc(2, 1.5, 1.7, 1.5, 0, 360), arc(2, 4.5, 2, 1.5, 0, 360)),
  9: g(4, arc(2, 1.8, 2, 1.8, 0, 360), arc(0.8, 1.8, 3.2, 4.2, 0, 75)),
  '.': g(0.4, dot(0.2)),
  ',': g(0.8, P(0.6, 5.6, 0.6, 6, 0.1, 6.9)),
  '!': g(0.4, P(0.2, 0, 0.2, 4.2), dot(0.2)),
  '?': g(4, [...arc(2, 1.6, 2, 1.6, 190, 450), ...P(2, 3.2, 2, 4.2)], dot(2)),
  '-': g(2.6, P(0, 3.3, 2.6, 3.3)),
  "'": g(0.4, P(0.2, 0, 0.2, 1.8)),
  '"': g(1.6, P(0.2, 0, 0.2, 1.8), P(1.4, 0, 1.4, 1.8)),
  ':': g(0.4, dot(0.2, 1.9), dot(0.2)),
  '/': g(3, P(0, 6, 3, 0)),
  '+': g(3.2, P(0, 3.2, 3.2, 3.2), P(1.6, 1.6, 1.6, 4.8)),
  '#': g(4, P(1.3, 0.6, 0.9, 5.4), P(3.1, 0.6, 2.7, 5.4), P(0, 2.2, 4, 2.2), P(0, 3.8, 4, 3.8)),
  '(': g(1.6, arc(2.2, 3, 2, 3.4, 135, 225)),
  ')': g(1.6, arc(-0.6, 3, 2, 3.4, -45, 45)),
  '&': g(4.2, [...P(4.2, 6, 1.2, 2.6), ...arc(1.9, 1.3, 1.1, 1.3, 130, 400), ...P(2.74, 2.14, 0.6, 3.9), ...arc(1.9, 4.6, 1.5, 1.4, 205, 60), ...P(4, 3.8)]),
  '$': g(4, [...arc(2, 1.5, 1.9, 1.5, 330, 90), ...arc(2, 4.5, 2, 1.5, 270, 510)], P(2, -0.7, 2, 6.7)),
  '%': g(4, P(0, 6, 4, 0), arc(0.8, 1, 0.7, 1, 0, 360), arc(3.2, 5, 0.7, 1, 0, 360)),
}
const SPACE = 2.4
/** Room between letters: more for a thicker pen, so bold letters don't touch. */
const gap = (pen: number) => 0.7 + 1.6 * pen

/** Characters the sign font can draw (besides spaces and one line break). */
export const SIGN_CHARS = Object.keys(GLYPHS).join('')

/**
 * What a sign will actually show: capitals, accents dropped, characters the
 * font doesn't have left out, at most two lines of 24 letters.
 */
export function signText(raw: string): string {
  const clean = String(raw ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  return clean.split(/\r?\n/).map((l) => [...l].filter((c) => c === ' ' || c in GLYPHS).join('').replace(/\s+/g, ' ').trim().slice(0, SIGN_LINE_LENGTH))
    .filter(Boolean).slice(0, SIGN_LINES).join('\n')
}

/** Null when `t` is text a sign can show as it is (what signText makes); otherwise what is wrong. */
export function signTextProblem(t: unknown): string | null {
  if (typeof t !== 'string') return 'has sign text that is not text'
  return signText(t) === t ? null : 'has sign text it cannot show'
}

export interface Seg { x0: number; y0: number; x1: number; y1: number }
export interface PlacedGlyph { x: number; w: number; segs: Float64Array }
/** A line of glyphs laid out left to right from x = 0, in glyph units. */
export interface SignLine { width: number; glyphs: PlacedGlyph[] }

export function layoutLine(text: string, pen = 0.5): SignLine {
  const glyphs: PlacedGlyph[] = []
  let x = 0
  for (const ch of text) {
    const gl = GLYPHS[ch]
    if (!gl) { x += SPACE; continue }
    // Each stroke piece as x0, y0, dx, dy, 1 / length².
    const segs: number[] = []
    for (const s of gl.strokes) for (let i = 0; i + 1 < s.length; i++) {
      const dx = s[i + 1][0] - s[i][0], dy = s[i + 1][1] - s[i][1], l2 = dx * dx + dy * dy
      segs.push(s[i][0] + x, s[i][1], dx, dy, l2 ? 1 / l2 : 0)
    }
    glyphs.push({ x, w: gl.w, segs: Float64Array.from(segs) })
    x += gl.w + gap(pen)
  }
  return { width: Math.max(0, x - gap(pen)), glyphs }
}

/** Distance from (x, y) to the nearest stroke of a line, in glyph units; looks only at glyphs within `reach`. */
export function lineDistance(line: SignLine, x: number, y: number, reach: number): number {
  let d2 = Infinity
  for (const gl of line.glyphs) {
    if (x < gl.x - reach || x > gl.x + gl.w + reach) continue
    const s = gl.segs
    for (let i = 0; i < s.length; i += 5) {
      const px = x - s[i], py = y - s[i + 1], dx = s[i + 2], dy = s[i + 3]
      let t = (px * dx + py * dy) * s[i + 4]
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const ex = px - t * dx, ey = py - t * dy, e = ex * ex + ey * ey
      if (e < d2) d2 = e
    }
  }
  return Math.sqrt(d2)
}
