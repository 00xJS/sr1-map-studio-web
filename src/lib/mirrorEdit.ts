// Mirror mode: an edit to one half of a point-symmetric map copied to the other half, in the same undo step. Objects,
// markers and lights pair with their twins across the middle: the same thing at the mirrored spot, turned 180° (red
// and blue spawns swapped). The middle is the one the map checks use (analysis/analyze.ts mirrorCentre), so what
// mirror mode makes is what the fairness check counts as mirrored.
import { freeze } from 'immer'
import { SPAWN_TYPES, referencedPaths, type Light, type Marker, type Project, type SceneItem, type Vec3 } from './project'
import { kindOf, turnedAsTwin, twinType } from './aiEdits'
import { mirrorCentre } from './analysis/analyze'

export type Centre = [number, number]
type Kind = 'scene_items' | 'markers' | 'lights'
type Thing = { uid: string; position: Vec3 }

const wrap = (deg: number) => ((deg % 360) + 360) % 360
const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0
const flip = (p: Vec3, c: Centre): Vec3 => [r4(2 * c[0] - p[0]), p[1], r4(2 * c[1] - p[2])]

/** How each kind of thing pairs and copies. */
interface Spec<T extends Thing> {
  /** How close to the mirrored spot a twin must be (units). */
  tol: number
  /** What it is, and what its twin must be. */
  key(t: T): string
  twinKey(t: T): string
  /** Sitting on the middle it is its own twin (not team spawns: red and blue always pair). */
  selfAtCentre(t: T): boolean
  /** Any other check a twin must pass (height, turn). */
  fits(t: T, o: T): boolean
  /** A twin of `from` across the middle: `onto`'s uid (and group) when it replaces that twin, else a new one. */
  copy(from: T, onto: T | null, c: Centre, newUid: () => string, groups: Map<string, string>): T
  /** The fields a move changes: when nothing else changed, only these go across (no deep copy per drag frame). */
  moved(from: T, onto: T, c: Centre): T
}

const MOVED = new Set(['position', 'rotation', 'scale', 'yaw'])

const ITEMS: Spec<SceneItem> = {
  tol: 1.5,
  key: kindOf,
  twinKey: kindOf,
  selfAtCentre: () => true,
  fits: (t, o) => Math.abs(o.position[1] - t.position[1]) <= 1.5 && turnedAsTwin(t, o),
  copy(from, onto, c, newUid, groups) {
    const t = structuredClone(from)
    t.uid = onto?.uid ?? newUid()
    t.position = flip(from.position, c)
    t.rotation = [from.rotation[0], wrap(from.rotation[1] + 180), from.rotation[2]]
    // Its own group: the twin's, or a new one per group copied.
    const group = onto ? onto.group : from.group ? (groups.get(from.group) ?? groups.set(from.group, newUid()).get(from.group)) : undefined
    if (group) t.group = group; else delete t.group
    return t
  },
  moved: (from, onto, c) => ({ ...onto, position: flip(from.position, c), rotation: [from.rotation[0], wrap(from.rotation[1] + 180), from.rotation[2]], scale: from.scale }),
}

const pickupKey = (m: Marker) => (m.type === 'Weapon pickup' ? m.weapon : '')
const MARKERS: Spec<Marker> = {
  tol: 2,
  key: (m) => `${m.type}|${pickupKey(m)}`,
  twinKey: (m) => `${twinType(m.type)}|${pickupKey(m)}`,
  selfAtCentre: (m) => twinType(m.type) === m.type,
  fits: () => true,
  copy: (from, onto, c, newUid) => ({ ...structuredClone(from), uid: onto?.uid ?? newUid(), type: twinType(from.type), position: flip(from.position, c), yaw: wrap((from.yaw ?? 0) + 180) }),
  moved: (from, onto, c) => ({ ...onto, position: flip(from.position, c), yaw: wrap((from.yaw ?? 0) + 180) }),
}

const LIGHTS: Spec<Light> = {
  tol: 1.5,
  key: () => 'light',
  twinKey: () => 'light',
  selfAtCentre: () => true,
  fits: (t, o) => Math.abs(o.position[1] - t.position[1]) <= 1.5,
  copy: (from, onto, c, newUid) => ({ ...structuredClone(from), uid: onto?.uid ?? newUid(), position: flip(from.position, c) }),
  moved: (from, onto, c) => ({ ...onto, position: flip(from.position, c) }),
}

const SPECS = { scene_items: ITEMS, markers: MARKERS, lights: LIGHTS } as unknown as Record<Kind, Spec<Thing>>

const atCentre = (t: Thing, c: Centre, tol: number) => Math.abs(t.position[0] - c[0]) <= tol && Math.abs(t.position[2] - c[1]) <= tol

/** Twins found through a grid of the list by kind and spot: one pass to build, then each look-up is quick. */
class TwinIndex<T extends Thing> {
  private grid = new Map<string, number[]>()
  private keys: string[]
  constructor(private list: T[], private spec: Spec<T>, private c: Centre) {
    this.keys = list.map((t) => spec.key(t))
    list.forEach((t, j) => {
      const k = `${this.keys[j]}|${this.cell(t.position[0])}|${this.cell(t.position[2])}`
      const at = this.grid.get(k)
      if (at) at.push(j); else this.grid.set(k, [j])
    })
  }
  private cell(v: number) { return Math.floor(v / this.spec.tol) }
  /** The index of `i`'s twin: `i` itself on the middle, null when it has none. `skip`: uids that don't count. */
  find(i: number, skip?: Set<string>): number | null {
    const t = this.list[i], { spec, c } = this
    if (spec.selfAtCentre(t) && atCentre(t, c, spec.tol)) return i
    const want = spec.twinKey(t)
    const x = 2 * c[0] - t.position[0], z = 2 * c[1] - t.position[2]
    let best: number | null = null, bestD = Infinity
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const j of this.grid.get(`${want}|${this.cell(x) + a}|${this.cell(z) + b}`) ?? []) {
        const o = this.list[j]
        if (j === i || skip?.has(o.uid)) continue
        const d = Math.hypot(o.position[0] - x, o.position[2] - z)
        if (d <= spec.tol && d < bestD && spec.fits(t, o)) { best = j; bestD = d }
      }
    }
    return best
  }
}

/**
 * Who pairs with whom while one edit lasts: a gizmo drag is many updates, and its pairs are found once, at the start,
 * then kept by uid. Re-finding them every frame would lose a twin the moment the dragged thing crosses the middle.
 */
export interface MirrorSession {
  projectId: string
  centre: Centre
  /** uid → its twin's uid (its own on the middle, '' for none). */
  pairs: Record<Kind, Map<string, string>>
  /** Twins this session made for things moved off the middle (taken away again if they go back). */
  made: Set<string>
  /** Twins taken away when the thing they mirror reached the middle, by that thing's uid, with where they were in the
   *  list: if it leaves the middle in the same drag, its own twin comes back (its uid and paint), not a fresh copy. */
  parked: Record<Kind, Map<string, { twin: Thing; index: number }>>
}

/** The middle mirror mode turns about on this map now: the fairness check's (the middle of the spawns), or the origin
 *  with fewer than two spawns (one spawn, or a few weapons, says nothing about where the middle is; maps are built round
 *  the origin, and opened ones are centred on their bounds). */
export function centreOf(p: Project): Centre {
  if (p.markers.filter((m) => SPAWN_TYPES.includes(m.type)).length < 2) return [0, 0]
  const [x, z] = mirrorCentre(p.markers)
  const r3 = (v: number) => Math.round(v * 1000) / 1000 + 0
  return [r3(x), r3(z)]
}

/** A new session about `centre` (by default the map's middle now). */
export function mirrorSession(p: Project, centre: Centre = centreOf(p)): MirrorSession {
  return { projectId: p.id, centre, pairs: { scene_items: new Map(), markers: new Map(), lights: new Map() }, made: new Set(), parked: { scene_items: new Map(), markers: new Map(), lights: new Map() } }
}

/** Has `a` changed in more than where it is and how it's turned (its size, paint or settings)? */
function changedMore(a: object, b: object): boolean {
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>
  for (const k in x) if (!MOVED.has(k) && x[k] !== y[k]) return true
  for (const k in y) if (!(k in x)) return true
  return false
}

/** `set`: twin uid → the edited thing it copies, and that thing before the edit. `back`: parked twins returning. */
interface ListPlan {
  set: Map<string, { from: Thing; prev: Thing }>; drop: Set<string>; add: Thing[]; at: Map<string, number>
  back: { from: Thing; twin: Thing; index: number }[]
}

/** What one list needs across the middle, comparing the edit's result with `before` by reference: what the edit left
 *  alone is the same object, so only what it touched is looked at. */
function plan(kind: Kind, before: Thing[], after: Thing[], s: MirrorSession): ListPlan | null {
  if (before === after) return null
  const spec = SPECS[kind], pairs = s.pairs[kind], c = s.centre
  const was = new Map<string, number>()
  before.forEach((t, i) => was.set(t.uid, i))
  // Most edits (a drag) keep the list's order: then one map serves both.
  const sameOrder = before.length === after.length && after.every((t, j) => t.uid === before[j].uid)
  const now = sameOrder ? was : new Map<string, number>()
  if (!sameOrder) after.forEach((t, j) => now.set(t.uid, j))
  const touched = (uid: string) => { const i = was.get(uid), j = now.get(uid); return i === undefined || j === undefined || before[i] !== after[j] }
  let index: TwinIndex<Thing> | null = null
  const twinOf = (i: number): string => {
    const uid = before[i].uid
    let t = pairs.get(uid)
    if (t === undefined) {
      index ??= new TwinIndex(before, spec, c)
      const j = index.find(i)
      t = j === null ? '' : before[j].uid
      pairs.set(uid, t)
      if (t && t !== uid) pairs.set(t, uid)
    }
    return t
  }
  const out: ListPlan = { set: new Map(), drop: new Set(), add: [], at: now, back: [] }
  const parked = s.parked[kind]
  before.forEach((b, i) => {
    const j = now.get(b.uid)
    if (j === undefined) {
      const t = twinOf(i)
      if (t && t !== b.uid && !touched(t)) out.drop.add(t)
      return
    }
    const a = after[j]
    if (a === b) return
    const t = twinOf(i)
    if (t === b.uid) {
      // It was on the middle, its own twin: moved off it, it gets its twin back (from earlier in this drag) or a new one.
      if (!(spec.selfAtCentre(a) && atCentre(a, c, spec.tol))) {
        const p = parked.get(b.uid)
        if (p) { out.back.push({ from: a, ...p }); parked.delete(b.uid) } else out.add.push(a)
      }
    } else if (t && !touched(t)) {
      // Onto the middle, where a thing is its own twin: its twin would sit on top of it, so the two become one (until
      // it leaves the middle again in the same drag).
      if (spec.selfAtCentre(a) && atCentre(a, c, spec.tol)) {
        const k = was.get(t)
        if (k !== undefined) parked.set(b.uid, { twin: before[k], index: k })
        out.drop.add(t); pairs.set(b.uid, b.uid); pairs.delete(t)
      } else out.set.set(t, { from: a, prev: b })
    }
  })
  // New things without a twin among what stays (a twin about to go doesn't count: a rebuild under a new uid replaces
  // its twin with a mirrored copy of the rebuild).
  if (!sameOrder && after.some((a) => !was.has(a.uid))) {
    const kept = after.filter((a) => !out.drop.has(a.uid))
    const keptIndex = new TwinIndex(kept, spec, c)
    kept.forEach((a, k) => { if (!was.has(a.uid) && keptIndex.find(k) === null) out.add.push(a) })
  }
  return out.set.size || out.drop.size || out.add.length || out.back.length ? out : null
}

/**
 * Runs after an edit, on its result: makes the same change across the middle and returns the project with both (or
 * `after` itself when nothing needs a twin). A moved or turned thing moves its twin to the mirrored spot; one resized,
 * repainted or with new settings gives its twin the same; a new thing gets a twin (unless it sits on the middle or the
 * edit already made one); a deleted one takes its twin with it. Twins the edit changed itself (both picked, say) are
 * left as the edit made them.
 */
export function mirrorEdit(before: Project, after: Project, newUid: () => string, s: MirrorSession): Project {
  const plans = (['scene_items', 'markers', 'lights'] as Kind[]).map((k) => [k, plan(k, before[k], after[k], s)] as const)
  if (!plans.some(([, p]) => p)) return after
  // Built by hand rather than through immer: a drag frame moves hundreds of twins, and immer finalising each new
  // object cost as much again as the edit itself. Lists are copied once; what isn't a twin stays the same object.
  const out = { ...after } as Project
  const oldPaths: string[] = []
  const groups = new Map<string, string>()
  for (const [kind, p] of plans) {
    if (!p) continue
    const spec = SPECS[kind], pairs = s.pairs[kind], was = after[kind] as Thing[]
    let list = was.slice()
    for (const [uid, { from, prev }] of p.set) {
      const k = p.at.get(uid)!, onto = was[k]
      if (!changedMore(from, prev)) { list[k] = freeze(spec.moved(from, onto, s.centre), true); continue }
      const path = (onto as Partial<SceneItem>).path
      if (path && path !== (from as Partial<SceneItem>).path) oldPaths.push(path)
      list[k] = freeze(spec.copy(from, onto, s.centre, newUid, groups), true)
    }
    if (p.drop.size) list = list.filter((t) => !p.drop.has(t.uid))
    for (const { from, twin, index } of p.back) {
      list.splice(Math.min(index, list.length), 0, freeze(spec.moved(from, twin, s.centre), true))
      pairs.set(from.uid, twin.uid)
      pairs.set(twin.uid, from.uid)
    }
    for (const a of p.add) {
      const t = freeze(spec.copy(a, null, s.centre, newUid, groups), true)
      list.push(t)
      pairs.set(a.uid, t.uid)
      pairs.set(t.uid, a.uid)
      s.made.add(t.uid)
    }
    ;(out as unknown as Record<Kind, Thing[]>)[kind] = freeze(list)
  }
  // A twin rebuilt like the edited one (a resized shape) no longer needs its old model's file.
  if (oldPaths.length) {
    const live = new Set(referencedPaths(out))
    out.files = freeze(Object.fromEntries(Object.entries(out.files).filter(([path]) => live.has(path) || !oldPaths.includes(path))))
  }
  return freeze(out)
}

/** Live numbers for mirror mode: how many objects, markers and lights have their twin across the middle. */
export function symmetryOf(p: Project, c: Centre = centreOf(p)) {
  const count = <T extends Thing>(list: T[], spec: Spec<T>) => { const index = new TwinIndex(list, spec, c); return list.reduce((n, _, i) => n + (index.find(i) === null ? 0 : 1), 0) }
  return {
    objects: count(p.scene_items, ITEMS), totalObjects: p.scene_items.length,
    markers: count(p.markers, MARKERS), totalMarkers: p.markers.length,
    lights: count(p.lights, LIGHTS), totalLights: p.lights.length,
  }
}
