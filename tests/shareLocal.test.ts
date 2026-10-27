// The local test server's play links (VITE_BACKEND=local), which mirror the
// share function's rules: anonymous links that expire, rate limits, reports,
// the gallery, ratings and time-trial boards. IndexedDB and localStorage are
// small in-memory stand-ins here.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { newMarker, newProject } from '../src/lib/project'
import { GhostRecorder } from '../src/play/ghost'
import { SHARE_RULES, cleanObj, type ShareDoc } from '../src/play/share'

// ---------------- stand-ins ----------------

class Req<T = unknown> { result!: T; error: unknown = null; onsuccess: ((e?: unknown) => void) | null = null; onerror: ((e?: unknown) => void) | null = null; onupgradeneeded: ((e?: unknown) => void) | null = null }
const ok = <T,>(r: Req<T>, v: T) => { r.result = v; queueMicrotask(() => r.onsuccess?.()) }
const inRange = (k: string, range?: { lower: string; upper: string }) => !range || (k >= range.lower && k <= range.upper)
class Store {
  constructor(private data: Map<string, unknown>) {}
  get(k: string) { const r = new Req(); ok(r, this.data.get(k)); return r }
  put(v: unknown, k: string) { this.data.set(k, v); const r = new Req(); ok(r, k); return r }
  delete(k: string | { lower: string; upper: string }) {
    if (typeof k === 'string') this.data.delete(k); else for (const key of [...this.data.keys()]) if (inRange(key, k)) this.data.delete(key)
    const r = new Req(); ok(r, undefined); return r
  }
  getAll() { const r = new Req(); ok(r, [...this.data.values()]); return r }
  getAllKeys(range?: { lower: string; upper: string }) { const r = new Req(); ok(r, [...this.data.keys()].filter((k) => inRange(k, range))); return r }
}
class Db {
  stores = new Map<string, Map<string, unknown>>()
  objectStoreNames = { contains: (n: string) => this.stores.has(n) }
  createObjectStore(n: string) { this.stores.set(n, new Map()) }
  transaction(n: string) { return { objectStore: () => new Store(this.stores.get(n)!) } }
}
const dbs = new Map<string, { version: number; db: Db }>()
const indexedDB = {
  open(name: string, version = 1) {
    const r = new Req<Db>()
    setTimeout(() => {
      let e = dbs.get(name)
      if (!e) { e = { version: 0, db: new Db() }; dbs.set(name, e) }
      r.result = e.db
      if (version > e.version) { e.version = version; r.onupgradeneeded?.() }
      r.onsuccess?.()
    })
    return r
  },
}
const mem = new Map<string, string>()
const localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k) }
Object.assign(globalThis, { indexedDB, localStorage, IDBKeyRange: { bound: (lower: string, upper: string) => ({ lower, upper }) }, location: { origin: 'http://localhost' } })

// ---------------- the map ----------------

const OBJ = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'
function doc(title = 'Local test', made: 'shape' | 'import' = 'shape'): ShareDoc {
  const p = newProject(title)
  p.scene_items.push({ uid: 'a', name: 'Floor', path: 'mesh/0', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: {}, alpha: {} })
  p.markers.push({ ...newMarker('Shared spawn', [0, 0, 0]) }, { ...newMarker('Weapon pickup', [20, 0, 0]), weapon: 'ak47' })
  return { format: 'sr1-map-studio-share', version: 1, title, created_at: '2026-10-27T00:00:00Z', project: p, models: { 'mesh/0': cleanObj(OBJ)! }, textures: {}, made: { 'mesh/0': made } }
}
/** A RIFF/WEBP header, enough for the thumbnail checks. */
const webp = () => new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46, 40, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, ...new Array(32).fill(1)])], { type: 'image/webp' })

let api: typeof import('../src/play/shareApi')
let backend: import('../src/lib/backend').Backend

beforeAll(async () => {
  vi.stubEnv('VITE_BACKEND', 'local')
  vi.stubEnv('VITE_SUPABASE_URL', '')
  api = await import('../src/play/shareApi')
  backend = (await (await import('../src/lib/backend')).getBackend())!
  await backend.signInWithEmail('mod@example.com') // the first local account is a moderator
})
beforeEach(async () => { dbs.delete('sr1-local-shares'); mem.delete('sr1-play-links'); await backend.signOut() })

const signIn = (who: string) => backend.signInWithEmail(`${who}@example.com`)

describe('local play links', () => {
  it('runs against the local server', () => {
    expect(api.hostedShares).toBe(true)
    expect(backend.kind).toBe('local')
  })

  it('makes links without an account that expire after 30 days, kept with their key', async () => {
    const before = Date.now()
    const { token, expires_at } = await api.createShare(doc(), 'p1')
    expect(new Date(expires_at!).getTime() - before).toBeGreaterThan((SHARE_RULES.anonDays - 0.01) * 86400_000)
    expect(api.myShares()[0]).toMatchObject({ token, project_id: 'p1' })
    expect(api.myShares()[0].key).toMatch(/^[\w-]{22}$/)
    expect((await api.fetchShare(token)).title).toBe('Local test')
    // Updating keeps the link and its date.
    const again = await api.createShare(doc('Renamed'), 'p1', { token })
    expect(again).toEqual({ token, expires_at })
    expect((await api.fetchShare(token)).title).toBe('Renamed')
  })

  it('stops opening a link once it expires, and the daily clean-up removes it', async () => {
    const { token } = await api.createShare(doc(), 'p1')
    const db = dbs.get('sr1-local-shares')!.db.stores.get('shares')!
    db.set(token, { ...(db.get(token) as object), expires_at: new Date(Date.now() - 1000).toISOString() })
    await expect(api.fetchShare(token)).rejects.toThrow(/expired/)
    expect(db.has(token)).toBe(false)
  })

  it('limits links made without an account per address, and keeps signed-in links for good', async () => {
    for (let i = 0; i < SHARE_RULES.anonPerDay; i++) await api.createShare(doc(), 'p' + i)
    await expect(api.createShare(doc(), 'px')).rejects.toThrow(/a day/)
    await signIn('maker')
    const mine = await api.createShare(doc(), 'p1')
    expect(mine.expires_at).toBeUndefined()
  })

  it('removes an anonymous link with its key only', async () => {
    const { token } = await api.createShare(doc(), 'p1')
    const key = api.myShares()[0].key!
    mem.set('sr1-play-links', JSON.stringify([{ token, title: 'x', created_at: '', project_id: 'p1', key: 'A'.repeat(22) }]))
    await api.deleteShare(token)
    expect((await api.fetchShare(token)).title).toBe('Local test') // wrong key: still there
    mem.set('sr1-play-links', JSON.stringify([{ token, title: 'x', created_at: '', project_id: 'p1', key }]))
    await api.deleteShare(token)
    await expect(api.fetchShare(token)).rejects.toThrow(/doesn’t lead to a map/)
  })

  it('lists only signed-in links whose models were all made on the site', async () => {
    await expect(api.createShare(doc(), 'p1', { listed: true })).rejects.toThrow(/Sign in/)
    await signIn('builder')
    await expect(api.createShare(doc('Imported', 'import'), 'p1', { listed: true })).rejects.toThrow(/shapes and prefabs/)
    const { token } = await api.createShare(doc('Shapes only'), 'p2', { listed: true, thumb: webp(), shot: true })
    await api.createShare(doc('Unlisted'), 'p3')
    const g = await api.listGallery({ sort: 'new', page: 1, pageSize: 10 })
    expect(g.items.map((i) => i.title)).toEqual(['Shapes only'])
    expect(g.items[0]).toMatchObject({ token, shot: true, author: { name: 'builder' }, modes: ['roam', 'weapons'], players: 1 })
    expect(g.items[0].thumbnail_url).toMatch(/^blob:/)
    expect((await api.listGallery({ search: 'nothing', sort: 'new', page: 1, pageSize: 10 })).total).toBe(0)
  })

  it('rates other people’s gallery maps, not your own', async () => {
    await signIn('author')
    const { token } = await api.createShare(doc('Rate me'), 'p1', { listed: true })
    await expect(api.rateShare(token, 5)).rejects.toThrow(/own map/)
    await signIn('fan')
    await api.rateShare(token, 4)
    await api.rateShare(token, 2)
    let item = (await api.listGallery({ sort: 'top', page: 1, pageSize: 10 })).items[0]
    expect(item).toMatchObject({ rating: 2, ratings: 1, my_rating: 2 })
    await api.rateShare(token, 0)
    item = (await api.listGallery({ sort: 'top', page: 1, pageSize: 10 })).items[0]
    expect(item).toMatchObject({ rating: 0, ratings: 0, my_rating: 0 })
  })

  it('takes reports from anyone, once, and lets a moderator hide the link', async () => {
    await signIn('mod')
    const mod = (await backend.getUser())!
    expect(mod.is_moderator).toBe(true)
    await backend.signOut()
    const { token } = await api.createShare(doc('Reported'), 'p1')
    await api.reportShare(token, 'offensive', 'Rude words')
    await expect(api.reportShare(token, 'spam', '')).rejects.toThrow(/already reported/)
    await signIn('someone')
    await expect(api.resolveShareReport({ id: 'x', token } as never, 'hide')).rejects.toThrow(/moderators/)
    await signIn('mod')
    const open = await api.listShareReports()
    const r = open.find((x) => x.token === token)!
    expect(r).toMatchObject({ title: 'Reported', reason: 'offensive', details: 'Rude words', reporter: 'Someone without an account' })
    await api.resolveShareReport(r, 'hide')
    expect((await api.listShareReports()).some((x) => x.token === token)).toBe(false)
    await expect(api.fetchShare(token)).rejects.toThrow(/doesn’t lead to a map/)
  })

  it('posts checked times to a link’s board, best first, with their ghosts', async () => {
    const { token } = await api.createShare(doc('Race'), 'p1')
    const ghost = (speed: number) => {
      const r = new GhostRecorder()
      let t = 0
      for (let x = 0.4; x < 20; x += speed * 0.1, t += 100) r.add(t, [x, 0, 0], 0)
      r.finish(t, [20, 0, 0], 0)
      return { ms: t, ghost: r.samples }
    }
    const slow = ghost(8), quick = ghost(9)
    expect(await api.submitTime(token, { mode: 'weapons', name: 'Slow', ...slow })).toBe(1)
    expect(await api.submitTime(token, { mode: 'weapons', name: ' Quick ', ...quick })).toBe(1)
    await expect(api.submitTime(token, { mode: 'weapons', name: 'Cheat', ms: 1000, ghost: quick.ghost })).rejects.toThrow(/can’t go on the board/)
    const board = await api.getBoard(token, 'weapons')
    expect(board.map((b) => b.name)).toEqual(['Quick', 'Slow'])
    expect(await api.getGhost(token, board[0].id)).toEqual(quick.ghost)
    expect(await api.getBoard(token, 'dropoffs')).toEqual([])
  })

  it('counts a play once per address, link and day', async () => {
    await signIn('player')
    const { token } = await api.createShare(doc('Played'), 'p1', { listed: true })
    await api.recordPlay(token)
    await api.recordPlay(token)
    expect((await api.listGallery({ sort: 'played', page: 1, pageSize: 10 })).items[0].plays).toBe(1)
  })

  it('keeps counting anonymous links after one is removed', async () => {
    for (let i = 0; i < SHARE_RULES.anonPerDay; i++) await api.createShare(doc(), 'p' + i)
    await api.deleteShare(api.myShares()[0].token)
    await expect(api.createShare(doc(), 'px')).rejects.toThrow(/a day/)
  })

  it('refuses to update a hidden link, and hiding drops its preview', async () => {
    await signIn('owner')
    const { token } = await api.createShare(doc('Hide me'), 'p1', { listed: true, thumb: webp() })
    await api.reportShare(token, 'spam', '')
    await signIn('mod')
    await api.resolveShareReport((await api.listShareReports()).find((r) => r.token === token)!, 'hide')
    const row = dbs.get('sr1-local-shares')!.db.stores.get('shares')!.get(token) as { thumb: unknown; listed: boolean }
    expect(row).toMatchObject({ thumb: null, listed: false })
    await signIn('owner')
    await expect(api.createShare(doc('Hide me'), 'p1', { token, thumb: webp() })).rejects.toThrow(/moderator hid/)
  })

  it('drops a board’s times when the map changes', async () => {
    const { token } = await api.createShare(doc('Race'), 'p1')
    const r = new GhostRecorder()
    let t = 0
    for (let x = 0.4; x < 20; x += 0.9, t += 100) r.add(t, [x, 0, 0], 0)
    r.finish(t, [20, 0, 0], 0)
    await api.submitTime(token, { mode: 'weapons', name: 'A', ms: t, ghost: r.samples })
    await api.createShare(doc('Race, changed'), 'p1', { token })
    expect(await api.getBoard(token, 'weapons')).toEqual([])
  })
})
