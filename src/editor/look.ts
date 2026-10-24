// The viewer's lighting choices (game or bright editor light, time of day and weather, shadows, fog, the
// SRMaxDetail look), kept in this browser, and the hook that applies them to a viewer. Times other than noon
// need the player's game files (lib/gameLightFiles.ts); without them the view stays at noon.
import { create } from 'zustand'
import { NOON, PRESETS, lightAt, maxDetail, type GameLight } from '../lib/gameLight'
import { loadLightTables } from '../lib/gameLightFiles'
import type { Viewer } from './Viewer'

export interface LookState {
  mode: 'game' | 'editor'
  preset: string
  shadows: boolean
  fogWhileEditing: boolean
  maxDetail: boolean
  /** The last time-of-day choice couldn't be shown: the game files aren't open. */
  needsFiles: boolean
}

const KEY = 'sr1ms.look'
const saved = (): Partial<LookState> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } }

export const useLook = create<LookState>(() => ({ mode: 'game', preset: 'noon', shadows: true, fogWhileEditing: false, maxDetail: false, ...saved(), needsFiles: false }))

/** Changes the lighting choices and remembers them. */
export function setLook(patch: Partial<LookState>) {
  useLook.setState(patch)
  const { needsFiles: _n, ...keep } = useLook.getState()
  try { localStorage.setItem(KEY, JSON.stringify(keep)) } catch { /* private window */ }
}

/** The light for a preset: noon is built in; the others come from the player's game files. */
async function lightFor(preset: string, ask: boolean): Promise<GameLight | null> {
  const p = PRESETS.find((x) => x.key === preset)
  if (!p || p.key === 'noon') return NOON
  const t = await loadLightTables(ask).catch(() => null)
  return t ? { ...lightAt(t, p.time, p.weather), name: p.label } : null
}

/** Keeps a viewer lit as the choices say; returns the unsubscribe. */
export function attachLook(viewer: Viewer): () => void {
  let n = 0
  const apply = async () => {
    const s = useLook.getState(), my = ++n
    let light = await lightFor(s.preset, false)
    if (my !== n) return
    if (!light) { light = NOON; if (!s.needsFiles) useLook.setState({ needsFiles: true }) }
    else if (s.needsFiles) useLook.setState({ needsFiles: false })
    viewer.setLook({ mode: s.mode, light: s.maxDetail ? maxDetail(light) : light, shadows: s.shadows, fogWhileEditing: s.fogWhileEditing })
  }
  void apply()
  return useLook.subscribe((s, prev) => { if (s.mode !== prev.mode || s.preset !== prev.preset || s.shadows !== prev.shadows || s.fogWhileEditing !== prev.fogWhileEditing || s.maxDetail !== prev.maxDetail) void apply() })
}

/** Picks a time of day; asks for the game folder when it needs it. */
export async function choosePreset(key: string) {
  if (key !== 'noon') await loadLightTables(true).catch(() => null)
  setLook({ preset: key, mode: 'game' })
}
