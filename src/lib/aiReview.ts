// What the AI chat makes of two kinds of answer: a critique of the map
// (merged with the facts measured in code, so it still works when the model
// says little or can't be read), and a new map from a sentence (wizard
// options plus edits, with a keyword reading of the sentence as fallback).
import { ALL_PREFABS } from './prefabRegistry'
import { DENSITY, LAYOUTS, SETTINGS, newSeed, wizardSample, wizardSize, type WizardDensity, type WizardLayout, type WizardOptions, type WizardSetting } from './mapWizard'
import { CITY_SIZES, citySample, citySide, type CitySize } from './cityGen'
import type { Sample } from './sampleKit'
import { TOPICS, type FactFix, type MapFacts, type Topic } from './mapFacts'
import { KNOWN_EDITS, actionsOf, readJsonObject, type AiAction } from './aiChat'

// ---------------- critique ----------------

export type Verdict = 'good' | 'ok' | 'bad'
export interface ReviewSection { topic: Topic; title: string; verdict: Verdict; notes: string[]; fixes: FactFix[] }
export interface Review { score: number | null; summary: string; sections: ReviewSection[]; byModel: boolean }

const VERDICTS: Verdict[] = ['good', 'ok', 'bad']

/** The review: what the code measured, with the model's notes and verdicts on top when it gave them. */
export function buildReview(facts: MapFacts, raw?: string): Review {
  const o = raw ? readJsonObject(raw) : null
  const rv = (o?.review && typeof o.review === 'object' ? o.review : {}) as { score?: unknown; sections?: unknown }
  const modelSections = Array.isArray(rv.sections) ? rv.sections.filter((s): s is Record<string, unknown> => !!s && typeof s === 'object') : []
  const sections = (Object.keys(TOPICS) as Topic[]).map((topic): ReviewSection => {
    const found = facts.issues.filter((i) => i.topic === topic)
    const worst: Verdict = found.some((i) => i.severity === 'bad') ? 'bad' : found.some((i) => i.severity === 'warn') ? 'ok' : 'good'
    const m = modelSections.find((s) => typeof s.topic === 'string' && (s.topic.toLowerCase() === topic || TOPICS[topic].toLowerCase().startsWith(s.topic.toLowerCase())))
    let verdict = worst
    // The model may judge, but never call something good that the code found bad.
    if (m && VERDICTS.includes(m.verdict as Verdict) && !(worst === 'bad' && m.verdict === 'good')) verdict = m.verdict as Verdict
    const notes = m && typeof m.notes === 'string' && m.notes.trim() ? [m.notes.trim()] : found.map((i) => i.text)
    const fixes = found.filter((i) => i.fix).map((i) => i.fix!)
    const extra = actionsOf(m?.actions).filter((a) => KNOWN_EDITS.has(a.do) && a.do !== 'generate_map')
    if (extra.length) fixes.push({ label: "Try the AI's fix", actions: extra })
    return { topic, title: TOPICS[topic], verdict, notes, fixes }
  })
  const score = typeof rv.score === 'number' && rv.score >= 1 && rv.score <= 10 ? Math.round(rv.score) : null
  const bad = sections.filter((s) => s.verdict === 'bad').length, ok = sections.filter((s) => s.verdict === 'ok').length
  const summary = typeof o?.reply === 'string' && o.reply.trim() ? o.reply.trim()
    : bad ? `${bad} area${bad === 1 ? ' needs' : 's need'} work${ok ? ` and ${ok} could be better` : ''}. Try the fixes below; undo puts things back.`
      : ok ? `Looks fair. ${ok} area${ok === 1 ? '' : 's'} could be better.` : 'Looks fair and safe on everything checked.'
  return { score, summary, sections, byModel: !!o?.review }
}

/** Does the message ask for a review of the map? */
export const isCritiqueRequest = (msg: string) =>
  /\b(critique|review|assess|evaluate|rate)\b.*\b(map|level|it|this)\b|\b(is|are)\b.*\b(fair|balanced|unfair)\b|\bhow\b.*\b(fair|balanced)\b|^\s*(critique|review)( my map)?\s*[.!?]*$/i.test(msg)

// ---------------- a map from a sentence ----------------

export interface MapPlan {
  options: WizardOptions; then: AiAction[]; reply: string; byModel: boolean
  /** Build a whole city (the city generator, at this size) instead of the wizard's arena. */
  city?: CitySize
}

/** The map a plan builds: the wizard's arena, or the whole city. */
export const planSample = (plan: MapPlan): Sample =>
  plan.city ? citySample({ size: plan.city, seed: plan.options.seed, name: plan.options.name }) : wizardSample(plan.options)

/** Words that ask for a whole town or city rather than an arena. */
const CITY_WORDS = /\b(city|cities|town|metropolis|megacity|districts?|neighbou?rhoods)\b/
const ARENA_WORDS = /\b(arena|1v1|duel|small|tiny|tight|city block|rooftop|park)\b/

const WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 }

/** Wizard options from the words alone: the fallback when the model can't be reached or read. */
export function heuristicPlan(text: string, seed = newSeed()): MapPlan {
  const t = text.toLowerCase()
  const setting: WizardSetting = /cyber|neon|tron|digital|futur|sci-?fi|synth|hologram/.test(t) ? 'cyber'
    : /paintball|turf|inflatable|airsoft/.test(t) ? 'paintball'
      : /ghetto|\bhood\b|slum|projects|abandon|derelict|run-?down|burn(ed|t)|ruin|decay|condemned|skid row|crack ?house|boarded|sketchy|bad side/.test(t) ? 'rundown'
      : /industr|warehouse|factory|dock|harbou?r|\bport\b|container|refinery|shipyard|depot/.test(t) ? 'industrial' : 'downtown'
  const layout: WizardLayout = /tower|roof|high ground|heights|vertical|deck|platform/.test(t) ? 'heights'
    : /arena|ring|circle|colosseum|\bpit\b/.test(t) ? 'arena'
      : /lane|corridor|long/.test(t) ? 'lanes'
        : /plaza|square|courtyard|park|open middle/.test(t) ? 'plaza' : 'blocks'
  const vs = t.match(/(\d+)\s*v(?:s\.?)?\s*(\d+)/)
  const num = t.match(/(\d+)\s*-?\s*(?:players?|people|person)/) ?? t.match(new RegExp(`\\b(${Object.keys(WORDS).join('|')})\\b\\s*-?\\s*(?:players?|people)`))
  const n = vs ? +vs[1] + +vs[2] : num ? (WORDS[num[1]] ?? +num[1]) : 8
  const players = Math.max(2, Math.min(12, n || 8))
  const density: WizardDensity = /packed|dense|busy|clutter|tight|cramped|lots of cover/.test(t) ? 'packed' : /\bopen\b|sparse|empty|minimal/.test(t) && !/open middle/.test(t) ? 'open' : 'normal'
  const then: AiAction[] = []
  const notes: string[] = []
  if (/rain|storm|weather|night|dark|fog|dusk|dawn/.test(t)) { then.push({ do: 'set_weather', clear: false }); notes.push('weather and time of day that change each match') }
  if (/(central|centre|center|middle)\W+(\w+\W+){0,3}tower|tower\W+(\w+\W+){0,3}(middle|centre|center)/.test(t) && ALL_PREFABS.koth) {
    then.push({ do: 'delete', near: [0, 0, 16] }, { do: 'add_prefab', key: 'koth', x: 0, z: 0 })
    notes.push('a tower in the middle')
  }
  const options: WizardOptions = { setting, layout, players, density, seed, name: `${SETTINGS[setting].label} ${LAYOUTS[layout].label}` }
  if (CITY_WORDS.test(t) && !ARENA_WORDS.test(t)) {
    const city: CitySize = /\b(huge|massive|sprawling|enormous|giant|megacity|metropolis)\b/.test(t) ? 'big' : /\b(town|village)\b/.test(t) ? 'town' : 'city'
    return { options: { ...options, name: 'New ' + CITY_SIZES[city].label }, then: clampToMap(then, options, city), city, byModel: false, reply: `A whole ${CITY_SIZES[city].label.toLowerCase()}: districts, a river, a freeway and streets to fight through${notes.length ? ', with ' + notes.join(' and ') : ''}.` }
  }
  return { options, then, byModel: false, reply: `${LAYOUTS[layout].label} in a ${SETTINGS[setting].label.toLowerCase()} setting for ${players} players${notes.length ? ', with ' + notes.join(' and ') : ''}.` }
}

const pickKey = <T extends string>(v: unknown, keys: T[], fallback: T): T => {
  const s = typeof v === 'string' ? v.toLowerCase().trim() : ''
  return keys.find((k) => k === s) ?? keys.find((k) => s.length > 2 && (k.startsWith(s) || s.startsWith(k))) ?? fallback
}

/** Wizard options from the model's answer, with gaps filled from the words; edits kept inside the new map. */
/** The most extra edits a plan may carry (a rich description can ask for a lot). */
const MAX_THEN = 60

export function planFromModel(raw: string, text: string, seed = newSeed()): MapPlan {
  const base = heuristicPlan(text, seed)
  const o = readJsonObject(raw)
  const m = (o?.map ?? o?.wizard) as Record<string, unknown> | undefined
  if (!o || !m || typeof m !== 'object') return base
  const options: WizardOptions = {
    setting: pickKey(m.setting, Object.keys(SETTINGS) as WizardSetting[], base.options.setting),
    layout: pickKey(m.layout, Object.keys(LAYOUTS) as WizardLayout[], base.options.layout),
    players: typeof m.players === 'number' && Number.isFinite(m.players) ? Math.max(2, Math.min(12, Math.round(m.players))) : base.options.players,
    density: pickKey(m.density, Object.keys(DENSITY) as WizardDensity[], base.options.density),
    seed,
    name: typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 40) : base.options.name,
  }
  const sizes = Object.keys(CITY_SIZES) as CitySize[]
  const city = m.generator === 'city' ? pickKey(m.size, sizes, 'city') : undefined
  const then = clampToMap(actionsOf(o.then ?? o.actions).filter((a) => KNOWN_EDITS.has(a.do) && a.do !== 'generate_map').slice(0, MAX_THEN), options, city)
  return { options, then, byModel: true, reply: typeof o.reply === 'string' && o.reply.trim() ? o.reply.trim() : base.reply, ...(city ? { city } : {}) }
}

/** The plan a chat's generate_map edit asks for. */
export function planFromAction(a: Extract<AiAction, { do: 'generate_map' }>, reply = ''): MapPlan {
  const seed = typeof a.seed === 'number' && Number.isInteger(a.seed) && a.seed > 0 ? a.seed : newSeed()
  return planFromModel(JSON.stringify({ reply, map: a, then: Array.isArray(a.then) ? a.then : [] }), '', seed)
}

const at = (a: { x?: unknown; z?: unknown }) => (typeof a.x === 'number' && typeof a.z === 'number' ? ` at (${Math.round(a.x)}, ${Math.round(a.z)})` : '')
const both = (a: { mirror?: boolean }) => (a.mirror ? ', both sides' : '')

/** An edit in a few plain words, to list what will happen. */
export function describeEdit(a: AiAction): string {
  switch (a.do) {
    case 'set_weather': return a.clear === false ? 'Weather and time of day change each match (rain, night)' : 'Always clear weather'
    case 'add_prefab': return `Add ${ALL_PREFABS[a.key]?.label ?? a.key}${at(a)}${both(a)}`
    case 'add_shape': return `Add a ${a.shape}${at(a)}${both(a)}`
    case 'add_marker': return `Add ${a.type === 'Weapon pickup' ? (a.weapon ?? 'a weapon') : a.type.toLowerCase()}${at(a)}${both(a)}`
    case 'add_light': return `Add a light${at(a)}${both(a)}`
    case 'delete': return a.near ? `Clear the area round (${Math.round(a.near[0])}, ${Math.round(a.near[1])})` : a.name ? `Remove "${a.name}"` : 'Remove some objects'
    case 'paint': return `Paint ${a.name ? `"${a.name}"` : a.prefab ?? a.shape ?? 'objects'} with ${a.texture}`
    case 'place_line': return `A line of ${a.count} ${(a.item as { key?: string; shape?: string; type?: string })?.key ?? (a.item as { shape?: string })?.shape ?? 'things'}${both(a)}`
    case 'place_ring': return `A ring of ${a.count} ${(a.item as { key?: string })?.key ?? (a.item as { shape?: string })?.shape ?? 'things'}`
    case 'set_modes': return `Game modes: ${(a.modes ?? []).join(', ')}`
    case 'spread_spawns': return `Spread out the ${a.which === 'team' ? 'team spawns' : a.which === 'all' ? 'spawns' : 'free-for-all spawns'}${a.count ? ` (${a.count}${a.which === 'team' ? ' per team' : ''})` : ''}`
    case 'add_weapons': return `Add weapons: ${(a.weapons ?? []).join(', ')}${a.where && a.where !== 'spread' ? ` (${a.where})` : ''}`
    default: return a.do.replace(/_/g, ' ')
  }
}

/** Keeps placed things inside the generated map's walls. */
export function clampToMap(actions: AiAction[], o: Pick<WizardOptions, 'players' | 'layout'>, city?: CitySize): AiAction[] {
  const [W, D] = city ? [citySide(city), citySide(city)] : wizardSize(o.players, o.layout)
  const cx = (v: unknown) => (typeof v === 'number' ? Math.max(-W / 2 + 6, Math.min(W / 2 - 6, v)) : v)
  const cz = (v: unknown) => (typeof v === 'number' ? Math.max(-D / 2 + 6, Math.min(D / 2 - 6, v)) : v)
  return actions.map((a) => {
    const b = { ...a } as Record<string, unknown>
    if ('x' in b) b.x = cx(b.x)
    if ('z' in b) b.z = cz(b.z)
    for (const k of ['from', 'to', 'center']) if (Array.isArray(b[k])) b[k] = [cx((b[k] as number[])[0]), cz((b[k] as number[])[1])]
    if (typeof b.radius === 'number') b.radius = Math.min(b.radius, Math.min(W, D) / 2 - 6)
    return b as unknown as AiAction
  })
}
