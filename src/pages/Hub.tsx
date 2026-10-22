// Community hub: browse, search and filter published maps.
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { accountsEnabled, useBackend, type HubMapMeta, type HubSort } from '../lib/backend'
import { toastError, Avatar, timeAgo } from '../ui'

const PAGE_SIZE = 24
const SORTS: { id: HubSort; label: string }[] = [
  { id: 'new', label: 'Newest' },
  { id: 'top', label: 'Most liked' },
  { id: 'remixed', label: 'Most remixed' },
]

export function AccountsOff() {
  return (
    <div className="page page-narrow">
      <div className="callout"><div className="col">
        <h2>Accounts aren't configured on this site</h2>
        <p className="muted">Cloud saves and the community hub need a server. Your maps are still saved in this browser, and you can export and share project files by hand.</p>
      </div></div>
    </div>
  )
}

export function HubCard({ m }: { m: HubMapMeta }) {
  return (
    <Link to={`/hub/${m.id}`} className="map-card">
      <div className="thumb">{m.thumbnail_url ? <img src={m.thumbnail_url} alt="" loading="lazy" /> : <span className="small">No preview</span>}</div>
      <div className="body">
        <div className="title" title={m.title}>{m.title}</div>
        <div className="row small muted">
          <Avatar name={m.author.name} url={m.author.avatar_url} />
          <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.author.name}</span>
          <span title="Likes">♥ {m.likes}</span>
          <span title="Remixes">⑂ {m.remixes}</span>
        </div>
        <div className="row small faint">
          <span className="grow">{timeAgo(m.created_at)}</span>
          {m.hidden && <span className="chip">hidden</span>}
          {m.remix_of && <span className="chip">remix</span>}
        </div>
      </div>
    </Link>
  )
}

export default function Hub() {
  const b = useBackend()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') || ''
  const sort = (SORTS.find((s) => s.id === params.get('sort'))?.id ?? 'new') as HubSort
  const tag = params.get('tag') || ''
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [text, setText] = useState(search)
  const [res, setRes] = useState<{ items: HubMapMeta[]; total: number } | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const setParam = (changes: Record<string, string | number | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) { if (v === null || v === '' || (k === 'page' && v === 1)) next.delete(k); else next.set(k, String(v)) }
    if (!('page' in changes)) next.delete('page')
    setParams(next, { replace: true })
  }

  // Debounced search box -> URL.
  useEffect(() => { setText(search) }, [search])
  useEffect(() => {
    if (text === search) return
    const t = setTimeout(() => setParam({ q: text.trim() || null }), 350)
    return () => clearTimeout(t)
  }, [text])

  useEffect(() => {
    if (!b) return
    let live = true
    setLoading(true)
    b.listHub({ search, sort, tag: tag || undefined, page, pageSize: PAGE_SIZE })
      .then((r) => live && setRes(r), (e) => live && toastError(e))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [b, search, sort, tag, page])

  useEffect(() => {
    if (!b?.popularTags) return
    b.popularTags(20).then((t) => setTags(t.map((x) => x.tag)), () => {})
  }, [b])

  if (!accountsEnabled) return <AccountsOff />
  const pages = res ? Math.max(1, Math.ceil(res.total / PAGE_SIZE)) : 1
  const chipTags = tag && !tags.includes(tag) ? [tag, ...tags] : tags

  return (
    <div className="page">
      <div className="hero" style={{ paddingTop: 8 }}>
        <h1>Community <b>hub</b></h1>
        <p>Maps shared by other players: their own meshes, textures, markers and lights. Remix any of them in the editor. To export a map you need your own data pack, so no Saints Row game files are ever shared here.</p>
      </div>
      <div className="row wrap">
        <input className="grow" type="search" placeholder="Search maps, tags, authors…" value={text} onChange={(e) => setText(e.target.value)} style={{ minWidth: 200 }} aria-label="Search maps" />
        <div className="btn-group" role="group" aria-label="Sort">
          {SORTS.map((s) => <button key={s.id} className={sort === s.id ? 'on' : ''} onClick={() => setParam({ sort: s.id === 'new' ? null : s.id })}>{s.label}</button>)}
        </div>
      </div>
      {chipTags.length > 0 && (
        <div className="chips" aria-label="Filter by tag">
          {chipTags.map((t) => (
            <button key={t} className={'chip hub-tag' + (t === tag ? ' accent' : '')} onClick={() => setParam({ tag: t === tag ? null : t })}>#{t}</button>
          ))}
          {tag && <button className="chip hub-tag" onClick={() => setParam({ tag: null })}>✕ clear</button>}
        </div>
      )}
      {!res ? <p className="muted">Loading…</p> : res.items.length === 0 ? (
        <div className="card" style={{ alignItems: 'center', textAlign: 'center', padding: 40 }}>
          <h3>{search || tag ? 'No maps match' : 'No maps yet'}</h3>
          <p className="muted">{search || tag ? 'Try other words or clear the tag filter.' : 'Be the first: open a map in the editor and choose Publish.'}</p>
        </div>
      ) : (
        <>
          <p className="small faint">{res.total} map{res.total === 1 ? '' : 's'}{loading ? ' · loading…' : ''}</p>
          <div className="grid-cards">{res.items.map((m) => <HubCard key={m.id} m={m} />)}</div>
          {pages > 1 && (
            <div className="row" style={{ justifyContent: 'center' }}>
              <button disabled={page <= 1} onClick={() => setParam({ page: page - 1 })}>← Previous</button>
              <span className="muted">Page {page} of {pages}</span>
              <button disabled={page >= pages} onClick={() => setParam({ page: page + 1 })}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
