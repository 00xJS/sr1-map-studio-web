// Cloud sync for the open project: kept mounted by the editor's top bar, it puts its state (and what clicking
// does) in useCloudItem, which the bar's ⋯ menu shows as an item; a conflict opens its own dialog here.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { accountsEnabled, ConflictError, useUser } from '../lib/backend'
import { db, type ProjectRecord } from '../lib/db'
import { hasUnsyncedChanges, pullProject, pushProject } from '../lib/sync'
import { Modal, timeAgo, toast, useBusy } from '../ui'
import { saveNow, useEditor } from './store'
import { useCloudItem } from './cloudItem'

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

export function CloudSync({ projectId }: { projectId: string }) {
  const user = useUser()
  const nav = useNavigate()
  const saveState = useEditor((s) => s.saveState)
  const [rec, setRec] = useState<Cloud | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [progress, setProgress] = useState('')
  const [, tick] = useState(0)
  const [run, busy] = useBusy()

  const refresh = () => db.getProject(projectId).then((r) => setRec(r ? { updated_at: r.updated_at, cloud: r.cloud } : null))
  useEffect(() => { void refresh() }, [projectId, saveState, user?.id])
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t) }, [])

  const push = (force = false) => run(async () => {
    try {
      // A fresh picture of the view as it is now (cloudThumb decides whether it may go up).
      await saveNow(true)
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
  const label = !user ? 'Sign in to sync'
    : busy ? `Syncing${progress ? ' ' + progress : ''}…`
    : !rec?.cloud ? 'Save to the cloud'
    : dirty ? 'Sync changes' : `Synced ${timeAgo(rec.cloud.synced_at)}`
  const tone = !user || !rec?.cloud ? '' : dirty ? 'warn' : 'ok'
  const title = !user ? 'Sign in to keep a copy of this map in your account' : rec?.cloud ? `Last synced ${new Date(rec.cloud.synced_at).toLocaleString()}` : 'Keep a copy in your account'
  useEffect(() => {
    if (!accountsEnabled) return
    useCloudItem.setState({ item: { label: '☁ ' + label, tone, title, busy, run: () => (user ? void push() : nav('/account')) } })
  })
  useEffect(() => () => useCloudItem.setState({ item: null }), [])
  if (!accountsEnabled) return null
  return conflict ? <ConflictDialog remote={conflict} onChoose={choose} /> : null
}
