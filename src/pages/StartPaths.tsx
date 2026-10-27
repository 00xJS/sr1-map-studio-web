// Step two of the Start a map dialog (SamplePicker.tsx): each way to start, with its own choices. Every way that can
// build with the player's game pieces shows the Build with choice first (BuildWith.tsx). Loaded when a way is picked:
// these need every prefab.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { SAMPLES, THEMES, THEME_INFO, hasCompact, type Sample, type Theme } from '../lib/samples'
import { BuildWith, useBuildWith, useGameSource } from './BuildWith'
import { MapWizard } from './MapWizard'
import { CityWizard } from './CityWizard'
import { DescribeMap } from './DescribeMap'
import type { WizardOptions } from '../lib/mapWizard'
import { galleryPages, gallerySample } from '../lib/gallery'
import type { PathProps } from './SamplePicker'

/** Build with game pieces: chosen, and the library is there. */
function useGame() {
  const [on, setOn] = useBuildWith()
  const src = useGameSource()
  return { on, setOn, game: on && !!src.entries }
}

export function GeneratePath(p: PathProps & { initial?: WizardOptions }) {
  const g = useGame()
  return (
    <>
      <BuildWith on={g.on} setOn={g.setOn} />
      <MapWizard initial={p.initial} busy={p.busy} progress={p.progress} footer={p.footer} game={g.game} onCreate={(s) => p.onCreate({ sample: s })} />
    </>
  )
}

export function DescribePath(p: PathProps & { onTune: (o: WizardOptions) => void }) {
  const g = useGame()
  return (
    <>
      <BuildWith on={g.on} setOn={g.setOn} />
      <DescribeMap busy={p.busy} footer={p.footer} game={g.game} onCreate={(s, edits) => p.onCreate({ sample: s, edits })} onTune={p.onTune} />
    </>
  )
}

export function CityPath(p: PathProps) {
  return (
    <>
      <div className="callout">
        <div className="col grow" style={{ gap: 2 }}>
          <b>Have the game? Start from the real Stilwater</b>
          <span className="small muted">Cut a rectangle of the city from your own game files, with its streets, buildings and props.</span>
        </div>
        <Link to="/city" className="btn sm" onClick={p.onClose}>Open Stilwater</Link>
      </div>
      <CityWizard busy={p.busy} footer={p.footer} onCreate={(s) => p.onCreate({ sample: s })} />
    </>
  )
}

/** Card picture: a rendered preview when there is one, else the sample's icon. */
function Pic({ s }: { s: Sample }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="pic">
      {failed ? s.icon : <img src={`/samples/${s.id}.webp`} alt="" loading="lazy" onError={() => setFailed(true)} />}
    </div>
  )
}

export function CatalogPath(p: PathProps & { onBlank?: () => void }) {
  const g = useGame()
  const [theme, setTheme] = useState<Theme | 'gallery'>('Starter')
  const [small, setSmall] = useState(false)
  const shown = theme === 'gallery' ? [] : SAMPLES.filter((s) => s.theme === theme)
  return (
    <>
      <BuildWith on={g.on} setOn={g.setOn} />
      <div className="row wrap">
        {THEMES.map((t) => (
          <button key={t} className={'sm' + (theme === t ? ' on' : '')} onClick={() => setTheme(t)}>
            {t} <span className="faint">{SAMPLES.filter((s) => s.theme === t).length}</span>
          </button>
        ))}
        <button className={'sm' + (theme === 'gallery' ? ' on' : '')} onClick={() => setTheme('gallery')} title="Every object, a category at a time, to check how each looks">🧪 Object gallery</button>
      </div>
      {theme === 'gallery' && <Gallery busy={p.busy} onPick={(s) => p.onCreate({ sample: s })} />}
      {theme === 'gallery' && g.game && <span className="faint small">The gallery shows the site's own objects; your game's are on the <Link to="/game-pieces" onClick={p.onClose}>Check game pieces</Link> page.</span>}
      {theme !== 'gallery' && <>
        <p className="small muted">{THEME_INFO[theme]} {g.game && theme !== 'Cyber'
          ? 'With game pieces, each sample keeps its layout, floors and stairs, and its buildings and props become real ones from your game that fit the same spots.'
          : 'Every sample is built from simple shapes with free textures.'} Each one already has spawns, weapons and lights.</p>
        {shown.some(hasCompact) && (
          <label className="row small"><input type="checkbox" checked={small} onChange={(e) => setSmall(e.target.checked)} /> Small version (half the size, for 2–6 players)</label>
        )}
        <div className="template-grid">
          {p.onBlank && theme === 'Starter' && (
            <button className="template-card" disabled={p.busy} onClick={p.onBlank}>
              <div className="pic" style={{ background: 'var(--bg-input)' }}>＋</div>
              <div className="txt"><b>Blank map</b><span className="small muted">Nothing yet. Draw your own floor and walls, or drop in a 3D model.</span></div>
            </button>
          )}
          {shown.map((s) => (
            <button key={s.id} className="template-card" disabled={p.busy} onClick={() => p.onCreate({ sample: s.id, small: small && hasCompact(s), game: g.game })}>
              <Pic s={s} />
              <div className="txt">
                <b>{s.name}</b>
                <span className="small muted">{s.description}</span>
                <span className="faint small">{s.modes.length === 5 ? 'All 5 modes' : s.modes.join(', ')}</span>
              </div>
            </button>
          ))}
        </div>
      </>}
    </>
  )
}

/** Gallery maps: every prefab of a category in rows, split into pages so no one map gets too big. */
function Gallery({ busy, onPick }: { busy: boolean; onPick: (s: Sample) => void }) {
  const pages = useMemo(galleryPages, [])
  const categories = [...new Set(pages.map((g) => g.category))]
  return (
    <div className="col" style={{ gap: 10 }}>
      <p className="small muted">A plain floor with every object of a category in rows and walkways in front, to walk or fly past and check each one (flicker, gaps, odd sizes) in the editor or in game. Big categories are split into parts.</p>
      {categories.map((c) => (
        <div key={c} className="row wrap" style={{ gap: 6 }}>
          <span className="small" style={{ minWidth: 130 }}>{c}</span>
          {pages.filter((g) => g.category === c).map((g) => (
            <button key={g.page} className="sm" disabled={busy} onClick={() => onPick(gallerySample(g))} title={g.keys.join(', ')}>
              {g.pages > 1 ? `Part ${g.page}` : 'Build'} <span className="faint">{g.keys.length}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
