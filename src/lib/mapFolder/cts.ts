// A map's CTS files back into editor markers. A CTS file is the game's plain-text list of what a level places:
// navpoints (a named position and facing), and records that start at one (respawns, item pickups, vehicles,
// triggers, people), each under its section heading (#Navpoints, #Items...). The main file is what Gangsta Brawl
// and Big Ass Chains load, <map>_ptp.cts holds Protect Tha Pimp's team spawns and pimp entrances, and
// amb_<map>.cts the ambience zones. The reverse of studio-py/sr1_cts.py and py/sound_zones.py.
import { catalogs } from '../catalogs'
import { newMarker, type Marker, type Vec3 } from '../project'
import { ITEM_PROP } from '../gameObjects/items'
import { SOUND_ZONE } from '../retailModes'

export interface CtsRecord {
  /** What it is: "Navpoint", "Respawn", "Item", "Ambient"... */
  kind: string
  name: string
  section: string
  /** Its fields by name ("Pos", "Start nav", "Item type"...), the first of each; nested ones too. */
  fields: Record<string, string>
  /** Its "+Name" switches without a value (+Disabled, +MPTeam1...). */
  flags: string[]
}

export interface Cts { includes: string[]; records: CtsRecord[] }

/** Record kinds: a "$Kind:" line at the start of a line opens one. */
const HEADS = new Set(['Navpoint', 'Item', 'Vehicle', 'Respawn', 'Trigger', 'Human', 'Special Spawn', 'Ambient', 'Group', 'DSP', 'Negative', 'Cluder', 'Include'])

const unquote = (v: string) => { const m = v.match(/^"([^"]*)"/); return m ? m[1] : v.trim() }

export function parseCts(text: string): Cts {
  const records: CtsRecord[] = [], includes: string[] = []
  let section = '', cur: CtsRecord | null = null
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\/\/.*$/, '')
    if (!line.trim()) continue
    const head = line.match(/^#([A-Za-z][A-Za-z0-9 ]*?)\s*$/)
    if (head) { section = '#' + head[1]; cur = null; continue }
    const field = line.match(/^\s*([$+])([^:\t]+?)\s*(?::\s*(.*))?$/)
    if (!field) continue
    const [, sign, key, value] = field
    const top = !/^\s/.test(line)
    if (sign === '$' && top && HEADS.has(key)) {
      if (key === 'Include') { includes.push(unquote(value ?? '')); cur = null; continue }
      cur = { kind: key, name: unquote(value ?? ''), section, fields: {}, flags: [] }
      records.push(cur)
      continue
    }
    if (!cur) continue
    if (value === undefined) { if (sign === '+') cur.flags.push(key); continue }
    if (!(key in cur.fields)) cur.fields[key] = value.trim()
  }
  return { includes, records }
}

/** "<1 2 3>" → [1, 2, 3]. */
export function vec(v: string | undefined): Vec3 | null {
  const m = v?.match(/<\s*(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s*>/)
  if (!m) return null
  const p: Vec3 = [+m[1], +m[2], +m[3]]
  return p.every(Number.isFinite) ? p : null
}

/** "[0.5]" or "0.5" → 0.5. */
export const num = (v: string | undefined, fallback = 0) => {
  const n = parseFloat((v ?? '').replace(/[[\]"]/g, ''))
  return Number.isFinite(n) ? n : fallback
}

/**
 * Game frame (metres) to editor space: the editor mirrors X and counts in world-scale units; `origin` is the
 * game point that becomes the editor's (0, 0, 0). Facing: the exporter writes radians(-yaw) for mirrored maps.
 */
export interface Frame { origin: Vec3; ws: number }
export const toEditor = (f: Frame, g: Vec3): Vec3 => [-(g[0] - f.origin[0]) / f.ws, (g[1] - f.origin[1]) / f.ws, (g[2] - f.origin[2]) / f.ws]
export const yawToEditor = (radians: number) => +(-(radians * 180) / Math.PI).toFixed(2) || 0

const WEAPON_IDS = new Map(catalogs.weapons.map(([, id]) => [id.toLowerCase(), id]))
const VEHICLE_IDS = new Map(catalogs.vehicles.map(([, id]) => [id.toLowerCase(), id]))

/** The weapon a CTS item type names (the exporter writes ids with "-" as spaces), or null when it's another item. */
export function weaponId(type: string): string | null {
  const t = type.trim().toLowerCase()
  return WEAPON_IDS.get(t) ?? WEAPON_IDS.get(t.replace(/ /g, '-')) ?? WEAPON_IDS.get(t.replace(/ /g, '_')) ?? null
}

export interface CtsMarkers {
  markers: Marker[]
  /** Ambience files it includes that aren't in the map folder (a retail map's, by name). */
  includes: string[]
  /** What was left out, in words. */
  skipped: string[]
}

const posKey = (m: Marker) => `${m.type}|${m.label}|${m.position.map((v) => Math.round(v * 20)).join(',')}`

/**
 * Markers from a map's CTS files (main first, then the PTP one), and sound zones from its ambience file. Things
 * that appear in more than one file (the PTP file repeats the vehicles) come in once.
 */
export function ctsMarkers(files: { main?: Cts; ptp?: Cts; ambience?: Cts }, frame: Frame, maxNavpoints = 200): CtsMarkers {
  const markers: Marker[] = [], skipped: string[] = []
  const seen = new Set<string>()
  const add = (m: Marker) => { const k = posKey(m); if (!seen.has(k)) { seen.add(k); markers.push(m) } }
  const counts = new Map<string, number>()
  const skip = (what: string) => counts.set(what, (counts.get(what) ?? 0) + 1)
  for (const [which, cts] of [['main', files.main], ['ptp', files.ptp]] as const) {
    if (!cts) continue
    const navs = new Map<string, CtsRecord>()
    for (const r of cts.records) if (r.kind === 'Navpoint') navs.set(r.name, r)
    const used = new Set<string>()
    const at = (r: CtsRecord): { position: Vec3; yaw: number } | null => {
      const nav = navs.get(unquote(r.fields['Start nav'] ?? ''))
      const g = vec(nav?.fields.Pos)
      if (!nav || !g) return null
      used.add(nav.name)
      return { position: toEditor(frame, g), yaw: yawToEditor(num(nav.fields.Orient)) }
    }
    for (const r of cts.records) {
      if (r.kind === 'Navpoint' || r.kind === 'Ambient' || r.kind === 'Group' || r.kind === 'Special Spawn') continue
      const p = at(r)
      if (!p) { if (r.kind !== 'DSP' && r.kind !== 'Negative' && r.kind !== 'Cluder') skip(`${r.kind.toLowerCase()} without a navpoint`); continue }
      const m = (type: string) => Object.assign(newMarker(type, p.position), { yaw: p.yaw })
      if (r.kind === 'Respawn') {
        const team = r.flags.includes('MPTeam1') ? 'Red team spawn' : r.flags.includes('MPTeam2') ? 'Blue team spawn' : 'Shared spawn'
        add(m(team))
      } else if (r.kind === 'Item') {
        const type = unquote(r.fields['Item type'] ?? '')
        const w = weaponId(type)
        if (w) add(Object.assign(m('Weapon pickup'), { weapon: w, label: w }))
        else if (type) add(Object.assign(m(ITEM_PROP), { item: type, label: type }))
      } else if (r.kind === 'Vehicle') {
        const type = unquote(r.fields['Vehicle type'] ?? '')
        const id = VEHICLE_IDS.get(type.toLowerCase()) ?? type
        if (id) add(Object.assign(m('Vehicle spawn'), { vehicle: id, label: id }))
      } else if (r.kind === 'Trigger') {
        if (unquote(r.fields['Trigger type'] ?? 'sphere').toLowerCase() !== 'sphere') { skip('box trigger'); continue }
        const action = unquote(r.fields['Trigger action'] ?? '')
        const type = action === 'chains drop off' ? 'Chains drop-off' : action === 'pimp enter' ? 'Pimp entrance' : 'Sphere trigger (custom)'
        add(Object.assign(m(type), {
          radius: num(r.fields['Sphere radius'], 0.7), delay_ms: Math.round(num(r.fields['Trigger delay'], 10000)),
          max_fires: Math.round(num(r.fields['Trigger max fires'], 0)), disabled: r.flags.includes('Disabled'),
          ...(type === 'Sphere trigger (custom)' ? { trigger_action: action } : {}),
        }))
      } else if (r.kind === 'Human') {
        const char = unquote(r.fields['Char type'] ?? '')
        add(Object.assign(m('Human NPC spawn'), {
          char_type: char || 'LC_X_F_Thug1-01_A', leash_distance: num(r.fields['Leash distance'], 10),
          group: unquote(r.fields.Group ?? '').replace(/^.*\$G_/, ''),
        }))
      } else skip(r.kind.toLowerCase())
    }
    // Special spawns carry their own position, like a navpoint.
    for (const r of cts.records) {
      if (r.kind !== 'Special Spawn') continue
      const p = vec(r.fields.Pos) ? { position: toEditor(frame, vec(r.fields.Pos)!), yaw: yawToEditor(num(r.fields.Orient)) } : at(r)
      if (p) add(Object.assign(newMarker('Special spawn', p.position), { yaw: p.yaw, special_type: unquote(r.fields.Type ?? '') || 'Reading news' }))
      else skip('special spawn without a position')
    }
    // Navpoints nothing starts at (AI paths, the "pimp exit" some maps mark): kept as navpoints, from the main file.
    if (which === 'main') {
      let n = 0
      for (const nav of navs.values()) {
        if (used.has(nav.name)) continue
        const g = vec(nav.fields.Pos)
        if (!g) continue
        if (++n > maxNavpoints) { skip('navpoint'); continue }
        const type = unquote(nav.fields.Type ?? '').toLowerCase() === 'floating' ? 'Floating navpoint' : 'Ground navpoint'
        add(Object.assign(newMarker(type, toEditor(frame, g)), { yaw: yawToEditor(num(nav.fields.Orient)) }))
      }
    }
  }
  if (files.ambience) for (const z of soundZones(files.ambience, frame)) add(z)
  for (const [what, n] of counts) skipped.push(`${n} ${what}${n === 1 ? '' : 's'}`)
  const includes = [...(files.main?.includes ?? [])].map((i) => i.replace(/\.cts$/i, ''))
  return { markers, includes, skipped }
}

/** Sound zones from an ambience file: its spheres, boxes and cylinders (as boxes), each playing its first sound. */
export function soundZones(cts: Cts, frame: Frame): Marker[] {
  const navs = new Map(cts.records.filter((r) => r.kind === 'Navpoint').map((r) => [r.name, r]))
  const out: Marker[] = []
  for (const r of cts.records) {
    if (r.kind !== 'Ambient') continue
    const nav = navs.get(unquote(r.fields.Navpoint ?? r.name))
    const g = vec(nav?.fields.Pos)
    const file = unquote(r.fields.File ?? '')
    if (!g || !file) continue
    const shape = unquote(r.fields.Shape ?? 'Sphere').toLowerCase()
    const m = Object.assign(newMarker(SOUND_ZONE, toEditor(frame, g)), { yaw: yawToEditor(num(nav!.fields.Orient)), sound: file.replace(/\.wav$/i, ''), label: file.replace(/\.wav$/i, '') })
    m.volume = num(r.fields.Volume, 0.4)
    const lo = num(r.fields['Min Delay']), hi = num(r.fields['Max Delay'])
    if (unquote(r.fields['Play Type'] ?? '').toLowerCase() === 'random' || hi > 0) Object.assign(m, { sound_random: true, delay_min_s: lo / 1000, delay_max_s: hi / 1000 })
    if (shape === 'box') {
      const s = vec(r.fields['Outer Dimensions'])
      Object.assign(m, { shape: 'box', size: s ?? [20, 8, 20] })
    } else if (shape === 'cylinder') {
      const rad = num(r.fields['Outer Radius'], 15), h = num(r.fields['Outer Height'], 8)
      Object.assign(m, { shape: 'box', size: [2 * rad, h, 2 * rad] })
    } else Object.assign(m, { shape: 'sphere', radius: num(r.fields['Outer Radius'], 15) })
    out.push(m)
  }
  return out
}
