// Scheduled daily: deletes play links made without an account once they
// expire (30 days, see SHARE_RULES.anonDays), with their reports, ratings,
// board times (cascade) and preview pictures. Also takes down the preview
// pictures of links a moderator hid.
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
    const due = await admin.from('shares').select('token').lt('expires_at', new Date().toISOString()).limit(BATCH)
    if (due.error) { console.error('Finding expired links failed', due.error.message); break }
    const tokens = (due.data ?? []).map((r) => r.token as string)
    if (!tokens.length) break
    const gone = await admin.from('shares').delete().in('token', tokens)
    if (gone.error) { console.error('Removing expired links failed', gone.error.message); break }
    await admin.storage.from('share-thumbs').remove(tokens.map((t) => `${t}.webp`)).catch(() => {})
    removed += tokens.length
    if (tokens.length < BATCH) break
  }
  const hidden = await admin.from('shares').update({ thumb: null }).eq('hidden', true).not('thumb', 'is', null).select('token')
  if (hidden.error) console.error('Clearing hidden previews failed', hidden.error.message)
  else if (hidden.data?.length) {
    await admin.storage.from('share-thumbs').remove(hidden.data.map((r) => `${r.token}.webp`)).catch(() => {})
    unpictured = hidden.data.length
  }
  console.log(`Expired play links removed: ${removed}; hidden previews removed: ${unpictured}`)
  return new Response(JSON.stringify({ removed, unpictured }), { headers: { 'Content-Type': 'application/json' } })
}

export const config = { schedule: '@daily' }
