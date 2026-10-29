// Editor commands for decoy dummies (lib/dummies): placing one, changing its model, pose or look, building the
// characters from the player's own game, and drawing them as stand-ins when the game's files aren't here.
import { useEditor, currentProject } from './store'
import { toast } from '../ui'
import { db } from '../lib/db'
import { referencedPaths, uid, type FileRef, type Project, type SceneItem, type Vec3 } from '../lib/project'
import { dummyPacks } from '../lib/dummies/packs'
import { MAX_DUMMIES, MANY_LOOKS, lookKey, type DummySpec } from '../lib/dummies/models'
import { asStandIn, dummyItem, dummyRefOf, isDummy, rebuildDummy } from '../lib/dummies/place'

const ws = () => currentProject()?.settings.world_scale || 0.5

export { dummyPacks }

export const dummyCount = (p: Pick<Project, 'scene_items'> | null) => p?.scene_items.filter(isDummy).length ?? 0
/** Different looks among a map's dummies (each costs about 1 MB of the texture budget). */
export const dummyLooks = (p: Pick<Project, 'scene_items'> | null) => new Set((p?.scene_items ?? []).flatMap((it) => { const d = dummyRefOf(it); return d ? [lookKey(d)] : [] })).size

const builtNote = 'From your own game files: it goes into your own exports; share links, the Showcase and the hub get a plain stand-in figure instead.'

/** Places a dummy standing at `at`. Built from the game when its files can be read, else as the stand-in. */
export async function placeDummy(spec: DummySpec, at: Vec3, rot = 0) {
  const p = currentProject()
  if (!p) return
  if (dummyCount(p) >= MAX_DUMMIES) throw new Error(`A map can have at most ${MAX_DUMMIES} dummies (about one lobby's worth of extra people to draw).`)
  const packs = await dummyPacks(true)
  const { item, files, summary } = await dummyItem(spec, at, rot, ws(), packs, uid())
  if (currentProject()?.id !== p.id) throw new Error('another map was opened')
  const st = useEditor.getState()
  st.update('Add ' + item.name, (d) => {
    Object.assign(d.files, files)
    d.scene_items.push(item)
  })
  st.select({ kind: 'item', index: currentProject()!.scene_items.length - 1 })
  st.log(packs
    ? `Added ${item.name} (${summary}). ${builtNote}`
    : `Added ${item.name} as a stand-in figure: connect your game folder (Connect page) and choose "Build from my game" to see the real character.`)
  if (dummyLooks(currentProject()) > MANY_LOOKS) toast(`More than ${MANY_LOOKS} different dummy looks: each adds about 1 MB to the map's textures.`, 'info', 8000)
}

function replaceItems(label: string, fixes: { uid: string; item: SceneItem; files: Record<string, FileRef> }[]) {
  useEditor.getState().update(label, (d) => {
    for (const f of fixes) {
      const i = d.scene_items.findIndex((x) => x.uid === f.uid)
      if (i < 0) continue
      d.scene_items[i] = f.item
      Object.assign(d.files, f.files)
    }
    // The files only the old versions used go.
    const live = new Set(referencedPaths(d as Project))
    for (const path of Object.keys(d.files)) if (!live.has(path)) delete d.files[path]
  })
}

/** Another model, pose or look for the dummy at `index`, built again in its place. */
export async function changeDummy(index: number, patch: Partial<DummySpec>) {
  const p = currentProject()
  const it = p?.scene_items[index]
  const d = it && dummyRefOf(it)
  if (!p || !it || !d) return
  const spec: DummySpec = { model: patch.model ?? d.model, pose: patch.pose ?? d.pose, look: { ...(patch.model && patch.model !== d.model ? {} : d.look), ...patch.look } }
  const packs = d.built || (await dummyPacks(false)) ? await dummyPacks(true) : null
  const r = await rebuildDummy(it, spec, ws(), packs)
  if (currentProject()?.id !== p.id) throw new Error('another map was opened')
  replaceItems('Change dummy', [{ uid: it.uid, item: r.item, files: r.files }])
}

/** Builds every dummy drawn as a stand-in (or missing its files here) from the player's own game. Returns how many. */
export async function buildDummies(ask = true): Promise<number> {
  const p = currentProject()
  if (!p) return 0
  const todo = p.scene_items.filter((it) => { const d = dummyRefOf(it); return d && (!d.built || d.ws !== ws()) })
  const missing = await missingDummies(p)
  const all = [...new Set([...todo, ...missing])]
  if (!all.length) return 0
  const packs = await dummyPacks(ask)
  if (!packs) throw new Error('Your game folder is needed to build the dummies: choose it on the Connect page (Chrome or Edge).')
  const fixes = []
  for (const it of all) {
    const d = dummyRefOf(it)!
    const r = await rebuildDummy(it, d, ws(), packs)
    fixes.push({ uid: it.uid, item: r.item, files: r.files })
  }
  if (currentProject()?.id !== p.id) throw new Error('another map was opened')
  replaceItems('Build dummies from the game', fixes)
  return fixes.length
}

/** Dummies drawn from game files that aren't in this browser (a backup, a cloud save, another computer). */
async function missingDummies(p: Project): Promise<SceneItem[]> {
  const out: SceneItem[] = []
  for (const it of p.scene_items) {
    const d = dummyRefOf(it)
    if (!d?.built) continue
    const ref = p.files[it.path]
    if (!ref || !(await db.hasBlob(ref.hash))) out.push(it)
  }
  return out
}

// A map opened without its dummies' game files: draw them as their stand-ins (which always travel with the map).
let checked = ''
useEditor.subscribe((s) => {
  const id = s.project?.id ?? ''
  if (id === checked) return
  checked = id
  if (!s.project?.scene_items.some(isDummy)) return
  void missingDummies(s.project).then((m) => {
    if (!m.length || currentProject()?.id !== id) return
    const uids = new Set(m.map((it) => it.uid))
    useEditor.getState().update('Show dummies as stand-ins', (d) => {
      d.scene_items = d.scene_items.map((it) => (uids.has(it.uid) ? asStandIn(it as SceneItem) : it))
    })
    toast(`${m.length === 1 ? '1 dummy' : `${m.length} dummies`} in this map ${m.length === 1 ? 'is' : 'are'} drawn as a stand-in: select one and choose "Build from my game" to see the real characters.`, 'info', 12000)
  }, () => {})
})
