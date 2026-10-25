// Plain names for the city's objects and their parts, from the game's record and texture names. The game names
// things in short codes ("ap_trshd", "bstvk_a_medsa", "Box_Car_ID1.tga", "B38_window01_gl.tga"); objects are
// named by the library's one rule table (gameObjects/identity.ts), building parts by their pictures here. Only
// rules live here, no lists of the game's names.
import { GENERIC_NAMES, INVISIBLE_TEXTURE, pieceName } from '../gameObjects/identity'

/** A building's own pieces in the city view: its shell and its size-named detail pieces ("bstvk_a_larges"). */
const BUILDING = /olddwnt|dwnt|bldg|building|hull$|_(larges?|meds?|smalls?)[a-z]?$/

/** Building parts, by their texture's name (first match wins). */
const PARTS: [RegExp, string][] = [
  [/missing-alpha|missing\.tga|norender|(^|_)proxy\d*_|(^|_)missing$/, 'Invisible blocker'],
  [/lightswitch|light_switch/, 'Light switch'], [/artpic|picture|painting|portrait|(^|_)pics/, 'Picture'], [/barb_?wire/, 'Barbed wire'],
  [/poster|_ad_|advert|flyer|billb/, 'Poster'], [/graffiti|(^|_)graf|(^|_)tag_/, 'Graffiti'], [/neon/, 'Neon sign'],
  [/marquee|marq/, 'Marquee'], [/banner/, 'Banner'], [/sign|logo|letter/, 'Sign'], [/awning|canopy/, 'Awning'],
  [/fire_?esc|fireesc/, 'Fire escape'], [/ladder/, 'Ladder'], [/balcon/, 'Balcony'],
  [/garage_?door|rollup|roll_?door|shutter/, 'Shutter'], [/door/, 'Door'], [/win|glass|pane|blind|curtain/, 'Window'],
  [/gate/, 'Gate'], [/grate|bars|grill|mesh|cage/, 'Grate'], [/vent|exhaust|(^|_)fan/, 'Vent'], [/ac_?unit|acunit|aircon/, 'AC unit'],
  [/pipe|gutter|drain|downspout/, 'Pipe'], [/rail|banister/, 'Railing'], [/fence/, 'Fence'],
  [/light|lamp|bulb/, 'Light'], [/pole|post|pillar|column|beam|girder|support/, 'Post'], [/ornament|deco|statue|crest/, 'Ornament'],
  [/chimney/, 'Chimney'], [/stair|step/, 'Steps'], [/roof|shingle|(^|_)tar_/, 'Roof'],
  [/trim|ledge|cornice|molding|moulding|sill|lintel|frieze|border|edge/, 'Trim'],
  [/strp|stripe|curbpaint|lane|xwalk|crosswalk/, 'Road paint'], [/sidewlk|sidewalk|sidewk/, 'Sidewalk'], [/street|asphalt|road/, 'Road'],
  [/box_?car(?!d)/, 'Boxcar'], [/eltrack/, 'El track'], [/grass/, 'Grass'], [/gravel/, 'Gravel'], [/dirt|mud/, 'Dirt'],
  [/brick|stone|concrete|conc\d|stucco|plaster|siding|wall|block|facade|marble|cement/, 'Wall'],
  [/metal|steel|iron|(^|_)tin|corrug|galv/, 'Metal panel'], [/wood|plank|board/, 'Wood panel'], [/tile/, 'Tiles'],
]

/** The game's surface codes at the end of texture names ("_wo" wood, "_me" metal...): the last way to say what a piece is. */
const SURFACE: Record<string, string> = {
  co: 'Concrete', cb: 'Cardboard', ca: 'Fabric', ce: 'Ceramic', dt: 'Dirt', dw: 'Drywall', lv: 'Leaves', gh: 'Glass', gm: 'Glass', gl: 'Glass',
  gs: 'Grass', gv: 'Gravel', ma: 'Marble', fm: 'Metal fence', me: 'Metal', tm: 'Metal', pl: 'Plastic', rb: 'Rubber', sa: 'Sand', wa: 'Water', wo: 'Wood',
}

/** Lower case, without the file type and the chunk prefix. */
const clean = (raw: string) => raw.toLowerCase().replace(/\.[^.]+$/, '').replace(/^(sr_)?(chunk\d+\w*?_)?/, '')
const match = (table: [RegExp, string][], s: string) => { for (const [re, name] of table) if (re.test(s)) return name; return '' }
const surfaceWord = (tex: string) => SURFACE[clean(tex).match(/_([a-z]{2})$/)?.[1] ?? ''] ?? ''

/** A plain name for a city object from its record name and its main texture (the library's rules: identity.ts). */
export function objectName(record: string, texture = ''): string {
  if (BUILDING.test(clean(record)) && !(texture && INVISIBLE_TEXTURE.test(texture.toLowerCase()))) {
    // A building's piece wearing a telling picture (a window, a sign) is named after it.
    const t = texture && match(PARTS, clean(texture))
    return t && !['Wall', 'Metal panel', 'Wood panel', 'Trim'].includes(t) ? t : 'Building'
  }
  return pieceName(record, texture) || (texture && surfaceWord(texture) ? surfaceWord(texture) + ' piece' : '')
}

/** A plain name for a building part from its texture ("B11_window_tm.tga" -> "Window"), or '' when it says nothing. */
export function partName(texture: string): string {
  const t = clean(texture)
  const named = t && pieceName('', texture)
  return (t && (match(PARTS, t) || (GENERIC_NAMES.has(named) ? '' : named))) || surfaceWord(texture)
}

/** How telling a part name is: lower comes first (a poster in a frame is a poster). */
export const partRank = (name: string) => { const i = PARTS.findIndex(([, n]) => n === name); return i < 0 ? PARTS.length : i }
