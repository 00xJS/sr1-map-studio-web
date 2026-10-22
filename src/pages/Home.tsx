import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { db, requestPersistence, type ProjectRecord } from '../lib/db'
import { newProject, normalizeProject, uid } from '../lib/project'
import { dataPackStatus, type DataPackStatus } from '../lib/datapack'
import { downloadBlob } from '../lib/exporter'
import { accountsEnabled } from '../lib/backend'
import { FileButton, confirmDialog, infoDialog, timeAgo, toastError, useBusy } from '../ui'

const CloudSection = lazy(() => import('./CloudSection').then((m) => ({ default: m.CloudSection })))

type Meta = Omit<ProjectRecord, 'project'>

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

export default function Home() {
  const nav = useNavigate()
  const [projects, setProjects] = useState<Meta[] | null>(null)
  const [pack, setPack] = useState<DataPackStatus | null>(null)
  const [run, busy] = useBusy()
  const refresh = () => db.listProjects().then(setProjects)
  useEffect(() => { refresh(); dataPackStatus().then(setPack) }, [])

  const create = async () => {
    const p = newProject()
    await db.putProject({ id: p.id, name: p.name, updated_at: p.updated_at, project: p })
    void requestPersistence()
    nav('/editor/' + p.id)
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
    <div className="page">
      <section className="hero">
        <h1>Build <b>Saints Row 1</b> maps in your browser</h1>
        <p>Import your models, place spawns, glass, props and lights, then export a ready-to-install map for Saints Reborn. Your work saves automatically in this browser{accountsEnabled ? ', and you can sync it to your account and share it on the hub' : ''}.</p>
        <div className="row wrap">
          <button className="primary" onClick={create}>+ New map</button>
          <FileButton multiple accept=".zip,.json,.obj,.mtl,.glb,.gltf,.fbx,.png,.jpg,.jpeg,.tga,.bmp,.dds" onFiles={importFiles} disabled={busy}
            title="A .sr1map.zip backup, or a desktop .sr1map.json selected together with its models and textures">Import project…</FileButton>
          <FileButton directory onFiles={importFiles} disabled={busy} title="Pick the folder that holds a desktop .sr1map.json and its files">Import desktop project folder…</FileButton>
        </div>
      </section>

      {pack && !pack.ready && (
        <div className="callout warn">
          <div className="col grow">
            <b>One-time setup: load your data pack</b>
            <span className="small">Exporting needs the map template and prefabs from your own copy of the SR1 Map Studio package. It stays in this browser and is never uploaded. You can edit maps without it.</span>
          </div>
          <Link to="/setup" className="btn">Set up</Link>
        </div>
      )}

      <section className="col">
        <div className="row between"><h2>My maps</h2><span className="faint small">Saved in this browser</span></div>
        {projects === null ? <p className="muted">Loading…</p> : projects.length === 0 ? (
          <div className="card"><p className="muted">No maps yet. Create one, or import a desktop SR1 Map Studio project.</p></div>
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

      <section className="steps">
        <div className="card"><div className="row"><span className="step-num">1</span><h3>Import</h3></div><p className="muted small">Your own 3D models as OBJ (with its MTL and textures), GLB, glTF or FBX, exported from Blender or another 3D app, or downloaded from a model site. Or start from a map installed in <code>SaintsReborn/dist/maps</code>. Nothing else to install.</p></div>
        <div className="card"><div className="row"><span className="step-num">2</span><h3>Build</h3></div><p className="muted small">Move, rotate and scale objects; set textures and surfaces; place spawns, weapons, vehicles, glass, props and lights.</p></div>
        <div className="card"><div className="row"><span className="step-num">3</span><h3>Export</h3></div><p className="muted small">The original SR1 Map Studio exporter runs in your browser and gives you a folder to drop into <code>SaintsReborn/dist/maps</code>.</p></div>
      </section>
    </div>
  )
}
