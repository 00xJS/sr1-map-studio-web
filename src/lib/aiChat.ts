// AI chat about the open map: a plain-text summary of the map for the model,
// the list of edits it may ask for, and a forgiving reader for its replies.
// The model is any chat model on NVIDIA's API (build.nvidia.com), called with
// the user's own key through /api/ai.
import type { Project, Vec3 } from './project'
import { ALL_PREFABS } from './prefabRegistry'
import { SHAPE_PRESETS } from './shapes'
import { catalogs } from './catalogs'
import { GAME_MODES } from './project'

export const DEFAULT_MODEL = 'meta/llama-3.3-70b-instruct'
export const SUGGESTED_MODELS = ['meta/llama-3.3-70b-instruct', 'nvidia/nemotron-3-super-120b-a12b', 'moonshotai/kimi-k2.6']
export const KEY_STORE = 'sr1ms.nvidiaKey'
export const MODEL_STORE = 'sr1ms.nvidiaModel'

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export type AiAction =
  | { do: 'add_prefab'; key: string; x: number; z: number; turn?: number; settings?: Record<string, number | string>; mirror?: boolean }
  | { do: 'add_shape'; shape: string; x: number; z: number; turn?: number; size?: [number, number, number]; mirror?: boolean }
  | { do: 'move'; index: number; x?: number; y?: number; z?: number; dx?: number; dy?: number; dz?: number }
  | { do: 'turn'; index: number; degrees: number }
  | { do: 'scale'; index: number; factor: number }
  | { do: 'delete'; indices: number[] }
  | { do: 'duplicate'; index: number; dx?: number; dz?: number }
  | { do: 'prefab_settings'; index: number; settings: Record<string, number | string> }
  | { do: 'add_marker'; type: string; x: number; z: number; weapon?: string; mirror?: boolean }
  | { do: 'delete_markers'; type?: string; near?: [number, number, number] }
  | { do: 'add_light'; x: number; y: number; z: number; color?: Vec3; mirror?: boolean }
  | { do: 'set_modes'; modes: string[] }
  | { do: 'rename_map'; name: string }
  | { do: 'select'; indices: number[] }

export interface AiReply { reply: string; actions: AiAction[] }

const r1 = (v: number) => Math.round(v * 10) / 10

/** What the model knows about the map, kept compact. `bounds` gives an object's box when the 3D view has it. */
export function describeMap(p: Project, bounds?: (index: number) => [Vec3, Vec3] | null): string {
  const lines: string[] = []
  const s = p.settings
  lines.push(`Map "${s.display_name || 'Untitled'}". Units: 1 unit = ${s.world_scale || 0.5} m in game; y is up; the main ground top is usually y 1.`)
  lines.push(`Red team's end is -Z, blue's is +Z. Fair maps are point-symmetric: whatever is at (x, z) has a twin at (-x, -z) turned 180°.`)
  lines.push(`Game modes on: ${s.modes.join(', ') || 'none'}.`)
  let lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  const objs = p.scene_items.map((it, i) => {
    const b = bounds?.(i)
    if (b) { lo = lo.map((v, k) => Math.min(v, b[0][k])) as Vec3; hi = hi.map((v, k) => Math.max(v, b[1][k])) as Vec3 }
    const size = b ? ` size ${r1(b[1][0] - b[0][0])}×${r1(b[1][1] - b[0][1])}×${r1(b[1][2] - b[0][2])}` : it.shape ? ` size ${it.shape.size.map((v) => r1(v * it.scale)).join('×')}` : ''
    const pf = it.prefab ? ` [prefab ${it.prefab.key}${Object.keys(it.prefab.params).length ? ' ' + JSON.stringify(it.prefab.params) : ''}]` : ''
    const turn = it.rotation[1] ? ` turn ${r1(it.rotation[1])}` : ''
    const grp = it.group ? ` group ${it.group.slice(0, 8)}` : ''
    return `${i}: ${it.name}${pf} at ${it.position.map(r1).join(',')}${size}${turn}${grp}`
  })
  if (Number.isFinite(lo[0])) lines.push(`Map extent: x ${r1(lo[0])}..${r1(hi[0])}, z ${r1(lo[2])}..${r1(hi[2])}, height ${r1(lo[1])}..${r1(hi[1])}.`)
  lines.push(`Objects (${objs.length}; index: name at x,y,z):`)
  lines.push(...(objs.length > 400 ? [...objs.slice(0, 400), `…and ${objs.length - 400} more`] : objs))
  const byType = new Map<string, Vec3[]>()
  for (const m of p.markers) byType.set(m.type, [...(byType.get(m.type) ?? []), m.position])
  lines.push(`Markers:`)
  for (const [t, ps] of byType) lines.push(`${t} ×${ps.length}: ${ps.slice(0, 40).map((q) => `(${r1(q[0])},${r1(q[1])},${r1(q[2])})`).join(' ')}${ps.length > 40 ? ' …' : ''}`)
  lines.push(`Lights: ${p.lights.length} (max ${catalogs.limits.max_lights}).`)
  return lines.join('\n')
}

function reference(): string {
  const prefabs = Object.entries(ALL_PREFABS).map(([k, d]) => {
    const ps = (d.params ?? []).map((pd) => `${pd.key}${pd.options ? '=' + pd.options.map(([v]) => v).join('|') : pd.min !== undefined ? ` ${pd.min}-${pd.max}` : ''}`).join(',')
    return `${k} (${d.label}${ps ? '; settings ' + ps : ''})`
  })
  return [
    `Prefab keys: ${prefabs.join('; ')}.`,
    `Shapes: ${Object.keys(SHAPE_PRESETS).join(', ')}.`,
    `Marker types: ${catalogs.marker_types.join(', ')}.`,
    `Weapon ids: ${catalogs.weapons.map(([, id]) => id).join(', ')}.`,
    `Game modes: ${GAME_MODES.join(', ')}.`,
  ].join('\n')
}

export function systemPrompt(map: string): string {
  return `You help someone build a Saints Row 1 multiplayer map in a web editor. You can talk about the map and change it.

Always answer with ONE JSON object and nothing else:
{"reply": "short, friendly, plain-language answer", "actions": [ ...edits, or [] ... ]}

Edits you can make (numbers are editor units; objects drop onto the surface below x,z):
{"do":"add_prefab","key":"bench","x":10,"z":-20,"turn":90,"settings":{},"mirror":true}
{"do":"add_shape","shape":"wall","x":0,"z":-30,"turn":0,"size":[12,6,1],"mirror":true}
{"do":"move","index":3,"x":10,"z":-4}   or relative: {"do":"move","index":3,"dx":2,"dy":0,"dz":0}
{"do":"turn","index":3,"degrees":90}
{"do":"scale","index":3,"factor":1.5}
{"do":"delete","indices":[3,4]}
{"do":"duplicate","index":3,"dx":10,"dz":0}
{"do":"prefab_settings","index":3,"settings":{"h":30}}
{"do":"add_marker","type":"Shared spawn","x":0,"z":-20,"mirror":true}   (weapons: "type":"Weapon pickup","weapon":"<id>")
{"do":"delete_markers","type":"Weapon pickup","near":[x,z,radius]}   (both fields optional)
{"do":"add_light","x":0,"y":8,"z":0,"color":[1,0.8,0.6],"mirror":true}
{"do":"set_modes","modes":["Gangsta Brawl"]}
{"do":"rename_map","name":"Harbor Rumble"}
{"do":"select","indices":[3,4]}   (to point things out)

Rules:
- "mirror": true also places the twin at (-x,-z) turned 180°, and a red team spawn's twin is a blue team spawn. Use it for anything off-centre so both teams get the same map.
- Object indices are the ones listed below. Deletes happen after everything else in the same reply.
- Keep spawns and weapons on open floor, not inside objects. Put team spawns at their own end (red -Z, blue +Z).
- For questions, answer in "reply" with "actions": []. Never invent prefab keys, shapes, marker types or weapon ids.
- If a request is unclear, ask in "reply" instead of guessing.

${reference()}

The map now:
${map}`
}

/** The model's JSON, even when wrapped in a code fence or a sentence. */
export function parseReply(text: string): AiReply {
  const t = text.trim()
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : t
  const start = body.indexOf('{'), end = body.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const o = JSON.parse(body.slice(start, end + 1))
      return { reply: typeof o.reply === 'string' ? o.reply : '', actions: Array.isArray(o.actions) ? o.actions.filter((a: unknown) => a && typeof a === 'object' && typeof (a as AiAction).do === 'string') : [] }
    } catch { /* not JSON after all */ }
  }
  return { reply: t, actions: [] }
}

/** One round trip to the model through the relay. */
export async function askModel(messages: ChatMessage[], key: string, model: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 2048 }),
    signal,
  })
  const text = await res.text()
  let data: any = null
  try { data = JSON.parse(text) } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = data?.error?.message ?? data?.error ?? data?.detail ?? data?.title ?? text.slice(0, 200)
    if (res.status === 401 || res.status === 403) throw new Error('NVIDIA did not accept the key. Check it on build.nvidia.com.')
    if (res.status === 404) throw new Error(`Model "${model}" was not found. Pick another in the chat settings.`)
    if (res.status === 429) throw new Error('Too many requests for the free tier right now. Wait a minute and try again.')
    throw new Error(typeof msg === 'string' && msg ? msg : `The AI service answered ${res.status}.`)
  }
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('The AI sent an empty answer.')
  return content
}
