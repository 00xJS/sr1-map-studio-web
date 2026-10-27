// Building what the Start a map dialog chose (SamplePicker.tsx): a catalogue sample by id, or a finished sample from
// the wizard, Describe it or City, with game pieces when the player builds with them. Once it is built, its spawns
// and weapons are checked on its real collision and moved or added where players can't use them (the editor's
// "Spawns and weapons" fix, spawnActions.ts), before the map opens; the catalogue and the home page do the same
// (sampleStart.ts).
import { buildFrom, buildSample, type Sample } from '../lib/samples'
import { gameSampleOf, gameSourceNow } from './BuildWith'
import { NeedGameFolder, connect } from '../lib/gameObjects/client'
import type { Project } from '../lib/project'
import type { PendingEdits } from '../lib/pendingEdits'

export interface StartChoice {
  /** A catalogue sample's id, or a finished sample. */
  sample: string | Sample
  /** The catalogue's small version. */
  small?: boolean
  /** Build with the player's game pieces (a catalogue sample is remade from them). */
  game?: boolean
  /** Edits to make once it is open (Describe it). */
  edits?: PendingEdits
}

export async function buildChoice(c: StartChoice, onProgress: (t: string) => void): Promise<{ project: Project; job?: PendingEdits }> {
  let id = c.sample
  // A catalogue sample with game pieces: remade from the player's game models.
  if (typeof id === 'string' && c.game) id = gameSampleOf(id, !!c.small, await gameSourceNow()) ?? id
  const game = typeof id !== 'string' && id.parts.some((p) => p.game)
  // Placing game models needs the game files open (the browser may ask for the folder once).
  if (game) {
    try { await connect(true) } catch (e) { throw e instanceof NeedGameFolder ? new Error('Choose your Saints Reborn folder so the models can come in from your game.') : e }
  }
  // A map built from game models gets the map's checks once it is open (its stairs are the game's).
  const job = game && typeof id !== 'string' ? { ...(c.edits ?? { actions: [], label: 'Game pieces' }), checks: true, ...(id.problems?.length ? { summary: id.problems } : {}) } : c.edits
  const project = await (typeof id === 'string' ? buildSample(id, onProgress, { compact: c.small }) : buildFrom(id, onProgress))
  await fixSpawnsBeforeOpen(project, !!job?.checks, onProgress)
  return { project, job }
}

/**
 * Every map started from a sample or the wizard, wherever it was started (this dialog, the catalogue, the home page):
 * spawns and weapons where players can't use them are moved, and missing ones added, before it opens. A map whose
 * checks run when it opens (`checks`, game pieces) is planned with the invisible stair ramps those checks add, so
 * floors up tall stairs count as reachable.
 */
export async function fixSpawnsBeforeOpen(project: Project, checks: boolean, onProgress?: (t: string) => void) {
  onProgress?.('Checking the spawns and weapons…')
  try {
    const { applySpawnFix, planSpawnFix } = await import('../editor/spawnActions')
    applySpawnFix(project, await planSpawnFix(project, { ramps: checks }))
  } catch { /* the map opens as built; the editor's health panel has the same fix */ }
}
