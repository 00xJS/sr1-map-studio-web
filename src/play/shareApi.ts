// Hosting play links: unlisted, opened by a random token, readable by anyone
// who has the link (no account). Signed-in users' links last until removed;
// links made without an account expire after SHARE_RULES.anonDays. Signed-in
// owners can list a map in the gallery when every model was made on the site.
//   supabase: /api/share (Netlify function, re-checks every share, report and time) and RPCs
//             (get_share, list_gallery, share_board, share_ghost, record_share_play)
//   local:    simulated in this browser's IndexedDB (VITE_BACKEND=local), with the same rules and limits
//   none:     no hosting; the share is a file the other person opens on /play
import { backendMode, getBackend, type HubAuthor, type ReportReason } from '../lib/backend'
import { isValidThumbnail, supabaseProjectUrl } from '../lib/hubRules'
import type { RunMode } from './game'
import { checkTime, cleanName, type GhostSample } from './ghost'
import { SHARE_RULES, SHARE_TOKEN, fromBase64, galleryReady, newShareToken, packShare, shareMeta, toBase64, unpackShare, validateShareDoc, type ShareDoc } from './share'

export const hostedShares = backendMode !== 'none'

export class ShareRejected extends Error {
  constructor(message: string, public problems: string[] = []) { super(message) }
}

export const shareUrl = (token: string) => `${location.origin}/play/s/${token}`

const GONE = 'This link doesn’t lead to a map any more. Its owner may have removed it, or it expired (links made without an account last 30 days).'

// ---------------- links you made (kept in this browser) ----------------

export interface MyShare {
  token: string; title: string; created_at: string; project_id: string
  /** Made without an account: the key that updates or removes it, and when it stops working. */
  key?: string; expires_at?: string
  listed?: boolean
}
const MINE_KEY = 'sr1-play-links'

export function myShares(): MyShare[] {
  try { return JSON.parse(localStorage.getItem(MINE_KEY) || '[]') } catch { return [] }
}
function saveMine(list: MyShare[]) {
  try { localStorage.setItem(MINE_KEY, JSON.stringify(list.slice(0, 200))) } catch { /* storage blocked: the list just isn't kept */ }
}

// ---------------- local test server ----------------

const LOCAL_DB = 'sr1-local-shares'
const LOCAL_STORES = ['shares', 'reports', 'ratings', 'times'] as const
type LocalStore = (typeof LOCAL_STORES)[number]
/** The local server sees every visitor of this browser as one address. */
const LOCAL_IP = 'this-browser'
function localDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LOCAL_DB, 2)
    req.onupgradeneeded = () => { for (const s of LOCAL_STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function localTx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, store: LocalStore = 'shares'): Promise<T> {
  const s = (await localDb()).transaction(store, mode).objectStore(store)
  return new Promise((resolve, reject) => { const r = fn(s); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
}
const localAll = <T,>(store: LocalStore) => localTx<T[]>('readonly', (s) => s.getAll() as IDBRequest<T[]>, store)
const localGet = <T,>(store: LocalStore, key: string) => localTx<T | undefined>('readonly', (s) => s.get(key), store)
const localPut = (store: LocalStore, key: string, value: unknown) => localTx('readwrite', (s) => s.put(value, key), store)
const localDel = (store: LocalStore, key: string) => localTx('readwrite', (s) => s.delete(key), store)

export interface LocalRow {
  token: string; owner: string | null; owner_name?: string; title: string; data: string; created_at: string; updated_at?: string
  anon?: boolean; expires_at?: string | null; ip_hash?: string | null; key_hash?: string | null
  listed?: boolean; hidden?: boolean; thumb?: Blob | null; thumb_at?: string | null; shot?: boolean; plays?: number
  modes?: string[]; players?: number; rating_sum?: number; rating_count?: number
}
interface LocalReport { id: string; token: string; reason: ReportReason; details: string; reporter: string | null; ip_hash: string | null; status: ShareReport['status']; created_at: string }
interface LocalRating { token: string; user_id: string; stars: number }
interface LocalTime { id: string; token: string; mode: RunMode; name: string; ms: number; ghost: GhostSample[]; player: string | null; ip_hash: string | null; created_at: string }

async function sha256(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
const ago = (iso: string | undefined | null, ms: number) => !!iso && Date.now() - new Date(iso).getTime() < ms
const live = (r: LocalRow | undefined): r is LocalRow => !!r && !r.hidden && !(r.expires_at && new Date(r.expires_at).getTime() <= Date.now())

/** What the daily job does on the real server: expired links go, with their reports, ratings and times. */
async function localExpire() {
  const now = Date.now()
  const gone = (await localAll<LocalRow>('shares')).filter((r) => r.expires_at && new Date(r.expires_at).getTime() <= now).map((r) => r.token)
  if (!gone.length) return
  const set = new Set(gone)
  for (const t of gone) await localDel('shares', t)
  for (const r of await localAll<LocalReport>('reports')) if (set.has(r.token)) await localDel('reports', r.id)
  for (const r of await localAll<LocalRating>('ratings')) if (set.has(r.token)) await localDel('ratings', `${r.token}:${r.user_id}`)
  for (const r of await localAll<LocalTime>('times')) if (set.has(r.token)) await localDel('times', r.id)
}

const isWebp = (head: Uint8Array) => head.length > 12 && String.fromCharCode(...head.subarray(8, 12)) === 'WEBP'

// ---------------- the Supabase server ----------------

const SUPA = () => {
  const env = import.meta.env
  return { url: supabaseProjectUrl(env.VITE_SUPABASE_URL), key: String(env.VITE_SUPABASE_ANON_KEY).trim() }
}
/** A REST call to the Supabase project, as the signed-in user when `auth` is given. */
async function rest(path: string, init: RequestInit = {}, auth?: string | null): Promise<Response> {
  const { url, key } = SUPA()
  return fetch(`${url}/rest/v1/${path}`, { ...init, headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${auth || key}`, ...(init.headers || {}) } })
}
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) })
  if (!res.ok) throw new Error(`The server didn’t answer (HTTP ${res.status}).`)
  return res.json()
}
async function userToken(): Promise<string | null> {
  const b = await getBackend()
  return (await b?.accessToken?.()) ?? null
}
/** POSTs to the share function, signed in when possible. Rejections (4xx) become ShareRejected. */
async function fn(path: string, body: unknown, method = 'POST'): Promise<any> {
  const auth = await userToken()
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) })
  const out = await res.json().catch(() => ({}))
  if (res.status >= 400 && res.status < 500) throw new ShareRejected(out.error || 'The server refused this.', Array.isArray(out.problems) ? out.problems : [])
  if (!res.ok) throw new Error(out.error || `The server had a problem (HTTP ${res.status}). Try again later.`)
  return out
}
export const thumbUrl = (token: string, at: string | null | undefined) => at ? `${SUPA().url}/storage/v1/object/public/share-thumbs/${token}.webp?v=${new Date(at).getTime()}` : undefined

// ---------------- making and removing links ----------------

export interface ShareOptions {
  /** Replace a link you made before. */
  token?: string
  /** A preview picture (WebP): drawn from the share (sharePreview.ts), or the author's own in-game screenshot. */
  thumb?: Blob | null
  /** The preview is an in-game screenshot the author took. */
  shot?: boolean
  /** Show it in the gallery (signed in, every model made on the site). */
  listed?: boolean
}

/** Hosts the share of map `projectId`. Without an account the link expires: see `expires_at`. */
export async function createShare(doc: ShareDoc, projectId: string, opts: ShareOptions = {}): Promise<{ token: string; expires_at?: string }> {
  const data = toBase64(packShare(doc))
  const b = await getBackend()
  if (!b) throw new Error('This site has no link server. Download the share file instead.')
  const user = await b.getUser()
  const mine = opts.token ? myShares().find((s) => s.token === opts.token) : undefined
  let thumb: Uint8Array | null = null
  if (opts.thumb) {
    const t = new Uint8Array(await opts.thumb.arrayBuffer())
    if (isWebp(t) && isValidThumbnail(t.length, t.subarray(0, 64))) thumb = t
  }
  let out: { token: string; key?: string; expires_at?: string }
  if (b.kind === 'local') out = await localCreate(data, user, opts, thumb, mine?.key)
  else out = await fn('/api/share', { title: doc.title, data, token: opts.token, key: user ? undefined : mine?.key, thumb: thumb ? toBase64(thumb) : undefined, shot: !!(thumb && opts.shot), listed: !!opts.listed })
  if (typeof out?.token !== 'string') throw new Error('Making the link failed. Try again later, or download the share file.')
  saveMine([
    { token: out.token, title: doc.title, created_at: new Date().toISOString(), project_id: projectId, ...(out.key ? { key: out.key, expires_at: out.expires_at } : {}), ...(opts.listed && user ? { listed: true } : {}) },
    ...myShares().filter((s) => s.token !== out.token),
  ])
  return { token: out.token, ...(out.expires_at ? { expires_at: out.expires_at } : {}) }
}

/** What the share function does, in this browser. */
async function localCreate(data: string, user: { id: string; name: string } | null, opts: ShareOptions, thumb: Uint8Array | null, key?: string) {
  await localExpire()
  // What the server does: unpack and check the stored bytes, not what the page says.
  const { problems, doc: checked } = validateShareDoc(unpackShare(fromBase64(data)))
  if (!checked) throw new ShareRejected('This map can’t be shared yet.', problems)
  if (opts.listed && !user) throw new ShareRejected('Sign in to list a map in the gallery.')
  if (opts.listed && !galleryReady(checked)) throw new ShareRejected('Only maps built entirely from the site’s own shapes and prefabs can go in the gallery.')
  const now = new Date().toISOString()
  const meta = shareMeta(checked)
  const row = { title: checked.title, data, updated_at: now, modes: meta.modes, players: meta.players, ...(thumb ? { thumb: new Blob([thumb], { type: 'image/webp' }), thumb_at: now, shot: !!opts.shot } : {}) }
  const rows = await localAll<LocalRow>('shares')
  if (!user) {
    if (opts.token && key) {
      const old = await localGet<LocalRow>('shares', opts.token)
      if (live(old) && old.anon && old.key_hash === await sha256(key)) {
        await localPut('shares', old.token, { ...old, ...row })
        return { token: old.token, key, expires_at: old.expires_at! }
      }
    }
    const recent = rows.filter((r) => r.ip_hash === LOCAL_IP && ago(r.created_at, 86400_000)).length
    if (recent >= SHARE_RULES.anonPerDay) throw new ShareRejected(`Without an account you can make ${SHARE_RULES.anonPerDay} play links a day. Sign in for more, or try again tomorrow.`)
    const token = newShareToken(), editKey = newShareToken()
    const expires_at = new Date(Date.now() + SHARE_RULES.anonDays * 86400_000).toISOString()
    await localPut('shares', token, { ...row, token, owner: null, anon: true, expires_at, ip_hash: LOCAL_IP, key_hash: await sha256(editKey), created_at: now, plays: 0 } satisfies LocalRow)
    return { token, key: editKey, expires_at }
  }
  if (rows.filter((r) => r.owner === user.id && ago(r.updated_at ?? r.created_at, 86400_000)).length >= SHARE_RULES.perDay) {
    throw new ShareRejected(`You can make or update ${SHARE_RULES.perDay} play links a day. Try again tomorrow.`)
  }
  const old = opts.token ? await localGet<LocalRow>('shares', opts.token) : undefined
  if (old && old.owner === user.id) {
    await localPut('shares', old.token, { ...old, ...row, listed: !!opts.listed, owner_name: user.name })
    return { token: old.token }
  }
  if (rows.filter((r) => r.owner === user.id).length >= SHARE_RULES.perUser) throw new ShareRejected(`You have ${SHARE_RULES.perUser} play links. Remove some you no longer need first.`)
  const token = newShareToken()
  await localPut('shares', token, { ...row, token, owner: user.id, owner_name: user.name, listed: !!opts.listed, created_at: now, plays: 0 } satisfies LocalRow)
  return { token }
}

export async function deleteShare(token: string) {
  const b = await getBackend()
  const key = myShares().find((s) => s.token === token)?.key
  if (b?.kind === 'local') {
    const user = await b.getUser()
    const row = await localGet<LocalRow>('shares', token)
    if (row && ((key && row.anon && row.key_hash === await sha256(key)) || (user && row.owner === user.id))) await localDel('shares', token)
  } else if (b) {
    try { await fn('/api/share', { token, key }, 'DELETE') } catch (e) { if (!(e instanceof ShareRejected) || !/not found/i.test(e.message)) throw e }
  }
  saveMine(myShares().filter((s) => s.token !== token))
}

// ---------------- opening a link ----------------

export async function fetchShare(token: string): Promise<ShareDoc> {
  if (!SHARE_TOKEN.test(token)) throw new Error('This link is not complete. Check that it was copied whole.')
  let data: string | null = null
  if (backendMode === 'local') {
    await localExpire()
    const row = await localGet<LocalRow>('shares', token)
    data = live(row) ? row.data : null
  } else if (backendMode === 'supabase') {
    const rows = await rpc<{ data: string }[] | { data: string }>('get_share', { p_token: token }).catch((e) => { throw new Error(`The map could not be loaded. ${e.message}`) })
    data = (Array.isArray(rows) ? rows[0]?.data : rows?.data) ?? null
  } else {
    throw new Error('This site has no play-link server. Ask for the share file instead.')
  }
  if (!data) throw new Error(GONE)
  return readShare(fromBase64(data))
}

/** A share file or stored share, checked the same way the server checks it. */
export function readShare(bytes: Uint8Array): ShareDoc {
  const { problems, doc } = validateShareDoc(unpackShare(bytes))
  if (!doc) throw new Error(problems[0] || 'This shared map could not be read.')
  return doc
}

/** Counts one play of a link (once per page load is plenty). */
export async function recordPlay(token: string) {
  if (backendMode === 'local') {
    const row = await localGet<LocalRow>('shares', token)
    if (live(row)) await localPut('shares', token, { ...row, plays: (row.plays ?? 0) + 1 })
  } else if (backendMode === 'supabase') await rpc('record_share_play', { p_token: token }).catch(() => {})
}

/** The share as a file (gzip JSON) for sites without hosting. */
export function shareFile(doc: ShareDoc): File {
  const name = (doc.title.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase() || 'map') + '.sr1play'
  return new File([packShare(doc)], name, { type: 'application/octet-stream' })
}

// ---------------- reports ----------------

export interface ShareReport { id: string; token: string; title: string; reason: ReportReason; details: string; reporter: string; status: 'open' | 'dismissed' | 'actioned'; created_at: string }

/** Anyone who opened a link can report it; the server limits reports per address. */
export async function reportShare(token: string, reason: ReportReason, details: string) {
  const b = await getBackend()
  if (!b) throw new Error('This site has no link server.')
  if (b.kind !== 'local') { await fn('/api/share/report', { token, reason, details }); return }
  const user = await b.getUser()
  if (!live(await localGet<LocalRow>('shares', token))) throw new ShareRejected(GONE)
  const all = await localAll<LocalReport>('reports')
  if (all.filter((r) => r.ip_hash === LOCAL_IP && ago(r.created_at, 86400_000)).length >= SHARE_RULES.reportsPerDay) throw new ShareRejected('You’ve sent a lot of reports today. Try again tomorrow.')
  if (all.some((r) => r.token === token && r.status === 'open' && ((user && r.reporter === user.id) || r.ip_hash === LOCAL_IP))) throw new ShareRejected('You already reported this map. A moderator will look at it.')
  const id = crypto.randomUUID()
  await localPut('reports', id, { id, token, reason, details: details.slice(0, 2000), reporter: user?.id ?? null, ip_hash: LOCAL_IP, status: 'open', created_at: new Date().toISOString() } satisfies LocalReport)
}

/** Moderators: open reports on play links, newest first. */
export async function listShareReports(): Promise<ShareReport[]> {
  const b = await getBackend()
  if (!b) return []
  if (b.kind === 'local') {
    const shares = new Map((await localAll<LocalRow>('shares')).map((s) => [s.token, s.title]))
    return (await localAll<LocalReport>('reports')).filter((r) => r.status === 'open').sort((a, z) => z.created_at.localeCompare(a.created_at))
      .map((r) => ({ ...r, title: shares.get(r.token) ?? '(removed link)', reporter: r.reporter ? 'A signed-in user' : 'Someone without an account' }))
  }
  const res = await rest('share_reports?select=id,token,reason,details,status,created_at,reporter,share:shares(title),who:profiles(display_name)&status=eq.open&order=created_at.desc&limit=200', {}, await userToken())
  if (!res.ok) throw new Error(`Loading the reports failed (HTTP ${res.status}).`)
  return (await res.json()).map((r: any) => ({
    id: r.id, token: r.token, title: r.share?.title ?? '(removed link)', reason: r.reason, details: r.details, status: r.status, created_at: r.created_at,
    reporter: r.who?.display_name ?? (r.reporter ? 'Unknown' : 'Someone without an account'),
  }))
}

/** Moderators: dismiss a report, or hide its link (which closes every open report on it). */
export async function resolveShareReport(r: ShareReport, action: 'dismiss' | 'hide') {
  const b = await getBackend()
  if (!b) return
  if (b.kind === 'local') {
    const user = await b.getUser()
    if (!user?.is_moderator) throw new Error('Only moderators can do this.')
    if (action === 'dismiss') { await localPut('reports', r.id, { ...(await localGet<LocalReport>('reports', r.id))!, status: 'dismissed' }); return }
    const row = await localGet<LocalRow>('shares', r.token)
    if (row) await localPut('shares', r.token, { ...row, hidden: true, listed: false })
    for (const o of await localAll<LocalReport>('reports')) if (o.token === r.token && o.status === 'open') await localPut('reports', o.id, { ...o, status: 'actioned' })
    return
  }
  const auth = await userToken()
  const me = (await b.getUser())?.id
  const done = { resolved_at: new Date().toISOString(), resolved_by: me }
  const patch = async (path: string, body: unknown) => {
    const res = await rest(path, { method: 'PATCH', body: JSON.stringify(body), headers: { Prefer: 'return=minimal' } }, auth)
    if (!res.ok) throw new Error(`That didn’t work (HTTP ${res.status}).`)
  }
  if (action === 'dismiss') return patch(`share_reports?id=eq.${r.id}`, { status: 'dismissed', ...done })
  await patch(`shares?token=eq.${r.token}`, { hidden: true })
  await patch(`share_reports?token=eq.${r.token}&status=eq.open`, { status: 'actioned', ...done })
}

// ---------------- the gallery ----------------

export type GallerySort = 'new' | 'top' | 'played'
export interface GalleryItem {
  token: string; title: string; thumbnail_url?: string; shot: boolean; modes: string[]; players: number; plays: number
  rating: number; ratings: number; my_rating?: number; author: HubAuthor; created_at: string; updated_at: string
}

export async function listGallery(q: { search?: string; sort: GallerySort; page: number; pageSize: number }): Promise<{ items: GalleryItem[]; total: number }> {
  const b = await getBackend()
  if (!b) return { items: [], total: 0 }
  const user = await b.getUser()
  if (b.kind === 'local') {
    await localExpire()
    const s = (q.search || '').trim().toLowerCase()
    const ratings = await localAll<LocalRating>('ratings')
    const rows = (await localAll<LocalRow>('shares')).filter((r) => r.listed && live(r))
      .filter((r) => !s || r.title.toLowerCase().includes(s) || (r.owner_name || '').toLowerCase().includes(s))
    const score = (r: LocalRow) => ((r.rating_sum ?? 0) + 10.5) / ((r.rating_count ?? 0) + 3)
    rows.sort((a, z) => (q.sort === 'top' ? score(z) - score(a) : q.sort === 'played' ? (z.plays ?? 0) - (a.plays ?? 0) : 0) || z.created_at.localeCompare(a.created_at))
    const page = rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize)
    return {
      total: rows.length,
      items: page.map((r) => ({
        token: r.token, title: r.title, thumbnail_url: r.thumb ? localThumb(r.token, r.thumb_at ?? '', r.thumb) : undefined, shot: !!r.shot,
        modes: r.modes ?? [], players: r.players ?? 0, plays: r.plays ?? 0,
        rating: r.rating_count ? (r.rating_sum ?? 0) / r.rating_count : 0, ratings: r.rating_count ?? 0,
        my_rating: user ? ratings.find((x) => x.token === r.token && x.user_id === user.id)?.stars ?? 0 : undefined,
        author: { id: r.owner ?? '', name: r.owner_name || 'Unknown' }, created_at: r.created_at, updated_at: r.updated_at ?? r.created_at,
      })),
    }
  }
  const rows: any[] = await rpc('list_gallery', { p_search: q.search || '', p_sort: q.sort, p_limit: q.pageSize, p_offset: (q.page - 1) * q.pageSize })
  let mine = new Map<string, number>()
  const auth = user ? await userToken() : null
  if (auth && rows.length) {
    const res = await rest(`share_ratings?select=token,stars&user_id=eq.${user!.id}&token=in.(${rows.map((r) => r.token).join(',')})`, {}, auth)
    if (res.ok) mine = new Map((await res.json()).map((r: any) => [r.token, r.stars]))
  }
  return {
    total: Number(rows[0]?.total ?? 0),
    items: rows.map((r) => ({
      token: r.token, title: r.title, thumbnail_url: thumbUrl(r.token, r.thumb), shot: !!r.shot, modes: r.modes ?? [], players: r.players ?? 0, plays: r.plays ?? 0,
      rating: r.rating ?? 0, ratings: r.rating_count ?? 0, my_rating: user ? mine.get(r.token) ?? 0 : undefined,
      author: { id: r.owner, name: r.author_name || 'Unknown', avatar_url: r.author_avatar || undefined }, created_at: r.created_at, updated_at: r.updated_at,
    })),
  }
}

const thumbs = new Map<string, { stamp: string; url: string }>()
function localThumb(token: string, stamp: string, blob: Blob): string {
  const cur = thumbs.get(token)
  if (cur?.stamp === stamp) return cur.url
  if (cur) URL.revokeObjectURL(cur.url)
  const url = URL.createObjectURL(blob)
  thumbs.set(token, { stamp, url })
  return url
}

/** 1 to 5 stars for someone else's gallery map, or 0 to take the rating back. */
export async function rateShare(token: string, stars: number) {
  const b = await getBackend()
  const user = await b?.getUser()
  if (!b || !user) throw new ShareRejected('Sign in to rate maps.')
  if (b.kind === 'local') {
    const row = await localGet<LocalRow>('shares', token)
    if (!live(row) || !row.listed) throw new ShareRejected(GONE)
    if (row.owner === user.id) throw new ShareRejected('You can’t rate your own map.')
    const key = `${token}:${user.id}`
    const old = await localGet<LocalRating>('ratings', key)
    let sum = (row.rating_sum ?? 0) - (old?.stars ?? 0), count = (row.rating_count ?? 0) - (old ? 1 : 0)
    if (stars) { await localPut('ratings', key, { token, user_id: user.id, stars } satisfies LocalRating); sum += stars; count++ } else await localDel('ratings', key)
    await localPut('shares', token, { ...row, rating_sum: sum, rating_count: count })
    return
  }
  const auth = await userToken()
  const res = stars
    ? await rest('share_ratings?on_conflict=token,user_id', { method: 'POST', body: JSON.stringify({ token, user_id: user.id, stars }), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } }, auth)
    : await rest(`share_ratings?token=eq.${token}&user_id=eq.${user.id}`, { method: 'DELETE' }, auth)
  if (!res.ok) throw new Error(`Rating didn’t work (HTTP ${res.status}).`)
}

// ---------------- time-trial boards ----------------

export interface BoardRow { id: string; name: string; ms: number; created_at: string }

export async function getBoard(token: string, mode: RunMode, limit = 10): Promise<BoardRow[]> {
  if (backendMode === 'local') {
    const share = await localGet<LocalRow>('shares', token)
    if (!live(share)) return []
    return (await localAll<LocalTime>('times')).filter((t) => t.token === token && t.mode === mode)
      .sort((a, z) => a.ms - z.ms || a.created_at.localeCompare(z.created_at)).slice(0, limit)
      .map(({ id, name, ms, created_at }) => ({ id, name, ms, created_at }))
  }
  if (backendMode !== 'supabase') return []
  const rows = await rpc<any[]>('share_board', { p_token: token, p_mode: mode, p_limit: limit })
  return rows.map((r) => ({ id: String(r.id), name: r.name, ms: r.ms, created_at: r.created_at }))
}

export async function getGhost(id: string): Promise<GhostSample[] | null> {
  if (backendMode === 'local') return (await localGet<LocalTime>('times', id))?.ghost ?? null
  if (backendMode !== 'supabase') return null
  const g = await rpc<unknown>('share_ghost', { p_id: Number(id) })
  return Array.isArray(g) ? (g as GhostSample[]) : null
}

/** Posts a finished run to the link's board (the server re-checks it against the map). Returns its place. */
export async function submitTime(token: string, e: { mode: RunMode; ms: number; name: string; ghost: GhostSample[] }): Promise<number> {
  const b = await getBackend()
  if (!b) throw new Error('This site has no link server.')
  const entry = { ...e, ms: Math.round(e.ms), name: cleanName(e.name) }
  if (b.kind !== 'local') return (await fn('/api/share/time', { token, ...entry })).rank
  const user = await b.getUser()
  const share = await localGet<LocalRow>('shares', token)
  if (!live(share)) throw new ShareRejected(GONE)
  const { doc } = validateShareDoc(unpackShare(fromBase64(share.data)))
  if (!doc) throw new ShareRejected('This map can’t take times.')
  const problems = checkTime(entry, doc.project.markers)
  if (problems.length) throw new ShareRejected('This time can’t go on the board.', problems)
  const all = await localAll<LocalTime>('times')
  if (all.filter((t) => t.ip_hash === LOCAL_IP && ago(t.created_at, 3600_000)).length >= SHARE_RULES.timesPerHour) throw new ShareRejected('That’s a lot of times in an hour. Try again later.')
  const id = crypto.randomUUID()
  const created_at = new Date().toISOString()
  await localPut('times', id, { id, token, ...entry, player: user?.id ?? null, ip_hash: LOCAL_IP, created_at } satisfies LocalTime)
  const board = [...all, { id, token, ...entry, created_at } as LocalTime].filter((t) => t.token === token && t.mode === entry.mode).sort((a, z) => a.ms - z.ms || a.created_at.localeCompare(z.created_at))
  for (const t of board.slice(SHARE_RULES.boardKeep)) await localDel('times', t.id)
  return board.filter((t) => t.ms < entry.ms).length + 1
}

