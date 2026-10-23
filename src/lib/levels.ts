// Game-mode entries for multiplayer_levels_extra.xtbl and the marker checks
// each mode needs. The game only accepts its exact mode names, level IDs must
// be unique across every installed map pack (Saints Reborn's map check), and
// Protect Tha Pimp loads its own <map>_ptp.cts, as the retail PTP maps do;
// Blinged Out Ride its own <map>_bor.cts plus levels/<map>_mode.xtbl.
import { PIMP_EXIT, SPAWN_TYPES, type GameMode, type Marker, type ProjectSettings } from './project'
import { BOR, borExtraCars, borMissing, borWarnings } from './retailModes'

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
 * Retail maps list as many customizable weapons/vehicles as distinct
 * $Item type / $Vehicle type values in the CTS the entry loads (mp_bac_03
 * 11/4, mp_arena 8/1); maps without weapon pickups (all PTP maps) use 6.
 */
export function customizableCounts(markers: Marker[]): { weapons: number; vehicles: number } {
  const weapons = distinct(markers.filter((m) => m.type === 'Weapon pickup').map((m) => m.label || m.weapon))
  const vehicles = distinct(markers.filter((m) => m.type === 'Vehicle spawn').map((m) => m.label || m.vehicle))
  return { weapons: Math.min(20, weapons || 6), vehicles: Math.min(20, vehicles) }
}

/** Blinged Out Ride is listed only when the map has everything the mode needs. */
export function levelEntries(map: string, modes: GameMode[], markers: Marker[]): LevelEntry[] {
  const main = customizableCounts(markers)
  const ptp = customizableCounts([]) // the PTP CTS holds team spawns and pimp entrances only
  // BOR cars come from <map>_mode.xtbl: the extra cars per team, as retail mp_bor_01 (3).
  const bor = { weapons: main.weapons, vehicles: borExtraCars(markers) }
  return modes.filter((mode) => mode !== BOR || !borMissing(markers).length).map((mode) => {
    const isPtp = mode === 'Protect Tha Pimp'
    const counts = isPtp ? ptp : mode === BOR ? bor : main
    const ctsFile = isPtp ? `${map}_ptp` : mode === BOR ? `${map}_bor` : map
    return { mode, name: `${map} ${ABBREV[mode]}`, ctsFile, id: levelId(map, mode), ...counts }
  })
}

export interface ModeCheck { errors: string[]; warnings: string[] }

export function checkModes(settings: Pick<ProjectSettings, 'modes'>, markers: Marker[]): ModeCheck {
  const errors: string[] = []
  const warnings: string[] = []
  const count = (type: string) => markers.filter((m) => m.type === type).length
  const modes = settings.modes
  if (!modes.length) errors.push('Choose at least one game mode.')
  const exits = count(PIMP_EXIT)
  if (exits) errors.push(`Remove ${exits === 1 ? 'the Pimp exit marker' : `the ${exits} Pimp exit markers`} or change ${exits === 1 ? 'its' : 'their'} type: the game has no "pimp exit" action.`)
  const spawns = markers.filter((m) => SPAWN_TYPES.includes(m.type)).length
  const brawl = modes.filter((m) => m !== 'Protect Tha Pimp')
  if (brawl.length && spawns > 0 && spawns < 4) warnings.push(`Only ${spawns} spawn${spawns === 1 ? '' : 's'}: at least 4 are recommended, ideally 8 or more.`)
  if (modes.some((m) => m.includes('Chains')) && count('Chains drop-off') < 2) {
    warnings.push('Big Ass Chains modes need Chains drop-off markers; place at least 2 (the drop-off moves between them every 2 minutes).')
  }
  if (modes.includes('Protect Tha Pimp')) {
    const red = count('Red team spawn'), blue = count('Blue team spawn'), pimp = count('Pimp entrance')
    const missing = [!red && 'Red team spawns', !blue && 'Blue team spawns', !pimp && "the pimp's escape point (Pimp entrance marker)"].filter(Boolean)
    if (missing.length) errors.push(`Protect Tha Pimp needs ${missing.join(', ')}.`)
    else if (red < 4 || blue < 4) warnings.push(`Protect Tha Pimp: ${red} red and ${blue} blue spawns. Retail PTP maps use 6 per team.`)
  } else if (count('Pimp entrance')) {
    warnings.push("The pimp's escape points (Pimp entrance markers) are only used by Protect Tha Pimp, which is not selected.")
  }
  if (modes.includes(BOR)) {
    const need = borMissing(markers)
    if (need.length) errors.push(`Blinged Out Ride needs ${need.map((n) => n.text).join(', ')}.`)
    else warnings.push(...borWarnings(markers))
  }
  return { errors, warnings }
}
