// Playtest logs from the companion mod (companion-mod/playtest.lua): one JSON object a line, recorded while the
// user plays a match, with positions in game metres. Parsed here, and put back into editor coordinates by running
// the exporter's conversion backwards (sr1_cts.convert_xyz: game = mirror_x((editor - origin) * world_scale), the
// origin being the base map's centre in x and z and its lowest point in y). The exporter writes that frame into
// MAP_STUDIO_EXPORT.txt and the mod copies it into each log's start line, so a log carries its own conversion.
import type { ProjectSettings, Vec3 } from './project'

/** How the exporter turns editor units into game metres. */
export interface GameFrame { origin: Vec3; worldScale: number; mirrorX: boolean }

export type PlaytestKind = 'start' | 'pos' | 'push' | 'fall' | 'stuck' | 'mark' | 'respawn' | 'rain' | 'end'

interface Common {
  /** Seconds since the recording started. */
  t: number
  map: string
  /** Game metres. */
  pos: Vec3
  /** The minimap's heading as the game has it (null when the game had none). */
  heading: number | null
  /** 1-based line in the log. */
  line: number
}

export type StartEvent = Common & { ev: 'start'; date?: string; project?: string; exported?: string; frame?: GameFrame; floorY?: number }
export type PlaytestEvent = StartEvent | Common & (
  | { ev: 'pos' }
  /** The camera pushed in by `by` metres from its usual distance; `wanted` is where it wanted to be. */
  | { ev: 'push'; by: number; usual?: number; wanted?: Vec3; camera?: Vec3 }
  /** A drop of more than 8 m (`drop`, from height `fromY`), or falling under the map's lowest floor (`belowFloor`). */
  | { ev: 'fall'; belowFloor: boolean; drop?: number; fromY?: number; speed?: number; floorY?: number }
  | { ev: 'stuck'; seconds: number; keys: string }
  | { ev: 'mark'; n: number }
  | { ev: 'respawn'; from?: Vec3 }
  /** The rain where the camera is: whether the game counts it as indoors (`indoor`, with the rain `fade` 0..1),
   *  the flags of the region it is in (-1 none), the weather stage, the console's Rain_density when set, and the
   *  two screen-wide rain layers after the fade. */
  | { ev: 'rain'; indoor: boolean; fade?: number; region?: number; weather?: number; density?: number; screenRain?: [number, number]; camera?: Vec3 }
  | { ev: 'end'; reason: string })

export interface Playtest {
  map: string
  start?: StartEvent
  events: PlaytestEvent[]
  /** Seconds recorded: the last event's time. */
  duration: number
  /** Whether the log has its end line (no end: the game closed or crashed while recording). */
  complete: boolean
  /** Lines that aren't a playtest event, such as a line cut off by a crash or an event from a newer mod (1-based). */
  skipped: number[]
}

const num = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined
const text = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined
const vec = (v: unknown): Vec3 | undefined =>
  Array.isArray(v) && v.length === 3 && v.every((n) => num(n) !== undefined) ? [v[0], v[1], v[2]] : undefined

function event(o: Record<string, unknown>, line: number): PlaytestEvent | null {
  const t = num(o.t), pos = vec(o.pos), map = text(o.map)
  if (t === undefined || !pos || map === undefined) return null
  const c: Common = { t, map, pos, heading: num(o.heading) ?? null, line }
  switch (o.ev) {
    case 'start': {
      const origin = vec(o.origin), worldScale = num(o.world_scale), mirrorX = typeof o.mirror_x === 'boolean' ? o.mirror_x : undefined
      return { ...c, ev: 'start', date: text(o.date), project: text(o.project), exported: text(o.exported), floorY: num(o.floor_y),
        frame: origin && worldScale && worldScale > 0 && mirrorX !== undefined ? { origin, worldScale, mirrorX } : undefined }
    }
    case 'pos': return { ...c, ev: 'pos' }
    case 'push': {
      const by = num(o.by)
      return by === undefined ? null : { ...c, ev: 'push', by, usual: num(o.usual), wanted: vec(o.wanted), camera: vec(o.camera) }
    }
    case 'fall':
      return { ...c, ev: 'fall', belowFloor: o.below_floor === true, drop: num(o.drop), fromY: num(o.from_y), speed: num(o.speed), floorY: num(o.floor_y) }
    case 'stuck': return { ...c, ev: 'stuck', seconds: num(o.seconds) ?? 0, keys: text(o.keys) ?? '' }
    case 'mark': return { ...c, ev: 'mark', n: num(o.n) ?? 0 }
    case 'respawn': return { ...c, ev: 'respawn', from: vec(o.from) }
    case 'rain': {
      const a = num(o.screen_rain), b = num(o.screen_rain2)
      return { ...c, ev: 'rain', indoor: o.indoor === true, fade: num(o.fade), region: num(o.region), weather: num(o.weather),
        density: num(o.density), screenRain: a !== undefined && b !== undefined ? [a, b] : undefined, camera: vec(o.camera) }
    }
    case 'end': return { ...c, ev: 'end', reason: text(o.reason) ?? '' }
    default: return null
  }
}

/** Reads a playtest log (.jsonl). Lines it can't read are listed in `skipped`, not thrown. */
export function parsePlaytest(log: string): Playtest {
  const events: PlaytestEvent[] = [], skipped: number[] = []
  log.split(/\r?\n/).forEach((raw, i) => {
    const s = raw.trim()
    if (!s) return
    let o: unknown
    try { o = JSON.parse(s) } catch { skipped.push(i + 1); return }
    const e = o && typeof o === 'object' && !Array.isArray(o) ? event(o as Record<string, unknown>, i + 1) : null
    if (e) events.push(e)
    else skipped.push(i + 1)
  })
  const start = events.find((e): e is StartEvent => e.ev === 'start')
  return {
    map: start?.map ?? events[0]?.map ?? '', start, events, skipped,
    duration: events.length ? events[events.length - 1].t : 0,
    complete: events[events.length - 1]?.ev === 'end',
  }
}

/** The frame from a project's settings and the export's origin (when a log has none of its own). */
export const frameOf = (s: Pick<ProjectSettings, 'world_scale' | 'mirror_x'>, origin: Vec3): GameFrame =>
  ({ origin, worldScale: s.world_scale || 0.5, mirrorX: s.mirror_x })

/** Editor units to game metres, as the exporter converts markers (sr1_cts.convert_xyz). */
export function editorToGame(p: Vec3, f: GameFrame): Vec3 {
  const x = (p[0] - f.origin[0]) * f.worldScale
  return [f.mirrorX ? -x : x, (p[1] - f.origin[1]) * f.worldScale, (p[2] - f.origin[2]) * f.worldScale]
}

/** Game metres to editor units: the exporter's conversion backwards. */
export function gameToEditor(p: Vec3, f: GameFrame): Vec3 {
  const x = f.mirrorX ? -p[0] : p[0]
  return [x / f.worldScale + f.origin[0], p[1] / f.worldScale + f.origin[1], p[2] / f.worldScale + f.origin[2]]
}

export interface PlaytestSpot { ev: 'push' | 'fall' | 'stuck' | 'mark'; t: number; at: Vec3; event: PlaytestEvent }

/** The spots worth a look (falls, stuck spots, camera pushes, End marks) in editor coordinates, in time order. */
export function playtestSpots(log: Playtest, frame = log.start?.frame): PlaytestSpot[] {
  if (!frame) return []
  return log.events.flatMap((e) => e.ev === 'push' || e.ev === 'fall' || e.ev === 'stuck' || e.ev === 'mark'
    ? [{ ev: e.ev, t: e.t, at: gameToEditor(e.pos, frame), event: e }] : [])
}

/** Where the player went, in editor coordinates: the once-a-second samples, a new run after each respawn. */
export function playtestPath(log: Playtest, frame = log.start?.frame): Vec3[][] {
  if (!frame) return []
  const runs: Vec3[][] = [[]]
  for (const e of log.events) {
    if (e.ev === 'respawn' && runs[runs.length - 1].length) runs.push([])
    if (e.ev === 'pos' || e.ev === 'respawn') runs[runs.length - 1].push(gameToEditor(e.pos, frame))
  }
  return runs.filter((r) => r.length)
}

// ------------------------------------------------------------ MAP_STUDIO_EXPORT.txt
// The export note's lines the mod reads (companion-mod/playtest.lua) and the editor reads back (install.ts).

export interface ExportFacts { projectId: string; origin: Vec3; worldScale: number; mirrorX: boolean; floorY: number }

const round = (n: number) => +n.toFixed(4)

/** The note's lines for the project and its game frame. */
export function exportFactLines(f: ExportFacts): string[] {
  return [
    `Project id: ${f.projectId}`,
    `Map origin: ${f.origin.map(round).join(' ')}`,
    `World scale: ${f.worldScale}`,
    `Mirror X: ${f.mirrorX ? 'on' : 'off'}`,
    `Lowest floor: ${round(f.floorY)} m`,
  ]
}

/** What an export note says about its project and frame; older notes have none of it. */
export function readExportNote(note: string): { projectId?: string; frame?: GameFrame; floorY?: number } {
  const field = (name: string) => note.match(new RegExp(`^${name}: *(.+?) *$`, 'm'))?.[1]
  const origin = field('Map origin')?.split(/\s+/).map(Number)
  const worldScale = Number(field('World scale'))
  const mirror = field('Mirror X')
  const floor = parseFloat(field('Lowest floor') ?? '')
  return {
    projectId: field('Project id'),
    frame: origin?.length === 3 && origin.every(Number.isFinite) && worldScale > 0 && mirror
      ? { origin: origin as Vec3, worldScale, mirrorX: mirror === 'on' } : undefined,
    floorY: Number.isFinite(floor) ? floor : undefined,
  }
}
