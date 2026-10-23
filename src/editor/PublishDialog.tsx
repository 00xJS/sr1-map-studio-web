// Put the open project in the Showcase, with the author's in-game screenshots.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { accountsEnabled, PublishRejected, useBackend, useUser, type HubMapMeta } from '../lib/backend'
import { MAX_SHOTS, checkPublishMeta, normalizeTags, showcasePlan } from '../lib/hubRules'
import { adoptRecipes, libraryIds } from '../lib/showcase'
import { publishShowcase } from '../lib/sync'
import { Check, Field, FileButton, Modal, toastError } from '../ui'
import { saveNow, useEditor } from './store'
import '../pages/home.css'

/** Screenshots go up as WebP, at most 1600 px wide, so they stay well under the 2 MB cap. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  try {
    const k = Math.min(1, 1600 / bmp.width)
    const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k))
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    return await c.convertToBlob({ type: 'image/webp', quality: 0.85 })
  } finally { bmp.close() }
}

function Shot({ blob, onRemove }: { blob: Blob; onRemove: () => void }) {
  const [url, setUrl] = useState('')
  useEffect(() => { const u = URL.createObjectURL(blob); setUrl(u); return () => URL.revokeObjectURL(u) }, [blob])
  return (
    <div className="shot-thumb">
      {url && <img src={url} alt="" />}
      <button className="sm quiet" onClick={onRemove} aria-label="Remove screenshot">✕</button>
    </div>
  )
}

export function PublishDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const user = useUser()
  const b = useBackend()
  const project = useEditor((s) => s.project)
  const [title, setTitle] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [tagText, setTagText] = useState('')
  const [shots, setShots] = useState<Blob[]>([])
  const [existing, setExisting] = useState<HubMapMeta | null>(null)
  const [update, setUpdate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ phase: string; done: number; total: number } | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [published, setPublished] = useState<string | null>(null)
  const [library, setLibrary] = useState<Set<string> | null>(null)

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

  // Older maps: recognise starter textures and shapes made before the site recorded their recipes.
  useEffect(() => {
    let live = true
    void (async () => {
      const ids = await libraryIds()
      const p = useEditor.getState().project
      if (!p) return
      const copy = structuredClone(p)
      if (await adoptRecipes(copy)) {
        useEditor.getState().update('Recognise site textures and shapes', (d) => {
          for (const [path, ref] of Object.entries(copy.files)) if (ref.recipe && d.files[path] && !d.files[path].recipe) d.files[path].recipe = ref.recipe
        })
      }
      if (live) setLibrary(ids)
    })().catch(toastError)
    return () => { live = false }
  }, [])

  const plan = useMemo(() => project && library ? showcasePlan(project, library) : null, [project, library])
  const tags = normalizeTags(tagText)
  const metaProblems = checkPublishMeta({ title, description, tags })

  const addShots = async (files: File[]) => {
    try {
      const room = MAX_SHOTS - shots.length
      const added = await Promise.all(files.slice(0, room).map(shrink))
      setShots((s) => [...s, ...added].slice(0, MAX_SHOTS))
    } catch { toastError(new Error('That image could not be read. Use a PNG, JPEG or WebP screenshot.')) }
  }

  const publish = async () => {
    setBusy(true); setProblems([])
    try {
      await saveNow(true)
      const res = await publishShowcase(projectId, { title, description, tags, mapId: existing && update ? existing.id : undefined }, shots, setProgress)
      setPublished(res.id)
    } catch (err) {
      if (err instanceof PublishRejected) setProblems(err.problems.length ? err.problems : [err.message])
      else toastError(err)
    } finally { setBusy(false); setProgress(null) }
  }

  if (!accountsEnabled) return (
    <Modal title="Publish to the Showcase" onClose={onClose}><p className="muted">Accounts aren't configured on this site, so maps can't be published.</p></Modal>
  )
  if (!user) return (
    <Modal title="Publish to the Showcase" onClose={onClose} footer={<button onClick={onClose}>Close</button>}>
      <p>Sign in to put maps in the Showcase.</p>
      <p><Link to="/account">Sign in</Link></p>
    </Modal>
  )
  if (published) return (
    <Modal title="Published" onClose={onClose} footer={<>
      <button className="quiet" onClick={onClose}>Close</button>
      <Link className="btn primary" to={`/showcase/${published}`}>View in the Showcase</Link>
    </>}>
      <div className="callout ok"><p>Your map is in the Showcase. Other players can rate and remix it.</p></div>
      <p className="small muted">Publishing again from this project updates the same Showcase map.</p>
    </Modal>
  )

  const blocked = !plan || plan.blockers.length > 0
  return (
    <Modal wide title="Publish to the Showcase" onClose={busy ? undefined : onClose} footer={<>
      <button className="quiet" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="primary" disabled={busy || blocked || metaProblems.length > 0} onClick={publish}>
        {busy ? 'Publishing…' : existing && update ? 'Update Showcase map' : 'Publish'}
      </button>
    </>}>
      <p className="small muted">
        The Showcase takes maps built from Map Studio's own pieces: starter-library and generated textures, shapes and prefabs.
        It stores how to rebuild them, not your files, so nothing you imported and no Saints Row game file is ever shared.
        The only images it keeps are the screenshots you add below.
      </p>

      {!plan && <p className="small muted">Checking the map…</p>}
      {plan && plan.blockers.length > 0 && (
        <div className="callout bad"><div className="col">
          <b>Not Showcase-ready yet</b>
          <ul className="problem-list">{plan.blockers.map((p, i) => <li key={i}>{p}</li>)}</ul>
          <span className="small muted">You can still share it with <b>Backup</b> on My maps.</span>
        </div></div>
      )}
      {plan && !plan.blockers.length && <div className="callout ok"><p className="small">Everything in this map is made from Map Studio's own textures, shapes and prefabs.</p></div>}

      <Field label="Title" hint={`${title.trim().length}/80`}>
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
      </Field>
      <Field label="Description" hint={`${description.length}/4000`}>
        <textarea value={description} maxLength={4000} rows={4} onChange={(e) => setDescription(e.target.value)} disabled={busy} placeholder="What is the map like? Which modes does it suit?" />
      </Field>
      <Field label="Tags" hint="Up to 8, separated by commas or spaces: letters, digits and dashes.">
        <input value={tagText} onChange={(e) => setTagText(e.target.value)} disabled={busy} placeholder="deathmatch, rooftops, night" />
      </Field>
      {tags.length > 0 && <div className="chips">{tags.map((t) => <span key={t} className="chip">#{t}</span>)}</div>}
      {metaProblems.length > 0 && (title || tagText) && <ul className="problem-list small warn">{metaProblems.map((p, i) => <li key={i}>{p}</li>)}</ul>}

      <Field label={`In-game screenshots (${shots.length}/${MAX_SHOTS})`} hint="Pictures of your map running in Saints Row. Your own captures only.">
        <div className="shot-row">
          {shots.map((s, i) => <Shot key={i} blob={s} onRemove={() => setShots((x) => x.filter((_, k) => k !== i))} />)}
          {shots.length < MAX_SHOTS && <FileButton multiple accept="image/png,image/jpeg,image/webp" disabled={busy} onFiles={addShots}>+ Add screenshots</FileButton>}
        </div>
      </Field>

      {existing && (
        <Check checked={update} onChange={setUpdate} disabled={busy}>
          Update my Showcase map “{existing.title}” instead of publishing a new one
        </Check>
      )}

      {progress && (
        <div className="col" style={{ gap: 4 }}>
          <span className="small muted">{progress.phase}{progress.total > 1 ? ` ${progress.done}/${progress.total}` : ''}…</span>
          <div className="meter"><div style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
        </div>
      )}

      {problems.length > 0 && (
        <div className="callout bad"><div className="col">
          <b>The Showcase didn't accept this map</b>
          <ul className="problem-list">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div></div>
      )}
    </Modal>
  )
}
