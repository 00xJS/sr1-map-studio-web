import { useState } from 'react'
import { Modal, toastError } from '../ui'
import { SAMPLES, THEMES, THEME_INFO, buildFrom, buildSample, hasCompact, type Sample, type Theme } from '../lib/samples'
import { MapWizard } from './MapWizard'
import { DescribeMap } from './DescribeMap'
import type { Project } from '../lib/project'
import type { WizardOptions } from '../lib/mapWizard'
import type { PendingEdits } from '../lib/pendingEdits'


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
  const [theme, setTheme] = useState<Theme | 'wizard' | 'describe'>('wizard')
  const [tuned, setTuned] = useState<WizardOptions | undefined>()
  const [small, setSmall] = useState(false)
  const choose = async (id: string | Sample, edits?: PendingEdits) => {
    setProgress('Starting…')
    try {
      await props.onBuilt(await (typeof id === 'string' ? buildSample(id, setProgress, { compact: small }) : buildFrom(id, setProgress)), edits)
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
        <button className={'sm' + (theme === 'describe' ? ' on' : '')} onClick={() => setTheme('describe')}>💬 Describe it</button>
        <button className={'sm' + (theme === 'wizard' ? ' on' : '')} onClick={() => setTheme('wizard')}>✨ Map wizard</button>
        {THEMES.map((t) => (
          <button key={t} className={'sm' + (theme === t ? ' on' : '')} onClick={() => setTheme(t)}>
            {t} <span className="faint">{SAMPLES.filter((s) => s.theme === t).length}</span>
          </button>
        ))}
      </div>
      {theme === 'describe' && <DescribeMap busy={busy} onCreate={(s, edits) => choose(s, edits)} onTune={(o) => { setTuned(o); setTheme('wizard') }} />}
      {theme === 'wizard' && <MapWizard key={tuned?.seed} initial={tuned} busy={busy} onCreate={(s) => choose(s)} onBlank={props.onBlank} />}
      {theme !== 'wizard' && theme !== 'describe' && <>
      <p className="small muted">{THEME_INFO[theme]} Every sample is built from simple shapes with free textures, sized for 8–12 player matches like the retail maps, and already has plenty of spawns, weapons and lights. Change anything you like.</p>
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
