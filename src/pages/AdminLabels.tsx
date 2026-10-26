// The labelling desk: the developer's page (admin.ts) for checking and correcting what the catalogue says about every
// model in the game library, fast. One row per model, every judgement editable in place, several at once, from the
// keyboard, with undo; the least sure first when asked. The other reviews (placeholders, placement rules, groups,
// modules) are tabs here too. The labels are this browser's own (labels.ts: game data never leaves the device);
// export and import move them between browsers.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast, toastError } from '../ui'
import { useIsAdmin } from '../lib/admin'
import { useUser } from '../lib/backend'
import { SETTINGS, type WizardSetting } from '../lib/mapWizard'
import { buildIndex, connect, loadIndex, useGameObjects, NeedGameFolder } from '../lib/gameObjects/client'
import { identify, type GameRole, type PropKind } from '../lib/gameObjects/identity'
import { loadCityLabels, loadLabels, setLabels, useGameLabels, withLabels, type GameLabel, type GameLabels } from '../lib/gameObjects/labels'
import type { CatalogEntry, Form, Structure } from '../lib/gameObjects/catalog'
import type { GameObjectEntry } from '../lib/gameObjects/indexer'
import { gamePiecesSuit } from '../lib/gameObjects/wizardPieces'
import { PrefabThumb } from '../editor/PrefabThumb'
import { missingThumbs, resetThumbs } from '../lib/prefabThumbs'
import { FORMS, PlaceholderView, STRUCTURES, useCatalogue } from './CatalogReview'
import { CityView, PlacementView } from './CityReview'
import '../editor/gameObjectActions'

const ROLES: [GameRole, string][] = [['building', 'Building'], ['prop', 'Prop'], ['fence', 'Fence / wall run'], ['piece', 'Part of something'], ['ground', 'Ground / road'], ['skip', 'Never place']]
const KINDS: PropKind[] = ['cover', 'clutter', 'street', 'nature', 'light', 'vehicle', 'sign', 'furniture', 'machine']
const SETTING_KEYS = (Object.keys(SETTINGS) as WizardSetting[]).filter(gamePiecesSuit)
const PAGE = 100
type Tab = 'labels' | 'placeholders' | 'placement' | 'groups' | 'modules'
const TABS: [Tab, string][] = [['labels', 'Labels'], ['placeholders', 'Placeholders'], ['placement', 'Placement rules'], ['groups', 'Groups'], ['modules', 'Modules']]
type Order = 'used' | 'unsure' | 'name'
const UNSURE = 0.6

const checked = (l?: GameLabel) => !!l && (!!l.ok || !!l.role || !!l.kind || !!l.form || !!l.structure || !!l.settings)
const leastSure = (c: CatalogEntry) => Math.min(c.form.sure, c.structure.sure, c.role.sure, c.measures.cover.sure)

export default function AdminLabels() {
  const admin = useIsAdmin()
  const user = useUser()
  const { entries, status, progress, connected } = useGameObjects()
  const [tab, setTab] = useState<Tab>('labels')
  const reload = async () => {
    if (!connected) {
      try { await connect(true) } catch (e) { toastError(e instanceof NeedGameFolder ? new Error('Choose your Saints Reborn folder to see the models.') : e); return }
    }
    const missing = missingThumbs('game:')
    resetThumbs('game:')
    toast(missing ? `Asking again for ${missing} picture${missing === 1 ? '' : 's'} that didn't load.` : 'Pictures reloaded.', 'info', 2500)
  }
  useEffect(() => { void loadIndex().catch(() => {}); void loadLabels(); void loadCityLabels() }, [])

  if (admin === null) return <div className="page"><p className="muted">Checking your account…</p></div>
  if (!admin) {
    return (
      <div className="page">
        <h1>Not found</h1>
        <p className="muted">{user ? 'There is nothing here.' : <>There is nothing here. <Link to="/account">Sign in</Link> if you were sent this link.</>}</p>
      </div>
    )
  }
  return (
    <div className="page">
      <div className="col" style={{ gap: 4 }}>
        <h1 style={{ margin: 0 }}>Labelling desk</h1>
        <p className="muted small" style={{ margin: 0, maxWidth: 900 }}>
          Every model in your game library as the catalogue sees it. Fix anything wrong right on the row, or tick several and change them together.
          Keys: <b>↑ ↓</b> move, <b>Enter</b> right as it is, <b>X</b> tick, <b>Ctrl+Z</b> undo. Your labels stay in this browser and the wizard follows them straight away;
          export them to keep a copy or move them to another browser.
        </p>
      </div>
      {!entries ? (
        <div className="card col" style={{ gap: 8 }}>
          <span>{status === 'indexing' ? `Reading your game (${progress ? `${progress.done}/${progress.total || '…'}` : '…'})…` : 'Your game library isn\'t loaded in this browser yet.'}</span>
          {status !== 'indexing' && <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={() => buildIndex(true).catch(toastError)}>Load my game library</button>}
        </div>
      ) : (
        <>
          <div className="row wrap">
            {TABS.map(([k, name]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{name}</button>)}
            <span className="grow" />
            <button className="sm" onClick={() => void reload()} title="Asks again for every picture that didn't load (and opens your game files if they aren't open)">{connected ? '↻ Reload pictures' : 'Show pictures'}</button>
            <Backup />
          </div>
          {tab === 'labels' && <LabelDesk entries={entries} key={(connected ? 'pictures' : 'none')} />}
          {tab === 'placeholders' && <div className="col" style={{ gap: 10 }} key={'ph' + connected}><PlaceholderView entries={entries} /></div>}
          {tab === 'placement' && <div className="col" style={{ gap: 10 }} key={'pl' + connected}><PlacementView entries={entries} /></div>}
          {(tab === 'groups' || tab === 'modules') && <div className="col" style={{ gap: 10 }} key={tab + connected}><CityView which={tab} entries={entries} /></div>}
        </>
      )}
    </div>
  )
}

/** Export and import the labels as a file (to keep a copy, or move them to another browser). */
function Backup() {
  const { labels } = useGameLabels()
  const file = useRef<HTMLInputElement>(null)
  const exportAll = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ kind: 'sr1-game-labels', version: 1, labels }, null, 1)], { type: 'application/json' }))
    a.download = 'game-labels.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const importFrom = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as { kind?: string; labels?: GameLabels }
      if (data.kind !== 'sr1-game-labels' || !data.labels || typeof data.labels !== 'object') throw new Error('That file isn\'t a labels export.')
      await setLabels(data.labels)
      toast(`Imported ${Object.keys(data.labels).length} labels (merged with the ones here).`, 'ok')
    } catch (e) { toastError(e) }
  }
  return (
    <>
      <button className="sm quiet" onClick={exportAll} disabled={!Object.keys(labels).length}>Export labels</button>
      <button className="sm quiet" onClick={() => file.current?.click()}>Import labels</button>
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFrom(f); e.target.value = '' }} />
    </>
  )
}

function LabelDesk({ entries }: { entries: GameObjectEntry[] }) {
  const { labels } = useGameLabels()
  const cat = useCatalogue(entries)
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries])
  const ident = useMemo(() => withLabels(labels), [labels])
  const [q, setQ] = useState('')
  const [role, setRole] = useState<GameRole | ''>('')
  const [form, setForm] = useState<Form | ''>('')
  const [structure, setStructure] = useState<Structure | ''>('')
  const [show, setShow] = useState<'all' | 'todo' | 'done' | 'unsure'>('todo')
  const [order, setOrder] = useState<Order>('used')
  const [shown, setShown] = useState(PAGE)
  const [focus, setFocus] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // Undo: the labels as they were before each change (one step per change, however many models it touched).
  const undo = useRef<Record<string, GameLabel | null>[]>([])

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out: { c: CatalogEntry; e: GameObjectEntry }[] = []
    for (const c of cat.values()) {
      const e = byId.get(c.id)!
      if (needle && !c.name.toLowerCase().includes(needle) && !c.title.toLowerCase().includes(needle) && !(e.raw ?? []).some((r) => r.toLowerCase().includes(needle))) continue
      if (role && ident(e).role !== role) continue
      if (form && c.form.value !== form) continue
      if (structure && c.structure.value !== structure) continue
      const l = labels[c.id]
      if (show === 'todo' && checked(l)) continue
      if (show === 'done' && !checked(l)) continue
      if (show === 'unsure' && (checked(l) || leastSure(c) >= UNSURE)) continue
      out.push({ c, e })
    }
    const by: Record<Order, (a: { c: CatalogEntry }, b: { c: CatalogEntry }) => number> = {
      used: (a, b) => b.c.use.seen - a.c.use.seen,
      unsure: (a, b) => leastSure(a.c) - leastSure(b.c) || b.c.use.seen - a.c.use.seen,
      name: (a, b) => a.c.name.localeCompare(b.c.name),
    }
    return out.sort((a, b) => by[order](a, b) || a.c.id.localeCompare(b.c.id))
  }, [cat, byId, ident, labels, q, role, form, structure, show, order])
  useEffect(() => { setShown(PAGE); setFocus(0) }, [q, role, form, structure, show, order])

  /** Changes some models' labels, as one undo step. */
  const change = (patch: Record<string, GameLabel | null>) => {
    undo.current.push(Object.fromEntries(Object.keys(patch).map((id) => [id, labels[id] ?? null])))
    if (undo.current.length > 100) undo.current.shift()
    void setLabels(patch)
  }
  const edit = (ids: string[], f: (l: GameLabel) => GameLabel | null) => change(Object.fromEntries(ids.map((id) => [id, f({ ...labels[id] })])))
  const targets = (id: string) => (picked.has(id) && picked.size > 1 ? [...picked] : [id])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      const row = list[focus]
      if (ev.key === 'ArrowDown') { setFocus((f) => Math.min(list.length - 1, f + 1)); ev.preventDefault() }
      else if (ev.key === 'ArrowUp') { setFocus((f) => Math.max(0, f - 1)); ev.preventDefault() }
      else if (ev.key === 'Enter' && row) { edit(targets(row.c.id), (l) => ({ ...l, ok: true })); setFocus((f) => Math.min(list.length - 1, f + 1)); ev.preventDefault() }
      else if ((ev.key === 'x' || ev.key === 'X') && row) setPicked((p) => { const n = new Set(p); if (n.has(row.c.id)) n.delete(row.c.id); else n.add(row.c.id); return n })
      else if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z') {
        const last = undo.current.pop()
        if (last) { void setLabels(last); toast('Undone.', 'info', 1500) }
        ev.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => { document.getElementById('desk-row-' + focus)?.scrollIntoView({ block: 'nearest' }) }, [focus])

  const total = cat.size, done = Object.values(labels).filter(checked).length
  const pickedIds = [...picked]
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
        <input placeholder="Search names" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220 }} />
        <select value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
          <option value="todo">Not checked yet</option><option value="unsure">Least sure, not checked</option><option value="done">Checked by me</option><option value="all">All</option>
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value as GameRole | '')}><option value="">Any role</option>{ROLES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        <select value={form} onChange={(e) => setForm(e.target.value as Form | '')}><option value="">Any form</option>{FORMS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        <select value={structure} onChange={(e) => setStructure(e.target.value as Structure | '')}><option value="">Any structure</option>{STRUCTURES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        <select value={order} onChange={(e) => setOrder(e.target.value as Order)}><option value="used">Most used first</option><option value="unsure">Least sure first</option><option value="name">By name</option></select>
        <span className="grow small muted">{list.length.toLocaleString()} shown · {done.toLocaleString()} of {total.toLocaleString()} checked by you</span>
      </div>
      {pickedIds.length > 0 && (
        <div className="card row wrap" style={{ gap: 6, alignItems: 'center', position: 'sticky', top: 0, zIndex: 2 }}>
          <b className="small">{pickedIds.length} ticked:</b>
          <button className="sm" onClick={() => edit(pickedIds, (l) => ({ ...l, ok: true }))}>✓ All right</button>
          <select className="sm" value="" onChange={(e) => e.target.value && edit(pickedIds, (l) => ({ ...l, ok: undefined, role: e.target.value as GameRole }))}><option value="">Set role…</option>{ROLES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          <select className="sm" value="" onChange={(e) => e.target.value && edit(pickedIds, (l) => ({ ...l, ok: undefined, kind: e.target.value as PropKind }))}><option value="">Set kind…</option>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
          <select className="sm" value="" onChange={(e) => e.target.value && edit(pickedIds, (l) => ({ ...l, ok: undefined, form: e.target.value as Form }))}><option value="">Set form…</option>{FORMS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          <select className="sm" value="" onChange={(e) => e.target.value && edit(pickedIds, (l) => ({ ...l, ok: undefined, structure: e.target.value as Structure }))}><option value="">Set structure…</option>{STRUCTURES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          <select className="sm" value="" onChange={(e) => e.target.value && edit(pickedIds, (l) => { const s = new Set(l.settings ?? []); const v = e.target.value as WizardSetting; if (s.has(v)) s.delete(v); else s.add(v); return { ...l, settings: [...s] } })}>
            <option value="">Toggle setting…</option>{SETTING_KEYS.map((k) => <option key={k} value={k}>{SETTINGS[k].label}</option>)}
          </select>
          <button className="sm quiet" onClick={() => edit(pickedIds, () => null)}>Reset to the rules</button>
          <button className="sm quiet" onClick={() => setPicked(new Set())}>Untick</button>
        </div>
      )}
      <div className="col" style={{ gap: 2 }}>
        {list.slice(0, shown).map(({ c, e }, i) => (
          <Row key={c.id} i={i} c={c} e={e} l={labels[c.id]} rules={identify(e)} id={ident(e)} focused={i === focus} picked={picked.has(c.id)}
            onFocus={() => setFocus(i)} onPick={() => setPicked((p) => { const n = new Set(p); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n })}
            onEdit={(f) => edit(targets(c.id), f)} />
        ))}
      </div>
      {list.length > shown && <button style={{ alignSelf: 'center' }} onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</button>}
    </div>
  )
}

function Row({ i, c, e, l, rules, id, focused, picked, onFocus, onPick, onEdit }: {
  i: number; c: CatalogEntry; e: GameObjectEntry; l?: GameLabel; rules: ReturnType<typeof identify>; id: ReturnType<typeof identify>
  focused: boolean; picked: boolean; onFocus: () => void; onPick: () => void; onEdit: (f: (l: GameLabel) => GameLabel | null) => void
}) {
  const settings = id.settings
  const unsure = (s: number) => (s < UNSURE ? ' warn' : '')
  return (
    <div id={'desk-row-' + i} className={'card row' + (focused ? ' selected' : '')} onClick={onFocus}
      style={{ gap: 10, alignItems: 'center', padding: 6, outline: focused ? '2px solid var(--accent, #d04ca0)' : undefined, background: l?.ok ? 'rgba(80,200,120,0.08)' : undefined }}>
      <input type="checkbox" checked={picked} onChange={onPick} onClick={(ev) => ev.stopPropagation()} title="Tick (X)" />
      <PrefabThumb shape={'game:' + c.id} size={72} />
      <div className="col" style={{ gap: 1, width: 220, minWidth: 0 }}>
        <b className="small">{id.name}</b>
        <span className="faint small mono" style={{ overflowWrap: 'anywhere' }} title={(e.raw ?? []).join(', ')}>{c.name}</span>
        <span className="faint small">{c.measures.long} × {c.measures.short} × {c.measures.height} m · used {c.use.seen}×</span>
      </div>
      <div className="row wrap" style={{ gap: 4, flex: 1, alignItems: 'center' }}>
        <select className={'sm' + unsure(c.role.sure)} value={l?.role ?? ''} title={`Role: ${c.role.why} (${Math.round(c.role.sure * 100)}% sure)`} onChange={(ev) => onEdit((x) => ({ ...x, ok: undefined, role: (ev.target.value || undefined) as GameRole | undefined }))}>
          <option value="">{ROLES.find(([k]) => k === rules.role)?.[1] ?? rules.role} (rules)</option>
          {ROLES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
        {id.role === 'prop' && (
          <select className="sm" value={l?.kind ?? ''} title="Kind of prop" onChange={(ev) => onEdit((x) => ({ ...x, kind: (ev.target.value || undefined) as PropKind | undefined }))}>
            <option value="">{rules.kind ?? '—'} (rules)</option>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        )}
        <select className={'sm' + unsure(c.form.sure)} value={l?.form ?? ''} title={`Form: ${c.form.why} (${Math.round(c.form.sure * 100)}% sure)`} onChange={(ev) => onEdit((x) => ({ ...x, ok: undefined, form: (ev.target.value || undefined) as Form | undefined }))}>
          <option value="">{FORMS.find(([k]) => k === c.form.value)?.[1]}{l?.form ? '' : ' (rules)'}</option>
          {FORMS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
        <select className={'sm' + unsure(c.structure.sure)} value={l?.structure ?? ''} title={`Structure: ${c.structure.why} (${Math.round(c.structure.sure * 100)}% sure)`} onChange={(ev) => onEdit((x) => ({ ...x, ok: undefined, structure: (ev.target.value || undefined) as Structure | undefined }))}>
          <option value="">{STRUCTURES.find(([k]) => k === c.structure.value)?.[1]}{l?.structure ? '' : ' (rules)'}</option>
          {STRUCTURES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
        <div className="row wrap" style={{ gap: 2 }} title="Settings it suits (none: any)">
          {SETTING_KEYS.map((s) => <button key={s} className={'chip' + (settings.includes(s) ? ' accent' : '')} onClick={(ev) => { ev.stopPropagation(); onEdit((x) => ({ ...x, settings: settings.includes(s) ? settings.filter((y) => y !== s) : [...settings, s] })) }}>{SETTINGS[s].label}</button>)}
        </div>
      </div>
      <div className="col" style={{ gap: 3 }}>
        <button className={'sm' + (l?.ok ? ' on' : '')} title="Right as it is (Enter)" onClick={(ev) => { ev.stopPropagation(); onEdit((x) => (x.ok ? { ...x, ok: undefined } : { ...x, ok: true })) }}>✓ Right</button>
        {l && <button className="sm quiet" onClick={(ev) => { ev.stopPropagation(); onEdit(() => null) }} title="Back to what the rules say">Reset</button>}
      </div>
    </div>
  )
}
