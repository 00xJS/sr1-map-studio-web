// "Spawns and weapons" in the health panel: every spawn and weapon where a player can use it (lib/markerPlan.ts), on
// the open map's real collision. Ones inside something, in the air or on floor nobody can walk to move to the nearest
// usable spot; spawns and weapons are added up to what a full match wants. One undo step.
import { useEditor, currentProject } from './store'
import { solidTriangles } from './stairActions'
import { prepareMap } from '../lib/analysis/analyze'
import { waterAreas } from '../lib/analysis/collision'
import { loadModel } from '../lib/assets'
import type { ObjModel } from '../lib/geometry'
import { planMarkers, type MarkerPlan } from '../lib/markerPlan'
import { newMarker } from '../lib/project'
import { FFA_SPAWNS } from '../lib/levels'

/** Free-for-all spawns and weapons a map should have for a full 12-player match. */
export const WANT = { spawns: Math.max(12, FFA_SPAWNS), weapons: 12 }

export interface SpawnFix { moved: number; added: { spawns: number; weapons: number }; reasons: string[]; floor: number }

/** Plans the fix on the open map and applies it. */
export async function fixSpawnsAndWeapons(): Promise<SpawnFix> {
  const project = currentProject()
  if (!project) return { moved: 0, added: { spawns: 0, weapons: 0 }, reasons: [], floor: 0 }
  const input = await solidTriangles(project)
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
  const plan: MarkerPlan = planMarkers(prep, markers, { ...WANT, wet })
  const back = (p: [number, number, number]) => p.map((v) => +(v / k).toFixed(3)) as [number, number, number]
  const spawns = plan.added.filter((a) => a.type !== 'Weapon pickup').length, weapons = plan.added.length - spawns
  if (plan.moved.length || plan.added.length) {
    useEditor.getState().update('Fix spawns and weapons', (d) => {
      for (const mv of plan.moved) d.markers[mv.index].position = back(mv.to)
      for (const a of plan.added) {
        const m = newMarker(a.type, back(a.at))
        m.yaw = a.yaw
        if (a.weapon) { m.weapon = a.weapon; m.label = a.weapon }
        d.markers.push(m)
      }
    })
  }
  const reasons = [...new Set(plan.moved.map((m) => m.why))]
  useEditor.getState().log(plan.floor
    ? `Spawns and weapons: ${plan.moved.length} moved${reasons.length ? ` (${reasons.join('; ')})` : ''}, ${spawns} spawn${spawns === 1 ? '' : 's'} and ${weapons} weapon${weapons === 1 ? '' : 's'} added.`
    : 'Spawns and weapons: no floor a player can stand on was found.')
  return { moved: plan.moved.length, added: { spawns, weapons }, reasons, floor: plan.floor }
}
