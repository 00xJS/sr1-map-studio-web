// Editor units and metres. The exporter scales the map by settings.world_scale (0.5 by default: 1 editor
// unit = half a metre), so a distance in the map is units × world_scale metres in game. The walk-through
// player and the map checks are built at the default scale (sr1char/player.ts UNITS_PER_M), so they keep
// their own fixed conversion.

export const DEFAULT_WORLD_SCALE = 0.5

/** A map distance in editor units, in game metres. */
export const toMetres = (units: number, worldScale = DEFAULT_WORLD_SCALE) => units * worldScale

/** Game metres back to editor units. */
export const toUnits = (metres: number, worldScale = DEFAULT_WORLD_SCALE) => (worldScale ? metres / worldScale : metres)

/** A distance in metres for people: whole metres from 10 up, one decimal below, "–" when unknown. */
export function fmtM(metres: number | null | undefined, unit = ' m'): string {
  if (metres === null || metres === undefined || !Number.isFinite(metres)) return '–'
  const v = Math.abs(metres) >= 10 ? Math.round(metres) : +metres.toFixed(1)
  return v + unit
}

/** A map distance in editor units, written in metres. */
export const fmtUnits = (units: number, worldScale = DEFAULT_WORLD_SCALE) => fmtM(toMetres(units, worldScale))
