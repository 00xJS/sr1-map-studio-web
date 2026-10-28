// @vitest-environment jsdom
/// <reference types="vite/client" />
import { afterEach, describe, expect, it } from 'vitest'
import { useEditor } from '../src/editor/store'
import { alignShifts, distributeShifts, measure, type Box } from '../src/lib/arrange'
import { alignItems, distributeItems, type BoundsOf } from '../src/editor/act/arrange'
import { clearMeasure, measureClick, measureText, useMeasure } from '../src/editor/measure'
import { loadViews, withView, type SavedView } from '../src/editor/savedViews'
import { handleKey } from '../src/editor/shortcuts'
import { newProject, uid, type SceneItem, type Vec3 } from '../src/lib/project'

const box = (min: Vec3, max: Vec3): Box => ({ min, max })
const st = () => useEditor.getState()
const item = (x: number, z: number, group?: string): SceneItem => ({
  uid: uid(), name: 'Crate', path: '', position: [x, 0, z], rotation: [0, 0, 0], scale: 1, textures: {}, alpha: {}, ...(group ? { group } : {}),
})
/** Every object a 2-unit cube on its position. */
const cubes: BoundsOf = (i) => { const p = st().project!.scene_items[i].position; return [[p[0] - 1, p[1], p[2] - 1], [p[0] + 1, p[1] + 2, p[2] + 1]] }

afterEach(() => { st().close(); clearMeasure() })

describe('align and distribute', () => {
  const boxes = [box([0, 0, 0], [2, 1, 2]), box([5, 2, 1], [9, 3, 3]), box([-3, 1, 4], [-1, 2, 8])]
  it('lines boxes up by their low edges, middles or high edges', () => {
    expect(alignShifts(boxes, 0, 'min')).toEqual([-3, -8, 0])
    expect(alignShifts(boxes, 0, 'max')).toEqual([7, 0, 10])
    // Middle of them all: (-3 + 9) / 2 = 3.
    expect(alignShifts(boxes, 0, 'mid')).toEqual([2, -4, 5])
    expect(alignShifts(boxes, 1, 'min')).toEqual([0, -2, -1])
    expect(alignShifts([boxes[0]], 0, 'min')).toEqual([0])
  })

  it('spaces boxes with equal gaps, the end ones staying', () => {
    // Along X by middles: box 2 (-3..-1), box 0 (0..2), box 1 (5..9). Span 12, widths 2+2+4: gaps of 2.
    expect(distributeShifts(boxes, 0)).toEqual([1, 0, 0])
    expect(distributeShifts(boxes.slice(0, 2), 0)).toEqual([0, 0])
  })

  it('moves the objects as one undo step, a group as one piece', () => {
    const p = newProject('Arrange')
    p.scene_items = [item(0, 0), item(10, 3), item(4, 7, 'g'), item(6, 9, 'g')]
    st().open(p)
    expect(alignItems([0, 1, 2, 3], 2, 'min', cubes)).toBe(true)
    let z = st().project!.scene_items.map((it) => it.position[2])
    // Lowest -Z edge is the first crate's (-1): the group's lowest member lines up and the other keeps its 2 units.
    expect(z).toEqual([0, 0, 0, 2])
    expect(st().past).toHaveLength(1)
    st().undo()
    z = st().project!.scene_items.map((it) => it.position[2])
    expect(z).toEqual([0, 3, 7, 9])
    // X: crate 0 (-1..1), the group (3..7), crate 1 (9..11): gaps 2 and 2 already.
    expect(distributeItems([0, 1, 2, 3], 0, cubes)).toBe(false)
    st().update('Move', (d) => { d.scene_items[1].position = [14, 0, 3] })
    expect(distributeItems([0, 1, 2, 3], 0, cubes)).toBe(true)
    expect(st().project!.scene_items.map((it) => it.position[0])).toEqual([0, 14, 6, 8])
    expect(() => distributeItems([0, 1], 0, cubes)).toThrow(/three or more/)
    expect(() => alignItems([2, 3], 0, 'min', cubes)).toThrow(/two or more/)
  })
})

describe('measure', () => {
  it('gives the straight distance, across the ground and up', () => {
    expect(measure([0, 0, 0], [3, 4, 12])).toEqual({ length: 13, flat: Math.hypot(3, 12), rise: 4 })
  })

  it('takes two clicks and reads out metres (1 unit = 0.5 m at the default scale)', () => {
    expect(measureText(useMeasure.getState())).toBe('Click the first point.')
    measureClick([0, 0, 0])
    expect(measureText(useMeasure.getState())).toBe('Now click the second point.')
    measureClick([30, 0, 40])
    expect(measureText(useMeasure.getState())).toBe('25 m')
    expect(measureText(useMeasure.getState(), 1)).toBe('50 m')
    // A third click starts again.
    measureClick([0, 0, 0])
    measureClick([0, 3, 4])
    expect(measureText(useMeasure.getState())).toBe('2.5 m · 2 m across · 1.5 m up')
  })

  it('M picks the Measure tool, and putting it down is Esc', () => {
    st().open(newProject('Keys'))
    const key = (k: string, shift = false) => ({ key: k, code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: shift, target: { tagName: 'DIV' }, preventDefault() {} }) as unknown as KeyboardEvent
    handleKey(key('m'), st())
    expect(st().tool).toBe('measure')
    handleKey(key('M', true), st())
    expect([st().tool, st().mirror]).toEqual(['measure', true])
    handleKey(key('o'), st())
    expect(st().plan).toBe(true)
    handleKey(key('Escape'), st())
    expect(st().tool).toBe('select')
    st().set({ mirror: false, plan: false })
  })
})

describe('saved views', () => {
  const at = (x: number) => ({ plan: false as const, target: [x, 0, 0] as Vec3, position: [x, 10, 10] as Vec3 })
  it('names new views by the first free number and keeps nine', () => {
    let list: SavedView[] = []
    list = withView(list, at(1))
    list = withView(list, at(2), 'Red base')
    list = withView(list, { plan: true, target: [0, 0, 0], half: 40 })
    expect(list.map((v) => v.name)).toEqual(['View 1', 'Red base', 'View 2'])
    for (let i = 0; i < 10; i++) list = withView(list, at(i))
    expect(list).toHaveLength(9)
  })

  it('reads back only well-formed views for the map', () => {
    localStorage.setItem('sr1-views:m1', JSON.stringify([{ name: 'A', view: at(1) }, { name: 3 }, null]))
    expect(loadViews('m1')).toEqual([{ name: 'A', view: at(1) }])
    localStorage.setItem('sr1-views:m2', 'not json')
    expect(loadViews('m2')).toEqual([])
    expect(loadViews('none')).toEqual([])
  })
})
