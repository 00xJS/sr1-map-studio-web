// GET /play/s/:token -> the app's page, with that link's title, runs, player
// count and preview picture in the <head>, so a link posted in a chat or on a
// social site unfurls as the map rather than as the site.
//
// The page itself is unchanged: the app still loads the map in the browser.
// The link's details come from the public get_share RPC (the same call the
// app makes), asking only for the small columns. Links that are expired,
// hidden or unknown keep the site's own preview. Nothing is stored here.
declare const Netlify: { env: { get(k: string): string | undefined } }

const TOKEN = /^[A-Za-z0-9_-]{22}$/
const MODES: Record<string, string> = { roam: 'Free roam', weapons: 'Weapon run', dropoffs: 'Drop-off run', race: 'Race the bots' }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const projectUrl = (raw: string) => raw.trim().replace(/\/+$/, '').replace(/\/(rest|auth|storage|functions)\/v1$/i, '')

interface ShareHead { title: string; modes: string[] | null; players: number | null; thumb: string | null; shot: boolean | null }

/** How long a page waits for the link's details before going out with the site's own preview. */
const WAIT_MS = 800
/** After the lookup fails (slow, down, or the database without migration 0004), pages skip it this long. */
const RETRY_MS = 10 * 60_000
let skipUntil = 0

async function lookUp(token: string): Promise<{ row: ShareHead; base: string } | null> {
  const base = projectUrl(Netlify.env.get('VITE_SUPABASE_URL') || Netlify.env.get('SUPABASE_URL') || '')
  const key = (Netlify.env.get('VITE_SUPABASE_ANON_KEY') || '').trim()
  if (!base || !key || Date.now() < skipUntil) return null
  const res = await fetch(`${base}/rest/v1/rpc/get_share?select=title,modes,players,thumb,shot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({ p_token: token }),
    signal: AbortSignal.timeout(WAIT_MS),
  }).catch(() => null)
  if (!res?.ok) { skipUntil = Date.now() + RETRY_MS; return null }
  const rows = await res.json().catch(() => null)
  const row = Array.isArray(rows) ? rows[0] : rows
  return row && typeof row.title === 'string' ? { row, base } : null
}

/**
 * Sets a meta tag's content, adding the tag when the page has none. Replacements are functions, so a `$&`,
 * `` $` `` or `$'` in a map's title stays text instead of pulling the page's own HTML into the head.
 */
export function meta(html: string, attr: 'property' | 'name', key: string, value: string): string {
  const tag = `<meta ${attr}="${key}" content="${esc(value)}" />`
  const re = new RegExp(`<meta\\s+${attr}="${key.replace(/[.:]/g, '\\$&')}"[^>]*>`, 'i')
  return re.test(html) ? html.replace(re, () => tag) : html.replace('</head>', () => `    ${tag}\n  </head>`)
}

export default async (req: Request, context: { next(): Promise<Response> }) => {
  const res = await context.next()
  if (req.method !== 'GET' || !res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return res
  const url = new URL(req.url)
  const token = url.pathname.split('/')[3] || ''
  if (!TOKEN.test(token)) return res
  const found = await lookUp(token)
  if (!found) return res
  const { row, base } = found
  const runs = (row.modes ?? []).filter((m) => m !== 'roam').map((m) => MODES[m] ?? m)
  const parts = [runs.length ? runs.join(' · ') : 'Free roam', row.players ? `${row.players} spawn${row.players === 1 ? '' : 's'}` : '']
  const title = `${row.title} · Play in the browser`
  const description = `A Saints Row 1 map built with SR1 Map Studio: ${parts.filter(Boolean).join(', ')}. Plays right in the browser on a computer or a phone, with no game or account needed.`
  const image = row.thumb ? `${base}/storage/v1/object/public/share-thumbs/${token}.webp?v=${new Date(row.thumb).getTime()}` : `${url.origin}/og.jpg`

  let html = await res.text()
  html = html.replace(/<title>[^<]*<\/title>/i, () => `<title>${esc(title)}</title>`)
  html = meta(html, 'name', 'description', description)
  html = meta(html, 'property', 'og:title', title)
  html = meta(html, 'property', 'og:description', description)
  html = meta(html, 'property', 'og:url', url.origin + url.pathname)
  html = meta(html, 'property', 'og:image', image)
  html = meta(html, 'name', 'twitter:title', title)
  html = meta(html, 'name', 'twitter:description', description)
  html = meta(html, 'name', 'twitter:image', image)
  if (row.thumb) {
    // Stored previews are 1280×720 (src/play/sharePreview.ts), not the site picture's size.
    html = meta(html, 'property', 'og:image:width', '1280')
    html = meta(html, 'property', 'og:image:height', '720')
    html = meta(html, 'property', 'og:image:alt', row.shot ? `An in-game screenshot of ${row.title}` : `A view of ${row.title}`)
  }
  const headers = new Headers(res.headers)
  headers.delete('content-length')
  headers.set('cache-control', 'public, max-age=0, must-revalidate')
  return new Response(html, { status: res.status, headers })
}

export const config = { path: '/play/s/*' }
