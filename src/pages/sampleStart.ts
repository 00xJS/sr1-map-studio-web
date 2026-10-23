import { db, requestPersistence } from '../lib/db'
import { buildSample } from '../lib/samples'

/** Builds a sample map into a new project saved in this browser; returns its id. */
export async function startFromSample(id: string, compact: boolean, onProgress?: (t: string) => void): Promise<string> {
  const p = await buildSample(id, onProgress, { compact })
  await db.putProject({ id: p.id, name: p.name, updated_at: p.updated_at, project: p })
  void requestPersistence()
  return p.id
}
