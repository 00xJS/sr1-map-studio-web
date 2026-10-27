// Development stand-in for the server: accounts, cloud saves and the hub are
// simulated in a separate IndexedDB database in this browser. Publishing runs
// the same hubRules checks as the Netlify function so rejections can be tested.
import { HEAD_BYTES, checkShots, isValidThumbnail, libraryIdsFrom, prepareShowcase, type HubFile } from '../hubRules'
import type { Project } from '../project'
import {
  ConflictError, LIBRARY_PROJECT_ID, PublishRejected,
  type Backend, type CloudProjectMeta, type HubMapDetail, type HubMapMeta, type HubQuery, type HubReport, type PublishInput, type ReportReason, type User,
} from './types'

const DB_NAME = 'sr1-local-server'
const SESSION_KEY = 'sr1-local-server:session'
const STORES = ['users', 'cloud', 'blobs', 'maps', 'likes', 'reports', 'log', 'ratings', 'featured'] as const
type StoreName = (typeof STORES)[number]
const MAX_PUBLISH_PER_DAY = 20

interface UserRow { id: string; name: string; is_moderator: boolean; created_at: string; email?: string }
interface CloudRow { uid: string; id: string; name: string; updated_at: string; project: Project; size_bytes: number; thumb: Blob | null }
interface MapRow {
  id: string; owner: string; project_id: string; title: string; description: string; tags: string[]
  snapshot: Project; files: HubFile[]; likes: number; remixes: number; downloads: number
  created_at: string; updated_at: string; remix_of: { id: string; title: string } | null
  hidden: boolean; version: number; thumb: Blob | null
  shots?: Blob[]; rating_sum?: number; rating_count?: number
}
interface ReportRow { id: string; map_id: string; reason: ReportReason; details: string; reporter: string; status: HubReport['status']; created_at: string }

let dbp: Promise<IDBDatabase> | null = null
function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}
function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
}
async function os(name: StoreName, mode: IDBTransactionMode = 'readonly') { return (await open()).transaction(name, mode).objectStore(name) }
const get = async <T>(s: StoreName, key: string): Promise<T | undefined> => wrap((await os(s)).get(key))
const put = async (s: StoreName, key: string, value: unknown) => { await wrap((await os(s, 'readwrite')).put(value, key)) }
const del = async (s: StoreName, key: string | IDBKeyRange) => { await wrap((await os(s, 'readwrite')).delete(key)) }
const all = async <T>(s: StoreName): Promise<T[]> => wrap((await os(s)).getAll()) as Promise<T[]>
const keys = async (s: StoreName, range?: IDBKeyRange): Promise<string[]> => wrap((await os(s)).getAllKeys(range)) as Promise<string[]>
const prefix = (p: string) => IDBKeyRange.bound(p, p + '￿')

async function hashText(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// One object URL per stored thumbnail version, revoked when replaced.
const urls = new Map<string, { stamp: string; url: string }>()
function thumbUrl(key: string, stamp: string, blob: Blob | null): string | undefined {
  if (!blob) return undefined
  const cur = urls.get(key)
  if (cur?.stamp === stamp) return cur.url
  if (cur) URL.revokeObjectURL(cur.url)
  const url = URL.createObjectURL(blob)
  urls.set(key, { stamp, url })
  return url
}

const toUser = (u: UserRow): User => ({ id: u.id, name: u.name, is_moderator: u.is_moderator, ...(u.email ? { email: u.email } : {}) })
const now = () => new Date().toISOString()

export class LocalBackend implements Backend {
  readonly kind = 'local' as const
  readonly label = 'Local test server (this browser only)'
  private listeners = new Set<(u: User | null) => void>()

  // ---------------- auth ----------------

  async getUser(): Promise<User | null> {
    const id = localStorage.getItem(SESSION_KEY)
    const row = id ? await get<UserRow>('users', id) : undefined
    return row ? toUser(row) : null
  }
  private async me(): Promise<UserRow> {
    const id = localStorage.getItem(SESSION_KEY)
    const row = id ? await get<UserRow>('users', id) : undefined
    if (!row) throw new Error('Sign in first.')
    return row
  }
  private emit(u: User | null) { for (const cb of this.listeners) cb(u) }
  onAuthChange(cb: (user: User | null) => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb) } }

  private async signIn(id: string, name: string, email?: string) {
    let row = await get<UserRow>('users', id)
    if (!row) {
      // The first account on this simulated server moderates, so moderation can be tried.
      row = { id, name, is_moderator: (await keys('users')).length === 0, created_at: now(), ...(email ? { email } : {}) }
      await put('users', id, row)
    } else if (email && row.email !== email) {
      row = { ...row, email }
      await put('users', id, row)
    }
    localStorage.setItem(SESSION_KEY, id)
    this.emit(toUser(row))
  }
  async signInWithEmail(email: string): Promise<'link-sent' | 'signed-in'> {
    const e = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Enter a valid email address.')
    await this.signIn('u-' + (await hashText(e)).slice(0, 16), e.split('@')[0].slice(0, 40), e)
    return 'signed-in'
  }
  async signInWithProvider(): Promise<void> { await this.signIn('local-tester', 'Local tester') }
  async signOut() { localStorage.removeItem(SESSION_KEY); this.emit(null) }
  async updateProfile(name: string): Promise<User> {
    const n = name.trim()
    if (n.length < 1 || n.length > 40) throw new Error('Display names are 1 to 40 characters.')
    const row = { ...(await this.me()), name: n }
    await put('users', row.id, row)
    this.emit(toUser(row))
    return toUser(row)
  }

  // ---------------- cloud saves ----------------

  async listCloudProjects(): Promise<CloudProjectMeta[]> {
    const u = await this.me()
    const rows = (await all<CloudRow>('cloud')).filter((r) => r.uid === u.id && r.id !== LIBRARY_PROJECT_ID)
    return rows
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((r) => ({ id: r.id, name: r.name, updated_at: r.updated_at, size_bytes: r.size_bytes, thumbnail_url: thumbUrl(`c/${u.id}/${r.id}`, r.updated_at, r.thumb) }))
  }
  async getCloudProject(id: string) {
    const u = await this.me()
    const r = await get<CloudRow>('cloud', `${u.id}/${id}`)
    return r ? { project: r.project, updated_at: r.updated_at } : null
  }
  async putCloudProject(project: Project, thumbnail: Blob | null, opts?: { expectedUpdatedAt?: string }) {
    const u = await this.me()
    const key = `${u.id}/${project.id}`
    const cur = await get<CloudRow>('cloud', key)
    if (cur && opts?.expectedUpdatedAt && cur.updated_at !== opts.expectedUpdatedAt) throw new ConflictError(cur.updated_at)
    let updated_at = now()
    if (cur && updated_at <= cur.updated_at) updated_at = new Date(Date.parse(cur.updated_at) + 1).toISOString()
    const size = JSON.stringify(project).length + Object.values(project.files).filter((f) => f.origin === 'user').reduce((a, f) => a + f.size, 0)
    await put('cloud', key, { uid: u.id, id: project.id, name: project.name, updated_at, project, size_bytes: size, thumb: thumbnail ?? cur?.thumb ?? null } satisfies CloudRow)
    return { updated_at }
  }
  async deleteCloudProject(id: string) { const u = await this.me(); await del('cloud', `${u.id}/${id}`) }
  async hasBlobs(hashes: string[]): Promise<Set<string>> {
    const u = await this.me()
    const p = `u/${u.id}/`
    const have = new Set((await keys('blobs', prefix(p))).map((k) => k.slice(p.length)))
    return new Set(hashes.filter((h) => have.has(h)))
  }
  async uploadBlob(hash: string, blob: Blob) { const u = await this.me(); await put('blobs', `u/${u.id}/${hash}`, blob) }
  async downloadBlob(hash: string): Promise<Blob> {
    const u = await this.me()
    const b = await get<Blob>('blobs', `u/${u.id}/${hash}`)
    if (!b) throw new Error('That file is not in your cloud storage.')
    return b
  }

  // ---------------- hub ----------------

  private async viewer() { return this.getUser() }
  private canSee(m: MapRow, me: User | null) { return !m.hidden || m.owner === me?.id || !!me?.is_moderator }

  private async toMeta(rows: MapRow[], me: User | null, withShots = false): Promise<HubMapMeta[]> {
    const users = new Map((await all<UserRow>('users')).map((u) => [u.id, u]))
    const liked = new Set(me ? (await keys('likes')).filter((k) => k.endsWith('|' + me.id)).map((k) => k.split('|')[0]) : [])
    const stars = me ? await Promise.all(rows.map((m) => get<number>('ratings', `${m.id}|${me.id}`))) : []
    return rows.map((m, i) => ({
      id: m.id, title: m.title, description: m.description, tags: m.tags,
      author: { id: m.owner, name: users.get(m.owner)?.name ?? 'Unknown' },
      thumbnail_url: thumbUrl('h/' + m.id, m.updated_at, m.thumb),
      likes: m.likes, rating: m.rating_count ? (m.rating_sum ?? 0) / m.rating_count : 0, ratings: m.rating_count ?? 0, my_rating: me ? stars[i] ?? 0 : undefined,
      shots: withShots ? (m.shots ?? []).map((b, k) => thumbUrl(`s/${m.id}/${k}`, m.updated_at, b)!) : [],
      remixes: m.remixes, downloads: m.downloads,
      created_at: m.created_at, updated_at: m.updated_at, remix_of: m.remix_of,
      liked_by_me: me ? liked.has(m.id) : undefined, hidden: m.hidden, project_id: m.owner === me?.id ? m.project_id : undefined,
    }))
  }

  async listHub(q: HubQuery) {
    const me = await this.viewer()
    const users = new Map((await all<UserRow>('users')).map((u) => [u.id, u.name]))
    const words = (q.search || '').toLowerCase().split(/\s+/).filter(Boolean)
    let rows = (await all<MapRow>('maps')).filter((m) => !m.hidden)
    if (q.tag) rows = rows.filter((m) => m.tags.includes(q.tag!))
    if (q.author) rows = rows.filter((m) => m.owner === q.author)
    if (words.length) {
      rows = rows.filter((m) => {
        const hay = [m.title, m.description, m.tags.join(' '), users.get(m.owner) ?? ''].join(' ').toLowerCase()
        return words.every((w) => hay.includes(w))
      })
    }
    const byNew = (a: MapRow, b: MapRow) => b.created_at.localeCompare(a.created_at)
    const avg = (m: MapRow) => (m.rating_count ? (m.rating_sum ?? 0) / m.rating_count : 0)
    rows.sort(q.sort === 'top' ? (a, b) => avg(b) - avg(a) || (b.rating_count ?? 0) - (a.rating_count ?? 0) || byNew(a, b) : q.sort === 'remixed' ? (a, b) => b.remixes - a.remixes || byNew(a, b) : byNew)
    const start = (Math.max(1, q.page) - 1) * q.pageSize
    return { items: await this.toMeta(rows.slice(start, start + q.pageSize), me), total: rows.length }
  }

  async popularTags(limit = 24) {
    const counts = new Map<string, number>()
    for (const m of await all<MapRow>('maps')) if (!m.hidden) for (const t of m.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, limit)
  }

  async getHubMap(id: string): Promise<HubMapDetail | null> {
    const me = await this.viewer()
    const m = await get<MapRow>('maps', id)
    if (!m || !this.canSee(m, me)) return null
    const [meta] = await this.toMeta([m], me, true)
    return { ...meta, project: m.snapshot }
  }

  async downloadHubBlob(mapId: string, hash: string): Promise<Blob> {
    const m = await get<MapRow>('maps', mapId)
    if (!m || !this.canSee(m, await this.viewer())) throw new Error('This map is not available.')
    const b = await get<Blob>('blobs', `hub/${mapId}/${hash}`)
    if (!b) throw new Error('A file of this map is missing on the server.')
    return b
  }

  async publish(input: PublishInput): Promise<{ id: string }> {
    const u = await this.me()
    const since = new Date(Date.now() - 86400_000).toISOString()
    const log = (await all<{ uid: string; at: string }>('log')).filter((l) => l.uid === u.id && l.at > since)
    if (log.length >= MAX_PUBLISH_PER_DAY) throw new PublishRejected(`You can publish ${MAX_PUBLISH_PER_DAY} times a day. Try again tomorrow.`)
    let existing: MapRow | undefined
    if (input.mapId) {
      existing = await get<MapRow>('maps', input.mapId)
      if (!existing || existing.owner !== u.id) throw new PublishRejected('You can only update Showcase maps you published.')
    }
    const library = libraryIdsFrom(await fetch('/textures/index.json').then((r) => r.json()))
    const prep = prepareShowcase(input.snapshot, input, library)
    const blob = (hash: string) => get<Blob>('blobs', `u/${u.id}/${hash}`)
    const head = async (b: Blob) => ({ size: b.size, head: new Uint8Array(await b.slice(0, HEAD_BYTES).arrayBuffer()) })
    const shots = await Promise.all(input.shots.map(blob))
    if (shots.some((b) => !b)) prep.problems.push("A screenshot hasn't finished uploading. Try again.")
    else prep.problems.push(...checkShots(await Promise.all((shots as Blob[]).map(head))))
    const thumbBlob = input.thumb ? await blob(input.thumb) : undefined
    const th = thumbBlob ? await head(thumbBlob) : null
    if (prep.problems.length) throw new PublishRejected("This map can't go in the Showcase yet.", prep.problems)

    const id = existing?.id ?? crypto.randomUUID()
    const r = prep.snapshot.remix_of
    const parent = r?.hub_id && r.hub_id !== id ? await get<MapRow>('maps', r.hub_id) : undefined
    const t = now()
    const row: MapRow = {
      id, owner: u.id, project_id: input.projectId, ...prep.meta, snapshot: prep.snapshot, files: [],
      likes: existing?.likes ?? 0, remixes: existing?.remixes ?? 0, downloads: existing?.downloads ?? 0,
      rating_sum: existing?.rating_sum ?? 0, rating_count: existing?.rating_count ?? 0,
      created_at: existing?.created_at ?? t, updated_at: t,
      remix_of: parent ? { id: parent.id, title: parent.title } : null,
      hidden: existing?.hidden ?? false, version: (existing?.version ?? 0) + 1,
      thumb: thumbBlob && th && isValidThumbnail(th.size, th.head) ? thumbBlob : null, shots: shots as Blob[],
    }
    await put('maps', id, row)
    await put('log', crypto.randomUUID(), { uid: u.id, at: t })
    return { id }
  }

  async unpublish(mapId: string) {
    const u = await this.me()
    const m = await get<MapRow>('maps', mapId)
    if (!m) return
    if (m.owner !== u.id) throw new Error('You can only unpublish your own maps.')
    await del('maps', mapId)
    await del('blobs', prefix(`hub/${mapId}/`))
    await del('likes', prefix(mapId + '|'))
    await del('ratings', prefix(mapId + '|'))
    for (const r of await all<ReportRow>('reports')) if (r.map_id === mapId) await del('reports', r.id)
  }

  async myPublished(): Promise<HubMapMeta[]> {
    const u = await this.me()
    const rows = (await all<MapRow>('maps')).filter((m) => m.owner === u.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return this.toMeta(rows, toUser(u))
  }

  private async bump(mapId: string, field: 'likes' | 'remixes' | 'downloads', by: number) {
    const m = await get<MapRow>('maps', mapId)
    if (m) await put('maps', mapId, { ...m, [field]: Math.max(0, m[field] + by) })
  }
  async setLike(mapId: string, liked: boolean) {
    const u = await this.me()
    const key = `${mapId}|${u.id}`
    const had = (await get('likes', key)) !== undefined
    if (liked === had) return
    const m = await get<MapRow>('maps', mapId)
    if (liked && (!m || m.hidden)) throw new Error('This map is not available.')
    if (liked) await put('likes', key, true)
    else await del('likes', key)
    await this.bump(mapId, 'likes', liked ? 1 : -1)
  }
  async setRating(mapId: string, stars: number) {
    const u = await this.me()
    const m = await get<MapRow>('maps', mapId)
    if (!m || m.hidden) throw new Error('This map is not available.')
    if (m.owner === u.id) throw new Error("You can't rate your own map.")
    const key = `${mapId}|${u.id}`
    const had = (await get<number>('ratings', key)) ?? 0
    if (stars) await put('ratings', key, Math.max(1, Math.min(5, Math.round(stars))))
    else await del('ratings', key)
    const next = stars ? Math.max(1, Math.min(5, Math.round(stars))) : 0
    await put('maps', mapId, { ...m, rating_sum: (m.rating_sum ?? 0) - had + next, rating_count: (m.rating_count ?? 0) - (had ? 1 : 0) + (next ? 1 : 0) })
  }
  async mapOfWeek(): Promise<HubMapMeta | null> {
    const rows = (await all<MapRow>('maps')).filter((m) => !m.hidden)
    const pick = await get<string>('featured', weekStart())
    const score = (m: MapRow) => ((m.rating_sum ?? 0) + 10.5) / ((m.rating_count ?? 0) + 3)
    const recent = (days: number) => rows.filter((m) => Date.now() - Date.parse(m.created_at) < days * 864e5).sort((a, b) => score(b) - score(a) || b.remixes - a.remixes)[0]
    const m = rows.find((x) => x.id === pick) ?? recent(7) ?? recent(30)
    return m ? (await this.toMeta([m], await this.viewer()))[0] : null
  }
  async featureMap(mapId: string) {
    await this.mod()
    await put('featured', weekStart(), mapId)
  }
  async recordRemix(mapId: string) { await this.bump(mapId, 'remixes', 1) }
  async recordDownload(mapId: string) { await this.bump(mapId, 'downloads', 1) }

  async report(mapId: string, reason: ReportReason, details: string) {
    const u = await this.me()
    const open = (await all<ReportRow>('reports')).some((r) => r.map_id === mapId && r.reporter === u.id && r.status === 'open')
    if (open) throw new Error('You already reported this map. A moderator will look at it.')
    const id = crypto.randomUUID()
    await put('reports', id, { id, map_id: mapId, reason, details: details.slice(0, 2000), reporter: u.id, status: 'open', created_at: now() } satisfies ReportRow)
  }

  // ---------------- moderation ----------------

  private async mod() {
    const u = await this.me()
    if (!u.is_moderator) throw new Error('Only moderators can do this.')
    return u
  }
  async listReports(): Promise<HubReport[]> {
    await this.mod()
    const users = new Map((await all<UserRow>('users')).map((u) => [u.id, u.name]))
    const maps = new Map((await all<MapRow>('maps')).map((m) => [m.id, m.title]))
    return (await all<ReportRow>('reports'))
      .filter((r) => r.status === 'open')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => ({ ...r, map_title: maps.get(r.map_id) ?? '(deleted map)', reporter: users.get(r.reporter) ?? 'Unknown' }))
  }
  async resolveReport(id: string, action: 'dismiss' | 'hide') {
    await this.mod()
    const r = await get<ReportRow>('reports', id)
    if (!r) return
    if (action === 'dismiss') { await put('reports', id, { ...r, status: 'dismissed' }); return }
    await this.setHidden(r.map_id, true)
    for (const o of await all<ReportRow>('reports')) if (o.map_id === r.map_id && o.status === 'open') await put('reports', o.id, { ...o, status: 'actioned' })
  }
  async setHidden(mapId: string, hidden: boolean) {
    await this.mod()
    const m = await get<MapRow>('maps', mapId)
    if (m) await put('maps', mapId, { ...m, hidden })
  }
}

/** Monday of this week (UTC), as the Supabase schema keys map-of-the-week picks. */
function weekStart() {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10)
}
