// Game-mode entries for multiplayer_levels_extra.xtbl and the marker checks
// each mode needs. The game only accepts its exact mode names, level IDs must
// be unique across every installed map pack (Saints Reborn's map check), and
// Protect Tha Pimp loads its own <map>_ptp.cts, as the retail PTP maps do;
// Blinged Out Ride its own <map>_bor.cts plus levels/<map>_mode.xtbl.
import { PIMP_EXIT, SPAWN_TYPES, type GameMode, type Marker, type ProjectSettings } from './project'
import { catalogs } from './catalogs'
import { ITEM_PROP } from './gameObjects/items'
import { BOR, BOR_CAR_BLUE, BOR_CAR_RED, BOR_TYPES, borExtraCars, borMissing, borWarnings } from './retailModes'
import { SPAWN_RULES, UNITS_PER_M } from './player'

export interface LevelEntry {
  mode: GameMode
  name: string
  ctsFile: string
  id: number
  weapons: number
  vehicles: number
}

const ABBREV: Record<GameMode, string> = {
  'Gangsta Brawl': 'GB', 'Team Gangsta Brawl': 'TGB', 'Big Ass Chains': 'BAC', 'Team Big Ass Chains': 'TBAC', 'Protect Tha Pimp': 'PTP', 'Blinged Out Ride': 'BOR',
}

/** Same ID for the same map name and mode, whatever else is selected. 1000-32767 marks a custom level. */
export function levelId(map: string, mode: GameMode): number {
  let h = 2166136261
  for (const ch of `${map.toLowerCase()}|${mode}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  return 1000 + ((h >>> 0) % 31768)
}

const distinct = (values: string[]) => new Set(values.map((v) => v.replace(/-/g, ' ').trim().toLowerCase()).filter(Boolean)).size

/**
 * The most lobby weapons/vehicles the host can turn on in a custom match.
 * Retail maps list as many as distinct $Item type / $Vehicle type values in
 * the CTS the entry loads (mp_bac_03 11/4, mp_arena 8/1); maps without weapon
 * pickups (all PTP maps) use 6. Item props don't need a row of their own: with
 * fewer rows on than types, the game reuses the chosen weapons.
 */
export function customizableCounts(markers: Marker[]): { weapons: number; vehicles: number } {
  const weapons = distinct(markers.filter((m) => m.type === 'Weapon pickup').map((m) => m.label || m.weapon))
  const vehicles = distinct(markers.filter((m) => m.type === 'Vehicle spawn').map((m) => m.label || m.vehicle))
  return { weapons: Math.min(20, weapons || 6), vehicles: Math.min(20, vehicles) }
}

/** Blinged Out Ride is listed only when the map has everything the mode needs. */
export function levelEntries(map: string, modes: GameMode[], markers: Marker[], ptpKeepWeapons = false): LevelEntry[] {
  const main = customizableCounts(markers)
  // The PTP CTS holds team spawns and pimp entrances, and the weapon pickups only if the map keeps them.
  const ptp = customizableCounts(ptpKeepWeapons ? markers.filter((m) => m.type === 'Weapon pickup') : [])
  // BOR cars come from <map>_mode.xtbl: the extra cars per team, as retail mp_bor_01 (3).
  const bor = { weapons: main.weapons, vehicles: borExtraCars(markers) }
  return modes.filter((mode) => mode !== BOR || !borMissing(markers).length).map((mode) => {
    const isPtp = mode === 'Protect Tha Pimp'
    const counts = isPtp ? ptp : mode === BOR ? bor : main
    const ctsFile = isPtp ? `${map}_ptp` : mode === BOR ? `${map}_bor` : map
    return { mode, name: `${map} ${ABBREV[mode]}`, ctsFile, id: levelId(map, mode), ...counts }
  })
}

/** $Trigger max fires is one byte in the game; sr1_cts.py lowers anything above this. */
export const MAX_TRIGGER_FIRES = 255
/**
 * Different $Item types a custom match with lobby weapons on can remember (0x823DBF50); the next one gets a
 * missing item. py/item_props.py leaves out item props that go past it. Weapon pickups are only warned about.
 */
export const MAX_ITEM_TYPES = 20

type ItemMarker = Pick<Marker, 'type' | 'label' | 'weapon' | 'item'>

/** The distinct $Item types the map's main CTS will name: weapon pickups and item props that have an item chosen. */
export function itemTypes(markers: ItemMarker[]): Set<string> {
  const names = markers.flatMap((m) => (m.type === 'Weapon pickup' ? [(m.label || m.weapon).replace(/-/g, ' ')] : m.type === ITEM_PROP && m.item ? [m.item] : []))
  return new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))
}

/**
 * The item type limit in plain words, or nothing when the files the selected modes load are within it. Item props go
 * only in the main file: Blinged Out Ride's copy is made before they are added, and Protect Tha Pimp's file has only
 * the weapon pickups, if the map keeps them there.
 */
export function itemTypesText(modes: GameMode[], markers: ItemMarker[], ptpKeepWeapons = false): string | null {
  const weapons = itemTypes(markers.filter((m) => m.type === 'Weapon pickup')).size
  const main = freeForAll(modes)
  const types = main ? itemTypes(markers).size : modes.includes(BOR) || (ptpKeepWeapons && modes.includes('Protect Tha Pimp')) ? weapons : 0
  if (types <= MAX_ITEM_TYPES) return null
  const fix = weapons <= MAX_ITEM_TYPES
    ? `The export leaves out item props that add a type past ${MAX_ITEM_TYPES}: place fewer different ones to choose which stay.`
    : `Use ${MAX_ITEM_TYPES} or fewer different weapon pickups${main ? ': the export keeps every pickup and leaves out any item prop that adds a new type' : ''}.`
  return `This map uses ${types} different item types, counting weapon pickups${main ? ' and item props' : ''}. In a custom match with lobby weapons on, the game keeps track of ${MAX_ITEM_TYPES}: past that it gets a missing item, which may crash the match. ${fix}`
}

/**
 * Spawns the game keeps from one CTS file (0x83E36280); later ones in the file are dropped with no error, by
 * 0x824C2BA8 and its caller. Its own maps have at most 29. map_features.py warns at export too.
 */
export const MAX_SPAWNS = 64

/** The spawn limit for each spawn file the selected modes load, in plain words: one text for each file over it. */
export function spawnLimitTexts(modes: GameMode[], markers: Pick<Marker, 'type'>[]): string[] {
  const count = (types: string[]) => markers.filter((m) => types.includes(m.type)).length
  const team = count(['Red team spawn', 'Blue team spawn'])
  const files: [string, number][] = []
  // With no Player spawns, the main file holds the team spawns with their teams removed (map_features.brawl_spawns).
  if (freeForAll(modes)) files.push(['Gangsta Brawl and Big Ass Chains', count(['Shared spawn']) || team])
  if (modes.includes('Protect Tha Pimp')) files.push(['Protect Tha Pimp', team])
  if (modes.includes(BOR)) files.push(['Blinged Out Ride', team + count([BOR_CAR_RED, BOR_CAR_BLUE])])
  return files.filter(([, n]) => n > MAX_SPAWNS).map(([what, n]) => `${n} spawns in the ${what} spawn file${what === 'Blinged Out Ride' ? ', counting team cars' : ''}. The game keeps the first ${MAX_SPAWNS} in the file and ignores the rest with no error, so a team placed later can lose some or all of its spawns. Its own maps have at most 29: remove ${n - MAX_SPAWNS}.`)
}

export interface ModeCheck { errors: string[]; warnings: string[] }

/** Gangsta Brawl and Big Ass Chains, team versions too: everyone spawns at Player spawns (no team ones), as on the game's own maps. */
export const freeForAll = (modes: GameMode[]) => modes.some((m) => m.includes('Gangsta Brawl') || m.includes('Chains'))
/** Triggers in the main file reach the game: those modes load it and Blinged Out Ride loads a copy. Protect Tha Pimp's own file has none. */
const mainTriggersLoaded = (modes: GameMode[]) => freeForAll(modes) || modes.includes(BOR)
/** The triggers a selected mode's file really holds: a pimp entrance is only in Protect Tha Pimp's, the others only in the main file. */
const loadedTriggers = (modes: GameMode[], markers: Marker[]) => markers.filter((m) => catalogs.trigger_kinds.includes(m.type)
  && (m.type === 'Pimp entrance' ? modes.includes('Protect Tha Pimp') : mainTriggersLoaded(modes)))
/** Player spawns the game's own GB/BAC maps have (8 to 10). */
export const FFA_SPAWNS = 8
/** Chains drop-offs on each of the game's own BAC maps. */
export const CHAINS_DROPS = 4
/** Editor units (0.5 m): closer than this on the same floor counts as bunched together. */
export const SPAWN_GAP = 16
export const DROP_GAP = 40

/** How many of these markers have another within `gap` units across and on the same floor. */
export function bunched(markers: Pick<Marker, 'position'>[], gap: number): number {
  const near = (a: Marker['position'], b: Marker['position']) => Math.abs(a[1] - b[1]) < 6 && Math.hypot(a[0] - b[0], a[2] - b[2]) < gap
  return markers.filter((m, i) => markers.some((o, j) => j !== i && near(m.position, o.position))).length
}

/**
 * Weapon pickups and drop-offs within the game's 5 m of a spawn (and less than 5 m above or below): the game
 * won't spawn anyone there while an enemy is that close, and players gather at those. Marker indexes, the
 * pickup or drop-off first.
 */
export function crowdedSpawns(markers: Pick<Marker, 'type' | 'position'>[]): { marker: number; spawn: number }[] {
  const near = SPAWN_RULES.enemyM * UNITS_PER_M, dy = SPAWN_RULES.enemyDyM * UNITS_PER_M
  const out: { marker: number; spawn: number }[] = []
  markers.forEach((m, i) => {
    if (m.type !== 'Weapon pickup' && m.type !== 'Chains drop-off') return
    const s = markers.findIndex((o) => SPAWN_TYPES.includes(o.type) && Math.abs(o.position[1] - m.position[1]) < dy
      && Math.hypot(o.position[0] - m.position[0], o.position[1] - m.position[1], o.position[2] - m.position[2]) < near)
    if (s >= 0) out.push({ marker: i, spawn: s })
  })
  return out
}

/** The 5 m check in plain words. */
export function crowdedText(markers: Pick<Marker, 'type'>[], list: { marker: number }[]): string {
  const n = list.length
  const kinds = [...new Set(list.map((c) => (markers[c.marker].type === 'Weapon pickup' ? 'weapon pickup' : 'drop-off')))]
  const what = kinds.length === 2 ? (n === 1 ? 'weapon pickup or drop-off' : 'weapon pickups and drop-offs') : `${kinds[0]}${n === 1 ? '' : 's'}`
  return `${n} ${what} ${n === 1 ? 'is' : 'are'} within ${SPAWN_RULES.enemyM} m of a spawn. The game won't spawn anyone there while an enemy is that close, and players gather at ${n === 1 ? 'it' : 'them'}: move ${n === 1 ? 'it' : 'them'} further away.`
}

/** Markers that only a game mode which isn't selected uses: the warning to show and the marker types a one-click fix removes. */
export interface UnusedMarkers { text: string; types: string[]; count: number }

export function unusedModeMarkers(modes: GameMode[], markers: Pick<Marker, 'type'>[]): UnusedMarkers[] {
  const count = (types: string[]) => markers.filter((m) => types.includes(m.type)).length
  const out: UnusedMarkers[] = []
  const pimp = ['Pimp entrance']
  if (!modes.includes('Protect Tha Pimp') && count(pimp)) {
    out.push({ text: "The pimp's escape points (Pimp entrance markers) are only used by Protect Tha Pimp, which is not selected.", types: pimp, count: count(pimp) })
  }
  // Drop-offs serve both Chains modes and Blinged Out Ride (its cash drop-off).
  const drops = ['Chains drop-off']
  if (!modes.some((m) => m.includes('Chains')) && !modes.includes(BOR) && count(drops)) {
    out.push({ text: 'Chains drop-off markers are only used by Big Ass Chains and Blinged Out Ride, which are not selected.', types: drops, count: count(drops) })
  }
  if (!modes.includes(BOR) && count(BOR_TYPES)) {
    out.push({ text: 'The Blinged Out Ride markers (cars, garages, chop shops, victory zone, cash spawns) are only used by Blinged Out Ride, which is not selected.', types: BOR_TYPES, count: count(BOR_TYPES) })
  }
  return out
}

export function checkModes(settings: Pick<ProjectSettings, 'modes' | 'ptp_keep_weapons'>, markers: Marker[]): ModeCheck {
  const errors: string[] = []
  const warnings: string[] = []
  const count = (type: string) => markers.filter((m) => m.type === type).length
  const modes = settings.modes
  if (!modes.length) errors.push('Choose at least one game mode.')
  const exits = count(PIMP_EXIT)
  if (exits) errors.push(`Remove ${exits === 1 ? 'the Pimp exit marker' : `the ${exits} Pimp exit markers`} or change ${exits === 1 ? 'its' : 'their'} type: the game has no "pimp exit" action.`)
  const spawns = markers.filter((m) => SPAWN_TYPES.includes(m.type)).length
  if (freeForAll(modes) && spawns > 0) {
    const shared = markers.filter((m) => m.type === 'Shared spawn')
    if (!shared.length) warnings.push(`Gangsta Brawl and Big Ass Chains spawn everyone at Player spawns, team versions too. With none placed, everyone uses the team spawns and appears next to each other: place ${FFA_SPAWNS} or more spread over the map.`)
    else if (shared.length < FFA_SPAWNS) warnings.push(`Only ${shared.length} Player spawn${shared.length === 1 ? '' : 's'}: Gangsta Brawl and Big Ass Chains spawn everyone at these (team versions too). The game's own maps have 8 to 10, spread over the map.`)
    const close = bunched(shared, SPAWN_GAP)
    if (close) warnings.push(`${close} Player spawns are within ${SPAWN_GAP / 2} m of another, so players can appear next to each other. The game's own maps keep them about 10 to 45 m apart.`)
  }
  // Team spawns go only into the Protect Tha Pimp and Blinged Out Ride spawn files: with neither mode on, nothing uses them.
  const teams = count('Red team spawn') + count('Blue team spawn')
  if (teams && count('Shared spawn') && !modes.includes('Protect Tha Pimp') && !modes.includes(BOR)) {
    warnings.push(`${teams} team spawn${teams === 1 ? ' is' : 's are'} left out of the export: only Protect Tha Pimp and Blinged Out Ride use team spawns. Gangsta Brawl and Big Ass Chains, team versions too, spawn everyone at Player spawns, as the game's own maps do. Turn on Protect Tha Pimp to use them, or change them to Player spawns.`)
  }
  const crowded = crowdedSpawns(markers)
  if (crowded.length) warnings.push(crowdedText(markers, crowded))
  warnings.push(...spawnLimitTexts(modes, markers))
  const itemsOver = itemTypesText(modes, markers, !!settings.ptp_keep_weapons)
  if (itemsOver) warnings.push(itemsOver)
  const triggers = loadedTriggers(modes, markers)
  const overFires = triggers.filter((m) => m.max_fires > MAX_TRIGGER_FIRES).length
  if (overFires) warnings.push(`${overFires} trigger${overFires === 1 ? ' has' : 's have'} more than ${MAX_TRIGGER_FIRES} max fires, the most the game can store. The export lowers ${overFires === 1 ? 'it' : 'them'} to ${MAX_TRIGGER_FIRES}.`)
  // Saved projects aren't filled in field by field (normalizeProject), so a hand-edited one can have no action at all.
  const typed = triggers.filter((m) => m.type === 'Sphere trigger (custom)').map((m) => (m.trigger_action ?? '').trim())
  const unknown = [...new Set(typed.filter((a) => a && !catalogs.trigger_actions.includes(a.toLowerCase())))]
  if (unknown.length) warnings.push(`The game has no ${unknown.map((a) => `"${a}"`).join(', ')} trigger action. It logs an error and treats the trigger as "execute lua script", so it does nothing: choose one of the game's actions.`)
  const drops = markers.filter((m) => m.type === 'Chains drop-off')
  if (modes.some((m) => m.includes('Chains'))) {
    // Only here: Blinged Out Ride removes the flag from its own copy, and the other modes don't use drop-offs.
    if (drops.length && drops.every((m) => m.disabled)) warnings.push(`Every Chains drop-off has "Starts switched off" on, which none of the game's own maps does (most start them all on). Older maps got it by default: turn it off unless you meant it.`)
    if (drops.length < 2) warnings.push(`Big Ass Chains modes need Chains drop-off markers; place at least 2, ideally ${CHAINS_DROPS} (the drop-off moves between them during the match).`)
    else if (drops.length < CHAINS_DROPS) warnings.push(`${drops.length} Chains drop-offs: the game's own maps have ${CHAINS_DROPS}, spread over the map, and the drop-off moves between them during the match.`)
    const close = bunched(drops, DROP_GAP)
    if (close) warnings.push(`${close} Chains drop-offs are within ${DROP_GAP / 2} m of another. The drop-off moves between them during the match, so spread them out to move the fight around.`)
  }
  if (modes.includes('Protect Tha Pimp')) {
    const red = count('Red team spawn'), blue = count('Blue team spawn'), pimp = count('Pimp entrance')
    const missing = [!red && 'Red team spawns', !blue && 'Blue team spawns', !pimp && "the pimp's escape point (Pimp entrance marker)"].filter(Boolean)
    if (missing.length) errors.push(`Protect Tha Pimp needs ${missing.join(', ')}.`)
    else if (red < 4 || blue < 4) warnings.push(`Protect Tha Pimp: ${red} red and ${blue} blue spawns. Retail PTP maps use 6 per team.`)
  }
  if (modes.includes(BOR)) {
    const need = borMissing(markers)
    if (need.length) errors.push(`Blinged Out Ride needs ${need.map((n) => n.text).join(', ')}.`)
    else warnings.push(...borWarnings(markers))
  }
  warnings.push(...unusedModeMarkers(modes, markers).map((u) => u.text))
  return { errors, warnings }
}
