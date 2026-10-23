// POST   /api/publish  {projectId, snapshot, title, description, tags, thumb?, shots, mapId?} -> {id}
// DELETE /api/publish  {mapId}                                                          -> {ok}
//
// The Showcase: re-checks the map with the same rules as the browser
// (src/lib/hubRules.ts showcasePlan). Only maps made from the site's own
// textures, shapes and prefabs pass, and only their recipes are stored. The
// sole files copied to hub/<mapId>/ are the author's screenshots and thumbnail,
// read back from their cloud storage and checked to be small images. Only this
// function (service role) can write to hub/.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { HEAD_BYTES, MAX_SHOTS, checkShots, isValidThumbnail, libraryIdsFrom, prepareShowcase, supabaseProjectUrl } from '../../src/lib/hubRules'
import library from '../../public/textures/index.json'

const LIBRARY = libraryIdsFrom(library)
const HASH = /^[0-9a-f]{64}$/

const BUCKET = 'blobs'
const env = (k: string) => process.env[k] || ''

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const reject = (status: number, error: string, problems: string[] = []) => json(status, { error, problems })

async function mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let next = 0
  const worker = async () => { while (next < items.length) await fn(items[next++]) }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** First `n` bytes of a response body, cancelling the rest of the download. */
async function readUpTo(res: Response, n: number): Promise<Uint8Array> {
  const out = new Uint8Array(n)
  let len = 0
  const reader = res.body?.getReader()
  if (!reader) return out.subarray(0, 0)
  while (len < n) {
    const { done, value } = await reader.read()
    if (done) break
    const take = Math.min(value.length, n - len)
    out.set(value.subarray(0, take), len)
    len += take
  }
  await reader.cancel().catch(() => {})
  return out.subarray(0, len)
}

/** Real size and first HEAD_BYTES of a stored object, or null if it doesn't exist. */
async function readHead(admin: SupabaseClient, path: string): Promise<{ size: number; head: Uint8Array } | null> {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 120)
  if (error || !data?.signedUrl) return null
  const res = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } })
  if (res.status === 416) return { size: 0, head: new Uint8Array(0) }
  if (res.status === 400 || res.status === 404) return null
  if (!res.ok) throw new Error(`Storage read failed (${res.status})`)
  const range = res.headers.get('content-range') // "bytes 0-4095/123456"
  const size = res.status === 206 && range ? Number(range.split('/')[1]) : Number(res.headers.get('content-length'))
  const head = await readUpTo(res, HEAD_BYTES)
  if (!Number.isFinite(size)) throw new Error('Storage did not report a file size.')
  return { size, head }
}

async function listAll(admin: SupabaseClient, folder: string): Promise<string[]> {
  const names: string[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(BUCKET).list(folder, { limit: 1000, offset })
    if (error) throw error
    names.push(...(data || []).map((o) => o.name))
    if (!data || data.length < 1000) return names
  }
}

async function removeAll(admin: SupabaseClient, paths: string[]) {
  for (let i = 0; i < paths.length; i += 500) {
    const { error } = await admin.storage.from(BUCKET).remove(paths.slice(i, i + 500))
    if (error) throw error
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST' && req.method !== 'DELETE') return reject(405, 'Method not allowed')
  if (req.method === 'POST' && env('HUB_ENABLED') !== 'true') return reject(403, 'Publishing is turned off on this site.')
  const url = supabaseProjectUrl(env('SUPABASE_URL')), key = env('SUPABASE_SERVICE_ROLE_KEY').trim()
  if (!url || !key) return reject(503, 'Publishing is not configured on this site.')
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return reject(401, 'Sign in first.')
  const { data: auth, error: authError } = await admin.auth.getUser(token)
  if (authError && ![400, 401, 403].includes(authError.status ?? 0)) {
    // Not a token problem: the account service is unreachable or misconfigured.
    console.error('Supabase auth check failed', authError.status, authError.message)
    return reject(503, 'The account service is not reachable right now. Try again later.')
  }
  if (authError || !auth.user) return reject(401, 'Your session has expired. Sign in again.')
  const uid = auth.user.id

  let body: any
  try { body = await req.json() } catch { return reject(400, 'Invalid request body.') }
  if (!body || typeof body !== 'object') return reject(400, 'Invalid request body.')

  try {
    if (req.method === 'DELETE') return await unpublish(admin, uid, body.mapId)
    return await publish(admin, uid, body)
  } catch (err) {
    console.error(err)
    return reject(500, 'Something went wrong on the server. Try again later.')
  }
}

async function unpublish(admin: SupabaseClient, uid: string, mapId: unknown): Promise<Response> {
  if (typeof mapId !== 'string' || !UUID.test(mapId)) return reject(400, 'Invalid map id.')
  const { data: map, error } = await admin.from('hub_maps').select('id, owner').eq('id', mapId).maybeSingle()
  if (error) throw error
  if (!map) return json(200, { ok: true })
  if (map.owner !== uid) return reject(403, 'You can only unpublish your own maps.')
  // Delete the row first so the files stop being public immediately.
  const del = await admin.from('hub_maps').delete().eq('id', mapId)
  if (del.error) throw del.error
  const names = await listAll(admin, `hub/${mapId}`)
  await removeAll(admin, names.map((n) => `hub/${mapId}/${n}`))
  return json(200, { ok: true })
}

async function publish(admin: SupabaseClient, uid: string, body: any): Promise<Response> {
  const { projectId, mapId } = body
  if (typeof projectId !== 'string' || !projectId || projectId.length > 64) return reject(400, 'Invalid project id.')
  if (mapId != null && (typeof mapId !== 'string' || !UUID.test(mapId))) return reject(400, 'Invalid map id.')
  const shots: unknown = body.shots ?? []
  if (!Array.isArray(shots) || shots.length > MAX_SHOTS || !shots.every((h) => typeof h === 'string' && HASH.test(h))) return reject(400, `Send at most ${MAX_SHOTS} screenshots.`)
  if (body.thumb != null && (typeof body.thumb !== 'string' || !HASH.test(body.thumb))) return reject(400, 'Invalid thumbnail.')

  const perDay = Number(env('HUB_MAX_PUBLISH_PER_DAY')) || 20
  const since = new Date(Date.now() - 86400_000).toISOString()
  const recent = await admin.from('hub_publish_log').select('id', { count: 'exact', head: true }).eq('user_id', uid).gte('created_at', since)
  if (recent.error) throw recent.error
  if ((recent.count ?? 0) >= perDay) return reject(429, `You can publish ${perDay} times a day. Try again tomorrow.`)

  let existing: { id: string; owner: string; version: number; shots: number } | null = null
  if (mapId) {
    const r = await admin.from('hub_maps').select('id, owner, version, shots').eq('id', mapId).maybeSingle()
    if (r.error) throw r.error
    if (!r.data || r.data.owner !== uid) return reject(403, 'You can only update Showcase maps you published.')
    existing = r.data
  }

  const prep = prepareShowcase(body.snapshot, { title: body.title, description: body.description ?? '', tags: body.tags }, LIBRARY)
  const images = [...(shots as string[]), ...(body.thumb ? [body.thumb as string] : [])]
  const heads = await Promise.all(images.map((h) => readHead(admin, `u/${uid}/${h}`)))
  if (heads.some((h) => !h)) prep.problems.push("A screenshot hasn't finished uploading. Try again.")
  else {
    prep.problems.push(...checkShots(heads.slice(0, shots.length) as { size: number; head: Uint8Array }[]))
    const t = body.thumb ? heads[heads.length - 1]! : null
    if (t && !isValidThumbnail(t.size, t.head)) prep.problems.push('The thumbnail must be a PNG, JPEG or WebP image of at most 2 MB.')
  }
  if (prep.problems.length) return reject(422, "This map can't go in the Showcase yet.", prep.problems)

  const id = existing?.id ?? crypto.randomUUID()
  const folder = `hub/${id}`
  const present = new Set(existing ? await listAll(admin, folder) : [])

  // Images first; the row (which makes them public) is written last.
  const names = [...(shots as string[]).map((_, i) => `shot-${i}`), ...(body.thumb ? ['thumb.webp'] : [])]
  await removeAll(admin, names.filter((n) => present.has(n)).map((n) => `${folder}/${n}`))
  const copied: string[] = []
  await mapLimit(names.map((n, i) => [n, images[i]] as const), 4, async ([name, hash]) => {
    const { error } = await admin.storage.from(BUCKET).copy(`u/${uid}/${hash}`, `${folder}/${name}`)
    if (error) throw error
    copied.push(`${folder}/${name}`)
  })

  // Ensure a profile exists (accounts created before the migration have none).
  await admin.from('profiles').upsert({ id: uid, display_name: 'Player-' + uid.replace(/-/g, '').slice(0, 6) }, { onConflict: 'id', ignoreDuplicates: true })

  let remixOf: string | null = null, remixTitle: string | null = null
  const parentId = prep.snapshot.remix_of?.hub_id
  if (typeof parentId === 'string' && UUID.test(parentId) && parentId !== id) {
    const p = await admin.from('hub_maps').select('id, title').eq('id', parentId).eq('showcase', true).maybeSingle()
    if (p.data) { remixOf = p.data.id; remixTitle = p.data.title }
  }

  const row = {
    title: prep.meta.title, description: prep.meta.description, tags: prep.meta.tags,
    snapshot: prep.snapshot, files: [], size_bytes: heads.reduce((a, h) => a + (h?.size ?? 0), 0),
    has_thumb: !!body.thumb, shots: shots.length, showcase: true,
    remix_of: remixOf, remix_of_title: remixTitle, project_id: projectId,
    updated_at: new Date().toISOString(),
  }
  const write = existing
    ? await admin.from('hub_maps').update({ ...row, version: existing.version + 1 }).eq('id', id)
    : await admin.from('hub_maps').insert({ ...row, id, owner: uid })
  if (write.error) {
    if (!existing) await removeAll(admin, copied).catch(() => {})
    throw write.error
  }

  // Anything else in the folder: dropped screenshots, and files of a pre-Showcase version of this map.
  if (existing) {
    const keep = new Set(names)
    await removeAll(admin, [...present].filter((n) => !keep.has(n)).map((n) => `${folder}/${n}`)).catch((e) => console.warn('Cleanup failed', e))
  }

  await admin.from('hub_publish_log').insert({ user_id: uid, map_id: id })
  return json(200, { id })
}

export const config = { path: '/api/publish' }
