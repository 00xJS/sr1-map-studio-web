import { useState } from 'react'
import { Modal, toastError } from '../ui'
import { SAMPLES, THEMES, buildSample, type Sample, type Theme } from '../lib/samples'
import type { Project } from '../lib/project'

const THEME_HINT: Record<Theme, string> = {
  'Starter': 'Simple layouts to learn with.',
  'Urban paintball': 'Bunkers, containers, alleys and rooftops: symmetric fields made for team fights.',
  'Cyber': 'Neon grids, glowing blocks and colored lights.',
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

/**
 * Choose a sample map to start from. `onBuilt` gets the finished project;
 * with `onBlank`, a "Blank map" card is offered too.
 */
export function SamplePicker(props: { onClose: () => void; onBuilt: (p: Project) => Promise<void> | void; onBlank?: () => void }) {
  const [progress, setProgress] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>('Starter')
  const choose = async (id: string) => {
    setProgress('Starting…')
    try {
      await props.onBuilt(await buildSample(id, setProgress))
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
      <div className="row wrap">
        {THEMES.map((t) => (
          <button key={t} className={'sm' + (theme === t ? ' on' : '')} onClick={() => setTheme(t)}>
            {t} <span className="faint">{SAMPLES.filter((s) => s.theme === t).length}</span>
          </button>
        ))}
      </div>
      <p className="small muted">{THEME_HINT[theme]} Every sample is built from simple shapes with free textures and already has spawns, weapons and lights for its game modes. Change anything you like.</p>
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
    </Modal>
  )
}
