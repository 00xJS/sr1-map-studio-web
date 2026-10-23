// The map catalog: every sample map, with its preview, size and what it holds.
// New samples appear here as soon as they are added to the sample list.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SAMPLES, THEMES, THEME_INFO, hasCompact, type Sample, type SampleStats, type Theme } from '../lib/samples'
import { startFromSample } from './sampleStart'
import { Modal, toastError } from '../ui'
import { ALL_PREFABS, PREFAB_CATEGORIES } from '../lib/prefabRegistry'

const NEW_DAYS = 30
const isNew = (s: Sample) => !!s.added && Date.now() - Date.parse(s.added) < NEW_DAYS * 864e5


let statsFile: Promise<Record<string, SampleStats>> | null = null
const loadStats = () => (statsFile ??= fetch('/samples/stats.json').then((r) => (r.ok ? r.json() : {}) as Promise<Record<string, SampleStats>>).catch((): Record<string, SampleStats> => ({})))

function Stats({ s }: { s: Sample }) {
  const [st, setSt] = useState<SampleStats | null>(null)
  useEffect(() => { let live = true; loadStats().then((all) => live && setSt(all[s.id] ?? null)); return () => { live = false } }, [s.id])
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
  const [theme, setTheme] = useState<Theme | 'New'>(SAMPLES.some(isNew) ? 'New' : 'Starter')
  const [progress, setProgress] = useState<string | null>(null)
  const shown = theme === 'New' ? SAMPLES.filter(isNew) : SAMPLES.filter((s) => s.theme === theme)

  const start = async (s: Sample, compact = false) => {
    setProgress(`Building ${s.name}…`)
    try { nav('/editor/' + (await startFromSample(s.id, compact, (t) => setProgress(`${s.name}: ${t}`)))) }
    catch (e) { toastError(e); setProgress(null) }
  }

  return (
    <div className="page">
      <section className="col" style={{ gap: 6 }}>
        <h1>Map catalog</h1>
        <p className="muted">Every sample map in Map Studio, {SAMPLES.length} so far and growing. Each one is built in your browser from simple shapes and free textures, already has spawns, weapons and lights for all five modes, and is sized for full 8–12 player matches like the retail maps. Start one, change anything, then press Play to put it in your game.</p>
      </section>
      <div className="row wrap">
        {SAMPLES.some(isNew) && <button className={'sm' + (theme === 'New' ? ' on' : '')} onClick={() => setTheme('New')}>New <span className="faint">{SAMPLES.filter(isNew).length}</span></button>}
        {THEMES.map((t) => (
          <button key={t} className={'sm' + (theme === t ? ' on' : '')} onClick={() => setTheme(t)}>{t} <span className="faint">{SAMPLES.filter((s) => s.theme === t).length}</span></button>
        ))}
      </div>
      {theme !== 'New' && <p className="small muted">{THEME_INFO[theme]}</p>}
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
              <Stats s={s} />
              <div className="row wrap" style={{ marginTop: 'auto' }}>
                <button className="sm primary" disabled={!!progress} onClick={() => start(s)}>Start this map</button>
                {hasCompact(s) && <button className="sm quiet" disabled={!!progress} onClick={() => start(s, true)} title="Half the size, for 2–6 players">Small version</button>}
              </div>
            </div>
          </article>
        ))}
      </div>
      <section className="col" style={{ gap: 8, marginTop: 24 }}>
        <h2>Prefab pieces <span className="faint small">{Object.keys(ALL_PREFABS).length}</span></h2>
        <p className="small muted">Ready-made pieces to build your own games with: in the editor, pick the <b>Shape</b> tool, choose a prefab from the <b>Prefabs…</b> list, and click the map. Each one is a single object you can move, turn, copy and repaint.</p>
        <div className="prefab-groups">
          {PREFAB_CATEGORIES.map((c) => {
            const list = Object.values(ALL_PREFABS).filter((p) => p.category === c)
            return (
              <div key={c} className="card prefab-group">
                <b>{c} <span className="faint small">{list.length}</span></b>
                <div className="chips">{list.map((p) => <span key={p.label} className="chip" title={p.hint}>{p.label}</span>)}</div>
              </div>
            )
          })}
        </div>
      </section>
      {progress && <Modal title="Building map"><div className="col"><div className="progress"><div /></div><span className="small muted">{progress}</span></div></Modal>}
    </div>
  )
}
