// Moderators: open reports on play links (anyone who opens a link can report
// it), and preview pictures waiting for review. Hiding a link stops it working
// and takes it out of the gallery.
import { useEffect, useState } from 'react'
import { listPendingPictures, listShareReports, resolveShareReport, reviewPicture, shareUrl, type PendingPicture, type ShareReport } from '../play/shareApi'
import { timeAgo, toast, toastError, useBusy } from '../ui'

const REASON_LABELS: Record<ShareReport['reason'], string> = {
  'game-data': 'Game files', stolen: 'Stolen work', offensive: 'Offensive', spam: 'Spam', broken: 'Broken', other: 'Other',
}

export function ShareReports() {
  const [items, setItems] = useState<ShareReport[] | null>(null)
  const [run, busy] = useBusy()
  const load = () => listShareReports().then(setItems, toastError)
  useEffect(() => { void load() }, [])
  const resolve = (r: ShareReport, action: 'dismiss' | 'hide') => run(async () => {
    await resolveShareReport(r, action)
    toast(action === 'hide' ? `"${r.title}" is hidden: the link no longer opens.` : 'Report dismissed.', 'ok')
    await load()
  })
  return (
    <section className="col">
      <div className="section-title">Moderation · reported play links</div>
      {!items ? <p className="muted">Loading…</p> : items.length === 0 ? <p className="muted">No open reports on play links.</p> : (
        <div className="col">
          {items.map((r) => (
            <div key={r.id} className="card tight">
              <div className="row wrap">
                <span className="chip accent">{REASON_LABELS[r.reason] ?? r.reason}</span>
                <a href={shareUrl(r.token)} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>{r.title}</a>
                <span className="small faint grow">by {r.reporter} · {timeAgo(r.created_at)}</span>
                <button className="sm" disabled={busy} onClick={() => resolve(r, 'dismiss')}>Dismiss</button>
                <button className="sm danger" disabled={busy} onClick={() => resolve(r, 'hide')}>Hide link</button>
              </div>
              {r.details && <p className="small muted" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.details}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * Moderators: preview pictures waiting for review. A link's picture shows in link previews and the gallery only
 * once approved; until then, and after a rejection, the link shows the site's own picture.
 */
export function SharePictures() {
  const [items, setItems] = useState<PendingPicture[] | null>(null)
  const [run, busy] = useBusy()
  const load = () => listPendingPictures().then(setItems, toastError)
  useEffect(() => { void load() }, [])
  const review = (p: PendingPicture, approve: boolean) => run(async () => {
    await reviewPicture(p, approve)
    toast(approve ? `"${p.title}" now shows its picture.` : `The picture for "${p.title}" is deleted.`, 'ok')
    await load()
  })
  return (
    <section className="col">
      <div className="section-title">Moderation · pictures waiting</div>
      <p className="small muted">Preview pictures drawn for play links. None shows in link previews or the gallery until you approve it.</p>
      {!items ? <p className="muted">Loading…</p> : items.length === 0 ? <p className="muted">No pictures waiting.</p> : (
        <div className="col">
          {items.map((p) => (
            <div key={p.token + p.path} className="card tight row wrap">
              <img src={p.url} alt={`Preview for ${p.title}`} width={160} height={90} style={{ borderRadius: 6, objectFit: 'cover' }} />
              <div className="col grow" style={{ gap: 2 }}>
                <a href={shareUrl(p.token)} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>{p.title}</a>
                <span className="small faint">by {p.author} · {timeAgo(p.at)}</span>
              </div>
              <button className="sm" disabled={busy} onClick={() => review(p, true)}>Approve</button>
              <button className="sm danger" disabled={busy} onClick={() => review(p, false)}>Reject</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
