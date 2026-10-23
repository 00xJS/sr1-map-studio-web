// Object gallery: every prefab of a category laid out in rows on a plain floor,
// a page at a time, so you can walk or fly past each one (or export it) and
// spot anything that looks wrong: flicker, gaps, odd sizes.
import { ALL_PREFABS, PREFAB_CATEGORIES } from './prefabRegistry'
import { prefabParams, tagPrefab } from './prefabs'
import { box, LIGHT, PB, type MarkerSpec, type Part, type Sample } from './sampleKit'
import type { Vec3 } from './project'

/** At most this many objects, or this much floor (square units), on one page. */
const PAGE_COUNT = 30
const PAGE_AREA = 36000
/** Space between objects, and the walkway in front of each row. */
const GAP = 8
const AISLE = 12
const MAX_LIGHTS = 60

export interface GalleryPage { category: string; page: number; pages: number; keys: string[] }

/** Footprint of a prefab placed at the origin facing 0: [minX, minZ, maxX, maxZ]. */
function footprint(key: string): [number, number, number, number] {
  const parts = ALL_PREFABS[key].make(0, 0, 0, 0)
  let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const p of parts) {
    const t = ((p.rot ?? 0) * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t)
    const [hx, hz] = [p.size[0] / 2, p.size[2] / 2]
    for (const [dx, dz] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]) {
      const x = p.at[0] + dx * c + dz * s, z = p.at[2] - dx * s + dz * c
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z)
    }
  }
  return Number.isFinite(x0) ? [x0, z0, x1, z1] : [-1, -1, 1, 1]
}

/** Every category split into pages small enough to build and walk comfortably. */
export function galleryPages(): GalleryPage[] {
  const out: GalleryPage[] = []
  for (const category of PREFAB_CATEGORIES) {
    const keys = Object.keys(ALL_PREFABS).filter((k) => ALL_PREFABS[k].category === category)
    const pages: string[][] = []
    let cur: string[] = [], area = 0
    for (const k of keys) {
      const [x0, z0, x1, z1] = footprint(k)
      const a = (x1 - x0 + GAP) * (z1 - z0 + AISLE)
      if (cur.length && (cur.length >= PAGE_COUNT || area + a > PAGE_AREA)) { pages.push(cur); cur = []; area = 0 }
      cur.push(k); area += a
    }
    if (cur.length) pages.push(cur)
    pages.forEach((keys, i) => out.push({ category, page: i + 1, pages: pages.length, keys }))
  }
  return out
}

export const galleryName = (g: GalleryPage) => `${g.category} gallery${g.pages > 1 ? ` ${g.page} of ${g.pages}` : ''}`

/** One gallery page as a map: the objects in rows with a walkway in front of each, player spawns along the front one. */
export function gallerySample(g: GalleryPage): Sample {
  const prints = g.keys.map(footprint)
  const total = prints.reduce((s, [x0, z0, x1, z1]) => s + (x1 - x0 + GAP) * (z1 - z0 + AISLE), 0)
  const rowWidth = Math.max(80, Math.sqrt(total) * 1.3)
  // Shelf packing, left to right, rows going back (+Z).
  const placed: { key: string; at: Vec3 }[] = []
  let x = 0, z = AISLE, depth = 0, width = 0
  g.keys.forEach((key, i) => {
    const [x0, z0, x1, z1] = prints[i]
    if (x > 0 && x + (x1 - x0) > rowWidth) { z += depth + AISLE; x = 0; depth = 0 }
    placed.push({ key, at: [x - x0, 1, z - z0] })
    x += x1 - x0 + GAP
    width = Math.max(width, x - GAP)
    depth = Math.max(depth, z1 - z0)
  })
  const far = z + depth + AISLE
  // Room for a few spawns even on a page with one small object.
  width = Math.max(width, 80)
  // Centre everything on the origin.
  const [cx, cz] = [width / 2, far / 2]
  const parts: Part[] = [box('Ground', [width + 2 * AISLE, 1, far], [0, 0, 0], PB.concrete, PB.concrete, 0, 8)]
  for (const { key, at } of placed) {
    const def = ALL_PREFABS[key], params = prefabParams(def)
    const p: Vec3 = [at[0] - cx, at[1], at[2] - cz]
    parts.push(...tagPrefab(def.make(p[0], p[2], 0, p[1], params), key, params, p, 0))
  }
  const markers: MarkerSpec[] = []
  // Along the front walkway, 10 m apart (the walkways between rows can be closer than that).
  for (let sx = AISLE / 2; sx < width; sx += 20) markers.push(['Shared spawn', [sx - cx, 1, AISLE / 2 - cz], { yaw: 180 }])
  const lights: [Vec3, Vec3?][] = []
  const step = Math.max(24, Math.sqrt(((width + 2 * AISLE) * far) / MAX_LIGHTS))
  for (let lx = -width / 2; lx <= width / 2 && lights.length < MAX_LIGHTS; lx += step) {
    for (let lz = -far / 2 + step / 2; lz <= far / 2 && lights.length < MAX_LIGHTS; lz += step) lights.push([[lx, 14, lz], LIGHT.white])
  }
  return {
    id: `gallery_${g.category.toLowerCase().replace(/[^a-z0-9]+/g, '')}_${g.page}`,
    name: galleryName(g), icon: '🧪', theme: 'Starter', modes: ['Gangsta Brawl'], size: 'full',
    description: `Every ${g.category.toLowerCase()} object${g.pages > 1 ? ` (part ${g.page} of ${g.pages})` : ''} in rows, for checking how each looks in the editor and in game.`,
    parts, markers, lights,
  }
}
