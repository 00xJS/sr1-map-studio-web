import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useEditor, saveNow } from './store'
import { Viewport, getViewer } from './Viewport'
import { TOOL_KEYS, chooseTool } from './Tools'
import * as act from './actions'
import { ScenePanel } from './panels/ScenePanel'
import { AssetsPanel } from './panels/AssetsPanel'
import { MaterialsPanel } from './panels/MaterialsPanel'
import { MarkersPanel } from './panels/MarkersPanel'
import { LightsPanel } from './panels/LightsPanel'
import { ExportPanel } from './panels/ExportPanel'
import { db } from '../lib/db'
import { normalizeProject, type Project } from '../lib/project'
import { py } from '../lib/py'
import { accountsEnabled, hubEnabled } from '../lib/backend'
import { confirmDialog, toast, toastError } from '../ui'

const CloudButton = lazy(() => import('./CloudButton').then((m) => ({ default: m.CloudButton })))
const SamplePicker = lazy(() => import('../pages/SamplePicker').then((m) => ({ default: m.SamplePicker })))
const PublishDialog = lazy(() => import('./PublishDialog').then((m) => ({ default: m.PublishDialog })))

const TABS = [
  ['scene', 'Scene'], ['assets', 'Assets'], ['materials', 'Materials'], ['spawns', 'Spawns'], ['lights', 'Lights'], ['export', 'Export'],
] as const

export default function EditorPage() {
  const { id } = useParams()
  const project = useEditor((s) => s.project)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let live = true
    db.getProject(id!).then((rec) => {
      if (!live) return
      if (!rec) { setMissing(true); return }
      useEditor.getState().open(normalizeProject(rec.project))
      document.title = rec.name + ' · SR1 Map Studio'
    })
    void py.init().catch(() => {})
    const offLog = py.onLog((t) => useEditor.getState().log(t))
    return () => {
      live = false
      offLog()
      if (useEditor.getState().saveState === 'unsaved') void saveNow()
      useEditor.getState().close()
      document.title = 'SR1 Map Studio'
    }
  }, [id])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (useEditor.getState().saveState === 'unsaved') { void saveNow(); e.preventDefault() } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  useShortcuts()

  if (missing) return <div className="page"><h1>Map not found</h1><p className="muted">It isn't saved in this browser. <Link to="/">Back to my maps</Link></p></div>
  if (!project) return <div className="page"><p className="muted">Opening…</p></div>
  return <Editor />
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
      const st = useEditor.getState()
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? st.redo() : st.undo() }
      else if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); st.redo() }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(true).then(() => toast('Saved in this browser', 'ok', 1800)) }
      else if (mod && e.key.toLowerCase() === 'd' && !typing) {
        e.preventDefault()
        if (st.selection?.kind === 'item') { try { act.duplicateItem(st.selection.index) } catch (err) { toastError(err) } }
      }
      else if (typing) return
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (st.selection) { e.preventDefault(); act.removeSelected() } }
      else if (e.key === 'Escape') chooseTool('select')
      else if (e.key === '1') chooseTool('select')
      else if (e.key === '2') chooseTool('rotate')
      else if (e.key === '3') chooseTool('scale')
      else if (!mod && TOOL_KEYS[e.key.toLowerCase()]) chooseTool(TOOL_KEYS[e.key.toLowerCase()])
      else if (e.key.toLowerCase() === 'g') st.set({ snap: !st.snap })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function Editor() {
  const project = useEditor((s) => s.project)!
  const tab = useEditor((s) => s.tab)
  const [publishing, setPublishing] = useState(false)
  const [picking, setPicking] = useState(false)
  const importDropped = async (files: File[]) => {
    try {
      const st = useEditor.getState()
      const mode = st.project!.scene_items.length ? 'add' : 'base'
      await act.importModelFiles(files, mode)
    } catch (err) { toastError(err) }
  }
  // The map is empty when the picker is offered, so the sample replaces it (one undo step).
  const useSample = (p: Project) => {
    useEditor.getState().update('Start from ' + p.name, (d) => {
      d.scene_items = p.scene_items
      d.markers = p.markers
      d.lights = p.lights
      d.files = { ...d.files, ...p.files }
      d.settings.modes = p.settings.modes
      d.settings.base_name = p.settings.base_name
      d.settings.display_name = p.settings.display_name
      if (d.name === 'Untitled map') d.name = p.name
    })
    useEditor.getState().select(null)
  }
  return (
    <div className="editor">
      <TopBar onPublish={() => setPublishing(true)} />
      <div className="editor-main">
        <Viewport onEmptyImport={importDropped} onSamples={() => setPicking(true)} />
        <aside className="side">
          <div className="tabs" role="tablist">
            {TABS.map(([k, label]) => (
              <button key={k} role="tab" className={tab === k ? 'active' : ''} onClick={() => useEditor.getState().set({ tab: k })}>
                {label}{k === 'spawns' && project.markers.length ? ` (${project.markers.length})` : ''}
              </button>
            ))}
          </div>
          <div className="panel">
            {tab === 'scene' && <ScenePanel />}
            {tab === 'assets' && <AssetsPanel />}
            {tab === 'materials' && <MaterialsPanel />}
            {tab === 'spawns' && <MarkersPanel />}
            {tab === 'lights' && <LightsPanel />}
            {tab === 'export' && <ExportPanel />}
          </div>
        </aside>
      </div>
      <LogBar />
      {picking && <Suspense fallback={null}><SamplePicker onClose={() => setPicking(false)} onBuilt={useSample} /></Suspense>}
      {publishing && <Suspense fallback={null}><PublishDialog projectId={project.id} onClose={() => setPublishing(false)} /></Suspense>}
    </div>
  )
}

function TopBar({ onPublish }: { onPublish: () => void }) {
  const name = useEditor((s) => s.project!.name)
  const projectId = useEditor((s) => s.project!.id)
  const remix = useEditor((s) => s.project!.remix_of)
  const saveState = useEditor((s) => s.saveState)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const undoLabel = useEditor((s) => s.past[s.past.length - 1]?.label)
  const wireframe = useEditor((s) => s.wireframe)
  const snap = useEditor((s) => s.snap)
  const collision = useEditor((s) => s.collisionView)
  const doubleSided = useEditor((s) => s.project!.settings.double_sided)
  const update = useEditor((s) => s.update)
  const [pyStatus, setPyStatus] = useState(py.status)
  useEffect(() => py.onStatus(setPyStatus), [])
  const st = useEditor.getState
  return (
    <div className="editor-bar">
      <Link to="/" className="btn quiet" title="My maps">←</Link>
      <input className="name" value={name} onChange={(e) => update('Rename map', (d) => { d.name = e.target.value }, { merge: 'project-name' })} aria-label="Map name" />
      <span className="save-state">{({ saved: 'Saved', saving: 'Saving…', unsaved: 'Edited', error: 'Save failed' } as const)[saveState]}</span>
      {remix && <span className="chip" title={`Remix of ${remix.title} by ${remix.author}`}>remix</span>}
      <div className="btn-group">
        <button className="sm" disabled={!canUndo} onClick={() => st().undo()} title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}>↶</button>
        <button className="sm" disabled={!canRedo} onClick={() => st().redo()} title="Redo (Ctrl+Shift+Z)">↷</button>
      </div>
      <button className={'sm' + (snap ? ' on' : '')} onClick={() => st().set({ snap: !snap })} title="Move in steps of the Scene tab's Fine/Normal/Coarse size and rotate in 15° steps (G)">Snap</button>
      <button className={'sm' + (wireframe ? ' on' : '')} onClick={() => st().set({ wireframe: !wireframe })}>Wireframe</button>
      <button className={'sm' + (!doubleSided ? ' on' : '')} onClick={() => update('Backface culling', (d) => { d.settings.double_sided = !doubleSided })} title="On = normal one-sided SR1 rendering. Off also exports reversed render-only copies so both sides show in game.">Cull backfaces</button>
      <button className={'sm' + (collision === 'faces' ? ' on' : '')} onClick={() => st().set({ collisionView: collision === 'faces' ? 'off' : 'faces' })}>Collision</button>
      <button className="sm" onClick={() => getViewer()?.focusSelection()} title="Focus selected (F)">Focus</button>
      <span className="spacer" />
      <span className="small faint row" title="Python exporter runtime">
        <span className={'status-dot ' + (pyStatus === 'ready' ? 'ok' : pyStatus.startsWith('error') ? 'bad' : 'warn')} />
        {pyStatus === 'ready' ? 'Exporter ready' : pyStatus === 'idle' ? 'Exporter idle' : pyStatus}
      </span>
      {accountsEnabled && <Suspense fallback={null}><CloudButton projectId={projectId} /></Suspense>}
      {hubEnabled && <button className="sm" onClick={async () => { await saveNow(true); onPublish() }}>Publish</button>}
      <button className="sm primary" onClick={() => st().set({ tab: 'export' })}>Export</button>
      <button className="sm quiet" onClick={() => confirmDialog('Keyboard & mouse', 'Left drag: orbit · Right drag: pan · Wheel: zoom\nWASD / Q E: fly (Shift = faster) · F: focus selection\nTools (left strip): V select · 2 rotate · 3 scale · H shape · B paint bucket · I eyedropper\nP spawn · K weapon · L light · X eraser · Esc back to select · G snap\nCtrl+Z / Ctrl+Shift+Z: undo / redo\nCtrl+D: duplicate · Delete: remove · Ctrl+S: save\nDrag assets from the Assets tab onto the map.', { confirm: 'Got it', cancel: null })}>?</button>
    </div>
  )
}

function LogBar() {
  const logs = useEditor((s) => s.logs)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const pre = useRef<HTMLPreElement>(null)
  useEffect(() => { if (pre.current) pre.current.scrollTop = pre.current.scrollHeight }, [logs, open])
  useEffect(() => py.onStatus((s) => setBusy(s !== 'ready' && s !== 'idle' && !s.startsWith('error'))), [])
  useEffect(() => { if (logs.length && /fail|error/i.test(logs[logs.length - 1])) setOpen(true) }, [logs])
  return (
    <div className="logbar">
      {busy && <div className="progress"><div /></div>}
      <header>
        <span className="section-title">Build log</span>
        <span className="grow faint" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{logs[logs.length - 1] || 'Ready'}</span>
        <button className="sm quiet" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</button>
      </header>
      {open && <pre ref={pre}>{logs.join('\n') || 'Nothing logged yet.'}</pre>}
    </div>
  )
}
