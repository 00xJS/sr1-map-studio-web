// "Install to game": write an export straight into SaintsReborn/dist/maps
// with the File System Access API (Chrome, Edge, Opera). The folder handle
// is remembered in IndexedDB; the browser asks again for permission when needed.
import { db } from './db'
import { readExportNote } from './playtest'
import { SETUP_CHANGED } from './setupEvents'

const KEY = 'maps-folder'
/** Tells the Connect page and its prompts (setup.ts) that the remembered folder changed. */
const changed = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(SETUP_CHANGED)) }

type DirHandle = FileSystemDirectoryHandle & {
  values?(): AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>
}

export const installSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window

export async function rememberedMapsFolder(): Promise<string | null> {
  const h = await db.getMeta<DirHandle>(KEY).catch(() => undefined)
  return h ? h.name : null
}

export async function forgetMapsFolder() { await db.setMeta(KEY, null); changed() }

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
  changed()
  return maps
}

export async function mapFolderExists(maps: DirHandle, folder: string): Promise<boolean> {
  try { await maps.getDirectoryHandle(folder); return true } catch { return false }
}

/** The project whose export is installed in maps/<folder>, from its MAP_STUDIO_EXPORT.txt (none for older exports and other maps). */
export async function installedProjectId(maps: DirHandle, folder: string): Promise<string | undefined> {
  try {
    const file = await (await (await maps.getDirectoryHandle(folder)).getFileHandle('MAP_STUDIO_EXPORT.txt')).getFile()
    return readExportNote(await file.text()).projectId
  } catch { return undefined }
}

/**
 * Whether installing over maps/<folder> needs the "Replace installed map?" question: only when the folder is there
 * and isn't this project's own last install (the companion mod then reloads that one in the match by itself).
 */
export async function replaceNeedsAsking(maps: DirHandle, folder: string, projectId: string): Promise<boolean> {
  if (!(await mapFolderExists(maps, folder))) return false
  return (await installedProjectId(maps, folder)) !== projectId
}

/** An early surface registration pair (py/surface_registration.py): named from its contents, so each export makes a new one. */
export const SURFACE_PAIR = /^sf_[0-9a-f]{12}\.(bbchunk|peg)_xbox2$/i

/**
 * Writes "<folder>/..." entries under the maps folder. Returns how many files were written.
 * Surface registration pairs from earlier exports of this map (about 50 MB each) are removed from its levels folder.
 */
export async function writeMap(maps: DirHandle, entries: Record<string, Uint8Array>): Promise<number> {
  let n = 0
  const levels = new Map<FileSystemDirectoryHandle, Set<string>>()
  for (const [path, data] of Object.entries(entries)) {
    const parts = path.split('/')
    let dir: FileSystemDirectoryHandle = maps
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true })
    const name = parts[parts.length - 1]
    const file = await dir.getFileHandle(name, { create: true })
    const w = await file.createWritable()
    await w.write(data)
    await w.close()
    n++
    if (parts.length > 1 && parts[parts.length - 2] === 'levels') levels.set(dir, (levels.get(dir) ?? new Set()).add(name.toLowerCase()))
  }
  for (const [dir, written] of levels) {
    if (![...written].some((f) => SURFACE_PAIR.test(f))) continue
    const stale: string[] = []
    for await (const h of (dir as DirHandle).values?.() ?? []) if (h.kind === 'file' && SURFACE_PAIR.test(h.name) && !written.has(h.name.toLowerCase())) stale.push(h.name)
    for (const f of stale) await dir.removeEntry(f).catch(() => {})
  }
  return n
}
