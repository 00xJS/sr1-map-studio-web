/// <reference types="vite/client" />
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { useEditor } from '../src/editor/store'
import { SHORTCUTS, handleKey, shortcutGroups } from '../src/editor/shortcuts'
import { TOOL_ENTRIES } from '../src/editor/Tools'
import { newProject, type SceneItem } from '../src/lib/project'

const key = (k: string, o: { ctrl?: boolean; shift?: boolean; tag?: string } = {}) =>
  ({ key: k, code: '', ctrlKey: !!o.ctrl, metaKey: false, shiftKey: !!o.shift, target: { tagName: o.tag ?? 'DIV' }, preventDefault() {} }) as unknown as KeyboardEvent
const st = () => useEditor.getState()
const press = (k: string, o?: Parameters<typeof key>[1]) => handleKey(key(k, o), st())

afterEach(() => st().close())

describe('editor shortcuts', () => {
  it('lists every tool key on the sheet', () => {
    const sheet = shortcutGroups().flatMap(([, rows]) => rows.map((r) => r.keys))
    for (const t of TOOL_ENTRIES) expect(sheet).toContain(t.key)
    expect(sheet).toEqual(expect.arrayContaining(['T', 'R', '1', 'R / Shift+R', 'Enter', 'Backspace']))
  })

  it('lists the keys the walk-through and physics preview really use', () => {
    const walk = readFileSync('src/editor/walk.ts', 'utf8')
    const physics = readFileSync('src/editor/physicsPreview.ts', 'utf8')
    for (const k of ["k === 'v'", "k === 'r'", "'c'", "' '"]) expect(walk).toContain(k)
    for (const k of ["k === 'g'", "k === 'f'", "k === 't'"]) expect(physics).toContain(k)
    const walking = SHORTCUTS.filter((s) => s.group === 'Walking').map((s) => s.keys)
    expect(walking).toEqual(expect.arrayContaining(['V', 'R', 'C', 'Space', 'G', 'F', 'T']))
  })

  it('picks tools, but not while typing in a field', () => {
    st().open(newProject('Keys'))
    press('h')
    expect(st().tool).toBe('shape')
    press('x', { tag: 'INPUT' })
    expect(st().tool).toBe('shape')
    press('3')
    expect([st().tool, st().gizmo]).toEqual(['select', 'scale'])
  })

  it('Esc goes back to Move, then clears the selection', () => {
    const p = newProject('Esc')
    p.scene_items = [{ uid: 'a', name: 'a', path: '', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } as unknown as SceneItem]
    st().open(p)
    st().select({ kind: 'item', index: 0 })
    press('h')
    press('Escape')
    expect(st().tool).toBe('select')
    expect(st().selection).not.toBeNull()
    press('Escape')
    expect(st().selection).toBeNull()
  })

  it('R turns the shape preview while placing, and undo works from the keyboard', () => {
    st().open(newProject('Undo'))
    press('h')
    press('r')
    expect([st().tool, st().placeRot]).toEqual(['shape', 15])
    st().update('Rename', (d) => { d.name = 'b' })
    press('z', { ctrl: true })
    expect(st().project!.name).toBe('Undo')
    press('z', { ctrl: true, shift: true })
    expect(st().project!.name).toBe('b')
  })
})
