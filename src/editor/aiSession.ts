// The AI chat's conversation, kept outside the panel so it survives closing
// the panel and opening a map the chat just made.
import { create } from 'zustand'
import type { ChatMessage } from '../lib/aiChat'
import type { Review } from '../lib/aiReview'

export interface Turn {
  id: number
  role: 'user' | 'assistant'
  text: string
  note?: string
  undoLabel?: string
  error?: boolean
  /** Still arriving. */
  pending?: boolean
  /** What a thinking model has thought so far (shown while it works). */
  thinking?: string
  review?: Review
  /** Labels of the review fixes already applied. */
  applied?: string[]
}

interface ChatState {
  turns: Turn[]
  /** What the model has been told so far (the last few exchanges go with each message). */
  history: ChatMessage[]
  add(t: Omit<Turn, 'id'>): number
  patch(id: number, p: Partial<Turn>): void
  clear(): void
}

let next = 1
export const useChat = create<ChatState>((set) => ({
  turns: [],
  history: [],
  add: (t) => { const id = next++; set((s) => ({ turns: [...s.turns, { ...t, id }] })); return id },
  patch: (id, p) => set((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, ...p } : t)) })),
  clear: () => set({ turns: [], history: [] }),
}))
