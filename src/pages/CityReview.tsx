// "Check game pieces": the placement rules, groups and modules views. Placement rules: each model's rule (where it
// goes, which way it faces, what it is never placed without, its own building, floor in front, how it is reached,
// what may vary, cover) next to its picture and how the game itself places it, with every part of the rule
// correctable. Groups and modules: the city's recurring arrangements and real pieces of Stilwater (cityModules.ts)
// drawn assembled, to mark right, leave out, rename or re-sort. Corrections stay in this browser (labels.ts) and
// override the rules. Until the Stilwater study fills groups() and cityModules() in, development builds show
// made-up samples (citySamples.ts).
import { useEffect, useMemo, useRef, useState } from 'react'
import { SETTINGS, type WizardSetting } from '../lib/mapWizard'
import type { GameObjectEntry } from '../lib/gameObjects/indexer'
import { CATEGORIES, identify } from '../lib/gameObjects/identity'
import { cityModules, groups, type CityGroup, type CityModule, type GroupKind, type ModuleKind, type PlacementRule, type Side } from '../lib/gameObjects/cityModules'
import { placementRule, type Library } from '../lib/gameObjects/placement'
import { SIDES, OPEN_MAX } from '../lib/gameObjects/sits'
import { fixRule, setCityLabels, setLabels, useCityLabels, useGameLabels, type CityLabel, type GameLabel, type PlacementFix } from '../lib/gameObjects/labels'
import { sampleGroups, sampleModules } from '../lib/gameObjects/citySamples'
import { assemble, snapshot, type PlacedPart } from '../lib/gameObjects/compose'
import { PrefabThumb } from '../editor/PrefabThumb'

const PAGE = 36
type Attach = PlacementRule['attach']
type Vary = PlacementRule['mayVary'][number]
const ATTACH: [Attach, string][] = [['ground', 'On the ground'], ['wall', 'On a wall'], ['roof', 'On a roof'], ['hang', 'Hanging'], ['building', 'Only on its own building']]
const ATTACH_NAME = Object.fromEntries(ATTACH) as Record<Attach, string>
const VARY: [Vary, string][] = [['turn', 'turn'], ['mirror', 'mirror'], ['variant', 'swap variant'], ['nudge', 'nudge']]
const REACH: NonNullable<PlacementRule['reach']>[] = ['stairs', 'ramp', 'ladder']

/** The rules for every model, worked out a slice at a time so the page stays responsive. */
function useRules(entries: GameObjectEntry[]): { rules: Map<string, PlacementRule>; done: boolean; lib: Library } {
  const lib = useMemo<Library>(() => new Map(entries.map((e) => [e.id, e])), [entries])
  const [state, setState] = useState<{ rules: Map<string, PlacementRule>; done: boolean }>({ rules: new Map(), done: false })
  useEffect(() => {
    let off = false, i = 0
    const rules = new Map<string, PlacementRule>()
    const step = () => {
      if (off) return
      const end = Math.min(entries.length, i + 1500)
      for (; i < end; i++) rules.set(entries[i].id, placementRule(entries[i], lib))
      // (A new map each time, so what is worked out from it is worked out again.)
      setState({ rules: new Map(rules), done: i >= entries.length })
      if (i < entries.length) setTimeout(step, 0)
    }
    step()
    return () => { off = true }
  }, [entries, lib])
  return { ...state, lib }
}

const isFixed = (l?: GameLabel) => !!l?.place && Object.keys(l.place).some((k) => k !== 'ok')

/** Placement rules: each model's rule with its picture, and corrections. */
export function PlacementView({ entries }: { entries: GameObjectEntry[] }) {
  const { labels } = useGameLabels()
  const { rules, done, lib } = useRules(entries)
  const [attach, setAttach] = useState<Attach | 'all'>('all')
  const [cat, setCat] = useState('')
  const [show, setShow] = useState<'all' | 'todo' | 'done'>('all')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  useEffect(() => setShown(PAGE), [attach, cat, show, q])
  // Corrected models stay in view (under their old filter) until the page is left, so a change can be undone.
  const [touched, setTouched] = useState<string[]>([])
  const list = useMemo(() => {
    const word = q.trim().toLowerCase()
    return entries.filter((e) => {
      const r = rules.get(e.id)
      if (!r || identify(e).role === 'skip') return false
      const l = labels[e.id]
      const now = l?.place ? fixRule(r, l.place) : r
      if (attach !== 'all' && now.attach !== attach && !(touched.includes(e.id) && r.attach === attach)) return false
      if (cat && e.cat !== cat) return false
      if (show !== 'all' && (show === 'done') !== !!l?.place) return false
      return !word || [e.name, identify(e).name, ...(e.raw ?? [])].some((n) => n.toLowerCase().includes(word))
    }).sort((a, b) => b.seen - a.seen)
  }, [entries, rules, labels, attach, cat, show, q, touched])
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const e of entries) { const r = rules.get(e.id); if (r && identify(e).role !== 'skip') c[r.attach] = (c[r.attach] ?? 0) + 1 }
    return c
  }, [entries, rules])
  const checked = Object.values(labels).filter((l) => l.place).length
  const fix = (id: string, place: PlacementFix | null) => {
    setTouched((t) => (t.includes(id) ? t : [id, ...t]))
    const kept = place ? Object.fromEntries(Object.entries(place).filter(([, v]) => v !== undefined)) as PlacementFix : null
    void setLabels({ [id]: { ...labels[id], place: kept && Object.keys(kept).length ? kept : undefined } })
  }
  return (
    <>
      <p className="muted" style={{ margin: 0, maxWidth: 860 }}>
        How each model is placed: on the ground, on a wall facing out, on a roof, hanging, or only on its own building; what it's never placed without,
        the floor it needs in front, and what may change when it's placed. Worked out from where your game puts each one in Stilwater. Fix what's wrong:
        your corrections override the rules.
      </p>
      <div className="row wrap">
        <button className={'sm' + (attach === 'all' ? ' on' : '')} onClick={() => setAttach('all')}>All</button>
        {ATTACH.map(([a, name]) => <button key={a} className={'sm' + (attach === a ? ' on' : '')} onClick={() => setAttach(a)}>{name} <span className="faint">{counts[a] ?? 0}</span></button>)}
      </div>
      <div className="row wrap" style={{ alignItems: 'center' }}>
        <select className="sm" value={cat} onChange={(ev) => setCat(ev.target.value)} title="Library category">
          <option value="">Every category</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="sm" placeholder="Search names" value={q} onChange={(ev) => setQ(ev.target.value)} style={{ width: 170 }} />
        {(['all', 'todo', 'done'] as const).map((k) => <button key={k} className={'sm quiet' + (show === k ? ' on' : '')} onClick={() => setShow(k)}>{{ all: 'All', todo: 'Not checked', done: 'Checked' }[k]}</button>)}
        <span className="grow small muted">{done ? `${list.length.toLocaleString()} models` : `Working out the rules (${rules.size.toLocaleString()}/${entries.length.toLocaleString()})…`} · {checked} checked by you</span>
      </div>
      <div className="label-grid wide">
        {list.slice(0, shown).map((e) => <PlacementTile key={e.id} e={e} rule={rules.get(e.id)!} l={labels[e.id]} lib={lib} onFix={(p) => fix(e.id, p)} />)}
      </div>
      {list.length > shown && <button style={{ alignSelf: 'center' }} onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</button>}
    </>
  )
}

const r1 = (v: number) => Math.round(v * 10) / 10
const nameOf = (lib: Library, id: string) => { const e = lib.get(id); return e ? identify(e).name : 'missing model' }

/** How the game places it, in words. */
function evidence(e: GameObjectEntry): string {
  const s = e.sits
  if (!s?.n) return 'Not seen in a street the game could be read around: the rule goes by its name and shape.'
  const parts = ([['ground', 'on a floor or the ground'], ['wall', 'on a wall'], ['roof', 'on a roof'], ['hang', 'hanging']] as const).filter(([k]) => s[k]).map(([k, w]) => `${s[k]} ${w}`)
  const backs = SIDES.map((side, i) => [side, s.back[i]] as const).filter(([, n]) => n).map(([side, n]) => `${side} ${n}`)
  return `Looked at ${s.n} of its ${e.seen} placements: ${parts.join(', ')}.${backs.length ? ` Wall behind ${backs.join(', ')}.` : ''}${s.lift >= 1 ? ` About ${s.lift} m above the ground.` : ''}${s.ceiling ? ` Ceiling right over it ${s.ceiling}×.` : ''}`
}

function PlacementTile({ e, rule: base, l, lib, onFix }: { e: GameObjectEntry; rule: PlacementRule; l?: GameLabel; lib: Library; onFix: (p: PlacementFix | null) => void }) {
  const id = identify(e)
  const place = l?.place
  const rule = place ? fixRule(base, place) : base
  const [more, setMore] = useState(false)
  const [view, setView] = useState<'thumb' | 'front' | 'parts'>('thumb')
  const set = (patch: PlacementFix) => onFix({ ...place, ok: undefined, ...patch })
  const size = e.size.map((v) => +v.toFixed(1)).join(' × ')
  const facingSide = rule.facing ? SIDES.indexOf(rule.facing) : -1
  const parts = useMemo(() => partsWith(e, rule, lib), [e, rule, lib])
  return (
    <div className={'label-tile' + (place?.ok ? ' ok' : isFixed(l) ? ' fixed' : '')}>
      <div className="col" style={{ gap: 4 }}>
        {view === 'thumb' ? <PrefabThumb shape={'game:' + e.id} size={120} /> : <Picture key={view} parts={view === 'parts' ? parts : [{ id: e.id, at: [0, 0, 0], yaw: 0 }]} lib={lib} px={120} side={view === 'front' ? rule.facing : undefined} />}
        <div className="row wrap" style={{ gap: 3 }}>
          {rule.facing && <button className={'sm quiet' + (view === 'front' ? ' on' : '')} title="Look straight at the side it faces out with" onClick={() => setView(view === 'front' ? 'thumb' : 'front')}>Front</button>}
          {parts.length > 1 && <button className={'sm quiet' + (view === 'parts' ? ' on' : '')} title="With the models it's never placed without, where the game puts them" onClick={() => setView(view === 'parts' ? 'thumb' : 'parts')}>With parts</button>}
        </div>
      </div>
      <div className="col" style={{ gap: 3, minWidth: 0 }}>
        <b className="small" title={e.raw?.join(', ') || e.name}>{id.name}</b>
        <span className="faint small mono" style={{ overflowWrap: 'anywhere' }}>{e.name}</span>
        <span className="faint small">{size} m · used {e.seen}× · {id.role}</span>
        <div className="chips">
          <span className="chip accent">{ATTACH_NAME[rule.attach]}</span>
          {rule.facing && <span className="chip" title="The side of the model (game axes) that faces out">faces {rule.facing}</span>}
          {rule.mountHeight !== undefined && <span className="chip" title="How high the game mostly has it above the ground">{rule.mountHeight} m up</span>}
          {rule.clearFront !== undefined && <span className="chip">{rule.clearFront} m clear in front</span>}
          {rule.reach && <span className="chip">reached by {rule.reach}</span>}
          {rule.coverHeight !== undefined && <span className="chip">cover {rule.coverHeight} m{rule.seeThrough ? ', see-through' : rule.seeThrough === false ? ', solid' : ''}</span>}
          <span className="chip" title="What may change when it's placed; the rest stays as the game has it">{rule.mayVary.length ? 'may ' + rule.mayVary.join(', ') : 'placed exactly as the game has it'}</span>
        </div>
        {!!rule.needs?.length && (
          <div className="row wrap small" style={{ gap: 4 }}><span className="muted">Never without:</span>
            {rule.needs.map((n) => <span key={n} className="chip">{nameOf(lib, n)} <a href="#" title="Not needed: take it off" onClick={(ev) => { ev.preventDefault(); set({ needs: rule.needs!.filter((x) => x !== n) }) }}>×</a></span>)}
          </div>
        )}
        {!!rule.onlyOn?.length && (
          <div className="row wrap small" style={{ gap: 4 }}><span className="muted">Only on:</span>
            {[...new Set(rule.onlyOn)].slice(0, 4).map((n) => <span key={n} className="chip">{nameOf(lib, n)} <a href="#" title="Not only this building: take it off" onClick={(ev) => { ev.preventDefault(); set({ onlyOn: rule.onlyOn!.filter((x) => x !== n) }) }}>×</a></span>)}
            {rule.onlyOn.length > 4 && <span className="faint">+{rule.onlyOn.length - 4}</span>}
          </div>
        )}
        <span className="faint small">{evidence(e)}{facingSide >= 0 && e.sits?.n ? ` ${e.sits.open[facingSide] >= OPEN_MAX ? 'Open floor' : e.sits.open[facingSide] + ' m clear'} in front.` : ''}</span>
        <div className="row wrap" style={{ gap: 4 }}>
          <button className={'sm' + (place?.ok ? ' on' : '')} title="Right as it is" onClick={() => onFix(place?.ok ? null : { ok: true })}>✓ Right</button>
          <select className="sm" value={place?.attach ?? ''} title="Where it really goes" onChange={(ev) => set({ attach: (ev.target.value || undefined) as Attach | undefined })}>
            <option value="">{ATTACH_NAME[base.attach]} (rules)</option>
            {ATTACH.filter(([a]) => a !== base.attach).map(([a, name]) => <option key={a} value={a}>{name}</option>)}
          </select>
          <select className="sm" value={place?.facing === null ? 'none' : place?.facing ?? ''} title="The side (game axes) that faces out from the wall" onChange={(ev) => set({ facing: ev.target.value === 'none' ? null : (ev.target.value || undefined) as Side | undefined })}>
            <option value="">Faces: {base.facing ?? 'any'} (rules)</option>
            <option value="none">Faces any way</option>
            {SIDES.map((s) => <option key={s} value={s}>Faces {s}</option>)}
          </select>
          <button className={'sm quiet' + (more ? ' on' : '')} onClick={() => setMore(!more)}>More…</button>
          {place && <button className="sm quiet" title="Forget your corrections for this model" onClick={() => onFix(null)}>Reset</button>}
        </div>
        {more && (
          <div className="col small" style={{ gap: 4 }}>
            <div className="row wrap" style={{ gap: 4 }}>
              <span className="muted">May:</span>
              {VARY.map(([v, name]) => <button key={v} className={'chip' + (rule.mayVary.includes(v) ? ' accent' : '')} onClick={() => set({ mayVary: rule.mayVary.includes(v) ? rule.mayVary.filter((x) => x !== v) : [...rule.mayVary, v] })}>{name}</button>)}
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              <label className="row" style={{ gap: 4 }}>Clear in front <input className="sm" type="number" min={0} max={5} step={0.1} style={{ width: 58 }} value={rule.clearFront ?? ''} onChange={(ev) => set({ clearFront: ev.target.value === '' ? null : r1(+ev.target.value) })} /> m</label>
              {(rule.attach === 'wall' || rule.attach === 'hang') && <label className="row" style={{ gap: 4 }}>Height <input className="sm" type="number" min={0} max={30} step={0.1} style={{ width: 58 }} value={rule.mountHeight ?? ''} onChange={(ev) => set({ mountHeight: ev.target.value === '' ? null : r1(+ev.target.value) })} /> m up</label>}
              <label className="row" style={{ gap: 4 }}>Reached by
                <select className="sm" value={rule.reach ?? ''} onChange={(ev) => set({ reach: (ev.target.value || null) as PlacementRule['reach'] | null })}>
                  <option value="">walking</option>
                  {REACH.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              <label className="row" style={{ gap: 4 }}>Cover <input className="sm" type="number" min={0} max={30} step={0.1} style={{ width: 58 }} value={rule.coverHeight ?? ''} onChange={(ev) => set({ coverHeight: ev.target.value === '' ? null : r1(+ev.target.value) })} /> m</label>
              <select className="sm" value={rule.seeThrough === undefined ? '' : rule.seeThrough ? 'yes' : 'no'} onChange={(ev) => set({ seeThrough: ev.target.value === '' ? null : ev.target.value === 'yes' })}>
                <option value="">see-through: not said</option>
                <option value="yes">players see through it</option>
                <option value="no">solid</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** The model with the ones it's never placed without, where the game puts them (its parts, or the whole it belongs to). */
function partsWith(e: GameObjectEntry, rule: PlacementRule, lib: Library): PlacedPart[] {
  const out: PlacedPart[] = [{ id: e.id, at: [0, 0, 0], yaw: 0 }]
  const need = new Set(rule.needs ?? [])
  for (const p of identify(e).assembly ?? []) if (need.has(p.id)) out.push(p)
  const whole = e.partOf && need.has(e.partOf) ? lib.get(e.partOf) : undefined
  // A part shown with its whole: the whole at the middle, this part where the whole has it.
  const mine = whole ? (identify(whole).assembly ?? []).find((p) => p.id === e.id) : undefined
  if (whole && mine) return [{ id: whole.id, at: [0, 0, 0], yaw: 0 }, mine, ...out.slice(1)]
  return out
}

/** Whether an element is (nearly) on screen, once it has been. */
function useSeen<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver((xs) => { if (xs.some((x) => x.isIntersecting)) setSeen(true) }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen]
}

/** A picture of models put together, drawn once it comes into view. */
function Picture({ parts, lib, px, side, max }: { parts: PlacedPart[]; lib: Library; px: number; side?: Side; max?: number }) {
  const [ref, seen] = useSeen<HTMLDivElement>()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!seen) return
    let off = false
    void assemble(parts, (id) => lib.get(id), px > 200 ? 128 : 64, max)
      .then((g) => (g.children.length ? snapshot(g, px, side) : ''))
      .then((u) => { if (!off) setUrl(u) }, () => { if (!off) setUrl('') })
    return () => { off = true }
  }, [seen, parts, lib, px, side, max])
  return (
    <div ref={ref} style={{ width: px, height: px, display: 'grid', placeItems: 'center', background: '#202028', borderRadius: 6 }}>
      {url ? <img src={url} width={px} height={px} alt="" style={{ display: 'block', borderRadius: 6 }} /> : <span className="faint small">{url === '' ? 'no picture' : '…'}</span>}
    </div>
  )
}

// ---------------- groups and modules ----------------

const GROUP_KINDS: GroupKind[] = ['street', 'cover', 'alley', 'shop front', 'yard', 'industrial', 'parking', 'decor', 'other']
const MODULE_KINDS: ModuleKind[] = ['block', 'corner', 'street', 'alley', 'yard', 'plaza', 'lot', 'landmark']
const SETTING_KEYS = Object.keys(SETTINGS) as WizardSetting[]

/** The city's groups or modules (cityModules.ts), or made-up samples in development until there are some. */
export function CityView({ which, entries }: { which: 'groups' | 'modules'; entries: GameObjectEntry[] }) {
  const labels = useCityLabels((s) => s[which])
  const lib = useMemo<Library>(() => new Map(entries.map((e) => [e.id, e])), [entries])
  const found = useMemo(() => (which === 'groups' ? groups(entries) : cityModules(entries)), [which, entries])
  const samples = !found.length && import.meta.env.DEV
  const items: (CityGroup | CityModule)[] = useMemo(() => (found.length ? found : samples ? (which === 'groups' ? sampleGroups(entries) : sampleModules(entries)) : []), [found, samples, which, entries])
  const [show, setShow] = useState<'all' | 'todo' | 'done'>('all')
  const [shown, setShown] = useState(12)
  const list = items.filter((x) => show === 'all' || (show === 'done') === !!labels[x.id])
  const label = (id: string, l: CityLabel | null) => void setCityLabels(which, { [id]: l })
  return (
    <>
      <p className="muted" style={{ margin: 0, maxWidth: 860 }}>
        {which === 'groups'
          ? 'Things your game keeps placing together the same way (a bus stop, a dumpster with its boxes), drawn as the game arranges them. Mark the right ones, leave out the wrong ones, fix names and kinds.'
          : 'Real pieces of Stilwater kept as the game built them (a corner shop with its sidewalk, an alley, a row of houses), with the edges they join on. Mark the right ones and leave out the wrong ones.'}
      </p>
      {samples && items.length > 0 && <div className="card tight small warn">Sample data: these {which} are made up from models in your library so this page can be tried out. The real ones appear here once the Stilwater study is in.</div>}
      {!items.length ? <p className="muted">{found.length ? '' : `No ${which} yet: they appear here once the Stilwater study is in.`}</p> : (
        <>
          <div className="row wrap" style={{ alignItems: 'center' }}>
            {(['all', 'todo', 'done'] as const).map((k) => <button key={k} className={'sm quiet' + (show === k ? ' on' : '')} onClick={() => setShow(k)}>{{ all: 'All', todo: 'Not checked', done: 'Checked' }[k]}</button>)}
            <span className="grow small muted">{list.length} {which} · {Object.keys(labels).length} checked by you</span>
          </div>
          <div className="label-grid wide">
            {list.slice(0, shown).map((x) => <CityCard key={x.id} which={which} x={x} l={labels[x.id]} lib={lib} onLabel={(l) => label(x.id, l)} />)}
          </div>
          {list.length > shown && <button style={{ alignSelf: 'center' }} onClick={() => setShown((n) => n + 12)}>Show {Math.min(12, list.length - shown)} more</button>}
        </>
      )}
    </>
  )
}

function CityCard({ which, x, l, lib, onLabel }: { which: 'groups' | 'modules'; x: CityGroup | CityModule; l?: CityLabel; lib: Library; onLabel: (l: CityLabel | null) => void }) {
  const set = (patch: CityLabel) => onLabel({ ...l, ok: undefined, ...patch })
  // (A module or group part's turn is degrees; the picture's radians.)
  const parts = useMemo<PlacedPart[]>(() => x.parts.map((p) => ({ id: p.id, at: p.at, yaw: (p.yaw * Math.PI) / 180 })), [x])
  const settings = l?.settings ?? x.settings
  const kinds: string[] = which === 'groups' ? GROUP_KINDS : MODULE_KINDS
  const layers = x.parts.reduce<Record<string, number>>((a, p) => ({ ...a, [p.layer]: (a[p.layer] ?? 0) + 1 }), {})
  const g = 'anchor' in x ? x : null, m = 'edges' in x ? x : null
  const [name, setName] = useState(l?.name ?? x.name)
  useEffect(() => setName(l?.name ?? x.name), [l?.name, x.name])
  return (
    <div className={'label-tile' + (l?.ok ? ' ok' : l?.drop ? ' dropped' : l ? ' fixed' : '')} style={{ gridTemplateColumns: '200px 1fr' }}>
      <Picture parts={parts} lib={lib} px={200} max={which === 'modules' ? 160 : 40} />
      <div className="col" style={{ gap: 3, minWidth: 0 }}>
        <input className="sm" value={name} title="Its name" onChange={(ev) => setName(ev.target.value)} onBlur={() => { if (name !== (l?.name ?? x.name)) set({ name: name.trim() && name !== x.name ? name.trim() : undefined }) }} />
        <span className="faint small">
          {x.size.map((v) => Math.round(v)).join(' × ')} m · {x.parts.length} models ({Object.entries(layers).map(([k, n]) => `${n} ${k}`).join(', ')})
          {g ? ` · ${g.anchor === 'wall' ? `against a wall (back ${g.back ?? '?'})` : g.anchor === 'roof' ? 'on a roof' : 'on open ground'} · placed ${g.seen}×` : ''}
          {m ? ` · ${m.district} · ${m.tris.toLocaleString()} tris` : ''}
        </span>
        {m && <span className="faint small">Edges: {m.edges.map((ed) => `${ed.side} ${ed.kind}${ed.openings.length ? ` (${ed.openings.length} way${ed.openings.length > 1 ? 's' : ''} through)` : ''}`).join(', ')} · {m.entrances.length} entrance{m.entrances.length === 1 ? '' : 's'}{m.levels.length ? ` · levels ${m.levels.map((v) => `${Math.round(v.height)} m by ${v.reach}`).join(', ')}` : ''}</span>}
        {g && g.examples.length > 0 && <span className="faint small">Seen at {g.examples.slice(0, 3).map((ex) => `${ex.chunk} (${ex.at.map((v) => Math.round(v)).join(', ')})`).join('; ')}</span>}
        <div className="row wrap" style={{ gap: 4 }}>
          <button className={'sm' + (l?.ok ? ' on' : '')} title="Right as it is" onClick={() => onLabel(l?.ok ? null : { ok: true })}>✓ Right</button>
          <button className={'sm' + (l?.drop ? ' on' : '')} title="Wrong: never build with it" onClick={() => set({ drop: l?.drop ? undefined : true })}>✗ Don't use</button>
          <select className="sm" value={l?.kind ?? ''} title="What kind it is" onChange={(ev) => set({ kind: ev.target.value || undefined })}>
            <option value="">Kind: {x.kind}</option>
            {kinds.filter((k) => k !== x.kind).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          {l && <button className="sm quiet" title="Forget your corrections" onClick={() => onLabel(null)}>Reset</button>}
        </div>
        <div className="row wrap" style={{ gap: 3 }} title="The settings it suits">
          {SETTING_KEYS.map((s) => <button key={s} className={'chip' + (settings.includes(s) ? ' accent' : '')} onClick={() => set({ settings: settings.includes(s) ? settings.filter((v) => v !== s) : [...settings, s] })}>{SETTINGS[s].label}</button>)}
        </div>
        <input className="sm" placeholder="A note (what's wrong with it)" defaultValue={l?.note ?? ''} onBlur={(ev) => { const v = ev.target.value.trim(); if (v !== (l?.note ?? '')) set({ note: v || undefined }) }} />
      </div>
    </div>
  )
}
