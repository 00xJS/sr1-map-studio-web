// What stops Install in game (or the zip) before the build starts, beyond the "Ready to play" checklist: a file name
// too long for the game, data-pack files the chosen settings build on, and game modes missing markers they need (the
// old Export panel's checks, which the exporter would otherwise fail on). A data pack without the map template, and
// no game mode at all, are the checklist's own lines.
import { maxMapName, type Marker, type ProjectSettings } from '../lib/project'
import { hasGroup, type DataPackStatus } from '../lib/datapack'
import { checkModes } from '../lib/levels'

/** A map file name as the exporter writes it. */
export const sanitizeName = (s: string) => s.trim().replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()

/** Names Install in game replaces with one of its own (empty, the default, or with characters files can't have). */
export const autoNamed = (base: string) => !base.trim() || base.trim() === 'mymap' || /[^a-zA-Z0-9_]/.test(base.trim())

/** Why the map can't be built yet; empty when it can. `pack` is null while its status loads. */
export function exportBlocks(s: Pick<ProjectSettings, 'base_name' | 'surface_preload' | 'native_sky' | 'modes'>, markers: Marker[], pack: DataPackStatus | null): string[] {
  const out: string[] = []
  const name = sanitizeName(s.base_name), max = maxMapName(s)
  if (!autoNamed(s.base_name) && name.length > max) {
    out.push(`The file name "${name}" is ${name.length} characters: ${s.surface_preload ? 'with early surface registration, ' : ''}the game takes ${max} at most. Shorten it in Ship → File name.`)
  }
  if (pack && s.surface_preload && !(hasGroup(pack, 'surface') && hasGroup(pack, 'sky'))) out.push('Early surface registration needs the surface template and the native sky presets from your data pack.')
  else if (pack && s.native_sky && !hasGroup(pack, 'sky')) out.push('The native sky you chose needs the native sky presets from your data pack.')
  if (s.modes.length) out.push(...checkModes(s, markers).errors)
  return out
}
