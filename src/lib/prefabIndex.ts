// The prefab list as the prefab browser shows it: every prefab in the registry
// with its category and search text. Built from ALL_PREFABS, so prefabs added
// there show up by themselves, in new categories too.
import { ALL_PREFABS, PREFAB_CATEGORIES } from './prefabRegistry'
import type { Part } from './sampleKit'

export interface PrefabEntry {
  /** What the Shape tool places: "prefab:<key>" or "mine:<id>" (see the store's toolShape). */
  shape: string
  label: string
  hint: string
  category: string
  /** Lower-case words searched: label, hint, category, key and keywords. */
  text: string
}

export const MINE = 'My prefabs'

/** Lower case, no accents, words separated by single spaces. */
export const normalize = (s: string) => ' ' + s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim() + ' '

let entries: PrefabEntry[] | null = null
export function prefabEntries(): PrefabEntry[] {
  return (entries ??= Object.entries(ALL_PREFABS).map(([key, p]) => ({
    shape: 'prefab:' + key, label: p.label, hint: p.hint, category: p.category,
    text: normalize([p.label, p.hint, p.category, key.replace(/_/g, ' '), ...(p.keywords ?? [])].join(' ')),
  })))
}

/** Categories in the registry's order, then any new ones a prefab file brought, A to Z. */
export function prefabCategories(list: { category: string }[] = prefabEntries()): string[] {
  const used = new Set(list.map((e) => e.category))
  return [...PREFAB_CATEGORIES.filter((c) => used.has(c)), ...[...used].filter((c) => !PREFAB_CATEGORIES.includes(c)).sort()]
}

/** "Trees" finds "tree"; short words stay as typed. */
const stem = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)

/** Entries holding every word of the query, best first: names before hints, word starts before middles. */
export function searchPrefabs<T extends { label: string; text: string }>(list: T[], query: string): T[] {
  const words = normalize(query).trim().split(' ').filter(Boolean).map(stem)
  if (!words.length) return list
  const scored: [T, number][] = []
  for (const e of list) {
    const label = normalize(e.label)
    let score = 0
    for (const w of words) {
      if (label.includes(' ' + w)) score += 4
      else if (label.includes(w)) score += 3
      else if (e.text.includes(' ' + w)) score += 2
      else if (e.text.includes(w)) score += 1
      else { score = -1; break }
    }
    if (score >= 0) scored.push([e, score + (label.startsWith(' ' + words[0]) ? 2 : 0)])
  }
  return scored.sort((a, b) => b[1] - a[1]).map(([e]) => e)
}

/** A prefab's parts at the origin, as placed with default settings. */
export const prefabParts = (key: string): Part[] => ALL_PREFABS[key]?.make(0, 0, 0, 0) ?? []

/** Short, fast hash (FNV-1a) of a string, for telling whether a prefab's look changed. */
export function hashText(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}
