// The map catalog: every sample map, with its preview, size and what it holds, filtered by players, size and modes.
// New samples appear here as soon as they are added to the sample list; the latest batch is marked New. "Walk it
// first" opens a sample in Play as a temporary map before choosing it (walkFirst.ts).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SAMPLES, THEMES, THEME_INFO, hasCompact, type Sample, type SampleStats, type Theme } from '../lib/samples'
import { GAME_MODES, type GameMode } from '../lib/project'
import { startFromSample } from './sampleStart'
import { Modal, toastError } from '../ui'
import { prefabCategories, prefabEntries, searchPrefabs } from '../lib/prefabIndex'
import { PrefabThumb } from '../editor/PrefabThumb'
import { db } from '../lib/db'
import { keepWalkFirst, lastWalkFirst, noteWalkFirst, sweepWalkFirst, type WalkFirst } from '../lib/walkFirst'

/** The latest batch of samples added (all on the same day) is the one marked New. */
const LATEST = SAMPLES.reduce((d, s) => (s.added && s.added > d ? s.added : d), '')
const isNew = (s: Sample) => !!LATEST && s.added === LATEST
/** The catalogue's clean-up on leaving, put off a moment so a page that comes straight back can call it off. */
let leaving: ReturnType<typeof setTimeout> | undefined

type Players = 'any' | 'small' | 'full'
type Size = 'any' | 'small' | 'medium' | 'large'
/** Playable size, by the longer side in metres. */
const SIZES: Record<Exclude<Size, 'any'>, { label: string; fits: (m: number) => boolean }> = {
  small: { label: 'Small (under 95 m)', fits: (m) => m < 95 },
  medium: { label: 'Medium (95–105 m)', fits: (m) => m >= 95 && m <= 105 },
  large: { label: 'Large (over 105 m)', fits: (m) => m > 105 },
}

let statsFile: Promise<Record<string, SampleStats>> | null = null
const loadStats = () => (statsFile ??= fetch('/samples/stats.json').then((r) => (r.ok ? r.json() : {}) as Promise<Record<string, SampleStats>>).catch((): Record<string, SampleStats> => ({})))

function Stats({ st }: { st?: SampleStats }) {
  if (!st) return null
  return (
    <div className="chips">
      <span className="chip" title="Playable area in game metres">{st.widthM} × {st.depthM} m</span>
      <span className="chip">up to {st.players} players</span>
      <span className="chip">{st.spawns} spawns</span>
      <span className="chip">{st.weapons} weapons</span>
      {st.lights > 0 && <span className="chip">{st.lights} lights</span>}
    </div>
  )
}

export default function Catalog() {
  const nav = useNavigate()
  const [theme, setTheme] = useState<Theme | 'New' | 'All'>(SAMPLES.some(isNew) ? 'New' : 'Starter')
  const [players, setPlayers] = useState<Players>('any')
  const [size, setSize] = useState<Size>('any')
  const [mode, setMode] = useState<GameMode | 'any'>('any')
  const [stats, setStats] = useState<Record<string, SampleStats>>({})
  const [progress, setProgress] = useState<string | null>(null)
  // Back from walking a sample: start it, or let it go.
  const [walked, setWalked] = useState<WalkFirst | null>(null)
  const walking = useRef<string>()
  useEffect(() => {
    // Back again before the last visit's clean-up ran (React mounts twice in development): nothing is let go.
    clearTimeout(leaving)
    void loadStats().then(setStats)
    const w = lastWalkFirst()
    // Only the last one walked is asked about; any older ones are cleared away.
    void sweepWalkFirst(undefined, w?.id).then(async () => { if (w && (await db.getProject(w.id))) setWalked(w) })
    // Leaving the page without an answer lets it go (not the one just opened to walk), once it has really gone.
    return () => { const keep = walking.current; leaving = setTimeout(() => void sweepWalkFirst(undefined, keep)) }
  }, [])
  const fits = (s: Sample) => {
    const st = stats[s.id]
    if (players === 'small' && !hasCompact(s)) return false
    if (size !== 'any' && st && !SIZES[size].fits(Math.max(st.widthM, st.depthM))) return false
    return mode === 'any' || s.modes.includes(mode)
  }
  const inTheme = theme === 'New' ? SAMPLES.filter(isNew) : theme === 'All' ? SAMPLES : SAMPLES.filter((s) => s.theme === theme)
  const shown = inTheme.filter(fits)
  const filtered = players !== 'any' || size !== 'any' || mode !== 'any'
  // With the 2–6 players filter, each map starts as its small version.
  const small = (s: Sample) => players === 'small' && hasCompact(s)

  const start = async (s: Sample, compact = false) => {
    setProgress(`Building ${s.name}…`)
    try { nav('/editor/' + (await startFromSample(s.id, compact, (t) => setProgress(`${s.name}: ${t}`)))) }
    catch (e) { toastError(e); setProgress(null) }
  }
  /** Builds it as a temporary map and opens it in Play. */
  const walk = async (s: Sample, compact = false) => {
    setProgress(`Building ${s.name} to walk…`)
    try {
      const id = await startFromSample(s.id, compact, (t) => setProgress(`${s.name}: ${t}`))
      const rec = await db.getProject(id)
      noteWalkFirst({ id, name: s.name, sample: s.id, small: compact, at: rec?.updated_at ?? '' })
      walking.current = id
      nav('/play/' + id)
    } catch (e) { toastError(e); setProgress(null) }
  }
  const keep = (w: WalkFirst) => { keepWalkFirst(w.id); nav('/editor/' + w.id) }
  const discard = (w: WalkFirst) => { setWalked(null); void sweepWalkFirst(w.id) }

  return (
    <div className="page">
      <section className="col" style={{ gap: 6 }}>
        <h1>Map catalog</h1>
        <p className="muted">Every sample map in Map Studio, {SAMPLES.length} so far and growing. Each one is built in your browser from simple shapes and free textures, already has spawns, weapons and lights for all five modes, and is sized for full 8–12 player matches like the retail maps. Start one, change anything, then press Play to put it in your game.</p>
      </section>
      {walked && (
        <div className="callout">
          <div className="col grow" style={{ gap: 2 }}>
            <b>You walked {walked.name}{walked.small ? ' (small version)' : ''}</b>
            <span className="small muted">Start it to keep it in My maps and change it, or let it go.</span>
          </div>
          <div className="row wrap">
            <button className="sm primary" onClick={() => keep(walked)}>Start this map</button>
            <button className="sm quiet" onClick={() => discard(walked)}>Let it go</button>
          </div>
        </div>
      )}
      <div className="row wrap">
        {SAMPLES.some(isNew) && <button className={'sm' + (theme === 'New' ? ' on' : '')} onClick={() => setTheme('New')}>New <span className="faint">{SAMPLES.filter(isNew).length}</span></button>}
        {THEMES.map((t) => (
          <button key={t} className={'sm' + (theme === t ? ' on' : '')} onClick={() => setTheme(t)}>{t} <span className="faint">{SAMPLES.filter((s) => s.theme === t).length}</span></button>
        ))}
        <button className={'sm' + (theme === 'All' ? ' on' : '')} onClick={() => setTheme('All')}>All <span className="faint">{SAMPLES.length}</span></button>
      </div>
      <div className="row wrap catalog-filters">
        <label className="row small">Players
          <select value={players} onChange={(e) => setPlayers(e.target.value as Players)}>
            <option value="any">Any</option>
            <option value="small">2–6 (small version)</option>
            <option value="full">8–12</option>
          </select>
        </label>
        <label className="row small">Size
          <select value={size} onChange={(e) => setSize(e.target.value as Size)}>
            <option value="any">Any</option>
            {(Object.keys(SIZES) as (keyof typeof SIZES)[]).map((k) => <option key={k} value={k}>{SIZES[k].label}</option>)}
          </select>
        </label>
        <label className="row small">Mode
          <select value={mode} onChange={(e) => setMode(e.target.value as GameMode | 'any')}>
            <option value="any">Any</option>
            {GAME_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        {filtered && <span className="small faint">{shown.length} of {inTheme.length}</span>}
        {filtered && <button className="link small" onClick={() => { setPlayers('any'); setSize('any'); setMode('any') }}>Clear filters</button>}
      </div>
      {theme !== 'New' && theme !== 'All' && <p className="small muted">{THEME_INFO[theme]}</p>}
      {!shown.length && <p className="muted">No maps here fit those filters.</p>}
      <div className="catalog-grid">
        {shown.map((s) => (
          <article key={s.id} className="catalog-card">
            <div className="pic">
              <img src={`/samples/${s.id}.webp`} alt={`${s.name} preview`} loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
              <span className="icon">{s.icon}</span>
              {isNew(s) && <span className="chip accent new">New</span>}
            </div>
            <div className="body">
              <div className="row between"><b>{s.name}</b><span className="faint small">{s.theme}</span></div>
              <span className="small muted">{s.description}</span>
              <Stats st={stats[s.id]} />
              <div className="row wrap" style={{ marginTop: 'auto' }}>
                <button className="sm primary" disabled={!!progress} onClick={() => start(s, small(s))}>Start this map</button>
                <button className="sm" disabled={!!progress} onClick={() => walk(s, small(s))} title="Run round it in Play first: it's only kept if you start it">Walk it first</button>
                {hasCompact(s) && players !== 'small' && <button className="sm quiet" disabled={!!progress} onClick={() => start(s, true)} title="Half the size, for 2–6 players">Small version</button>}
              </div>
            </div>
          </article>
        ))}
      </div>
      <PrefabPieces />
      {progress && <Modal title="Building map"><div className="col"><div className="progress"><div /></div><span className="small muted">{progress}</span></div></Modal>}
    </div>
  )
}

/** Every prefab, by category, with its picture (drawn in this browser the first time it is shown). */
function PrefabPieces() {
  const all = prefabEntries()
  const cats = useMemo(() => prefabCategories(all), [all])
  const [cat, setCat] = useState(cats[0])
  const [query, setQuery] = useState('')
  const shown = query.trim() ? searchPrefabs(all, query) : all.filter((e) => e.category === cat)
  return (
    <section className="col" style={{ gap: 8, marginTop: 24 }}>
      <h2>Prefab pieces <span className="faint small">{all.length}</span></h2>
      <p className="small muted">Ready-made pieces to build your own games with: in the editor, pick the <b>Shape</b> tool, open <b>Prefabs…</b>, and click a piece, then the map (or drag it onto the map). Each one is a single object you can move, turn, copy and repaint.</p>
      <div className="row wrap">
        <input type="search" placeholder="Search prefabs" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search prefabs" style={{ maxWidth: 240 }} />
        {cats.map((c) => (
          <button key={c} className={'sm' + (!query.trim() && cat === c ? ' on' : '')} onClick={() => { setCat(c); setQuery('') }}>{c} <span className="faint">{all.filter((e) => e.category === c).length}</span></button>
        ))}
      </div>
      {query.trim() && <span className="small muted">{shown.length} found</span>}
      <div className="prefab-grid catalog-prefabs">
        {shown.map((e) => (
          <div key={e.shape} className="prefab-tile" title={e.hint}>
            <div className="prefab-pick"><PrefabThumb shape={e.shape} /><span className="prefab-label">{e.label}</span></div>
          </div>
        ))}
      </div>
    </section>
  )
}
