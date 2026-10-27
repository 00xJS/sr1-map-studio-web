// Favourite and recently used pieces in the prefab browser, kept in this browser only: prefabs, saved pieces
// and objects from the player's own game alike, by their shape ("prefab:<key>", "mine:<id>", "game:<id>").
import { useSyncExternalStore } from 'react'

const FAVS = 'sr1ms.prefabFavs'
const RECENT = 'sr1ms.prefabRecent'
const EVENT = 'sr1ms-prefablists'
const RECENT_MAX = 12

function readList(key: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] }
}
let lists: { favs: string[]; recent: string[] } | null = null
const listSnapshot = () => (lists ??= { favs: readList(FAVS), recent: readList(RECENT) })
const listSubscribe = (fn: () => void) => {
  const on = () => { lists = null; fn() }
  window.addEventListener(EVENT, on); window.addEventListener('storage', on)
  return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on) }
}
function writeList(key: string, list: string[]) {
  try { localStorage.setItem(key, JSON.stringify(list)) } catch { /* storage blocked: lists last until reload */ }
  lists = { ...listSnapshot(), [key === FAVS ? 'favs' : 'recent']: list }
  window.dispatchEvent(new Event(EVENT))
}
export const usePrefabLists = () => useSyncExternalStore(listSubscribe, listSnapshot)

export function toggleFavourite(shape: string) {
  const { favs } = listSnapshot()
  writeList(FAVS, favs.includes(shape) ? favs.filter((x) => x !== shape) : [...favs, shape])
}
export function markPrefabUsed(shape: string) {
  const { recent } = listSnapshot()
  if (recent[0] !== shape) writeList(RECENT, [shape, ...recent.filter((x) => x !== shape)].slice(0, RECENT_MAX))
}
