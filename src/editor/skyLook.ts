// A stand-in for the game's own sky in the walk-through and Play: what an exported map shows overhead at noon in
// clear weather with the sky copied from mp_bac_01 (see lib/gameSky.ts). Painted here, nothing from the game: a blue
// dome paling to a hazy horizon, a band of puffy clouds low down (the game's cloud_sparse_hz) and a few higher
// puffs and wisps (cloud_cirrus_01). Drawn as an equirectangular picture for scene.background.

export interface Puff { x: number; elevation: number; size: number; alpha: number }

/** Small deterministic random numbers, so the sky looks the same every walk. */
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296 }
}

/**
 * Cloud puffs: x across the picture (0..1, wraps), elevation in degrees above the horizon, size as a share of the
 * picture's height. Most sit in a low band like the game's horizon clouds; a few drift higher.
 */
export function skyPuffs(seed = 7, count = 140): Puff[] {
  const r = rng(seed), out: Puff[] = []
  for (let i = 0; i < count; i++) {
    const high = i % 7 === 0
    const elevation = high ? 18 + r() * 30 : Math.pow(r(), 1.6) * 13 + 0.5
    out.push({ x: r(), elevation, size: (high ? 0.025 : 0.018) + r() * (high ? 0.03 : 0.035) * (1 - elevation / 90), alpha: (high ? 0.45 : 0.6) + r() * 0.35 })
  }
  return out
}

/**
 * The time of day and weather the sky is painted for (the game tints the same sky objects through the day): top
 * and horizon colours, the horizon haze, the sun's colour (black: down), night (moon and stars) and how bright the
 * clouds are. Without it the sky is the clear noon one.
 */
export interface SkyTint { top: string; horizon: string; haze: string; sun: string; night: boolean; clouds: number }

const rgba = (hex: string, a: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`

/** Paints the stand-in sky into a 2:1 canvas (equirectangular: the horizon across the middle). */
export function paintGameSky(c: HTMLCanvasElement, seed = 7, tint?: SkyTint) {
  const w = c.width, h = c.height, g = c.getContext('2d')!
  const horizon = h / 2
  const sky = g.createLinearGradient(0, 0, 0, horizon)
  if (tint) { sky.addColorStop(0, tint.top); sky.addColorStop(0.8, tint.horizon); sky.addColorStop(1, tint.haze) }
  else { sky.addColorStop(0, '#2f63b0'); sky.addColorStop(0.55, '#5f93d4'); sky.addColorStop(0.9, '#a9c6e6'); sky.addColorStop(1, '#d6e2ea') }
  g.fillStyle = sky; g.fillRect(0, 0, w, horizon)
  if (tint?.night) {
    // Stars, and the moon instead of the sun.
    const r = rng(seed * 7 + 1)
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.6})`; g.fillRect(r() * w, r() * horizon * 0.9, 1.2, 1.2) }
    const mx = w * 0.3, my = horizon * 0.35, mr = h * 0.018
    const moon = g.createRadialGradient(mx, my, 0, mx, my, mr * 6)
    moon.addColorStop(0, 'rgba(235,240,250,1)'); moon.addColorStop(0.16, 'rgba(225,232,245,0.9)'); moon.addColorStop(0.2, 'rgba(200,210,235,0.25)'); moon.addColorStop(1, 'rgba(200,210,235,0)')
    g.fillStyle = moon; g.fillRect(mx - mr * 6, my - mr * 6, mr * 12, mr * 12)
  }
  const ground = g.createLinearGradient(0, horizon, 0, h)
  if (tint) { ground.addColorStop(0, tint.haze); ground.addColorStop(0.15, rgba(tint.horizon, 0.6)); ground.addColorStop(1, '#3a3836') }
  else { ground.addColorStop(0, '#d0d8dc'); ground.addColorStop(0.15, '#9a9a94'); ground.addColorStop(1, '#6d6a64') }
  g.fillStyle = ground; g.fillRect(0, horizon, w, h - horizon)
  // The sun's glow, high in the south.
  const sx = w * 0.62, sy = horizon * 0.28
  const sun = g.createRadialGradient(sx, sy, 0, sx, sy, h * 0.22)
  const sunColor = tint ? tint.sun : '#fff6d6', up = !tint || (!tint.night && tint.sun !== '#000000')
  sun.addColorStop(0, rgba(sunColor, 0.95)); sun.addColorStop(0.08, rgba(sunColor, 0.6)); sun.addColorStop(1, rgba(sunColor, 0))
  g.fillStyle = sun
  if (up) g.fillRect(0, 0, w, horizon)
  const cloud = tint ? tint.clouds : 1
  // Wisps: long faint streaks.
  const r = rng(seed * 31 + 3)
  for (let i = 0; i < 9; i++) {
    const x = r() * w, y = horizon * (0.25 + r() * 0.45), len = w * (0.06 + r() * 0.08)
    g.save(); g.translate(x, y); g.rotate((r() - 0.5) * 0.25); g.scale(1, 0.12)
    const wisp = g.createRadialGradient(0, 0, 0, 0, 0, len)
    wisp.addColorStop(0, `rgba(255,255,255,${0.35 * cloud})`); wisp.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = wisp; g.fillRect(-len, -len, 2 * len, 2 * len)
    g.restore()
  }
  // Puffs, each a few soft blobs, shaded a little underneath; drawn twice near the edges so the seam wraps.
  for (const p of skyPuffs(seed)) {
    const y = horizon - (p.elevation / 90) * horizon, rad = p.size * h
    for (const dx of [0, -w, w]) {
      const x = p.x * w + dx
      if (x + rad * 3 < 0 || x - rad * 3 > w) continue
      for (let k = 0; k < 4; k++) {
        const bx = x + (k - 1.5) * rad * 0.8, by = y - Math.sin(k * 1.7) * rad * 0.25
        const blob = g.createRadialGradient(bx, by - rad * 0.15, 0, bx, by, rad)
        const lit = tint ? rgba(tint.haze, p.alpha * cloud) : `rgba(255,255,255,${p.alpha})`, shade = tint ? rgba(tint.horizon, p.alpha * 0.7 * cloud) : `rgba(236,240,246,${p.alpha * 0.7})`
        blob.addColorStop(0, lit); blob.addColorStop(0.6, shade); blob.addColorStop(1, 'rgba(225,232,242,0)')
        g.fillStyle = blob; g.beginPath(); g.ellipse(bx, by, rad, rad * 0.55, 0, 0, Math.PI * 2); g.fill()
      }
    }
  }
  // Haze where the sky meets the ground.
  const haze = g.createLinearGradient(0, horizon - h * 0.06, 0, horizon + h * 0.03)
  const hz = tint ? tint.haze : '#d6e2ea'
  haze.addColorStop(0, rgba(hz, 0)); haze.addColorStop(0.7, rgba(hz, 0.85)); haze.addColorStop(1, rgba(hz, 0))
  g.fillStyle = haze; g.fillRect(0, horizon - h * 0.06, w, h * 0.09)
}
