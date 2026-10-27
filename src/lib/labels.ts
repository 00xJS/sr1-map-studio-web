// Plain-language names and one-line explanations for game terms, used by the
// simple editor. The stored values stay the exporter's names.
import type { GameMode } from './project'
import { RETAIL_MARKER_HINTS } from './retailModes'
import { statusSentence } from './featureStatus'

export const MARKER_LABELS: Record<string, string> = {
  'Shared spawn': 'Player spawn',
  'Red team spawn': 'Red team spawn',
  'Blue team spawn': 'Blue team spawn',
  'Weapon pickup': 'Weapon',
  'Vehicle spawn': 'Vehicle',
  'Chains drop-off': 'Chains drop-off',
  'Pimp entrance': "Pimp's escape point",
}
export const markerLabel = (type: string) => MARKER_LABELS[type] ?? type

/** What each placeable marker is for, in game terms a player knows. */
export const MARKER_HINTS: Record<string, string> = {
  'Shared spawn': 'Where everyone appears in Gangsta Brawl and Big Ass Chains, team versions too. Place 8 or more, spread over the map.',
  'Red team spawn': 'Where the red team appears in Protect Tha Pimp and Blinged Out Ride. Brawl and Chains use Player spawns, as in the game.',
  'Blue team spawn': 'Where the blue team appears in Protect Tha Pimp and Blinged Out Ride. Brawl and Chains use Player spawns, as in the game.',
  'Chains drop-off': 'Where players cash in chains in Big Ass Chains. The drop-off moves between them during the match: place 4, spread over the map.',
  'Pimp entrance': "Where the pimp has to get to in Protect Tha Pimp. Place 1 or 2, well away from both teams' spawns.",
  'Vehicle spawn': 'A car or bike that appears on the map.',
}

/** The markers offered in simple mode; triggers, navpoints and NPCs are in advanced mode. */
export const SIMPLE_MARKERS = Object.keys(MARKER_HINTS)
// Blinged Out Ride and sound zone markers: offered by the spawn tool on their own terms (retailToolMarkers).
Object.assign(MARKER_HINTS, RETAIL_MARKER_HINTS)

export const MODE_HINTS: Record<GameMode, string> = {
  'Gangsta Brawl': 'Every player for themselves.',
  'Team Gangsta Brawl': 'Two teams fight it out.',
  'Big Ass Chains': 'Take chains from beaten players and cash them in.',
  'Team Big Ass Chains': 'Big Ass Chains in two teams.',
  'Protect Tha Pimp': 'One team guards the pimp, the other hunts him.',
  'Blinged Out Ride': 'Teams earn cash to bling their ride, then drive it into the victory garage. Needs its own markers.' + statusSentence('blinged_out_ride'),
}
