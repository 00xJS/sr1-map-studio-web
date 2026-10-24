// Plain names for the city's objects and their parts, from the game's record and texture names. The game names
// things in short codes ("ap_trshd", "bstvk_a_medsa", "Box_Car_ID1.tga", "B38_window01_gl.tga"); these rules turn
// the common ones into words. Only rules live here, no lists of the game's names.

/** Objects, by a part of their record or texture name (first match wins). Word starts matter: "street" is no tree. */
const OBJECTS: [RegExp, string][] = [
  [/missing-alpha|missing\.tga|norender|(^|_)proxy\d*_|(^|_)missing$/, 'Invisible blocker'],
  [/cardb|cardboard/, 'Cardboard box'], [/shoebox|boxshoe/, 'Shoe box'], [/lightswitch|light_switch/, 'Light switch'],
  [/12pack|sixpack|6pack/, 'Beer pack'], [/beer/, 'Beer bottles'], [/bottle/, 'Bottle'], [/jean|pants|shirt|dress|(^|_)cloth|hoodie|jacket/, 'Clothes'],
  [/artpic|picture|painting|portrait|(^|_)pics/, 'Picture'], [/locker/, 'Locker'], [/(^|_)safe\d*(_|$)/, 'Safe'], [/chandel|chandal/, 'Chandelier'],
  [/(^|_)sink/, 'Sink'], [/cash_?r|register|cashdet/, 'Cash register'], [/drill/, 'Drill press'], [/barb_?wire/, 'Barbed wire'],
  [/(^|_)trash|alltrash|litter|garbage(?!can)/, 'Trash'],
  [/lightceil|ceil_?light|flite/, 'Ceiling light'], [/shamp|haircare/, 'Hair products'], [/ashtr/, 'Ashtray'], [/wrench/, 'Wrenches'],
  [/firehyd|hydrant/, 'Fire hydrant'], [/trashcan|trash_can|garbagecan|trsh|ashcan|_ash_?can/, 'Trash can'], [/dumpster|dump(_|$)/, 'Dumpster'],
  [/picnictable/, 'Picnic table'], [/bench/, 'Bench'], [/planter/, 'Planter'], [/prkblk|parkingblock|parkblock|carstop/, 'Parking block'],
  [/newsstand|newsbox|news(side|rack)|(^|_)news/, 'Newspaper box'], [/phonebooth|payphone/, 'Payphone'], [/mailbox|mailbx/, 'Mailbox'],
  [/(^|_)meter|parkmeter|parkingmeter/, 'Parking meter'], [/gaugepower|powermeter/, 'Power meter'],
  [/utilitypole|telepole|tele_?pole/, 'Utility pole'], [/telewire|powerline|(^|_)wires?(_|$)|p_wire/, 'Power lines'],
  [/trafficlight|stoplight|traffic_?signal|(^|_)signal/, 'Traffic light'], [/trfcsgn|trafficsign|stopsign|streetsign|signpost/, 'Street sign'],
  [/bannerpole/, 'Banner pole'], [/streetlight|lmpst|lamp|lppost|highway-light/, 'Street lamp'],
  [/guardrail/, 'Guardrail'], [/shtmtl|sheetmetal/, 'Sheet metal fence'], [/chainlink|chain_?fnc/, 'Chain-link fence'], [/fnc|fence/, 'Fence'],
  [/railing|handrail|(^|_)rail_/, 'Railing'], [/eltrack|eltrain|el_track/, 'El track'], [/el_?(small)?support/, 'El support'],
  [/box_?car(?!d)/, 'Boxcar'], [/semi_?trailer|psemi|(^|_)semi|trailerwheel/, 'Semi trailer'], [/forklift/, 'Forklift'],
  [/(^|_)tree|palm(_|tree|$)|(^|_)oak|(^|_)pine/, 'Tree'], [/bush|shrub|hedge|leaf_|greenleaf/, 'Bush'], [/(^|_)grass|_gs$/, 'Grass'],
  [/statue/, 'Statue'], [/fountain/, 'Fountain'], [/lumber/, 'Lumber stack'], [/pallet/, 'Pallet'], [/crate/, 'Crate'], [/barrel/, 'Barrel'],
  [/couch|sofa/, 'Couch'], [/chair/, 'Chair'], [/(^|_)table/, 'Table'], [/(^|_)tv_|television/, 'TV'], [/fridge|refrig/, 'Fridge'],
  [/acunit|acind|aircon/, 'AC unit'], [/(^|_)vent/, 'Vent'], [/patio/, 'Patio'], [/billboard/, 'Billboard'], [/poster|flyer/, 'Poster'],
  [/hwy|freeway|highway/, 'Highway'], [/sidewlk|sidewalk|sidewk/, 'Sidewalk'], [/curb|kerb/, 'Kerb'],
  [/(^|_)road|(^|_)street|asphalt|(^|_)rd_/, 'Road'], [/(^|_)ter_|terrain/, 'Ground'], [/hoswall|(^|_)wall/, 'Wall'], [/winlit|window/, 'Window'], [/roof/, 'Roof'],
  [/door/, 'Door'], [/stair|(^|_)steps?(_|$)/, 'Stairs'], [/olddwnt|dwnt|bldg|building|_hull$/, 'Building'],
]

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

/** Words from a name when it reads like words: "lumberstack_a" -> "Lumberstack"; codes ("bstvk_a_medsa") give ''. */
function readable(raw: string): string {
  const words = clean(raw).replace(/[_\-.]+/g, ' ').replace(/\d+/g, ' ').split(' ').filter((w) => w.length > 1)
  // Short consonant clusters and two-letter tags are codes, not words.
  const real = words.filter((w) => w.length >= 3 && /[aeiou]/.test(w) && !/^[^aeiou]{3,}/.test(w))
  if (!real.length) return ''
  const s = real.join(' ').replace(/([a-z]{4,})[a-c]$/, '$1')
  return s[0].toUpperCase() + s.slice(1)
}

/** A plain name for a city object from its record name and its main texture. */
export function objectName(record: string, texture = ''): string {
  const r = clean(record), t = clean(texture)
  const fromRecord = r ? match(OBJECTS, r) : '', fromTexture = t ? match(OBJECTS, t) : ''
  // A record that only says where it is ("road", "wall") loses to a texture that says what it is (trash on the road).
  if (fromRecord && !(GENERIC.has(fromRecord) && fromTexture && !GENERIC.has(fromTexture))) return fromRecord
  return fromTexture || (t && match(PARTS, t)) || readable(record) || (texture && surfaceWord(texture) ? surfaceWord(texture) + ' piece' : '')
}

/** Names that say where something is rather than what it is. */
const GENERIC = new Set(['Road', 'Ground', 'Sidewalk', 'Kerb', 'Wall', 'Building', 'Highway', 'Roof'])

/** A plain name for a building part from its texture ("B11_window_tm.tga" -> "Window"), or '' when it says nothing. */
export function partName(texture: string): string {
  const t = clean(texture)
  return (t && (match(PARTS, t) || match(OBJECTS, t))) || surfaceWord(texture)
}

/** How telling a part name is: lower comes first (a poster in a frame is a poster). */
export const partRank = (name: string) => { const i = PARTS.findIndex(([, n]) => n === name); return i < 0 ? PARTS.length : i }
