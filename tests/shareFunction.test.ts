// The share function itself (netlify/functions/share.mts) against an
// in-memory Supabase: removing links, limits, hiding, plays, board times
// through walls, and a database without migration 0004. Also the link
// preview's head rewrite (netlify/edge-functions/og.ts).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { newMarker, newProject, type Vec3 } from '../src/lib/project'
import { GhostRecorder, checkTime } from '../src/play/ghost'
import { wallsOf } from '../src/play/ghostWalls'
import { SHARE_RULES, cleanObj, packShare, toBase64, type ShareDoc } from '../src/play/share'

// ---------------- a small Supabase ----------------

type Row = Record<string, any>
type Result = { data: any; error: { code: string; message: string } | null; count?: number | null }

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  /** Columns each table has (a table missing here doesn't exist). */
  columns: {} as Record<string, string[]>,
  stored: new Map<string, unknown>(),
  removed: [] as string[],
  users: {} as Record<string, string>,
  moderators: new Set<string>(),
  plays: [] as string[],
}))

const NEW_SHARES = ['token', 'owner', 'title', 'data', 'size_bytes', 'created_at', 'updated_at', 'anon', 'expires_at', 'ip_hash', 'key_hash', 'listed', 'hidden', 'thumb', 'shot', 'plays', 'data_hash', 'modes', 'players']
const OLD_SHARES = ['token', 'owner', 'title', 'data', 'size_bytes', 'created_at', 'updated_at']
function schema(fresh: boolean) {
  db.columns = fresh
    ? { shares: NEW_SHARES, share_log: ['id', 'kind', 'ip_hash', 'token', 'created_at'], share_times: ['id', 'token', 'mode', 'name', 'ms', 'ghost', 'player', 'ip_hash', 'created_at'], share_reports: ['id', 'token', 'reason', 'details', 'reporter', 'ip_hash', 'status', 'created_at', 'resolved_at', 'resolved_by'], profiles: ['id', 'is_moderator'] }
    : { shares: OLD_SHARES, profiles: ['id', 'is_moderator'] }
  db.tables = Object.fromEntries(Object.keys(db.columns).map((t) => [t, []]))
}

class Query implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private cols: string[] = []
  private payload: Row | Row[] | null = null
  private filters: [string, (r: Row) => boolean][] = []
  private sorts: string[] = []
  private from = 0
  private to = Infinity
  private counting = false
  private head = false
  private one = false
  private returning = false
  constructor(private table: string) {}
  select(cols = '*', o: { count?: string; head?: boolean } = {}) {
    if (this.op === 'select') { this.cols = cols === '*' ? [] : cols.split(',').map((c) => c.trim()); this.counting = !!o.count; this.head = !!o.head } else this.returning = true
    return this
  }
  insert(p: Row | Row[]) { this.op = 'insert'; this.payload = p; return this }
  update(p: Row) { this.op = 'update'; this.payload = p; return this }
  delete() { this.op = 'delete'; return this }
  eq(c: string, v: unknown) { this.filters.push([c, (r) => r[c] === v]); return this }
  gte(c: string, v: string) { this.filters.push([c, (r) => r[c] >= v]); return this }
  lt(c: string, v: unknown) { this.filters.push([c, (r) => r[c] < (v as number)]); return this }
  in(c: string, v: unknown[]) { this.filters.push([c, (r) => v.includes(r[c])]); return this }
  not(c: string, _op: string, _v: null) { this.filters.push([c, (r) => r[c] != null]); return this }
  order(c: string) { this.sorts.push(c); return this }
  range(a: number, b: number) { this.from = a; this.to = b; return this }
  limit(n: number) { this.to = n - 1; return this }
  maybeSingle() { this.one = true; return this }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> { return Promise.resolve(this.run()).then(ok, bad) }

  private run(): Result {
    const known = db.columns[this.table]
    if (!known) return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${this.table}' in the schema cache` } }
    const used = [...this.cols, ...this.filters.map(([c]) => c), ...(this.payload ? (Array.isArray(this.payload) ? this.payload : [this.payload]).flatMap(Object.keys) : [])]
    const bad = used.find((c) => !known.includes(c))
    if (bad) return { data: null, error: { code: '42703', message: `column ${this.table}.${bad} does not exist` } }
    const rows = db.tables[this.table]
    const match = (r: Row) => this.filters.every(([, f]) => f(r))
    if (this.op === 'insert') {
      for (const p of Array.isArray(this.payload) ? this.payload : [this.payload!]) {
        rows.push({ id: rows.length + 1 + Math.random(), created_at: new Date().toISOString(), ...(this.table === 'shares' ? { hidden: false, plays: 0 } : {}), ...(this.table === 'share_reports' ? { status: 'open' } : {}), ...p })
      }
      return { data: null, error: null }
    }
    if (this.op === 'update') { for (const r of rows.filter(match)) Object.assign(r, this.payload); return { data: null, error: null } }
    if (this.op === 'delete') {
      const gone = rows.filter(match)
      db.tables[this.table] = rows.filter((r) => !match(r))
      return { data: this.returning ? gone : null, error: null }
    }
    let out = rows.filter(match)
    for (const s of this.sorts.slice().reverse()) out = out.slice().sort((a, b) => (a[s] < b[s] ? -1 : a[s] > b[s] ? 1 : 0))
    const count = out.length
    out = out.slice(this.from, this.to + 1)
    if (this.head) return { data: null, error: null, count }
    if (this.one) return { data: out[0] ?? null, error: null, count }
    return { data: out, error: null, count }
  }
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => new Query(t),
    auth: { getUser: async (jwt: string) => (db.users[jwt] ? { data: { user: { id: db.users[jwt] } }, error: null } : { data: { user: null }, error: { status: 401, message: 'bad jwt' } }) },
    storage: {
      from: () => ({
        upload: async (path: string, bytes: unknown) => { db.stored.set(path, bytes); return { error: null } },
        remove: async (paths: string[]) => { db.removed.push(...paths); for (const p of paths) db.stored.delete(p); return { error: null } },
      }),
    },
    rpc: async (name: string, args: { p_token: string }) => {
      if (name !== 'record_share_play') return { data: null, error: { code: 'PGRST202', message: 'no such function' } }
      db.plays.push(args.p_token)
      const s = db.tables.shares.find((r) => r.token === args.p_token)
      if (s) s.plays++
      return { data: null, error: null }
    },
  }),
}))

const { default: handler, ipPrefix } = await import('../netlify/functions/share.mjs')

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
process.env.SHARE_IP_SALT = 'pepper'

async function call(route: string, body: unknown, o: { method?: string; jwt?: string; ip?: string } = {}) {
  const res = await handler(new Request(`https://site.example/api/share${route}`, {
    method: o.method ?? 'POST',
    headers: { 'Content-Type': 'application/json', 'x-nf-client-connection-ip': o.ip ?? '203.0.113.7', ...(o.jwt ? { Authorization: `Bearer ${o.jwt}` } : {}) },
    body: JSON.stringify(body),
  }))
  return { status: res.status, body: await res.json() }
}

// ---------------- the map: spawn, a wall, a weapon behind it ----------------

/** A wall 1 unit thick at x = 9.5..10.5, from z = -6 to 6, 8 high. */
const WALL = [
  'v 9.5 0 -6', 'v 9.5 8 -6', 'v 9.5 8 6', 'v 9.5 0 6',
  'v 10.5 0 -6', 'v 10.5 8 -6', 'v 10.5 8 6', 'v 10.5 0 6',
  'f 1 2 3', 'f 1 3 4', 'f 5 7 6', 'f 5 8 7', '',
].join('\n')
function doc(title = 'Walled'): ShareDoc {
  const p = newProject(title)
  p.scene_items.push({ uid: 'w', name: 'Wall', path: 'mesh/0', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: {}, alpha: {} })
  p.markers.push({ ...newMarker('Shared spawn', [0, 0, 0]) }, { ...newMarker('Shared spawn', [40, 0, 40]) }, { ...newMarker('Weapon pickup', [20, 0, 0]), weapon: 'ak47' })
  return { format: 'sr1-map-studio-share', version: 1, title, created_at: '2026-10-27T00:00:00Z', project: p, models: { 'mesh/0': cleanObj(WALL)! }, textures: {}, made: { 'mesh/0': 'shape' } }
}
const data = (d = doc()) => toBase64(packShare(d))
const webp = () => toBase64(new Uint8Array([0x52, 0x49, 0x46, 0x46, 40, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, ...new Array(48).fill(1)]))

/** A run along `path` at running speed, sampled every 100 ms. */
function run(path: Vec3[]) {
  const r = new GhostRecorder()
  let t = 0
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1], path[i]]
    const len = Math.hypot(b[0] - a[0], b[2] - a[2])
    for (let d = 0; d < len; d += 0.9, t += 100) r.add(t, [a[0] + ((b[0] - a[0]) * d) / len, 0, a[2] + ((b[2] - a[2]) * d) / len], 0)
  }
  r.finish(t, path[path.length - 1], 0)
  return { ms: t, ghost: r.samples }
}
const straight = () => run([[0.4, 0, 0], [20, 0, 0]])
const around = () => run([[0.4, 0, 0], [0.4, 0, 9], [20, 0, 9], [20, 0, 0]])

beforeEach(() => {
  schema(true)
  db.stored.clear(); db.removed = []; db.plays = []
  db.users = { alice: 'u-alice', bob: 'u-bob', mod: 'u-mod' }
  db.tables.profiles.push({ id: 'u-mod', is_moderator: true }, { id: 'u-alice', is_moderator: false })
  for (const k of ['SHARE_ANON_PER_DAY', 'SHARE_ANON_UPDATES_PER_DAY']) delete process.env[k]
})

describe('the share function', () => {
  it('counts IPv6 addresses by their /64 network', () => {
    expect(ipPrefix('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64')
    expect(ipPrefix('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64')
    expect(ipPrefix('2001:db8::5')).toBe('2001:db8:0:0::/64')
    expect(ipPrefix('::ffff:198.51.100.4')).toBe('198.51.100.4')
    expect(ipPrefix('198.51.100.4')).toBe('198.51.100.4')
    expect(ipPrefix('nonsense')).toBeNull()
  })

  it('makes a link without an account, with an edit key, an expiry and its preview', async () => {
    const r = await call('', { title: 'x', data: data(), thumb: webp() })
    expect(r.status).toBe(200)
    expect(r.body.key).toMatch(/^[\w-]{22}$/)
    const row = db.tables.shares[0]
    expect(row).toMatchObject({ token: r.body.token, anon: true, owner: null })
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row.thumb).toBeTruthy()
    expect(db.stored.has(`${r.body.token}.webp`)).toBe(true)
  })

  it('removes a preview only with the link it belongs to', async () => {
    const a = await call('', { title: 'x', data: data(), thumb: webp() })
    const mine = await call('', { title: 'x', data: data(), thumb: webp() }, { jwt: 'alice' })
    // A wrong key, or someone else's link: nothing goes, picture included.
    expect((await call('', { token: a.body.token, key: 'A'.repeat(22) }, { method: 'DELETE' })).status).toBe(200)
    expect((await call('', { token: mine.body.token }, { method: 'DELETE', jwt: 'bob' })).status).toBe(200)
    expect(db.removed).toEqual([])
    expect(db.tables.shares).toHaveLength(2)
    // The right key, and the owner.
    await call('', { token: a.body.token, key: a.body.key }, { method: 'DELETE' })
    await call('', { token: mine.body.token }, { method: 'DELETE', jwt: 'alice' })
    expect(db.removed.sort()).toEqual([`${a.body.token}.webp`, `${mine.body.token}.webp`].sort())
    expect(db.tables.shares).toHaveLength(0)
  })

  it('counts links made without an account from its log, so removing one gives nothing back', async () => {
    process.env.SHARE_ANON_PER_DAY = '2'
    const first = await call('', { title: 'x', data: data() })
    await call('', { title: 'x', data: data() })
    await call('', { token: first.body.token, key: first.body.key }, { method: 'DELETE' })
    const third = await call('', { title: 'x', data: data() })
    expect(third.status).toBe(429)
    // Another network has its own count; another address in the same /64 doesn't.
    expect((await call('', { title: 'x', data: data() }, { ip: '2001:db8:1:2::1' })).status).toBe(200)
    expect((await call('', { title: 'x', data: data() }, { ip: '2001:db8:1:2::2' })).status).toBe(200)
    expect((await call('', { title: 'x', data: data() }, { ip: '2001:db8:1:2:ffff::9' })).status).toBe(429)
  })

  it('limits updates to links made without an account', async () => {
    process.env.SHARE_ANON_UPDATES_PER_DAY = '2'
    const a = await call('', { title: 'x', data: data() })
    const again = () => call('', { title: 'x', data: data(), token: a.body.token, key: a.body.key })
    expect((await again()).status).toBe(200)
    expect((await again()).status).toBe(200)
    expect((await again()).status).toBe(429)
    expect(SHARE_RULES.anonUpdatesPerDay).toBeGreaterThan(2)
  })

  it('drops a board’s times when the map changes, and keeps them when it doesn’t', async () => {
    const same = data()
    const a = await call('', { title: 'x', data: same }, { jwt: 'alice' })
    expect((await call('/time', { token: a.body.token, mode: 'weapons', name: 'Ace', ...around() })).status).toBe(200)
    await call('', { title: 'x', data: same, token: a.body.token }, { jwt: 'alice' })
    expect(db.tables.share_times).toHaveLength(1)
    await call('', { title: 'x', data: data(doc('Changed')), token: a.body.token }, { jwt: 'alice' })
    expect(db.tables.share_times).toHaveLength(0)
  })

  it('refuses a time whose ghost runs through a wall', async () => {
    const a = await call('', { title: 'x', data: data() }, { jwt: 'alice' })
    const r = await call('/time', { token: a.body.token, mode: 'weapons', name: 'Ghost', ...straight() })
    expect(r.status).toBe(422)
    expect(r.body.problems.join()).toMatch(/through a wall/)
    expect((await call('/time', { token: a.body.token, mode: 'weapons', name: 'Honest', ...around() })).body.rank).toBe(1)
  })

  it('lets only moderators hide a link, which takes its preview down at once and stops updates', async () => {
    const a = await call('', { title: 'x', data: data(), thumb: webp() }, { jwt: 'alice' })
    await call('/report', { token: a.body.token, reason: 'spam', details: '' })
    expect((await call('/hide', { token: a.body.token }, { jwt: 'alice' })).status).toBe(403)
    expect((await call('/hide', { token: a.body.token }, { jwt: 'mod' })).status).toBe(200)
    expect(db.tables.shares[0]).toMatchObject({ hidden: true, listed: false, thumb: null })
    expect(db.removed).toEqual([`${a.body.token}.webp`])
    expect(db.tables.share_reports[0].status).toBe('actioned')
    const up = await call('', { title: 'x', data: data(), thumb: webp(), token: a.body.token }, { jwt: 'alice' })
    expect(up.status).toBe(403)
    expect(db.stored.has(`${a.body.token}.webp`)).toBe(false)
  })

  it('counts a play once per address, link and day', async () => {
    const a = await call('', { title: 'x', data: data() }, { jwt: 'alice' })
    await call('/play', { token: a.body.token })
    await call('/play', { token: a.body.token })
    await call('/play', { token: a.body.token }, { ip: '198.51.100.9' })
    expect(db.plays).toHaveLength(2)
  })

  it('keeps signed-in links working on a database without migration 0004', async () => {
    schema(false)
    const r = await call('', { title: 'x', data: data(), thumb: webp(), listed: true }, { jwt: 'alice' })
    expect(r.status).toBe(200)
    expect(Object.keys(db.tables.shares[0]).every((k) => OLD_SHARES.includes(k) || k === 'id' || k === 'hidden' || k === 'plays')).toBe(true)
    expect(db.stored.size).toBe(0)
    expect((await call('', { title: 'x', data: data(), token: r.body.token }, { jwt: 'alice' })).status).toBe(200)
    expect((await call('', { title: 'x', data: data() })).body.error).toMatch(/aren’t open yet/)
    expect((await call('/report', { token: r.body.token, reason: 'spam' })).status).toBe(503)
    expect((await call('/play', { token: r.body.token })).status).toBe(200)
    expect((await call('', { token: r.body.token }, { method: 'DELETE', jwt: 'alice' })).status).toBe(200)
    expect(db.tables.shares).toHaveLength(0)
  })
})

describe('board times and walls', () => {
  it('sees the wall in the share', () => {
    const walls = wallsOf(doc())!
    expect(walls([0, 2.4, 0], [20, 2.4, 0])).toBe(true)
    expect(walls([0, 2.4, 9], [20, 2.4, 9])).toBe(false)
    expect(checkTime({ mode: 'weapons', name: 'x', ...straight() }, doc().project.markers, walls).join()).toMatch(/through a wall/)
    expect(checkTime({ mode: 'weapons', name: 'x', ...around() }, doc().project.markers, walls)).toEqual([])
  })
  it('allows going back to the run’s own spawn, not jumping to another one', () => {
    const ms = doc().project.markers
    const half = around().ghost.slice(0, 6)
    const t = half[half.length - 1][0] + 100
    const home = around().ghost.map((s) => [s[0] + t, s[1], s[2], s[3], s[4]] as typeof s)
    expect(checkTime({ mode: 'weapons', name: 'x', ghost: [...half, ...home], ms: around().ms + t }, ms)).toEqual([])
    // Jumping to the far spawn (40, 0, 40) and walking from there is not a respawn.
    const far = run([[40, 0, 40], [20, 0, 0]]).ghost.map((s) => [s[0] + t, s[1], s[2], s[3], s[4]] as typeof s)
    expect(checkTime({ mode: 'weapons', name: 'x', ghost: [...half, ...far], ms: far[far.length - 1][0] }, ms).join()).toMatch(/faster than a player/)
  })
})

// ---------------- link previews ----------------

describe('the link preview', () => {
  const PAGE = '<!doctype html><html><head>\n    <title>SR1 Map Studio</title>\n    <meta property="og:title" content="SR1 Map Studio" />\n  </head><body><div id="root"></div></body></html>'
  const TOKEN = 'A'.repeat(22)
  let fetches = 0
  async function preview(title: string, ok = true) {
    vi.resetModules()
    ;(globalThis as any).Netlify = { env: { get: (k: string) => ({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' } as Record<string, string>)[k] } }
    vi.stubGlobal('fetch', async () => { fetches++; return ok ? new Response(JSON.stringify([{ title, modes: ['roam', 'weapons'], players: 2, thumb: null, shot: false }])) : new Response('{}', { status: 400 }) })
    const og = (await import('../netlify/edge-functions/og')).default
    const next = async () => new Response(PAGE, { headers: { 'content-type': 'text/html' } })
    return { og, next }
  }
  beforeEach(() => { fetches = 0 })

  it('puts the map in the head, keeping $-patterns in titles as text', async () => {
    const { og, next } = await preview('Evil $& $` $\' "<b>')
    const html = await (await og(new Request(`https://site.example/play/s/${TOKEN}`), { next })).text()
    expect(html.match(/<div id="root">/g)).toHaveLength(1)
    expect(html).toContain('<title>Evil $&amp; $` $\' &quot;&lt;b&gt; · Play in the browser</title>')
    expect(html).toContain('content="Evil $&amp; $` $\' &quot;&lt;b&gt; · Play in the browser"')
    expect(html).toContain('Weapon run, 2 spawns')
    expect(html.indexOf('og:image')).toBeLessThan(html.indexOf('</head>'))
  })

  it('goes out with the site’s own preview, and stops asking for a while, when the lookup fails', async () => {
    const { og, next } = await preview('x', false)
    const first = await (await og(new Request(`https://site.example/play/s/${TOKEN}`), { next })).text()
    expect(first).toBe(PAGE)
    await og(new Request(`https://site.example/play/s/${TOKEN}`), { next })
    expect(fetches).toBe(1)
  })
})
