// Editor commands for terrain and roads: add a terrain, keep a sculpted
// surface, draw a road or add a branch to one, move and remove its points.
import { useEditor, currentProject } from './store'
import { addPrefab, updatePrefab, UserError } from './actions'
import { cacheModel } from '../lib/assets'
import { storeFile } from '../lib/files'
import { referencedPaths, type Project, type Vec3 } from '../lib/project'
import { shapeObj, type Shape } from '../lib/shapes'
import { TERRAIN_TEX, terrainModel, terrainShape } from '../lib/terrain'
import { turn } from '../lib/sampleKit'
import { formatPath, parsePath, type Polyline, type Pt } from '../lib/roads'
import { prefabParams } from '../lib/prefabs'
import { ALL_PREFABS } from '../lib/prefabRegistry'

const log = (t: string) => useEditor.getState().log(t)

/** Adds a flat terrain `size` across at a spot, its surface at the ground height there. */
export async function addTerrain(at: Vec3, groundY: number | null, size = 160) {
  const { materialize } = await import('../lib/samples')
  // A deep slab, so there is ground to dig into: hollows and ditches up to about 2 m.
  const shape = terrainShape(size, size, { base: 4, cell: 4 })
  const y = (groundY ?? 1) - 4
  const { items, files } = await materialize([{
    label: 'Terrain', kind: 'terrain', size: shape.size, at: [at[0], y, at[2]], top: TERRAIN_TEX.grass, side: TERRAIN_TEX.dirt, rock: TERRAIN_TEX.rock,
    tile: shape.tile, cells: shape.cells, heights: shape.heights,
  }])
  const item = items[0]
  // Grass under the other objects' feet would fight with a ground slab at the same height: start a hair above it.
  item.position = [at[0], y + 0.02, at[2]]
  update('Add terrain', (d) => { Object.assign(d.files, files); d.scene_items.push(item) })
  useEditor.getState().select({ kind: 'item', index: currentProject()!.scene_items.length - 1 })
  log(`Added a ${size} × ${size} terrain (${shape.cells![0]} × ${shape.cells![1]} cells). Drag on it with the Terrain tool to raise hills, dig, smooth or level.`)
}

const update = (...a: Parameters<ReturnType<typeof useEditor.getState>['update']>) => useEditor.getState().update(...a)

/** Keeps the result of a sculpt stroke: a new mesh for the terrain, one undo step. */
export async function commitTerrain(index: number, heights: number[]) {
  const it = currentProject()?.scene_items[index]
  if (!it?.shape || it.shape.kind !== 'terrain') return
  const shape: Shape = { ...it.shape, heights: heights.map((v) => +v.toFixed(3)) }
  const text = shapeObj(shape)
  const stored = await storeFile(new Blob([text], { type: 'model/obj' }), 'terrain.obj')
  cacheModel(stored.vpath, terrainModel(shape))
  update('Sculpt terrain', (d) => {
    const x = d.scene_items[index]
    x.shape = shape
    x.path = x.source_path = stored.vpath
    d.files[stored.vpath] = stored.ref
    const live = new Set(referencedPaths(d as Project))
    for (const path of Object.keys(d.files)) if (!live.has(path)) delete d.files[path]
  })
}

// ---------------- roads ----------------

/** A road object's lines in world space (x, z), as drawn. */
export function roadLines(index: number): Polyline[] {
  const it = currentProject()?.scene_items[index]
  if (!it?.prefab || it.prefab.key !== 'road') return []
  const rot = it.rotation[1], s = it.scale || 1
  return parsePath(it.prefab.params.path).map((l) => l.map(([x, z]): Pt => {
    const [ox, oz] = turn(x * s, z * s, rot)
    return [it.position[0] + ox, it.position[2] + oz]
  }))
}

/** World points back into a road's own frame. */
function toLocal(index: number, lines: Polyline[]): Polyline[] {
  const it = currentProject()!.scene_items[index]
  const s = it.scale || 1
  return lines.map((l) => l.map(([x, z]): Pt => { const [lx, lz] = turn(x - it.position[0], z - it.position[2], -it.rotation[1]); return [lx / s, lz / s] }))
}

export const isRoad = (index: number) => currentProject()?.scene_items[index]?.prefab?.key === 'road'

/** A new road from points drawn in world space; settings as chosen in the tool bar. */
export async function addRoad(points: Pt[], y: number, params: Record<string, number | string>) {
  if (points.length < 2) throw new UserError('A road needs at least two points: click along the map, then press Enter.')
  const [ox, oz] = points[0]
  const path = formatPath([points.map(([x, z]): Pt => [x - ox, z - oz])])
  await addPrefab('road', [ox, y, oz], y, { params: { ...prefabParams(ALL_PREFABS.road, params), path } })
}

/** Replaces a road's lines (world space): moved points, a new branch, a removed point. */
export async function setRoadLines(index: number, lines: Polyline[]) {
  const it = currentProject()?.scene_items[index]
  if (!it?.prefab || it.prefab.key !== 'road') return
  const keep = lines.filter((l) => l.length >= 2)
  if (!keep.length) throw new UserError('That would leave the road with no lines. Delete the road instead (Delete key).')
  await updatePrefab(index, { ...it.prefab.params, path: formatPath(toLocal(index, keep)) })
}
