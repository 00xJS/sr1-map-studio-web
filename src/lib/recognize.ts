// Where a texture came from, for files stored before the site recorded recipes:
// starter-library images by their bytes, generated textures by name and pixels.
// Play links and the Showcase both use this (browser only).
import { db, sha256 } from './db'
import { KINDS, defaultParams, generate, type GenParams, type TextureKind } from './procedural'
import type { FileRef } from './project'
import type { TextureRecipe } from './recipes'

let libraryIdList: Promise<Set<string>> | null = null
/** Ids of the starter-library textures this site serves. */
export const libraryIds = () => (libraryIdList ??= fetch('/textures/index.json').then((r) => r.ok ? r.json() : { textures: [] })
  .then((d: { textures: { id: string }[] }) => new Set(d.textures.map((t) => t.id))).catch(() => new Set<string>()))

const libraryHashes = new Map<string, Promise<string | null>>()
const libraryHash = (id: string) => {
  let p = libraryHashes.get(id)
  if (!p) {
    p = fetch(`/textures/${id}.jpg`).then((r) => r.ok ? r.blob().then(sha256) : null).catch(() => null)
    libraryHashes.set(id, p)
  }
  return p
}

/** Generator settings used by the sample maps and prefabs, by "kind:seed" (to recognise textures made before recipes were recorded). */
let tweakIndex: Promise<Map<string, GenParams[]>> | null = null
function knownTweaks(): Promise<Map<string, GenParams[]>> {
  tweakIndex ??= (async () => {
    const [{ SAMPLES }, { ALL_PREFABS }, { prefabParams }] = await Promise.all([import('./samples'), import('./prefabRegistry'), import('./prefabs')])
    const out = new Map<string, GenParams[]>()
    const seen = new Set<string>()
    const add = (t: { gen?: TextureKind; tweak?: Partial<GenParams> }) => {
      if (!t.gen) return
      const k = JSON.stringify([t.gen, t.tweak ?? {}])
      if (seen.has(k)) return
      seen.add(k)
      const p = { ...defaultParams(t.gen), ...t.tweak }
      const key = `${t.gen}:${p.seed}`
      out.set(key, [...(out.get(key) ?? []), p])
    }
    // The samples as drawn (building them in full takes minutes); the prefabs they get dressed with are below.
    for (const s of SAMPLES) for (const part of s.parts) { add(part.top as never); add(part.side as never) }
    for (const def of Object.values(ALL_PREFABS)) {
      try { for (const part of def.make(0, 0, 0, 0, prefabParams(def, {}))) { add(part.top as never); add(part.side as never) } } catch { /* skip */ }
    }
    return out
  })()
  return tweakIndex
}

async function pixelsOf(blob: Blob): Promise<{ w: number; h: number; px: Uint8ClampedArray } | null> {
  try {
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const g = c.getContext('2d')!
    g.drawImage(bmp, 0, 0)
    bmp.close()
    return { w: c.width, h: c.height, px: g.getImageData(0, 0, c.width, c.height).data }
  } catch { return null }
}

/** Close enough at a spread of sample points (PNG is lossless; this allows for browser rounding). */
function samePixels(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false
  const stride = Math.max(1, Math.floor(a.length / 4 / 3000)) * 4
  for (let i = 0; i < a.length; i += stride) {
    for (let c = 0; c < 3; c++) if (Math.abs(a[i + c] - b[i + c]) > 3) return false
  }
  return true
}

const GEN_NAME = /^([a-z_]+?)_(\d+)(?:_(\d+))?\.png$/
const BLOCKOUT: Record<string, [TextureKind, number]> = { 'blockout_top.png': ['concrete', 1], 'blockout_side.png': ['brick', 1] }

/**
 * The recipe of a texture the site made before recipes were recorded: known by
 * its name, and only if its content matches what the recipe makes. Null for
 * anything else (a photo, a download, an imported model's image).
 */
export async function recognizeTexture(ref: FileRef): Promise<TextureRecipe | null> {
  if (ref.origin !== 'user') return null
  const lib = /^([a-z0-9_]+)\.jpg$/.exec(ref.name)
  if (lib && (await libraryIds()).has(lib[1])) return (await libraryHash(lib[1])) === ref.hash ? { kind: 'library', id: lib[1] } : null
  const m = GEN_NAME.exec(ref.name)
  const named = BLOCKOUT[ref.name] ?? (m && Object.hasOwn(KINDS, m[1]) ? [m[1] as TextureKind, Number(m[2])] as const : null)
  if (!named) return null
  const blob = await db.getBlob(ref.hash)
  const img = blob && await pixelsOf(blob)
  if (!img || img.w !== img.h) return null
  const [kind, seed] = named
  const candidates = [{ ...defaultParams(kind), seed }, ...((await knownTweaks()).get(`${kind}:${seed}`) ?? [])]
  for (const c of candidates) {
    const p = { ...c, size: img.w }
    if (samePixels(generate(p), img.px)) return { kind: 'generated', params: p }
  }
  return null
}
