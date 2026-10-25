// "Open a game map": a finished map folder (from SaintsReborn/dist/maps, a zip, or a drop) opened in the editor to
// edit and export again, or upgraded in place without rebuilding (src/lib/mapFolder). Mounted once in App.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, requestPersistence } from '../lib/db'
import { downloadBlob, lazyZip } from '../lib/exporter'
import { fmtBytes } from '../lib/files'
import { installSupported, mapFolderExists, mapsFolder, writeMap } from '../lib/install'
import { closeOpenMap, useOpenMap } from '../lib/mapFolder/store'
import type { MapSource } from '../lib/mapFolder/files'
import { openMapProject, readMapInfo, type MapInfo, type OpenReport } from '../lib/mapFolder/open'
import { MAP_UPGRADES, checkUpgrades, runUpgrades, type MapCheck, type UpgradeResult } from '../lib/mapFolder/upgrades'
import { Modal, confirmDialog, infoDialog, toast, toastError } from '../ui'

export default function OpenMapHost() {
  const sources = useOpenMap((s) => s.sources)
  return sources ? <OpenMapDialog sources={sources} onClose={closeOpenMap} /> : null
}

function OpenMapDialog({ sources, onClose }: { sources: MapSource[]; onClose: () => void }) {
  const [src, setSrc] = useState<MapSource | null>(sources.length === 1 ? sources[0] : null)
  return (
    <Modal title="Open a Saints Row map" onClose={onClose} wide>
      {!src ? (
        <div className="col">
          <p className="muted small">{sources.length} maps in what you picked. Which one?</p>
          <div className="col" style={{ gap: 6 }}>
            {sources.map((s) => <button key={s.name} className="sm" style={{ justifyContent: 'flex-start' }} onClick={() => setSrc(s)}>{s.name}</button>)}
          </div>
        </div>
      ) : <MapPanel key={src.name} src={src} onBack={sources.length > 1 ? () => setSrc(null) : undefined} onClose={onClose} />}
    </Modal>
  )
}

function MapPanel({ src, onBack, onClose }: { src: MapSource; onBack?: () => void; onClose: () => void }) {
  const nav = useNavigate()
  const [info, setInfo] = useState<MapInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [check, setCheck] = useState<MapCheck | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<UpgradeResult | null>(null)

  useEffect(() => {
    let live = true
    readMapInfo(src).then((i) => { if (live) setInfo(i) }, (e) => { if (live) setError((e as Error).message) })
    return () => { live = false }
  }, [src])
  useEffect(() => {
    if (!info) return
    let live = true
    checkUpgrades(info).then((c) => {
      if (!live) return
      setCheck(c)
      setPicked(MAP_UPGRADES.filter((u) => c.upgrades[u.key]?.state === 'available').map((u) => u.key))
    }, (e) => { if (live) setCheckError((e as Error).message.split('\n')[0]) })
    return () => { live = false }
  }, [info])

  if (error) return <div className="col"><div className="callout bad">{error}</div>{onBack && <button className="sm" onClick={onBack}>← Other maps</button>}</div>
  if (!info) return <p className="muted">Reading {src.name}…</p>
  const id = info.identity
  const counts = markerCounts(info)

  const openInEditor = async () => {
    setBusy('Opening…')
    try {
      const { project, report } = await openMapProject(info, setBusy)
      await db.putProject({ id: project.id, name: project.name, updated_at: project.updated_at, project })
      void requestPersistence()
      onClose()
      nav('/editor/' + project.id)
      void infoDialog(`${project.name} is open`, <Report r={report} />)
    } catch (e) { toastError(e) } finally { setBusy(null) }
  }

  const upgrade = async (how: 'zip' | 'install') => {
    setBusy('Upgrading…')
    try {
      // Asked for first, while the click still counts: the maps folder, then (inside) the game folder.
      const maps = how === 'install' ? await mapsFolder() : null
      const r = await runUpgrades(info, picked, true)
      setDone(r)
      if (!r.applied.length) { toast('Nothing was changed: ' + Object.values(r.skipped).join(' '), 'bad', 9000); return }
      if (maps) {
        const exists = await mapFolderExists(maps, r.folder)
        if (exists && !(await confirmDialog('Replace the map in your game?', <p>This writes the upgraded files over <b>SaintsReborn/dist/maps/{r.folder}</b>. Download the zip instead if you want to keep the old files.</p>, { confirm: 'Replace' }))) return
        const n = await writeMap(maps, r.entries)
        toast(`${r.folder} upgraded in your game (${n} files). Start the game to try it.`, 'ok', 8000)
      } else {
        downloadBlob(await lazyZip(r.entries)(), `${r.folder}.zip`)
        toast('Upgraded map downloaded: unzip it into SaintsReborn/dist/maps.', 'ok', 8000)
      }
    } catch (e) { toastError(e) } finally { setBusy(null) }
  }

  return (
    <div className="col">
      <div className="row between wrap">
        <div className="col" style={{ gap: 2 }}>
          <b style={{ fontSize: '1.1em' }}>{id.displayName}</b>
          <span className="small muted">Folder <code>{src.name}</code> · map <code>{info.stem}</code> · {fmtBytes(info.bytes)}</span>
          <span className="small muted">{id.modes.length ? id.modes.join(', ') : 'No game modes listed'}{id.otherModes.length ? ` (+ ${id.otherModes.join(', ')})` : ''} · {id.alwaysClearWeather ? 'always clear weather' : 'changing weather'}</span>
          <span className="small muted">{counts}</span>
        </div>
        {onBack && <button className="sm quiet" onClick={onBack}>← Other maps</button>}
      </div>

      <div className="card col">
        <span className="section-title">Edit it</span>
        <p className="small muted">Opens the map in the editor as a new map: every object with its pictures, the spawns, weapons, vehicles and triggers, the sound zones and lights. Add to it and export it again from there.</p>
        <div><button className="primary" disabled={!!busy} onClick={openInEditor}>Open in the editor</button></div>
      </div>

      <div className="card col">
        <span className="section-title">Quick upgrades, without rebuilding</span>
        <p className="small muted">Changes go into the map's own files; everything else in the folder stays as it is.</p>
        {checkError ? <p className="small bad">Couldn't check the map: {checkError}</p> : !check ? <p className="small muted">Checking the map…</p> : (
          <div className="col" style={{ gap: 6 }}>
            {MAP_UPGRADES.map((u) => {
              const st = check.upgrades[u.key] ?? { state: 'unavailable', why: 'Not offered for this map.' }
              return (
                <label key={u.key} className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
                  <input type="checkbox" disabled={st.state !== 'available' || !!busy} checked={picked.includes(u.key)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, u.key] : p.filter((k) => k !== u.key)))} />
                  <span className="col" style={{ gap: 2 }}>
                    <b>{u.title}{st.state === 'done' ? ' ✓' : ''}</b>
                    <span className="small muted">{st.state === 'available' ? (st.why ? `${u.hint} ${st.why}` : u.hint) : st.why}</span>
                  </span>
                </label>
              )
            })}
            <div className="row wrap">
              <button disabled={!picked.length || !!busy} onClick={() => upgrade('zip')}>Download the upgraded map</button>
              {installSupported() && <button disabled={!picked.length || !!busy} onClick={() => upgrade('install')} title="Writes the upgraded map into SaintsReborn/dist/maps">Upgrade it in my game</button>}
            </div>
            {done && <details className="small"><summary>{done.applied.length ? 'Upgraded: ' + done.applied.map((k) => MAP_UPGRADES.find((u) => u.key === k)?.title ?? k).join(', ') : 'Nothing changed'}</summary><pre className="small">{done.log.join('\n')}</pre></details>}
          </div>
        )}
      </div>

      {busy && <div className="col"><div className="progress"><div /></div><span className="small muted">{busy}</span></div>}
      <p className="small faint">A map from your game or from someone else stays on this device: you can export it for your own game, but not share, publish or sync it. Nothing from it is uploaded.</p>
    </div>
  )
}

function markerCounts(info: MapInfo): string {
  const recs = [...(info.cts.main?.records ?? []), ...(info.cts.ptp?.records ?? [])]
  const n = (k: string) => recs.filter((r) => r.kind === k).length
  const parts = [[n('Respawn'), 'spawn'], [n('Item'), 'item'], [n('Vehicle'), 'vehicle'], [n('Trigger'), 'trigger']] as const
  const out = parts.filter(([c]) => c).map(([c, w]) => `${c} ${w}${c === 1 ? '' : 's'}`)
  return out.length ? out.join(', ') : 'No CTS file: no spawns'
}

function Report({ r }: { r: OpenReport }) {
  return (
    <div className="col">
      <span>{r.pieces} objects ({r.triangles.toLocaleString()} triangles{r.doubleSided ? `, ${r.doubleSided} double-sided` : ''}), {r.markers} markers, {r.lights} light{r.lights === 1 ? '' : 's'}.</span>
      {r.notes.map((n) => <span key={n} className="small muted">{n}</span>)}
      <span className="small muted">Export it from the Export tab or with ▶ Play. Its files stay on this device.</span>
    </div>
  )
}
