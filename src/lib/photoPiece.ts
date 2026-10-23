// Objects from a photo: a building whose front is the picture, or a cut-out
// panel (a sign, a poster, a car, a person-shaped target) with the
// background taken out. Everything happens in the browser.
import type { Part, Tex } from './sampleKit'
import { PB, box } from './sampleKit'
import { U } from './urbanKit'
import { group } from './prefabs'
import { storeFile } from './files'

export type PhotoKind = 'building' | 'cutout' | 'decal'

export interface PhotoImage {
  /** Ready-to-use pixels (cut-outs: background removed and trimmed). */
  canvas: HTMLCanvasElement
  /** Width over height of what will be shown. */
  aspect: number
  /** Average color of the picture, for a building's plain sides. */
  average: string
}

const MAX = 1024

async function load(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k))
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return c
}

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/**
 * Makes the background see-through: everything joined to the picture's edge
 * that is close in color to the edge is removed (good for a photo against a
 * plain wall or sky), then the picture is trimmed to what is left.
 */
export function removeBackground(src: HTMLCanvasElement, tolerance = 42): HTMLCanvasElement {
  const { width: w, height: h } = src
  const g = src.getContext('2d')!
  const img = g.getImageData(0, 0, w, h)
  const d = img.data
  // The background color: the median of the border pixels.
  const border: number[][] = []
  for (let x = 0; x < w; x++) { border.push([...d.subarray((x) * 4, x * 4 + 3)], [...d.subarray(((h - 1) * w + x) * 4, ((h - 1) * w + x) * 4 + 3)]) }
  for (let y = 0; y < h; y++) { border.push([...d.subarray((y * w) * 4, (y * w) * 4 + 3)], [...d.subarray((y * w + w - 1) * 4, (y * w + w - 1) * 4 + 3)]) }
  const med = [0, 1, 2].map((k) => border.map((p) => p[k]).sort((a, b) => a - b)[border.length >> 1])
  const near = (i: number) => Math.hypot(d[i] - med[0], d[i + 1] - med[1], d[i + 2] - med[2]) < tolerance
  // Flood from every edge pixel that matches.
  const gone = new Uint8Array(w * h)
  const stack: number[] = []
  const push = (x: number, y: number) => { const p = y * w + x; if (!gone[p] && near(p * 4)) { gone[p] = 1; stack.push(p) } }
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1) }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y) }
  while (stack.length) {
    const p = stack.pop()!, x = p % w, y = (p / w) | 0
    if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1)
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let p = 0; p < w * h; p++) {
    if (gone[p]) { d[p * 4 + 3] = 0; continue }
    // Soften the edge a little where a kept pixel touches removed ones.
    const x = p % w, y = (p / w) | 0
    const edge = (x > 0 && gone[p - 1]) || (x < w - 1 && gone[p + 1]) || (y > 0 && gone[p - w]) || (y < h - 1 && gone[p + w])
    if (edge) d[p * 4 + 3] = 170
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  g.putImageData(img, 0, 0)
  if (x1 < 0) return src
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1
  out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return out
}

/** The look of a finished canvas (a tag or a sticker) for placing. */
export function canvasImage(canvas: HTMLCanvasElement): PhotoImage {
  return { canvas, aspect: canvas.width / canvas.height, average: '#808080' }
}

export async function preparePhoto(file: Blob, kind: PhotoKind, cutBackground = true): Promise<PhotoImage> {
  let canvas = await load(file)
  if (kind !== 'building' && cutBackground) canvas = removeBackground(canvas)
  const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
  let r = 0, g = 0, b = 0, n = 0
  for (let i = 0; i < d.length; i += 4 * 7) if (d[i + 3] > 128) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++ }
  n = n || 1
  return { canvas, aspect: canvas.width / canvas.height, average: hex(r / n, g / n, b / n) }
}

/**
 * A decal (tag, sticker, poster) stuck flat on a wall: `point` where the wall
 * was clicked, `normal` the way the wall faces. Players walk through it.
 */
export async function decalParts(img: PhotoImage, width: number, point: [number, number, number], normal: [number, number, number], name: string): Promise<Part[]> {
  const stored = await storeFile(await toBlob(img.canvas), `${name.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'tag'}.png`)
  const tex: Tex = { file: stored.vpath, ref: stored.ref, surface: 0, alpha: true }
  const h = Math.max(0.2, width / img.aspect)
  const len = Math.hypot(normal[0], normal[2]) || 1
  const nx = normal[0] / len, nz = normal[2] / len
  const rot = +((Math.atan2(nx, nz) * 180) / Math.PI).toFixed(2)
  const at: [number, number, number] = [point[0] + nx * 0.04, point[1] - h / 2, point[2] + nz * 0.04]
  return group(`Decal@${at.map((v) => v.toFixed(2)).join(',')}#${stored.ref.hash.slice(0, 6)}`, [{ ...box(name, [width, h, 0.04], at, tex, tex, rot), fit: true }])
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('Could not encode the picture.'))), 'image/png'))

/**
 * The parts for a photo object at (x, z) on height y. Building: `width` wide,
 * as tall as the photo's shape allows, `depth` deep, the photo on its front
 * (+Z). Cut-out: a thin panel `width` wide standing on its edge.
 */
export async function photoParts(img: PhotoImage, kind: PhotoKind, o: { width: number; depth: number; x: number; z: number; y: number; name: string }): Promise<Part[]> {
  const stored = await storeFile(await toBlob(img.canvas), `${o.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'photo'}.png`)
  const photo: Tex = { file: stored.vpath, ref: stored.ref, surface: kind === 'building' ? 0 : 15, alpha: kind === 'cutout' }
  const w = o.width, h = Math.max(1, Math.min(200, w / img.aspect))
  const at = (dz: number): [number, number, number] => [o.x, o.y, o.z + dz]
  const id = `Photo ${kind}@${o.x.toFixed(2)},${o.y.toFixed(2)},${o.z.toFixed(2)}#${stored.ref.hash.slice(0, 6)}`
  if (kind === 'cutout') return group(id, [{ ...box(o.name, [w, h, 0.15], at(0), photo, photo), fit: true }])
  const sides: Tex = { gen: 'concrete', tweak: { color: img.average, accent: img.average, wear: 0.25, seed: 401 } }
  return group(id, [
    box(o.name, [w, h, o.depth], at(-0.08), U.roof, sides, 0, 6),
    { ...box(o.name + ' front', [w, h, 0.16], at(o.depth / 2 - 0.08), PB.concrete, photo), fit: true },
  ])
}
