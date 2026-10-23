// The new map wizard's "Neighbourhood" layout: a real street grid (one road
// network with sidewalks, crossings and lamps) round blocks of buildings
// with alleys and back yards, a park, parked cars and, optionally, terrain:
// wooded hills along the side walls and a raised plaza in the park. Blocks
// are laid out on red's half (−Z) and turned 180° for blue; the streets and
// hills are point-symmetric by construction, so both teams get the same map.
// Lots and sidewalks are one kerb (0.32) above the street, at y 1.32.
import type { Vec3 } from './project'
import { CY, PB, blob, box, organic, type Part } from './sampleKit'
import { U, car } from './urbanKit'
import { bench, building, dumpster, tree, prefabParams, tagPrefab, type Style } from './prefabs'
import { ALL_PREFABS } from './prefabRegistry'
import { buildRoad, formatPath, roadOptions, roadPrefabParts, WALK_H, type Polyline } from './roads'
import { TERRAIN_TEX, heightAt, hills, peak, shapeTerrain, terrainShape } from './terrain'
import { blocker } from './sampleScale'
import type { Look, Rng, WizardOptions } from './mapWizard'

export interface HoodContext {
  o: WizardOptions
  look: Look
  r: Rng
  W: number
  D: number
  /** Depth of each team's spawn strip at the end of the map. */
  strip: number
  /** A building height that suits the setting. */
  height(): number
  /** A building players can walk into (front toward +Z), standing at y. */
  walkIn(key: string, x: number, z: number, w: number, d: number, extra: Record<string, string | number>, y: number): Part[]
  high: string[]
}

export interface HoodResult {
  /** Red's half: mirrored by the caller. */
  half: Part[]
  /** Already point-symmetric: the streets. */
  centre: Part[]
  weapons: [string, Vec3][]
  lights: [Vec3, Vec3?][]
  wallH: number
}

/** Ground level of the lots and sidewalks. */
export const LOT_Y = 1 + WALK_H

const DOWNTOWN_STYLES: Style[] = ['brick', 'darkbrick', 'plaster', 'beige', 'apartment', 'shop', 'office', 'projects']
const CAR_COLORS = ['#a8322b', '#2f5f8f', '#d8d4cc', '#2a2a2e', '#c9a23a', '#3f7a3a', '#7a7f86']
const GROUND = {
  downtown: { lot: U.walk, park: U.grass, plaza: U.plazaTiles },
  industrial: { lot: PB.floorWorn, park: U.grass, plaza: PB.concrete },
  paintball: { lot: PB.dirt, park: PB.turf, plaza: PB.planks },
  cyber: { lot: CY.panel, park: CY.gridLime, plaza: CY.fineGrid },
  suburbs: { lot: U.walk, park: U.grass, plaza: U.plazaTiles },
  docks: { lot: PB.concrete, park: U.grass, plaza: PB.diamond },
  construction: { lot: PB.dirt, park: U.grass, plaza: PB.concrete },
  military: { lot: PB.sand, park: PB.dirt, plaza: PB.concrete },
} as const
const HILL_TEX = TERRAIN_TEX

interface Block { x0: number; x1: number; z0: number; z1: number }
const mid = (b: Block): [number, number] => [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2]

export function neighbourhood(c: HoodContext): HoodResult {
  const { o, look, r, W, D, strip } = c
  const terrain = o.terrain !== false
  const small = W < 110
  const RW = small ? 12 : 14, SW = small ? 4 : 5, C = RW + 2 * SW
  const band = terrain ? (small ? 12 : 20) : 3
  const xL = W / 2 - band
  const zEnd = D / 2 - strip
  const zb = zEnd - C / 2
  const back = zb - C >= 30
  const xs = xL - C / 2 >= 56 ? [-Math.round(W * 0.18), Math.round(W * 0.18)] : [0]
  const tex = GROUND[o.setting]
  const half: Part[] = []
  const weapons: [string, Vec3][] = []

  // ---- streets: an avenue across the middle, back streets in front of the spawns, cross streets joining them.
  const zz = back ? zb : zEnd
  const lines: Polyline[] = [[[-xL, 0], [xL, 0]], ...xs.map((x): Polyline => [[x, -zz], [x, zz]])]
  if (back) lines.push([[-xL, -zb], [xL, -zb]], [[-xL, zb], [xL, zb]])
  // One road object, editable afterwards with the Road tool like a drawn one.
  const params = { path: formatPath(lines), width: RW, walk: SW, lines: o.setting === 'downtown' ? 'double' : 'dashed', lamps: small ? 26 : 32, crossings: 'yes' }
  const road = buildRoad(lines, roadOptions(params), 1)
  const centre = tagPrefab(roadPrefabParts(0, 0, 0, 1, params), 'road', params, [0, 1, 0], 0)

  // ---- blocks on red's half, between the streets.
  const cols: [number, number][] = []
  let a = -xL
  for (const x of xs) { cols.push([a, x - C / 2]); a = x + C / 2 }
  cols.push([a, xL])
  const z0 = back ? -zb + C / 2 : -zEnd, z1 = -C / 2
  const blocks: Block[] = cols.map(([x0, x1]) => ({ x0, x1, z0, z1 }))
  const roles: ('build' | 'park')[] = blocks.length === 3 ? (r.chance(0.7) ? ['build', 'park', 'build'] : ['park', 'build', 'build']) : (r.chance(0.5) ? ['build', 'park'] : ['park', 'build'])

  blocks.forEach((b, i) => (roles[i] === 'park' ? park(b) : buildings(b)))

  function buildings(b: Block) {
    const bw = b.x1 - b.x0, bd = b.z1 - b.z0
    const [cx] = mid(b)
    half.push(box('Lot', [bw, WALK_H, bd], [cx, 1, (b.z0 + b.z1) / 2], tex.lot, PB.concrete, 0, 6))
    const fd = Math.max(12, Math.min(20, Math.round(bd * 0.42)))
    const fz = b.z1 - 1 - fd / 2
    // Street front: two buildings with an alley between them, or one with room round it.
    const fronts: [number, number][] = bw >= 34 ? (() => { const w = Math.floor((bw - 2 - 6) / 2); return [[b.x0 + 1 + w / 2, w], [b.x1 - 1 - w / 2, w]] })() : [[cx, bw - 8]]
    const walkInAt = r.chance(o.setting === 'cyber' || o.setting === 'paintball' ? 0.25 : 0.45) ? r.int(0, fronts.length - 1) : -1
    fronts.forEach(([x, w], k) => {
      if (k === walkInAt) {
        const key = fd >= 14 && w >= 14 ? r.pick(['twostory', 'room']) : 'room'
        const made = c.walkIn(key, x, fz, w, fd, { style: r.pick(['brick', 'plaster', 'concrete']) }, LOT_Y)
        if (made.length) { half.push(...made); weapons.push([r.pick(['pump_action_shotgun', 'ak47', 'tec9']), [x, LOT_Y, fz]]); return }
      }
      half.push(...block(x, fz, w, fd, 'S'))
    })
    if (fronts.length === 2) {
      // The alley: a dumpster against one wall, light clutter.
      const ax = (b.x0 + b.x1) / 2
      half.push(...dumpster(ax, fz - fd / 2 + 4, 90, LOT_Y))
    }
    // Back row facing the back street, if the block is deep enough; a yard between.
    const yardFrom = b.z0, yardTo = b.z1 - 2 - fd
    let yardZ = (yardFrom + yardTo) / 2
    if (back && bd - fd - 2 >= 26) {
      const bd2 = Math.min(16, bd - fd - 14)
      const w2 = Math.round(bw * 0.55)
      half.push(...block(cx + r.pick([-1, 1]) * (bw - w2) / 2 * 0.6, b.z0 + 1 + bd2 / 2, w2, bd2, 'N'))
      yardZ = (b.z0 + 2 + bd2 + yardTo) / 2
    }
    // The yard: open ground with a couple of trees, a weapon to fight over.
    if (yardTo - yardFrom >= 8) {
      weapons.push([r.pick(['ak47', 'pump_action_shotgun', 'm16', 'molotov']), [Math.round(cx + r.range(-4, 4)), LOT_Y, Math.round(yardZ)]])
      if (o.setting !== 'cyber') half.push(...tree(b.x0 + 3, yardFrom + 3, LOT_Y, 0.9), ...tree(b.x1 - 3, yardFrom + 3, LOT_Y, 0.9, r.chance(0.3)))
    } else {
      // No room for a yard: something worth running for at the alley's mouth, or beside the building.
      const wx = fronts.length === 2 ? (b.x0 + b.x1) / 2 : b.x0 + 2
      weapons.push([r.pick(['tec9', 'pump_action_shotgun', 'molotov']), [Math.round(wx), LOT_Y, Math.round(b.z1 - 2)]])
    }
  }

  /** One building: a detailed facade in town, the setting's own structure elsewhere. */
  function block(x: number, z: number, w: number, d: number, front: 'S' | 'N'): Part[] {
    const h = c.height()
    if (o.setting === 'downtown') return building({ x, z, w, d, h, y: LOT_Y, style: r.pick(DOWNTOWN_STYLES), front })
    if (o.setting === 'industrial' && r.chance(0.5)) return building({ x, z, w, d, h: Math.max(8, Math.min(h, 14)), y: LOT_Y, style: 'warehouse', front })
    return look.structure(r, x, z, w, d, h)
  }

  function park(b: Block) {
    const bw = b.x1 - b.x0, bd = b.z1 - b.z0
    const [cx, cz] = mid(b)
    if (terrain) {
      // A raised plaza: a grassy mound with a paved, level top and walkable slopes all round.
      const ramp = Math.max(4, Math.min(9, (Math.min(bw, bd) - 12) / 2))
      // Gentle enough that the smoothstep's steepest part stays under the walkable limit.
      const P = Math.min(3, (ramp - 1.5) * 0.45)
      const s = terrainShape(bw, bd, { base: WALK_H, cell: 2, tile: 8 })
      const sm = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u) }
      const mound = shapeTerrain(s, (x, z) => {
        const ex = bw / 2 - Math.abs(x), ez = bd / 2 - Math.abs(z)
        return P * sm((Math.min(ex, ez) - 1.5) / (ramp - 1.5))
      })
      half.push({ label: 'Park', kind: 'terrain', size: mound.size, at: [cx, 1, cz], top: tex.park, side: HILL_TEX.dirt, rock: HILL_TEX.rock, tile: 8, cells: mound.cells, heights: mound.heights })
      const pw = Math.max(6, bw - 2 * ramp - 1), pd = Math.max(6, bd - 2 * ramp - 1)
      const top = LOT_Y + P
      half.push(box('Plaza', [pw, 0.3, pd], [cx, top, cz], tex.plaza, PB.concrete, 0, 6))
      const key = look.centre.find((k) => ALL_PREFABS[k] && pw >= 14 && pd >= 14 && r.chance(0.7))
      const piece = key ? tagPrefab(ALL_PREFABS[key].make(cx, cz, 0, top + 0.3, prefabParams(ALL_PREFABS[key])), key, prefabParams(ALL_PREFABS[key]), [cx, top + 0.3, cz], 0) : []
      half.push(...piece)
      // The prize on top, wherever the centrepiece leaves room.
      const y = +(top + 0.3).toFixed(2)
      const spot = ([[pw / 2 - 2.5, 0], [-pw / 2 + 2.5, 0], [0, pd / 2 - 2.5], [0, -pd / 2 + 2.5], [pw / 2 - 2.5, pd / 2 - 2.5], [-pw / 2 + 2.5, -pd / 2 + 2.5]] as const)
        .map(([dx, dz]): Vec3 => [Math.round(cx + dx), y, Math.round(cz + dz)]).find((p) => !blocker(piece, p))
      if (spot) weapons.push([r.pick(c.high), spot])
      // Trees in the corners, on the flat rim.
      if (o.setting !== 'cyber') for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) half.push(...tree(cx + sx * (bw / 2 - 2.5), cz + sz * (bd / 2 - 2.5), LOT_Y + (heightAt(mound, sx * (bw / 2 - 2.5), sz * (bd / 2 - 2.5)) ?? 0), 0.9, r.chance(0.3)))
      return
    }
    half.push(box('Lawn', [bw, WALK_H, bd], [cx, 1, cz], tex.park, PB.concrete, 0, 6))
    // Gravel paths crossing the lawn, a pond in one quarter, trees and benches round the edge.
    half.push(box('Path', [bw, 0.02, 3], [cx, LOT_Y, cz], PB.gravel, PB.gravel, 0, 4), box('Path', [3, 0.02, bd], [cx, LOT_Y, cz], PB.gravel, PB.gravel, 0, 4))
    const qx = cx + r.pick([-1, 1]) * bw / 4, qz = cz + r.pick([-1, 1]) * bd / 4
    if (Math.min(bw, bd) >= 26 && o.setting !== 'cyber') half.push({ ...blob('Pond', organic(bw / 2 - 6, bd / 2 - 6, r.int(1, 99)), 0.05, [qx, LOT_Y, qz], U.water, U.water, 8), water: true })
    if (o.setting !== 'cyber') for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) half.push(...tree(cx + sx * (bw / 2 - 3), cz + sz * (bd / 2 - 3), LOT_Y, 1, r.chance(0.3)))
    half.push(...bench(cx + 5, cz + 3, 0, LOT_Y), ...bench(cx - 5, cz - 3, 180, LOT_Y))
    weapons.push([r.pick(c.high), [Math.round(cx - r.pick([-1, 1]) * bw / 4), LOT_Y, Math.round(cz - r.pick([-1, 1]) * bd / 4)]])
  }

  // ---- a pickup out on the avenue, between the side wall and the first junction.
  const streetGun: [number, number] = [Math.round((-xL + Math.min(...xs) - C / 2) / 2), -1]
  weapons.push([r.pick(['tec9', 'molotov', 'pipe_bomb']), [streetGun[0], 1, streetGun[1]]])

  // ---- parked cars in the kerb lanes on red's half, clear of the junctions.
  const lane = RW / 2 - 2.2
  const spots: [number, number, number][] = [[streetGun[0], streetGun[1], 0]]
  const clear = (v: number, centres: number[]) => centres.every((q) => Math.abs(v - q) > C / 2 + 7)
  for (let k = 0; k < 40 && spots.length < (small ? 2 : 4); k++) {
    const onAvenue = r.chance(0.6) || !xs.length
    const s: [number, number, number] = onAvenue
      ? [Math.round(r.range(-xL + 6, xL - 6)), -lane, 90]
      : [xs[r.int(0, xs.length - 1)] - lane, Math.round(r.range(-zz + 6, -C / 2 - 6)), 0]
    if (onAvenue ? !clear(s[0], xs) : !clear(s[1], back ? [0, -zb] : [0])) continue
    if (spots.some(([x, z]) => Math.hypot(x - s[0], z - s[1]) < 12)) continue
    spots.push(s)
  }
  if (o.setting === 'downtown' || o.setting === 'industrial') for (const [x, z, rot] of spots.slice(1)) half.push(car(x, z, rot + r.pick([0, 180]), r.pick(CAR_COLORS), r.int(1, 99)))

  // ---- hills along the side walls: one strip per side, spanning the whole depth, turned for the other side.
  let wallH = look.wallH
  if (terrain) {
    const Hmax = small ? 6 : 9
    const s = terrainShape(band, D, { base: WALK_H, cell: 2, tile: 8 })
    const noise = hills(o.seed % 997, 18)
    const ease = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u) }
    const hill = shapeTerrain(s, (x, z) => {
      // 0 at the inner edge (local +X, toward the middle), rising to the wall; bumps vary along it.
      const u = (band / 2 - x) / band
      return Hmax * ease((u - 0.1) / 0.9) ** 1.2 * (0.7 + 0.6 * noise(x, z))
    })
    const hx = -W / 2 + band / 2
    // Walls stand well above the hilltops, so nobody jumps out of the map.
    wallH = Math.max(wallH, Math.ceil(peak(hill)) + 7)
    half.push({ label: 'Hills', kind: 'terrain', size: hill.size, at: [hx, 1, 0], top: HILL_TEX.grass, side: HILL_TEX.dirt, rock: HILL_TEX.rock, tile: 8, cells: hill.cells, heights: hill.heights })
    // Pines up the slopes.
    if (o.setting !== 'cyber') for (let k = 0; k < (small ? 3 : 5); k++) {
      const lx = band / 2 - band * r.range(0.45, 0.8), lz = -D / 2 + (D * (k + 0.5)) / (small ? 3 : 5) + r.range(-4, 4)
      half.push(...tree(hx + lx, lz, LOT_Y + (heightAt(hill, lx, lz) ?? 0) - 0.2, r.range(0.9, 1.3), true))
    }
  }

  // Lamp lights: every other lamp, up to 24.
  const lights = road.lights.filter((_, k) => k % 2 === 0).slice(0, 24)
  return { half, centre, weapons, lights, wallH }
}

