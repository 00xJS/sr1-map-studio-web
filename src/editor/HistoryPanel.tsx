// Undo history: every step since the map was opened. Clicking a step goes
// back (or forward) to it; nothing is lost until a new edit is made.
import { useEffect, useRef } from 'react'
import { useEditor } from './store'
import { toggleOverlay } from './overlays'

export function HistoryPanel() {
  const past = useEditor((s) => s.past)
  const future = useEditor((s) => s.future)
  const jumpTo = useEditor((s) => s.jumpTo)
  const current = useRef<HTMLButtonElement>(null)
  useEffect(() => { current.current?.scrollIntoView({ block: 'nearest' }) }, [past.length])
  // State k is the map after k steps; past.length is where we are now.
  const rows = [
    { label: past.length >= 150 ? 'Earliest kept step' : 'Opened the map' },
    ...past.map((h) => ({ label: h.label })),
    ...future.map((h) => ({ label: h.label })),
  ]
  const now = past.length
  return (
    <div className="history-panel" role="dialog" aria-label="Undo history">
      <header className="row between">
        <b>History</b>
        <span className="faint small">{past.length} undo · {future.length} redo</span>
        <button className="sm quiet icon" onClick={() => toggleOverlay('history', false)} aria-label="Close history">✕</button>
      </header>
      <ol>
        {rows.map((r, k) => (
          <li key={k}>
            <button ref={k === now ? current : undefined} className={'history-row' + (k === now ? ' now' : k > now ? ' undone' : '')}
              onClick={() => jumpTo(k - now)} title={k === now ? 'Where you are now' : k < now ? `Undo back to here (${now - k} step${now - k === 1 ? '' : 's'})` : `Redo up to here (${k - now} step${k - now === 1 ? '' : 's'})`}>
              <span className="n">{k}</span><span className="grow">{r.label}</span>{k === now && <span className="chip accent">now</span>}
            </button>
          </li>
        ))}
      </ol>
      <p className="faint small">Greyed steps were undone. Making a new change drops them.</p>
    </div>
  )
}
