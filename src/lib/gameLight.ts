// How the game lights a multiplayer map, for the editor's "game lighting": a warm sun with real shadows, a cool
// fill light from the other side, a flat ambient and a fog that never passes a set strength. No tone mapping, no
// bloom. Maps with "always clear" on are always lit as at noon under clear skies (NOON below, matched to the game).
// Other times of day and weathers come from the player's own game files (time_of_day.xtbl and
// weather_time_of_day.xtbl in misc.vpp_xbox2), read in this browser and never stored or uploaded.
import type { Vec3 } from './project'

/** A lighting state. Colours are 0-1 (the game's bytes / 255); directions point toward the light, in editor axes. */
export interface GameLight {
  name: string
  sun: Vec3
  sunDir: Vec3
  /** The sun (or moon) casts shadows. */
  shadows: boolean
  fill: Vec3
  fillDir: Vec3
  ambient: Vec3
  /** Fog: colour, start and end in metres, and the most it ever covers (0-1). */
  fog: { color: Vec3; start: number; end: number; strength: number }
  /** Sky: top and horizon colours, and the horizon haze. */
  sky: { top: Vec3; horizon: Vec3; haze: Vec3 }
}

const hex = (h: string): Vec3 => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Vec3

/** Noon under clear skies, as every map with "always clear" weather is lit in multiplayer. */
export const NOON: GameLight = {
  name: 'Noon, clear',
  sun: hex('#c8ad9d'), sunDir: [0.3, 0.84, 0.46], shadows: true,
  fill: hex('#394448'), fillDir: [-0.66, 0.17, -0.73],
  ambient: hex('#606978'),
  fog: { color: hex('#c8a9a6'), start: 0, end: 186, strength: 0.5 },
  sky: { top: hex('#567bf3'), horizon: hex('#a4b6f1'), haze: hex('#b6b6cc') },
}

/** The SRMaxDetail mod's daytime look (ambient ×0.8, fill ×0.7, sun ×1.12), for players who use it. */
export function maxDetail(l: GameLight): GameLight {
  const k = (c: Vec3, f: number): Vec3 => c.map((v) => Math.min(1, v * f)) as Vec3
  return { ...l, name: l.name + ' (SRMaxDetail)', ambient: k(l.ambient, 0.8), fill: k(l.fill, 0.7), sun: k(l.sun, 1.12) }
}

// ---------------- the game's tables ----------------

interface Node { tag: string; text: string; kids: Node[] }

/** A small XML reader for the game's tables (elements and text only). */
export function parseXml(xml: string): Node {
  const root: Node = { tag: '#root', text: '', kids: [] }
  const stack = [root]
  const re = /<(\/?)([A-Za-z_][\w.-]*)[^>]*?(\/?)>|([^<]+)/g
  for (let m: RegExpExecArray | null; (m = re.exec(xml));) {
    const top = stack[stack.length - 1]
    if (m[4] !== undefined) { top.text += m[4]; continue }
    if (m[1]) { if (stack.length > 1) stack.pop(); continue }
    const n: Node = { tag: m[2], text: '', kids: [] }
    top.kids.push(n)
    if (!m[3]) stack.push(n)
  }
  return root
}

const find = (n: Node | undefined, path: string): Node | undefined =>
  path.split('/').reduce<Node | undefined>((cur, t) => cur?.kids.find((k) => k.tag === t), n)
const text = (n: Node | undefined, path: string) => find(n, path)?.text.trim() ?? ''
const num = (n: Node | undefined, path: string): number | undefined => { const v = text(n, path); return v === '' || !Number.isFinite(+v) ? undefined : +v }
const rgb = (n: Node | undefined, path: string): Vec3 | undefined => {
  const c = find(n, path)
  if (!c) return undefined
  const v = ['R', 'G', 'B'].map((k) => num(c, k))
  return v.every((x) => x !== undefined) ? v.map((x) => x! / 255) as Vec3 : undefined
}
/** HHMM to minutes after midnight. */
const minutes = (t: number) => Math.floor(t / 100) * 60 + (Math.round(t) % 100)

interface Segment {
  name: string; at: number; moon: boolean; shadows: boolean
  ambient: Vec3; sun: Vec3; fill: Vec3; haze: Vec3; top: Vec3; horizon: Vec3
  fog: { color: Vec3; start: number; end: number; strength: number }
  S: number; L: number; MS: number; ML: number; fillH: number; fillE: number
}
type Stage = Partial<Pick<Segment, 'ambient' | 'sun' | 'fill' | 'haze' | 'top' | 'horizon'>> & { fog?: Partial<Segment['fog']> }

export interface LightTables { segments: Segment[]; weather: { at: number; name: string; stages: Record<string, Stage> }[] }

const BLACK: Vec3 = [0, 0, 0]

/** Reads time_of_day.xtbl and weather_time_of_day.xtbl. */
export function readLightTables(timeOfDay: string, weatherTimes: string): LightTables {
  const segments: Segment[] = []
  for (const s of find(parseXml(timeOfDay), 'root/Table')?.kids.filter((k) => k.tag === 'Time_Segment') ?? []) {
    const P = find(s, 'Parameters')
    segments.push({
      name: text(s, 'Name'), at: minutes(num(s, 'Time') ?? 0), moon: /moon/i.test(text(s, 'Light_Type/Flag')), shadows: !/false|no|0/i.test(text(s, 'Cast_Shadows') || 'true'),
      ambient: rgb(P, 'Colors/Level_Ambient_Light_Color') ?? BLACK, sun: rgb(P, 'Colors/Tod_Light_Color') ?? BLACK, fill: rgb(P, 'Colors/Fill_Light_Color') ?? BLACK,
      haze: rgb(P, 'Colors/Haze_Color') ?? BLACK, horizon: rgb(P, 'Colors/Skybox_Colors/Pos1') ?? BLACK, top: rgb(P, 'Colors/Skybox_Colors/Pos4') ?? BLACK,
      fog: { color: rgb(P, 'Fog/Fog_Color') ?? BLACK, start: num(P, 'Fog/Fog_Start_Distance') ?? 0, end: num(P, 'Fog/Fog_End_Distance') ?? 200, strength: num(P, 'Fog/Fog_Strength') ?? 0 },
      S: num(P, 'Sun/Sun_Rotation_Angle') ?? 0, L: num(P, 'Sun/Light_Rotation_Angle') ?? 45, MS: num(P, 'Moon/Moon_Rotation_Angle') ?? 0, ML: num(P, 'Moon/Light_Rotation_Angle') ?? 45,
      fillH: num(P, 'Fill_Pos_Override/Heading') ?? 0, fillE: num(P, 'Fill_Pos_Override/Elevation') ?? 10,
    })
  }
  segments.sort((a, b) => a.at - b.at)
  const weather: LightTables['weather'] = []
  for (const s of find(parseXml(weatherTimes), 'root/Table')?.kids ?? []) {
    const stagesNode = find(s, 'Weather_Stages')
    if (!stagesNode) continue
    const stages: Record<string, Stage> = {}
    for (const g of stagesNode.kids) {
      const fog: Partial<Segment['fog']> = {}
      const fc = rgb(g, 'Fog/Color'), fs = num(g, 'Fog/Strength'), f0 = num(g, 'Fog/Start_Dist'), f1 = num(g, 'Fog/End_Dist')
      if (fc) fog.color = fc
      if (fs !== undefined) fog.strength = fs
      if (f0 !== undefined) fog.start = f0
      if (f1 !== undefined) fog.end = f1
      const st: Stage = { ambient: rgb(g, 'Ambients/Level'), sun: rgb(g, 'Light_Colors/Main_Light'), fill: rgb(g, 'Light_Colors/Fill_Light'), haze: rgb(g, 'Horizon_Haze/Color'), horizon: rgb(g, 'Sky_Colors/Sky_Color_1'), top: rgb(g, 'Sky_Colors/Sky_Color_4'), fog }
      stages[text(g, 'Stage_Name')] = st
    }
    weather.push({ at: minutes(num(s, 'Start_Time') ?? 0), name: text(s, 'Name'), stages })
  }
  weather.sort((a, b) => a.at - b.at)
  return { segments, weather }
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f
const lerp3 = (a: Vec3, b: Vec3, f: number): Vec3 => [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)]
/** Angles are blended the short way round, as the game does. */
const lerpAngle = (a: number, b: number, f: number) => { if (Math.abs(b - a) > 180) { if (a < b) a += 360; else b += 360 } return lerp(a, b, f) }
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l) as Vec3 }
const rad = (d: number) => (d * Math.PI) / 180
/** Game axes to editor axes (the exporter mirrors X). */
const toEditor = (v: Vec3): Vec3 => [-v[0], v[1], v[2]]

/** Toward the sun or moon: Light_Rotation_Angle sets how high it is, Sun_Rotation_Angle where round the sky. */
function lightDir(S: number, L: number, pitch: number, offset: number): Vec3 {
  const R = 5000, s = rad(90 - S), l = rad(90 - L)
  return unit([-Math.sin(s) * R, Math.cos(l) * Math.cos(pitch) * R, Math.cos(s) * Math.sin(pitch) * R + offset])
}
const fillDir = (H: number, E: number): Vec3 => { const h = rad(H - 180), e = rad(90 - E); return unit([Math.cos(h) * Math.sin(e), Math.cos(e), Math.sin(h) * Math.sin(e)]) }

/** The weather stages the tables know, in a sensible order. */
export const WEATHERS = ['Clear Skies', 'Partly Cloudy', 'Light Rain', 'Medium Rain', 'Heavy Rain', 'Overcast', 'Thunderstorm']

/** The lighting at a clock time (HHMM) under a weather stage. */
export function lightAt(t: LightTables, hhmm: number, weather = 'Clear Skies'): GameLight {
  const segs = t.segments
  if (!segs.length) return NOON
  const now = minutes(hhmm)
  let i = segs.length - 1
  for (let k = 0; k < segs.length; k++) if (segs[k].at <= now) i = k
  const a = segs[i], b = segs[(i + 1) % segs.length]
  const span = (b.at - a.at + 1440) % 1440 || 1440
  const f = ((now - a.at + 1440) % 1440) / span
  const moon = a.moon
  const S = moon ? lerpAngle(a.MS, b.MS, f) : lerpAngle(a.S, b.S, f), L = moon ? lerpAngle(a.ML, b.ML, f) : lerpAngle(a.L, b.L, f)
  const out: GameLight = {
    name: `${String(Math.floor(hhmm / 100)).padStart(2, '0')}:${String(hhmm % 100).padStart(2, '0')}, ${weather.toLowerCase()}`,
    sun: lerp3(a.sun, b.sun, f), sunDir: toEditor(moon ? lightDir(S, L, 0.9, 20) : lightDir(S, L, 0.5, 45)), shadows: a.shadows,
    fill: lerp3(a.fill, b.fill, f), fillDir: toEditor(fillDir(lerpAngle(a.fillH, b.fillH, f), lerp(a.fillE, b.fillE, f))),
    ambient: lerp3(a.ambient, b.ambient, f),
    fog: { color: lerp3(a.fog.color, b.fog.color, f), start: lerp(a.fog.start, b.fog.start, f), end: lerp(a.fog.end, b.fog.end, f), strength: lerp(a.fog.strength, b.fog.strength, f) },
    sky: { top: lerp3(a.top, b.top, f), horizon: lerp3(a.horizon, b.horizon, f), haze: lerp3(a.haze, b.haze, f) },
  }
  // A weather stage replaces what it defines and keeps the rest.
  let w = t.weather[t.weather.length - 1]
  for (const x of t.weather) if (x.at <= now) w = x
  const st = w?.stages[weather]
  if (st) {
    for (const k of ['ambient', 'sun', 'fill'] as const) if (st[k]) out[k] = st[k]!
    if (st.haze) out.sky.haze = st.haze
    if (st.horizon) out.sky.horizon = st.horizon
    if (st.top) out.sky.top = st.top
    out.fog = { ...out.fog, ...Object.fromEntries(Object.entries(st.fog ?? {}).filter(([, v]) => v !== undefined)) }
  }
  if (out.sun.every((c) => c === 0)) out.shadows = false
  return out
}

/** The presets the editor offers: the times multiplayer uses, under the common weathers. */
export const PRESETS: { key: string; label: string; time: number; weather: string }[] = [
  { key: 'noon', label: 'Noon, clear (always-clear maps)', time: 1200, weather: 'Clear Skies' },
  { key: 'morning', label: 'Dawn (06:00)', time: 600, weather: 'Clear Skies' },
  { key: 'evening', label: 'Evening (18:30)', time: 1832, weather: 'Clear Skies' },
  { key: 'dusk', label: 'Dusk (20:00)', time: 2000, weather: 'Clear Skies' },
  { key: 'night', label: 'Midnight', time: 0, weather: 'Clear Skies' },
  { key: 'overcast', label: 'Noon, overcast', time: 1200, weather: 'Overcast' },
  { key: 'rain', label: 'Noon, heavy rain', time: 1200, weather: 'Heavy Rain' },
  { key: 'storm', label: 'Noon, thunderstorm', time: 1200, weather: 'Thunderstorm' },
  { key: 'nightrain', label: 'Midnight, heavy rain', time: 0, weather: 'Heavy Rain' },
]
