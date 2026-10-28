// Which editor overlays are open (history panel, saved versions, shortcut sheet, command palette).
import { create } from 'zustand'

type Overlay = 'history' | 'versions' | 'keys' | 'palette'
export const useOverlays = create<Record<Overlay, boolean>>(() => ({ history: false, versions: false, keys: false, palette: false }))
export const toggleOverlay = (k: Overlay, on?: boolean) => useOverlays.setState((s) => ({ [k]: on ?? !s[k] }))
