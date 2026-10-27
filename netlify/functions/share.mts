// POST   /api/share         {title, data, token?, key?, thumb?, shot?, listed?} -> {token, key?, expires_at?}
// DELETE /api/share         {token, key?}                                -> {ok}
// POST   /api/share/report  {token, reason, details}                     -> {ok}
// POST   /api/share/time    {token, mode, ms, name, ghost}               -> {ok, rank}
//   data: base64 of the gzip share (src/play/share.ts); thumb: base64 WebP preview, drawn from the share or
//   (shot: true) the author's own in-game screenshot; ghost: src/play/ghost.ts
//
// Play links. The function unpacks and checks every share with the same rules
// as the browser (no files, plain OBJ geometry, texture recipes only) before
// storing it, and is the only thing that can write to public.shares, its
// reports and its boards. Anyone can read a share with its token through the
// get_share RPC; only links their signed-in owner listed show in the gallery.
//
// Without an account a link still works, but expires after SHARE_RULES.anonDays
// and is limited per salted hash of the maker's IP address (SHARE_IP_SALT; the
// address itself is never stored). The maker's browser keeps a random key to
// update or remove it. Reports and board times are limited the same way.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { MAX_THUMB_BYTES, isValidThumbnail, supabaseProjectUrl } from '../../src/lib/hubRules'
import { checkTime, cleanName } from '../../src/play/ghost'
import { SHARE_LIMITS, SHARE_RULES, SHARE_TOKEN, fromBase64, galleryReady, newShareToken, shareMeta, unpackShare, validateShareDoc } from '../../src/play/share'

const env = (k: string) => process.env[k] || ''
const num = (k: string, fallback: number) => Number(env(k)) || fallback

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const reject = (status: number, error: string, problems: string[] = []) => json(status, { error, problems })

/** Base64 grows the gzip by a third; anything bigger than this can't be a valid share (with its preview). */
const MAX_BODY = Math.ceil((SHARE_LIMITS.packedBytes + MAX_THUMB_BYTES) * 1.4) + 4096
const MAX_TIME_BODY = 400_000
const REASONS = ['game-data', 'stolen', 'offensive', 'spam', 'broken', 'other']
const THUMBS = 'share-thumbs'

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Salted hash of the caller's address, or null when the site has no salt (then nothing anonymous is allowed). */
async function ipHash(req: Request): Promise<string | null> {
  const salt = env('SHARE_IP_SALT')
  const ip = req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
  if (!salt || !ip) return null
  return sha256(`${salt}:${ip}`)
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

  const max = route === 'time' ? MAX_TIME_BODY : route === 'report' ? 8192 : MAX_BODY
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
    if (route === 'report') return await report(admin, uid, ip, body)
    if (route === 'time') return await addTime(admin, uid, ip, body)
    if (req.method === 'DELETE') return await remove(admin, uid, body)
    return await create(admin, uid, ip, body)
  } catch (err) {
    console.error(err)
    return reject(500, 'Something went wrong on the server. Try again later.')
  }
}

async function remove(admin: SupabaseClient, uid: string | null, body: any): Promise<Response> {
  if (typeof body.token !== 'string') return reject(400, 'Invalid link.')
  // A link made without an account goes with its key (whoever is signed in now); others with their owner.
  if (typeof body.key === 'string' && SHARE_TOKEN.test(body.key)) {
    const { error } = await admin.from('shares').delete().eq('token', body.token).eq('anon', true).eq('key_hash', await sha256(body.key))
    if (error) throw error
  } else if (uid) {
    const { error } = await admin.from('shares').delete().eq('token', body.token).eq('owner', uid)
    if (error) throw error
  } else return reject(401, 'Sign in to remove your links.')
  await admin.storage.from(THUMBS).remove([`${body.token}.webp`]).catch(() => {})
  return json(200, { ok: true })
}

const since = (ms: number) => new Date(Date.now() - ms).toISOString()

async function create(admin: SupabaseClient, uid: string | null, ip: string | null, body: any): Promise<Response> {
  if (typeof body.data !== 'string') return reject(400, 'Invalid request body.')
  if (!uid && !ip) return reject(401, 'Sign in to make a play link.')

  // Check what will be stored, not what the page says about it.
  let raw: unknown
  try { raw = unpackShare(fromBase64(body.data)) } catch (e) { return reject(422, (e as Error).message || 'This is not a play link.') }
  const { problems, doc } = validateShareDoc(raw)
  if (!doc) return reject(422, 'This map can’t be shared yet.', problems)
  let thumb: Uint8Array | null = null
  if (body.thumb != null) {
    if (typeof body.thumb !== 'string') return reject(400, 'Invalid request body.')
    try { thumb = fromBase64(body.thumb) } catch { return reject(422, 'The preview picture is not valid.') }
    const webp = thumb.length > 12 && String.fromCharCode(...thumb.subarray(8, 12)) === 'WEBP'
    if (!webp || !isValidThumbnail(thumb.length, thumb.subarray(0, 64))) return reject(422, 'The preview picture is not valid.')
  }
  const listed = body.listed === true
  if (listed && !uid) return reject(422, 'Sign in to list a map in the gallery.')
  if (listed && !galleryReady(doc)) return reject(422, 'Only maps built entirely from the site’s own shapes and prefabs can go in the gallery.')

  const meta = shareMeta(doc)
  const row = { title: doc.title, data: body.data, size_bytes: Math.floor(body.data.length * 0.75), updated_at: new Date().toISOString(), modes: meta.modes, players: meta.players }
  const saveThumb = async (token: string) => {
    if (!thumb) return {}
    const up = await admin.storage.from(THUMBS).upload(`${token}.webp`, thumb, { contentType: 'image/webp', upsert: true, cacheControl: '300' })
    if (up.error) { console.error('Preview upload failed', up.error.message); return {} }
    return { thumb: new Date().toISOString(), shot: body.shot === true }
  }

  if (!uid) {
    // Anonymous: limited per IP hash, expires, edited only with its key.
    if (typeof body.token === 'string' && typeof body.key === 'string' && SHARE_TOKEN.test(body.key)) {
      const keyHash = await sha256(body.key)
      const old = await admin.from('shares').select('token, expires_at').eq('token', body.token).eq('anon', true).eq('key_hash', keyHash).maybeSingle()
      if (old.error) throw old.error
      if (old.data && new Date(old.data.expires_at).getTime() > Date.now()) {
        const up = await admin.from('shares').update({ ...row, ...(await saveThumb(body.token)) }).eq('token', body.token).eq('key_hash', keyHash)
        if (up.error) throw up.error
        return json(200, { token: body.token, key: body.key, expires_at: old.data.expires_at })
      }
    }
    const perDay = num('SHARE_ANON_PER_DAY', SHARE_RULES.anonPerDay)
    const recent = await admin.from('shares').select('token', { count: 'exact', head: true }).eq('ip_hash', ip).gte('created_at', since(86400_000))
    if (recent.error) throw recent.error
    if ((recent.count ?? 0) >= perDay) return reject(429, `Without an account you can make ${perDay} play links a day. Sign in for more, or try again tomorrow.`)
    const token = newShareToken(), editKey = newShareToken()
    const expires_at = new Date(Date.now() + SHARE_RULES.anonDays * 86400_000).toISOString()
    const ins = await admin.from('shares').insert({ ...row, token, owner: null, anon: true, expires_at, ip_hash: ip, key_hash: await sha256(editKey) })
    if (ins.error) throw ins.error
    const t = await saveThumb(token)
    if (t.thumb) await admin.from('shares').update(t).eq('token', token)
    return json(200, { token, key: editKey, expires_at })
  }

  const perDay = num('SHARE_MAX_PER_DAY', SHARE_RULES.perDay)
  const perUser = num('SHARE_MAX_PER_USER', SHARE_RULES.perUser)
  const recent = await admin.from('shares').select('token', { count: 'exact', head: true }).eq('owner', uid).gte('updated_at', since(86400_000))
  if (recent.error) throw recent.error
  if ((recent.count ?? 0) >= perDay) return reject(429, `You can make or update ${perDay} play links a day. Try again tomorrow.`)

  if (body.token) {
    const old = await admin.from('shares').select('owner').eq('token', body.token).maybeSingle()
    if (old.error) throw old.error
    if (old.data && old.data.owner === uid) {
      const up = await admin.from('shares').update({ ...row, listed, ...(await saveThumb(body.token)) }).eq('token', body.token).eq('owner', uid)
      if (up.error) throw up.error
      return json(200, { token: body.token })
    }
    // Not yours (or removed): make a new link instead.
  }
  const total = await admin.from('shares').select('token', { count: 'exact', head: true }).eq('owner', uid)
  if (total.error) throw total.error
  if ((total.count ?? 0) >= perUser) return reject(429, `You have ${perUser} play links. Remove some you no longer need first.`)
  const token = newShareToken()
  const ins = await admin.from('shares').insert({ ...row, token, owner: uid, listed })
  if (ins.error) throw ins.error
  const t = await saveThumb(token)
  if (t.thumb) await admin.from('shares').update(t).eq('token', token)
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
    const recent = await admin.from('share_reports').select('id', { count: 'exact', head: true }).eq('ip_hash', ip).gte('created_at', since(86400_000))
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
  const problems = checkTime(entry, doc.project.markers)
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

export const config = { path: ['/api/share', '/api/share/report', '/api/share/time'] }
