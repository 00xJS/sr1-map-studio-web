import { useState } from 'react'
import { Modal, toastError } from '../ui'
import { SAMPLES, buildSample } from '../lib/samples'
import type { Project } from '../lib/project'

/**
 * Choose a sample map to start from. `onBuilt` gets the finished project;
 * with `onBlank`, a "Blank map" card is offered too.
 */
export function SamplePicker(props: { onClose: () => void; onBuilt: (p: Project) => Promise<void> | void; onBlank?: () => void }) {
  const [progress, setProgress] = useState<string | null>(null)
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
  return (
    <Modal title="Start a map" wide onClose={busy ? undefined : props.onClose}
      footer={<>{busy && <span className="grow small muted">{progress}</span>}<button onClick={props.onClose} disabled={busy}>Cancel</button></>}>
      <p className="small muted">Every sample is built from simple shapes with free textures, and already has spawns, weapons and lights for its game modes. Change anything you like: paint it, move it, erase it, add more.</p>
      <div className="template-grid">
        {props.onBlank && (
          <button className="template-card" disabled={busy} onClick={props.onBlank}>
            <div className="pic" style={{ background: 'var(--bg-input)' }}>＋</div>
            <div className="txt"><b>Blank map</b><span className="small muted">Nothing yet. Draw your own floor and walls, or drop in a 3D model.</span></div>
          </button>
        )}
        {SAMPLES.map((s) => (
          <button key={s.id} className="template-card" disabled={busy} onClick={() => choose(s.id)}>
            <div className="pic">{s.icon}</div>
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
