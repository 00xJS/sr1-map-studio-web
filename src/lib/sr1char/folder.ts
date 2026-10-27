// Ported from SR1-Creator (github.com/00xJS/SR1-Creator)
// The user's Saints Reborn folder: find the four packfiles the player needs in it, read them by byte range in the
// browser and build the character. Any of the Saints Reborn folder, dist, game or dist/game/packfiles works. Nothing
// is uploaded and nothing game-derived is stored: only the folder handle is remembered (IndexedDB, Chrome and Edge),
// so the next walk can open it again, and the built character is kept in memory for this tab.
import { db } from '../db'
import { openVpp, type Vpp } from './vpp'
import { SETUP_CHANGED } from '../setupEvents'
// The model builder needs three.js: loaded when a player is built, not with every page that reads game files.
import type { PlayerModel } from './player'

/** In the order entries are looked up: misc2 holds the meshes and textures, morph_stream the face and body morphs,
 *  preload the skeleton; cmesh_stream is the fallback for anything missing from misc2. */
export const PACKFILES = ['misc2.vpp_xbox2', 'morph_stream.vpp_xbox2', 'preload.vpp_xbox2', 'cmesh_stream.vpp_xbox2']
const SKIP_DIRS = new Set(['build', '.git', 'node_modules', 'saves', 'screenshots', 'logs', 'shader_cache', 'cache', 'mods', 'maps', 'config', 'core'])
const DIR_ORDER = ['packfiles', 'game', 'dist']
const dirRank = (name: string) => { const i = DIR_ORDER.indexOf(name.toLowerCase()); return i < 0 ? DIR_ORDER.length : i }
const KEY = 'sr1-game-folder'
/** Tells the Connect page and its prompts (lib/setup.ts) that the remembered folder changed. */
const changed = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(SETUP_CHANGED)) }

type Handle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>
  queryPermission?(o: { mode: 'read' }): Promise<PermissionState>
  requestPermission?(o: { mode: 'read' }): Promise<PermissionState>
}

export const folderPickerSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window

/** Searches a folder for the packfiles (`wanted`, lower case), packfiles folders first, stopping once all are found. */
async function findInHandle(dir: Handle, found = new Map<string, File>(), depth = 0, wanted = PACKFILES): Promise<Map<string, File>> {
  const subdirs: Handle[] = []
  for await (const h of dir.values()) {
    const n = h.name.toLowerCase()
    if (h.kind === 'file') { if (wanted.includes(n) && !found.has(n)) found.set(n, await (h as FileSystemFileHandle).getFile()) }
    else if (!SKIP_DIRS.has(n)) subdirs.push(h as Handle)
  }
  if (depth < 5) for (const d of subdirs.sort((a, b) => dirRank(a.name) - dirRank(b.name))) {
    if (found.size === wanted.length) break
    await findInHandle(d, found, depth + 1, wanted)
  }
  return found
}

/** Files from an `<input webkitdirectory>`: keep only the packfiles, by name. */
export function pickPackfiles(files: Iterable<File>): Map<string, File> {
  const found = new Map<string, File>()
  for (const f of files) { const n = f.name.toLowerCase(); if (PACKFILES.includes(n) && !found.has(n)) found.set(n, f) }
  return found
}

let built: { key: string; model: Promise<PlayerModel> } | null = null

/** The character built this session, if any. */
export const currentPlayer = () => built?.model ?? null

/** Opens the packfiles (directories only) and builds the player. Built once per tab. */
export function loadPlayer(found: Map<string, Blob>, where: string): Promise<PlayerModel> {
  const key = where + '|' + [...found.keys()].sort().join(',')
  if (built && built.key === key) return built.model
  const model = (async () => {
    if (!found.has('misc2.vpp_xbox2')) {
      throw new Error(`misc2.vpp_xbox2 isn't in ${where}. Choose the Saints Reborn folder (or dist\\game\\packfiles inside it).`)
    }
    const packs: Vpp[] = []
    for (const n of PACKFILES) { const f = found.get(n); if (f) packs.push(await openVpp(f, n)) }
    const { buildPlayer } = await import('./player')
    return buildPlayer(packs)
  })()
  built = { key, model }
  model.catch(() => { if (built?.model === model) built = null })
  return model
}

async function permitted(h: Handle, ask: boolean): Promise<boolean> {
  if (!h.queryPermission) return true
  if ((await h.queryPermission({ mode: 'read' })) === 'granted') return true
  return ask && !!h.requestPermission && (await h.requestPermission({ mode: 'read' })) === 'granted'
}

/** The remembered game folder's name, and whether it can be read without asking. */
export async function rememberedGameFolder(): Promise<{ name: string; ready: boolean } | null> {
  const h = await db.getMeta<Handle>(KEY).catch(() => undefined)
  if (!h) return null
  return { name: h.name, ready: await permitted(h, false).catch(() => false) }
}

export async function forgetGameFolder() { walked = null; await db.setMeta(KEY, null); changed() }

/** The game folder's files by lower-case name (the first found, packfiles folders first), walked once per folder per tab. */
let walked: { name: string; files: Promise<Map<string, FileSystemFileHandle>> } | null = null
async function walk(dir: Handle, out: Map<string, FileSystemFileHandle>, depth: number): Promise<Map<string, FileSystemFileHandle>> {
  const subdirs: Handle[] = []
  for await (const h of dir.values()) {
    const n = h.name.toLowerCase()
    if (h.kind === 'file') { if (!out.has(n)) out.set(n, h as FileSystemFileHandle) }
    else if (!SKIP_DIRS.has(n)) subdirs.push(h as Handle)
  }
  if (depth < 5) for (const d of subdirs.sort((a, b) => dirRank(a.name) - dirRank(b.name))) await walk(d, out, depth + 1)
  return out
}
function filesOf(h: Handle) {
  if (walked?.name !== h.name) {
    const files = walk(h, new Map(), 0)
    walked = { name: h.name, files }
    files.catch(() => { if (walked?.files === files) walked = null })
  }
  return walked.files
}

/** Picks the game folder (needs a click) and remembers it, once it holds the game's packfiles; its name, or null if cancelled. */
export async function pickGameFolder(): Promise<string | null> {
  let h: Handle
  try { h = await (window as any).showDirectoryPicker({ id: 'saintsreborn-game', mode: 'read' }) as Handle }
  catch (e) { if ((e as Error).name === 'AbortError') return null; throw e }
  walked = null
  if (!(await filesOf(h)).has('misc2.vpp_xbox2')) throw new Error(`No Saints Row packfiles in "${h.name}". Choose the Saints Reborn folder, or dist\\game\\packfiles inside it.`)
  await db.setMeta(KEY, h).catch(() => {})
  changed()
  return h.name
}

/**
 * Other packfiles from the same game folder (lower-case names), read by byte range like the character's.
 * Uses the remembered folder; `ask` lets the browser prompt for it again, or for the folder (needs a click).
 * Null when there is no folder (or the user cancelled).
 */
export async function gameFolderFiles(names: string[], ask: boolean): Promise<Map<string, File> | null> {
  let h = await db.getMeta<Handle>(KEY).catch(() => undefined)
  if (h && !(await permitted(h, ask).catch(() => false))) h = undefined
  if (!h) {
    if (!ask || !folderPickerSupported()) return null
    try { h = await (window as any).showDirectoryPicker({ id: 'saintsreborn-game', mode: 'read' }) as Handle }
    catch (e) { if ((e as Error).name === 'AbortError') return null; throw e }
    walked = null
  }
  // The folder is walked once per tab (a library connects to several packfiles, each asked for on its own).
  const files = await filesOf(h)
  const found = new Map<string, File>()
  for (const n of names) { const f = files.get(n); if (f) found.set(n, await f.getFile()) }
  if (found.size) { await db.setMeta(KEY, h).catch(() => {}); changed() }
  return found
}

/** Builds the character from the remembered folder. `ask` lets the browser prompt (needs a click). */
export async function loadFromRememberedFolder(ask: boolean): Promise<PlayerModel | null> {
  const h = await db.getMeta<Handle>(KEY).catch(() => undefined)
  if (!h || !(await permitted(h, ask).catch(() => false))) return null
  return loadPlayer(await findInHandle(h), h.name)
}

/** Asks for the game folder (File System Access API), remembers it and builds the character. Null if cancelled. */
export async function chooseGameFolder(): Promise<PlayerModel | null> {
  let h: Handle
  try { h = await (window as any).showDirectoryPicker({ id: 'saintsreborn-game', mode: 'read' }) as Handle }
  catch (e) { if ((e as Error).name === 'AbortError') return null; throw e }
  const found = await findInHandle(h)
  if (!found.has('misc2.vpp_xbox2')) throw new Error(`No Saints Row packfiles in "${h.name}". Choose the Saints Reborn folder, or dist\\game\\packfiles inside it.`)
  // Another folder (even one of the same name): the next file lookup walks it afresh.
  walked = null
  await db.setMeta(KEY, h).catch(() => {})
  changed()
  return loadPlayer(found, h.name)
}
