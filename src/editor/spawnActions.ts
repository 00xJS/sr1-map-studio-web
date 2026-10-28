// "Spawns and weapons" in the health panel: every spawn and weapon where a player can use it (lib/markerPlan.ts), on
// the open map's real collision. Ones inside something, in the air or on floor nobody can walk to move to the nearest
// usable spot; spawns and weapons are added up to what a full match wants. One undo step.
import { useEditor, currentProject, editEpoch, stillCurrent } from './store'
import { isRamps, solidTriangles } from './stairActions'
import { prepareMap } from '../lib/analysis/analyze'
import { collisionFromProject, waterAreas } from '../lib/analysis/collision'
import { findStairs, rampPieces, scaleRuns } from '../lib/stairRamps'
import { compoundObj } from '../lib/shapes'
import { parseObj } from '../lib/geometry'
import { loadModel } from '../lib/assets'
import type { ObjModel } from '../lib/geometry'
import { planMarkers, type MarkerPlan } from '../lib/markerPlan'
import { newMarker, type Project, type SceneItem, type Vec3 } from '../lib/project'
import { FFA_SPAWNS } from '../lib/levels'

/** Free-for-all spawns and weapons a map should have for a full 12-player match. */
export const WANT = { spawns: Math.max(12, FFA_SPAWNS), weapons: 12 }

export interface SpawnFix { moved: number; added: { spawns: number; weapons: number }; reasons: string[]; floor: number }

/** What the fix would do to a project, in its own units: markers to move and markers to add. `uids` are the
 *  planned project's markers, in the order the plan's indices count them. */
export interface SpawnFixPlan { plan: MarkerPlan; scale: number; uids: string[] }

/**
 * The invisible ramps the map's checks will put over stairs too tall to run up (stairActions.ts addStairRamps), as
 * collision only: so a map planned before they are added doesn't count the floors up those stairs as out of reach.
 */
function rampCollision(project: Project, input: { tris: Float32Array; flags: Uint8Array }) {
  const k = (project.settings.world_scale || 0.5) / 0.5
  const runs = scaleRuns(findStairs(k === 1 ? input.tris : input.tris.map((v) => v * k), input.flags), 1 / k)
  if (!runs.length) return null
  const mat = 'stair_ramp'
  const origin: Vec3 = [0, 0, 0]
  const model = parseObj(compoundObj(rampPieces(runs, origin, mat)))
  const item: SceneItem = { uid: 'ramps', name: 'ramps', path: '/ramps', position: origin, rotation: [0, 0, 0], scale: 1, textures: {}, alpha: { [mat]: true } }
  return collisionFromProject({ ...project, scene_items: [item], markers: [] }, () => model)
}

/**
 * Plans the fix on a project's real collision without touching it (the editor's open map, or a map just built and
 * not open yet). Reads the project's models from this device. With `ramps`, it plans for the map as it will be once
 * its stairs get their invisible ramps (a map whose checks run when it opens).
 */
export async function planSpawnFix(project: Project, opts: { ramps?: boolean } = {}): Promise<SpawnFixPlan> {
  let input = await solidTriangles(project, opts.ramps ? (it) => !isRamps(it) : undefined)
  const extra = opts.ramps ? rampCollision(project, input) : null
  if (extra) {
    const tris = new Float32Array(input.tris.length + extra.tris.length), flags = new Uint8Array(input.flags.length + extra.flags.length)
    tris.set(input.tris); tris.set(extra.tris, input.tris.length)
    flags.set(input.flags); flags.set(extra.flags, input.flags.length)
    input = { ...input, tris, flags }
  }
  // The planner works in the usual editor units (0.5 m each): a map at another world scale is measured in game metres.
  const k = (project.settings.world_scale || 0.5) / 0.5
  const markers = project.markers.map((m) => ({ type: m.type, position: m.position.map((v) => v * k) as typeof m.position, weapon: m.weapon }))
  const prep = prepareMap({ tris: k === 1 ? input.tris : input.tris.map((v) => v * k), flags: input.flags, markers }, { cell: 2 })
  // Water objects: their seabed is no place for a spawn or a gun.
  const wetModels = new Map<string, ObjModel>()
  await Promise.all([...new Set(project.scene_items.filter((it) => it.swimmable_water).map((it) => it.path))].map(async (p) => {
    try { wetModels.set(p, await loadModel(project, p)) } catch { /* missing: left out */ }
  }))
  const wet = waterAreas(project, (p) => wetModels.get(p)).map((a) => a.map((v) => v * k) as typeof a)
  return { plan: planMarkers(prep, markers, { ...WANT, wet }), scale: k, uids: project.markers.map((m) => m.uid) }
}

/** Makes the planned moves and additions on `d` (a draft inside an undo step, or a project not open yet). */
export function applySpawnFix(d: Project, { plan, scale: k, uids }: SpawnFixPlan) {
  const back = (p: [number, number, number]) => p.map((v) => +(v / k).toFixed(3)) as [number, number, number]
  // By uid: a marker added, deleted or reordered since the plan was made moves only itself (or nothing).
  for (const mv of plan.moved) {
    const m = d.markers.find((x) => x.uid === uids[mv.index])
    if (m) m.position = back(mv.to)
  }
  for (const a of plan.added) {
    const m = newMarker(a.type, back(a.at))
    m.yaw = a.yaw
    if (a.weapon) { m.weapon = a.weapon; m.label = a.weapon }
    d.markers.push(m)
  }
}

/** What a plan comes to, for the build log. */
export function spawnFixSummary({ plan }: SpawnFixPlan): SpawnFix & { text: string } {
  const spawns = plan.added.filter((a) => a.type !== 'Weapon pickup').length, weapons = plan.added.length - spawns
  const reasons = [...new Set(plan.moved.map((m) => m.why))]
  const text = plan.floor
    ? `Spawns and weapons: ${plan.moved.length} moved${reasons.length ? ` (${reasons.join('; ')})` : ''}, ${spawns} spawn${spawns === 1 ? '' : 's'} and ${weapons} weapon${weapons === 1 ? '' : 's'} added.`
    : 'Spawns and weapons: no floor a player can stand on was found.'
  return { moved: plan.moved.length, added: { spawns, weapons }, reasons, floor: plan.floor, text }
}

/** Plans the fix on the open map and applies it. */
export async function fixSpawnsAndWeapons(): Promise<SpawnFix> {
  const project = currentProject()
  if (!project) return { moved: 0, added: { spawns: 0, weapons: 0 }, reasons: [], floor: 0 }
  const run = editEpoch()
  const fix = await planSpawnFix(project)
  // A map was opened (or Fix all stopped) while it planned: this plan is not about it.
  stillCurrent(run)
  if (fix.plan.moved.length || fix.plan.added.length) useEditor.getState().update('Fix spawns and weapons', (d) => applySpawnFix(d, fix))
  const { text, ...out } = spawnFixSummary(fix)
  useEditor.getState().log(text)
  return out
}
