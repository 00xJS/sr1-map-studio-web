// Home page section: cloud saves that are not on this device yet.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { accountsEnabled, useUser, type CloudProjectMeta } from '../lib/backend'
import { db } from '../lib/db'
import { fmtBytes } from '../lib/files'
import { hasUnsyncedChanges, listCloudProjects, pullProject } from '../lib/sync'
import { confirmDialog, infoDialog, timeAgo, toastError, useBusy } from '../ui'

/** Open a cloud save: reuse an identical local copy, otherwise download it. */
export async function openCloudProject(meta: CloudProjectMeta, navigate: (to: string) => void) {
  const local = await db.getProject(meta.id)
  if (local?.cloud?.remote_updated_at === meta.updated_at) { navigate(`/editor/${meta.id}`); return }
  if (local) {
    const dirty = hasUnsyncedChanges(local)
    const ok = await confirmDialog('Replace the copy on this device?', dirty
      ? `"${local.name}" on this device has changes that are not in the cloud. Opening the cloud copy discards them.`
      : `The cloud copy of "${meta.name}" is different from the one on this device. Open the cloud copy?`,
    { confirm: 'Use cloud copy', danger: dirty })
    if (!ok) return
  }
  const res = await pullProject(meta.id)
  if (res.missingGameFiles.length) {
    await infoDialog('Some game files are needed', `These came from your Saints Row game files, which are never uploaded. Add them again on this device:\n\n${res.missingGameFiles.join('\n')}`)
  }
  navigate(`/editor/${res.id}`)
}

export function CloudSection() {
  const user = useUser()
  const navigate = useNavigate()
  const [items, setItems] = useState<CloudProjectMeta[]>([])
  const [run, busy] = useBusy()

  useEffect(() => {
    if (!user) { setItems([]); return }
    let live = true
    Promise.all([listCloudProjects(), db.listProjects()]).then(([cloud, local]) => {
      const here = new Set(local.map((p) => p.id))
      if (live) setItems(cloud.filter((p) => !here.has(p.id)))
    }, (e) => live && toastError(e))
    return () => { live = false }
  }, [user?.id])

  if (!accountsEnabled || !user || items.length === 0) return null
  return (
    <section className="col">
      <div className="section-title">In your cloud, not on this device</div>
      <div className="grid-cards">
        {items.map((p) => (
          <div key={p.id} className="map-card">
            <div className="thumb">{p.thumbnail_url ? <img src={p.thumbnail_url} alt="" loading="lazy" /> : <span className="small">Cloud save</span>}</div>
            <div className="body">
              <div className="title" title={p.name}>{p.name}</div>
              <div className="row small faint">
                <span className="grow">Saved {timeAgo(p.updated_at)} · {fmtBytes(p.size_bytes)}</span>
                <button className="sm primary" disabled={busy} onClick={() => run(() => openCloudProject(p, navigate))}>Open</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
