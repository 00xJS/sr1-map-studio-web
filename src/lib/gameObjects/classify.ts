// Names and categories for the "From my game" library: a short base name for each object (copies of one model
// carry numbers and area tags around the same name) and a category guessed from plain words in its physics
// profile and its name. Only rules live here, no names from the game.

/** Lower case, without the copy numbers at the end and the short area tag some copies carry in front. */
export function baseName(name: string): string {
  let n = name.toLowerCase().replace(/(_?\d+)+$/, '').replace(/^\d+_?/, '')
  // A short tag in front ("ab_", "ab12_", "c9a_"), once or twice, when a real name is left after it.
  for (let i = 0; i < 2; i++) {
    const m = n.match(/^[a-z]{1,3}\d*[a-z]?_(.+)$/)
    if (m && m[1].length >= 4 && /[a-z]{3}/.test(m[1])) n = m[1]
  }
  return n.replace(/^\d+_?/, '').replace(/(_?\d+)+$/, '') || name.toLowerCase()
}

export const BUILDINGS = 'Buildings'
export const OTHER = 'Other'

/** Categories in the order the library shows them, each with the words that put an object in it. */
const RULES: [string, RegExp][] = [
  ['Lights and signals', /light|lamp|signal|siglmp|lantern/],
  ['Signs and billboards', /sign|billboard|banner|poster|marquee/],
  ['Fences and barriers', /fence|railing|guard ?rail|barrier|bollard|barricade|gate|cone|jersey/],
  ['Street furniture', /bench|hydrant|mailbox|newspaper|newsstand|payphone|phone|parking ?meter|meter|bus ?stop|trash|garbage|recycl|planter|manhole|drain|grate|picnic|porta ?potty|toilet/],
  ['Containers and crates', /crate|box|barrel|dumpster|container|pallet|palate|drum|spool|bag|tank|cylinder|cinder|lumber|pipe|bucket|tire|tyre|skip/],
  ['Furniture', /chair|table|sofa|couch|bed\b|desk|shelf|shelves|cabinet|locker|counter|stool|dresser|umbrella|furniture/],
  ['Bottles, glass and small things', /glass|bottle|cup\b|can\b|cans|pack|jar|plate|book|magazine|phone|keyboard|tray|electronics/],
  ['Machines', /machine|vend|register|pump|generator|grill|cooler|fridge|washer|dryer|\bac\b|vent|compressor|computer|monitor|\btv\b/],
  ['Nature', /tree|bush|shrub|plant|grass|rock|stone|log\b|timber|flower|hedge|palm|leaf|leaves/],
  ['Doors and windows', /door|window|shutter|garage/],
  ['Wrecks and vehicles', /car|husk|wreck|truck|boat|plane|bike|cart|trailer/],
  ['Water and sky', /water|pool|ocean|\bsea\b|river|fountain|sky|cloud|\bsun\b|moon|stars|atmosphere/],
  ['Ground and roads', /^ter_|terrain|ground|road|street|sidewalk|curb|kerb|asphalt|pavement|hwy|hway|highway|freeway|ramp|bridge|dirt|sand|gravel|grass|lawn|parking|crosswalk/],
  ['Building pieces', /wall|roof|floor|stair|step|beam|column|pillar|awning|ledge|trim|facade|duct|chimney|balcony|scaffold|girder|brick|concrete|plaster|tile|panel|frame|pipe|rail|arch|dome|tower|hull|base/],
]

export const CATEGORIES = [BUILDINGS, ...RULES.map(([c]) => c), OTHER]

/**
 * The category for an object from its profile name and base name, then (for pieces the name doesn't place) its
 * texture names; anything over 60 m across is ground or a road.
 */
export function categoryOf(profile: string, base: string, textures: string[] = [], size?: number[]): string {
  const p = profile.toLowerCase()
  const text = (p === 'default' ? '' : p + ' ') + base
  for (const [cat, re] of RULES) if (re.test(text)) return cat
  const tex = textures.map((t) => t.toLowerCase().replace(/\.\w+$/, '')).join(' ')
  for (const [cat, re] of RULES) if (re.test(tex)) return cat
  if (size && Math.max(size[0], size[1]) > 60 && size[2] < Math.max(size[0], size[1]) / 4) return 'Ground and roads'
  return OTHER
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
