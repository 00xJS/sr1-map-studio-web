// One hub map: details, like, remix, report, and owner/moderator controls.
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { accountsEnabled, useBackend, useUser, type HubMapDetail, type ReportReason } from '../lib/backend'
import { fmtBytes } from '../lib/files'
import { remixHubMap, type Progress } from '../lib/sync'
import { Avatar, Field, Modal, confirmDialog, timeAgo, toast, toastError, useBusy } from '../ui'
import { AccountsOff } from './Hub'

const REASONS: { id: ReportReason; label: string }[] = [
  { id: 'game-data', label: 'Contains Saints Row game files' },
  { id: 'stolen', label: "Someone else's work without credit" },
  { id: 'offensive', label: 'Offensive or hateful content' },
  { id: 'spam', label: 'Spam or advertising' },
  { id: 'broken', label: "Broken or doesn't load" },
  { id: 'other', label: 'Something else' },
]

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

function ReportDialog({ mapId, onClose }: { mapId: string; onClose: () => void }) {
  const b = useBackend()
  const [reason, setReason] = useState<ReportReason>('game-data')
  const [details, setDetails] = useState('')
  const [run, busy] = useBusy()
  const send = () => run(async () => {
    await b!.report(mapId, reason, details.trim())
    toast('Thanks. A moderator will review this map.', 'ok')
    onClose()
  })
  return (
    <Modal title="Report this map" onClose={onClose} footer={<>
      <button className="quiet" onClick={onClose}>Cancel</button>
      <button className="primary" disabled={busy || !b} onClick={send}>Send report</button>
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
      <Link to="/hub">Back to the hub</Link>
    </div>
  )

  const mine = user?.id === map.author.id
  const files = Object.values(map.project.files)
  const bytes = [...new Map(files.map((f) => [f.hash, f.size])).values()].reduce((a, n) => a + n, 0)
  const onProgress: Progress = (p) => setProgress(p.total > 1 ? `${p.phase} ${p.done}/${p.total}` : p.phase)

  const like = () => run(async () => {
    if (!user) { toast('Sign in to like maps.'); return }
    const liked = !map.liked_by_me
    await b!.setLike(map.id, liked)
    setMap({ ...map, liked_by_me: liked, likes: Math.max(0, map.likes + (liked ? 1 : -1)) })
  })
  const remix = () => run(async () => {
    try {
      const newId = await remixHubMap(map.id, onProgress)
      toast('Remix created in My maps.', 'ok')
      navigate(`/editor/${newId}`)
    } finally { setProgress('') }
  })
  const unpublish = () => run(async () => {
    if (!(await confirmDialog('Unpublish this map?', 'It disappears from the hub for everyone, along with its likes. Your local and cloud copies are not affected.', { confirm: 'Unpublish', danger: true }))) return
    await b!.unpublish(map.id)
    toast('Map unpublished.', 'ok')
    navigate('/hub')
  })
  const setHidden = (hidden: boolean) => run(async () => {
    await b!.setHidden(map.id, hidden)
    setMap({ ...map, hidden })
    toast(hidden ? 'Map hidden from the hub.' : 'Map visible again.', 'ok')
  })

  return (
    <div className="page">
      <Link to="/hub" className="small">← Hub</Link>
      {map.hidden && <div className="callout warn">This map is hidden by a moderator. {mine ? 'Only you and moderators can see it.' : 'Only moderators and its author can see it.'}</div>}
      <div className="hub-detail">
        <div className="map-card hub-detail-thumb">
          <div className="thumb">{map.thumbnail_url ? <img src={map.thumbnail_url} alt="" /> : <span>No preview</span>}</div>
        </div>
        <div className="col" style={{ gap: 12 }}>
          <h1 style={{ overflowWrap: 'anywhere' }}>{map.title}</h1>
          <div className="row">
            <Avatar name={map.author.name} url={map.author.avatar_url} />
            <span>{map.author.name}</span>
            <span className="faint small">· published {timeAgo(map.created_at)}{map.updated_at !== map.created_at ? ` · updated ${timeAgo(map.updated_at)}` : ''}</span>
          </div>
          {map.remix_of && <p className="small muted">Remix of <Link to={`/hub/${map.remix_of.id}`}>{map.remix_of.title}</Link></p>}
          {map.tags.length > 0 && <div className="chips">{map.tags.map((t) => <Link key={t} to={`/hub?tag=${encodeURIComponent(t)}`} className="chip">#{t}</Link>)}</div>}
          <div className="row small muted">
            <span>♥ {plural(map.likes, 'like')}</span><span>· ⑂ {plural(map.remixes, 'remix', 'remixes')}</span><span>· {plural(map.downloads, 'download')}</span>
            <span>· {files.length} files, {fmtBytes(bytes)}</span>
          </div>
          <div className="row wrap">
            <button className="primary" disabled={busy} onClick={remix}>Remix in editor</button>
            <button className={map.liked_by_me ? 'on' : ''} disabled={busy} onClick={like} title={user ? '' : 'Sign in to like maps'}>{map.liked_by_me ? '♥ Liked' : '♡ Like'}</button>
            {user && !mine && <button className="quiet" onClick={() => setReporting(true)}>Report</button>}
            {!user && <Link to="/account" className="small">Sign in to like or report</Link>}
          </div>
          {progress && <p className="small muted">{progress}…</p>}
        </div>
      </div>

      {map.description && <div className="card"><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{map.description}</p></div>}

      <div className="callout">
        <p className="small muted">Remixing copies this map's own meshes, textures, markers and lights into a new project in My maps. Hub maps never include Saints Row game files: to preview game props and export the map to the game you need your own <Link to="/setup">data pack</Link>.</p>
      </div>

      {(mine || user?.is_moderator) && (
        <div className="card">
          <div className="section-title">{mine ? 'Your map' : 'Moderation'}</div>
          <div className="row wrap">
            {mine && <span className="small muted grow">To update it, open the project in the editor and publish again.</span>}
            {mine && <button className="danger" disabled={busy} onClick={unpublish}>Unpublish</button>}
            {user?.is_moderator && (map.hidden
              ? <button disabled={busy} onClick={() => setHidden(false)}>Unhide</button>
              : <button className="danger" disabled={busy} onClick={() => setHidden(true)}>Hide from hub</button>)}
          </div>
        </div>
      )}

      {reporting && <ReportDialog mapId={map.id} onClose={() => setReporting(false)} />}
    </div>
  )
}
