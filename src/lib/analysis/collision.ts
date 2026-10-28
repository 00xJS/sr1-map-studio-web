// The map's collision as world triangles for the health checks, from the
// project and its parsed models. Follows what the exporter makes solid:
// objects marked pass-through, faces excluded from collision and swimmable
// water are left out; glass and see-through (alpha) materials block players
// but not sight.
import { exportMatName, transformPoint, type ObjModel } from '../geometry'
import { isGlass, type Project, type SceneItem } from '../project'
import { OPAQUE, SOLID, type AnalysisInput, type AnalysisMarker } from './types'

const KINDS = ['Shared spawn', 'Red team spawn', 'Blue team spawn', 'Weapon pickup', 'Chains drop-off']

/** Collision triangles and the markers the checks look at. `model(path)` returns a parsed model (undefined: missing). */
export function collisionFromProject(project: Project, model: (path: string) => ObjModel | undefined): AnalysisInput {
  const tris: number[] = []
  const flags: number[] = []
  for (const it of project.scene_items) {
    if (it.collision_disabled) continue
    if (it.swimmable_water && !it.water_materials?.length) continue
    const mdl = model(it.path)
    if (!mdl) continue
    addItem(it, mdl, tris, flags)
  }
  const markers: AnalysisMarker[] = project.markers
    .filter((mk) => KINDS.includes(mk.type))
    .map((mk) => ({ type: mk.type, position: mk.position, uid: mk.uid, ...(mk.type === 'Weapon pickup' ? { weapon: mk.weapon } : /spawn/i.test(mk.type) ? { yaw: mk.yaw } : {}) }))
  return { tris: Float32Array.from(tris), flags: Uint8Array.from(flags), markers }
}

/** Each swimmable water object's area and surface, editor units: [x0, z0, x1, z1, surface]. */
export function waterAreas(project: Project, model: (path: string) => ObjModel | undefined): [number, number, number, number, number][] {
  const out: [number, number, number, number, number][] = []
  for (const it of project.scene_items) {
    if (!it.swimmable_water) continue
    const mdl = model(it.path)
    if (!mdl) continue
    const water = new Set(it.water_materials ?? [])
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, top = -Infinity
    for (let f = 0; f < mdl.faces.length / 3; f++) {
      if (water.size && !water.has(exportMatName(mdl.mats[mdl.faceMat[f]]))) continue
      for (let k = 0; k < 3; k++) {
        const v = mdl.faces[f * 3 + k] * 3
        const [x, y, z] = transformPoint(mdl.positions.subarray(v, v + 3), it)
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); top = Math.max(top, y)
      }
    }
    if (Number.isFinite(top)) out.push([x0, z0, x1, z1, top])
  }
  return out
}

function addItem(it: SceneItem, mdl: ObjModel, tris: number[], flags: number[]) {
  const excluded = new Set(it.collision_excluded_faces ?? [])
  const water = new Set(it.swimmable_water ? it.water_materials ?? [] : [])
  const glass = isGlass(it)
  // Transform each vertex once.
  const world = new Float32Array(mdl.positions.length)
  for (let v = 0; v < mdl.positions.length; v += 3) world.set(transformPoint(mdl.positions.subarray(v, v + 3), it), v)
  const faces = mdl.faces.length / 3
  for (let f = 0; f < faces; f++) {
    if (excluded.has(f)) continue
    const mat = exportMatName(mdl.mats[mdl.faceMat[f]])
    if (water.has(mat)) continue
    for (let k = 0; k < 3; k++) {
      const v = mdl.faces[f * 3 + k] * 3
      tris.push(world[v], world[v + 1], world[v + 2])
    }
    flags.push(glass || it.alpha?.[mat] ? SOLID : SOLID | OPAQUE)
  }
}

/** A short key that changes whenever something the checks look at changes (to tell when a report is out of date). */
export function analysisKey(project: Project): string {
  const items = project.scene_items.map((it) => [it.path, it.position, it.rotation, it.scale, it.pivot, it.collision_disabled, it.collision_excluded_faces?.length, it.swimmable_water, it.water_materials, it.alpha, it.native_prefab])
  const markers = project.markers.filter((mk) => KINDS.includes(mk.type)).map((mk) => [mk.type, mk.position, mk.type === 'Weapon pickup' ? mk.weapon : /spawn/i.test(mk.type) ? mk.yaw : ''])
  const text = JSON.stringify([items, markers])
  // FNV-1a, enough to notice a change.
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36) + ':' + text.length
}
