// Scheduled daily: deletes play links made without an account once they
// expire (30 days, see SHARE_RULES.anonDays), with their reports, ratings,
// board times (cascade) and preview pictures. Also clears the share function's
// limit log after two days, and (as a backstop: hiding removes it at once)
// the preview pictures of links a moderator hid.
import { createClient } from '@supabase/supabase-js'
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
  const old = await admin.from('share_log').delete().lt('created_at', new Date(Date.now() - 2 * 86400_000).toISOString())
  if (old.error) console.error('Clearing the limit log failed', old.error.message)
  console.log(`Expired play links removed: ${removed}; hidden previews removed: ${unpictured}`)
  return new Response(JSON.stringify({ removed, unpictured }), { headers: { 'Content-Type': 'application/json' } })
}

export const config = { schedule: '@daily' }
