// A new map from a rectangle of the city: the cut-out as two models from the player's own game files (what's
// solid, and the look-only detail with collision off, as in the game), boundary walls and a safety floor so
// nobody walks or falls off the cut edge, and spawns and weapons spread over the open street level.
import { newMarker, newProject, type Marker, type Project, type Vec3 } from '../project'
import { box, PB, type Part } from '../sampleKit'
import { materialize, skyFile } from '../samples'
import { catalogs } from '../catalogs'
import { storeObject } from '../gameObjects/place'
import { workerCityCut } from '../gameObjects/client'
import type { CityMap, ObjectResult } from '../gameObjects/worker'
import { chunksIn, type Rect } from './city'

/** Biggest side of an area (metres): the game's own multiplayer maps are 45 to 120 m across. */
export const MAX_SIDE = 300
const WEAPONS = ['ak47', 'pump_action_shotgun', 'tec9', 'sniper_rifle', 'mac10', 'pipe_bomb', 'beretta', 'molotov', 'rpg_launcher', 'magnum']

/** Only the materials a mesh's triangles use (the cut's two meshes share one list). */
function compact(r: ObjectResult): ObjectResult {
  const used = [...new Set(r.mesh.triMaterial)].sort((a, b) => a - b)
  const to = new Map(used.map((m, i) => [m, i]))
  return {
    mesh: { ...r.mesh, triMaterial: r.mesh.triMaterial.map((m) => to.get(m)!), materials: used.map((m) => r.mesh.materials[m]) },
    textures: used.map((m) => r.textures[m]),
  }
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
  onProgress('Saving the city pieces on this device…')
  const items = []
  for (const [mesh, label, tag, look] of [[cut.solid, name, '', false], [cut.look, name + ' detail', '_look', true]] as const) {
    if (!mesh.mesh.triangles.length) continue
    const s = await storeObject(compact(mesh), label, ws, tag)
    Object.assign(p.files, s.files)
    items.push({
      uid: crypto.randomUUID(), name: label, path: s.path, source_path: s.path, position: [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3, scale: 1,
      textures: s.textures, alpha: s.alpha, surface_ids: s.surface_ids, physics_intent: 'Static', triangles: s.triangles,
      // Decals, grass and far detail: drawn, not solid, as the game has them.
      ...(look ? { collision_disabled: true } : {}),
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
