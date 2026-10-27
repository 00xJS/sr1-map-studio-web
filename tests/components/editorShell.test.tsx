// @vitest-environment jsdom
/// <reference types="vite/client" />
// The editor shell's Check tab (Fix all is one undo step) and the inspector's "More settings" folds.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditor } from '../../src/editor/store'
import { useHealth } from '../../src/editor/health'
import { newProject, newMarker, type SceneItem } from '../../src/lib/project'
import type { HealthReport } from '../../src/lib/analysis/types'
import { CheckTab } from '../../src/editor/tabs/CheckTab'
import { SelectionInspector } from '../../src/editor/Inspector'

// The fixes that need the map's real floor are stood in for: each makes one edit, as the real ones do.
vi.mock('../../src/editor/spawnActions', () => ({
  fixSpawnsAndWeapons: vi.fn(async () => {
    const { useEditor: st } = await import('../../src/editor/store')
    const { newMarker: m } = await import('../../src/lib/project')
    st.getState().update('Fix spawns and weapons', (d) => { d.markers.push(m('Shared spawn', [1, 0, 1])) })
    return { moved: 2, added: { spawns: 1, weapons: 0 }, reasons: ['inside a wall'], floor: 100 }
  }),
}))
vi.mock('../../src/editor/stairActions', async (orig) => ({
  ...(await orig<typeof import('../../src/editor/stairActions')>()),
  addStairRamps: vi.fn(async () => {
    const { useEditor: st } = await import('../../src/editor/store')
    st.getState().update('Add invisible stair ramps', (d) => { d.scene_items.push({ ...d.scene_items[0], uid: 'ramps', name: 'Invisible stair ramps' }) })
    return 1
  }),
}))
vi.mock('../../src/editor/health', async (orig) => ({ ...(await orig<typeof import('../../src/editor/health')>()), runHealthCheck: vi.fn(async () => {}) }))

const item = (uid: string, extra: Partial<SceneItem> = {}) => ({ uid, name: uid, path: 'a.obj', position: [4, 0, 0], rotation: [0, 0, 0], scale: 1, textures: { m0: 'tex/brick_wall.png' }, ...extra } as unknown as SceneItem)

function openMap() {
  const p = newProject('Shell')
  p.scene_items = [item('floor'), item('box')]
  p.markers = Array.from({ length: 8 }, (_, i) => newMarker('Shared spawn', [i * 10, 0, 0]))
  p.markers.push(newMarker('Weapon pickup', [0, 0, 5]))
  p.settings.remove_invisible_walls = false
  p.settings.sky_texture = 'sky.png'
  act(() => useEditor.getState().open(p))
  return p
}

beforeEach(() => { try { localStorage.clear() } catch { /* none */ } })
afterEach(() => {
  cleanup()
  useEditor.getState().close()
  useEditor.setState({ allSettings: false })
  useHealth.setState({ report: null, stairs: 0, slivers: null })
})

describe('Check tab', () => {
  it('ranks what it found and applies every fix as one undo step', { timeout: 30000 }, async () => {
    openMap()
    const report = { score: 60, findings: ["2 spawns can't be used: inside a wall.", 'Spawn 3 can be seen from 4 places: easy to camp.'], spawns: [], fairness: { basis: 'none', score: 0, reasons: [] }, moves: [] } as unknown as HealthReport
    useHealth.setState({ report, stairs: 1, slivers: { count: 3, places: [[0, 0, 0]] } as never, key: '' })
    render(<MemoryRouter><CheckTab onSamples={() => {}} /></MemoryRouter>)

    // Worst first: the unusable spawns and the camping spot come before anything merely worth fixing.
    const lines = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(lines[0]).toContain("can't be used")
    expect(lines[1]).toContain('Spawn 3')
    expect(lines.some((t) => t.includes('too tall to walk up'))).toBe(true)
    // The long explanation waits behind "Why?".
    expect(screen.queryByText(/rub against nothing/)).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Why?' })[0])
    expect(screen.getAllByRole('button', { name: 'Hide' })).toHaveLength(1)

    const before = useEditor.getState().past.length
    fireEvent.click(screen.getByRole('button', { name: /^Fix all \(3\)$/ }))
    await waitFor(() => expect(useEditor.getState().project!.settings.remove_invisible_walls).toBe(true), { timeout: 10000 })
    await waitFor(() => expect(useEditor.getState().past.length).toBe(before + 1), { timeout: 10000 })
    const st = useEditor.getState()
    expect(st.past[st.past.length - 1].label).toBe('Fix all')
    expect(st.project!.scene_items.some((it) => it.name === 'Invisible stair ramps')).toBe(true)
    expect(st.project!.markers).toHaveLength(10)

    // One Undo takes all of it back.
    act(() => useEditor.getState().undo())
    const back = useEditor.getState().project!
    expect(back.settings.remove_invisible_walls).toBe(false)
    expect(back.markers).toHaveLength(9)
    expect(back.scene_items).toHaveLength(2)
  })
})

describe('Inspector', () => {
  it('folds the extra settings away, remembers them open, and Show all settings opens them', { timeout: 30000 }, async () => {
    openMap()
    act(() => useEditor.getState().select({ kind: 'item', index: 1 }))
    const { unmount } = render(<SelectionInspector />)
    const fold = screen.getByRole('button', { name: /More settings/ })
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Position (metres)')).toBeNull()
    // A model's surface is named by its picture, not "m0".
    expect(await screen.findByText('brick wall', undefined, { timeout: 10000 })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Turn left' })).toBeTruthy()

    fireEvent.click(fold)
    expect(fold.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Position (metres)')).toBeTruthy()
    // 4 editor units at the default world scale are 2 m.
    const x = screen.getByText('Position (metres)').parentElement!.querySelector('input')!
    expect(x.value).toBe('2')
    unmount()

    // Opened once, it stays open next time.
    const again = render(<SelectionInspector />)
    expect(screen.getByRole('button', { name: /More settings/ }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /More settings/ }))
    expect(screen.getByRole('button', { name: /More settings/ }).getAttribute('aria-expanded')).toBe('false')
    again.unmount()

    // Show all settings opens every fold.
    act(() => useEditor.setState({ allSettings: true }))
    render(<SelectionInspector />)
    expect(screen.getByRole('button', { name: /More settings/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('shows nothing when nothing is selected', () => {
    openMap()
    const { container } = render(<SelectionInspector />)
    expect(container.textContent).toBe('')
  })
})
