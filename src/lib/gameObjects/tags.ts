// Tags and a one-line description for each object in the "From my game" library, worked out from what the index
// already knows (names, the game's own names, textures, category, size, physics profile, the maps it is in), so
// people and the AI can find things by what they are, what they're made of, what state they're in, where they
// belong and what they're good for. Rules only, no lists of the game's names; computed when needed, so a library
// built before this existed gets tags too.
import type { GameObjectEntry } from './indexer'
import { identify } from './identity'

/** Tag words, by what they mean. */
export const TAG_GROUPS = {
  condition: ['run-down', 'upscale'],
  setting: ['street', 'industrial', 'shop', 'home', 'office', 'nightlife', 'construction', 'nature', 'sports', 'police', 'transport', 'restaurant', 'chinatown'],
  material: ['wood', 'metal', 'concrete', 'stone', 'glass', 'plastic', 'fabric', 'paper', 'rubber'],
  size: ['tiny', 'small', 'medium', 'large', 'huge'],
  use: ['cover', 'decoration', 'structure', 'ground', 'light', 'sign', 'container', 'seat', 'barrier', 'vehicle', 'movable'],
  place: ['indoor', 'outdoor', 'city', 'multiplayer'],
} as const

const WORDS: [RegExp, string[]][] = [
  // Condition.
  [/broken|burnt|burned|burn|rust|dirty|trash(?!_?can)|junk|graffiti|(^|_)graf|boarded|crack|wreck|damag|dilap|abandon|ruin|debris|rubble|scrap|husk|torn|smash|dent|grime|condemn|barrio|tire_?trsh|barb/, ['run-down']],
  [/marble|gold|chrome|luxur|(^|_)lux|fancy|crystal|chandel|velvet|mahog|designer|penthouse|highend|brass|jewel|bling|pictframegold|goldframe/, ['upscale']],
  // Settings.
  [/hydrant|mailbox|newspaper|parking|meter|lamp|streetlight|traffic|sign|bench|bus|kerb|curb|sidewalk|road|street|utility|pole|phone|trash ?can|dumpster/, ['street', 'outdoor']],
  [/crate|pallet|barrel|drum|container|forklift|pipe|warehouse|dock|crane|girder|scaffold|machine|generator|tank|valve|conveyor|boxcar|trailer|semi|lumber|reefer|rail_?car/, ['industrial']],
  [/shop|store|register|counter|shelf|shelves|cooler|vend|display|mannequin|clothes|shoe|(^|_)rack|cdrack|shoerack|cashier|price/, ['shop', 'indoor']],
  [/couch|sofa|(^|_)bed|tv|television|fridge|kitchen|bath|toilet|sink|dresser|nightstand|lamp_?shade|crib|apartment|(^|_)apt/, ['home', 'indoor']],
  [/desk|office|cubicle|copier|computer|monitor|filing|whiteboard|clipboard/, ['office', 'indoor']],
  [/neon|(^|_)bar(_|$)|club|beer|liquor|stripper|(^|_)pole_?dance|disco|dj|jukebox|pool_?table|ashtray|redlight|rld/, ['nightlife']],
  [/cone|barricade|barrier|scaffold|girder|cement|construction|(^|_)site|jersey|rebar|sawhorse|porta/, ['construction']],
  [/tree|bush|shrub|hedge|grass|plant|flower|rock|leaf|palm|log(_|$)|bonsai/, ['nature', 'outdoor']],
  [/basket|hoop|(^|_)ball|gym|weights|bleacher|scoreboard|goal/, ['sports']],
  [/police|jail|(^|_)cell(_|$)|(^|_)guard(?!rail|wall)|army|sandbag|military/, ['police']],
  [/(^|_)car(_|s?$|\d)|truck|(^|_)van(_|$)|(^|_)bus(_|$)|boat|train|el_?track|trailer|wheel|(^|_)tire|tyre|husk|forklift|bike/, ['transport']],
  [/burger|pizza|food|diner|kitchen|grill|fryer|menu|soda|cup|plate|napkin/, ['restaurant']],
  [/china|chinese|lantern|pagoda|dragon/, ['chinatown']],
]

/** The game's surface codes at the end of texture names. */
const SURFACE: Record<string, string> = { co: 'concrete', ma: 'stone', ce: 'stone', wo: 'wood', me: 'metal', tm: 'metal', fm: 'metal', gl: 'glass', gm: 'glass', gh: 'glass', pl: 'plastic', ca: 'fabric', cb: 'paper', rb: 'rubber', gs: 'nature', lv: 'nature' }

const BY_CATEGORY: Record<string, string[]> = {
  'Buildings': ['structure'], 'Building pieces': ['structure'], 'Ground and roads': ['ground', 'outdoor'], 'Water and sky': ['outdoor'],
  'Lights and signals': ['light'], 'Signs and billboards': ['sign'], 'Fences and barriers': ['barrier'], 'Street furniture': ['street', 'outdoor'],
  'Containers and crates': ['container'], 'Furniture': ['indoor'], 'Bottles, glass and small things': ['indoor'], 'Machines': [],
  'Nature': ['nature', 'outdoor'], 'Doors and windows': ['structure'], 'Wrecks and vehicles': ['vehicle', 'transport'],
}

const cache = new Map<string, string[]>()

/** Categories whose chest-high things make cover. */
const COVER_CATS = new Set(['Containers and crates', 'Furniture', 'Street furniture', 'Machines', 'Wrecks and vehicles', 'Fences and barriers', 'Nature'])


/** The object's tags, most telling first. */
export function tagsOf(e: GameObjectEntry): string[] {
  const hit = cache.get(e.id)
  if (hit) return hit
  const text = [e.name, ...(e.names ?? []), ...(e.raw ?? []), ...e.tex, e.profile].join(' ').toLowerCase()
  const out = new Set<string>(BY_CATEGORY[e.cat] ?? [])
  for (const [re, tags] of WORDS) if (re.test(text)) tags.forEach((t) => out.add(t))
  for (const t of e.tex) { const s = SURFACE[t.toLowerCase().replace(/\.\w+$/, '').match(/_([a-z]{2})$/)?.[1] ?? '']; if (s && s !== 'nature') out.add(s) }
  const [w, d, h] = e.size, big = Math.max(w, d, h)
  out.add(big < 0.5 ? 'tiny' : big < 1.5 ? 'small' : big < 4 ? 'medium' : big < 12 ? 'large' : 'huge')
  // Chest-high and solid enough to duck behind: a prop, not a piece of a building, the ground or the el.
  if (h >= 0.8 && h <= 2.4 && Math.min(w, d) >= 0.6 && Math.max(w, d) >= 0.9 && COVER_CATS.has(e.cat) && !/el_?track|eltrain|proxy|(^|_)blk|chunk|gnd|grnd|(^|_)ter_|_al(_|\s|$)|mtlimpus/.test(text)) out.add('cover')
  if (Math.min(w, d, h) < 0.08 || out.has('sign')) out.add('decoration')
  if (/chair|stool|bench|couch|sofa|seat/.test(text)) out.add('seat')
  if (e.physics || (e.profile && !/default/i.test(e.profile))) out.add('movable')
  const where = e.where ?? ['city']
  if (where.includes('city')) out.add('city')
  if (where.some((x) => x !== 'city')) out.add('multiplayer')
  if (!out.has('indoor') && !out.has('outdoor') && ['street', 'nature', 'ground'].some((t) => out.has(t))) out.add('outdoor')
  const tags = [...out]
  cache.set(e.id, tags)
  return tags
}

/** Setting and condition tags read from any description (a prefab's name and hint use the same words). */
export function textTags(text: string): string[] {
  const low = text.toLowerCase(), out = new Set<string>()
  for (const [re, tags] of WORDS) if (re.test(low)) tags.forEach((t) => out.add(t))
  return [...out]
}

/** A readable name for a library object ("trashcand" -> "Trash can"): the one identify() gives, so the library and the wizard agree. */
export const displayName = (e: GameObjectEntry): string => identify(e).name

/** One line about an object, for the AI and tooltips: "Mailbox: street furniture; metal, small (0.7 × 0.5 × 1.3 m); street, outdoor; used 120× in the game". */
export function describeEntry(e: GameObjectEntry): string {
  const tags = tagsOf(e).filter((t) => !(TAG_GROUPS.size as readonly string[]).includes(t))
  const size = e.size.map((v) => +v.toFixed(1)).join(' × ')
  return `${displayName(e)}${displayName(e) !== e.name ? ` (${e.name})` : ''}: ${e.cat.toLowerCase()}; ${size} m; ${tags.join(', ')}${e.seen > 1 ? `; used ${e.seen}× in the game` : ''}`
}

/** Everyday words people use, to the tags they mean ("ghetto" -> run-down, "fancy" -> upscale). */
const SYNONYMS: [RegExp, string][] = [
  [/ghetto|hood|slum|run-?down|broken|derelict|abandon|ruin|shabby|seedy|sketchy|trashy|grimy|dirty|rough|projects|barrio|wreck|junk|burn/, 'run-down'],
  [/fancy|luxur|rich|upscale|posh|classy|elegant|expensive|high-?end|mansion|penthouse|swanky/, 'upscale'],
  [/factory|warehouse|dock|port|harbou?r|industr|plant|yard|shipping/, 'industrial'],
  [/store|shop|mall|market|retail/, 'shop'], [/house|apartment|home|bedroom|living ?room|kitchen|crib/, 'home'],
  [/office|corporate|bank/, 'office'], [/club|bar|nightlife|party|disco|strip|red ?light/, 'nightlife'],
  [/construction|building site|work ?site/, 'construction'], [/park|garden|forest|nature|green/, 'nature'],
  [/street|road|downtown|city|urban|sidewalk/, 'street'], [/police|jail|prison|military|army|base/, 'police'],
  [/train|rail|station|parking|garage|traffic/, 'transport'], [/diner|restaurant|food|fast ?food|cafe/, 'restaurant'],
  [/china|chinese|asian/, 'chinatown'], [/cover|hide|duck behind|shelter/, 'cover'], [/inside|indoor|interior/, 'indoor'], [/outside|outdoor/, 'outdoor'],
]

/** The tags a request asks for, from its words. */
export function tagsFor(request: string): string[] {
  const low = request.toLowerCase()
  const out = new Set<string>()
  for (const [re, tag] of SYNONYMS) if (re.test(low)) out.add(tag)
  for (const group of Object.values(TAG_GROUPS)) for (const t of group) if (new RegExp(`\\b${t}\\b`).test(low)) out.add(t)
  return [...out]
}

/**
 * A varied pick of objects with the tags asked for: as many different kinds (names) and categories as it can, the
 * game's most used copies first, nothing too big to scatter. For filling a map with real game things.
 */
export function varietyPick(entries: GameObjectEntry[], tags: string[], count: number, maxSide = 6): GameObjectEntry[] {
  const want = new Set(tags)
  // Only stand-alone props (identify(): no building pieces, ground, fence runs, decals or blockers).
  const fits = entries.filter((e) => Math.max(...e.size) <= maxSide && Math.max(...e.size) >= 0.3 && Math.min(...e.size) >= 0.05 && identify(e).role === 'prop' && e.cat !== 'Other' && e.seen >= 2)
  const scored = fits.map((e) => {
    const t = tagsOf(e)
    return { e, score: (want.size ? t.filter((x) => want.has(x)).length : 1) + Math.min(1, Math.log10(1 + e.seen) / 3) }
  }).filter((x) => x.score >= (want.size ? 1 : 0)).sort((a, b) => b.score - a.score)
  const out: GameObjectEntry[] = []
  const names = new Set<string>(), cats = new Map<string, number>()
  // Round after round: a new kind each time, no category more than its share ahead of the others.
  for (let round = 0; out.length < count && round < 6; round++) {
    for (const { e } of scored) {
      if (out.length >= count) break
      if (out.includes(e) || (round < 2 && names.has(e.name))) continue
      if ((cats.get(e.cat) ?? 0) > round + 1) continue
      out.push(e); names.add(e.name); cats.set(e.cat, (cats.get(e.cat) ?? 0) + 1)
    }
  }
  return out
}
