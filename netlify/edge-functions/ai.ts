// POST /api/ai  {model, messages, temperature?, max_tokens?, stream?}  ->  the chat completion from NVIDIA
// GET  /api/ai/models  ->  the models NVIDIA's API serves right now (public; no key needed or sent)
//
// A relay for the editor's AI chat: NVIDIA's API (build.nvidia.com) is not
// callable from the browser directly. The user's own key arrives in the
// Authorization header and is passed straight through; nothing is stored or
// logged here.
//
// It is an edge function, not a regular one: Netlify cuts a regular function's
// stream after 10 seconds, and a big map on a busy free model can take longer
// than that just to start answering. Edge functions stream for as long as the
// answer takes. With stream: true the reply starts at once; until NVIDIA's
// first words arrive it sends a comment line every few seconds, so nothing on
// the way gives up on a quiet connection, and an NVIDIA error comes back as a
// {"error": {status, message}} event.
const UPSTREAM = 'https://integrate.api.nvidia.com/v1/chat/completions'
const MODELS = 'https://integrate.api.nvidia.com/v1/models'
const MAX_BODY = 400_000
const PING_MS = 5000

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** An error body's words: its JSON message, or a web page without its tags. */
function errorText(text: string): string {
  try {
    const d = JSON.parse(text)
    const m = d?.error?.message ?? d?.error ?? d?.detail ?? d?.title
    if (typeof m === 'string' && m) return m.slice(0, 300)
  } catch { /* not JSON */ }
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
}

export default async (req: Request) => {
  if (req.method === 'GET' && new URL(req.url).pathname.endsWith('/models')) {
    const upstream = await fetch(MODELS, { headers: { Accept: 'application/json' }, signal: req.signal }).catch(() => null)
    if (!upstream?.ok) return json(502, { error: "Couldn't reach NVIDIA's model list." })
    const { data } = (await upstream.json()) as { data?: { id?: unknown }[] }
    const ids = (data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string')
    return new Response(JSON.stringify({ models: ids }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } })
  }
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' })
  const auth = req.headers.get('authorization') || ''
  if (!/^Bearer nvapi-[\w-]{20,}$/.test(auth)) return json(401, { error: 'Add your NVIDIA API key (it starts with nvapi-).' })
  const text = await req.text()
  if (text.length > MAX_BODY) return json(413, { error: 'That conversation is too long; start a new chat.' })
  let body: { model?: unknown; messages?: unknown; temperature?: unknown; max_tokens?: unknown; stream?: unknown }
  try { body = JSON.parse(text) } catch { return json(400, { error: 'Bad request.' }) }
  if (typeof body.model !== 'string' || !/^[\w.-]+\/[\w.:-]+$/.test(body.model) || !Array.isArray(body.messages)) return json(400, { error: 'Bad request.' })
  const stream = body.stream === true
  const ctl = new AbortController()
  req.signal?.addEventListener('abort', () => ctl.abort())
  const ask = () => fetch(UPSTREAM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: stream ? 'text/event-stream' : 'application/json', Authorization: auth },
    body: JSON.stringify({
      model: body.model,
      messages: body.messages,
      temperature: typeof body.temperature === 'number' ? Math.max(0, Math.min(1, body.temperature)) : 0.3,
      // Thinking models need room to think before they answer.
      max_tokens: typeof body.max_tokens === 'number' ? Math.max(64, Math.min(8192, body.max_tokens)) : 2048,
      stream,
    }),
    signal: ctl.signal,
  })

  if (!stream) {
    const upstream = await ask().catch(() => null)
    if (!upstream) return json(502, { error: "Couldn't reach NVIDIA." })
    return new Response(await upstream.text(), { status: upstream.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  }

  const enc = new TextEncoder()
  const out = new ReadableStream<Uint8Array>({
    async start(c) {
      const send = (s: string) => { try { c.enqueue(enc.encode(s)) } catch { /* closed */ } }
      send(': waiting\n\n')
      const ping = setInterval(() => send(': waiting\n\n'), PING_MS)
      try {
        const upstream = await ask()
        clearInterval(ping)
        if (upstream.ok && upstream.body && (upstream.headers.get('content-type') || '').includes('event-stream')) {
          const reader = upstream.body.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            c.enqueue(value)
          }
        } else if (upstream.ok) {
          // A plain answer (some models don't stream): pass it on as one event.
          const answer = JSON.parse(await upstream.text())
          const msg = answer?.choices?.[0]?.message ?? {}
          send(`data: ${JSON.stringify({ choices: [{ delta: { content: msg.content ?? '', reasoning_content: msg.reasoning_content } }] })}\n\ndata: [DONE]\n\n`)
        } else {
          send(`data: ${JSON.stringify({ error: { status: upstream.status, message: errorText(await upstream.text()) } })}\n\n`)
        }
      } catch {
        clearInterval(ping)
        if (!ctl.signal.aborted) send(`data: ${JSON.stringify({ error: { status: 502, message: "Couldn't reach NVIDIA." } })}\n\n`)
      }
      try { c.close() } catch { /* closed */ }
    },
    cancel() { ctl.abort() },
  })
  return new Response(out, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } })
}

export const config = { path: ['/api/ai', '/api/ai/models'] }
