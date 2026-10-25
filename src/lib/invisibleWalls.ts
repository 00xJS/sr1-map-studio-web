// Invisible walls: paper-thin (sliver) triangles in a map's solid geometry. Their corners lie (almost) in a straight
// line, so they draw nothing, but in game they act as a wall through that line reaching out into open air: players
// rub against nothing and the camera is pushed (found in game on Dust; py/collision_fix.py leaves them out of the
// collision at export). The test is the same as there: the triangle's height across its longest side is at most
// THIN of that side. Pure, for the health panel.

/** Thinner than this (height over longest side) is a sliver; must match py/collision_fix.py THIN. */
export const THIN = 0.004

/** Whether the triangle starting at float `i` of `tris` (9 floats each) is a sliver. */
export function isSliver(tris: ArrayLike<number>, i: number): boolean {
  const ax = tris[i + 3] - tris[i], ay = tris[i + 4] - tris[i + 1], az = tris[i + 5] - tris[i + 2]
  const bx = tris[i + 6] - tris[i], by = tris[i + 7] - tris[i + 1], bz = tris[i + 8] - tris[i + 2]
  const cross = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)
  const e = (j: number, k: number) => Math.hypot(tris[i + k] - tris[i + j], tris[i + k + 1] - tris[i + j + 1], tris[i + k + 2] - tris[i + j + 2])
  const longest = Math.max(e(0, 3), e(3, 6), e(6, 0))
  return longest === 0 || cross <= THIN * longest * longest
}

export interface SliverReport {
  count: number
  /** Middle of each (a few), editor units, to show where they are. */
  places: [number, number, number][]
}

/** The slivers among solid triangles (`flags` bit 1 = solid, as the health checks have them). */
export function findSlivers(tris: Float32Array, flags?: Uint8Array, maxPlaces = 12): SliverReport {
  const n = tris.length / 9
  let count = 0
  const places: [number, number, number][] = []
  for (let t = 0; t < n; t++) {
    if (flags && !(flags[t] & 1)) continue
    if (!isSliver(tris, t * 9)) continue
    count++
    if (places.length < maxPlaces) {
      const i = t * 9
      places.push([(tris[i] + tris[i + 3] + tris[i + 6]) / 3, (tris[i + 1] + tris[i + 4] + tris[i + 7]) / 3, (tris[i + 2] + tris[i + 5] + tris[i + 8]) / 3])
    }
  }
  return { count, places }
}
