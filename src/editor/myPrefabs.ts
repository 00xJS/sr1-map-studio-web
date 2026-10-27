// "My prefabs": objects the user picked and saved to place again, in any map.
// Kept in this browser (localStorage); the model files they point at are
// already stored by content in IndexedDB, so a saved piece is just JSON.
// Signed in, they also follow the account (lib/sync.ts syncMyPrefabs): every
// change here is sent, and deletions are remembered so other devices drop them too.
import { useSyncExternalStore } from 'react'
import { bundleItems, placeBundle, UserError, type ItemBundle } from './actions'
import { uid, type Vec3 } from '../lib/project'
import { MY_PREFABS, syncMyPrefabs, type PrefabDeletion } from '../lib/sync'

const KEY = MY_PREFABS.key
const EVENT = MY_PREFABS.event

export interface MyPrefab { id: string; name: string; saved: string; bundle: ItemBundle }

function read(): MyPrefab[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

function write(list: MyPrefab[], deleted?: PrefabDeletion[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
    if (deleted) localStorage.setItem(MY_PREFABS.deletedKey, JSON.stringify(deleted))
  } catch { throw new UserError('This browser would not save it (storage is full or blocked).') }
  cache = null
  window.dispatchEvent(new Event(EVENT))
  syncMyPrefabs().catch((e) => console.warn('My prefabs did not sync', e))
}

let cache: MyPrefab[] | null = null
const snapshot = () => (cache ??= read())
const subscribe = (fn: () => void) => {
  const on = () => { cache = null; fn() }
  window.addEventListener(EVENT, on); window.addEventListener('storage', on)
  return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on) }
}

export const useMyPrefabs = () => useSyncExternalStore(subscribe, snapshot)

export function saveMyPrefab(indices: number[], name: string): MyPrefab {
  const bundle = bundleItems(indices)
  if (!bundle) throw new UserError('Pick something to save first.')
  const p: MyPrefab = { id: uid(), name: name.trim() || 'My piece', saved: new Date().toISOString(), bundle }
  write([...read(), p])
  return p
}

/** One saved piece, or undefined. */
export const readMyPrefab = (id: string): MyPrefab | undefined => read().find((p) => p.id === id)

export function deleteMyPrefab(id: string) {
  let deleted: PrefabDeletion[] = []
  try { deleted = JSON.parse(localStorage.getItem(MY_PREFABS.deletedKey) || '[]') } catch { /* start over */ }
  write(read().filter((p) => p.id !== id), [{ id, deleted: new Date().toISOString() }, ...deleted.filter((d) => d.id !== id)])
}

/** Renaming counts as a save, so the new name wins on other devices. */
export function renameMyPrefab(id: string, name: string) { write(read().map((p) => (p.id === id ? { ...p, name, saved: new Date().toISOString() } : p))) }

/** Places a saved piece with its bottom centre on `at`. */
export function placeMyPrefab(id: string, at: Vec3, rot = 0) {
  const p = read().find((x) => x.id === id)
  if (!p) throw new UserError('That saved piece is gone (it may have been deleted in another tab).')
  return placeBundle(p.bundle, at, 'Add ' + p.name, rot)
}
