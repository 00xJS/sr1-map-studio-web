// Automatic minimaps. On export (unless the user picked an image) the editor
// renders the map straight down over a square area and hands that image and
// the area to the exporter, which points the map's minimap region at them.
//
// How the game places the image: a minimap region in the map's bbchunk gives
// a rectangle and a texture; the image is stretched over that rectangle with
// image right = game -X and image down = game +Z. The exporter mirrors X
// (game X = -editor X), so in editor space that is +X right, +Z down. The
// HUD and the pause map both use the region when its pause-map flag is set.
import type { Project } from './project'
import { storeFile } from './files'

/** Empty space round the map's footprint, in game metres per side. */
export const MINIMAP_PAD_M = 3

/** [minX, minZ, maxX, maxZ] in editor units. */
export type MinimapRect = [number, number, number, number]

export interface MinimapSource {
  rect(padUnits: number): MinimapRect | null
  capture(o: { size: number; rect: MinimapRect; mirror?: boolean }): Promise<Blob | null>
}

export const minimapMode = (p: Project): 'auto' | 'custom' => p.settings.minimap_mode ?? (p.settings.minimap_texture ? 'custom' : 'auto')

export const minimapPad = (p: Project) => MINIMAP_PAD_M / (p.settings.world_scale || 0.5)

/**
 * The project as the exporter should see it: with the area the minimap covers
 * and, for an automatic minimap, a freshly rendered image of that area.
 */
export async function withAutoMinimap(project: Project, src: MinimapSource | undefined, log?: (t: string) => void): Promise<Project> {
  const s = project.settings
  const rect = src && project.scene_items.length ? src.rect(minimapPad(project)) : null
  if (!rect) return project
  if (minimapMode(project) !== 'auto') return { ...project, settings: { ...s, minimap_rect: rect } }
  const blob = await src!.capture({ size: 1024, rect, mirror: !s.mirror_x })
  if (!blob) return project
  const stored = await storeFile(new File([blob], 'minimap.png', { type: 'image/png' }), 'minimap.png')
  const ws = s.world_scale || 0.5
  log?.(`Minimap: rendered from above, ${Math.round((rect[2] - rect[0]) * ws)} × ${Math.round((rect[3] - rect[1]) * ws)} m.`)
  return { ...project, files: { ...project.files, [stored.vpath]: stored.ref }, settings: { ...s, minimap_texture: stored.vpath, minimap_rect: rect } }
}
