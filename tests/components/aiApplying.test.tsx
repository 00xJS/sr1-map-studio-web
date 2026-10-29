// @vitest-environment jsdom
// The AI's changes being made can be cancelled from wherever they show, and that outlives the chat: a new map's
// extras and a reply from the editor's note while the chat is closed, a review card's fix from its own button. A
// fix stopped partway isn't offered again (running it again would add its changes twice).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEditor } from '../../src/editor/store'
import { runAiActions, stopAiEdits, useAiApplying } from '../../src/editor/aiActions'
import { AiChat, ReviewCard } from '../../src/editor/AiChat'
import { MemoryRouter } from 'react-router-dom'
import { KEY_STORE } from '../../src/lib/aiChat'
import { AiApplyingNote } from '../../src/editor/AiApplyingNote'
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
// jsdom has no scrolling; the chat scrolls its list to the newest turn.
Element.prototype.scrollTo = () => {}
/** Re-renders a card as its chat turn changes; undone after each test. */
const subs: (() => void)[] = []
afterEach(() => { subs.splice(0).forEach((u) => u()); cleanup(); stopAiEdits(); releaseAll(); st().close(); useChat.setState({ turns: [] }); try { localStorage.removeItem(KEY_STORE) } catch { /* none */ } })

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
    subs.push(useChat.subscribe(() => view.rerender(<ReviewCard turn={turn()} />)))
    return { turn }
  }

  it('has its own Cancel while it applies, and once stopped partway it is not offered again', async () => {
    openMap()
    const { turn } = showCard([{ do: 'rename_map', name: 'Covered' } as AiAction, ...shapes(1)])
    fireEvent.click(screen.getByRole('button', { name: /Add cover/ }))
    const cancel = await screen.findByRole('button', { name: 'Cancel Add cover' })
    // The rename is made; the shape waits on its file.
    await waitFor(() => expect(st().project!.settings.display_name).toBe('Covered'))
    fireEvent.click(cancel)
    const stopped = await screen.findByRole('button', { name: /◐ Add cover/ })
    expect((stopped as HTMLButtonElement).disabled).toBe(true)
    expect(turn().partly).toEqual(['0:0'])
    expect(turn().applied ?? []).toEqual([])
  })

  it('stopped before any change, it can be pressed again', async () => {
    openMap()
    const { turn } = showCard(shapes(1))
    fireEvent.click(screen.getByRole('button', { name: /Add cover/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel Add cover' }))
    const again = await screen.findByRole('button', { name: /🔧 Add cover/ })
    await waitFor(() => expect((again as HTMLButtonElement).disabled).toBe(false))
    expect(turn().partly ?? []).toEqual([])
  })

  it('done in full, it shows as applied', async () => {
    openMap()
    const { turn } = showCard([{ do: 'rename_map', name: 'Covered' } as AiAction])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Add cover/ })) })
    await screen.findByRole('button', { name: /✓ Add cover/ })
    expect(turn().applied).toEqual(['0:0'])
  })
})

describe('The chat while its reply is being applied (after closing and reopening it)', () => {
  const showChat = () => render(<MemoryRouter><AiChat onClose={() => {}} /></MemoryRouter>)

  it("sends nothing more: not with Enter, nor the idea buttons, and New chat waits", async () => {
    openMap()
    localStorage.setItem(KEY_STORE, 'test-key')
    const reply = runAiActions(shapes(1), 'AI: chat', { key: 'chat' })
    showChat()
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeTruthy()
    const box = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(box, { target: { value: 'Add more cover' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(useChat.getState().turns).toEqual([])
    for (const idea of screen.getAllByRole('button').filter((b) => /cover|sniper|Review my map/i.test(b.textContent ?? ''))) expect((idea as HTMLButtonElement).disabled).toBe(true)
    // With a turn shown, New chat waits too.
    act(() => { useChat.getState().add({ role: 'user', text: 'earlier' }) })
    expect((screen.getByRole('button', { name: 'New chat' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect((await reply).stopped).toBe('cancel')
    await waitFor(() => expect((screen.getByRole('button', { name: 'New chat' }) as HTMLButtonElement).disabled).toBe(false))
  })

  it('shows the note and its Cancel on the key-setup screen', async () => {
    openMap()
    const reply = runAiActions(shapes(1), 'AI extras', { key: 'extras' })
    showChat()
    expect(await screen.findByText("Making the AI's changes…")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect((await reply).stopped).toBe('cancel')
  })
})

describe('Replies on a map left meanwhile', () => {
  it("aren't shown on the next map", async () => {
    openMap()
    const reply = runAiActions(shapes(1), 'AI extras', { key: 'extras' })
    render(<AiApplyingNote />)
    expect(await screen.findByText("Making the AI's changes…")).toBeTruthy()
    act(() => openMap())
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect((await finish(reply)).stopped).toBe('map')
  })
})

describe('Two review fixes with the same name', () => {
  it('are two fixes: one applying shows Cancel on itself only, and only it is marked stopped partway', async () => {
    openMap()
    const same = (actions: AiAction[]) => ({ label: 'Add cover', actions })
    const rv: Review = { score: 6, summary: '', byModel: true, sections: [{ topic: 'flow' as never, title: 'Flow', verdict: 'ok', notes: [], fixes: [same([{ do: 'rename_map', name: 'One' } as AiAction, ...shapes(1)]), same([{ do: 'rename_map', name: 'Two' } as AiAction])] as never }] }
    const id = useChat.getState().add({ role: 'assistant', text: 'Review', review: rv })
    const turn = () => useChat.getState().turns.find((t) => t.id === id)!
    const view = render(<ReviewCard turn={turn()} />)
    subs.push(useChat.subscribe(() => view.rerender(<ReviewCard turn={turn()} />)))
    fireEvent.click(screen.getAllByRole('button', { name: /Add cover/ })[0])
    await screen.findByRole('button', { name: 'Cancel Add cover' })
    expect(screen.getAllByRole('button', { name: /Cancel/ })).toHaveLength(1)
    await waitFor(() => expect(st().project!.settings.display_name).toBe('One'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Add cover' }))
    await screen.findByRole('button', { name: /◐ Add cover/ })
    expect(screen.getAllByRole('button', { name: /◐/ })).toHaveLength(1)
    expect(turn().partly).toEqual(['0:0'])
  })
})

describe('Review fixes and the chat, more', () => {
  const twins = (): Review => ({ score: 6, summary: '', byModel: true, sections: [{ topic: 'flow' as never, title: 'Flow', verdict: 'ok', notes: [], fixes: [{ label: 'Add cover', actions: [{ do: 'rename_map', name: 'One' }] }, { label: 'Add cover', actions: [{ do: 'rename_map', name: 'Two' }, ...shapes(1)] }] as never }] })
  function showTwins() {
    const id = useChat.getState().add({ role: 'assistant', text: 'Review', review: twins() })
    const turn = () => useChat.getState().turns.find((t) => t.id === id)!
    const view = render(<ReviewCard turn={turn()} />)
    subs.push(useChat.subscribe(() => view.rerender(<ReviewCard turn={turn()} />)))
    return turn
  }

  it('marks only the fix done in full as applied, not its same-named twin', async () => {
    openMap()
    const turn = showTwins()
    fireEvent.click(screen.getAllByRole('button', { name: /Add cover/ })[0])
    await screen.findByRole('button', { name: /✓ Add cover/ })
    expect(turn().applied).toEqual(['0:0'])
    const twin = screen.getAllByRole('button', { name: /Add cover/ })[1]
    expect(twin.textContent).toBe('🔧 Add cover')
    await waitFor(() => expect((twin as HTMLButtonElement).disabled).toBe(false))
  })

  it("keeps the chat from sending while a review card's fix runs, and its Cancel stops the fix", async () => {
    openMap()
    localStorage.setItem(KEY_STORE, 'test-key')
    showTwins()
    fireEvent.click(screen.getAllByRole('button', { name: /Add cover/ })[1])
    await screen.findByRole('button', { name: 'Cancel Add cover' })
    cleanup()
    render(<MemoryRouter><AiChat onClose={() => {}} /></MemoryRouter>)
    const box = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(box, { target: { value: 'Add more cover' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(useChat.getState().turns.filter((t) => t.role === 'user')).toEqual([])
    expect((screen.getByRole('button', { name: 'New chat' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(useAiApplying.getState().running).toEqual([]))
  })

  it("stops the open map's replies at the note's Cancel, not one settling on a map left meanwhile", async () => {
    openMap()
    const left = runAiActions(shapes(1), 'AI on A', { key: 'extras' })
    await waitFor(() => expect(useAiApplying.getState().running).toHaveLength(1))
    act(() => openMap())
    const mine = runAiActions(shapes(1), 'AI on B', { key: 'extras' })
    render(<AiApplyingNote />)
    const stopA = vi.spyOn(useAiApplying.getState().running[0], 'stop')
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect((await mine).stopped).toBe('cancel')
    expect(stopA).not.toHaveBeenCalled()
    expect((await finish(left)).stopped).toBe('map')
  })
})
