// Where a player respawns, by the game's rules (src/lib/player.ts SPAWN_RULES):
// spawns of your side only; none used in the last 5 s or with someone standing
// on it (unless every one is, then the least bad); none with an enemy within
// 5 m; then a random pick weighted by the distance to the nearest enemy squared,
// so a spawn twice as far from the nearest enemy is four times as likely.
// Nothing stops a spawn in an enemy's view. Positions in editor units, times in ms.
import { SPAWN_RULES, UNITS_PER_M } from '../player'
import type { Vec3 } from '../project'
import type { Team } from './types'

export interface SpawnSpot {
  at: Vec3
  team: Team
  /** When someone last spawned here (ms), if ever. */
  used?: number
}

export interface Someone { at: Vec3; team: Team }

const NEAR = SPAWN_RULES.enemyM * UNITS_PER_M, NEAR_DY = SPAWN_RULES.enemyDyM * UNITS_PER_M, BOX = SPAWN_RULES.boxM * UNITS_PER_M

/** Whether `other` is an enemy of someone on `team` (everyone is, in free-for-all). */
export const enemyOf = (team: Team, other: Team) => team === 'shared' || other === 'shared' || other !== team

/**
 * The spawn (an index into `spots`) a player on `team` gets at `now`, with the others where they are; `from` is
 * where the player died (the fallback is the spawn nearest to it). -1 when no spawn is for this side.
 */
export function pickSpawn(spots: SpawnSpot[], team: Team, others: Someone[], now: number, rand: () => number, from?: Vec3): number {
  const mine = spots.map((_, i) => i).filter((i) => team === 'shared' ? spots[i].team === 'shared' : spots[i].team === team)
  if (!mine.length) return -1
  const standing = (s: SpawnSpot) => others.some((o) => Math.abs(o.at[0] - s.at[0]) < BOX && Math.abs(o.at[2] - s.at[2]) < BOX && Math.abs(o.at[1] - s.at[1]) < BOX)
  const recent = (s: SpawnSpot) => s.used !== undefined && now - s.used < SPAWN_RULES.reuseMs
  let ok = mine.filter((i) => !recent(spots[i]) && !standing(spots[i]))
  // Every spawn is taken: the one used longest ago.
  if (!ok.length) ok = [mine.reduce((a, b) => ((spots[a].used ?? -Infinity) <= (spots[b].used ?? -Infinity) ? a : b))]
  const enemies = others.filter((o) => enemyOf(team, o.team))
  if (!enemies.length) return ok[Math.floor(rand() * ok.length)]
  const weight = ok.map((i) => {
    const s = spots[i].at
    let best = Infinity
    for (const e of enemies) {
      const dy = e.at[1] - s[1], d2 = (e.at[0] - s[0]) ** 2 + dy * dy + (e.at[2] - s[2]) ** 2
      if (d2 < NEAR * NEAR && Math.abs(dy) < NEAR_DY) return 0
      best = Math.min(best, d2)
    }
    return best
  })
  const total = weight.reduce((a, b) => a + b, 0)
  if (total > 0) {
    let r = rand() * total
    for (let k = 0; k < ok.length; k++) { r -= weight[k]; if (weight[k] > 0 && r <= 0) return ok[k] }
    for (let k = ok.length - 1; k >= 0; k--) if (weight[k] > 0) return ok[k]
  }
  // An enemy near every spawn: the one nearest to where the player died.
  if (!from) return ok[Math.floor(rand() * ok.length)]
  const dist = (i: number) => Math.hypot(spots[i].at[0] - from[0], spots[i].at[1] - from[1], spots[i].at[2] - from[2])
  return ok.reduce((a, b) => (dist(b) < dist(a) ? b : a))
}
