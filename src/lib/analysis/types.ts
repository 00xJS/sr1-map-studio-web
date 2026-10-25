// Map health checks: what goes in (collision triangles and markers) and what
// comes out (a floor grid with per-spot values, spawn and fairness verdicts).
// Everything is in editor units (1 unit = 0.5 m in game) unless a field says metres.
import type { Vec3 } from '../project'

/** Triangle flag bits. */
export const SOLID = 1
/** Blocks sight (glass, fences and other see-through materials do not). */
export const OPAQUE = 2

export interface AnalysisMarker {
  type: string
  position: Vec3
  uid?: string
  weapon?: string
}

export interface AnalysisInput {
  /** World-space triangles, 9 floats each. */
  tris: Float32Array
  /** One byte per triangle: SOLID | OPAQUE. */
  flags: Uint8Array
  markers: AnalysisMarker[]
}

export interface AnalysisOptions {
  /** Floor grid spacing, editor units (default: 2, coarser on very big maps). */
  cell?: number
  /** Most rays the sight check may cast (default 4 million). */
  rayBudget?: number
  /** Longest sight line that counts, editor units (default 300 = 150 m). */
  maxSight?: number
  /** Highest drop a player takes on purpose, editor units (default: anything short of the 9 m (18 units) that kills; drops over 4 m count as costly). */
  maxDrop?: number
  /** Bot playtest: bots and the trips they make between spawns, weapons and drop-offs (default 8 and 800). */
  bots?: number
  trips?: number
  seed?: number
  /** Called now and then with a short description and 0..1. */
  onProgress?: (text: string, done: number) => void
}

/** The floor players can stand on: one node per standable spot. */
export interface FloorGrid {
  cell: number
  count: number
  /** x, y, z of each node (y = the floor). */
  pos: Float32Array
  /** 1 where there is only room to crouch. */
  crouchOnly: Uint8Array
  /** 1 where a player can get to from the spawns. */
  reachable: Uint8Array
}

export type Team = 'red' | 'blue' | 'shared'
export type Risk = 'ok' | 'watch' | 'campable'

export interface SpawnReport {
  /** Index into the input markers. */
  marker: number
  uid?: string
  type: string
  team: Team
  /** 1-based, counting every spawn in marker order (as the walk-through numbers them). */
  number: number
  position: Vec3
  /** Enemy spawns and weapon pickups with a clear view of this spawn (standing eyes). */
  seenBySpawns: number
  seenByPickups: number
  /** Where those are, for drawing. */
  seenFrom: Vec3[]
  /** Share of the reachable floor that can see this spot (standing). */
  exposure: number
  /** Shortest walk from an enemy spawn, metres (null: no path). */
  enemyWalkM: number | null
  /** Shortest walk to a weapon, metres. */
  weaponWalkM: number | null
  risk: Risk
  reasons: string[]
}

export interface TeamStats {
  spawns: number
  /** Average walk from a spawn to its nearest weapon, metres. */
  toWeaponM: number | null
  /** Walk from the team's closest spawn to the nearest power weapon (rocket, sniper), metres. */
  toPowerM: number | null
  toDropM: number | null
  /** Walk to the nearest high ground (the top quarter of the map's floor heights), metres. */
  toHighM: number | null
  /** Share of the floor this team reaches first. */
  territory: number
  /** Average exposure of the team's spawns. */
  spawnExposure: number
}

export interface FairnessReport {
  /** 0..100, 100 = both teams get the same chances. */
  score: number
  /** 'teams' compares red and blue spawns; 'halves' compares the −Z and +Z halves (maps without team spawns). */
  basis: 'teams' | 'halves' | 'none'
  red: TeamStats | null
  blue: TeamStats | null
  /** Markers with no point-mirrored twin (same kind, red and blue swapped). */
  unmirrored: { type: string; position: Vec3 }[]
  reasons: string[]
}

export interface SightLane { from: Vec3; to: Vec3; metres: number }

/**
 * Getting around: 'sprint-gap' only a sprinting jump crosses, 'wide-gap' too wide to jump, 'hurt-drop' a fall that
 * costs health, 'kill-drop' one that kills (or off the map), 'climb-only' a wall the game's own maps would let you
 * climb but exported maps can't.
 */
export type MoveKind = 'sprint-gap' | 'wide-gap' | 'hurt-drop' | 'kill-drop' | 'climb-only'

export interface MoveFinding {
  kind: MoveKind
  /** Where you stand (the edge, or the foot of the wall). */
  at: Vec3
  /** The other side: where you land, or the top of the wall (none when you'd fall off the map). */
  to?: Vec3
  /** The gap's width, the drop or the wall's height (Infinity: off the map). */
  metres: number
  /** The finding in plain words. */
  text: string
}

export interface HealthReport {
  version: 1
  grid: FloorGrid
  /** Per node, 0..1: share of the floor that sees a player standing there. */
  exposure: Float32Array
  /** The same for a crouching player. */
  exposureCrouch: Float32Array
  /** Per node, 0..1: how often the bots ran through. */
  traffic: Float32Array
  /** Per node: −1 red reaches it first, +1 blue, 0 even or unreachable. */
  territory: Int8Array
  /** The longest clear sight lines across the map (sniper lanes). */
  lanes: SightLane[]
  /** Share of the floor seen by fewer than 3% of the map (hiding spots). */
  blindShare: number
  /** Share of the floor seen by more than 40% of the map (wide open ground). */
  openShare: number
  spawns: SpawnReport[]
  fairness: FairnessReport
  /** Markers a player cannot walk to. */
  unreachable: { type: string; position: Vec3; /** Why players can't use it. */ why?: string }[]
  /** The busiest spots from the bot playtest. */
  hotspots: Vec3[]
  /** Gaps, drops and climb-only walls next to the reachable floor. */
  moves: MoveFinding[]
  /** The map's textures as the exporter will store them (textureBudget.ts), when they were measured. */
  textures?: { pictures: number; materials: number; mb: number; over: boolean }
  /** 0..100 overall, with the headline findings in plain language (most important first). */
  score: number
  findings: string[]
  stats: { triangles: number; nodes: number; reachable: number; observers: number; rays: number; ms: Record<string, number> }
}
