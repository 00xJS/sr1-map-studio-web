import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LIMITS, MB, checkPublishFiles, checkPublishMeta, fileKind, gameSignature, hubSnapshot, isValidThumbnail,
  limitsFromEnv, normalizeTags, preparePublish, projectUploadPlan, type PublishFile,
} from '../src/lib/hubRules'
import { newProject, type FileRef, type Project, type SceneItem } from '../src/lib/project'

const enc = new TextEncoder()
const bin = (bytes: number[], pad = 64) => { const a = new Uint8Array(Math.max(pad, bytes.length)); a.set(bytes); return a }
const file = (name: string, head: Uint8Array, size = head.length): PublishFile => ({ name, size, type: '', head })
const text = (name: string, s: string, size?: number) => file(name, enc.encode(s), size ?? enc.encode(s).length)

const PNG = bin([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
const OBJ = '# exported\nmtllib crate.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'

describe('game data is rejected', () => {
  const cases: [string, number[]][] = [
    ['BBChunk', [0xbb, 0xca, 0xca, 0x12]],
    ['PEG texture package', [0x56, 0x4b, 0x45, 0x47]],
    ['BBCity', [0xbb, 0xc1, 0x7e, 0xee]],
    ['PVSV', [0xbb, 0xda, 0xdd, 0x10]],
    ['VPP packfile', [0x51, 0x89, 0x0a, 0xce]],
  ]
  for (const [name, magic] of cases) {
    it(name, () => {
      expect(gameSignature(bin(magic), 'innocent.png')).toBe(name)
      const problems = checkPublishFiles([file('innocent.png', bin(magic), 1000)])
      expect(problems).toHaveLength(1)
      expect(problems[0]).toMatch(/game data/)
    })
  }

  it('CTS gameplay tables by content', () => {
    const cts = '// ----------\n#Navpoints\n+Chunk: sr_mp_lobby\n  $Name: "x"\n'
    expect(gameSignature(enc.encode(cts), 'notes.mtl', cts)).toBe('CTS gameplay table')
    expect(checkPublishFiles([text('notes.mtl', cts)])[0]).toMatch(/CTS gameplay table/)
  })

  it('game file extensions', () => {
    for (const n of ['level.cts', 'mp_lobby.chunk_xbox2', 'textures.peg_xbox2', 'sr1.vpp_xbox2', 'items.xtbl']) {
      expect(checkPublishFiles([text(n, 'hello world')])[0]).toMatch(/game data/)
    }
  })
})

describe('allowed files pass', () => {
  it('PNG and OBJ/MTL', () => {
    expect(checkPublishFiles([file('wall.png', PNG, 2048), text('crate.obj', OBJ), text('crate.mtl', 'newmtl wood\nmap_Kd wood.png\n')])).toEqual([])
    expect(fileKind({ name: 'wall.png', head: PNG })).toBe('png')
    expect(fileKind({ name: 'crate.obj', head: enc.encode(OBJ) })).toBe('obj')
  })

  it('other image formats by magic number', () => {
    expect(fileKind({ name: 'a.jpg', head: bin([0xff, 0xd8, 0xff, 0xe0]) })).toBe('jpeg')
    expect(fileKind({ name: 'a.gif', head: bin([...enc.encode('GIF89a')]) })).toBe('gif')
    expect(fileKind({ name: 'a.webp', head: bin([...enc.encode('RIFF'), 0, 0, 0, 0, ...enc.encode('WEBP')]) })).toBe('webp')
    expect(fileKind({ name: 'a.dds', head: bin([...enc.encode('DDS ')]) })).toBe('dds')
    expect(fileKind({ name: 'a.tif', head: bin([0x49, 0x49, 0x2a, 0x00]) })).toBe('tiff')
    expect(fileKind({ name: 'a.bmp', head: bin([0x42, 0x4d, 0, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0, 40, 0, 0, 0]) })).toBe('bmp')
  })

  it('TGA needs the extension and a plausible header', () => {
    const tga = bin([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 0, 64, 0, 32, 8])
    expect(fileKind({ name: 'grass.tga', head: tga })).toBe('tga')
    expect(fileKind({ name: 'grass.dat', head: tga })).toBeNull()
    expect(fileKind({ name: 'grass.tga', head: bin([0, 0, 77, 0]) })).toBeNull()
  })

  it('unknown kinds are rejected', () => {
    expect(checkPublishFiles([text('script.js', 'alert(1)')])[0]).toMatch(/supported file type/)
    expect(checkPublishFiles([file('model.obj', bin([1, 2, 3, 0, 0, 5]), 100)])[0]).toMatch(/supported file type/)
    expect(checkPublishFiles([file('x.png', new Uint8Array(0), 0)])[0]).toMatch(/empty/)
  })
})

describe('size caps', () => {
  it('per file', () => {
    const p = checkPublishFiles([file('big.png', PNG, 26 * MB)])
    expect(p).toHaveLength(1)
    expect(p[0]).toMatch(/limit per file/)
  })
  it('per map', () => {
    const files = [1, 2, 3].map((i) => file(`t${i}.png`, PNG, 24 * MB))
    expect(checkPublishFiles(files)).toEqual([expect.stringMatching(/limit per map/)])
  })
  it('env override', () => {
    expect(limitsFromEnv(undefined)).toEqual(DEFAULT_LIMITS)
    expect(limitsFromEnv('abc')).toEqual(DEFAULT_LIMITS)
    expect(limitsFromEnv('100')).toEqual({ maxMapBytes: 100 * MB, maxFileBytes: 25 * MB })
    expect(limitsFromEnv('10')).toEqual({ maxMapBytes: 10 * MB, maxFileBytes: 10 * MB })
    expect(checkPublishFiles([file('a.png', PNG, 11 * MB)], limitsFromEnv('10')).length).toBeGreaterThan(0)
  })
})

describe('meta', () => {
  const ok = { title: 'Rooftop Brawl', description: 'Fight on the roofs.', tags: ['deathmatch', 'City', 'night-time'] }
  it('accepts a normal map', () => expect(checkPublishMeta(ok)).toEqual([]))
  it('title length', () => {
    expect(checkPublishMeta({ ...ok, title: 'ab' })).toHaveLength(1)
    expect(checkPublishMeta({ ...ok, title: '   abc  ' })).toEqual([])
    expect(checkPublishMeta({ ...ok, title: 'x'.repeat(81) })).toHaveLength(1)
    expect(checkPublishMeta({ ...ok, title: 42 })).toHaveLength(1)
  })
  it('description length', () => {
    expect(checkPublishMeta({ ...ok, description: 'x'.repeat(4000) })).toEqual([])
    expect(checkPublishMeta({ ...ok, description: 'x'.repeat(4001) })).toHaveLength(1)
  })
  it('tags', () => {
    expect(checkPublishMeta({ ...ok, tags: Array.from({ length: 9 }, (_, i) => 'tag' + i) })).toHaveLength(1)
    expect(checkPublishMeta({ ...ok, tags: ['a'] })).toHaveLength(1)
    expect(checkPublishMeta({ ...ok, tags: ['no spaces!'] })).toHaveLength(1)
    expect(checkPublishMeta({ ...ok, tags: ['x'.repeat(25)] })).toHaveLength(1)
    expect(checkPublishMeta({ ...ok, tags: 'deathmatch' })).toHaveLength(1)
    expect(normalizeTags('Deathmatch, city  #night deathmatch')).toEqual(['deathmatch', 'city', 'night'])
  })
})

const H = (c: string) => c.repeat(64)
const ref = (hash: string, name: string, origin: FileRef['origin'] = 'user', size = 100): FileRef => ({ hash, size, name, type: '', origin })
const item = (name: string, path: string, textures: Record<string, string> = {}): SceneItem => ({
  uid: name, name, path, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures, alpha: {},
})

function project(): Project {
  const p = newProject('Test')
  p.files['/work/f/a/crate.obj'] = ref(H('a'), 'crate.obj')
  p.files['/work/f/b/wood.png'] = ref(H('b'), 'wood.png')
  p.files['/work/f/c/crate.mtl'] = ref(H('c'), 'crate.mtl')
  p.scene_items.push(item('Crate', '/work/f/a/crate.obj', { wood: '/work/f/b/wood.png' }))
  p.scene_items.push(item('Lamp', '/studio/props/lamp.obj', { metal: '/studio/textures/metal.png' }))
  return p
}

describe('projectUploadPlan', () => {
  it('user files are uploadable, data-pack paths are fine', () => {
    const plan = projectUploadPlan(project())
    expect(plan.blockers).toEqual([])
    expect(plan.upload.map((f) => f.ref.name).sort()).toEqual(['crate.mtl', 'crate.obj', 'wood.png'])
    expect(plan.hashes).toHaveLength(3)
    expect(plan.bytes).toBe(300)
  })

  it('game files referenced by settings block publishing and are never uploaded', () => {
    const p = project()
    p.files['/work/f/d/sr_mp_lobby.cts'] = ref(H('d'), 'sr_mp_lobby.cts', 'game')
    p.files['/work/f/e/donor.bbcity'] = ref(H('e'), 'donor.bbcity', 'game')
    p.settings.cts_template = '/work/f/d/sr_mp_lobby.cts'
    p.settings.bbcity_donor = '/work/f/e/donor.bbcity'
    const plan = projectUploadPlan(p)
    expect(plan.upload.some((f) => f.ref.origin === 'game')).toBe(false)
    expect(plan.local).toHaveLength(2)
    expect(plan.blockers).toHaveLength(2)
    expect(plan.blockers.join('\n')).toMatch(/CTS template \(map settings\).*sr_mp_lobby\.cts/)
    expect(plan.blockers.join('\n')).toMatch(/BBCity donor/)
  })

  it('game textures on objects name the object and the file', () => {
    const p = project()
    p.files['/work/f/f/brick.png'] = ref(H('f'), 'brick.png', 'game')
    p.scene_items[0].textures.wall = '/work/f/f/brick.png'
    const [b] = projectUploadPlan(p).blockers
    expect(b).toMatch(/Object "Crate" uses a file/)
    expect(b).toMatch(/brick\.png/)
  })

  it('many game files on one object become one blocker', () => {
    const p = project()
    for (let i = 0; i < 40; i++) {
      p.files[`/work/f/t${i}/t${i}.png`] = ref(H(String(i % 10)), `t${i}.png`, 'game')
      p.scene_items[0].textures[`m${i}`] = `/work/f/t${i}/t${i}.png`
    }
    const blockers = projectUploadPlan(p).blockers
    expect(blockers).toHaveLength(1)
    expect(blockers[0]).toMatch(/Object "Crate" uses 40 files .*t0\.png, t1\.png, t2\.png and 37 more/)
  })

  it('unreferenced game files do not block but are stripped from the snapshot', () => {
    const p = project()
    p.files['/work/f/g/old.cts'] = ref(H('9'), 'old.cts', 'game')
    expect(projectUploadPlan(p).blockers).toEqual([])
    expect(Object.values(hubSnapshot(p).files).every((f) => f.origin === 'user')).toBe(true)
    expect(Object.keys(hubSnapshot(p).files)).toHaveLength(3)
  })

  it('missing files block publishing', () => {
    const p = project()
    p.scene_items.push(item('Ghost', '/work/f/z/ghost.obj'))
    expect(projectUploadPlan(p).blockers[0]).toMatch(/Object "Ghost".*missing/)
  })
})

describe('preparePublish', () => {
  const heads: Record<string, Uint8Array> = { [H('a')]: enc.encode(OBJ), [H('b')]: PNG, [H('c')]: enc.encode('newmtl wood\n') }
  const read = async (hash: string) => heads[hash] ? { size: heads[hash].length, head: heads[hash] } : null
  const meta = { title: 'Crates', description: '', tags: ['Test'] }

  it('passes a clean project and reports real sizes', async () => {
    const r = await preparePublish(project(), meta, read)
    expect(r.problems).toEqual([])
    expect(r.meta.tags).toEqual(['test'])
    expect(r.manifest).toHaveLength(3)
    expect(r.snapshot.files['/work/f/b/wood.png'].size).toBe(PNG.length)
  })

  it('catches files that are game data on the server even if marked as user files', async () => {
    const r = await preparePublish(project(), meta, async (h) => h === H('b') ? { size: 500, head: bin([0x56, 0x4b, 0x45, 0x47]) } : read(h))
    expect(r.problems).toEqual([expect.stringMatching(/wood\.png is Saints Row game data/)])
  })

  it('reports files that were never uploaded and invalid projects', async () => {
    const r = await preparePublish(project(), meta, async (h) => h === H('c') ? null : read(h))
    expect(r.problems[0]).toMatch(/crate\.mtl hasn't been uploaded/)
    expect((await preparePublish({ nope: 1 }, meta, read)).problems).toEqual([expect.stringMatching(/not a valid/)])
  })
})

describe('thumbnails', () => {
  it('only small PNG/JPEG/WebP images', () => {
    expect(isValidThumbnail(5000, PNG)).toBe(true)
    expect(isValidThumbnail(3 * MB, PNG)).toBe(false)
    expect(isValidThumbnail(5000, bin([0x56, 0x4b, 0x45, 0x47]))).toBe(false)
    expect(isValidThumbnail(5000, enc.encode('<html><script>'))).toBe(false)
  })
})
