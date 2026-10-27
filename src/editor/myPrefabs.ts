// "My prefabs": objects the user picked and saved to place again, in any map.
// Kept in this browser (localStorage); the model files they point at are
// already stored by content in IndexedDB, so a saved piece is just JSON.
// Signed in, they also follow the account (lib/sync.ts syncMyPrefabs): every
// change here is sent, and deletions are remembered so other devices drop them too.
import { useSyncExternalStore } from 'react'
import { bundleItems, placeBundle, UserError, type ItemBundle } from './actions'
import { uid, type Vec3 } from '../lib/project'
import { deletePiece, MY_PREFABS, readPrefabStore, renamePiece, syncMyPrefabs, writePrefabStore, type PrefabState } from '../lib/sync'

export interface MyPrefab { id: string; name: string; saved: string; bundle: ItemBundle }

const read = (): MyPrefab[] => readPrefabStore().pieces

/** Writes the pieces and deletion markers together, then sends them to the account. */
function write(change: (s: PrefabState) => PrefabState) {
  try { writePrefabStore(change(readPrefabStore())) } catch { throw new UserError('This browser would not save it (storage is full or blocked).') }
  cache = null
  void syncMyPrefabs()
}

let cache: MyPrefab[] | null = null
const snapshot = () => (cache ??= read())
const subscribe = (fn: () => void) => {
  const on = () => { cache = null; fn() }
  window.addEventListener(MY_PREFABS.event, on); window.addEventListener('storage', on)
  return () => { window.removeEventListener(MY_PREFABS.event, on); window.removeEventListener('storage', on) }
}

export const useMyPrefabs = () => useSyncExternalStore(subscribe, snapshot)

export function saveMyPrefab(indices: number[], name: string): MyPrefab {
  const bundle = bundleItems(indices)
  if (!bundle) throw new UserError('Pick something to save first.')
  const p: MyPrefab = { id: uid(), name: name.trim() || 'My piece', saved: new Date().toISOString(), bundle }
  write((s) => ({ ...s, pieces: [...s.pieces, p] }))
  return p
}

/** One saved piece, or undefined. */
export const readMyPrefab = (id: string): MyPrefab | undefined => read().find((p) => p.id === id)

export function deleteMyPrefab(id: string) { write((s) => deletePiece(s, id)) }

export function renameMyPrefab(id: string, name: string) { write((s) => renamePiece(s, id, name)) }

/** Places a saved piece with its bottom centre on `at`. */
export function placeMyPrefab(id: string, at: Vec3, rot = 0) {
  const p = read().find((x) => x.id === id)
  if (!p) throw new UserError('That saved piece is gone (it may have been deleted in another tab).')
  return placeBundle(p.bundle, at, 'Add ' + p.name, rot)
}
