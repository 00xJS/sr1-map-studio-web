// Sight lines: how much of the map sees each standable spot, at standing and
// crouched eye height, and the longest clear lines across the map. The work
// splits by observer, so several workers can each take a share.
import type { Bvh } from './bvh'
import { PLAYER } from './floor'
import { OPAQUE, type SightLane } from './types'

/** Lines longer than this (editor units, 40 m) count as sniper lanes. */
const LANE = 80

/** A small seeded random generator (mulberry32), so the same map gives the same report. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A random sample of the reachable nodes to look from, as many as the ray budget allows (about 1.5 rays per pair).
 *  With `twin`, each pick comes with its mirror image, so a symmetric map gets symmetric numbers. */
export function pickObservers(nodes: Int32Array, rayBudget: number, seed: number, twin?: (n: number) => number): Int32Array {
  if (!nodes.length) return new Int32Array(0)
  const m = Math.max(1, Math.min(nodes.length, Math.max(48, Math.floor(rayBudget / (nodes.length * 1.5)))))
  const pick = nodes.slice()
  const rand = rng(seed)
  for (let i = pick.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = pick[i]; pick[i] = pick[j]; pick[j] = t }
  if (!twin) return pick.slice(0, m)
  const taken = new Set<number>()
  const out: number[] = []
  for (let i = 0; i < pick.length && out.length < m; i++) {
    const a = pick[i]
    if (taken.has(a)) continue
    taken.add(a); out.push(a)
    const b = twin(a)
    if (b >= 0 && !taken.has(b)) { taken.add(b); out.push(b) }
  }
  return Int32Array.from(out)
}

/** Counts from some of the observers: how many see each node standing and crouched, and each one's longest view. */
export interface SightCounts { stand: Uint16Array; crouch: Uint16Array; longest: number[]; rays: number }

/** Looks from each observer at every reachable node. The crouched check only runs where the standing one sees:
 *  lower eyes are taken as at least as hidden. */
export function observe(bvh: Bvh, pos: Float32Array, nodes: Int32Array, observers: ArrayLike<number>, maxSight: number, onProgress?: (done: number) => void): SightCounts {
  const n = pos.length / 3, P = pos
  const stand = new Uint16Array(n), crouch = new Uint16Array(n)
  const far2 = maxSight * maxSight
  const rays0 = bvh.rays
  // [length, from, to] triples.
  const longest: number[] = []
  for (let k = 0; k < observers.length; k++) {
    const a = observers[k]
    const ax = P[a * 3], ay = P[a * 3 + 1] + PLAYER.standEye, az = P[a * 3 + 2]
    let bestLen = LANE, bestB = -1
    for (let q = 0; q < nodes.length; q++) {
      const b = nodes[q]
      if (b === a) { stand[b]++; crouch[b]++; continue }
      const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2]
      const dx = bx - ax, dz = bz - az, dy = by + PLAYER.standEye - ay
      const d2 = dx * dx + dz * dz + dy * dy
      if (d2 > far2) continue
      if (bvh.blocked(ax, ay, az, bx, by + PLAYER.standEye, bz, OPAQUE)) continue
      stand[b]++
      if (!bvh.blocked(ax, ay, az, bx, by + PLAYER.crouchEye, bz, OPAQUE)) crouch[b]++
      if (d2 > bestLen * bestLen) { bestLen = Math.sqrt(d2); bestB = b }
    }
    if (bestB >= 0) longest.push(bestLen, a, bestB)
    if ((k & 7) === 7) onProgress?.((k + 1) / observers.length)
  }
  // Counted in the result, not on the tree (another worker may have cast them).
  const rays = bvh.rays - rays0
  bvh.rays = rays0
  return { stand, crouch, longest, rays }
}

/** Adds up counts from several shares of the observers. */
export function mergeCounts(parts: SightCounts[]): SightCounts {
  const n = parts[0]?.stand.length ?? 0
  const stand = new Uint16Array(n), crouch = new Uint16Array(n)
  const longest: number[] = []
  let rays = 0
  for (const p of parts) {
    rays += p.rays
    for (let i = 0; i < n; i++) { stand[i] += p.stand[i]; crouch[i] += p.crouch[i] }
    for (const x of p.longest) longest.push(x)
  }
  return { stand, crouch, longest, rays }
}

/** The longest lines, skipping ones that run alongside a line already picked. */
export function pickLanes(longest: number[], P: Float32Array, count = 6): SightLane[] {
  const cands: { len: number; a: number; b: number }[] = []
  for (let i = 0; i < longest.length; i += 3) cands.push({ len: longest[i], a: longest[i + 1], b: longest[i + 2] })
  cands.sort((x, y) => y.len - x.len || x.a - y.a)
  const out: SightLane[] = []
  const at = (n: number): [number, number, number] => [P[n * 3], P[n * 3 + 1] + PLAYER.standEye, P[n * 3 + 2]]
  const near = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[2] - q[2]) < 24
  for (const c of cands) {
    const from = at(c.a), to = at(c.b)
    if (out.some((l) => (near(l.from, from) && near(l.to, to)) || (near(l.from, to) && near(l.to, from)))) continue
    out.push({ from, to, metres: Math.round(c.len / 2) })
    if (out.length >= count) break
  }
  return out
}

/** Clear view between two eye positions (sight lines only: glass and fences don't block). */
export function sees(bvh: Bvh, a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  return !bvh.blocked(a[0], a[1], a[2], b[0], b[1], b[2], OPAQUE)
}
