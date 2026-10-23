import { describe, expect, it } from 'vitest'
import { blockers, mapChecklist } from '../src/lib/checklist'
import { newMarker, newProject, type Project, type SceneItem } from '../src/lib/project'
import { SAMPLES } from '../src/lib/samples'

const item = (textures: Record<string, string>): SceneItem => ({
  uid: 'x', name: 'Floor', path: '/work/f/a/floor.obj', source_path: '', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1,
  textures, alpha: {}, surface_ids: {}, physics_intent: 'Static',
} as SceneItem)

function withSample(id: string): Project {
  const s = SAMPLES.find((x) => x.id === id)!
  const p = newProject()
  p.scene_items = [item({ top: '/work/f/a/t.png', side: '/work/f/b/s.png' })]
  p.markers = s.markers.map(([type, at, patch]) => ({ ...newMarker(type, at), ...patch }))
  p.settings.modes = s.modes
  return p
}

const ids = (p: Project, pack: boolean | null = true) => blockers(mapChecklist(p, pack)).map((c) => c.id)

describe('ready-to-play checklist', () => {
  it('a new map needs ground and spawns', () => {
    expect(ids(newProject())).toEqual(['ground', 'spawns'])
  })

  it('every sample is ready to play', () => {
    for (const s of SAMPLES) expect(ids(withSample(s.id)), s.id).toEqual([])
  })

  it('flags untextured objects and points at the first one', () => {
    const p = withSample('arena')
    p.scene_items.push(item({ top: '/work/f/a/t.png', side: '' }))
    const c = mapChecklist(p, true).find((x) => x.id === 'textures')!
    expect(c.state).toBe('needed')
    expect(c.fix).toEqual({ kind: 'select', index: 1 })
  })

  it('Protect Tha Pimp needs both teams and a pimp entrance', () => {
    const p = withSample('flat')
    p.settings.modes = ['Protect Tha Pimp']
    const c = mapChecklist(p, true).find((x) => x.id === 'ptp')!
    expect(c.state).toBe('needed')
    expect(c.text).toContain('red team spawns, blue team spawns, a pimp entrance')
    expect(c.fix).toEqual({ kind: 'tool', tool: 'spawn', spawn: 'Red team spawn' })
  })

  it('chains drop-offs and weapons are suggestions, not blockers', () => {
    const p = withSample('flat')
    p.markers = p.markers.filter((m) => m.type !== 'Weapon pickup')
    p.settings.modes = ['Big Ass Chains']
    const list = mapChecklist(p, true)
    expect(list.find((x) => x.id === 'chains')!.state).toBe('suggested')
    expect(list.find((x) => x.id === 'weapons')!.state).toBe('suggested')
    expect(blockers(list)).toEqual([])
  })

  it('a missing data pack blocks; an unknown one does not', () => {
    const p = withSample('flat')
    expect(ids(p, false)).toEqual(['pack'])
    expect(ids(p, null)).toEqual([])
  })
})
