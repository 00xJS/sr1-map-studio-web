// How solid a model is at eye height: the check that keeps see-through "buildings" (a canopy on posts, a billboard
// frame, a building's front without its sides) out of the new map wizard. Pure, so the index's worker measures every
// building once as it reads the game files (GameObjectEntry.eye), and the map builder checks each model it brings in.
import type { ObjModel } from '../geometry'

/** Eye height band players look through, editor units above the model's feet (0.3 to 2.5 m). */
const EYE: [number, number] = [0.6, 5]
const CELLS = 24

/**
 * How much of the model, seen side-on from X and from Z, is solid at eye height (0..1, the less of the two): a
 * building is nearly 1; a canopy on posts, a billboard frame or a light rig is far less.
 */
export function eyeCover(m: Pick<ObjModel, 'positions' | 'faces'>): number {
  const P = m.positions
  let lo = Infinity
  for (const axis of [0, 2]) {
    let a0 = Infinity, a1 = -Infinity
    for (let i = 0; i < P.length; i += 3) { a0 = Math.min(a0, P[i + axis]); a1 = Math.max(a1, P[i + axis]) }
    const span = a1 - a0
    if (!(span > 0)) return 0
    // Cells across the side view (along `axis`) and up the eye band; a cell is solid when a triangle covers its middle.
    const hit = new Uint8Array(CELLS * CELLS)
    const cu = (u: number) => ((u - a0) / span) * CELLS - 0.5, cv = (v: number) => ((v - EYE[0]) / (EYE[1] - EYE[0])) * CELLS - 0.5
    for (let t = 0; t < m.faces.length; t += 3) {
      const ia = m.faces[t] * 3, ib = m.faces[t + 1] * 3, ic = m.faces[t + 2] * 3
      const ax = cu(P[ia + axis]), ay = cv(P[ia + 1]), bx = cu(P[ib + axis]), by = cv(P[ib + 1]), cx = cu(P[ic + axis]), cy = cv(P[ic + 1])
      const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
      if (Math.abs(d) < 1e-9) continue
      const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx))), i1 = Math.min(CELLS - 1, Math.floor(Math.max(ax, bx, cx)))
      const j0 = Math.max(0, Math.ceil(Math.min(ay, by, cy))), j1 = Math.min(CELLS - 1, Math.floor(Math.max(ay, by, cy)))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const w1 = ((bx - i) * (cy - j) - (cx - i) * (by - j)) / d, w2 = ((cx - i) * (ay - j) - (ax - i) * (cy - j)) / d
        if (w1 >= 0 && w2 >= 0 && w1 + w2 <= 1) hit[j * CELLS + i] = 1
      }
    }
    let n = 0
    for (const h of hit) n += h
    lo = Math.min(lo, n / hit.length)
  }
  return lo
}
