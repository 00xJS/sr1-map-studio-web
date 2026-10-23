// Saved versions of this map (kept in this browser). Restoring is one undo step.
import { useEffect, useState } from 'react'
import { Modal, confirmDialog, timeAgo, toast, toastError } from '../ui'
import { useEditor } from './store'
import { getViewer } from './Viewport'
import { toggleOverlay } from './overlays'
import { MAX_VERSIONS, deleteVersion, listVersions, saveVersion, type MapVersion } from '../lib/versions'

function Thumb({ blob }: { blob?: Blob }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) return
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return <div className="version-thumb">{url && <img src={url} alt="" />}</div>
}

export function restoreVersion(v: MapVersion) {
  const st = useEditor.getState()
  st.update(`Restore version “${v.label}”`, (d) => {
    const p = structuredClone(v.project)
    d.name = p.name; d.description = p.description; d.settings = p.settings
    d.scene_items = p.scene_items; d.asset_library = p.asset_library; d.markers = p.markers; d.lights = p.lights
    d.files = p.files
    if (p.remix_of) d.remix_of = p.remix_of
    else delete d.remix_of
  })
  st.select(null)
}

export function VersionsDialog() {
  const project = useEditor((s) => s.project)!
  const [list, setList] = useState<MapVersion[] | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const close = () => toggleOverlay('versions', false)
  const refresh = () => listVersions(project.id).then(setList)
  useEffect(() => { void refresh() }, [project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true)
    try {
      const thumbnail = await getViewer()?.capture(320, 180).catch(() => null)
      const v = await saveVersion(useEditor.getState().project!, label || `Version ${new Date().toLocaleString()}`, { thumbnail })
      setLabel('')
      toast(`Saved version “${v.label}”`, 'ok', 2000)
      await refresh()
    } catch (e) { toastError(e) } finally { setBusy(false) }
  }
  const restore = async (v: MapVersion) => {
    if (!(await confirmDialog('Restore this version?', `The map goes back to “${v.label}”. You can undo this with Ctrl+Z.`, { confirm: 'Restore' }))) return
    restoreVersion(v)
    toast(`Restored “${v.label}”. Ctrl+Z puts it back.`, 'ok', 3000)
    close()
  }
  const remove = async (v: MapVersion) => {
    await deleteVersion(project.id, v.id).catch(toastError)
    await refresh()
  }

  return (
    <Modal title="Saved versions" onClose={close}>
      <p className="small muted">Keep a copy of the map as it is now and come back to it later. Versions stay in this browser (up to {MAX_VERSIONS} per map; the oldest automatic ones go first). One is also kept when you open a map you haven't opened for an hour.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void save() }}>
        <input className="grow" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name this version (optional)" maxLength={60} aria-label="Version name" />
        <button className="primary" disabled={busy}>Save version</button>
      </form>
      {list === null ? <p className="muted">Loading…</p> : list.length === 0 ? <p className="faint small">No versions yet.</p> : (
        <ul className="version-list">
          {list.map((v) => (
            <li key={v.id} className="version-row">
              <Thumb blob={v.thumbnail} />
              <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                <b className="ellipsis">{v.label}</b>
                <span className="faint small">{timeAgo(v.created_at)} · {v.project.scene_items.length} objects · {v.project.markers.length} markers{v.auto ? ' · automatic' : ''}</span>
              </div>
              <button className="sm" onClick={() => restore(v)}>Restore</button>
              <button className="sm quiet" onClick={() => remove(v)} aria-label={`Delete version ${v.label}`}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
