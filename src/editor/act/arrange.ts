// Several objects lined up or spaced evenly (lib/arrange.ts), each group moving as one piece.
import { currentProject } from '../store'
import { alignShifts, distributeShifts, type Axis, type Box, type Edge } from '../../lib/arrange'
import type { Vec3 } from '../../lib/project'
import { update, UserError } from './core'

/** An object's world box (the viewer's, once its model has loaded), or null. */
export type BoundsOf = (index: number) => [Vec3, Vec3] | null

/** The selected objects as pieces that move together: a group is one piece, every other object its own. */
function pieces(indices: number[], bounds: BoundsOf): { members: number[]; box: Box }[] {
  const p = currentProject()
  if (!p) return []
  const byKey = new Map<string, number[]>()
  for (const i of indices) {
    const it = p.scene_items[i]
    if (!it) continue
    const key = it.group ? 'g:' + it.group : 'i:' + i
    byKey.set(key, [...(byKey.get(key) ?? []), i])
  }
  return [...byKey.values()].map((members) => {
    const box: Box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
    for (const i of members) {
      // Still loading: its position stands in for its box.
      const pos = p.scene_items[i].position
      const [lo, hi] = bounds(i) ?? [pos, pos]
      for (const a of [0, 1, 2] as Axis[]) { box.min[a] = Math.min(box.min[a], lo[a]); box.max[a] = Math.max(box.max[a], hi[a]) }
    }
    return { members, box }
  })
}

function shift(label: string, list: { members: number[] }[], axis: Axis, by: number[]) {
  if (by.every((v) => Math.abs(v) < 1e-6)) return false
  update(label, (d) => {
    list.forEach((piece, k) => {
      for (const i of piece.members) {
        const it = d.scene_items[i]
        if (!it) continue
        const pos = [...it.position] as Vec3
        pos[axis] = +(pos[axis] + by[k]).toFixed(4)
        it.position = pos
      }
    })
  })
  return true
}

const AXIS = ['X', 'Y', 'Z']

/** Lines the objects up along `axis` by their low edges, middles or high edges. False when they already are. */
export function alignItems(indices: number[], axis: Axis, edge: Edge, bounds: BoundsOf): boolean {
  const list = pieces(indices, bounds)
  if (list.length < 2) throw new UserError('Pick two or more objects to line up (Shift+click to add).')
  return shift(`Line up along ${AXIS[axis]}`, list, axis, alignShifts(list.map((x) => x.box), axis, edge))
}

/** Spaces the objects so the gaps between them along `axis` are equal; the two at the ends stay. */
export function distributeItems(indices: number[], axis: Axis, bounds: BoundsOf): boolean {
  const list = pieces(indices, bounds)
  if (list.length < 3) throw new UserError('Pick three or more objects to space evenly (Shift+click to add).')
  return shift(`Space evenly along ${AXIS[axis]}`, list, axis, distributeShifts(list.map((x) => x.box), axis))
}
