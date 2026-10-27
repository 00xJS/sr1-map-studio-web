// Moderators: open reports on play links (anyone who opens a link can report
// it). Hiding a link stops it working and takes it out of the gallery.
import { useEffect, useState } from 'react'
import { listShareReports, resolveShareReport, shareUrl, type ShareReport } from '../play/shareApi'
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
