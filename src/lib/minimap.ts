// Automatic minimaps. Without its own image a map keeps the Beaver Creek
// template's minimap, so on export (unless the user picked an image) the
// editor renders the map straight down and hands that image to the exporter.
//
// Layout, from retail Industrial (mp_bac_02) against its geometry: the image
// is north-up with game -X to the right and +Z down. The exporter mirrors X
// (game X = -editor X), so in editor space that is simply +X right, +Z down.
// The image is square and centred on the map's bounds; MINIMAP_SPAN is how
// much wider than the bounds' longer side it reaches.
import type { Project } from './project'
import { storeFile } from './files'

/** Image width over the map bounds' longer side (Industrial: about 100 m of image for 86 m of bounds). */
export const MINIMAP_SPAN = 1.16
/** The exporter pads the bounds by this many game metres on each side. */
export const BOUNDS_PAD_M = 3

export type MinimapCapture = (opts: { size: number; span: number; padUnits: number; mirror?: boolean }) => Promise<Blob | null>

export const minimapMode = (p: Project): 'auto' | 'custom' => p.settings.minimap_mode ?? (p.settings.minimap_texture ? 'custom' : 'auto')

/** The project as the exporter should see it: with a freshly rendered minimap when the map uses an automatic one. */
export async function withAutoMinimap(project: Project, capture: MinimapCapture | undefined, log?: (t: string) => void): Promise<Project> {
  const s = project.settings
  if (minimapMode(project) !== 'auto' || !capture || !project.scene_items.length) return project
  const blob = await capture({ size: 1024, span: MINIMAP_SPAN, padUnits: BOUNDS_PAD_M / (s.world_scale || 0.5), mirror: !s.mirror_x })
  if (!blob) return project
  const stored = await storeFile(new File([blob], 'minimap.png', { type: 'image/png' }), 'minimap.png')
  log?.('Minimap: rendered from above (1024 × 1024).')
  return { ...project, files: { ...project.files, [stored.vpath]: stored.ref }, settings: { ...s, minimap_texture: stored.vpath } }
}
