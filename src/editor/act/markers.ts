// Spawns, markers and lights.
import { useEditor, currentProject, startRun, stillCurrent } from '../store'
import { catalogs } from '../../lib/catalogs'
import { newLight, newMarker, type Marker, type Vec3 } from '../../lib/project'
import { log, update, UserError } from './core'
import { removeItem } from './objects'

export function addMarker(type: string, position: Vec3, patch: Partial<Marker> = {}) {
  update('Add marker', (d) => {
    const m = { ...newMarker(type, position), ...patch }
    if (m.type === 'Weapon pickup') m.label = m.weapon
    if (m.type === 'Vehicle spawn') m.label = m.vehicle
    d.markers.push(m)
  })
  useEditor.getState().select({ kind: 'marker', index: currentProject()!.markers.length - 1 })
}

export function removeSelected() {
  const { selection } = useEditor.getState()
  if (selection) removeTarget(selection)
}

/** Gives the map the default sky picture (as new maps get), so the game doesn't draw a black sky. */
export async function addDefaultSky() {
  const run = startRun()
  const { skyFile } = await import('../../lib/samples')
  const sky = await skyFile()
  // A map opened while the picture loaded keeps its own sky.
  stillCurrent(run)
  update('Add a sky', (d) => { d.files[sky.vpath] = sky.ref; d.settings.sky_texture = sky.vpath }, { noMirror: true })
  log('Added a sky: the game shows it overhead (change it in the Game tab, under Sky).')
}

/** Deletes every marker of the given types, as one undo step (unused game-mode markers). */
export function removeMarkersOfType(types: string[]) {
  const n = currentProject()?.markers.filter((m) => types.includes(m.type)).length ?? 0
  if (!n) return 0
  update(`Remove ${n} unused marker${n === 1 ? '' : 's'}`, (d) => { d.markers = d.markers.filter((m) => !types.includes(m.type)) })
  const sel = useEditor.getState().selection
  if (sel?.kind === 'marker') useEditor.getState().select(null)
  log(`Removed ${n} marker${n === 1 ? '' : 's'} that no selected game mode uses (Undo brings ${n === 1 ? 'it' : 'them'} back).`)
  return n
}

/** Deletes one object, marker or light (the Eraser tool and the Delete key). */
export function removeTarget(selection: { kind: 'item' | 'marker' | 'light'; index: number }) {
  if (selection.kind === 'item') return removeItem(selection.index)
  const key = selection.kind === 'marker' ? 'markers' : 'lights'
  update('Remove ' + selection.kind, (d) => { d[key].splice(selection.index, 1) })
  const n = currentProject()![key].length
  useEditor.getState().select(n ? { kind: selection.kind, index: Math.min(selection.index, n - 1) } : null)
}

export function addLight(position: Vec3) {
  const p = currentProject()
  if (!p) return
  if (p.lights.length >= catalogs.limits.max_lights) throw new UserError(`Use at most ${catalogs.limits.max_lights} point lights per map.`)
  update('Add light', (d) => { d.lights.push(newLight(position, 'interior', d.settings.world_scale)) })
  useEditor.getState().select({ kind: 'light', index: currentProject()!.lights.length - 1 })
}

/** Vertical ray onto the scene surface (desktop "Snap selected to surface"). */
export function snapPoint(raycastDown: (x: number, y: number, z: number) => number | null, pos: Vec3): Vec3 | null {
  const y = raycastDown(pos[0], pos[1], pos[2])
  return y === null ? null : [pos[0], y + 0.12, pos[2]]
}
