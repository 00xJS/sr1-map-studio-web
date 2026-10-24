// The person's own NVIDIA key and model choice, kept in this browser only.
import { useEffect, useState } from 'react'
import { DEFAULT_MODEL, KEY_STORE, MODEL_STORE, SUGGESTED_MODELS, listModels, modelProfile } from '../lib/aiChat'

const read = (k: string) => { try { return localStorage.getItem(k) || '' } catch { return '' } }
const write = (k: string, v: string) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k) } catch { /* private window */ } }

export const readKey = () => read(KEY_STORE)
export const readModel = () => read(MODEL_STORE) || DEFAULT_MODEL

export function KeySetup({ onSaved, onCancel }: { onSaved: () => void; onCancel?: () => void }) {
  const [key, setKey] = useState(read(KEY_STORE))
  const [model, setModel] = useState(readModel())
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
      <ModelPicker model={model} onChange={setModel} />
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

/** NVIDIA's chat models, loaded live and searchable, plus a box for any model id. */
function ModelPicker({ model, onChange }: { model: string; onChange: (m: string) => void }) {
  const [models, setModels] = useState<string[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  useEffect(() => {
    const ctl = new AbortController()
    listModels(ctl.signal).then(setModels, () => { if (!ctl.signal.aborted) setFailed(true) })
    return () => ctl.abort()
  }, [])
  const id = model.trim()
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = (models ?? []).filter((m) => words.every((w) => m.toLowerCase().includes(w)))
  const gone = models && id && !models.includes(id)
  return (
    <div className="col small" style={{ gap: 4 }}>
      <span className="muted">Model</span>
      <input value={model} onChange={(e) => onChange(e.target.value)} placeholder="publisher/model-name" spellCheck={false} aria-label="Model id" />
      {gone && <span className="warn">NVIDIA's API doesn't list <code>{id}</code> right now, so it may not answer. Check the spelling, or pick one below.</span>}
      {models ? <>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${models.length} chat models…`} aria-label="Search models" />
        <div className="model-list" role="listbox" aria-label="NVIDIA chat models">
          {shown.map((m) => {
            const tier = modelProfile(m).tier
            return (
              <button key={m} role="option" aria-selected={m === id} className={'model-row' + (m === id ? ' on' : '')} onClick={() => onChange(m)}>
                <span>{m}</span>
                {SUGGESTED_MODELS.includes(m) && <span className="tag">{m === DEFAULT_MODEL ? 'default' : 'good pick'}</span>}
                {tier === 'reasoning' && <span className="tag">thinks first</span>}
                {tier === 'small' && <span className="tag">small</span>}
              </button>
            )
          })}
          {!shown.length && <span className="faint" style={{ padding: 6 }}>No model matches “{query}”.</span>}
        </div>
      </> : <span className="faint">{failed ? "Couldn't load NVIDIA's list; type the model id above." : "Loading NVIDIA's models…"}</span>}
      <span className="faint">
        Found one on build.nvidia.com? Its id is the <code>model</code> line in the page's code sample (like <code>moonshotai/kimi-k2.6</code>); paste it above.
        Models missing here (image, speech, embedding and download-only ones) can't chat through NVIDIA's free API.
        Thinking models take longer but plan bigger edits better.
      </span>
    </div>
  )
}
