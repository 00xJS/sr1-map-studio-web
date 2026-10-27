// The Check tab's list: what the "Ready to play" checklist, the health check, the stair finder and the
// invisible-wall finder found, in one list ranked worst first. Each line can carry its own fix; the ones that
// need no choices (moving and adding spawns and weapons, ramps, the invisible-wall setting, a sky, removing
// leftover markers) also run together under Fix all, as one undo step.
import type { CheckItem, Fix } from '../lib/checklist'
import type { HealthReport } from '../lib/analysis/types'
import type { SliverReport } from '../lib/invisibleWalls'

/** 0: blocks putting it in the game · 1: players will notice · 2: worth fixing · 3: a tip. */
export type Rank = 0 | 1 | 2 | 3

export type AutoFix =
  | { kind: 'spawns' }
  | { kind: 'ramps' }
  | { kind: 'walls' }
  | { kind: 'sky' }
  | { kind: 'removeMarkers'; types: string[] }

export interface Issue {
  id: string
  rank: Rank
  text: string
  /** The longer explanation, behind "Why?". */
  why?: string
  /** A fix that needs no choices: it has its own button and runs under Fix all. */
  auto?: { fix: AutoFix; label: string }
  /** A fix that takes you somewhere (a tool, the object, a setting). */
  go?: { fix: Fix; label: string }
  /** Shows it on the map. */
  show?: { label: string; what: { spawn: number } | { overlay: 'spawns' | 'moves' } | { place: [number, number, number] } }
}

export const WHY = {
  spawns: "Checks every spawn and weapon on the map's real floor. Any inside something, in the air or somewhere nobody can walk to moves to the nearest spot players can use; then spawns are added (out of sight of most of the map first, spread far apart) and weapons (spread out, off the spawns), up to 12 of each.",
  stairs: "The game's player only steps up about 0.28 m without jumping, so taller steps (often on converted or scaled-up maps) stop you at every one. The fix lays a see-through ramp over each flight: you run up it in game and never see it.",
  walls: 'Paper-thin triangles draw nothing, but in game they act as walls through open air: players rub against nothing and the camera gets pushed. Converted and rescaled maps often have them. The export can leave them out of the collision.',
  camp: "Seen from enemy spawns, pickups or much of the open map: whoever waits there picks players off as they appear. Move it behind cover, or further from where the enemy spawns.",
  textures: "The game loads a map's textures into a fixed pool. The biggest map known to load has about 25 MB; past that the game may load none of them and the map shows black.",
  moves: "From the game's own numbers: a run jump clears about 2.5 m and a sprint jump 6 m; falls over 4 m hurt and 9 m kills; a jump gets you onto about 1.1 m.",
} as const

const AUTO: Partial<Record<Fix['kind'], (f: Fix) => AutoFix>> = {
  autoSpawns: () => ({ kind: 'spawns' }),
  sky: () => ({ kind: 'sky' }),
  removeMarkers: (f) => ({ kind: 'removeMarkers', types: (f as Extract<Fix, { kind: 'removeMarkers' }>).types }),
}

/** One line per finding of the last health check (none when there is no report). */
function healthLines(r: HealthReport): Issue[] {
  const out: Issue[] = []
  r.findings.forEach((f, i) => {
    const id = 'health-' + i
    const spawn = /^Spawn (\d+)[ :]/.exec(f)
    if (spawn) out.push({ id, rank: 1, text: f, why: WHY.camp, show: { label: 'Show', what: { spawn: Number(spawn[1]) } } })
    else if (/more spawns are easy to camp/.test(f)) out.push({ id, rank: 1, text: f, why: WHY.camp, show: { label: 'Show', what: { overlay: 'spawns' } } })
    else if (/can't be used:/.test(f)) out.push({ id, rank: 1, text: f, why: WHY.spawns, auto: { fix: { kind: 'spawns' }, label: 'Move them' } })
    else if (/^Textures come to/.test(f)) out.push({ id, rank: 1, text: f, why: WHY.textures })
    else if (/^Getting around:/.test(f)) out.push({ id, rank: 2, text: f, why: WHY.moves, show: { label: 'Show', what: { overlay: 'moves' } } })
    else if (/^No spawn is easy to camp;/.test(f)) out.push({ id, rank: 3, text: f, show: { label: 'Show', what: { overlay: 'spawns' } } })
    // Good news and what the checklist already says stay out of the list.
    else if (/^(Every spawn is out of sight|No spawns yet|No floor to stand on|Longest sight line: .* within)/.test(f)) return
    else out.push({ id, rank: /hidden from almost everywhere|^Longest/.test(f) ? 3 : 2, text: f })
  })
  return out
}

export interface IssueInput {
  checklist: CheckItem[]
  report: HealthReport | null
  /** Flights too tall to walk up, from the last check. */
  stairs: number
  slivers: SliverReport | null
  /** settings.remove_invisible_walls */
  removeWalls: boolean
}

/** Every open problem, worst first (the checklist's order, then the check's, within a rank). */
export function buildIssues({ checklist, report, stairs, slivers, removeWalls }: IssueInput): Issue[] {
  const out: Issue[] = []
  for (const c of checklist) {
    if (c.state === 'done') continue
    const auto = c.fix && AUTO[c.fix.kind]
    out.push({
      id: 'list-' + c.id, rank: c.state === 'needed' ? 0 : 2, text: c.text,
      ...(c.fix && auto ? { auto: { fix: auto(c.fix), label: c.action || 'Fix' }, why: c.fix.kind === 'autoSpawns' ? WHY.spawns : undefined }
        : c.fix ? { go: { fix: c.fix, label: c.action || 'Show' } } : {}),
    })
  }
  if (report) out.push(...healthLines(report))
  if (stairs) out.push({ id: 'stairs', rank: 1, text: `${stairs} flight${stairs === 1 ? '' : 's'} of stairs or step${stairs === 1 ? '' : 's'} too tall to walk up: players stop at each.`, why: WHY.stairs, auto: { fix: { kind: 'ramps' }, label: 'Add ramps' } })
  if (slivers?.count) {
    const n = `${slivers.count} invisible wall${slivers.count === 1 ? '' : 's'}`
    const show = slivers.places[0] ? { label: 'Show', what: { place: slivers.places[0] } } : undefined
    out.push(removeWalls
      ? { id: 'walls', rank: 3, text: `${n}: left out of the collision at export.`, why: WHY.walls, show }
      : { id: 'walls', rank: 1, text: `${n}: players bump into nothing.`, why: WHY.walls, auto: { fix: { kind: 'walls' }, label: 'Remove at export' }, show })
  }
  return out.map((x, i) => [x, i] as const).sort((a, b) => a[0].rank - b[0].rank || a[1] - b[1]).map(([x]) => x)
}

/** The fixes Fix all runs: each kind once, spawns last (it works on the floor the others leave). */
export function autoFixes(issues: Issue[]): AutoFix[] {
  const seen = new Set<string>()
  const out: AutoFix[] = []
  for (const x of issues) {
    if (!x.auto) continue
    const key = x.auto.fix.kind === 'removeMarkers' ? 'remove:' + x.auto.fix.types.join(',') : x.auto.fix.kind
    if (seen.has(key)) continue
    seen.add(key)
    out.push(x.auto.fix)
  }
  return out.sort((a, b) => Number(a.kind === 'spawns') - Number(b.kind === 'spawns'))
}
