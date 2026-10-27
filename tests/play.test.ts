import { describe, expect, it } from 'vitest'
import {
  DROP_RADIUS, PICKUP_RADIUS, availableRuns, bestTime, elapsed, formatTime, inDropoff, newRun, pickupsOf, progress, recordTime,
  stepRun, targets, visible, weaponName, type TimeStore,
} from '../src/play/game'
import {
  SHARE_LIMITS, SHARE_TOKEN, checkRecipe, cleanObj, fromBase64, isCleanObj, newShareToken, packShare, toBase64, unpackShare, validateShareDoc,
  type ShareDoc,
} from '../src/play/share'
import { defaultParams } from '../src/lib/procedural'
import { newMarker, newProject, type Marker, type Vec3 } from '../src/lib/project'

const at = (type: string, p: Vec3, patch: Partial<Marker> = {}) => ({ ...newMarker(type, p), ...patch })
const markers = () => [
  at('Shared spawn', [0, 0, 0]),
  at('Weapon pickup', [10, 0, 0], { weapon: 'ak47' }),
  at('Weapon pickup', [20, 0, 0], { weapon: 'shotgun' }),
  at('Weapon pickup', [30, 0, 0], { weapon: 'ak47' }),
  at('Chains drop-off', [0, 0, 20]),
  at('Chains drop-off', [0, 5, 40], { radius: 3 }),
]

describe('pickups', () => {
  it('reads weapons and drop-offs from the markers', () => {
    const p = pickupsOf(markers())
    expect(p.map((x) => x.kind)).toEqual(['weapon', 'weapon', 'weapon', 'dropoff', 'dropoff'])
    expect(p[0].label).toBe(weaponName('ak47'))
    expect(p[0].radius).toBe(PICKUP_RADIUS)
    expect(p[3].radius).toBe(DROP_RADIUS)
    expect(p[4].radius).toBe(6) // 3 m in editor units
  })
  it('offers runs only for what the map has', () => {
    expect(availableRuns(markers()).map((r) => [r.mode, r.count])).toEqual([['roam', 0], ['weapons', 3], ['dropoffs', 2], ['race', 3]])
    expect(availableRuns([at('Shared spawn', [0, 0, 0])]).map((r) => r.mode)).toEqual(['roam'])
  })
  it('names weapons from the catalog, and leaves unknown ids readable', () => {
    expect(weaponName('AK47')).toBe(weaponName('ak47'))
    expect(weaponName('my_gun')).toBe('my gun')
  })
})

describe('collect-the-weapons run', () => {
  it('starts the clock when you leave the spawn, and finishes on the last weapon', () => {
    const s = newRun(markers(), 'weapons', [0, 0, 0])
    expect(stepRun(s, [0, 0, 0], 0)).toEqual([])
    expect(s.started).toBeNull()
    expect(stepRun(s, [1, 0, 0], 1000).map((e) => e.type)).toEqual(['start'])
    const ev = stepRun(s, [10.5, 0.2, 1], 2000)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ type: 'weapon', first: true })
    expect(s.current).toBe('ak47')
    expect(progress(s)).toEqual({ done: 1, total: 3 })
    // Standing on it again does nothing: it's gone for this run.
    expect(stepRun(s, [10, 0, 0], 2100)).toEqual([])
    stepRun(s, [20, 0, 0], 3000)
    const last = stepRun(s, [30, 0, 0], 4500)
    expect(last.map((e) => e.type)).toEqual(['weapon', 'finish'])
    expect(last[0]).toMatchObject({ first: false })
    expect(last[1]).toMatchObject({ time: 3500 })
    expect(s.inventory).toEqual(['ak47', 'shotgun'])
    expect(elapsed(s, 99999)).toBe(3500)
    // Drop-offs don't count in a weapon run.
    expect(stepRun(s, [0, 0, 20], 5000)).toEqual([])
  })
  it('needs the feet near the marker height', () => {
    const s = newRun(markers(), 'weapons', [0, 0, 0])
    expect(stepRun(s, [10, 8, 0], 0).filter((e) => e.type === 'weapon')).toEqual([])
    expect(stepRun(s, [10, -3, 0], 0).filter((e) => e.type === 'weapon')).toEqual([])
    expect(stepRun(s, [10 + PICKUP_RADIUS + 0.1, 0, 0], 0).filter((e) => e.type === 'weapon')).toEqual([])
  })
})

describe('touch-every-drop-off run', () => {
  it('counts each drop-off once and finishes on the last', () => {
    const s = newRun(markers(), 'dropoffs', [0, 0, 0])
    expect(targets(s)).toHaveLength(2)
    stepRun(s, [0, 0, 5], 0)
    const a = stepRun(s, [1, 0, 19], 1000)
    expect(a).toEqual([expect.objectContaining({ type: 'dropoff', left: 1 })])
    expect(stepRun(s, [1, 0, 19], 1100)).toEqual([])
    const b = stepRun(s, [4, 5, 40], 2500)
    expect(b.map((e) => e.type)).toEqual(['dropoff', 'finish'])
    expect(s.finished).toBe(2500)
    // Weapons still go into your hands.
    expect(stepRun(s, [10, 0, 0], 3000)[0]).toMatchObject({ type: 'weapon' })
  })
})

describe('free roam', () => {
  it('has no clock; weapons come back after a while', () => {
    const s = newRun(markers(), 'roam', [0, 0, 0])
    expect(stepRun(s, [10, 0, 0], 0).map((e) => e.type)).toEqual(['weapon'])
    expect(s.started).toBeNull()
    const gun = s.pickups[0]
    // The game's 15 s for an AK (was 10 s here before).
    expect(visible(gun, 5000)).toBe(false)
    expect(stepRun(s, [10, 0, 0], 5000)).toEqual([])
    expect(visible(gun, 10000)).toBe(false)
    expect(visible(gun, 15000)).toBe(true)
    expect(stepRun(s, [10, 0, 0], 15000, 10000).map((e) => e.type)).toEqual(['weapon'])
    // An override still works: back 10 s after this pickup.
    expect(gun.back).toBe(25000)
    expect(inDropoff(s, [0, 0, 21])?.kind).toBe('dropoff')
    expect(inDropoff(s, [50, 0, 50])).toBeNull()
  })
})

describe("weapons come back on the game's clock", () => {
  it('15 s, a sniper rifle 20 s, an RPG 30 s, or the time set on the marker', () => {
    const ms = [
      at('Weapon pickup', [10, 0, 0], { weapon: 'ak47' }), at('Weapon pickup', [20, 0, 0], { weapon: 'sniper_rifle' }),
      at('Weapon pickup', [30, 0, 0], { weapon: 'rpg_launcher' }), at('Weapon pickup', [40, 0, 0], { weapon: 'ak47', respawn_ms: 4000 }),
    ]
    expect(pickupsOf(ms).map((p) => p.respawnMs)).toEqual([15000, 20000, 30000, 4000])
    const s = newRun(ms, 'roam', [0, 0, 0])
    for (const x of [10, 20, 30, 40]) stepRun(s, [x, 0, 0], 0)
    expect(s.pickups.map((p) => p.back)).toEqual([15000, 20000, 30000, 4000])
    expect(visible(s.pickups[0], 14999)).toBe(false)
    expect(visible(s.pickups[0], 15000)).toBe(true)
  })
})

describe('times', () => {
  it('formats minutes, seconds and hundredths', () => {
    expect(formatTime(0)).toBe('0:00.00')
    expect(formatTime(62345)).toBe('1:02.34')
    expect(formatTime(-5)).toBe('0:00.00')
  })
  it('keeps only better times', () => {
    const m = new Map<string, string>()
    const store: TimeStore = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) } }
    expect(bestTime(store, 'map', 'weapons')).toBeNull()
    expect(recordTime(store, 'map', 'weapons', 5000)).toBe(true)
    expect(recordTime(store, 'map', 'weapons', 6000)).toBe(false)
    expect(recordTime(store, 'map', 'weapons', 4000)).toBe(true)
    expect(bestTime(store, 'map', 'weapons')).toBe(4000)
    expect(bestTime(store, 'map', 'dropoffs')).toBeNull()
    expect(bestTime(null, 'map', 'weapons')).toBeNull()
  })
})

// ---------------- sharing ----------------

const OBJ = '# made by hand\nmtllib crate.mtl\no crate\nv 0 0 0\nv 1 0 0\nv  0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nvn 0 0 1\nusemtl top\nf 1/1/1 2/2/1 3/3/1\n'

describe('share geometry', () => {
  it('keeps geometry and drops comments and material libraries', () => {
    const c = cleanObj(OBJ)!
    expect(c).not.toMatch(/#|mtllib/)
    expect(c).toContain('v 0 1 0')
    expect(c).toContain('usemtl top')
    expect(isCleanObj(c)).toBe(true)
    expect(isCleanObj(OBJ)).toBe(false)
  })
  it('refuses anything that is not plain geometry', () => {
    expect(cleanObj('v 0 0 0\nv 1 0 0\nv 0 1 0\n')).toBeNull() // no faces
    expect(cleanObj('v 0 0 x\nf 1 2 3\n')).toBeNull()
    expect(isCleanObj('v 0 0 0\nf 1 2 3\nhello world\n')).toBe(false)
    expect(isCleanObj('v 0 0 0\nf 1 2 3\n# hidden\n')).toBe(false)
    expect(isCleanObj('v 0 0 0\nf 1 2 3\nmtllib x.mtl\n')).toBe(false)
  })
})

describe('texture recipes', () => {
  it('accepts generator settings and library ids', () => {
    expect(checkRecipe({ gen: defaultParams('brick', 512) })).toBeNull()
    expect(checkRecipe({ gen: { ...defaultParams('facade', 256), bricks: true } })).toBeNull()
    expect(checkRecipe({ lib: 'red_brick' })).toBeNull()
    expect(checkRecipe({ gen: { ...defaultParams('metal_plate', 256), accent: '#333' } })).toBeNull()
  })
  it('refuses images and odd settings', () => {
    expect(checkRecipe({ png: 'iVBORw0KGgo' })).not.toBeNull()
    expect(checkRecipe({ lib: '../secret' })).not.toBeNull()
    expect(checkRecipe({ lib: 'x', data: 'y' })).not.toBeNull()
    expect(checkRecipe({ gen: { ...defaultParams('brick', 512), kind: 'photo' } })).not.toBeNull()
    expect(checkRecipe({ gen: { ...defaultParams('brick', 512), size: 8192 } })).not.toBeNull()
    expect(checkRecipe({ gen: { ...defaultParams('brick', 512), color: 'url(x)' } })).not.toBeNull()
    expect(checkRecipe({ gen: { ...defaultParams('brick', 512), pixels: [1, 2, 3] } })).not.toBeNull()
  })
})

function doc(): ShareDoc {
  const p = newProject('Share test')
  p.scene_items.push({
    uid: 'a', name: 'Crate', path: 'mesh/0', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1,
    textures: { top: 'tex/0', side: 'tex/1' }, alpha: {},
  })
  p.markers.push(newMarker('Shared spawn', [0, 0, 0]))
  return {
    format: 'sr1-map-studio-share', version: 1, title: 'Share test', created_at: '2026-10-23T00:00:00Z', project: p,
    models: { 'mesh/0': cleanObj(OBJ)! }, textures: { 'tex/0': { kind: 'generated', params: defaultParams('concrete', 256) }, 'tex/1': { kind: 'library', id: 'brick_4' } },
  }
}

describe('share documents', () => {
  it('opens links made before the recipe formats were merged', () => {
    const d = doc() as any
    d.textures = { 'tex/0': { gen: defaultParams('concrete', 256) }, 'tex/1': { lib: 'brick_4' } }
    const r = validateShareDoc(d)
    expect(r.problems).toEqual([])
    expect(r.doc!.textures['tex/0'].kind).toBe('generated')
    expect(r.doc!.textures['tex/1']).toEqual({ kind: 'library', id: 'brick_4' })
  })

  it('passes a clean share and survives packing', () => {
    const d = doc()
    expect(validateShareDoc(d).problems).toEqual([])
    const back = unpackShare(fromBase64(toBase64(packShare(d))))
    expect(validateShareDoc(back).doc?.project.scene_items[0].name).toBe('Crate')
  })
  it('refuses shares that carry files, file settings or extra data', () => {
    const files = doc(); files.project.files['/work/f/x/photo.png'] = { hash: 'x', size: 1, name: 'photo.png', type: 'image/png', origin: 'user' }
    expect(validateShareDoc(files).problems.join()).toMatch(/must not hold files/)
    const sky = doc(); sky.project.settings.sky_texture = '/work/f/x/sky.png'
    expect(validateShareDoc(sky).problems.join()).toMatch(/sky_texture/)
    const extra = doc(); extra.models['mesh/9'] = cleanObj(OBJ)!
    expect(validateShareDoc(extra).problems.join()).toMatch(/no object uses/)
    const smuggled = doc(); smuggled.models['mesh/0'] = '# PNG data here\n' + smuggled.models['mesh/0']
    expect(validateShareDoc(smuggled).problems.join()).toMatch(/plain OBJ/)
    const photo = doc(); (photo.textures as Record<string, unknown>)['tex/0'] = { png: 'AAAA' }
    expect(validateShareDoc(photo).problems.join()).toMatch(/texture recipe/)
    const missing = doc(); delete missing.textures['tex/1']
    expect(validateShareDoc(missing).problems.join()).toMatch(/doesn't hold/)
  })
  it('lets data pack paths through without bytes', () => {
    const d = doc(); d.project.scene_items[0].textures.side = '/studio/native_glass/tinted.png'; delete d.textures['tex/1']
    expect(validateShareDoc(d).problems).toEqual([])
  })
  it('refuses Saints Row data dressed up as a model', () => {
    const d = doc(); d.models['mesh/0'] = '#Includes\n+Chunk: x\n'
    expect(validateShareDoc(d).problems.length).toBeGreaterThan(0)
  })
  it('refuses gzip bombs before unpacking', () => {
    const packed = packShare(doc())
    const n = packed.length
    const big = SHARE_LIMITS.modelChars + SHARE_LIMITS.projectChars + 2 * 1024 * 1024
    packed[n - 4] = big & 0xff; packed[n - 3] = (big >> 8) & 0xff; packed[n - 2] = (big >> 16) & 0xff; packed[n - 1] = (big >>> 24) & 0xff
    expect(() => unpackShare(packed)).toThrow(/too large/)
    expect(() => unpackShare(new Uint8Array([1, 2, 3]))).toThrow()
  })
  it('makes unguessable link tokens', () => {
    const a = newShareToken(), b = newShareToken()
    expect(a).toMatch(SHARE_TOKEN)
    expect(a).not.toBe(b)
  })
})

describe('the site’s own textures all make valid recipes', () => {
  it('every generated texture in the samples and prefabs', async () => {
    const { SAMPLES } = await import('../src/lib/samples')
    const { ALL_PREFABS } = await import('../src/lib/prefabRegistry')
    const { prefabParams } = await import('../src/lib/prefabs')
    const texs: { gen?: string; tweak?: object; lib?: string }[] = []
    for (const s of SAMPLES) for (const p of s.parts) texs.push(p.top as never, p.side as never)
    for (const def of Object.values(ALL_PREFABS)) for (const p of def.make(0, 0, 0, 0, prefabParams(def, {}))) texs.push(p.top as never, p.side as never)
    const bad = new Set<string>()
    for (const t of texs) {
      const r = t.lib ? { lib: t.lib } : { gen: { ...defaultParams(t.gen as never), ...t.tweak, size: 512 } }
      const why = checkRecipe(r)
      if (why) bad.add(`${JSON.stringify(t)}: ${why}`)
    }
    expect([...bad]).toEqual([])
  }, 120000)
})
