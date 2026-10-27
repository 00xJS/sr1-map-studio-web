// @vitest-environment jsdom
/// <reference types="vite/client" />
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal, Status, modalOpen } from '../../src/ui'
import { useEditor } from '../../src/editor/store'
import { PhysicsPanel } from '../../src/editor/PhysicsPanel'
import { newProject, type SceneItem } from '../../src/lib/project'

afterEach(() => { cleanup(); useEditor.getState().close() })

describe('Modal', () => {
  it('closes only the top modal on Escape and names itself by its title', () => {
    const outer = vi.fn(), inner = vi.fn()
    render(<>
      <Modal title="Outer" onClose={outer}><button>outer button</button></Modal>
      <Modal title="Inner" onClose={inner}><button>inner button</button></Modal>
    </>)
    expect(modalOpen()).toBe(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Inner' })).toBeTruthy()
  })

  it('keeps Tab inside the dialog and gives focus back when it closes', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(<Modal title="Trap" onClose={() => {}}><button>first</button><button>last</button></Modal>)
    const close = screen.getByRole('button', { name: 'Close' })
    const last = screen.getByRole('button', { name: 'last' })
    expect(document.activeElement).toBe(close) // the first control
    last.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    unmount()
    expect(modalOpen()).toBe(false)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

describe('Status chip', () => {
  it('says a feature is not yet tried in game, and nothing once it is', () => {
    render(<><Status id="water" /><Status id="minimap" /></>)
    expect(screen.getAllByText('not yet tried in game')).toHaveLength(1)
  })
})

describe('PhysicsPanel', () => {
  it('survives the selection switching between glass and a normal object', () => {
    const p = newProject('Physics')
    const item = (uid: string, extra: Partial<SceneItem> = {}) => ({ uid, name: uid, path: 'a.obj', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: {}, ...extra } as unknown as SceneItem)
    p.scene_items = [item('base'), item('glass', { native_prefab: 'sr1_native_glass_3x3' }), item('box')]
    act(() => useEditor.getState().open(p))
    const { rerender } = render(<PhysicsPanel indices={[1]} />)
    expect(() => rerender(<PhysicsPanel indices={[2]} />)).not.toThrow()
    expect(() => rerender(<PhysicsPanel indices={[1]} />)).not.toThrow()
  })
})
