// Which export features have been tried in the game. Every "not yet tried in game" note on the site reads
// from here, so when a feature passes an in-game test, changing its status here updates every panel,
// hint and export summary at once.
//
//   proven    tried in game and it works
//   exports   the export writes it and a check in tests/ reads it back, but nobody has tried it in game
//   untested  written by the export, not yet checked either way

export type FeatureState = 'proven' | 'exports' | 'untested'

export interface Feature {
  label: string
  state: FeatureState
  /** What was seen, or what to look for in game. */
  note: string
  /** On in every export unless someone turns it off: these come first in an in-game test. */
  byDefault?: boolean
  /** When and on what it was tried in game (proven only). */
  tested?: string
}

export const FEATURES = {
  invisible_walls: { label: 'Invisible walls removed', state: 'proven', byDefault: true, tested: '2026-10-24, Slime\'s rescaled Dust', note: 'Paper-thin triangles left out of the collision: the camera stopped being pushed and players no longer rub against open air.' },
  minimap: { label: 'Minimap', state: 'proven', byDefault: true, tested: '2026-10-24, Dust and Sublot', note: 'The map-wide region makes the HUD use the minimap picture.' },
  game_sky: { label: "The game's own sky", state: 'exports', byDefault: true, note: "The five sky objects of mp_bac_01, read from your game. Look for: sun, moon, stars and clouds instead of the painted sky box." },
  loading_screen: { label: 'Loading screen picture', state: 'untested', byDefault: true, note: 'The 3D view rendered at export (or your picture). Look for: it shows while the map loads.' },
  logo_walls: { label: 'Saints Reborn logo walls', state: 'untested', byDefault: true, note: 'The default outer-wall texture. Look for: the logo reads the right way round on every wall.' },
  map_description: { label: 'Map description', state: 'untested', note: "The help text in the game's menus, in every game language." },
  random_weather: { label: 'Changing time and weather', state: 'untested', note: 'Each match rolls noon, midnight, dusk or dawn and the weather. Look for: how the map looks at night.' },
  dry_interiors: { label: 'Dry interiors', state: 'exports', note: 'Rain blockers over floor that has a roof or ceiling. Reported not working in game on 2026-10-28: it still rained indoors. New exports add the rain occluders the game stops falling rain at, not yet tried in game. Look for: no rain indoors when the weather changes; shots, players and the camera still pass through the doorways.' },
  rain_blockers: { label: 'Rain blockers and indoor rooms', state: 'exports', note: 'Hand-placed rain blocker and indoor room markers. Not reported on their own, but they had the same fault as dry interiors (reported not working in game on 2026-10-28). New exports add the rain occluders the game stops falling rain at, not yet tried in game. Look for: no rain inside the marked box when the weather changes; shots, players and the camera still pass through its sides.' },
  ambience: { label: 'Background sound', state: 'untested', note: "Borrowed from your game when the map loads. Look for: the retail map's sound bed or sound spots." },
  water: { label: 'Swimmable water', state: 'exports', note: 'No collision, see-through, swim surface at the top. Look for: swimming, and climbing back out.' },
  physics_props: { label: 'Physics props', state: 'exports', note: 'Loose, heavy, rolling, bouncy, explosive and breakable props with fitted collision.' },
  breakable_glass: { label: 'Breakable glass', state: 'untested', note: 'Your mesh with a fitted Havok box hull. Look for: it shatters when shot.' },
  breakable_wood: { label: 'Breakable wood', state: 'untested', note: 'A loose object that disappears when it breaks.' },
  crate_debris: { label: 'Smashing crates', state: 'exports', note: 'Wooden crates smash into boards and dust, read from your game files.' },
  item_props: { label: 'Item props', state: 'untested', note: 'Small objects the game places by name, like a weapon pickup.' },
  sound_zones: { label: 'Sound zones', state: 'exports', note: "The game's own ambience sounds where you place them." },
  blinged_out_ride: { label: 'Blinged Out Ride', state: 'exports', note: 'Team cars, garages, a chop shop and a victory garage.' },
  surface_registration: { label: 'Early surface registration', state: 'exports', note: 'Two sf_… files so footsteps and bullet impacts follow each texture.' },
  native_sky: { label: 'Native sky presets', state: 'untested', note: 'Stages an original sky resource pair with your map.' },
  pimp_exit: { label: 'Pimp exit marker', state: 'untested', note: 'The game has no pimp exit action: it logs the name as an error and reads it as "execute lua script", so the marker does nothing.' },
  decoy_dummies: { label: 'Decoy dummies', state: 'untested', note: 'Posed player and people models standing as map geometry, solid only in their body boxes. Look for: shots and players stop at the body, no health bar or team arrow over them, how they look beside real players.' },
} satisfies Record<string, Feature>

export type FeatureId = keyof typeof FEATURES

export const feature = (id: FeatureId): Feature => FEATURES[id]
export const triedInGame = (id: FeatureId) => FEATURES[id].state === 'proven'

/** The short tag for chips and summaries: "not yet tried in game", or '' once it has been. */
export const statusTag = (id: FeatureId) => (triedInGame(id) ? '' : 'not yet tried in game')

/** A sentence to end a hint with: " Not yet tried in game." or '' once it has been. */
export const statusSentence = (id: FeatureId) => (triedInGame(id) ? '' : ' Not yet tried in game.')

/** " (not yet tried in game)" for the export summary, or ''. */
export const statusParen = (id: FeatureId) => (triedInGame(id) ? '' : ' (not yet tried in game)')
