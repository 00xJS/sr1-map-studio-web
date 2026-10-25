// Each model's placement rule (cityModules.ts PlacementRule): where it goes (the ground, a wall, a roof, hanging,
// only its own building), which way it faces, what it is never placed without, what floor it needs in front,
// whether players need stairs or a ladder to reach it, what may change when it is placed, and how much cover it
// gives. Worked out from how the game itself stands each model in the city (GameObjectEntry.sits: on a floor,
// flush on a wall, on a roof, hanging), from identify() (role, name, assemblies, building kits) and from its shape.
// The player's own corrections ("Check game pieces") go on top (withPlacementLabels in labels.ts).
import type { GameObjectEntry } from './indexer'
import { identify, type GameIdentity } from './identity'
import { SIDES, type Sits } from './sits'
import type { PlacementRule, Side } from './cityModules'

/** The library by id, for the answers that need another model (a part's whole, its variants). */
export type Library = ReadonlyMap<string, GameObjectEntry>

const OPPOSITE: Record<Side, Side> = { '+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z' }

/** A part is never placed without the other when at least this share of its placements have it at its spot. */
const NEEDS_SHARE = 0.75

/** Names of things that go on walls, hang from above or sit on roofs, for a model the game's placements don't tell about. */
const WALL_NAMES = /^(Poster|Picture|Clock|Light switch|Fire alarm|Wall lamp|Neon sign|Marquee|Elevator panel|Awning|Fire escape|Balcony|Security grille|Window|Window frame|Shutter|Radiator|Pipe|Vent|Ladder)$/
const HANG_NAMES = /^(Ceiling light|Power lines|Chain|Banner)$/
/** Names that only ever go on walls, whatever is under them. */
const WALL_ONLY = /^(Wall lamp|Light switch|Fire alarm|Poster)$/
const ROOF_NAMES = /^(Chimney|Water tower support)$/
/** Small things that sit on shelves, never on the wall behind them. */
const SHELF_NAMES = /^(Bottles?|Books and papers|Dishes|Food|Glassware|Drugs|CDs|Jewelry|Hair products|Container|Beer pack|Candle|Ashtray|Lab glass|Shoe box)$/
const DOOR_NAMES = /^(Door|Shutter)$/
const WINDOW_NAMES = /^(Window|Window frame|Security grille)$/
/** Clear floor these need in front of them (metres) unless the game's placements say otherwise. */
const CLEAR: Record<string, number> = {
  Door: 1.2, Shutter: 2, Gate: 1.5, Counter: 1, Stairs: 1.5, 'Fire escape': 1, Ladder: 0.8, 'Vending machine': 1, 'Arcade machine': 1, Pump: 1.5,
  Payphone: 0.8, Toilet: 0.8, Locker: 0.8, Fridge: 0.8, 'Elevator panel': 1, 'Bus stop': 1.5, 'Cash register': 0.8, Sink: 0.8, Stove: 0.8,
  'Washing machine': 0.8, 'Water cooler': 0.6, Mailbox: 0.6, 'Newspaper box': 0.6, 'Parking meter': 0.5,
}
/** Things players see and shoot through whatever their outline: wire, bars, glass, open frames. */
const SEE_THROUGH = /Chain-link|Iron fence|Railing|Barbed|Security grille|Grate|Scaffolding|Window|Gate|Guardrail|Girder|Fire escape|Ladder|Bike rack|Tree guard|Power lines/
/** Things whose look has writing or a hand to it: never mirrored. */
const NO_MIRROR = /Sign|Poster|Billboard|Marquee|Neon|Banner|Picture|Clock|Vehicle|Wrecked car|Boxcar|Rail car|Semi trailer|Forklift|Boat|Aircraft|Arcade|Vending|Pump|Payphone|Computer|TV|Books|Newspaper|Mailbox|Cash register|Door|Shutter|Stairs/

const r1 = (v: number) => Math.round(v * 10) / 10

/** The side most of its placements have a wall behind, when that is most of them (`of`: out of how many). */
function backSide(s: Sits, of: number): Side | null {
  let best = -1
  for (let i = 0; i < 4; i++) if (best < 0 || s.back[i] > s.back[best]) best = i
  return best >= 0 && s.back[best] >= Math.max(1, of * 0.5) ? SIDES[best] : null
}

/** Where it goes, from how the game placed it; null when its placements don't tell. */
function attachFrom(s: Sits | undefined, id: GameIdentity, e: GameObjectEntry): PlacementRule['attach'] | null {
  if (!s || s.n < 1) return null
  const n = s.n, g = s.ground / n, w = s.wall / n, r = s.roof / n, h = s.hang / n
  // A big structure (a highway deck, a bridge, a long wall) stands on the ground or its supports.
  const big = Math.max(e.size[0], e.size[1]) > 8
  // A column stands on its foot, whatever wall it is built against.
  if (column(e) && e.size[1] > 0.08 && r < 0.5) return 'ground'
  // Bottles, books and the like stand on shelves in front of walls, and fences stand on what they top: a wall
  // behind them says nothing. (Guns and tools do hang on racks and pegboards.)
  const offWall = SHELF_NAMES.test(id.name) || id.role === 'fence'
  // Flush on a wall, back to the same side nearly every time (a ledge or a cornice over it doesn't matter).
  const backed = Math.max(...s.back) >= n * 0.6
  if (w >= 0.5 && backed && !offWall) return 'wall'
  // A thin plate against a wall (a socket, a baseboard) is on the wall even where the floor is right under it.
  if (backed && e.size[1] <= 0.08 && e.size[2] > e.size[1] * 2 && !big && !offWall) return 'wall'
  // Nothing under it and a ceiling right over it most times: fixed to the ceiling (a light), even next to a wall.
  if (s.ceiling >= n * 0.5 && g < 0.5 && !big && !column(e) && !stands(id)) return 'hang'
  if (!offWall && (w >= 0.5 || (w >= 0.34 && w > g && w >= h))) return 'wall'
  if (!big && (r >= 0.5 || (r >= 0.34 && r >= g && r >= h))) return 'roof'
  if (h >= 0.5 || (h > g && h >= w)) {
    // Nothing under it and no wall: hanging from a ceiling or a bracket, strung between poles (wires), or high up
    // on something that holds it from the side; a low one with nothing over it is part of something on the ground.
    // (A highway deck, a girder or a beam rests on supports at its ends, not under its middle; a column stands
    // on the floor whatever touches its top; rocks, plants, wrecks, cover and furniture stand.)
    const wire = isWire(e, id)
    if ((big || column(e) || stands(id)) && !wire) return 'ground'
    if (s.ceiling >= Math.max(1, s.hang * 0.25) || wire || HANG_NAMES.test(id.name) || (s.lift > 2 && e.size[2] < 3)) return 'hang'
  }
  return 'ground'
}

/** Wires, cables, chains and ropes: strung or hanging, whatever their size. */
const WIRE_WORDS = /(?<!barb_?|razor_?|brb_?)wire(?!frame|_?fe?nc)|cable(?!_?(reel|spool))|(^|_)rope|(^|_)chains?(_|\d|$)|powerline/
const isWire = (e: GameObjectEntry, id: GameIdentity) => (HANG_NAMES.test(id.name) && id.name !== 'Ceiling light') || [e.name, ...(e.raw ?? [])].some((n) => WIRE_WORDS.test(n.toLowerCase()))
/** A column: tall and narrow, standing on its foot (not a pipe or duct, which run along walls). */
const column = (e: GameObjectEntry) => e.size[2] >= 3 && e.size[2] >= 2.5 * e.size[0] && !/pipe|duct|vent|drain/i.test(e.name)
/** Kinds of prop that stand on something, never hang. */
const STANDS = new Set(['nature', 'vehicle', 'cover', 'furniture'])
/** Stands on something, never hangs: those kinds of prop, fences and walls, and the feet things stand on. */
const stands = (id: GameIdentity) => STANDS.has(id.kind ?? '') || id.role === 'fence' || / base$/.test(id.name)

/** Where it goes from its name and shape alone (no placements to go by). */
function attachByName(id: GameIdentity, e: GameObjectEntry): PlacementRule['attach'] {
  if (WALL_NAMES.test(id.name)) return 'wall'
  if (HANG_NAMES.test(id.name)) return 'hang'
  if (ROOF_NAMES.test(id.name)) return 'roof'
  // A thin flat sign or plaque stands against something.
  if ((id.kind === 'sign' || id.name === 'Sign') && e.size[1] < 0.15 && e.size[2] > 0.3 && e.size[2] < 4) return 'wall'
  return 'ground'
}

/** Models of the same look and size made as variants of one another ("barrela", "barrelb"), per library. */
const variantMemo = new WeakMap<Library, Map<string, number>>()
const stem = (e: GameObjectEntry) => e.name.toLowerCase().replace(/[\d_]+$/, '').replace(/([a-z]{3,})[a-h]$/, '$1')
function hasVariants(e: GameObjectEntry, lib?: Library): boolean {
  if (!lib) return /[a-z]{3,}[a-h]\d*$/i.test(e.name)
  let counts = variantMemo.get(lib)
  if (!counts) {
    counts = new Map()
    for (const x of lib.values()) { const k = stem(x) + '|' + identify(x).name; counts.set(k, (counts.get(k) ?? 0) + 1) }
    variantMemo.set(lib, counts)
  }
  return (counts.get(stem(e) + '|' + identify(e).name) ?? 0) > 1
}

/** The models it is never placed without: its own parts nearly always with it, and the whole it is part of. */
function needsOf(e: GameObjectEntry, id: GameIdentity, lib?: Library): string[] {
  const out: string[] = []
  const skip = (x: string) => { const m = lib?.get(x); return !!m && (identify(m).role === 'skip' || !!m.copyOf) }
  for (const p of id.assembly ?? []) if (p.share >= NEEDS_SHARE && !skip(p.id)) out.push(p.id)
  if (id.partOf && !skip(id.partOf)) {
    const whole = lib?.get(id.partOf)
    const mine = whole ? (identify(whole).assembly ?? []).filter((p) => p.id === e.id).reduce((a, p) => a + p.share * whole.seen, 0) / Math.max(1, e.seen) : 1
    if (mine >= NEEDS_SHARE) out.push(id.partOf)
  }
  return [...new Set(out)].filter((x) => x !== e.id)
}

/**
 * Made for one kind of building and kept to it: its pieces, signs and lights. (Props found only on one kind of
 * building, a barrel on its roof, can stand anywhere.)
 */
const isKit = (e: GameObjectEntry, id: GameIdentity) => !!id.kitOf && (id.kind === 'sign' || id.kind === 'light' || (id.role !== 'prop' && KIT_CATS.has(id.category)) || !!codeOf(e))
/** The categories of a building's own pieces (furniture, clutter and plants found in one building are not its kit). */
const KIT_CATS = new Set(['Buildings', 'Building pieces', 'Doors and windows', 'Fences and barriers', 'Signs and billboards', 'Lights and signals', 'Ground and roads'])

/** A building's part name: its building's code, then which part ("RL8BSRL5A_MedNa01" -> "bsrl5a"; not an area's "VK30b_"). */
const PART_CODE = /^(?:\d*[a-z]{0,3}\d*_)?(?:[a-z]{1,3}\d+)?([a-z]{3,10}\d+[a-z]{1,2})_[a-z]/
const buildingIndex = new WeakMap<Library, Map<string, string[]>>()
/** The building code in a model's names ("fstfd1a" for "FSTFD1A_Bench2B_04"), if one carries it. */
const codeOf = (e: GameObjectEntry) => [e.name, ...(e.raw ?? [])].map((n) => n.toLowerCase().match(PART_CODE)?.[1]).find(Boolean) ?? null

/** A building's piece the game names after it ("bsrl2dn_smlfront") that the library didn't tie to one (no kitOf). */
const namedPiece = (e: GameObjectEntry, id: GameIdentity) => !id.kitOf && (id.role === 'piece' || id.kind === 'sign' || id.kind === 'light') && KIT_CATS.has(id.category) && !!codeOf(e)

/** The library's buildings of the code a named piece carries (none when the library has none of them). */
function namedFor(e: GameObjectEntry, id: GameIdentity, lib?: Library): string[] {
  if (!lib || !namedPiece(e, id)) return []
  let index = buildingIndex.get(lib)
  if (!index) {
    index = new Map()
    for (const b of lib.values()) {
      if (identify(b).role !== 'building') continue
      const code = b.name.toLowerCase().replace(/_hull\d*$/, '').replace(/^[a-z]{0,3}\d*_/, '')
      ;(index.get(code) ?? index.set(code, []).get(code)!).push(b.id)
    }
    buildingIndex.set(lib, index)
  }
  for (const n of [e.name, ...(e.raw ?? [])]) {
    const code = n.toLowerCase().match(PART_CODE)?.[1]
    if (!code) continue
    // The building's own code, one its code ends with ("abstsr1a" for "bstsr1a" and back), or without a last
    // variant letter ("bsrl2d" for "bsrl2dn").
    const found = index.get(code) ?? [...index].find(([k]) => k.length >= 5 && (k.endsWith(code) || code.endsWith(k) || k === code.slice(0, -1)))?.[1]
    if (found?.length) return found.slice(0, 8)
  }
  return []
}

/** Where a model goes, before what its whole says. */
function ownAttach(e: GameObjectEntry, id: GameIdentity): PlacementRule['attach'] {
  if (isKit(e, id) || namedPiece(e, id)) return 'building'
  if (id.role === 'ground' || id.role === 'building') return 'ground'
  const placed = attachFrom(e.sits, id, e)
  // Wires and chains hang, whatever holds them up; so do ceiling lights and things named for hanging.
  if (isWire(e, id) && id.name !== 'Utility pole') return 'hang'
  if ((HANG_NAMES.test(id.name) || [e.name, ...(e.raw ?? [])].some((n) => /hang(ing|er)?(_|[a-d]?$)/i.test(n))) && placed !== 'wall') return 'hang'
  // A building's door (a person's height or more) or window, thin, goes in a wall's opening, whatever it stands on.
  if (opening(e, id) && placed !== 'roof') return 'wall'
  if (WALL_ONLY.test(id.name) && (placed === 'ground' || !placed)) return 'wall'
  return placed ?? attachByName(id, e)
}

/** A building's door (a person's height or more) or window: thin, and made for a wall's opening. */
const opening = (e: GameObjectEntry, id: GameIdentity) => e.size[1] < 0.6 && ((DOOR_NAMES.test(id.name) && e.size[2] >= 1.8) || (WINDOW_NAMES.test(id.name) && e.size[2] >= 0.3))

/**
 * Where a model goes: a part never placed without its whole goes where the whole goes (a lamp's base, a door's
 * handle), except a door or window, which goes in its wall whatever its frame stands on.
 */
function attachOf(e: GameObjectEntry, id: GameIdentity, needs: string[], lib?: Library, depth = 0): PlacementRule['attach'] {
  const own = ownAttach(e, id)
  const whole = id.partOf && needs.includes(id.partOf) ? lib?.get(id.partOf) : undefined
  if (!whole || own === 'building' || (own === 'wall' && opening(e, id)) || depth > 3) return own
  const wid = identify(whole)
  return attachOf(whole, wid, needsOf(whole, wid, lib), lib, depth + 1)
}

/** A model's placement rule (see PlacementRule). `lib` (the library by id) lets parts and variants be checked against the others. */
export function placementRule(e: GameObjectEntry, lib?: Library): PlacementRule {
  const id = identify(e)
  const s = e.sits
  const height = e.size[2]
  // A whole building stands on its plot; never mirrored (its signs and doors), may be turned and moved.
  if (id.role === 'building') {
    return { attach: 'ground', ...(id.building?.front ? { facing: id.building.front } : {}), mayVary: ['turn', 'nudge'], coverHeight: r1(height) }
  }
  const needs = needsOf(e, id, lib)
  const kit = isKit(e, id)
  const attach = attachOf(e, id, needs, lib)
  const rule: PlacementRule = { attach, mayVary: [] }
  // Which way it faces: away from the wall most of its placements have behind it (for something standing on a
  // floor, only when it is seen against one often enough to tell).
  const walled = attach === 'wall' ? (s?.wall ?? 0) : s?.n ?? 0
  const against = !!s && s.n >= 3 && s.back.reduce((a, b) => a + b, 0) >= s.n * 0.6
  const back = s && (attach === 'wall' || attach === 'building' || against) ? backSide(s, Math.max(1, walled)) : null
  if (back) rule.facing = OPPOSITE[back]
  if (needs.length) rule.needs = needs
  if (kit && id.belongsTo?.length) rule.onlyOn = [...id.belongsTo]
  else if (attach === 'building') { const named = namedFor(e, id, lib); if (named.length) rule.onlyOn = named }
  // Floor in front: doors, counters, stairs, machines players use. The game's own clear floor in front, when known.
  const clear = CLEAR[id.name]
  if (clear !== undefined) {
    const seen = rule.facing && s ? s.open[SIDES.indexOf(rule.facing)] : undefined
    rule.clearFront = r1(seen !== undefined && seen >= 0.5 ? Math.min(2.5, Math.max(clear * 0.6, seen)) : clear)
  }
  // High up: a roof, or an upper floor of a building players have to climb to (not a street on a bridge).
  const upstairs = !!s && s.n > 0 && s.lift >= 3 && s.inside >= s.n * 0.5 && (id.role === 'prop' || id.role === 'fence')
  if (attach === 'roof' || (attach === 'ground' && upstairs)) {
    rule.reach = reachFrom(id, lib) ?? (attach === 'roof' ? 'ladder' : 'stairs')
  }
  // How high up a wall or hanging thing goes, as the game mostly has it.
  if ((attach === 'wall' || attach === 'hang') && s && s.n > 0 && s.lift >= 0.3) rule.mountHeight = r1(s.lift)
  rule.mayVary = vary(e, id, rule, lib)
  // Cover: what stands on a floor and is at least knee high.
  if ((attach === 'ground' || attach === 'roof') && height >= 0.4 && id.role !== 'ground') {
    rule.coverHeight = r1(height)
    const open = s?.cover !== undefined && s.cover < 0.45
    if (open || SEE_THROUGH.test(id.name)) rule.seeThrough = true
    else if (s?.cover !== undefined) rule.seeThrough = false
  } else if (attach === 'building' && SEE_THROUGH.test(id.name)) rule.seeThrough = true
  return rule
}

/** How players get up to it, from what the game stands near it (a ladder, stairs, a fire escape, a ramp). */
function reachFrom(id: GameIdentity, lib?: Library): PlacementRule['reach'] | null {
  if (!lib) return null
  for (const n of id.near ?? []) {
    const m = lib.get(n)
    if (!m) continue
    const name = identify(m).name
    if (name === 'Ladder') return 'ladder'
    if (name === 'Stairs' || name === 'Fire escape') return 'stairs'
    if (name === 'Ramp') return 'ramp'
  }
  return null
}

/** What may change when it is placed; everything else stays as the game has it. */
function vary(e: GameObjectEntry, id: GameIdentity, rule: PlacementRule, lib?: Library): PlacementRule['mayVary'] {
  const out: PlacementRule['mayVary'] = []
  // Kit pieces and the parts of a whole stand exactly where their building or whole has them.
  if (rule.attach === 'building' || (id.partOf && rule.needs?.includes(id.partOf))) return out
  const big = Math.max(e.size[0], e.size[1]) > 8
  const variants = hasVariants(e, lib)
  if (rule.attach === 'wall') {
    // Slid along its wall; it keeps facing out.
    out.push('nudge')
  } else if (rule.attach === 'hang') {
    // Wires and other long things span exactly between what holds them.
    if (!big) out.push('turn', 'nudge')
  } else {
    // Something kept with its back to a wall keeps facing out; the rest can turn.
    if (!rule.facing || id.role === 'fence') out.push('turn')
    if (!(id.role === 'ground' && big)) out.push('nudge')
    if (!rule.needs?.length && !NO_MIRROR.test(id.name) && (id.kind === 'nature' || id.kind === 'clutter' || id.kind === 'cover' || id.role === 'fence')) out.push('mirror')
  }
  if (variants && id.role !== 'piece') out.push('variant')
  return out
}

/** Every model's rule at once (the library by id built once). */
export function placementRules(entries: GameObjectEntry[]): Map<string, PlacementRule> {
  const lib: Library = new Map(entries.map((e) => [e.id, e]))
  return new Map(entries.map((e) => [e.id, placementRule(e, lib)]))
}
