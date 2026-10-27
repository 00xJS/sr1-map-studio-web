// Physics props: "put a model in, give it weight, and it flies around in game".
//
// In game a prop is a native object (see py/physics_props.py): its weight,
// bounce, friction and health come from one of the game's own stock object
// profiles (a map can't set its own numbers), and the exporter writes a
// collision shape that fits the model. The numbers below are rough figures
// for the browser preview (walk-through) only; the game uses its own table.
import { isCustomNative, isGlass, isProp, type Project, type SceneItem } from './project'

export type PhysicsShape = 'box' | 'sphere' | 'cylinder' | 'hull' | 'parts'

export interface PhysicsPreset {
  key: string
  label: string
  /** One line for the button / list. */
  hint: string
  /** Exporter behaviour: a movable prop, or the explosive (propane) prop with its blast effect. */
  behavior: 'movable' | 'explosive'
  /** Stock object profile the game looks up by name. */
  profile: string
  shape: PhysicsShape
  /** Preview only: rough feel of the stock profile. */
  lb: number
  bounce: number
  friction: number
  /** Linear and angular damping. */
  damping: [number, number]
  hp: number
  /** What damages it: b = bullets, x = explosions. Empty = can't be hurt. */
  hurtBy: '' | 'b' | 'x' | 'bx'
  /** Destroyed at 0 health: it vanishes (or explodes). Otherwise it just keeps going. */
  breaks: boolean
  /** Blast when destroyed: radius in metres and push strength. */
  blast?: { radius: number; force: number }
  /** Players can shove it by walking into it. */
  pushable: boolean
}

export const PHYSICS_PRESETS: PhysicsPreset[] = [
  { key: 'light_crate', label: 'Light crate', hint: '20 lb. Shoved by players, shots and blasts; never breaks.', behavior: 'movable', profile: 'Crate Small', shape: 'box', lb: 20, bounce: 0, friction: 1, damping: [0.01, 0.05], hp: 50, hurtBy: 'bx', breaks: false, pushable: true },
  { key: 'cardboard', label: 'Cardboard box', hint: '15 lb. Light and easy to send flying.', behavior: 'movable', profile: "Cardboard Box  1'x1'x1'", shape: 'box', lb: 15, bounce: 0.05, friction: 0.5, damping: [0.01, 0.05], hp: 100, hurtBy: 'bx', breaks: false, pushable: true },
  { key: 'wood_block', label: 'Wood block', hint: '10 lb. Good for stacking towers.', behavior: 'movable', profile: "Wood Object 1'x1'x1'", shape: 'box', lb: 10, bounce: 0.05, friction: 0.5, damping: [0.01, 0.05], hp: 100, hurtBy: 'bx', breaks: false, pushable: true },
  { key: 'metal_block', label: 'Metal block', hint: '10 lb, grippy metal.', behavior: 'movable', profile: "Iron Object 1'x1'x1'", shape: 'box', lb: 10, bounce: 0.05, friction: 0.7, damping: [0.01, 0.05], hp: 100, hurtBy: 'bx', breaks: false, pushable: true },
  { key: 'heavy', label: 'Heavy', hint: '500 lb. Players can lean on it; blasts nudge it.', behavior: 'movable', profile: 'CableSpool', shape: 'hull', lb: 500, bounce: 0, friction: 1, damping: [0.01, 0.05], hp: 50, hurtBy: 'bx', breaks: false, pushable: true },
  { key: 'very_heavy', label: 'Very heavy', hint: '2000 lb. Players can\'t push it; only cars and big blasts.', behavior: 'movable', profile: 'Log Timber', shape: 'hull', lb: 2000, bounce: 0, friction: 0.8, damping: [0.01, 0.05], hp: 100, hurtBy: 'x', breaks: false, pushable: false },
  { key: 'rolls', label: 'Rolls', hint: 'A tire: 10 lb, rolls and bounces.', behavior: 'movable', profile: 'Tire', shape: 'cylinder', lb: 10, bounce: 0.5, friction: 0.5, damping: [0.01, 0.05], hp: 50, hurtBy: 'bx', breaks: false, pushable: true },
  { key: 'trash_can', label: 'Trash can', hint: '50 lb, tips over and rolls; can\'t be destroyed.', behavior: 'movable', profile: 'Trashcan', shape: 'cylinder', lb: 50, bounce: 0.05, friction: 0.5, damping: [0.05, 0.1], hp: 100, hurtBy: '', breaks: false, pushable: true },
  { key: 'ball', label: 'Bouncy ball', hint: '4 lb, very bouncy; can\'t be destroyed.', behavior: 'movable', profile: 'Red Ball', shape: 'sphere', lb: 4, bounce: 1, friction: 0.5, damping: [0.01, 0.05], hp: 1, hurtBy: '', breaks: false, pushable: true },
  { key: 'soccer', label: 'Soccer ball', hint: '5 lb, rolls far.', behavior: 'movable', profile: 'SoccerBall', shape: 'sphere', lb: 5, bounce: 0.05, friction: 0.5, damping: [0.1, 0.2], hp: 100, hurtBy: 'bx', breaks: false, pushable: true },
  { key: 'explodes', label: 'Explodes', hint: 'A propane tank: 10 lb, blows up when shot or caught in a blast (5 m), setting off others.', behavior: 'explosive', profile: 'Propanesmall', shape: 'cylinder', lb: 10, bounce: 0, friction: 1, damping: [0.01, 0.05], hp: 75, hurtBy: 'bx', breaks: true, blast: { radius: 5, force: 10000 }, pushable: true },
  { key: 'breaks', label: 'Breaks', hint: '7 lb, vanishes after a couple of shots (no debris).', behavior: 'movable', profile: 'Can', shape: 'box', lb: 7, bounce: 0.05, friction: 1, damping: [0.01, 3], hp: 50, hurtBy: 'bx', breaks: true, pushable: true },
  { key: 'breaks_blast', label: 'Breaks in blasts', hint: '4 lb, bullet-proof; vanishes in an explosion.', behavior: 'movable', profile: 'SofaPillow', shape: 'box', lb: 4, bounce: 0.1, friction: 0.7, damping: [1, 0.05], hp: 50, hurtBy: 'x', breaks: true, pushable: true },
]

export const PRESET_BY_KEY: Record<string, PhysicsPreset> = Object.fromEntries(PHYSICS_PRESETS.map((p) => [p.key, p]))

/**
 * More stock objects, from v1.15's library in the player's own data pack (lib/propLibrary.ts): keys start with
 * "lib_". Empty until it has been read, and on a v1.13 data pack.
 */
export const LIBRARY_PRESETS: PhysicsPreset[] = []

export function setLibraryPresets(list: PhysicsPreset[]) {
  for (const p of LIBRARY_PRESETS) delete PRESET_BY_KEY[p.key]
  LIBRARY_PRESETS.splice(0, LIBRARY_PRESETS.length, ...list)
  for (const p of list) PRESET_BY_KEY[p.key] = p
}

/** An object made from a library preset while the library isn't loaded: its profile still goes to the exporter. */
function missingLibraryPreset(key: string, profile: string): PhysicsPreset {
  return { key, label: profile, hint: "A stock object from the v1.15 package's library, which isn't in this browser's data pack: it exports as a light crate until it is.",
    behavior: 'movable', profile, shape: 'box', lb: 20, bounce: 0, friction: 1, damping: [0.01, 0.05], hp: 50, hurtBy: 'bx', breaks: false, pushable: true }
}

export const PHYSICS_SHAPES: { key: PhysicsShape; label: string; hint: string }[] = [
  { key: 'box', label: 'Box', hint: 'A box around the model. Stacks well.' },
  { key: 'sphere', label: 'Ball', hint: 'A ball around the model. Rolls in every direction.' },
  { key: 'cylinder', label: 'Cylinder', hint: 'Round across its roundest side. Rolls like a tire or barrel.' },
  { key: 'hull', label: 'Wrapped', hint: 'Shrink-wrapped around the model (up to 64 corners). Tumbles like its real shape.' },
  { key: 'parts', label: 'Separate parts', hint: 'One wrapped shape per separate piece of the model (up to 15).' },
]

/** Native objects (physics props, breakables, glass) one map can hold. The game itself allows about 310 moving objects. */
export const OBJECT_BUDGET = 96
export const GAME_MOVER_CAP = 310
export const MAX_PARTS = 15

/** The preset an item uses: its own choice, else the one its stock profile belongs to. */
export function presetOf(it: SceneItem): PhysicsPreset | null {
  if (!isProp(it) && !(isCustomNative(it) && it.native_breakable_kind === 'wood')) return null
  const key = it.physics_preset as string | undefined
  if (key && PRESET_BY_KEY[key]) return PRESET_BY_KEY[key]
  if (it.native_prop_behavior === 'explosive') return PRESET_BY_KEY.explodes
  const profile = it.native_profile || (it.native_prop_behavior ? 'Crate Small' : 'Can')
  return PHYSICS_PRESETS.find((p) => p.profile === profile && p.behavior === 'movable')
    ?? LIBRARY_PRESETS.find((p) => p.profile === profile)
    ?? (key?.startsWith('lib_') && it.native_profile ? missingLibraryPreset(key, it.native_profile) : null)
}

export const shapeOf = (it: SceneItem): PhysicsShape => (it.physics_shape as PhysicsShape | undefined) ?? 'box'

export interface PhysicsCount {
  /** Native objects in the map: props, breakables and glass. */
  objects: number
  props: number
  /** Different models among them (each needs a free render slot in the map). */
  models: number
  /** Plain-language warnings, empty when all is fine. */
  warnings: string[]
}

export function countPhysics(p: Project): PhysicsCount {
  const natives = p.scene_items.filter(isGlass)
  const props = natives.filter((it) => isProp(it) || (isCustomNative(it) && it.native_breakable_kind === 'wood'))
  const models = new Set(natives.map((it) => isCustomNative(it) ? JSON.stringify([it.native_mesh_obj ?? it.path, it.glass_custom_texture, it.scale]) : 'glass:' + (it.glass_custom_texture ?? it.glass_style))).size
  const warnings: string[] = []
  if (natives.length > OBJECT_BUDGET) warnings.push(`${natives.length} physics props, breakables and glass panes: the exporter takes at most ${OBJECT_BUDGET}. Turn some back into normal objects.`)
  else if (natives.length > OBJECT_BUDGET * 0.85) warnings.push(`${natives.length} of ${OBJECT_BUDGET} physics objects used.`)
  if (models > 40) warnings.push(`${models} different prop models: each needs a free render slot in the map, so a big map may run out. Reuse the same model (copies are free).`)
  return { objects: natives.length, props: props.length, models, warnings }
}

// ---------------- shapes (the same fitting rules as py/physics_props.py) ----------------

export type P3 = [number, number, number]

export function bounds(points: P3[]): [P3, P3] {
  const lo: P3 = [Infinity, Infinity, Infinity], hi: P3 = [-Infinity, -Infinity, -Infinity]
  for (const p of points) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]) }
  return [lo, hi]
}

/** The axis a cylinder fitted to this box runs along: the one whose cross-section is most nearly round. */
export function cylinderAxis(lo: P3, hi: P3): 0 | 1 | 2 {
  const size = [0, 1, 2].map((k) => Math.max(hi[k] - lo[k], 1e-9))
  const score = (k: number) => {
    const [a, b] = [0, 1, 2].filter((j) => j !== k).map((j) => size[j])
    return [Math.abs(a - b) / Math.max(a, b), size[k]]
  }
  let best: 0 | 1 | 2 = 0
  for (const k of [1, 2] as const) {
    const [r, s] = score(k), [rb, sb] = score(best)
    if (r < rb - 1e-12 || (Math.abs(r - rb) <= 1e-12 && s < sb)) best = k
  }
  return best
}

export function cylinderPoints(lo: P3, hi: P3, sides = 16): P3[] {
  const axis = cylinderAxis(lo, hi)
  const [u, v] = [0, 1, 2].filter((k) => k !== axis)
  const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2)
  const out: P3[] = []
  for (const end of [lo[axis], hi[axis]]) {
    for (let i = 0; i < sides; i++) {
      const a = (2 * Math.PI * (i + 0.5)) / sides
      const p: P3 = [0, 0, 0]
      p[axis] = end
      p[u] = c[u] + ((hi[u] - lo[u]) / 2) * Math.cos(a)
      p[v] = c[v] + ((hi[v] - lo[v]) / 2) * Math.sin(a)
      out.push(p)
    }
  }
  return out
}

/** Separate pieces of a mesh (vertices welded by position): lists of vertex indices. */
export function pieces(verts: P3[], tris: ArrayLike<number>): number[][] {
  const parent = verts.map((_, i) => i)
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  const join = (a: number, b: number) => { a = find(a); b = find(b); if (a !== b) parent[b] = a }
  const seen = new Map<string, number>()
  verts.forEach((v, i) => {
    const k = v.map((x) => Math.round(x * 1e5)).join(',')
    const j = seen.get(k)
    if (j === undefined) seen.set(k, i)
    else join(j, i)
  })
  for (let t = 0; t + 2 < tris.length; t += 3) { join(tris[t], tris[t + 1]); join(tris[t], tris[t + 2]) }
  const groups = new Map<number, Set<number>>()
  for (let t = 0; t < tris.length; t++) {
    const r = find(tris[t])
    if (!groups.has(r)) groups.set(r, new Set())
    groups.get(r)!.add(tris[t])
  }
  return [...groups.values()].map((g) => [...g].sort((a, b) => a - b))
}

const boxVolume = (pts: P3[]) => { const [lo, hi] = bounds(pts); return Math.max(1e-9, (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2])) }

/** Merges the pieces whose joined box grows least until at most `limit` are left. */
export function mergePieces(groups: P3[][], limit = MAX_PARTS): P3[][] {
  const out = groups.map((g) => [...g])
  while (out.length > limit) {
    let best: [number, number, number] | null = null
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const grow = boxVolume([...out[i], ...out[j]]) - boxVolume(out[i]) - boxVolume(out[j])
        if (!best || grow < best[0]) best = [grow, i, j]
      }
    }
    const [, i, j] = best!
    out[i].push(...out.splice(j, 1)[0])
  }
  return out
}
