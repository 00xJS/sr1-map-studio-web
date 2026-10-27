// The gallery: play links their signed-in owners chose to list. Only maps
// whose every model was made on the site (shapes, compounds and prefabs) can
// be listed, because an imported model travels as its full geometry; the share
// function rebuilds each model to check. Pictures are drawn by the site. Play
// one in the browser, rate it, report it, or remix it into a map of your own.
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useUser } from '../lib/backend'
import { MODE_NAMES } from '../play/share'
import { NotOpenYet, hostedShares, listGallery, rateShare, reportShare, type GalleryItem, type GallerySort } from '../play/shareApi'
import { remixShare } from '../play/remixShare'
import { toast, toastError, useBusy } from '../ui'
import { HubCard } from './Hub'
import { RateStars, ReportDialog } from './HubMap'
import './home.css'

const PAGE_SIZE = 24
const SORTS: { id: GallerySort; label: string }[] = [
  { id: 'new', label: 'Newest' },
  { id: 'top', label: 'Top rated' },
  { id: 'played', label: 'Most played' },
]

const plays = (n: number) => `${n} play${n === 1 ? '' : 's'}`

export default function Gallery() {
  const user = useUser()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') || ''
  const sort = (SORTS.find((s) => s.id === params.get('sort'))?.id ?? 'new') as GallerySort
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [text, setText] = useState(search)
  const [res, setRes] = useState<{ items: GalleryItem[]; total: number } | null>(null)
  const [reporting, setReporting] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ token: string; text: string } | null>(null)
  const [run, busy] = useBusy()

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

  const [closed, setClosed] = useState(false)
  useEffect(() => {
    let live = true
    listGallery({ search, sort, page, pageSize: PAGE_SIZE }).then((r) => live && setRes(r), (e) => {
      if (!live) return
      if (e instanceof NotOpenYet) setClosed(true)
      else toastError(e)
    })
    return () => { live = false }
  }, [search, sort, page, user?.id])

  if (!hostedShares) return (
    <div className="page page-narrow">
      <h1>Gallery</h1>
      <p className="muted">The gallery needs a server, and this site has none. Share a map by sending its <code>.sr1play</code> file (<b>Share</b> in the editor).</p>
    </div>
  )
  if (closed) return (
    <div className="page page-narrow">
      <h1>Gallery</h1>
      <p className="muted">The gallery isn’t open yet. Play links still work: choose <b>Share</b> in the editor to make one.</p>
    </div>
  )

  const remix = (token: string) => run(async () => {
    try {
      const id = await remixShare(token, (t) => setProgress({ token, text: t }))
      toast('Remix created in My maps.', 'ok')
      navigate(`/editor/${id}`)
    } finally { setProgress(null) }
  })
  const rate = (m: GalleryItem, stars: number) => run(async () => {
    await rateShare(m.token, stars)
    setRes((r) => r && { ...r, items: r.items.map((x) => {
      if (x.token !== m.token) return x
      const had = x.my_rating ?? 0
      const count = x.ratings - (had ? 1 : 0) + (stars ? 1 : 0)
      return { ...x, my_rating: stars, ratings: count, rating: count ? (x.rating * x.ratings - had + stars) / count : 0 }
    }) })
  })
  const pages = res ? Math.max(1, Math.ceil(res.total / PAGE_SIZE)) : 1

  return (
    <div className="page">
      <div className="hero" style={{ paddingTop: 8 }}>
        <h1>The <b>Gallery</b></h1>
        <p>Maps you can play right here in the browser, on a computer or a phone, with no game or account. Every map in here was built on this site from its own shapes and prefabs, and the site checks each one before it goes in, so none of them carry files from games or other sites. The pictures are drawn by the site from the maps themselves. Rate the maps you like, or remix one into your own.</p>
      </div>
      <div className="row wrap">
        <input className="grow" type="search" placeholder="Search maps and authors…" value={text} onChange={(e) => setText(e.target.value)} style={{ minWidth: 200 }} aria-label="Search maps" />
        <div className="btn-group" role="group" aria-label="Sort">
          {SORTS.map((s) => <button key={s.id} className={sort === s.id ? 'on' : ''} onClick={() => setParam({ sort: s.id === 'new' ? null : s.id })}>{s.label}</button>)}
        </div>
      </div>
      {!res ? <p className="muted">Loading…</p> : res.items.length === 0 ? (
        <div className="card" style={{ alignItems: 'center', textAlign: 'center', padding: 40 }}>
          <h3>{search ? 'No maps match' : 'No maps yet'}</h3>
          <p className="muted">{search ? 'Try other words.' : <>Build a map from shapes and prefabs, choose <b>Share</b> in the editor, and tick <b>List it in the gallery</b>.</>}</p>
        </div>
      ) : (
        <>
          <p className="small faint">{res.total} map{res.total === 1 ? '' : 's'}</p>
          <div className="grid-cards">
            {res.items.map((m) => (
              <div key={m.token} className="col gallery-item" style={{ gap: 6 }}>
                <HubCard to={`/play/s/${m.token}`} stats={<span title="Times played">▶ {m.plays}</span>}
                  m={{ id: m.token, title: m.title, description: '', tags: [], author: m.author, thumbnail_url: m.thumbnail_url, likes: 0, rating: m.rating, ratings: m.ratings, shots: [], remixes: 0, downloads: m.plays, created_at: m.created_at, updated_at: m.updated_at, remix_of: null }} />
                <div className="small faint">{m.modes.map((k) => MODE_NAMES[k] ?? k).join(' · ')}{m.players ? ` · ${m.players} spawn${m.players === 1 ? '' : 's'}` : ''} · {plays(m.plays)}</div>
                <div className="row wrap small">
                  <Link className="btn sm primary" to={`/play/s/${m.token}`}>Play</Link>
                  <button className="sm" disabled={busy} onClick={() => remix(m.token)}>{progress?.token === m.token ? `${progress.text}…` : 'Remix in editor'}</button>
                  {user && user.id !== m.author.id && <RateStars value={m.my_rating ?? 0} disabled={busy} onRate={(n) => rate(m, n)} />}
                  <button className="sm quiet" onClick={() => setReporting(m.token)}>Report</button>
                </div>
              </div>
            ))}
          </div>
          {pages > 1 && (
            <div className="row" style={{ justifyContent: 'center' }}>
              <button disabled={page <= 1} onClick={() => setParam({ page: page - 1 })}>← Previous</button>
              <span className="muted">Page {page} of {pages}</span>
              <button disabled={page >= pages} onClick={() => setParam({ page: page + 1 })}>Next →</button>
            </div>
          )}
        </>
      )}
      {reporting && <ReportDialog mapId={reporting} onClose={() => setReporting(null)} send={(reason, details) => reportShare(reporting, reason, details)} />}
    </div>
  )
}
