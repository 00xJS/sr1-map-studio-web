// Invisible ramps over stairs too tall to walk up (lib/stairRamps.ts): found in the map's solid objects, added as one
// object of see-through ramps that players run up in game. Made from site recipes (open ramp shapes and the
// generated "invisible" texture), so a map with them can still be shared.
import { useEditor, currentProject, startRun, stillCurrent } from './store'
import { cacheModel, loadModel } from '../lib/assets'
import { parseObj, type ObjModel } from '../lib/geometry'
import { storeFile } from '../lib/files'
import { importImage } from '../lib/importers'
import { tagRecipe } from '../lib/recipes'
import { compoundObj } from '../lib/shapes'
import { collisionFromProject } from '../lib/analysis/collision'
import { findStairs, rampPieces, scaleRuns } from '../lib/stairRamps'
import { uid, type Project, type SceneItem, type Vec3 } from '../lib/project'

/** The object the ramps go in; adding them again replaces it. */
export const RAMPS_NAME = 'Invisible stair ramps'
const MAT = 'stair_ramp'

export const isRamps = (it: Pick<SceneItem, 'name'>) => it.name === RAMPS_NAME

/** The project's solid triangles as the exporter makes them solid (analysis/collision.ts), editor units. */
export async function solidTriangles(project: Project, keep: (it: SceneItem) => boolean = () => true) {
  const items = project.scene_items.filter(keep)
  const models = new Map<string, ObjModel>()
  await Promise.all([...new Set(items.filter((it) => !it.collision_disabled).map((it) => it.path))].map(async (p) => {
    try { models.set(p, await loadModel(project, p)) } catch { /* missing file: left out, as the checks do */ }
  }))
  return collisionFromProject({ ...project, scene_items: items }, (p) => models.get(p))
}

/** Ramps go over the stairs this map has: mirror mode doesn't copy them (there may be no stairs across the middle). */
const NOT_MIRRORED = { noMirror: true }

/** Finds the stairs too tall to walk up and puts a ramp over each. Returns how many ramps (0: none needed). */
export async function addStairRamps(): Promise<number> {
  const project = currentProject()
  if (!project) return 0
  const run = startRun()
  const input = await solidTriangles(project, (it) => !isRamps(it))
  // The finder measures in the usual editor units (0.5 m each): a map with another world scale is measured in game metres.
  const k = (project.settings.world_scale || 0.5) / 0.5
  const runs = scaleRuns(findStairs(k === 1 ? input.tris : input.tris.map((v) => v * k), input.flags), 1 / k)
  const state = useEditor.getState()
  stillCurrent(run)
  if (!runs.length) {
    state.update('Remove invisible stair ramps', (d) => { d.scene_items = d.scene_items.filter((it) => !isRamps(it)) }, NOT_MIRRORED)
    state.log('No stairs with steps too tall to walk up (over about 0.28 m each).')
    return 0
  }
  const sum = runs.reduce((a, r) => [a[0] + r.from[0], a[1] + r.from[1], a[2] + r.from[2]], [0, 0, 0])
  const origin = sum.map((v) => +(v / runs.length).toFixed(2)) as Vec3
  const pieces = rampPieces(runs, origin, MAT)
  const text = compoundObj(pieces)
  // The shared invisible picture first: a run stopped meanwhile then leaves no ramp file of its own behind.
  const tex = await invisibleTexture()
  stillCurrent(run)
  const obj = await storeFile(tagRecipe(new Blob([text], { type: 'model/obj' }), { kind: 'compound', pieces }), 'stair_ramps.obj')
  cacheModel(obj.vpath, parseObj(text))
  stillCurrent(run)
  const item: SceneItem = {
    uid: uid(), name: RAMPS_NAME, path: obj.vpath, source_path: obj.vpath, position: origin, rotation: [0, 0, 0], scale: 1,
    textures: { [MAT]: tex.vpath }, alpha: { [MAT]: true }, surface_ids: { [MAT]: 0 }, physics_intent: 'Static',
  }
  state.update('Add invisible stair ramps', (d) => {
    d.scene_items = d.scene_items.filter((it) => !isRamps(it))
    Object.assign(d.files, { [obj.vpath]: obj.ref, [tex.vpath]: tex.ref })
    d.scene_items.push(item)
  }, NOT_MIRRORED)
  const steps = runs.reduce((a, r) => a + r.steps, 0)
  const m = (u: number) => (u * (project.settings.world_scale || 0.5)).toFixed(2)
  state.log(`Invisible stair ramps: ${runs.length} flight${runs.length === 1 ? '' : 's'} of stairs (${steps} steps, ` +
    `${runs.map((r) => `${m(r.rise)} m high`).join(', ')}) get a ramp players can run up; you won't see them in game. ` +
    `Select "${RAMPS_NAME}" in the scene list to see where they are.`)
  return runs.length
}

async function invisibleTexture() {
  const { generate, defaultParams } = await import('../lib/procedural')
  const { pixelsToPng } = await import('../lib/images')
  const params = { ...defaultParams('invisible', 16), seed: 1 }
  return importImage(tagRecipe(await pixelsToPng(generate(params), 16, 'invisible.png'), { kind: 'generated', params }), 16)
}
