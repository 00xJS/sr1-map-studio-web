// Lining things up, spacing them evenly and measuring, kept free of the editor so it can be tested. Boxes are world
// bounds in editor units; the answers are how far to move each one along the axis (0 X, 1 Y, 2 Z).
import type { Vec3 } from './project'

export type Axis = 0 | 1 | 2
export type Edge = 'min' | 'mid' | 'max'
export interface Box { min: Vec3; max: Vec3 }

const mid = (b: Box, a: Axis) => (b.min[a] + b.max[a]) / 2

/** How far to move each box so they line up along `axis`: their low edges at the lowest, their high edges at the
 *  highest, or their middles at the middle of them all. */
export function alignShifts(boxes: Box[], axis: Axis, edge: Edge): number[] {
  if (boxes.length < 2) return boxes.map(() => 0)
  const lo = Math.min(...boxes.map((b) => b.min[axis])), hi = Math.max(...boxes.map((b) => b.max[axis]))
  return boxes.map((b) => (edge === 'min' ? lo - b.min[axis] : edge === 'max' ? hi - b.max[axis] : (lo + hi) / 2 - mid(b, axis)))
}

/** How far to move each box so there are equal gaps between them along `axis`. The first and last (by their middles)
 *  stay where they are; fewer than three boxes don't move. */
export function distributeShifts(boxes: Box[], axis: Axis): number[] {
  const out = boxes.map(() => 0)
  if (boxes.length < 3) return out
  const order = boxes.map((_, i) => i).sort((i, j) => mid(boxes[i], axis) - mid(boxes[j], axis))
  const first = boxes[order[0]], last = boxes[order[order.length - 1]]
  const width = (b: Box) => b.max[axis] - b.min[axis]
  const total = last.max[axis] - first.min[axis]
  const gap = (total - order.reduce((s, i) => s + width(boxes[i]), 0)) / (order.length - 1)
  let at = first.max[axis] + gap
  for (const i of order.slice(1, -1)) {
    out[i] = at - boxes[i].min[axis]
    at += width(boxes[i]) + gap
  }
  return out
}

/** The distance between two points, in editor units: straight, across the ground and up (negative: down). */
export function measure(a: Vec3, b: Vec3): { length: number; flat: number; rise: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]
  return { length: Math.hypot(dx, dy, dz), flat: Math.hypot(dx, dz), rise: dy }
}
