// Game catalogs and limits exported from the vendored Python by
// scripts/dump-catalogs.py, so the UI works before Python has loaded.
import data from './catalogs.json'

export interface Catalogs {
  marker_types: string[]
  spawn_kinds: string[]
  trigger_kinds: string[]
  trigger_actions: string[]
  special_spawn_types: string[]
  human_char_types: string[]
  weapons: [string, string][]
  vehicles: [string, string][]
  surface_types: string[]
  surface_suffixes: string[]
  glass_styles: Record<string, string>
  glass_kind: string
  custom_kind: string
  glass_size: [number, number]
  prop_presets: Record<string, { label: string; profile: string; health: number; weight: number; description: string }>
  limits: { max_native_objects: number; max_native_triangles: number; min_native_axis: number; max_native_axis: number; max_lights: number }
  new_light: Record<string, unknown>
  exporter_version: string
}

export const catalogs = data as unknown as Catalogs
