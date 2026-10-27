// My prefabs following the account: two devices against the local test server
// (lib/backend/local.ts on a fake IndexedDB), each with its own pieces and file store.
import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { LocalBackend } from '../src/lib/backend/local'
import { LIBRARY_PROJECT_ID, type Backend } from '../src/lib/backend'
import { deletePiece, mergePrefabs, renamePiece, syncMyPrefabsWith, type PrefabDevice, type PrefabState, type SyncedPrefab } from '../src/lib/sync'
import type { FileRef, SceneItem } from '../src/lib/project'

beforeAll(() => {
  // The local server keeps its session in localStorage.
  const m = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k) },
  })
})

class Device implements PrefabDevice {
  state: PrefabState = { pieces: [], deleted: [] }
  blobs = new Map<string, Blob>()
  aside = new Map<string, PrefabState>()
  read() { return structuredClone(this.state) }
  write(s: PrefabState) { this.state = structuredClone(s) }
  takeAside(owner: string) { const s = this.aside.get(owner); this.aside.delete(owner); return s }
  setAside(s: PrefabState & { owner: string }) { this.aside.set(s.owner, structuredClone(s)) }
  async hasBlob(h: string) { return this.blobs.has(h) }
  async getBlob(h: string) { return this.blobs.get(h) }
  async putBlob(h: string, b: Blob) { this.blobs.set(h, b) }
}

const ref = (hash: string, origin: FileRef['origin'], name = hash + '.obj'): FileRef => ({ hash, size: 4, name, type: 'model/obj', origin })
const item = (path: string) => ({ uid: 'it-' + path, path, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], textures: {} }) as unknown as SceneItem
const piece = (id: string, saved: string, files: Record<string, FileRef>, name = id): SyncedPrefab => ({
  id, name, saved, bundle: { items: Object.keys(files).map(item), files },
})

let n = 0
/** A fresh account on the shared test server, signed in. */
async function account() {
  const b = new LocalBackend()
  await b.signInWithEmail(`tester${++n}@example.com`)
  return b
}

describe('My prefabs sync', () => {
  it('a piece saved on device A appears on device B with its files', async () => {
    const b = await account()
    const A = new Device(), B = new Device()
    A.blobs.set('h-crate', new Blob(['crate']))
    A.state.pieces.push(piece('p1', '2026-10-01T00:00:00.000Z', { '/user/crate.obj': ref('h-crate', 'user') }, 'Crate stack'))

    await syncMyPrefabsWith(b, A)
    const res = await syncMyPrefabsWith(b, B)

    expect(B.state.pieces.map((p) => p.name)).toEqual(['Crate stack'])
    expect(await B.blobs.get('h-crate')?.text()).toBe('crate')
    expect(res).toEqual({ pieces: 1, missingGameFiles: [] })
  })

  it('a deletion on one device removes the piece on the other', async () => {
    const b = await account()
    const A = new Device(), B = new Device()
    A.state.pieces.push(piece('p1', '2026-10-01T00:00:00.000Z', {}), piece('p2', '2026-10-01T00:00:00.000Z', {}))
    await syncMyPrefabsWith(b, A)
    await syncMyPrefabsWith(b, B)
    expect(B.state.pieces).toHaveLength(2)

    A.state.pieces = A.state.pieces.filter((p) => p.id !== 'p1')
    A.state.deleted.push({ id: 'p1', deleted: '2026-10-02T00:00:00.000Z' })
    await syncMyPrefabsWith(b, A)
    // B still has p1 locally; syncing must not bring it back.
    await syncMyPrefabsWith(b, B)
    await syncMyPrefabsWith(b, A)

    expect(B.state.pieces.map((p) => p.id)).toEqual(['p2'])
    expect(A.state.pieces.map((p) => p.id)).toEqual(['p2'])
    expect(B.state.deleted.map((d) => d.id)).toEqual(['p1'])
  })

  it('conflicting edits: the newest save wins on both devices', async () => {
    const b = await account()
    const A = new Device(), B = new Device()
    A.state.pieces.push(piece('p1', '2026-10-01T00:00:00.000Z', {}, 'Wall'))
    await syncMyPrefabsWith(b, A)
    await syncMyPrefabsWith(b, B)

    // Both rename while apart; B's rename is later.
    A.state.pieces[0] = { ...A.state.pieces[0], name: 'Wall A', saved: '2026-10-03T00:00:00.000Z' }
    B.state.pieces[0] = { ...B.state.pieces[0], name: 'Wall B', saved: '2026-10-04T00:00:00.000Z' }
    await syncMyPrefabsWith(b, B)
    await syncMyPrefabsWith(b, A)
    await syncMyPrefabsWith(b, B)

    expect(A.state.pieces.map((p) => p.name)).toEqual(['Wall B'])
    expect(B.state.pieces.map((p) => p.name)).toEqual(['Wall B'])
  })

  it('a save racing another device merges instead of overwriting', async () => {
    const b = await account()
    const A = new Device(), B = new Device()
    A.state.pieces.push(piece('pa', '2026-10-01T00:00:00.000Z', {}))
    B.state.pieces.push(piece('pb', '2026-10-01T00:00:00.000Z', {}))
    await syncMyPrefabsWith(b, A)

    // B saves between A reading the cloud copy and A writing it.
    let raced = false
    const racing: Backend = Object.create(b)
    racing.putCloudProject = async (...args) => {
      if (!raced) { raced = true; await syncMyPrefabsWith(b, B) }
      return b.putCloudProject(...args)
    }
    A.state.pieces.push(piece('pa2', '2026-10-02T00:00:00.000Z', {}))
    await syncMyPrefabsWith(racing, A)
    expect(raced).toBe(true)
    // A was refused, merged B's piece and sent again.
    const cloud = (await b.getCloudProject(LIBRARY_PROJECT_ID))!.project as unknown as { my_prefabs: PrefabState }
    expect(cloud.my_prefabs.pieces.map((p) => p.id).sort()).toEqual(['pa', 'pa2', 'pb'])
    await syncMyPrefabsWith(b, B)

    expect(A.state.pieces.map((p) => p.id).sort()).toEqual(['pa', 'pa2', 'pb'])
    expect(B.state.pieces.map((p) => p.id).sort()).toEqual(['pa', 'pa2', 'pb'])
  })

  it('never uploads game files: only their record goes, and the other device reports them missing', async () => {
    const b = await account()
    const A = new Device(), B = new Device()
    A.blobs.set('h-user', new Blob(['mine']))
    A.blobs.set('h-game', new Blob(['saints row data']))
    A.state.pieces.push(piece('p1', '2026-10-01T00:00:00.000Z', {
      '/user/mine.obj': ref('h-user', 'user'),
      '/game/sr_crate.peg': ref('h-game', 'game', 'sr_crate.peg'),
    }))
    const uploaded: string[] = []
    const watched: Backend = Object.create(b)
    watched.uploadBlob = async (hash, blob) => { uploaded.push(hash); return b.uploadBlob(hash, blob) }

    await syncMyPrefabsWith(watched, A)
    const res = await syncMyPrefabsWith(b, B)

    expect(uploaded).toEqual(['h-user'])
    expect([...(await b.hasBlobs(['h-user', 'h-game']))]).toEqual(['h-user'])
    expect(B.blobs.has('h-game')).toBe(false)
    expect(B.state.pieces[0].bundle.files['/game/sr_crate.peg']).toMatchObject({ hash: 'h-game', origin: 'game' })
    expect(res.missingGameFiles).toEqual(['sr_crate.peg'])
  })

  it('keeps the library out of the cloud save lists, and creates none without pieces', async () => {
    const b = await account()
    await syncMyPrefabsWith(b, new Device())
    expect(await b.getCloudProject(LIBRARY_PROJECT_ID)).toBeNull()

    const A = new Device()
    A.state.pieces.push(piece('p1', '2026-10-01T00:00:00.000Z', {}))
    await syncMyPrefabsWith(b, A)
    expect(await b.getCloudProject(LIBRARY_PROJECT_ID)).not.toBeNull()
    expect((await b.listCloudProjects()).map((p) => p.id)).not.toContain(LIBRARY_PROJECT_ID)
  })

  it('another account signing in on the same device sets the first account’s pieces aside', async () => {
    const b = new LocalBackend()
    const D = new Device()
    await b.signInWithEmail('switch-a@example.com')
    D.blobs.set('h-a', new Blob(['a']))
    D.state.pieces.push(piece('pa', '2026-10-01T00:00:00.000Z', { '/user/a.obj': ref('h-a', 'user') }, 'A piece'))
    await syncMyPrefabsWith(b, D)
    await b.signOut()
    // Signed out, the pieces still work and new ones can be saved.
    expect(D.state.pieces.map((p) => p.id)).toEqual(['pa'])
    D.state.pieces.push(piece('pa-offline', '2026-10-02T00:00:00.000Z', {}))

    await b.signInWithEmail('switch-b@example.com')
    const uploaded: string[] = []
    const watched: Backend = Object.create(b)
    watched.uploadBlob = async (hash, blob) => { uploaded.push(hash); return b.uploadBlob(hash, blob) }
    await syncMyPrefabsWith(watched, D)
    expect(D.state.pieces).toEqual([])
    expect(await b.getCloudProject(LIBRARY_PROJECT_ID)).toBeNull()
    expect(uploaded).toEqual([])

    D.state.pieces.push(piece('pb', '2026-10-03T00:00:00.000Z', {}, 'B piece'))
    await syncMyPrefabsWith(b, D)
    await b.signOut()
    await b.signInWithEmail('switch-a@example.com')
    await syncMyPrefabsWith(b, D)

    expect(D.state.pieces.map((p) => p.id)).toEqual(['pa', 'pa-offline'])
    const cloudA = (await b.getCloudProject(LIBRARY_PROJECT_ID))!.project as unknown as { my_prefabs: PrefabState }
    expect(cloudA.my_prefabs.pieces.map((p) => p.id)).toEqual(['pa', 'pa-offline'])
    expect(D.aside.get((await b.getUser())!.id)).toBeUndefined()
    expect([...D.aside.values()].map((s) => s.pieces.map((p) => p.id))).toEqual([['pb']])
  })

  it('a deletion or rename still wins when the device that saved the piece has a clock 10 minutes fast', async () => {
    const b = await account()
    const A = new Device(), B = new Device()
    const fast = new Date(Date.now() + 10 * 60_000).toISOString()
    B.state.pieces.push(piece('gone', fast, {}), piece('renamed', fast, {}, 'Old name'))
    await syncMyPrefabsWith(b, B)
    await syncMyPrefabsWith(b, A)

    A.state = renamePiece(deletePiece(A.state, 'gone'), 'renamed', 'New name')
    await syncMyPrefabsWith(b, A)
    await syncMyPrefabsWith(b, B)

    expect(B.state.pieces.map((p) => [p.id, p.name])).toEqual([['renamed', 'New name']])
    expect(A.state.pieces.map((p) => [p.id, p.name])).toEqual([['renamed', 'New name']])
  })

  it('each account has its own library', async () => {
    const b1 = await account()
    const A = new Device()
    A.state.pieces.push(piece('p1', '2026-10-01T00:00:00.000Z', {}))
    await syncMyPrefabsWith(b1, A)
    const b2 = await account()
    const B = new Device()
    await syncMyPrefabsWith(b2, B)
    expect(B.state.pieces).toEqual([])
  })
})

describe('mergePrefabs', () => {
  const t = (d: number) => `2026-10-0${d}T00:00:00.000Z`
  it('a deletion beats saves before it but not after', () => {
    const merged = mergePrefabs(
      { pieces: [piece('old', t(1), {}), piece('new', t(3), {})], deleted: [] },
      { pieces: [], deleted: [{ id: 'old', deleted: t(2) }, { id: 'new', deleted: t(2) }] },
    )
    expect(merged.pieces.map((p) => p.id)).toEqual(['new'])
    expect(merged.deleted).toEqual([{ id: 'old', deleted: t(2) }])
  })
  it('keeps the first copy order and is the same either way round', () => {
    const a = { pieces: [piece('x', t(1), {}), piece('y', t(1), {})], deleted: [] }
    const b = { pieces: [piece('z', t(1), {}), piece('x', t(2), {}, 'X2')], deleted: [] }
    expect(mergePrefabs(a, b).pieces.map((p) => p.name)).toEqual(['X2', 'y', 'z'])
    expect(new Set(mergePrefabs(b, a).pieces.map((p) => p.name))).toEqual(new Set(['X2', 'y', 'z']))
  })
})
