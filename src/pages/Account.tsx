// Sign in, profile, cloud saves, published maps and (for moderators) reports.
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { accountsEnabled, backendMode, setUser, useAuthReady, useBackend, useUser, type CloudProjectMeta, type HubMapMeta, type HubReport, type User } from '../lib/backend'
import { db } from '../lib/db'
import { fmtBytes } from '../lib/files'
import { Avatar, Field, confirmDialog, timeAgo, toast, toastError, useBusy } from '../ui'
import { openCloudProject } from './CloudSection'
import { AccountsOff, HubCard } from './Hub'

type Provider = 'github' | 'discord' | 'google'
const PROVIDER_LABELS: Record<Provider, string> = { github: 'GitHub', discord: 'Discord', google: 'Google' }
const PROVIDERS = ((import.meta.env.VITE_AUTH_PROVIDERS as string | undefined) ?? 'github,discord')
  .split(',').map((s) => s.trim()).filter((s): s is Provider => s in PROVIDER_LABELS)

function SignIn() {
  const b = useBackend()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState('')
  const [run, busy] = useBusy()
  const local = backendMode === 'local'
  const submit = (e: FormEvent) => {
    e.preventDefault()
    run(async () => { if ((await b!.signInWithEmail(email)) === 'link-sent') setSent(email.trim()) })
  }
  return (
    <div className="page page-narrow">
      <div className="hero" style={{ paddingTop: 8 }}>
        <h1>Sign <b>in</b></h1>
        <p>An account adds cloud saves (open your maps on any device) and lets you publish to and remix from the community hub. Your Saints Row game files and data pack never leave this device.</p>
      </div>
      {local && <div className="callout warn"><p className="small">Local test server: accounts, cloud saves and the hub are simulated in this browser. Signing in is instant and the first account becomes a moderator.</p></div>}
      <div className="card">
        {sent ? (
          <div className="col">
            <h3>Check your email</h3>
            <p className="muted">We sent a sign-in link to <b>{sent}</b>. Open it on this device to finish signing in.</p>
            <div><button className="quiet sm" onClick={() => setSent('')}>Use another address</button></div>
          </div>
        ) : (
          <form className="col" onSubmit={submit}>
            <Field label="Email" hint={local ? undefined : "We'll email you a sign-in link. No password needed."}>
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </Field>
            <div><button className="primary" type="submit" disabled={busy || !b}>{local ? 'Sign in' : 'Email me a link'}</button></div>
          </form>
        )}
        {(local || PROVIDERS.length > 0) && <>
          <div className="section-title">Or</div>
          <div className="row wrap">
            {local
              ? <button disabled={busy || !b} onClick={() => run(() => b!.signInWithProvider('github'))}>Sign in as Local tester</button>
              : PROVIDERS.map((p) => <button key={p} disabled={busy || !b} onClick={() => run(() => b!.signInWithProvider(p))}>Continue with {PROVIDER_LABELS[p]}</button>)}
          </div>
        </>}
      </div>
    </div>
  )
}

function Profile({ user }: { user: User }) {
  const b = useBackend()
  const [name, setName] = useState(user.name)
  const [run, busy] = useBusy()
  useEffect(() => setName(user.name), [user.name])
  const save = (e: FormEvent) => {
    e.preventDefault()
    run(async () => { setUser(await b!.updateProfile(name)); toast('Display name saved.', 'ok') })
  }
  return (
    <div className="card">
      <div className="row">
        <Avatar name={user.name} url={user.avatar_url} />
        <h2 className="grow">{user.name}</h2>
        {user.is_moderator && <span className="chip accent">moderator</span>}
        <button className="quiet" disabled={busy} onClick={() => run(() => b!.signOut())}>Sign out</button>
      </div>
      <form className="row" onSubmit={save}>
        <Field label="Display name" hint="Shown on maps you publish.">
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </Field>
        <button type="submit" disabled={busy || !name.trim() || name.trim() === user.name} style={{ alignSelf: 'center' }}>Save</button>
      </form>
      {b && <p className="small faint">{b.label}</p>}
    </div>
  )
}

function CloudSaves() {
  const b = useBackend()
  const navigate = useNavigate()
  const [items, setItems] = useState<CloudProjectMeta[] | null>(null)
  const [run, busy] = useBusy()
  const load = () => b?.listCloudProjects().then(setItems, toastError)
  useEffect(() => { void load() }, [b])
  const remove = (p: CloudProjectMeta) => run(async () => {
    if (!(await confirmDialog('Delete cloud save?', `"${p.name}" is removed from the cloud. A copy on this device, if there is one, is kept.`, { confirm: 'Delete', danger: true }))) return
    await b!.deleteCloudProject(p.id)
    const local = await db.getProject(p.id)
    if (local?.cloud) await db.putProject({ ...local, cloud: undefined })
    await load()
  })
  return (
    <section className="col">
      <div className="section-title">Cloud saves</div>
      {!items ? <p className="muted">Loading…</p> : items.length === 0 ? (
        <p className="muted">Nothing here yet. In the editor, use <b>Save to cloud</b> to keep a copy in your account.</p>
      ) : (
        <div className="list cloud-list">
          {items.map((p) => (
            <div key={p.id} className="list-item">
              {p.thumbnail_url ? <img src={p.thumbnail_url} alt="" /> : <span className="cloud-thumb-empty" />}
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <div className="meta">Saved {timeAgo(p.updated_at)} · {fmtBytes(p.size_bytes)}</div>
              </div>
              <button className="sm" disabled={busy} onClick={() => run(() => openCloudProject(p, navigate))}>Open</button>
              <button className="sm danger" disabled={busy} onClick={() => remove(p)}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Published() {
  const b = useBackend()
  const [items, setItems] = useState<HubMapMeta[] | null>(null)
  useEffect(() => { b?.myPublished().then(setItems, toastError) }, [b])
  return (
    <section className="col">
      <div className="section-title">My published maps</div>
      {!items ? <p className="muted">Loading…</p> : items.length === 0
        ? <p className="muted">You haven't published anything yet. Open a map in the editor and choose <b>Publish</b>. <Link to="/hub">Browse the hub</Link></p>
        : <div className="grid-cards">{items.map((m) => <HubCard key={m.id} m={m} />)}</div>}
    </section>
  )
}

const REASON_LABELS: Record<HubReport['reason'], string> = {
  'game-data': 'Game files', stolen: 'Stolen work', offensive: 'Offensive', spam: 'Spam', broken: 'Broken', other: 'Other',
}

function Moderation() {
  const b = useBackend()
  const [items, setItems] = useState<HubReport[] | null>(null)
  const [run, busy] = useBusy()
  const load = () => b?.listReports().then(setItems, toastError)
  useEffect(() => { void load() }, [b])
  const resolve = (r: HubReport, action: 'dismiss' | 'hide') => run(async () => {
    await b!.resolveReport(r.id, action)
    toast(action === 'hide' ? `"${r.map_title}" is hidden.` : 'Report dismissed.', 'ok')
    await load()
  })
  return (
    <section className="col">
      <div className="section-title">Moderation · open reports</div>
      {!items ? <p className="muted">Loading…</p> : items.length === 0 ? <p className="muted">No open reports.</p> : (
        <div className="col">
          {items.map((r) => (
            <div key={r.id} className="card tight">
              <div className="row wrap">
                <span className="chip accent">{REASON_LABELS[r.reason] ?? r.reason}</span>
                <Link to={`/hub/${r.map_id}`} style={{ fontWeight: 700 }}>{r.map_title}</Link>
                <span className="small faint grow">by {r.reporter} · {timeAgo(r.created_at)}</span>
                <button className="sm" disabled={busy} onClick={() => resolve(r, 'dismiss')}>Dismiss</button>
                <button className="sm danger" disabled={busy} onClick={() => resolve(r, 'hide')}>Hide map</button>
              </div>
              {r.details && <p className="small muted" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.details}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default function Account() {
  const user = useUser()
  const ready = useAuthReady()
  if (!accountsEnabled) return <AccountsOff />
  if (!ready) return <div className="page"><p className="muted">Loading…</p></div>
  if (!user) return <SignIn />
  return (
    <div className="page page-narrow">
      <h1>Account</h1>
      <Profile user={user} />
      <CloudSaves />
      <Published />
      {user.is_moderator && <Moderation />}
    </div>
  )
}
