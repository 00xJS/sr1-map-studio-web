// The "Describe it" tab of the Start a map dialog: say what you want in a
// sentence; the AI picks the map wizard's options plus a few extra edits,
// you see it from above, and create it (or fine-tune it in the wizard).
import { useEffect, useMemo, useRef, useState } from 'react'
import { LAYOUTS, SETTINGS, busyLabel, busyOf, newSeed, type WizardOptions } from '../lib/mapWizard'
import { askWithRepair, describePrompt, formatReminder, modelProfile, partialReply, setLibraryTextures, stripThinking } from '../lib/aiChat'
import { describeEdit, heuristicPlan, planFromModel, planSample, type MapPlan } from '../lib/aiReview'
import { CITY_SIZES } from '../lib/cityGen'
import { CitySketch } from './CityWizard'
import type { PendingEdits } from '../lib/pendingEdits'
import type { Sample } from '../lib/sampleKit'
import { KeySetup, readKey, readModel } from '../editor/AiKey'
import { loadLibrary } from '../editor/paint'
import { Sketch } from './MapWizard'
import { gameCity, useGameSource } from './BuildWith'

const EXAMPLES = ['A rainy rooftop map with a central tower for 8 players', 'Tight neon arena for 1v1', 'Paintball field with long lanes, 10 players', 'Docks at night with lots of cover']
/** Characters: long, imaginative descriptions are welcome; the model reads all of it. */
const MAX_CHARS = 3000

export function DescribeMap({ busy, onCreate, onTune, game = false }: { busy: boolean; onCreate: (s: Sample, edits?: PendingEdits) => void; onTune: (o: WizardOptions) => void; game?: boolean }) {
  const [text, setText] = useState('')
  const [plan, setPlan] = useState<MapPlan | null>(null)
  const [asking, setAsking] = useState(false)
  const [thought, setThought] = useState('')
  const [error, setError] = useState('')
  const [hasKey, setHasKey] = useState(() => !!readKey())
  const [setup, setSetup] = useState(false)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => { loadLibrary().then((l) => setLibraryTextures(l.map((t) => t.id))).catch(() => {}) }, [])
  // Game pieces (BuildWith.tsx): the wizard builds from the game's models; a whole city is remade with them.
  const src = useGameSource()
  const sample = useMemo(() => {
    if (!plan) return null
    if (!game) return planSample(plan)
    // (A whole city is the site's: more than one map's worth of game models.)
    if (plan.city) return planSample(plan)
    return planSample(plan, gameCity(src, plan.options.setting, plan.options.seed)?.pieces)
  }, [plan, game, src.entries, src.labels, src.version, src.cityLabels])

  const ask = async () => {
    if (!text.trim() || asking) return
    setError('')
    if (!hasKey) { setPlan(heuristicPlan(text)); return }
    setAsking(true)
    setThought('')
    abort.current = new AbortController()
    const model = readModel(), profile = modelProfile(model)
    try {
      const { raw } = await askWithRepair([{ role: 'system', content: describePrompt(profile, text) }, { role: 'user', content: text + formatReminder(profile) }], readKey(), model, { signal: abort.current.signal, profile, onProgress: ({ content, reasoning }) => setThought(partialReply(content) || (reasoning || stripThinking(content) ? 'Thinking' : '')) })
      setPlan(planFromModel(raw, text))
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      // The words alone still make a map.
      setPlan(heuristicPlan(text))
      setError(`The AI couldn't answer (${err instanceof Error ? err.message : String(err)}), so this is a quick guess from your words.`)
    } finally { setAsking(false); abort.current = null }
  }

  if (setup) return <div className="card" style={{ maxWidth: 520 }}><KeySetup onSaved={() => { setHasKey(true); setSetup(false) }} onCancel={() => setSetup(false)} /></div>

  return (
    <div className="wizard">
      <div className="col" style={{ gap: 12, flex: '1 1 300px', minWidth: 0 }}>
        <label className="col" style={{ gap: 6 }}>
          <span className="section-title">Describe your map</span>
          <textarea rows={3} value={text} maxLength={MAX_CHARS} placeholder={EXAMPLES[0]} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask() } }} />
        </label>
        <div className="row wrap">{EXAMPLES.map((x) => <button key={x} className="sm quiet" onClick={() => setText(x)}>{x}</button>)}</div>
        <div className="row wrap">
          {asking
            ? <><span className="muted small ai-thinking">{thought && thought !== 'Thinking' ? thought : thought ? 'Thinking' : 'Planning your map'}</span><button className="sm" onClick={() => abort.current?.abort()}>Stop</button></>
            : <button className="primary" disabled={!text.trim() || busy} onClick={ask}>{plan ? 'Plan again' : 'Plan my map'}</button>}
          {hasKey
            ? <button className="link small" onClick={() => setSetup(true)}>AI key and model</button>
            : <span className="small muted">No AI key yet: you'll get a quick guess from your words. <button className="link small" onClick={() => setSetup(true)}>Add your free NVIDIA key</button> for a smarter plan.</span>}
        </div>
        {error && <span className="small warn">{error}</span>}
        {plan && (
          <div className="col describe-plan card">
            <span>{plan.reply}</span>
            <span className="small muted">
              {plan.city
                ? <>🌆 Whole {CITY_SIZES[plan.city].label.toLowerCase()} · {CITY_SIZES[plan.city].hint}</>
                : <>{SETTINGS[plan.options.setting].icon} {SETTINGS[plan.options.setting].label} · {LAYOUTS[plan.options.layout].label} · {plan.options.players} players · {busyLabel(busyOf(plan.options))}</>}
            </span>
            {!!plan.then.length && (
              <div className="small">
                <span className="muted">Then, once it's built:</span>
                <ul>{plan.then.map((a, i) => <li key={i}>{describeEdit(a)}</li>)}</ul>
              </div>
            )}
            <div className="row wrap">
              <button className="primary" disabled={busy} onClick={() => sample && onCreate({ ...sample, name: plan.options.name || sample.name }, plan.then.length ? { actions: plan.then, label: 'AI: extras for ' + (plan.options.name || sample.name) } : undefined)}>Create this map</button>
              <button disabled={busy} onClick={() => setPlan({ ...plan, options: { ...plan.options, seed: newSeed() } })} title="Same choices, a different map">🎲 Reroll</button>
              {!plan.city && <button className="link small" disabled={busy} onClick={() => onTune(plan.options)}>Fine-tune in the wizard</button>}
            </div>
          </div>
        )}
      </div>
      <div className="col" style={{ gap: 6, flex: '1 1 300px', alignItems: 'stretch', minWidth: 0 }}>
        {sample ? (plan?.city ? <CitySketch s={sample} /> : <Sketch s={sample} />) : <div className="card muted small" style={{ aspectRatio: '1', maxWidth: 420, display: 'grid', placeItems: 'center', textAlign: 'center' }}>Your map's layout shows here, seen from above.</div>}
        {plan && <span className="faint small">{plan.city ? 'Spawns and weapons are spread along the streets.' : 'Fair by design: both halves match, red starts at the top, blue at the bottom.'}{plan.then.length ? ' Extras are added in the editor and undo as one step.' : ''}</span>}
      </div>
    </div>
  )
}
