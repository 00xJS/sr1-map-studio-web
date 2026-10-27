import { db, requestPersistence } from '../lib/db'
import { buildFrom, buildSample } from '../lib/samples'
import { queueEdits } from '../lib/pendingEdits'
import { NeedGameFolder, connect } from '../lib/gameObjects/client'

/**
 * Builds a sample map into a new project saved in this browser; returns its id. With game pieces chosen (the Start
 * a map dialog's Build with, remembered in this browser) and the game library read, it is built from the player's
 * own game models, and the map's checks run once it is open.
 */
export async function startFromSample(id: string, compact: boolean, onProgress?: (t: string) => void): Promise<string> {
  const { buildsWithGame, gameSourceNow, gameSampleOf } = await import('./BuildWith')
  const game = buildsWithGame() ? gameSampleOf(id, compact, await gameSourceNow()) : null
  if (game) {
    try { await connect(true) } catch (e) { throw e instanceof NeedGameFolder ? new Error('Choose your Saints Reborn folder so the models can come in from your game.') : e }
  }
  const p = game ? await buildFrom(game, onProgress) : await buildSample(id, onProgress, { compact })
  await db.putProject({ id: p.id, name: p.name, updated_at: p.updated_at, project: p })
  if (game) queueEdits(p.id, { actions: [], label: 'Game pieces', checks: true })
  void requestPersistence()
  return p.id
}
