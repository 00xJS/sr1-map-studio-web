// Generated textures: nothing copied from anywhere, so they're free to share.
// Every pattern repeats exactly across the image (integer grids, noise that
// wraps around), so the result always tiles. Each kind suggests the matching
// physical surface (index into the 22 SR1 surface types).

export type TextureKind =
  | 'concrete' | 'asphalt' | 'brick' | 'tiles' | 'metal_plate' | 'diamond_plate'
  | 'wood_planks' | 'grass' | 'dirt' | 'gravel' | 'sand'
  | 'facade' | 'storefront' | 'garage_door' | 'hazard'

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
  hazard: { label: 'Hazard stripes', surface: 15, color: '#e8b81c', accent: '#1d1d1f', scale: 4, wear: 0.3, accentLabel: 'Stripe', scaleLabel: 'Stripes' },
}

export const defaultParams = (kind: TextureKind, size = 512): GenParams => {
  const k = KINDS[kind]
  return { kind, size, color: k.color, accent: k.accent, scale: k.scale, wear: k.wear, seed: 1, line: kind === 'asphalt' ? 'yellow' : 'none' }
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

// ---------------- patterns ----------------

type Pixel = (u: number, v: number) => number[]

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
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255
    }
  }
  return out
}
