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

/** Paints the stand-in sky into a 2:1 canvas (equirectangular: the horizon across the middle). */
export function paintGameSky(c: HTMLCanvasElement, seed = 7) {
  const w = c.width, h = c.height, g = c.getContext('2d')!
  const horizon = h / 2
  const sky = g.createLinearGradient(0, 0, 0, horizon)
  sky.addColorStop(0, '#2f63b0'); sky.addColorStop(0.55, '#5f93d4'); sky.addColorStop(0.9, '#a9c6e6'); sky.addColorStop(1, '#d6e2ea')
  g.fillStyle = sky; g.fillRect(0, 0, w, horizon)
  const ground = g.createLinearGradient(0, horizon, 0, h)
  ground.addColorStop(0, '#d0d8dc'); ground.addColorStop(0.15, '#9a9a94'); ground.addColorStop(1, '#6d6a64')
  g.fillStyle = ground; g.fillRect(0, horizon, w, h - horizon)
  // The sun's glow, high in the south.
  const sx = w * 0.62, sy = horizon * 0.28
  const sun = g.createRadialGradient(sx, sy, 0, sx, sy, h * 0.22)
  sun.addColorStop(0, 'rgba(255,252,235,0.95)'); sun.addColorStop(0.08, 'rgba(255,246,214,0.6)'); sun.addColorStop(1, 'rgba(255,246,214,0)')
  g.fillStyle = sun; g.fillRect(0, 0, w, horizon)
  // Wisps: long faint streaks.
  const r = rng(seed * 31 + 3)
  for (let i = 0; i < 9; i++) {
    const x = r() * w, y = horizon * (0.25 + r() * 0.45), len = w * (0.06 + r() * 0.08)
    g.save(); g.translate(x, y); g.rotate((r() - 0.5) * 0.25); g.scale(1, 0.12)
    const wisp = g.createRadialGradient(0, 0, 0, 0, 0, len)
    wisp.addColorStop(0, 'rgba(255,255,255,0.35)'); wisp.addColorStop(1, 'rgba(255,255,255,0)')
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
        blob.addColorStop(0, `rgba(255,255,255,${p.alpha})`); blob.addColorStop(0.6, `rgba(236,240,246,${p.alpha * 0.7})`); blob.addColorStop(1, 'rgba(225,232,242,0)')
        g.fillStyle = blob; g.beginPath(); g.ellipse(bx, by, rad, rad * 0.55, 0, 0, Math.PI * 2); g.fill()
      }
    }
  }
  // Haze where the sky meets the ground.
  const haze = g.createLinearGradient(0, horizon - h * 0.06, 0, horizon + h * 0.03)
  haze.addColorStop(0, 'rgba(214,226,234,0)'); haze.addColorStop(0.7, 'rgba(214,226,234,0.85)'); haze.addColorStop(1, 'rgba(208,216,220,0)')
  g.fillStyle = haze; g.fillRect(0, horizon - h * 0.06, w, h * 0.09)
}
