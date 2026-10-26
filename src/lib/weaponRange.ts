// How far each multiplayer weapon hits reliably, for judging sight lines: a long line across a map is no danger to
// a player when nothing on the map can hit them from the far end. Worked out from the game's own weapon tables
// (weapons.xtbl with weapons_mp_overrides.xtbl): a shot leaves in a random cone the weapon's spread wide (its first
// shot, before firing widens it), so it stays on a player (about 0.85 m across) out to 0.425 m / tan(spread).
// Shotguns throw their pellets over a fixed cone. A sniper rifle zoomed fires straight, and an RPG's blast makes up
// for aim. Spread read as the cone's half-angle in degrees: that reading is our own, not checked in the game's code.

/** Metres: the farthest a weapon hits a standing player reliably. */
export const REACH_M: Record<string, number> = {
  // Spread at the first shot in multiplayer: 1° (Beretta, TEC-9, MAC-10, AK-47), 0.5° (Glock), 1.5° (Desert
  // Eagle), 0.25° (M16), 0.1° (Magnum).
  beretta: 24, tec9: 24, mac10: 24, ak47: 24, glock: 49, 'desert eagle': 16, m16: 97, magnum: 243,
  // Four pellets over an 8-9° cone: about one on a player at 10 m.
  pump_action_shotgun: 10, spas12: 10, twelve_gauge: 10, pimpcane: 10,
  // Thrown, and melee.
  molotov: 25, grenade: 25, pipe_bomb: 25, baseball_bat: 2, nightstick: 2, knife: 1.5,
  sniper_rifle: 150, rpg_launcher: 150, rpg_laser: 150,
}

/**
 * The range sight lines are judged at when nothing longer-reaching is in play: past it, the guns players spawn with
 * and most pickups (everything but the M16, the Magnum, the sniper rifle and the RPG) can't hit a player reliably.
 */
export const AIMED_M = 50

/** Metres a weapon pickup's weapon reaches (an unknown weapon: the aimed range). */
export const reachOf = (weapon?: string) => (weapon && REACH_M[weapon.toLowerCase()]) || AIMED_M

/** The weapons that hit reliably past AIMED_M. */
export const longReach = (weapon?: string) => reachOf(weapon) > AIMED_M
