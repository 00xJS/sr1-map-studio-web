// Plain-language names and one-line explanations for game terms, used by the
// simple editor. The stored values stay the exporter's names.
import type { GameMode } from './project'

export const MARKER_LABELS: Record<string, string> = {
  'Shared spawn': 'Player spawn',
  'Red team spawn': 'Red team spawn',
  'Blue team spawn': 'Blue team spawn',
  'Weapon pickup': 'Weapon',
  'Vehicle spawn': 'Vehicle',
  'Chains drop-off': 'Chains drop-off',
  'Pimp entrance': 'Pimp entrance',
}
export const markerLabel = (type: string) => MARKER_LABELS[type] ?? type

/** What each placeable marker is for, in game terms a player knows. */
export const MARKER_HINTS: Record<string, string> = {
  'Shared spawn': 'Where players appear in every-player-for-themselves modes.',
  'Red team spawn': 'Where the red team appears in team modes and Protect Tha Pimp.',
  'Blue team spawn': 'Where the blue team appears in team modes and Protect Tha Pimp.',
  'Chains drop-off': 'Where players cash in chains in Big Ass Chains. Place 2 or more.',
  'Pimp entrance': 'Where the pimp starts in Protect Tha Pimp.',
  'Vehicle spawn': 'A car or bike that appears on the map.',
}

/** The markers offered in simple mode; triggers, navpoints and NPCs are in advanced mode. */
export const SIMPLE_MARKERS = Object.keys(MARKER_HINTS)

export const MODE_HINTS: Record<GameMode, string> = {
  'Gangsta Brawl': 'Every player for themselves.',
  'Team Gangsta Brawl': 'Two teams fight it out.',
  'Big Ass Chains': 'Take chains from beaten players and cash them in.',
  'Team Big Ass Chains': 'Big Ass Chains in two teams.',
  'Protect Tha Pimp': 'One team guards the pimp, the other hunts him.',
}
