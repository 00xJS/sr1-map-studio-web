// How the game's player moves, falls and spawns, in one place. Sizes are in
// editor units (1 unit = 0.5 m in game) unless the name says metres (M) or
// seconds/milliseconds. Values noted "inferred" are strong inferences from the
// game rather than numbers read straight out of it. No three.js here, so the
// map-health worker can use it too.

/** Editor units per game metre. */
export const UNITS_PER_M = 2

/** Highest step walked up without jumping: about 0.28 m (inferred from the round bottom of the player's capsule). */
export const STEP = 0.56
/**
 * Steepest slope walked up. The game allows 70° (inferred); 60° here because the map checks only sample the floor
 * every metre or so, and 60° is also the steepest floor they count as something to stand on.
 */
export const MAX_SLOPE_DEG = 60
/** Jump height (the top of the jump), 0.85 m. */
export const JUMP_HEIGHT = 1.7
/** Gravity on the player: 14.7 m/s², 1.5 × normal (inferred). */
export const GRAVITY = 29.4
/** Take-off speed that reaches JUMP_HEIGHT: 10 units/s (5 m/s), 0.68 s in the air. */
export const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT)
/** Highest ledge a jump gets you onto, about 1.1 m: the jump plus a step (inferred). */
export const MANTLE = 2.2

/** Running (a keyboard always runs), 4.5 m/s. */
export const RUN_SPEED = 9
/** Sprinting, 10.6 m/s (inferred: the fastest of the game's three on-foot speeds). */
export const SPRINT_SPEED = 21.2
/** Crouched, 1.9 m/s. */
export const CROUCH_SPEED = 3.8
/** The multiplayer sprint meter: 3 s of sprint; it refills 2 s after you stop, over 6 s; a jump costs 20 % of it. */
export const SPRINT = { useS: 3, delayS: 2, refillS: 6, jumpCost: 0.2 }

/** On-foot camera: 60° wide at 4:3, which is 46.8° top to bottom (three.js `fov`). */
export const CAMERA_FOV = 46.8
/** How far the on-foot camera looks down and up, degrees (positive looks up). */
export const PITCH_DOWN_DEG = -45
export const PITCH_UP_DEG = 60
/** Walk-mode fog: starts 40 units (20 m) away, strongest from 400 (200 m), and never thicker than 75 %. */
export const FOG = { near: 40, far: 400, max: 0.75 }

/** Multiplayer health, every mode. */
export const MAX_HP = 375
/** Falls up to 4 m are free; above that each metre costs 20 % of full health (375 HP: 75 HP a metre). */
export const FALL = { freeM: 4, perM: 0.2 }
/** A fall this high kills from full health: 9 m. */
export const LETHAL_FALL_M = FALL.freeM + 1 / FALL.perM
/** Health lost falling `metres`. */
export const fallDamage = (metres: number, hp = MAX_HP) => (metres <= FALL.freeM ? 0 : hp * (metres - FALL.freeM) * FALL.perM)

/** Ledge climbing: an edge 0.75 to 3.15 m above the feet, only where the map lists climb ledges (exported maps have none yet). */
export const CLIMB = { minM: 0.75, maxM: 3.15 }
/** Jumping a gap: up to 2.5 m from a run, up to 6 m only from a sprint, wider can't be jumped (inferred: speed kept in the air). */
export const GAP = { runM: 2.5, sprintM: 6 }
/** A crouching player is 1.11 m tall, so cover must be at least this high to hide one, metres. */
export const CROUCH_COVER_M = 1.15

/**
 * The game's spawn rules: a spawn is skipped while an enemy is within 5 m (and less than 5 m above or below), for
 * 5 s after someone spawned there, and while someone stands in its 2 m box; the rest are picked at random, weighted
 * by the distance to the nearest enemy squared.
 */
export const SPAWN_RULES = { enemyM: 5, enemyDyM: 5, reuseMs: 5000, boxM: 2 }
/** After dying you wait 5 s to respawn. */
export const RESPAWN_DELAY_MS = 5000

/** Weapon pickups come back after 15 s, a sniper rifle after 20 s, an RPG or other launcher after 30 s (the game's defaults). */
export const PICKUP_RESPAWN_MS = { normal: 15000, sniper: 20000, launcher: 30000 }

/** How long a weapon pickup stays away once taken: the time set on the marker (`own`, ms), or the game's default for that weapon. */
export function pickupRespawnMs(weapon: string | undefined, own?: number | null): number {
  if (typeof own === 'number' && Number.isFinite(own) && own > 0) return Math.round(own)
  const w = (weapon ?? '').toLowerCase()
  if (/rpg|launcher/.test(w)) return PICKUP_RESPAWN_MS.launcher
  if (/sniper/.test(w)) return PICKUP_RESPAWN_MS.sniper
  return PICKUP_RESPAWN_MS.normal
}

/**
 * The sprint meter. `update` each frame with whether the player is trying to sprint; it answers whether they do.
 * Once it runs dry, sprinting waits until the sprint key is let go.
 */
export class SprintMeter {
  /** 0 empty .. 1 full. */
  level = 1
  private rest = 0
  private dry = false

  update(dt: number, wants: boolean): boolean {
    if (!wants) this.dry = false
    const sprinting = wants && !this.dry && this.level > 0
    if (sprinting) {
      this.level = Math.max(0, this.level - dt / SPRINT.useS)
      this.rest = 0
      if (this.level === 0) this.dry = true
    } else {
      this.rest += dt
      if (this.rest >= SPRINT.delayS) this.level = Math.min(1, this.level + dt / SPRINT.refillS)
    }
    return sprinting
  }

  /** A jump uses some of the meter. */
  jump() {
    this.level = Math.max(0, this.level - SPRINT.jumpCost)
    this.rest = 0
  }

  /** Sprinting is out until the key is let go. */
  get empty() { return this.dry }

  reset() { this.level = 1; this.rest = 0; this.dry = false }
}
