// The person's own NVIDIA key and model choice, kept in this browser only.
import { useState } from 'react'
import { DEFAULT_MODEL, KEY_STORE, MODEL_STORE, SUGGESTED_MODELS } from '../lib/aiChat'

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
      <label className="col small" style={{ gap: 4 }}>
        <span className="muted">Model</span>
        <input list="ai-models" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
        <datalist id="ai-models">{SUGGESTED_MODELS.map((m) => <option key={m} value={m} />)}</datalist>
        <span className="faint">Thinking models (Nemotron Super, Kimi) take longer but plan bigger edits better.</span>
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
