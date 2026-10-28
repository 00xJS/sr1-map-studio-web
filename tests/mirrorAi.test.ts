/// <reference types="vite/client" />
import { afterEach, describe, expect, it } from 'vitest'
import { useEditor } from '../src/editor/store'
import { runAiActions } from '../src/editor/aiActions'
import { newProject } from '../src/lib/project'

const st = () => useEditor.getState()
afterEach(() => { st().set({ mirror: false }); st().close() })

describe('mirror mode and the AI', () => {
  it("the AI's own twins aren't twinned again", async () => {
    st().open(newProject('AI'))
    st().set({ mirror: true })
    const r = await runAiActions([{ do: 'add_marker', type: 'Weapon pickup', weapon: 'ak47', x: 8, z: 8, mirror: true } as never], 'Add')
    expect(r.done).toBe(2)
    expect(st().project!.markers.map((m) => [m.position[0], m.position[2]])).toEqual([[8, 8], [-8, -8]])
    // Mirror mode is back on for the user's own edits.
    st().update('Move', (d) => { d.markers[0].position = [9, d.markers[0].position[1], 8] })
    expect(st().project!.markers[1].position[0]).toBe(-9)
  })
})
