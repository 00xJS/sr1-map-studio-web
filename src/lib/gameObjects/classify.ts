// Names for the "From my game" library: a short base name for each object (copies of one model carry numbers and
// area tags around the same name), the building a part belongs to, and the names of copies never drawn. Only
// rules live here, no names from the game.
import { identify } from './identity'

/** Lower case, without the copy numbers at the end and the short area tag some copies carry in front. */
export function baseName(name: string): string {
  let n = name.toLowerCase().replace(/(_?\d+)+$/, '').replace(/^\d+_?/, '')
  // A short tag in front ("ab_", "ab12_", "c9a_"; not a word like "pier_"), once or twice, when a real name is left after it.
  for (let i = 0; i < 2; i++) {
    const m = n.match(/^(?:[a-z]{1,3}\d+[a-z]?|[a-z]{1,3})_(.+)$/)
    if (m && m[1].length >= 4 && /[a-z]{3}/.test(m[1])) n = m[1]
  }
  return n.replace(/^\d+_?/, '').replace(/(_?\d+)+$/, '') || name.toLowerCase()
}

// Categories and what each model is come from one rule table (identity.ts); these are kept for the callers that
// only want a category.
export { BUILDINGS, OTHER, CATEGORIES } from './identity'

/** The category for an object from its profile name, base name, textures and size (see identity.ts). */
export function categoryOf(profile: string, base: string, textures: string[] = [], size?: number[]): string {
  const [a = 1, b = 1, h = 1] = size ?? []
  return identify({ id: '', name: base, cat: '', profile, pack: '', chunk: '', record: 0, size: [a, b, h], tris: 0, tex: textures, seen: 1 }).category
}

/** Profile names the editor shows as a hint ("Default" means none). */
export const profileLabel = (p: string) => (!p || p.toLowerCase() === 'default' ? '' : p)

/** Names of things that are never seen: shadow volumes, blockers, occluders and lower-detail copies. */
export const skipName = (lname: string) => /_sdw|sdw$|shd$|_shd|shadow|blocker|occluder|_lod\d*$|lod$/.test(lname)

/**
 * The building a part belongs to, from its name: building parts share a code of letters and one digit and
 * letter ("abcd1a_frontdoor01"), or end in "_hull". Null for anything else.
 */
export function buildingCode(lname: string): string | null {
  const hull = lname.match(/^(.+)_hull$/)
  if (hull) return hull[1]
  const m = lname.match(/^([a-z]{2,10}\d[a-z])_[a-z]/)
  return m ? m[1] : null
}
