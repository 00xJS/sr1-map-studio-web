import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { db, requestPersistence, type ProjectRecord } from '../lib/db'
import { newProject, normalizeProject, uid, type Project } from '../lib/project'
import { queueEdits, type PendingEdits } from '../lib/pendingEdits'
import { dataPackStatus, type DataPackStatus } from '../lib/datapack'
import { downloadBlob } from '../lib/exporter'
import { accountsEnabled, hubEnabled, useBackend, type HubMapMeta } from '../lib/backend'
import { SAMPLE_CARDS as SAMPLES, type SampleCard as Sample } from '../lib/sampleCatalog'
import { FileButton, Modal, confirmDialog, infoDialog, timeAgo, toastError, useBusy } from '../ui'
import { dropHasMap } from '../lib/mapFolder/files'
import { openMapDrop, openMapFiles } from '../lib/mapFolder/store'
import './home.css'

const CloudSection = lazy(() => import('./CloudSection').then((m) => ({ default: m.CloudSection })))
const HeroReel = lazy(() => import('./HeroReel'))
// The maps and the dialog to start one need every prefab: loaded when asked for, not with the home page.
const SamplePicker = lazy(() => import('./SamplePicker').then((m) => ({ default: m.SamplePicker })))

type Meta = Omit<ProjectRecord, 'project'>

/** Maps the hero circles, one a day: ones that build in a second or two. */
const REEL = ['pb_speedball', 'cy_grid', 'rooftops', 'arena'].filter((id) => SAMPLES.some((s) => s.id === id))
const reelSample = () => SAMPLES.find((s) => s.id === REEL[Math.floor(Date.now() / 864e5) % REEL.length]) ?? SAMPLES[0]

/** Catalog picks for the home page: the newest first, then one of each theme. */
function catalogPicks(n: number): Sample[] {
  const byNew = [...SAMPLES].filter((s) => s.added).sort((a, b) => (b.added ?? '').localeCompare(a.added ?? ''))
  const out: Sample[] = []
  const add = (s?: Sample) => { if (s && !out.includes(s) && out.length < n) out.push(s) }
  byNew.slice(0, 2).forEach(add)
  for (const theme of ['Urban', 'Urban paintball', 'Cyber', 'Starter']) add(SAMPLES.find((s) => s.theme === theme && !out.includes(s)))
  SAMPLES.forEach(add)
  return out
}

function Thumb({ blob }: { blob?: Blob }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) return
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return <div className="thumb">{url ? <img src={url} alt="" /> : <span>No preview yet</span>}</div>
}

/** This week's Showcase pick, when the site has a Showcase. */
function ShowcaseTeaser() {
  const b = useBackend()
  const [m, setM] = useState<HubMapMeta | null>(null)
  useEffect(() => { b?.mapOfWeek().then(setM, () => {}) }, [b])
  if (!m) return null
  return (
    <Link to={`/showcase/${m.id}`} className="teaser card">
      <div className="pic">{m.thumbnail_url && <img src={m.thumbnail_url} alt="" />}</div>
      <div className="col" style={{ gap: 4 }}>
        <span className="section-title">Showcase · map of the week</span>
        <b>{m.title}</b>
        <span className="small muted">by {m.author.name}{m.ratings ? ` · ★ ${m.rating.toFixed(1)}` : ''}</span>
      </div>
    </Link>
  )
}

export default function Home() {
  const nav = useNavigate()
  const [projects, setProjects] = useState<Meta[] | null>(null)
  const [pack, setPack] = useState<DataPackStatus | null>(null)
  const [run, busy] = useBusy()
  const [picking, setPicking] = useState<null | 'first' | 'any'>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [reel] = useState(reelSample)
  const [live, setLive] = useState(false)
  const refresh = () => db.listProjects().then(setProjects)
  useEffect(() => { refresh(); dataPackStatus().then(setPack) }, [])

  const open = async (p: Project, edits?: PendingEdits, first = false) => {
    await db.putProject({ id: p.id, name: p.name, updated_at: p.updated_at, project: p })
    if (edits) queueEdits(p.id, edits)
    void requestPersistence()
    nav('/editor/' + p.id + (first ? '?first=1' : ''))
  }

  const start = async (s: Sample) => {
    setProgress(`Building ${s.name}…`)
    try { const { startFromSample } = await import('./sampleStart'); nav('/editor/' + (await startFromSample(s.id, false, (t) => setProgress(`${s.name}: ${t}`)))) }
    catch (e) { toastError(e); setProgress(null) }
  }

  const duplicate = (id: string) => run(async () => {
    const rec = await db.getProject(id)
    if (!rec) return
    const p = normalizeProject(structuredClone(rec.project))
    p.id = uid()
    p.name = rec.name + ' copy'
    p.updated_at = new Date().toISOString()
    await db.putProject({ id: p.id, name: p.name, updated_at: p.updated_at, project: p, thumbnail: rec.thumbnail })
    await refresh()
  })

  const remove = async (m: Meta) => {
    if (!(await confirmDialog('Delete map?', `“${m.name}” will be removed from this browser. ${m.cloud ? 'Your cloud copy is not affected.' : 'This cannot be undone. Download a backup first if you might need it.'}`, { confirm: 'Delete', danger: true }))) return
    await db.deleteProject(m.id)
    await refresh()
  }

  const backup = (id: string) => run(async () => {
    const rec = await db.getProject(id)
    if (!rec) return
    const { exportProjectZip } = await import('../lib/projectFiles')
    downloadBlob(await exportProjectZip(rec.project, rec.thumbnail), `${rec.name.replace(/[^\w -]+/g, '') || 'map'}.sr1map.zip`)
  })

  const importFiles = (files: File[]) => run(async () => {
    const { importDesktopProject, importProjectZip } = await import('../lib/projectFiles')
    const zip = files.find((f) => /\.zip$/i.test(f.name))
    if (zip) { nav('/editor/' + (await importProjectZip(zip))); return }
    const r = await importDesktopProject(files)
    if (r.missing.length || r.notes.length) {
      await infoDialog('Desktop project imported', <div className="col">
        {r.missing.length > 0 && <><b>Files not found in your selection</b><pre>{r.missing.join('\n')}</pre><span className="small muted">Assign these later in the Materials tab, or import again selecting the folder that contains them.</span></>}
        {r.notes.map((n) => <span key={n} className="small muted">{n}</span>)}
      </div>)
    }
    nav('/editor/' + r.projectId)
  })

  return (
    <div className="page home">
      <section className="home-hero">
        <div className="home-hero-text">
          <span className="section-title">Saints Row 1 multiplayer map editor</span>
          <h1>Build <b>Saints Row 1</b> maps in your browser</h1>
          <p>Generate a map in seconds, walk it at player height, then press Play to drop it into your game. Free and open source, and there's nothing to install.</p>
          <div className="row wrap">
            <button className="primary big" onClick={() => setPicking('first')}>Make your first map</button>
            <Link to="/maps" className="btn big">Browse {SAMPLES.length} sample maps</Link>
          </div>
          <span className="small faint">Your maps save in this browser{accountsEnabled ? ', and you can sync them to your account' : ''}.</span>
        </div>
        <div className={'home-reel' + (live ? ' live' : '')}>
          <img src={`/samples/${reel.id}.webp`} alt={`${reel.name}, a sample map`} />
          <Suspense fallback={null}><HeroReel sampleId={reel.id} onReady={() => setLive(true)} /></Suspense>
          <span className="reel-label">{live ? '● Live' : 'Sample map'} · {reel.name}</span>
        </div>
      </section>

      <section className="first-map" aria-labelledby="first-map-title">
        <div className="row between wrap">
          <h2 id="first-map-title">Your first map in 60 seconds</h2>
          <button className="primary" onClick={() => setPicking('first')}>Start now</button>
        </div>
        <ol className="path">
          <li>
            <span className="step-num">1</span>
            <div className="col"><b>Generate <span className="faint small">· 15 s</span></b><span className="small muted">The map wizard: pick a setting, a layout and how many players, reroll until you like it.</span></div>
          </li>
          <li>
            <span className="step-num">2</span>
            <div className="col"><b>Walk it <span className="faint small">· 30 s</span></b><span className="small muted">Press <b>🚶 Walk</b> and run, jump and crouch through it at player height, spawn to spawn.</span></div>
          </li>
          <li>
            <span className="step-num">3</span>
            <div className="col"><b>Play <span className="faint small">· 15 s</span></b><span className="small muted">Press <b>▶ Play</b>: the map is built in your browser and installed into Saints Reborn.</span></div>
          </li>
        </ol>
      </section>

      <section className="col">
        <div className="row between wrap"><h2>Start from a sample map</h2><Link to="/maps" className="small">All {SAMPLES.length} maps in the catalog →</Link></div>
        <div className="home-catalog">
          {catalogPicks(6).map((s) => (
            <button key={s.id} className="catalog-tile" disabled={!!progress} onClick={() => start(s)} title={s.description}>
              <div className="pic"><img src={`/samples/${s.id}.webp`} alt="" loading="lazy" /><span className="chip">{s.theme}</span></div>
              <div className="txt"><b>{s.name}</b><span className="small muted">{s.description}</span></div>
            </button>
          ))}
        </div>
      </section>

      {hubEnabled && <ShowcaseTeaser />}

      {pack && !pack.ready && (
        <div className="callout warn">
          <div className="col grow">
            <b>One-time setup before you export: load your data pack</b>
            <span className="small">Exporting needs the map template and prefabs from your own copy of the SR1 Map Studio package. It stays in this browser and is never uploaded. You can build and walk maps without it.</span>
          </div>
          <Link to="/setup" className="btn">Set up</Link>
        </div>
      )}

      <section className="col"
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
        onDrop={(e) => { if (!dropHasMap(e.dataTransfer)) return; e.preventDefault(); openMapDrop(e.dataTransfer).catch(toastError) }}>
        <div className="row between wrap">
          <h2>My maps</h2>
          <div className="row wrap">
            <button className="sm" onClick={() => setPicking('any')}>+ New map</button>
            <FileButton className="sm" multiple accept=".zip,.json,.obj,.mtl,.glb,.gltf,.fbx,.png,.jpg,.jpeg,.tga,.bmp,.dds" onFiles={importFiles} disabled={busy}
              title="A .sr1map.zip backup, or a desktop .sr1map.json selected together with its models and textures">Import project…</FileButton>
            <FileButton className="sm" directory onFiles={importFiles} disabled={busy} title="Pick the folder that holds a desktop .sr1map.json and its files">Import desktop folder…</FileButton>
            <FileButton className="sm" directory onFiles={(f) => run(() => openMapFiles(f))} disabled={busy}
              title="A finished map from SaintsReborn/dist/maps (the folder with bundle_info.xtbl and levels/): edit it and export it again, or add the game's sky to it">Open a game map…</FileButton>
            <FileButton className="sm" accept=".zip" onFiles={(f) => run(() => openMapFiles(f))} disabled={busy} title="A zip of a finished map folder">Open a map zip…</FileButton>
          </div>
        </div>
        <p className="small faint">Made a map a while ago? <b>Open a game map</b> picks its folder in <code>SaintsReborn/dist/maps</code> (or drop the folder or its zip here) to edit it, or to add the game's own sky without rebuilding it.</p>
        {projects === null ? <p className="muted">Loading…</p> : projects.length === 0 ? (
          <div className="card"><p className="muted">No maps yet. Make one above, or import a desktop SR1 Map Studio project. Maps are saved in this browser; to pass one to someone, use <b>Backup</b> and they open it with <b>Import project…</b>.</p></div>
        ) : (
          <div className="grid-cards">
            {projects.map((m) => (
              <div key={m.id} className="map-card">
                <Link to={'/editor/' + m.id} style={{ color: 'inherit' }}><Thumb blob={m.thumbnail} /></Link>
                <div className="body">
                  <Link to={'/editor/' + m.id} className="title" style={{ color: 'inherit' }}>{m.name}</Link>
                  <span className="faint small">Edited {timeAgo(m.updated_at)}{m.cloud ? ' · in cloud' : ''}</span>
                  <div className="row wrap" style={{ marginTop: 6 }}>
                    <Link to={'/editor/' + m.id} className="btn sm primary">Open</Link>
                    <button className="sm" onClick={() => duplicate(m.id)}>Duplicate</button>
                    <button className="sm" onClick={() => backup(m.id)} title="Download a .sr1map.zip backup with all files">Backup</button>
                    <button className="sm quiet" onClick={() => remove(m).catch(toastError)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {accountsEnabled && <Suspense fallback={null}><CloudSection /></Suspense>}

      <section className="col">
        <h2>Bring your own models</h2>
        <div className="steps">
          <div className="card"><div className="row"><span className="step-num">1</span><h3>Import</h3></div><p className="muted small">Your own 3D models as OBJ (with its MTL and textures), GLB, glTF or FBX, exported from Blender or another 3D app. Or start from a map installed in <code>SaintsReborn/dist/maps</code>.</p></div>
          <div className="card"><div className="row"><span className="step-num">2</span><h3>Build</h3></div><p className="muted small">Move, rotate and scale objects; set textures and surfaces; place spawns, weapons, vehicles, glass, props and lights.</p></div>
          <div className="card"><div className="row"><span className="step-num">3</span><h3>Export</h3></div><p className="muted small">The original SR1 Map Studio exporter runs in your browser and gives you a folder to drop into <code>SaintsReborn/dist/maps</code>.</p></div>
        </div>
      </section>

      {picking && <Suspense fallback={null}><SamplePicker onClose={() => setPicking(null)} onBuilt={(p, edits) => open(p, edits, picking === 'first')} onBlank={() => open(newProject()).catch(toastError)} /></Suspense>}
      {progress && <Modal title="Building map"><div className="col"><div className="progress"><div /></div><span className="small muted">{progress}</span></div></Modal>}
    </div>
  )
}
