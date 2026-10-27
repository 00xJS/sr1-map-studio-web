// v1.15's stock object library (native_props/expanded_v114/catalog.json in the player's own data pack): the game's
// object profiles that v1.15 offers as native prop behaviours, each with the retail object record it was copied
// from, which py/prop_library.py uses at export. It is read in this browser only and never stored in a project or
// uploaded: a project names the profile, as it does for the web's own presets (lib/physicsProps.ts).
import { dataPackBlob } from './datapack'
import { PHYSICS_PRESETS, setLibraryPresets, type PhysicsPreset } from './physicsProps'

export const LIBRARY_CATALOG = 'native_props/expanded_v114/catalog.json'

// The crate and the propane tank are upstream's own two behaviours; CrateFruit keeps the web's debris route
// (py/crate_debris.py) under "How it breaks".
const SKIP = new Set(['Crate Small', 'Propanesmall', 'CrateFruit'])

interface Row { name: string; properties: Record<string, unknown>; explosion: Record<string, unknown> | null }
export interface LibraryCatalog { profiles: Row[]; presets: Record<string, { label: string; profile: string }> }

const num = (v: unknown, fallback: number) => {
  const n = parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : fallback
}
/** The game's lists ({"Element": "x"} or {"Element": ["x", "y"]}), lower case. */
const list = (v: unknown, field: string): string[] => {
  const e = (v as Record<string, unknown> | undefined)?.[field]
  return (e === undefined ? [] : Array.isArray(e) ? e : [e]).map((x) => String(x).toLowerCase())
}

/** Physics presets for the library's profiles the web doesn't offer yet; the numbers are the preview's (the game uses its own table). */
export function libraryPresets(c: LibraryCatalog): PhysicsPreset[] {
  const rows = new Map(c.profiles.map((r) => [r.name, r]))
  const ours = new Set(PHYSICS_PRESETS.map((p) => p.profile))
  const out: PhysicsPreset[] = []
  for (const [key, preset] of Object.entries(c.presets)) {
    const row = rows.get(preset.profile)
    if (!row || SKIP.has(preset.profile) || ours.has(preset.profile)) continue
    const q = row.properties
    const hurt = list(q.Damaged_By, 'Element')
    const all = hurt.includes('all')
    const bullets = all || hurt.includes('bullets'), blasts = all || hurt.includes('explosions')
    const ex = row.explosion
    const lb = num(q.Weight, 20), hp = num(q.Hitpoints, 100)
    const breaks = !!ex || list(q.Flags, 'Flag').includes('disappear_on_death')
    const material = String(q.Material ?? '').replace(' - ', ' ').toLowerCase()
    out.push({
      key: 'lib_' + key,
      label: preset.label,
      hint: `${lb} lb, ${hp} health, ${material || 'no material'}${ex ? `; explodes (${num(ex.Radius, 0)} m)` : breaks ? '; vanishes when destroyed' : ''}. A stock object from your v1.15 package.`,
      behavior: 'movable',
      profile: preset.profile,
      shape: 'box',
      lb,
      bounce: num(q.Restitution, 0),
      friction: num(q.Friction, 1),
      damping: [num(q.Linear_Damping, 0.01), num(q.Angular_Damping, 0.05)],
      hp,
      hurtBy: ((bullets ? 'b' : '') + (blasts ? 'x' : '')) as PhysicsPreset['hurtBy'],
      breaks,
      blast: ex ? { radius: num(ex.Radius, 0), force: num(ex.Impulse, 0) } : undefined,
      pushable: String(q.Movable_By_Humans ?? '').toLowerCase() === 'true',
    })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

let loading: Promise<PhysicsPreset[]> | null = null

/** Reads the library from the data pack once (empty without it) and adds its presets to physicsProps. */
export function loadPropLibrary(): Promise<PhysicsPreset[]> {
  loading ??= dataPackBlob(LIBRARY_CATALOG)
    .then(async (blob) => (blob ? libraryPresets(JSON.parse(await blob.text())) : []))
    .catch(() => [])
    .then((presets) => { setLibraryPresets(presets); return presets })
  return loading
}

/** After the data pack changes. */
export function reloadPropLibrary(): Promise<PhysicsPreset[]> {
  loading = null
  return loadPropLibrary()
}
