// Text tags for walls: graffiti-style lettering drawn on a see-through canvas,
// ready to stick on a wall as a decal. Only fonts every computer has.

export type TagStyle = 'spray' | 'bubble' | 'stencil' | 'marker'

export const TAG_STYLES: Record<TagStyle, { label: string; font: string }> = {
  spray: { label: 'Spray paint', font: '900 160px Impact, "Arial Black", sans-serif' },
  bubble: { label: 'Bubble letters', font: '900 160px "Arial Black", "Arial Rounded MT Bold", sans-serif' },
  stencil: { label: 'Stencil', font: 'bold 150px "Courier New", Courier, monospace' },
  marker: { label: 'Marker tag', font: 'italic bold 150px "Brush Script MT", "Segoe Script", "Comic Sans MS", cursive' },
}

/** Repeatable little random numbers, so the same tag always draws the same. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export function renderTag(text: string, style: TagStyle, fill: string, outline: string, seed = 7): HTMLCanvasElement {
  const lines = text.trim().split('\n').filter(Boolean).slice(0, 3)
  const words = lines.length ? lines : ['TAG']
  const font = TAG_STYLES[style].font
  const probe = document.createElement('canvas').getContext('2d')!
  probe.font = font
  const lineH = 170
  const textW = Math.max(...words.map((l) => probe.measureText(l).width))
  const pad = 70
  const c = document.createElement('canvas')
  c.width = Math.min(2048, Math.ceil(textW + pad * 2)); c.height = Math.ceil(words.length * lineH + pad * 2)
  const g = c.getContext('2d')!
  g.font = font
  g.textBaseline = 'middle'
  g.textAlign = 'center'
  g.lineJoin = 'round'
  const r = rng(seed)
  const cx = c.width / 2
  const ys = words.map((_, i) => pad + lineH * (i + 0.5))
  const grad = (y: number) => {
    const gr = g.createLinearGradient(0, y - 70, 0, y + 70)
    gr.addColorStop(0, fill); gr.addColorStop(1, shade(fill, 0.65))
    return gr
  }

  if (style === 'spray') {
    // Overspray dots, a dark outline, a two-tone fill and a few drips.
    g.fillStyle = fill
    for (let i = 0; i < 900; i++) {
      const y = ys[Math.floor(r() * ys.length)] + (r() - 0.5) * lineH * 1.2
      g.globalAlpha = 0.15 + r() * 0.25
      g.beginPath(); g.arc(cx + (r() - 0.5) * textW * 1.1, y, 1 + r() * 2.5, 0, Math.PI * 2); g.fill()
    }
    g.globalAlpha = 1
    words.forEach((l, i) => { g.lineWidth = 22; g.strokeStyle = outline; g.strokeText(l, cx, ys[i]) })
    words.forEach((l, i) => { g.fillStyle = grad(ys[i]); g.fillText(l, cx, ys[i]) })
    g.fillStyle = fill
    for (let i = 0; i < 9; i++) {
      const x = cx + (r() - 0.5) * textW * 0.9, y = ys[ys.length - 1] + 40, len = 20 + r() * 60
      g.fillRect(x, y, 4, len); g.beginPath(); g.arc(x + 2, y + len, 4, 0, Math.PI * 2); g.fill()
    }
  } else if (style === 'bubble') {
    // Fat rounded letters: wide white rim, dark line, shiny fill.
    words.forEach((l, i) => { g.lineWidth = 40; g.strokeStyle = '#ffffff'; g.strokeText(l, cx, ys[i]) })
    words.forEach((l, i) => { g.lineWidth = 16; g.strokeStyle = outline; g.strokeText(l, cx, ys[i]) })
    words.forEach((l, i) => { g.fillStyle = grad(ys[i]); g.fillText(l, cx, ys[i]) })
    g.fillStyle = 'rgba(255,255,255,0.55)'
    words.forEach((l, i) => { g.save(); g.beginPath(); g.rect(0, ys[i] - 70, c.width, 34); g.clip(); g.fillText(l, cx, ys[i]); g.restore() })
  } else if (style === 'stencil') {
    // One flat color with bridges cut through the letters and a little bleed.
    words.forEach((l, i) => { g.fillStyle = fill; g.fillText(l, cx, ys[i]) })
    g.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < words.length; i++) for (let x = 0; x < c.width; x += 46) g.fillRect(x, ys[i] - 4, 8, 8)
    g.globalCompositeOperation = 'source-over'
    g.globalAlpha = 0.25; g.fillStyle = fill
    for (let i = 0; i < 300; i++) { g.beginPath(); g.arc(cx + (r() - 0.5) * textW, ys[0] + (r() - 0.5) * lineH * words.length, 1 + r() * 2, 0, Math.PI * 2); g.fill() }
    g.globalAlpha = 1
  } else {
    // A quick slanted tag with a thin outline and an underline swoosh.
    g.save(); g.translate(cx, 0); g.transform(1, 0, -0.18, 1, 0, 0); g.translate(-cx, 0)
    words.forEach((l, i) => { g.lineWidth = 8; g.strokeStyle = outline; g.strokeText(l, cx, ys[i]) })
    words.forEach((l, i) => { g.fillStyle = fill; g.fillText(l, cx, ys[i]) })
    g.restore()
    g.strokeStyle = fill; g.lineWidth = 9; g.lineCap = 'round'
    const y = ys[ys.length - 1] + 70
    g.beginPath(); g.moveTo(cx - textW * 0.45, y); g.quadraticCurveTo(cx, y + 30, cx + textW * 0.5, y - 10); g.stroke()
  }
  return trim(c)
}

function shade(hex: string, k: number) {
  const n = parseInt(hex.replace('#', ''), 16)
  const ch = (s: number) => Math.round(((n >> s) & 255) * k).toString(16).padStart(2, '0')
  return '#' + ch(16) + ch(8) + ch(0)
}

/** Crops away fully see-through edges. */
function trim(c: HTMLCanvasElement): HTMLCanvasElement {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  if (x1 < 0) return c
  const m = 6
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(c.width - 1, x1 + m); y1 = Math.min(c.height - 1, y1 + m)
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1
  out.getContext('2d')!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return out
}
