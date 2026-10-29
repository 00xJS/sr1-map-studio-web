// How a decoy dummy goes where the game's files can't (share links, the Showcase, the hub): its stand-in figure.
// Pure module (the share and publish functions use it).
import type { Project, SceneItem } from '../project'
import { BODY_MAT, FLESH_SURFACE, isPose } from './figure'
import { validModel, type DummySpec } from './models'

export interface DummyRef extends DummySpec {
  source: 'dummy'
  /** World scale the files were made at (metres per editor unit). */
  ws: number
  /** Drawn from the player's own game (files origin 'game'); false: the stand-in is drawn in its place. */
  built: boolean
  /** The stand-in figure and its pictures: site recipes, so it goes wherever the map goes. */
  stand_in: { path: string; textures: Record<string, string> }
}

export const dummyRefOf = (it: { dummy?: unknown }): DummyRef | null => {
  const d = it.dummy as DummyRef | undefined
  return d && d.source === 'dummy' && validModel(d.model) && isPose(d.pose) && typeof d.stand_in?.path === 'string' ? d : null
}
export const isDummy = (it: { dummy?: unknown }) => !!dummyRefOf(it)

export const MATERIAL_ALPHA = (mat: string) => mat === BODY_MAT
export const SURFACES = (mats: string[]) => Object.fromEntries(mats.map((m) => [m, m === BODY_MAT ? FLESH_SURFACE : 0]))

/**
 * What the dummy's object is while drawn as its stand-in: the stand-in's files, the body boxes solid. Also how
 * share links, the Showcase and the hub see a dummy.
 */
export function asStandIn(it: SceneItem): SceneItem {
  const d = dummyRefOf(it)
  if (!d) return it
  const textures = { ...d.stand_in.textures }
  const mats = Object.keys(textures)
  const out: SceneItem = {
    ...it, path: d.stand_in.path, source_path: d.stand_in.path, textures,
    alpha: Object.fromEntries(mats.map((m) => [m, MATERIAL_ALPHA(m)])), surface_ids: SURFACES(mats),
    collision_materials: [BODY_MAT], dummy: { ...d, built: false },
  }
  delete out.game_look
  delete out.collision_excluded_faces
  return out
}

/** The project with every dummy drawn as its stand-in (and none of its game files listed). */
export function withStandIns<P extends Pick<Project, 'scene_items' | 'files'>>(p: P): P {
  if (!p.scene_items.some(isDummy)) return p
  const items = p.scene_items.map((it) => (isDummy(it) ? asStandIn(it) : it))
  const files = { ...p.files }
  for (const it of p.scene_items) {
    if (!isDummy(it)) continue
    for (const path of [it.path, it.source_path, ...Object.values(it.textures || {})]) if (typeof path === 'string' && files[path]?.origin === 'game') delete files[path]
  }
  return { ...p, scene_items: items, files }
}
