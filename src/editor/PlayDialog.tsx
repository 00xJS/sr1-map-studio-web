// One button to get a map into the game: checks it, names it, builds it and
// installs it (or downloads a zip where the browser can't write folders).
import { useState } from 'react'
import { useEditor } from './store'
import { useExport } from './useExport'
import { Checklist, useApplyFix, useChecklist } from './Checklist'
import { Modal } from '../ui'
import { blockers } from '../lib/checklist'
import { downloadBlob } from '../lib/exporter'
import { installSupported } from '../lib/install'

const DEFAULT_TITLE = 'My Map'

/** A file name for the map folder: letters and digits, 11 at most, unlikely to clash. */
export function fileNameFor(title: string) {
  const stem = title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 7) || 'map'
  return stem + Math.floor(1000 + Math.random() * 9000)
}

export function PlayDialog({ onClose, onSamples }: { onClose: () => void; onSamples: () => void }) {
  const project = useEditor((s) => s.project)!
  const lastLog = useEditor((s) => s.logs[s.logs.length - 1])
  const items = useChecklist()
  const applyFix = useApplyFix(onSamples)
  const exp = useExport()
  const s = project.settings
  const [title, setTitle] = useState(s.display_name === DEFAULT_TITLE && project.name !== 'Untitled map' ? project.name.slice(0, 40) : s.display_name)
  const blocked = blockers(items)
  const open = items.filter((c) => c.state !== 'done')

  // Runs once the folder is chosen: fill in the names the game needs.
  const applyNames = () => useEditor.getState().update('Name map', (d) => {
    d.settings.display_name = title.trim().slice(0, 40) || DEFAULT_TITLE
    const base = d.settings.base_name.trim()
    if (!base || base === 'mymap' || base.length > 11 || /[^a-zA-Z0-9_]/.test(base)) d.settings.base_name = fileNameFor(d.settings.display_name)
  })
  const fix = (f: Parameters<typeof applyFix>[0]) => { onClose(); applyFix(f) }
  const canInstall = installSupported()

  return (
    <Modal title="Play in game" onClose={exp.busy ? undefined : onClose}>
      {exp.result ? (
        <div className="callout ok"><div className="col">
          <b>{exp.result.installedTo ? 'Your map is in the game!' : 'Your map is ready'}</b>
          <span className="small">{exp.result.installedTo
            ? <>Installed to <code>{exp.result.installedTo}</code>. Start (or restart) Saints Reborn and look for <b>{project.settings.display_name}</b> in a private party.</>
            : <>Unzip <b>{exp.result.folder}</b> into <code>SaintsReborn/dist/maps</code>, then start the game and look for <b>{project.settings.display_name}</b> in a private party.</>}</span>
          {exp.result.installedTo && <span className="small muted">Changed something? Press Play again and it replaces the installed copy.</span>}
          <div className="row"><button className="sm" onClick={() => downloadBlob(exp.result!.zip, `${exp.result!.folder}.zip`)}>Download a copy (.zip)</button><span className="spacer" /><button className="sm primary" onClick={onClose}>Back to editing</button></div>
        </div></div>
      ) : exp.busy ? (
        <div className="col">
          <b>Building your map…</b>
          <div className="progress"><div /></div>
          <span className="small muted ellipsis">{lastLog || 'Starting the map builder…'}</span>
          <span className="faint small">The first time takes longer while the builder loads.</span>
        </div>
      ) : (
        <>
          {open.length > 0 && (
            <div className="col">
              <b>{blocked.length ? 'Before it can go in the game' : 'Nearly there. You could also:'}</b>
              <Checklist items={open} onFix={fix} />
            </div>
          )}
          <label className="col">
            <span className="small muted">Name in the game's map list</span>
            <input value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {exp.error && <div className="callout bad"><div className="col"><b>It didn't build</b><pre className="small mono" style={{ margin: 0 }}>{exp.error}</pre><span className="small muted">Tell us in Discord with a screenshot of this, or try Advanced mode's build log for details.</span></div></div>}
          {canInstall ? (
            <div className="col">
              <button className="primary big" disabled={blocked.length > 0} onClick={() => exp.run('install', false, applyNames)}>▶ Put it in my game</button>
              <span className="faint small">{exp.mapsDir
                ? <>Goes into your <code>{exp.mapsDir}</code> folder. <button className="link" disabled={blocked.length > 0} onClick={() => exp.run('install', true, applyNames)}>Different folder</button></>
                : <>The first time, your browser asks for a folder: choose <code>SaintsReborn/dist/maps</code> (or the SaintsReborn folder) and allow editing.</>}</span>
              <button className="sm quiet" disabled={blocked.length > 0} onClick={() => exp.run('download', false, applyNames)}>Download a zip instead</button>
            </div>
          ) : (
            <div className="col">
              <button className="primary big" disabled={blocked.length > 0} onClick={() => exp.run('download', false, applyNames)}>Download my map (.zip)</button>
              <span className="faint small">Use Chrome or Edge on a computer to install it straight into your game.</span>
            </div>
          )}
          <span className="faint small">Sky, minimap and other map settings: <button className="link" onClick={() => { onClose(); useEditor.getState().set({ advanced: true, tab: 'export' }) }}>Advanced mode → Map &amp; export</button></span>
        </>
      )}
    </Modal>
  )
}
