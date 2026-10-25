// The Stilwater study: how the city is put together, read from the player's own city chunks while the library is
// built, so the map wizard can build the way the city does (cityModules.ts has the shapes).
//
//   - Each chunk (studyChunk, run by the indexer): where every model stands; for each building, its own parts
//     that lead up (steps, fire escapes, ladders); for each piece of ground, which squares of it are road,
//     sidewalk, grass, dirt or water (a small top-down map in its own frame, kept once per model).
//   - The whole city (studyCity, run when the chunks are merged; neighbouring chunks share their edges, so the
//     city is looked at as one):
//       groups: things placed together again and again in the same arrangement, found by counting, for every
//         prop, which other props stand at the same spot and turn around it, then keeping the set that most of
//         its placements have whole;
//       modules: each building cut out with what stands on it and around it up to the kerb, the middle of the
//         alley or the next building, its edges and the gaps players pass through, and how its roof is reached.
// The results ride on the library entries (GameObjectEntry.groups, .modules): never stored in the repository.
// Game frame throughout (metres, the game's handedness); turns about +Y as the indexer measures them.
import { meshTriangles, type Chunk } from './chunk'
import { buildingKind, identify, parseBuildingCode, type GameIdentity } from './identity'
import type { Candidate, GameObjectEntry, Placement, Vec3 } from './indexer'
import type { CityGroup, CityModule, EdgeKind, GroupKind, ModuleEdge, ModuleKind, ModulePart, PartLayer, Side } from './cityModules'
import type { WizardSetting } from '../mapWizard'

// ---------------- what a chunk hands over ----------------

/** How players get up a building: its own steps, fire escapes and ladders, where (feet, building frame) and how high they reach. */
export interface Climb { kind: 'stairs' | 'fire escape' | 'ladder'; at: Vec3; top: number }

/**
 * A building placement's own parts that lead up (named ones, and flights of steps found in its geometry), and its
 * decks: the heights over its feet where it has flat ground to stand on (walkways, terraces, roofs), with their
 * area in m².
 */
export interface Site { climbs: Climb[]; decks: { y: number; area: number }[] }

/**
 * Which squares of a piece of ground (in its own, cut-out frame: feet centre at the origin) are what: `rows` has
 * w x d letters, one per `cell`-metre square from (x0, z0): r road, w sidewalk or paving, g grass, d dirt, a water,
 * l rail, o other ground, '.' none. `lo` and `hi`: its walkable faces' heights over its feet.
 */
export interface Cover { cell: number; x0: number; z0: number; w: number; d: number; rows: string; lo: number; hi: number }

/** One placement in a city chunk. `ext` is its size across x and z in its own (cut-out) frame; `yaw` radians. */
export interface Spot { id: string; at: Vec3; yaw: number; ext: [number, number]; h: number; chunk: number; site?: Site }

/** One city chunk. */
export interface ChunkSpots { pack: string; chunk: string; districts: string[] }

/** Everything the study reads: the chunks, every placement in them, and each ground model's cover. */
export interface CityData { chunks: ChunkSpots[]; spots: Spot[]; covers: Map<string, Cover> }

export const SIDES: Side[] = ['+x', '-x', '+z', '-z']
/** Lines across each side of a building, and samples along each line (one a metre, from half a metre out). */
export const LINES = 5, STEPS = 14

/** The chunks the study reads: Stilwater's own (not the multiplayer maps, not the far stand-ins). */
export const isStudyChunk = (pack: string, chunk: string) => pack === 'sr_city_stream' && /^sr_chunk/i.test(chunk) && !/_al$/i.test(chunk)
/** The chunks groups and modules come from: the city's streets (not the shop interiors and hideouts streamed in separately). */
export const isStreetChunk = (chunk: string) => /^sr_chunk\d+b?$/i.test(chunk)

const r2 = (v: number) => Math.round(v * 100) / 100

// ---------------- reading a chunk ----------------

/** What a ground surface is, from its picture's name (see the Cover letters). */
export function surfaceLetter(tex: string): string {
  const t = tex.toLowerCase()
  if (/water|ocean|river|lake|(^|_)sea_|wave/.test(t)) return 'a'
  if (/(^|_)rail|track/.test(t)) return 'l'
  if (/grass|lawn|turf|field|hedge|leaf|foliage|ivy|plant/.test(t)) return 'g'
  if (/dirt|sand|gravel|mud|soil|beach|rock/.test(t)) return 'd'
  if (/road|asphalt|street|_rd|rd_|hwy|highway|lane|tarmac|crosswalk|parking|pkg|alley/.test(t)) return 'r'
  if (/sidewalk|sidewlk|curb|kerb|pave|walk|plaza|conc|cement|tile|brick|stone|^ter_/.test(t)) return 'w'
  return 'o'
}

/** Building part names that lead up. */
const CLIMB: [RegExp, Climb['kind']][] = [[/f_?esc|escape|firestair/, 'fire escape'], [/ladder/, 'ladder'], [/stair|steps|stoop|porch/, 'stairs']]

/** Where world offset d stands in the frame of something turned `yaw` (the frame its cut-out has). */
export const local = (d: ArrayLike<number>, yaw: number): Vec3 => { const c = Math.cos(yaw), s = Math.sin(yaw); return [d[0] * c + d[2] * s, d[1], -d[0] * s + d[2] * c] }
/** Back to the world. */
export const world = (o: ArrayLike<number>, yaw: number): Vec3 => { const c = Math.cos(yaw), s = Math.sin(yaw); return [o[0] * c - o[2] * s, o[1], o[0] * s + o[2] * c] }

/** The squares of a piece of ground, from its placement `p` (which the indexer read from `ch`). */
function coverOf(ch: Chunk, p: Placement, letterOf: (material: number) => string): Cover | null {
  const ext = p.ext
  const cell = Math.max(1, Math.ceil(Math.sqrt((ext[0] + 1) * (ext[1] + 1) / 6000)))
  const x0 = -ext[0] / 2 - 0.5, z0 = -ext[1] / 2 - 0.5
  const w = Math.ceil((ext[0] + 1) / cell), d = Math.ceil((ext[1] + 1) / cell)
  const grid = new Array<string>(w * d).fill('.')
  const top = new Float32Array(w * d).fill(-Infinity)
  let lo = Infinity, hi = -Infinity
  for (const ii of p.inst) {
    const inst = ch.instances[ii]
    if (!inst) continue
    let m
    try { m = meshTriangles(ch, inst.mesh) } catch { continue }
    const R = inst.rotation, P = inst.position
    const v = [0, 0, 0, 0, 0, 0, 0, 0, 0]
    for (let t = 0; t < m.triangles.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const j = 3 * m.triangles[t + k], x = m.positions[j], y = m.positions[j + 1], z = m.positions[j + 2]
        const wv = [P[0] + x * R[0] + y * R[3] + z * R[6] - p.at[0], P[1] + x * R[1] + y * R[4] + z * R[7] - p.at[1], P[2] + x * R[2] + y * R[5] + z * R[8] - p.at[2]]
        const o = local(wv, p.yaw)
        v[3 * k] = o[0]; v[3 * k + 1] = o[1]; v[3 * k + 2] = o[2]
      }
      // Only what can be walked on: the flat-ish faces.
      const ex = v[3] - v[0], ey = v[4] - v[1], ez = v[5] - v[2], fx = v[6] - v[0], fy = v[7] - v[1], fz = v[8] - v[2]
      const nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx
      if (Math.abs(ny) < 0.6 * Math.hypot(nx, ny, nz)) continue
      const letter = letterOf(m.triMaterial[t / 3])
      const xs = [v[0], v[3], v[6]], zs = [v[2], v[5], v[8]]
      const area = (xs[1] - xs[0]) * (zs[2] - zs[0]) - (xs[2] - xs[0]) * (zs[1] - zs[0])
      if (Math.abs(area) < 1e-6) continue
      lo = Math.min(lo, v[1], v[4], v[7]); hi = Math.max(hi, v[1], v[4], v[7])
      const i0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / cell)), i1 = Math.min(w - 1, Math.floor((Math.max(...xs) - x0) / cell))
      const j0 = Math.max(0, Math.floor((Math.min(...zs) - z0) / cell)), j1 = Math.min(d - 1, Math.floor((Math.max(...zs) - z0) / cell))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * cell, pz = z0 + (j + 0.5) * cell
        const w1 = ((px - xs[0]) * (zs[2] - zs[0]) - (xs[2] - xs[0]) * (pz - zs[0])) / area
        const w2 = ((xs[1] - xs[0]) * (pz - zs[0]) - (px - xs[0]) * (zs[1] - zs[0])) / area
        const w0 = 1 - w1 - w2
        // (Half a square of slack: thin strips of kerb still mark the squares they cross.)
        const slack = -0.5 * cell / Math.max(1, Math.sqrt(Math.abs(area)))
        if (w0 < slack || w1 < slack || w2 < slack) continue
        const y = w0 * v[1] + w1 * v[4] + w2 * v[7], c = j * w + i
        if (y > top[c]) { top[c] = y; grid[c] = letter }
      }
    }
  }
  if (lo > hi) return null
  return { cell, x0: r2(x0), z0: r2(z0), w, d, rows: grid.join(''), lo: r2(lo), hi: r2(hi) }
}

/**
 * The study's reading of one city chunk (the indexer calls it with every placement it found): each candidate's
 * placements (Candidate.spots, four numbers each: x, y, z, turn) and its size across in its own frame
 * (Candidate.foot); for buildings, each placement's site (Candidate.sites); for ground, its cover (Candidate.cover).
 */
export function studyChunk(ch: Chunk, places: Placement[], out: Map<string, Candidate>) {
  const ids = new Map<string, GameIdentity>()
  const idOf = (key: string) => { let r = ids.get(key); if (!r) ids.set(key, (r = identify(out.get(key)!))); return r }
  const ground = (key: string) => { const id = idOf(key); return id.role === 'ground' || id.name === 'Water' }
  const tex = ch.materials.map((m) => m.textures.find((t) => !/\.tgn$/i.test(t)) ?? '')
  const recName = new Map<number, string>()
  for (const r of ch.records) recName.set(r.instance, r.name.toLowerCase())
  for (const p of places) {
    const id = idOf(p.key)
    if (id.role === 'skip' && id.name !== 'Water') continue
    const c = out.get(p.key)!
    ;(c.spots ??= []).push(r2(p.at[0]), r2(p.at[1]), r2(p.at[2]), Math.round(p.yaw * 1000) / 1000)
    c.foot ??= [r2(p.ext[0]), r2(p.ext[1])]
    if (ground(p.key) && c.cover === undefined) {
      const water = id.name === 'Water'
      c.cover = coverOf(ch, p, (mi) => (water ? 'a' : surfaceLetter(tex[mi] ?? ''))) ?? undefined
    }
    if (id.role !== 'building' || buildingKind(c) !== 'whole') continue
    // A building's own parts say what leads up: "bsad1a_escapeb04", "bsad2a_steps06".
    const climbs: Climb[] = []
    for (const ii of p.inst) {
      const name = recName.get(ii)?.replace(/^.*?\d[a-z]_/, '') ?? ''
      const kind = CLIMB.find(([re]) => re.test(name))?.[1]
      const inst = ch.instances[ii], m = inst && ch.meshes[inst.mesh]
      if (!kind || !m) continue
      // (The mesh's own box: good enough for where it stands and how high it reaches.)
      const lo = inst.position[1] + Math.min(m.min[1], m.max[1]), hi = inst.position[1] + Math.max(m.min[1], m.max[1])
      climbs.push({ kind, at: [r2(inst.position[0] - p.at[0]), r2(lo - p.at[1]), r2(inst.position[2] - p.at[2])], top: r2(hi - p.at[1]) })
    }
    ;(c.sites ??= []).push({ climbs: [...climbs, ...flights(ch, p)], decks: decksOf(ch, p) })
  }
}

/** The world corners of each triangle of a placement's instances, three at a time. */
function* worldTriangles(ch: Chunk, p: Placement): Generator<number[]> {
  for (const ii of p.inst) {
    const inst = ch.instances[ii]
    if (!inst) continue
    let m
    try { m = meshTriangles(ch, inst.mesh) } catch { continue }
    const R = inst.rotation, P = inst.position
    for (let t = 0; t < m.triangles.length; t += 3) {
      const v: number[] = []
      for (let k = 0; k < 3; k++) {
        const j = 3 * m.triangles[t + k], x = m.positions[j], y = m.positions[j + 1], z = m.positions[j + 2]
        v.push(P[0] + x * R[0] + y * R[3] + z * R[6], P[1] + x * R[1] + y * R[4] + z * R[7], P[2] + x * R[2] + y * R[5] + z * R[8])
      }
      yield v
    }
  }
}

/** An up-facing triangle's area seen from above (0 when it isn't flat enough to stand on). */
function flatArea(v: number[]): number {
  const ex = v[3] - v[0], ey = v[4] - v[1], ez = v[5] - v[2], fx = v[6] - v[0], fy = v[7] - v[1], fz = v[8] - v[2]
  const nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx
  const l = Math.hypot(nx, ny, nz)
  return l && Math.abs(ny) / l > 0.95 ? l / 2 : 0
}

/** Height bands (metres) for decks, and the least flat area that makes one. */
const DECK_BAND = 0.5, DECK_AREA = 20

/** A triangle's shortest side seen from above. */
const narrowest = (v: number[]) => Math.min(Math.hypot(v[3] - v[0], v[5] - v[2]), Math.hypot(v[6] - v[3], v[8] - v[5]), Math.hypot(v[0] - v[6], v[2] - v[8]))

/** A building's decks: flat area by height over its feet, in DECK_BAND bands, the bands of at least DECK_AREA m². */
function decksOf(ch: Chunk, p: Placement): Site['decks'] {
  const bands = new Map<number, number>()
  for (const v of worldTriangles(ch, p)) {
    const a = flatArea(v)
    // (Narrow faces are steps, sills and trim, not floor.)
    if (!a || narrowest(v) < 0.6) continue
    const y = (v[1] + v[4] + v[7]) / 3 - p.at[1]
    const k = Math.round(y / DECK_BAND)
    bands.set(k, (bands.get(k) ?? 0) + a)
  }
  // Neighbouring bands are one deck (a slab's top sits on a band's edge).
  const out: Site['decks'] = []
  for (const [k, a] of [...bands].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1]
    if (last && Math.abs(k * DECK_BAND - last.y) <= 1.01) { if (a > last.area) last.y = k * DECK_BAND; last.area += a; continue }
    out.push({ y: k * DECK_BAND, area: a })
  }
  return out.filter((d) => d.area >= DECK_AREA).map((d) => ({ y: r2(d.y), area: Math.round(d.area) }))
}

/**
 * Flights of steps in a building's geometry: small flat faces (a step's tread) each 0.1-0.4 m above the last and
 * within 0.8 m of it, at least 8 in a row and rising 1.5 m or more. Found longest first.
 */
function flights(ch: Chunk, p: Placement): Climb[] {
  const treads: { x: number; y: number; z: number }[] = []
  const seen = new Set<string>()
  for (const v of worldTriangles(ch, p)) {
    const a = flatArea(v)
    if (!a || a > 1.5) continue
    // (A tread is narrow one way: its triangle's shortest side short.)
    if (narrowest(v) > 0.5) continue
    const x = (v[0] + v[3] + v[6]) / 3, y = (v[1] + v[4] + v[7]) / 3, z = (v[2] + v[5] + v[8]) / 3
    const k = `${Math.round(x / 0.4)},${Math.round(y / 0.05)},${Math.round(z / 0.4)}`
    if (seen.has(k)) continue
    seen.add(k)
    treads.push({ x, y, z })
    if (treads.length > 4000) break
  }
  treads.sort((a, b) => a.y - b.y)
  const out: Climb[] = []
  const used = new Uint8Array(treads.length)
  for (let round = 0; round < 16; round++) {
    // Longest rising chain over the treads not yet used.
    const len = new Int32Array(treads.length), from = new Int32Array(treads.length).fill(-1)
    let best = -1
    for (let i = 0; i < treads.length; i++) {
      if (used[i]) continue
      len[i] = 1
      for (let j = i - 1; j >= 0 && treads[i].y - treads[j].y <= 0.4; j--) {
        if (used[j] || treads[i].y - treads[j].y < 0.1) continue
        if (Math.hypot(treads[i].x - treads[j].x, treads[i].z - treads[j].z) > 0.8) continue
        if (len[j] + 1 > len[i]) { len[i] = len[j] + 1; from[i] = j }
      }
      if (best < 0 || len[i] > len[best]) best = i
    }
    if (best < 0 || len[best] < 8) break
    let i = best, first = best
    while (i >= 0) { used[i] = 1; first = i; i = from[i] }
    const lo = treads[first], hi = treads[best]
    if (hi.y - lo.y < 1.5) continue
    out.push({ kind: 'stairs', at: [r2(lo.x - p.at[0]), r2(lo.y - p.at[1]), r2(lo.z - p.at[2])], top: r2(hi.y - p.at[1]) })
  }
  return out
}

// ---------------- the whole city ----------------

/** The city as the study reads it, from the merged candidates (the indexer gathers them). */
export function cityData(all: Iterable<Candidate>): CityData {
  const chunks: ChunkSpots[] = [], index = new Map<string, number>()
  const spots: Spot[] = [], covers = new Map<string, Cover>()
  for (const c of all) {
    if (c.cover && !covers.has(c.id)) covers.set(c.id, c.cover)
    if (!c.spots?.length) continue
    const k = c.pack + '/' + c.chunk
    let ci = index.get(k)
    if (ci === undefined) { index.set(k, (ci = chunks.length)); chunks.push({ pack: c.pack, chunk: c.chunk, districts: c.districts ?? [] }) }
    const foot: [number, number] = c.foot ?? [c.size[0], c.size[1]], h = c.size[2]
    for (let i = 0, n = 0; i + 3 < c.spots.length; i += 4, n++) {
      const s: Spot = { id: c.id, at: [c.spots[i], c.spots[i + 1], c.spots[i + 2]], yaw: c.spots[i + 3], ext: foot, h, chunk: ci }
      const site = c.sites?.[n]
      if (site) s.site = site
      spots.push(s)
    }
  }
  return { chunks, spots, covers }
}

/** Fills GameObjectEntry.groups (on each group's anchor) and .modules (on each building cut out) from the city. */
export function studyCity(entries: GameObjectEntry[], data: CityData) {
  for (const e of entries) { delete e.groups; delete e.modules }
  const byId = new Map(entries.map((e) => [e.id, e]))
  const city = new City(entries, data)
  for (const g of findGroups(city)) {
    const list = (byId.get(g.anchorId)!.groups ??= [])
    if (list.length) g.group.id += '-' + (list.length + 1)
    list.push(g.group)
  }
  for (const m of cutModules(city)) { const b = byId.get(m.parts.find((p) => p.layer === 'shell')!.id)!; (b.modules ??= []).push(m) }
}

const wrap = (t: number) => { t %= 2 * Math.PI; if (t > Math.PI) t -= 2 * Math.PI; if (t <= -Math.PI) t += 2 * Math.PI; return t }
const deg = (t: number) => { const d = Math.round((t * 180) / Math.PI); return d <= -180 ? d + 360 : d }

/** A grid over spots, for finding what stands near a point. Spots go in every square their reach touches. */
class Grid {
  cells = new Map<string, number[]>()
  constructor(public cell: number) {}
  add(i: number, x: number, z: number, r = 0) {
    const c = this.cell
    for (let a = Math.floor((x - r) / c); a <= Math.floor((x + r) / c); a++) for (let b = Math.floor((z - r) / c); b <= Math.floor((z + r) / c); b++) {
      const k = a + ',' + b
      const l = this.cells.get(k)
      if (l) l.push(i); else this.cells.set(k, [i])
    }
  }
  /** Every spot in the squares within `r` of (x, z) (some more than once when they were added with a reach). */
  near(x: number, z: number, r: number, cb: (i: number) => void) {
    const c = this.cell
    for (let a = Math.floor((x - r) / c); a <= Math.floor((x + r) / c); a++) for (let b = Math.floor((z - r) / c); b <= Math.floor((z + r) / c); b++) for (const i of this.cells.get(a + ',' + b) ?? []) cb(i)
  }
}

/** The settings each district suits (identity.ts has the same table for buildings). */
const DISTRICT_SETTINGS: Record<string, WizardSetting[]> = {
  Downtown: ['downtown'], 'High end': ['downtown'], Museum: ['downtown'], Chinatown: ['downtown'], Mall: ['downtown'],
  'Red Light': ['downtown', 'rundown'], "Saint's Row": ['rundown'], Projects: ['rundown'], Barrio: ['rundown'], Suburbs: ['suburbs'],
  Factories: ['industrial'], Docks: ['docks', 'industrial'], 'Truck yard': ['industrial'], Airport: ['industrial'],
}

/** The city's streets as one: every placement from the street chunks (once, where chunks repeat one), what each is, the buildings and the ground. */
export class City {
  byId: Map<string, GameObjectEntry>
  spots: Spot[]
  chunks: ChunkSpots[]
  buildings: Spot[]
  private ids = new Map<string, GameIdentity>()
  private all: Grid
  private walls: Grid
  private ground: Grid
  private groundSpots: Spot[]
  private covers: Map<string, Cover>
  constructor(entries: GameObjectEntry[], data: CityData) {
    this.byId = new Map(entries.map((e) => [e.id, e]))
    this.chunks = data.chunks
    this.covers = data.covers
    const seen = new Set<string>()
    this.spots = data.spots.filter((s) => {
      const e = this.byId.get(s.id)
      if (!e || e.copyOf || !isStreetChunk(data.chunks[s.chunk].chunk)) return false
      // Neighbouring chunks share some of their edges: one placement each.
      const k = `${s.id}|${Math.round(s.at[0] * 5)},${Math.round(s.at[1] * 5)},${Math.round(s.at[2] * 5)}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    this.buildings = this.spots.filter((s) => s.site && this.role(s) === 'building' && buildingKind(this.entry(s)) === 'whole')
    this.all = new Grid(16)
    this.spots.forEach((s, i) => this.all.add(i, s.at[0], s.at[2]))
    this.walls = new Grid(32)
    this.buildings.forEach((b, i) => this.walls.add(i, b.at[0], b.at[2], Math.hypot(b.ext[0], b.ext[1]) / 2))
    this.ground = new Grid(32)
    this.groundSpots = this.spots.filter((s) => this.covers.has(s.id))
    this.groundSpots.forEach((g, i) => this.ground.add(i, g.at[0], g.at[2], Math.hypot(g.ext[0], g.ext[1]) / 2 + 1))
  }
  entry(s: Spot) { return this.byId.get(s.id)! }
  id(s: Spot | GameObjectEntry): GameIdentity { const e = 'ext' in s ? this.entry(s) : s; let v = this.ids.get(e.id); if (!v) this.ids.set(e.id, (v = identify(e))); return v }
  role(s: Spot) { return this.id(s).role }
  /** Every street placement within r (metres across) of (x, z). */
  near(x: number, z: number, r: number): Spot[] {
    const out: Spot[] = []
    const seen = new Set<number>()
    this.all.near(x, z, r, (i) => { if (seen.has(i)) return; seen.add(i); const s = this.spots[i]; if (Math.hypot(s.at[0] - x, s.at[2] - z) <= r) out.push(s) })
    return out
  }
  /** The building whose footprint holds (x, z) at height y (other than `not`), if any. */
  buildingAt(x: number, z: number, y: number, not?: Spot, pad = 0): Spot | null {
    let hit: Spot | null = null
    this.walls.near(x, z, 0, (i) => {
      const b = this.buildings[i]
      if (hit || b === not || Math.abs(x - b.at[0]) > b.ext[0] / 2 + pad || Math.abs(z - b.at[2]) > b.ext[1] / 2 + pad || y < b.at[1] - 2 || y > b.at[1] + b.h) return
      hit = b
    })
    return hit
  }
  buildingsNear(x: number, z: number, r: number): Spot[] {
    const out = new Set<Spot>()
    this.walls.near(x, z, r, (i) => out.add(this.buildings[i]))
    return [...out]
  }
  /** What the ground is at (x, z) nearest to height y (within 3 m below, 2 m above), as a Cover letter ('-' for none). */
  groundAt(x: number, z: number, y: number): string {
    let best = '-', d = Infinity
    this.ground.near(x, z, 0, (i) => {
      const g = this.groundSpots[i], c = this.covers.get(g.id)!
      const o = local([x - g.at[0], 0, z - g.at[2]], g.yaw)
      const ci = Math.floor((o[0] - c.x0) / c.cell), cj = Math.floor((o[2] - c.z0) / c.cell)
      if (ci < 0 || cj < 0 || ci >= c.w || cj >= c.d) return
      const letter = c.rows[cj * c.w + ci]
      if (letter === '.') return
      const top = g.at[1] + c.hi, bottom = g.at[1] + c.lo
      if (top < y - 3 || bottom > y + 2) return
      const dist = Math.abs(Math.min(top, Math.max(bottom, y)) - y)
      if (dist < d || (dist === d && letter !== 'o')) { d = dist; best = letter }
    })
    return best
  }
  district(s: Spot): string { return this.chunks[s.chunk].districts[0] ?? '' }
}

// ---------------- groups ----------------

/** Companions further than this from the anchor (metres across, metres up) are not in its group; nearer than SELF, they are part of it. */
const GROUP_R = 6, GROUP_UP = 2.5, SELF = 0.4
/** Offsets and turns are first counted in squares this big (metres) and steps this wide (radians). */
const BIN = 0.5, TURN = Math.PI / 6
/** A companion is at the same spot again when within this (metres, radians) of where it usually is. */
const SAME_AT = 0.7, SAME_TURN = 0.45
/** A group must be whole at this share of its anchor's placements, and at least this many times. */
const WHOLE = 0.3, MIN_SEEN = 3
const MAX_MEMBERS = 10
/** Loose groups: whole at this share of the anchor's placements, and near it this many times more often than near any prop. */
const LOOSE = 0.25, LIFT = 4

export interface FoundGroup { anchorId: string; group: CityGroup }

/**
 * The city's recurring groups. For each prop (the anchor), every other prop within GROUP_R is counted at its
 * offset and turn in the anchor's frame; offsets where the same companion stands again and again are kept; then,
 * going back over the anchor's placements, the set of companions found whole at the most of them (at least WHOLE
 * of them, MIN_SEEN times) is its group. The same arrangement found from two of its members is kept once.
 */
export function findGroups(city: City): FoundGroup[] {
  const { byId } = city
  // Props placed on their own: never-drawn copies, building parts and the parts of assembled things left out.
  const pool = city.spots.filter((s) => { const e = city.entry(s); return !e.partOf && city.role(s) === 'prop' && Math.max(...e.size) >= 0.25 })
  const near = new Grid(GROUP_R)
  pool.forEach((s, i) => near.add(i, s.at[0], s.at[2]))
  const around = (a: Spot, i: number, cb: (b: Spot, o: Vec3, t: number) => void) => near.near(a.at[0], a.at[2], GROUP_R, (j) => {
    if (j === i) return
    const b = pool[j]
    const d = [b.at[0] - a.at[0], b.at[1] - a.at[1], b.at[2] - a.at[2]]
    const across = Math.hypot(d[0], d[2])
    if (across > GROUP_R || across < SELF || Math.abs(d[1]) > GROUP_UP) return
    cb(b, local(d, a.yaw), wrap(b.yaw - a.yaw))
  })
  // 1. Counting: anchor -> companion|offset bin|turn bin -> [n, sum x, y, z, turn].
  const counts = new Map<string, Map<string, number[]>>()
  const placed = new Map<string, number>()
  pool.forEach((a, i) => {
    placed.set(a.id, (placed.get(a.id) ?? 0) + 1)
    const mine = counts.get(a.id) ?? counts.set(a.id, new Map()).get(a.id)!
    const seen = new Set<string>()
    around(a, i, (b, o, t) => {
      const bin = `${b.id}|${Math.round(o[0] / BIN)},${Math.round(o[2] / BIN)}|${Math.round(t / TURN)}`
      if (seen.has(bin)) return
      seen.add(bin)
      const v = mine.get(bin) ?? mine.set(bin, [0, 0, 0, 0, 0]).get(bin)!
      v[0]++; v[1] += o[0]; v[2] += o[1]; v[3] += o[2]; v[4] += t
    })
  })
  // 2. Where each companion usually stands: the strongest bins, a bin next to one already kept being the same spot.
  interface Usual { id: string; at: Vec3; t: number }
  const usual = new Map<string, Usual[]>()
  for (const [a, m] of counts) {
    const n = placed.get(a)!
    if (n < MIN_SEEN || Math.max(...byId.get(a)!.size) < 0.5) continue
    const centres: Usual[] = []
    for (const [bin, v] of [...m.entries()].sort((x, y) => y[1][0] - x[1][0])) {
      if (v[0] < Math.max(MIN_SEEN, WHOLE * n * 0.6) || centres.length >= 24) break
      const id = bin.slice(0, bin.indexOf('|'))
      const at: Vec3 = [v[1] / v[0], v[2] / v[0], v[3] / v[0]], t = v[4] / v[0]
      if (centres.some((c) => c.id === id && Math.hypot(c.at[0] - at[0], c.at[2] - at[2]) < SAME_AT * 1.5 && Math.abs(wrap(c.t - t)) < SAME_TURN)) continue
      centres.push({ id, at, t })
    }
    if (centres.length) usual.set(a, centres)
  }
  // 3. Back over each anchor's placements: which of its usual companions are there.
  const rows = new Map<string, { i: number; has: boolean[] }[]>()
  pool.forEach((a, i) => {
    const cs = usual.get(a.id)
    if (!cs) return
    const has = cs.map(() => false)
    around(a, i, (b, o, t) => cs.forEach((c, k) => {
      if (!has[k] && c.id === b.id && Math.hypot(o[0] - c.at[0], o[2] - c.at[2]) <= SAME_AT && Math.abs(o[1] - c.at[1]) <= 0.6 && Math.abs(wrap(t - c.t)) <= SAME_TURN) has[k] = true
    }))
    ;(rows.get(a.id) ?? rows.set(a.id, []).get(a.id)!).push({ i, has })
  })
  // 4. Each anchor's group: companions added most-found first while the group stays whole often enough.
  const found: (FoundGroup & { members: string[] })[] = []
  for (const [a, cs] of usual) {
    const all = rows.get(a)!
    const need = Math.max(MIN_SEEN, Math.ceil(WHOLE * all.length))
    let keep = all
    const take: number[] = []
    const order = cs.map((_, k) => [k, all.filter((r) => r.has[k]).length] as const).sort((x, y) => y[1] - x[1])
    for (const [k] of order) {
      if (take.length >= MAX_MEMBERS - 1) break
      // (Two companions at one spot are one thing: keep the first.)
      if (take.some((t) => Math.hypot(cs[t].at[0] - cs[k].at[0], cs[t].at[2] - cs[k].at[2]) < SELF && Math.abs(cs[t].at[1] - cs[k].at[1]) < SELF)) continue
      const next = keep.filter((r) => r.has[k])
      // (Each companion after the first must keep most of the group's placements: a rare extra is left out.)
      if (next.length < need || (take.length && next.length < keep.length * 0.6)) continue
      take.push(k); keep = next
    }
    if (!take.length) continue
    const group = makeGroup(city, a, take.map((k) => cs[k]), keep.map((r) => pool[r.i]))
    found.push({ anchorId: a, group, members: [a, ...take.map((k) => cs[k].id)].sort() })
  }
  // 5. Things that stand together though not at one spot (a bus stop's sign at one end or the other): the same
  // companions within GROUP_R of the anchor at LOOSE of its placements, far more often than they stand near any
  // prop (LIFT); the arrangement is the most compact real example's.
  const loose: (FoundGroup & { members: string[] })[] = []
  const nearby = new Map<string, { i: number; ids: Map<string, Spot[]> }[]>()
  const anywhere = new Map<string, number>()
  pool.forEach((a, i) => {
    const ids = new Map<string, Spot[]>()
    around(a, i, (b) => { if (b.id === a.id) return; const l = ids.get(b.id); if (l) l.push(b); else ids.set(b.id, [b]) })
    for (const id of ids.keys()) anywhere.set(id, (anywhere.get(id) ?? 0) + 1)
    if ((placed.get(a.id) ?? 0) >= MIN_SEEN && Math.max(...byId.get(a.id)!.size) >= 0.8) (nearby.get(a.id) ?? nearby.set(a.id, []).get(a.id)!).push({ i, ids })
  })
  for (const [a, list] of nearby) {
    const need = Math.max(MIN_SEEN, Math.ceil(LOOSE * list.length))
    const freq = new Map<string, number>()
    for (const r of list) for (const id of r.ids.keys()) freq.set(id, (freq.get(id) ?? 0) + 1)
    let keep = list
    const take: string[] = []
    for (const [id, f] of [...freq].sort((x, y) => y[1] - x[1])) {
      if (f < need || take.length >= MAX_MEMBERS - 1) break
      if (f / list.length < LIFT * (anywhere.get(id)! / pool.length)) continue
      const next = keep.filter((r) => r.ids.has(id))
      if (next.length < need || (take.length && next.length < keep.length * 0.6)) continue
      take.push(id); keep = next
    }
    if (!take.length) continue
    // The example: the one whose companions stand at the most usual distances, none of them inside another.
    const pick = keep.map((r) => {
      const s = pool[r.i]
      const ms = take.map((id) => r.ids.get(id)!.reduce((p, q) => (Math.hypot(q.at[0] - s.at[0], q.at[2] - s.at[2]) < Math.hypot(p.at[0] - s.at[0], p.at[2] - s.at[2]) ? q : p)))
      return { s, ms, d: ms.map((m) => Math.hypot(m.at[0] - s.at[0], m.at[2] - s.at[2])) }
    })
    const usualD = take.map((_, k) => { const ds = pick.map((x) => x.d[k]).sort((p, q) => p - q); return ds[Math.floor(ds.length / 2)] })
    const inside = (all: Spot[]) => all.some((p, i) => all.some((q, j) => j > i && Math.hypot(p.at[0] - q.at[0], p.at[2] - q.at[2]) < 0.35 * (Math.min(...city.entry(p).size.slice(0, 2)) + Math.min(...city.entry(q).size.slice(0, 2))) && Math.abs(p.at[1] - q.at[1]) < 0.5 * Math.min(p.h, q.h)))
    let best = pick[0], cost = Infinity
    for (const x of pick) {
      const c = x.d.reduce((sum, d, k) => sum + Math.abs(d - usualD[k]), 0) + (inside([x.s, ...x.ms]) ? 100 : 0)
      if (c < cost) { cost = c; best = x }
    }
    const members = best.ms.map((m) => ({ id: m.id, at: local([m.at[0] - best.s.at[0], m.at[1] - best.s.at[1], m.at[2] - best.s.at[2]], best.s.yaw), t: wrap(m.yaw - best.s.yaw) }))
    const group = makeGroup(city, a, members, keep.map((r) => pool[r.i]))
    group.arrangement = 'varies'
    loose.push({ anchorId: a, group, members: [a, ...take].sort() })
  }
  // 6. One arrangement found from several of its members is kept once: the biggest, then the one seen most; a
  // loose group only when no fixed one already has its members.
  const within = (a: string[], b: string[]) => { const m = new Map<string, number>(); for (const x of b) m.set(x, (m.get(x) ?? 0) + 1); return a.every((x) => { const k = m.get(x) ?? 0; if (!k) return false; m.set(x, k - 1); return true }) }
  const order = (l: typeof found) => l.sort((x, y) => y.members.length - x.members.length || y.group.seen - x.group.seen)
  const kept: typeof found = []
  for (const f of order(found)) if (!kept.some((k) => within(f.members, k.members) && k.group.seen >= f.group.seen * 0.5)) kept.push(f)
  const fixed = kept.length
  for (const f of order(loose)) if (!kept.some((k, i) => within(f.members, k.members) && (i < fixed || k.group.seen >= f.group.seen * 0.5))) kept.push(f)
  // The same things in a slightly different arrangement (a row of three or of five): the two seen most.
  const named = new Map<string, number>()
  const names = (f: (typeof found)[number]) => f.members.map((m) => city.id(byId.get(m)!).name).sort().join('|')
  return kept.sort((x, y) => y.group.seen - x.group.seen).filter((f) => { const k = names(f), n = named.get(k) ?? 0; named.set(k, n + 1); return n < 2 }).sort((x, y) => y.group.seen - x.group.seen || y.group.parts.length - x.group.parts.length).map(({ anchorId, group }) => ({ anchorId, group }))
}

/** What a group is for, from its members. */
function groupKind(ids: GameIdentity[]): GroupKind {
  const names = ids.map((i) => i.name), kinds = ids.map((i) => i.kind)
  const has = (re: RegExp) => names.some((n) => re.test(n))
  if (has(/^Parking (block|meter)$/)) return 'parking'
  if (has(/^(Dumpster|Trash bags|Trash)$/)) return 'alley'
  if (has(/^(Bus stop|Bench|Mailbox|Newspaper box|Payphone|Fire hydrant|Street lamp|Traffic light|Trash can|Street sign|Bike rack|Bollard)$/)) return 'street'
  if (has(/^(Shipping container|Pallet|Barrel|Crate|Forklift|Cable spool|Gas cylinder|Tank|Lumber|Semi trailer|Pump|Generator|Machine|Substation equipment|Boxcar|Rail car)$/)) return 'industrial'
  if (has(/^(Sign|Neon sign|Marquee|Umbrella|Vending machine|Poster)$/)) return 'shop front'
  if (kinds.every((k) => k === 'nature' || k === 'furniture' || k === 'street') && has(/^(Tree|Bush|Picnic table|Planter|Playground swing|Chair|Table)$/)) return 'yard'
  if (kinds.filter((k) => k === 'cover').length * 2 >= ids.length) return 'cover'
  if (kinds.every((k) => k === 'clutter' || k === 'furniture' || k === 'machine')) return 'decor'
  return 'other'
}

const plural = (n: string) => (/s$/.test(n) ? n : /(x|ch|sh)$/.test(n) ? n + 'es' : n + 's')

/** A plain name for a group from its members' names. */
function groupName(names: string[], stacked: boolean): string {
  const anchor = names[0]
  if (names.every((n) => n === anchor)) return `${stacked ? 'Stack' : names.length === 2 ? 'Pair' : 'Row'} of ${plural(anchor).toLowerCase()}`
  const lead = names.find((n) => /^(Bus stop|Pump|Dumpster|Picnic table|Bench|Shipping container|Vending machine|Payphone|Wrecked car|Semi trailer)$/.test(n)) ?? anchor
  const count = names.filter((n) => n === lead).length
  const rest = [...new Set(names.filter((n) => n !== lead))].map((n) => { const k = names.filter((x) => x === n).length; return (k > 1 ? `${k} ${plural(n)}` : n).toLowerCase() })
  const list = rest.length <= 2 ? rest.join(' and ') : rest.slice(0, -1).join(', ') + ' and ' + rest[rest.length - 1]
  const head = count > 1 ? `${count} ${plural(lead).toLowerCase()}` : lead
  return `${head[0].toUpperCase()}${head.slice(1)} with ${list}`
}

function makeGroup(city: City, a: string, members: { id: string; at: Vec3; t: number }[], rows: Spot[]): CityGroup {
  const { byId } = city
  // Parts in the anchor's frame, then the frame moved to the middle of the group's footprint.
  const raw = [{ id: a, at: [0, 0, 0] as Vec3, t: 0 }, ...members]
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (const p of raw) {
    const e = byId.get(p.id)!, c = Math.abs(Math.cos(p.t)), s = Math.abs(Math.sin(p.t))
    // (Its size across as cut out: x is its long side.)
    const hx = (e.size[0] * c + e.size[1] * s) / 2, hz = (e.size[0] * s + e.size[1] * c) / 2
    x0 = Math.min(x0, p.at[0] - hx); x1 = Math.max(x1, p.at[0] + hx); z0 = Math.min(z0, p.at[2] - hz); z1 = Math.max(z1, p.at[2] + hz)
  }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
  const y0 = Math.min(...raw.map((p) => p.at[1]))
  const parts: ModulePart[] = raw.map((p) => ({ id: p.id, at: [r2(p.at[0] - cx), r2(p.at[1] - y0), r2(p.at[2] - cz)], yaw: deg(p.t), layer: 'prop' as PartLayer }))
  // Where it stands: against a building's wall (and which of its sides backs onto it), on a roof, or on open ground.
  let wall = 0, roof = 0
  const backs = new Map<Side, number>()
  for (const s of rows) {
    const centre = world([cx, 0, cz], s.yaw).map((v, k) => v + s.at[k])
    let best: { d: number; dir: [number, number] } | null = null
    let onRoof = false
    for (const b of city.buildingsNear(centre[0], centre[2], 8)) {
      const hx = b.ext[0] / 2, hz = b.ext[1] / 2, dx = centre[0] - b.at[0], dz = centre[2] - b.at[2]
      const inside = Math.abs(dx) <= hx && Math.abs(dz) <= hz
      if (inside && s.at[1] > b.at[1] + 2.5 && s.at[1] <= b.at[1] + b.h + 1) { onRoof = true; break }
      if (s.at[1] > b.at[1] + 2.5 || s.at[1] < b.at[1] - 2) continue
      // The nearest point of the footprint's outline: how far, and which way.
      let d: number, dir: [number, number]
      if (inside) { const ex = hx - Math.abs(dx), ez = hz - Math.abs(dz); d = Math.min(ex, ez); dir = ex < ez ? [Math.sign(dx), 0] : [0, Math.sign(dz)] }
      else {
        const qx = Math.max(-hx, Math.min(hx, dx)), qz = Math.max(-hz, Math.min(hz, dz))
        d = Math.hypot(dx - qx, dz - qz); const l = d || 1; dir = [(qx - dx) / l, (qz - dz) / l]
      }
      if (!best || d < best.d) best = { d, dir }
    }
    if (onRoof) { roof++; continue }
    if (!best) continue
    const o = local([best.dir[0], 0, best.dir[1]], s.yaw)
    const side: Side = Math.abs(o[0]) >= Math.abs(o[2]) ? (o[0] > 0 ? '+x' : '-x') : (o[2] > 0 ? '+z' : '-z')
    // Backing onto it: the group's own edge on that side within a metre of the wall.
    const half = side === '+x' || side === '-x' ? (x1 - x0) / 2 : (z1 - z0) / 2
    if (best.d <= half + 1) { wall++; backs.set(side, (backs.get(side) ?? 0) + 1) }
  }
  const back = [...backs].sort((p, q) => q[1] - p[1])[0]
  const anchor: CityGroup['anchor'] = roof >= rows.length * 0.5 ? 'roof' : wall >= rows.length * 0.5 && back && back[1] >= rows.length * 0.4 ? 'wall' : 'ground'
  const ids = raw.map((p) => city.id(byId.get(p.id)!))
  const settings = new Set<WizardSetting>()
  for (const i of ids) for (const s of i.settings) settings.add(s)
  // Seen in one or two districts only: their settings too.
  const districts = new Set(rows.map((s) => city.district(s)).filter(Boolean))
  if (districts.size && districts.size <= 2) for (const d of districts) for (const s of DISTRICT_SETTINGS[d] ?? []) settings.add(s)
  // A few to look at, from as many chunks as there are.
  const examples: CityGroup['examples'] = []
  for (const pass of [0, 1]) for (const s of rows) {
    if (examples.length >= 4) break
    const c = city.chunks[s.chunk]
    if (pass === 0 ? examples.some((x) => x.chunk === c.chunk) : examples.some((x) => x.at[0] === r2(s.at[0]) && x.at[2] === r2(s.at[2]))) continue
    examples.push({ pack: c.pack, chunk: c.chunk, at: [r2(s.at[0]), r2(s.at[1]), r2(s.at[2])] })
  }
  return {
    id: 'g' + a, name: groupName(ids.map((i) => i.name), parts.some((p) => p.at[1] > 0.5 && parts.some((q) => q !== p && q.at[1] < p.at[1] - 0.4 && Math.hypot(q.at[0] - p.at[0], q.at[2] - p.at[2]) < 1))), kind: groupKind(ids), settings: [...settings], anchor,
    ...(anchor === 'wall' ? { back: back![0] } : {}), size: [r2(x1 - x0), r2(z1 - z0)], parts, seen: rows.length, examples,
  }
}

// ---------------- modules ----------------

/** How far past a building a module reaches when nothing stops it sooner (metres). */
const REACH = 8
/** Another building this close to a side (metres) makes that side a shared wall; this close, an alley. */
const WALL_GAP = 2, ALLEY_GAP = 12
/** Taller or bigger than this (metres, m²), or one of these, a building is a landmark rather than a block. */
const LANDMARK_HEIGHT = 45, LANDMARK_AREA = 3000
const LANDMARK_TYPES = /church|museum|arena|mall|hotel|cinema|terminal|hangar|hospital|police|civic|control tower|cargo ship/
/** A climb's foot this close (metres, up or down) to somewhere players stand is reached from there. */
const CLIMB_ON = 1
/**
 * The city's fire escapes start a storey up (their lowest landing about 4.3 m over the street, the drop ladder
 * not modelled): one whose lowest landing is this low (metres) counts as reaching its levels, by 'fire escape'
 * (something to climb onto under it makes it reachable in a new map).
 */
const FIRE_ESCAPE_FOOT = 5
/** Modules kept per building (its best cut-outs). */
const PER_BUILDING = 2

/**
 * What one side of a building meets, from the ground read outward from it (LINES lines of STEPS letters, a metre
 * apart; 'b' another building), and how far past the wall the module reaches on that side.
 */
export function readSide(lines: string): { kind: EdgeKind; reach: number } {
  const per: string[] = []
  for (let l = 0; l < LINES; l++) per.push(lines.slice(l * STEPS, (l + 1) * STEPS))
  // Each line: what it meets past the sidewalk, and how far that is.
  const ends = per.map((s) => {
    let k = 0
    while (k < s.length && (s[k] === 'w' || s[k] === 'o')) k++
    return { k, hit: s[k] ?? 'w' }
  })
  const vote = new Map<string, number>()
  for (const e of ends) vote.set(e.hit, (vote.get(e.hit) ?? 0) + 1)
  const top = [...vote].sort((a, b) => b[1] - a[1])[0][0]
  const at = ends.filter((e) => e.hit === top).map((e) => e.k).sort((a, b) => a - b)
  const k = at[Math.floor(at.length / 2)]
  switch (top) {
    case 'b': {
      if (k < WALL_GAP) return { kind: 'wall', reach: k / 2 }
      // A road between the two buildings is a street, not an alley.
      const road = per.some((s) => s.slice(0, s.indexOf('b') < 0 ? s.length : s.indexOf('b')).includes('r'))
      return road ? { kind: 'street', reach: Math.min(per.map((s) => s.indexOf('r')).filter((x) => x >= 0).sort((a, b) => a - b)[0] ?? k / 2, REACH) } : { kind: 'alley', reach: Math.min(k / 2, ALLEY_GAP / 2) }
    }
    case 'r': return { kind: 'street', reach: Math.min(k, REACH) }
    case 'a': return { kind: 'water', reach: Math.min(k, REACH) }
    case 'g': case 'd': return { kind: 'yard', reach: Math.min(Math.max(k, 4), REACH) }
    case 'l': return { kind: 'open', reach: Math.min(k, REACH) }
    case '-': return k >= 3 ? { kind: 'sidewalk', reach: Math.min(k, REACH) } : { kind: 'open', reach: Math.min(Math.max(k, 1), REACH) }
    default: return { kind: 'sidewalk', reach: REACH }
  }
}

/** The ground around a building: one string per side (+x, -x, +z, -z) of LINES x STEPS letters (see readSide). */
export function groundAround(city: City, b: Spot): string[] {
  return SIDES.map((s) => {
    const ox = s === '+x' ? 1 : s === '-x' ? -1 : 0, oz = s === '+z' ? 1 : s === '-z' ? -1 : 0
    const along = ox ? b.ext[1] : b.ext[0]
    let line = ''
    for (let l = 0; l < LINES; l++) {
      const u = ((l + 0.5) / LINES - 0.5) * along
      const ex = b.at[0] + (ox ? (ox * b.ext[0]) / 2 : u), ez = b.at[2] + (oz ? (oz * b.ext[1]) / 2 : u)
      for (let k = 0; k < STEPS; k++) {
        const x = ex + ox * (k + 0.5), z = ez + oz * (k + 0.5)
        line += city.buildingAt(x, z, b.at[1] + 0.5, b) ? 'b' : city.groundAt(x, z, b.at[1])
      }
    }
    return line
  })
}

/**
 * Each building of the city's streets cut out as a module: the building, what stands on it (its kit, its
 * details), and what stands around it out to the kerb, the middle of the alley or the next building. Its edges
 * say what each side meets, its openings where players can pass, its levels how the roof is reached. Each
 * building keeps its best PER_BUILDING cut-outs (the most of its own layout there, then the most around it).
 */
export function cutModules(city: City): CityModule[] {
  const by = new Map<string, { m: CityModule; score: number }[]>()
  for (const b of city.buildings) {
    const x = cutOne(city, b)
    if (x) (by.get(b.id) ?? by.set(b.id, []).get(b.id)!).push(x)
  }
  const out: CityModule[] = []
  for (const [id, list] of by) {
    list.sort((p, q) => q.score - p.score)
    list.slice(0, PER_BUILDING).forEach((x, k) => { x.m.id = `m${id}${k ? '-' + (k + 1) : ''}`; out.push(x.m) })
  }
  return out.sort((a, b) => a.district.localeCompare(b.district) || a.name.localeCompare(b.name))
}

/** The family of a building ("bsad2a" for "bsad2a_hull"): what its kit pieces name. */
const familyOf = (e: GameObjectEntry) => e.name.toLowerCase().replace(/_hull\d*$/, '')

/** Prop kinds that hang on a wall when they stand against one. */
const WALL_KINDS = new Set(['sign', 'light', 'machine'])

export function cutOne(city: City, b: Spot): { m: CityModule; score: number } | null {
  const be = city.entry(b), bid = city.id(be)
  if (!bid.building) return null
  const hx = b.ext[0] / 2, hz = b.ext[1] / 2, base = b.at[1]
  // Each side: what it meets, and how far the module reaches past the wall.
  const ground = groundAround(city, b)
  const sides = SIDES.map((s, k) => ({ side: s, ...readSide(ground[k]) }))
  const reach = (s: Side) => sides.find((x) => x.side === s)!.reach
  const rect = [b.at[0] - hx - reach('-x'), b.at[2] - hz - reach('-z'), b.at[0] + hx + reach('+x'), b.at[2] + hz + reach('+z')]
  const cx = (rect[0] + rect[2]) / 2, cz = (rect[1] + rect[3]) / 2
  const W = rect[2] - rect[0], D = rect[3] - rect[1]
  const inRect = (x: number, z: number, pad = 0) => x >= rect[0] - pad && x <= rect[2] + pad && z >= rect[1] - pad && z <= rect[3] + pad
  const onThis = (s: Spot, pad: number) => Math.abs(s.at[0] - b.at[0]) <= hx + pad && Math.abs(s.at[2] - b.at[2]) <= hz + pad && s.at[1] >= base - 1 && s.at[1] <= base + b.h + 1
  const fam = familyOf(be)
  const parts: ModulePart[] = [{ id: b.id, at: [r2(b.at[0] - cx), 0, r2(b.at[2] - cz)], yaw: 0, layer: 'shell' }]
  const climbs: Climb[] = [...(b.site?.climbs ?? [])]
  const fences: Spot[] = [], blockers: Spot[] = []
  let tris = be.tris, props = 0
  for (const s of city.near(cx, cz, Math.hypot(W, D) / 2 + 30)) {
    if (s === b) continue
    const e = city.entry(s), id = city.id(e)
    if (id.role === 'building' || id.role === 'skip') continue
    let layer: PartLayer
    if (id.role === 'ground') {
      // A ground tile belongs when it lies inside, give or take a few metres (tiles are big: 20-60 m).
      const [l, w] = s.ext, co = Math.abs(Math.cos(s.yaw)), si = Math.abs(Math.sin(s.yaw))
      const ex = (l * co + w * si) / 2, ez = (l * si + w * co) / 2
      if (!inRect(s.at[0], s.at[2]) || !inRect(s.at[0] - ex, s.at[2] - ez, 4) || !inRect(s.at[0] + ex, s.at[2] + ez, 4) || Math.abs(s.at[1] - base) > 3) continue
      layer = 'ground'
    } else {
      if (!inRect(s.at[0], s.at[2]) || s.at[1] < base - 3 || s.at[1] > base + b.h + 2) continue
      if (city.buildingAt(s.at[0], s.at[2], s.at[1] + 0.1, b, 0.3) && !onThis(s, 0)) continue
      if (e.kitOf === fam) layer = 'kit'
      else if (id.role === 'fence') layer = 'fence'
      else if (id.role === 'piece') {
        // A piece standing away from the building is part of something else (an el track, an overpass).
        if (!onThis(s, 1.5)) continue
        layer = 'detail'
      } else {
        const onWall = Math.abs(Math.abs(s.at[0] - b.at[0]) - hx) < 0.8 || Math.abs(Math.abs(s.at[2] - b.at[2]) - hz) < 0.8
        layer = onThis(s, 0.6) && (s.at[1] > base + 1.2 || (WALL_KINDS.has(id.kind ?? '') && onWall)) ? 'detail' : 'prop'
      }
    }
    if (layer === 'fence') fences.push(s)
    if (layer === 'prop') { props++; if (id.kind === 'cover' && s.h >= 1.2) blockers.push(s) }
    if (id.name === 'Fire escape' || id.name === 'Ladder' || id.name === 'Stairs') {
      const kind: Climb['kind'] = id.name === 'Fire escape' ? 'fire escape' : id.name === 'Ladder' ? 'ladder' : 'stairs'
      climbs.push({ kind, at: [r2(s.at[0] - b.at[0]), r2(s.at[1] - base), r2(s.at[2] - b.at[2])], top: r2(s.at[1] - base + s.h) })
    }
    tris += e.tris
    parts.push({ id: s.id, at: [r2(s.at[0] - cx), r2(s.at[1] - base), r2(s.at[2] - cz)], yaw: deg(s.yaw), layer })
  }
  // Edges and where players pass: along each side's outer line, a metre at a time, what blocks the way.
  const edges: ModuleEdge[] = sides.map(({ side, kind }) => {
    if (kind === 'wall' || kind === 'water') return { side, kind, openings: [] }
    const alongX = side === '+z' || side === '-z'
    const len = alongX ? W : D
    const fixed = side === '+x' ? rect[2] - 0.5 : side === '-x' ? rect[0] + 0.5 : side === '+z' ? rect[3] - 0.5 : rect[1] + 0.5
    const hit = (s: Spot, x: number, z: number, pad: number) => { const o = local([x - s.at[0], 0, z - s.at[2]], s.yaw); return Math.abs(o[0]) <= s.ext[0] / 2 + pad && Math.abs(o[2]) <= s.ext[1] / 2 + pad }
    const free: boolean[] = []
    for (let u = -len / 2 + 0.5; u < len / 2; u += 1) {
      const x = alongX ? cx + u : fixed, z = alongX ? fixed : cz + u
      const inB = Math.abs(x - b.at[0]) < hx && Math.abs(z - b.at[2]) < hz
      free.push(!inB && !city.buildingAt(x, z, base + 0.5, b) && !fences.some((f) => hit(f, x, z, 0.4)) && !blockers.some((f) => hit(f, x, z, 0.2)))
    }
    const openings: ModuleEdge['openings'] = []
    for (let i = 0; i < free.length;) {
      if (!free[i]) { i++; continue }
      let j = i
      while (j < free.length && free[j]) j++
      if (j - i >= 2) openings.push({ at: r2(-len / 2 + (i + j) / 2), width: j - i })
      i = j
    }
    return { side, kind, openings }
  })
  // Where players come in: the middle of each opening, at street level.
  const entrances: Vec3[] = []
  for (const e of edges) for (const o of e.openings) {
    const p: Vec3 = e.side === '+x' ? [W / 2 - 0.5, 0, o.at] : e.side === '-x' ? [-W / 2 + 0.5, 0, o.at] : e.side === '+z' ? [o.at, 0, D / 2 - 0.5] : [o.at, 0, -D / 2 + 0.5]
    entrances.push(p.map(r2) as Vec3)
  }
  // Levels: the building's decks above street level (walkways, terraces, roofs). What players reach: from the
  // street (and anything a step up), up every climb whose foot is within CLIMB_ON of somewhere reached (flights
  // break at landings), to its top and the decks there.
  const decks = (b.site?.decks ?? []).filter((d) => d.y >= 1)
  const reached = new Map<number, Climb['kind'] | 'jump'>([[0, 'jump']])
  const way = (y: number) => [...reached].find(([h]) => Math.abs(h - y) <= CLIMB_ON)?.[1]
  for (const d of decks) if (d.y <= 1.3) reached.set(d.y, 'jump')
  for (let changed = true, n = 0; changed && n < 20; n++) {
    changed = false
    for (const x of climbs) {
      if (reached.has(x.top) || (!way(x.at[1]) && !(x.kind === 'fire escape' && x.at[1] <= FIRE_ESCAPE_FOOT))) continue
      reached.set(x.top, x.kind); changed = true
      for (const d of decks) if (!reached.has(d.y) && x.top >= d.y - 1.2 && x.top <= d.y + 0.8) reached.set(d.y, x.kind)
    }
  }
  const levels: CityModule['levels'] = []
  for (const d of decks) {
    if (levels.some((l) => Math.abs(l.height - d.y) < 1)) continue
    const how = reached.get(d.y)
    levels.push({ height: r2(d.y), reach: how ?? 'none' })
  }
  // (A climb reached that ends where the geometry has no deck still leads somewhere: a fire escape's top landing.)
  for (const [h, how] of reached) if (h >= 2 && how !== 'jump' && !levels.some((l) => Math.abs(l.height - h) < 1.5)) levels.push({ height: r2(h), reach: how })
  levels.sort((p, q) => p.height - q.height)
  const roofReach = levels.length ? levels[levels.length - 1].reach : 'none'
  // Floor: the heights the module's ground and props stand at (the building's feet are 0).
  const gy = parts.filter((p) => p.layer === 'ground' || p.layer === 'prop' || p.layer === 'fence').map((p) => p.at[1]).filter((y) => Math.abs(y) < 3)
  const floor: [number, number] = [r2(Math.min(0, ...gy)), r2(Math.max(0, ...gy))]
  // Kind, district, settings and name.
  const facts = bid.building
  const streets = sides.filter((s) => s.kind === 'street')
  const corner = streets.some((s) => s.side[1] === 'x') && streets.some((s) => s.side[1] === 'z')
  const area = b.ext[0] * b.ext[1]
  let kind: ModuleKind = corner ? 'corner' : 'block'
  if (b.h > LANDMARK_HEIGHT || area > LANDMARK_AREA || LANDMARK_TYPES.test(facts.type ?? '')) kind = 'landmark'
  else if (/gas station|parking garage/.test(facts.type ?? '') || area < W * D * 0.3) kind = 'lot'
  else if (sides.filter((s) => s.kind === 'yard').length >= 2) kind = 'yard'
  const district = parseBuildingCode(familyOf(be)).district ?? city.district(b) ?? facts.districts?.[0] ?? ''
  const settings = new Set<WizardSetting>(bid.settings)
  for (const s of DISTRICT_SETTINGS[district] ?? []) settings.add(s)
  // How complete this copy is: its own layout's pieces there, then what stands around it.
  const layout = new Set((be.layout ?? []).map((p) => p.id))
  const have = new Set(parts.filter((p) => layout.has(p.id)).map((p) => p.id)).size
  const score = (layout.size ? have / layout.size : 0) * 10 + Math.min(props, 30) / 10 + edges.reduce((s, e) => s + e.openings.length, 0) * 0.1 + (sides.some((s) => s.kind === 'street') ? 1 : 0)
  const c = city.chunks[b.chunk]
  return {
    m: {
      id: '', name: moduleName(bid.name, kind, sides.map((s) => s.kind), roofReach), kind, district: district || 'Stilwater', settings: [...settings],
      source: { pack: c.pack, chunk: c.chunk, rect: rect.map(r2) as [number, number, number, number], y: r2(base) },
      size: [r2(W), r2(D)], floor, edges, entrances, parts, levels, tris,
    },
    score,
  }
}

function moduleName(building: string, kind: ModuleKind, sides: EdgeKind[], roof: CityModule['levels'][number]['reach']): string {
  const has = (k: EdgeKind) => sides.includes(k)
  const where = kind === 'corner' ? 'on a street corner' : kind === 'yard' ? 'with its yard' : has('street') ? 'on the street' : has('alley') ? 'off an alley' : has('water') ? 'by the water' : has('sidewalk') ? 'on a plaza' : 'between buildings'
  const extra = [
    has('alley') && kind !== 'yard' && has('street') ? 'a back alley' : '',
    roof === 'fire escape' ? 'a fire escape to the roof' : roof === 'stairs' ? 'stairs to the roof' : roof === 'ladder' ? 'a ladder to the roof' : '',
  ].filter(Boolean)
  return `${building} ${where}${extra.length ? ', with ' + extra.join(' and ') : ''}`
}
