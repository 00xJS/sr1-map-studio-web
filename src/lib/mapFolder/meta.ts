// What a map folder says about itself, read the way the game reads it: bundle_info.xtbl marks it as a level pack,
// levels/multiplayer_levels_extra.xtbl lists each game mode the map is offered in (with the CTS file it loads and
// its flags), and levels/<lang>_strings.txt holds the map's name in the menus. The same layout our exporter writes
// (exporter.ts packageMetadata) and the community maps in SaintsReborn/dist/maps use.
import { GAME_MODES, type GameMode } from '../project'

export interface MapLevel {
  name: string
  mode: string
  /** The chunk's name (levels/<map>.bbchunk_xbox2). */
  map: string
  /** The CTS file it loads, without .cts. */
  cts: string
  /** String key of the map's name (MULTI_LEVEL_...). */
  display: string
  id: number
  flags: string[]
}

const tag = (block: string, name: string) => block.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim() ?? ''

/** The MultiplayerLevel entries of a level list. */
export function parseLevels(xml: string): MapLevel[] {
  const out: MapLevel[] = []
  for (const m of xml.matchAll(/<MultiplayerLevel>([\s\S]*?)<\/MultiplayerLevel>/g)) {
    const b = m[1]
    const flags = [...(b.match(/<Flags>([\s\S]*?)<\/Flags>/)?.[1] ?? '').matchAll(/<Flag>([^<]*)<\/Flag>/g)].map((f) => f[1].trim())
    out.push({ name: tag(b, 'Name'), mode: tag(b, 'Mode'), map: tag(b, 'Map'), cts: tag(b, 'CTSFile'), display: tag(b, 'DisplayName'), id: Number(tag(b, 'ID')) || 0, flags })
  }
  return out
}

/** bundle_info.xtbl marks a level pack (BUNDLE_TYPE_LEVEL). */
export const isLevelBundle = (xml: string) => /<Flag>\s*BUNDLE_TYPE_LEVEL\s*<\/Flag>/.test(xml)

/** Text of a strings file: UTF-16 (with its byte-order mark, as the game's are) or plain 8-bit. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes.subarray(3))
  return new TextDecoder('latin1').decode(bytes)
}

/** The KEY=value lines of a strings file ("BINTEXT", the entries, then their count). */
export function parseStrings(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of decodeText(bytes).split(/\r?\n/)) {
    const at = line.indexOf('=')
    if (at > 0) out[line.slice(0, at).trim().toUpperCase()] = line.slice(at + 1).trim()
  }
  return out
}

export interface MapIdentity {
  /** The chunk's name: the map's id in the game. */
  map: string
  /** Its name in the menus (from the strings file), or one made from the folder name. */
  displayName: string
  /** Help text, when the map has one. */
  description: string
  modes: GameMode[]
  /** Modes listed that the editor doesn't know (kept out of the project). */
  otherModes: string[]
  alwaysClearWeather: boolean
  /** CTS file per mode (without .cts). */
  ctsByMode: Partial<Record<GameMode, string>>
  levels: MapLevel[]
}

/** Who the map is, from its level list and strings; `fallback` names it when they don't (the folder name). */
export function mapIdentity(levels: MapLevel[], strings: Record<string, string>, chunks: string[], fallback: string): MapIdentity {
  const known = levels.filter((l) => chunks.some((c) => c.toLowerCase() === l.map.toLowerCase()))
  const map = known[0]?.map ?? chunks[0] ?? ''
  const mine = known.filter((l) => l.map.toLowerCase() === map.toLowerCase())
  const modes: GameMode[] = [], otherModes: string[] = [], ctsByMode: MapIdentity['ctsByMode'] = {}
  for (const l of mine) {
    const mode = GAME_MODES.find((g) => g.toLowerCase() === l.mode.toLowerCase())
    if (!mode) { if (!otherModes.includes(l.mode)) otherModes.push(l.mode); continue }
    if (!modes.includes(mode)) { modes.push(mode); ctsByMode[mode] = l.cts }
  }
  const key = (mine[0]?.display || `MULTI_LEVEL_${map}`).toUpperCase()
  const displayName = strings[key] || fallback || map
  const description = strings[`HELP_TEXT_${map.toUpperCase()}_LEVEL`] ?? ''
  // A map offered without the flag rolls its weather; with no level list at all, the editor's default.
  const alwaysClearWeather = mine.length ? mine.every((l) => l.flags.includes('AlwaysClearWeather')) : true
  return { map, displayName, description, modes, otherModes, alwaysClearWeather, ctsByMode, levels: mine }
}
