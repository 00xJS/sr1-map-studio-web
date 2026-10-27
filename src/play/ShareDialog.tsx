// "Share": a link anyone can open to play the map in their browser (no game,
// no account), or a share file where the site has no link server. Only the
// site's own building blocks go out: geometry, generated textures and the
// starter library. Your own pictures and game files are never shared.
// Links made without an account expire; signed-in owners can list a map in
// the gallery when every model in it was made on the site. A link's preview
// picture is drawn from the share itself, or is an in-game screenshot the
// author took (the only game graphics that ever go public, as in the Showcase).
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { saveNow, useEditor } from '../editor/store'
import { useUser } from '../lib/backend'
import { fmtBytes } from '../lib/files'
import { Check, Field, FileButton, Modal, toast, toastError } from '../ui'
import { issueText, planShare, type SharePlan } from './makeShare'
import { SHARE_RULES, packShare, validateShareDoc } from './share'
import { screenshotPreview, sharePreview } from './sharePreview'
import { ShareRejected, createShare, deleteShare, hostedShares, myShares, shareFile, shareUrl, type MyShare } from './shareApi'
import './play.css'

/** Your links for this map, without ones that have expired. */
const linksFor = (projectId: string) => myShares().filter((s) => s.project_id === projectId && !(s.expires_at && new Date(s.expires_at).getTime() <= Date.now()))

export function ShareDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const project = useEditor((s) => s.project)
  const user = useUser()
  const [title, setTitle] = useState(project?.name ?? '')
  const [plan, setPlan] = useState<SharePlan | null>(null)
  const [status, setStatus] = useState('Getting the map ready…')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [made, setMade] = useState<{ token: string; expires_at?: string } | null>(null)
  const [links, setLinks] = useState<MyShare[]>(() => linksFor(projectId))
  const [auto, setAuto] = useState<Blob | null>(null)
  const [shot, setShot] = useState<Blob | null>(null)
  const [mine, setMine] = useState(false)
  const [listed, setListed] = useState(() => !!linksFor(projectId).find((l) => !l.key)?.listed)

  useEffect(() => {
    let live = true
    ;(async () => {
      await saveNow()
      const p = useEditor.getState().project
      if (!p) return
      const result = await planShare(p, { title: p.name, onProgress: (t) => live && setStatus(t) })
      if (!live) return
      setPlan(result)
      // The preview shows what players of the link see, never the editor's own view.
      if (hostedShares && result.doc.project.scene_items.length) sharePreview(result.doc).then((b) => live && setAuto(b), () => {})
    })().catch((e) => { if (live) { setStatus(''); toastError(e) } })
    return () => { live = false }
  }, [projectId])

  const doc = useMemo(() => plan && { ...plan.doc, title: title.trim().slice(0, 80) || plan.doc.title }, [plan, title])
  const bytes = useMemo(() => (doc ? packShare(doc).length : 0), [doc])
  const blocked = !!plan?.issues.length && !agree
  const empty = !!plan && !plan.doc.project.scene_items.length
  // An in-game screenshot counts only once the author says it is their own.
  const useShot = !!shot && mine
  const thumb = useShot ? shot : auto
  const thumbSrc = useMemo(() => (thumb ? URL.createObjectURL(thumb) : ''), [thumb])
  useEffect(() => () => { if (thumbSrc) URL.revokeObjectURL(thumbSrc) }, [thumbSrc])
  const canList = !!user && !!plan?.galleryReady

  const check = () => {
    const { problems } = validateShareDoc(doc)
    setProblems(problems)
    return !problems.length
  }

  const makeLink = async (token?: string) => {
    if (!doc || !check()) return
    setBusy(true); setProblems([])
    try {
      const t = await createShare(doc, projectId, { token, thumb, shot: useShot, listed: canList && listed })
      setMade(t)
      setLinks(linksFor(projectId))
      try { await navigator.clipboard.writeText(shareUrl(t.token)); toast('Link copied.', 'ok') } catch { /* the link is on screen to copy */ }
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
      setLinks(linksFor(projectId))
      if (made?.token === token) setMade(null)
    } catch (e) { toastError(e) }
  }

  // A link made without an account is updated with its key; one made signed in, only by its owner.
  const existing = links.find((l) => (user ? !l.key : !!l.key))
  return (
    <Modal title="Share to play in the browser" onClose={onClose} footer={<button onClick={onClose}>Close</button>}>
      <div className="col" style={{ gap: 12 }}>
        <p className="muted small" style={{ margin: 0 }}>
          Anyone with the link can walk your map, pick up the weapons, race the timed runs and the bots, on a computer or a phone.
          They don’t need the game or an account. Links are unlisted: they show up only where you post them, unless you put the map in the gallery.
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

          {hostedShares && <>
            {user
              ? (plan.galleryReady
                  ? <Check checked={listed} onChange={setListed}>List it in the gallery, where anyone can find, rate and remix it</Check>
                  : <p className="faint small" style={{ margin: 0 }}>The gallery only takes maps built entirely from the site’s own shapes and prefabs. This one has imported models, so its link stays unlisted.</p>)
              : <p className="small" style={{ margin: 0 }}>Without an account, a link lasts {SHARE_RULES.anonDays} days. <Link to="/account">Sign in</Link> to keep your links, or to put the map in the gallery.</p>}
            <div className="row wrap">
              {existing
                ? <>
                    <button className="primary" disabled={busy || blocked || empty} onClick={() => makeLink(existing.token)} title="The same link shows the map as it is now">Update the link</button>
                    <button disabled={busy || blocked || empty} onClick={() => makeLink()}>New link</button>
                  </>
                : <button className="primary" disabled={busy || blocked || empty} onClick={() => makeLink()}>{busy ? 'Making the link…' : 'Make a link'}</button>}
            </div>
            <div className="share-preview">
              {thumbSrc ? <img src={thumbSrc} alt="Link preview" /> : <div className="faint small">{plan.doc.project.scene_items.length ? 'Drawing the preview…' : ''}</div>}
              <div className="col" style={{ gap: 6 }}>
                <span className="small">{useShot ? 'Preview: your in-game screenshot.' : 'Preview: the map as players of the link see it.'} It shows wherever the link is posted{canList && listed ? ', and in the gallery' : ''}.</span>
                <div className="row wrap">
                  <FileButton className="sm" accept="image/png,image/jpeg,image/webp" disabled={busy}
                    onFiles={([f]) => f && screenshotPreview(f).then((b) => { setShot(b); setMine(false) }, () => toastError(new Error('That image could not be read. Use a PNG, JPEG or WebP screenshot.')))}>
                    {shot ? 'Pick another screenshot…' : 'Use an in-game screenshot…'}
                  </FileButton>
                  {shot && <button className="sm quiet" onClick={() => { setShot(null); setMine(false) }}>Use the drawn preview</button>}
                </div>
                {shot && <Check checked={mine} onChange={setMine}>This is a screenshot I took of this map in Saints Row</Check>}
              </div>
            </div>
          </>}
          {made && (
            <div className="col" style={{ gap: 4 }}>
              <div className="share-link">
                <input readOnly value={shareUrl(made.token)} onFocus={(e) => e.currentTarget.select()} aria-label="Play link" />
                <button className="sm" onClick={() => navigator.clipboard.writeText(shareUrl(made.token)).then(() => toast('Link copied.', 'ok'), toastError)}>Copy</button>
                <a className="btn sm" href={shareUrl(made.token)} target="_blank" rel="noreferrer">Open</a>
              </div>
              {made.expires_at && <span className="faint small">This link works until {new Date(made.expires_at).toLocaleDateString()}.</span>}
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
                  {l.listed && <span className="chip">gallery</span>}
                  <span className="faint">{l.expires_at ? `until ${new Date(l.expires_at).toLocaleDateString()}` : new Date(l.created_at).toLocaleDateString()}</span>
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
