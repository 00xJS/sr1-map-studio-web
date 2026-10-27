import { useMemo, useState } from 'react'
import { Modal, toastError } from '../ui'
import { SAMPLES, THEMES, THEME_INFO, buildFrom, buildSample, hasCompact, type Sample, type Theme } from '../lib/samples'
import { BuildWith, gameSampleOf, useBuildWith, useGameSource } from './BuildWith'
import { NeedGameFolder, connect } from '../lib/gameObjects/client'
import { MapWizard } from './MapWizard'
import { CityWizard } from './CityWizard'
import { DescribeMap } from './DescribeMap'
import type { Project } from '../lib/project'
import type { WizardOptions } from '../lib/mapWizard'
import type { PendingEdits } from '../lib/pendingEdits'
import { galleryPages, gallerySample } from '../lib/gallery'


/** Card picture: a rendered preview when there is one, else the sample's icon. */
function Pic({ s }: { s: Sample }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="pic">
      {failed ? s.icon : <img src={`/samples/${s.id}.webp`} alt="" loading="lazy" onError={() => setFailed(true)} />}
    </div>
  )
}

/**
 * Choose a sample map to start from. `onBuilt` gets the finished project (and,
 * from "Describe it", edits to make once it is open); with `onBlank`, a
 * "Blank map" card is offered too.
 */
export function SamplePicker(props: { onClose: () => void; onBuilt: (p: Project, edits?: PendingEdits) => Promise<void> | void; onBlank?: () => void }) {
  const [progress, setProgress] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme | 'wizard' | 'describe' | 'gallery' | 'city'>('wizard')
  const [tuned, setTuned] = useState<WizardOptions | undefined>()
  const [small, setSmall] = useState(false)
  // Site or game pieces, for every way to start a map (BuildWith.tsx).
  const [buildGame, setBuildGame] = useBuildWith()
  const src = useGameSource()
  const game = buildGame && !!src.entries
  const choose = async (id: string | Sample, edits?: PendingEdits) => {
    setProgress('Starting…')
    try {
      // A catalogue sample with game pieces: remade from the player's game models.
      if (typeof id === 'string' && game) id = gameSampleOf(id, small, src) ?? id
      // Placing game models needs the game files open (the browser may ask for the folder once).
      if (typeof id !== 'string' && id.parts.some((p) => p.game)) {
        try { await connect(true) } catch (e) { throw e instanceof NeedGameFolder ? new Error('Choose your Saints Reborn folder so the models can come in from your game.') : e }
      }
      // A map built from game models gets the map's checks once it is open (its stairs are the game's).
      const job = typeof id !== 'string' && id.parts.some((p) => p.game) ? { ...(edits ?? { actions: [], label: 'Game pieces' }), checks: true, ...(id.problems?.length ? { summary: id.problems } : {}) } : edits
      await props.onBuilt(await (typeof id === 'string' ? buildSample(id, setProgress, { compact: small }) : buildFrom(id, setProgress)), job)
      props.onClose()
    } catch (e) {
      toastError(e)
      setProgress(null)
    }
  }
  const busy = progress !== null
  const shown = SAMPLES.filter((s) => s.theme === theme)
  return (
    <Modal title="Start a map" wide onClose={busy ? undefined : props.onClose}
      footer={<>{busy && <span className="grow small muted">{progress}</span>}<button onClick={props.onClose} disabled={busy}>Cancel</button></>}>
      <BuildWith on={buildGame} setOn={setBuildGame} />
      <div className="row wrap">
        <button className={'sm' + (theme === 'describe' ? ' on' : '')} onClick={() => setTheme('describe')}>💬 Describe it</button>
        <button className={'sm' + (theme === 'wizard' ? ' on' : '')} onClick={() => setTheme('wizard')}>✨ Map wizard</button>
        <button className={'sm' + (theme === 'city' ? ' on' : '')} onClick={() => setTheme('city')} title="An original Stilwater-style city, no game needed">🌆 City</button>
        {THEMES.map((t) => (
          <button key={t} className={'sm' + (theme === t ? ' on' : '')} onClick={() => setTheme(t)}>
            {t} <span className="faint">{SAMPLES.filter((s) => s.theme === t).length}</span>
          </button>
        ))}
        <button className={'sm' + (theme === 'gallery' ? ' on' : '')} onClick={() => setTheme('gallery')} title="Every object, a category at a time, to check how each looks">🧪 Object gallery</button>
      </div>
      {theme === 'gallery' && <Gallery busy={busy} onPick={(s) => choose(s)} />}
      {theme === 'gallery' && game && <span className="faint small">The gallery shows the site's own objects; your game's are on the Check game pieces page.</span>}
      {theme === 'city' && <CityWizard busy={busy} game={game} onCreate={(s) => choose(s)} />}
      {theme === 'describe' && <DescribeMap busy={busy} game={game} onCreate={(s, edits) => choose(s, edits)} onTune={(o) => { setTuned(o); setTheme('wizard') }} />}
      {theme === 'wizard' && <MapWizard key={tuned?.seed} initial={tuned} busy={busy} game={game} onCreate={(s) => choose(s)} onBlank={props.onBlank} />}
      {theme !== 'wizard' && theme !== 'describe' && theme !== 'gallery' && theme !== 'city' && <>
      <p className="small muted">{THEME_INFO[theme]} {game && theme !== 'Cyber'
        ? 'With game pieces, each sample keeps its layout, floors and stairs, and its buildings and props become real ones from your game that fit the same spots, dressed the way Stilwater dresses each kind of place.'
        : 'Every sample is built from simple shapes with free textures.'} Each is sized for 8–12 player matches like the retail maps and already has plenty of spawns, weapons and lights. Change anything you like.</p>
      {shown.some(hasCompact) && (
        <label className="row small"><input type="checkbox" checked={small} onChange={(e) => setSmall(e.target.checked)} /> Small version (half the size, for 2–6 players)</label>
      )}
      <div className="template-grid">
        {props.onBlank && theme === 'Starter' && (
          <button className="template-card" disabled={busy} onClick={props.onBlank}>
            <div className="pic" style={{ background: 'var(--bg-input)' }}>＋</div>
            <div className="txt"><b>Blank map</b><span className="small muted">Nothing yet. Draw your own floor and walls, or drop in a 3D model.</span></div>
          </button>
        )}
        {shown.map((s) => (
          <button key={s.id} className="template-card" disabled={busy} onClick={() => choose(s.id)}>
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
    </Modal>
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
            <button key={g.page} className="sm" disabled={busy} onClick={() => onPick(gallerySample(g))} title={g.keys.map((k) => k).join(', ')}>
              {g.pages > 1 ? `Part ${g.page}` : 'Build'} <span className="faint">{g.keys.length}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
