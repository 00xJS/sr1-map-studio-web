// Which map folders the "Open a game map" dialog is showing (src/pages/OpenMapDialog.tsx, mounted once in App),
// so Home, the editor's Assets panel and a drop anywhere can raise it.
import { create } from 'zustand'
import { toast } from '../../ui'
import { fromDrop, fromFiles, type MapSource } from './files'

export const useOpenMap = create<{ sources: MapSource[] | null }>(() => ({ sources: null }))

export const closeOpenMap = () => useOpenMap.setState({ sources: null })

const NONE = 'No Saints Row map in that: pick a map folder from SaintsReborn/dist/maps (the one with bundle_info.xtbl and levels/ in it), or a zip of one.'

export function showMaps(sources: MapSource[]) {
  if (!sources.length) { toast(NONE, 'bad', 8000); return }
  useOpenMap.setState({ sources })
}

/** Files from a folder pick or a zip pick. */
export async function openMapFiles(files: File[]) { showMaps(await fromFiles(files)) }

/** A drop that holds a map folder or zip. */
export async function openMapDrop(dt: DataTransfer) { showMaps(await fromDrop(dt)) }

// Development only: `await __sr1OpenMap.useDevServer('Dust')` opens a map installed in the local game (scripts/devMaps.ts).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as any).__sr1OpenMap = {
    async list() { return (await fetch('/__sr1dev/maps')).json() },
    async useDevServer(name: string) {
      const listing = await fetch('/__sr1dev/maps/' + encodeURIComponent(name))
      if (!listing.ok) throw new Error('No map folder ' + name + ' (start the dev server with SR1_PACKFILES or SR1_MAPS set)')
      const sizes = await listing.json() as Record<string, number>
      const files = new Map<string, Blob>()
      for (const p of Object.keys(sizes)) files.set(p, await (await fetch(`/__sr1dev/maps/${encodeURIComponent(name)}/${p.split('/').map(encodeURIComponent).join('/')}`)).blob())
      showMaps([{ name, files }])
      return Object.keys(sizes)
    },
    state: () => useOpenMap.getState(),
  }
}
