// "Connect your game": everything this browser can be connected to, a row each, with what it unlocks (lib/setup.ts):
// the data pack, the game folder and the game library read from it, the maps folder to install into, and an AI key.
// Nothing here is uploaded; the site hosts no game files.
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { DATAPACK, GROUP_LABELS, importDataPackFiles, importDataPackZip, type DataPackGroup, type ImportReport } from '../lib/datapack'
import { db, requestPersistence } from '../lib/db'
import { py } from '../lib/py'
import { fmtBytes } from '../lib/files'
import { reloadPropLibrary } from '../lib/propLibrary'
import { FileButton, confirmDialog, infoDialog, useBusy } from '../ui'
import { UNLOCKS, refreshSetup, useSetup, type SetupItem } from '../lib/setup'
import { folderPickerSupported, forgetGameFolder, pickGameFolder } from '../lib/sr1char/folder'
import { forgetMapsFolder, installSupported, mapsFolder } from '../lib/install'
import { buildIndex, useGameObjects } from '../lib/gameObjects/client'

// The key form needs the AI's whole vocabulary (every prefab): loaded when opened.
const KeySetup = lazy(() => import('../editor/AiKey').then((m) => ({ default: m.KeySetup })))

const sizeOf = (g: DataPackGroup) => Object.values(DATAPACK).filter((e) => e.group === g).reduce((n, e) => n + e.size, 0)

/** One thing to connect: whether it is, what it unlocks, and how. */
function Row({ id, ok, status, children }: { id: SetupItem; ok: boolean | null; status: ReactNode; children?: ReactNode }) {
  const u = UNLOCKS[id]
  return (
    <section className="card connect-row" id={id}>
      <div className="row between wrap">
        <h3 className="row" style={{ gap: 8 }}><span className={'status-dot ' + (ok ? 'ok' : ok === false ? 'warn' : '')} />{u.label}</h3>
        <span className="small muted">{status}</span>
      </div>
      <p className="small muted"><b>Unlocks:</b> {u.unlocks}</p>
      {children}
    </section>
  )
}

export default function Connect() {
  const s = useSetup((x) => x)
  const lib = useGameObjects()
  const [progress, setProgress] = useState('')
  const [report, setReport] = useState<ImportReport | null>(null)
  const [keyOpen, setKeyOpen] = useState(false)
  const [run, busy] = useBusy()
  const { hash } = useLocation()
  // A prompt elsewhere links straight to its row.
  useEffect(() => { if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' }) }, [hash, s.loaded])

  const load = (fn: () => Promise<ImportReport>) => run(async () => {
    setReport(null)
    const r = await fn()
    setReport(r)
    setProgress('')
    await refreshSetup()
    void requestPersistence()
    await py.remountDataPack().catch(() => {})
    void reloadPropLibrary()
  })

  const selfTest = () => run(async () => {
    setProgress('Running exporter self-test…')
    try {
      const out = await py.call<string>('run_self_test')
      await infoDialog('Self-test passed', <pre>{out}</pre>)
    } finally { setProgress('') }
  })

  const status = s.datapack
  return (
    <div className="page page-narrow">
      <div className="col">
        <h1>Connect your game</h1>
        <p className="muted">Map Studio works in your browser and hosts no game files. Connect what you have on this device to put maps in your game and to build with real game pieces. Everything stays in this browser; nothing is uploaded.</p>
      </div>

      <Row id="datapack" ok={s.loaded ? !!status?.ready : null} status={!s.loaded ? 'Checking…' : status?.ready ? 'Loaded' : 'Not loaded'}>
        <p className="small muted">The exporter builds every map from reference files that come from Saints Row: the Beaver Creek map template, the breakable-glass and prop prefabs, sky presets, the surface template and spawn-table templates. Load them once from your own copy of the <b>SR1 Map Studio</b> package (v1.13, or v1.15, which adds the stock object library): the package zip or its extracted folder. They're checked against the package's published SHA-256 list.</p>
        <div className="row wrap">
          <FileButton className="primary sm" accept=".zip" disabled={busy} onFiles={([f]) => load(() => importDataPackZip(f, setProgress))}>Choose zip…</FileButton>
          <FileButton className="sm" directory disabled={busy} onFiles={(f) => load(() => importDataPackFiles(f, setProgress))}>Choose folder…</FileButton>
          {progress && <span className="small muted">{progress}</span>}
        </div>
        {report && (
          <div className={'callout ' + (report.mismatched.length ? 'warn' : 'ok')}>
            <div className="col">
              <span>Loaded {report.added.length} files.</span>
              {report.mismatched.length > 0 && <span className="small">{report.mismatched.length} files didn't match the package's published list and were skipped: {report.mismatched.join(', ')}</span>}
            </div>
          </div>
        )}
        {status && (
          <details>
            <summary className="small">What's loaded</summary>
            {(Object.keys(GROUP_LABELS) as DataPackGroup[]).map((g) => {
              const st = status.groups[g]
              const done = st && st.have === st.total
              return (
                <div key={g} className="row">
                  <span className={'status-dot ' + (done ? 'ok' : st?.have ? 'warn' : g === 'required' ? 'bad' : '')} />
                  <span className="grow small">{GROUP_LABELS[g]}</span>
                  <span className="small faint">{st?.have ?? 0}/{st?.total ?? 0} files · {fmtBytes(sizeOf(g))}</span>
                </div>
              )
            })}
            <div className="row wrap" style={{ marginTop: 6 }}>
              <button className="sm" disabled={busy || !status.ready} onClick={selfTest}>Run exporter self-test</button>
              <button className="sm quiet" disabled={busy} onClick={async () => {
                if (!(await confirmDialog('Remove data pack?', 'This deletes the loaded reference files from this browser. Your maps are not affected.', { confirm: 'Remove', danger: true }))) return
                await db.clearDataPack(); await refreshSetup(); void reloadPropLibrary()
              }}>Remove from this browser</button>
            </div>
          </details>
        )}
      </Row>

      <Row id="gameFolder" ok={s.loaded ? !!s.gameFolder : null} status={s.gameFolder ? <>“{s.gameFolder.name}”{s.gameFolder.ready ? '' : ' · the browser asks again next time'}</> : s.loaded ? 'Not chosen' : 'Checking…'}>
        <p className="small muted">Your Saints Reborn folder (or <code>dist\game\packfiles</code> inside it). The browser reads the packfiles it needs by byte range and remembers the folder, never the files.</p>
        <div className="row wrap">
          {folderPickerSupported()
            ? <button className="sm primary" disabled={busy} onClick={() => run(async () => { await pickGameFolder(); await refreshSetup() })}>{s.gameFolder ? 'Choose another folder…' : 'Choose folder…'}</button>
            : <span className="small faint">This browser can't remember folders (Chrome and Edge can). Pick the files where each feature asks for them.</span>}
          {s.gameFolder && <button className="sm quiet" disabled={busy} onClick={() => run(async () => { await forgetGameFolder(); await refreshSetup() })}>Forget</button>}
        </div>
      </Row>

      <Row id="library" ok={lib.status === 'ready' && !!lib.entries?.length} status={lib.entries ? `${lib.entries.length.toLocaleString()} models` : lib.status === 'indexing' ? 'Reading…' : 'Not read'}>
        <p className="small muted">An index of the models in your game, read once from the game folder and kept in this browser. Only its index is stored; the models are read from your files when a map needs them.</p>
        <div className="row wrap">
          {lib.status === 'indexing'
            ? <span className="small"><b>Reading your game ({lib.progress ? `${lib.progress.done}/${lib.progress.total || '…'}` : '…'})</b></span>
            : <button className="sm primary" disabled={busy} onClick={() => run(async () => { await buildIndex(true); await refreshSetup() })}>{lib.entries ? 'Read it again' : 'Read my game library'}</button>}
          {lib.entries && <Link to="/game-pieces" className="small">Check which models it picks →</Link>}
          {lib.error && <span className="small warn">{lib.error}</span>}
        </div>
      </Row>

      <Row id="mapsFolder" ok={s.loaded ? !!s.mapsFolder : null} status={s.mapsFolder ? `“${s.mapsFolder}”` : s.loaded ? 'Not chosen' : 'Checking…'}>
        <div className="row wrap">
          {installSupported()
            ? <button className="sm primary" disabled={busy} onClick={() => run(async () => { await mapsFolder(true); await refreshSetup() })}>{s.mapsFolder ? 'Choose another folder…' : 'Choose SaintsReborn/dist/maps…'}</button>
            : <span className="small faint">This browser can't write to folders (Chrome and Edge can): Install in game downloads a zip to unpack there instead.</span>}
          {s.mapsFolder && <button className="sm quiet" disabled={busy} onClick={() => run(async () => { await forgetMapsFolder(); await refreshSetup() })}>Forget</button>}
        </div>
      </Row>

      <Row id="aiKey" ok={s.loaded ? s.aiKey : null} status={s.aiKey ? 'Saved in this browser' : s.loaded ? 'None' : 'Checking…'}>
        {keyOpen
          ? <Suspense fallback={<span className="small muted">Loading…</span>}><KeySetup onSaved={() => { setKeyOpen(false); void refreshSetup() }} onCancel={() => { setKeyOpen(false); void refreshSetup() }} /></Suspense>
          : <div className="row wrap"><button className="sm primary" onClick={() => setKeyOpen(true)}>{s.aiKey ? 'Change key or model' : 'Add your free NVIDIA key'}</button></div>}
      </Row>

      <div className="callout">
        <div className="col small">
          <b>Why it works this way</b>
          <span>Exported Saints Row maps contain game data, so the hub only shares <i>projects</i>: your own models, textures, spawns and settings. Anyone who opens a shared map exports it with their own data pack. Files from your game install (like a CTS template or a map you import from the game) stay on your device too.</span>
        </div>
      </div>
    </div>
  )
}
