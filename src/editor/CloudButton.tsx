// Editor top-bar button: save the open project to the cloud and show its sync state.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { accountsEnabled, ConflictError, useUser } from '../lib/backend'
import { db, type ProjectRecord } from '../lib/db'
import { hasUnsyncedChanges, pullProject, pushProject } from '../lib/sync'
import { Modal, timeAgo, toast, useBusy } from '../ui'
import { saveNow, useEditor } from './store'

type Cloud = Pick<ProjectRecord, 'updated_at' | 'cloud'>

function ConflictDialog({ remote, onChoose }: { remote: string; onChoose: (c: 'overwrite' | 'download' | null) => void }) {
  return (
    <Modal title="The cloud copy changed" onClose={() => onChoose(null)} footer={<>
      <button className="quiet" onClick={() => onChoose(null)}>Cancel</button>
      <button onClick={() => onChoose('download')}>Download cloud copy</button>
      <button className="danger" onClick={() => onChoose('overwrite')}>Overwrite cloud copy</button>
    </>}>
      <p>This project was saved to the cloud from another device or tab ({timeAgo(remote)}).</p>
      <p className="muted small"><b>Overwrite</b> replaces the cloud copy with this one. <b>Download</b> replaces this copy with the cloud version, discarding changes made here since the last sync.</p>
    </Modal>
  )
}

export function CloudButton({ projectId }: { projectId: string }) {
  const user = useUser()
  const saveState = useEditor((s) => s.saveState)
  const [rec, setRec] = useState<Cloud | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [progress, setProgress] = useState('')
  const [, tick] = useState(0)
  const [run, busy] = useBusy()

  const refresh = () => db.getProject(projectId).then((r) => setRec(r ? { updated_at: r.updated_at, cloud: r.cloud } : null))
  useEffect(() => { void refresh() }, [projectId, saveState, user?.id])
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t) }, [])

  if (!accountsEnabled) return null
  if (!user) return <Link to="/account" className="btn sm" title="Sign in to keep a copy of this map in your account">☁ Sign in to sync</Link>

  const push = (force = false) => run(async () => {
    try {
      await saveNow()
      await pushProject(projectId, (p) => setProgress(p.total > 1 ? `${p.done}/${p.total}` : ''), { force })
      toast('Saved to the cloud.', 'ok')
    } catch (err) {
      if (err instanceof ConflictError) setConflict(err.remote_updated_at)
      else throw err
    } finally { setProgress(''); await refresh() }
  })

  const choose = (c: 'overwrite' | 'download' | null) => {
    setConflict(null)
    if (c === 'overwrite') push(true)
    if (c === 'download') run(async () => {
      await pullProject(projectId)
      const r = await db.getProject(projectId)
      if (r) useEditor.getState().open(r.project)
      toast('Downloaded the cloud copy.', 'ok')
      await refresh()
    })
  }

  const dirty = !rec || hasUnsyncedChanges(rec)
  const label = busy ? `Syncing${progress ? ' ' + progress : ''}…`
    : !rec?.cloud ? 'Save to cloud'
    : dirty ? 'Sync changes' : `Synced ${timeAgo(rec.cloud.synced_at)}`
  return (
    <>
      <button className="sm" disabled={busy} onClick={() => push()} title={rec?.cloud ? `Last synced ${new Date(rec.cloud.synced_at).toLocaleString()}` : 'Keep a copy in your account'}>
        <span className={'status-dot' + (rec?.cloud ? (dirty ? ' warn' : ' ok') : '')} />{label}
      </button>
      {conflict && <ConflictDialog remote={conflict} onChoose={choose} />}
    </>
  )
}
