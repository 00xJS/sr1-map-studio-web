// The parts of one city object. The game often builds a whole frontage as one object: the wall with its windows,
// doors, posters, signs, posts and trim as extra pieces of the same mesh. Here they come apart: triangles that touch
// and share a material make a piece; the pieces of the object's main material (the most surface) are the object
// itself; every other piece becomes a part of its own, pieces that overlap staying together (a poster and its frame,
// a window and its glass); grime, drips and shadow overlays stay on the main part, as do specks too small to pick.

import { partName, partRank } from './names'

export { partName }

export interface PartTris { tris: number[]; name: string }

/** Overlays that belong to the surface under them (dirt, drips, stains, baked shadow), by texture name. */
const GRIME = /dirt|grime|stain|drip|shadow|_sh(ad)?_|crack|decl|decal|grad|leak|soot|burnt?|puddle|_ao\b|_ao_|wet|smudge|rust|weather|mold|moss|graf_?fade|water_?stain/i
/** Smaller than this (m²) is a speck: it stays with the main part. */
const SPECK = 0.02
/** Pieces closer than this (m) belong to one part. */
const TOUCH = 0.05

/**
 * Splits one object's triangles into its parts. `pos` holds three corners per triangle (x, y, z), `mat` the
 * material per triangle, `tex` each material's texture name and `look` whether a triangle is look-only. The first
 * part is always the object itself (named `name`); the others are named from their main texture.
 */
export function splitParts(pos: ArrayLike<number>, mat: ArrayLike<number>, tex: (m: number) => string, look: ArrayLike<number>, name: string): PartTris[] {
  const n = mat.length
  if (n < 2) return [{ tris: [...Array(n).keys()], name }]
  // Pieces: triangles that share a corner (to the millimetre) and a material.
  const parent = [...Array(n).keys()]
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  const corner = new Map<string, number>()
  const area = new Float64Array(n)
  for (let t = 0; t < n; t++) {
    const o = 9 * t
    const ax = pos[o + 3] - pos[o], ay = pos[o + 4] - pos[o + 1], az = pos[o + 5] - pos[o + 2]
    const bx = pos[o + 6] - pos[o], by = pos[o + 7] - pos[o + 1], bz = pos[o + 8] - pos[o + 2]
    area[t] = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2
    for (let k = 0; k < 3; k++) {
      const key = `${mat[t]}|${Math.round(pos[o + 3 * k] * 1000)},${Math.round(pos[o + 3 * k + 1] * 1000)},${Math.round(pos[o + 3 * k + 2] * 1000)}`
      const prev = corner.get(key)
      if (prev === undefined) corner.set(key, t)
      else { const a = find(prev), b = find(t); if (a !== b) parent[a] = b }
    }
  }
  // The main material: the most surface (look-only overlays don't count).
  const byMat = new Map<number, number>()
  for (let t = 0; t < n; t++) if (!look[t]) byMat.set(mat[t], (byMat.get(mat[t]) ?? 0) + area[t])
  if (byMat.size < 2 && ![...Array(n).keys()].some((t) => look[t] && !GRIME.test(tex(mat[t])))) return [{ tris: [...Array(n).keys()], name }]
  const main = [...byMat.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? mat[0]

  interface Piece { tris: number[]; area: number; box: number[]; mats: Map<number, number> }
  const pieces = new Map<number, Piece>()
  for (let t = 0; t < n; t++) {
    const r = find(t)
    let p = pieces.get(r)
    if (!p) pieces.set(r, (p = { tris: [], area: 0, box: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], mats: new Map() }))
    p.tris.push(t); p.area += area[t]
    p.mats.set(mat[t], (p.mats.get(mat[t]) ?? 0) + area[t])
    for (let k = 0; k < 9; k++) { const v = pos[9 * t + k], a = k % 3; if (v < p.box[a]) p.box[a] = v; if (v > p.box[a + 3]) p.box[a + 3] = v }
  }
  const stay: number[] = []
  const loose: Piece[] = []
  for (const p of pieces.values()) {
    const m = mat[p.tris[0]]
    if (m === main || GRIME.test(tex(m))) stay.push(...p.tris)
    else loose.push(p)
  }
  // Loose pieces that touch or overlap are one part.
  const lp = loose.map((_, i) => i)
  const lf = (i: number): number => { while (lp[i] !== i) { lp[i] = lp[lp[i]]; i = lp[i] } return i }
  const near = (a: number[], b: number[]) => [0, 1, 2].every((k) => a[k] - TOUCH <= b[k + 3] && b[k] - TOUCH <= a[k + 3])
  for (let a = 0; a < loose.length; a++) for (let b = a + 1; b < loose.length; b++) if (near(loose[a].box, loose[b].box)) { const x = lf(a), y = lf(b); if (x !== y) lp[x] = y }
  const groups = new Map<number, Piece[]>()
  loose.forEach((p, i) => { const r = lf(i); const g = groups.get(r); if (g) g.push(p); else groups.set(r, [p]) })
  const out: PartTris[] = [{ tris: stay, name }]
  for (const g of groups.values()) {
    const total = g.reduce((s, p) => s + p.area, 0)
    const tris = g.flatMap((p) => p.tris)
    if (total < SPECK) { stay.push(...tris); continue }
    // Named after the material with the most surface, else the next one that says what it is.
    const mats = new Map<number, number>()
    for (const p of g) for (const [m, a] of p.mats) mats.set(m, (mats.get(m) ?? 0) + a)
    // The most telling name among its materials (a poster and its frame: Poster), else by surface.
    const names = [...mats.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => partName(tex(m))).filter(Boolean)
    const label = names.sort((a, b) => partRank(a) - partRank(b))[0] || 'Detail'
    out.push({ tris: tris.sort((a, b) => a - b), name: label })
  }
  if (!out[0].tris.length) out.shift()
  else out[0].tris.sort((a, b) => a - b)
  return out
}
