// Local storage in IndexedDB: projects, content-addressed file blobs and the
// user's data pack. Nothing here leaves the device unless the user signs in
// and syncs (see backend/).
import type { Project } from './project'

const DB_NAME = 'sr1-map-studio'
const DB_VERSION = 1

export interface ProjectRecord {
  id: string
  name: string
  updated_at: string
  project: Project
  thumbnail?: Blob
  cloud?: { synced_at: string; remote_updated_at: string }
}
export interface BlobRecord { hash: string; blob: Blob; size: number }
export interface DataPackRecord { path: string; blob: Blob; sha256: string }

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb(name = DB_NAME): Promise<IDBDatabase> {
  if (name === DB_NAME && dbPromise) return dbPromise
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'hash' })
      if (!db.objectStoreNames.contains('datapack')) db.createObjectStore('datapack', { keyPath: 'path' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  if (name === DB_NAME) dbPromise = p
  return p
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function store(name: string, mode: IDBTransactionMode = 'readonly') {
  const db = await openDb()
  return db.transaction(name, mode).objectStore(name)
}

export const db = {
  async listProjects(): Promise<Omit<ProjectRecord, 'project'>[]> {
    const all: ProjectRecord[] = await wrap((await store('projects')).getAll())
    return all
      .map(({ project: _p, ...rest }) => rest)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  },
  async getProject(id: string): Promise<ProjectRecord | undefined> {
    return wrap((await store('projects')).get(id))
  },
  async putProject(rec: ProjectRecord) {
    await wrap((await store('projects', 'readwrite')).put(rec))
  },
  async deleteProject(id: string) {
    await wrap((await store('projects', 'readwrite')).delete(id))
    await wrap((await store('meta', 'readwrite')).delete('versions:' + id)) // saved versions (lib/versions.ts)
  },
  async getBlob(hash: string): Promise<Blob | undefined> {
    const r: BlobRecord | undefined = await wrap((await store('blobs')).get(hash))
    return r?.blob
  },
  async hasBlob(hash: string): Promise<boolean> {
    return (await wrap((await store('blobs')).getKey(hash))) !== undefined
  },
  async putBlob(hash: string, blob: Blob) {
    await wrap((await store('blobs', 'readwrite')).put({ hash, blob, size: blob.size } satisfies BlobRecord))
  },
  async deleteBlob(hash: string) {
    await wrap((await store('blobs', 'readwrite')).delete(hash))
  },
  async getDataPackFile(path: string): Promise<DataPackRecord | undefined> {
    return wrap((await store('datapack')).get(path))
  },
  async listDataPack(): Promise<string[]> {
    return (await wrap((await store('datapack')).getAllKeys())) as string[]
  },
  async putDataPackFiles(files: DataPackRecord[]) {
    const s = await store('datapack', 'readwrite')
    await Promise.all(files.map((f) => wrap(s.put(f))))
  },
  async clearDataPack() {
    await wrap((await store('datapack', 'readwrite')).clear())
  },
  async getMeta<T>(key: string): Promise<T | undefined> {
    return wrap((await store('meta')).get(key))
  },
  async setMeta(key: string, value: unknown) {
    await wrap((await store('meta', 'readwrite')).put(value, key))
  },
}

export async function sha256(data: ArrayBuffer | Blob): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Ask the browser not to evict our storage under pressure. */
export async function requestPersistence(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false } catch { return false }
}
