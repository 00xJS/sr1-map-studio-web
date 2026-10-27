// @vitest-environment jsdom
// The Start a map dialog's moving parts: the quality gate only counts a score for the choices it was checked on
// (wizardGate.ts), the wizard's worker falls back to building on the page when it fails (wizardClient.ts), and
// "Walk it first" lets go of a temporary map unless it was changed (walkFirst.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { choicesKey, gateScore, newGate, scoreGate } from '../src/lib/wizardGate'
import { PASS, TRIES, nextSeeds } from '../src/lib/wizardClient'
import type { WizardOptions } from '../src/lib/mapWizard'

const o: WizardOptions = { setting: 'downtown', layout: 'blocks', players: 10, density: 'normal', seed: 7 }

describe('quality gate', () => {
  it('keys a score on every choice but the seed and the name, and on the pieces built with', () => {
    expect(choicesKey(o, 'site')).toBe(choicesKey({ ...o, seed: 99, name: 'Mine' }, 'site'))
    expect(choicesKey(o, 'site')).not.toBe(choicesKey({ ...o, layout: 'maze' }, 'site'))
    expect(choicesKey(o, 'site')).not.toBe(choicesKey({ ...o, busy: 80 }, 'site'))
    // Site pieces and game pieces, or the library finishing loading (a new key), are other maps.
    expect(choicesKey(o, 'site')).not.toBe(choicesKey(o, '1:0:0'))
    expect(choicesKey(o, '1:0:0')).not.toBe(choicesKey(o, '1:1:0'))
  })

  it('tries the next seeds under the bar, and ends on the best of them', () => {
    const key = choicesKey(o, 'site'), seeds = [7, ...nextSeeds(7, TRIES - 1)]
    let g = newGate(key, 7)
    const scores = [60, 72, 55, 78, 64]
    for (let i = 0; i < TRIES; i++) {
      const r = scoreGate(g, key, seeds[i], scores[i])
      g = r.gate
      expect(r.next).toBe(i < TRIES - 1 ? seeds[i + 1] : seeds[3])
    }
    expect(g.done).toBe(true)
    expect(gateScore(g, key, seeds[3])).toBe(78)
    // A pass stops at once.
    const pass = scoreGate(newGate(key, 7), key, 7, PASS)
    expect(pass.gate.done).toBe(true)
    expect(pass.next).toBeNull()
  })

  it('ignores a score checked on other choices, or for another library', () => {
    const key = choicesKey(o, 'site')
    const g = newGate(key, 7)
    // A preview that finished after the player changed the layout, with the same seed.
    const stale = scoreGate(g, choicesKey({ ...o, layout: 'maze' }, 'site'), 7, 40)
    expect(stale.gate).toBe(g)
    expect(stale.next).toBeNull()
    // Switching to game pieces: the site map's score isn't shown for the game map.
    const scored = scoreGate(g, key, 7, 85).gate
    expect(gateScore(scored, key, 7)).toBe(85)
    expect(gateScore(scored, choicesKey(o, '1:0:0'), 7)).toBeUndefined()
  })
})

describe('wizard worker', () => {
  const real = globalThis.Worker
  afterEach(() => { globalThis.Worker = real; vi.resetModules() })

  it('builds on the page when the worker fails to load, then and from then on', async () => {
    let made = 0
    class Broken {
      onmessage: ((e: MessageEvent) => void) | null = null
      onerror: ((e: Event) => void) | null = null
      constructor() { made++ }
      postMessage() { setTimeout(() => this.onerror?.(new Event('error'))) }
      terminate() {}
    }
    globalThis.Worker = Broken as unknown as typeof Worker
    const { wizardBuild } = await import('../src/lib/wizardClient')
    const first = await wizardBuild({ ...o, layout: 'maze' }, null)
    expect(first.sample.markers.length).toBeGreaterThan(0)
    const second = await wizardBuild({ ...o, layout: 'maze', seed: 8 }, null)
    expect(second.sample.markers.length).toBeGreaterThan(0)
    // The dead worker was dropped: no second one, and nothing left hanging.
    expect(made).toBe(1)
  }, 60_000)

  it('drops a request waiting behind the one being built when a newer one comes', async () => {
    const posted: { id: number; o: WizardOptions }[] = []
    let worker: { onmessage: ((e: MessageEvent) => void) | null } | null = null
    class Slow {
      onmessage: ((e: MessageEvent) => void) | null = null
      onerror: ((e: Event) => void) | null = null
      constructor() { worker = this } // eslint-disable-line @typescript-eslint/no-this-alias
      postMessage(m: { kind: string; id: number; o: WizardOptions }) { if (m.kind === 'build') posted.push(m) }
      terminate() {}
    }
    globalThis.Worker = Slow as unknown as typeof Worker
    const { wizardBuild, isSuperseded } = await import('../src/lib/wizardClient')
    const a = wizardBuild({ ...o, busy: 10 }, null)
    const b = wizardBuild({ ...o, busy: 20 }, null)
    const c = wizardBuild({ ...o, busy: 30 }, null)
    await expect(b).rejects.toSatisfy(isSuperseded)
    // Only the first went to the worker; the last waits for it.
    expect(posted.map((m) => m.o.busy)).toEqual([10])
    const reply = (id: number) => worker!.onmessage!({ data: { id, kind: 'built', sample: { markers: [], parts: [] } } } as unknown as MessageEvent)
    reply(posted[0].id)
    await a
    expect(posted.map((m) => m.o.busy)).toEqual([10, 30])
    reply(posted[1].id)
    await expect(c).resolves.toBeTruthy()
  })
})

describe('walk it first', () => {
  const store = new Map<string, { updated_at: string }>()
  beforeEach(() => {
    store.clear()
    localStorage.clear()
    vi.doMock('../src/lib/db', () => ({
      db: {
        getProject: async (id: string) => store.get(id),
        deleteProject: async (id: string) => { store.delete(id) },
      },
    }))
  })
  afterEach(() => { vi.doUnmock('../src/lib/db'); vi.resetModules() })

  it('lets go of a temporary map unless it was changed since, and keeps one being walked', async () => {
    const w = await import('../src/lib/walkFirst')
    store.set('a', { updated_at: 't1' })
    store.set('b', { updated_at: 't9' })
    store.set('c', { updated_at: 't3' })
    w.noteWalkFirst({ id: 'a', name: 'A', sample: 'arena', small: false, at: 't1' })
    // Edited in the editor since: counts as started.
    w.noteWalkFirst({ id: 'b', name: 'B', sample: 'arena', small: false, at: 't2' })
    w.noteWalkFirst({ id: 'c', name: 'C', sample: 'arena', small: false, at: 't3' })
    await w.sweepWalkFirst(undefined, 'c')
    expect([...store.keys()].sort()).toEqual(['b', 'c'])
    expect(w.lastWalkFirst()?.id).toBe('c')
    // Kept: never swept.
    w.keepWalkFirst('c')
    await w.sweepWalkFirst()
    expect(store.has('c')).toBe(true)
    expect(w.lastWalkFirst()).toBeNull()
  })

  it("doesn't lose a map walked while a sweep runs", async () => {
    const w = await import('../src/lib/walkFirst')
    store.set('a', { updated_at: 't1' })
    w.noteWalkFirst({ id: 'a', name: 'A', sample: 'arena', small: false, at: 't1' })
    const sweep = w.sweepWalkFirst()
    store.set('n', { updated_at: 't5' })
    w.noteWalkFirst({ id: 'n', name: 'N', sample: 'arena', small: false, at: 't5' })
    await sweep
    expect(w.lastWalkFirst()?.id).toBe('n')
    expect(store.has('n')).toBe(true)
    expect(store.has('a')).toBe(false)
  })
})
