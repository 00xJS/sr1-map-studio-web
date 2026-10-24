// The thinking behind the AI chat's bigger edits, kept free of the editor so
// it can be tested: which objects a target names, where a line or ring of
// things goes, which object is another's twin across the middle, and what
// "make it symmetric" keeps and adds.
import type { Light, Marker, Project, SceneItem, Vec3 } from './project'
import type { AiAction, AiPlaceable, AiTarget } from './aiChat'

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const r2 = (v: number) => Math.round(v * 100) / 100 + 0
const wrap = (deg: number) => ((deg % 360) + 360) % 360

/** Object indices a target names; an empty target names nothing. */
export function resolveTarget(p: Project, t: AiTarget): number[] {
  const n = p.scene_items.length
  const out = new Set<number>()
  for (const i of Array.isArray(t.indices) ? t.indices : []) if (Number.isInteger(i) && i >= 0 && i < n) out.add(i)
  const name = typeof t.name === 'string' ? t.name.trim().toLowerCase() : ''
  const prefab = typeof t.prefab === 'string' ? t.prefab.trim() : ''
  const shape = typeof t.shape === 'string' ? t.shape.trim().toLowerCase() : ''
  const near = Array.isArray(t.near) && t.near.length >= 2 ? [num(t.near[0]), num(t.near[1]), num(t.near[2], 8)] : null
  if (name || prefab || shape || near) {
    p.scene_items.forEach((it, i) => {
      if (near) {
        if (Math.hypot(it.position[0] - near[0], it.position[2] - near[1]) > near[2]) return
        // Not the ground or anything else much bigger than the area.
        if (it.shape && Math.min(it.shape.size[0], it.shape.size[2]) * it.scale > near[2] * 3) return
      }
      if (name && !it.name.toLowerCase().includes(name)) return
      if (prefab && it.prefab?.key !== prefab) return
      if (shape && !(it.shape && (it.shape.kind === shape || it.name.toLowerCase().startsWith(shape)))) return
      out.add(i)
    })
  }
  return [...out].sort((a, b) => a - b)
}

/** The add_* edit for one placeable at (x, z). */
function placeAt(item: AiPlaceable, x: number, z: number, turn: number | undefined, mirror?: boolean): AiAction | null {
  const at = { x: r2(x), z: r2(z), ...(mirror ? { mirror: true } : {}) }
  switch (item?.do) {
    case 'add_prefab': return { do: 'add_prefab', key: item.key, ...at, turn: turn ?? num(item.turn), ...(item.settings ? { settings: item.settings } : {}) }
    case 'add_shape': return { do: 'add_shape', shape: item.shape, ...at, turn: turn ?? num(item.turn), ...(item.size ? { size: item.size } : {}) }
    case 'add_marker': return { do: 'add_marker', type: item.type, ...at, ...(item.weapon ? { weapon: item.weapon } : {}) }
    case 'add_light': return { do: 'add_light', ...at, y: num(item.y, 8), ...(item.color ? { color: item.color } : {}) }
    default: return null
  }
}

const MAX_PLACED = 40

/** place_line and place_ring as plain add_* edits (at most 40 things). */
export function expandPlacement(a: Extract<AiAction, { do: 'place_line' | 'place_ring' }>): AiAction[] {
  const count = Math.max(1, Math.min(MAX_PLACED, Math.round(num(a.count, 1))))
  const out: (AiAction | null)[] = []
  if (a.do === 'place_line') {
    const [x0, z0] = (Array.isArray(a.from) ? a.from : [0, 0]).map((v) => num(v))
    const [x1, z1] = (Array.isArray(a.to) ? a.to : [0, 0]).map((v) => num(v))
    // Heading of the line in the editor's sense (0 faces +Z, 90 faces +X).
    const along = wrap((Math.atan2(x1 - x0, z1 - z0) * 180) / Math.PI)
    const turn = a.face === 'along' ? along : a.face === 'across' ? wrap(along + 90) : undefined
    for (let k = 0; k < count; k++) {
      const f = count === 1 ? 0.5 : k / (count - 1)
      out.push(placeAt(a.item, x0 + (x1 - x0) * f, z0 + (z1 - z0) * f, turn, a.mirror))
    }
  } else {
    const [cx, cz] = (Array.isArray(a.center) ? a.center : [0, 0]).map((v) => num(v))
    const radius = Math.max(0, num(a.radius, 10))
    for (let k = 0; k < count; k++) {
      const deg = num(a.start) + (360 * k) / count
      const rad = (deg * Math.PI) / 180
      const x = cx + Math.sin(rad) * radius, z = cz + Math.cos(rad) * radius
      // Facing out is the heading from the centre; in is the other way.
      const turn = a.face === 'out' ? wrap(deg) : a.face === 'in' ? wrap(deg + 180) : undefined
      out.push(placeAt(a.item, x, z, turn, a.mirror))
    }
  }
  return out.filter((x): x is AiAction => !!x)
}

/** What makes two objects the same thing: prefab and settings, shape and size, or else the name. */
function kindOf(it: SceneItem): string {
  if (it.prefab) return `p:${it.prefab.key}`
  if (it.shape) return `s:${it.shape.kind}:${it.shape.size.map((v) => r2(v * it.scale)).join('x')}`
  // Imported models and baked groups: each side has its own file, already turned in it.
  return `n:${it.name.replace(/( Copy)+$/, '')}`
}

/** Shapes that look the same turned by 180° (so either way round is a fair twin). */
const halfTurnSymmetric = (it: SceneItem) => !!it.shape && ['box', 'cylinder'].includes(it.shape.kind) && !it.shape.lie

const angleDiff = (a: number, b: number, period = 360) => { const d = Math.abs(wrap(a - b) % period); return Math.min(d, period - d) }

/** Near the middle, where an object is its own twin. */
export const atCentre = (x: number, z: number, tol = 1) => Math.abs(x) <= tol && Math.abs(z) <= tol

/** Index of the object across the middle from `i` (at -x, -z, turned 180°), or null. `i` itself when it sits on the centre. */
export function findTwin(p: Project, i: number, tol = 1.5): number | null {
  const it = p.scene_items[i]
  if (!it) return null
  const [x, y, z] = it.position
  if (atCentre(x, z, tol)) return i
  const k = kindOf(it)
  let best: number | null = null, bestD = Infinity
  p.scene_items.forEach((o, j) => {
    if (j === i || kindOf(o) !== k) return
    const d = Math.hypot(o.position[0] + x, o.position[2] + z)
    if (d > tol || Math.abs(o.position[1] - y) > tol) return
    // A prefab whose settings differ faces its own way through them (a shop's front), whatever its turn.
    const ownFacing = !!it.prefab && JSON.stringify(it.prefab.params) !== JSON.stringify(o.prefab?.params)
    const turnOk = !(it.prefab || it.shape) || ownFacing || angleDiff(o.rotation[1], it.rotation[1] + 180, halfTurnSymmetric(it) ? 180 : 360) <= 6
    if (turnOk && d < bestD) { best = j; bestD = d }
  })
  return best
}

const TWIN_TYPE: Record<string, string> = { 'Red team spawn': 'Blue team spawn', 'Blue team spawn': 'Red team spawn' }
export const twinType = (type: string) => TWIN_TYPE[type] ?? type

/** Index of the marker across the middle from marker `i` (red spawns pair with blue ones), or null. */
export function findMarkerTwin(p: Project, i: number, tol = 2): number | null {
  const m = p.markers[i]
  if (!m) return null
  const [x, , z] = m.position
  if (atCentre(x, z, tol) && !TWIN_TYPE[m.type]) return i
  const type = twinType(m.type)
  let best: number | null = null, bestD = Infinity
  p.markers.forEach((o, j) => {
    if (j === i || o.type !== type || (m.type === 'Weapon pickup' && o.weapon !== m.weapon)) return
    const d = Math.hypot(o.position[0] + x, o.position[2] + z)
    if (d <= tol && d < bestD) { best = j; bestD = d }
  })
  return best
}

/** Is (x, z) on the kept team's half? Red keeps -Z; along the centre line, red keeps -X. */
export function onHalf(keep: 'red' | 'blue', x: number, z: number, tol = 0.5): boolean {
  const s = keep === 'red' ? -1 : 1
  if (Math.abs(z) > tol) return Math.sign(z) === s
  return Math.abs(x) > tol ? Math.sign(x) === s : true
}

/** The twin of an object: same thing at (-x, -z), turned 180°, in its own group when it had one. */
export function twinItem(it: SceneItem, newUid: () => string, groups: Map<string, string>): SceneItem {
  const c = structuredClone(it)
  c.uid = newUid()
  c.position = [-it.position[0], it.position[1], -it.position[2]]
  c.rotation = [it.rotation[0], wrap(it.rotation[1] + 180), it.rotation[2]]
  if (it.group) {
    if (!groups.has(it.group)) groups.set(it.group, newUid())
    c.group = groups.get(it.group)
  }
  return c
}

/** The twin of a marker: same thing at (-x, -z), facing the other way; red and blue spawns swap. */
export function twinMarker(m: Marker, newUid: () => string): Marker {
  return { ...structuredClone(m), uid: newUid(), type: twinType(m.type), position: [-m.position[0], m.position[1], -m.position[2]], yaw: wrap((m.yaw ?? 0) + 180) }
}

/** Plan for make_symmetric: what to drop from the other half and what to copy from the kept one. */
export function symmetricPlan(p: Project, keep: 'red' | 'blue', only?: 'objects' | 'markers') {
  const items = only === 'markers' ? { drop: [] as number[], copy: [] as number[] } : split(p.scene_items.map((it) => it.position), keep)
  const markers = only === 'objects' ? { drop: [] as number[], copy: [] as number[] } : split(p.markers.map((m) => m.position), keep, p.markers.map((m) => m.type))
  const lights = only ? { drop: [] as number[], copy: [] as number[] } : split(p.lights.map((l) => l.position), keep)
  return { items, markers, lights }
}

function split(positions: [number, number, number][], keep: 'red' | 'blue', types?: string[]) {
  const drop: number[] = [], copy: number[] = []
  positions.forEach(([x, , z], i) => {
    // Team spawns belong to their own end whatever half they are on.
    const t = types?.[i]
    if (t === 'Red team spawn' || t === 'Blue team spawn') {
      if ((t === 'Red team spawn') === (keep === 'red')) copy.push(i); else drop.push(i)
      return
    }
    if (atCentre(x, z, 0.5)) return
    if (onHalf(keep, x, z)) copy.push(i); else drop.push(i)
  })
  return { drop, copy }
}

// ---------------- markers, lights and map settings the AI can change ----------------

export interface MarkerPick { indices?: number[]; type?: string; near?: [number, number, number] }

/** Markers an edit is for: by index, else by type and/or within `near` [x, z, radius]; nothing given means none. */
export function markerTargets(p: Project, a: MarkerPick): number[] {
  if (Array.isArray(a.indices)) return a.indices.filter((i) => Number.isInteger(i) && p.markers[i])
  if (!a.type && !Array.isArray(a.near)) return []
  const [x, z, r] = Array.isArray(a.near) ? a.near : [0, 0, Infinity]
  return p.markers.map((m, i) => [m, i] as const)
    .filter(([m]) => (!a.type || m.type === a.type) && Math.hypot(m.position[0] - x, m.position[2] - z) <= (r || Infinity)).map(([, i]) => i)
}

/** Lights an edit is for: by index, within `near`, or all of them. */
export function lightTargets(p: Project, a: { indices?: number[]; near?: [number, number, number]; all?: boolean }): number[] {
  if (Array.isArray(a.indices)) return a.indices.filter((i) => Number.isInteger(i) && p.lights[i])
  if (a.all) return p.lights.map((_, i) => i)
  if (!Array.isArray(a.near)) return []
  const [x, z, r] = a.near
  return p.lights.map((l, i) => [l, i] as const).filter(([l]) => Math.hypot(l.position[0] - x, l.position[2] - z) <= (r || Infinity)).map(([, i]) => i)
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The marker fields an AI edit may set, checked against the game's lists; what it got wrong goes in `bad`. */
export function markerPatch(a: Record<string, unknown>, lists: { weapons: string[]; vehicles: string[]; chars: string[]; specials: string[] }): { patch: Partial<Marker>; bad: string[] } {
  const patch: Partial<Marker> = {}, bad: string[] = []
  if (finite(a.yaw)) patch.yaw = +((((a.yaw + 180) % 360) + 360) % 360 - 180).toFixed(1)
  if (a.weapon !== undefined) lists.weapons.includes(String(a.weapon)) ? Object.assign(patch, { weapon: String(a.weapon), label: String(a.weapon) }) : bad.push(`unknown weapon "${a.weapon}"`)
  if (a.vehicle !== undefined) lists.vehicles.includes(String(a.vehicle)) ? Object.assign(patch, { vehicle: String(a.vehicle), label: String(a.vehicle) }) : bad.push(`unknown vehicle "${a.vehicle}"`)
  if (a.char_type !== undefined) lists.chars.includes(String(a.char_type)) ? (patch.char_type = String(a.char_type)) : bad.push(`unknown character "${a.char_type}"`)
  if (a.special_type !== undefined) lists.specials.includes(String(a.special_type)) ? (patch.special_type = String(a.special_type)) : bad.push(`unknown special spawn "${a.special_type}"`)
  if (finite(a.radius)) patch.radius = Math.max(0.1, Math.min(200, a.radius))
  if (Array.isArray(a.size) && a.size.length === 3 && a.size.every(finite)) patch.size = a.size.map((v) => Math.max(0.1, Math.min(500, v))) as Vec3
  if (finite(a.delay_ms)) patch.delay_ms = Math.max(0, Math.round(a.delay_ms))
  if (typeof a.label === 'string') patch.label = a.label.slice(0, 64)
  if (typeof a.sound === 'string') patch.sound = a.sound.slice(0, 64)
  if (finite(a.volume)) patch.volume = Math.max(0, Math.min(1, a.volume))
  if (typeof a.disabled === 'boolean') patch.disabled = a.disabled
  return { patch, bad }
}

/** The light fields an AI edit may set (colour 0-1 each). */
export function lightPatch(a: Record<string, unknown>): Partial<Light> {
  const out: Partial<Light> = {}
  if (Array.isArray(a.color) && a.color.length === 3 && a.color.every(finite)) out.color = a.color.map((v) => Math.max(0, Math.min(1, v))) as Vec3
  if (finite(a.intensity)) out.intensity = Math.max(0, Math.min(20, a.intensity))
  if (finite(a.range)) out.range = Math.max(0.5, Math.min(200, a.range))
  if (finite(a.inner_range)) out.inner_range = Math.max(0, Math.min(200, a.inner_range))
  if (typeof a.enabled === 'boolean') out.enabled = a.enabled
  return out
}
