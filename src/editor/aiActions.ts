// Carries out the edits an AI chat reply asks for, as one undo step.
import { useEditor, currentProject } from './store'
import { getViewer } from './Viewport'
import * as act from './actions'
import { ALL_PREFABS } from '../lib/prefabRegistry'
import { SHAPE_PRESETS } from '../lib/shapes'
import { catalogs } from '../lib/catalogs'
import { GAME_MODES, newLight, type GameMode, type Vec3 } from '../lib/project'
import type { AiAction } from '../lib/aiChat'

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const TWIN_MARKER: Record<string, string> = { 'Red team spawn': 'Blue team spawn', 'Blue team spawn': 'Red team spawn' }
const weapons = () => new Set(catalogs.weapons.map(([, id]) => id))

/** The surface height under (x, z), or the usual ground height. */
const floorAt = (x: number, z: number) => getViewer()?.surfaceBelow(x, 1e4, z) ?? 1

/** Runs the actions; returns a short note of what happened and what was skipped. */
export async function runAiActions(actions: AiAction[], label: string): Promise<{ done: number; skipped: string[] }> {
  const st = useEditor.getState()
  if (!st.project) return { done: 0, skipped: ['No map is open.'] }
  const start = st.past.length
  const before = st.project
  const skipped: string[] = []
  const deletes = new Set<number>()
  let done = 0
  const count = () => currentProject()!.scene_items.length
  const item = (i: unknown) => (Number.isInteger(i) && (i as number) >= 0 && (i as number) < count() ? (i as number) : null)
  // Each placement, plus its twin across the middle when asked.
  const spots = (x: number, z: number, turn: number, mirror?: boolean): [number, number, number, boolean][] =>
    mirror && (Math.abs(x) > 0.5 || Math.abs(z) > 0.5) ? [[x, z, turn, false], [-x, -z, (turn + 180) % 360, true]] : [[x, z, turn, false]]

  for (const a of actions) {
    try {
      switch (a.do) {
        case 'add_prefab': {
          if (!ALL_PREFABS[a.key]) { skipped.push(`unknown prefab "${a.key}"`); break }
          for (const [x, z, rot] of spots(num(a.x), num(a.z), num(a.turn), a.mirror)) {
            await act.addPrefab(a.key, [x, 0, z], floorAt(x, z), { rot, params: a.settings }); done++
          }
          break
        }
        case 'add_shape': {
          if (!SHAPE_PRESETS[a.shape]) { skipped.push(`unknown shape "${a.shape}"`); break }
          const size = Array.isArray(a.size) && a.size.length === 3 ? a.size.map((v) => num(v, 1)) as Vec3 : undefined
          for (const [x, z, rot] of spots(num(a.x), num(a.z), num(a.turn), a.mirror)) {
            await act.addShape(a.shape, [x, 0, z], floorAt(x, z), { rot, size }); done++
          }
          break
        }
        case 'move': {
          const i = item(a.index)
          if (i === null) { skipped.push(`no object ${a.index}`); break }
          st.update('Move', (d) => {
            const p = d.scene_items[i].position
            d.scene_items[i].position = [num(a.x, p[0]) + num(a.dx), num(a.y, p[1]) + num(a.dy), num(a.z, p[2]) + num(a.dz)]
          })
          done++
          break
        }
        case 'turn': {
          const i = item(a.index)
          if (i === null) { skipped.push(`no object ${a.index}`); break }
          st.update('Turn', (d) => { const r = d.scene_items[i].rotation; r[1] = ((r[1] + num(a.degrees)) % 360 + 360) % 360 })
          done++
          break
        }
        case 'scale': {
          const i = item(a.index), f = num(a.factor, 1)
          if (i === null || f <= 0 || f > 20) { skipped.push(`can't scale ${a.index} by ${a.factor}`); break }
          st.update('Scale', (d) => { d.scene_items[i].scale = +(d.scene_items[i].scale * f).toFixed(5) })
          done++
          break
        }
        case 'duplicate': {
          const i = item(a.index)
          if (i === null) { skipped.push(`no object ${a.index}`); break }
          act.duplicateItem(i)
          const n = count() - 1
          if (a.dx || a.dz) st.update('Move', (d) => { const p = d.scene_items[n].position; d.scene_items[n].position = [p[0] + num(a.dx), p[1], p[2] + num(a.dz)] })
          done++
          break
        }
        case 'prefab_settings': {
          const i = item(a.index)
          if (i === null || !currentProject()!.scene_items[i].prefab) { skipped.push(`object ${a.index} isn't a prefab`); break }
          await act.updatePrefab(i, a.settings ?? {})
          done++
          break
        }
        case 'delete':
          for (const i of a.indices ?? []) { const k = item(i); if (k !== null) deletes.add(k) }
          break
        case 'add_marker': {
          if (!catalogs.marker_types.includes(a.type)) { skipped.push(`unknown marker "${a.type}"`); break }
          if (a.type === 'Weapon pickup' && !weapons().has(a.weapon ?? '')) { skipped.push(`unknown weapon "${a.weapon}"`); break }
          for (const [x, z, , twin] of spots(num(a.x), num(a.z), 0, a.mirror)) {
            const type = twin ? TWIN_MARKER[a.type] ?? a.type : a.type
            act.addMarker(type, [x, floorAt(x, z) + 0.1, z], a.type === 'Weapon pickup' ? { weapon: a.weapon } : {}); done++
          }
          break
        }
        case 'delete_markers': {
          const [nx, nz, nr] = Array.isArray(a.near) ? a.near.map((v) => num(v)) : [0, 0, Infinity]
          const before = currentProject()!.markers.length
          st.update('Remove markers', (d) => {
            d.markers = d.markers.filter((m) => !((!a.type || m.type === a.type) && Math.hypot(m.position[0] - nx, m.position[2] - nz) <= (nr || Infinity)))
          })
          done += before - currentProject()!.markers.length
          break
        }
        case 'add_light': {
          const color = Array.isArray(a.color) && a.color.length === 3 ? a.color.map((v) => Math.max(0, Math.min(1, num(v, 1)))) as Vec3 : undefined
          for (const [x, z] of spots(num(a.x), num(a.z), 0, a.mirror)) {
            if (currentProject()!.lights.length >= catalogs.limits.max_lights) { skipped.push(`light limit (${catalogs.limits.max_lights}) reached`); break }
            st.update('Add light', (d) => { d.lights.push({ ...newLight([x, num(a.y, 8), z]), ...(color ? { color } : {}) }) })
            done++
          }
          break
        }
        case 'set_modes': {
          const modes = (a.modes ?? []).filter((m): m is GameMode => (GAME_MODES as string[]).includes(m))
          if (!modes.length) { skipped.push('no known game modes given'); break }
          st.update('Game modes', (d) => { d.settings.modes = modes })
          done++
          break
        }
        case 'rename_map':
          if (typeof a.name === 'string' && a.name.trim()) { st.update('Rename map', (d) => { d.settings.display_name = a.name.trim().slice(0, 60) }); done++ }
          break
        case 'select': {
          const ids = (a.indices ?? []).map(item).filter((i): i is number => i !== null)
          useEditor.getState().selectItems(ids)
          break
        }
        default:
          skipped.push(`unknown edit "${(a as { do: string }).do}"`)
      }
    } catch (err) {
      skipped.push(err instanceof Error ? err.message : String(err))
    }
  }
  if (deletes.size) { act.removeItems([...deletes]); done += deletes.size }
  // Everything this reply did is one step on the undo list.
  const now = useEditor.getState()
  if (now.past.length > start) useEditor.setState({ past: [...now.past.slice(0, start), { project: before, label }], future: [] })
  return { done, skipped }
}
