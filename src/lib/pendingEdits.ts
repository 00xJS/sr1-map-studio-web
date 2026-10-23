// Edits waiting for a map to open: when the AI makes a new map (from the home
// page or the chat), the map is built and saved first, and its extra edits
// ("make it rain", "a tower in the middle") run once the editor has it loaded.
// Kept in session storage too, so a page reload on the way doesn't lose them.
import type { AiAction } from './aiChat'

export interface PendingEdits {
  actions: AiAction[]
  /** The undo step's name. */
  label: string
  /** Open the AI chat once they're done (the request came from it). */
  openChat?: boolean
}

const pending = new Map<string, PendingEdits>()
const listeners = new Set<() => void>()
const STORE = 'sr1ms.pendingEdits.'

export function queueEdits(projectId: string, job: PendingEdits) {
  pending.set(projectId, job)
  try { sessionStorage.setItem(STORE + projectId, JSON.stringify(job)) } catch { /* kept in memory only */ }
  listeners.forEach((f) => f())
}

/** The edits waiting for this map, removed from the queue. */
export function takeEdits(projectId: string): PendingEdits | null {
  let job = pending.get(projectId) ?? null
  try {
    if (!job) job = JSON.parse(sessionStorage.getItem(STORE + projectId) || 'null')
    sessionStorage.removeItem(STORE + projectId)
  } catch { /* nothing stored */ }
  pending.delete(projectId)
  return job && Array.isArray(job.actions) ? job : null
}

export function onQueued(f: () => void): () => void {
  listeners.add(f)
  return () => { listeners.delete(f) }
}
