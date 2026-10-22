// Client for the Pyodide worker. The worker boots lazily on first use.
import type { WorkerMessage, WorkerRequest } from './py.worker'
import { db } from './db'
import type { Project } from './project'
import { referencedPaths, isDataPackPath } from './project'

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void }
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never

class PyClient {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private written = new Map<string, string>() // vpath -> content key
  status = 'idle'
  private statusListeners = new Set<(s: string) => void>()
  private logListeners = new Set<(s: string) => void>()
  private ready: Promise<void> | null = null

  onStatus(fn: (s: string) => void) { this.statusListeners.add(fn); fn(this.status); return () => { this.statusListeners.delete(fn) } }
  onLog(fn: (s: string) => void) { this.logListeners.add(fn); return () => { this.logListeners.delete(fn) } }

  private ensureWorker() {
    if (this.worker) return this.worker
    const w = new Worker(new URL('./py.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data
      if ('type' in m) {
        if (m.type === 'status') { this.status = m.text; this.statusListeners.forEach((f) => f(m.text)) }
        else this.logListeners.forEach((f) => f(m.text))
        return
      }
      const p = this.pending.get(m.id)
      if (!p) return
      this.pending.delete(m.id)
      if (m.ok) p.resolve(m.value)
      else p.reject(new Error(m.error))
    }
    w.onerror = (e) => {
      this.status = 'error: ' + e.message
      this.statusListeners.forEach((f) => f(this.status))
    }
    this.worker = w
    return w
  }

  private send<T>(msg: DistributiveOmit<WorkerRequest, 'id'>, transfer: Transferable[] = []): Promise<T> {
    const w = this.ensureWorker()
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      w.postMessage({ ...msg, id }, transfer)
    })
  }

  init() {
    this.ready ??= this.send<boolean>({ type: 'init' }).then(() => this.mountDataPack())
    return this.ready
  }

  /** Copy the user's data pack (minus the large sky presets) into /studio. */
  private async mountDataPack(skies = false) {
    const paths = await db.listDataPack()
    const wanted = paths.filter((p) => skies ? p.startsWith('native_sky_presets/') : !p.startsWith('native_sky_presets/'))
    for (let i = 0; i < wanted.length; i += 8) {
      const batch = await Promise.all(wanted.slice(i, i + 8).map(async (p) => {
        const rec = await db.getDataPackFile(p)
        return rec ? { path: '/studio/' + p, data: await rec.blob.arrayBuffer(), key: rec.sha256 } : null
      }))
      const files = batch.filter(Boolean) as { path: string; data: ArrayBuffer; key: string }[]
      const fresh = files.filter((f) => this.written.get(f.path) !== f.key)
      if (!fresh.length) continue
      await this.send({ type: 'write', files: fresh.map(({ path, data }) => ({ path, data })) }, fresh.map((f) => f.data))
      fresh.forEach((f) => this.written.set(f.path, f.key))
    }
  }

  async remountDataPack() { await this.init(); await this.mountDataPack() }
  async mountSkies() { await this.init(); await this.mountDataPack(true) }

  /** Make sure every user file the project uses exists in the worker FS. */
  async syncProject(project: Project) {
    await this.init()
    const missing: string[] = []
    const files: { path: string; data: ArrayBuffer }[] = []
    for (const path of referencedPaths(project)) {
      if (isDataPackPath(path)) continue
      const ref = project.files[path]
      if (!ref) { missing.push(path); continue }
      if (this.written.get(path) === ref.hash) continue
      const blob = await db.getBlob(ref.hash)
      if (!blob) { missing.push(path); continue }
      files.push({ path, data: await blob.arrayBuffer() })
      this.written.set(path, ref.hash)
    }
    for (let i = 0; i < files.length; i += 16) {
      const batch = files.slice(i, i + 16)
      await this.send({ type: 'write', files: batch }, batch.map((f) => f.data))
    }
    return missing
  }

  async writeFiles(files: { path: string; data: ArrayBuffer; key?: string }[]) {
    await this.init()
    await this.send({ type: 'write', files: files.map(({ path, data }) => ({ path, data })) }, files.map((f) => f.data))
    files.forEach((f) => f.key && this.written.set(f.path, f.key))
  }

  async readFiles(paths: string[]): Promise<{ path: string; data: ArrayBuffer }[]> {
    await this.init()
    return this.send({ type: 'read', paths })
  }

  async exists(paths: string[]): Promise<boolean[]> {
    await this.init()
    return this.send({ type: 'exists', paths })
  }

  async texturePreview(path: string, max = 1024): Promise<ArrayBuffer> {
    await this.init()
    const [f] = await this.send<{ path: string; data: ArrayBuffer }[]>({ type: 'texture', path, max })
    return f.data
  }

  async call<T = any>(fn: string, ...args: (string | number | null)[]): Promise<T> {
    await this.init()
    return this.send<T>({ type: 'call', fn, args })
  }

  sceneOp<T = any>(op: string, payload: unknown): Promise<T> {
    return this.call<T>('scene_op', op, JSON.stringify(payload))
  }
}

export const py = new PyClient()
