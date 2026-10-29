// Cloud saves and hub transfers between the local IndexedDB store and the
// account backend. Files with origin 'game' (the user's own Saints Row data)
// are never uploaded; /studio/ data-pack paths are never in project.files.
import { getBackend, ConflictError, LIBRARY_PROJECT_ID, PublishRejected, type Backend, type CloudProjectMeta, type HubMapDetail, type User } from './backend'
import { db, sha256, type ProjectRecord } from './db'
import { checkPublishMeta, checkShots, HEAD_BYTES, projectUploadPlan, showcasePlan, type PublishMeta, type UploadPlan } from './hubRules'
import { libraryIds, rebuildFromRecipes } from './showcase'
import { newProject, normalizeProject, uid, type FileRef, type Project, type SceneItem } from './project'
import { hasBuiltDummy } from './dummies/standIn'
import { showsGameData } from './gameObjects/policy'

export type Progress = (p: { phase: string; done: number; total: number }) => void

async function signedIn(): Promise<{ b: Backend; user: User }> {
  const b = await getBackend()
  if (!b) throw new Error("Accounts aren't configured on this site.")
  const user = await b.getUser()
  if (!user) throw new Error('Sign in first.')
  return { b, user }
}

async function eachLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let next = 0
  const worker = async () => { while (next < items.length) await fn(items[next++]) }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/**
 * Upload the plan's user files the server doesn't have yet (game files are never
 * in the plan's hashes). `blobOf` returns undefined to skip a file.
 */
async function uploadMissing(b: Backend, plan: UploadPlan, blobOf: (hash: string) => Promise<Blob | undefined>, onProgress?: Progress) {
  onProgress?.({ phase: 'Checking files', done: 0, total: plan.hashes.length })
  const have = await b.hasBlobs(plan.hashes)
  const missing = plan.hashes.filter((h) => !have.has(h))
  let done = 0
  onProgress?.({ phase: 'Uploading files', done, total: missing.length })
  await eachLimit(missing, 3, async (hash) => {
    const blob = await blobOf(hash)
    if (blob) await b.uploadBlob(hash, blob)
    onProgress?.({ phase: 'Uploading files', done: ++done, total: missing.length })
  })
}

/** Local changes not yet in the cloud copy. */
export const hasUnsyncedChanges = (rec: Pick<ProjectRecord, 'updated_at' | 'cloud'>) => !rec.cloud || rec.updated_at > rec.cloud.synced_at

/**
 * Upload the project's user files, thumbnail and data to the cloud.
 * Throws ConflictError when the cloud copy changed elsewhere (pass force to overwrite).
 */
/**
 * The thumbnail a cloud save sends: the saved picture is a render of the editor's view, so none goes up if it was
 * drawn while the map showed anything from the player's game, or if the map shows some now. `clear`: take down
 * one sent before (it may show the same).
 */
export function cloudThumb(rec: Pick<ProjectRecord, 'project' | 'thumbnail' | 'thumb_game'>): { thumbnail: Blob | null; clear: boolean } {
  if (rec.thumb_game || showsGameData(rec.project)) return { thumbnail: null, clear: true }
  return { thumbnail: rec.thumbnail ?? null, clear: false }
}

export async function pushProject(id: string, onProgress?: Progress, opts: { force?: boolean } = {}): Promise<{ updated_at: string }> {
  const { b } = await signedIn()
  // Anything saved locally after this moment counts as unsynced.
  const syncedAt = new Date().toISOString()
  const rec = await db.getProject(id)
  if (!rec) throw new Error('Project not found on this device.')
  const plan = projectUploadPlan(rec.project)

  let expectedUpdatedAt = rec.cloud?.remote_updated_at
  if (!opts.force && !expectedUpdatedAt) {
    const remote = (await b.listCloudProjects()).find((p) => p.id === id)
    if (remote) throw new ConflictError(remote.updated_at)
  }
  if (opts.force) expectedUpdatedAt = undefined

  const names = new Map(plan.upload.map((f) => [f.ref.hash, f.ref.name]))
  await uploadMissing(b, plan, async (hash) => {
    const blob = await db.getBlob(hash)
    if (!blob) throw new Error(`${names.get(hash)} is missing on this device, so it can't be uploaded. Re-import it and try again.`)
    return blob
  }, onProgress)

  onProgress?.({ phase: 'Saving project', done: 0, total: 1 })
  const thumb = cloudThumb(rec)
  const res = await b.putCloudProject(rec.project, thumb.thumbnail, { expectedUpdatedAt, clearThumb: thumb.clear })
  const latest = (await db.getProject(id)) ?? rec
  await db.putProject({ ...latest, cloud: { synced_at: syncedAt, remote_updated_at: res.updated_at } })
  onProgress?.({ phase: 'Saved to cloud', done: 1, total: 1 })
  return res
}

/** Download a cloud save (data, user files, thumbnail) into local storage, replacing any local copy. */
export async function pullProject(cloudId: string, onProgress?: Progress): Promise<{ id: string; missingGameFiles: string[] }> {
  const { b } = await signedIn()
  const remote = await b.getCloudProject(cloudId)
  if (!remote) throw new Error('That cloud save no longer exists.')
  const project = normalizeProject(remote.project)
  const refs = Object.values(project.files)
  const user = refs.filter((r) => r.origin === 'user')
  const need: string[] = []
  for (const h of new Set(user.map((r) => r.hash))) if (!(await db.hasBlob(h))) need.push(h)
  let done = 0
  onProgress?.({ phase: 'Downloading files', done, total: need.length })
  await eachLimit(need, 3, async (hash) => {
    await db.putBlob(hash, await b.downloadBlob(hash))
    onProgress?.({ phase: 'Downloading files', done: ++done, total: need.length })
  })
  const missingGameFiles: string[] = []
  for (const r of refs) if (r.origin === 'game' && !(await db.hasBlob(r.hash))) missingGameFiles.push(r.name)

  const meta = (await b.listCloudProjects()).find((p) => p.id === cloudId)
  const thumbnail = meta?.thumbnail_url ? await fetchBlob(meta.thumbnail_url) : undefined
  const existing = await db.getProject(project.id)
  await db.putProject({
    id: project.id, name: project.name, updated_at: project.updated_at, project,
    thumbnail: thumbnail ?? existing?.thumbnail,
    cloud: { synced_at: new Date().toISOString(), remote_updated_at: remote.updated_at },
  })
  return { id: project.id, missingGameFiles }
}

async function fetchBlob(url: string): Promise<Blob | undefined> {
  try { const r = await fetch(url); return r.ok ? await r.blob() : undefined } catch { return undefined }
}

export async function listCloudProjects(): Promise<CloudProjectMeta[]> {
  const b = await getBackend()
  if (!b || !(await b.getUser())) return []
  return b.listCloudProjects()
}

/** What keeps a map out of the Showcase, checked here with the server's rules. */
export async function showcaseProblems(project: Project, meta: PublishMeta): Promise<string[]> {
  return [...checkPublishMeta(meta), ...showcasePlan(project, await libraryIds()).blockers]
}

async function uploadImage(b: Backend, blob: Blob): Promise<string> {
  const hash = await sha256(blob)
  if (!(await b.hasBlobs([hash])).has(hash)) await b.uploadBlob(hash, blob)
  return hash
}

/**
 * Put the (already saved) project in the Showcase with the author's
 * screenshots. Only recipes are sent, never the map's files. Pass mapId to
 * update a map you published before. Throws PublishRejected with problems.
 */
export async function publishShowcase(id: string, meta: PublishMeta & { mapId?: string }, shots: Blob[], onProgress?: Progress): Promise<{ id: string }> {
  const { b } = await signedIn()
  const rec = await db.getProject(id)
  if (!rec) throw new Error('Project not found on this device.')
  const plan = showcasePlan(rec.project, await libraryIds())
  const problems = [...checkPublishMeta(meta), ...plan.blockers, ...checkShots(await Promise.all(shots.map(async (s) => ({ size: s.size, head: new Uint8Array(await s.slice(0, HEAD_BYTES).arrayBuffer()) }))))]
  if (problems.length) throw new PublishRejected("This map can't go in the Showcase yet.", problems)
  // The saved picture is a render of the editor's view: with a dummy built from the game it shows the real character.
  const thumbnail = hasBuiltDummy(rec.project.scene_items) ? undefined : rec.thumbnail
  const total = shots.length + (thumbnail ? 1 : 0)
  let done = 0
  onProgress?.({ phase: 'Uploading screenshots', done, total })
  const hashes: string[] = []
  for (const s of shots) { hashes.push(await uploadImage(b, s)); onProgress?.({ phase: 'Uploading screenshots', done: ++done, total }) }
  const thumb = thumbnail ? await uploadImage(b, thumbnail) : undefined
  onProgress?.({ phase: 'Checking and publishing', done: 0, total: 1 })
  const res = await b.publish({ projectId: id, snapshot: plan.snapshot, title: meta.title, description: meta.description, tags: meta.tags, mapId: meta.mapId, thumb, shots: hashes })
  onProgress?.({ phase: 'Published', done: 1, total: 1 })
  return res
}

/** Download a hub map's files into local storage, verifying each against its hash. */
async function fetchHubFiles(b: Backend, d: HubMapDetail, onProgress?: Progress) {
  const need: string[] = []
  for (const h of new Set(Object.values(d.project.files).filter((r) => r.origin === 'user' && !r.recipe).map((r) => r.hash))) {
    if (!(await db.hasBlob(h))) need.push(h)
  }
  let done = 0
  onProgress?.({ phase: 'Downloading files', done, total: need.length })
  await eachLimit(need, 3, async (hash) => {
    const blob = await b.downloadHubBlob(d.id, hash)
    if ((await sha256(blob)) !== hash) throw new Error('A file of this map is damaged (its contents do not match). Try again later.')
    await db.putBlob(hash, blob)
    onProgress?.({ phase: 'Downloading files', done: ++done, total: need.length })
  })
}

function hubProject(d: HubMapDetail): Project {
  const p = normalizeProject(JSON.parse(JSON.stringify(d.project)))
  for (const [path, ref] of Object.entries(p.files)) if (ref.origin !== 'user') delete p.files[path]
  return p
}

/** Copy a hub map into a new local project; returns its id. */
export async function remixHubMap(mapId: string, onProgress?: Progress): Promise<string> {
  const b = await getBackend()
  if (!b) throw new Error("Accounts aren't configured on this site.")
  const d = await b.getHubMap(mapId)
  if (!d) throw new Error('This map is not available.')
  await fetchHubFiles(b, d, onProgress)
  const now = new Date().toISOString()
  const p = await rebuildFromRecipes(hubProject(d), (done, total) => onProgress?.({ phase: 'Building textures and shapes', done, total }))
  const project: Project = {
    ...p, id: uid(), name: `${d.title} (remix)`.slice(0, 120), created_at: now, updated_at: now,
    remix_of: { hub_id: d.id, title: d.title, author: d.author.name },
  }
  const thumbnail = d.thumbnail_url ? await fetchBlob(d.thumbnail_url) : undefined
  await db.putProject({ id: project.id, name: project.name, updated_at: now, project, thumbnail })
  b.recordRemix(mapId).catch(() => {})
  return project.id
}

/** A hub map's project with its files available locally, for a read-only viewer. */
export async function openHubMapForView(mapId: string, onProgress?: Progress): Promise<{ project: Project; map: HubMapDetail }> {
  const b = await getBackend()
  if (!b) throw new Error("Accounts aren't configured on this site.")
  const map = await b.getHubMap(mapId)
  if (!map) throw new Error('This map is not available.')
  await fetchHubFiles(b, map, onProgress)
  b.recordDownload(mapId).catch(() => {})
  return { project: await rebuildFromRecipes(hubProject(map), (done, total) => onProgress?.({ phase: 'Building textures and shapes', done, total })), map }
}

// ---------------- My prefabs ----------------
// The pieces a user saved (editor/myPrefabs.ts) follow their account in one
// hidden cloud save, LIBRARY_PROJECT_ID. Its files are every piece's files, so
// they go through the same upload plan as a map backup: user files are stored
// once by hash, game files never leave the device (only their record does).
// `my_prefabs` holds the pieces and deletion markers; this browser's
// localStorage stays the working copy, so the pieces work offline and without
// accounts. Merged by piece id: the newest `saved` wins, and a deletion beats
// every save before it. The working copy remembers whose it is: when another
// account signs in, it is set aside for its owner instead of being merged.

export interface SyncedPrefab { id: string; name: string; saved: string; bundle: { items: SceneItem[]; files: Record<string, FileRef> } }
export interface PrefabDeletion { id: string; deleted: string }
export interface PrefabState {
  pieces: SyncedPrefab[]
  deleted: PrefabDeletion[]
  /** The account these pieces were last synced with; unset until the first sync. */
  owner?: string
}

/** Where this browser keeps My prefabs (one key, so pieces and deletions are written together). */
export const MY_PREFABS = { key: 'sr1ms.myPrefabs', asidePrefix: 'sr1ms.myPrefabs.aside.', event: 'sr1ms-myprefabs' } as const
/** Deletion markers kept (the newest); older ones could let a long-offline device bring a piece back. */
const MAX_DELETIONS = 500

/** One device's copy of My prefabs and its file store (tests pass their own). */
export interface PrefabDevice {
  read(): PrefabState
  write(state: PrefabState): void
  /** Another account's pieces, kept on this device while someone else is signed in. */
  takeAside(owner: string): PrefabState | undefined
  setAside(state: PrefabState & { owner: string }): void
  hasBlob(hash: string): Promise<boolean>
  getBlob(hash: string): Promise<Blob | undefined>
  putBlob(hash: string, blob: Blob): Promise<void>
}

function parseState(text: string | null): PrefabState | undefined {
  try {
    const v = JSON.parse(text || 'null')
    // Before syncing, the key held just the list of pieces.
    if (Array.isArray(v)) return { pieces: v, deleted: [] }
    if (v && Array.isArray(v.pieces)) return { pieces: v.pieces, deleted: Array.isArray(v.deleted) ? v.deleted : [], ...(v.owner ? { owner: String(v.owner) } : {}) }
  } catch { /* unreadable: start over */ }
  return undefined
}

/** This browser's My prefabs. */
export const readPrefabStore = (): PrefabState => parseState(localStorage.getItem(MY_PREFABS.key)) ?? { pieces: [], deleted: [] }

/** Replaces this browser's My prefabs (throws when storage is full or blocked). */
export function writePrefabStore(s: PrefabState) {
  localStorage.setItem(MY_PREFABS.key, JSON.stringify(s))
  window.dispatchEvent(new Event(MY_PREFABS.event))
}

export const browserPrefabDevice: PrefabDevice = {
  read: readPrefabStore,
  write: writePrefabStore,
  takeAside(owner) {
    const s = parseState(localStorage.getItem(MY_PREFABS.asidePrefix + owner))
    localStorage.removeItem(MY_PREFABS.asidePrefix + owner)
    return s
  },
  setAside: (s) => localStorage.setItem(MY_PREFABS.asidePrefix + s.owner, JSON.stringify(s)),
  hasBlob: (h) => db.hasBlob(h),
  getBlob: (h) => db.getBlob(h),
  putBlob: (h, b) => db.putBlob(h, b),
}

/**
 * A time for a change to something saved at `saved`: now, or just after
 * `saved` when this device's clock is behind the one that saved it, so the
 * change still wins.
 */
export function stampAfter(saved: string): string {
  const now = Date.now(), t = Date.parse(saved)
  return new Date(Number.isFinite(t) && t >= now ? t + 1 : now).toISOString()
}

/** The state with piece `id` removed and its deletion remembered. */
export function deletePiece(s: PrefabState, id: string): PrefabState {
  const p = s.pieces.find((x) => x.id === id)
  const marker = { id, deleted: p ? stampAfter(p.saved) : new Date().toISOString() }
  return { ...s, pieces: s.pieces.filter((x) => x.id !== id), deleted: [marker, ...s.deleted.filter((d) => d.id !== id)].slice(0, MAX_DELETIONS) }
}

/** The state with piece `id` renamed; renaming counts as a save, so the new name wins on other devices. */
export function renamePiece(s: PrefabState, id: string, name: string): PrefabState {
  return { ...s, pieces: s.pieces.map((p) => (p.id === id ? { ...p, name, saved: stampAfter(p.saved) } : p)) }
}

/** Both copies combined. Pieces keep `a`'s order, then `b`'s new ones. */
export function mergePrefabs(a: PrefabState, b: PrefabState): PrefabState {
  const gone = new Map<string, string>()
  for (const d of [...a.deleted, ...b.deleted]) if (!(d.deleted <= (gone.get(d.id) ?? ''))) gone.set(d.id, d.deleted)
  const pieces = new Map<string, SyncedPrefab>()
  for (const p of [...a.pieces, ...b.pieces]) { const cur = pieces.get(p.id); if (!cur || p.saved > cur.saved) pieces.set(p.id, p) }
  const live = [...pieces.values()].filter((p) => !(p.saved <= (gone.get(p.id) ?? '')))
  const liveIds = new Set(live.map((p) => p.id))
  const deleted = [...gone].filter(([id]) => !liveIds.has(id)).map(([id, deleted]) => ({ id, deleted }))
    .sort((x, y) => y.deleted.localeCompare(x.deleted)).slice(0, MAX_DELETIONS)
  return { pieces: live, deleted }
}

const stateKey = (s: PrefabState) => JSON.stringify([
  [...s.pieces].sort((x, y) => x.id.localeCompare(y.id)),
  [...s.deleted].sort((x, y) => x.id.localeCompare(y.id)),
  s.owner ?? null,
])

type LibraryProject = Project & { my_prefabs?: PrefabState }

const libraryState = (p: LibraryProject | undefined): PrefabState => ({ pieces: p?.my_prefabs?.pieces ?? [], deleted: p?.my_prefabs?.deleted ?? [] })

function libraryProject(s: PrefabState, before?: LibraryProject): LibraryProject {
  const now = new Date().toISOString()
  // Keyed per piece so two pieces' files never overwrite each other.
  const files: Record<string, FileRef> = {}
  for (const p of s.pieces) for (const [path, ref] of Object.entries(p.bundle.files)) files[`${p.id}|${path}`] = ref
  return {
    ...newProject('My prefabs'), id: LIBRARY_PROJECT_ID, description: 'Saved pieces (My prefabs). Not a map.',
    created_at: before?.created_at ?? now, updated_at: now, files, my_prefabs: { pieces: s.pieces, deleted: s.deleted },
  }
}

/**
 * Make the device's working copy the signed-in account's: a copy that belongs
 * to someone else is set aside for them, and this account's own (if it was
 * set aside earlier) comes back. A copy with no owner yet joins this account.
 */
function adoptFor(device: PrefabDevice, uid: string) {
  const cur = device.read()
  if (cur.owner === uid) return
  if (cur.owner) {
    device.setAside({ ...cur, owner: cur.owner })
    device.write({ ...(device.takeAside(uid) ?? { pieces: [], deleted: [] }), owner: uid })
  } else {
    device.write({ ...cur, owner: uid })
  }
}

export interface PrefabSyncResult {
  pieces: number
  /** Game files some pieces use that this device doesn't have (they are never uploaded). */
  missingGameFiles: string[]
}

/** One sync of My prefabs between `device` and the signed-in account. */
export async function syncMyPrefabsWith(b: Backend, device: PrefabDevice): Promise<PrefabSyncResult> {
  const user = await b.getUser()
  if (!user) throw new Error('Sign in first.')
  adoptFor(device, user.id)
  for (let attempt = 0; ; attempt++) {
    const remote = await b.getCloudProject(LIBRARY_PROJECT_ID)
    const before = remote?.project as LibraryProject | undefined
    const theirs = libraryState(before)
    const merged = mergePrefabs(device.read(), theirs)

    // Files of pieces saved on another device.
    const refs = merged.pieces.flatMap((p) => Object.values(p.bundle.files))
    const need: string[] = []
    for (const h of new Set(refs.filter((r) => r.origin === 'user').map((r) => r.hash))) if (!(await device.hasBlob(h))) need.push(h)
    await eachLimit(need, 3, async (hash) => {
      // A file the saving device no longer had was never uploaded; that piece just lacks it.
      try { await device.putBlob(hash, await b.downloadBlob(hash)) } catch (e) { console.warn('My prefabs: file not downloaded', hash, e) }
    })

    if (stateKey(merged) !== stateKey(theirs) && (remote || merged.pieces.length || merged.deleted.length)) {
      const project = libraryProject(merged, before)
      await uploadMissing(b, projectUploadPlan(project), (h) => device.getBlob(h))
      try {
        await b.putCloudProject(project, null, { expectedUpdatedAt: remote?.updated_at })
      } catch (e) {
        if (e instanceof ConflictError && attempt < 3) continue
        throw e
      }
    }

    // Re-read: a piece saved while this ran is kept (and sent by the next sync).
    const now = device.read()
    const next = { ...mergePrefabs(now, merged), owner: user.id }
    if (stateKey(next) !== stateKey(now)) device.write(next)

    const missingGameFiles = new Set<string>()
    for (const r of refs) if (r.origin === 'game' && !(await device.hasBlob(r.hash))) missingGameFiles.add(r.name)
    return { pieces: next.pieces.length, missingGameFiles: [...missingGameFiles] }
  }
}

let running: Promise<PrefabSyncResult | null> | null = null
let again = false

/**
 * Sync this browser's My prefabs with the signed-in account; null when
 * accounts are off, nobody is signed in or it failed (a toast says why).
 * Calls while one runs are folded into one more pass.
 */
export function syncMyPrefabs(): Promise<PrefabSyncResult | null> {
  if (running) { again = true; return running }
  running = (async () => {
    const b = await getBackend()
    if (!b || !(await b.getUser())) return null
    let res: PrefabSyncResult
    do { again = false; res = await syncMyPrefabsWith(b, browserPrefabDevice) } while (again)
    return res
  })().catch(async (e) => {
    console.warn('My prefabs did not sync', e)
    const { toast } = await import('../ui')
    toast(`My prefabs did not sync to your account: ${e instanceof Error ? e.message : String(e)} They are still saved in this browser.`, 'bad', 8000)
    return null
  }).finally(() => { running = null })
  return running
}
