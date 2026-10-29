// The wall test for board times: a share's solid collision (the same the
// health check and the bots use), built from its OBJ geometry. Pure, so the
// share function and the local test server check times the same way.
import { Bvh } from '../lib/analysis/bvh'
import { collisionFromProject } from '../lib/analysis/collision'
import { SOLID } from '../lib/analysis/types'
import { parseObj, type ObjModel } from '../lib/geometry'
import type { WallTest } from './ghost'
import { MAX_PLACED_TRIANGLES, type ShareDoc } from './share'

/**
 * A wall test for the share's map; null when it has nothing solid; 'too many' when it places more triangles than
 * a share may (MAX_PLACED_TRIANGLES: each object copies its model's, so building it would take too long; a link
 * stored today can't, see validateShareDoc), and then its board takes no times.
 */
export function wallsOf(doc: ShareDoc): WallTest | null | 'too many' {
  const models = new Map<string, ObjModel>()
  for (const [k, text] of Object.entries(doc.models)) { try { models.set(k, parseObj(text)) } catch { /* left out, like a missing file */ } }
  let placed = 0
  for (const it of doc.project.scene_items) placed += (models.get(it.path)?.faces.length ?? 0) / 3
  if (placed > MAX_PLACED_TRIANGLES) return 'too many'
  const input = collisionFromProject(doc.project, (p) => models.get(p))
  if (!input.flags.length) return null
  const bvh = new Bvh(input.tris, input.flags)
  return (a, b) => bvh.blocked(a[0], a[1], a[2], b[0], b[1], b[2], SOLID)
}
