import { useEffect, useState } from 'react'
import { DATAPACK, GROUP_LABELS, dataPackStatus, importDataPackFiles, importDataPackZip, type DataPackGroup, type DataPackStatus, type ImportReport } from '../lib/datapack'
import { db, requestPersistence } from '../lib/db'
import { py } from '../lib/py'
import { fmtBytes } from '../lib/files'
import { FileButton, confirmDialog, infoDialog, useBusy } from '../ui'

const sizeOf = (g: DataPackGroup) => Object.values(DATAPACK).filter((e) => e.group === g).reduce((n, e) => n + e.size, 0)

export default function Setup() {
  const [status, setStatus] = useState<DataPackStatus | null>(null)
  const [progress, setProgress] = useState('')
  const [report, setReport] = useState<ImportReport | null>(null)
  const [run, busy] = useBusy()
  const refresh = () => dataPackStatus().then(setStatus)
  useEffect(() => { refresh() }, [])

  const load = (fn: () => Promise<ImportReport>) => run(async () => {
    setReport(null)
    const r = await fn()
    setReport(r)
    setProgress('')
    await refresh()
    void requestPersistence()
    await py.remountDataPack().catch(() => {})
  })

  const selfTest = () => run(async () => {
    setProgress('Running exporter self-test…')
    try {
      const out = await py.call<string>('run_self_test')
      await infoDialog('Self-test passed', <pre>{out}</pre>)
    } finally { setProgress('') }
  })

  return (
    <div className="page page-narrow">
      <div className="col">
        <h1>Data pack</h1>
        <p className="muted">The exporter builds every map from reference files that come from Saints Row: the Beaver Creek map template, the breakable-glass and prop prefabs, sky presets and spawn-table templates. This site doesn't host any of them. Load them once from your own copy of the <b>SR1 Map Studio v1.13</b> package; they're checked against the package's published SHA-256 list and kept only in this browser.</p>
      </div>

      <div className="card">
        <h3>Load from your SR1 Map Studio package</h3>
        <p className="small muted">Choose the package zip (<code>SR1_Map_Studio_v1.13_….zip</code>) or its extracted folder. Only the reference folders are read; nothing is uploaded.</p>
        <div className="row wrap">
          <FileButton className="primary" accept=".zip" disabled={busy} onFiles={([f]) => load(() => importDataPackZip(f, setProgress))}>Choose zip…</FileButton>
          <FileButton directory disabled={busy} onFiles={(f) => load(() => importDataPackFiles(f, setProgress))}>Choose folder…</FileButton>
          {progress && <span className="small muted">{progress}</span>}
        </div>
        {report && (
          <div className={'callout ' + (report.mismatched.length ? 'warn' : 'ok')}>
            <div className="col">
              <span>Loaded {report.added.length} files.</span>
              {report.mismatched.length > 0 && <span className="small">{report.mismatched.length} files didn't match v1.13 and were skipped: {report.mismatched.join(', ')}</span>}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>What's loaded</h3>
        {status && (Object.keys(GROUP_LABELS) as DataPackGroup[]).map((g) => {
          const s = status.groups[g]
          const done = s && s.have === s.total
          return (
            <div key={g} className="row">
              <span className={'status-dot ' + (done ? 'ok' : s?.have ? 'warn' : g === 'required' ? 'bad' : '')} />
              <span className="grow">{GROUP_LABELS[g]}</span>
              <span className="small faint">{s?.have ?? 0}/{s?.total ?? 0} files · {fmtBytes(sizeOf(g))}</span>
            </div>
          )
        })}
        <div className="row wrap" style={{ marginTop: 6 }}>
          <button className="sm" disabled={busy || !status?.ready} onClick={selfTest}>Run exporter self-test</button>
          <button className="sm quiet" disabled={busy} onClick={async () => {
            if (!(await confirmDialog('Remove data pack?', 'This deletes the loaded reference files from this browser. Your maps are not affected.', { confirm: 'Remove', danger: true }))) return
            await db.clearDataPack(); await refresh()
          }}>Remove from this browser</button>
        </div>
      </div>

      <div className="callout">
        <div className="col small">
          <b>Why it works this way</b>
          <span>Exported Saints Row maps contain game data, so the hub only shares <i>projects</i>: your own models, textures, spawns and settings. Anyone who opens a shared map exports it with their own data pack. Files from your game install (like a CTS template or a map you import from the game) stay on your device too.</span>
        </div>
      </div>
    </div>
  )
}
