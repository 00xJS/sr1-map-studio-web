// "Ask AI": a chat beside the 3D view. Say what you want ("more cover in the
// middle", "four snipers on the rooftops") and the model's edits are applied
// as one undo step; ask "is this map fair?" for a review with one-click fixes;
// ask for a new map and it is built and opened. Uses the person's own free
// NVIDIA API key, streamed so the answer shows as it arrives.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEditor, saveNow } from './store'
import { getViewer } from './Viewport'
import { aiMiddle, runAiActions, stopAiEdits, useAiRunning } from './aiActions'
import { AiApplyingNote } from './AiApplyingNote'
import { useChat, type Turn } from './aiSession'
import { KeySetup, readKey, readModel } from './AiKey'
import { loadLibrary } from './paint'
import {
  askWithRepair, critiquePrompt, relevantGameObjects, describeMap, formatReminder, modelProfile, parseReply, partialReply, setLibraryTextures, stripThinking, systemPrompt,
  type AiAction, type ChatMessage,
} from '../lib/aiChat'
import { useGameObjects } from '../lib/gameObjects/client'
import { tagsOf } from '../lib/gameObjects/tags'
import { buildReview, isCritiqueRequest, planFromAction, planSample } from '../lib/aiReview'
import { factsText, gatherFacts } from '../lib/mapFacts'
import { queueEdits } from '../lib/pendingEdits'
import { db, requestPersistence } from '../lib/db'

const IDEAS = ['Add more cover in the middle', 'Put two sniper rifles up high', 'Paint the walls red brick', 'Make a new rainy rooftop map for 8 players']

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError'
const tail = (s: string, n = 600) => (s.length > n ? '…' + s.slice(-n) : s)
/** A <think> block that is still being written, from a model that thinks out loud in its answer. */
const openThought = (content: string) => { const m = content.match(/<think>([\s\S]*?)(<\/think>|$)/i); return m && !m[2] ? m[1] : '' }

const VERDICT_ICON = { good: '✅', ok: '⚠️', bad: '⛔' } as const

export function ReviewCard({ turn }: { turn: Turn }) {
  const r = turn.review!
  const patch = useChat((s) => s.patch)
  const [busy, setBusy] = useState(false)
  // A fix of this card being applied (in the store, so it shows again when the chat is reopened).
  // Keyed by its place in the card (section, fix), so two fixes with the same name are two fixes.
  const fixKey = (place: string) => `fix:${turn.id}:${place}`
  const running = useAiRunning().filter((r) => r.key.startsWith(`fix:${turn.id}:`)).map((r) => r.key)
  const apply = async (label: string, place: string, actions: AiAction[]) => {
    setBusy(true)
    patch(turn.id, { note: `${label}: applying…` })
    try {
      const { done, skipped, stopped } = await runAiActions(actions, 'AI fix: ' + label, { key: fixKey(place) })
      // Stopped before any change, it can be tried again; stopped partway, running it again would add its changes
      // twice, so it isn't offered again.
      const t = useChat.getState().turns.find((x) => x.id === turn.id) ?? turn
      patch(turn.id, {
        ...(!stopped ? { applied: [...(t.applied ?? []), label] } : done ? { partly: [...(t.partly ?? []), place] } : {}),
        note: `${label}: ${done ? `made ${done} change${done === 1 ? '' : 's'}` : 'nothing changed'}${skipped.length ? `; skipped ${skipped.join('; ')}` : ''}.` })
    } finally { setBusy(false) }
  }
  return (
    <div className="ai-review col">
      {r.score !== null && <div className="small"><b>Score {r.score}/10</b></div>}
      {r.sections.map((s, si) => (
        <div key={s.topic} className={'ai-review-row ' + s.verdict}>
          <div className="row"><span aria-hidden>{VERDICT_ICON[s.verdict]}</span><b className="grow">{s.title}</b></div>
          {s.notes.map((n, i) => <div key={i} className="small muted">{n}</div>)}
          {!!s.fixes.length && (
            <div className="row wrap">
              {s.fixes.map((f, fi) => running.includes(fixKey(`${si}:${fi}`))
                ? <button key={fi} className="sm" onClick={() => stopAiEdits(fixKey(`${si}:${fi}`))} title={"Stop making the AI's changes: the ones made so far stay"}>Cancel {f.label}</button>
                : turn.partly?.includes(`${si}:${fi}`)
                  ? <button key={fi} className="sm" disabled title="Stopped partway: the changes it made stay (Undo takes them back). Ask the AI again to finish it.">◐ {f.label}</button>
                  : (
                    <button key={fi} className="sm" disabled={busy || running.length > 0 || turn.applied?.includes(f.label)} onClick={() => apply(f.label, `${si}:${fi}`, f.actions)} title={`${f.actions.length} edit${f.actions.length === 1 ? '' : 's'}, one undo step`}>
                      {turn.applied?.includes(f.label) ? '✓ ' : '🔧 '}{f.label}
                    </button>
                  ))}
            </div>
          )}
        </div>
      ))}
      {!r.byModel && <span className="faint small">From the editor's own measurements.</span>}
    </div>
  )
}

export function AiChat({ onClose }: { onClose: () => void }) {
  const nav = useNavigate()
  const [hasKey, setHasKey] = useState(() => !!readKey())
  const [setup, setSetup] = useState(false)
  const { turns, add, patch } = useChat()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  /** Waiting on the model (Stop works), as opposed to applying its edits. */
  const [asking, setAsking] = useState(false)
  /** The chat's reply's edits, or a new map's AI extras, being made or waiting their turn: Cancel stops them (and only
   *  them). Kept in the store, so closing the chat doesn't lose it. */
  const applying = useAiRunning().some((r) => r.key === 'chat' || r.key === 'extras')
  const abort = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) }, [turns])
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => { loadLibrary().then((l) => setLibraryTextures(l.map((t) => t.id))).catch(() => {}) }, [])

  /** Builds the map a generate_map edit asks for, saves it, and opens it; its extra edits run once it's loaded. */
  const newMap = async (a: Extract<AiAction, { do: 'generate_map' }>, reply: string, id: number) => {
    const plan = planFromAction(a, reply)
    patch(id, { text: `${plan.reply || 'Making a new map.'} Building “${plan.options.name}”…`, pending: true, thinking: undefined })
    const { buildFrom } = await import('../lib/samples')
    const sample = planSample(plan)
    const p = await buildFrom({ ...sample, name: plan.options.name || sample.name }, (t) => patch(id, { note: t }))
    await db.putProject({ id: p.id, name: p.name, updated_at: p.updated_at, project: p })
    void requestPersistence()
    if (plan.then.length) queueEdits(p.id, { actions: plan.then, label: 'AI: extras for ' + p.name, openChat: true })
    patch(id, { pending: false, text: `${plan.reply || 'Here is your new map.'} Opened “${p.name}”; your other map is saved in My maps.`, note: `${plan.city ? `whole ${plan.city}` : `${plan.options.setting}, ${plan.options.layout}, ${plan.options.players} players, ${plan.options.density}`}${plan.then.length ? ` · ${plan.then.length} extra edit${plan.then.length === 1 ? '' : 's'} to come` : ''}` })
    if (useEditor.getState().saveState === 'unsaved') await saveNow()
    nav('/editor/' + p.id)
  }

  const send = async (msg: string) => {
    const project = useEditor.getState().project
    // Enter and the idea buttons too: a second reply would queue behind the one being applied.
    if (!msg.trim() || busy || applying || !project) return
    setText('')
    add({ role: 'user', text: msg })
    const id = add({ role: 'assistant', text: '', pending: true })
    setBusy(true)
    setAsking(true)
    abort.current = new AbortController()
    const model = readModel()
    const profile = modelProfile(model)
    const critique = isCritiqueRequest(msg)
    const viewer = getViewer()
    const bounds = viewer ? (i: number) => viewer.itemBounds(i) : undefined
    const facts = critique ? gatherFacts({ project, bounds }) : null
    try {
      const map = describeMap(project, bounds, aiMiddle())
      // The request and the one before it pick which prefabs the model is told about in full.
      const asked = [...useChat.getState().history.filter((h) => h.role === 'user').slice(-1).map((h) => h.content), msg].join(' ')
      const game = relevantGameObjects((useGameObjects.getState().entries ?? []).map((e) => ({ ...e, tags: tagsOf(e) })), asked)
      const system = critique ? critiquePrompt(map, factsText(facts!), profile) : systemPrompt(map, profile, asked, game)
      // The map summary is fresh every turn; the last few exchanges give context.
      const messages: ChatMessage[] = [{ role: 'system', content: system }, ...useChat.getState().history.slice(-10), { role: 'user', content: msg + formatReminder(profile) }]
      const { raw, repaired } = await askWithRepair(messages, readKey(), model, {
        signal: abort.current.signal,
        profile,
        onProgress: ({ content, reasoning }) => {
          const thought = reasoning || openThought(content)
          const shown = partialReply(content)
          patch(id, { text: shown, thinking: shown ? undefined : thought ? tail(thought) : '' })
        },
        onRepair: () => patch(id, { text: '', thinking: '', note: 'Tidying up the answer…' }),
      })
      setAsking(false)
      useChat.setState((s) => ({ history: [...s.history, { role: 'user', content: msg }, { role: 'assistant', content: stripThinking(raw).slice(0, 6000) }] }))
      if (critique) {
        const review = buildReview(facts!, raw)
        patch(id, { pending: false, thinking: undefined, text: review.summary, review, note: repaired ? 'The first answer was garbled; asked again.' : undefined })
        return
      }
      const { reply, actions } = parseReply(raw)
      const gen = actions.find((a): a is Extract<AiAction, { do: 'generate_map' }> => a.do === 'generate_map')
      if (gen) { await newMap(gen, reply, id); return }
      let note: string | undefined, undoLabel: string | undefined
      if (actions.length) {
        undoLabel = 'AI: ' + (msg.length > 40 ? msg.slice(0, 40) + '…' : msg)
        patch(id, { pending: false, thinking: undefined, text: reply || 'Working on it.', note: 'Applying…' })
        const { done, skipped } = await runAiActions(actions, undoLabel, { key: 'chat' })
        note = [done ? `Made ${done} change${done === 1 ? '' : 's'}.` : 'Nothing changed.', skipped.length ? `Skipped: ${skipped.join('; ')}.` : ''].filter(Boolean).join(' ')
        if (!done) undoLabel = undefined
      }
      if (repaired) note = ['The first answer was garbled; asked again.', note].filter(Boolean).join(' ')
      patch(id, { pending: false, thinking: undefined, text: reply || (actions.length ? 'Done.' : '…'), note, undoLabel })
    } catch (err) {
      if (isAbort(err)) { patch(id, { pending: false, thinking: undefined, text: useChat.getState().turns.find((t) => t.id === id)?.text || 'Stopped.', note: 'Stopped. Nothing was changed.' }); return }
      const message = err instanceof Error ? err.message : String(err)
      // A review still works without the model: the measurements and their fixes.
      if (facts) { const review = buildReview(facts); patch(id, { pending: false, thinking: undefined, text: review.summary, review, note: `The AI couldn't answer (${message}), so this is the editor's own check.` }); return }
      patch(id, { pending: false, thinking: undefined, text: message, error: true })
    } finally { setBusy(false); setAsking(false); abort.current = null }
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
        {hasKey && !setup && !!turns.length && <button className="sm quiet" disabled={busy || applying} onClick={() => useChat.getState().clear()} title="Start a new conversation">New chat</button>}
        {hasKey && !setup && <button className="sm quiet" onClick={() => setSetup(true)} title="Key and model">⚙</button>}
        <button className="sm quiet" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {!hasKey || setup ? (
        <div className="ai-body"><AiApplyingNote inline /><KeySetup onSaved={() => { setHasKey(true); setSetup(false) }} onCancel={hasKey ? () => setSetup(false) : undefined} /></div>
      ) : (
        <>
          <div className="ai-body ai-list" ref={listRef} aria-live="polite">
            {!turns.length && (
              <div className="col" style={{ gap: 8 }}>
                <span className="small muted">Tell me what to change or ask about your map. Edits apply right away and undo as one step.</span>
                <div className="row wrap">
                  <button className="sm" disabled={busy || applying} onClick={() => send('Critique my map: is it fair for both teams?')}>🩺 Review my map</button>
                  {IDEAS.map((i) => <button key={i} className="sm quiet" disabled={busy || applying} onClick={() => send(i)}>{i}</button>)}
                </div>
              </div>
            )}
            {turns.map((t) => (
              <div key={t.id} className={'ai-msg ' + t.role + (t.error ? ' error' : '')}>
                {t.pending && !t.text && <div className="faint ai-thinking">{t.thinking ? 'Thinking…' : 'Working…'}</div>}
                {t.pending && t.thinking && !t.text && <div className="faint small ai-thought">{t.thinking}</div>}
                {t.text && <div>{t.text}</div>}
                {t.review && <ReviewCard turn={t} />}
                {t.note && <div className="faint small">{t.note}</div>}
                {t.undoLabel && lastUndo === t.undoLabel && <button className="link small" onClick={() => undo(t.undoLabel!)}>Undo this</button>}
              </div>
            ))}
          </div>
          <div className="ai-input row">
            <textarea rows={2} value={text} placeholder="e.g. add a bus stop on each side" onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text) } }} aria-label="Message" />
            {asking
              ? <button className="sm" onClick={() => abort.current?.abort()} title="Stop the answer">■ Stop</button>
              : applying
                ? <button className="sm" onClick={() => stopAiEdits('chat', 'extras')} title="Stop making the AI's changes: the ones made so far stay">Cancel</button>
                : <button className="primary sm" disabled={busy || !text.trim()} onClick={() => send(text)}>{busy ? 'Working…' : 'Send'}</button>}
          </div>
        </>
      )}
    </div>
  )
}
