// "Install to game": write an export straight into SaintsReborn/dist/maps
// with the File System Access API (Chrome, Edge, Opera). The folder handle
// is remembered in IndexedDB; the browser asks again for permission when needed.
import { db } from './db'

const KEY = 'maps-folder'

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>
}

export const installSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window

export async function rememberedMapsFolder(): Promise<string | null> {
  const h = await db.getMeta<DirHandle>(KEY).catch(() => undefined)
  return h ? h.name : null
}

export async function forgetMapsFolder() { await db.setMeta(KEY, null) }

/** Accepts the maps folder itself, dist, or the SaintsReborn folder. */
async function resolveMaps(picked: DirHandle): Promise<DirHandle> {
  if (picked.name.toLowerCase() === 'maps') return picked
  const tryDir = async (h: DirHandle, name: string) => {
    try { return (await h.getDirectoryHandle(name)) as DirHandle } catch { return null }
  }
  const dist = picked.name.toLowerCase() === 'dist' ? picked : await tryDir(picked, 'dist')
  const maps = dist && (await tryDir(dist, 'maps'))
  if (maps) return maps
  throw new Error(`"${picked.name}" isn't the game's maps folder. Choose SaintsReborn/dist/maps (or the SaintsReborn folder).`)
}

async function permitted(h: DirHandle, ask: boolean): Promise<boolean> {
  if (!h.queryPermission) return true
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true
  return ask && !!h.requestPermission && (await h.requestPermission({ mode: 'readwrite' })) === 'granted'
}

/** The maps folder, asking the user to pick it the first time (or when choose is set). */
export async function mapsFolder(choose = false): Promise<DirHandle> {
  if (!installSupported()) throw new Error('This browser can\'t write to folders. Use Chrome or Edge, or download the zip.')
  const saved = choose ? null : await db.getMeta<DirHandle>(KEY).catch(() => null)
  if (saved && (await permitted(saved, true))) return saved
  const picked = await (window as any).showDirectoryPicker({ id: 'saintsreborn-maps', mode: 'readwrite' }) as DirHandle
  const maps = await resolveMaps(picked)
  await db.setMeta(KEY, maps)
  return maps
}

export async function mapFolderExists(maps: DirHandle, folder: string): Promise<boolean> {
  try { await maps.getDirectoryHandle(folder); return true } catch { return false }
}

/** Writes "<folder>/..." entries under the maps folder. Returns how many files were written. */
export async function writeMap(maps: DirHandle, entries: Record<string, Uint8Array>): Promise<number> {
  let n = 0
  for (const [path, data] of Object.entries(entries)) {
    const parts = path.split('/')
    let dir: FileSystemDirectoryHandle = maps
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true })
    const file = await dir.getFileHandle(parts[parts.length - 1], { create: true })
    const w = await file.createWritable()
    await w.write(data)
    await w.close()
    n++
  }
  return n
}
