/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEditor, withoutMirror } from '../src/editor/store'
import { quiet, runAiActions } from '../src/editor/aiActions'
import { newMarker, newProject } from '../src/lib/project'

// Only storing files is stood in for: the AI runner and the shape command are the real ones.
vi.mock('../src/lib/files', async (orig) => ({
  ...(await orig<typeof import('../src/lib/files')>()),
  storeFile: vi.fn(async (_b: Blob, name: string) => ({ vpath: 'files/' + name, ref: { hash: 'h-' + name, name, type: 'model/obj', size: 1, origin: 'user' } })),
}))
vi.mock('../src/lib/importers', async (orig) => ({
  ...(await orig<typeof import('../src/lib/importers')>()),
  importImage: vi.fn(async () => ({ vpath: 'files/tex.png', ref: { hash: 'h-tex', name: 'tex.png', type: 'image/png', size: 1, origin: 'user' } })),
}))
vi.mock('../src/lib/images', async (orig) => ({
  ...(await orig<typeof import('../src/lib/images')>()),
  pixelsToPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
}))

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

  it("shapes the AI adds after an await (a model to store) get no extra twins, about mirror mode's middle", async () => {
    const p = newProject('AI shapes')
    // An off-centre map: the spawns' middle is (100, 40).
    p.markers = [newMarker('Red team spawn', [100, 0, 20]), newMarker('Blue team spawn', [100, 0, 60])]
    st().open(p)
    st().set({ mirror: true })
    const r = await runAiActions([{ do: 'add_shape', shape: 'box', x: 104, z: 30, mirror: true } as never], 'Add')
    expect(r.skipped).toEqual([])
    expect(st().project!.scene_items.map((it) => [it.position[0], it.position[2]])).toEqual([[104, 30], [96, 50]])
  })

  it("refuses an async command not made with command(): its edits would land after withoutMirror", async () => {
    const loose = async () => {}
    expect(() => quiet(loose, 'loose')()).toThrow(/not made with command\(\)/)
    // Inside withoutMirror or not, the refusal is the same.
    expect(() => withoutMirror(() => quiet(loose, 'loose')())).toThrow(/command\(\)/)
  })
})
