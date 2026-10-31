// The fields a play link may hold, and nothing else. A share is rebuilt from
// these before it is checked or stored (share.ts validateShareDoc), so an
// unknown field, or text where a number goes, never reaches the database:
// what a link serves back is the map the editor would have made, not
// whatever else was sent with it. Model settings (`builds`) are checked
// strictly instead: an unknown key there makes the share invalid.
// Pure: no DOM, IndexedDB or Node APIs.
import type { Light, Marker, Project, ProjectSettings, SceneItem } from '../lib/project'
import type { Shape } from '../lib/shapes'

type Clean = (v: unknown) => unknown

const TEXT = 256
const MAX_ENTRIES = 256

const str = (max = TEXT): Clean => (v) => (typeof v === 'string' ? v.slice(0, max) : undefined)
const num: Clean = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const bool: Clean = (v) => (typeof v === 'boolean' ? v : undefined)
const nums = (len?: number, max = 100_000): Clean => (v) =>
  Array.isArray(v) && v.length <= max && (len === undefined || v.length === len) && v.every((x) => num(x) !== undefined) ? [...v] : undefined
const vec3 = nums(3)
const strs: Clean = (v) => (Array.isArray(v) && v.length <= MAX_ENTRIES && v.every((x) => typeof x === 'string') ? v.map((x) => x.slice(0, TEXT)) : undefined)
const record = (value: Clean): Clean => (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  // Built from entries, so a key like __proto__ is a key like any other.
  const out: [string, unknown][] = []
  for (const [k, x] of Object.entries(v).slice(0, MAX_ENTRIES)) {
    const c = value(x)
    if (c !== undefined && k.length <= TEXT) out.push([k, c])
  }
  return Object.fromEntries(out)
}

/** Keeps the listed fields that have the right type, cleaned; everything else goes. */
function pick<T>(v: unknown, fields: Record<string, Clean>): Partial<T> {
  const out: Record<string, unknown> = {}
  if (!v || typeof v !== 'object') return out as Partial<T>
  for (const [k, clean] of Object.entries(fields)) {
    if (!Object.hasOwn(v, k)) continue
    const c = clean((v as Record<string, unknown>)[k])
    if (c !== undefined) out[k] = c
  }
  return out as Partial<T>
}

/** A decoy dummy's settings (lib/dummies/standIn.ts DummyRef): in a share always drawn as its stand-in figure. */
function dummy(v: unknown): unknown {
  if (!v || typeof v !== 'object') return undefined
  const d = v as Record<string, unknown>
  const stand = pick<{ path: string; textures: Record<string, string> }>(d.stand_in, { path: str(), textures: record(str()) })
  if (d.source !== 'dummy' || typeof stand.path !== 'string') return undefined
  return {
    source: 'dummy', ...pick(d, { model: str(64), pose: str(32), ws: num }),
    look: pick(d.look, { top: str(16), skin: str(16), hair: str(16), outfit: num }),
    built: false, stand_in: { path: stand.path, textures: stand.textures ?? {} },
  }
}

const SHAPE: Record<keyof Shape, Clean> = {
  kind: str(16), size: vec3, tile: num, segments: num, taper: num, bevel: num, lie: bool, fit: bool, open: bool,
  outline: (v) => (Array.isArray(v) && v.length <= 1024 && v.every((p) => nums(2)(p)) ? v.map((p) => [...p]) : undefined),
  cells: nums(2), heights: nums(undefined, 65 * 65),
}
const shape: Clean = (v) => (v && typeof v === 'object' ? pick<Shape>(v, SHAPE) : undefined)

/** The scene item fields a share keeps: none that point at the maker's own files or game. */
const ITEM: { [K in keyof SceneItem]?: Clean } & Record<string, Clean> = {
  uid: str(64), name: str(), path: str(), position: vec3, rotation: vec3, scale: num, pivot: vec3,
  textures: record(str()), alpha: record(bool), glow: record(num), surface_ids: record(num),
  physics_intent: str(64), double_sided: bool, collision_disabled: bool, collision_excluded_faces: nums(),
  native_prefab: str(), glass_style: str(64), glass_custom_texture: str(), native_mesh_obj: str(),
  native_breakable_kind: str(16), native_opacity: num, native_use_alpha: bool, native_prop_behavior: str(16),
  native_original_name: str(), native_prop_original_name: str(), native_profile: str(64),
  physics_preset: str(64), physics_shape: str(16), physics_bottom_heavy: bool,
  swimmable_water: bool, water_materials: strs, collision_materials: strs, triangles: num, shape, group: str(), layer: str(),
  dummy: (v) => dummy(v),
}

const MARKER: Record<keyof Marker, Clean> = {
  uid: str(64), type: str(64), position: vec3, yaw: num, label: str(), weapon: str(64), vehicle: str(64),
  radius: num, delay_ms: num, respawn_ms: num, max_fires: num, disabled: bool, trigger_action: str(),
  special_type: str(64), char_type: str(64), group: str(), leash_distance: num, size: vec3, shape: str(16),
  sound: str(), volume: num, sound_random: bool, delay_min_s: num, delay_max_s: num, ambient: num, item: str(64),
}

const LIGHT: Record<keyof Light, Clean> = {
  uid: str(64), name: str(), enabled: bool, position: vec3, color: vec3, intensity: num, inner_range: num, range: num,
}

const SETTINGS: Record<keyof ProjectSettings, Clean> = {
  base_name: str(64), display_name: str(), world_scale: num, mirror_x: bool, flip_obj_v: bool, double_sided: bool,
  sky_texture: str(), minimap_texture: str(), sky_scale: num, native_sky: str(32), game_sky: bool, bbcity_donor: str(),
  surface_preload: bool, cts_template: str(), marker_game_coords: bool, modes: strs, ptp_keep_weapons: bool, always_clear_weather: bool,
  dry_interiors: bool, remove_invisible_walls: bool, minimap_mode: str(16), minimap_rect: nums(4), loading_mode: str(16),
  loading_image: str(), ambience: str(),
}

const list = <T>(v: unknown, fields: Record<string, Clean>): Partial<T>[] => (Array.isArray(v) ? v.map((x) => pick<T>(x, fields)) : [])

/** The project with only the fields a share may hold (validateShareDoc normalizes it first). */
export function cleanProject(p: Project): Project {
  return {
    format: 'sr1-map-studio-web', version: 1,
    id: str(64)(p.id) as string ?? '', name: str()(p.name) as string ?? '', description: str(2000)(p.description) as string ?? '',
    created_at: str(40)(p.created_at) as string ?? '', updated_at: str(40)(p.updated_at) as string ?? '',
    settings: pick<ProjectSettings>(p.settings, SETTINGS) as ProjectSettings,
    scene_items: list<SceneItem>(p.scene_items, ITEM) as SceneItem[],
    asset_library: [],
    markers: list<Marker>(p.markers, MARKER) as Marker[],
    lights: list<Light>(p.lights, LIGHT) as Light[],
    files: {},
    ...(p.remix_of ? { remix_of: { hub_id: str(64)(p.remix_of.hub_id) as string ?? '', title: str()(p.remix_of.title) as string ?? '', author: str()(p.remix_of.author) as string ?? '' } } : {}),
  }
}

// ---------------- model settings ----------------

const BUILD_KEYS: Record<string, string[]> = { shape: ['kind', 'shape'], compound: ['kind', 'pieces'], prefab: ['kind', 'key', 'params', 'at', 'rot'], figure: ['kind', 'pose', 'ws'] }
const PIECE_KEYS = ['shape', 'at', 'rot', 'top', 'side']
const SHAPE_KEYS = Object.keys(SHAPE)

const onlyKeys = (v: unknown, keys: string[]) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every((k) => keys.includes(k))

/**
 * True when a model's settings hold only the keys a build has, with JSON values of the right kind; their ranges
 * are checked when the map is listed (shareBuilds.ts buildProblem).
 */
export function buildKeysOk(b: unknown): boolean {
  const x = b as any
  if (!x || typeof x !== 'object' || !Object.hasOwn(BUILD_KEYS, x.kind) || !onlyKeys(x, BUILD_KEYS[x.kind])) return false
  const shapeOk = (s: unknown) => onlyKeys(s, SHAPE_KEYS)
  if (x.kind === 'shape') return shapeOk(x.shape)
  if (x.kind === 'compound') return Array.isArray(x.pieces) && x.pieces.every((pc: unknown) => onlyKeys(pc, PIECE_KEYS) && shapeOk((pc as any).shape))
  if (x.kind === 'figure') return typeof x.pose === 'string' && x.pose.length <= 32 && typeof x.ws === 'number'
  return typeof x.key === 'string' && x.key.length <= 64 && !!x.params && typeof x.params === 'object' && !Array.isArray(x.params)
    && Object.entries(x.params).every(([k, v]) => k.length <= 64 && (typeof v === 'number' || (typeof v === 'string' && v.length <= 40000)))
}
