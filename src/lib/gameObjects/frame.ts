// The frame of a Game pieces map (its ground, outer walls, raised decks and the walls a layout draws) stays simple
// shapes, but wears the game's own surfaces from the player's files: Stilwater's asphalt, sidewalk, dirt and sand on
// the ground, its concrete, cinder block and seawall on the walls. With the game's models everywhere else, nothing in
// the map is the site's own. Like the models, the pictures are game files (origin 'game'): kept on this device,
// never shared.
import type { Part, Tex } from '../sampleKit'
import type { WizardSetting } from '../mapWizard'
import type { GameObjectEntry } from './indexer'

export interface FrameLook {
  ground?: Tex
  wall?: Tex
  wallTop?: Tex
  deckTop?: Tex
  deckSide?: Tex
  /** Streets, sidewalks, grass, rock and road markings (the neighbourhood's roads and hills). */
  road?: Tex
  walk?: Tex
  grass?: Tex
  rock?: Tex
  cross?: Tex
  line?: Tex
}

type Slot = keyof FrameLook
type SettingSlot = 'ground' | 'wall' | 'wallTop' | 'deckTop' | 'deckSide'

/** The same in every setting. */
const COMMON: Record<Exclude<Slot, SettingSlot>, string[]> = {
  road: ['ter_street02_co', 'ter_asphalt01_co', 'ter_street01_co'],
  walk: ['ter_sidewlk03_co', 'ter_newsidewk02_co', 'mp_sidewlk04_co'],
  grass: ['gegrass01_gs', 'gegrass02_gs', 'jpgrass01_gs'],
  rock: ['ter_cliffrock01_co', 'cccliffrock01d_co'],
  cross: ['ter_xwalk01_co'],
  line: ['ter_whitestrp_co', 'ter_whitedsh_co'],
}

/** The game's textures for each part of the frame, per setting, best first (the first the library has is used). */
const PREFS: Record<WizardSetting, Record<SettingSlot, string[]>> = {
  downtown: {
    ground: ['ter_asphalt01_co', 'ter_street02_co', 'ter_asphalt02_co', 'ter_concrete03_co'],
    wall: ['ccwall1base1d_co', 'concretea01_co', 'cinderblocka01_co'], wallTop: ['ter_concrete03_co', 'concreteb01_co'],
    deckTop: ['ter_concrete03_co', 'concreteb01_co'], deckSide: ['concretea01_co', 'cinderblocka01_co'],
  },
  industrial: {
    ground: ['ter_concrete05_co', 'ter_asphalt04_co', 'concreteb01_co'],
    wall: ['sheetmetalpanel_me', 'cinderblocka01_co', 'concretea01_co'], wallTop: ['ter_concrete05_co', 'concreteb01_co'],
    deckTop: ['ter_concrete05_co', 'concreteb01_co'], deckSide: ['rusty_metal-01_me', 'sheetmetalpanel_me', 'concretea01_co'],
  },
  rundown: {
    ground: ['ter_asphalt04_co', 'ter_street03_co', 'ter_asphalt01_co'],
    wall: ['oldbricka01_co', 'cinderblocka01_co', 'concretea01_co'], wallTop: ['ter_concrete02_co', 'concreteb01_co'],
    deckTop: ['dock_wood1_wo', 'ter_concrete02_co'], deckSide: ['oldbricka01_co', 'cinderblocka01_co'],
  },
  suburbs: {
    ground: ['gegrass01_gs', 'gegrass02_gs', 'jpgrass01_gs'],
    wall: ['ccwall1base1d_co', 'concretea01_co'], wallTop: ['ter_concrete03_co', 'concreteb01_co'],
    deckTop: ['dock_wood1_wo', 'ter_concrete03_co'], deckSide: ['concretea01_co', 'cinderblocka01_co'],
  },
  docks: {
    ground: ['ter_concrete05b_co', 'ter_concrete05_co', 'ter_concrete03_co'],
    wall: ['ter_seawall_co', 'concretea01_co'], wallTop: ['ter_concrete05_co', 'concreteb01_co'],
    deckTop: ['dock_wood1_wo', 'ter_concrete05_co'], deckSide: ['rusty_metal-01_me', 'ter_seawall_co'],
  },
  construction: {
    ground: ['ter_dirta01_gv', 'ccdirta_gv', 'ter_gravela01_gv'],
    wall: ['cinderblocka01_co', 'concretea01_co'], wallTop: ['ter_concrete02_co', 'concreteb01_co'],
    deckTop: ['dock_wood1_wo', 'ter_concrete02_co'], deckSide: ['concretea01_co', 'cinderblocka01_co'],
  },
  military: {
    ground: ['ter_sand01_sa', 'mbsand', 'ter_dirta01_gv'],
    wall: ['concretea01_co', 'b36_concrete_gr_co', 'cinderblocka01_co'], wallTop: ['ter_concrete03_co', 'concreteb01_co'],
    deckTop: ['ter_concrete03_co', 'concreteb01_co'], deckSide: ['concretea01_co', 'cinderblocka01_co'],
  },
  paintball: {
    ground: ['gegrass01_gs', 'ter_dirta01_gv'],
    wall: ['dock_wood1_wo', 'concretea01_co'], wallTop: ['dock_wood1_wo', 'concreteb01_co'],
    deckTop: ['dock_wood1_wo'], deckSide: ['dock_wood1_wo', 'concretea01_co'],
  },
  cyber: { ground: [], wall: [], wallTop: [], deckTop: [], deckSide: [] },
}

const stem = (t: string) => t.toLowerCase().replace(/\.[^.]+$/, '')

/** The frame's textures for a setting, from the models in the library that carry them (the lightest of each). */
export function frameLook(entries: GameObjectEntry[], setting: WizardSetting): FrameLook {
  const prefs: Record<Slot, string[]> = { ...COMMON, ...PREFS[setting] }
  const wanted = new Set(Object.values(prefs).flat())
  const carrier = new Map<string, { e: GameObjectEntry; tex: string }>()
  for (const e of entries) for (const t of e.tex) {
    const s = stem(t)
    if (!wanted.has(s)) continue
    const had = carrier.get(s)
    if (!had || e.tris < had.e.tris) carrier.set(s, { e, tex: t.toLowerCase() })
  }
  const out: FrameLook = {}
  for (const [slot, names] of Object.entries(prefs) as [Slot, string[]][]) {
    const c = names.map((n) => carrier.get(n)).find(Boolean)
    if (c) out[slot] = { game: c.e.id, tex: c.tex }
  }
  return out
}

/** Whether a texture is one of the game's (a frame surface). */
export const isGameTex = (t: Tex) => 'game' in t

const isLogoWall = (t: Tex | undefined) => !!t && 'lib' in t && t.lib === 'saints_reborn_wall'

/**
 * The frame's shapes by label, and the game surfaces they wear: [top, side]. `must`: kept even when the library has
 * none of the textures (the map needs its ground, outer walls and decks), in the site's look.
 */
const FRAME: Record<string, { top: Slot; side: Slot; rock?: Slot; must?: boolean }> = {
  Ground: { top: 'ground', side: 'wallTop', must: true },
  Wall: { top: 'wallTop', side: 'wall', must: true },
  'Yard wall': { top: 'wallTop', side: 'wall', must: true },
  'Maze wall': { top: 'wallTop', side: 'wall', must: true },
  'Ring wall': { top: 'wallTop', side: 'wall', must: true },
  Cover: { top: 'wallTop', side: 'wall', must: true },
  Platform: { top: 'deckTop', side: 'deckSide', must: true },
  Ramp: { top: 'deckTop', side: 'deckSide', must: true },
  Hills: { top: 'grass', side: 'rock', rock: 'rock', must: true },
  Road: { top: 'road', side: 'wallTop' },
  Junction: { top: 'road', side: 'wallTop' },
  Sidewalk: { top: 'walk', side: 'wallTop' },
  Path: { top: 'walk', side: 'wallTop' },
  Plaza: { top: 'walk', side: 'wallTop' },
  Lot: { top: 'road', side: 'wallTop' },
  Kerb: { top: 'wallTop', side: 'wallTop' },
  Park: { top: 'grass', side: 'wallTop' },
  Lawn: { top: 'grass', side: 'wallTop' },
  Seabed: { top: 'ground', side: 'wallTop', must: true },
  'Quay wall': { top: 'wallTop', side: 'wall', must: true },
  Slipway: { top: 'deckTop', side: 'deckSide', must: true },
  Crosswalk: { top: 'cross', side: 'cross' },
  'Lane dash': { top: 'line', side: 'line' },
  'Edge line': { top: 'line', side: 'line' },
}

/**
 * A Game pieces map with nothing of the site's own in it: the game's models stay, the frame's shapes (ground, walls,
 * decks, streets) wear the game's surfaces, and every other site piece (one no game model could stand in for) is
 * left out. `keep`: other parts to leave as they are (the boxes the passes keep out of).
 */
export function gameOnly(parts: Part[], f: FrameLook, keep: (p: Part) => boolean = () => false): Part[] {
  const out: Part[] = []
  for (const p of parts) {
    // Water keeps its own look: the game draws its water with a shader, not a picture (it exports as the game's own water).
    if (p.game || p.water || keep(p)) { out.push(p); continue }
    // Pieces of the site's prefabs go (a gazebo's floor is no frame), all but the streets' own.
    const slot = FRAME[p.label]
    if (!slot || (p.group && p.prefab?.key !== 'road')) continue
    const top = f[slot.top], side = f[slot.side]
    if (!top || !side) { if (slot.must) out.push(p); continue }
    // Outer walls keep the Saints Reborn logo on their sides, as on every new map; only their tops turn to the game's.
    if (isLogoWall(p.side)) { out.push({ ...p, top }); continue }
    out.push({ ...p, top, side, ...(slot.rock && f[slot.rock] ? { rock: f[slot.rock] } : {}) })
  }
  return out
}

/** The game picture a frame texture names, as a PNG file (read from the player's game files). */
export async function gameTextureFile(t: Extract<Tex, { game: string }>, size = 512): Promise<File> {
  const { entryById, getObject } = await import('./client')
  const { rgbaPng, safe } = await import('./place')
  const e = entryById(t.game)
  if (!e) throw new Error('That game texture is not in the library.')
  const r = await getObject(e, size)
  const i = r.mesh.materials.findIndex((m) => m.toLowerCase() === t.tex)
  const img = r.textures[i]
  if (!img) throw new Error(`The game texture ${t.tex} could not be read.`)
  return rgbaPng(img, safe(stem(t.tex)) + '.png')
}
