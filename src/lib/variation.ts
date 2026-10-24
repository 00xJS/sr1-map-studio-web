// The large-scale variation layer of the editor's opt-in "layered surfaces" look, the way retail keeps its
// surfaces from repeating: the base picture tiles every few metres, two soft grime layers repeat every 10.7 m and
// 14.3 m (non-whole, so they never line up with the base or each other), and one cloudy mask tints between two
// colours every 97 m. Projected in world space (on the plane the surface faces most), so it runs on across
// separate objects. One small wrapping noise picture holds the three fields (R, G: grime, B: mask). The GLSL in
// src/editor/gameMaterial.ts does the same sums as `vary` here, which the tests use to measure the effect.

export const VARIATION = {
  /** Grime layers: repeat (metres) and opacity; grime darkens toward `dark` x the colour. */
  grime: [{ period: 10.7, opacity: 0.55 }, { period: 14.3, opacity: 0.4 }] as const,
  dark: 0.55,
  /** The tint mask's repeat (metres) and its two tints (about 10-15 % apart, like retail's Diffuse_Color_1/2). */
  maskPeriod: 97,
  tintA: [1.05, 1.03, 0.99] as const,
  tintB: [0.9, 0.91, 0.94] as const,
}

export const TILE_SIZE = 128

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
const mod = (a: number, n: number) => ((a % n) + n) % n
const smooth = (t: number) => t * t * (3 - 2 * t)
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

function noise(u: number, v: number, p: number, seed: number) {
  const x = u * p, y = v * p, x0 = Math.floor(x), y0 = Math.floor(y), tx = smooth(x - x0), ty = smooth(y - y0)
  const h = (i: number, j: number) => hash(mod(i, p), mod(j, p), seed)
  const a = h(x0, y0), b = h(x0 + 1, y0), c = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1)
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty
}
function fbm(u: number, v: number, period: number, octaves: number, seed: number) {
  let sum = 0, amp = 0.5, norm = 0, p = period
  for (let o = 0; o < octaves; o++) { sum += amp * noise(u, v, p, seed + o * 101); norm += amp; amp *= 0.5; p *= 2 }
  return sum / norm
}

/** The noise picture (RGBA, wraps): R and G grime coverage (soft-edged blotches), B the cloudy tint mask. */
export function variationTile(size = TILE_SIZE): Uint8Array {
  const out = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = (y * size + x) * 4
    out[i] = Math.round(255 * smoothstep(0.48, 0.78, fbm(u, v, 4, 5, 11)))
    out[i + 1] = Math.round(255 * smoothstep(0.5, 0.8, fbm(u, v, 5, 5, 23)))
    out[i + 2] = Math.round(255 * fbm(u, v, 3, 4, 37))
    out[i + 3] = 255
  }
  return out
}

/** Bilinear, wrapping sample of channel `c` (0..1). */
export function sampleTile(tile: Uint8Array, size: number, u: number, v: number, c: number): number {
  const x = mod(u * size - 0.5, size), y = mod(v * size - 0.5, size)
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0, x1 = (x0 + 1) % size, y1 = (y0 + 1) % size
  const g = (i: number, j: number) => tile[(j * size + i) * 4 + c] / 255
  return (g(x0, y0) * (1 - tx) + g(x1, y0) * tx) * (1 - ty) + (g(x0, y1) * (1 - tx) + g(x1, y1) * tx) * ty
}

/** Per facing plane: the two world axes it uses and an offset that keeps the three projections apart. */
export const PLANES = [[2, 1, 0.37, 0.11], [0, 2, 0.0, 0.0], [0, 1, 0.71, 0.53]] as const

/** The layers at world point `p` (metres) on a surface facing `n`: grime coverages and the mask, blended by facing. */
export function layersAt(tile: Uint8Array, size: number, p: readonly number[], n: readonly number[]) {
  const w = n.map((x) => x * x * x * x), s = w[0] + w[1] + w[2] || 1
  let g1 = 0, g2 = 0, m = 0
  PLANES.forEach(([a, b, oa, ob], k) => {
    if (!w[k]) return
    const f = w[k] / s
    g1 += f * sampleTile(tile, size, p[a] / VARIATION.grime[0].period + oa, p[b] / VARIATION.grime[0].period + ob, 0)
    g2 += f * sampleTile(tile, size, p[a] / VARIATION.grime[1].period + ob, p[b] / VARIATION.grime[1].period + oa, 1)
    m += f * sampleTile(tile, size, p[a] / VARIATION.maskPeriod + oa, p[b] / VARIATION.maskPeriod + ob, 2)
  })
  return { g1, g2, m }
}

/** A colour (linear 0..1) with the variation layers applied at `p` facing `n`. */
export function vary(c: readonly number[], tile: Uint8Array, size: number, p: readonly number[], n: readonly number[]): [number, number, number] {
  const { g1, g2, m } = layersAt(tile, size, p, n)
  const k = (1 - (1 - VARIATION.dark) * g1 * VARIATION.grime[0].opacity) * (1 - (1 - VARIATION.dark) * g2 * VARIATION.grime[1].opacity)
  const t = smoothstep(0.3, 0.7, m)
  return [0, 1, 2].map((i) => c[i] * k * (VARIATION.tintA[i] + (VARIATION.tintB[i] - VARIATION.tintA[i]) * t)) as [number, number, number]
}

/** The same sums in GLSL (tile in `uSrVary`, world point in metres, unit normal). */
export const VARY_GLSL = `
vec3 srVary(vec3 c, vec3 p, vec3 n) {
  vec3 w = n * n; w = w * w; w /= max(w.x + w.y + w.z, 1e-4);
  vec2 ax = p.zy, ay = p.xz, az = p.xy;
  const vec2 ox = vec2(${PLANES[0][2].toFixed(2)}, ${PLANES[0][3].toFixed(2)}), oz = vec2(${PLANES[2][2].toFixed(2)}, ${PLANES[2][3].toFixed(2)});
  float P1 = ${VARIATION.grime[0].period.toFixed(2)}, P2 = ${VARIATION.grime[1].period.toFixed(2)}, PM = ${VARIATION.maskPeriod.toFixed(1)};
  float g1 = w.x * texture2D(uSrVary, ax / P1 + ox).r + w.y * texture2D(uSrVary, ay / P1).r + w.z * texture2D(uSrVary, az / P1 + oz).r;
  float g2 = w.x * texture2D(uSrVary, ax / P2 + ox.yx).g + w.y * texture2D(uSrVary, ay / P2).g + w.z * texture2D(uSrVary, az / P2 + oz.yx).g;
  float m = w.x * texture2D(uSrVary, ax / PM + ox).b + w.y * texture2D(uSrVary, ay / PM).b + w.z * texture2D(uSrVary, az / PM + oz).b;
  float k = (1.0 - ${(1 - VARIATION.dark).toFixed(2)} * g1 * ${VARIATION.grime[0].opacity.toFixed(2)}) * (1.0 - ${(1 - VARIATION.dark).toFixed(2)} * g2 * ${VARIATION.grime[1].opacity.toFixed(2)});
  vec3 tint = mix(vec3(${VARIATION.tintA.map((x) => x.toFixed(2)).join(', ')}), vec3(${VARIATION.tintB.map((x) => x.toFixed(2)).join(', ')}), smoothstep(0.3, 0.7, m));
  return c * k * tint;
}`
