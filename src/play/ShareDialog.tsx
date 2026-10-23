// "Share": a link anyone can open to play the map in their browser (no game,
// no account), or a share file where the site has no link server. Only the
// site's own building blocks go out: geometry, generated textures and the
// starter library. Your own pictures and game files are never shared.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { saveNow, useEditor } from '../editor/store'
import { useUser } from '../lib/backend'
import { fmtBytes } from '../lib/files'
import { Check, Field, Modal, toast, toastError } from '../ui'
import { issueText, planShare, type SharePlan } from './makeShare'
import { packShare, validateShareDoc } from './share'
import { ShareRejected, createShare, deleteShare, hostedShares, myShares, shareFile, shareUrl, type MyShare } from './shareApi'
import './play.css'

export function ShareDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const project = useEditor((s) => s.project)
  const user = useUser()
  const [title, setTitle] = useState(project?.name ?? '')
  const [plan, setPlan] = useState<SharePlan | null>(null)
  const [status, setStatus] = useState('Getting the map ready…')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [made, setMade] = useState<string | null>(null)
  const [links, setLinks] = useState<MyShare[]>(() => myShares().filter((s) => s.project_id === projectId))

  useEffect(() => {
    let live = true
    ;(async () => {
      await saveNow()
      const p = useEditor.getState().project
      if (!p) return
      const result = await planShare(p, { title: p.name, onProgress: (t) => live && setStatus(t) })
      if (live) setPlan(result)
    })().catch((e) => { if (live) { setStatus(''); toastError(e) } })
    return () => { live = false }
  }, [projectId])

  const doc = useMemo(() => plan && { ...plan.doc, title: title.trim().slice(0, 80) || plan.doc.title }, [plan, title])
  const bytes = useMemo(() => (doc ? packShare(doc).length : 0), [doc])
  const blocked = !!plan?.issues.length && !agree
  const empty = !!plan && !plan.doc.project.scene_items.length

  const check = () => {
    const { problems } = validateShareDoc(doc)
    setProblems(problems)
    return !problems.length
  }

  const makeLink = async (token?: string) => {
    if (!doc || !check()) return
    setBusy(true); setProblems([])
    try {
      const t = await createShare(doc, projectId, { token })
      setMade(t)
      setLinks(myShares().filter((s) => s.project_id === projectId))
      try { await navigator.clipboard.writeText(shareUrl(t)); toast('Link copied.', 'ok') } catch { /* the link is on screen to copy */ }
    } catch (e) {
      if (e instanceof ShareRejected) setProblems([e.message, ...e.problems])
      else toastError(e)
    } finally { setBusy(false) }
  }

  const download = () => {
    if (!doc || !check()) return
    const f = shareFile(doc)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(f)
    a.download = f.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  const remove = async (token: string) => {
    try {
      await deleteShare(token)
      setLinks(myShares().filter((s) => s.project_id === projectId))
      if (made === token) setMade(null)
    } catch (e) { toastError(e) }
  }

  const existing = links[0]
  return (
    <Modal title="Share to play in the browser" onClose={onClose} footer={<button onClick={onClose}>Close</button>}>
      <div className="col" style={{ gap: 12 }}>
        <p className="muted small" style={{ margin: 0 }}>
          Anyone with the link can walk your map, pick up the weapons and race the timed runs, on a computer or a phone.
          They don’t need the game or an account. Links are unlisted: they don’t show up anywhere.
        </p>
        {!plan ? <p className="faint">{status}</p> : <>
          <Field label="Title"><input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} /></Field>
          {plan.issues.length > 0 && (
            <div className="card tight" style={{ borderColor: 'var(--warn)' }}>
              <b>Some of this map can’t be shared</b>
              <p className="small" style={{ margin: 0 }}>Play links only carry the site’s own textures (generated, and the CC0 starter library), so nobody’s pictures end up hosted here. Game files never leave your device.</p>
              <ul className="share-issues small">{plan.issues.map((i, n) => <li key={n}>{issueText(i)}</li>)}</ul>
              <Check checked={agree} onChange={setAgree}>
                Share without them: {[plan.swapped && `${plan.swapped} texture${plan.swapped === 1 ? '' : 's'} become plain concrete`, plan.dropped && `${plan.dropped} object${plan.dropped === 1 ? ' is' : 's are'} left out`].filter(Boolean).join(', ')}
              </Check>
              <p className="faint small" style={{ margin: 0 }}>Or repaint those surfaces with generated or library textures (Textures tab), then share again.</p>
            </div>
          )}
          {plan.dataPack > 0 && <p className="faint small" style={{ margin: 0 }}>{plan.dataPack} object{plan.dataPack === 1 ? '' : 's'} (like native glass) come from your data pack and only show for players who loaded one.</p>}
          {empty && <p className="bad small">Nothing left to share: add some objects first.</p>}
          {problems.length > 0 && <ul className="share-issues small bad">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          <p className="faint small" style={{ margin: 0 }}>{plan.doc.project.scene_items.length} objects, {plan.doc.project.markers.length} markers · {fmtBytes(bytes)} to share.</p>

          {hostedShares && (user
            ? <div className="row wrap">
                {existing
                  ? <>
                      <button className="primary" disabled={busy || blocked || empty} onClick={() => makeLink(existing.token)} title="The same link shows the map as it is now">Update the link</button>
                      <button disabled={busy || blocked || empty} onClick={() => makeLink()}>New link</button>
                    </>
                  : <button className="primary" disabled={busy || blocked || empty} onClick={() => makeLink()}>{busy ? 'Making the link…' : 'Make a link'}</button>}
              </div>
            : <p className="small" style={{ margin: 0 }}><Link to="/account">Sign in</Link> to make a link, or send the share file below.</p>)}
          {made && (
            <div className="share-link">
              <input readOnly value={shareUrl(made)} onFocus={(e) => e.currentTarget.select()} aria-label="Play link" />
              <button className="sm" onClick={() => navigator.clipboard.writeText(shareUrl(made)).then(() => toast('Link copied.', 'ok'), toastError)}>Copy</button>
              <a className="btn sm" href={shareUrl(made)} target="_blank" rel="noreferrer">Open</a>
            </div>
          )}
          <div className="row wrap">
            <button className={hostedShares ? '' : 'primary'} disabled={blocked || empty} onClick={download}>Download share file (.sr1play)</button>
            <span className="faint small">{hostedShares ? 'For people you’d rather send a file.' : 'This site has no link server: send the file. They open it at'} {!hostedShares && <a href="/play" target="_blank" rel="noreferrer">{location.host}/play</a>}</span>
          </div>
          {links.length > 0 && (
            <div className="col" style={{ gap: 4 }}>
              <span className="section-title">Your links for this map</span>
              {links.map((l) => (
                <div key={l.token} className="row small">
                  <a href={shareUrl(l.token)} target="_blank" rel="noreferrer" className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.title}</a>
                  <span className="faint">{new Date(l.created_at).toLocaleDateString()}</span>
                  <button className="sm quiet" onClick={() => remove(l.token)} title="The link stops working">Remove</button>
                </div>
              ))}
            </div>
          )}
        </>}
      </div>
    </Modal>
  )
}
