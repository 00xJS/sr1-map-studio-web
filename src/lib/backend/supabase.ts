// Production backend: Supabase auth, Postgres (RLS) and Storage, plus the
// Netlify function /api/publish that validates and copies files to the hub.
// Schema: supabase/migrations/0001_init.sql.
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import type { Project } from '../project'
import {
  ConflictError, PublishRejected,
  type Backend, type CloudProjectMeta, type HubMapDetail, type HubMapMeta, type HubQuery, type HubReport, type PublishInput, type ReportReason, type User,
} from './types'

const BUCKET = 'blobs'
const URL_TTL = 3600
const MAP_COLS = 'id, owner, project_id, title, description, tags, likes, remixes, downloads, created_at, updated_at, remix_of, remix_of_title, hidden, has_thumb, author:profiles!hub_maps_owner_fkey(id, display_name, avatar_url)'

/** Supabase results carry errors as plain objects; throw them as Errors. Rows are untyped (no generated DB types). */
function check(r: { data?: unknown; error: { message: string; code?: string } | null }): any {
  if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code })
  return r.data
}

/** "big city" -> "big:* & city:*" (prefix search over the 'simple' config). */
function toTsQuery(search?: string) {
  const words = (search || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []
  return words.slice(0, 8).map((w) => w + ':*').join(' & ')
}

export class SupabaseBackend implements Backend {
  readonly kind = 'supabase' as const
  readonly label = 'SR1 Map Studio accounts'
  private sb: SupabaseClient

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  }

  private async session(): Promise<Session | null> { return (await this.sb.auth.getSession()).data.session }
  private async uid(): Promise<string> {
    const s = await this.session()
    if (!s) throw new Error('Sign in first.')
    return s.user.id
  }
  private bucket() { return this.sb.storage.from(BUCKET) }

  // ---------------- auth ----------------

  private async profile(session: Session | null): Promise<User | null> {
    if (!session) return null
    const p = check(await this.sb.from('profiles').select('display_name, avatar_url, is_moderator').eq('id', session.user.id).maybeSingle())
    const meta = session.user.user_metadata || {}
    return {
      id: session.user.id,
      name: p?.display_name || meta.user_name || meta.full_name || 'Player',
      avatar_url: p?.avatar_url || meta.avatar_url || undefined,
      is_moderator: !!p?.is_moderator,
    }
  }
  async getUser() { return this.profile(await this.session()) }
  onAuthChange(cb: (user: User | null) => void) {
    const { data } = this.sb.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED') return
      // Querying from inside the auth callback can deadlock supabase-js; defer.
      setTimeout(() => { this.profile(session).then(cb, () => cb(null)) }, 0)
    })
    return () => data.subscription.unsubscribe()
  }
  async signInWithEmail(email: string): Promise<'link-sent'> {
    check(await this.sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${location.origin}/account` } }))
    return 'link-sent'
  }
  async signInWithProvider(provider: 'github' | 'discord' | 'google') {
    check(await this.sb.auth.signInWithOAuth({ provider, options: { redirectTo: `${location.origin}/account` } }))
  }
  async signOut() { check(await this.sb.auth.signOut()) }
  async updateProfile(name: string): Promise<User> {
    const n = name.trim()
    if (n.length < 1 || n.length > 40) throw new Error('Display names are 1 to 40 characters.')
    const uid = await this.uid()
    check(await this.sb.from('profiles').update({ display_name: n }).eq('id', uid))
    return (await this.getUser())!
  }

  // ---------------- cloud saves ----------------

  private async signedUrls(paths: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    if (!paths.length) return out
    const { data } = await this.bucket().createSignedUrls(paths, URL_TTL)
    for (const d of data || []) if (d.signedUrl && d.path) out.set(d.path, d.signedUrl)
    return out
  }

  async listCloudProjects(): Promise<CloudProjectMeta[]> {
    const uid = await this.uid()
    const rows: any[] = check(await this.sb.from('cloud_projects').select('id, name, updated_at, size_bytes, has_thumb').order('updated_at', { ascending: false })) ?? []
    const thumbs = await this.signedUrls(rows.filter((r) => r.has_thumb).map((r) => `u/${uid}/thumbs/${r.id}.webp`))
    return rows.map((r) => ({ id: r.id, name: r.name, updated_at: r.updated_at, size_bytes: Number(r.size_bytes), thumbnail_url: thumbs.get(`u/${uid}/thumbs/${r.id}.webp`) }))
  }
  async getCloudProject(id: string) {
    await this.uid()
    const r = check(await this.sb.from('cloud_projects').select('project, updated_at').eq('id', id).maybeSingle())
    return r ? { project: r.project as Project, updated_at: r.updated_at as string } : null
  }
  async putCloudProject(project: Project, thumbnail: Blob | null, opts?: { expectedUpdatedAt?: string }) {
    const uid = await this.uid()
    const size = JSON.stringify(project).length + Object.values(project.files).filter((f) => f.origin === 'user').reduce((a, f) => a + f.size, 0)
    const res = check(await this.sb.rpc('cloud_put', {
      p_id: project.id, p_name: project.name, p_project: project, p_size: size,
      p_has_thumb: thumbnail ? true : null, p_expected: opts?.expectedUpdatedAt ?? null,
    })) as { conflict: boolean; updated_at: string }
    if (res.conflict) throw new ConflictError(res.updated_at)
    if (thumbnail) {
      const { error } = await this.bucket().upload(`u/${uid}/thumbs/${project.id}.webp`, thumbnail, { upsert: true, contentType: /^image\/(webp|png|jpeg)$/.test(thumbnail.type) ? thumbnail.type : 'image/webp' })
      if (error) console.warn('Thumbnail upload failed', error)
    }
    return { updated_at: res.updated_at }
  }
  async deleteCloudProject(id: string) {
    const uid = await this.uid()
    check(await this.sb.from('cloud_projects').delete().eq('id', id))
    await this.bucket().remove([`u/${uid}/thumbs/${id}.webp`])
  }
  async hasBlobs(hashes: string[]): Promise<Set<string>> {
    await this.uid()
    const out = new Set<string>()
    const unique = [...new Set(hashes)]
    for (let i = 0; i < unique.length; i += 500) {
      const found = check(await this.sb.rpc('blobs_present', { hashes: unique.slice(i, i + 500) })) as string[] | null
      for (const h of found || []) out.add(h)
    }
    return out
  }
  async uploadBlob(hash: string, blob: Blob) {
    const uid = await this.uid()
    const { error } = await this.bucket().upload(`u/${uid}/${hash}`, blob, { contentType: 'application/octet-stream', upsert: false })
    // Content-addressed: an existing object already holds these bytes.
    if (error && !/exist|duplicate/i.test(error.message) && (error as any).statusCode !== '409') throw error
  }
  async downloadBlob(hash: string): Promise<Blob> {
    const uid = await this.uid()
    const { data, error } = await this.bucket().download(`u/${uid}/${hash}`)
    if (error || !data) throw new Error('Could not download a file from your cloud storage: ' + (error?.message || 'missing'))
    return data
  }

  // ---------------- hub ----------------

  private async toMeta(rows: any[]): Promise<HubMapMeta[]> {
    const s = await this.session()
    const ids = rows.map((r) => r.id)
    let liked = new Set<string>()
    if (s && ids.length) {
      const likes: any[] = check(await this.sb.from('hub_likes').select('map_id').eq('user_id', s.user.id).in('map_id', ids)) ?? []
      liked = new Set(likes.map((l) => l.map_id))
    }
    const thumbs = await this.signedUrls(rows.filter((r) => r.has_thumb).map((r) => `hub/${r.id}/thumb.webp`))
    return rows.map((r) => ({
      id: r.id, title: r.title, description: r.description, tags: r.tags || [],
      author: { id: r.owner, name: r.author?.display_name || 'Unknown', avatar_url: r.author?.avatar_url || undefined },
      thumbnail_url: thumbs.get(`hub/${r.id}/thumb.webp`),
      likes: r.likes, remixes: r.remixes, downloads: r.downloads, created_at: r.created_at, updated_at: r.updated_at,
      remix_of: r.remix_of ? { id: r.remix_of, title: r.remix_of_title || 'another map' } : null,
      liked_by_me: s ? liked.has(r.id) : undefined, hidden: r.hidden,
      project_id: s && r.owner === s.user.id ? r.project_id : undefined,
    }))
  }

  async listHub(q: HubQuery) {
    let query = this.sb.from('hub_maps').select(MAP_COLS, { count: 'exact' }).eq('hidden', false)
    if (q.tag) query = query.contains('tags', [q.tag])
    if (q.author) query = query.eq('owner', q.author)
    const ts = toTsQuery(q.search)
    if (ts) query = query.textSearch('search', ts, { config: 'simple' })
    if (q.sort === 'top') query = query.order('likes', { ascending: false })
    if (q.sort === 'remixed') query = query.order('remixes', { ascending: false })
    query = query.order('created_at', { ascending: false })
    const from = (Math.max(1, q.page) - 1) * q.pageSize
    const { data, error, count } = await query.range(from, from + q.pageSize - 1)
    if (error) throw new Error(error.message)
    return { items: await this.toMeta(data || []), total: count ?? 0 }
  }

  async popularTags(limit = 24) {
    const rows: any[] = check(await this.sb.rpc('hub_popular_tags', { max_tags: limit })) || []
    return rows.map((r) => ({ tag: r.tag as string, count: Number(r.count) }))
  }

  async getHubMap(id: string): Promise<HubMapDetail | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null
    const r = check(await this.sb.from('hub_maps').select(MAP_COLS + ', snapshot').eq('id', id).maybeSingle())
    if (!r) return null
    const [meta] = await this.toMeta([r])
    return { ...meta, project: (r as any).snapshot as Project }
  }

  async downloadHubBlob(mapId: string, hash: string): Promise<Blob> {
    const { data, error } = await this.bucket().download(`hub/${mapId}/${hash}`)
    if (error || !data) throw new Error('Could not download a file of this map: ' + (error?.message || 'missing'))
    return data
  }

  private async api(method: 'POST' | 'DELETE', body: unknown): Promise<Response> {
    const s = await this.session()
    if (!s) throw new Error('Sign in first.')
    return fetch('/api/publish', { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}` }, body: JSON.stringify(body) })
  }

  async publish(input: PublishInput): Promise<{ id: string }> {
    const res = await this.api('POST', input)
    const body = await res.json().catch(() => ({}))
    if (res.ok && body.id) return { id: body.id }
    if (res.status >= 400 && res.status < 500) throw new PublishRejected(body.error || 'Publishing was rejected.', Array.isArray(body.problems) ? body.problems : [])
    throw new Error(body.error || `Publishing failed (HTTP ${res.status}). Try again later.`)
  }
  async unpublish(mapId: string) {
    const res = await this.api('DELETE', { mapId })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Unpublishing failed (HTTP ${res.status}).`)
  }
  async myPublished(): Promise<HubMapMeta[]> {
    const uid = await this.uid()
    return this.toMeta(check(await this.sb.from('hub_maps').select(MAP_COLS).eq('owner', uid).order('updated_at', { ascending: false })) || [])
  }
  async setLike(mapId: string, liked: boolean) {
    const uid = await this.uid()
    if (liked) {
      const { error } = await this.sb.from('hub_likes').insert({ map_id: mapId, user_id: uid })
      if (error && error.code !== '23505') throw new Error(error.message)
    } else {
      check(await this.sb.from('hub_likes').delete().eq('map_id', mapId).eq('user_id', uid))
    }
  }
  async recordRemix(mapId: string) { check(await this.sb.rpc('hub_record_remix', { map_id: mapId })) }
  async recordDownload(mapId: string) { check(await this.sb.rpc('hub_record_download', { map_id: mapId })) }
  async report(mapId: string, reason: ReportReason, details: string) {
    const uid = await this.uid()
    const { error } = await this.sb.from('hub_reports').insert({ map_id: mapId, reporter: uid, reason, details: details.slice(0, 2000) })
    if (error?.code === '23505') throw new Error('You already reported this map. A moderator will look at it.')
    if (error) throw new Error(error.message)
  }

  // ---------------- moderation ----------------

  async listReports(): Promise<HubReport[]> {
    await this.uid()
    const rows: any[] = check(await this.sb.from('hub_reports')
      .select('id, map_id, reason, details, status, created_at, map:hub_maps!hub_reports_map_id_fkey(title), who:profiles!hub_reports_reporter_fkey(display_name)')
      .eq('status', 'open').order('created_at', { ascending: false })) ?? []
    return rows.map((r) => ({
      id: r.id, map_id: r.map_id, map_title: r.map?.title ?? '(deleted map)', reason: r.reason, details: r.details,
      reporter: r.who?.display_name ?? 'Unknown', status: r.status, created_at: r.created_at,
    }))
  }
  async resolveReport(id: string, action: 'dismiss' | 'hide') {
    const uid = await this.uid()
    const resolved = { resolved_at: new Date().toISOString(), resolved_by: uid }
    if (action === 'dismiss') {
      const rows = check(await this.sb.from('hub_reports').update({ status: 'dismissed', ...resolved }).eq('id', id).select('id'))
      if (!rows?.length) throw new Error('Only moderators can do this.')
      return
    }
    const r = check(await this.sb.from('hub_reports').select('map_id').eq('id', id).maybeSingle())
    if (!r) throw new Error('Report not found.')
    await this.setHidden(r.map_id, true)
    check(await this.sb.from('hub_reports').update({ status: 'actioned', ...resolved }).eq('map_id', r.map_id).eq('status', 'open'))
  }
  async setHidden(mapId: string, hidden: boolean) {
    await this.uid()
    const rows = check(await this.sb.from('hub_maps').update({ hidden }).eq('id', mapId).select('id'))
    if (!rows?.length) throw new Error('Only moderators can do this.')
  }
}
