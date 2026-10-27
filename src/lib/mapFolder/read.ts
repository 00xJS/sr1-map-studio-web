// A map's chunk and texture files into what the editor makes a project from: its pieces (scene.ts), one decoded
// picture per material from the map's own texture file, the sky picture the template's sky box drew, and the
// loading screen (ld-<map>.peg_xbox2). Pure: runs in the map folder worker and in Node tests.
import { readChunk } from '../gameObjects/chunk'
import { INVISIBLE_TEXTURE, findShared, findTexture, hasAlpha, indexPeg, shrink, type PegIndex } from '../gameObjects/textures'
import { decodeEntry, parsePeg, type PegImage } from '../sr1char/peg'
import { FAKE_SKY, chunkSoup, sceneOrigin, splitScene, type MapPiece, type MaterialPlan } from './scene'

export interface SceneTexture { width: number; height: number; rgba: ArrayBuffer; alpha: boolean }

export interface MapScene {
  pieces: MapPiece[]
  /** Texture name per material (pieces index into it), and its picture (null: not in the map's files). */
  materials: string[]
  textures: (SceneTexture | null)[]
  /** Per material: drawn blended and lit by itself this much (scene.ts MaterialPlan.glow); null for an ordinary one. */
  glow: (number | null)[]
  /** The game point the editor's origin is put at (middle across, lowest point). */
  origin: [number, number, number]
  /** The picture the template's sky box drew, and the loading screen. */
  sky: SceneTexture | null
  loading: SceneTexture | null
  skipped: { fakeSky: number; skyObjects: number }
  /** Triangles in the chunk, and in the pieces (back-face copies folded into double-sided pieces). */
  triangles: { chunk: number; pieces: number }
}

const pic = (img: PegImage, max: number): SceneTexture => {
  const s = shrink(img, max)
  return { width: s.width, height: s.height, rgba: s.rgba.slice().buffer, alpha: hasAlpha(s) }
}

/** The average colour of a picture, and whether it is one plain colour all over (every pixel within 8%). */
function meanOf(img: PegImage): { rgb: [number, number, number]; flat: boolean } {
  const n = img.width * img.height, sum = [0, 0, 0]
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) sum[c] += img.rgba[4 * i + c]
  const rgb = sum.map((v) => v / Math.max(1, n)) as [number, number, number]
  let flat = true
  for (let i = 0; i < n && flat; i++) for (let c = 0; c < 3; c++) if (Math.abs(img.rgba[4 * i + c] - rgb[c]) > 20) { flat = false; break }
  return { rgb, flat }
}

/** A material's picture as its plan says (scene.ts materialPlan), at most `max` on a side. */
export function planPicture(plan: MaterialPlan, find: (name: string) => PegImage | null, max: number): SceneTexture | null {
  const tint = plan.tint ?? [1, 1, 1]
  if (plan.decals) {
    // Baked: the decals over the base's average colour, at the first decal's size.
    const ds = plan.decals.map((d) => ({ img: find(d.tex), opacity: d.opacity })).filter((d): d is { img: PegImage; opacity: number } => !!d.img)
    if (!ds.length) return null
    const first = shrink(ds[0].img, max), w = first.width, h = first.height
    const base = plan.base ? find(plan.base) : null
    const rgb = base ? meanOf(base).rgb : [255, 255, 255]
    const layers = ds.map((d) => ({ img: shrink(d.img, max), opacity: d.opacity }))
    const out = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const col = [0, 1, 2].map((c) => rgb[c] * tint[c])
      for (const { img, opacity } of layers) {
        const o = 4 * (Math.min(img.height - 1, Math.floor((y * img.height) / h)) * img.width + Math.min(img.width - 1, Math.floor((x * img.width) / w)))
        const a = (img.rgba[o + 3] / 255) * opacity
        for (let c = 0; c < 3; c++) col[c] = col[c] * (1 - a) + img.rgba[o + c] * a
      }
      const i = 4 * (y * w + x)
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(Math.min(255, col[c]))
      out[i + 3] = 255
    }
    return { width: w, height: h, rgba: out.buffer, alpha: false }
  }
  const img = find(plan.tex)
  if (!img) return null
  const s = shrink(img, max)
  if (!plan.tint && !plan.additive) return { width: s.width, height: s.height, rgba: s.rgba.slice().buffer, alpha: hasAlpha(s) }
  const out = s.rgba.slice()
  for (let i = 0; i < out.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = Math.round(Math.min(255, out[i + c] * tint[c]))
    if (plan.additive) {
      // Added to what is behind it: as a blended picture, its colour at full strength over its brightness.
      const m = Math.max(out[i], out[i + 1], out[i + 2])
      if (m > 0) for (let c = 0; c < 3; c++) out[i + c] = Math.round((out[i + c] * 255) / m)
      out[i + 3] = Math.round((m * out[i + 3]) / 255)
    }
  }
  return { width: s.width, height: s.height, rgba: out.buffer, alpha: hasAlpha({ width: s.width, height: s.height, rgba: out }) }
}

/** `pegs`: the map's texture files, its own first. */
export function readMapScene(chunk: Uint8Array, pegs: Uint8Array[], loading: Uint8Array | null, texSize = 1024): MapScene {
  const ch = readChunk(chunk)
  const index: PegIndex[] = []
  for (const p of pegs) { try { index.push(indexPeg(p)) } catch { /* not a texture file: its pictures stay grey */ } }
  const found = new Map<string, PegImage | null>()
  const find = (name: string) => {
    const k = name.toLowerCase()
    if (!found.has(k)) found.set(k, findTexture(name, index) ?? findShared(name, index))
    return found.get(k)!
  }
  const flat = (name: string) => { const img = find(name); return !!img && meanOf(shrink(img, 64)).flat }
  const { soup, instances, skipped, fakeSky } = chunkSoup(ch, flat)
  const pieces = splitScene(soup, instances)
  const textures = soup.materials.map((name, i): SceneTexture | null => {
    if (!name) return null
    if (INVISIBLE_TEXTURE.test(name)) return { width: 8, height: 8, rgba: new Uint8Array(8 * 8 * 4).buffer, alpha: true }
    return planPicture(soup.plans[i], find, texSize)
  })
  const skyImg = fakeSky ? findTexture(FAKE_SKY, index) : null
  let load: SceneTexture | null = null
  if (loading) {
    try {
      const peg = parsePeg(loading)
      const e = peg.entries.find((x) => x.size)
      const img = e ? decodeEntry(peg, e) : null
      if (img) load = { width: img.width, height: img.height, rgba: img.rgba.slice().buffer, alpha: false }
    } catch { /* no loading screen */ }
  }
  return {
    pieces, materials: soup.materials, textures, glow: soup.plans.map((p) => p.glow ?? null), origin: sceneOrigin(soup), sky: skyImg ? pic(skyImg, 2048) : null, loading: load, skipped,
    triangles: { chunk: soup.mat.length, pieces: pieces.reduce((a, p) => a + p.look.length, 0) },
  }
}

/** The buffers to hand over without copying. */
export function sceneTransfer(s: MapScene): Transferable[] {
  const out: Transferable[] = []
  for (const p of s.pieces) out.push(p.mesh.positions.buffer, p.mesh.uvs.buffer, p.mesh.triangles.buffer, p.mesh.triMaterial.buffer, p.look.buffer)
  for (const t of [...s.textures, s.sky, s.loading]) if (t) out.push(t.rgba)
  return out
}
