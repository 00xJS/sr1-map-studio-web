// Mirror mode: an edit to one half of a point-symmetric map copied to the other half, in the same step. Objects and
// markers pair with their twins across the middle as aiEdits.ts finds them (at -x, -z, turned 180°; red and blue
// spawns swapped), the same turn about the origin the map checks use (analysis/analyze.ts mirrorCheck).
import { current, isDraft, type Draft } from 'immer'
import type { Marker, Project, SceneItem, Vec3 } from './project'
import { countTwinned, findMarkerTwin, findTwin, twinItem, twinMarker } from './aiEdits'

const wrap = (deg: number) => ((deg % 360) + 360) % 360
const flip = (p: Vec3): Vec3 => [-p[0] + 0, p[1], -p[2] + 0]
const same = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

export interface MirrorResult { moved: number; added: number; removed: number }

/**
 * Runs after an edit's recipe, inside the same produce: compares the draft with `before` by uid and makes the same
 * change across the middle. A moved, turned or resized object moves its twin to the mirrored spot; a new object or
 * marker gets a twin (unless it sits on the centre or the edit already added one); a deleted one takes its twin with
 * it. Twins the edit changed itself (both selected, say) are left as the edit made them. Lights have no twins.
 */
export function mirrorEdit(before: Project, d: Draft<Project>, newUid: () => string): MirrorResult {
  // The draft read as it stands (reading makes no change); only the new things are copied out of it.
  const after = d as unknown as Project
  const out: MirrorResult = { moved: 0, added: 0, removed: 0 }
  const items = pass<SceneItem>(before.scene_items, after.scene_items, {
    twin: (list, i) => findTwin({ ...before, scene_items: list }, i),
    moved: (a, b) => !same(a.position, b.position) || !same(a.rotation, b.rotation) || a.scale !== b.scale,
  })
  const markers = pass<Marker>(before.markers, after.markers, {
    twin: (list, i) => findMarkerTwin({ ...before, markers: list }, i),
    moved: (a, b) => !same(a.position, b.position) || a.yaw !== b.yaw || a.weapon !== b.weapon,
  })

  for (const [uid, from] of items.move) {
    const t = d.scene_items.find((x) => x.uid === uid)
    if (!t) continue
    t.position = flip(from.position)
    t.rotation = [from.rotation[0], wrap(from.rotation[1] + 180), from.rotation[2]]
    t.scale = from.scale
    out.moved++
  }
  for (const [uid, from] of markers.move) {
    const t = d.markers.find((x) => x.uid === uid)
    if (!t) continue
    t.position = flip(from.position)
    t.yaw = wrap((from.yaw ?? 0) + 180)
    if (from.type === 'Weapon pickup') t.weapon = from.weapon
    out.moved++
  }
  if (items.drop.size) d.scene_items = d.scene_items.filter((x) => !items.drop.has(x.uid))
  if (markers.drop.size) d.markers = d.markers.filter((x) => !markers.drop.has(x.uid))
  out.removed = items.drop.size + markers.drop.size
  // Grouped objects' twins share a group of their own, one per group.
  const groups = new Map<string, string>()
  const plain = <T,>(x: T): T => (isDraft(x) ? current(x) : x)
  for (const it of items.add) d.scene_items.push(twinItem(plain(it), newUid, groups))
  for (const m of markers.add) d.markers.push(twinMarker(plain(m), newUid))
  out.added = items.add.length + markers.add.length
  return out
}

/** What one list (objects or markers) needs across the middle: twins to move (by uid, to mirror what), to drop, and
 *  new things that need a twin. */
function pass<T extends { uid: string }>(before: T[], after: T[], how: { twin: (list: T[], i: number) => number | null; moved: (a: T, b: T) => boolean }) {
  const was = new Map(before.map((x, i) => [x.uid, i]))
  const now = new Map(after.map((x, i) => [x.uid, i]))
  // Touched by the edit itself: new, gone, or moved.
  const touched = (uid: string) => !was.has(uid) || !now.has(uid) || how.moved(after[now.get(uid)!], before[was.get(uid)!])
  const twinUid = (i: number) => { const j = how.twin(before, i); return j === null || j === i ? null : before[j].uid }
  const move = new Map<string, T>(), drop = new Set<string>()
  before.forEach((b, i) => {
    const j = now.get(b.uid)
    if (j === undefined) {
      const t = twinUid(i)
      if (t && !touched(t)) drop.add(t)
    } else if (how.moved(after[j], b)) {
      const t = twinUid(i)
      if (t && !touched(t)) move.set(t, after[j])
    }
  })
  // New things without a twin among what stays (a twin about to be dropped doesn't count: a rebuild under a new uid
  // replaces its twin with a mirrored copy of the rebuild).
  const kept = after.filter((x) => !drop.has(x.uid))
  const add = kept.filter((x, i) => !was.has(x.uid) && how.twin(kept, i) === null)
  return { move, drop, add }
}

/** Live numbers for mirror mode: how many objects and markers have their twin across the middle. */
export function symmetryOf(p: Project) {
  const markers = p.markers.reduce((n, _, i) => n + (findMarkerTwin(p, i) === null ? 0 : 1), 0)
  return { objects: countTwinned(p), totalObjects: p.scene_items.length, markers, totalMarkers: p.markers.length }
}
