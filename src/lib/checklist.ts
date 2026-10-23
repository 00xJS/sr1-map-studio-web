// "Ready to play" checklist: what a map still needs before it can go into the
// game ('needed' blocks Play), and what would make it better ('suggested').
import { PIMP_EXIT, SPAWN_TYPES, isCustomNative, isGlass, type Project } from './project'

export type Fix =
  | { kind: 'tool'; tool: string; spawn?: string }
  | { kind: 'samples' }
  | { kind: 'modes' }
  | { kind: 'setup' }
  | { kind: 'select'; index: number }

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
  else if (spawns < 4) add({ id: 'spawns', state: 'suggested', text: `Only ${spawns} spawn${spawns === 1 ? '' : 's'}: add a few more (8 is good)`, fix: spawnFix, action: 'Place' })
  else add({ id: 'spawns', state: 'done', text: `${spawns} spawns` })

  const weapons = count('Weapon pickup')
  add(weapons
    ? { id: 'weapons', state: 'done', text: `${weapons} weapon${weapons === 1 ? '' : 's'} to pick up` }
    : { id: 'weapons', state: 'suggested', text: 'Add weapons to pick up', fix: { kind: 'tool', tool: 'weapon' }, action: 'Place' })

  if (!modes.length) add({ id: 'modes', state: 'needed', text: 'Choose at least one game mode', fix: { kind: 'modes' }, action: 'Choose' })

  if (modes.some((m) => m.includes('Chains'))) {
    const drops = count('Chains drop-off')
    add(drops >= 2
      ? { id: 'chains', state: 'done', text: `${drops} chains drop-offs` }
      : { id: 'chains', state: 'suggested', text: `Big Ass Chains: place ${drops ? '1 more drop-off' : '2 drop-offs'}`, fix: { kind: 'tool', tool: 'spawn', spawn: 'Chains drop-off' }, action: 'Place' })
  }

  if (modes.includes('Protect Tha Pimp')) {
    const need = ([['Red team spawn', 'red team spawns'], ['Blue team spawn', 'blue team spawns'], ['Pimp entrance', 'a pimp entrance']] as const)
      .filter(([type]) => !count(type))
    if (need.length) add({
      id: 'ptp', state: 'needed', text: `Protect Tha Pimp needs ${need.map(([, t]) => t).join(', ')}`,
      fix: { kind: 'tool', tool: 'spawn', spawn: need[0][0] }, action: 'Place',
    })
    else add({ id: 'ptp', state: 'done', text: 'Protect Tha Pimp: teams and pimp placed' })
  }

  const exits = count(PIMP_EXIT)
  if (exits) add({ id: 'exit', state: 'needed', text: `Erase ${exits === 1 ? 'the pimp exit marker' : `${exits} pimp exit markers`}: the game has no pimp exit`, fix: { kind: 'tool', tool: 'erase' }, action: 'Erase' })

  return items
}

export const blockers = (items: CheckItem[]) => items.filter((i) => i.state === 'needed')
