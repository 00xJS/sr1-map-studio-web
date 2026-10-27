// "Walk it first" in the map catalogue: a sample built as a temporary map, opened in Play to run round before
// choosing it. It is saved like any map (Play opens maps from this browser) and noted here; once the player is back,
// it is either kept (they start it) or deleted. A temporary map that was changed and saved since (opened in the
// editor from Play and edited) counts as started and is kept.
import { db } from './db'

const KEY = 'sr1-walk-first'

export interface WalkFirst { id: string; name: string; sample: string; small: boolean; at: string }

const read = (): WalkFirst[] => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') as WalkFirst[] } catch { return [] } }
const write = (l: WalkFirst[]) => { try { l.length ? localStorage.setItem(KEY, JSON.stringify(l)) : localStorage.removeItem(KEY) } catch { /* private window */ } }

/** Notes a temporary map just saved (its `updated_at`, to tell whether it changes later). */
export function noteWalkFirst(w: WalkFirst) { write([...read().filter((x) => x.id !== w.id), w]) }

/** The temporary map the player last walked, if it is still waiting for an answer. */
export const lastWalkFirst = (): WalkFirst | null => read().at(-1) ?? null

/** The player starts it: it stays as one of their maps. */
export function keepWalkFirst(id: string) { write(read().filter((x) => x.id !== id)) }

/** Deletes one temporary map (unless it was changed since), or every one but `except`. One sweep at a time. */
let sweeping: Promise<void> = Promise.resolve()
export function sweepWalkFirst(only?: string, except?: string): Promise<void> {
  // Only the maps noted when it was asked for: one walked while it waits or runs is left alone.
  const asked = read()
  return (sweeping = sweeping.then(async () => {
    const done = new Set<string>()
    for (const w of asked) {
      if ((only && w.id !== only) || w.id === except) continue
      try {
        const rec = await db.getProject(w.id)
        if (rec && rec.updated_at === w.at) await db.deleteProject(w.id)
        done.add(w.id)
      } catch { /* kept for the next sweep */ }
    }
    // Read again: a map walked while this one ran stays noted.
    write(read().filter((x) => !done.has(x.id)))
  }))
}
