// Storing user files (content addressed) and detecting files that must never
// be uploaded because they are Saints Row game data.
import { db, sha256 } from './db'
import { fileVPath, type FileRef } from './project'
import { gameSignature } from './hubRules'
import { recipeOf } from './recipes'

export interface StoredFile { vpath: string; ref: FileRef }

export async function storeFile(data: Blob, name: string, origin: FileRef['origin'] = 'user'): Promise<StoredFile> {
  const hash = await sha256(data)
  if (!(await db.hasBlob(hash))) await db.putBlob(hash, data)
  const type = data.type || guessType(name)
  const gameData = await looksLikeGameFile(data, name)
  const recipe = gameData ? undefined : recipeOf(data)
  return { vpath: fileVPath(hash, name), ref: { hash, size: data.size, name, type, origin: gameData ? 'game' : origin, ...(recipe ? { recipe } : {}) } }
}

/**
 * storeFile for work that may be called off while it stores: when `keep()` says no afterwards, the file is taken out
 * again if this call added it (files are shared by content, so one stored before stays). Null then.
 */
export async function storeFileIf(data: Blob, name: string, keep: () => boolean): Promise<StoredFile | null> {
  const had = await db.hasBlob(await sha256(data))
  const out = await storeFile(data, name)
  if (keep()) return out
  if (!had) await db.deleteBlob(out.ref.hash).catch(() => undefined)
  return null
}

export function guessType(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || ''
  return ({
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp', gif: 'image/gif', webp: 'image/webp',
    tga: 'image/x-tga', dds: 'image/vnd-ms.dds', tif: 'image/tiff', tiff: 'image/tiff',
    obj: 'model/obj', mtl: 'model/mtl', cts: 'text/plain',
  } as Record<string, string>)[ext] || 'application/octet-stream'
}

// Game-data detection lives in hubRules.ts so the Netlify publish function
// can repeat the same check on the server.
export { GAME_SIGNATURES, GAME_EXTENSIONS, gameSignature } from './hubRules'

export async function looksLikeGameFile(data: Blob, name: string): Promise<boolean> {
  const head = new Uint8Array(await data.slice(0, 4096).arrayBuffer())
  const text = new TextDecoder('utf-8', { fatal: false }).decode(head)
  return gameSignature(head, name, text) !== null
}

export function readText(blob: Blob) { return blob.text() }
export const fmtBytes = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`
