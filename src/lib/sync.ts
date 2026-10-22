// Cloud saves and hub transfers between the local IndexedDB store and the
// account backend. Files with origin 'game' (the user's own Saints Row data)
// are never uploaded; /studio/ data-pack paths are never in project.files.
import { getBackend, ConflictError, PublishRejected, type Backend, type CloudProjectMeta, type HubMapDetail, type User } from './backend'
import { db, sha256, type ProjectRecord } from './db'
import { checkPublishFiles, checkPublishMeta, HEAD_BYTES, projectUploadPlan, type PublishMeta } from './hubRules'
import { normalizeProject, uid, type Project } from './project'

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

/** Local changes not yet in the cloud copy. */
export const hasUnsyncedChanges = (rec: Pick<ProjectRecord, 'updated_at' | 'cloud'>) => !rec.cloud || rec.updated_at > rec.cloud.synced_at

/**
 * Upload the project's user files, thumbnail and data to the cloud.
 * Throws ConflictError when the cloud copy changed elsewhere (pass force to overwrite).
 */
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

  onProgress?.({ phase: 'Checking files', done: 0, total: plan.hashes.length })
  const have = await b.hasBlobs(plan.hashes)
  const missing = plan.hashes.filter((h) => !have.has(h))
  const names = new Map(plan.upload.map((f) => [f.ref.hash, f.ref.name]))
  let done = 0
  onProgress?.({ phase: 'Uploading files', done, total: missing.length })
  await eachLimit(missing, 3, async (hash) => {
    const blob = await db.getBlob(hash)
    if (!blob) throw new Error(`${names.get(hash)} is missing on this device, so it can't be uploaded. Re-import it and try again.`)
    await b.uploadBlob(hash, blob)
    onProgress?.({ phase: 'Uploading files', done: ++done, total: missing.length })
  })

  onProgress?.({ phase: 'Saving project', done: 0, total: 1 })
  const res = await b.putCloudProject(rec.project, rec.thumbnail ?? null, { expectedUpdatedAt })
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

/** Check a project locally with the same rules the server uses. */
export async function precheckPublish(project: Project, meta: PublishMeta): Promise<string[]> {
  const plan = projectUploadPlan(project)
  const problems = [...checkPublishMeta(meta), ...plan.blockers]
  const seen = new Set<string>()
  const files = []
  for (const f of plan.upload) {
    if (seen.has(f.ref.hash)) continue
    seen.add(f.ref.hash)
    const blob = await db.getBlob(f.ref.hash)
    if (!blob) { problems.push(`${f.ref.name} is missing on this device. Re-import it and try again.`); continue }
    files.push({ name: f.ref.name, size: blob.size, type: f.ref.type, head: new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer()) })
  }
  return [...problems, ...checkPublishFiles(files)]
}

/**
 * Push the (already saved) project and publish it to the hub. Pass mapId to
 * update a map you published before. Throws PublishRejected with problems, or
 * ConflictError when the cloud copy changed elsewhere (retry with force).
 */
export async function publishProject(id: string, meta: PublishMeta & { mapId?: string }, onProgress?: Progress, opts: { force?: boolean } = {}): Promise<{ id: string }> {
  const { b } = await signedIn()
  const rec = await db.getProject(id)
  if (!rec) throw new Error('Project not found on this device.')
  const problems = await precheckPublish(rec.project, meta)
  if (problems.length) throw new PublishRejected("This map can't be published yet.", problems)
  await pushProject(id, onProgress, { force: opts.force })
  onProgress?.({ phase: 'Checking and publishing', done: 0, total: 1 })
  const res = await b.publish({ projectId: id, title: meta.title, description: meta.description, tags: meta.tags, mapId: meta.mapId })
  onProgress?.({ phase: 'Published', done: 1, total: 1 })
  return res
}

/** Download a hub map's files into local storage, verifying each against its hash. */
async function fetchHubFiles(b: Backend, d: HubMapDetail, onProgress?: Progress) {
  const need: string[] = []
  for (const h of new Set(Object.values(d.project.files).filter((r) => r.origin === 'user').map((r) => r.hash))) {
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
  const p = hubProject(d)
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
  return { project: hubProject(map), map }
}
