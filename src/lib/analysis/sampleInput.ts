// Health-check input straight from a sample map's parts (the same shapes the
// sample builds into OBJ files), so tests and the AI can check a sample
// without building it into a project first.
import { parseObj } from '../geometry'
import { shapeObj, type Shape } from '../shapes'
import type { Sample } from '../sampleKit'
import { collisionFromProject } from './collision'
import { newProject, newMarker, type SceneItem, type Vec3 } from '../project'

export function sampleInput(sample: Pick<Sample, 'parts' | 'markers'>) {
  const project = newProject(sample.parts.length ? 'sample' : 'empty')
  const models = new Map<string, ReturnType<typeof parseObj>>()
  const parsed = new Map<string, ReturnType<typeof parseObj>>()
  project.scene_items = sample.parts.map((part, i): SceneItem => {
    const shape: Shape = {
      kind: part.kind, size: part.size, tile: part.tile ?? 4,
      ...(part.segments ? { segments: part.segments } : {}), ...(part.taper !== undefined ? { taper: part.taper } : {}), ...(part.bevel ? { bevel: part.bevel } : {}),
      ...(part.lie ? { lie: true } : {}), ...(part.outline ? { outline: part.outline } : {}),
    }
    const path = `/sample/${i}.obj`
    // Parts of the same shape share one parsed model (only read from here on).
    const key = JSON.stringify(shape)
    let model = parsed.get(key)
    if (!model) { model = parseObj(shapeObj(shape)); parsed.set(key, model) }
    models.set(path, model)
    return {
      uid: String(i), name: part.label, path, position: part.at, rotation: [0, part.rot ?? 0, 0], scale: 1, textures: {}, alpha: {},
      ...(part.water ? { swimmable_water: true } : {}),
    }
  })
  // A little above the surface, as samples are built.
  project.markers = sample.markers.map(([type, at, patch]) => ({ ...newMarker(type, [at[0], at[1] + 0.1, at[2]] as Vec3), ...patch }))
  return collisionFromProject(project, (p) => models.get(p))
}
