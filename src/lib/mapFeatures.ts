// Map extras added at export (see py/map_features.py, which writes them):
// background sound borrowed from one of the game's own multiplayer maps,
// stock breakable / weight presets for native objects, and the picture shown
// while the map loads. None of these has been tried in game yet.
import type { Project, SceneItem } from './project'
import { storeFile } from './files'

/**
 * Background sound: the sound file of one of the game's own multiplayer maps,
 * included by name (the sounds stay in the player's game; nothing is shipped).
 * `even` = that map's file is one big sound bed, so it sounds the same all
 * over your map; otherwise its smaller sound spots land at random places.
 */
export const AMBIENCE_OPTIONS: { file: string; label: string; even: boolean }[] = [
  { file: 'amb_mp_arena', label: 'The Ultor Dome (mp_arena)', even: true },
  { file: 'amb_mp_bac_01', label: 'The Corner (mp_bac_01)', even: false },
  { file: 'amb_mp_bac_03', label: 'Hotwired (mp_bac_03)', even: false },
  { file: 'amb_mp_bor_01', label: 'The Barrio (mp_bor_01)', even: false },
  { file: 'amb_mp_bor_02', label: "Hustlin' (mp_bor_02)", even: false },
  { file: 'amb_mp_bor_03', label: 'The Ultor Dome, Blinged Out Ride (mp_bor_03)', even: true },
  { file: 'amb_mp_coop_delivery', label: 'Mob Rule (mp_coop_delivery)', even: false },
  { file: 'amb_mp_coop_gauntlet', label: 'Turbulence (mp_coop_gauntlet)', even: false },
  { file: 'amb_mp_ptp_01', label: 'Crunch Time (mp_ptp_01)', even: true },
  { file: 'amb_mp_ptp_02', label: 'Holding Pattern (mp_ptp_02)', even: false },
  { file: 'amb_mp_ptp_03', label: 'Code Blue (mp_ptp_03)', even: true },
  { file: 'amb_mplobby_01', label: 'Multiplayer lobby (mplobby_01)', even: false },
]

export const ambienceHint = (file: string | undefined) => {
  const o = AMBIENCE_OPTIONS.find((x) => x.file === file)
  if (!o) return 'No background sound, like other custom maps.'
  return (o.even ? 'One sound bed that covers your whole map. ' : "That map's sound spots play at random places in yours. ")
    + 'Borrowed from your game when the map loads. New: not yet tried in game.'
}

/** Stock profiles a movable prop can use (weight presets). Health and weight come with the profile. */
export const MOVABLE_PRESETS: [profile: string, label: string][] = [
  ['Crate Small', 'Crate, 20 lb'],
  ["Wood Object 0.5'x0.5'x0.5'", 'Small wood block, 3 lb'],
  ["Wood Object 1'x1'x1'", 'Wood block, 10 lb'],
  ["Wood Object 2'x2'x2'", 'Big wood block, 35 lb'],
  ["Cardboard Box  0.5'x0.5'x0.5'1", 'Small cardboard box, 5 lb'],
  ["Cardboard Box  1'x1'x1'", 'Cardboard box, 15 lb'],
  ["Cardboard Box  4'x4'x4'", 'Big cardboard box, 200 lb'],
  // Physics-prop behaviours (see physicsProps.ts).
  ['Tire', 'Rolls and bounces (tire), 10 lb'],
  ['Red Ball', 'Very bouncy ball that cannot break, 4 lb'],
  ['SoccerBall', 'Soccer ball, 5 lb'],
  ["Iron Object 1'x1'x1'", 'Metal block, 10 lb'],
  ['Trashcan', 'Trash can that cannot break, 50 lb'],
  ['CableSpool', 'Heavy cable spool, 500 lb'],
  ['Log Timber', 'Very heavy log that only cars and blasts move, 2000 lb'],
]

/** The game's wooden crate: smashes into boards and dust, with its debris read from the player's game files at export. */
export const CRATE_PROFILE = 'CrateFruit'

/** Stock profiles that make a "breakable wood" object break (it disappears; only the crate leaves debris). */
export const BREAKING_PRESETS: [profile: string, label: string][] = [
  ['Can', 'Breaks when shot (like a can), 7 lb'],
  ['SofaPillow', 'Breaks only from explosions, 4 lb'],
  ['Normal Glass Moveable', 'Fragile: breaks at the first hit, 1 lb'],
  [CRATE_PROFILE, 'Wooden crate: smashes into boards (explosions, cars), 20 lb'],
]

/** Plain-language hint for the swimmable water setting. */
export const waterHint = (it: Pick<SceneItem, 'water_materials'>) => it.water_materials?.length
  ? 'Its water part becomes water players can swim in: no collision, see-through, the water surface at its top and at least 2 m deep. Not yet tried in game.'
  : 'Players can swim in it: it loses its collision, turns see-through, and its top is the water surface (at least 2 m deep). Use a box that fills a basin; water outside a basin just sits on the ground. Not yet tried in game.'

// ---------------- loading screen ----------------

export const LOADING_SIZE = [1280, 720] as const

export type LoadingMode = 'auto' | 'custom' | 'none'
export const loadingMode = (p: Project): LoadingMode => p.settings.loading_mode ?? 'auto'

/** Turns any picture the browser can draw into a PNG (the exporter's image reader may not know WebP). */
async function toPng(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  return canvas.convertToBlob({ type: 'image/png' })
}

/**
 * The user's own loading picture, kept at its own shape (the exporter crops it
 * to 16:9 and sizes it to 1280×720). Pictures the browser can draw are stored
 * as PNG; TGA, DDS and TIFF pass through for the exporter to read.
 */
export async function loadingPicture(file: File): Promise<File> {
  if (!/\.(png|jpe?g|bmp|gif|webp)$/i.test(file.name)) return file
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const k = Math.min(1, 2560 / Math.max(bmp.width, bmp.height))
    const canvas = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k))
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return new File([await canvas.convertToBlob({ type: 'image/png' })], 'loading.png', { type: 'image/png' })
  } finally { bmp.close() }
}

/**
 * The project as the exporter should see it: `loading_image` set to the
 * picture to use, rendered from the 3D view in automatic mode, or cleared
 * when the map should have none.
 */
export async function withLoadingScreen(project: Project, capture: ((w: number, h: number) => Promise<Blob | null>) | undefined, log?: (t: string) => void): Promise<Project> {
  const s = project.settings
  const mode = loadingMode(project)
  if (mode === 'custom') return project
  if (mode === 'none' || !capture || !project.scene_items.length) return { ...project, settings: { ...s, loading_image: '' } }
  const shot = await capture(LOADING_SIZE[0], LOADING_SIZE[1])
  if (!shot) return { ...project, settings: { ...s, loading_image: '' } }
  const stored = await storeFile(new File([await toPng(shot)], 'loading.png', { type: 'image/png' }), 'loading.png')
  log?.('Loading screen: rendered from the 3D view as it is now.')
  return { ...project, files: { ...project.files, [stored.vpath]: stored.ref }, settings: { ...s, loading_image: stored.vpath } }
}
