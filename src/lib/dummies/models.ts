// What a decoy dummy can be: the player, dressed as players are in a match, or one of a short list of the game's
// people. Only names and slider values are written here; the meshes and pictures come from the player's own game.
import type { PoseId } from './figure'

/** Where a dummy came from and how it is posed and dressed: enough to build it again from anyone's own game. */
export interface DummySpec {
  /** 'player', or a person from NPC_MODELS (their mesh name). */
  model: string
  pose: PoseId
  look: DummyLook
}

export interface DummyLook {
  /** The player's T-shirt colour (TOPS). */
  top?: TopId
  /** Skin tone: the player's three, or a person's light or dark variant. */
  skin?: SkinId
  /** The player's hair colour. */
  hair?: HairId
  /** A person's outfit: which of their alternative pieces they wear (0 = the first of each). */
  outfit?: number
}

// The MP-store T-shirt every new player can buy, in the colours of the game's four gangs (and plain ones).
export const TOPS = {
  black: { label: 'Black (new player)', variant: 'tshirt_black', colour: '#202022' },
  purple: { label: 'Purple (Saints)', variant: 'tshirt_purple', colour: '#5b2a86' },
  yellow: { label: 'Yellow (Vice Kings)', variant: 'tshirt_yellow', colour: '#d8b02a' },
  red: { label: 'Red (Los Carnales)', variant: 'tshirt_red', colour: '#a52525' },
  blue: { label: 'Blue (Westside Rollerz)', variant: 'tshirt_blue', colour: '#2a4f9a' },
  gray: { label: 'Grey', variant: 'tshirt_gray', colour: '#77787a' },
  green: { label: 'Green', variant: 'tshirt_green', colour: '#3c6e35' },
} as const
export type TopId = keyof typeof TOPS

// The creator's Saturation and Luminosity sliders (0-1).
export const SKINS = {
  light: { label: 'Light', saturation: 0.4, luminosity: 0.55, colour: '#d9a78a' },
  medium: { label: 'Medium', saturation: 0.45, luminosity: 0.4, colour: '#a8754f' },
  dark: { label: 'Dark', saturation: 0.5, luminosity: 0.24, colour: '#5c3a26' },
} as const
export type SkinId = keyof typeof SKINS

export const HAIRS = {
  brown: { label: 'Light brown', rgb: [155, 110, 56], lum: 1 },
  black: { label: 'Black', rgb: [40, 32, 28], lum: 1 },
  blonde: { label: 'Blonde', rgb: [214, 178, 112], lum: 1 },
} as const
export type HairId = keyof typeof HAIRS

/** People of the game a dummy can be (their mesh names in cmesh_stream.vpp_xbox2). */
export const NPC_MODELS = {
  'vk_x_m_thug1-01': { label: 'Vice Kings thug', gang: 'yellow' },
  'lc_x_m_thug1-01': { label: 'Los Carnales thug', gang: 'red' },
  'wr_x_m_thug1-01': { label: 'Westside Rollerz thug', gang: 'blue' },
  'ts_x_m_thug1-01': { label: 'Saints thug', gang: 'purple' },
  'ts_x_f_thug-01': { label: 'Saints thug (woman)', gang: 'purple' },
  lw_x_m_officer_01: { label: 'Police officer', gang: 'blue' },
  lw_w_m_swat01: { label: 'SWAT', gang: 'black' },
  'pd_x_m_genericyoung-01': { label: 'Young man', gang: 'gray' },
  'pd_x_f_genericyoung-01': { label: 'Young woman', gang: 'gray' },
  'pd_x_m_businessman-01': { label: 'Businessman', gang: 'black' },
} as const satisfies Record<string, { label: string; gang: TopId }>
export type NpcId = keyof typeof NPC_MODELS

export const PLAYER = 'player'
export const isNpc = (m: string): m is NpcId => Object.hasOwn(NPC_MODELS, m)
export const validModel = (m: unknown): m is string => m === PLAYER || (typeof m === 'string' && isNpc(m))
export const modelLabel = (m: string) => (m === PLAYER ? 'Player' : isNpc(m) ? NPC_MODELS[m].label : m)

/** Most dummies in one map: about a lobby's worth (MP holds 12 players) of extra people to draw. */
export const MAX_DUMMIES = 12
/** More different looks than this cost the map's texture budget noticeably (about 1 MB each). */
export const MANY_LOOKS = 8

/** The look with every choice filled in. */
export function fullLook(model: string, look: DummyLook = {}): Required<DummyLook> {
  const gang = isNpc(model) ? NPC_MODELS[model].gang : 'black'
  return {
    top: look.top && Object.hasOwn(TOPS, look.top) ? look.top : gang,
    skin: look.skin && Object.hasOwn(SKINS, look.skin) ? look.skin : 'light',
    hair: look.hair && Object.hasOwn(HAIRS, look.hair) ? look.hair : 'brown',
    outfit: Number.isInteger(look.outfit) && look.outfit! >= 0 ? look.outfit! : 0,
  }
}

/** The parts of a look that apply to a model (for keys and labels). */
export function lookOf(model: string, look: DummyLook = {}): DummyLook {
  const f = fullLook(model, look)
  return model === PLAYER ? { top: f.top, skin: f.skin, hair: f.hair } : { skin: f.skin === 'dark' ? 'dark' : 'light', outfit: f.outfit }
}

/** Same key for the same model, pose and look (dummies with one key share their files). */
export const specKey = (s: DummySpec) => JSON.stringify([s.model, s.pose, lookOf(s.model, s.look)])
/** Same key for the same look in any pose (for counting different looks). */
export const lookKey = (s: Pick<DummySpec, 'model' | 'look'>) => JSON.stringify([s.model, lookOf(s.model, s.look)])

/** A dummy's name in the object list. */
export function dummyName(s: DummySpec): string {
  const l = fullLook(s.model, s.look)
  const what = s.model === PLAYER ? `player, ${TOPS[l.top].label.replace(/ \(.*\)$/, '').toLowerCase()} top` : modelLabel(s.model).toLowerCase()
  return `Dummy (${what})`
}

/** The colours of the stand-in figure for a look: skin, top, legs, shoes. */
export function standInColours(s: Pick<DummySpec, 'model' | 'look'>) {
  const l = fullLook(s.model, s.look)
  return { skin: SKINS[l.skin].colour, top: TOPS[l.top].colour, legs: '#2b3446', shoes: '#e8e6e0' }
}
