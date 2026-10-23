// POST   /api/share  {title, data, token?} -> {token}   (data: base64 of the gzip share, see src/play/share.ts)
// DELETE /api/share  {token}                -> {ok}
//
// Play links. The function unpacks and checks every share with the same rules
// as the browser (no files, plain OBJ geometry, texture recipes only) before
// storing it, and is the only thing that can write to public.shares. Anyone
// can read a share with its token through the get_share RPC; nothing lists them.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseProjectUrl } from '../../src/lib/hubRules'
import { SHARE_LIMITS, SHARE_TOKEN, fromBase64, newShareToken, unpackShare, validateShareDoc } from '../../src/play/share'

const env = (k: string) => process.env[k] || ''

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const reject = (status: number, error: string, problems: string[] = []) => json(status, { error, problems })

/** Base64 grows the gzip by a third; anything bigger than this can't be a valid share. */
const MAX_BODY = Math.ceil(SHARE_LIMITS.packedBytes * 1.4) + 4096

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST' && req.method !== 'DELETE') return reject(405, 'Method not allowed')
  if (req.method === 'POST' && env('SHARES_ENABLED') === 'false') return reject(403, 'Play links are turned off on this site.')
  const url = supabaseProjectUrl(env('SUPABASE_URL')), key = env('SUPABASE_SERVICE_ROLE_KEY').trim()
  if (!url || !key) return reject(503, 'Play links are not set up on this site.')
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return reject(401, 'Sign in first.')
  const { data: auth, error: authError } = await admin.auth.getUser(jwt)
  if (authError && ![400, 401, 403].includes(authError.status ?? 0)) {
    console.error('Supabase auth check failed', authError.status, authError.message)
    return reject(503, 'The account service is not reachable right now. Try again later.')
  }
  if (authError || !auth.user) return reject(401, 'Your session has expired. Sign in again.')
  const uid = auth.user.id

  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) return reject(413, 'This map is too large to share.')
  let body: any
  try {
    const text = await req.text()
    if (text.length > MAX_BODY) return reject(413, 'This map is too large to share.')
    body = JSON.parse(text)
  } catch { return reject(400, 'Invalid request body.') }
  if (!body || typeof body !== 'object') return reject(400, 'Invalid request body.')

  try {
    if (req.method === 'DELETE') return await remove(admin, uid, body.token)
    return await create(admin, uid, body)
  } catch (err) {
    console.error(err)
    return reject(500, 'Something went wrong on the server. Try again later.')
  }
}

async function remove(admin: SupabaseClient, uid: string, token: unknown): Promise<Response> {
  if (typeof token !== 'string' || !SHARE_TOKEN.test(token)) return reject(400, 'Invalid link.')
  const { error } = await admin.from('shares').delete().eq('token', token).eq('owner', uid)
  if (error) throw error
  return json(200, { ok: true })
}

async function create(admin: SupabaseClient, uid: string, body: any): Promise<Response> {
  if (typeof body.data !== 'string') return reject(400, 'Invalid request body.')
  if (body.token != null && (typeof body.token !== 'string' || !SHARE_TOKEN.test(body.token))) return reject(400, 'Invalid link.')

  // Check what will be stored, not what the page says about it.
  let raw: unknown
  try { raw = unpackShare(fromBase64(body.data)) } catch (e) { return reject(422, (e as Error).message || 'This is not a play link.') }
  const { problems, doc } = validateShareDoc(raw)
  if (!doc) return reject(422, 'This map can’t be shared yet.', problems)

  const perDay = Number(env('SHARE_MAX_PER_DAY')) || 50
  const perUser = Number(env('SHARE_MAX_PER_USER')) || 200
  const since = new Date(Date.now() - 86400_000).toISOString()
  const recent = await admin.from('shares').select('token', { count: 'exact', head: true }).eq('owner', uid).gte('updated_at', since)
  if (recent.error) throw recent.error
  if ((recent.count ?? 0) >= perDay) return reject(429, `You can make or update ${perDay} play links a day. Try again tomorrow.`)

  const row = { title: doc.title, data: body.data, size_bytes: Math.floor(body.data.length * 0.75), updated_at: new Date().toISOString() }
  if (body.token) {
    const old = await admin.from('shares').select('owner').eq('token', body.token).maybeSingle()
    if (old.error) throw old.error
    if (old.data && old.data.owner === uid) {
      const up = await admin.from('shares').update(row).eq('token', body.token).eq('owner', uid)
      if (up.error) throw up.error
      return json(200, { token: body.token })
    }
    // Not yours (or removed): make a new link instead.
  }
  const total = await admin.from('shares').select('token', { count: 'exact', head: true }).eq('owner', uid)
  if (total.error) throw total.error
  if ((total.count ?? 0) >= perUser) return reject(429, `You have ${perUser} play links. Remove some you no longer need first.`)
  const token = newShareToken()
  const ins = await admin.from('shares').insert({ ...row, token, owner: uid })
  if (ins.error) throw ins.error
  return json(200, { token })
}

export const config = { path: '/api/share' }
