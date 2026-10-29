// "Ready to play" checklist: what a map still needs before it can go into the
// game ('needed' blocks Play), and what would make it better ('suggested').
import { PIMP_EXIT, SPAWN_TYPES, gameSkyWanted, isCustomNative, isGlass, type Project } from './project'
import { retailChecklist } from './retailModes'
import { isDummy, dummyRefOf } from './dummies/standIn'
import { MANY_LOOKS, MAX_DUMMIES, lookKey } from './dummies/models'
import { CHAINS_DROPS, DROP_GAP, FFA_SPAWNS, SPAWN_GAP, bunched, crowdedSpawns, crowdedText, freeForAll, unusedModeMarkers } from './levels'

export type Fix =
  | { kind: 'tool'; tool: string; spawn?: string }
  | { kind: 'samples' }
  | { kind: 'modes' }
  | { kind: 'setup' }
  | { kind: 'select'; index: number }
  /** Select a marker (and show it). */
  | { kind: 'marker'; index: number }
  /** Delete every marker of these types (ones only an unselected game mode uses). */
  | { kind: 'removeMarkers'; types: string[]; label: string }
  /** Give the map the default sky picture. */
  | { kind: 'sky' }
  /** Move unusable spawns and weapons and add more where players can use them (editor/spawnActions.ts). */
  | { kind: 'autoSpawns' }

export interface CheckItem {
  id: string
  state: 'done' | 'needed' | 'suggested'
  text: string
  fix?: Fix
  /** Button text for the fix. */
  action?: string
}

/** Objects with a material that has no texture (they can't be exported). */
export function untextured(p: Project): number[] {
  const out: number[] = []
  p.scene_items.forEach((it, i) => {
    if (isCustomNative(it)) { if (!it.glass_custom_texture) out.push(i) }
    else if (!isGlass(it) && Object.values(it.textures || {}).some((v) => !v)) out.push(i)
  })
  return out
}

/** `dataPack` is null while its status is still loading. */
export function mapChecklist(p: Project, dataPack: boolean | null): CheckItem[] {
  const items: CheckItem[] = []
  const count = (type: string) => p.markers.filter((m) => m.type === type).length
  const modes = p.settings.modes
  const add = (c: CheckItem) => items.push(c)

  if (dataPack === false) add({ id: 'pack', state: 'needed', text: 'One-time setup: load your data pack so maps can be built', fix: { kind: 'setup' }, action: 'Set up' })

  add(p.scene_items.length
    ? { id: 'ground', state: 'done', text: 'Ground to stand on' }
    : { id: 'ground', state: 'needed', text: 'Build something to stand on', fix: { kind: 'samples' }, action: 'Start' })

  const bare = untextured(p)
  if (bare.length) add({
    id: 'textures', state: 'needed', fix: { kind: 'select', index: bare[0] }, action: 'Show',
    text: `${bare.length === 1 ? '1 object has' : `${bare.length} objects have`} a surface with no texture`,
  })

  const spawns = p.markers.filter((m) => SPAWN_TYPES.includes(m.type)).length
  const spawnFix: Fix = { kind: 'tool', tool: 'spawn', spawn: 'Shared spawn' }
  if (!spawns) add({ id: 'spawns', state: 'needed', text: 'Place spawns where players appear', fix: spawnFix, action: 'Place' })
  else if (spawns < 4) add({ id: 'spawns', state: 'suggested', text: `Only ${spawns} spawn${spawns === 1 ? '' : 's'}: every player would start in the same few spots (8 or more is good)`, fix: { kind: 'autoSpawns' }, action: 'Add for me' })
  else add({ id: 'spawns', state: 'done', text: `${spawns} spawns` })
  // Gangsta Brawl and Big Ass Chains spawn everyone at Player spawns, never at team ones.
  const shared = p.markers.filter((m) => m.type === 'Shared spawn')
  if (spawns && freeForAll(modes)) {
    if (shared.length < FFA_SPAWNS) add({ id: 'ffa-spawns', state: 'suggested', text: `Gangsta Brawl and Big Ass Chains use Player spawns only: ${shared.length} placed, ${FFA_SPAWNS} or more spread over the map is good`, fix: { kind: 'autoSpawns' }, action: 'Add for me' })
    else if (bunched(shared, SPAWN_GAP)) add({ id: 'ffa-spawns', state: 'suggested', text: `${bunched(shared, SPAWN_GAP)} Player spawns are within ${SPAWN_GAP / 2} m of another: spread them out so players don't appear together` })
  }

  // No sky picture and no native sky (early surface registration brings one): the game draws a black sky (unless the export can add the game's own sky).
  if (p.scene_items.length && !p.settings.sky_texture && !p.settings.native_sky && !p.settings.surface_preload) add({
    id: 'sky', state: 'suggested', fix: { kind: 'sky' }, action: 'Add sky',
    text: gameSkyWanted(p.settings) ? "No fallback sky picture: without your game files at export the sky is black. Add one?" : 'No sky: the game shows black overhead. Add one?',
  })

  // Rain blockers keep rain out, and an always-clear map has none.
  if (count('Rain blocker') && p.settings.always_clear_weather) add({ id: 'rain-blockers', state: 'suggested', text: 'Rain blockers only matter when the weather changes each match (this map is always clear). Switch weather to "Changes each match" to get rain.' })

  const weapons = count('Weapon pickup')
  add(weapons
    ? { id: 'weapons', state: 'done', text: `${weapons} weapon${weapons === 1 ? '' : 's'} to pick up` }
    : { id: 'weapons', state: 'suggested', text: 'Add weapons to pick up', fix: { kind: 'tool', tool: 'weapon' }, action: 'Place' })
  // The game skips a spawn while an enemy is within 5 m: weapons and drop-offs (where players gather) keep further off.
  const crowded = crowdedSpawns(p.markers)
  if (crowded.length) add({ id: 'crowded-spawns', state: 'suggested', text: crowdedText(p.markers, crowded), fix: { kind: 'marker', index: crowded[0].marker }, action: 'Show' })

  if (!modes.length) add({ id: 'modes', state: 'needed', text: 'Choose at least one game mode', fix: { kind: 'modes' }, action: 'Choose' })

  if (modes.some((m) => m.includes('Chains'))) {
    const drops = count('Chains drop-off')
    const close = bunched(p.markers.filter((m) => m.type === 'Chains drop-off'), DROP_GAP)
    const more = CHAINS_DROPS - drops
    add(more > 0
      ? { id: 'chains', state: 'suggested', text: `Big Ass Chains: place ${more} more drop-off${more === 1 ? '' : 's'} (the drop-off moves between ${CHAINS_DROPS} spots during the match)`, fix: { kind: 'tool', tool: 'spawn', spawn: 'Chains drop-off' }, action: 'Place' }
      : close
        ? { id: 'chains', state: 'suggested', text: `${close} chains drop-offs are within ${DROP_GAP / 2} m of another: spread them over the map, since the drop-off moves between them` }
        : { id: 'chains', state: 'done', text: `${drops} chains drop-offs` })
  }

  if (modes.includes('Protect Tha Pimp')) {
    const need = ([['Red team spawn', 'red team spawns'], ['Blue team spawn', 'blue team spawns'], ['Pimp entrance', "the pimp's escape point"]] as const)
      .filter(([type]) => !count(type))
    if (need.length) add({
      id: 'ptp', state: 'needed', text: `Protect Tha Pimp needs ${need.map(([, t]) => t).join(', ')}`,
      fix: { kind: 'tool', tool: 'spawn', spawn: need[0][0] }, action: 'Place',
    })
    else add({ id: 'ptp', state: 'done', text: "Protect Tha Pimp: teams and the pimp's escape point placed" })
  }

  items.push(...retailChecklist(modes, p.markers))

  // Markers left over from a game mode that was switched off: one click removes them.
  unusedModeMarkers(modes, p.markers).forEach((u, i) => add({
    id: 'unused-' + i, state: 'suggested', text: `${u.text} Remove ${u.count === 1 ? 'it' : `the ${u.count}`}?`,
    fix: { kind: 'removeMarkers', types: u.types, label: u.text }, action: 'Remove',
  }))

  // Decoy dummies: a lobby's worth at most, and each different look costs texture memory.
  const dummies = p.scene_items.filter(isDummy)
  const first = p.scene_items.findIndex(isDummy)
  if (dummies.length > MAX_DUMMIES) add({ id: 'dummies', state: 'needed', text: `${dummies.length} decoy dummies: ${MAX_DUMMIES} at most is about a lobby's worth of extra people for the game to draw. Delete ${dummies.length - MAX_DUMMIES}.`, fix: { kind: 'select', index: first }, action: 'Show' })
  const looks = new Set(dummies.map((it) => lookKey(dummyRefOf(it)!))).size
  if (looks > MANY_LOOKS) add({ id: 'dummy-looks', state: 'suggested', text: `${looks} different dummy looks add about ${looks} MB to the map's textures: give some the same look (copies share their pictures).`, fix: { kind: 'select', index: first }, action: 'Show' })

  const exits = count(PIMP_EXIT)
  if (exits) add({ id: 'exit', state: 'needed', text: `Erase ${exits === 1 ? 'the pimp exit marker' : `${exits} pimp exit markers`}: the game has no pimp exit`, fix: { kind: 'tool', tool: 'erase' }, action: 'Erase' })

  return items
}

export const blockers = (items: CheckItem[]) => items.filter((i) => i.state === 'needed')
