// POST /api/ai  {model, messages, temperature?, max_tokens?, stream?}  ->  the chat completion from NVIDIA
//
// A relay for the editor's AI chat: NVIDIA's API (build.nvidia.com) is not
// callable from the browser directly. The user's own key arrives in the
// Authorization header and is passed straight through; nothing is stored or
// logged here. With stream: true the answer comes back as server-sent events,
// piped through as they arrive.
const UPSTREAM = 'https://integrate.api.nvidia.com/v1/chat/completions'
const MAX_BODY = 400_000

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export default async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' })
  const auth = req.headers.get('authorization') || ''
  if (!/^Bearer nvapi-[\w-]{20,}$/.test(auth)) return json(401, { error: 'Add your NVIDIA API key (it starts with nvapi-).' })
  const text = await req.text()
  if (text.length > MAX_BODY) return json(413, { error: 'That conversation is too long; start a new chat.' })
  let body: { model?: unknown; messages?: unknown; temperature?: unknown; max_tokens?: unknown; stream?: unknown }
  try { body = JSON.parse(text) } catch { return json(400, { error: 'Bad request.' }) }
  if (typeof body.model !== 'string' || !/^[\w.-]+\/[\w.:-]+$/.test(body.model) || !Array.isArray(body.messages)) return json(400, { error: 'Bad request.' })
  const stream = body.stream === true
  const upstream = await fetch(UPSTREAM, {
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
    signal: req.signal,
  })
  const type = upstream.headers.get('content-type') || 'application/json'
  if (stream && upstream.ok && upstream.body) {
    return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': type.includes('event-stream') ? type : 'text/event-stream', 'Cache-Control': 'no-store' } })
  }
  return new Response(await upstream.text(), { status: upstream.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

export const config = { path: '/api/ai' }
