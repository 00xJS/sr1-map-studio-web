// Scheduled daily: deletes play links made without an account once they
// expire (30 days, see SHARE_RULES.anonDays), with their reports, ratings,
// board times (cascade) and preview pictures. Also clears the share function's
// limit log after two days, and (as a backstop: hiding removes it at once)
// the preview pictures of links a moderator hid. Last, it deletes pictures no
// link names any more (a deleted account's links go with it, but their
// pictures are only in storage), once they are an hour old.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseProjectUrl } from '../../src/lib/hubRules'

const env = (k: string) => process.env[k] || ''
const BATCH = 500

export default async (): Promise<Response> => {
  const url = supabaseProjectUrl(env('SUPABASE_URL')), key = env('SUPABASE_SERVICE_ROLE_KEY').trim()
  if (!url || !key) return new Response('Play links are not set up on this site.', { status: 503 })
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  let removed = 0, unpictured = 0
  for (let round = 0; round < 40; round++) {
    const due = await admin.from('shares').select('token, thumb_path').lt('expires_at', new Date().toISOString()).limit(BATCH)
    if (due.error) { console.error('Finding expired links failed', due.error.message); break }
    const tokens = (due.data ?? []).map((r) => r.token as string)
    if (!tokens.length) break
    const gone = await admin.from('shares').delete().in('token', tokens)
    if (gone.error) { console.error('Removing expired links failed', gone.error.message); break }
    const paths = (due.data ?? []).map((r) => r.thumb_path as string | null).filter((x): x is string => !!x)
    if (paths.length) await admin.storage.from('share-thumbs').remove(paths).catch(() => {})
    removed += tokens.length
    if (tokens.length < BATCH) break
  }
  const hidden = await admin.from('shares').select('token, thumb_path').eq('hidden', true).not('thumb_path', 'is', null).limit(BATCH)
  if (hidden.error) console.error('Finding hidden previews failed', hidden.error.message)
  else if (hidden.data?.length) {
    const cleared = await admin.from('shares').update({ thumb: null, thumb_path: null, thumb_approved: false }).in('token', hidden.data.map((r) => r.token))
    if (cleared.error) console.error('Clearing hidden previews failed', cleared.error.message)
    else {
      await admin.storage.from('share-thumbs').remove(hidden.data.map((r) => r.thumb_path as string)).catch(() => {})
      unpictured = hidden.data.length
    }
  }
  const orphans = await sweepPictures(admin).catch((e) => { console.error('Sweeping pictures failed', e?.message ?? e); return 0 })
  const old = await admin.from('share_log').delete().lt('created_at', new Date(Date.now() - 2 * 86400_000).toISOString())
  if (old.error) console.error('Clearing the limit log failed', old.error.message)
  console.log(`Expired play links removed: ${removed}; hidden previews removed: ${unpictured}; pictures no link names removed: ${orphans}`)
  return new Response(JSON.stringify({ removed, unpictured, orphans }), { headers: { 'Content-Type': 'application/json' } })
}

/** Deletes pictures in share-thumbs that no link names, once an hour old (one being stored right now is left alone). */
export async function sweepPictures(admin: SupabaseClient): Promise<number> {
  const named = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const r = await admin.from('shares').select('thumb_path').not('thumb_path', 'is', null).order('token').range(from, from + 999)
    if (r.error) throw r.error
    for (const row of r.data ?? []) named.add((row as { thumb_path: string }).thumb_path)
    if ((r.data ?? []).length < 1000) break
  }
  const cutoff = Date.now() - 3600_000
  const stray: string[] = []
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const page = await admin.storage.from('share-thumbs').list('', { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
    if (page.error) throw page.error
    for (const f of page.data ?? []) if (!named.has(f.name) && new Date(f.created_at ?? 0).getTime() < cutoff) stray.push(f.name)
    if ((page.data ?? []).length < 1000) break
  }
  // Asked again just before deleting: a picture a moderator approved meanwhile moved to a name the first look missed,
  // and keeps its old upload time.
  let gone = 0
  // A hundred names at a time: they go in the request's address, which has a length limit.
  for (let i = 0; i < stray.length; i += 100) {
    const batch = stray.slice(i, i + 100)
    const still = await admin.from('shares').select('thumb_path').in('thumb_path', batch)
    if (still.error) throw still.error
    const named = new Set((still.data ?? []).map((r) => (r as { thumb_path: string }).thumb_path))
    const go = batch.filter((n) => !named.has(n))
    if (go.length) await admin.storage.from('share-thumbs').remove(go)
    gone += go.length
  }
  return gone
}

export const config = { schedule: '@daily' }
