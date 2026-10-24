// A new map from a rectangle of the city: the cut-out as one model per game object, from the player's own game
// files (each placed at its own base, so it can be picked, moved, turned, copied or deleted on its own; its
// look-only parts, decals and grass, keep collision off as in the game), boundary walls and a safety floor so
// nobody walks or falls off the cut edge, and spawns and weapons spread over the open street level.
import { newMarker, newProject, type Marker, type Project, type Vec3 } from '../project'
import { box, PB, type Part } from '../sampleKit'
import { materialize, skyFile } from '../samples'
import { catalogs } from '../catalogs'
import { objText, plain, rgbaPng, safe, stemOf, surfaceOf } from '../gameObjects/place'
import { storeFile } from '../files'
import { parseObj } from '../geometry'
import type { ObjectMesh } from '../gameObjects/extract'
import type { SceneItem } from '../project'
import { workerCityCut } from '../gameObjects/client'
import type { CityCut, CityMap } from '../gameObjects/worker'
import { chunksIn, type Rect } from './city'
import { splitParts } from './parts'

/** Biggest side of an area (metres): the game's own multiplayer maps are 45 to 120 m across. */
export const MAX_SIDE = 300
const WEAPONS = ['ak47', 'pump_action_shotgun', 'tec9', 'sniper_rifle', 'mac10', 'pipe_bomb', 'beretta', 'molotov', 'rpg_launcher', 'magnum']

/** One game object of a cut: its mesh about its own base centre, which triangles are only drawn, and where it goes. */
export interface PieceMesh {
  name: string
  prop: boolean
  /** Materials are indexes into the cut's shared list. */
  mesh: ObjectMesh
  /** Per triangle: 1 when it is look-only (decal, grass, far detail), so it gets no collision. */
  look: Uint8Array
  /** Middle of its footprint at its lowest point (game frame, metres, after the cut's move). */
  base: [number, number, number]
}

/**
 * Splits a cut into its game objects, each with only its own vertices, centred on its base. A building object's
 * windows, doors, posters, signs and trim become objects of their own (parts.ts); props stay whole.
 */
export function splitPieces(cut: Pick<CityCut, 'solid' | 'look' | 'pieces' | 'solidPiece' | 'lookPiece'>): PieceMesh[] {
  const tris: [ObjectMesh, number, boolean][][] = cut.pieces.map(() => [])
  for (const [m, of, look] of [[cut.solid.mesh, cut.solidPiece, false], [cut.look.mesh, cut.lookPiece, true]] as const) {
    for (let t = 0; t < m.triangles.length / 3; t++) tris[of[t]]?.push([m, t, look])
  }
  const materials = cut.solid.mesh.materials
  const out: PieceMesh[] = []
  tris.forEach((list, pi) => {
    if (!list.length) return
    const { name, prop } = cut.pieces[pi]
    const parts = prop ? [{ tris: list.map((_, i) => i), name }] : splitParts(
      Float32Array.from(list.flatMap(([m, t]) => [0, 1, 2].flatMap((k) => { const v = m.triangles[3 * t + k]; return [m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]] }))),
      list.map(([m, t]) => m.triMaterial[t]), (mi) => materials[mi] ?? '', list.map(([, , look]) => (look ? 1 : 0)), name)
    for (const part of parts) out.push(pieceMesh(part.tris.map((i) => list[i]), part.name, prop, materials))
  })
  return out
}

/** One object from its triangles: only the vertices it uses, centred on its base. */
function pieceMesh(list: [ObjectMesh, number, boolean][], name: string, prop: boolean, materials: string[]): PieceMesh {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], mat: number[] = [], look: number[] = []
  const remap = new Map<ObjectMesh, Map<number, number>>()
  for (const [m, t, isLook] of list) {
    let vm = remap.get(m)
    if (!vm) remap.set(m, (vm = new Map()))
    for (let k = 0; k < 3; k++) {
      const v = m.triangles[3 * t + k]
      let n = vm.get(v)
      if (n === undefined) {
        n = pos.length / 3
        vm.set(v, n)
        pos.push(m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2])
        uv.push(m.uvs[2 * v], m.uvs[2 * v + 1])
      }
      idx.push(n)
    }
    mat.push(m.triMaterial[t])
    look.push(isLook ? 1 : 0)
  }
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let i = 0; i < pos.length; i += 3) {
    x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); y0 = Math.min(y0, pos[i + 1]); z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2])
  }
  const base: [number, number, number] = [(x0 + x1) / 2, y0, (z0 + z1) / 2]
  const p = new Float32Array(pos.length)
  for (let i = 0; i < pos.length; i++) p[i] = pos[i] - base[i % 3]
  return {
    name, prop, base, look: new Uint8Array(look),
    mesh: { positions: p, uvs: new Float32Array(uv), triangles: new Uint32Array(idx), triMaterial: new Uint16Array(mat), materials },
  }
}

/** The OBJ face numbers of the look-only triangles: objText writes them grouped by material, in order. */
export function lookFaces(piece: Pick<PieceMesh, 'mesh' | 'look'>, localMat: (m: number) => number): number[] {
  const order = [...Array(piece.look.length).keys()].sort((a, b) => localMat(piece.mesh.triMaterial[a]) - localMat(piece.mesh.triMaterial[b]) || a - b)
  const out: number[] = []
  order.forEach((t, face) => { if (piece.look[t]) out.push(face) })
  return out
}

/** Farthest-point picks: each one as far as it can be from those already taken. */
function spread(points: Vec3[], count: number, taken: Vec3[] = []): Vec3[] {
  const out: Vec3[] = []
  const all = [...taken]
  while (out.length < count && points.length) {
    let best = -1, bestD = -1
    for (const [i, p] of points.entries()) {
      const d = all.length ? Math.min(...all.map((q) => Math.hypot(q[0] - p[0], q[2] - p[2]))) : Math.hypot(p[0], p[2]) + 1
      if (d > bestD) { bestD = d; best = i }
    }
    if (best < 0 || (all.length && bestD < 4)) break
    out.push(points[best]); all.push(points[best])
  }
  return out
}

export const areaName = (r: Rect) => `Stilwater ${Math.round((r.x0 + r.x1) / 2)}, ${Math.round((r.z0 + r.z1) / 2)}`

export async function cityProject(r: Rect, map: CityMap, onProgress: (t: string) => void): Promise<Project> {
  const w = r.x1 - r.x0, d = r.z1 - r.z0
  if (Math.max(w, d) > MAX_SIDE) throw new Error(`Pick an area at most ${MAX_SIDE} m across (this one is ${Math.round(Math.max(w, d))} m).`)
  const stems = chunksIn(map.summaries, r)
  if (!stems.length) throw new Error('There is nothing of the city in that area.')
  onProgress(`Cutting the area out of ${stems.length} part${stems.length === 1 ? '' : 's'} of the city…`)
  const cut = await workerCityCut(r, stems, 512)
  if (!cut.solid.mesh.triangles.length && !cut.look.mesh.triangles.length) throw new Error('There is nothing of the city in that area.')
  const name = areaName(r)
  const p = newProject(name)
  const ws = p.settings.world_scale
  const pieces = splitPieces(cut)
  // Each picture once, shared by every object that uses it.
  onProgress('Saving the city pictures on this device…')
  const mats = cut.solid.mesh.materials
  const matName: string[] = [], used = new Set<string>()
  for (const tex of mats) {
    const b = safe(tex ? stemOf(tex) : 'plain')
    let n = b
    for (let i = 2; used.has(n); i++) n = `${b}_${i}`
    used.add(n)
    matName.push(n)
  }
  const texPath: string[] = []
  for (const m of new Set(pieces.flatMap((pc) => [...pc.mesh.triMaterial]))) {
    const f = await storeFile(await rgbaPng(cut.solid.textures[m] ?? plain(), matName[m] + '.png'), matName[m] + '.png', 'game')
    f.ref.origin = 'game'
    p.files[f.vpath] = f.ref
    texPath[m] = f.vpath
  }
  const items: SceneItem[] = []
  const { cacheModel } = await import('../assets')
  const counts = new Map<string, number>()
  for (const [i, pc] of pieces.entries()) {
    if (i % 25 === 0) onProgress(`Saving the city's objects on this device (${i} of ${pieces.length})…`)
    // Its own short list of materials, in the shared list's order.
    const own = [...new Set(pc.mesh.triMaterial)].sort((a, b) => a - b)
    const local = new Map(own.map((m, k) => [m, k]))
    const mesh: ObjectMesh = { ...pc.mesh, triMaterial: pc.mesh.triMaterial.map((m) => local.get(m)!), materials: own.map((m) => mats[m]) }
    const k = (counts.get(pc.name) ?? 0) + 1
    counts.set(pc.name, k)
    const label = k > 1 ? `${pc.name} ${k}` : pc.name
    const text = objText({ mesh, textures: [] }, ws, own.map((m) => matName[m]), label)
    const obj = await storeFile(new Blob([text], { type: 'model/obj' }), safe(label) + '.obj', 'game')
    obj.ref.origin = 'game'
    p.files[obj.vpath] = obj.ref
    cacheModel(obj.vpath, parseObj(text))
    const faces = lookFaces(pc, (m) => local.get(m)!)
    items.push({
      uid: crypto.randomUUID(), name: label, path: obj.vpath, source_path: obj.vpath,
      // Editor space mirrors X (the exporter mirrors it back); one unit is world_scale metres.
      position: [-pc.base[0] / ws, pc.base[1] / ws, pc.base[2] / ws] as Vec3, rotation: [0, 0, 0] as Vec3, scale: 1,
      textures: Object.fromEntries(own.map((m) => [matName[m], texPath[m]])),
      alpha: Object.fromEntries(own.map((m) => [matName[m], !!cut.solid.textures[m]?.alpha])),
      surface_ids: Object.fromEntries(own.map((m) => [matName[m], surfaceOf(mats[m])])),
      physics_intent: 'Static', triangles: pc.look.length,
      // Decals, grass and far detail: drawn, not solid, as the game has them.
      ...(faces.length === pc.look.length ? { collision_disabled: true } : faces.length ? { collision_excluded_faces: faces } : {}),
    })
  }
  // Walls round the cut edge and a floor under it (editor units; street level is 0).
  const u = (m: number) => m / ws
  const W = u(w), D = u(d), H = u(16), y0 = u(-6)
  const parts: Part[] = [
    box('Boundary wall', [W + 2, H, 1], [0, y0, -D / 2 - 0.5], PB.concrete), box('Boundary wall', [W + 2, H, 1], [0, y0, D / 2 + 0.5], PB.concrete),
    box('Boundary wall', [1, H, D], [-W / 2 - 0.5, y0, 0], PB.concrete), box('Boundary wall', [1, H, D], [W / 2 + 0.5, y0, 0], PB.concrete),
    box('Safety floor', [W, 1, D], [0, y0 - 1, 0], PB.concrete),
  ]
  onProgress('Adding boundary walls…')
  const built = await materialize(parts)
  Object.assign(p.files, built.files)
  p.scene_items = [...items, ...built.items]
  const sky = await skyFile()
  p.files[sky.vpath] = sky.ref
  p.settings.sky_texture = sky.vpath
  // Spawns and weapons on open street level, in editor space (the exporter mirrors X back).
  const spots = cut.standable.map(([x, y, z]): Vec3 => [-u(x), u(y), u(z)])
  const spawns = spread(spots, 12)
  const known = new Set(catalogs.weapons.map(([, id]) => id))
  const weapons = spread(spots, 10, spawns)
  const markers: Marker[] = [
    ...spawns.map((at) => ({ ...newMarker('Shared spawn', [at[0], at[1] + 0.1, at[2]]), yaw: +((Math.atan2(-at[0], at[2]) * 180) / Math.PI).toFixed(1) })),
    ...weapons.map((at, i) => { const id = WEAPONS.filter((x) => known.has(x))[i % WEAPONS.length] ?? 'ak47'; return { ...newMarker('Weapon pickup', [at[0], at[1] + 0.1, at[2]]), weapon: id, label: id } }),
  ]
  p.markers = markers
  p.settings.modes = ['Gangsta Brawl']
  p.settings.display_name = name
  p.settings.base_name = 'stil' + Math.floor(1000 + Math.random() * 9000)
  return p
}
