// "More settings": a fold for the settings most maps never need. Each one remembers being open (per kind, in
// this browser), and "Show all settings" opens every one of them.
import { useEffect, useId, useState, type ReactNode } from 'react'
import { readFlag, useEditor, writeFlag } from './store'

const OPEN = 'sr1-more-open'
/** Opens a More settings fold, now and when it next shows (the command palette's "go to this setting"). */
export function openMore(id: string) {
  writeFlag('sr1-more-' + id, true)
  window.dispatchEvent(new CustomEvent(OPEN, { detail: id }))
}

export function More({ id, title = 'More settings', children }: { id: string; title?: ReactNode; children: ReactNode }) {
  const all = useEditor((s) => s.allSettings)
  const key = 'sr1-more-' + id
  const [open, setOpen] = useState(() => all || readFlag(key))
  useEffect(() => { setOpen(all || readFlag(key)) }, [all, key])
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail === id) setOpen(true) }
    window.addEventListener(OPEN, on)
    return () => window.removeEventListener(OPEN, on)
  }, [id])
  const body = useId()
  const toggle = () => { writeFlag(key, !open); setOpen(!open) }
  return (
    <div className={'more-fold' + (open ? ' open' : '')}>
      <button type="button" className="quiet more-toggle" aria-expanded={open} aria-controls={body} onClick={toggle}>
        <span aria-hidden>{open ? '▾' : '▸'}</span>{title}
      </button>
      {open && <div id={body} className="stack">{children}</div>}
    </div>
  )
}

/** A long explanation behind a small "Why?" link. */
export function Why({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="link why" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Why?'}</button>
      {open && <span className="why-text">{children}</span>}
    </>
  )
}
