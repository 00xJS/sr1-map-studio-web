// @vitest-environment jsdom
// Fix all (editor/checkFixes.ts): one undo step with the real addStairRamps, a fix that throws doesn't stop the
// others, the editor is locked while it runs, and one map's findings never show on another.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEditor } from '../../src/editor/store'
import { useHealth } from '../../src/editor/health'
import { handleKey } from '../../src/editor/shortcuts'
import { fixAll } from '../../src/editor/checkFixes'
import { applySpawnFix, fixSpawnsAndWeapons } from '../../src/editor/spawnActions'
import { parseObj } from '../../src/lib/geometry'
import { newMarker, newProject, type SceneItem } from '../../src/lib/project'

type V = [number, number, number]

/** A box's 12 triangles. */
function box([x0, y0, z0]: V, [x1, y1, z1]: V): number[] {
  const v: V[] = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]
  const out: number[] = []
  for (const [a, b, c, d] of [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]) out.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d])
  return out
}

/** Ground, six steps 0.8 units high (0.4 m: too tall to walk up), and a landing, as an OBJ model. */
function stairsModel() {
  const t = box([-40, -1, -40], [40, 0, 40])
  for (let k = 0; k < 6; k++) t.push(...box([-2, 0, k * 1.2], [2, (k + 1) * 0.8, (k + 1) * 1.2]))
  t.push(...box([-2, 0, 7.2], [2, 4.8, 13.2]))
  const lines = ['usemtl m']
  for (let i = 0; i < t.length; i += 3) lines.push(`v ${t[i]} ${t[i + 1]} ${t[i + 2]}`)
  for (let i = 1; i <= t.length / 3; i += 3) lines.push(`f ${i} ${i + 1} ${i + 2}`)
  return parseObj(lines.join('\n'))
}

// Only the file reading and writing is stood in for: the stair finder and addStairRamps itself are the real ones.
vi.mock('../../src/lib/assets', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/assets')>()),
  loadModel: vi.fn(async () => stairsModel()),
  cacheModel: vi.fn(),
}))
vi.mock('../../src/lib/files', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/files')>()),
  storeFile: vi.fn(async (_b: Blob, name: string) => ({ vpath: 'files/' + name, ref: { hash: 'h-' + name, name, type: 'model/obj', size: 1, origin: 'user' } })),
}))
vi.mock('../../src/lib/importers', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/importers')>()),
  importImage: vi.fn(async () => ({ vpath: 'files/invisible.png', ref: { hash: 'h-inv', name: 'invisible.png', type: 'image/png', size: 1, origin: 'user' } })),
}))
vi.mock('../../src/lib/images', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/images')>()),
  pixelsToPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
}))
vi.mock('../../src/editor/spawnActions', async (orig) => ({
  ...(await orig<typeof import('../../src/editor/spawnActions')>()),
  fixSpawnsAndWeapons: vi.fn(),
}))
vi.mock('../../src/editor/health', async (orig) => ({ ...(await orig<typeof import('../../src/editor/health')>()), runHealthCheck: vi.fn(async () => {}) }))

function openMap() {
  const p = newProject('Fix all')
  p.scene_items = [{ uid: 'stairs', name: 'Stairs', path: 'stairs.obj', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: { m: 'tex/x.png' } } as unknown as SceneItem]
  p.markers = [newMarker('Shared spawn', [0, 0, -10])]
  p.settings.remove_invisible_walls = false
  useEditor.getState().open(p)
  return p
}

const spawnFix = vi.mocked(fixSpawnsAndWeapons)
afterEach(() => { useEditor.getState().close(); spawnFix.mockReset() })

describe('Fix all', () => {
  it('lays the real stair ramps and the setting as one undo step', { timeout: 30000 }, async () => {
    openMap()
    const { done, failed } = await fixAll([{ kind: 'ramps' }, { kind: 'walls' }])
    expect(failed).toEqual([])
    expect(done[0]).toMatch(/invisible ramp/)
    const st = useEditor.getState()
    expect(st.project!.scene_items.map((it) => it.name)).toEqual(['Stairs', 'Invisible stair ramps'])
    expect(st.past.map((x) => x.label)).toEqual(['Fix all'])
    st.undo()
    expect(useEditor.getState().project!.scene_items).toHaveLength(1)
    expect(useEditor.getState().project!.settings.remove_invisible_walls).toBe(false)
  })

  it('keeps going past a fix that throws, and says which', { timeout: 30000 }, async () => {
    openMap()
    spawnFix.mockRejectedValue(new Error('the planner fell over'))
    const { done, failed } = await fixAll([{ kind: 'walls' }, { kind: 'spawns' }])
    expect(done).toEqual(['invisible walls left out at export'])
    expect(failed).toEqual(['spawns and weapons (the planner fell over)'])
    expect(useEditor.getState().project!.settings.remove_invisible_walls).toBe(true)
    expect(useEditor.getState().past.map((x) => x.label)).toEqual(['Fix all'])
    expect(useEditor.getState().locked).toBeNull()
  })

  it('locks the editor while it runs: Undo and the editor keys do nothing', async () => {
    openMap()
    useEditor.getState().update('Before', (d) => { d.name = 'Before' })
    let finish = () => {}
    spawnFix.mockImplementation(async () => {
      useEditor.getState().update('Fix spawns and weapons', (d) => { d.markers.push(newMarker('Shared spawn', [5, 0, 5])) })
      await new Promise<void>((r) => { finish = r })
      return { moved: 0, added: { spawns: 1, weapons: 0 }, reasons: [], floor: 10 }
    })
    const running = fixAll([{ kind: 'spawns' }])
    await vi.waitFor(() => expect(useEditor.getState().project!.markers).toHaveLength(2))
    const st = useEditor.getState()
    expect(st.locked).toBe('Fix all')
    // Mid-run, Undo (the button or Ctrl+Z) changes nothing.
    st.undo()
    const e = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true })
    expect(handleKey(e, useEditor.getState())).toBe(true)
    expect(e.defaultPrevented).toBe(true)
    expect(useEditor.getState().project!.markers).toHaveLength(2)
    expect(useEditor.getState().project!.name).toBe('Before')
    finish()
    await running
    expect(useEditor.getState().locked).toBeNull()
    expect(useEditor.getState().past.map((x) => x.label)).toEqual(['Before', 'Fix all'])
    useEditor.getState().undo()
    expect(useEditor.getState().project!.markers).toHaveLength(1)
    expect(useEditor.getState().project!.name).toBe('Before')
  })
})

describe('Findings belong to their map', () => {
  it("clears the stairs and invisible walls found on one map when another opens", () => {
    const a = openMap()
    useHealth.setState({ projectId: a.id, stairs: 2, slivers: { count: 3, places: [[0, 0, 0]] } as never })
    const b = openMap()
    expect(b.id).not.toBe(a.id)
    const h = useHealth.getState()
    expect(h.projectId).toBe(b.id)
    expect(h.stairs).toBe(0)
    expect(h.slivers).toBeNull()
    expect(h.report).toBeNull()
  })
})

describe('Spawn fix plan', () => {
  it('moves markers by uid, so a marker added or reordered since planning moves only itself', () => {
    const p = newProject('Plan')
    const [s1, s2] = [newMarker('Shared spawn', [0, 0, 0]), newMarker('Shared spawn', [1, 0, 0])]
    p.markers = [s1, s2]
    const plan = { plan: { moved: [{ index: 1, to: [9, 0, 9], why: 'inside a wall' }], added: [], floor: 1 }, scale: 1, uids: [s1.uid, s2.uid] } as never
    // Since the plan: a marker was put in front of them.
    p.markers.unshift(newMarker('Weapon pickup', [3, 0, 3]))
    applySpawnFix(p, plan)
    expect(p.markers.find((m) => m.uid === s2.uid)!.position).toEqual([9, 0, 9])
    expect(p.markers.find((m) => m.uid === s1.uid)!.position).toEqual([0, 0, 0])
    expect(p.markers[0].position).toEqual([3, 0, 3])
  })
})
