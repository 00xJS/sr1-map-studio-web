// What leaves this device for objects from the player's game: nothing. Their files (origin 'game') are already
// kept out of cloud saves, the hub, the Showcase and share links; a project backup leaves them out too, keeping
// only where each object came from, so whoever opens the backup rebuilds them from their own game.
import type { Project } from '../project'

/** Files of placed game objects that are game data (a texture the user painted on one is theirs and stays). */
export function gameObjectPaths(p: Pick<Project, 'scene_items' | 'files'>): Set<string> {
  const out = new Set<string>()
  for (const it of p.scene_items) {
    if (!it.game_object) continue
    for (const path of [it.path, it.source_path, ...Object.values(it.textures || {})]) {
      if (typeof path === 'string' && p.files[path]?.origin === 'game') out.add(path)
    }
  }
  return out
}
