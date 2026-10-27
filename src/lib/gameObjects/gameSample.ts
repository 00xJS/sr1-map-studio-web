// Any map built from the site's own pieces (a catalogue sample, a generated city) remade with the game's: its big
// building blocks become game buildings that fit their plots, its props the game's own of the same kind, the
// setting's area kit dresses it as Stilwater dresses each kind of place (gameDress.ts), its ground, walls and decks
// wear the game's surfaces, and spawns and weapons are placed again round what is there. Floors, stairs, ramps and
// platforms stay as they are, and so does any building players climb onto (its stairs or a marker on its roof), so
// every level of the map can still be reached.
import type { Vec3 } from '../project'
import type { Part, Sample } from '../sampleKit'
import { detailize } from '../sampleDetail'
import { FULL_TARGETS, populate, type PopulateTargets } from '../samplePopulate'
import { over, spreadSample } from '../sampleScale'
import type { WizardSetting } from '../mapWizard'
import { KITS } from './areaKits'
import { gameDress } from './gameDress'
import { withGameSurfaces } from './frame'
import type { GamePieces } from './wizardPieces'

/** Site building blocks a game building may take the place of (the samples' and the generated city's names). */
const BUILDING = /^(Building|House|Warehouse|Shed|Shack|Store|Shop|Mall|Bank|School|Church|Courthouse|Station|Ticket hall|Park office|Office|Apartments?|Tenement|Motel|Garage|Factory|Diner|Bar|Club|Tower|Hotel)$/
/** What players climb by (a building with one of these at its walls is kept: its roof is part of the map). */
const CLIMB = /Stairs|Ramp|Ladder|Catwalk|Bridge|Walkway|Steps/

/** Which wizard setting's game pieces suit a sample, from its theme and words; null where the game has nothing like it. */
export function settingFor(s: Pick<Sample, 'theme' | 'id' | 'name' | 'description'>): WizardSetting | null {
  if (s.theme === 'Cyber') return null
  if (s.theme === 'Urban paintball') return 'paintball'
  if (s.theme === 'Starter') return 'industrial'
  // By what it is called (its description mentions shops and plazas everywhere); whole words only.
  const t = `${s.id.replace(/_/g, ' ')} ${s.name}`.toLowerCase()
  const has = (words: string) => new RegExp(`\\b(${words})\\b`).test(t)
  if (has('downtown|office|chinatown|towers?|main street|mainstreet')) return 'downtown'
  if (has('docks?|harbou?r|pier|port|marina|wharf|quay|canal|river')) return 'docks'
  if (has('construction|scaffolding|site')) return 'construction'
  if (has('military|army|barracks|bunkers?|checkpoint')) return 'military'
  if (has('industrial|factory|factories|warehouses?|trainyard|train|rail|railyard|plant|mill|refinery|depot|terminal|highway')) return 'industrial'
  if (has('slums?|ghetto|rundown|abandoned|trailer|projects|ruins?|junkyard')) return 'rundown'
  if (has('suburbs?|suburban|park|gardens?|houses|cul-de-sac|school|church|golf|neighbou?rhood')) return 'suburbs'
  return 'downtown'
}

export interface GameSampleOptions {
  setting: WizardSetting
  seed: number
  /** The wizard's 0..100 for how much the area kit dresses it. */
  busy?: number
  targets?: PopulateTargets
}

/** The sample remade with game pieces (see the top of this file). */
export function gameSample(base: Sample, pieces: GamePieces, o: GameSampleOptions): Sample {
  const climbs = base.parts.filter((p) => CLIMB.test(p.label))
  const markers = base.markers.map(([, p]) => p)
  // Footprint of a part or a group, square to the axes (units): [x0, z0, x1, z1], its floor and its top.
  const box = (ps: Part[]) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const p of ps) {
      const turned = (p.rot ?? 0) % 180 !== 0
      const [w, d] = turned ? [p.size[2], p.size[0]] : [p.size[0], p.size[2]]
      x0 = Math.min(x0, p.at[0] - w / 2); x1 = Math.max(x1, p.at[0] + w / 2); z0 = Math.min(z0, p.at[2] - d / 2); z1 = Math.max(z1, p.at[2] + d / 2)
      y0 = Math.min(y0, p.at[1]); y1 = Math.max(y1, p.at[1] + p.size[1])
    }
    return { x0, x1, z0, z1, y0, y1 }
  }
  type Box = ReturnType<typeof box>
  // Players climb onto it: stairs or a ramp at its walls, or a marker on its roof.
  const climbed = (b: Box) => climbs.some((q) => { const c = box([q]); return c.x0 <= b.x1 + 1.5 && c.x1 >= b.x0 - 1.5 && c.z0 <= b.z1 + 1.5 && c.z1 >= b.z0 - 1.5 && c.y1 > b.y0 + 1 })
    || markers.some((m) => m[0] >= b.x0 && m[0] <= b.x1 && m[2] >= b.z0 && m[2] <= b.z1 && m[1] >= b.y1 - 1)

  // The building blocks to replace: single boxes, and groups named as a building (a house of several parts).
  const groups = new Map<string, Part[]>()
  for (const p of base.parts) if (p.group) { const g = groups.get(p.group); if (g) g.push(p); else groups.set(p.group, [p]) }
  const plots: { parts: Part[]; b: Box }[] = []
  for (const p of base.parts) {
    if (p.group || p.game || p.kind !== 'box' || !BUILDING.test(p.label) || (p.rot ?? 0) % 90 !== 0) continue
    const b = box([p])
    if (b.y1 - b.y0 >= 6 && Math.min(b.x1 - b.x0, b.z1 - b.z0) >= 8 && !climbed(b)) plots.push({ parts: [p], b })
  }
  for (const [, g] of groups) {
    if (!BUILDING.test(g[0].label) || g.some((p) => p.game)) continue
    const b = box(g)
    if (b.y1 - b.y0 >= 6 && Math.min(b.x1 - b.x0, b.z1 - b.z0) >= 8 && !climbed(b)) plots.push({ parts: g, b })
  }
  const gone = new Set<Part>(), made: Part[] = []
  // In a fixed order (by where each plot stands), so the same map comes out the same each time.
  for (const { parts, b } of plots.sort((a, c) => a.b.z0 - c.b.z0 || a.b.x0 - c.b.x0)) {
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, w = b.x1 - b.x0, d = b.z1 - b.z0
    // Its front toward the middle of the map.
    const front = (Math.round(((Math.atan2(-cx, -cz) * 180) / Math.PI) / 90) * 90 + 360) % 360
    const g = pieces.building(cx, cz, w, d, b.y0, front, Math.hypot(cx, cz) < 0.5 ? 1 : 2, parts)
    if (!g) continue
    parts.forEach((p) => gone.add(p))
    made.push(g)
  }

  const detailed = detailize({ ...base, parts: base.parts.filter((p) => !gone.has(p)) })
  const swapped = pieces.swap({ ...detailed, parts: [...detailed.parts, ...made] })
  const floor = withGameSurfaces(swapped.parts, pieces.frame)
  const dressed = gameDress({ ...swapped, parts: floor }, pieces, KITS[o.setting], o.busy ?? 35, o.seed)
  return populate({ ...dressed, parts: withGameSurfaces(dressed.parts, pieces.frame) }, o.targets ?? FULL_TARGETS, floor)
}

/** A catalogue sample (samples.ts sampleFor's variants: full size, or the small version) built with game pieces. */
export function gameSampleFor(s: Sample, compact: boolean, compactTargets: PopulateTargets, pieces: GamePieces, setting: WizardSetting): Sample {
  const small = (s.size ?? 'compact') === 'compact'
  const base = compact && small ? s : small ? spreadSample(s, 2) : s
  let seed = 0
  for (const ch of s.id) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0
  return gameSample(base, pieces, { setting, seed, targets: compact && small ? compactTargets : FULL_TARGETS })
}

/** Markers that ended up inside something solid (for the tests). */
export const buried = (s: Sample): Vec3[] => s.markers.map(([, p]) => p).filter((p) => s.parts.some((q) => q.at[1] < p[1] + 2 && q.at[1] + q.size[1] > p[1] + 0.5 && !q.water && over(q, p[0], p[2], -0.1)))
