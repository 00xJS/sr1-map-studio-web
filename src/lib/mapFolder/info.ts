// What a map folder says before its chunk is read: its id, name, modes and weather, and its CTS files (main,
// Protect Tha Pimp, ambience). Quick, and free of the browser's storage: Node tests use it too.
import { AMBIENCE_OPTIONS } from '../mapFeatures'
import { chunkStems, fileAt, textOf, type MapSource } from './files'
import { mapIdentity, parseLevels, parseStrings, type MapIdentity } from './meta'
import { parseCts, type Cts } from './cts'

/** The exporter's limit on a map's id. */
export const MAX_BASE = 11

export interface MapInfo {
  src: MapSource
  identity: MapIdentity
  /** The chunk's name, and the files the editor reads. */
  stem: string
  chunk: Blob
  peg: Blob | null
  cts: { main?: Cts; ptp?: Cts; ambience?: Cts; mainName: string }
  /** A retail ambience the map includes by name (and the editor can include again). */
  ambience: string
  bytes: number
}

/** What the map folder says: its id, name, modes and CTS files. Quick: the chunk isn't read. */
export async function readMapInfo(src: MapSource): Promise<MapInfo> {
  const stems = chunkStems(src)
  if (!stems.length) throw new Error(`${src.name} has no map chunk (levels/<map>.bbchunk_xbox2).`)
  const xtbl = await textOf(src, 'levels/multiplayer_levels_extra.xtbl')
  const stringsFile = fileAt(src, 'levels/US_strings.txt') ?? [...src.files].find(([p]) => /^levels\/[a-z]{2}_strings\.txt$/i.test(p))?.[1]
  const strings = stringsFile ? parseStrings(new Uint8Array(await stringsFile.arrayBuffer())) : {}
  const identity = mapIdentity(xtbl ? parseLevels(xtbl) : [], strings, stems, src.name)
  const stem = stems.find((s) => s.toLowerCase() === identity.map.toLowerCase()) ?? stems[0]
  const chunk = fileAt(src, `levels/${stem}.bbchunk_xbox2`)!
  const peg = fileAt(src, `levels/${stem}.peg_xbox2`) ?? null
  const ctsText = async (name: string) => { const t = await textOf(src, `levels/${name}.cts`); return t === null ? undefined : parseCts(t) }
  const modes = identity.ctsByMode
  const mainName = modes['Gangsta Brawl'] ?? modes['Big Ass Chains'] ?? modes['Team Gangsta Brawl'] ?? modes['Team Big Ass Chains'] ?? stem
  const main = await ctsText(mainName)
  const ptp = await ctsText(modes['Protect Tha Pimp'] ?? `${stem}_ptp`)
  let ambience: Cts | undefined, retailAmbience = ''
  for (const inc of main?.includes ?? []) {
    const name = inc.replace(/\.cts$/i, '')
    const own = await ctsText(name)
    if (own) { ambience ??= own; continue }
    if (AMBIENCE_OPTIONS.some((o) => o.file.toLowerCase() === name.toLowerCase())) retailAmbience ||= AMBIENCE_OPTIONS.find((o) => o.file.toLowerCase() === name.toLowerCase())!.file
  }
  let bytes = 0
  for (const f of src.files.values()) bytes += f.size
  return { src, identity, stem, chunk, peg, cts: { main, ptp, ambience, mainName }, ambience: retailAmbience, bytes }
}

/** The map's id for the editor's exporter (at most 11 letters, digits or _): its own when it fits. */
export function baseNameFor(stem: string): string {
  const s = stem.toLowerCase().replace(/[^a-z0-9_]+/g, '_')
  if (s && s.length <= MAX_BASE) return s
  return s.replace(/^mpx?_/, '').slice(0, MAX_BASE).replace(/_+$/, '') || 'map'
}
