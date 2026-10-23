import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  askModel, askWithRepair, critiquePrompt, describeMap, describePrompt, modelProfile, needsRepair, parseReply, partialReply, readJsonObject, repairJson, systemPrompt,
} from '../src/lib/aiChat'
import { buildReview, clampToMap, describeEdit, heuristicPlan, isCritiqueRequest, planFromAction, planFromModel } from '../src/lib/aiReview'
import { factsText, gatherFacts } from '../src/lib/mapFacts'
import relay from '../netlify/functions/ai.mjs'
import { newMarker, newProject, uid } from '../src/lib/project'

const KEY = 'nvapi-' + 'x'.repeat(40)

/** A fake NVIDIA answer: plain JSON, or server-sent events from these chunks. */
function answer(content: string, opts: { stream?: string[]; reasoning?: string[]; status?: number } = {}): Response {
  if (opts.status && opts.status >= 400) return new Response(content, { status: opts.status, headers: { 'Content-Type': 'application/json' } })
  if (!opts.stream) return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'Content-Type': 'application/json' } })
  const events = [
    ...(opts.reasoning ?? []).map((r) => ({ choices: [{ delta: { reasoning_content: r } }] })),
    ...opts.stream.map((c) => ({ choices: [{ delta: { content: c } }] })),
  ].map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'
  // Cut into uneven pieces so lines arrive split across reads.
  const bytes = new TextEncoder().encode(events)
  const body = new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 37) c.enqueue(bytes.slice(i, i + 37)); c.close() } })
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('reading the model', () => {
  it('reads replies in a code fence, after a sentence, or as plain text', () => {
    const json = '{"reply":"Done","actions":[{"do":"turn","index":1,"degrees":90},{"nope":1}]}'
    expect(parseReply('```json\n' + json + '\n```')).toEqual({ reply: 'Done', actions: [{ do: 'turn', index: 1, degrees: 90 }] })
    expect(parseReply('Sure! ' + json).actions).toHaveLength(1)
    expect(parseReply('Just words.')).toEqual({ reply: 'Just words.', actions: [] })
  })

  it('mends what weak models get wrong: thinking, comments, trailing commas, smart quotes, a cut-off end', () => {
    expect(parseReply('<think>maybe a lamp {not json}</think>{"reply":"Hi","actions":[]}').reply).toBe('Hi')
    expect(parseReply('{"reply":"Ok", // a note\n "actions":[{"do":"set_weather","clear":false},],}').actions).toEqual([{ do: 'set_weather', clear: false }])
    expect(parseReply('{“reply”: “Quoted”, "actions": []}').reply).toBe('Quoted')
    expect(parseReply('{"reply":"Line one\nline two","actions":[{"do":"add_marker","type":"Shared spawn","x":1,"z":2}').actions).toHaveLength(1)
    expect(JSON.parse(repairJson('{"a":[1,2'))).toEqual({ a: [1, 2] })
    expect(readJsonObject('no braces here')).toBeNull()
  })

  it('knows when to ask again', () => {
    expect(needsRepair('{"reply":"x","actions":[]}')).toBeNull()
    expect(needsRepair('Plain chat, no JSON meant.')).toBeNull()
    expect(needsRepair('{"reply": "x", "actions": [ {"do": "add_prefab" "key": "bench"} ]}')).toMatch(/not valid JSON/)
    expect(needsRepair('{"reply":"x","actions":[{"do":"teleport"}]}')).toMatch(/not ones the editor knows/)
  })

  it('shows the reply while it streams in', () => {
    expect(partialReply('{"reply":"Adding two lam')).toBe('Adding two lam')
    expect(partialReply('<think>hmm</think>{"reply":"A \\"quote\\" and')).toBe('A "quote" and')
    expect(partialReply('{"actions":[')).toBe('')
  })

  it('picks a prompting style from the model name', () => {
    expect(modelProfile('meta/llama-3.3-70b-instruct').tier).toBe('standard')
    expect(modelProfile('nvidia/nemotron-3-super-120b-a12b').tier).toBe('reasoning')
    expect(modelProfile('moonshotai/kimi-k2.6').tier).toBe('reasoning')
    expect(modelProfile('deepseek-ai/deepseek-r1').tier).toBe('reasoning')
    expect(modelProfile('meta/llama-3.2-3b-instruct').tier).toBe('small')
    expect(modelProfile('microsoft/phi-3-mini-128k-instruct').tier).toBe('small')
  })
})

describe('prompts', () => {
  it('describes the map and lists the edits it may use', () => {
    const p = newProject('Test')
    p.markers = [{ ...p.markers[0], type: 'Shared spawn', position: [1, 1, 2] } as never]
    const text = describeMap(p)
    expect(text).toContain('Shared spawn ×1: #0(1,1,2)')
    const sys = systemPrompt(text)
    for (const e of ['"do":"add_prefab"', '"do":"paint"', '"do":"place_line"', '"do":"place_ring"', '"do":"mirror"', '"do":"make_symmetric"', '"do":"generate_map"', '"do":"set_weather"']) expect(sys).toContain(e)
    expect(sys).toContain('bench (Bench')
    expect(sys).toContain('sniper_rifle')
    expect(sys).toContain('Example.')
    // Thinking models skip the worked example; small ones get a shorter list.
    expect(systemPrompt(text, modelProfile('deepseek-ai/deepseek-r1'))).not.toContain('Example.')
    expect(systemPrompt(text, modelProfile('meta/llama-3.2-3b-instruct')).length).toBeLessThan(sys.length)
  })

  it('gives the critique the measured facts', () => {
    const p = newProject('Test')
    p.markers = [newMarker('Red team spawn', [0, 1, -40]), newMarker('Blue team spawn', [0, 1, 40])]
    const sys = critiquePrompt(describeMap(p), factsText(gatherFacts({ project: p })))
    expect(sys).toContain('Measured in code')
    expect(sys).toContain('"review"')
    expect(describePrompt()).toContain('"map"')
  })
})

describe('talking to the model (mocked)', () => {
  it('sends the key only in the Authorization header and streams thinking then the answer', async () => {
    const fetchMock = vi.fn(async () => answer('', { reasoning: ['Let me ', 'think.'], stream: ['{"reply":"Two', ' lamps.","actions":[]}'] }))
    vi.stubGlobal('fetch', fetchMock)
    const seen: { content: string; reasoning: string }[] = []
    const out = await askModel([{ role: 'user', content: 'hi' }], KEY, 'nvidia/nemotron-3-super-120b-a12b', { onProgress: (p) => seen.push({ ...p }) })
    expect(out).toBe('{"reply":"Two lamps.","actions":[]}')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/ai')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ' + KEY)
    const body = JSON.parse(init.body as string)
    expect(JSON.stringify(body)).not.toContain(KEY)
    expect(body).toMatchObject({ stream: true, max_tokens: 8192 })
    expect(seen[0].content).toBe('')
    expect(seen.at(-1)!.reasoning).toBe('Let me think.')
    expect(partialReply(seen.at(-1)!.content)).toBe('Two lamps.')
  })

  it('without streaming, reads the plain JSON answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer('{"reply":"ok","actions":[]}')))
    expect(await askModel([], KEY, 'meta/llama-3.3-70b-instruct')).toBe('{"reply":"ok","actions":[]}')
  })

  it('asks again once when the answer is garbled', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(answer('{"reply": "Sure" "actions": [}'))
      .mockResolvedValueOnce(answer('{"reply":"Sure","actions":[{"do":"set_weather","clear":false}]}'))
    vi.stubGlobal('fetch', fetchMock)
    let repairs = 0
    const { raw, repaired } = await askWithRepair([{ role: 'user', content: 'make it rain' }], KEY, 'meta/llama-3.3-70b-instruct', { onRepair: () => repairs++ })
    expect(repaired).toBe(true)
    expect(repairs).toBe(1)
    expect(parseReply(raw).actions).toEqual([{ do: 'set_weather', clear: false }])
    const second = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)
    expect(second.messages.at(-1).content).toMatch(/not valid JSON/)
  })

  it('a plain-language answer is not sent back for repair', async () => {
    const fetchMock = vi.fn(async () => answer('That map looks good to me.'))
    vi.stubGlobal('fetch', fetchMock)
    expect((await askWithRepair([], KEY, 'meta/llama-3.3-70b-instruct')).repaired).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('explains errors without ever showing the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(JSON.stringify({ error: { message: `bad header Bearer ${KEY}` } }), { status: 500 })))
    const err = await askModel([], KEY, 'meta/llama-3.3-70b-instruct').catch((e: Error) => e)
    expect(String(err)).not.toContain(KEY)
    vi.stubGlobal('fetch', vi.fn(async () => answer('{}', { status: 401 })))
    expect(String(await askModel([], KEY, 'm/x').catch((e: Error) => e))).toMatch(/did not accept the key/)
  })

  it('stops when cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))))
    const ctl = new AbortController()
    const p = askModel([], KEY, 'm/x', { signal: ctl.signal, onProgress: () => {} })
    ctl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('the relay', () => {
  it('passes the key through, caps the request, and streams the answer back', async () => {
    const upstream = vi.fn(async () => answer('', { stream: ['{"reply":"hi"}'] }))
    vi.stubGlobal('fetch', upstream)
    const res = await relay(new Request('http://x/api/ai', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY }, body: JSON.stringify({ model: 'meta/llama-3.3-70b-instruct', messages: [], max_tokens: 99999, stream: true, extra: 'dropped' }) }))
    expect(res.headers.get('content-type')).toContain('event-stream')
    expect(await res.text()).toContain('"reply')
    const [, init] = upstream.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ' + KEY)
    expect(JSON.parse(init.body as string)).toEqual({ model: 'meta/llama-3.3-70b-instruct', messages: [], temperature: 0.3, max_tokens: 8192, stream: true })
  })

  it('refuses a missing key without calling NVIDIA', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    const res = await relay(new Request('http://x/api/ai', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(401)
    expect(upstream).not.toHaveBeenCalled()
  })
})

describe('critique', () => {
  const lopsided = () => {
    const p = newProject('Lopsided')
    p.scene_items = [{ uid: uid(), name: 'Ground', path: '', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: {}, alpha: {}, shape: { kind: 'box', size: [80, 1, 120], tile: 4 } }]
    p.markers = [newMarker('Red team spawn', [0, 1.1, -50]), newMarker('Blue team spawn', [0, 1.1, 50]), newMarker('Red team spawn', [5, 1.1, -50])]
    return p
  }

  it('spots review requests', () => {
    for (const m of ['Is this map fair?', 'Critique my map', 'review it please', 'How balanced is it for both teams?', 'critique']) expect(isCritiqueRequest(m), m).toBe(true)
    for (const m of ['Add a bench', 'make the walls fairer colours? no, add lamps', 'rate of fire']) expect(isCritiqueRequest(m), m).toBe(false)
  })

  it('without the model, the review comes from the measurements, with fixes', () => {
    const r = buildReview(gatherFacts({ project: lopsided() }))
    expect(r.byModel).toBe(false)
    expect(r.sections.map((s) => s.topic)).toEqual(['spawns', 'sightlines', 'cover', 'flow', 'fairness', 'weapons'])
    const fair = r.sections.find((s) => s.topic === 'fairness')!
    expect(fair.verdict).toBe('bad')
    expect(fair.fixes.map((f) => f.actions[0].do)).toContain('make_symmetric')
    expect(r.sections.find((s) => s.topic === 'spawns')!.fixes[0].actions[0]).toMatchObject({ do: 'add_shape', mirror: true })
  })

  it("takes the model's notes but not a 'good' the code disproves", () => {
    const raw = JSON.stringify({
      reply: 'Mostly fine.', review: { score: 6, sections: [
        { topic: 'fairness', verdict: 'good', notes: 'Looks even.' },
        { topic: 'cover', verdict: 'ok', notes: 'Bare middle.', actions: [{ do: 'add_shape', shape: 'box', x: 3, z: -4, mirror: true }, { do: 'explode' }] },
      ] }, actions: [],
    })
    const r = buildReview(gatherFacts({ project: lopsided() }), raw)
    expect(r.byModel).toBe(true)
    expect(r.score).toBe(6)
    expect(r.summary).toBe('Mostly fine.')
    const fair = r.sections.find((s) => s.topic === 'fairness')!
    expect(fair.verdict).toBe('bad')
    expect(fair.notes).toEqual(['Looks even.'])
    const cover = r.sections.find((s) => s.topic === 'cover')!
    expect(cover.fixes.at(-1)).toEqual({ label: "Try the AI's fix", actions: [{ do: 'add_shape', shape: 'box', x: 3, z: -4, mirror: true }] })
  })
})

describe('a map from a sentence', () => {
  const SENTENCE = 'a rainy rooftop map with a central tower for 8 players'

  it('without the model, reads the words', () => {
    const plan = heuristicPlan(SENTENCE, 7)
    expect(plan.options).toMatchObject({ setting: 'downtown', layout: 'heights', players: 8, density: 'normal', seed: 7 })
    expect(plan.then).toEqual([{ do: 'set_weather', clear: false }, { do: 'delete', near: [0, 0, 10] }, { do: 'add_prefab', key: 'koth', x: 0, z: 0 }])
    expect(heuristicPlan('neon arena 1v1').options).toMatchObject({ setting: 'cyber', layout: 'arena', players: 2 })
    expect(heuristicPlan('packed docks for twelve players').options).toMatchObject({ setting: 'industrial', players: 12, density: 'packed' })
  })

  it("uses the model's choices, fills gaps from the words, and keeps edits inside the map", () => {
    const raw = '```json\n{"reply":"Rainy roofs!","map":{"setting":"Downtown","layout":"height","players":30,"name":"Wet Roofs"},"then":[{"do":"set_weather","clear":false},{"do":"add_prefab","key":"koth","x":0,"z":0},{"do":"add_prefab","key":"lamp","x":500,"z":-500,"mirror":true},{"do":"fly"}]}\n```'
    const plan = planFromModel(raw, SENTENCE, 3)
    expect(plan.byModel).toBe(true)
    expect(plan.options).toEqual({ setting: 'downtown', layout: 'heights', players: 12, density: 'normal', seed: 3, name: 'Wet Roofs' })
    expect(plan.then).toHaveLength(3)
    const lamp = plan.then[2] as { x: number; z: number }
    expect(Math.abs(lamp.x)).toBeLessThan(100)
    expect(Math.abs(lamp.z)).toBeLessThan(100)
    expect(planFromModel('I cannot do that.', SENTENCE, 3).byModel).toBe(false)
  })

  it("reads the chat's generate_map edit", () => {
    const plan = planFromAction({ do: 'generate_map', setting: 'paintball', layout: 'lanes', players: 6, density: 'open', name: 'Lanes', then: [{ do: 'add_light', x: 999, y: 8, z: 0 }] }, 'Here you go')
    expect(plan.options).toMatchObject({ setting: 'paintball', layout: 'lanes', players: 6, density: 'open', name: 'Lanes' })
    expect(plan.reply).toBe('Here you go')
    expect((plan.then[0] as { x: number }).x).toBeLessThan(100)
    expect(clampToMap([{ do: 'place_ring', item: { do: 'add_light' }, radius: 500, count: 4 }], { players: 4, layout: 'arena' })[0]).toMatchObject({ radius: expect.any(Number) })
    expect(describeEdit({ do: 'set_weather', clear: false })).toMatch(/rain/)
    expect(describeEdit({ do: 'add_prefab', key: 'koth', x: 0, z: 0 })).toBe('Add King of the hill at (0, 0)')
  })
})
