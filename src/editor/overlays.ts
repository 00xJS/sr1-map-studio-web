// Which editor overlays are open (history panel, saved versions, shortcut sheet).
import { create } from 'zustand'

export const useOverlays = create<{ history: boolean; versions: boolean; keys: boolean }>(() => ({ history: false, versions: false, keys: false }))
export const toggleOverlay = (k: 'history' | 'versions' | 'keys', on?: boolean) => useOverlays.setState((s) => ({ [k]: on ?? !s[k] }))
