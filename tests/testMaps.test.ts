import { describe, expect, it, vi } from 'vitest'
import { fileVPath, type FileRef, type Project } from '../src/lib/project'

// Building a map stores files and paints textures in the browser: here they are stand-ins, so the build runs as it does there.
let next = 0
vi.mock('../src/lib/db', async (orig) => ({ ...(await orig<typeof import('../src/lib/db')>()), db: { getMeta: async () => undefined, hasBlob: async () => false, setMeta: async () => {} } }))
vi.mock('../src/lib/files', async (orig) => ({
  ...(await orig<typeof import('../src/lib/files')>()),
  storeFile: async (data: Blob, name: string, origin: FileRef['origin'] = 'user') => {
    const hash = 'h' + next++
    return { vpath: fileVPath(hash, name), ref: { hash, size: data.size, name, type: data.type, origin } }
  },
}))
vi.mock('../src/lib/texgen', () => ({ generatedPng: async (_: unknown, name: string) => new File(['png'], name, { type: 'image/png' }) }))
globalThis.fetch = (async () => new Response(new Blob(['jpg'], { type: 'image/jpeg' }))) as typeof fetch

const { TEST_BATCHES, UNBATCHED, buildTestMap, carries, testChecklist } = await import('../src/lib/testMaps')
const { mapChecklist } = await import('../src/lib/checklist')
const { checkModes } = await import('../src/lib/levels')
const { catalogs } = await import('../src/lib/catalogs')
const { OBJECT_BUDGET } = await import('../src/lib/physicsProps')
const { isZone } = await import('../src/lib/retailModes')
const { blocker, support } = await import('../src/lib/sampleScale')
const { FEATURES } = await import('../src/lib/featureStatus')
type FeatureId = import('../src/lib/featureStatus').FeatureId
type NativeConverter = import('../src/lib/testMaps').NativeConverter

// The editor's Python step, reduced to the fields it sets.
const asked: { batch: number; tags: unknown[] }[] = []
const fakeNatives = (batch: number): NativeConverter => async (p, jobs) => {
  asked.push({ batch, tags: jobs.map((j) => j.tag) })
  for (const { index, tag } of jobs) {
    const it = p.scene_items[index]
    // Python keeps the object's one texture as the native's texture.
    it.glass_custom_texture = it.textures.m0
    if ('breakable' in tag) Object.assign(it, { native_prefab: 'sr1_native_custom_mesh_glass_experiment', native_breakable_kind: tag.breakable, native_profile: tag.profile })
    else Object.assign(it, { native_prefab: 'sr1_native_custom_mesh_glass_experiment', native_prop_behavior: 'movable', physics_preset: tag.preset })
  }
}

const builds = new Map<number, Promise<Project>>()
const built = (id: 1 | 2 | 3) => {
  if (!builds.has(id)) builds.set(id, buildTestMap(id, { convert: fakeNatives(id), gameNames: async () => ({ item: 'Chair_Office', sound: 'AMB_BIRDS' }) }))
  return builds.get(id)!
}

describe('test maps', () => {
  for (const batch of TEST_BATCHES) {
    it(`batch ${batch.id} builds and carries every feature it tests`, async () => {
      const p = await built(batch.id)
      expect(p.scene_items.length).toBeGreaterThan(4)
      for (const id of batch.features) if (!batch.absent?.[id]) expect(carries(p, id), id).toBe(true)
    })

    it(`batch ${batch.id} passes the map checklist and the export's mode checks with nothing to fix`, async () => {
      const p = await built(batch.id)
      // Nothing needed and nothing suggested: a tester shouldn't have to fix a test map first.
      expect(mapChecklist(p, true).filter((i) => i.state !== 'done').map((i) => i.text)).toEqual([])
      expect(checkModes(p.settings, p.markers)).toEqual({ errors: [], warnings: [] })
      expect(p.lights.length).toBeLessThanOrEqual(catalogs.limits.max_lights)
      expect(p.settings.base_name.length).toBeLessThanOrEqual(p.settings.surface_preload ? 10 : 11)
    })

    it(`batch ${batch.id}: every marker stands on a floor, clear of walls`, () => {
      const s = batch.sample()
      const solid = s.parts.filter((x) => !x.water)
      const problems = s.markers.filter(([type]) => !isZone({ type })).flatMap(([type, at]) => {
        const b = blocker(solid, at)
        return [...(support(solid, at) < 0 ? [`${type} at ${at}: nothing to stand on`] : []), ...(b ? [`${type} at ${at}: inside ${b.label}`] : [])]
      })
      expect(problems).toEqual([])
    })

    it(`batch ${batch.id}: a checklist line for every feature, saying where and what to look for`, () => {
      const lines = testChecklist(batch)
      expect(lines.map((l) => l.id)).toEqual(batch.features)
      for (const l of lines) {
        expect(l.where, l.id).not.toBe('')
        if (!batch.absent?.[l.id]) expect(l.look, l.id).not.toBe('')
      }
    })
  }

  it('batch 1 is the export as everyone gets it: nothing turned on or off', async () => {
    const p = await built(1)
    expect(TEST_BATCHES[0].settings).toEqual({})
    expect(TEST_BATCHES[0].features.every((id) => (FEATURES[id] as { byDefault?: boolean }).byDefault)).toBe(true)
    expect(p.settings.game_sky).toBeUndefined()
    expect(p.settings.loading_mode).toBeUndefined()
    expect(p.settings.always_clear_weather).toBe(true)
  })

  it('batch 2 has changing weather and a roofed room', async () => {
    const p = await built(2)
    expect(p.settings.always_clear_weather).toBe(false)
    expect(p.settings.dry_interiors).toBeUndefined()
    expect(p.scene_items.filter((it) => it.name.startsWith('Roof'))).toHaveLength(1)
  })

  it('batch 3 holds water, props, breakables, the crate and its game names', async () => {
    const p = await built(3)
    const water = p.scene_items.filter((it) => it.swimmable_water)
    expect(water).toHaveLength(1)
    expect(water[0].name).toMatch(/^Pool water/)
    const tags = asked.find((a) => a.batch === 3)!.tags as Record<string, unknown>[]
    expect(tags.filter((t) => t.breakable)).toHaveLength(3)
    expect(tags.filter((t) => t.preset).length).toBeGreaterThanOrEqual(20)
    expect(tags.length).toBeLessThanOrEqual(OBJECT_BUDGET)
    expect(p.markers.find((m) => m.type === 'Item prop')?.item).toBe('Chair_Office')
    expect(p.markers.find((m) => m.type === 'Sound zone')?.sound).toBe('AMB_BIRDS')
    expect(p.markers.some((m) => m.type === 'Pimp exit (experimental)')).toBe(false)
    expect(asked.some((a) => a.batch !== 3)).toBe(false)
  })

  it('every feature is either in a test map or listed as not in one', () => {
    const inMaps = TEST_BATCHES.flatMap((b) => b.features)
    expect(new Set(inMaps).size).toBe(inMaps.length)
    expect([...inMaps, ...UNBATCHED].sort()).toEqual((Object.keys(FEATURES) as FeatureId[]).sort())
  })
})
