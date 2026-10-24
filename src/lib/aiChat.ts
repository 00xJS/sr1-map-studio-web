// AI chat about the open map: a plain-text summary of the map for the model,
// the list of edits it may ask for, and a forgiving reader for its replies.
// The model is any chat model on NVIDIA's API (build.nvidia.com), called with
// the user's own key through /api/ai. The key only ever goes in the
// Authorization header of that call; it is never logged or put in a message.
import { gameSkyWanted, type Marker, type Project, type Vec3 } from './project'
import { ALL_PREFABS } from './prefabRegistry'
import { PREFABS } from './prefabs'
import { normalize, prefabEntries, stem } from './prefabIndex'
import { SHAPE_PRESETS } from './shapes'
import { catalogs } from './catalogs'
import { GAME_MODES } from './project'
import { KINDS } from './procedural'
import { DENSITY, LAYOUTS, SETTINGS } from './mapWizard'
import { TOPICS } from './mapFacts'
import { CITY_SIZES, citySide, type CitySize } from './cityGen'
import { PHYSICS_PRESETS } from './physicsProps'
import { AMBIENCE_OPTIONS } from './mapFeatures'

/**
 * The chat models marked "Free Endpoint" on build.nvidia.com (its models page, filtered to Free Endpoint),
 * as of October 2026. NVIDIA's API answers for more models than these, but the rest need a paid partner plan
 * or are being retired. The live list still decides what shows, so a model NVIDIA drops disappears by itself.
 */
export const FREE_MODELS = [
  'google/gemma-4-31b-it', 'deepseek-ai/deepseek-v4.1-flash', 'z-ai/glm-5.3', 'z-ai/glm-5.3-flash', 'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-3.5-lightning-30b-a3b', 'nvidia/nemotron-3.5-super-vl-120b-a12b', 'nvidia/nemotron-3.5-bolt-e4b', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'minimaxai/minimax-m3.1-flash', 'stepfun-ai/step-5-preview', 'openai/gpt-oss-20b', 'meta/muse-glimmer-30b', 'poolside/laguna-xs-2.1',
  'google/diffusiongemma-26b-a4b-it', 'meta/llama-3.2-90b-vision-instruct', 'meta/llama-3.2-11b-vision-instruct',
]
/** Good free picks, best first; the first is the default. */
export const SUGGESTED_MODELS = ['google/gemma-4-31b-it', 'deepseek-ai/deepseek-v4.1-flash', 'z-ai/glm-5.3', 'nvidia/nemotron-3-ultra-550b-a55b']
export const isFree = (id: string) => FREE_MODELS.includes(id)
export const DEFAULT_MODEL = SUGGESTED_MODELS[0]
export const KEY_STORE = 'sr1ms.nvidiaKey'
export const MODEL_STORE = 'sr1ms.nvidiaModel'

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

/** Which objects an edit is for: by index, by name (a part of it, any case), by prefab or shape kind, or near [x, z, radius]. */
export interface AiTarget { indices?: number[]; name?: string; prefab?: string; shape?: string; near?: [number, number, number] }

/** One thing to place, for place_line and place_ring (an add_* edit without its position). */
export type AiPlaceable =
  | { do: 'add_prefab'; key: string; turn?: number; settings?: Record<string, number | string> }
  | { do: 'add_shape'; shape: string; turn?: number; size?: [number, number, number] }
  | { do: 'add_marker'; type: string; weapon?: string }
  | { do: 'add_light'; y?: number; color?: Vec3 }

export type AiAction =
  | { do: 'add_prefab'; key: string; x: number; z: number; turn?: number; settings?: Record<string, number | string>; mirror?: boolean }
  | { do: 'add_shape'; shape: string; x: number; z: number; turn?: number; size?: [number, number, number]; mirror?: boolean }
  | { do: 'move'; index: number; x?: number; y?: number; z?: number; dx?: number; dy?: number; dz?: number }
  | { do: 'turn'; index: number; degrees: number }
  | { do: 'scale'; index: number; factor: number }
  | ({ do: 'delete' } & AiTarget)
  | { do: 'duplicate'; index: number; dx?: number; dz?: number }
  | { do: 'prefab_settings'; index: number; settings: Record<string, number | string> }
  | { do: 'add_marker'; type: string; x: number; z: number; weapon?: string; mirror?: boolean }
  | { do: 'delete_markers'; type?: string; near?: [number, number, number]; indices?: number[] }
  | { do: 'move_marker'; index: number; x: number; z: number }
  | { do: 'add_light'; x: number; y: number; z: number; color?: Vec3; mirror?: boolean }
  | { do: 'set_modes'; modes: string[] }
  | { do: 'rename_map'; name: string }
  | ({ do: 'select' } & AiTarget)
  | ({ do: 'paint'; texture: string; material?: string; color?: string; accent?: string } & AiTarget)
  | { do: 'spread_spawns'; which?: 'shared' | 'team' | 'all'; count?: number }
  | { do: 'add_weapons'; weapons: string[]; where?: 'middle' | 'spread' | 'ends'; mirror?: boolean }
  | ({ do: 'set_object'; solid?: boolean; physics?: string; water?: boolean; double_sided?: boolean; rename?: string } & AiTarget)
  | ({ do: 'edit_marker'; indices?: number[]; type?: string; near?: [number, number, number]; face?: 'middle' } & Record<string, unknown>)
  | ({ do: 'edit_light'; indices?: number[]; near?: [number, number, number]; all?: boolean; x?: number; y?: number; z?: number } & Record<string, unknown>)
  | { do: 'delete_lights'; indices?: number[]; near?: [number, number, number]; all?: boolean }
  | { do: 'set_map'; name?: string; ambience?: string; game_sky?: boolean; sky_picture?: boolean; loading?: 'auto' | 'none' }
  | { do: 'place_line'; item: AiPlaceable; from: [number, number]; to: [number, number]; count: number; face?: 'along' | 'across'; mirror?: boolean }
  | { do: 'place_ring'; item: AiPlaceable; center?: [number, number]; radius: number; count: number; start?: number; face?: 'in' | 'out'; mirror?: boolean }
  | ({ do: 'mirror'; markers?: number[] } & AiTarget)
  | { do: 'make_symmetric'; keep: 'red' | 'blue'; only?: 'objects' | 'markers' }
  | { do: 'set_weather'; clear: boolean }
  | { do: 'generate_map'; setting: string; layout: string; players: number; density?: string; seed?: number; name?: string; then?: AiAction[]; generator?: 'wizard' | 'city'; size?: string }

export const KNOWN_EDITS = new Set(['add_prefab', 'add_shape', 'move', 'turn', 'scale', 'delete', 'duplicate', 'prefab_settings', 'add_marker', 'delete_markers', 'move_marker', 'add_light', 'set_modes', 'rename_map', 'select', 'paint', 'place_line', 'place_ring', 'mirror', 'make_symmetric', 'set_weather', 'generate_map', 'spread_spawns', 'add_weapons', 'set_object', 'edit_marker', 'edit_light', 'delete_lights', 'set_map'])

export interface AiReply { reply: string; actions: AiAction[] }

const r1 = (v: number) => Math.round(v * 10) / 10

/** "/work/f/ab12…/red_brick.jpg" -> "red_brick" */
const texName = (vpath: string) => (vpath || '').split('/').pop()!.replace(/\.\w+$/, '').replace(/(_\d+)+$/, '') || 'none'

/** What the model knows about the map, kept compact. `bounds` gives an object's box when the 3D view has it. */
/** What a marker is set to, besides where it is. */
function markerDetail(m: Marker): string {
  const d: string[] = []
  if (m.type === 'Weapon pickup') d.push(m.weapon)
  if (m.type === 'Vehicle spawn') d.push(m.vehicle)
  if (/spawn/i.test(m.type) && m.yaw) d.push('yaw ' + r1(m.yaw))
  if (/npc|human|character|special/i.test(m.type)) d.push(m.special_type || m.char_type)
  if (m.sound) d.push(`sound ${m.sound}${m.volume !== undefined ? ' ' + m.volume : ''}`)
  if (m.size) d.push('size ' + m.size.map(r1).join('×'))
  else if (/zone|trigger|drop-off|sound/i.test(m.type)) d.push('radius ' + r1(m.radius))
  const shown = d.filter(Boolean)
  return shown.length ? ' ' + shown.join(' ') : ''
}

export function describeMap(p: Project, bounds?: (index: number) => [Vec3, Vec3] | null): string {
  const lines: string[] = []
  const s = p.settings
  lines.push(`Map "${s.display_name || 'Untitled'}". Units: 1 unit = ${s.world_scale || 0.5} m in game; y is up; the main ground top is usually y 1.`)
  lines.push(`Red team's end is -Z, blue's is +Z. Fair maps are point-symmetric: whatever is at (x, z) has a twin at (-x, -z) turned 180°.`)
  lines.push(`Game modes on: ${s.modes.join(', ') || 'none'}. Weather: ${s.always_clear_weather ? 'always clear' : 'changes each match (rain, night)'}.`)
  let lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  const objs = p.scene_items.map((it, i) => {
    const b = bounds?.(i)
    if (b) { lo = lo.map((v, k) => Math.min(v, b[0][k])) as Vec3; hi = hi.map((v, k) => Math.max(v, b[1][k])) as Vec3 }
    const size = b ? ` size ${r1(b[1][0] - b[0][0])}×${r1(b[1][1] - b[0][1])}×${r1(b[1][2] - b[0][2])}` : it.shape ? ` size ${it.shape.size.map((v) => r1(v * it.scale)).join('×')}` : ''
    const pf = it.prefab ? ` [prefab ${it.prefab.key}${Object.keys(it.prefab.params).length ? ' ' + JSON.stringify(it.prefab.params) : ''}]` : ''
    const turn = it.rotation[1] ? ` turn ${r1(it.rotation[1])}` : ''
    const grp = it.group ? ` group ${it.group.slice(0, 8)}` : ''
    const flags = [it.collision_disabled && 'walk-through', it.physics_preset && `physics=${it.physics_preset}`, it.native_prop_behavior && !it.physics_preset && it.native_prop_behavior,
      it.swimmable_water && 'swimmable', it.glass_style && 'glass', it.double_sided && 'double-sided'].filter(Boolean)
    const flag = flags.length ? ` (${flags.join(', ')})` : ''
    const mats = Object.keys(it.textures || {})
    const mat = mats.length ? ` materials ${mats.slice(0, 6).map((m) => `${m}=${texName(it.textures[m])}`).join(',')}` : ''
    return `${i}: ${it.name}${pf} at ${it.position.map(r1).join(',')}${size}${turn}${flag}${grp}${mat}`
  })
  if (Number.isFinite(lo[0])) lines.push(`Map extent: x ${r1(lo[0])}..${r1(hi[0])}, z ${r1(lo[2])}..${r1(hi[2])}, height ${r1(lo[1])}..${r1(hi[1])}.`)
  lines.push(`Objects (${objs.length}; index: name at x,y,z):`)
  lines.push(...(objs.length > 400 ? [...objs.slice(0, 400), `…and ${objs.length - 400} more`] : objs))
  const byType = new Map<string, string[]>()
  p.markers.forEach((m, i) => {
    const q = m.position
    byType.set(m.type, [...(byType.get(m.type) ?? []), `#${i}(${r1(q[0])},${r1(q[1])},${r1(q[2])}${markerDetail(m)})`])
  })
  lines.push(`Markers (#index(x,y,z) and details; yaw 0 faces -Z):`)
  for (const [t, ps] of byType) lines.push(`${t} ×${ps.length}: ${ps.slice(0, 40).join(' ')}${ps.length > 40 ? ' …' : ''}`)
  lines.push(`Lights (${p.lights.length} of ${catalogs.limits.max_lights}; #index (x,y,z) colour intensity range):${p.lights.length ? '' : ' none'}`)
  if (p.lights.length) lines.push(p.lights.map((l, i) => `#${i}(${l.position.map(r1).join(',')}) [${l.color.map((c) => +c.toFixed(2)).join(',')}] ${+l.intensity.toFixed(2)} ${r1(l.range)}${l.enabled ? '' : ' off'}`).join(' '))
  lines.push(`Settings: background sound ${s.ambience || 'none'}; sky: ${s.native_sky ? 'native preset ' + s.native_sky : gameSkyWanted(s) ? "the game's own sky at export" : 'none from the game'}${s.sky_texture ? ', with a fallback sky picture' : ', no fallback sky picture'}; loading picture ${s.loading_mode ?? 'auto'}.`)
  return lines.join('\n')
}

// ---------------- models ----------------

export interface ModelProfile {
  /** small: short prompts and a worked example; reasoning: thinks first (slower, needs more tokens). */
  tier: 'small' | 'standard' | 'reasoning'
  temperature: number
  maxTokens: number
}

/** How to prompt a model, from its name. Unknown models get the careful standard treatment. */
export function modelProfile(model: string): ModelProfile {
  const m = model.toLowerCase()
  if (/deepseek-r1|qwq|-r1\b|reason|think|kimi-k2|magistral|gpt-oss|nemotron.*(super|ultra)/.test(m)) return { tier: 'reasoning', temperature: 0.6, maxTokens: 8192 }
  if (/(^|[-/_.])(\d(\.\d)?b|1[0-4]b|mini|nano|small|lite|tiny)\b/.test(m)) return { tier: 'small', temperature: 0.2, maxTokens: 2048 }
  return { tier: 'standard', temperature: 0.3, maxTokens: 3072 }
}

// ---------------- prompts ----------------

let libraryIds: string[] = []
/** The starter library's texture ids, once the page has loaded them (so paint can name them). */
export const setLibraryTextures = (ids: string[]) => { libraryIds = ids }
/** Texture names the paint edit understands: the starter library's ids and the generated kinds. */
export const textureNames = () => [...libraryIds, ...Object.keys(KINDS)]

const STOP = new Set(('the and for with from into onto add put place make build some more this that there here its our your you can could would like want need please map maps near next middle center centre around each side top front back left right big small new one two three lot lots any all also just very really').split(' '))

/**
 * The prefabs that fit a request, best first: a word of the request in a prefab's name counts most,
 * in its description, category or keywords less. ("add a gas station" finds the gas stations.)
 */
export function relevantPrefabs(request: string, count = 40): string[] {
  const words = [...new Set(normalize(request).trim().split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map(stem))]
  if (!words.length) return []
  const scored: [string, number][] = []
  for (const e of prefabEntries()) {
    if (!e.shape.startsWith('prefab:')) continue
    const label = normalize(e.label)
    let score = 0
    // Whole words (or their plural): "bus" is not "bush".
    const has = (t: string, w: string) => t.includes(' ' + w + ' ') || t.includes(' ' + w + 's ') || t.includes(' ' + w + 'es ')
    for (const w of words) score += has(label, w) ? 4 : has(e.text, w) ? 1.5 : 0
    if (score) scored.push([e.shape.slice(7), score])
  }
  return scored.sort((a, b) => b[1] - a[1]).slice(0, count).map(([k]) => k)
}

/**
 * What the model may name. Every prefab key is listed (so it knows what exists), but only the ones that fit
 * the request, plus the everyday basics, come with their names and settings: the whole catalogue in full is
 * so long that busy free models time out before they start answering.
 */
function reference(profile: ModelProfile, request = ''): string {
  const small = profile.tier === 'small'
  const full = new Set([...relevantPrefabs(request, small ? 15 : 40), ...Object.keys(PREFABS), 'textsign'].filter((k) => ALL_PREFABS[k]))
  const detail = (k: string) => {
    const d = ALL_PREFABS[k]
    const ps = small ? '' : (d.params ?? []).map((pd) => `${pd.key}${pd.options ? '=' + pd.options.map(([v]) => v).join('|') : pd.min !== undefined ? ` ${pd.min}-${pd.max}` : ''}`).join(',')
    return `${k} (${d.label}${ps ? '; settings ' + ps : ''})`
  }
  return [
    `Prefabs for this request: ${[...full].map(detail).join('; ')}.`,
    `Other prefab keys (the key says what it is): ${Object.keys(ALL_PREFABS).filter((k) => !full.has(k)).join(', ')}.`,
    `Shapes: ${Object.keys(SHAPE_PRESETS).join(', ')}.`,
    `Textures for paint: ${textureNames().join(', ')}.`,
    `Marker types: ${catalogs.marker_types.join(', ')}.`,
    `Physics presets (set_object physics): ${PHYSICS_PRESETS.map((x) => x.key).join(', ')}.`,
    `Background sounds (set_map ambience): ${AMBIENCE_OPTIONS.map((x) => `${x.file} (${x.label})`).join(', ')}.`,
    ...(/car|vehicle|truck|bike|van|drive|ride|police|taxi|limo|bus/i.test(request) ? [`Vehicles (id): ${catalogs.vehicles.map(([label, id]) => `${id} (${label})`).join(', ')}.`] : []),
    ...(/npc|people|person|character|thug|gang|crowd|bouncer|dancer|stripper|guard|cop|civilian|human/i.test(request) ? [`Characters (char_type): ${catalogs.human_char_types.join(', ')}. Special spawns (special_type): ${catalogs.special_spawn_types.join(', ')}.`] : []),
    `Weapon ids: ${catalogs.weapons.map(([, id]) => id).join(', ')} (power weapons: sniper_rifle, rpg_launcher, rpg_laser).`,
    `Game modes: ${GAME_MODES.join(', ')}.`,
    `New map settings: ${Object.keys(SETTINGS).join(', ')}; layouts: ${Object.keys(LAYOUTS).join(', ')}; density: ${Object.keys(DENSITY).join(', ')}; players 2-12.`,
  ].join('\n')
}

const EDITS = `{"do":"add_prefab","key":"bench","x":10,"z":-20,"turn":90,"settings":{},"mirror":true}
{"do":"add_shape","shape":"wall","x":0,"z":-30,"turn":0,"size":[12,6,1],"mirror":true}
{"do":"move","index":3,"x":10,"z":-4}   or relative: {"do":"move","index":3,"dx":2,"dy":0,"dz":0}
{"do":"turn","index":3,"degrees":90}
{"do":"scale","index":3,"factor":1.5}
{"do":"duplicate","index":3,"dx":10,"dz":0}
{"do":"prefab_settings","index":3,"settings":{"h":30}}
{"do":"delete","indices":[3,4]}   or by name, kind or area: {"do":"delete","name":"crate"}  {"do":"delete","near":[0,0,16]}
{"do":"select","name":"wall"}   (or "indices", "prefab":"lamp", "shape":"box"; to point things out)
{"do":"paint","name":"building","texture":"red_brick","material":"side"}   (any target; "material" is optional: a material name or its current texture)
{"do":"paint","prefab":"office","texture":"concrete","color":"#3b2d4f","accent":"#c9a227"}   (a generated texture in your colours, for a mood or theme)
{"do":"place_line","item":{"do":"add_prefab","key":"lamp"},"from":[-40,-60],"to":[40,-60],"count":5,"face":"along","mirror":true}
{"do":"place_ring","item":{"do":"add_shape","shape":"pillar"},"center":[0,0],"radius":25,"count":8,"face":"out"}
{"do":"add_marker","type":"Shared spawn","x":0,"z":-20,"mirror":true}   (weapons: "type":"Weapon pickup","weapon":"<id>"; also "yaw", "vehicle", "char_type", "special_type", "radius" as in edit_marker)
{"do":"move_marker","index":12,"x":4,"z":-50}
{"do":"spread_spawns","which":"shared","count":16}   (moves the spawns onto open floor, as far apart as it allows: "shared" free-for-all spawns, "team" (count is per team, each at its own end) or "all"; leave out count to keep how many there are. Use it for "reshift / spread out / fix the spawns")
{"do":"add_weapons","weapons":["rpg_launcher","sniper_rifle","spas12"],"where":"spread"}   (finds open floor for each, off the spawns, twin on the other half; "where": middle, spread or ends. Use it for "add these weapons" instead of guessing spots)
{"do":"delete_markers","type":"Weapon pickup","near":[x,z,radius]}   or {"do":"delete_markers","indices":[12]}
{"do":"add_light","x":0,"y":8,"z":0,"color":[1,0.8,0.6],"mirror":true}
{"do":"edit_light","indices":[2],"color":[0.2,0.9,1],"intensity":2,"range":30,"enabled":true,"x":4,"y":9,"z":-10}   (or "near":[x,z,radius], or "all":true; any of the fields)
{"do":"delete_lights","near":[0,0,20]}   (or "indices", or "all":true)
{"do":"set_object","name":"crate","solid":false,"physics":"light_crate","water":false,"double_sided":true,"rename":"Supply crate"}   (any target; solid false = players and shots pass through; "physics": a physics preset, or "none" to make it static again; water true = swimmable)
{"do":"edit_marker","type":"Vehicle spawn","vehicle":"car_4dr_police01"}   (pick by "indices", "type" and/or "near"; fields: yaw (0 faces -Z) or "face":"middle", weapon, vehicle, char_type, special_type, radius, size [w,h,d], delay_ms, label, sound, volume, disabled)
{"do":"set_map","name":"Rust Belt","ambience":"amb_mp_bac_01","game_sky":true,"sky_picture":true,"loading":"auto"}   (any of: map name, background sound ("" for none), the game's own sky at export, a fallback sky picture, the loading picture "auto" or "none")
{"do":"mirror","name":"crate"}   (adds missing twins across the middle; any target; markers: {"do":"mirror","markers":[12,13]})
{"do":"make_symmetric","keep":"red"}   (blue's half becomes a copy of red's; add "only":"objects" or "markers")
{"do":"set_weather","clear":false}   (false: time of day and weather such as rain change each match)
{"do":"set_modes","modes":["Gangsta Brawl"]}
{"do":"rename_map","name":"Harbor Rumble"}
{"do":"generate_map","setting":"downtown","layout":"heights","players":8,"density":"normal","name":"Rain Roofs","then":[...edits for the new map...]}   (a brand-new map; only when asked for a new map; add "generator":"city","size":"town|city|big" for a whole city)`

const RULES = `Rules:
- "mirror": true also places the twin at (-x,-z) turned 180°, and a red team spawn's twin is a blue team spawn. Use it for anything off-centre so both teams get the same map.
- Object and marker indices are the ones listed below. Deletes happen after everything else in the same reply.
- Keep spawns and weapons on open floor, not inside objects. Put team spawns at their own end (red -Z, blue +Z).
- For questions, answer in "reply" with "actions": []. Never invent prefab keys, shapes, textures, marker types or weapon ids.
- If a request is unclear, ask in "reply" instead of guessing.`

const EXAMPLE = `Example. User: "put a lamp on each side of the middle" ->
{"reply":"Added a street lamp on each side of the middle.","actions":[{"do":"add_prefab","key":"lamp","x":12,"z":-6,"turn":0,"mirror":true}]}`

export function systemPrompt(map: string, profile: ModelProfile = modelProfile(DEFAULT_MODEL), request = ''): string {
  return `You help someone build a Saints Row 1 multiplayer map in a web editor. You can talk about the map and change it.

Always answer with ONE JSON object and nothing else (no code fence, no comments):
{"reply": "short, friendly, plain-language answer", "actions": [ ...edits, or [] ... ]}

Edits you can make (numbers are editor units; objects drop onto the surface below x,z):
${EDITS}

${RULES}
${profile.tier === 'reasoning' ? '' : '\n' + EXAMPLE + '\n'}
${reference(profile, request)}

The map now:
${map}

Remember: answer with the JSON object only.`
}

/** The critique: the map, the facts measured in code, and the review format. */
export function critiquePrompt(map: string, facts: string, profile: ModelProfile = modelProfile(DEFAULT_MODEL)): string {
  const small = profile.tier === 'small'
  return `You review Saints Row 1 multiplayer maps for fairness and fun. The numbers below were measured in code: trust them, don't recount.

Answer with ONE JSON object and nothing else:
{"reply": "two or three sentences: the overall verdict",
 "review": {"score": 1-10, "sections": [
   {"topic": "spawns", "verdict": "good|ok|bad", "notes": "what is right or wrong, in plain words, citing the numbers", "actions": [optional extra edits]}
 ]},
 "actions": []}
One section for each topic: ${Object.keys(TOPICS).join(', ')}. Keep notes short. Findings marked [fix] already have a one-click fix; only put edits in a section's "actions" for something else, in the editor's format:
${small ? EDITS.split('\n').slice(0, 2).join('\n') : EDITS}

${facts}

${small ? '' : reference(profile) + '\n\n'}The map:
${map}

Remember: answer with the JSON object only.`
}

/** For "describe a map": pick the new map wizard's options and any edits to make after. */
export function describePrompt(profile: ModelProfile = modelProfile(DEFAULT_MODEL), request = ''): string {
  const sizes = (Object.keys(CITY_SIZES) as CitySize[]).map((k) => `${k} ${citySide(k)}×${citySide(k)}`).join(', ')
  return `You turn someone's description of a Saints Row 1 multiplayer map into settings for a map generator, plus edits to make after it is built.
Descriptions can be short ("docks at night for 6") or long and wild (a magic city on an ancient network, with guilds and dragons). Either way, build the closest thing the game can be and make it theirs.

Answer with ONE JSON object and nothing else:
{"reply": "two or three sentences: what you built, how it matches their idea, and what the game can't do",
 "map": {"generator": "wizard|city", "size": "${Object.keys(CITY_SIZES).join('|')}", "setting": "${Object.keys(SETTINGS).join('|')}", "layout": "${Object.keys(LAYOUTS).join('|')}", "players": 2-12, "density": "${Object.keys(DENSITY).join('|')}", "name": "a short map name"},
 "then": [ ...edits... ]}

Generators:
- wizard: a compact, fair arena for a match (any setting and layout). The default.
- city: a whole Stilwater-style city to fight through: downtown towers, chinatown, red light, projects, barrio, suburbs, high end, docks, industrial, a park, a river with bridges, an elevated freeway, cars and street signs. Choose it when they describe a city, a town, districts or a big world; "size" is ${sizes} editor units (keep city edits inside ±(side/2 - 8)). Setting, layout and density don't apply to it.

Big or imaginative ideas:
- Names (the city, guilds, factions, shops, slogans, street names) go on signs: {"do":"add_prefab","key":"textsign","x":0,"z":-20,"settings":{"text":"THE AETHERLINE","style":"neon","mount":"post","w":10,"h":2}}. Styles: street, shop, plaque, neon, plain; mount: post, stand, wall, hanging; two lines of up to 24 letters.
- A mood or colour scheme: paint with your own colours, e.g. {"do":"paint","prefab":"office","texture":"concrete","color":"#2b2238","accent":"#c9a227"}.
- Landmarks and set pieces: prefabs whose names fit (a tower for a spire, statues, fountains, neon signs, wrecks...), lines and rings of them for scale. Never invent keys.
- Fantasy and sci-fi things the game has no model for (dragons, spells, robots): say so in "reply" and stand in for them with what fits (a glowing sign, a sculpture, a wrecked machine).
- Up to ${60} edits in "then". Weather, night and rain: {"do":"set_weather","clear":false}.

Settings: ${Object.entries(SETTINGS).map(([k, s]) => `${k}: ${s.hint}`).join(' ')}
Layouts: ${Object.entries(LAYOUTS).map(([k, l]) => `${k}: ${l.hint}`).join(' ')}
Density: open, normal or packed (how much clutter).
The generator makes a fair, point-symmetric map with spawns, weapons and lights already placed. Red's end is -Z, blue's +Z. The map is about W×W editor units with W = 2×sqrt(players×450) (8 players: 120; lanes is 1.2× longer and 1.2× narrower); keep edits within ±(W/2 - 8). The ground top is y 1. The middle (0,0) already has a centrepiece; to replace it, first {"do":"delete","near":[0,0,16]}.
Use "then" for what the generator can't do: rain or night, a particular centrepiece, landmarks, signs, colours, more of something. Use "mirror": true for anything off-centre on a wizard map.

Edits:
${EDITS.split('\n').filter((l) => /"(add_prefab|add_shape|delete|place_line|place_ring|add_marker|add_light|set_weather|set_modes|paint|rename_map|spread_spawns|add_weapons)"/.test(l)).join('\n')}

${reference(profile, request)}
${profile.tier === 'reasoning' ? '' : `
Example. "a small neon arena for 4" ->
{"reply":"A packed cyber ring arena for 4 players.","map":{"setting":"cyber","layout":"arena","players":4,"density":"packed","name":"Neon Ring"},"then":[]}
`}
Remember: answer with the JSON object only.`
}

/** Added to the last user message for models that drift from the format. */
export const formatReminder = (profile: ModelProfile) => (profile.tier === 'reasoning' ? '' : '\n\n(Answer with the JSON object only.)')

// ---------------- reading replies ----------------

/** The text without a reasoning model's <think>…</think> part (or an unfinished one). */
export const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim()

/** Mends the usual ways a model's JSON goes wrong: comments, trailing commas, smart quotes, raw line breaks in strings, a missing end. */
export function repairJson(text: string): string {
  const s = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  let out = '', inStr = false, esc = false
  const open: string[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      out += c === '\n' ? '\\n' : c
      continue
    }
    if (c === '"') { inStr = true; out += c; continue }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue }
    if (c === '{' || c === '[') open.push(c === '{' ? '}' : ']')
    if (c === '}' || c === ']') {
      out = out.replace(/,\s*$/, '')
      if (open[open.length - 1] === c) open.pop()
    }
    out += c
  }
  if (inStr) out += '"'
  out = out.replace(/,\s*$/, '').replace(/:\s*$/, ': null').replace(/,\s*"[^"]*"\s*$/, '')
  return out + open.reverse().join('')
}

/** The first JSON object in the text, read leniently; null if there is none. */
export function readJsonObject(text: string): Record<string, unknown> | null {
  const t = stripThinking(text)
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)(```|$)/)
  const body = fenced ? fenced[1] : t
  const start = body.indexOf('{')
  if (start < 0) return null
  const end = body.lastIndexOf('}')
  for (const cand of [end > start ? body.slice(start, end + 1) : '', body.slice(start)]) {
    if (!cand) continue
    for (const s of [cand, repairJson(cand)]) {
      try {
        const o = JSON.parse(s)
        if (o && typeof o === 'object' && !Array.isArray(o)) return o
      } catch { /* try the next way */ }
    }
  }
  return null
}

const isAction = (a: unknown): a is AiAction => !!a && typeof a === 'object' && typeof (a as AiAction).do === 'string'
export const actionsOf = (v: unknown): AiAction[] => (Array.isArray(v) ? v.filter(isAction) : [])

/** The model's JSON, even when wrapped in a code fence, after a sentence, or after thinking out loud. */
export function parseReply(text: string): AiReply {
  const o = readJsonObject(text)
  if (o) return { reply: typeof o.reply === 'string' ? o.reply : '', actions: actionsOf(o.actions) }
  return { reply: stripThinking(text), actions: [] }
}

/** What is wrong with an answer that meant to be JSON but can't be used, or null when it is fine. */
export function needsRepair(text: string): string | null {
  const t = stripThinking(text)
  const o = readJsonObject(t)
  if (!o) return /[{[]/.test(t) && /"(reply|actions|do|map|review)"/.test(t) ? 'Your last answer was not valid JSON.' : null
  if (typeof o.reply !== 'string' && !Array.isArray(o.actions) && !o.map && !o.review) return 'Your last answer did not have "reply" and "actions".'
  const bad = [...(Array.isArray(o.actions) ? o.actions : []), ...(Array.isArray(o.then) ? o.then : [])].filter((a) => !isAction(a) || !KNOWN_EDITS.has((a as AiAction).do))
  if (bad.length) return `These edits are not ones the editor knows: ${JSON.stringify(bad).slice(0, 300)}.`
  return null
}

/** The follow-up asking the model to fix its answer. */
export const repairRequest = (problem: string) => `${problem} Send the same answer again as ONE valid JSON object in the format asked for, and nothing else, using only the edits listed.`

/** The "reply" text so far in a half-streamed JSON answer, for showing while it arrives. */
export function partialReply(content: string): string {
  const m = stripThinking(content).match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/)
  if (!m) return ''
  try { return JSON.parse('"' + m[1].replace(/\\$/, '') + '"') } catch { return m[1] }
}

// ---------------- which models there are ----------------

/** Models on NVIDIA's API that can't chat: embeddings, safety guards, reward models, parsers, detectors and the like. */
const NOT_CHAT = /embed|guard|safety|reward|parse|clip|detector|retriever|calibration|deplot|kosmos|translate|diffusion/i

/** The chat models among NVIDIA's ids: suggested ones first, then the other free ones, then the rest, each A to Z. */
export function chatModels(ids: string[]): string[] {
  const chat = [...new Set(ids)].filter((id) => isFree(id) || !NOT_CHAT.test(id)).sort()
  const rank = (m: string) => (SUGGESTED_MODELS.includes(m) ? SUGGESTED_MODELS.indexOf(m) - 100 : isFree(m) ? 0 : 1)
  return chat.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1))
}

const slug = (s: string) => s.toLowerCase().replace(/[._]/g, '-')
/**
 * A model id from what someone pasted: the id itself, or a build.nvidia.com page address
 * (whose spelling differs: z-ai/glm-5-3 for z-ai/glm-5.3), matched against the live list.
 */
export function resolveModelId(input: string, live: string[]): string {
  const t = input.trim().replace(/^https?:\/\/build\.nvidia\.com\//i, '').replace(/[?#].*$/, '').replace(/\/+$/, '')
  if (live.includes(t)) return t
  return live.find((m) => slug(m) === slug(t)) ?? t
}

/** The chat models NVIDIA's API serves right now (the list is public: no key is sent). */
export async function listModels(signal?: AbortSignal): Promise<string[]> {
  const res = await fetch('/api/ai/models', { signal })
  if (!res.ok) throw new Error("Couldn't load NVIDIA's model list.")
  // The relay sends {models: [id]}; the dev server passes NVIDIA's own {data: [{id}]} through.
  const body = (await res.json()) as { models?: string[]; data?: { id: string }[] }
  return chatModels(body.models ?? body.data?.map((m) => m.id) ?? [])
}

// ---------------- talking to the model ----------------

export interface ModelProgress { content: string; reasoning: string }
export interface AskOptions { signal?: AbortSignal; onProgress?: (p: ModelProgress) => void; profile?: ModelProfile }

/** Never let the key into text that is shown or kept. */
const scrub = (s: string, key: string) => (key ? s.split(key).join('nvapi-…') : s)

/**
 * One round trip to the model through the relay, streamed when `onProgress`
 * is given (it sees the answer, and any thinking, as they arrive). Returns
 * the whole answer.
 */
export async function askModel(messages: ChatMessage[], key: string, model: string, opts: AskOptions = {}): Promise<string> {
  try { return await askOnce(messages, key, model, opts) } catch (err) {
    // A busy free endpoint often answers on the second try.
    if (!(err instanceof BusyError) || opts.signal?.aborted) throw err
    return askOnce(messages, key, model, opts)
  }
}

/** NVIDIA gave up waiting for the model to start (its gateway's "Inactivity Timeout"). */
export class BusyError extends Error {}

/** What went wrong, in plain words, from a status and whatever the service said (JSON, or a gateway's web page). */
function failure(status: number, said: string, model: string, key: string): Error {
  let msg: unknown = said
  try { const d = JSON.parse(said); msg = d?.error?.message ?? d?.error ?? d?.detail ?? d?.title ?? d?.errorMessage ?? said } catch { /* not JSON */ }
  const plain = typeof msg === 'string' ? msg.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : ''
  if (status === 401 || status === 403) return new Error('NVIDIA did not accept the key. Check it on build.nvidia.com.')
  if (status === 404) return new Error(`Model "${model}" was not found. Pick another in the chat settings.`)
  if (status === 429) return new Error('Too many requests for the free tier right now. Wait a minute and try again.')
  if (status === 408 || status === 504 || /inactivity timeout|timed out|too much time/i.test(plain)) {
    return new BusyError(`${model} didn't start answering in time: NVIDIA's free endpoint is busy or the model is slow. Try again, or pick a faster model in the AI settings (like ${SUGGESTED_MODELS[0]}).`)
  }
  return new Error(scrub(plain || `The AI service answered ${status}.`, key))
}

async function askOnce(messages: ChatMessage[], key: string, model: string, opts: AskOptions): Promise<string> {
  const profile = opts.profile ?? modelProfile(model)
  // Always streamed: the relay keeps a streamed reply alive while a busy model gets started.
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, temperature: profile.temperature, max_tokens: profile.maxTokens, stream: true }),
    signal: opts.signal,
  })
  if (!res.ok) throw failure(res.status, await res.text(), model, key)
  if (!(res.headers.get('content-type') || '').includes('event-stream') || !res.body) {
    let data: any = null
    try { data = JSON.parse(await res.text()) } catch { /* not JSON */ }
    const msg = data?.choices?.[0]?.message
    if (typeof msg?.content !== 'string' || !msg.content) throw new Error('The AI sent an empty answer.')
    opts.onProgress?.({ content: msg.content, reasoning: typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '' })
    return msg.content
  }
  // Server-sent events: "data: {chunk}" lines, ending with "data: [DONE]".
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = '', content = '', reasoning = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (value) buf += dec.decode(value, { stream: !done })
    const lines = buf.split('\n')
    buf = done ? '' : lines.pop() ?? ''
    let changed = false
    for (const line of lines) {
      const l = line.trim()
      if (!l.startsWith('data:')) continue
      const d = l.slice(5).trim()
      if (d === '[DONE]') continue
      let chunk: any
      try { chunk = JSON.parse(d) } catch { continue }
      if (chunk?.error) throw failure(Number(chunk.error.status) || 500, String(chunk.error.message ?? chunk.error), model, key)
      const delta = chunk?.choices?.[0]?.delta ?? {}
      if (typeof delta.content === 'string') { content += delta.content; changed = true }
      const r = delta.reasoning_content ?? delta.reasoning
      if (typeof r === 'string') { reasoning += r; changed = true }
    }
    if (changed) opts.onProgress?.({ content, reasoning })
    if (done) break
  }
  if (!stripThinking(content)) throw new Error(reasoning || content ? 'The AI thought it over but sent no answer. Try again, or pick a faster model.' : 'The AI sent an empty answer.')
  return content
}

/**
 * Asks, and if the answer can't be used (not JSON, or edits we don't know),
 * asks once more with the problem pointed out. `onRepair` says when that happens.
 */
export async function askWithRepair(messages: ChatMessage[], key: string, model: string, opts: AskOptions & { onRepair?: () => void } = {}): Promise<{ raw: string; repaired: boolean }> {
  const raw = await askModel(messages, key, model, opts)
  const problem = needsRepair(raw)
  if (!problem) return { raw, repaired: false }
  opts.onRepair?.()
  const again = await askModel([...messages, { role: 'assistant', content: stripThinking(raw).slice(0, 4000) }, { role: 'user', content: repairRequest(problem) }], key, model, opts)
  // The second answer is kept unless it is no better.
  return needsRepair(again) && readJsonObject(raw) ? { raw, repaired: false } : { raw: again, repaired: true }
}

