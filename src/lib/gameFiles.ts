// Things read from the player's own Saints Row files, in the browser, when they are needed: the names of the
// game's ambience sounds (for sound zones) and the wooden crate's debris effect (for smashing crates). Packfiles
// are read by byte range (File.slice); nothing read here is uploaded, published or stored: the sound names live
// in memory for this tab, and the crate files only go to the exporter's in-memory file system.
import { gameFolderFiles, folderPickerSupported } from './sr1char/folder'
import { openVpp } from './sr1char/vpp'

export const FOLEY_PACK = 'real_foley_streaming.vpp_xbox2'
export const CITY_PACK = 'sr_city_stream.vpp_xbox2'
const AMBIENTS = 'Ambients.xsb'
/** City chunks holding the crate effect, the first with every picture it names. */
const CRATE_CHUNKS = ['sr_chunk12', 'sr_chunk14_lopez']

/** Packfiles the user chose one by one (browsers without the folder picker). */
const picked = new Map<string, File>()
export function addPickedFiles(files: Iterable<File>) {
  for (const f of files) picked.set(f.name.toLowerCase(), f)
}

/** A packfile from the user's game folder, or null when it can't be read without asking (or `ask` was refused). */
export async function gamePack(name: string, ask: boolean): Promise<File | null> {
  const hit = picked.get(name)
  if (hit) return hit
  const found = await gameFolderFiles([name], ask)
  return found?.get(name) ?? null
}

export const canPickFolder = folderPickerSupported

// ---------------- ambience sound names ----------------

/**
 * Sound names in an XACT sound bank (.xsb, big-endian, "KBDS"): the number of cues is a u16 at 0x12 and the
 * offset of their NUL-terminated names a u32 at 0x22. Checked by reading exactly that many plain names (letters,
 * digits, underscores; a few have spaces).
 */
export function parseCueNames(bytes: Uint8Array): string[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 0x30 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'KBDS') throw new Error('Not a sound bank')
  const count = dv.getUint16(0x12)
  for (const at of [0x22, 0x26]) {
    const names = readNames(bytes, dv.getUint32(at), count)
    if (names) return names
  }
  throw new Error('Sound names not found in the sound bank')
}

function readNames(bytes: Uint8Array, start: number, count: number): string[] | null {
  if (!count || start >= bytes.length) return null
  const out: string[] = []
  let at = start
  while (out.length < count) {
    const end = bytes.indexOf(0, at)
    if (end < 0 || end === at || end - at > 60) return null
    const s = String.fromCharCode(...bytes.subarray(at, end))
    if (!/^[A-Za-z0-9_][A-Za-z0-9_ ]*$/.test(s)) return null
    out.push(s)
    at = end + 1
  }
  return out
}

let cues: Promise<string[]> | null = null

/** The game's ambience sound names, sorted. Read once per tab. Null when the game files aren't available. */
export async function loadSoundNames(ask: boolean): Promise<string[] | null> {
  if (cues) return cues
  const file = await gamePack(FOLEY_PACK, ask)
  if (!file) return null
  const p = (async () => {
    const vpp = await openVpp(file, FOLEY_PACK)
    if (!vpp.has(AMBIENTS)) throw new Error(`${AMBIENTS} isn't in ${FOLEY_PACK}`)
    return [...new Set(parseCueNames(await vpp.read(AMBIENTS)))].sort()
  })()
  cues = p
  p.catch(() => { if (cues === p) cues = null })
  return p
}

/** The names already read this tab, without reading anything. */
export const soundNamesLoaded = () => cues

/** Words for a sound name: AMB_EXT_BIRDS_2 -> "ext birds 2". */
export const soundLabel = (cue: string) => cue.replace(/^AMB_/i, '').replace(/_/g, ' ').toLowerCase()

// ---------------- crate debris ----------------

/** The pictures and effect of the wooden crate live in a city chunk; these are that chunk's two files. */
export async function crateDebrisFiles(ask: boolean): Promise<{ chunk: Uint8Array; peg: Uint8Array; name: string } | null> {
  const file = await gamePack(CITY_PACK, ask)
  if (!file) return null
  const vpp = await openVpp(file, CITY_PACK)
  for (const stem of CRATE_CHUNKS) {
    const chunk = `${stem}.bbchunk_xbox2`, peg = `${stem}.peg_xbox2`
    if (vpp.has(chunk) && vpp.has(peg)) return { chunk: await vpp.read(chunk), peg: await vpp.read(peg), name: stem }
  }
  return null
}
