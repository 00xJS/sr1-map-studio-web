// Getting around the way the game's player does: gaps only a sprinting jump
// crosses (or none), drops that hurt or kill, and walls with no way up. The game
// climbs only at ledges a map lists, and an export lists them only for objects
// marked climbable; the floor graph counts the ones it would write (ledges.ts) as
// a way up, so a wall still found here is one no ledge gets you over.
import type { Bvh } from './bvh'
import { FREE_DROP, JUMP_UP, LETHAL_DROP, PLAYER, type FloorGraph } from './floor'
import { SOLID, type MoveFinding, type MoveKind } from './types'
import { statusSentence } from '../featureStatus'
import { CLIMB, GAP, MAX_HP, UNITS_PER_M, fallDamage } from '../player'
import type { Vec3 } from '../project'

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
/** Widest gap looked for, editor units (10 m): wider is open ground, not a gap. */
const GAP_SEARCH = 20
/** Findings of one kind closer than this are the same place, editor units (8 m). */
const APART = 16
/** At most this many places of each kind. */
const MAX_EACH = 12
/** Floor spots (about 1 m² each) a wall top needs to count as a platform worth climbing to, not a crate. */
const PLATFORM = 12

const m = (units: number) => Math.round((units / UNITS_PER_M) * 10) / 10

/** Every gap, drop and climb-only wall next to the floor players can reach. */
export function findMoves(bvh: Bvh, g: FloorGraph): MoveFinding[] {
  const { pos, count, reachable, cell } = g.grid
  const { nx, nz, colStart } = g
  const low = PLAYER.step + 0.15, head = PLAYER.stand - 0.3
  const colOf = (x: number, z: number) => [Math.floor((x - g.x0) / cell), Math.floor((z - g.z0) / cell)]
  /** Highest node in column (i, j) at or below y, or -1. */
  const below = (i: number, j: number, y: number) => {
    const c = j * nx + i
    for (let n = colStart[c]; n < colStart[c + 1]; n++) if (pos[n * 3 + 1] <= y + 1e-3) return n
    return -1
  }
  const hasNear = (i: number, j: number, lo: number, hi: number) => {
    const c = j * nx + i
    for (let n = colStart[c]; n < colStart[c + 1]; n++) { const y = pos[n * 3 + 1]; if (y >= lo && y <= hi) return true }
    return false
  }
  /** Floor about as high as node n, joined to it column by column: at least `need` spots of it (counting stops there). */
  const area = (n: number, need: number) => {
    const seen = new Set<number>([n]), queue = [n]
    for (let q = 0; q < queue.length && seen.size < need; q++) {
      const u = queue[q], [i, j] = colOf(pos[u * 3], pos[u * 3 + 2]), y = pos[u * 3 + 1]
      for (const [di, dj] of DIRS) {
        const a = i + di, b = j + dj
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue
        const c = b * nx + a
        for (let v = colStart[c]; v < colStart[c + 1]; v++) {
          if (Math.abs(pos[v * 3 + 1] - y) > PLAYER.step || seen.has(v)) continue
          seen.add(v); queue.push(v)
        }
      }
    }
    return seen.size >= need
  }
  /** How far down the first solid surface is from just above height y at (x, z), or Infinity (nothing: off the map). */
  const depth = (x: number, z: number, y: number) => { const d = bvh.closest(x, y + 0.1, z, 0, -1, 0, 1e5, SOLID); return d < 0 ? Infinity : d - 0.1 }
  const centre = (i: number, j: number) => [g.x0 + (i + 0.5) * cell, g.z0 + (j + 0.5) * cell]
  const out: Record<MoveKind, MoveFinding[]> = { 'sprint-gap': [], 'wide-gap': [], 'hurt-drop': [], 'kill-drop': [], 'climb-only': [] }
  const P = (n: number): Vec3 => [pos[n * 3], pos[n * 3 + 1], pos[n * 3 + 2]]

  for (let a = 0; a < count; a++) {
    // From reachable floor with room to stand around (not the top of a railing).
    if (!reachable[a] || !area(a, 4)) continue
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2]
    const [ci, cj] = colOf(ax, az)
    /** The narrowest gap from here, over every direction (the straight way across, not a diagonal). */
    let gap: MoveFinding | null = null, gapless = false
    for (const [di, dj] of DIRS) {
      const i = ci + di, j = cj + dj
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue
      const len = cell * (di && dj ? Math.SQRT2 : 1)
      // A wall a climb ledge would get you up, onto floor you can't reach (one on a climbable object is reachable):
      // a face in the way (anywhere across the next column) and a real platform on top, not a crate.
      const top = below(i, j, ay + CLIMB.maxM * UNITS_PER_M)
      const rise = top >= 0 ? pos[top * 3 + 1] - ay : 0
      if (rise > JUMP_UP && rise >= CLIMB.minM * UNITS_PER_M && !reachable[top]
        && bvh.blocked(ax, ay + low, az, ax + di * cell * 1.5, ay + low, az + dj * cell * 1.5, SOLID) && area(top, PLATFORM)) {
        out['climb-only'].push({
          kind: 'climb-only', at: [ax, ay, az], to: P(top), metres: m(rise),
          text: `A ${m(rise)} m wall with no way up. Marking the object on top Climbable lets players pull up, if its top is flat with an edge over 0.7 m.${statusSentence('climb_ledges')} Or add stairs or a ramp, if it should be a way up.`,
        })
        continue
      }
      const nxt: Vec3 = [ax + di * cell, ay, az + dj * cell]
      const open = !bvh.blocked(ax, ay + low, az, nxt[0], ay + low, nxt[2], SOLID) && !bvh.blocked(ax, ay + head, az, nxt[0], ay + head, nxt[2], SOLID)
      // Floor next door that you walk or jump onto, or can get back up from: no gap, no drop.
      if (!open || hasNear(i, j, ay - JUMP_UP, ay + JUMP_UP)) continue
      // Walking off the edge: how far down is it (to anything solid, floor or not), and is there floor across to jump to?
      const [cx, cz] = centre(i, j)
      const fall = depth(cx, cz, ay)
      if (fall <= JUMP_UP) continue
      const under = below(i, j, ay)
      if (fall > FREE_DROP) {
        const kind: MoveKind = fall >= LETHAL_DROP ? 'kill-drop' : 'hurt-drop'
        out[kind].push({
          kind, at: [ax, ay, az], to: under >= 0 ? P(under) : undefined, metres: Number.isFinite(fall) ? m(fall) : Infinity,
          text: !Number.isFinite(fall) ? 'Players can fall off the map here.'
            : kind === 'kill-drop' ? `A ${m(fall)} m drop: falling off kills.`
            : `A ${m(fall)} m drop: falling costs ${Math.round(fallDamage(fall / UNITS_PER_M))} of ${MAX_HP} health.`,
        })
      }
      // Across the gap: the first column with floor about as high as here (or a little lower) to land on.
      for (let k = 2; k * len <= GAP_SEARCH + len; k++) {
        const li = ci + di * k, lj = cj + dj * k
        if (li < 0 || lj < 0 || li >= nx || lj >= nz) break
        const land = below(li, lj, ay + PLAYER.step)
        if (land < 0 || pos[land * 3 + 1] < ay - JUMP_UP) {
          // Still over the gap, as long as it stays a pit (not a wall or a prop with no floor node on it).
          const [px, pz] = centre(li, lj)
          if (depth(px, pz, ay) <= JUMP_UP) break
          continue
        }
        const lx = pos[land * 3], lz = pos[land * 3 + 2]
        if (bvh.blocked(ax, ay + low, az, lx, ay + low, lz, SOLID) || bvh.blocked(ax, ay + head, az, lx, ay + head, lz, SOLID)) break
        // Somewhere to land, not the top of a railing.
        if (!area(land, 4)) break
        const width = (k - 1) * len
        if (width <= GAP.runM * UNITS_PER_M) { gapless = true; break }
        const kind: MoveKind = width <= GAP.sprintM * UNITS_PER_M ? 'sprint-gap' : 'wide-gap'
        // Too wide to jump matters where there's no other way over.
        if (kind === 'wide-gap' && reachable[land]) break
        if (!gap || width / UNITS_PER_M < gap.metres) gap = {
          kind, at: [ax, ay, az], to: P(land), metres: m(width),
          text: kind === 'sprint-gap' ? `A ${m(width)} m gap: only a sprinting jump gets across.` : `A ${m(width)} m gap: too wide to jump.`,
        }
        break
      }
    }
    if (gap && !gapless) out[gap.kind].push(gap)
  }
  // The worst first (the widest gap a sprint still crosses, the narrowest too wide, the highest drop, the lowest wall), one per place.
  const order: Record<MoveKind, (a: MoveFinding, b: MoveFinding) => number> = {
    'sprint-gap': (a, b) => b.metres - a.metres, 'wide-gap': (a, b) => a.metres - b.metres,
    'hurt-drop': (a, b) => b.metres - a.metres, 'kill-drop': (a, b) => b.metres - a.metres, 'climb-only': (a, b) => a.metres - b.metres,
  }
  const kept: MoveFinding[] = []
  for (const kind of Object.keys(out) as MoveKind[]) {
    const list = out[kind].sort((a, b) => order[kind](a, b) || a.at[0] - b.at[0] || a.at[2] - b.at[2])
    const mine: MoveFinding[] = []
    for (const f of list) {
      if (mine.some((o) => Math.hypot(o.at[0] - f.at[0], o.at[2] - f.at[2]) < APART && Math.abs(o.at[1] - f.at[1]) < 4)) continue
      mine.push(f)
      if (mine.length >= MAX_EACH) break
    }
    kept.push(...mine)
  }
  return kept
}

/** One line about the gaps, drops and walls found, for the report's findings (null when there are none). */
export function movesSummary(moves: MoveFinding[]): string | null {
  const n = (kind: MoveKind) => moves.filter((x) => x.kind === kind).length
  const say = (c: number, one: string, many: string) => (c ? [`${c} ${c === 1 ? one : many}`] : [])
  const said = [
    ...say(n('sprint-gap'), 'gap only a sprinting jump crosses', 'gaps only a sprinting jump crosses'),
    ...say(n('wide-gap'), 'gap too wide to jump', 'gaps too wide to jump'),
    ...say(n('kill-drop'), 'drop that kills', 'drops that kill'),
    ...say(n('hurt-drop'), 'drop that hurts', 'drops that hurt'),
    ...say(n('climb-only'), 'wall with no way up', 'walls with no way up'),
  ]
  return said.length ? `Getting around: ${said.join(', ')}.` : null
}
