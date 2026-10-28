// A dummy's pictures: what each of the character's materials looks like, worked out on the CPU into one picture per
// material, because the exporter writes one picture per material. The colour math is the editor's ports of the
// game's shaders (sr1char/materials.ts: cloth decals and fabric detail, the creator's skin tone, hair colour and
// alpha, the eye's iris); the lighting parts (specular, rim, normal maps) are left to the game's own map shader.
// Values are the game's raw (gamma-space) texture values, as those shaders use them.
import type { PegImage } from '../sr1char/peg'
import type { CmeshMaterial } from '../sr1char/cmesh'

export interface Picture { width: number; height: number; rgba: Uint8Array; alpha: boolean }

/** Largest side kept (each picture's PEG cost, textureBudget.ts). */
export const MAX_SIDE = 512

type RGBA = [number, number, number, number]

/** Samples a picture at three.js-style UVs (v up from the bottom, as the textures are flipped), wrapping. */
function sampler(img: PegImage) {
  return (u: number, v: number): RGBA => {
    const x = Math.min(img.width - 1, Math.floor((u - Math.floor(u)) * img.width))
    const fv = v - Math.floor(v)
    const y = Math.min(img.height - 1, Math.floor((1 - fv) * img.height))
    const o = 4 * (y * img.width + x), p = img.rgba
    return [p[o] / 255, p[o + 1] / 255, p[o + 2] / 255, p[o + 3] / 255]
  }
}

const size = (...imgs: (PegImage | null | undefined)[]) => {
  let w = 1, h = 1
  for (const i of imgs) if (i) { w = Math.max(w, i.width); h = Math.max(h, i.height) }
  const k = Math.min(1, MAX_SIDE / Math.max(w, h))
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))]
}

/** Fills a picture from a colour function of three.js-style UVs. */
function paint(w: number, h: number, alpha: boolean, fn: (u: number, v: number) => RGBA): Picture {
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const v = 1 - (y + 0.5) / h
    for (let x = 0; x < w; x++) {
      const c = fn((x + 0.5) / w, v), o = 4 * (y * w + x)
      for (let k = 0; k < 4; k++) rgba[o + k] = Math.round(Math.max(0, Math.min(1, k === 3 && !alpha ? 1 : c[k])) * 255)
    }
  }
  return { width: w, height: h, rgba, alpha }
}

/** One flat colour. */
export const flat = (c: number[], s = 8): Picture => paint(s, s, false, () => [c[0], c[1], c[2], 1])

export type Lookup = (name: string | undefined) => PegImage | null
const konst = (m: CmeshMaterial, n: string, d: number[]) => m.consts[n] || d
const slot = (m: CmeshMaterial, name: string) => m.slots.find((s) => s.slot === name)?.texture

/** Engine pictures that live outside a character's own pictures (shared by every character), as plain colours. */
function standIn(name: string | undefined, m: CmeshMaterial): Picture {
  const n = (name || '').toLowerCase()
  if (/teeth/.test(n)) return flat([0.86, 0.83, 0.74])
  if (/eye/.test(n)) return flat([0.85, 0.82, 0.8])
  const dc = konst(m, 'diffuse_color', [0.6, 0.6, 0.6, 1])
  return flat(dc)
}

/** bb-cloth1: Diffuse_Map x Diffuse_Color, the two decals over it, then the fabric detail overlay. */
export function clothPicture(m: CmeshMaterial, tex: Lookup): Picture {
  const base = tex(slot(m, 'diffuse_map'))
  const dc = konst(m, 'diffuse_color', [1, 1, 1, 1])
  const decals = [1, 2].map((i) => ({ img: tex(slot(m, 'decal_map_' + i)), c: konst(m, `decal_map_${i}_color`, [1, 1, 1, 1]), o: konst(m, `decal_map_${i}_opacity`, [1])[0], tu: konst(m, `decal_map_${i}_tilingu`, [1])[0], tv: konst(m, `decal_map_${i}_tilingv`, [1])[0] }))
    .filter((d) => d.img).map((d) => ({ ...d, at: sampler(d.img!) }))
  const detailImg = tex(slot(m, 'detail_map_4'))
  const detail = detailImg ? sampler(detailImg) : null
  const tu = konst(m, 'spec_map_tilingu', [1])[0], tv = konst(m, 'spec_map_tilingv', [1])[0], dOp = konst(m, 'detail_map_opacity', [0])[0]
  const at = base ? sampler(base) : () => [1, 1, 1, 1] as RGBA
  const [w, h] = size(base, ...decals.map((d) => d.img))
  return paint(w, h, false, (u, v) => {
    const t = at(u, v)
    let c = [t[0] * dc[0], t[1] * dc[1], t[2] * dc[2]]
    for (const d of decals) {
      const s = d.at(u * d.tu, v * d.tv), k = s[3] * d.o
      c = c.map((x, i) => x + (s[i] * d.c[i] - x) * k)
    }
    if (detail && dOp) {
      const s = detail(u * tu, v * tv)
      c = c.map((x, i) => { const dt = (s[i] - 0.5) * dOp + 0.5; return x < 0.5 ? 2 * x * dt : 1 - 2 * (1 - x) * (1 - dt) })
    }
    return [c[0], c[1], c[2], 1]
  })
}

/** bb-skin2 (the player's head and body): the creator's tone (slider values 0-1) over the skin, kept where the pigment map is white. */
export function skinPicture(m: CmeshMaterial, tex: Lookup, tone: { saturation: number; luminosity: number }): Picture {
  const img = tex(slot(m, 'diffuse_map'))
  if (!img) return standIn(slot(m, 'diffuse_map'), m)
  const pig = tex(slot(m, 'pigment_map'))
  const at = sampler(img), pat = pig ? sampler(pig) : null
  const dc = konst(m, 'diffuse_color', [1, 0.6392, 0.498, 1])
  const S = 2 * tone.saturation, L = 2 * tone.luminosity
  const gray = dc[0] * 0.6 + dc[1] * 0.3 + dc[2] * 0.1
  const tint = [0, 1, 2].map((i) => { const c = gray + (dc[i] - gray) * S; return L >= 1 ? c + (1 - c) * (L - 1) : c * L })
  const [w, h] = size(img)
  return paint(w, h, false, (u, v) => {
    const t = at(u, v), p = pat ? pat(u, v) : [0, 0, 0, 0]
    return [0, 1, 2].map((i) => tint[i] * t[i] + (t[i] - tint[i] * t[i]) * p[i]).concat(1) as RGBA
  })
}

/** Everything else a character wears (the people's skin and the plain shaders): its picture times its colour. */
export function plainPicture(m: CmeshMaterial, tex: Lookup): Picture {
  const name = slot(m, 'diffuse_map') ?? m.slots.find((s) => /^[0-9a-f]{8}$/.test(s.slot) && /\.tga$/i.test(s.texture))?.texture
  const img = tex(name)
  if (!img) return standIn(name, m)
  const dc = konst(m, 'diffuse_color', [1, 1, 1, 1])
  const at = sampler(img)
  const [w, h] = size(img)
  return paint(w, h, false, (u, v) => { const t = at(u, v); return [t[0] * dc[0], t[1] * dc[1], t[2] * dc[2], 1] })
}

export interface HairTone { rgb: readonly number[]; lum: number }

/**
 * bb-haircolor2: the picture's red is the hair's brightness and its blue the alpha. Head hair is cut out at the
 * game's alpha test (0.3); stubble and brows fade (alpha doubled).
 */
export function hairPicture(img: PegImage, colour: HairTone, head: boolean): Picture {
  const at = sampler(img)
  const [w, h] = size(img)
  const c = colour.rgb.map((x) => (x / 255) * colour.lum * 1.332)
  return paint(w, h, true, (u, v) => {
    const t = at(u, v)
    const a = head ? (t[2] >= 0.3 ? 1 : 0) : Math.min(1, t[2] * 2)
    return [c[0] * t[0], c[1] * t[0], c[2] * t[0], a]
  })
}

/**
 * The eye, for its iris UVs: the iris picture tinted by the eye colour over the eye's white (the editor draws the
 * white from the first UV set and the iris from the second; one picture can only follow one, and the iris is what
 * reads from a distance).
 */
export function eyePicture(iris: PegImage | null, white: PegImage | null, eye: CmeshMaterial, own: CmeshMaterial): Picture {
  const dc = konst(eye, 'diffuse_color', konst(own, 'diffuse_color', [0.949, 0.8235, 0.7725, 1]))
  let sclera = [dc[0], dc[1], dc[2]]
  if (white) {
    // The white's average colour (the eyeball picture is mostly white with veins).
    const p = white.rgba, n = p.length / 4
    sclera = [0, 1, 2].map((k) => { let s = 0; for (let i = 0; i < n; i++) s += p[4 * i + k]; return (s / n / 255) * dc[k] })
  }
  if (!iris) return flat(sclera)
  const ic = konst(eye, 'decal_map_1_color', konst(own, 'decal_map_1_color', [0.4863, 0.3647, 0.3059, 1]))
  const op = konst(eye, 'decal_map_1_opacity', [1])[0]
  const at = sampler(iris)
  const [w, h] = size(iris)
  return paint(w, h, false, (u, v) => {
    const t = at(u, v), k = t[3] * op
    return [0, 1, 2].map((i) => sclera[i] + (t[i] * ic[i] - sclera[i]) * k).concat(1) as RGBA
  })
}

/** A short key for a picture's pixels (so dummies with the same look share their pictures). */
export function pictureKey(p: Picture): string {
  let h = 0x811c9dc5
  const step = Math.max(1, Math.floor(p.rgba.length / 65536))
  for (let i = 0; i < p.rgba.length; i += step) { h ^= p.rgba[i]; h = Math.imul(h, 0x01000193) }
  return `${p.width}x${p.height}${p.alpha ? 'a' : ''}:${(h >>> 0).toString(36)}`
}
