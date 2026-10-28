// @vitest-environment jsdom
// The cover while Fix all (a transaction) runs: the editor behind it takes no clicks, Tab or keys, and Stop ends it.
import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BusyLock } from '../../src/editor/EditorPage'
import { useEditor } from '../../src/editor/store'
import { newProject } from '../../src/lib/project'

afterEach(() => { cleanup(); useEditor.getState().close() })

describe('Busy cover', () => {
  it('makes the editor inert, takes focus out of it, and Stop ends the transaction with what it did', async () => {
    useEditor.getState().open(newProject('Cover'))
    const editor = createRef<HTMLDivElement>()
    render(<div ref={editor}><input aria-label="Name" /><BusyLock editor={editor} /></div>)
    const field = screen.getByRole('textbox', { name: 'Name' })
    field.focus()
    expect(document.activeElement).toBe(field)

    let stuck = () => {}
    let running!: Promise<void>
    act(() => {
      running = useEditor.getState().transaction('Fix all', async () => {
        useEditor.getState().update('Rename', (d) => { d.name = 'Fixed' })
        await new Promise<void>((r) => { stuck = r })
      })
    })
    expect(editor.current!.inert).toBe(true)
    expect(document.activeElement).not.toBe(field)
    // The cover sits outside the editor, so it isn't inert itself.
    const stop = screen.getByRole('button', { name: 'Stop' })
    expect(editor.current!.contains(stop)).toBe(false)

    fireEvent.click(stop)
    await act(() => running)
    expect(useEditor.getState().locked).toBeNull()
    expect(editor.current!.inert).toBe(false)
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(useEditor.getState().past.map((x) => x.label)).toEqual(['Fix all'])
    stuck()
  })
})
