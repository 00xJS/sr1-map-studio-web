// Edits waiting for a map to open: when the AI makes a new map (from the home
// page or the chat), the map is built and saved first, and its extra edits
// ("make it rain", "a tower in the middle") run once the editor has it loaded.
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

export function queueEdits(projectId: string, job: PendingEdits) {
  pending.set(projectId, job)
  listeners.forEach((f) => f())
}

/** The edits waiting for this map, removed from the queue. */
export function takeEdits(projectId: string): PendingEdits | null {
  const job = pending.get(projectId) ?? null
  pending.delete(projectId)
  return job
}

export function onQueued(f: () => void): () => void {
  listeners.add(f)
  return () => { listeners.delete(f) }
}
