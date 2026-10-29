// One Showcase map: screenshots, rating, remix, report, and owner/moderator controls.
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { accountsEnabled, useBackend, useUser, type HubMapDetail, type ReportReason } from '../lib/backend'
import { remixHubMap, type Progress } from '../lib/sync'
import { Avatar, Field, Modal, confirmDialog, timeAgo, toast, toastError, useBusy } from '../ui'
import { AccountsOff, Stars } from './Hub'

const REASONS: { id: ReportReason; label: string }[] = [
  { id: 'game-data', label: 'Contains Saints Row game files' },
  { id: 'stolen', label: "Someone else's work without credit" },
  { id: 'offensive', label: 'Offensive or hateful content' },
  { id: 'spam', label: 'Spam or advertising' },
  { id: 'broken', label: "Broken or doesn't load" },
  { id: 'other', label: 'Something else' },
]

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

/** Click a star to rate; click your current rating again to take it back. */
export function RateStars({ value, disabled, onRate }: { value: number; disabled?: boolean; onRate: (n: number) => void }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  return (
    <span className="stars rate" role="radiogroup" aria-label="Your rating" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} className={'star' + (i <= shown ? ' on' : '')} disabled={disabled} role="radio" aria-checked={value === i}
          aria-label={`${i} star${i === 1 ? '' : 's'}`} title={value === i ? 'Take my rating back' : `${i} star${i === 1 ? '' : 's'}`}
          onMouseEnter={() => setHover(i)} onClick={() => onRate(value === i ? 0 : i)}>★</button>
      ))}
    </span>
  )
}

function Gallery({ shots, fallback }: { shots: string[]; fallback?: string }) {
  const [at, setAt] = useState(0)
  const pics = shots.length ? shots : fallback ? [fallback] : []
  if (!pics.length) return <div className="map-card hub-detail-thumb"><div className="thumb"><span>No pictures</span></div></div>
  return (
    <div className="gallery">
      <div className="gallery-main"><img src={pics[Math.min(at, pics.length - 1)]} alt={shots.length ? `Screenshot ${at + 1}` : 'Preview'} /></div>
      {pics.length > 1 && (
        <div className="gallery-strip">
          {pics.map((u, i) => <button key={i} className={i === at ? 'on' : ''} onClick={() => setAt(i)} aria-label={`Screenshot ${i + 1}`}><img src={u} alt="" loading="lazy" /></button>)}
        </div>
      )}
    </div>
  )
}

/** Reports a Showcase map, or with `send` something else (play links use it too). */
export function ReportDialog({ mapId, onClose, send: sendTo }: { mapId: string; onClose: () => void; send?: (reason: ReportReason, details: string) => Promise<void> }) {
  const b = useBackend()
  const [reason, setReason] = useState<ReportReason>('game-data')
  const [details, setDetails] = useState('')
  const [run, busy] = useBusy()
  const send = () => run(async () => {
    await (sendTo ? sendTo(reason, details.trim()) : b!.report(mapId, reason, details.trim()))
    toast('Thanks. A moderator will review this map.', 'ok')
    onClose()
  })
  return (
    <Modal title="Report this map" onClose={onClose} footer={<>
      <button className="quiet" onClick={onClose}>Cancel</button>
      <button className="primary" disabled={busy || (!b && !sendTo)} onClick={send}>Send report</button>
    </>}>
      <Field label="Reason">
        <select value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
          {REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </Field>
      <Field label="Details (optional)" hint="What should the moderators look at?">
        <textarea value={details} maxLength={2000} onChange={(e) => setDetails(e.target.value)} />
      </Field>
    </Modal>
  )
}

export default function HubMap() {
  const { id = '' } = useParams()
  const b = useBackend()
  const user = useUser()
  const navigate = useNavigate()
  const [map, setMap] = useState<HubMapDetail | null | undefined>(undefined)
  const [reporting, setReporting] = useState(false)
  const [progress, setProgress] = useState<string>('')
  const [run, busy] = useBusy()

  const load = () => b?.getHubMap(id).then(setMap, (e) => { toastError(e); setMap(null) })
  useEffect(() => { void load() }, [b, id, user?.id])

  if (!accountsEnabled) return <AccountsOff />
  if (map === undefined) return <div className="page"><p className="muted">Loading…</p></div>
  if (map === null) return (
    <div className="page page-narrow">
      <h1>Map not found</h1>
      <p className="muted">It may have been unpublished or hidden by a moderator.</p>
      <Link to="/showcase">Back to the Showcase</Link>
    </div>
  )

  const mine = user?.id === map.author.id
  const p = map.project
  const onProgress: Progress = (x) => setProgress(x.total > 1 ? `${x.phase} ${x.done}/${x.total}` : x.phase)

  const rate = (stars: number) => run(async () => {
    if (!user) { toast('Sign in to rate maps.'); return }
    const had = map.my_rating ?? 0
    await b!.setRating(map.id, stars)
    const count = map.ratings - (had ? 1 : 0) + (stars ? 1 : 0)
    const sum = map.rating * map.ratings - had + stars
    setMap({ ...map, my_rating: stars, ratings: count, rating: count ? sum / count : 0 })
  })
  const remix = () => run(async () => {
    try {
      const newId = await remixHubMap(map.id, onProgress)
      toast('Remix created in My maps.', 'ok')
      navigate(`/editor/${newId}`)
    } finally { setProgress('') }
  })
  const unpublish = () => run(async () => {
    if (!(await confirmDialog('Unpublish this map?', 'It disappears from the Showcase for everyone, along with its ratings and screenshots. Your local and cloud copies are not affected.', { confirm: 'Unpublish', danger: true }))) return
    await b!.unpublish(map.id)
    toast('Map unpublished.', 'ok')
    navigate('/showcase')
  })
  const setHidden = (hidden: boolean) => run(async () => {
    await b!.setHidden(map.id, hidden)
    setMap({ ...map, hidden })
    toast(hidden ? 'Map hidden from the Showcase.' : 'Map visible again.', 'ok')
  })
  const feature = () => run(async () => {
    await b!.featureMap(map.id)
    toast('This is now the map of the week.', 'ok')
  })

  return (
    <div className="page">
      <Link to="/showcase" className="small">← Showcase</Link>
      {map.hidden && <div className="callout warn">This map is hidden by a moderator. {mine ? 'Only you and moderators can see it.' : 'Only moderators and its author can see it.'}</div>}
      <div className="hub-detail">
        <Gallery shots={map.shots} fallback={map.thumbnail_url} />
        <div className="col" style={{ gap: 12 }}>
          <h1 style={{ overflowWrap: 'anywhere' }}>{map.title}</h1>
          <div className="row wrap">
            <Avatar name={map.author.name} url={map.author.avatar_url} />
            <span>{map.author.name}</span>
            <span className="faint small">· published {timeAgo(map.created_at)}{map.updated_at !== map.created_at ? ` · updated ${timeAgo(map.updated_at)}` : ''}</span>
          </div>
          {map.remix_of && <p className="small muted">Remix of <Link to={`/showcase/${map.remix_of.id}`}>{map.remix_of.title}</Link></p>}
          {map.tags.length > 0 && <div className="chips">{map.tags.map((t) => <Link key={t} to={`/showcase?tag=${encodeURIComponent(t)}`} className="chip">#{t}</Link>)}</div>}
          <div className="row small muted wrap">
            <Stars value={map.rating} count={map.ratings} />
            <span>· ⑂ {plural(map.remixes, 'remix', 'remixes')}</span><span>· {plural(map.downloads, 'download')}</span>
            <span>· {plural(p.scene_items.length, 'object')}, {plural(p.markers.length, 'marker')}</span>
          </div>
          {user && !mine && <div className="row small"><span className="muted">Your rating</span><RateStars value={map.my_rating ?? 0} disabled={busy} onRate={rate} /></div>}
          <div className="row wrap">
            <button className="primary" disabled={busy} onClick={remix}>Remix in editor</button>
            {user && !mine && <button className="quiet" onClick={() => setReporting(true)}>Report</button>}
            {!user && <Link to="/account" className="small">Sign in to rate or report</Link>}
          </div>
          {progress && <p className="small muted">{progress}…</p>}
        </div>
      </div>

      {map.description && <div className="card"><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{map.description}</p></div>}

      <div className="callout">
        <p className="small muted">Remixing rebuilds this map in your browser from Map Studio's own textures, shapes and prefabs, as a new project in My maps. Showcase maps never include anyone's files or Saints Row game data: to preview game props and export the map to the game you need your own <Link to="/connect#datapack">data pack</Link>.</p>
      </div>

      {(mine || user?.is_moderator) && (
        <div className="card">
          <div className="section-title">{mine ? 'Your map' : 'Moderation'}</div>
          <div className="row wrap">
            {mine && <span className="small muted grow">To update it, open the project in the editor and publish again.</span>}
            {mine && <button className="danger" disabled={busy} onClick={unpublish}>Unpublish</button>}
            {user?.is_moderator && !map.hidden && <button disabled={busy} onClick={feature} title="Show it at the top of the Showcase until Monday">Make map of the week</button>}
            {user?.is_moderator && (map.hidden
              ? <button disabled={busy} onClick={() => setHidden(false)}>Unhide</button>
              : <button className="danger" disabled={busy} onClick={() => setHidden(true)}>Hide from the Showcase</button>)}
          </div>
        </div>
      )}

      {reporting && <ReportDialog mapId={map.id} onClose={() => setReporting(false)} />}
    </div>
  )
}
