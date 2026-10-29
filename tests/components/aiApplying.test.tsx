// @vitest-environment jsdom
// The AI's changes being made can be cancelled from wherever they show, and that outlives the chat: a new map's
// extras and a reply from the editor's note while the chat is closed, a review card's fix from its own button. A
// fix stopped partway isn't offered again (running it again would add its changes twice).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEditor } from '../../src/editor/store'
import { runAiActions, stopAiEdits, useAiApplying } from '../../src/editor/aiActions'
import { ReviewCard } from '../../src/editor/AiChat'
import { AiApplyingNote } from '../../src/editor/EditorPage'
import { useChat } from '../../src/editor/aiSession'
import { newProject, type SceneItem } from '../../src/lib/project'
import type { AiAction } from '../../src/lib/aiChat'
import type { Review } from '../../src/lib/aiReview'

const T = vi.hoisted(() => ({ release: [] as (() => void)[] }))
// Storing a shape's file waits until the test lets it go: the reply is "being applied" meanwhile.
vi.mock('../../src/lib/files', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/files')>()),
  storeFile: vi.fn((_b: Blob, name: string) => new Promise((r) => { T.release.push(() => r({ vpath: 'files/' + name, ref: { hash: 'h-' + name, name, type: 'model/obj', size: 1, origin: 'user' } })) })),
}))
vi.mock('../../src/lib/assets', async (orig) => ({ ...(await orig<typeof import('../../src/lib/assets')>()), cacheModel: vi.fn() }))
vi.mock('../../src/lib/importers', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/importers')>()),
  importImage: vi.fn(async () => ({ vpath: 'files/t.png', ref: { hash: 'h-t', name: 't.png', type: 'image/png', size: 1, origin: 'user' } })),
}))
vi.mock('../../src/lib/images', async (orig) => ({ ...(await orig<typeof import('../../src/lib/images')>()), pixelsToPng: vi.fn(async () => new Blob(['png'])) }))
vi.mock('../../src/lib/procedural', async (orig) => ({ ...(await orig<typeof import('../../src/lib/procedural')>()), generate: () => new Uint8ClampedArray(4) }))

const st = () => useEditor.getState()
function openMap() {
  const p = newProject('A')
  p.scene_items = [{ uid: 'base', name: 'Base', path: 'base.obj', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: { m: 'tex/x.png' } } as unknown as SceneItem]
  st().open(p)
}
const shapes = (n: number) => Array.from({ length: n }, (_, k) => ({ do: 'add_shape', shape: 'box', x: 10 + k * 5, z: 4 })) as AiAction[]
const releaseAll = () => { T.release.splice(0).forEach((r) => r()) }
/** Lets every file it waits on go until `p` ends. */
async function finish<R>(p: Promise<R>): Promise<R> {
  let ended = false
  void p.finally(() => { ended = true })
  while (!ended) { releaseAll(); await new Promise((r) => setTimeout(r, 10)) }
  return p
}
afterEach(() => { cleanup(); stopAiEdits(); releaseAll(); st().close(); useChat.setState({ turns: [] }) })

describe('Cancel that outlives the chat', () => {
  it('lists each reply under who started it, and stops only those asked for', async () => {
    openMap()
    const chat = runAiActions(shapes(1), 'AI: chat', { key: 'chat' })
    const extras = runAiActions(shapes(1), 'AI extras', { key: 'extras' })
    await waitFor(() => expect(useAiApplying.getState().running.map((r) => r.key)).toEqual(['chat', 'extras']))
    // The chat was closed and opened again: its Cancel still finds the chat's reply (and a new map's extras).
    stopAiEdits('chat')
    expect((await chat).stopped).toBe('cancel')
    expect(useAiApplying.getState().running.map((r) => r.key)).toEqual(['extras'])
    expect((await finish(extras)).stopped).toBeUndefined()
    expect(useAiApplying.getState().running).toEqual([])
  })

  it("shows the editor's note while the chat is closed, and its Cancel stops a new map's extras", async () => {
    openMap()
    render(<AiApplyingNote />)
    expect(screen.queryByRole('status')).toBeNull()
    const extras = runAiActions(shapes(2), 'AI extras', { key: 'extras' })
    expect(await screen.findByText("Making the AI's changes…")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await extras).toEqual({ done: 0, skipped: ['the rest (cancelled)'], stopped: 'cancel' })
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })
})

describe('A review fix', () => {
  const review = (actions: AiAction[]): Review => ({ score: 6, summary: '', byModel: true, sections: [{ topic: 'flow' as never, title: 'Flow', verdict: 'ok', notes: [], fixes: [{ label: 'Add cover', actions } as never] }] })
  function showCard(actions: AiAction[]) {
    const id = useChat.getState().add({ role: 'assistant', text: 'Review', review: review(actions) })
    const turn = () => useChat.getState().turns.find((t) => t.id === id)!
    const view = render(<ReviewCard turn={turn()} />)
    // The card re-renders as the chat's turn changes.
    const unsub = useChat.subscribe(() => view.rerender(<ReviewCard turn={turn()} />))
    return { turn, unsub }
  }

  it('has its own Cancel while it applies, and once stopped partway it is not offered again', async () => {
    openMap()
    const { turn, unsub } = showCard([{ do: 'rename_map', name: 'Covered' } as AiAction, ...shapes(1)])
    fireEvent.click(screen.getByRole('button', { name: /Add cover/ }))
    const cancel = await screen.findByRole('button', { name: 'Cancel Add cover' })
    // The rename is made; the shape waits on its file.
    await waitFor(() => expect(st().project!.settings.display_name).toBe('Covered'))
    fireEvent.click(cancel)
    const stopped = await screen.findByRole('button', { name: /◐ Add cover/ })
    expect((stopped as HTMLButtonElement).disabled).toBe(true)
    expect(turn().partly).toEqual(['Add cover'])
    expect(turn().applied ?? []).toEqual([])
    unsub()
  })

  it('stopped before any change, it can be pressed again', async () => {
    openMap()
    const { turn, unsub } = showCard(shapes(1))
    fireEvent.click(screen.getByRole('button', { name: /Add cover/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel Add cover' }))
    const again = await screen.findByRole('button', { name: /🔧 Add cover/ })
    await waitFor(() => expect((again as HTMLButtonElement).disabled).toBe(false))
    expect(turn().partly ?? []).toEqual([])
    unsub()
  })

  it('done in full, it shows as applied', async () => {
    openMap()
    const { turn, unsub } = showCard([{ do: 'rename_map', name: 'Covered' } as AiAction])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Add cover/ })) })
    await screen.findByRole('button', { name: /✓ Add cover/ })
    expect(turn().applied).toEqual(['Add cover'])
    unsub()
  })
})
