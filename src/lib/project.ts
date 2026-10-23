// Project format. scene_items/markers/lights keep the desktop SR1 Map Studio
// schema exactly, so the original Python can read them unchanged. File paths
// are virtual paths inside the Pyodide file system:
//   /work/f/<sha256>/<name>  user files (content addressed)
//   /studio/<folder>/...     the user's local data pack (never uploaded)
import { retailMarkerDefaults } from './retailModes'

export type Vec3 = [number, number, number]

export interface SceneItem {
  uid: string
  name: string
  path: string
  source_path?: string
  original_import_path?: string
  position: Vec3
  rotation: Vec3
  scale: number
  pivot?: Vec3
  textures: Record<string, string>
  alpha: Record<string, boolean>
  surface_ids?: Record<string, number>
  physics_intent?: string
  asset_ref?: string
  double_sided?: boolean
  collision_disabled?: boolean
  collision_excluded_faces?: number[]
  native_prefab?: string
  glass_style?: string
  glass_custom_texture?: string
  native_mesh_obj?: string
  native_breakable_kind?: 'glass' | 'wood'
  native_opacity?: number
  native_use_alpha?: boolean
  native_prop_behavior?: 'movable' | 'explosive'
  native_original_name?: string
  native_prop_original_name?: string
  /** Stock damage profile for a native object (a weight or breaking preset); unset = the mode's default. */
  native_profile?: string
  /** Physics prop behaviour preset (see physicsProps.ts), collision shape and a lowered centre of mass. */
  physics_preset?: string
  physics_shape?: 'box' | 'sphere' | 'cylinder' | 'hull' | 'parts'
  physics_bottom_heavy?: boolean
  /** Players can swim in it: exported as water (no collision, see-through, water surface). */
  swimmable_water?: boolean
  /** With swimmable_water: only these materials are the water (a prefab's water part); unset = the whole object. */
  water_materials?: string[]
  triangles?: number
  /** Block-out shape this item's OBJ was generated from (see shapes.ts). */
  shape?: import('./shapes').Shape
  /** Prefab this item was built from, with its settings and its original textures (to keep the user's repaints on a rebuild). */
  prefab?: { key: string; params: Record<string, number | string>; defaults: Record<string, string> }
  /** Items with the same group id are selected, moved and copied together. */
  group?: string
  [key: string]: unknown
}

export interface Asset {
  uid: string
  name: string
  path: string
  source_path: string
  original_import_path?: string
  textures: Record<string, string>
  alpha: Record<string, boolean>
  triangles: number
  native_prefab?: string
  glass_style?: string
  [key: string]: unknown
}

export interface Marker {
  uid: string
  type: string
  position: Vec3
  yaw: number
  label: string
  weapon: string
  vehicle: string
  radius: number
  delay_ms: number
  max_fires: number
  disabled: boolean
  trigger_action: string
  special_type: string
  char_type: string
  group: string
  leash_distance: number
  /** Box zones (Blinged Out Ride triggers, box sound zones): width, height, depth in metres. */
  size?: Vec3
  /** Sound zones: 'sphere' (uses radius) or 'box' (uses size). */
  shape?: 'sphere' | 'box'
  /** Sound zones: the sound's name in the game's ambience bank. */
  sound?: string
  /** Sound zones: 0-1. */
  volume?: number
  /** Sound zones: play now and then (with a pause between delay_min_s and delay_max_s) instead of looping. */
  sound_random?: boolean
  delay_min_s?: number
  delay_max_s?: number
}

export interface Light {
  uid: string
  name: string
  enabled: boolean
  position: Vec3
  color: Vec3
  intensity: number
  inner_range: number
  range: number
}

// Exact names the game accepts (it rejects anything else); Protect Tha Pimp
// loads its own <map>_ptp.cts with team spawns and pimp entrances, Blinged
// Out Ride its own <map>_bor.cts (see retailModes.ts).
export type GameMode = 'Gangsta Brawl' | 'Team Gangsta Brawl' | 'Big Ass Chains' | 'Team Big Ass Chains' | 'Protect Tha Pimp' | 'Blinged Out Ride'
export const GAME_MODES: GameMode[] = ['Gangsta Brawl', 'Team Gangsta Brawl', 'Big Ass Chains', 'Team Big Ass Chains', 'Protect Tha Pimp', 'Blinged Out Ride']
export const PIMP_EXIT = 'Pimp exit (experimental)'

export interface ProjectSettings {
  base_name: string
  display_name: string
  world_scale: number
  mirror_x: boolean
  flip_obj_v: boolean
  double_sided: boolean
  sky_texture: string
  minimap_texture: string
  sky_scale: number
  native_sky: '' | 'sr_alwayshwyf01' | 'sr_custom000001'
  bbcity_donor: string
  cts_template: string
  marker_game_coords: boolean
  modes: GameMode[]
  /** Off: the server rolls time of day and weather each match, like retail maps without the flag. */
  always_clear_weather: boolean
  /** 'auto' renders the minimap from above at every export; 'custom' uses minimap_texture. Unset: custom if an image is set, else auto. */
  minimap_mode?: 'auto' | 'custom'
  /** Set at export: the square the minimap image covers, [minX, minZ, maxX, maxZ] in editor units. */
  minimap_rect?: [number, number, number, number]
  /** Picture shown while the map loads: 'auto' renders the 3D view at export (default), 'custom' uses loading_image. */
  loading_mode?: 'auto' | 'custom' | 'none'
  /** The user's own loading picture (with loading_mode 'custom'). */
  loading_image?: string
  /** Background sound: the file name of a retail multiplayer map's ambience to include, or '' for none. */
  ambience?: string
}

/** origin 'game': taken from the user's own game files. Kept on this device only. */
export interface FileRef {
  hash: string
  size: number
  name: string
  type: string
  origin: 'user' | 'game'
  /** How the site made this texture (generated or starter library), if it did: lets play links rebuild it. */
  recipe?: import('./recipes').TextureRecipe
}

export interface RemixInfo { hub_id: string; title: string; author: string }

export interface Project {
  format: 'sr1-map-studio-web'
  version: 1
  id: string
  name: string
  description: string
  created_at: string
  updated_at: string
  settings: ProjectSettings
  scene_items: SceneItem[]
  asset_library: Asset[]
  markers: Marker[]
  lights: Light[]
  files: Record<string, FileRef>
  remix_of?: RemixInfo
}

export const uid = () => crypto.randomUUID()

export const defaultSettings = (): ProjectSettings => ({
  base_name: 'mymap',
  display_name: 'My Map',
  world_scale: 0.5,
  mirror_x: true,
  flip_obj_v: true,
  double_sided: false,
  sky_texture: '',
  minimap_texture: '',
  sky_scale: 0,
  native_sky: '',
  bbcity_donor: '',
  cts_template: '',
  marker_game_coords: false,
  modes: ['Gangsta Brawl', 'Team Gangsta Brawl'],
  always_clear_weather: true,
})

export function newProject(name = 'Untitled map'): Project {
  const now = new Date().toISOString()
  return {
    format: 'sr1-map-studio-web', version: 1, id: uid(), name, description: '',
    created_at: now, updated_at: now, settings: defaultSettings(),
    scene_items: [], asset_library: [], markers: [], lights: [], files: {},
  }
}

export function newMarker(type: string, position: Vec3 = [0, 0, 0]): Marker {
  const m: Marker = {
    uid: uid(), type, position, yaw: 0, label: '', weapon: 'ak47', vehicle: 'car_2dr_sports03',
    radius: 0.7, delay_ms: 10000, max_fires: 0, disabled: true, trigger_action: '',
    special_type: 'Reading news', char_type: 'LC_X_F_Thug1-01_A', group: '', leash_distance: 10,
  }
  if (type === 'Weapon pickup') m.label = m.weapon
  if (type === 'Vehicle spawn') m.label = m.vehicle
  return Object.assign(m, retailMarkerDefaults(type))
}

export function newLight(position: Vec3 = [0, 3, 0]): Light {
  return { uid: uid(), name: 'Point light', enabled: true, position, color: [1, 0.85, 0.65], intensity: 1, inner_range: 1, range: 8 }
}

export const SPAWN_TYPES = ['Shared spawn', 'Red team spawn', 'Blue team spawn']

export const fileVPath = (hash: string, name: string) => `/work/f/${hash}/${safeName(name)}`
export const safeName = (name: string) => (name.split(/[\\/]/).pop() || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'file'
export const isDataPackPath = (p: string) => p.startsWith('/studio/')
export const baseName = (p: string) => p.split('/').pop() || p

export const isGlass = (it: { native_prefab?: string }) =>
  it.native_prefab === 'sr1_native_glass_3x3' || it.native_prefab === 'sr1_native_custom_mesh_glass_experiment'
export const isCustomNative = (it: { native_prefab?: string }) => it.native_prefab === 'sr1_native_custom_mesh_glass_experiment'
export const isProp = (it: { native_prop_behavior?: string }) => !!it.native_prop_behavior

/** Every virtual path the project refers to (for syncing files and publishing). */
export function referencedPaths(p: Project): string[] {
  const out = new Set<string>()
  const add = (v: unknown) => { if (typeof v === 'string' && v) out.add(v) }
  for (const it of [...p.scene_items, ...p.asset_library]) {
    add(it.path); add(it.native_mesh_obj); add(it.glass_custom_texture)
    Object.values(it.textures || {}).forEach(add)
  }
  const s = p.settings
  add(s.sky_texture); add(s.minimap_texture); add(s.bbcity_donor); add(s.cts_template); add(s.loading_image)
  return [...out]
}

/** Upgrade older saves and fill fields added later. */
export function normalizeProject(raw: any): Project {
  if (!raw || raw.format !== 'sr1-map-studio-web') throw new Error('Not an SR1 Map Studio web project')
  const p = raw as Project
  p.settings = { ...defaultSettings(), ...(p.settings || {}) }
  p.description ??= ''
  for (const k of ['scene_items', 'asset_library', 'markers', 'lights'] as const) {
    (p as any)[k] = ((p as any)[k] || []).map((x: any) => ({ uid: x.uid || uid(), ...x }))
  }
  p.files ||= {}
  return p
}
