// Small shared UI pieces: inputs, modals, toasts and confirm dialogs.
import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import type { Vec3 } from './lib/project'

// ---------------- error boundary ----------------

export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="page page-narrow">
        <div className="callout bad"><div className="col">
          <b>{this.props.label || 'Something went wrong'}</b>
          <pre className="small mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{this.state.error.message}</pre>
          <span className="small">Your work is saved in this browser. Reload the page to continue.</span>
          <div className="row"><button onClick={() => location.reload()}>Reload</button></div>
        </div></div>
      </div>
    )
  }
}

// ---------------- toasts ----------------

type Toast = { id: number; text: string; tone: 'info' | 'ok' | 'bad' }
const useToasts = create<{ items: Toast[] }>(() => ({ items: [] }))
let toastId = 1
export function toast(text: string, tone: Toast['tone'] = 'info', ms = 4500) {
  const id = toastId++
  useToasts.setState((s) => ({ items: [...s.items, { id, text, tone }] }))
  setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) })), ms)
}
export const toastError = (err: unknown) => toast(err instanceof Error ? err.message : String(err), 'bad', 8000)

export function Toasts() {
  const items = useToasts((s) => s.items)
  return (
    <div className="toasts" role="status">
      {items.map((t) => <div key={t.id} className={'toast ' + t.tone}>{t.text}</div>)}
    </div>
  )
}

// ---------------- modal / dialogs ----------------

export function Modal(props: { title: ReactNode; onClose?: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose?.() }}>
      <div className={'modal' + (props.wide ? ' wide' : '')} role="dialog" aria-modal="true">
        <header><h2 className="grow">{props.title}</h2>{props.onClose && <button className="quiet icon" onClick={props.onClose} aria-label="Close">✕</button>}</header>
        <div className="content">{props.children}</div>
        {props.footer && <footer>{props.footer}</footer>}
      </div>
    </div>
  )
}

type DialogState = { title: string; body: ReactNode; confirm?: string; cancel?: string | null; danger?: boolean; resolve: (v: boolean) => void } | null
const useDialog = create<{ d: DialogState }>(() => ({ d: null }))

export function confirmDialog(title: string, body: ReactNode, opts: { confirm?: string; cancel?: string | null; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => useDialog.setState({ d: { title, body, ...opts, resolve } }))
}
export const infoDialog = (title: string, body: ReactNode) => confirmDialog(title, body, { confirm: 'OK', cancel: null })

export function Dialogs() {
  const d = useDialog((s) => s.d)
  if (!d) return null
  const close = (v: boolean) => { useDialog.setState({ d: null }); d.resolve(v) }
  return (
    <Modal title={d.title} onClose={() => close(false)} footer={<>
      {d.cancel !== null && <button className="quiet" onClick={() => close(false)}>{d.cancel || 'Cancel'}</button>}
      <button className={d.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>{d.confirm || 'OK'}</button>
    </>}>
      {typeof d.body === 'string' ? <p style={{ whiteSpace: 'pre-wrap' }}>{d.body}</p> : d.body}
    </Modal>
  )
}

// ---------------- inputs ----------------

/** Number field that commits on blur/Enter and supports arrow-key steps. */
export function NumberInput(props: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; digits?: number; title?: string; disabled?: boolean; suffix?: string }) {
  const { value, step = 0.5, digits = 3 } = props
  const fmt = (v: number) => (Number.isFinite(v) ? String(+v.toFixed(digits)) : '')
  const [text, setText] = useState(fmt(value))
  const editing = useRef(false)
  useEffect(() => { if (!editing.current) setText(fmt(value)) }, [value])
  const commit = (raw: string) => {
    const v = parseFloat(raw)
    if (!Number.isFinite(v)) { setText(fmt(value)); return }
    const clamped = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, v))
    if (clamped !== value) props.onChange(clamped)
    setText(fmt(clamped))
  }
  return (
    <input
      type="text" inputMode="decimal" value={text} title={props.title} disabled={props.disabled}
      onFocus={() => { editing.current = true }}
      onBlur={(e) => { editing.current = false; commit(e.target.value) }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const v = (parseFloat(text) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)
          commit(String(v))
        }
      }}
    />
  )
}

export function Vec3Input(props: { value: Vec3; onChange: (v: Vec3) => void; step?: number; disabled?: boolean }) {
  return (
    <div className="vec3">
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <label key={axis} data-axis={axis}>
          <NumberInput value={props.value[i]} step={props.step} disabled={props.disabled} onChange={(v) => {
            const next = [...props.value] as Vec3
            next[i] = v
            props.onChange(next)
          }} />
        </label>
      ))}
    </div>
  )
}

export function Field(props: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return <label className="field"><span>{props.label}</span>{props.children}{props.hint && <span className="hint">{props.hint}</span>}</label>
}

export function Check(props: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean; title?: string }) {
  return (
    <label className="check" title={props.title}>
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.children}</span>
    </label>
  )
}

/** A button that opens a file picker. */
export function FileButton(props: { accept?: string; multiple?: boolean; directory?: boolean; capture?: 'environment' | 'user'; onFiles: (f: File[]) => void; children: ReactNode; className?: string; disabled?: boolean; title?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button className={props.className} disabled={props.disabled} title={props.title} onClick={() => ref.current?.click()}>{props.children}</button>
      <input
        ref={ref} type="file" hidden accept={props.accept} multiple={props.multiple} capture={props.capture}
        {...(props.directory ? { webkitdirectory: '', directory: '' } as any : {})}
        onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) props.onFiles(f) }}
      />
    </>
  )
}

/** Runs an async handler, showing errors as toasts; returns [run, busy]. */
export function useBusy() {
  const [busy, setBusy] = useState(false)
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    try { return await fn() } catch (err) { toastError(err); return undefined } finally { setBusy(false) }
  }
  return [run, busy] as const
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`
  return new Date(iso).toLocaleDateString()
}

export function Avatar({ name, url }: { name: string; url?: string }) {
  return <span className="avatar">{url ? <img src={url} alt="" /> : (name || '?').slice(0, 1).toUpperCase()}</span>
}

/** 00xJS, who rebuilt the studio for the web: bold orange, linked to their GitHub. */
export function ZeroXJS() {
  return <a className="zeroxjs" href="https://github.com/00xJS" target="_blank" rel="noreferrer">00xJS</a>
}

/** Kewizzle's name, as Kewizzle asked for it: fuchsia, and sparkling in every colour on hover (styles.css), linked to his channel. */
export function Kewizzle() {
  return (
    <a className="kewizzle" href="https://www.youtube.com/@kewizzle" target="_blank" rel="noreferrer" title="Kewizzle">
      Kewizzle
      {[1, 2, 3, 4, 5].map((n) => <span key={n} className={`kw-spark kw-s${n}`} aria-hidden>✦</span>)}
    </a>
  )
}
