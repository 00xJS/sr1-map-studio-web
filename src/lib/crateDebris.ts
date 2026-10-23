// Smashing crates at export: hands the exporter the city chunk that holds the crate's debris effect, read from
// the player's own game (see gameFiles.ts and py/crate_debris.py). The exporter copies the effect out once per
// tab and deletes the big files; without them the crates break without debris, as before.
import { py } from './py'
import { crateDebrisFiles } from './gameFiles'
import { CRATE_PROFILE } from './mapFeatures'
import type { Project } from './project'

const DONOR = '/work/game/crate_debris'

export const usesCrates = (p: Project) => p.scene_items.some((it) => it.native_profile === CRATE_PROFILE)

/** The export spec's crate_debris_source, or nothing when no object is a smashing crate. Never asks for the folder. */
export async function crateDebrisSpec(project: Project, onLog: (t: string) => void): Promise<{ crate_debris_source?: Record<string, string> }> {
  if (!usesCrates(project)) return {}
  const [ready] = await py.exists([DONOR + '/effect.bin'])
  if (ready) return { crate_debris_source: { dir: DONOR } }
  let files: Awaited<ReturnType<typeof crateDebrisFiles>> = null
  try {
    onLog('Reading the crate effect from your game files…')
    files = await crateDebrisFiles(false)
  } catch (e) {
    onLog('Crates: your game files could not be read: ' + (e as Error).message)
  }
  if (!files) return { crate_debris_source: { dir: DONOR } }
  const chunk = `/work/game/${files.name}.bbchunk_xbox2`, peg = `/work/game/${files.name}.peg_xbox2`
  await py.writeFiles([{ path: chunk, data: copy(files.chunk) }, { path: peg, data: copy(files.peg) }])
  return { crate_debris_source: { dir: DONOR, chunk, peg } }
}

const copy = (b: Uint8Array) => b.buffer.byteLength === b.byteLength ? b.buffer as ArrayBuffer : b.slice().buffer as ArrayBuffer
