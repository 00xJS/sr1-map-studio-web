// What leaves this device for objects from the player's game: nothing. Their files (origin 'game') are already
// kept out of cloud saves, the hub, the Showcase and share links; a project backup leaves them out too, keeping
// only where each object came from, so whoever opens the backup rebuilds them from their own game.
import { isDataPackPath, type Project, type SceneItem } from '../project'

/** Files of placed game objects that are game data (a texture the user painted on one is theirs and stays). */
export function gameObjectPaths(p: Pick<Project, 'scene_items' | 'files'>): Set<string> {
  const out = new Set<string>()
  for (const it of p.scene_items) {
    if (!it.game_object && !it.game_look && !it.dummy) continue
    // An object's look (from the game, or a city cut-out's) is game data too.
    const look = it.game_look ? [it.game_look.path, ...(it.game_look.layers || [])] : []
    // A decoy dummy's character too (its stand-in, a site recipe, stays).
    const own = it.game_object || it.dummy ? [it.path, it.source_path, ...Object.values(it.textures || {})] : []
    for (const path of [...own, ...look]) {
      if (typeof path === 'string' && p.files[path]?.origin === 'game') out.add(path)
    }
  }
  return out
}

/**
 * Whether the map draws anything from the player's game: an object, its look, a built dummy, an imported game map,
 * an object or picture from the data pack, or a sky texture from either. A picture of the editor's view would show
 * game data, so it stays on this device too.
 */
export function showsGameData(p: Pick<Project, 'scene_items' | 'files'> & { settings?: Pick<Project['settings'], 'sky_texture'> }): boolean {
  if (fileFromGame(p.files, p.settings?.sky_texture)) return true
  return p.scene_items.some((it) => itemFromGame(it, p.files))
}

const fileFromGame = (files: Project['files'], path: unknown) => typeof path === 'string' && !!path && (isDataPackPath(path) || files[path]?.origin === 'game')

/** Whether an object is drawn from the player's game or the data pack (its model, a picture, its look). */
export const itemFromGame = (it: Pick<SceneItem, 'path' | 'textures' | 'game_look'>, files: Project['files']) =>
  [it.path, ...Object.values(it.textures || {}), it.game_look?.path].some((path) => fileFromGame(files, path))
