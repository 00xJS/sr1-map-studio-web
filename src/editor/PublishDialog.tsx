// Publish the open project to the community hub.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { accountsEnabled, ConflictError, PublishRejected, useBackend, useUser, type HubMapMeta } from '../lib/backend'
import { fmtBytes } from '../lib/files'
import { checkPublishMeta, normalizeTags, projectUploadPlan } from '../lib/hubRules'
import { publishProject } from '../lib/sync'
import { Check, Field, Modal, confirmDialog, toastError } from '../ui'
import { saveNow, useEditor } from './store'

export function PublishDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const user = useUser()
  const b = useBackend()
  const project = useEditor((s) => s.project)
  const [title, setTitle] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [tagText, setTagText] = useState('')
  const [existing, setExisting] = useState<HubMapMeta | null>(null)
  const [update, setUpdate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ phase: string; done: number; total: number } | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [published, setPublished] = useState<string | null>(null)

  // Prefill from a previous publish of this project.
  useEffect(() => {
    if (!b || !user) return
    b.myPublished().then((maps) => {
      const m = maps.find((x) => x.project_id === projectId)
      if (!m) return
      setExisting(m)
      setTitle(m.title)
      setDescription(m.description)
      setTagText(m.tags.join(', '))
    }, () => {})
  }, [b, user?.id, projectId])

  const plan = useMemo(() => project ? projectUploadPlan(project) : null, [project])
  const tags = normalizeTags(tagText)
  const metaProblems = checkPublishMeta({ title, description, tags })

  const publish = async (force = false) => {
    setBusy(true); setProblems([])
    try {
      await saveNow(true)
      const res = await publishProject(projectId, { title, description, tags, mapId: existing && update ? existing.id : undefined }, setProgress, { force })
      setPublished(res.id)
    } catch (err) {
      if (err instanceof PublishRejected) setProblems(err.problems.length ? err.problems : [err.message])
      else if (err instanceof ConflictError) {
        setBusy(false); setProgress(null)
        if (await confirmDialog('The cloud copy changed', 'This project was saved to the cloud from another device. Publishing uploads the version open here and replaces that cloud copy.', { confirm: 'Replace and publish', danger: true })) return publish(true)
      } else toastError(err)
    } finally { setBusy(false); setProgress(null) }
  }

  if (!accountsEnabled) return (
    <Modal title="Publish to hub" onClose={onClose}><p className="muted">Accounts aren't configured on this site, so maps can't be published.</p></Modal>
  )
  if (!user) return (
    <Modal title="Publish to hub" onClose={onClose} footer={<button onClick={onClose}>Close</button>}>
      <p>Sign in to publish maps to the community hub.</p>
      <p><Link to="/account">Sign in</Link></p>
    </Modal>
  )
  if (published) return (
    <Modal title="Published" onClose={onClose} footer={<>
      <button className="quiet" onClick={onClose}>Close</button>
      <Link className="btn primary" to={`/hub/${published}`}>View on the hub</Link>
    </>}>
      <div className="callout ok"><p>Your map is live on the hub. Other players can like and remix it.</p></div>
      <p className="small muted">Publishing again from this project updates the same hub map.</p>
    </Modal>
  )

  const blocked = !plan || plan.blockers.length > 0
  return (
    <Modal wide title="Publish to hub" onClose={busy ? undefined : onClose} footer={<>
      <button className="quiet" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="primary" disabled={busy || blocked || metaProblems.length > 0} onClick={() => publish()}>
        {busy ? 'Publishing…' : existing && update ? 'Update hub map' : 'Publish'}
      </button>
    </>}>
      <p className="small muted">The hub shares this project: your meshes, textures, markers, lights and settings. It never includes Saints Row game files or exported maps; players use their own data pack to preview and export.</p>

      {plan && plan.blockers.length > 0 && (
        <div className="callout bad"><div className="col">
          <b>Fix these before publishing</b>
          <ul className="problem-list">{plan.blockers.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div></div>
      )}

      <Field label="Title" hint={`${title.trim().length}/80`}>
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
      </Field>
      <Field label="Description" hint={`${description.length}/4000`}>
        <textarea value={description} maxLength={4000} rows={5} onChange={(e) => setDescription(e.target.value)} disabled={busy} placeholder="What is the map like? Which modes does it suit?" />
      </Field>
      <Field label="Tags" hint="Up to 8, separated by commas or spaces: letters, digits and dashes.">
        <input value={tagText} onChange={(e) => setTagText(e.target.value)} disabled={busy} placeholder="deathmatch, rooftops, night" />
      </Field>
      {tags.length > 0 && <div className="chips">{tags.map((t) => <span key={t} className="chip">#{t}</span>)}</div>}
      {metaProblems.length > 0 && (title || tagText) && <ul className="problem-list small warn">{metaProblems.map((p, i) => <li key={i}>{p}</li>)}</ul>}

      {existing && (
        <Check checked={update} onChange={setUpdate} disabled={busy}>
          Update my existing hub map “{existing.title}” instead of publishing a new one
        </Check>
      )}

      {plan && (
        <p className="small faint">
          {plan.hashes.length} file{plan.hashes.length === 1 ? '' : 's'} to share ({fmtBytes(plan.bytes)}).
          {plan.local.length > 0 && ` ${plan.local.length} game file${plan.local.length === 1 ? '' : 's'} stay on this device.`}
        </p>
      )}

      {progress && (
        <div className="col" style={{ gap: 4 }}>
          <span className="small muted">{progress.phase}{progress.total > 1 ? ` ${progress.done}/${progress.total}` : ''}…</span>
          <div className="meter"><div style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
        </div>
      )}

      {problems.length > 0 && (
        <div className="callout bad"><div className="col">
          <b>The hub didn't accept this map</b>
          <ul className="problem-list">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div></div>
      )}
    </Modal>
  )
}
