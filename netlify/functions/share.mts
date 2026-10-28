// POST   /api/share         {title, data, token?, key?, thumb?, listed?}  -> {token, key?, expires_at?}
// DELETE /api/share         {token, key?}                                -> {ok}
// POST   /api/share/report  {token, reason, details}                     -> {ok}
// POST   /api/share/time    {token, mode, ms, name, ghost}               -> {ok, rank}
// POST   /api/share/play    {token}                                      -> {ok}
// POST   /api/share/hide    {token}   (moderators)                       -> {ok}
// POST   /api/share/review  {token, path, approve}   (moderators)         -> {ok}
//   data: base64 of the gzip share (src/play/share.ts); thumb: base64 WebP preview the site drew from the
//   share (src/play/sharePreview.ts), signed-in links only; ghost: src/play/ghost.ts
//
// A preview picture is stored under a name with a random part (shares.thumb_path) and waits for a moderator
// (/api/share/review): until approved, link previews and the gallery show the site's own picture, and nothing
// gives out its name. Approving moves it to a new name; rejecting deletes it. A new picture waits again.
//
// Play links. The function unpacks and checks every share with the same rules
// as the browser (no files, plain OBJ geometry, texture recipes only) and
// stores the share rebuilt from only the fields a share may hold
// (src/play/shareSchema.ts), never the bytes it was sent. It is the only thing
// that can write to public.shares, its
// reports, its boards and its preview pictures. Anyone can read a share with
// its token through the get_share RPC; only links their signed-in owner listed
// show in the gallery, and a map is listed only after the function rebuilds
// every model from the settings in the share and gets the same geometry
// (src/play/shareBuilds.ts).
//
// Without an account a link still works, but expires after SHARE_RULES.anonDays
// and is limited per salted hash of the maker's address (SHARE_IP_SALT; IPv6 by
// its /64 network; the address itself is never stored). Creations and updates
// are logged in share_log (by address hash, or by account when signed in), so
// removing a link doesn't give its count back and updating one counts each
// time. The maker's browser keeps a random key to update or remove it.
// Reports, board times and plays are limited the same way. Every limit is
// checked before the share is unpacked: reading and checking a map is the
// costly part, so every attempt to make or update a link, and every board
// time, is logged and counted first, whether or not it then succeeds.
//
// Until migration 0004 is applied, signed-in links keep working as before
// (without previews or the gallery) and everything new answers "not open yet".
import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js'
import { isValidThumbnail, supabaseProjectUrl } from '../../src/lib/hubRules'
import { checkTime, cleanName } from '../../src/play/ghost'
import { wallsOf } from '../../src/play/ghostWalls'
import { MAX_PREVIEW_BYTES, SHARE_LIMITS, SHARE_RULES, SHARE_TOKEN, fromBase64, newShareToken, packShare, previewProblem, shareMeta, toBase64, unpackShare, validateShareDoc, type ShareDoc } from '../../src/play/share'
import { cleanBuilds, galleryProblems } from '../../src/play/shareBuilds'

const env = (k: string) => process.env[k] || ''
const num = (k: string, fallback: number) => Number(env(k)) || fallback

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const reject = (status: number, error: string, problems: string[] = []) => json(status, { error, problems })
const notOpen = (what: string) => reject(503, `${what} aren’t open yet on this site.`)

/** Base64 grows the gzip by a third; anything bigger than this can't be a valid share (with its preview). */
const MAX_BODY = Math.ceil((SHARE_LIMITS.packedBytes + MAX_PREVIEW_BYTES) * 1.4) + 4096
const MAX_TIME_BODY = 400_000
const REASONS = ['game-data', 'stolen', 'offensive', 'spam', 'broken', 'other']
const THUMBS = 'share-thumbs'
const DAY = 86400_000
/**
 * The gallery's rebuild gives up after this long. With reading, checking and storing a share at the size limit
 * (about 3 s more at worst), a request stays well inside the function's 10 s.
 */
const GALLERY_MS = 3000
/** Pictures are cached briefly, so one hidden or turned down stops showing soon. */
const THUMB_CACHE = '60'
/** The share columns that existed before migration 0004. */
const LEGACY = ['title', 'data', 'size_bytes', 'updated_at', 'token', 'owner'] as const

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/**
 * What an address is counted as: IPv4 as it is, IPv6 by its /64 network (one home or phone gets a whole /64).
 * An IPv4 address carried in IPv6 (::ffff:a.b.c.d, or NAT64's 64:ff9b::a.b.c.d) counts as that IPv4 address.
 */
export function ipPrefix(ip: string): string | null {
  let a = ip.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '').toLowerCase()
  if (IPV4.test(a)) return a
  if (!a.includes(':') || !/^[0-9a-f:.]+$/.test(a)) return null
  // A dotted IPv4 tail as its two groups.
  const tail4 = /:(\d+\.\d+\.\d+\.\d+)$/.exec(a)
  if (tail4) {
    const q = IPV4.exec(tail4[1])?.slice(1).map(Number)
    if (!q || q.some((n) => n > 255)) return null
    a = a.slice(0, -tail4[1].length) + ((q[0] << 8) | q[1]).toString(16) + ':' + ((q[2] << 8) | q[3]).toString(16)
  }
  if (a.split('::').length > 2) return null
  const [head, tail = ''] = a.split('::')
  const h = head ? head.split(':') : [], t = a.includes('::') && tail ? tail.split(':') : []
  if (!a.includes('::') && h.length !== 8) return null
  const groups = [...h, ...new Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t]
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  const n = groups.map((g) => parseInt(g, 16))
  const mapped = n.slice(0, 5).every((x) => x === 0) && n[5] === 0xffff
  const nat64 = n[0] === 0x64 && n[1] === 0xff9b && n.slice(2, 6).every((x) => x === 0)
  if (mapped || nat64) return [n[6] >> 8, n[6] & 255, n[7] >> 8, n[7] & 255].join('.')
  return n.slice(0, 4).map((x) => x.toString(16)).join(':') + '::/64'
}

/**
 * Salted hash of the caller's address, or null when the site has no salt (then nothing anonymous is allowed).
 * The address is the one Netlify saw connect, never X-Forwarded-For, which the caller can write.
 */
async function ipHash(req: Request, context?: { ip?: string }): Promise<string | null> {
  const salt = env('SHARE_IP_SALT')
  const raw = context?.ip || req.headers.get('x-nf-client-connection-ip') || ''
  const ip = raw ? ipPrefix(raw) : null
  if (!salt || !ip) return null
  return sha256(`${salt}:${ip}`)
}

/** PostgREST's answer for a column, table or function that isn't there (migration 0004 not applied). */
const missing = (e: Pick<PostgrestError, 'code' | 'message'> | null | undefined) =>
  !!e && (['PGRST202', 'PGRST204', 'PGRST205', '42703', '42P01', '42883'].includes(e.code) || /schema cache|does not exist/i.test(e.message || ''))

let schema: { fresh: boolean; at: number } | null = null
/** Forgets what the database was found to have (tests switch databases). */
export const forgetSchema = () => { schema = null }

/** True when this database has migration 0004. Remembered: for good once it has, a minute while it hasn't. */
async function upToDate(admin: SupabaseClient): Promise<boolean> {
  if (schema && (schema.fresh || Date.now() - schema.at < 60_000)) return schema.fresh
  // A GET for no rows, not a HEAD: a HEAD that fails comes back with no body, so no code to tell a missing column by.
  const r = await admin.from('shares').select('anon').limit(0)
  if (r.error && !missing(r.error)) throw r.error
  schema = { fresh: !r.error, at: Date.now() }
  return schema.fresh
}

export default async (req: Request, context?: { ip?: string }): Promise<Response> => {
  const route = new URL(req.url).pathname.replace(/\/+$/, '').split('/').pop()
  if (route === 'share' ? req.method !== 'POST' && req.method !== 'DELETE' : req.method !== 'POST') return reject(405, 'Method not allowed')
  if (route === 'share' && req.method === 'POST' && env('SHARES_ENABLED') === 'false') return reject(403, 'Play links are turned off on this site.')
  const url = supabaseProjectUrl(env('SUPABASE_URL')), key = env('SUPABASE_SERVICE_ROLE_KEY').trim()
  if (!url || !key) return reject(503, 'Play links are not set up on this site.')
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  // Signed in or not: a token that doesn't check out is an error, no token is anonymous.
  let uid: string | null = null
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (jwt) {
    const { data: auth, error: authError } = await admin.auth.getUser(jwt)
    if (authError && ![400, 401, 403].includes(authError.status ?? 0)) {
      console.error('Supabase auth check failed', authError.status, authError.message)
      return reject(503, 'The account service is not reachable right now. Try again later.')
    }
    if (authError || !auth.user) return reject(401, 'Your session has expired. Sign in again.')
    uid = auth.user.id
  }

  const max = route === 'time' ? MAX_TIME_BODY : route === 'report' ? 8192 : route === 'share' ? MAX_BODY : 1024
  if (Number(req.headers.get('content-length') || 0) > max) return reject(413, 'This map is too large to share.')
  let body: any
  try {
    const text = await req.text()
    if (text.length > max) return reject(413, 'This map is too large to share.')
    body = JSON.parse(text)
  } catch { return reject(400, 'Invalid request body.') }
  if (!body || typeof body !== 'object') return reject(400, 'Invalid request body.')
  if (typeof body.token !== 'undefined' && body.token !== null && (typeof body.token !== 'string' || !SHARE_TOKEN.test(body.token))) return reject(400, 'Invalid link.')

  try {
    const ip = await ipHash(req, context)
    const fresh = await upToDate(admin)
    if (!fresh && route === 'play') return json(200, { ok: true })
    if (!fresh && route !== 'share') return notOpen(route === 'report' ? 'Reports on play links' : route === 'time' ? 'Boards' : 'Moderation tools for play links')
    if (route === 'report') return await report(admin, uid, ip, body)
    if (route === 'time') return await addTime(admin, uid, ip, body)
    if (route === 'play') return await play(admin, ip, body)
    if (route === 'hide') return await hide(admin, uid, body)
    if (route === 'review') return await review(admin, uid, body)
    if (req.method === 'DELETE') return await remove(admin, uid, body, fresh)
    return await create(admin, uid, ip, body, fresh)
  } catch (err) {
    console.error(err)
    return reject(500, 'Something went wrong on the server. Try again later.')
  }
}

const since = (ms: number) => new Date(Date.now() - ms).toISOString()

type LogKind = 'create' | 'update' | 'play' | 'attempt' | 'time'

/**
 * Counts and logs one try at something costly (making or updating a link, a board time) for an account or an
 * address, before any of the work: failed tries count too. False when over `max` in the last hour.
 */
async function attempt(admin: SupabaseClient, kind: 'attempt' | 'time', uid: string | null, ip: string | null, max: number): Promise<boolean> {
  const who = uid ? { owner: uid } : { ip_hash: ip! }
  // Logged first, then counted with this try included: tries sent at the same moment can't all slip under.
  const ins = await admin.from('share_log').insert({ kind, token: null, ip_hash: null, ...who })
  if (ins.error) {
    // An early copy of migration 0004, without these kinds or the owner column: nothing to count with.
    if (missing(ins.error) || ins.error.code === '23514') return true
    throw ins.error
  }
  // A GET for no rows, so a missing column comes back with its code (see upToDate).
  let q = admin.from('share_log').select('id', { count: 'exact' }).eq('kind', kind).gte('created_at', since(3600_000))
  q = uid ? q.eq('owner', uid) : q.eq('ip_hash', ip!)
  const r = await q.limit(0)
  if (r.error) {
    if (missing(r.error)) return true
    throw r.error
  }
  return (r.count ?? 0) <= max
}

async function logged(admin: SupabaseClient, kind: LogKind, ip: string, within: number, token?: string): Promise<number> {
  let q = admin.from('share_log').select('id', { count: 'exact', head: true }).eq('ip_hash', ip).eq('kind', kind).gte('created_at', since(within))
  if (token) q = q.eq('token', token)
  const r = await q
  if (r.error) throw r.error
  return r.count ?? 0
}
async function log(admin: SupabaseClient, kind: 'create' | 'update' | 'play', ip: string, token: string) {
  const r = await admin.from('share_log').insert({ kind, ip_hash: ip, token })
  if (r.error) throw r.error
}
/**
 * Links an account made or updated in the last day: from the log, or (without migration 0004, or with an early
 * copy of it whose log has no owner column) its links' dates.
 */
async function writesToday(admin: SupabaseClient, uid: string, fresh: boolean): Promise<number> {
  if (fresh) {
    // A GET for no rows, so a missing column comes back with its code (see upToDate).
    const r = await admin.from('share_log').select('id', { count: 'exact' }).eq('owner', uid).in('kind', ['create', 'update']).gte('created_at', since(DAY)).limit(0)
    if (!r.error) return r.count ?? 0
    if (!missing(r.error)) throw r.error
  }
  const r = await admin.from('shares').select('token', { count: 'exact', head: true }).eq('owner', uid).gte('updated_at', since(DAY))
  if (r.error) throw r.error
  return r.count ?? 0
}

async function removeThumb(admin: SupabaseClient, path: string | null | undefined) {
  if (path) await admin.storage.from(THUMBS).remove([path]).catch(() => {})
}

async function remove(admin: SupabaseClient, uid: string | null, body: any, fresh: boolean): Promise<Response> {
  if (typeof body.token !== 'string') return reject(400, 'Invalid link.')
  // A link made without an account goes with its key (whoever is signed in now); others with their owner.
  let gone: { token: string; thumb_path?: string | null }[] = []
  const cols = fresh ? 'token, thumb_path' : 'token'
  if (fresh && typeof body.key === 'string' && SHARE_TOKEN.test(body.key)) {
    const r = await admin.from('shares').delete().eq('token', body.token).eq('anon', true).eq('key_hash', await sha256(body.key)).select(cols)
    if (r.error) throw r.error
    gone = (r.data ?? []) as unknown as typeof gone
  } else if (uid) {
    const r = await admin.from('shares').delete().eq('token', body.token).eq('owner', uid).select(cols)
    if (r.error) throw r.error
    gone = (r.data ?? []) as unknown as typeof gone
  } else return reject(401, 'Sign in to remove your links.')
  // Only the link that was really removed loses its picture: a wrong key or someone else's link changes nothing.
  for (const g of gone) await removeThumb(admin, g.thumb_path)
  return json(200, { ok: true })
}

/** Writes a share row; on a database without migration 0004, only the columns it has. */
async function write(admin: SupabaseClient, row: Record<string, unknown>, fresh: boolean, match?: Record<string, string>) {
  const r = fresh ? row : Object.fromEntries(Object.entries(row).filter(([k]) => (LEGACY as readonly string[]).includes(k)))
  let q = match ? admin.from('shares').update(r) : admin.from('shares').insert(r)
  if (match) for (const [k, v] of Object.entries(match)) q = (q as any).eq(k, v)
  const res = await q
  if (res.error) throw res.error
}

async function create(admin: SupabaseClient, uid: string | null, ip: string | null, body: any, fresh: boolean): Promise<Response> {
  if (typeof body.data !== 'string') return reject(400, 'Invalid request body.')
  if (!uid && !ip) return reject(401, 'Sign in to make a play link.')
  if (!uid && !fresh) return reject(401, 'Links without an account aren’t open yet on this site. Sign in to make a link.')
  const hidden = () => reject(403, 'A moderator hid this link, so it can’t be changed. You can still remove it.')
  // Every try counts, before anything is read: one that fails costs as much as one that works.
  if (fresh && !(await attempt(admin, 'attempt', uid, ip, num('SHARE_ATTEMPTS_PER_HOUR', SHARE_RULES.attemptsPerHour)))) {
    return reject(429, 'That’s a lot of links in an hour. Try again later.')
  }

  // What this is (a new link, or an update of one) and its limit, before the map is read.
  let anonEdit: { keyHash: string; expires_at: string; data_hash: string | null } | null = null
  let ownEdit: { data_hash: string | null; thumb_path: string | null } | null = null
  if (!uid) {
    if (typeof body.token === 'string' && typeof body.key === 'string' && SHARE_TOKEN.test(body.key)) {
      const keyHash = await sha256(body.key)
      const old = await admin.from('shares').select('token, expires_at, hidden, data_hash').eq('token', body.token).eq('anon', true).eq('key_hash', keyHash).maybeSingle()
      if (old.error) throw old.error
      if (old.data?.hidden) return hidden()
      if (old.data && new Date(old.data.expires_at).getTime() > Date.now()) anonEdit = { keyHash, expires_at: old.data.expires_at, data_hash: old.data.data_hash }
    }
    if (anonEdit) {
      const perDay = num('SHARE_ANON_UPDATES_PER_DAY', SHARE_RULES.anonUpdatesPerDay)
      if ((await logged(admin, 'update', ip!, DAY)) >= perDay) return reject(429, `Without an account you can update links ${perDay} times a day. Sign in for more, or try again tomorrow.`)
    } else {
      const perDay = num('SHARE_ANON_PER_DAY', SHARE_RULES.anonPerDay)
      // Counted from the log, not the links that still exist: removing one doesn't give its place back.
      if ((await logged(admin, 'create', ip!, DAY)) >= perDay) return reject(429, `Without an account you can make ${perDay} play links a day. Sign in for more, or try again tomorrow.`)
    }
  } else {
    const perDay = num('SHARE_MAX_PER_DAY', SHARE_RULES.perDay)
    if ((await writesToday(admin, uid, fresh)) >= perDay) return reject(429, `You can make or update ${perDay} play links a day. Try again tomorrow.`)
    if (body.token) {
      const old = await admin.from('shares').select(fresh ? 'owner, hidden, data_hash, thumb_path' : 'owner').eq('token', body.token).maybeSingle()
      if (old.error) throw old.error
      const prev = old.data as { owner: string; hidden?: boolean; data_hash?: string | null; thumb_path?: string | null } | null
      // Not yours (or removed): a new link instead.
      if (prev && prev.owner === uid) {
        if (prev.hidden) return hidden()
        ownEdit = { data_hash: prev.data_hash ?? null, thumb_path: prev.thumb_path ?? null }
      }
    }
    if (!ownEdit) {
      const perUser = num('SHARE_MAX_PER_USER', SHARE_RULES.perUser)
      const total = await admin.from('shares').select('token', { count: 'exact', head: true }).eq('owner', uid)
      if (total.error) throw total.error
      if ((total.count ?? 0) >= perUser) return reject(429, `You have ${perUser} play links. Remove some you no longer need first.`)
    }
  }

  // Check what will be stored, not what the page says about it.
  let raw: unknown
  try { raw = unpackShare(fromBase64(body.data)) } catch (e) { return reject(422, (e as Error).message || 'This is not a play link.') }
  const checked = validateShareDoc(raw)
  if (!checked.doc) return reject(422, 'This map can’t be shared yet.', checked.problems)
  // Every share's model settings, listed or not: settings, never text riding along in them.
  const { doc, problems: buildIssues } = cleanBuilds(checked.doc)
  if (buildIssues.length) return reject(422, 'This map can’t be shared yet.', buildIssues)
  // A preview is the site's own render of the share, for signed-in links only; links without an account
  // show the site's own picture.
  let thumb: Uint8Array | null = null
  if (body.thumb != null && fresh && uid) {
    if (typeof body.thumb !== 'string') return reject(400, 'Invalid request body.')
    try { thumb = fromBase64(body.thumb) } catch { return reject(422, 'The preview picture is not valid.') }
    const bad = previewProblem(thumb) ?? (isValidThumbnail(thumb.length, thumb.subarray(0, 64)) ? null : 'is not valid')
    if (bad) return reject(422, `The preview picture ${bad}.`)
  }
  const listed = body.listed === true && fresh
  if (listed && !uid) return reject(422, 'Sign in to list a map in the gallery.')
  if (listed) {
    // Rebuilt here from the share's own settings: what the page says about how a model was made isn't trusted.
    const why = galleryProblems(doc, { deadline: performance.now() + GALLERY_MS })
    if (why.length) return reject(422, 'This map can’t go in the gallery.', why)
  }

  // Stored as checked and packed here, never the bytes that were sent (a gzip can carry more than its JSON:
  // comments, names, bytes after its end). Packed quicker than the browser packs and so a little larger; the
  // limit leaves room for that.
  const packed = packShare(doc, 3)
  if (packed.length > SHARE_LIMITS.packedBytes * 1.1) return reject(413, 'This map is too large to share.')
  const data = toBase64(packed)
  const meta = shareMeta(doc)
  const dataHash = await sha256(data)
  const row = { title: doc.title, data, size_bytes: packed.length, updated_at: new Date().toISOString(), modes: meta.modes, players: meta.players, data_hash: dataHash }
  /** Stores the preview under a new name nobody can guess, waiting for a moderator (the row is written next). */
  const saveThumb = async (token: string): Promise<{ thumb?: string; thumb_path?: string; thumb_approved?: boolean }> => {
    if (!thumb) return {}
    const path = `${token}-${newShareToken()}.webp`
    const up = await admin.storage.from(THUMBS).upload(path, thumb, { contentType: 'image/webp', upsert: false, cacheControl: THUMB_CACHE })
    if (up.error) { console.error('Preview upload failed', up.error.message); return {} }
    return { thumb: new Date().toISOString(), thumb_path: path, thumb_approved: false }
  }
  /** A board's times were run on the old map: they go when the map changes. */
  const mapChanged = async (token: string, oldHash: string | null) => {
    if (oldHash === dataHash) return
    const r = await admin.from('share_times').delete().eq('token', token)
    if (r.error) throw r.error
  }
  /** Signed-in writes are logged by account (without migration 0004 there's no log: links' dates count instead). */
  const logOwn = async (kind: 'create' | 'update', token: string) => {
    if (!fresh) return
    const r = await admin.from('share_log').insert({ kind, owner: uid, ip_hash: null, token })
    if (r.error && !missing(r.error)) throw r.error
  }

  if (!uid) {
    // Anonymous: limited per address hash, expires, edited only with its key.
    if (anonEdit) {
      await log(admin, 'update', ip!, body.token)
      await mapChanged(body.token, anonEdit.data_hash)
      await write(admin, row, fresh, { token: body.token, key_hash: anonEdit.keyHash })
      return json(200, { token: body.token, key: body.key, expires_at: anonEdit.expires_at })
    }
    const token = newShareToken(), editKey = newShareToken()
    const expires_at = new Date(Date.now() + SHARE_RULES.anonDays * DAY).toISOString()
    await log(admin, 'create', ip!, token)
    await write(admin, { ...row, token, owner: null, anon: true, expires_at, ip_hash: ip, key_hash: await sha256(editKey) }, fresh)
    return json(200, { token, key: editKey, expires_at })
  }

  if (ownEdit) {
    await logOwn('update', body.token)
    if (fresh) await mapChanged(body.token, ownEdit.data_hash)
    const t = await saveThumb(body.token)
    await write(admin, { ...row, listed, ...t }, fresh, { token: body.token, owner: uid })
    // The old picture goes once the row no longer names it.
    if (t.thumb_path) await removeThumb(admin, ownEdit.thumb_path)
    return json(200, { token: body.token })
  }
  const token = newShareToken()
  await logOwn('create', token)
  await write(admin, { ...row, token, owner: uid, listed }, fresh)
  const t = await saveThumb(token)
  if (t.thumb) await write(admin, t, fresh, { token })
  return json(200, { token })
}

/** A live share's row (not hidden or expired). */
async function liveShare(admin: SupabaseClient, token: string, columns: string) {
  const r = await admin.from('shares').select(columns).eq('token', token).eq('hidden', false).maybeSingle()
  if (r.error) throw r.error
  const row = r.data as { expires_at?: string | null } | null
  if (!row || (row.expires_at && new Date(row.expires_at).getTime() <= Date.now())) return null
  return row as any
}

async function report(admin: SupabaseClient, uid: string | null, ip: string | null, body: any): Promise<Response> {
  if (typeof body.token !== 'string') return reject(400, 'Invalid link.')
  if (!REASONS.includes(body.reason)) return reject(400, 'Choose a reason.')
  if (!uid && !ip) return reject(401, 'Sign in to report a map.')
  const details = typeof body.details === 'string' ? body.details.slice(0, 2000) : ''
  if (!(await liveShare(admin, body.token, 'token, expires_at'))) return reject(404, 'This link doesn’t lead to a map any more.')
  if (ip) {
    const perDay = num('SHARE_REPORTS_PER_DAY', SHARE_RULES.reportsPerDay)
    const recent = await admin.from('share_reports').select('id', { count: 'exact', head: true }).eq('ip_hash', ip).gte('created_at', since(DAY))
    if (recent.error) throw recent.error
    if ((recent.count ?? 0) >= perDay) return reject(429, 'You’ve sent a lot of reports today. Try again tomorrow.')
  }
  const ins = await admin.from('share_reports').insert({ token: body.token, reason: body.reason, details, reporter: uid, ip_hash: ip })
  if (ins.error?.code === '23505') return reject(409, 'You already reported this map. A moderator will look at it.')
  if (ins.error) throw ins.error
  return json(200, { ok: true })
}

async function addTime(admin: SupabaseClient, uid: string | null, ip: string | null, body: any): Promise<Response> {
  if (typeof body.token !== 'string') return reject(400, 'Invalid link.')
  if (!uid && !ip) return reject(401, 'Sign in to post a time.')
  // The limit first, counting every try (a time refused costs as much to check): checking a run means reading the whole map.
  if (!(await attempt(admin, 'time', uid, ip, num('SHARE_TIMES_PER_HOUR', SHARE_RULES.timesPerHour)))) return reject(429, 'That’s a lot of times in an hour. Try again later.')

  const share = await liveShare(admin, body.token, 'data, expires_at')
  if (!share) return reject(404, 'This link doesn’t lead to a map any more.')
  // The stored share was checked and rebuilt when it was stored: read as it is, not checked again for every time.
  let doc: ShareDoc | null = null
  try { doc = unpackShare(fromBase64(share.data)) as ShareDoc } catch { /* below */ }
  if (!doc?.project || !Array.isArray(doc.project.markers) || !doc.models || typeof doc.models !== 'object') return reject(422, 'This map can’t take times.')
  const entry = { mode: body.mode, ms: body.ms, name: cleanName(body.name), ghost: body.ghost }
  const problems = checkTime(entry, doc.project.markers, wallsOf(doc) ?? undefined)
  if (problems.length) return reject(422, 'This time can’t go on the board.', problems)

  const ins = await admin.from('share_times').insert({ token: body.token, mode: entry.mode, name: entry.name, ms: entry.ms, ghost: entry.ghost, player: uid, ip_hash: ip })
  if (ins.error) throw ins.error
  // Keep the best few per board.
  const extra = await admin.from('share_times').select('id').eq('token', body.token).eq('mode', entry.mode).order('ms').order('created_at').range(SHARE_RULES.boardKeep, SHARE_RULES.boardKeep + 200)
  if (!extra.error && extra.data?.length) await admin.from('share_times').delete().in('id', extra.data.map((r) => r.id))
  const faster = await admin.from('share_times').select('id', { count: 'exact', head: true }).eq('token', body.token).eq('mode', entry.mode).lt('ms', entry.ms)
  return json(200, { ok: true, rank: (faster.count ?? 0) + 1 })
}

/** One play per address, link and day. Without an address (no salt) plays aren't counted. */
async function play(admin: SupabaseClient, ip: string | null, body: any): Promise<Response> {
  if (typeof body.token !== 'string') return reject(400, 'Invalid link.')
  if (!ip || (await logged(admin, 'play', ip, DAY, body.token)) > 0) return json(200, { ok: true })
  await log(admin, 'play', ip, body.token)
  const r = await admin.rpc('record_share_play', { p_token: body.token })
  if (r.error) throw r.error
  return json(200, { ok: true })
}

/** Moderators: hide a link (it stops opening, leaves the gallery and loses its preview picture now). */
async function hide(admin: SupabaseClient, uid: string | null, body: any): Promise<Response> {
  if (typeof body.token !== 'string') return reject(400, 'Invalid link.')
  if (!uid) return reject(401, 'Sign in first.')
  const me = await admin.from('profiles').select('is_moderator').eq('id', uid).maybeSingle()
  if (me.error) throw me.error
  if (!me.data?.is_moderator) return reject(403, 'Only moderators can do this.')
  const old = await admin.from('shares').select('thumb_path').eq('token', body.token).maybeSingle()
  if (old.error) throw old.error
  const up = await admin.from('shares').update({ hidden: true, listed: false, thumb: null, thumb_path: null, thumb_approved: false }).eq('token', body.token)
  if (up.error) throw up.error
  await removeThumb(admin, (old.data as { thumb_path?: string | null } | null)?.thumb_path)
  const done = await admin.from('share_reports').update({ status: 'actioned', resolved_at: new Date().toISOString(), resolved_by: uid }).eq('token', body.token).eq('status', 'open')
  if (done.error) throw done.error
  return json(200, { ok: true })
}

/**
 * Moderators: approve a link's preview picture (it moves to a new name and shows in link previews and the gallery)
 * or turn it down (the file is deleted, then the row forgets it). Only the picture that was looked at (`path`): if
 * the author stored a new one since, nothing changes.
 */
async function review(admin: SupabaseClient, uid: string | null, body: any): Promise<Response> {
  if (typeof body.token !== 'string' || typeof body.path !== 'string' || typeof body.approve !== 'boolean') return reject(400, 'Invalid request body.')
  if (!uid) return reject(401, 'Sign in first.')
  const me = await admin.from('profiles').select('is_moderator').eq('id', uid).maybeSingle()
  if (me.error) throw me.error
  if (!me.data?.is_moderator) return reject(403, 'Only moderators can do this.')
  const gone = () => reject(409, 'This picture changed or was removed. Load the list again.')
  const row = await admin.from('shares').select('token').eq('token', body.token).eq('thumb_path', body.path).maybeSingle()
  if (row.error) throw row.error
  if (!row.data) return gone()
  if (body.approve) {
    // A new name for the approved picture: the one it waited under is never the one shown.
    const to = `${body.token}-${newShareToken()}.webp`
    const mv = await admin.storage.from(THUMBS).move(body.path, to)
    if (mv.error) throw mv.error
    const up = await admin.from('shares').update({ thumb_path: to, thumb_approved: true, thumb: new Date().toISOString() }).eq('token', body.token).eq('thumb_path', body.path).select('token')
    if (up.error) throw up.error
    if (!up.data?.length) { await removeThumb(admin, to); return gone() }
    return json(200, { ok: true })
  }
  // The file first: if deleting it fails, the row still says it's waiting, so it never shows and can be tried again.
  const rm = await admin.storage.from(THUMBS).remove([body.path])
  if (rm.error) throw rm.error
  const up = await admin.from('shares').update({ thumb: null, thumb_path: null, thumb_approved: false }).eq('token', body.token).eq('thumb_path', body.path)
  if (up.error) throw up.error
  return json(200, { ok: true })
}

export const config = { path: ['/api/share', '/api/share/report', '/api/share/time', '/api/share/play', '/api/share/hide', '/api/share/review'] }
