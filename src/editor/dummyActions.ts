// Editor commands for decoy dummies (lib/dummies): placing one, changing its model, pose or look, building the
// characters from the player's own game, and drawing them as stand-ins when the game's files aren't here.
import { produce } from 'immer'
import { useEditor, currentProject } from './store'
import { getViewer } from './Viewport'
import { forgetFiles } from '../lib/assets'
import { toast } from '../ui'
import { db } from '../lib/db'
import { referencedPaths, uid, type FileRef, type Project, type SceneItem, type Vec3 } from '../lib/project'
import { dummySource } from '../lib/dummies/packs'
import { MAX_DUMMIES, MANY_LOOKS, dummyName, lookKey, type DummySpec } from '../lib/dummies/models'
import { asStandIn, dummyItem, dummyRefOf, isDummy, rebuildDummy } from '../lib/dummies/place'

const ws = () => currentProject()?.settings.world_scale || 0.5

export const dummyCount = (p: Pick<Project, 'scene_items'> | null) => p?.scene_items.filter(isDummy).length ?? 0
/** Different looks among a map's dummies (each costs about 1 MB of the texture budget). */
export const dummyLooks = (p: Pick<Project, 'scene_items'> | null) => new Set((p?.scene_items ?? []).flatMap((it) => { const d = dummyRefOf(it); return d ? [lookKey(d)] : [] })).size

const builtNote = 'From your own game files: it goes into your own exports; share links, the Showcase and the hub get a plain stand-in figure instead.'
const NO_FOLDER = 'Your game folder is needed to build the dummies: choose it on the Connect page (Chrome or Edge).'

/** Places a dummy standing at `at`. Built from the game when its files can be read, else as the stand-in. */
export async function placeDummy(spec: DummySpec, at: Vec3, rot = 0) {
  const p = currentProject()
  if (!p) return
  if (dummyCount(p) >= MAX_DUMMIES) throw new Error(`A map can have at most ${MAX_DUMMIES} dummies (about one lobby's worth of extra people to draw).`)
  const source = await dummySource(true)
  const { item, files, summary } = await dummyItem(spec, at, rot, ws(), source, uid())
  if (currentProject()?.id !== p.id) throw new Error('another map was opened')
  const st = useEditor.getState()
  const before = currentProject()
  st.update('Add ' + item.name, (d) => {
    Object.assign(d.files, files)
    d.scene_items.push(item)
  })
  // Refused (the cap) or not: select it by its own id (mirror mode adds its twin after it).
  const index = currentProject()!.scene_items.findIndex((x) => x.uid === item.uid)
  if (currentProject() === before || index < 0) return
  st.select({ kind: 'item', index })
  st.log(source
    ? `Added ${item.name} (${summary}). ${builtNote}`
    : `Added ${item.name} as a stand-in figure: connect your game folder (Connect page) and choose "Build from my game" to see the real character.`)
  if (dummyLooks(currentProject()) > MANY_LOOKS) toast(`More than ${MANY_LOOKS} different dummy looks: each adds about 1 MB to the map's textures.`, 'info', 8000)
}

/**
 * Puts rebuilt dummies in place of the old ones. Where each stands, its layer and group are taken now, so a dummy
 * moved while it was being built stays where it was put; so does a name the user gave it.
 */
function replaceItems(label: string, fixes: { uid: string; item: SceneItem; files: Record<string, FileRef> }[]) {
  const dropped: string[] = []
  useEditor.getState().update(label, (d) => {
    for (const f of fixes) {
      const i = d.scene_items.findIndex((x) => x.uid === f.uid)
      if (i < 0) continue
      const now = d.scene_items[i] as SceneItem
      const old = dummyRefOf(now)
      const name = old && now.name !== dummyName(old) ? now.name : f.item.name
      d.scene_items[i] = { ...f.item, name, position: now.position, rotation: now.rotation, scale: now.scale, layer: now.layer, group: now.group }
      if (!now.layer) delete d.scene_items[i].layer
      if (!now.group) delete d.scene_items[i].group
      Object.assign(d.files, f.files)
    }
    // The files only the old versions used go.
    const live = new Set(referencedPaths(d as Project))
    for (const path of Object.keys(d.files)) if (!live.has(path)) { delete d.files[path]; dropped.push(path) }
  })
  // And what the editor kept of them.
  if (dropped.length) { forgetFiles(dropped); getViewer()?.forget(dropped) }
}

/** Another model, pose or look for the dummy at `index`, built again in its place. */
export async function changeDummy(index: number, patch: Partial<DummySpec>) {
  const p = currentProject()
  const it = p?.scene_items[index]
  const d = it && dummyRefOf(it)
  if (!p || !it || !d) return
  const spec: DummySpec = { model: patch.model ?? d.model, pose: patch.pose ?? d.pose, look: { ...(patch.model && patch.model !== d.model ? {} : d.look), ...patch.look } }
  // A built one asks for the folder again if it must; a stand-in is built only when the folder is already open.
  const source = d.built ? await dummySource(true) : await dummySource(false)
  const r = await rebuildDummy(it, spec, ws(), source)
  if (currentProject()?.id !== p.id) throw new Error('another map was opened')
  replaceItems('Change dummy', [{ uid: it.uid, item: r.item, files: r.files }])
  if (d.built && !source) toast(`Your game folder couldn't be read, so ${r.item.name} is drawn as its stand-in figure for now: choose "Build from my game" once the folder is connected.`, 'info', 10000)
}

/** Dummies that need building here: stand-ins, ones made at another world scale, ones missing their files. */
export async function dummiesToBuild(p: Project): Promise<SceneItem[]> {
  const missing = new Set((await missingDummies(p)).map((it) => it.uid))
  return p.scene_items.filter((it) => { const d = dummyRefOf(it); return d && (!d.built || d.ws !== (p.settings.world_scale || 0.5) || missing.has(it.uid)) })
}

/**
 * Builds every dummy that needs it (dummiesToBuild) from the player's own game. Returns how many. Without the
 * folder, dummies made at another world scale are made again as stand-ins at this one, and the rest wait.
 */
export async function buildDummies(ask = true, onProgress?: (done: number, total: number) => void): Promise<number> {
  const p = currentProject()
  if (!p) return 0
  const all = await dummiesToBuild(p)
  if (!all.length) return 0
  const source = await dummySource(ask)
  const todo = source ? all : all.filter((it) => !dummyRefOf(it)!.built && dummyRefOf(it)!.ws !== ws())
  if (!todo.length) throw new Error(NO_FOLDER)
  const fixes = []
  for (const [i, it] of todo.entries()) {
    onProgress?.(i, todo.length)
    const r = await rebuildDummy(it, dummyRefOf(it)!, ws(), source)
    fixes.push({ uid: it.uid, item: r.item, files: r.files })
    if (currentProject()?.id !== p.id) throw new Error('another map was opened')
  }
  onProgress?.(todo.length, todo.length)
  replaceItems(source ? 'Build dummies from the game' : 'Resize dummies', fixes)
  if (!source) toast(NO_FOLDER, 'info', 8000)
  return fixes.length
}

/** Built dummies whose game files aren't in this browser (a backup, a cloud save, another computer, a paste). */
async function missingDummies(p: Pick<Project, 'scene_items' | 'files'>): Promise<SceneItem[]> {
  const out: SceneItem[] = []
  for (const it of p.scene_items) {
    if (!dummyRefOf(it)?.built) continue
    const ref = p.files[it.path]
    if (!ref || !(await db.hasBlob(ref.hash))) out.push(it)
  }
  return out
}

// A built dummy whose game files aren't here (a map opened from elsewhere, a paste, one of My prefabs from another
// device, an undo back to one): drawn as its stand-in, which always travels with the map. Not an undo step of its
// own: undoing past it would only bring back files that aren't here.
const present = new Set<string>()
let checking = false, again = false
async function standInMissing() {
  if (checking) { again = true; return }
  checking = true
  try {
    do {
      again = false
      const p = currentProject()
      if (!p) return
      const unknown = p.scene_items.filter((it) => dummyRefOf(it)?.built && !present.has(it.path))
      if (!unknown.length) continue
      const missing = await missingDummies({ scene_items: unknown, files: p.files })
      const gone = new Set(missing.map((it) => it.uid))
      for (const it of unknown) if (!gone.has(it.uid)) present.add(it.path)
      if (!gone.size) continue
      const cur = currentProject()
      if (!cur || cur.id !== p.id) continue
      const next = produce(cur, (d) => { d.scene_items = d.scene_items.map((it) => (gone.has(it.uid) && dummyRefOf(it)?.built ? asStandIn(it as SceneItem) : it)) })
      useEditor.setState({ project: next, saveState: 'unsaved' })
      toast(`${gone.size === 1 ? '1 dummy' : `${gone.size} dummies`} in this map ${gone.size === 1 ? 'is' : 'are'} drawn as a stand-in: select one and choose "Build from my game" to see the real characters.`, 'info', 12000)
    } while (again)
  } finally { checking = false }
}
useEditor.subscribe((s, prev) => {
  if (s.project && s.project.scene_items !== prev.project?.scene_items && s.project.scene_items.some((it) => dummyRefOf(it)?.built)) void standInMissing().catch(() => {})
})
