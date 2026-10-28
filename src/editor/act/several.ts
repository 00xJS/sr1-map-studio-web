// Several objects at once: duplicate, delete, copy and paste, turn, group.
import { useEditor, currentProject, withoutMirror } from '../store'
import { holdsBothHalves } from '../../lib/mirrorEdit'
import { catalogs } from '../../lib/catalogs'
import { isGlass, referencedPaths, uid, type FileRef, type Project, type SceneItem, type Vec3 } from '../../lib/project'
import { log, update, UserError } from './core'
import { duplicateItem, removeItem } from './objects'

const CLIPBOARD_KEY = 'sr1ms.clipboard'

/** Selected objects as a portable bundle: positions relative to their bottom centre, plus the file records they use. */
export interface ItemBundle { items: SceneItem[]; files: Record<string, FileRef> }

export function bundleItems(indices: number[]): ItemBundle | null {
  const p = currentProject()
  const items = indices.map((i) => p?.scene_items[i]).filter((x): x is SceneItem => !!x)
  if (!p || !items.length) return null
  const lo = (k: 0 | 1 | 2) => Math.min(...items.map((it) => it.position[k]))
  const hi = (k: 0 | 1 | 2) => Math.max(...items.map((it) => it.position[k]))
  const o: Vec3 = [(lo(0) + hi(0)) / 2, lo(1), (lo(2) + hi(2)) / 2]
  const rel = items.map((it) => ({ ...structuredClone(it), position: [it.position[0] - o[0], it.position[1] - o[1], it.position[2] - o[2]] as Vec3 }))
  const used = new Set(referencedPaths({ ...p, scene_items: rel, asset_library: [] } as Project))
  const files = Object.fromEntries(Object.entries(p.files).filter(([k]) => used.has(k)))
  return { items: rel, files }
}

/** Puts a bundle into the map with its bottom centre at `at`, turned by `rot` degrees; returns the new indices. Groups get fresh ids. */
export function placeBundle(b: ItemBundle, at: Vec3, label: string, rot = 0): number[] {
  const p = currentProject()
  if (!p) return []
  const glass = b.items.filter(isGlass).length
  if (glass && p.scene_items.filter(isGlass).length + glass > catalogs.limits.max_native_objects) throw new UserError(`This build supports up to ${catalogs.limits.max_native_objects} native objects.`)
  const regroup = new Map<string, string>()
  const start = p.scene_items.length
  update(label, (d) => {
    Object.assign(d.files, b.files)
    for (const it of b.items) {
      const group = it.group && (regroup.get(it.group) ?? regroup.set(it.group, 'g-' + uid()).get(it.group))
      // Turned about the bundle's middle the same way the editor turns objects (x' = x cos + z sin, z' = -x sin + z cos).
      const t = (rot * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t)
      const [x, y, z] = it.position
      const rotation: Vec3 = [it.rotation[0], (((it.rotation[1] + rot) % 360) + 360) % 360, it.rotation[2]]
      d.scene_items.push({ ...structuredClone(it), uid: uid(), group, rotation, position: [x * c + z * sn + at[0], y + at[1], -x * sn + z * c + at[2]] })
    }
  })
  const added = b.items.map((_, i) => start + i)
  useEditor.getState().selectItems(added)
  return added
}

const bundleOrigin = (indices: number[]): Vec3 => {
  const items = indices.map((i) => currentProject()!.scene_items[i])
  const xs = items.map((it) => it.position[0]), zs = items.map((it) => it.position[2])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...items.map((it) => it.position[1])), (Math.min(...zs) + Math.max(...zs)) / 2]
}

export function duplicateItems(indices: number[]) {
  if (indices.length === 1 && !currentProject()?.scene_items[indices[0]]?.group) return duplicateItem(indices[0])
  const b = bundleItems(indices)
  if (!b) return
  const o = bundleOrigin(indices)
  placeBundleOnce(b, [o[0] + 4, o[1], o[2] + 4], `Duplicate ${b.items.length} objects`)
  log(`Duplicated ${b.items.length} objects, shifted a little so you can see them.`)
}

export function removeItems(indices: number[]) {
  const p = currentProject()
  if (!p || !indices.length) return
  if (indices.length === 1) return removeItem(indices[0])
  const drop = new Set(indices)
  update(`Remove ${drop.size} objects`, (d) => { d.scene_items = d.scene_items.filter((_, i) => !drop.has(i)) })
  useEditor.getState().select(null)
}

export function copyItems(indices: number[]): number {
  const b = bundleItems(indices)
  if (!b) return 0
  try { localStorage.setItem(CLIPBOARD_KEY, JSON.stringify({ ...b, origin: bundleOrigin(indices), pastes: 0 })) } catch { throw new UserError('This browser would not keep the copy (storage is full or blocked).') }
  return b.items.length
}

export function hasClipboard() {
  try { return !!localStorage.getItem(CLIPBOARD_KEY) } catch { return false }
}

/** Pastes next to where the objects were copied from, stepping a little further each time. */
export function pasteItems(): number {
  let c: (ItemBundle & { origin: Vec3; pastes: number }) | null = null
  try { c = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) || 'null') } catch { /* nothing usable */ }
  if (!c?.items?.length) return 0
  c.pastes = (c.pastes || 0) + 1
  try { localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(c)) } catch { /* the next paste just lands in the same spot */ }
  const step = 4 * c.pastes
  placeBundleOnce(c, [c.origin[0] + step, c.origin[1], c.origin[2] + step], `Paste ${c.items.length} objects`)
  return c.items.length
}

/** placeBundle, but a bundle that already holds both halves of itself (a mirrored pair copied together) goes in as it
 *  is, mirror mode or not: twinning each half again would make four. Positions are relative to its middle. */
function placeBundleOnce(b: ItemBundle, at: Vec3, label: string) {
  return holdsBothHalves(b.items) ? withoutMirror(() => placeBundle(b, at, label)) : placeBundle(b, at, label)
}

/** Turns several objects together about their shared centre. */
export function turnItems(indices: number[], deg: number) {
  const p = currentProject()
  if (!p || !indices.length) return
  const [cx, , cz] = bundleOrigin(indices)
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
  update('Turn objects', (d) => {
    for (const i of indices) {
      const it = d.scene_items[i]
      if (!it) continue
      // Same sense as the gizmo: +deg is a turn about +Y.
      const x = it.position[0] - cx, z = it.position[2] - cz
      it.position = [+(cx + x * c + z * s).toFixed(4), it.position[1], +(cz - x * s + z * c).toFixed(4)]
      it.rotation = [it.rotation[0], ((it.rotation[1] + deg) % 360 + 360) % 360, it.rotation[2]]
    }
  })
}

export function groupItems(indices: number[]) {
  if (indices.length < 2) throw new UserError('Pick two or more objects to group (Shift+click to add).')
  const id = 'g-' + uid()
  update(`Group ${indices.length} objects`, (d) => { for (const i of indices) if (d.scene_items[i]) d.scene_items[i].group = id })
  useEditor.getState().selectItems(indices)
  log(`Grouped ${indices.length} objects: clicking any of them now picks the whole group.`)
}

export function ungroupItems(indices: number[]) {
  const p = currentProject()
  if (!p || !indices.some((i) => p.scene_items[i]?.group)) return
  update('Ungroup', (d) => { for (const i of indices) if (d.scene_items[i]) delete d.scene_items[i].group })
  useEditor.getState().selectItems(indices)
}
