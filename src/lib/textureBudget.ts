// How big a map's texture file (its PEG) will come out, before it is exported. The game reads a level's textures into
// its chunk's fixed memory pool; a map whose textures don't fit loads none of them, and players spawn into a black,
// empty map they can still stand on (a 136 MB cut of the city did). The biggest map known to load has about 25 MB.
// Each picture counts once however many materials use it (the exporter shares it: py/shared_textures.py), sized as
// the exporter sizes it: each side to a power of two (at most 1024), DXT1 (half a byte a pixel) or DXT5 with alpha
// (a byte), its mip chain, 4 KB aligned.
import type { Project } from './project'

/** The template's own textures every exported map starts with (sky, clouds, minimap), bytes. */
export const TEMPLATE_PEG_BYTES = 10_358_784
/** Above this (MB) the map may not load in game. */
export const SAFE_PEG_MB = 28

const pow2 = (n: number) => Math.min(1024, 1 << Math.max(2, Math.ceil(Math.log2(Math.max(4, n)))))

/** Bytes one picture takes in the PEG. */
export function pictureBytes(width: number, height: number, alpha: boolean): number {
  const w = pow2(width), h = pow2(height)
  const base = w * h * (alpha ? 1 : 0.5)
  return Math.ceil((base * 4) / 3 / 4096) * 4096
}

export interface TextureBudget {
  /** Different pictures (each stored once), and the materials using them. */
  pictures: number
  materials: number
  mb: number
  over: boolean
}

/**
 * The map's textures as the exporter will store them. `size` gives a stored picture's width and height (by file
 * hash); pictures it can't read count as 512 × 512.
 */
export async function textureBudget(project: Project, size: (hash: string) => Promise<[number, number] | null>): Promise<TextureBudget> {
  const pictures = new Map<string, boolean>()
  let materials = 0
  for (const it of project.scene_items) for (const [mat, path] of Object.entries(it.textures ?? {})) {
    const ref = project.files[path]
    if (!ref) continue
    materials++
    const key = ref.hash + (it.alpha?.[mat] ? ':a' : '')
    pictures.set(key, !!it.alpha?.[mat])
  }
  let bytes = TEMPLATE_PEG_BYTES
  await Promise.all([...pictures].map(async ([key, alpha]) => {
    const wh = await size(key.replace(/:a$/, '')).catch(() => null)
    bytes += pictureBytes(wh?.[0] ?? 512, wh?.[1] ?? 512, alpha)
  }))
  const mb = bytes / 1e6
  return { pictures: pictures.size, materials, mb: +mb.toFixed(1), over: mb > SAFE_PEG_MB }
}
