// Map health checks, as one pure function: collision triangles and markers in,
// a report out (sight lines, spawn safety, red vs blue fairness, a bot
// playtest). No DOM or three.js, so it runs in a worker, in tests and for the AI.
import { Bvh } from './bvh'
import { buildFloor, dijkstra, dijkstraTo, LETHAL_DROP, nodeNear, PLAYER, twoWay, type FloorGraph } from './floor'
import { observe, pickLanes, pickObservers, sees, type SightCounts } from './sight'
import { botPlaytest, fieldCache } from './bots'
import { findMoves, movesSummary } from './moves'
import { OPAQUE, type AnalysisInput, type AnalysisMarker, type AnalysisOptions, type FairnessReport, type HealthReport, type Risk, type SpawnReport, type Team, type TeamStats } from './types'
import type { Vec3 } from '../project'
import { AIMED_M, longReach, reachOf } from '../weaponRange'

const SPAWN_TYPES = ['Shared spawn', 'Red team spawn', 'Blue team spawn']
/** The bot playtest's default size. */
export const BOTS = { bots: 8, trips: 800 }
const POWER = /rpg|sniper|mini|launcher/i
const m = (units: number) => units / 2
const pct = (x: number) => `${Math.round(x * 100)}%`
const round = (x: number) => Math.round(x)
/** Farthest a player counts as seen, units: as far as most guns hit (weaponRange.ts). */
export const WITHIN = AIMED_M * 2
/** A spawn whose eyes meet a wall this close ahead (metres) starts the round looking at it. */
export const FACING_WALL_M = 4

/** Everything before the sight check: the ray tree, the floor graph, markers on it, the reachable floor and who looks. */
export interface Prepared {
  input: AnalysisInput
  opts: AnalysisOptions
  bvh: Bvh
  g: FloorGraph
  nodeOf: number[]
  reachList: Int32Array
  observers: Int32Array
  unreachable: HealthReport['unreachable']
  ms: Record<string, number>
}

const progress = (opts: AnalysisOptions, text: string, from: number, to: number) => (done: number) => opts.onProgress?.(text, from + (to - from) * done)
export const SIGHT_FROM = 0.2, SIGHT_TO = 0.8

/** Collision + markers in, a health report out. Synchronous; the editor runs it in workers (see client.ts). */
export function analyzeMap(input: AnalysisInput, opts: AnalysisOptions = {}): HealthReport {
  const p = prepareMap(input, opts)
  const t = performance.now()
  const counts = observe(p.bvh, p.g.grid.pos, p.reachList, p.observers, opts.maxSight ?? 300, progress(opts, 'Checking sight lines', SIGHT_FROM, SIGHT_TO), opts.within ?? WITHIN)
  p.ms.sight = Math.round(performance.now() - t)
  return finishMap(p, counts)
}

export function prepareMap(input: AnalysisInput, opts: AnalysisOptions = {}): Prepared {
  const ms: Record<string, number> = {}
  let t = performance.now()
  const lap = (k: string) => { const now = performance.now(); ms[k] = Math.round(now - t); t = now }

  progress(opts, 'Reading the map', 0, 0.05)(0)
  const bvh = new Bvh(input.tris, input.flags)
  lap('bvh')

  progress(opts, 'Finding the floor', 0.05, SIGHT_FROM)(0)
  const [minX, , minZ] = bvh.min, [maxX, , maxZ] = bvh.max
  const area = Math.max(1, (maxX - minX) * (maxZ - minZ))
  const cell = opts.cell ?? Math.max(2, Math.ceil(Math.sqrt(area / 90000) * 2) / 2)
  const g = buildFloor(bvh, cell, opts.maxDrop ?? LETHAL_DROP)
  lap('floor')

  // Markers on the floor graph.
  const markers = input.markers
  // The middle mirror pairs turn about (mirrorCentre), as mirrorCheck and mirror mode use.
  const [cx, cz] = mirrorCentre(markers)
  const nodeOf = markers.map((mk) => (g.grid.count ? nodeNear(g, mk.position[0], mk.position[1], mk.position[2], cx, cz) : -1))
  const spawnNodes = markers.flatMap((mk, i) => (SPAWN_TYPES.includes(mk.type) && nodeOf[i] >= 0 ? [nodeOf[i]] : []))

  // Reachable floor: anywhere a player can walk to from a spawn (or any marker, or anywhere, on maps without them).
  const starts = spawnNodes.length ? spawnNodes : nodeOf.filter((n) => n >= 0)
  const fromStart = starts.length ? dijkstra(g, starts) : null
  const reach = g.grid.reachable
  for (let i = 0; i < g.grid.count; i++) reach[i] = !fromStart || Number.isFinite(fromStart[i]) ? 1 : 0
  const reachList = Int32Array.from(Array.from(reach.keys()).filter((i) => reach[i]))
  // Spawns, weapons and drop-offs must be on the floor players get round both ways (twoWay): a spawn on a roof with no
  // stairs up leaves its player to camp there or fall; a gun on a deck nobody can climb is never picked up. The main
  // stretch is the one most of the spawns stand on.
  const { comp, sizes } = twoWay(g)
  const votes = new Map<number, number>()
  for (const n of spawnNodes) votes.set(comp[n], (votes.get(comp[n]) ?? 0) + 1)
  let main = -1
  for (const [c, v] of votes) if (main < 0 || v > votes.get(main)! || (v === votes.get(main)! && sizes[c] > sizes[main])) main = c
  if (main < 0 && sizes.length) main = sizes.indexOf(Math.max(...sizes))
  const placed = (t: string) => SPAWN_TYPES.includes(t) || t === 'Weapon pickup' || t === 'Chains drop-off'
  const unreachable = markers.flatMap((mk, i) => {
    if (!placed(mk.type)) return []
    const n = nodeOf[i]
    if (n < 0) return [{ type: mk.type, position: mk.position, why: 'not on any floor (in the air, under the map or inside something)' }]
    if (!reach[n]) return [{ type: mk.type, position: mk.position, why: 'no way to walk there from the spawns' }]
    if (comp[n] !== main) return [{ type: mk.type, position: mk.position, why: 'no stairs or ramp up to it, or no way back down without a fall' }]
    return []
  })
  // Observers in mirrored pairs about the spawns' centre (the maps are point-symmetric), when the twin is reachable too.
  const P = g.grid.pos
  const twin = (n: number) => { const q = nodeNear(g, 2 * cx - P[n * 3], P[n * 3 + 1] + 0.1, 2 * cz - P[n * 3 + 2], cx, cz); return q >= 0 && reach[q] ? q : -1 }
  const observers = pickObservers(reachList, opts.rayBudget ?? 4_000_000, opts.seed ?? 1, twin)
  lap('reach')
  return { input, opts, bvh, g, nodeOf, reachList, observers, unreachable, ms }
}

/** Everything after the sight check, from the counts of all the observers. */
export function finishMap(p: Prepared, counts: SightCounts): HealthReport {
  const { input, opts, bvh, g, nodeOf, reachList, unreachable, ms } = p
  let t = performance.now()
  const lap = (k: string) => { const now = performance.now(); ms[k] = Math.round(now - t); t = now }
  const markers = input.markers
  const idx = (pred: (mk: AnalysisMarker) => boolean) => markers.flatMap((mk, i) => (pred(mk) ? [i] : []))
  const spawnIdx = idx((mk) => SPAWN_TYPES.includes(mk.type))
  const weaponIdx = idx((mk) => mk.type === 'Weapon pickup')
  const dropIdx = idx((mk) => mk.type === 'Chains drop-off')
  const nodes = (list: number[]) => list.map((i) => nodeOf[i]).filter((n) => n >= 0)

  const m0 = Math.max(1, p.observers.length)
  const stand = new Float32Array(g.grid.count), crouch = new Float32Array(g.grid.count)
  for (const n of reachList) { stand[n] = counts.stand[n] / m0; crouch[n] = counts.crouch[n] / m0 }
  const lanes = pickLanes(counts.longest, g.grid.pos)

  progress(opts, 'Checking spawns', SIGHT_TO, 0.85)(0)
  const field = fieldCache(g)
  const toWeapon = weaponIdx.length ? dijkstraTo(g, nodes(weaponIdx)) : null
  const eye = (i: number): Vec3 => {
    const n = nodeOf[i]
    const pt = markers[i].position
    return [pt[0], (n >= 0 ? g.grid.pos[n * 3 + 1] : pt[1] - 0.1) + PLAYER.standEye, pt[2]]
  }
  const teamOf = (type: string): Team => (type === 'Red team spawn' ? 'red' : type === 'Blue team spawn' ? 'blue' : 'shared')
  const spawns: SpawnReport[] = spawnIdx.map((i, k) => {
    const mk = markers[i], team = teamOf(mk.type), n = nodeOf[i]
    const enemies = spawnIdx.filter((j) => j !== i && (team === 'shared' ? teamOf(markers[j].type) === 'shared' : teamOf(markers[j].type) === (team === 'red' ? 'blue' : 'red')))
    const me = eye(i)
    const seenFrom: Vec3[] = []
    let bySpawns = 0, byPickups = 0
    // Only from where a gun reaches: a player who spawns there with the guns players spawn with (most guns hit
    // reliably only within about 50 m), or one who picks up that weapon (a sniper rifle reaches much farther).
    const near = (j: number, metres: number) => Math.hypot(eye(j)[0] - me[0], eye(j)[1] - me[1], eye(j)[2] - me[2]) <= metres * 2
    for (const j of enemies) if (near(j, AIMED_M) && sees(bvh, eye(j), me)) { bySpawns++; seenFrom.push(markers[j].position) }
    for (const j of weaponIdx) if (near(j, reachOf(markers[j].weapon)) && sees(bvh, eye(j), me)) { byPickups++; seenFrom.push(markers[j].position) }
    const f = n >= 0 ? field(n) : null
    let enemyWalk = Infinity
    if (f) for (const j of enemies) if (nodeOf[j] >= 0) enemyWalk = Math.min(enemyWalk, f[nodeOf[j]])
    const exp = n >= 0 ? stand[n] : 0
    const weaponWalk = n >= 0 && toWeapon ? toWeapon[n] : Infinity
    // Straight ahead from its eyes, the way it faces: a wall within a few metres means turning round before anything else.
    let wall: number | undefined
    if (mk.yaw !== undefined) {
      const t = (mk.yaw * Math.PI) / 180, hit = bvh.closest(me[0], me[1], me[2], Math.sin(t), 0, -Math.cos(t), FACING_WALL_M * 2, OPAQUE)
      if (hit >= 0) wall = Math.round(m(hit) * 10) / 10
    }
    const { risk, reasons } = judgeSpawn(team, bySpawns, byPickups, exp, Number.isFinite(enemyWalk) ? m(enemyWalk) : null, wall)
    return {
      marker: i, uid: mk.uid, type: mk.type, team, number: k + 1, position: mk.position,
      seenBySpawns: bySpawns, seenByPickups: byPickups, seenFrom, exposure: exp,
      enemyWalkM: Number.isFinite(enemyWalk) ? round(m(enemyWalk)) : null,
      weaponWalkM: Number.isFinite(weaponWalk) ? round(m(weaponWalk)) : null,
      ...(wall !== undefined ? { facesWallM: wall } : {}),
      risk, reasons,
    }
  })
  lap('spawns')

  progress(opts, 'Comparing red and blue', 0.85, 0.9)(0)
  const { fairness, territory } = compareTeams(g, markers, nodeOf, spawns, weaponIdx, dropIdx, reachList, toWeapon)
  lap('fairness')

  progress(opts, 'Bots playing the map', 0.9, 1)(0)
  const bots = botPlaytest(g, { spawns: spawnIdx.map((i) => nodeOf[i]), spawnTeams: spawnIdx.map((i) => teamOf(markers[i].type)), weapons: nodes(weaponIdx), drops: nodes(dropIdx) },
    { bots: opts.bots ?? BOTS.bots, trips: opts.trips ?? BOTS.trips, seed: opts.seed ?? 1, field })
  lap('bots')

  let blind = 0, open = 0
  for (const n of reachList) { if (stand[n] < 0.03) blind++; if (stand[n] > 0.4) open++ }
  const blindShare = reachList.length ? blind / reachList.length : 0
  const openShare = reachList.length ? open / reachList.length : 0

  const moves = findMoves(bvh, g)
  lap('moves')
  const far = [...new Set(weaponIdx.map((i) => markers[i].weapon).filter((w) => longReach(w)))] as string[]
  const { score, findings } = summarize(spawns, fairness, unreachable, lanes, blindShare, openShare, reachList.length, far)
  const getAround = movesSummary(moves)
  if (getAround && reachList.length) findings.push(getAround)
  return {
    version: 1, grid: g.grid, exposure: stand, exposureCrouch: crouch, traffic: bots.traffic, territory,
    lanes, blindShare, openShare, spawns, fairness, unreachable, hotspots: bots.hotspots, moves, score, findings,
    stats: { triangles: input.flags.length, nodes: g.grid.count, reachable: reachList.length, observers: p.observers.length, rays: bvh.rays + counts.rays, ms },
  }
}

function judgeSpawn(team: Team, bySpawns: number, byPickups: number, exp: number, enemyWalkM: number | null, wallM?: number): { risk: Risk; reasons: string[] } {
  const reasons: string[] = []
  const shared = team === 'shared'
  const other = shared ? 'other spawn' : 'enemy spawn'
  if (bySpawns) reasons.push(`Seen from ${bySpawns} ${other}${bySpawns === 1 ? '' : 's'}`)
  if (byPickups) reasons.push(`Seen from ${byPickups} weapon pickup${byPickups === 1 ? '' : 's'}`)
  if (exp >= 0.15) reasons.push(`${pct(exp)} of the map can see it`)
  if (enemyWalkM !== null && enemyWalkM < (shared ? 10 : 25)) reasons.push(shared ? `Another spawn is only ${round(enemyWalkM)} m away` : `Enemies can walk here in ${round(enemyWalkM)} m`)
  if (wallM !== undefined) reasons.push(`Faces a wall ${wallM} m away`)
  const walk = enemyWalkM ?? Infinity
  // Shared (free-for-all) spawns are judged more gently: with every player an enemy, some other spawn is usually in view.
  const campable = shared
    ? exp >= 0.3 || bySpawns >= 6 || walk < 6
    : bySpawns >= 2 || exp >= 0.3 || walk < 15 || (bySpawns >= 1 && exp >= 0.2)
  const watch = shared
    ? exp >= 0.15 || bySpawns >= 3 || byPickups >= 5 || walk < 10
    : bySpawns >= 1 || exp >= 0.15 || byPickups >= 5 || walk < 25
  // Facing a wall is never campable on its own, but a player who spawns turning round is a step behind.
  const facing = wallM !== undefined
  if (!reasons.length) reasons.push('Out of sight and a good walk from the enemy')
  return { risk: campable ? 'campable' : watch || facing ? 'watch' : 'ok', reasons }
}

function compareTeams(g: FloorGraph, markers: AnalysisMarker[], nodeOf: number[], spawns: SpawnReport[],
  weaponIdx: number[], dropIdx: number[], reachList: Int32Array, toWeapon: Float32Array | null): { fairness: FairnessReport; territory: Int8Array } {
  const territory = new Int8Array(g.grid.count)
  const reds = spawns.filter((s) => s.team === 'red'), blues = spawns.filter((s) => s.team === 'blue')
  const shared = spawns.filter((s) => s.team === 'shared')
  const basis: FairnessReport['basis'] = reds.length && blues.length ? 'teams' : shared.length >= 2 ? 'halves' : 'none'
  const unmirrored = mirrorCheck(markers)
  if (basis === 'none') {
    return { territory, fairness: { score: 100 - unmirroredPoints(unmirrored.length, basis), basis, red: null, blue: null, unmirrored, reasons: ['Add red and blue team spawns (or a few shared ones) to compare the two sides.'] } }
  }
  // Without team spawns, compare the two halves either side of the spawns' centre (red at −Z).
  let red = reds, blue = blues
  if (basis === 'halves') {
    const cz = shared.reduce((a, s) => a + s.position[2], 0) / shared.length
    red = shared.filter((s) => s.position[2] < cz - 0.5)
    blue = shared.filter((s) => s.position[2] > cz + 0.5)
    if (!red.length || !blue.length) return { territory, fairness: { score: 100, basis: 'none', red: null, blue: null, unmirrored, reasons: ['All the spawns are on one line, so there are no sides to compare.'] } }
  }
  const P = g.grid.pos
  const ys = Array.from(reachList, (n) => P[n * 3 + 1]).sort((a, b) => a - b)
  const yLo = ys[0] ?? 0, yHi = ys[ys.length - 1] ?? 0
  const high = yHi - yLo >= 4 ? Array.from(reachList).filter((n) => P[n * 3 + 1] >= yLo + 0.75 * (yHi - yLo)) : []
  const power = weaponIdx.filter((i) => POWER.test(markers[i].weapon ?? ''))
  const stats = (team: SpawnReport[]): { s: TeamStats; dist: Float32Array } => {
    const src = team.map((s) => nodeOf[s.marker]).filter((n) => n >= 0)
    const dist = dijkstra(g, src)
    const near = (list: number[]) => { let best = Infinity; for (const n of list) if (n >= 0) best = Math.min(best, dist[n]); return Number.isFinite(best) ? round(m(best)) : null }
    const ws = toWeapon ? team.map((s) => nodeOf[s.marker]).filter((n) => n >= 0 && Number.isFinite(toWeapon[n])).map((n) => toWeapon[n]) : []
    return {
      dist,
      s: {
        spawns: team.length,
        toWeaponM: ws.length ? round(m(ws.reduce((a, b) => a + b, 0) / ws.length)) : null,
        toPowerM: near(power.map((i) => nodeOf[i])),
        toDropM: near(dropIdx.map((i) => nodeOf[i])),
        toHighM: near(high),
        territory: 0,
        spawnExposure: team.reduce((a, s) => a + s.exposure, 0) / team.length,
      },
    }
  }
  const R = stats(red), B = stats(blue)
  let r = 0, b = 0
  for (const n of reachList) {
    const dr = R.dist[n], db = B.dist[n]
    if (!Number.isFinite(dr) && !Number.isFinite(db)) continue
    if (dr + 1 < db) { territory[n] = -1; r++ } else if (db + 1 < dr) { territory[n] = 1; b++ }
  }
  const total = Math.max(1, reachList.length)
  R.s.territory = r / total
  B.s.territory = b / total

  const reasons: string[] = []
  const even: string[] = []
  let penalty = 0
  const compare = (what: string, a: number | null, c: number | null, weight: number) => {
    if (a === null && c === null) return
    if (a === null || c === null) {
      penalty += 20 * weight
      reasons.push(`Only ${a === null ? 'blue' : 'red'} can walk to ${what}.`)
      return
    }
    const diff = Math.abs(a - c), rel = diff / Math.max(a, c, 1)
    if (diff >= 3 && rel >= 0.12) {
      penalty += Math.min(20, rel * 60) * weight
      reasons.push(`${a < c ? 'Red' : 'Blue'} gets to ${what} ${round(diff)} m sooner (${Math.min(a, c)} m vs ${Math.max(a, c)} m).`)
    } else even.push(what)
  }
  compare('the nearest weapon', R.s.toWeaponM, B.s.toWeaponM, 1)
  if (power.length) compare('a power weapon', R.s.toPowerM, B.s.toPowerM, 1)
  if (dropIdx.length) compare('a drop-off', R.s.toDropM, B.s.toDropM, 0.8)
  if (high.length) compare('the high ground', R.s.toHighM, B.s.toHighM, 0.6)
  const td = R.s.territory - B.s.territory
  if (Math.abs(td) >= 0.08) {
    penalty += Math.min(20, Math.abs(td) * 60)
    reasons.push(`${td > 0 ? 'Red' : 'Blue'} reaches more of the map first (${pct(Math.max(R.s.territory, B.s.territory))} vs ${pct(Math.min(R.s.territory, B.s.territory))}).`)
  } else even.push('how much of the map each side reaches first')
  const ed = R.s.spawnExposure - B.s.spawnExposure
  if (Math.abs(ed) >= 0.08) {
    penalty += Math.min(15, Math.abs(ed) * 60)
    reasons.push(`${ed > 0 ? 'Red' : 'Blue'}'s spawns are more in the open (${pct(Math.max(R.s.spawnExposure, B.s.spawnExposure))} of the map sees them vs ${pct(Math.min(R.s.spawnExposure, B.s.spawnExposure))}).`)
  } else even.push('how hidden the spawns are')
  if (unmirrored.length) {
    penalty += unmirroredPoints(unmirrored.length, basis)
    reasons.push(`${unmirrored.length} marker${unmirrored.length === 1 ? ' has' : 's have'} no mirrored twin on the other side.`)
  }
  if (even.length) reasons.push(`Even for both sides: ${even.join(', ')}.`)
  return { territory, fairness: { score: Math.max(0, round(100 - penalty)), basis, red: R.s, blue: B.s, unmirrored, reasons } }
}

/** The map's centre on the ground: the middle of the spawns (or of all markers with fewer than two spawns). */
function centre(markers: AnalysisMarker[]): [number, number] {
  const spawns = markers.filter((mk) => SPAWN_TYPES.includes(mk.type))
  const list = spawns.length >= 2 ? spawns : markers
  if (!list.length) return [0, 0]
  return [list.reduce((a, mk) => a + mk.position[0], 0) / list.length, list.reduce((a, mk) => a + mk.position[2], 0) / list.length]
}

const MIRRORED = [...SPAWN_TYPES, 'Weapon pickup', 'Chains drop-off']

/** The middle the map is mirrored about: the middle of the spawns (of the spawns, weapons and drop-offs with fewer
 *  than two spawns). Mirror mode turns edits about the same point (lib/mirrorEdit.ts). */
export function mirrorCentre(markers: Pick<AnalysisMarker, 'type' | 'position'>[]): [number, number] {
  return centre(markers.filter((mk) => MIRRORED.includes(mk.type)) as AnalysisMarker[])
}

/** What the fairness score takes off for `count` spawns, weapons and drop-offs without a twin: 3 each, 20 at most when
 *  the two sides are compared (team spawns, or shared spawns either side of the middle), else 3 each. */
export function unmirroredPoints(count: number, basis: FairnessReport['basis']): number {
  return basis === 'none' ? Math.min(100, count * 3) : Math.min(20, count * 3)
}

/** As the fairness score will count them: how many spawns, weapons and drop-offs have no twin, and the points that
 *  costs (0 when the spawns are all on one line, which leaves no sides to compare). */
export function unmirroredCost(markers: AnalysisMarker[]): { count: number; points: number } {
  const count = mirrorCheck(markers).length
  const type = (t: string) => markers.filter((mk) => mk.type === t)
  const shared = type('Shared spawn')
  const basis: FairnessReport['basis'] = type('Red team spawn').length && type('Blue team spawn').length ? 'teams' : shared.length >= 2 ? 'halves' : 'none'
  if (basis === 'halves') {
    const cz = shared.reduce((a, mk) => a + mk.position[2], 0) / shared.length
    if (!shared.some((mk) => mk.position[2] < cz - 0.5) || !shared.some((mk) => mk.position[2] > cz + 0.5)) return { count, points: 0 }
  }
  return { count, points: unmirroredPoints(count, basis) }
}

/** Spawns, weapons and drop-offs whose twin (turned 180° about the map's centre, red and blue swapped) is missing. */
export function mirrorCheck(markers: AnalysisMarker[]): { type: string; position: Vec3 }[] {
  const list = markers.filter((mk) => MIRRORED.includes(mk.type))
  if (list.length < 2) return []
  const [cx, cz] = centre(list)
  const twin = (t: string) => (t === 'Red team spawn' ? 'Blue team spawn' : t === 'Blue team spawn' ? 'Red team spawn' : t)
  return list.filter((mk) => {
    const x = 2 * cx - mk.position[0], z = 2 * cz - mk.position[2]
    return !list.some((o) => o.type === twin(mk.type) && (mk.type !== 'Weapon pickup' || o.weapon === mk.weapon)
      && Math.hypot(o.position[0] - x, o.position[2] - z) <= 3 && Math.abs(o.position[1] - mk.position[1]) <= 1.5)
  }).map((mk) => ({ type: mk.type, position: mk.position }))
}

const GUN: Record<string, string> = { sniper_rifle: 'sniper rifle', rpg_launcher: 'RPG', rpg_laser: 'laser RPG', m16: 'M16', magnum: 'Magnum' }
const gunName = (w: string) => GUN[w.toLowerCase()] ?? w

function summarize(spawns: SpawnReport[], fairness: FairnessReport, unreachable: HealthReport['unreachable'], lanes: HealthReport['lanes'],
  blindShare: number, openShare: number, floor: number, far: string[] = []): { score: number; findings: string[] } {
  const findings: string[] = []
  if (!floor) return { score: 0, findings: ['No floor to stand on yet: add a floor or a sample map first.'] }
  if (unreachable.length) {
    const name = (t: string) => (t === 'Weapon pickup' ? 'weapon' : t === 'Chains drop-off' ? 'drop-off' : 'spawn')
    const kinds = [...new Set(unreachable.map((u) => name(u.type)))]
    const whys = [...new Set(unreachable.map((u) => u.why).filter(Boolean))]
    findings.push(`${unreachable.length} ${kinds.join('/')}${unreachable.length === 1 ? '' : 's'} can't be used: ${whys.join('; ') || 'not reachable on foot from the spawns'}.`)
  }
  // Worst first: seen from enemy spawns, then from pickups, then from the open map.
  const bad = spawns.filter((s) => s.risk === 'campable').sort((a, b) => b.seenBySpawns * 3 + b.seenByPickups + b.exposure * 10 - (a.seenBySpawns * 3 + a.seenByPickups + a.exposure * 10) || a.number - b.number)
  const watch = spawns.filter((s) => s.risk === 'watch')
  for (const s of bad.slice(0, 3)) {
    const places = s.seenBySpawns + s.seenByPickups
    findings.push(places ? `Spawn ${s.number} can be seen from ${places} place${places === 1 ? '' : 's'}: easy to camp.` : `Spawn ${s.number}: ${s.reasons[0].toLowerCase()}.`)
  }
  if (bad.length > 3) findings.push(`${bad.length - 3} more spawns are easy to camp.`)
  if (!spawns.length) findings.push('No spawns yet: place some so players have somewhere to start.')
  else if (!bad.length) findings.push(watch.length ? `No spawn is easy to camp; ${watch.length} could use a bit more cover.` : 'Every spawn is out of sight and away from the enemy.')
  const walled = spawns.filter((s) => s.facesWallM !== undefined)
  if (walled.length) findings.push(walled.length === 1 ? `Spawn ${walled[0].number} faces a wall ${walled[0].facesWallM} m away: turn it toward open ground.`
    : `${walled.length} spawns face a wall within ${FACING_WALL_M} m (${walled.slice(0, 4).map((s) => s.number).join(', ')}${walled.length > 4 ? '…' : ''}): turn them toward open ground.`)
  for (const r of fairness.reasons.slice(0, 2)) if (!r.startsWith('Even')) findings.push(r)
  // A long line only matters to what can hit along it: past about 50 m, only the long guns.
  if (lanes[0]) findings.push(lanes[0].metres <= AIMED_M ? `Longest sight line: ${lanes[0].metres} m, within what most guns hit.`
    : far.length ? `Longest sniper lane: ${lanes[0].metres} m across the map, for the ${far.map(gunName).join(', ')} on it (most guns don't hit past about ${AIMED_M} m).`
      : `Longest sight line: ${lanes[0].metres} m, but nothing on the map hits that far (most guns don't past about ${AIMED_M} m).`)
  if (openShare > 0.3) findings.push(`${pct(openShare)} of the floor is wide open (half the map can see it and is close enough to hit it): add cover.`)
  if (blindShare > 0.25) findings.push(`${pct(blindShare)} of the floor is hidden from almost everywhere: good cover, but also camping corners.`)
  const spawnScore = spawns.length ? (100 * spawns.reduce((a, s) => a + (s.risk === 'ok' ? 1 : s.risk === 'watch' ? 0.6 : 0), 0)) / spawns.length : 0
  const score = Math.max(0, Math.min(100, round(0.5 * spawnScore + 0.5 * fairness.score - 5 * unreachable.length - Math.max(0, openShare - 0.3) * 50)))
  return { score, findings }
}
