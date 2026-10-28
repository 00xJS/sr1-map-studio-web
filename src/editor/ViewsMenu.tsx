// The camera pad's saved views: the list (Alt+1 … 9 or Shift+1 … 9 go to them), saving where the camera is, deleting one.
import { goToView, removeView, saveCurrentView, useSavedViews } from './savedViews'
import { toast } from '../ui'

export function ViewsMenu() {
  const { views, open } = useSavedViews()
  const close = () => useSavedViews.setState({ open: false })
  const save = () => { const name = saveCurrentView(); if (name) toast(`Saved as ${name}: Alt+${useSavedViews.getState().views.length} comes back to it.`, 'ok', 2400) }
  return (
    <div className="menu-wrap">
      <button className={'sm' + (open ? ' on' : '')} title="Saved views (Alt+1 … 9 or Shift+1 … 9)" aria-label="Saved views" aria-expanded={open}
        onClick={() => useSavedViews.setState({ open: !open })}>📍</button>
      {open && (
        <div className="menu views-menu" role="menu" aria-label="Saved views">
          {views.map((v, i) => (
            <div className="row" key={i}>
              <button className="menu-item grow" role="menuitem" title={`Alt+${i + 1}`} onClick={() => { goToView(i); close() }}>
                <span className="faint">{i + 1}</span> {v.name}{v.view.plan && <span className="faint"> · plan</span>}
              </button>
              <button className="sm quiet" aria-label={`Delete ${v.name}`} title="Delete this view" onClick={() => removeView(i)}>✕</button>
            </div>
          ))}
          {!views.length && <span className="small faint" style={{ padding: '6px 8px' }}>No saved views yet.</span>}
          <hr />
          <button className="menu-item" role="menuitem" onClick={save}>+ Save this view</button>
          <span className="small faint" style={{ padding: '2px 8px 6px' }}>Kept in this browser, for this map.</span>
        </div>
      )}
    </div>
  )
}
