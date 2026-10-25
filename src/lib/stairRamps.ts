// Invisible ramps over stairs whose steps are too tall to walk up. The game's player steps up only about 0.28 m
// without jumping (player.ts STEP), so stairs with taller risers (common on converted maps, and on any map scaled
// up) stop a running player at every step. A ramp laid over the step nosings, see-through but solid, lets players
// run up them as the map's maker meant.
//
// Found from the map's solid triangles (analysis/collision.ts, editor units): a riser is a vertical face with floor
// at its foot in front and floor at its top behind; two or more risers in a row, the same way round, each starting
// where the last ended and a tread apart, make a flight of stairs. The ramp is the plane through the nosings (the
// top edge of each riser), from where it meets the lower floor to the top step, as wide as every step. Pure: no
// three.js, so it is tested in Node.
import { Bvh } from './analysis/bvh'
import { SOLID } from './analysis/types'
import { MAX_SLOPE_DEG, STEP } from './player'
import type { CompoundPiece } from './shapes'
import type { Vec3 } from './project'

/**
 * Risers up to a step (0.28 m) are walked up, as the site's own stairs (built to it) and its walk mode have it;
 * taller ones, from 0.3 m, get a ramp.
 */
export const MIN_RISER = STEP + 0.04
/** Taller than this (0.7 m) is a ledge or a wall, not a step. */
export const MAX_RISER = 1.4
/** Tread depth from riser to riser (0.25 to 1.4 m). */
export const MIN_TREAD = 0.5
export const MAX_TREAD = 2.8
/** Steepest ramp laid: well under what the player walks up (MAX_SLOPE_DEG). */
export const MAX_RAMP_DEG = Math.min(55, MAX_SLOPE_DEG)
/** Narrowest stairs given a ramp (1 m: a player is about 0.85 m across). */
export const MIN_WIDTH = 2
/** The ramp sits this far above the nosings, so the steps' edges never poke through it. */
const LIFT = 0.03

/** One flight of stairs and the ramp over it. Editor units. */
export interface StairRun {
  /** Horizontal unit direction up the stairs. */
  up: [number, number]
  /** Number of steps too tall to walk up, and their average rise and tread. */
  steps: number
  rise: number
  tread: number
  /** The ramp: bottom edge middle (on the lower floor), top edge middle (the top step), and width. */
  from: Vec3
  to: Vec3
  width: number
  slopeDeg: number
}

interface Riser {
  up: [number, number]
  /** Distance along `up` (from the origin), bottom and top heights, and its extent across. */
  r: number
  yb: number
  yt: number
  t0: number
  t1: number
}

const near = (ys: number[], y: number, tol: number) => ys.some((v) => Math.abs(v - y) <= tol)

/** Every flight of stairs with steps too tall to walk up, in the solid triangles `tris` (9 floats each). */
export function findStairs(tris: Float32Array, flags?: Uint8Array): StairRun[] {
  const n = tris.length / 9
  const fl = flags ?? new Uint8Array(n).fill(SOLID)
  if (!n) return []
  const bvh = new Bvh(tris, fl)
  const ys: number[] = [], hit: number[] = []
  const floorAt = (x: number, z: number, y: number, tol: number) => {
    bvh.column(x, z, y + 0.5, y - 0.5, SOLID, ys, hit)
    return near(ys, y, tol)
  }
  /** The first floor below height y at (x, z), down to a riser's height under it, or null. */
  const floorBelow = (x: number, z: number, y: number) => {
    bvh.column(x, z, y, y - MAX_RISER - 0.1, SOLID, ys, hit)
    return ys.length ? ys[0] : null
  }

  // 1. Riser faces: vertical triangles of step height with floor at the foot on one side and at the top on the other.
  const raw: Riser[] = []
  for (let i = 0; i < n; i++) {
    if (!(fl[i] & SOLID)) continue
    const p = i * 9
    const ax = tris[p], ay = tris[p + 1], az = tris[p + 2]
    const ux = tris[p + 3] - ax, uy = tris[p + 4] - ay, uz = tris[p + 5] - az
    const vx = tris[p + 6] - ax, vy = tris[p + 7] - ay, vz = tris[p + 8] - az
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-9) continue
    nx /= len; ny /= len; nz /= len
    if (Math.abs(ny) > 0.15) continue
    const hl = Math.hypot(nx, nz)
    const hx = nx / hl, hz = nz / hl
    // The face may reach down past the step below (stairs built from blocks standing on the ground): the step's
    // height is from its top down to the first floor in front of it.
    const low = Math.min(ay, tris[p + 4], tris[p + 7]), yt = Math.max(ay, tris[p + 4], tris[p + 7])
    if (yt - low < MIN_RISER) continue
    // Across the face (perpendicular to its normal, in plan), and its middle.
    const px = -hz, pz = hx
    const ts = [0, 3, 6].map((k) => tris[p + k] * px + tris[p + k + 2] * pz)
    const t0 = Math.min(...ts), t1 = Math.max(...ts)
    if (t1 - t0 < 0.2) continue
    const mx = (ax + tris[p + 3] + tris[p + 6]) / 3, mz = (az + tris[p + 5] + tris[p + 8]) / 3
    const s = mx * hx + mz * hz
    const tm = (t0 + t1) / 2
    // Either way round: the low floor on the side it faces is "in front", the tread on the other is "behind".
    for (const sign of [1, -1]) {
      const fx = hx * sign, fz = hz * sign
      const cx = s * hx + tm * px, cz = s * hz + tm * pz
      const yb = floorBelow(cx + fx * 0.3, cz + fz * 0.3, yt - 0.02)
      if (yb === null || yt - yb < MIN_RISER || yt - yb > MAX_RISER || low > yb + 0.08) continue
      if (!floorAt(cx - fx * 0.3, cz - fz * 0.3, yt, 0.08)) continue
      const up: [number, number] = [-fx, -fz]
      const across = [-up[1], up[0]]
      const tt = [0, 3, 6].map((k) => tris[p + k] * across[0] + tris[p + k + 2] * across[1])
      raw.push({ up, r: cx * up[0] + cz * up[1], yb, yt, t0: Math.min(...tt), t1: Math.max(...tt) })
      break
    }
  }

  // 2. One riser per step: triangles of the same face (same way, place and heights) side by side are merged.
  const risers: Riser[] = []
  for (const a of raw.sort((x, y) => x.t0 - y.t0)) {
    const b = risers.find((q) => q.up[0] * a.up[0] + q.up[1] * a.up[1] > 0.995 && Math.abs(q.r - a.r) < 0.06
      && Math.abs(q.yb - a.yb) < 0.06 && Math.abs(q.yt - a.yt) < 0.06 && a.t0 <= q.t1 + 0.15 && a.t1 >= q.t0 - 0.15)
    if (b) { b.t0 = Math.min(b.t0, a.t0); b.t1 = Math.max(b.t1, a.t1) } else risers.push({ ...a, up: [...a.up] })
  }

  // 3. Flights: each riser's next one up starts where it ends, a tread further on, side by side with it.
  const overlap = (a: Riser, b: Riser) => Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0)
  const next = risers.map((a) => {
    let best = -1, bestD = Infinity
    risers.forEach((b, j) => {
      if (b === a || a.up[0] * b.up[0] + a.up[1] * b.up[1] < 0.99) return
      if (Math.abs(b.yb - a.yt) > 0.1) return
      const d = b.r - a.r
      if (d < MIN_TREAD || d > MAX_TREAD) return
      if (overlap(a, b) < 0.5 * Math.min(a.t1 - a.t0, b.t1 - b.t0)) return
      if (d < bestD) { bestD = d; best = j }
    })
    return best
  })
  const hasPrev = new Set(next.filter((j) => j >= 0))
  const runs: StairRun[] = []
  risers.forEach((start, i) => {
    if (hasPrev.has(i)) return
    const chain: Riser[] = [start]
    for (let j = next[i], guard = 0; j >= 0 && guard < 200; j = next[j], guard++) {
      if (chain.includes(risers[j])) break
      chain.push(risers[j])
    }
    if (chain.length < 2) return
    const run = rampOver(chain)
    if (run) runs.push(run)
  })
  return runs
}

/** The ramp over a flight: the plane through the nosings, from the lower floor to the top step. */
function rampOver(chain: Riser[]): StairRun | null {
  const first = chain[0], last = chain[chain.length - 1]
  const up = first.up
  const t0 = Math.max(...chain.map((c) => c.t0)), t1 = Math.min(...chain.map((c) => c.t1))
  const width = t1 - t0
  if (width < MIN_WIDTH) return null
  const slope = (last.yt - first.yt) / (last.r - first.r)
  if (!(slope > 0)) return null
  // Where the nosing line meets the lower floor, in front of the first step.
  const toe = first.r - (first.yt - first.yb) / slope
  const slopeDeg = (Math.atan(slope) * 180) / Math.PI
  if (slopeDeg > MAX_RAMP_DEG) return null
  const across: [number, number] = [-up[1], up[0]]
  const tm = (t0 + t1) / 2
  const at = (r: number, y: number): Vec3 => [up[0] * r + across[0] * tm, y + LIFT, up[1] * r + across[1] * tm]
  return {
    up, steps: chain.length, rise: (last.yt - first.yb) / chain.length, tread: (last.r - first.r) / (chain.length - 1),
    from: at(toe, first.yb), to: at(last.r, last.yt), width, slopeDeg,
  }
}

/**
 * The ramps as pieces of one compound object (shapes.ts): open ramps (just the sloped top: sides would be invisible
 * walls along the stairs), placed about `origin`, with material `mat` on top.
 */
export function rampPieces(runs: StairRun[], origin: Vec3, mat: string): CompoundPiece[] {
  return runs.map((run) => {
    const run3 = [run.to[0] - run.from[0], run.to[2] - run.from[2]]
    const depth = Math.hypot(run3[0], run3[1])
    const height = run.to[1] - run.from[1]
    // The ramp shape rises toward its back (−Z); turned so that points up the stairs (x' = x cos + z sin, z' = −x sin + z cos).
    const rot = (Math.atan2(-run.up[0], -run.up[1]) * 180) / Math.PI
    const mid: Vec3 = [(run.from[0] + run.to[0]) / 2 - origin[0], run.from[1] - origin[1], (run.from[2] + run.to[2]) / 2 - origin[2]]
    return { shape: { kind: 'ramp', size: [run.width, height, depth], tile: 4, open: true }, at: mid, rot: +rot.toFixed(3), top: mat, side: mat }
  })
}
