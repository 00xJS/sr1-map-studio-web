// Carries out the edits an AI chat reply asks for, as one undo step.
import { useEditor, currentProject } from './store'
import { getViewer } from './Viewport'
import * as act from './actions'
import { ALL_PREFABS } from '../lib/prefabRegistry'
import { SHAPE_PRESETS } from '../lib/shapes'
import { catalogs } from '../lib/catalogs'
import { GAME_MODES, isGlass, newLight, uid, type GameMode, type Vec3 } from '../lib/project'
import { KINDS, defaultParams, type TextureKind } from '../lib/procedural'
import type { AiAction } from '../lib/aiChat'
import { expandPlacement, findMarkerTwin, findTwin, resolveTarget, symmetricPlan, twinItem, twinMarker } from '../lib/aiEdits'
import { loadLibrary, niceName, paintMaterial } from './paint'
import { spreadSpawns, weaponSpots } from '../lib/markerPlacer'
import type { Swatch } from './store'

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const TWIN_MARKER: Record<string, string> = { 'Red team spawn': 'Blue team spawn', 'Blue team spawn': 'Red team spawn' }
const weapons = () => new Set(catalogs.weapons.map(([, id]) => id))

/** The surface height under (x, z), or the usual ground height. */
const floorAt = (x: number, z: number) => getViewer()?.surfaceBelow(x, 1e4, z) ?? 1

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** A texture by name: the starter library (id or name), a generated kind, or one already in the map. */
const HEX = /^#[0-9a-f]{6}$/i

/** A texture by name; with colours, a generated one in those colours (a library photo can't be recoloured). */
async function swatchFor(name: string, tint: { color?: unknown; accent?: unknown } = {}): Promise<Swatch | null> {
  const want = squash(name)
  if (!want) return null
  const color = HEX.test(String(tint.color)) ? String(tint.color) : '', accent = HEX.test(String(tint.accent)) ? String(tint.accent) : ''
  if (color || accent) {
    const kind = (Object.keys(KINDS) as TextureKind[]).find((k) => squash(k) === want || squash(KINDS[k].label) === want || want.includes(squash(k)))
      ?? 'concrete'
    const params = { ...defaultParams(kind, 1024), ...(color ? { color } : {}), ...(accent ? { accent } : {}) }
    return { key: `gen:${kind}:${color}:${accent}`, label: KINDS[kind].label, surface: KINDS[kind].surface, source: { kind: 'generated', params } }
  }
  const lib = await loadLibrary().catch(() => [])
  const l = lib.find((t) => squash(t.id) === want) ?? lib.find((t) => squash(t.name) === want)
  if (l) return { key: 'lib:' + l.id, label: l.name, surface: l.surface, source: { kind: 'library', id: l.id } }
  const kind = (Object.keys(KINDS) as TextureKind[]).find((k) => squash(k) === want || squash(KINDS[k].label) === want)
  if (kind) return { key: 'gen:' + kind, label: KINDS[kind].label, surface: KINDS[kind].surface, source: { kind: 'generated', params: defaultParams(kind, 1024) } }
  for (const it of currentProject()?.scene_items ?? []) for (const [mat, vpath] of Object.entries(it.textures || {})) {
    if (vpath && squash(niceName(vpath)) === want) return { key: 'file:' + vpath, label: niceName(vpath), surface: it.surface_ids?.[mat] ?? 0, source: { kind: 'file', vpath } }
  }
  // Last try: a library texture whose name has the word in it ("brick" finds Red brick).
  const part = lib.find((t) => squash(t.name).includes(want) || squash(t.id).includes(want))
  return part ? { key: 'lib:' + part.id, label: part.name, surface: part.surface, source: { kind: 'library', id: part.id } } : null
}

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

  // Lines and rings expand into more edits in place.
  const queue = [...actions]
  for (let n = 0; n < queue.length && n < 400; n++) {
    const a = queue[n]
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
        case 'delete': {
          const ids = resolveTarget(currentProject()!, a)
          if (!ids.length) { skipped.push('nothing matched to delete'); break }
          for (const k of ids) deletes.add(k)
          break
        }
        case 'add_marker': {
          if (!catalogs.marker_types.includes(a.type)) { skipped.push(`unknown marker "${a.type}"`); break }
          if (a.type === 'Weapon pickup' && !weapons().has(a.weapon ?? '')) { skipped.push(`unknown weapon "${a.weapon}"`); break }
          for (const [x, z, , twin] of spots(num(a.x), num(a.z), 0, a.mirror)) {
            const type = twin ? TWIN_MARKER[a.type] ?? a.type : a.type
            act.addMarker(type, [x, floorAt(x, z) + 0.1, z], a.type === 'Weapon pickup' ? { weapon: a.weapon } : {}); done++
          }
          break
        }
        case 'spread_spawns': {
          const viewer = getViewer()
          const which = a.which === 'team' || a.which === 'all' ? a.which : 'shared'
          const markers = spreadSpawns(currentProject()!, viewer ? (i) => viewer.itemBounds(i) : undefined, which, typeof a.count === 'number' ? a.count : undefined)
          if (!markers) { skipped.push('no open floor to put spawns on'); break }
          st.update('Spread spawns', (d) => { d.markers = markers })
          done++
          break
        }
        case 'add_weapons': {
          const known = weapons()
          const list = (Array.isArray(a.weapons) ? a.weapons : []).map(String)
          for (const w of list.filter((w) => !known.has(w))) skipped.push(`unknown weapon "${w}"`)
          const want = list.filter((w) => known.has(w))
          if (!want.length) break
          const viewer = getViewer()
          const at = weaponSpots(currentProject()!, viewer ? (i) => viewer.itemBounds(i) : undefined, want.length, a.where === 'middle' || a.where === 'ends' ? a.where : 'spread')
          if (at.length < want.length) skipped.push(`room for ${at.length} of ${want.length} weapons`)
          at.forEach((p, i) => {
            act.addMarker('Weapon pickup', [p[0], p[1] + 0.1, p[2]], { weapon: want[i] }); done++
            if (a.mirror !== false) { act.addMarker('Weapon pickup', [-p[0], p[1] + 0.1, -p[2]], { weapon: want[i] }); done++ }
          })
          break
        }
        case 'delete_markers': {
          const [nx, nz, nr] = Array.isArray(a.near) ? a.near.map((v) => num(v)) : [0, 0, Infinity]
          const only = Array.isArray(a.indices) ? new Set(a.indices) : null
          const before = currentProject()!.markers.length
          st.update('Remove markers', (d) => {
            d.markers = d.markers.filter((m, i) => !((!only || only.has(i)) && (!a.type || m.type === a.type) && Math.hypot(m.position[0] - nx, m.position[2] - nz) <= (nr || Infinity)))
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
        case 'select':
          useEditor.getState().selectItems(resolveTarget(currentProject()!, a))
          break
        case 'move_marker': {
          const m = currentProject()!.markers[a.index]
          if (!m) { skipped.push(`no marker #${a.index}`); break }
          const x = num(a.x, m.position[0]), z = num(a.z, m.position[2])
          st.update('Move marker', (d) => { d.markers[a.index].position = [x, floorAt(x, z) + 0.1, z] })
          done++
          break
        }
        case 'paint': {
          const ids = resolveTarget(currentProject()!, a)
          const sw = typeof a.texture === 'string' ? await swatchFor(a.texture, a) : null
          if (!sw) { skipped.push(`unknown texture "${a.texture}"`); break }
          if (!ids.length) { skipped.push('nothing matched to paint'); break }
          // A material by its name or by its current texture's name; all of them when none is given.
          const want = typeof a.material === 'string' ? squash(a.material) : ''
          for (const i of ids) {
            const it = currentProject()!.scene_items[i]
            if (isGlass(it)) continue
            const mats = Object.entries(it.textures || {}).filter(([m, v]) => !want || squash(m) === want || (!!v && squash(niceName(v)).includes(want))).map(([m]) => m)
            for (const m of mats) { await paintMaterial(i, m, sw); done++ }
          }
          break
        }
        case 'place_line':
        case 'place_ring': {
          const more = expandPlacement(a)
          if (!more.length) { skipped.push(`nothing to place for ${a.do}`); break }
          queue.splice(n + 1, 0, ...more)
          break
        }
        case 'mirror': {
          const p = currentProject()!
          const ids = resolveTarget(p, a).filter((i) => findTwin(p, i) === null)
          const marks = (Array.isArray(a.markers) ? a.markers : []).filter((i) => p.markers[i] && findMarkerTwin(p, i) === null)
          if (!ids.length && !marks.length) { skipped.push('those already have twins'); break }
          const groups = new Map<string, string>()
          st.update('Mirror', (d) => {
            for (const i of ids) d.scene_items.push(twinItem(p.scene_items[i], uid, groups))
            for (const i of marks) d.markers.push(twinMarker(p.markers[i], uid))
          })
          done += ids.length + marks.length
          break
        }
        case 'make_symmetric': {
          const p = currentProject()!
          const plan = symmetricPlan(p, a.keep === 'blue' ? 'blue' : 'red', a.only === 'objects' || a.only === 'markers' ? a.only : undefined)
          const groups = new Map<string, string>()
          const dropI = new Set(plan.items.drop), dropM = new Set(plan.markers.drop), dropL = new Set(plan.lights.drop)
          st.update('Make symmetric', (d) => {
            d.scene_items = [...d.scene_items.filter((_, i) => !dropI.has(i)), ...plan.items.copy.map((i) => twinItem(p.scene_items[i], uid, groups))]
            d.markers = [...d.markers.filter((_, i) => !dropM.has(i)), ...plan.markers.copy.map((i) => twinMarker(p.markers[i], uid))]
            d.lights = [...d.lights.filter((_, i) => !dropL.has(i)), ...plan.lights.copy.map((i) => {
              const l = p.lights[i]
              return { ...structuredClone(l), uid: uid(), position: [-l.position[0], l.position[1], -l.position[2]] as Vec3 }
            })]
          })
          useEditor.getState().select(null)
          done += plan.items.copy.length + plan.markers.copy.length + plan.lights.copy.length
          break
        }
        case 'set_weather':
          st.update('Weather', (d) => { d.settings.always_clear_weather = a.clear !== false })
          done++
          break
        case 'generate_map':
          skipped.push('a new map is made from the chat, not as an edit')
          break
        default:
          skipped.push(`unknown edit "${(a as { do: string }).do}"`)
      }
    } catch (err) {
      skipped.push(err instanceof Error ? err.message : String(err))
    }
  }
  if (deletes.size) { act.removeItems([...deletes]); useEditor.getState().select(null); done += deletes.size }
  // Everything this reply did is one step on the undo list.
  const now = useEditor.getState()
  if (now.past.length > start) useEditor.setState({ past: [...now.past.slice(0, start), { project: before, label }], future: [] })
  return { done, skipped }
}
