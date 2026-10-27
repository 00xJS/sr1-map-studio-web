// What this browser is connected to, in one place (the Connect page and every <NeedsSetup> prompt): the data pack
// (datapack.ts), the player's game folder (sr1char/folder.ts) and the game library read from it (gameObjects/
// client.ts), the game's maps folder for installing (install.ts) and an AI key (aiChat.ts). Each is read once when
// first asked for and again whenever something changes it here; nothing is uploaded.
import { create } from 'zustand'
import { dataPackStatus, type DataPackStatus } from './datapack'
import { rememberedGameFolder } from './sr1char/folder'
import { rememberedMapsFolder } from './install'
import { SETUP_CHANGED } from './setupEvents'

export type SetupItem = 'datapack' | 'gameFolder' | 'library' | 'mapsFolder' | 'aiKey'

export interface SetupState {
  loaded: boolean
  datapack: DataPackStatus | null
  /** The remembered game folder, and whether it can be read without asking. */
  gameFolder: { name: string; ready: boolean } | null
  mapsFolder: string | null
  aiKey: boolean
}

export const useSetupStore = create<SetupState>(() => ({ loaded: false, datapack: null, gameFolder: null, mapsFolder: null, aiKey: false }))

/** aiChat.ts's KEY_STORE (that module needs every prefab, so it isn't loaded for this). */
export const KEY_STORE = 'sr1ms.nvidiaKey'
const hasKey = () => { try { return !!localStorage.getItem(KEY_STORE) } catch { return false } }

let loading: Promise<void> | null = null
/** Reads everything again (after the player connects or forgets something). */
export function refreshSetup(): Promise<void> {
  return (loading = (async () => {
    const [datapack, gameFolder, mapsFolder] = await Promise.all([
      dataPackStatus().catch(() => null), rememberedGameFolder().catch(() => null), rememberedMapsFolder().catch(() => null),
    ])
    useSetupStore.setState({ loaded: true, datapack, gameFolder, mapsFolder, aiKey: hasKey() })
  })().finally(() => { loading = null }))
}

/** The setup, read the first time a page asks (and kept up to date by refreshSetup). */
export function useSetup<T>(pick: (s: SetupState) => T): T {
  if (!useSetupStore.getState().loaded && !loading) void refreshSetup()
  return useSetupStore(pick)
}

// Read again when something changes it elsewhere: another tab's AI key, a folder chosen or forgotten in the editor,
// or coming back to this tab (a key saved in the editor's AI panel, a folder's permission given or taken).
if (typeof window !== 'undefined') {
  const again = () => { if (useSetupStore.getState().loaded && !loading) void refreshSetup() }
  window.addEventListener('storage', (e) => { if (e.key === KEY_STORE) useSetupStore.setState({ aiKey: hasKey() }) })
  window.addEventListener(SETUP_CHANGED, again)
  window.addEventListener('focus', again)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') again() })
}

/** What each thing unlocks, for the Connect page's rows and the prompts. */
export const UNLOCKS: Record<SetupItem, { label: string; unlocks: string }> = {
  datapack: { label: 'Data pack', unlocks: 'Putting maps in your game: Install in game and Download. Building and walking maps works without it.' },
  gameFolder: { label: 'Game folder', unlocks: "Your own character when you walk a map, the game's sky and sounds, and reading your game library." },
  library: { label: 'Game library', unlocks: 'Game pieces: maps built from the real buildings and props in your game, and cutting a piece of Stilwater.' },
  mapsFolder: { label: 'Maps folder', unlocks: 'Install in game writes the map straight into SaintsReborn/dist/maps (Chrome and Edge). Without it, you download a zip.' },
  aiKey: { label: 'AI key', unlocks: 'A smarter plan in Describe it, and Ask AI in the editor. Without one, Describe it makes a quick guess from your words.' },
}
