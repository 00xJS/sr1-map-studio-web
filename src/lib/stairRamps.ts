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
/**
 * Two steps alone are weak evidence (a bench, a planter, a machine's casing look the same), so they need stair
 * proportions: no steeper than this, and steps no taller than SHORT_MAX_RISER (0.45 m). Three or more need only
 * the limits above. Tried on the installed maps: Dust's and Sanctuary's short flights (18-32°, up to 0.43 m) pass,
 * Industrial's machine (54°) and a planter in Traverse Town (0.51 m steps) don't.
 */
export const SHORT_MAX_DEG = 40
export const SHORT_MAX_RISER = 0.9
/**
 * A single step too tall to walk up (a doorstep, a terrace, a raised floor: no step above it) gets a short wedge in
 * front of it, up to this tall (0.65 m: taller is a ledge to jump) and this steep. Only with floor at its foot for
 * the wedge's length, and at least TOP_DEPTH of floor on top, all across: a crate's side or a bench gets none.
 */
export const SINGLE_MAX_RISER = 1.3
export const SINGLE_DEG = 35
const TOP_DEPTH = 2
/**
 * Giant steps (a castle's grand stairs, a grandstand, stairs on a map scaled up): risers up to this tall (2.2 m) and
 * treads up to three times their rise count as stairs, in a flight (two only at a gentle slope, see GIANT_PAIR_DEG);
 * one such step alone is a ledge or a wall.
 */
export const GIANT_RISER = 4.4
/** Two giant steps alone get a ramp only at this slope or gentler. */
const GIANT_PAIR_DEG = 35
/** Curved stairs: each step may turn up to about 30° from the one below it; each then gets its own stretch of ramp. */
const TURN_DOT = 0.85
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

export interface Riser {
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
  if (!n) return []
  const fl = flags ?? new Uint8Array(n).fill(SOLID)
  const bvh = new Bvh(tris, fl)
  const risers = findRisers(tris, fl, bvh, GIANT_RISER)

  const ys: number[] = [], hit: number[] = []
  // Floor at height y, open above it for a player's height (not the ground under a block, inside something solid).
  const floorAt = (x: number, z: number, y: number, tol: number) => {
    bvh.column(x, z, y + 3.5, y - 0.5, SOLID, ys, hit)
    // (A second layer of floor a few centimetres up, as converted maps have, is no ceiling.)
    return near(ys, y, tol) && !ys.some((v) => v > y + 0.3 && v < y + 3.5)
  }
  const runs = flights(risers)
  // Single steps: not part of any run of steps (even one left alone, a bench or a casing), nor the side of one.
  const besideRun = (r: Riser) => {
    // The riser's middle in the world: along its own rise, and across.
    const tm = (r.t0 + r.t1) / 2
    const x = r.up[0] * r.r - r.up[1] * tm, z = r.up[1] * r.r + r.up[0] * tm
    return chains.get(risers)!.some((c) => {
      const u = c[0].up
      const along = x * u[0] + z * u[1], across = -x * u[1] + z * u[0]
      const t0 = Math.min(...c.map((q) => q.t0)), t1 = Math.max(...c.map((q) => q.t1))
      return along >= c[0].r - 1.5 && along <= c[c.length - 1].r + TOP_DEPTH + 1.5 && across >= t0 - 1.5 && across <= t1 + 1.5
    })
  }
  return [...runs, ...risers.filter((r) => !inFlight.has(r) && !besideRun(r)).flatMap((r) => singleSteps(r, floorAt))]
}

/** Every step too tall to walk up: one riser per step, with the floor at its foot and its top (editor units). */
export function findRisers(tris: Float32Array, fl: Uint8Array, bvh = new Bvh(tris, fl), maxRiser = MAX_RISER): Riser[] {
  const n = tris.length / 9
  const ys: number[] = [], hit: number[] = []
  const floorAt = (x: number, z: number, y: number, tol: number) => {
    bvh.column(x, z, y + 0.5, y - 0.5, SOLID, ys, hit)
    return near(ys, y, tol)
  }
  /** The first floor below height y at (x, z), down to a riser's height under it, or null. */
  const floorBelow = (x: number, z: number, y: number) => {
    bvh.column(x, z, y, y - maxRiser - 0.1, SOLID, ys, hit)
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
      if (yb === null || yt - yb < MIN_RISER || yt - yb > maxRiser || low > yb + 0.08) continue
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

  return risers
}

/** Flights: each riser's next one up starts where it ends, a tread further on, side by side with it. */
/** Risers that are part of a run of steps, ramped or not (the rest may be single steps), and the runs, per finder call. */
const inFlight = new WeakSet<Riser>()
const chains = new WeakMap<Riser[], Riser[][]>()

function flights(risers: Riser[]): StairRun[] {
  const overlap = (a: Riser, b: Riser) => Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0)
  const next = risers.map((a) => {
    const [ax, az] = middle(a)
    let best = -1, bestD = Infinity
    risers.forEach((b, j) => {
      const dot = a.up[0] * b.up[0] + a.up[1] * b.up[1]
      // (A face too narrow to walk up, the side of a step or a bit of trim, never carries a flight on.)
      if (b === a || dot < TURN_DOT || b.t1 - b.t0 < MIN_WIDTH) return
      if (Math.abs(b.yb - a.yt) > 0.1) return
      // How far on it is up the stairs, and how far to the side.
      const [bx, bz] = middle(b)
      const d = (bx - ax) * a.up[0] + (bz - az) * a.up[1], side = Math.abs(-(bx - ax) * a.up[1] + (bz - az) * a.up[0])
      if (d < MIN_TREAD || d > Math.max(MAX_TREAD, 3 * (a.yt - a.yb))) return
      // Straight on: side by side with it. Turning (a curved stair): its middle within the step's width.
      if (dot >= 0.99 ? overlap(a, b) < 0.5 * Math.min(a.t1 - a.t0, b.t1 - b.t0) : side > Math.max(a.t1 - a.t0, b.t1 - b.t0) / 2) return
      if (d < bestD) { bestD = d; best = j }
    })
    return best
  })
  const hasPrev = new Set(next.filter((j) => j >= 0))
  const runs: StairRun[] = []
  const found: Riser[][] = []
  chains.set(risers, found)
  risers.forEach((start, i) => {
    if (hasPrev.has(i)) return
    const chain: Riser[] = [start]
    for (let j = next[i], guard = 0; j >= 0 && guard < 200; j = next[j], guard++) {
      if (chain.includes(risers[j])) break
      chain.push(risers[j])
    }
    if (chain.length < 2) return
    // Straight (every step within a couple of degrees of the one below): one ramp over the nosings, or, where that
    // doesn't fit (a slow turn), a stretch per step as on a curved flight.
    const straight = chain.every((c, k) => k === 0 || c.up[0] * chain[k - 1].up[0] + c.up[1] * chain[k - 1].up[1] >= 0.999)
    const one = straight ? rampOver(chain) : null
    // (Two steps alone get one ramp or none: a stretch per step needs a flight of three to be sure it's stairs.)
    const made = one ? [one] : chain.length >= 3 ? curvedRamps(chain) : []
    // A run that can't take a ramp (too narrow where its steps overlap, too steep): its steps may be single steps.
    if (!made.length) return
    runs.push(...made)
    found.push(chain)
    chain.forEach((c) => inFlight.add(c))
  })
  return runs
}

/** A riser's middle in the world (x, z). */
function middle(r: Riser): [number, number] {
  const tm = (r.t0 + r.t1) / 2
  return [r.up[0] * r.r - r.up[1] * tm, r.up[1] * r.r + r.up[0] * tm]
}

/**
 * A curved flight: one stretch of ramp per step, each from the nosing below it up to its own, as wide as the step and
 * turned with it, so together they follow the curve. None when a step is too narrow or too steep for one.
 */
function curvedRamps(chain: Riser[]): StairRun[] {
  // How far b is on from a, up the stairs as a faces (how the flight was linked).
  const along = (a: Riser, b: Riser) => { const [ax, az] = middle(a), [bx, bz] = middle(b); return (bx - ax) * a.up[0] + (bz - az) * a.up[1] }
  const out: StairRun[] = []
  for (let k = 0; k < chain.length; k++) {
    const c = chain[k], width = c.t1 - c.t0, rise = c.yt - c.yb
    // The tread in front of it: the one below, or (the first step) the next one's.
    const tread = k > 0 ? along(chain[k - 1], c) : along(c, chain[1])
    const slopeDeg = (Math.atan(rise / tread) * 180) / Math.PI
    if (width < MIN_WIDTH || slopeDeg > MAX_RAMP_DEG) return []
    const tm = (c.t0 + c.t1) / 2, across = [-c.up[1], c.up[0]]
    const at = (r: number, y: number): Vec3 => [c.up[0] * r + across[0] * tm, y + LIFT, c.up[1] * r + across[1] * tm]
    out.push({ up: c.up, steps: 1, rise, tread, from: at(c.r - tread, c.yb), to: at(c.r, c.yt), width, slopeDeg })
  }
  return out
}

/** How often along a single step its floors are checked (units). */
const SAMPLE = 1

/**
 * The wedges in front of a single step (see SINGLE_MAX_RISER): one over each stretch of it, at least MIN_WIDTH wide,
 * with floor at its foot for the wedge's length and floor on top a player's depth, checked every SAMPLE along it. A
 * long terrace edge with a crate or a wall somewhere along it still gets wedges where it's clear.
 */
function singleSteps(r: Riser, floorAt: (x: number, z: number, y: number, tol: number) => boolean): StairRun[] {
  const rise = r.yt - r.yb
  if (rise > SINGLE_MAX_RISER || r.t1 - r.t0 < MIN_WIDTH) return []
  const run = rise / Math.tan((SINGLE_DEG * Math.PI) / 180)
  const up = r.up, across: [number, number] = [-up[1], up[0]]
  const p = (along: number, t: number): [number, number] => [up[0] * along + across[0] * t, up[1] * along + across[1] * t]
  const clear = (t: number) => [0.3, run / 2, run + 0.2].every((d) => floorAt(...p(r.r - d, t), r.yb, 0.08))
    && [0.3, TOP_DEPTH / 2, TOP_DEPTH].every((d) => floorAt(...p(r.r + d, t), r.yt, 0.08))
  const out: StairRun[] = []
  const emit = (a: number, b: number) => {
    // The stretch from the first clear sample to the last, half a sample past each (within the step).
    const t0 = Math.max(r.t0, a - SAMPLE / 2), t1 = Math.min(r.t1, b + SAMPLE / 2), width = t1 - t0
    if (width < MIN_WIDTH) return
    const tm = (t0 + t1) / 2
    const at = (along: number, y: number): Vec3 => { const [x, z] = p(along, tm); return [x, y + LIFT, z] }
    out.push({ up, steps: 1, rise, tread: 0, from: at(r.r - run, r.yb), to: at(r.r, r.yt), width, slopeDeg: SINGLE_DEG })
  }
  let from: number | null = null, last = 0
  for (let t = r.t0 + 0.3; t <= r.t1 - 0.3 + 1e-6; t += SAMPLE) {
    if (clear(t)) { if (from === null) from = t; last = t } else if (from !== null) { emit(from, last); from = null }
  }
  if (from !== null) emit(from, last)
  return out
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
  const giant = chain.some((c) => c.yt - c.yb > MAX_RISER + 1e-6)
  // Two steps need stair proportions; two giant steps (a podium's, a grandstand's) a gentle slope and room to walk up.
  if (chain.length === 2 && (giant ? slopeDeg > GIANT_PAIR_DEG || width < 2 * MIN_WIDTH : slopeDeg > SHORT_MAX_DEG || chain.some((c) => c.yt - c.yb > SHORT_MAX_RISER + 0.04))) return null
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

/** The same runs in units `k` times as big (from the finder's 0.5 m units to a map's own, when its world scale differs). */
export function scaleRuns(runs: StairRun[], k: number): StairRun[] {
  if (k === 1) return runs
  const s = (v: number[]) => v.map((x) => x * k) as Vec3
  return runs.map((r) => ({ ...r, rise: r.rise * k, tread: r.tread * k, width: r.width * k, from: s(r.from), to: s(r.to) }))
}
