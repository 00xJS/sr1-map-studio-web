// POST   /api/share         {title, data, token?, key?, thumb?, shot?, listed?} -> {token, key?, expires_at?}
// DELETE /api/share         {token, key?}                                -> {ok}
// POST   /api/share/report  {token, reason, details}                     -> {ok}
// POST   /api/share/time    {token, mode, ms, name, ghost}               -> {ok, rank}
// POST   /api/share/play    {token}                                      -> {ok}
// POST   /api/share/hide    {token}   (moderators)                       -> {ok}
//   data: base64 of the gzip share (src/play/share.ts); thumb: base64 WebP preview, drawn from the share or
//   (shot: true) the author's own in-game screenshot; ghost: src/play/ghost.ts
//
// Play links. The function unpacks and checks every share with the same rules
// as the browser (no files, plain OBJ geometry, texture recipes only) before
// storing it, and is the only thing that can write to public.shares, its
// reports, its boards and its preview pictures. Anyone can read a share with
// its token through the get_share RPC; only links their signed-in owner listed
// show in the gallery.
//
// Without an account a link still works, but expires after SHARE_RULES.anonDays
// and is limited per salted hash of the maker's address (SHARE_IP_SALT; IPv6 by
// its /64 network; the address itself is never stored). Creations and updates
// are logged in share_log, so removing a link doesn't give its count back. The
// maker's browser keeps a random key to update or remove it. Reports, board
// times and plays are limited the same way.
//
// Until migration 0004 is applied, signed-in links keep working as before
// (without previews or the gallery) and everything new answers "not open yet".
import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js'
import { MAX_THUMB_BYTES, isValidThumbnail, supabaseProjectUrl } from '../../src/lib/hubRules'
import { checkTime, cleanName } from '../../src/play/ghost'
import { wallsOf } from '../../src/play/ghostWalls'
import { SHARE_LIMITS, SHARE_RULES, SHARE_TOKEN, fromBase64, galleryReady, newShareToken, shareMeta, unpackShare, validateShareDoc } from '../../src/play/share'

const env = (k: string) => process.env[k] || ''
const num = (k: string, fallback: number) => Number(env(k)) || fallback

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const reject = (status: number, error: string, problems: string[] = []) => json(status, { error, problems })
const notOpen = (what: string) => reject(503, `${what} aren’t open yet on this site.`)

/** Base64 grows the gzip by a third; anything bigger than this can't be a valid share (with its preview). */
const MAX_BODY = Math.ceil((SHARE_LIMITS.packedBytes + MAX_THUMB_BYTES) * 1.4) + 4096
const MAX_TIME_BODY = 400_000
const REASONS = ['game-data', 'stolen', 'offensive', 'spam', 'broken', 'other']
const THUMBS = 'share-thumbs'
const DAY = 86400_000
/** The share columns that existed before migration 0004. */
const LEGACY = ['title', 'data', 'size_bytes', 'updated_at', 'token', 'owner'] as const

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** What an address is counted as: IPv4 as it is, IPv6 by its /64 network (one home or phone gets a whole /64). */
export function ipPrefix(ip: string): string | null {
  const a = ip.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '').toLowerCase()
  const mapped = /^(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/.exec(a)
  if (mapped) return mapped[1]
  if (/^\d+\.\d+\.\d+\.\d+$/.test(a)) return a
  if (!a.includes(':') || !/^[0-9a-f:.]+$/.test(a)) return null
  const [head, tail = ''] = a.split('::')
  const h = head ? head.split(':') : [], t = a.includes('::') && tail ? tail.split(':') : []
  if (!a.includes('::') && h.length !== 8) return null
  const groups = [...h, ...new Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t]
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64'
}

/** Salted hash of the caller's address, or null when the site has no salt (then nothing anonymous is allowed). */
async function ipHash(req: Request): Promise<string | null> {
  const salt = env('SHARE_IP_SALT')
  const raw = req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0]
  const ip = raw ? ipPrefix(raw) : null
  if (!salt || !ip) return null
  return sha256(`${salt}:${ip}`)
}

/** PostgREST's answer for a column, table or function that isn't there (migration 0004 not applied). */
const missing = (e: Pick<PostgrestError, 'code' | 'message'> | null | undefined) =>
  !!e && (['PGRST202', 'PGRST204', 'PGRST205', '42703', '42P01', '42883'].includes(e.code) || /schema cache|does not exist/i.test(e.message || ''))

/** True when this database has migration 0004. */
async function upToDate(admin: SupabaseClient): Promise<boolean> {
  const r = await admin.from('shares').select('anon', { head: true, count: 'exact' }).limit(1)
  if (missing(r.error)) return false
  if (r.error) throw r.error
  return true
}

export default async (req: Request): Promise<Response> => {
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
    const ip = await ipHash(req)
    const fresh = await upToDate(admin)
    if (!fresh && route === 'play') return json(200, { ok: true })
    if (!fresh && route !== 'share') return notOpen(route === 'report' ? 'Reports on play links' : route === 'time' ? 'Boards' : 'Moderation tools for play links')
    if (route === 'report') return await report(admin, uid, ip, body)
    if (route === 'time') return await addTime(admin, uid, ip, body)
    if (route === 'play') return await play(admin, ip, body)
    if (route === 'hide') return await hide(admin, uid, body)
    if (req.method === 'DELETE') return await remove(admin, uid, body, fresh)
    return await create(admin, uid, ip, body, fresh)
  } catch (err) {
    console.error(err)
    return reject(500, 'Something went wrong on the server. Try again later.')
  }
}

const since = (ms: number) => new Date(Date.now() - ms).toISOString()

async function logged(admin: SupabaseClient, kind: 'create' | 'update' | 'play', ip: string, within: number, token?: string): Promise<number> {
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

async function removeThumb(admin: SupabaseClient, token: string) {
  await admin.storage.from(THUMBS).remove([`${token}.webp`]).catch(() => {})
}

async function remove(admin: SupabaseClient, uid: string | null, body: any, fresh: boolean): Promise<Response> {
  if (typeof body.token !== 'string') return reject(400, 'Invalid link.')
  // A link made without an account goes with its key (whoever is signed in now); others with their owner.
  let gone: { token: string }[] = []
  if (fresh && typeof body.key === 'string' && SHARE_TOKEN.test(body.key)) {
    const r = await admin.from('shares').delete().eq('token', body.token).eq('anon', true).eq('key_hash', await sha256(body.key)).select('token')
    if (r.error) throw r.error
    gone = r.data ?? []
  } else if (uid) {
    const r = await admin.from('shares').delete().eq('token', body.token).eq('owner', uid).select('token')
    if (r.error) throw r.error
    gone = r.data ?? []
  } else return reject(401, 'Sign in to remove your links.')
  // Only the link that was really removed loses its picture: a wrong key or someone else's link changes nothing.
  if (gone.length && fresh) await removeThumb(admin, body.token)
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

  // Check what will be stored, not what the page says about it.
  let raw: unknown
  try { raw = unpackShare(fromBase64(body.data)) } catch (e) { return reject(422, (e as Error).message || 'This is not a play link.') }
  const { problems, doc } = validateShareDoc(raw)
  if (!doc) return reject(422, 'This map can’t be shared yet.', problems)
  let thumb: Uint8Array | null = null
  if (body.thumb != null && fresh) {
    if (typeof body.thumb !== 'string') return reject(400, 'Invalid request body.')
    try { thumb = fromBase64(body.thumb) } catch { return reject(422, 'The preview picture is not valid.') }
    const webp = thumb.length > 12 && String.fromCharCode(...thumb.subarray(8, 12)) === 'WEBP'
    if (!webp || !isValidThumbnail(thumb.length, thumb.subarray(0, 64))) return reject(422, 'The preview picture is not valid.')
  }
  const listed = body.listed === true && fresh
  if (listed && !uid) return reject(422, 'Sign in to list a map in the gallery.')
  if (listed && !galleryReady(doc)) return reject(422, 'Only maps built entirely from the site’s own shapes and prefabs can go in the gallery.')

  const meta = shareMeta(doc)
  const dataHash = await sha256(body.data)
  const row = { title: doc.title, data: body.data, size_bytes: Math.floor(body.data.length * 0.75), updated_at: new Date().toISOString(), modes: meta.modes, players: meta.players, data_hash: dataHash }
  const saveThumb = async (token: string) => {
    if (!thumb) return {}
    const up = await admin.storage.from(THUMBS).upload(`${token}.webp`, thumb, { contentType: 'image/webp', upsert: true, cacheControl: '300' })
    if (up.error) { console.error('Preview upload failed', up.error.message); return {} }
    return { thumb: new Date().toISOString(), shot: body.shot === true }
  }
  /** A board's times were run on the old map: they go when the map changes. */
  const mapChanged = async (token: string, oldHash: string | null) => {
    if (oldHash === dataHash) return
    const r = await admin.from('share_times').delete().eq('token', token)
    if (r.error) throw r.error
  }

  if (!uid) {
    // Anonymous: limited per address hash, expires, edited only with its key.
    if (typeof body.token === 'string' && typeof body.key === 'string' && SHARE_TOKEN.test(body.key)) {
      const keyHash = await sha256(body.key)
      const old = await admin.from('shares').select('token, expires_at, hidden, data_hash').eq('token', body.token).eq('anon', true).eq('key_hash', keyHash).maybeSingle()
      if (old.error) throw old.error
      if (old.data?.hidden) return reject(403, 'A moderator hid this link, so it can’t be changed. You can still remove it.')
      if (old.data && new Date(old.data.expires_at).getTime() > Date.now()) {
        const perDay = num('SHARE_ANON_UPDATES_PER_DAY', SHARE_RULES.anonUpdatesPerDay)
        if ((await logged(admin, 'update', ip!, DAY)) >= perDay) return reject(429, `Without an account you can update links ${perDay} times a day. Sign in for more, or try again tomorrow.`)
        await log(admin, 'update', ip!, body.token)
        await mapChanged(body.token, old.data.data_hash)
        await write(admin, { ...row, ...(await saveThumb(body.token)) }, fresh, { token: body.token, key_hash: keyHash })
        return json(200, { token: body.token, key: body.key, expires_at: old.data.expires_at })
      }
    }
    const perDay = num('SHARE_ANON_PER_DAY', SHARE_RULES.anonPerDay)
    // Counted from the log, not the links that still exist: removing one doesn't give its place back.
    if ((await logged(admin, 'create', ip!, DAY)) >= perDay) return reject(429, `Without an account you can make ${perDay} play links a day. Sign in for more, or try again tomorrow.`)
    const token = newShareToken(), editKey = newShareToken()
    const expires_at = new Date(Date.now() + SHARE_RULES.anonDays * DAY).toISOString()
    await log(admin, 'create', ip!, token)
    await write(admin, { ...row, token, owner: null, anon: true, expires_at, ip_hash: ip, key_hash: await sha256(editKey) }, fresh)
    const t = await saveThumb(token)
    if (t.thumb) await write(admin, t, fresh, { token })
    return json(200, { token, key: editKey, expires_at })
  }

  const perDay = num('SHARE_MAX_PER_DAY', SHARE_RULES.perDay)
  const perUser = num('SHARE_MAX_PER_USER', SHARE_RULES.perUser)
  const recent = await admin.from('shares').select('token', { count: 'exact', head: true }).eq('owner', uid).gte('updated_at', since(DAY))
  if (recent.error) throw recent.error
  if ((recent.count ?? 0) >= perDay) return reject(429, `You can make or update ${perDay} play links a day. Try again tomorrow.`)

  if (body.token) {
    const old = await admin.from('shares').select(fresh ? 'owner, hidden, data_hash' : 'owner').eq('token', body.token).maybeSingle()
    if (old.error) throw old.error
    const prev = old.data as { owner: string; hidden?: boolean; data_hash?: string | null } | null
    if (prev && prev.owner === uid) {
      if (prev.hidden) return reject(403, 'A moderator hid this link, so it can’t be changed. You can still remove it.')
      if (fresh) await mapChanged(body.token, prev.data_hash ?? null)
      await write(admin, { ...row, listed, ...(await saveThumb(body.token)) }, fresh, { token: body.token, owner: uid })
      return json(200, { token: body.token })
    }
    // Not yours (or removed): make a new link instead.
  }
  const total = await admin.from('shares').select('token', { count: 'exact', head: true }).eq('owner', uid)
  if (total.error) throw total.error
  if ((total.count ?? 0) >= perUser) return reject(429, `You have ${perUser} play links. Remove some you no longer need first.`)
  const token = newShareToken()
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
  const share = await liveShare(admin, body.token, 'data, expires_at')
  if (!share) return reject(404, 'This link doesn’t lead to a map any more.')
  const { doc } = validateShareDoc(unpackShare(fromBase64(share.data)))
  if (!doc) return reject(422, 'This map can’t take times.')
  const entry = { mode: body.mode, ms: body.ms, name: cleanName(body.name), ghost: body.ghost }
  const problems = checkTime(entry, doc.project.markers, wallsOf(doc) ?? undefined)
  if (problems.length) return reject(422, 'This time can’t go on the board.', problems)

  const perHour = num('SHARE_TIMES_PER_HOUR', SHARE_RULES.timesPerHour)
  const who = ip ? admin.from('share_times').select('id', { count: 'exact', head: true }).eq('ip_hash', ip) : admin.from('share_times').select('id', { count: 'exact', head: true }).eq('player', uid)
  const recent = await who.gte('created_at', since(3600_000))
  if (recent.error) throw recent.error
  if ((recent.count ?? 0) >= perHour) return reject(429, 'That’s a lot of times in an hour. Try again later.')

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
  const up = await admin.from('shares').update({ hidden: true, listed: false, thumb: null, shot: false }).eq('token', body.token)
  if (up.error) throw up.error
  await removeThumb(admin, body.token)
  const done = await admin.from('share_reports').update({ status: 'actioned', resolved_at: new Date().toISOString(), resolved_by: uid }).eq('token', body.token).eq('status', 'open')
  if (done.error) throw done.error
  return json(200, { ok: true })
}

export const config = { path: ['/api/share', '/api/share/report', '/api/share/time', '/api/share/play', '/api/share/hide'] }
