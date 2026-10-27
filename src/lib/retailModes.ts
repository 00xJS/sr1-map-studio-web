// Blinged Out Ride and sound zones: the marker types py/bor_mode.py and
// py/sound_zones.py write, what each needs, and their settings. The names
// here must match the Python modules. Nothing here has been tried in game yet.
import type { CheckItem } from './checklist'
import type { GameMode, Marker, Vec3 } from './project'
import { ITEM_PROP } from './gameObjects/items'
import { statusSentence } from './featureStatus'

export const BOR: GameMode = 'Blinged Out Ride'

export const BOR_VICTORY = 'BOR victory zone'
export const BOR_CHOP = 'BOR chop shop'
export const BOR_ENTRANCE = 'BOR chop shop entrance'
export const BOR_DOOR = 'BOR chop shop door'
export const BOR_GARAGE_RED = 'BOR red team garage'
export const BOR_GARAGE_BLUE = 'BOR blue team garage'
export const BOR_CAR_RED = 'BOR red team car'
export const BOR_CAR_BLUE = 'BOR blue team car'
export const BOR_CASH = 'BOR cash spawn'
export const SOUND_ZONE = 'Sound zone'
/** Boxes the camera is tested against (py/regions.py): no rain inside; a room also has its own even light, no sky, no sun shadows. */
export const RAIN_BLOCKER = 'Rain blocker'
export const INDOOR_ROOM = 'Indoor room'
export const REGION_TYPES = [RAIN_BLOCKER, INDOOR_ROOM]
/** Default boxes in metres: bigger than the room, because the game tests the camera, which sits behind the player. */
export const REGION_BOXES: Record<string, Vec3> = { [RAIN_BLOCKER]: [20, 10, 20], [INDOOR_ROOM]: [16, 8, 16] }
export const REGION_DEFAULT_AMBIENT = 0.35

export const BOR_TYPES = [BOR_CAR_RED, BOR_CAR_BLUE, BOR_GARAGE_RED, BOR_GARAGE_BLUE, BOR_CHOP, BOR_ENTRANCE, BOR_DOOR, BOR_VICTORY, BOR_CASH]
export const RETAIL_MARKER_TYPES = [...BOR_TYPES, SOUND_ZONE, ITEM_PROP, ...REGION_TYPES]

/** Box triggers and their default size in metres (width, height, depth). */
export const BOR_BOXES: Record<string, Vec3> = {
  [BOR_VICTORY]: [12, 6, 14],
  [BOR_CHOP]: [5.5, 3.25, 9.5],
  [BOR_ENTRANCE]: [12, 2, 6.5],
  [BOR_DOOR]: [2, 2, 2],
  [BOR_GARAGE_RED]: [7, 5, 11],
  [BOR_GARAGE_BLUE]: [7, 5, 11],
}
export const isZone = (m: Pick<Marker, 'type'>) => m.type in BOR_BOXES || m.type === SOUND_ZONE || m.type in REGION_BOXES

export const SOUND_DEFAULT_BOX: Vec3 = [20, 8, 20]
export const SOUND_DEFAULT_RADIUS = 15
export const SOUND_DEFAULT_VOLUME = 0.4

/** The zone's outline in metres: a box [w, h, d], or a sphere's radius. */
export function zoneShape(m: Marker): { box: Vec3 } | { radius: number } {
  if (m.type === SOUND_ZONE) return m.shape === 'box' ? { box: m.size ?? SOUND_DEFAULT_BOX } : { radius: m.radius || SOUND_DEFAULT_RADIUS }
  return { box: m.size ?? BOR_BOXES[m.type] ?? REGION_BOXES[m.type] ?? [4, 2, 4] }
}

/** Models the mode has its own settings for; the first car of each team is the team's ride, chosen by the game. */
export const BOR_CARS: [string, string][] = [
  ['car_2dr_compact03', 'Mockingbird'], ['car_4dr_lowrider01', 'Compton'], ['sp_metermaid01', 'Quota'], ['sp_forklift01', 'Forklift'],
  ['SUV_4dr_03', 'Aqua'], ['car_4dr_luxury01', 'Zomkah'], ['car_2dr_exoticsports01', 'Attrazione'], ['car_2dr_muscle03', 'La Fuerza'],
  ['car_4dr_luxury04', 'Eiswolf'], ['car_2dr_sports04', 'Venom'], ['car_2dr_standard02', 'Vegas'],
]
export const BOR_DEFAULT_CAR = 'car_2dr_compact03'

/** New markers of these types start with these settings. */
export function retailMarkerDefaults(type: string): Partial<Marker> {
  if (type in BOR_BOXES) return { size: [...BOR_BOXES[type]] as Vec3 }
  if (type === BOR_CAR_RED || type === BOR_CAR_BLUE) return { vehicle: BOR_DEFAULT_CAR }
  if (type === SOUND_ZONE) return { shape: 'sphere', radius: SOUND_DEFAULT_RADIUS, size: [...SOUND_DEFAULT_BOX] as Vec3, volume: SOUND_DEFAULT_VOLUME, sound: '' }
  if (type === ITEM_PROP) return { item: '' }
  if (type in REGION_BOXES) return { size: [...REGION_BOXES[type]] as Vec3, ...(type === INDOOR_ROOM ? { ambient: REGION_DEFAULT_AMBIENT } : {}) }
  return {}
}

export const RETAIL_MARKER_HINTS: Record<string, string> = {
  [BOR_CAR_RED]: "Where the red team's cars appear in Blinged Out Ride. The first is the team's ride; more become extra cars.",
  [BOR_CAR_BLUE]: "Where the blue team's cars appear in Blinged Out Ride. The first is the team's ride; more become extra cars.",
  [BOR_GARAGE_RED]: "The red team's garage in Blinged Out Ride: a safe zone around where its ride starts.",
  [BOR_GARAGE_BLUE]: "The blue team's garage in Blinged Out Ride: a safe zone around where its ride starts.",
  [BOR_CHOP]: 'A chop shop in Blinged Out Ride, where teams pay to bling their ride. Place 1 or 2.',
  [BOR_ENTRANCE]: 'The drive-in area in front of a chop shop. Place one per chop shop.',
  [BOR_DOOR]: "A chop shop's door for players on foot, a few metres beside its drive-in entrance. One per chop shop.",
  [BOR_VICTORY]: 'The victory garage in Blinged Out Ride: drive the fully blinged ride in here to win.',
  [BOR_CASH]: 'Where cash appears in Blinged Out Ride. Place 6 or more around the map.',
  [SOUND_ZONE]: 'A sphere or box that plays a sound from your game, like birds, traffic or room tone.',
  [RAIN_BLOCKER]: 'A box where it never rains: put one over a building or under a roof. Rain only falls on maps whose weather changes each match.',
  [INDOOR_ROOM]: 'A box that feels indoors: no rain, an even room light, no sky and no sun shadows.',
  [ITEM_PROP]: 'A small object the game places by name, like a weapon pickup: a chair, a flag, a barrel…' + statusSentence('item_props'),
}

/** What Blinged Out Ride still needs, in words ([] when the map has all of it). */
export function borMissing(markers: Pick<Marker, 'type'>[]): { text: string; type: string }[] {
  const has = (t: string) => markers.some((m) => m.type === t)
  return ([
    ['red team spawns', 'Red team spawn'], ['blue team spawns', 'Blue team spawn'],
    ['a red team car', BOR_CAR_RED], ['a blue team car', BOR_CAR_BLUE],
    ['a red team garage', BOR_GARAGE_RED], ['a blue team garage', BOR_GARAGE_BLUE],
    ['a chop shop', BOR_CHOP], ['a chop shop entrance', BOR_ENTRANCE], ['the victory garage', BOR_VICTORY],
    ['a cash drop-off', 'Chains drop-off'], ['cash spawns', BOR_CASH],
  ] as const).filter(([, t]) => !has(t)).map(([text, type]) => ({ text, type }))
}

/** Extra cars per team (all cars after each team's first): the level's number of customizable vehicles. */
export function borExtraCars(markers: Pick<Marker, 'type'>[]): number {
  const n = (t: string) => Math.max(0, markers.filter((m) => m.type === t).length - 1)
  return Math.max(n(BOR_CAR_RED), n(BOR_CAR_BLUE))
}

export const BOR_LIMITS = { chopShops: 2, extraCars: 8, cash: 16 }

export function borWarnings(markers: Pick<Marker, 'type'>[]): string[] {
  const count = (t: string) => markers.filter((m) => m.type === t).length
  const out: string[] = []
  if (count(BOR_CHOP) > BOR_LIMITS.chopShops) out.push(`Blinged Out Ride uses ${BOR_LIMITS.chopShops} chop shops at most; the others are left out.`)
  if (count(BOR_ENTRANCE) && count(BOR_ENTRANCE) < count(BOR_CHOP)) out.push('Blinged Out Ride: give each chop shop its own entrance.')
  if (count(BOR_DOOR) < count(BOR_CHOP)) out.push("Blinged Out Ride: give each chop shop a door for players on foot, as the game's own maps do.")
  if (count(BOR_VICTORY) > 1) out.push('Blinged Out Ride uses one victory garage; only the first is used.')
  if (count(BOR_CASH) && count(BOR_CASH) < 6) out.push(`Blinged Out Ride: only ${count(BOR_CASH)} cash spawns; the game's own maps use 8 to 11.`)
  return out
}

/** Checklist lines for Blinged Out Ride (when chosen) and sound zones. */
export function retailChecklist(modes: GameMode[], markers: Marker[]): CheckItem[] {
  const items: CheckItem[] = []
  if (modes.includes(BOR)) {
    const need = borMissing(markers)
    items.push(need.length
      ? { id: 'bor', state: 'needed', text: `Blinged Out Ride needs ${need.map((n) => n.text).join(', ')}`, fix: { kind: 'tool', tool: 'spawn', spawn: need[0].type }, action: 'Place' }
      : { id: 'bor', state: 'done', text: 'Blinged Out Ride: cars, garages, chop shop, victory garage and cash placed' })
    const doors = markers.filter((m) => m.type === BOR_DOOR).length, shops = markers.filter((m) => m.type === BOR_CHOP).length
    if (!need.length && doors < shops) items.push({ id: 'bor-door', state: 'suggested', text: 'Blinged Out Ride: give each chop shop a door for players on foot', fix: { kind: 'tool', tool: 'spawn', spawn: BOR_DOOR }, action: 'Place' })
  }
  const silent = markers.filter((m) => m.type === SOUND_ZONE && !m.sound?.trim()).length
  if (silent) items.push({ id: 'sound', state: 'suggested', text: `${silent === 1 ? '1 sound zone has' : `${silent} sound zones have`} no sound chosen: left out until you pick one` })
  return items
}

/** Marker types the spawn tool offers for the modes chosen: BOR markers only while Blinged Out Ride is. */
export const retailToolMarkers = (modes: GameMode[]) => [...(modes.includes(BOR) ? BOR_TYPES : []), SOUND_ZONE, ITEM_PROP, ...REGION_TYPES]
