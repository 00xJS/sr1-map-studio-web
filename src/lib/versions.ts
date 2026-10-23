// Saved versions of a map: full snapshots kept in this browser (the 'meta'
// store, so no schema change). Files are content addressed and never deleted,
// so a snapshot only needs the project itself.
import { db } from './db'
import { uid, type Project } from './project'

export interface MapVersion { id: string; label: string; created_at: string; auto?: boolean; project: Project; thumbnail?: Blob }

export const MAX_VERSIONS = 20
const AUTO_EVERY_MS = 60 * 60 * 1000
const key = (projectId: string) => 'versions:' + projectId

/** Newest first. */
export async function listVersions(projectId: string): Promise<MapVersion[]> {
  return ((await db.getMeta<MapVersion[]>(key(projectId))) ?? []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function saveVersion(project: Project, label: string, o: { auto?: boolean; thumbnail?: Blob | null } = {}): Promise<MapVersion> {
  const v: MapVersion = { id: uid(), label: label.trim() || 'Untitled version', created_at: new Date().toISOString(), project: structuredClone(project), ...(o.auto ? { auto: true } : {}), ...(o.thumbnail ? { thumbnail: o.thumbnail } : {}) }
  const list = [v, ...(await listVersions(project.id))]
  // Over the cap: drop the oldest automatic version first, then the oldest of any kind.
  while (list.length > MAX_VERSIONS) {
    const i = list.map((x) => !!x.auto).lastIndexOf(true)
    list.splice(i >= 0 ? i : list.length - 1, 1)
  }
  await db.setMeta(key(project.id), list)
  return v
}

export async function deleteVersion(projectId: string, id: string) {
  await db.setMeta(key(projectId), (await listVersions(projectId)).filter((v) => v.id !== id))
}

export async function deleteAllVersions(projectId: string) {
  await db.setMeta(key(projectId), [])
}

/** On opening a map: keep a version if the newest one is over an hour old. */
export async function autoVersion(project: Project, thumbnail?: Blob) {
  if (!project.scene_items.length) return
  const [latest] = await listVersions(project.id)
  if (latest && Date.now() - Date.parse(latest.created_at) < AUTO_EVERY_MS) return
  if (latest && JSON.stringify(latest.project.scene_items) === JSON.stringify(project.scene_items) && latest.project.markers.length === project.markers.length) return
  await saveVersion(project, 'Opened ' + new Date().toLocaleString(), { auto: true, thumbnail })
}
