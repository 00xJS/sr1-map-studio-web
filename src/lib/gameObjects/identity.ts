// What a model from the player's game is, in one place: its role (a whole building, a piece of one, a stand-alone
// prop, ground, a fence run, or something never placed), a plain name, the library category it is shown under,
// what kind of prop it is, which new-map settings it suits, and for buildings the facts a layout needs. The
// library (its categories, names and tiles) and the new-map wizard ("Game pieces") both read this answer, so they
// always agree.
//
// One rule table (RULES) decides role, category, name and prop kind together, from the model's record names, the
// game's own names for it, its physics profile and textures, its size and shape and where it is placed. Only rules
// live here, no lists of the game's names.
import type { GameObjectEntry, GamePart } from './indexer'
import type { WizardSetting } from '../mapWizard'

export type GameRole =
  /** A whole building: placed on its own, on a plot. */
  | 'building'
  /** Part of a building (a wall, a window, a roof, a door) or of a bigger thing (a lamp's base): never placed alone. */
  | 'piece'
  /** Stands on its own and can go anywhere fitting: cover, clutter, street furniture, plants, lights, wrecks, signs. */
  | 'prop'
  /** A ground, road, sidewalk or kerb tile. */
  | 'ground'
  /** A run of fence, wall or barrier: placed along an edge. */
  | 'fence'
  /** Never placed: invisible blockers, shadow and low-detail copies, decals, sky, water surfaces. */
  | 'skip'

export type PropKind = 'cover' | 'clutter' | 'street' | 'nature' | 'light' | 'vehicle' | 'sign' | 'furniture' | 'machine'

export interface BuildingFacts {
  /** Long side and short side, metres (`long` says which way the long side runs). */
  footprint: [number, number]
  /** Metres. */
  height: number
  storeys: number
  /** Which side of its own frame the front (main door, shop front) faces; unknown when it can't be told. */
  front?: '+x' | '-x' | '+z' | '-z'
  /** The axis of its own frame the long side runs along (the frame is the game's, as the model is cut out). */
  long?: 'x' | 'z'
  /** What kind of building ("apartment block", "warehouse"). */
  type?: string
  /** Its main wall material ("brick", "concrete"). */
  material?: string
  /** The Stilwater districts it stands in. */
  districts?: string[]
}

export interface GameIdentity {
  role: GameRole
  /** The library category it is shown under (CATEGORIES). */
  category: string
  /** A plain name ("Parking block", "4-storey brick apartment block"). */
  name: string
  /** Props: what kind, for the wizard to pick by. */
  kind?: PropKind
  /** New-map settings it suits (empty: any). */
  settings: WizardSetting[]
  /** Buildings only. */
  building?: BuildingFacts
  /**
   * The other models that make this one whole, where each stands in this one's frame (a lamp's base and foot, a
   * fence panel's feet, a container's doors): place them with it. See GameObjectEntry.assembly.
   */
  assembly?: GamePart[]
  /** It is one of those parts of a bigger model (its id): placed with that one, not alone. */
  partOf?: string
  /** A second copy of another model at the same spot (its id): place one or the other, never both. */
  copyOf?: string
  /** The models the game most often stands near this one (ids, most telling first), for placing things where they belong. */
  near?: string[]
  /**
   * A piece made for one kind of building (its own windows, doors, trims, corners): that building's code, and
   * the buildings of that kind it stands on (ids). Use it only with those buildings, never mixed onto others.
   */
  kitOf?: string
  belongsTo?: string[]
  /** Buildings: the pieces made only for buildings of this kind (ids). */
  kit?: string[]
  /**
   * Buildings: every piece the game places on most copies of this one (windows, doors, signs, roof units...),
   * where and turned how in the building's own frame (see GameObjectEntry.layout); placing them all completes
   * it. Leave out the parts identify() calls 'skip'.
   */
  layout?: GamePart[]
}

// ---------------- categories ----------------

export const BUILDINGS = 'Buildings'
export const HIDDEN = 'Hidden and decals'
export const OTHER = 'Other'
const LIGHTS = 'Lights and signals', SIGNS = 'Signs and billboards', FENCES = 'Fences and barriers', STREET = 'Street furniture'
const CONTAINERS = 'Containers and crates', FURNITURE = 'Furniture', SMALL = 'Bottles, glass and small things', MACHINES = 'Machines'
const NATURE = 'Nature', OPENINGS = 'Doors and windows', VEHICLES = 'Wrecks and vehicles', SKY = 'Water and sky'
const GROUND = 'Ground and roads', PIECES = 'Building pieces'

/** Categories in the order the library shows them. */
export const CATEGORIES = [BUILDINGS, LIGHTS, SIGNS, FENCES, STREET, CONTAINERS, FURNITURE, SMALL, MACHINES, NATURE, OPENINGS, VEHICLES, GROUND, PIECES, SKY, HIDDEN, OTHER]

/** The role a category's models have unless their rule says otherwise. */
const ROLE_OF: Record<string, GameRole> = {
  [BUILDINGS]: 'building', [PIECES]: 'piece', [OPENINGS]: 'piece', [GROUND]: 'ground', [FENCES]: 'fence', [SKY]: 'skip', [HIDDEN]: 'skip',
}
/** The kind a category's props are unless their rule says otherwise. */
const KIND_OF: Record<string, PropKind> = {
  [LIGHTS]: 'light', [SIGNS]: 'sign', [FENCES]: 'cover', [STREET]: 'street', [CONTAINERS]: 'cover', [FURNITURE]: 'furniture', [SMALL]: 'clutter',
  [MACHINES]: 'machine', [NATURE]: 'nature', [VEHICLES]: 'vehicle', [OTHER]: 'clutter',
}

// ---------------- the rule table ----------------

/** A model's facts, as the rules read them. */
interface Facts {
  /** Its record names and the game's names for it: lower case, copy numbers and area tags off. */
  names: string[]
  /** Its physics profile when that says what it is ("trashcan_anchored"; not "wood_object_2x2x2"). */
  profile: string[]
  /** Its record names are a building's part names ("abcd1a_medfront"): a piece of a building, whatever it shows. */
  part: boolean
  /** The game's own names mark it a decal ("DEC_..."). */
  decal?: boolean
  /** Its texture names, lower case, no file type. */
  tex: string[]
  /** Long side, short side, height (metres). */
  size: [number, number, number]
  /** A piece placed without a record of its own (named after its texture). */
  loose: boolean
  /** Named without its size (a city piece by its names alone): shape variants (posts, bases) are left out. */
  sizeless?: boolean
}

interface Rule {
  re: RegExp
  name: string
  cat: string
  role?: GameRole
  kind?: PropKind
  /** Where the words are looked for (default both: names first, then textures). */
  on?: 'name' | 'tex'
  /** A test on size and shape the model must pass too. */
  when?: (f: Facts) => boolean
  /** It says where something is (a road, a wall) rather than what it is: a texture that says more wins. */
  generic?: boolean
  /** A shape variant of the rule before it (its post, its base): only for a model whose size is known. */
  variant?: boolean
}

const R = (re: RegExp, name: string, cat: string, o: Omit<Rule, 're' | 'name' | 'cat'> = {}): Rule => ({ re, name, cat, ...o })

// Shape tests (metres).
const small = (f: Facts) => Math.max(...f.size) < 1.6
const tiny = (f: Facts) => Math.max(...f.size) < 0.35
const flat = (f: Facts) => Math.min(...f.size) < 0.02
const runLike = (f: Facts) => f.size[0] >= 1.5 && f.size[1] < Math.max(0.8, f.size[0] / 4)
const big = (f: Facts) => f.size[0] >= 12
const post = (f: Facts) => f.size[0] < 0.5 && f.size[2] > Math.max(0.8, f.size[0] * 2)
/** Shaped like a vehicle: long (a bike's 1.5 m up to a bus), clearly longer than wide, no taller than a truck. */
const vehicleShape = (f: Facts) => f.size[0] >= 1.5 && f.size[0] >= 1.8 * f.size[1] && f.size[2] >= 0.8 && f.size[2] <= 5 && (f.size[0] >= 2.2 || f.size[1] < 0.9)

/** First match wins. Word starts matter: "street" is no tree. */
const RULES: Rule[] = [
  // Lights and signals.
  // A thing's own door ("boxcardr1a", "portapottydoora"): a piece of it.
  R(/(?<!out|in)[a-z]door[a-d]?$|(box_?car|husk|potty|truck|van)_?(door|dr)/, 'Door', OPENINGS),
  R(/husk_?tire|husk_?wheel/, 'Tire', CONTAINERS, { kind: 'clutter' }),
  R(/head_?stone|grave_?stone|(^|_)tomb/, 'Gravestone', STREET),
  R(/tree_?(gate|guard)/, 'Tree guard', STREET),
  R(/anchor/, 'Anchor', STREET, { on: 'name' }),
  R(/water_?tower_?(spt|sup|brc|brace|leg|bse|base|x)/, 'Water tower support', PIECES),
  R(/(^|_)substn|substation/, 'Substation equipment', MACHINES, { on: 'name' }),
  R(/el(evator)?_?pan(el)?$|elevator_?(button|panel)|(^|_)elpan/, 'Elevator panel', PIECES),
  R(/sec_?gate|grille|security_?bars?/, 'Security grille', OPENINGS),
  R(/pillow|cushion/, 'Pillow', FURNITURE, { kind: 'clutter' }),
  R(/floor_?mat|door_?mat/, 'Rug', FURNITURE, { kind: 'clutter' }),
  R(/dart|arrow_?(a|b)?$/, 'Dart', SMALL, { on: 'name' }),
  R(/tattoo/, 'Tattoo gear', SMALL),
  R(/(^|_)cds?(_|$|stack|rack|case|jewel)|(^|_)dvds?|cd_?jewel/, 'CDs', SMALL),
  R(/luggage|baggage|conveyor/, 'Conveyor', MACHINES),
  R(/lift_?engine|engine_?hoist|(^|_)hoist|(^|_)engine/, 'Engine hoist', MACHINES),
  R(/pop_?mach|soda_?mach|vend/, 'Vending machine', MACHINES),
  R(/lightdecal|lightpool|light_?glow|(^|_)glow|lightfade|lightcone|lightbeam|(^|_)flare|corona|godray/, 'Light glow', HIDDEN),
  R(/trafficsig|traffic_?light|stoplight|traffic_?signal|(^|_)signal|siglmp|(^|_)sig_?(bse|base)|trfclt/, 'Traffic light', LIGHTS),
  R(/sconce|walllight|wall_?lamp|(^|_)wlamp/, 'Wall lamp', LIGHTS, { role: 'piece' }),
  R(/lightceil|ceil_?(ing)?_?light|flite|fluorescent|florescent|chandel|chandal|ceilingfan|hanglamp|pendant/, 'Ceiling light', LIGHTS, { role: 'piece' }),
  R(/neon/, 'Neon sign', SIGNS),
  R(/banner_?pole/, 'Street lamp with banners', LIGHTS, { kind: 'street', when: (f) => f.size[2] >= 2.5 }),
  R(/streetlight|street_?lamp|lamppost|lmpst|lmppst|lppost|lamp_?post|highway-?light|lotlamp|(^|_)lamppole|lightpole|lghtpole|floodlight|fldlight|spotlight/, 'Street lamp', LIGHTS, { kind: 'street', when: (f) => f.size[2] >= 2.5 }),
  R(/streetlight|street_?lamp|lamppost|lmpst|lmppst|lppost|lamp_?post|highway-?light|lotlamp|(^|_)lamppole|lightpole|lghtpole|floodlight|fldlight|spotlight/, 'Street lamp base', LIGHTS, { variant: true, role: 'piece', when: (f) => f.size[2] < 1.5 && f.size[0] < 1.2 }),
  R(/sky_?light/, 'Window', OPENINGS),
  R(/(^|_)lamp|lantern|light(?!_?switch|house|ning|weight)|(^|_)lite/, 'Lamp', LIGHTS),
  // Signs.
  R(/billboard|billb/, 'Billboard', SIGNS),
  R(/poster|flyer|(^|_)ad_|advert|motivation/, 'Poster', SIGNS),
  R(/trfcsgn|trafficsign|stopsign|streetsign|signpost|roadsign|(^|_)strsign|yieldsign|onewaysign/, 'Street sign', SIGNS, { kind: 'street' }),
  R(/marquee|marq(ui)?e?(_|$)|marquie/, 'Marquee', SIGNS),
  R(/banner(?!pole)|(^|_)flags?(_|$)/, 'Banner', SIGNS),
  R(/(^|_)sign|sign(_|$|s$|[a-d]$)|logo|letters?(_|$)/, 'Sign', SIGNS),
  R(/artpic|picture|painting|portrait|(^|_)pics|picfram|frame_?pic/, 'Picture', SMALL),
  // Fences and barriers.
  R(/barb_?wire|brb_?wi?re?|barbwire|razorwire|(^|_)brbwr/, 'Barbed wire', FENCES),
  R(/guard_?rail|grdrail/, 'Guardrail', FENCES, { when: runLike }),
  R(/guard_?rail|grdrail/, 'Guardrail post', FENCES, { variant: true, role: 'piece' }),
  R(/shtmtl|sheetmetal|sheet_?metal/, 'Sheet metal fence', FENCES),
  R(/chain_?link|chain_?fnc|fence_?chain|chainfence|(^|_)cc_chainlink|fncchain|superm?fnce|cnstr_?fnc|fence_?cnstr|_fm$/, 'Chain-link fence', FENCES),
  R(/fence_?iron|iron_?fence|fenceheiron|wrought|fnc_?iron/, 'Iron fence', FENCES),
  R(/pick(et)?_?fence|fence_?wd_?pick|wdpick/, 'Picket fence', FENCES),
  R(/fence_?wd|wood_?fence|wdfnc|fnc_?wd/, 'Wooden fence', FENCES),
  R(/fence_?brb|brb_?fence/, 'Barbed-wire fence', FENCES),
  R(/jersey|(^|_)k_?rail|conc(rete)?_?barrier|cement_?barrier|road_?block/, 'Concrete barrier', FENCES, { role: 'prop', kind: 'cover' }),
  R(/barricade|sawhorse/, 'Barricade', FENCES, { role: 'prop', kind: 'street' }),
  R(/bollard|barrier_?pole|(^|_)bpost/, 'Bollard', FENCES, { role: 'prop', kind: 'street' }),
  R(/(^|_)cone|traffic_?cone/, 'Traffic cone', FENCES, { role: 'prop', kind: 'street' }),
  R(/(^|_)gate|gate(_|s?$|[a-d]$)/, 'Gate', FENCES),
  R(/hand_?rail|railing|banister|(?<!guard)rail(?!er|_?(car|road|way|track|line))/, 'Railing', FENCES, { when: runLike }),
  R(/hand_?rail|railing|banister|(?<!guard)rail(?!er|_?(car|road|way|track|line))/, 'Railing post', FENCES, { variant: true, role: 'piece', when: (f) => f.size[0] < 0.4 }),
  R(/hand_?rail|railing|banister|(?<!guard)rail(?!er|_?(car|road|way|track|line))/, 'Railing', FENCES, { role: 'piece' }),
  R(/(^|_)links?$|(^|_)chains?(_|$)/, 'Chain', PIECES),
  R(/barrier/, 'Barrier', FENCES, { role: 'prop', kind: 'cover' }),
  R(/endandhinge/, 'Wooden fence', FENCES, { on: 'tex' }),
  R(/fnc|fence/, 'Fence post', FENCES, { variant: true, role: 'piece', when: post }),
  R(/fnc|fence/, 'Fence', FENCES),
  R(/rtain_?wall|retain(ing)?_?wall|seawall/, 'Retaining wall', FENCES),
  R(/wall(?!_?(light|lamp|paper|clock|sign|post|pst|art|shelf|mount))/, 'Boundary wall', FENCES, { variant: true, on: 'name', when: (f) => runLike(f) && !f.part && f.size[2] <= 8 }),
  // Street furniture.
  R(/parking_?block|prk_?blk|park_?block|carstop|(^|_)p_?block|wheelstop|curbstop/, 'Parking block', STREET),
  R(/fire_?hyd|hydrant/, 'Fire hydrant', STREET),
  R(/mail_?box|mailbx|postbox|(^|_)usps/, 'Mailbox', STREET),
  R(/news_?stand|newsbox|news_?(side|rack|paper)|(^|_)news/, 'Newspaper box', STREET, { on: 'name' }),
  R(/phone_?booth|pay_?phone/, 'Payphone', STREET),
  R(/park(ing)?_?meter|(^|_)meter(_|$|[a-d]$)/, 'Parking meter', STREET),
  R(/trash_?can|garbage_?can|(^|_)trsh|(^|_)s?trash$|ash_?can|waste_?bin|litter_?bin|(^|_)bin(_|$)/, 'Trash can', STREET),
  R(/trash_?bag|garbage_?bag|bin_?bag/, 'Trash bags', STREET, { kind: 'clutter' }),
  R(/(^|_)trash(?!_?can)|alltrash|street_?trash|litter|garbage(?!_?can)|debris|rubble|(^|_)junk(?!mattress|comp|car|tv|pc)/, 'Trash', STREET, { kind: 'clutter' }),
  R(/picnic/, 'Picnic table', STREET),
  R(/bench/, 'Bench', STREET),
  R(/planter|plntr|flower_?box|flowerpot|(^|_)pot_?plant/, 'Planter', STREET),
  R(/bus_?stop|bus_?shelter/, 'Bus stop', STREET),
  R(/utility_?pole|tele_?pole|power_?pole|phone_?pole|(^|_)telpole/, 'Utility pole', STREET),
  R(/tele_?wire|power_?line|(^|_)wires?(_|$)|p_wire|(^|_)cables?(_|$)/, 'Power lines', STREET, { role: 'piece' }),
  R(/manhole|drain_?cover|sewer/, 'Manhole cover', GROUND),
  R(/grate|(^|_)drain/, 'Drain grate', GROUND, { when: (f) => f.size[2] < 0.5 }),
  R(/grate/, 'Grate', PIECES),
  R(/porta_?(potty|john|loo)|(^|_)toilet|(^|_)urinal/, 'Toilet', STREET),
  R(/bike_?rack/, 'Bike rack', STREET),
  R(/(^|_)swing|slide_?play|playground|seesaw|jungle_?gym|go_?round|merry/, 'Playground swing', STREET),
  R(/water_?meter|gas_?meter|power_?meter|gaugepower|elec_?box|ebox|junction_?box|(^|_)utilbox|transformer/, 'Utility box', STREET, { kind: 'clutter' }),
  // Vehicles, before containers ("truck" is no box).
  R(/box_?car(?!d)/, 'Boxcar', VEHICLES),
  R(/rail_?car|(^|_)train|locomotive|tanker_?car/, 'Rail car', VEHICLES),
  R(/semi_?trailer|psemi|(^|_)semi|jt_semi|trailer_?wheel|(^|_)trailer/, 'Semi trailer', VEHICLES),
  R(/forklift/, 'Forklift', VEHICLES),
  R(/(^|_)husk|wreck|burnt_?car|junk_?car|car_?husk/, 'Wrecked car', VEHICLES),
  R(/(^|_)boat|yacht|dinghy|(^|_)ship(_|$)/, 'Boat', VEHICLES),
  R(/(^|_)plane(_|$)|airplane|jet(_|$)|helicop/, 'Aircraft', VEHICLES),
  R(/shopping_?cart|(^|_)trolley/, 'Shopping cart', OTHER, { kind: 'clutter', when: (f) => f.size[0] >= 0.6 && f.size[2] >= 0.6 }),
  // A vehicle's shape too: a texture called car_wall or a truck's pillar alone isn't one.
  R(/(^|_)car(_|s?$|\d)|(^|_)truck|(^|_)van(_|$)|(^|_)bus(_|$)|(^|_)cart(_|$)|golf_?cart|motorcycle|(^|_)bike(_|$)|bicycle/, 'Vehicle', VEHICLES, { when: vehicleShape }),
  R(/husk_?tire|(^|_)tire|(^|_)tyre|tire_?(stack|pile)|(^|_)wheel/, 'Tire', CONTAINERS, { kind: 'clutter' }),
  // Containers and crates.
  R(/dumpster|dump(_|$)|(^|_)skip_?bin/, 'Dumpster', CONTAINERS),
  R(/card_?b(oar)?d|cardb|(^|_)cb_?box/, 'Cardboard box', CONTAINERS),
  R(/shoe_?box|boxshoe/, 'Shoe box', SMALL),
  R(/box_?bullet|ammo_?box|bulletbox|(^|_)ammo/, 'Ammo box', SMALL),
  R(/shipping_?container|container|cargo_?cont|(^|_)cntnr|reefer/, 'Shipping container', CONTAINERS, { when: (f) => f.size[0] >= 4 }),
  R(/container|canister|(^|_)jars?(_|$|[a-d]$)/, 'Container', SMALL),
  R(/barrel|(^|_)drum|oil_?drum|keg/, 'Barrel', CONTAINERS),
  R(/crate/, 'Crate', CONTAINERS),
  R(/pallet|palate|palette/, 'Pallet', CONTAINERS),
  R(/lumber|plank_?stack|wood_?pile|(^|_)2_?x_?4|(^|_)x4_|(^|_)beams?_?stack/, 'Lumber', CONTAINERS, { kind: 'clutter' }),
  R(/plywood|(^|_)board(_|$|[a-d]$)|wood_?board/, 'Plywood sheet', CONTAINERS, { kind: 'clutter' }),
  R(/cinder|breeze_?block|(^|_)cblock/, 'Cinder block', CONTAINERS, { kind: 'clutter', when: small }),
  R(/sand_?bag/, 'Sandbags', CONTAINERS),
  R(/spool|cable_?reel/, 'Cable spool', CONTAINERS),
  R(/bucket|(^|_)pail|paint_?can|gallon|(^|_)jug/, 'Bucket', SMALL),
  R(/propane|gas_?tank|gas_?cyl|gas_?bottle/, 'Gas cylinder', CONTAINERS),
  R(/(^|_)tank(_|$|s$|[a-d]$)|water_?tower|silo/, 'Tank', CONTAINERS, { kind: 'machine' }),
  R(/dolly|hand_?truck|wheel_?barrow/, 'Hand truck', CONTAINERS, { kind: 'clutter' }),
  R(/(^|_)bags?(_|$|[a-d]$)|sack/, 'Bag', CONTAINERS, { kind: 'clutter' }),
  R(/(^|_)box|box(es)?(_|$|[a-d]$)/, 'Box', CONTAINERS, { when: (f) => f.size[0] < 3 && f.size[2] < 2.5 }),
  // Machines.
  R(/vend|soda_?mach|snack_?mach/, 'Vending machine', MACHINES),
  R(/cash_?r(eg)?|register|cashdet|cashbody|(^|_)till/, 'Cash register', MACHINES, { kind: 'clutter' }),
  R(/arcade|pinball|jukebox|slot_?mach/, 'Arcade machine', MACHINES),
  R(/gas_?pump|fuel_?pump|(^|_)pump/, 'Pump', MACHINES),
  R(/generator/, 'Generator', MACHINES),
  R(/ac_?unit|acunit|ac_?ind|aircon|hvac|(^|_)ac(_|$)/, 'AC unit', MACHINES),
  R(/(^|_)vents?(_|$|[a-d]$)|exhaust_?fan|(^|_)fan(_|$)/, 'Vent', PIECES),
  R(/fridge|refrig|freezer|(^|_)cooler/, 'Fridge', MACHINES),
  R(/water_?cool/, 'Water cooler', MACHINES),
  R(/washer|dryer|wash_?mach/, 'Washing machine', MACHINES),
  R(/(^|_)stove|(^|_)oven|fryer|(^|_)grill(_|$)|microwave/, 'Stove', MACHINES),
  R(/(^|_)tv[a-d]?(_|$)|television|aritv|deptv|wall_?tv/, 'TV', MACHINES, { kind: 'clutter' }),
  R(/computer|monitor|(^|_)pc(_|$)|(^|_)mouse|keyboard|laptop|printer|copier/, 'Computer', SMALL),
  R(/crane|hoist|gantry/, 'Crane', MACHINES),
  R(/compressor|machine|wet_?vac|(^|_)motor|turbine|conveyor|press(_|$)|drill_?press|lathe|intcontrol|intcntrl|control_?panel/, 'Machine', MACHINES),
  R(/(^|_)guns?(_|$)|gun_?(holder|case|rack)|rifle|pistol|shotgun|glock|spear|sword|machete|(^|_)knife|spas|(^|_)mac(_|$)|(^|_)ak(_|\d)|hgun|(^|_)gsa_?p|tec_?9|(^|_)mp5|(^|_)smg|revolver|magnum|(^|_)colt|weapon|(^|_)uzi|(^|_)ak_?47/, 'Gun', SMALL),
  R(/(^|_)bricks?(_|$)/, 'Brick', CONTAINERS, { kind: 'clutter', on: 'name', when: small }),
  R(/drill|wrench|(^|_)tools?(_|$)|toolbox|hammer/, 'Tools', SMALL),
  // Furniture.
  R(/mattress/, 'Mattress', FURNITURE, { kind: 'clutter' }),
  R(/couch|sofa/, 'Couch', FURNITURE),
  R(/chair|stool|(^|_)seat/, 'Chair', FURNITURE),
  R(/bed_?side|night_?stand/, 'Cabinet', FURNITURE),
  R(/(^|_)table|desk/, 'Table', FURNITURE),
  R(/(^|_)beds?(_|$|[a-d]$|jail)|bunk|jail_?bed/, 'Bed', FURNITURE),
  R(/shel(f|ves)|bookcase|pegboard|(^|_)rack|(?<!t)rack[a-d]?$|display_?case|showcase/, 'Shelves', FURNITURE),
  R(/cabinet|dresser|nightstand|wardrobe|(^|_)drawer|filing/, 'Cabinet', FURNITURE),
  R(/locker/, 'Locker', FURNITURE),
  R(/(^|_)safe\d*(_|$)/, 'Safe', FURNITURE),
  R(/counter|(^|_)bar_?top|reception/, 'Counter', FURNITURE),
  R(/cubicle|partition|divider|beltway|stanchion/, 'Divider', FURNITURE),
  R(/umbrella|parasol/, 'Umbrella', FURNITURE),
  R(/mannequin|manikin/, 'Mannequin', FURNITURE),
  R(/(^|_)rug|carpet|(^|_)mat(_|$)/, 'Rug', FURNITURE, { kind: 'clutter' }),
  R(/(^|_)sink|bathtub|(^|_)tub(_|$)|shower/, 'Sink', FURNITURE),
  R(/furniture/, 'Furniture', FURNITURE),
  // Bottles, glass and small things.
  R(/(^|_)12_?pack|six_?pack|6_?pack/, 'Beer pack', SMALL),
  R(/beer|liquor|wine|whiskey|vodka|champ(agne)?|tequila/, 'Bottles', SMALL),
  R(/bottle/, 'Bottle', SMALL),
  R(/jean|pants|slack|shirt|dress|(^|_)cloth|hoodie|jacket|(^|_)coat|sweater|(^|_)hat(_|$)/, 'Clothes', SMALL),
  R(/shamp|hair_?care|haircare|lotion|cosmetic/, 'Hair products', SMALL),
  R(/ashtr/, 'Ashtray', SMALL),
  R(/light_?switch|(^|_)outlet|(^|_)socket|elec_?socket/, 'Light switch', SMALL, { role: 'piece' }),
  R(/(^|_)books?(_|$|[a-d]$)|magazine|newspaper|(^|_)papers?(_|$)|clipboard|folder/, 'Books and papers', SMALL),
  R(/(^|_)cups?(_|$|[a-d]$)|(^|_)mug|(^|_)plates?(_|$)|(^|_)dish|(^|_)bowl|(^|_)tray|(^|_)cans?(_|$|[a-d]$)|soda/, 'Dishes', SMALL),
  R(/necklace|ncklce|jewel|(^|_)ring(_|$)|(^|_)watch(_|$)/, 'Jewelry', SMALL),
  R(/popcorn|candy|snack|food|burger|pizza|(^|_)chips/, 'Food', SMALL),
  R(/(^|_)phone/, 'Phone', SMALL),
  R(/recycl/, 'Recycling bin', STREET),
  R(/test_?tube|beaker|flask|(^|_)vial/, 'Lab glass', SMALL),
  R(/fire_?ext/, 'Fire extinguisher', SMALL),
  R(/(^|_)fire?_?alarm|(^|_)alarm/, 'Fire alarm', SMALL, { role: 'piece' }),
  R(/(^|_)clock/, 'Clock', SMALL),
  R(/(^|_)tie[a-d]?$|(^|_)ties?(_|$)|shoes?|sneaker|boots?(_|$|[a-d]$)|(^|_)belt(_|$)/, 'Clothes', SMALL),
  R(/(^|_)mid_?tower|pc_?tower/, 'Computer', SMALL),
  R(/hair_?(brush|grease|gel)|comb(_|$)/, 'Hair products', SMALL),
  R(/candle/, 'Candle', SMALL),
  R(/radiator|heater/, 'Radiator', PIECES),
  R(/(^|_)lime|orange|apple|banana|fruit|veg(etable)?s?(_|$)/, 'Food', SMALL),
  R(/menu/, 'Books and papers', SMALL),
  R(/drug_?bag|nickel_?bag|(^|_)drugs?(_|$)|(^|_)coke|(^|_)weed_?bag/, 'Drugs', SMALL),
  R(/(^|_)cds?(_|$|stack|rack|case)|(^|_)dvds?/, 'CDs', SMALL),
  R(/turntable|stereo|speaker|(^|_)radio|boombox|(^|_)amp(_|$)/, 'Stereo', SMALL),
  R(/(^|_)glass(_|$|es)|(^|_)vase/, 'Glassware', SMALL),
  // Nature.
  R(/(^|_)lill?y|lilypad|water_?lily/, 'Lily pad', NATURE),
  R(/(^|_)trees?(_|$|[a-d]$)|palm(_|tree|$|[a-d]$)|(^|_)oak|(^|_)pine|(^|_)birch|(^|_)maple|(^|_)willow|tree_?trunk|treebase/, 'Tree', NATURE),
  R(/bush|shrub|hedge|(^|_)leaf_|greenleaf|ivy|fern|plant(?!er|ation|_?(power|chem))|flower|(^|_)weed|cactus|bonsai/, 'Bush', NATURE),
  R(/cliff|rock_?face|mountain|(^|_)hill/, 'Cliff', GROUND, { variant: true, when: big }),
  R(/(^|_)rocks?(_|$|[a-h]$)|rock\d|boulder|(^|_)stones?(_|$|[a-h]$)|cliff/, 'Rock', NATURE),
  R(/(^|_)logs?(_|$|[a-d]$)|stump|driftwood/, 'Log', NATURE),
  R(/(^|_)grass|walk_?grass|grass_?patch|tallgrass/, 'Grass', NATURE, { when: (f) => !big(f) }),
  R(/(^|_)grass|lawn/, 'Lawn', GROUND),
  R(/pagoda|gazebo|kiosk|pavilion|bandstand/, 'Gazebo', STREET, { when: (f) => f.size[0] >= 3 }),
  R(/statue|sculpture|monument|head_?stone|grave_?stone|(^|_)tomb|(^|_)saint$/, 'Statue', STREET),
  R(/fountain/, 'Fountain', STREET),
  // Openings.
  R(/garage_?door|roll_?up|roll_?door|shutter/, 'Shutter', OPENINGS),
  R(/door/, 'Door', OPENINGS),
  R(/(^|_)frame|winfr|win_?frm/, 'Window frame', OPENINGS),
  R(/(^|_)win(dow|lit|_|s?$|[a-d]$|\d)|window|(^|_)glass|_gl$|_gh$|_gm$|pane(_|s?$)|blinds?(_|$)|curtain/, 'Window', OPENINGS),
  // Water and sky.
  R(/(^|_)sky|(^|_)sun(_|$)|(^|_)moon(_|$)|(^|_)stars?(_|$)|(^|_)clouds?(_|$)|atmosph/, 'Sky', SKY),
  R(/water(?!_?(meter|pipe|tank|tower|cool|jug|fountain|heater|bottle|pole|twr))|shore|ocean|(^|_)waves?(_|$)|(^|_)sea(_|$)|(^|_)river|watermesh|(^|_)pool(_|$)/, 'Water', SKY),
  // Ground and roads.
  R(/(el|track|train).*(sup|sprt|supprt|foot)|supportfoot|(^|_)el_?s(u)?p(p)?(o)?rt|elsprt/, 'El track support', GROUND, { role: 'piece' }),
  R(/train_?tr(a)?ck|rail_?track|frt_?train|(^|_)rail_?road/, 'Rail track', GROUND),
  R(/(^|_)el_?track|eltrack|eltrain|(^|_)el_?(small)?_?s(u)?p(p)?(o)?rt|(^|_)elsprt|supportfoot|el_?support/, 'El track', GROUND, { role: 'piece' }),
  R(/(^|_)pier|dock_?(plank|floor|deck)|boardwalk|jetty|(^|_)wharf/, 'Pier', GROUND),
  R(/dock_?pole|piling|mooring|(^|_)bollard_?dock|ropeguide|rope_?guide|cleat/, 'Dock post', STREET),
  R(/(hwy|highway|freeway|bridge|overpass).*(sup|sprt|pillar|column|pier)|lintil|lintel|pylon/, 'Support pillar', PIECES),
  R(/hwy|freeway|highway|overpass|onramp|offramp/, 'Highway', GROUND, { generic: true }),
  R(/(^|_)bridge/, 'Bridge', GROUND, { generic: true, when: (f) => f.size[0] >= 8 && f.size[1] >= 3 }),
  R(/(^|_)bridge/, 'Bridge support', PIECES, { variant: true }),
  R(/sidewlk|side_?walk|sidewk|sdwlk|sdwalk|(^|_)walk(way)?(_|$)|pavement|paving/, 'Sidewalk', GROUND, { generic: true }),
  R(/(^|_)curb|kerb/, 'Kerb', GROUND, { generic: true }),
  R(/crosswalk|xwalk|road_?paint|parking_?line|(^|_)strp|stripe|lane_?mark/, 'Road paint', HIDDEN, { when: (f) => f.size[2] < 0.1 }),
  R(/(^|_)roads?(_|$|[a-d]$)|(^|_)street(?!light|lamp|sign)|asphalt|(^|_)rd_|(^|_)alley|intersection|parking_?lot|(^|_)lot(_|$)/, 'Road', GROUND, { generic: true }),
  R(/(^|_)ramp/, 'Ramp', GROUND, { generic: true }),
  R(/(^|_)ter(_|\d|$)|terrain|(^|_)gnd|(^|_)grnd|ground|(^|_)dirt|(^|_)mud(_|$)|(^|_)sand(?!_?bag)|gravel|_dt$|_gv$|_sa$/, 'Ground', GROUND, { generic: true, when: (f) => f.size[2] < Math.max(2, f.size[0] / 2) }),
  // Building pieces.
  R(/fire_?esc|fireesc|fire_?stair/, 'Fire escape', PIECES),
  R(/ladder/, 'Ladder', PIECES),
  R(/balcon/, 'Balcony', PIECES),
  R(/awning|canopy|canopi|suncover/, 'Awning', PIECES),
  R(/scaffold/, 'Scaffolding', PIECES),
  R(/stair|steps|(^|_)step(_|$|[a-d]$)/, 'Stairs', PIECES),
  R(/chimney/, 'Chimney', PIECES),
  R(/pillar|column|(^|_)pil(_|$)|pill(_|$|[a-d]$)|(^|_)posts?|wall_?c?_?pos(_|$)|post(s?(_|$)|[a-d]$)|support|suprt|sprt|(^|_)pole/, 'Post', PIECES, { generic: true }),
  R(/roof|shingle|(^|_)tar_/, 'Roof', PIECES, { generic: true }),
  R(/pipes?(_|$|[a-d]$)|pipe_|duct|gutter|downspout|drain_?pipe|pipeline/, 'Pipe', PIECES),
  R(/girder|i_?beam|(^|_)beams?(_|$|[a-d]$)|truss|catwalk/, 'Girder', PIECES),
  
  R(/ornament|(^|_)deco|crest|gargoyle|medallion/, 'Ornament', PIECES),
  R(/trim|ledge|cornice|molding|moulding|(^|_)sill|lintel|frieze|border/, 'Trim', PIECES, { generic: true }),
  R(/(^|_)floor|(^|_)ceiling|(^|_)tiles?(_|$)|_tile/, 'Floor', PIECES),
  R(/(^|_)hull|bldg|building|facade|walls?(_|$|[a-d]$)|wall_|brick|stucco|plaster|siding|(^|_)conc(rete)?|beton|cement|marble|(^|_)stone|_co$|_ma$|_ce$/, 'Wall', PIECES, { generic: true }),
  R(/(^|_)metal|steel|(^|_)iron|(^|_)tin(_|$)|corrug|galv|alu(_|$|min)|_me$|_tm$/, 'Metal panel', PIECES, { generic: true }),
  R(/(^|_)wood|plank|_wo$/, 'Wood panel', PIECES, { generic: true }),
]

/** Physics profiles that only say what something is made of ("Wood Object 2'x2'x2'"): no help with what it is. */
const PLAIN_PROFILE = /^(default|.*object.*|bounce|static|none)$/i

/** Invisible pictures: blockers, collision and placeholders. */
export const INVISIBLE_TEXTURE = /missing-alpha|(^|_)missing(_|$)|missing\.|norender|(^|_)proxy\d*(_|$)|invisible|(^|_)collision|nodraw|occlud/
/** Names of copies that are never drawn as they are: shadows, blockers, occluders, lower-detail and far copies. */
const SKIP_NAME = /sdw(?!lk|alk)|shdw|shadow|(^|_|hull|\d)shd|blocker|occluder|(^|_)lod|lod(\d*|_?[a-z])$|_lod|proxy|(^|_)al$|_al[a-d]?\d*$|(^|_)coll(ision)?(_|$)|(^|_)nav(mesh)?(_|$)|invisible/
/** Decals: pictures laid on a surface. */
const DECAL = /decal|(^|_)dcl|dcl(_|$)|(^|_)dec(_|$|[a-d]$)|graffiti|(^|_)graf(_|$)|(^|_)tag_|stain|puddle|skid|splat|blood|(^|_)oil_?spill|(^|_)crack|floatingdecal|(^|_)floater/

/** The copy numbers, area tags and file type off a name ("2fenceChainBseA19" -> "fencechainbsea"). */
function clean(name: string): string {
  let n = name.toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '').replace(/^(sr_)?(chunk\d+\w*?_)/, '').replace(/[\s'"&-]+/g, '_')
  n = n.replace(/(_?\d+)+$/, '').replace(/^\d+_?/, '')
  for (let i = 0; i < 2; i++) {
    const m = n.match(/^(?:[a-z]{1,3}\d+[a-z]?|[a-z]{1,3})_(.+)$/)
    if (m && m[1].length >= 4 && /[a-z]{3}/.test(m[1])) n = m[1]
  }
  return n.replace(/^\d+_?/, '').replace(/(_?\d+)+$/, '') || name.toLowerCase()
}

const texStem = (t: string) => t.toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '')

function factsOf(e: GameObjectEntry): Facts {
  const loose = e.record < 0
  const names = new Set<string>()
  if (!loose) names.add(clean(e.name))
  for (const n of e.names ?? []) if (!loose) names.add(clean(n))
  for (const r of e.raw ?? []) names.add(clean(r))
  // (Raw names as written keep the short tags clean() takes off: "DEC_floordirt" is a decal.)
  const decal = (e.raw ?? []).some((r) => /^\d*dec_/i.test(r))
  // A copy with no names of its own goes by the names of the model it copies.
  if (!names.size) for (const n of e.copyNames ?? []) names.add(clean(n))
  const profile = e.profile && !PLAIN_PROFILE.test(e.profile.trim()) ? [e.profile.toLowerCase().trim().replace(/[\s'"-]+/g, '_')] : []
  const [a, b, h] = e.size
  // Variant letters at the end ("platea", "chairpatiob") hide the word: the name without them too.
  for (const n of [...names]) { const m = n.match(/^(.*[a-z]{3})[a-h]$/); if (m && !names.has(m[1])) names.add(m[1]) }
  // So do copy numbers with variant letters ("exitsignsign02ba", "plant01b").
  for (const n of [...names]) { const m = n.match(/^(.*[a-z]{3})\d+[a-z]{1,2}$/); if (m && !names.has(m[1])) names.add(m[1]) }
  const list = [...names].filter(Boolean)
  const part = list.length > 0 && PART_NAME.test(list[0])
  return { names: list, profile, part, decal, tex: e.tex.map(texStem).filter(Boolean), size: [Math.max(a, b), Math.min(a, b), h], loose }
}

const hit = (rule: Rule, f: Facts, words: string[]) => words.some((w) => rule.re.test(w)) && (f.sizeless ? !rule.variant : !rule.when || rule.when(f))

/** Which rule named a model and the word it matched (for checking the rules). */
export function whyIdentity(e: GameObjectEntry): { rule: string; word: string } | null {
  const f = factsOf(e), r = matchRule(f)
  return r ? { rule: r.re.source, word: [...f.names, ...f.tex].find((w) => r.re.test(w)) ?? '' } : null
}

/** The first rule that fits: by name, or (for a name that says nothing, or only where it is) by texture. */
function matchRule(f: Facts): Rule | null {
  // A building's part says what it is by its part name ("medfront", "lrgmarquee") or its pictures, and is one
  // of a building's kinds of piece whatever the words say (its "B26_stones" are a wall, not a rock).
  const rules = RULES
  const words = f.part ? f.names.map((n) => n.replace(PART_NAME, '')) : f.names
  const first = (list: string[], on: 'name' | 'tex') => (list.length ? rules.find((r) => r.on !== (on === 'name' ? 'tex' : 'name') && hit(r, f, list)) ?? null : null)
  // Its own (most used) name first, then the others the same model goes by, then its physics profile; a word
  // that says more ("streetlight") beats one that only says where or what shape ("pole", "wall").
  const tries = [first(words.slice(0, 1), 'name'), first(words.slice(1), 'name'), first(f.profile, 'name')]
  const byName = tries.find((r) => r && !r.generic) ?? tries.find(Boolean) ?? null
  if (byName && !byName.generic) return byName
  // Texture sets ("B11_conc1_co") say what a surface is; the most used picture comes first.
  // (A building's part only takes the pictures' word for a window, a sign or a light, not for a material.)
  const byTex = f.part ? (f.tex.length ? PART_TEX_RULES.find((r) => r.on !== 'name' && hit(r, f, f.tex.slice(0, 2))) ?? null : null) : first(f.tex.slice(0, 2), 'tex')
  // A fence's own pictures (chain-link, hinges) anywhere in the list say more than its frame's metal.
  if (!byName && !f.part && (!byTex || byTex.generic)) { const fence = first(f.tex.slice(2).filter((t) => FENCE_TEXTURE.test(t)), 'tex'); if (fence) return fence }
  if (byName && byTex?.generic) return byName
  // A big piece of ground or wall wearing a picture of something small (a sidewalk with a news-stand texture) is still ground.
  if (byName && byTex && !f.sizeless && f.size[0] > 6 && !LARGE_CATS.has(byTex.cat)) return byName
  return byTex ?? byName
}

/** Categories whose things can be big. */
const LARGE_CATS = new Set([GROUND, PIECES, OPENINGS, HIDDEN, SKY, FENCES, VEHICLES, BUILDINGS])

/** Pictures only fences wear. */
const FENCE_TEXTURE = /chain_?link|barb_?wire|endandhinge|fence/

/** A building's part name: its building's code, then what part ("abcd1a_medfront", "bstsr1a_lrgcornrc"). */
const PART_NAME = /^(?:[a-z0-9]{1,6}_|[a-z]{1,3}\d+)?[a-z]{2,10}\d+[a-z]{1,2}_/
/** The categories a building's part can be in. */
const PART_CATS = new Set([PIECES, OPENINGS, SIGNS, LIGHTS, FENCES, HIDDEN, SKY])
const PART_RULES = RULES.filter((r) => PART_CATS.has(r.cat))
const PART_TEX_RULES = PART_RULES.filter((r) => r.cat !== PIECES)

/** Pictures from a building's own texture set ("B11_conc1_co", "D04_metal01_me"). */
const BUILDING_TEXTURE = /^[a-z]{1,2}\d{2}[a-z]?_/

/** Small pieces only named by their material. */
const MATERIAL_PIECE: Record<string, string> = { 'Post': 'Post', 'Wall': 'Concrete block', 'Metal panel': 'Metal piece', 'Wood panel': 'Wood piece', 'Roof': 'Roof piece' }

/** Base pieces ("lampPostStBseA", "mailboxBaseA"): the foot something else stands on. */
const BASE = /(^|_)bse|bse[a-d]?$|bse_|base(?!ball|ment)|(^|_)foot(ing)?(_|$|[a-d]$)/
/** Lids: the top of something else. */
const LID = /lid(_|$|[a-d]$)/

/** What a model that isn't a building is, from the table, then its shape. */
function classify(f: Facts): { role: GameRole; category: string; name: string; kind?: PropKind } {
  const texts = [...f.names, ...f.tex]
  // Nothing but invisible pictures: never seen. Mostly invisible: a blocker, unless the name says what it is (a
  // bottle whose glass is the see-through picture).
  const named = matchRule({ ...f, tex: [] })
  const allInvisible = f.tex.length > 0 && f.tex.every((t) => INVISIBLE_TEXTURE.test(t))
  const mostly = f.tex.length > 0 && INVISIBLE_TEXTURE.test(f.tex[0]) && f.tex.length < 3
  if (allInvisible || (mostly && !(named && !named.generic && small(f) && ![HIDDEN, SKY, PIECES, GROUND, FENCES].includes(named.cat)))) return { role: 'skip', category: HIDDEN, name: 'Invisible blocker' }
  if (f.names.some((n) => SKIP_NAME.test(n)) || f.tex.some((t) => /_al\d*$/.test(t) && !/^[a-z]\d\d_/.test(t))) {
    const shadow = texts.some((t) => /sdw|shd|shadow/.test(t))
    return { role: 'skip', category: HIDDEN, name: shadow ? 'Shadow copy' : texts.some((t) => INVISIBLE_TEXTURE.test(t) || /proxy|blocker|occluder|coll/.test(t)) ? 'Invisible blocker' : 'Low-detail copy' }
  }
  if (f.decal || f.names.some((n) => DECAL.test(n)) || (f.tex[0] && DECAL.test(f.tex[0]) && Math.min(...f.size) < 0.05 && !(named && !named.generic))) return { role: 'skip', category: HIDDEN, name: 'Decal' }
  const rule = matchRule(f)
  // A sheet with no thickness that isn't a sign or a picture: a decal.
  if (flat(f) && f.size[1] < 0.02 && !(rule && [SIGNS, GROUND, SMALL, FURNITURE, OPENINGS].includes(rule.cat))) return { role: 'skip', category: HIDDEN, name: 'Decal' }
  if (rule) {
    let { name, cat: category } = rule
    let role = rule.role ?? ROLE_OF[category] ?? 'prop'
    let kind = role === 'prop' ? rule.kind ?? KIND_OF[category] ?? 'clutter' : undefined
    if (role === 'skip') return { role, category, name }
    // A free-standing sheet of wood or metal at fence height, not from a building's own texture set: a fence.
    if (rule.generic && category === PIECES && !f.part && runLike(f) && f.size[1] < 0.5 && f.size[2] >= 0.8 && f.size[2] <= 3.2 && f.tex[0] && !BUILDING_TEXTURE.test(f.tex[0]) && /panel/.test(name)) {
      return { role: 'fence', category: FENCES, name: name === 'Wood panel' ? 'Wooden fence' : 'Metal fence' }
    }
    // A lone beam or pillar only named by its material.
    if (rule.generic && category === PIECES && !f.part && !small(f)) {
      if (f.size[0] > 3 && f.size[1] < 0.6 && f.size[2] < 0.6) return { role: 'piece', category: PIECES, name: 'Girder' }
      if (f.size[0] <= 1.5 && f.size[2] >= 2 * f.size[0]) return { role: 'piece', category: PIECES, name: 'Post' }
    }
    // A building's part or a small lump only named by its material: what it is made of says too little.
    if (rule.generic && category === PIECES && (f.part || small(f))) {
      return { role: 'piece', category: PIECES, name: f.part ? 'Building detail' : post(f) ? 'Post' : MATERIAL_PIECE[name] ?? 'Building detail' }
    }
    if (f.part) return { role: 'piece', category, name }
    // The foot a lamp, a sign or a fence stands on.
    if (f.names.some((n) => BASE.test(n)) && small(f) && !['Barrel', 'Crate', 'Box', 'Pallet', 'Bench'].includes(name) && category !== GROUND) {
      return { role: 'piece', category, name: / base$/.test(name) ? name : (name === 'Fence post' ? 'Fence' : name.replace(/ post$/, '')) + ' base' }
    }
    if (f.names.some((n) => LID.test(n)) && Math.max(...f.size) < 3) return { role: 'piece', category, name: name + ' lid' }
    // Props too small to matter as cover are clutter; huge "props" are part of something.
    if (role === 'prop' && kind === 'cover' && (f.size[2] < 0.6 || f.size[0] < 0.5)) kind = 'clutter'
    if (role === 'fence' && !runLike(f) && name !== 'Barbed wire' && name !== 'Gate') {
      // A fence piece that isn't a run: a post, a corner, or a whole fenced yard.
      if (post(f) || tiny(f)) { role = 'piece'; name = name === 'Railing' ? 'Railing post' : post(f) && name !== 'Barbed wire' ? 'Fence post' : name }
    }
    if (role === 'fence' && tiny(f)) role = 'piece'
    if (category === NATURE && name === 'Bush' && f.size[2] > 5) name = 'Tree'
    return { role, category, name, ...(kind ? { kind } : {}) }
  }
  // Nothing in the words: the shape decides.
  const [l, , h] = f.size
  if (f.part) return { role: 'piece', category: PIECES, name: 'Building detail' }
  if (l > 30 && h < l / 6) return { role: 'ground', category: GROUND, name: 'Ground' }
  if (flat(f)) return { role: 'skip', category: HIDDEN, name: 'Decal' }
  // Pictures from a building's own texture set ("B11_conc1_co", "D04_metal01_me") belong to a building.
  if (f.tex[0] && BUILDING_TEXTURE.test(f.tex[0])) return { role: 'piece', category: PIECES, name: 'Building detail' }
  if (l > 8 || h > 6) return { role: 'piece', category: PIECES, name: 'Structure' }
  return { role: 'prop', category: OTHER, name: readable(f) || 'Object', kind: 'clutter' }
}

/** Words from a name when it reads like words: "lumberstack_a" -> "Lumberstack"; codes ("bstvk_a_medsa") give ''. */
function readable(f: Facts): string {
  for (const raw of [...f.names, ...f.tex]) {
    const words = raw.replace(/_[a-z]{2}$/, '').replace(/[_\-.]+/g, ' ').replace(/\d+/g, ' ').split(' ').filter((w) => w.length > 2)
    const real = words.filter((w) => /[aeiou]/.test(w) && !/^[^aeiou]{3,}/.test(w) && !/[^aeiou]{4,}/.test(w))
    if (!real.length) continue
    const s = real.join(' ').replace(/([a-z]{4,})[a-d]$/, '$1')
    return s[0].toUpperCase() + s.slice(1)
  }
  return ''
}

// ---------------- buildings ----------------

/** District codes in building codes and record names, and the Stilwater district each means. */
const DISTRICT_CODES: [RegExp, string][] = [
  [/^(dt|dwnt|olddt|olddwnt|moddwnt|gov)$/, 'Downtown'], [/^(her|lhr|hr)$/, 'High end'], [/^(mu|mus)$/, 'Museum'], [/^(ct|lct)$/, 'Chinatown'],
  [/^(rl|rld)$/, 'Red Light'], [/^(sr)$/, "Saint's Row"], [/^(pr|prj)$/, 'Projects'], [/^(ba)$/, 'Barrio'], [/^(wr)$/, 'Suburbs'],
  [/^(fa|fac|stl)$/, 'Factories'], [/^(do|dk|nyd)$/, 'Docks'], [/^(tky)$/, 'Truck yard'], [/^(ap|apt)$/, 'Airport'], [/^(ml)$/, 'Mall'],
]
/** The settings each district suits. */
const DISTRICT_SETTINGS: Record<string, WizardSetting[]> = {
  Downtown: ['downtown'], 'High end': ['downtown'], Museum: ['downtown'], Chinatown: ['downtown'], Mall: ['downtown'],
  'Red Light': ['downtown', 'rundown'], "Saint's Row": ['rundown'], Projects: ['rundown'], Barrio: ['rundown'], Suburbs: ['suburbs'],
  Factories: ['industrial'], Docks: ['docks', 'industrial'], 'Truck yard': ['industrial'], Airport: [],
}

export const districtOfCode = (code: string) => DISTRICT_CODES.find(([re]) => re.test(code))?.[1] ?? null

/** Record-name prefixes ("DT_", "12RLD_") that say which district a record was placed in ("SR" and "AP" are on everything). */
const PREFIX_CODE = /^\d*(dt|mu|her|ct|rld?|prj|ba|wr|fac?|stl|dk|tky)_/i

/**
 * The districts a map chunk belongs to, from its record names: their district prefixes and the district codes in
 * its buildings' part names. Districts with at least a quarter of the votes (and a few of them), most first.
 */
export function chunkDistricts(recordNames: string[]): string[] {
  const votes = new Map<string, number>()
  for (const name of recordNames) {
    const n = name.toLowerCase()
    const p = n.match(PREFIX_CODE)?.[1]
    const code = p ? null : n.match(/^\d*(?:[a-z0-9]{1,6}_|[a-z]{1,3}\d+)?([a-z]{2,10}\d+[a-z])_[a-z]/)?.[1]
    const d = p ? districtOfCode(p) : code ? parseBuildingCode(code).district : null
    if (d) votes.set(d, (votes.get(d) ?? 0) + 1)
  }
  const total = [...votes.values()].reduce((a, b) => a + b, 0)
  return [...votes.entries()].filter(([, v]) => v >= 8 && v >= total / 4).sort((a, b) => b[1] - a[1]).map(([d]) => d)
}

/** Building types by the letters a building's code starts with, and the settings each suits. */
const BUILDING_TYPES: [RegExp, string, WizardSetting[]][] = [
  [/^(old|mod)?dwnt|^olddt|^hiri|^hr(?!sr|rl)/, 'tower', ['downtown']],
  [/^gov/, 'civic building', ['downtown']], [/^pol/, 'police station', ['downtown', 'military']], [/^hos/, 'hospital', ['downtown']],
  [/^church/, 'church', ['downtown', 'suburbs']], [/^mus/, 'museum', ['downtown']], [/^(imax|th)/, 'cinema', ['downtown']], [/^arn/, 'arena', ['downtown']],
  [/^mall/, 'mall', ['downtown']], [/^htl|^ht/, 'hotel', ['downtown']], [/^(cd|apt|psapt|smapt|vkapt)/, 'apartment block', ['downtown', 'suburbs']],
  [/^(fno)?r?hs|^man/, 'house', ['suburbs']], [/^(fno)?r?rh/, 'row houses', ['suburbs', 'rundown']], [/^hr/, 'high-rise', ['downtown']],
  [/^(ret|rtl|dpret|liq|pwn|gun|gs|fstfd|bar|brth|car)/, 'shop', ['downtown']], [/^gas/, 'gas station', ['downtown', 'suburbs']],
  [/^(fno)?bst/, 'shop row', ['downtown']], [/^(fno)?bs/, 'shop block', ['downtown']],
  [/^(wh|wrf|strg|whd|wht|dct)/, 'warehouse', ['industrial', 'docks']], [/^(smfa|fa|fac|stl)/, 'factory', ['industrial']],
  [/^(hngr)/, 'hangar', ['industrial', 'military']], [/^(rdr)/, 'control tower', ['industrial', 'military']], [/^(mainap|scap|fpap|msc)/, 'terminal', ['industrial']],
  [/^cship/, 'cargo ship', ['docks']], [/^(tky|tyre)/, 'yard building', ['industrial']], [/^(mc|il)/, 'garage', ['industrial', 'rundown']],
  [/^prk/, 'parking garage', ['downtown']], [/^(sc|uc)/, 'school', ['suburbs']],
  [/garage/, 'garage', ['industrial', 'suburbs']], [/shed|shack|(^|[^c])hut|cabin/, 'shed', ['industrial', 'rundown']], [/house/, 'house', ['suburbs']],
]

/** Building types without floors to count: halls, sheds and landmarks. */
const UNFLOORED = new Set(['shed', 'warehouse', 'factory', 'hangar', 'church', 'museum', 'arena', 'cinema', 'mall', 'terminal', 'cargo ship', 'yard building', 'garage', 'gas station', 'control tower', 'parking garage'])

/** Main wall materials, by words in the building's pictures: a word anywhere in them first, then the surface code of the most used. */
const MATERIAL_WORDS: [RegExp, string][] = [
  [/brick|brck|bricl/, 'brick'], [/marble/, 'marble'], [/stucco|plaster/, 'stucco'], [/(^|_)stone|sandstone/, 'stone'],
  [/siding|clapboard|shingle|wood_?wall|planks?(_|$)/, 'wooden'], [/corrug|galv|sheet_?metal|rust/, 'metal'],
]
const MATERIAL_CODES: [RegExp, string][] = [
  [/_ma$/, 'marble'], [/_dw$/, 'stucco'], [/_ce$/, 'stone'], [/_wo$/, 'wooden'], [/_me$|_tm$/, 'metal'], [/conc|beton|cement|_co$/, 'concrete'],
]
const GLASS = /(^|_)(glas|glass|win|window)|_gl$|_gh$|_gm$/
/** Picture names that are no help with the walls (windows, trims, signs, doors, details). */
const NOT_WALL = /win|glas|_gl$|_gh$|trim|border|sign|door|frame|light|lamp|neon|canop|awn|pipe|vent|drain|orn|deco|ledge|rail|roof|stair|ladder|fire|sill|grate|bars|metalgen|metal(?!l)|catwalk|graf/

function materialOf(tex: string[]): string {
  const t = tex.map(texStem)
  const walls = t.filter((x) => !NOT_WALL.test(x) && !INVISIBLE_TEXTURE.test(x))
  for (const [re, m] of MATERIAL_WORDS) if (walls.some((x) => re.test(x))) return m
  for (const x of walls.length ? walls : t) for (const [re, m] of MATERIAL_CODES) if (re.test(x)) return m
  if (t.filter((x) => GLASS.test(x)).length >= Math.max(2, t.length / 2)) return 'glass'
  return 'concrete'
}

/** Storeys from the height: about 3.7 m each, with a parapet and roof (about 2.5 m) on top. */
export const storeysOf = (h: number) => Math.max(1, Math.round((h - 2.5) / 3.7))

/** The type letters and district of a building code ("retba8a" -> ["ret", "Barrio"]). */
export function parseBuildingCode(code: string): { type: string; district: string | null } {
  const m = code.toLowerCase().match(/^(?:[a-z]?\d*[a-z]?_)?([a-z]+?)(\d+)[a-z]?$/)
  const letters = m ? m[1] : code.toLowerCase().replace(/[^a-z]/g, '')
  // The district is the longest known code at the end of the letters, with something left in front of it.
  for (let n = Math.min(4, letters.length - 2); n >= 2; n--) {
    const d = districtOfCode(letters.slice(-n))
    if (d) return { type: letters.slice(0, -n), district: d }
  }
  return { type: letters, district: null }
}

function buildingIdentity(e: GameObjectEntry, tagsSettings: WizardSetting[]): GameIdentity {
  const [a, b, h] = e.size
  const footprint: [number, number] = [Math.max(a, b), Math.min(a, b)]
  const code = e.name.replace(/_hull$/, '')
  const { type: letters, district } = parseBuildingCode(code)
  // The type is the letters before the district ("ret" + "ba"), or the whole code's ("olddwnt").
  const found = BUILDING_TYPES.find(([re]) => re.test(letters)) ?? BUILDING_TYPES.find(([re]) => re.test(code.replace(/[^a-z]/g, '')))
  const texts = [e.name, ...e.tex].map(texStem)
  let type = found?.[1] ?? ''
  if (!type) type = h > 45 ? 'tower' : footprint[0] > 40 && h < 16 ? 'warehouse' : h < 9 ? 'shop' : 'building'
  // Low "tower" codes are the tower's podium or annex.
  if (type === 'tower' && h < 30) type = 'office block'
  const material = materialOf(e.tex)
  const storeys = storeysOf(h)
  const districts = [...new Set([...(e.districts ?? []), ...(district ? [district] : [])])]
  const settings = new Set<WizardSetting>(found?.[2] ?? (type === 'warehouse' ? ['industrial', 'docks'] : ['downtown']))
  // A district's own buildings suit its settings; the code's own district outweighs the chunks around it.
  for (const d of district ? [district] : districts.slice(0, 2)) for (const s of DISTRICT_SETTINGS[d] ?? []) settings.add(s)
  for (const s of tagsSettings) if (s === 'rundown' || s === 'construction') settings.add(s)
  if (texts.some((t) => /graffiti|(^|_)graf|boarded|board(s|ed)?_|plywood|rust|crack|broken|dirty|burn/.test(t))) settings.add('rundown')
  if (texts.some((t) => /scaffold|construct|rebar|(^|_)cnstr/.test(t))) settings.add('construction')
  // Halls, sheds and landmarks are named by their size; buildings with floors by their storeys.
  const floored = !UNFLOORED.has(type)
  const sizeWord = footprint[0] * footprint[1] > 2500 ? 'Large ' : footprint[0] * footprint[1] < 200 ? 'Small ' : ''
  const words = `${material} ${type}`
  const name = floored ? `${storeys === 1 ? 'Single-storey' : `${storeys}-storey`} ${words}` : sizeWord + words.replace(/^\w/, (c) => (sizeWord ? c : c.toUpperCase()))
  return {
    role: 'building', category: BUILDINGS, name, settings: [...settings],
    building: {
      footprint, height: h, storeys, ...(e.front ? { front: e.front } : {}), ...(e.long ? { long: e.long } : {}),
      type, material, ...(districts.length ? { districts } : {}),
    },
  }
}

// ---------------- settings ----------------

/** Words that point at a setting. */
const SETTING_WORDS: [RegExp, WizardSetting[]][] = [
  [/broken|burnt|burned|rust|dirty|trash(?!_?can)|junk|graffiti|(^|_)graf|boarded|wreck|damag|abandon|ruin|debris|rubble|scrap|husk|torn|smash|grime|mattress|tire_?trsh|barb/, ['rundown']],
  [/crate|pallet|palate|barrel|drum|container|forklift|warehouse|machine|generator|(^|_)tank|valve|conveyor|boxcar|rail_?car|trailer|semi|lumber|reefer|spool|chain_?link|fencechain|cnstr|galv|indust|_fm$/, ['industrial']],
  [/(^|_)dock|pier|wharf|boat|anchor|rope|buoy|container|reefer|mooring|cleat|ship/, ['docks']],
  [/cone|barricade|scaffold|girder|cement|construction|cnstr|(^|_)site|jersey|rebar|sawhorse|porta|cinder|plywood|lumber|(^|_)2_?x_?4|(^|_)x4_|wheelbarrow/, ['construction']],
  [/hydrant|mailbox|newspaper|news_?box|parking|meter|lamp_?post|streetlight|traffic|bench|bus_?stop|kerb|curb|sidewalk|trash_?can|payphone|shop|store|register|cooler|vend|mannequin|neon|sign|billboard|awning/, ['downtown']],
  [/picket|mailbox|lawn|hedge|bush|shrub|(^|_)tree|swing|playground|picnic|planter|bbq|grill|garden|flower|fence_?wd|wood_?fence/, ['suburbs']],
  [/police|jail|army|military|sandbag|bunker|(^|_)guard_?tower|ammo|razor/, ['military']],
]

// ---------------- the answer ----------------

const memo = new WeakMap<GameObjectEntry, GameIdentity>()

/**
 * Whether a model is a building: 'whole' (a building to place), 'far' (a building's low-detail copy), 'detail'
 * (a group of a building's parts too small to stand alone), or null (not a building at all).
 */
export function buildingKind(e: GameObjectEntry): 'whole' | 'far' | 'detail' | null {
  const group = e.cat === BUILDINGS || (e.parts?.length ?? 0) >= 3
  // A building's shell placed on its own ("abcd1a_hull") is a whole building too.
  const shell = !e.parts && /^[a-z]{2,10}\d+[a-z]_hull$/.test(e.name) && Math.min(e.size[0], e.size[1]) >= 5 && e.size[2] >= 4
  // A record that names a small building and is the size of one (a lock-up garage, a shed).
  const named = !e.parts && e.record >= 0 && /garage(?!_?(door|rail))|(^|_)shed|shack|(^|_)hut(_|$)|cabin|kiosk|bldg|building|warehouse|hangar/.test(e.name)
    && Math.min(e.size[0], e.size[1]) >= 4 && e.size[2] >= 2.5 && Math.max(e.size[0], e.size[1]) <= 150
  const whole = Math.max(e.size[0], e.size[1]) >= 5 && Math.min(e.size[0], e.size[1]) >= 2.5 && e.size[2] >= 2.5
  if (group && !whole) return 'detail'
  if (!group && !shell && !named) return null
  // A building put together from its far, low-detail copy is not one to place.
  if (e.tex.length && e.tex.every((t) => /_al\d*\.\w+$/i.test(t) || INVISIBLE_TEXTURE.test(texStem(t)))) return 'far'
  return 'whole'
}

/** The model's identity. */
export function identify(e: GameObjectEntry): GameIdentity {
  const hitMemo = memo.get(e)
  if (hitMemo) return hitMemo
  const f = factsOf(e)
  const words = [...f.names, ...f.tex]
  const fromWords = new Set<WizardSetting>()
  for (const [re, s] of SETTING_WORDS) if (words.some((w) => re.test(w))) s.forEach((x) => fromWords.add(x))
  let id: GameIdentity
  const kind = buildingKind(e)
  if (kind === 'detail') id = { role: 'piece', category: PIECES, name: 'Building detail', settings: [] }
  else if (kind === 'far') id = { role: 'skip', category: HIDDEN, name: 'Low-detail copy', settings: [] }
  else if (kind === 'whole') {
    id = buildingIdentity(e, [...fromWords])
  } else {
    const c = classify(f)
    const settings = new Set(c.role === 'skip' ? [] : fromWords)
    // Something found in one or two districts only suits theirs.
    const d = e.districts ?? []
    if (c.role !== 'skip' && d.length > 0 && d.length <= 2) for (const x of d) for (const s of DISTRICT_SETTINGS[x] ?? []) settings.add(s)
    id = { ...c, settings: [...settings] }
  }
  // What it is placed with (indexer.ts works it out from where the game puts things).
  if (e.partOf && id.role === 'prop') { id.role = 'piece'; delete id.kind }
  if (e.assembly?.length) id.assembly = e.assembly
  if (e.partOf) id.partOf = e.partOf
  if (e.copyOf) id.copyOf = e.copyOf
  if (e.near?.length) id.near = e.near.map((n) => n.id)
  if (e.kitOf) { id.kitOf = e.kitOf; if (e.belongsTo?.length) id.belongsTo = e.belongsTo }
  if (e.kit?.length) id.kit = e.kit
  if (e.layout?.length) id.layout = e.layout
  memo.set(e, id)
  return id
}

/** The category alone (the indexer files each model under it). */
export const categoryOfEntry = (e: GameObjectEntry) => identify(e).category

/** Names that only say what a thing is made of or where it is ("Wall", "Road"). */
export const GENERIC_NAMES: ReadonlySet<string> = new Set(RULES.filter((r) => r.generic).map((r) => r.name))

/** The rule names the table gives, with the category each always has (for checks). */
export const RULE_CATEGORIES: ReadonlyMap<string, string> = new Map(RULES.map((r) => [r.name, r.cat]))

/** A plain name for a city piece from its record name and main texture ("" when the rules don't know it). */
export function pieceName(record: string, texture = ''): string {
  const f: Facts = { names: record ? [clean(record)] : [], profile: [], part: false, tex: texture ? [texStem(texture)] : [], size: [1, 1, 1], loose: !record, sizeless: true }
  if (texture && INVISIBLE_TEXTURE.test(texStem(texture))) return 'Invisible blocker'
  return matchRule(f)?.name ?? readable({ ...f, names: record ? [record.toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '')] : [] })
}
