// Editor commands for the "From my game" library: placing an object (the Shape tool's "game:<id>"), its
// placement ghost, its thumbnails, and rebuilding placed objects whose files are not in this browser.
import { useEditor, currentProject, command, type Edits } from './store'
import { toast } from '../ui'
import { db } from '../lib/db'
import { registerThumbSource, resetThumbs } from '../lib/prefabThumbs'
import { connect, entryById, getObject, loadIndex, useGameObjects } from '../lib/gameObjects/client'
import { gameObjectItem, gameRefOf, missingGameObjects, rebuildItem, sinkUnits } from '../lib/gameObjects/place'
import { referencedPaths, type FileRef, type Project, type Vec3 } from '../lib/project'

const THUMB_TEX = 64
const GHOST_TEX = 128
const THUMB_VERSION = 1

async function entry(id: string) {
  const e = entryById(id) ?? (await loadIndex(), entryById(id))
  if (!e) throw new Error('That object is not in your game library any more. Rebuild the library (Prefabs → From my game).')
  return e
}

const ws = () => currentProject()?.settings.world_scale || 0.5

/** Places a library object standing on the clicked surface. */
export const placeGameObject = command(async (edits: Edits, id: string, at: Vec3, groundY: number | null, rot: number) => {
  const e = await entry(id)
  // On a floor: sunk into it as the city has it (place.ts sinkUnits).
  const { item, files } = await gameObjectItem(e, [at[0], groundY !== null ? groundY - sinkUnits(e, ws()) : at[1], at[2]], rot, ws())
  const st = useEditor.getState()
  edits.update('Add ' + e.name, (d) => {
    Object.assign(d.files, files)
    d.scene_items.push(item)
  })
  st.select({ kind: 'item', index: currentProject()!.scene_items.length - 1 })
  st.log(`Added ${e.name} from your game files (${e.size.join(' × ')} m). It is yours to use in your own maps; it can't be shared or published.`)
})

/** The placement ghost: the object itself, small textures. */
export async function gameGhost(id: string) {
  const e = await entry(id)
  const [r, { objectMesh }] = await Promise.all([getObject(e, GHOST_TEX), import('../lib/gameObjects/render')])
  return objectMesh(r, ws())
}

registerThumbSource('game:', {
  sig: (key) => `g${THUMB_VERSION}:${key.slice(5)}`,
  async draw(key) {
    const e = await entry(key.slice(5))
    const [r, { objectMesh }, { drawObject }] = await Promise.all([getObject(e, THUMB_TEX), import('../lib/gameObjects/render'), import('../lib/prefabRender')])
    return drawObject(objectMesh(r, 1))
  },
})
// Pictures that couldn't be drawn before the game files were open are asked for again once they are.
useGameObjects.subscribe((s, prev) => { if (s.connected && !prev.connected) resetThumbs('game:') })

/** Placed game objects in the open map whose files are missing here (indices). */
export async function missingInProject(): Promise<number[]> {
  const p = currentProject()
  return p ? missingGameObjects(p, (h) => db.hasBlob(h)) : []
}

/** Rebuilds the open map's game objects that are missing their files, from this player's own game files. */
export async function rebuildMissing(ask: boolean): Promise<number> {
  await connect(ask)
  const p = currentProject()
  if (!p) return 0
  const todo = await missingInProject()
  const fixes: { uid: string; patch: Record<string, unknown>; files: Record<string, FileRef> }[] = []
  for (const i of todo) {
    const it = p.scene_items[i]
    if (!gameRefOf(it)) continue
    const r = await rebuildItem(it, p.files)
    fixes.push({ uid: it.uid, ...r })
  }
  if (!fixes.length) return 0
  useEditor.getState().update('Rebuild objects from the game', (d) => {
    for (const f of fixes) {
      const it = d.scene_items.find((x) => x.uid === f.uid)
      if (!it) continue
      Object.assign(it, f.patch)
      Object.assign(d.files, f.files)
    }
    // The records of the files they had before (missing here) go.
    const live = new Set(referencedPaths(d as Project))
    for (const path of Object.keys(d.files)) if (!live.has(path)) delete d.files[path]
  })
  return fixes.length
}

// A map opened from a backup or another computer: say which objects from the game need rebuilding here.
let checked = ''
useEditor.subscribe((s) => {
  const id = s.project?.id ?? ''
  if (id === checked) return
  checked = id
  if (!s.project?.scene_items.some((it) => it.game_object)) return
  void missingInProject().then((m) => {
    if (m.length && currentProject()?.id === id) {
      toast(`${m.length === 1 ? '1 object' : `${m.length} objects`} from the game in this map ${m.length === 1 ? 'needs' : 'need'} your game files on this device: Shape tool → Prefabs → From my game → Rebuild from my game.`, 'info', 12000)
    }
  }, () => {})
})
