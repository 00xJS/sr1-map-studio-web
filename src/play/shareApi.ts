// Hosting play links: unlisted, opened by a random token, readable by anyone
// who has the link (no account), made only by signed-in users.
//   supabase: /api/share (Netlify function, re-checks every share) and the get_share RPC
//   local:    simulated in this browser's IndexedDB (VITE_BACKEND=local)
//   none:     no hosting; the share is a file the other person opens on /play
import { backendMode, getBackend } from '../lib/backend'
import { supabaseProjectUrl } from '../lib/hubRules'
import { SHARE_TOKEN, fromBase64, newShareToken, packShare, toBase64, unpackShare, validateShareDoc, type ShareDoc } from './share'

export const hostedShares = backendMode !== 'none'

export class ShareRejected extends Error {
  constructor(message: string, public problems: string[] = []) { super(message) }
}

export const shareUrl = (token: string) => `${location.origin}/play/s/${token}`

// ---------------- links you made (kept in this browser) ----------------

export interface MyShare { token: string; title: string; created_at: string; project_id: string }
const MINE_KEY = 'sr1-play-links'

export function myShares(): MyShare[] {
  try { return JSON.parse(localStorage.getItem(MINE_KEY) || '[]') } catch { return [] }
}
function saveMine(list: MyShare[]) {
  try { localStorage.setItem(MINE_KEY, JSON.stringify(list.slice(0, 200))) } catch { /* storage blocked: the list just isn't kept */ }
}

// ---------------- local test server ----------------

const LOCAL_DB = 'sr1-local-shares'
function localDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LOCAL_DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('shares')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function localTx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const store = (await localDb()).transaction('shares', mode).objectStore('shares')
  return new Promise((resolve, reject) => { const r = fn(store); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
}
interface LocalRow { token: string; owner: string; title: string; data: string; created_at: string }

// ---------------- API ----------------

/** Hosts the share of map `projectId` and returns its token. `token`: replace a link you made before. */
export async function createShare(doc: ShareDoc, projectId: string, opts: { token?: string } = {}): Promise<string> {
  const data = toBase64(packShare(doc))
  const b = await getBackend()
  if (!b) throw new Error('Play links need accounts on this site. Download the share file instead.')
  const user = await b.getUser()
  if (!user) throw new ShareRejected('Sign in to make a play link.')
  let token: string
  if (b.kind === 'local') {
    // What the server does: unpack and check the stored bytes, not what the page says.
    const { problems } = validateShareDoc(unpackShare(fromBase64(data)))
    if (problems.length) throw new ShareRejected('This map can’t be shared yet.', problems)
    const old = opts.token ? await localTx<LocalRow | undefined>('readonly', (s) => s.get(opts.token!)) : undefined
    token = old && old.owner === user.id ? old.token : newShareToken()
    await localTx('readwrite', (s) => s.put({ token, owner: user.id, title: doc.title, data, created_at: new Date().toISOString() } satisfies LocalRow, token))
  } else {
    const auth = await b.accessToken?.()
    if (!auth) throw new ShareRejected('Sign in to make a play link.')
    const res = await fetch('/api/share', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` }, body: JSON.stringify({ title: doc.title, data, token: opts.token }) })
    const body = await res.json().catch(() => ({}))
    if (res.status >= 400 && res.status < 500) throw new ShareRejected(body.error || 'The link was refused.', Array.isArray(body.problems) ? body.problems : [])
    if (!res.ok || typeof body.token !== 'string') throw new Error(body.error || `Making the link failed (HTTP ${res.status}). Try again later, or download the share file.`)
    token = body.token
  }
  saveMine([{ token, title: doc.title, created_at: new Date().toISOString(), project_id: projectId }, ...myShares().filter((s) => s.token !== token)])
  return token
}

export async function fetchShare(token: string): Promise<ShareDoc> {
  if (!SHARE_TOKEN.test(token)) throw new Error('This link is not complete. Check that it was copied whole.')
  let data: string | null = null
  if (backendMode === 'local') {
    data = (await localTx<LocalRow | undefined>('readonly', (s) => s.get(token)))?.data ?? null
  } else if (backendMode === 'supabase') {
    const env = import.meta.env
    const key = String(env.VITE_SUPABASE_ANON_KEY).trim()
    const res = await fetch(`${supabaseProjectUrl(env.VITE_SUPABASE_URL)}/rest/v1/rpc/get_share`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` }, body: JSON.stringify({ p_token: token }),
    })
    if (!res.ok) throw new Error(`The map could not be loaded (HTTP ${res.status}).`)
    const rows = await res.json()
    data = (Array.isArray(rows) ? rows[0]?.data : rows?.data) ?? null
  } else {
    throw new Error('This site has no play-link server. Ask for the share file instead.')
  }
  if (!data) throw new Error('This link doesn’t lead to a map any more. Its owner may have removed it.')
  return readShare(fromBase64(data))
}

/** A share file or stored share, checked the same way the server checks it. */
export function readShare(bytes: Uint8Array): ShareDoc {
  const { problems, doc } = validateShareDoc(unpackShare(bytes))
  if (!doc) throw new Error(problems[0] || 'This shared map could not be read.')
  return doc
}

export async function deleteShare(token: string) {
  const b = await getBackend()
  if (b?.kind === 'local') {
    const user = await b.getUser()
    const row = await localTx<LocalRow | undefined>('readonly', (s) => s.get(token))
    if (row && row.owner === user?.id) await localTx('readwrite', (s) => s.delete(token))
  } else if (b) {
    const auth = await b.accessToken?.()
    if (!auth) throw new Error('Sign in to remove your links.')
    const res = await fetch('/api/share', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` }, body: JSON.stringify({ token }) })
    if (!res.ok && res.status !== 404) throw new Error((await res.json().catch(() => ({}))).error || `Removing the link failed (HTTP ${res.status}).`)
  }
  saveMine(myShares().filter((s) => s.token !== token))
}

/** The share as a file (gzip JSON) for sites without hosting. */
export function shareFile(doc: ShareDoc): File {
  const name = (doc.title.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase() || 'map') + '.sr1play'
  return new File([packShare(doc)], name, { type: 'application/octet-stream' })
}
