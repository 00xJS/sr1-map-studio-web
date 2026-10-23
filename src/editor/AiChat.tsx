// "Ask AI": a chat beside the 3D view. Say what you want ("more cover in the
// middle", "four snipers on the rooftops") and the model's edits are applied
// as one undo step. Uses the person's own free NVIDIA API key.
import { useEffect, useRef, useState } from 'react'
import { useEditor } from './store'
import { getViewer } from './Viewport'
import { runAiActions } from './aiActions'
import { DEFAULT_MODEL, KEY_STORE, MODEL_STORE, SUGGESTED_MODELS, askModel, describeMap, parseReply, systemPrompt, type ChatMessage } from '../lib/aiChat'

interface Turn { role: 'user' | 'assistant'; text: string; note?: string; undoLabel?: string; error?: boolean }

const read = (k: string) => { try { return localStorage.getItem(k) || '' } catch { return '' } }
const write = (k: string, v: string) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k) } catch { /* private window */ } }

const IDEAS = ['Add more cover in the middle', 'Put two sniper rifles up high', 'Is this map fair for both teams?', 'Add street lamps along the edges']

function KeySetup({ onSaved, onCancel }: { onSaved: () => void; onCancel?: () => void }) {
  const [key, setKey] = useState(read(KEY_STORE))
  const [model, setModel] = useState(read(MODEL_STORE) || DEFAULT_MODEL)
  const ok = /^nvapi-[\w-]{20,}$/.test(key.trim())
  return (
    <div className="col" style={{ gap: 10 }}>
      <span className="small">The assistant runs on NVIDIA's free AI models. You need your own free key:</span>
      <ol className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
        <li>Sign in at <a href="https://build.nvidia.com" target="_blank" rel="noreferrer">build.nvidia.com</a>.</li>
        <li>Open any model and press <b>Get API Key</b>.</li>
        <li>Paste the key (it starts with <code>nvapi-</code>) here.</li>
      </ol>
      <input type="password" placeholder="nvapi-…" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} aria-label="NVIDIA API key" />
      <label className="col small" style={{ gap: 4 }}>
        <span className="muted">Model</span>
        <input list="ai-models" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
        <datalist id="ai-models">{SUGGESTED_MODELS.map((m) => <option key={m} value={m} />)}</datalist>
      </label>
      <span className="faint small">Your key stays in this browser. Each message goes through this site's relay to NVIDIA with the key attached; the relay keeps nothing. Free keys have a rate limit, so slow down if it complains.</span>
      <div className="row">
        <button className="primary sm" disabled={!ok} onClick={() => { write(KEY_STORE, key.trim()); write(MODEL_STORE, model.trim() === DEFAULT_MODEL ? '' : model.trim()); onSaved() }}>Save</button>
        {onCancel && <button className="sm quiet" onClick={onCancel}>Cancel</button>}
        <span className="spacer" />
        {read(KEY_STORE) && <button className="sm quiet danger" onClick={() => { write(KEY_STORE, ''); setKey('') }}>Forget key</button>}
      </div>
    </div>
  )
}

export function AiChat({ onClose }: { onClose: () => void }) {
  const [hasKey, setHasKey] = useState(() => !!read(KEY_STORE))
  const [setup, setSetup] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const history = useRef<ChatMessage[]>([])
  const abort = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) }, [turns, busy])
  useEffect(() => () => abort.current?.abort(), [])

  const send = async (msg: string) => {
    const project = useEditor.getState().project
    if (!msg.trim() || busy || !project) return
    setText('')
    setTurns((t) => [...t, { role: 'user', text: msg }])
    setBusy(true)
    abort.current = new AbortController()
    try {
      const viewer = getViewer()
      const map = describeMap(project, viewer ? (i) => viewer.itemBounds(i) : undefined)
      // The map summary is fresh every turn; the last few exchanges give context.
      const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt(map) }, ...history.current.slice(-10), { role: 'user', content: msg }]
      const raw = await askModel(messages, read(KEY_STORE), read(MODEL_STORE) || DEFAULT_MODEL, abort.current.signal)
      const { reply, actions } = parseReply(raw)
      history.current.push({ role: 'user', content: msg }, { role: 'assistant', content: raw })
      let note: string | undefined, undoLabel: string | undefined
      if (actions.length) {
        undoLabel = 'AI: ' + (msg.length > 40 ? msg.slice(0, 40) + '…' : msg)
        const { done, skipped } = await runAiActions(actions, undoLabel)
        note = [done ? `Made ${done} change${done === 1 ? '' : 's'}.` : 'Nothing changed.', skipped.length ? `Skipped: ${skipped.join('; ')}.` : ''].filter(Boolean).join(' ')
        if (!done) undoLabel = undefined
      }
      setTurns((t) => [...t, { role: 'assistant', text: reply || (actions.length ? 'Done.' : '…'), note, undoLabel }])
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setTurns((t) => [...t, { role: 'assistant', text: err instanceof Error ? err.message : String(err), error: true }])
    } finally { setBusy(false) }
  }

  const undo = (label: string) => {
    const st = useEditor.getState()
    if (st.past[st.past.length - 1]?.label === label) st.undo()
  }
  const lastUndo = useEditor((s) => s.past[s.past.length - 1]?.label)

  return (
    <div className="ai-chat" role="dialog" aria-label="Map assistant">
      <div className="row ai-head">
        <b className="grow">✨ Map assistant</b>
        {hasKey && !setup && <button className="sm quiet" onClick={() => setSetup(true)} title="Key and model">⚙</button>}
        <button className="sm quiet" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {!hasKey || setup ? (
        <div className="ai-body"><KeySetup onSaved={() => { setHasKey(true); setSetup(false) }} onCancel={hasKey ? () => setSetup(false) : undefined} /></div>
      ) : (
        <>
          <div className="ai-body ai-list" ref={listRef}>
            {!turns.length && (
              <div className="col" style={{ gap: 8 }}>
                <span className="small muted">Tell me what to change or ask about your map. Edits apply right away and undo as one step.</span>
                <div className="row wrap">{IDEAS.map((i) => <button key={i} className="sm quiet" onClick={() => send(i)}>{i}</button>)}</div>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={'ai-msg ' + t.role + (t.error ? ' error' : '')}>
                <div>{t.text}</div>
                {t.note && <div className="faint small">{t.note}</div>}
                {t.undoLabel && lastUndo === t.undoLabel && <button className="link small" onClick={() => undo(t.undoLabel!)}>Undo this</button>}
              </div>
            ))}
            {busy && <div className="ai-msg assistant faint">Thinking…</div>}
          </div>
          <div className="ai-input row">
            <textarea rows={2} value={text} placeholder="e.g. add a bus stop on each side" onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text) } }} aria-label="Message" />
            <button className="primary sm" disabled={busy || !text.trim()} onClick={() => send(text)}>Send</button>
          </div>
        </>
      )}
    </div>
  )
}
