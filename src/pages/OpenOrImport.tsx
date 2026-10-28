// "Open or import…": every way to bring a map in, in one menu (the site's header and My maps): a finished game map
// (its folder or a zip of it), a Map Studio backup, or a project from the desktop SR1 Map Studio. Also "Open a game
// map" in the Start a map dialog (SamplePicker.tsx).
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileButton, infoDialog, toastError } from '../ui'
import { openMapFiles } from '../lib/mapFolder/store'
import './start.css'

const PROJECT_FILES = '.zip,.json,.obj,.mtl,.glb,.gltf,.fbx,.png,.jpg,.jpeg,.tga,.bmp,.dds'

/** Opens a Map Studio backup or a desktop project; returns the new map's id. */
export async function importProject(files: File[]): Promise<string> {
  const { importDesktopProject, importProjectZip } = await import('../lib/projectFiles')
  const zip = files.find((f) => /\.zip$/i.test(f.name))
  if (zip) return importProjectZip(zip)
  const r = await importDesktopProject(files)
  if (r.missing.length || r.notes.length) {
    await infoDialog('Desktop project imported', <div className="col">
      {r.missing.length > 0 && <><b>Files not found in your selection</b><pre>{r.missing.join('\n')}</pre><span className="small muted">Assign these later in the Materials tab, or import again selecting the folder that contains them.</span></>}
      {r.notes.map((n) => <span key={n} className="small muted">{n}</span>)}
    </div>)
  }
  return r.projectId
}

/** The menu: a button that opens the four ways in. */
export function OpenOrImport({ className = 'sm', label = 'Open or import…' }: { className?: string; label?: string }) {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', key) }
  }, [open])
  const run = (f: () => Promise<void>) => { setOpen(false); setBusy(true); f().catch(toastError).finally(() => setBusy(false)) }
  const game = (files: File[]) => run(() => openMapFiles(files))
  const project = (files: File[]) => run(async () => nav('/editor/' + (await importProject(files))))
  return (
    <span className="menu-wrap" ref={wrap}>
      <button className={className} aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen((v) => !v)}>{busy ? 'Opening…' : label}</button>
      {open && (
        <div className="menu open-menu" role="menu">
          <span className="menu-head small faint">A finished game map</span>
          <FileButton className="menu-item" directory onFiles={game} title="A finished map from SaintsReborn/dist/maps (the folder with bundle_info.xtbl and levels/): edit it and export it again, or add the game's sky to it">Game map folder…</FileButton>
          <FileButton className="menu-item" accept=".zip" onFiles={game} title="A zip of a finished map folder">Game map zip…</FileButton>
          <hr />
          <span className="menu-head small faint">A Map Studio project</span>
          <FileButton className="menu-item" multiple accept={PROJECT_FILES} onFiles={project} title="A .sr1map.zip backup, or a desktop .sr1map.json selected together with its models and textures">Backup or project file…</FileButton>
          <FileButton className="menu-item" directory onFiles={project} title="Pick the folder that holds a desktop .sr1map.json and its files">Desktop project folder…</FileButton>
        </div>
      )}
    </span>
  )
}

/** "Open a game map" in the Start a map dialog. */
export function OpenGameMapPath({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const open = (files: File[]) => { setBusy(true); openMapFiles(files).then(onDone, (e) => { toastError(e); setBusy(false) }) }
  return (
    <div className="col" style={{ gap: 12 }}>
      <p className="muted">Pick a map you made before: its folder in <code>SaintsReborn/dist/maps</code> (the one with <code>bundle_info.xtbl</code> and <code>levels/</code>), or a zip of it. You can edit it and export it again, or just add the game's own sky to it without rebuilding it.</p>
      <div className="row wrap">
        <FileButton className="primary" directory onFiles={open} disabled={busy}>{busy ? 'Opening…' : 'Choose the map folder…'}</FileButton>
        <FileButton accept=".zip" onFiles={open} disabled={busy}>Choose a zip…</FileButton>
      </div>
      <span className="small faint">You can also drop a map folder or its zip on My maps. To open a Map Studio backup or a desktop project, use <b>Open or import…</b> at the top of the page.</span>
    </div>
  )
}
