// The walk-through's weather preview: where the game stops the rain. The game fades the rain out while the camera
// is inside one of the map's indoor regions (py/regions.py), so the preview does the same with the boxes the
// export writes: Rain blocker and Indoor room markers, and with "Keep interiors dry" on, the boxes py/interiors.py
// puts over the floor under roofs and ceilings (worked out here by the same Python, on the editor's geometry).
import type { Project, Vec3 } from './project'
import { dryInteriors } from './project'
import { REGION_BOXES } from './retailModes'
import { PRESETS } from './gameLight'

/** A rain-stopping box: its bottom middle and size (editor units), turned `yaw` degrees like its marker. */
export interface RainBox { at: Vec3; size: Vec3; yaw: number; dry: boolean }

/** The export's limits (py/regions.py MAX_REGIONS, py/interiors.py BUDGET). */
const MAX_REGIONS = 64
const DRY_BUDGET = 40

/** Whether a lighting preset (lib/gameLight.ts PRESETS) rains, and how hard (0-1). */
export function rainOf(preset: string): number {
  const w = PRESETS.find((p) => p.key === preset)?.weather ?? ''
  return /thunder/i.test(w) ? 1 : /heavy/i.test(w) ? 0.85 : /medium/i.test(w) ? 0.55 : /light rain/i.test(w) ? 0.3 : 0
}

/** The Rain blocker and Indoor room markers' boxes. */
export function markerRainBoxes(p: Pick<Project, 'markers' | 'settings'>): RainBox[] {
  const ws = p.settings.world_scale || 0.5
  return p.markers.filter((m) => m.type in REGION_BOXES).map((m) => ({
    at: m.position, size: (m.size ?? REGION_BOXES[m.type]).map((v) => v / ws) as Vec3, yaw: m.yaw ?? 0, dry: false,
  }))
}

/** Whether `p` (editor units) is inside a box: the region test the game makes with the camera. */
export function insideRain(boxes: RainBox[], p: Vec3): boolean {
  return boxes.some((b) => {
    const t = (b.yaw * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t)
    const dx = p[0] - b.at[0], dz = p[2] - b.at[2]
    // The box's own axes (py/regions.py turns a corner (x, z) to (x c - z s, x s + z c)).
    const x = dx * c + dz * s, z = -dx * s + dz * c
    return Math.abs(x) <= b.size[0] / 2 && Math.abs(z) <= b.size[2] / 2 && p[1] >= b.at[1] && p[1] <= b.at[1] + b.size[1]
  })
}

/**
 * The boxes "Keep interiors dry" will add on export, from the map's solid triangles (editor units, 9 floats each);
 * none when it is off. `run` hands the triangles (metres) to py/web_api.py dry_boxes and returns its boxes.
 */
export async function dryRainBoxes(p: Pick<Project, 'markers' | 'settings'>, tris: Float32Array,
  run: (metres: Float32Array) => Promise<[Vec3, Vec3][]>): Promise<RainBox[]> {
  if (!dryInteriors(p.settings) || !tris.length) return []
  const ws = p.settings.world_scale || 0.5
  const metres = tris.map((v) => v * ws)
  const room = Math.max(0, Math.min(DRY_BUDGET, MAX_REGIONS - markerRainBoxes(p).length))
  return (await run(metres)).slice(0, room).map(([lo, hi]) => ({
    at: [(lo[0] + hi[0]) / 2 / ws, lo[1] / ws, (lo[2] + hi[2]) / 2 / ws] as Vec3,
    size: [(hi[0] - lo[0]) / ws, (hi[1] - lo[1]) / ws, (hi[2] - lo[2]) / ws] as Vec3, yaw: 0, dry: true,
  }))
}
