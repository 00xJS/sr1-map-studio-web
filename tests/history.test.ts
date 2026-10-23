/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { useEditor } from '../src/editor/store'
import { newProject } from '../src/lib/project'

describe('undo history jumpTo', () => {
  it('moves several steps back and forward like repeated undo/redo', () => {
    const st = useEditor.getState()
    st.open(newProject('Test'))
    for (const n of ['a', 'b', 'c', 'd']) useEditor.getState().update('Rename ' + n, (d) => { d.name = n })
    expect(useEditor.getState().project!.name).toBe('d')
    useEditor.getState().jumpTo(-3)
    let s = useEditor.getState()
    expect(s.project!.name).toBe('a')
    expect(s.past.map((h) => h.label)).toEqual(['Rename a'])
    expect(s.future.map((h) => h.label)).toEqual(['Rename b', 'Rename c', 'Rename d'])
    useEditor.getState().jumpTo(2)
    s = useEditor.getState()
    expect(s.project!.name).toBe('c')
    expect(s.future.map((h) => h.label)).toEqual(['Rename d'])
    useEditor.getState().jumpTo(-10)
    expect(useEditor.getState().project!.name).toBe('Test')
    useEditor.getState().jumpTo(10)
    expect(useEditor.getState().project!.name).toBe('d')
    useEditor.getState().undo()
    useEditor.getState().redo()
    expect(useEditor.getState().project!.name).toBe('d')
    useEditor.getState().close()
  })
})
