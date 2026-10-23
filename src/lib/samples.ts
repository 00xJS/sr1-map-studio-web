// Sample maps to start from: block-out shapes, generated or starter-library
// textures, spawns for every mode, weapons and lights. Built in the browser
// from these descriptions, so they need no downloads or game files.
// Coordinates are editor units (the default world scale of 0.5 halves them in game).
import { newLight, newMarker, newProject, uid, type FileRef, type Light, type Marker, type Project, type SceneItem, type Vec3 } from './project'
import { compoundObj, shapeName, shapeObj, type Shape } from './shapes'
import { KINDS, defaultParams, generate } from './procedural'
import { pixelsToPng } from './images'
import { storeFile } from './files'
import { ALL_MODES, GB, box, turn, type Part, type Sample, type Tex, type Theme } from './sampleKit'
import { PAINTBALL } from './samplesPaintball'
import { CYBER } from './samplesCyber'
import { URBAN } from './samplesUrban'
import { mapSize, spreadSample } from './sampleScale'
import { FULL_TARGETS, populate } from './samplePopulate'
import { DENSE, LIGHT_DRESS, dress } from './sampleDress'
import { detailize } from './sampleDetail'

export type { Sample, Theme }

// Textures used by the samples.
const T = {
  floorWorn: { lib: 'concrete_floor_worn_001', surface: 0 } as Tex,
  brick: { lib: 'red_brick', surface: 0 } as Tex,
  oldBrick: { lib: 'brick_4', surface: 0 } as Tex,
  plywood: { lib: 'plywood', surface: 21 } as Tex,
  corrugated: { lib: 'corrugated_iron', surface: 16 } as Tex,
  beige: { lib: 'beige_wall_001', surface: 5 } as Tex,
  plaster: { lib: 'painted_plaster_wall', surface: 5 } as Tex,
  concrete: { gen: 'concrete' } as Tex,
  darkConcrete: { gen: 'concrete', tweak: { color: '#6f6d69', seed: 4, wear: 0.6 } } as Tex,
  metal: { gen: 'metal_plate' } as Tex,
  diamond: { gen: 'diamond_plate' } as Tex,
  wood: { gen: 'wood_planks' } as Tex,
  asphalt: { gen: 'asphalt', tweak: { line: 'none' } } as Tex,
  road: { gen: 'asphalt', tweak: { line: 'yellow' } } as Tex,
  tiles: { gen: 'tiles', tweak: { color: '#b9b6ae', accent: '#7d7a73', scale: 4 } } as Tex,
  grass: { gen: 'grass' } as Tex,
}

/** Four spawns per team on opposite sides, facing each other. */
const teams = (x: number, y: number, zs: number[]): [string, Vec3, Partial<Marker>?][] => [
  ...zs.map((z): [string, Vec3, Partial<Marker>] => ['Red team spawn', [-x, y, z], { yaw: 90 }]),
  ...zs.map((z): [string, Vec3, Partial<Marker>] => ['Blue team spawn', [x, y, z], { yaw: -90 }]),
]
const weapon = (id: string, at: Vec3): [string, Vec3, Partial<Marker>] => ['Weapon pickup', at, { weapon: id }]

/** Moves a whole map sideways so its middle is at x 0 (maps are mirrored around the center). */
function centerX(s: Sample, dx: number): Sample {
  const mv = (p: Vec3): Vec3 => [p[0] + dx, p[1], p[2]]
  return { ...s, parts: s.parts.map((p) => ({ ...p, at: mv(p.at) })), markers: s.markers.map(([t, p, m]) => [t, mv(p), m]), lights: s.lights?.map(([p, c]) => [mv(p), c]) }
}

const STARTER: Sample[] = [
  {
    id: 'flat', theme: 'Starter', name: 'Flat ground', icon: '▭', modes: GB,
    description: 'One big concrete floor with four spawns. A clean canvas for building your own layout.',
    parts: [box('Floor', [80, 1, 80], [0, 0, 0], T.floorWorn, T.concrete)],
    markers: [['Shared spawn', [-25, 1, -25]], ['Shared spawn', [25, 1, -25]], ['Shared spawn', [-25, 1, 25]], ['Shared spawn', [25, 1, 25]], weapon('ak47', [0, 1, 0])],
  },
  {
    id: 'arena', theme: 'Starter', name: 'Arena', icon: '🏟', modes: ALL_MODES,
    description: 'Walled square with a raised center platform, four ramps, pillars and cover. Set up for every mode.',
    parts: [
      box('Floor', [100, 1, 100], [0, 0, 0], T.floorWorn, T.concrete),
      box('Wall', [104, 8, 2], [0, 1, -51], T.concrete, T.brick),
      box('Wall', [104, 8, 2], [0, 1, 51], T.concrete, T.brick),
      box('Wall', [100, 8, 2], [51, 1, 0], T.concrete, T.brick, 90),
      box('Wall', [100, 8, 2], [-51, 1, 0], T.concrete, T.brick, 90),
      box('Platform', [16, 4, 16], [0, 1, 0], T.metal, T.darkConcrete),
      { label: 'Ramp', kind: 'ramp', size: [6, 4, 12], at: [0, 1, 14], top: T.wood, side: T.darkConcrete },
      { label: 'Ramp', kind: 'ramp', size: [6, 4, 12], at: [0, 1, -14], rot: 180, top: T.wood, side: T.darkConcrete },
      { label: 'Ramp', kind: 'ramp', size: [6, 4, 12], at: [14, 1, 0], rot: 90, top: T.wood, side: T.darkConcrete },
      { label: 'Ramp', kind: 'ramp', size: [6, 4, 12], at: [-14, 1, 0], rot: -90, top: T.wood, side: T.darkConcrete },
      ...[[-30, -30], [30, -30], [-30, 30], [30, 30]].map(([x, z]): Part => ({ label: 'Pillar', kind: 'cylinder', size: [3, 10, 3], at: [x, 1, z], top: T.concrete, side: T.oldBrick, segments: 16 })),
      ...[[-20, 10], [20, -10], [10, 25], [-10, -25]].map(([x, z]) => box('Box', [4, 3, 4], [x, 1, z], T.plywood, T.plywood, 0, 3)),
    ],
    markers: [
      ...[[-40, -40], [40, -40], [-40, 40], [40, 40], [0, -40], [0, 40], [-40, 0], [40, 0]].map(([x, z]): [string, Vec3] => ['Shared spawn', [x, 1, z]]),
      ...teams(44, 1, [-12, -4, 4, 12]),
      weapon('rpg_launcher', [0, 5, 0]), weapon('ak47', [-25, 1, 0]), weapon('ak47', [25, 1, 0]),
      weapon('pump_action_shotgun', [0, 1, -25]), weapon('pump_action_shotgun', [0, 1, 25]), weapon('sniper_rifle', [-30, 1, 22]),
      ['Chains drop-off', [0, 1, -35]], ['Chains drop-off', [0, 1, 35]],
      ['Pimp entrance', [0, 1, -45]],
    ],
    lights: [[[0, 12, 0], [1, 0.85, 0.65]], [[-30, 12, -30]], [[30, 12, 30]]],
  },
  {
    id: 'warehouse', theme: 'Starter', name: 'Warehouse', icon: '🏭', modes: ALL_MODES,
    description: 'Indoor hall with corrugated walls, crate stacks, support columns and a catwalk reached by stairs.',
    parts: [
      box('Floor', [90, 1, 60], [0, 0, 0], T.darkConcrete, T.concrete),
      box('Wall', [94, 14, 2], [0, 1, -31], T.metal, T.corrugated),
      box('Wall', [94, 14, 2], [0, 1, 31], T.metal, T.corrugated),
      box('Wall', [60, 14, 2], [46, 1, 0], T.metal, T.corrugated, 90),
      box('Wall', [60, 14, 2], [-46, 1, 0], T.metal, T.corrugated, 90),
      box('Catwalk', [80, 1, 4], [0, 8, -26], T.diamond, T.metal),
      { label: 'Stairs', kind: 'stairs', size: [4, 8, 12], at: [-35, 1, -18], top: T.diamond, side: T.metal, segments: 12 },
      { label: 'Stairs', kind: 'stairs', size: [4, 8, 12], at: [35, 1, -18], top: T.diamond, side: T.metal, segments: 12 },
      ...[[-25, -10], [0, -10], [25, -10], [-25, 12], [0, 12], [25, 12]].map(([x, z]) => box('Column', [2, 13, 2], [x, 1, z], T.metal, T.metal)),
      ...([[-15, 1, 5], [-12, 1, 5], [-15, 4, 5], [10, 1, -2], [13, 1, -2], [10, 1, 1], [20, 1, 18], [20, 4, 18], [-30, 1, 20], [-27, 1, 20]] as Vec3[]).map((at) => box('Crate', [3, 3, 3], at, T.plywood, T.plywood, 0, 3)),
    ],
    markers: [
      ...[[-38, -15], [38, -15], [-38, 22], [38, 22], [0, 24], [-10, 0], [10, 8], [0, -20]].map(([x, z]): [string, Vec3] => ['Shared spawn', [x, 1, z]]),
      ...teams(40, 1, [-8, 0, 8, 16]),
      weapon('ak47', [0, 9, -26]), weapon('pump_action_shotgun', [-15, 1, 10]), weapon('tec9', [13, 1, 4]), weapon('pipe_bomb', [20, 7, 18]),
      ['Chains drop-off', [-20, 1, -15]], ['Chains drop-off', [20, 1, 25]],
      ['Pimp entrance', [0, 9, -26]],
    ],
    lights: [[[-25, 13, 0]], [[0, 13, 0]], [[25, 13, 0]]],
  },
  {
    id: 'rooftops', theme: 'Starter', name: 'Rooftops', icon: '🏙', modes: ALL_MODES,
    description: 'Eight buildings around a plaza, joined by bridges. Stairs lead up from the plaza.',
    parts: [
      box('Ground', [140, 1, 140], [0, 0, 0], T.asphalt, T.concrete, 0, 6),
      ...([[-35, -35], [0, -35], [35, -35], [-35, 0], [35, 0], [-35, 35], [0, 35], [35, 35]] as [number, number][])
        .map(([x, z], i) => box('Building', [24, 16, 24], [x, 1, z], T.concrete, i % 2 ? T.oldBrick : T.beige)),
      ...([[-17.5, -35], [17.5, -35], [-17.5, 35], [17.5, 35]] as [number, number][]).map(([x, z]) => box('Bridge', [11, 1, 4], [x, 16, z], T.wood, T.metal)),
      ...([[-35, -17.5], [35, -17.5], [-35, 17.5], [35, 17.5]] as [number, number][]).map(([x, z]) => box('Bridge', [4, 1, 11], [x, 16, z], T.wood, T.metal)),
      { label: 'Stairs', kind: 'stairs', size: [6, 16, 20], at: [0, 1, -13], top: T.concrete, side: T.darkConcrete, segments: 20 },
      { label: 'Stairs', kind: 'stairs', size: [6, 16, 20], at: [0, 1, 13], rot: 180, top: T.concrete, side: T.darkConcrete, segments: 20 },
    ],
    markers: [
      ...[[-35, -35], [35, -35], [-35, 35], [35, 35]].map(([x, z]): [string, Vec3] => ['Shared spawn', [x, 17, z]]),
      ...[[-15, 0], [15, 0], [8, -8], [-8, 8]].map(([x, z]): [string, Vec3] => ['Shared spawn', [x, 1, z]]),
      ['Red team spawn', [-38, 17, -4], { yaw: 90 }], ['Red team spawn', [-38, 17, 4], { yaw: 90 }], ['Red team spawn', [-32, 17, -4], { yaw: 90 }], ['Red team spawn', [-32, 17, 4], { yaw: 90 }],
      ['Blue team spawn', [38, 17, -4], { yaw: -90 }], ['Blue team spawn', [38, 17, 4], { yaw: -90 }], ['Blue team spawn', [32, 17, -4], { yaw: -90 }], ['Blue team spawn', [32, 17, 4], { yaw: -90 }],
      weapon('sniper_rifle', [0, 17, -35]), weapon('sniper_rifle', [0, 17, 35]), weapon('rpg_launcher', [0, 1, 0]), weapon('ak47', [-35, 17, 0]), weapon('ak47', [35, 17, 0]),
      ['Chains drop-off', [0, 17, -40]], ['Chains drop-off', [0, 17, 40]],
      ['Pimp entrance', [0, 1, 0]],
    ],
    lights: [[[0, 8, 0], [1, 0.8, 0.55]]],
  },
  centerX({
    id: 'street', theme: 'Starter', name: 'Street', icon: '🛣', modes: ALL_MODES,
    description: 'A city block: road with a center line, curbs and sidewalks, buildings on both sides and parked cover.',
    parts: [
      // The road sits at x 0..24 so the texture's center line lands in the middle of the lane.
      box('Road', [24, 1, 140], [12, 0, 0], T.road, T.darkConcrete, 0, 24),
      box('Sidewalk', [8, 1.4, 140], [-4, 0, 0], T.tiles, T.concrete),
      box('Sidewalk', [8, 1.4, 140], [28, 0, 0], T.tiles, T.concrete),
      ...([[-55, 12, T.beige], [-20, 18, T.brick], [15, 14, T.plaster], [50, 20, T.oldBrick]] as [number, number, Tex][]).map(([z, h, side]) => box('Building', [24, h, 26], [-20, 0, z], T.concrete, side)),
      ...([[-55, 20, T.oldBrick], [-20, 14, T.plaster], [15, 18, T.brick], [50, 12, T.beige]] as [number, number, Tex][]).map(([z, h, side]) => box('Building', [24, h, 26], [44, 0, z], T.concrete, side)),
      box('Barrier', [40, 4, 1], [12, 0, -70.5], T.concrete, T.concrete),
      box('Barrier', [40, 4, 1], [12, 0, 70.5], T.concrete, T.concrete),
      ...([[6, -30], [18, -5], [6, 22], [18, 45]] as [number, number][]).map(([x, z]) => box('Van', [4, 3, 8], [x, 1, z], T.metal, T.metal)),
    ],
    markers: [
      ...[[-4, -50], [28, -35], [-4, -10], [28, 10], [-4, 30], [28, 55]].map(([x, z]): [string, Vec3] => ['Shared spawn', [x, 1.4, z]]),
      ['Shared spawn', [12, 1, -60]], ['Shared spawn', [12, 1, 60]],
      // Yaw 0 faces -Z: red (south end) looks north with 180, blue (north end) looks south with 0.
      ['Red team spawn', [-4, 1.4, -64], { yaw: 180 }], ['Red team spawn', [28, 1.4, -64], { yaw: 180 }], ['Red team spawn', [8, 1, -64], { yaw: 180 }], ['Red team spawn', [16, 1, -64], { yaw: 180 }],
      ['Blue team spawn', [-4, 1.4, 64], { yaw: 0 }], ['Blue team spawn', [28, 1.4, 64], { yaw: 0 }], ['Blue team spawn', [8, 1, 64], { yaw: 0 }], ['Blue team spawn', [16, 1, 64], { yaw: 0 }],
      weapon('ak47', [12, 1, 0]), weapon('pump_action_shotgun', [-4, 1.4, 20]), weapon('tec9', [28, 1.4, -20]), weapon('molotov', [12, 1, 35]),
      ['Chains drop-off', [12, 1, -40]], ['Chains drop-off', [12, 1, 40]],
      ['Pimp entrance', [-4, 1.4, 0]],
    ],
    lights: [[[-4, 9, -40]], [[28, 9, 0]], [[-4, 9, 40]]],
  }, -12),

]

export const SAMPLES: Sample[] = [...STARTER, ...URBAN, ...PAINTBALL, ...CYBER]
export const THEMES: Theme[] = ['Starter', 'Urban', 'Urban paintball', 'Cyber']

export const THEME_INFO: Record<Theme, string> = {
  'Starter': 'Simple layouts to learn with.',
  'Urban': 'City streets, plazas, parks, docks and rooftops, drawn at full retail size.',
  'Urban paintball': 'Bunkers, containers, alleys and rooftops: symmetric fields made for team fights.',
  'Cyber': 'Neon grids, glowing blocks and colored lights.',
}

const COMPACT_TARGETS = { shared: 8, perTeam: 6, weapons: 12, drops: 4, lights: 10 }
/** Generated texture size: full detail where it shows (windows, shop fronts, doors), half elsewhere to keep maps light. */
const DETAILED = new Set(['facade', 'storefront', 'garage_door'])
const texSize = (kind: string) => (DETAILED.has(kind) ? 1024 : 512)

/** The map as it will be built: full multiplayer size (compact designs spread ×2) with spawns, weapons and lights filled in, or compact for small groups. */
export function sampleFor(id: string, compact = false): Sample {
  const s = SAMPLES.find((x) => x.id === id)
  if (!s) throw new Error('Unknown sample map')
  const small = (s.size ?? 'compact') === 'compact'
  if (compact && small) return populate(dress(detailize(s), { ...DENSE, perArea: 900 }), COMPACT_TARGETS)
  // Spread-out compact maps get filled with prefabs in the space that opened up; urban maps get street clutter.
  return populate(small ? dress(detailize(spreadSample(s, 2)), DENSE) : dress(detailize(s), LIGHT_DRESS), FULL_TARGETS)
}

export interface SampleStats { widthM: number; depthM: number; players: number; spawns: number; weapons: number; lights: number }
const statsCache = new Map<string, SampleStats>()
/** Size and contents of a sample as it builds (cached; filling a map with markers takes a few milliseconds). */
export function sampleStats(id: string, compact = false): SampleStats {
  const key = id + (compact ? ':c' : '')
  let st = statsCache.get(key)
  if (!st) {
    const s = sampleFor(id, compact)
    const count = (...t: string[]) => s.markers.filter(([m]) => t.includes(m)).length
    const { widthM, depthM, players } = mapSize(s)
    st = { widthM, depthM, players, spawns: count('Shared spawn', 'Red team spawn', 'Blue team spawn'), weapons: count('Weapon pickup'), lights: s.lights?.length ?? 0 }
    statsCache.set(key, st)
  }
  return st
}

/** True for maps drawn small, which can also be built compact for 2-6 players. */
export const hasCompact = (s: Sample) => (s.size ?? 'compact') === 'compact'

/** Turns parts into scene objects: shapes and prefabs as OBJ files, textures generated or loaded, all stored in this browser. */
// Textures are content-addressed files, so one generated or loaded texture serves every build in this session.
const texCache = new Map<string, Promise<{ vpath: string; surface: number; ref: FileRef }>>()
function storedTexture(t: Tex) {
  const key = JSON.stringify(t)
  let p = texCache.get(key)
  if (!p) {
    p = (async () => {
      if ('lib' in t) {
        const r = await fetch(`/textures/${t.lib}.jpg`)
        if (!r.ok) throw new Error(`Starter texture ${t.lib} could not be loaded.`)
        const s = await storeFile(await r.blob(), `${t.lib}.jpg`)
        return { vpath: s.vpath, surface: t.surface, ref: s.ref }
      }
      const size = texSize(t.gen)
      const params = { ...defaultParams(t.gen, size), ...t.tweak, size }
      const s = await storeFile(await pixelsToPng(generate(params), size, `${t.gen}_${params.seed}.png`), `${t.gen}_${params.seed}.png`)
      return { vpath: s.vpath, surface: t.surface ?? KINDS[t.gen].surface, ref: s.ref }
    })()
    p.catch(() => texCache.delete(key))
    texCache.set(key, p)
  }
  return p
}

export async function materialize(parts: Part[], onProgress?: (t: string) => void): Promise<{ items: SceneItem[]; files: Record<string, FileRef> }> {
  const files: Record<string, FileRef> = {}
  const texture = async (t: Tex) => {
    const x = await storedTexture(t)
    files[x.vpath] = x.ref
    return x
  }

  const items: SceneItem[] = []
  const shapeOf = (part: Part): Shape => ({
    kind: part.kind, size: part.size, tile: part.tile ?? 4,
    ...(part.segments ? { segments: part.segments } : {}), ...(part.taper !== undefined ? { taper: part.taper } : {}), ...(part.bevel ? { bevel: part.bevel } : {}),
  })
  // Parts of a prefab (same group) become one object; the rest stay one object each.
  const units: Part[][] = []
  const byGroup = new Map<string, Part[]>()
  for (const part of parts) {
    if (!part.group) { units.push([part]); continue }
    if (!byGroup.has(part.group)) { byGroup.set(part.group, []); units.push(byGroup.get(part.group)!) }
    byGroup.get(part.group)!.push(part)
  }
  for (const [i, unit] of units.entries()) {
    if (i % 20 === 0) onProgress?.(`Building ${unit[0].label.toLowerCase()} (${i + 1}/${units.length})…`)
    if (unit.length === 1) {
      const part = unit[0]
      const shape = shapeOf(part)
      const obj = await storeFile(new Blob([shapeObj(shape)], { type: 'model/obj' }), `${part.kind}.obj`)
      files[obj.vpath] = obj.ref
      const [top, side] = await Promise.all([texture(part.top), texture(part.side)])
      items.push({
        uid: uid(), name: shapeName(part.label, shape), path: obj.vpath, source_path: obj.vpath, shape,
        position: part.at, rotation: [0, part.rot ?? 0, 0], scale: 1,
        textures: { top: top.vpath, side: side.vpath }, alpha: { top: false, side: false },
        surface_ids: { top: top.surface, side: side.surface }, physics_intent: 'Static',
      })
      continue
    }
    // Prefab: origin at its placement point (or the first part's base), turned as placed; one material per distinct texture.
    const tag = unit[0].prefab
    const origin = tag?.at ?? unit[0].at
    const turnBy = tag?.rot ?? 0
    const mats = new Map<string, Tex>()
    const matOf = (t: Tex) => { const k = JSON.stringify(t); if (!mats.has(k)) mats.set(k, t); return 'm' + [...mats.keys()].indexOf(k) }
    const obj = compoundObj(unit.map((p) => {
      const [dx, dz] = turn(p.at[0] - origin[0], p.at[2] - origin[2], -turnBy)
      return { shape: shapeOf(p), at: [dx, p.at[1] - origin[1], dz] as Vec3, rot: (p.rot ?? 0) - turnBy, top: matOf(p.top), side: matOf(p.side) }
    }))
    const stored = await storeFile(new Blob([obj], { type: 'model/obj' }), 'prefab.obj')
    files[stored.vpath] = stored.ref
    const textures: Record<string, string> = {}, alpha: Record<string, boolean> = {}, surface_ids: Record<string, number> = {}
    for (const [k, t] of mats) {
      const name = 'm' + [...mats.keys()].indexOf(k)
      const tx = await texture(t)
      textures[name] = tx.vpath; alpha[name] = false; surface_ids[name] = tx.surface
    }
    items.push({
      uid: uid(), name: unit[0].group!.split('@')[0].replace(/[~|]+$/, ''), path: stored.vpath, source_path: stored.vpath,
      position: origin, rotation: [0, turnBy, 0], scale: 1, textures, alpha, surface_ids, physics_intent: 'Static',
      ...(tag ? { prefab: { key: tag.key, params: tag.params, defaults: { ...textures } } } : {}),
    })
  }
  return { items, files }
}

/** Builds a sample into a new project (geometry, textures and markers stored locally). */
export async function buildSample(id: string, onProgress?: (t: string) => void, opts: { compact?: boolean } = {}): Promise<Project> {
  const sample = sampleFor(id, opts.compact)
  return buildFrom(sample, onProgress, opts.compact && (sample.size ?? 'compact') === 'compact' ? 16 : 24)
}

/** A project from a finished sample (one from sampleFor, or the new map wizard's). */
export async function buildFrom(sample: Sample, onProgress?: (t: string) => void, lightRange = 24): Promise<Project> {
  const project = newProject(sample.name)
  const { items, files } = await materialize(sample.parts, onProgress)
  project.scene_items = items
  // A little above the surface, as the editor's "snap to surface" does.
  project.markers = sample.markers.map(([type, at, patch]) => {
    const m: Marker = { ...newMarker(type, [at[0], at[1] + 0.1, at[2]]), ...patch }
    if (m.type === 'Weapon pickup') m.label = m.weapon
    return m
  })
  project.lights = (sample.lights || []).map(([at, color]): Light => ({ ...newLight(at), ...(color ? { color } : {}), range: lightRange, inner_range: lightRange * 0.35 }))
  project.files = files
  project.settings.modes = sample.modes
  const base = sample.id.replace(/[^a-z0-9]/g, '').slice(0, 7)
  project.settings.base_name = base + Math.floor(1000 + Math.random() * 9000)
  project.settings.display_name = sample.name
  return project
}
