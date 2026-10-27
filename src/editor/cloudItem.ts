// The cloud sync item in the editor's ⋯ menu, filled in by CloudSync (CloudButton.tsx, loaded only with accounts on).
import { create } from 'zustand'

export interface CloudItem { label: string; tone: '' | 'ok' | 'warn'; title: string; busy: boolean; run: () => void }
export const useCloudItem = create<{ item: CloudItem | null }>(() => ({ item: null }))
