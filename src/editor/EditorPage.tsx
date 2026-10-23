import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useEditor, saveNow, readFlag, writeFlag, selectedItems } from './store'
import { Viewport, getViewer } from './Viewport'
import { Inspector } from './Inspector'
import { PlayDialog } from './PlayDialog'
import { Tour } from './Tour'
import { TOOL_KEYS, chooseTool } from './Tools'
import * as act from './actions'
import { ScenePanel } from './panels/ScenePanel'
import { AssetsPanel } from './panels/AssetsPanel'
import { MaterialsPanel } from './panels/MaterialsPanel'
import { MarkersPanel } from './panels/MarkersPanel'
import { LightsPanel } from './panels/LightsPanel'
import { ExportPanel } from './panels/ExportPanel'
import { HealthPanel } from './HealthPanel'
import { db } from '../lib/db'
import { normalizeProject, type Project } from '../lib/project'
import { py } from '../lib/py'
import { accountsEnabled, hubEnabled } from '../lib/backend'
import { confirmDialog, toast, toastError } from '../ui'

const CloudButton = lazy(() => import('./CloudButton').then((m) => ({ default: m.CloudButton })))
const AiChat = lazy(() => import('./AiChat').then((m) => ({ default: m.AiChat })))
const SamplePicker = lazy(() => import('../pages/SamplePicker').then((m) => ({ default: m.SamplePicker })))
const PublishDialog = lazy(() => import('./PublishDialog').then((m) => ({ default: m.PublishDialog })))

const TABS = [
  ['scene', 'Objects'], ['assets', 'Library'], ['materials', 'Textures'], ['spawns', 'Spawns'], ['lights', 'Lights'], ['health', 'Health'], ['export', 'Map & export'],
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
      if (st.walking) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? st.redo() : st.undo() }
      else if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); st.redo() }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(true).then(() => toast('Saved in this browser', 'ok', 1800)) }
      else if (mod && e.key.toLowerCase() === 'd' && !typing) {
        e.preventDefault()
        if (selectedItems().length) { try { act.duplicateItems(selectedItems()) } catch (err) { toastError(err) } }
      }
      else if (typing) return
      else if (mod && e.key.toLowerCase() === 'c') {
        if (!selectedItems().length || window.getSelection()?.toString()) return
        e.preventDefault()
        try { const n = act.copyItems(selectedItems()); toast(`Copied ${n} object${n === 1 ? '' : 's'}. Ctrl+V pastes, in this map or another.`, 'ok', 2200) } catch (err) { toastError(err) }
      }
      else if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        try { if (!act.pasteItems()) toast('Nothing copied yet: pick objects and press Ctrl+C.', 'info', 2200) } catch (err) { toastError(err) }
      }
      else if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        try { e.shiftKey ? act.ungroupItems(selectedItems()) : act.groupItems(selectedItems()) } catch (err) { toastError(err) }
      }
      else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        st.selectItems(st.project?.scene_items.map((_, i) => i) ?? [])
      }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.multi.length > 1) { e.preventDefault(); act.removeItems(st.multi) }
        else if (st.selection) { e.preventDefault(); act.removeSelected() }
      }
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
  const advanced = useEditor((s) => s.advanced)
  const [publishing, setPublishing] = useState(false)
  const [picking, setPicking] = useState(false)
  const [chatting, setChatting] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [touring, setTouring] = useState(false)
  const hasItems = project.scene_items.length > 0
  // First visit: show the tour once there's something to look at.
  useEffect(() => { if (hasItems && !readFlag('sr1-tour-done')) setTouring(true) }, [hasItems])
  const endTour = () => { writeFlag('sr1-tour-done', true); setTouring(false) }
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
    <div className={'editor ' + (advanced ? 'advanced' : 'simple')}>
      <TopBar onPublish={() => setPublishing(true)} onPlay={() => setPlaying(true)} onTour={() => setTouring(true)} onAi={() => setChatting((v) => !v)} />
      <div className="editor-main">
        <Viewport onEmptyImport={importDropped} onSamples={() => setPicking(true)} />
        <aside className="side">
          {advanced ? (
            <>
              <div className="tabs" role="tablist">
                {TABS.map(([k, label]) => (
                  <button key={k} role="tab" className={tab === k ? 'active' : ''} onClick={() => useEditor.getState().set({ tab: k })}>
                    {label}{k === 'spawns' && project.markers.length ? ` (${project.markers.length})` : ''}
                  </button>
                ))}
              </div>
              <div className="panel" data-tour="panel">
                {tab === 'scene' && <ScenePanel />}
                {tab === 'assets' && <AssetsPanel />}
                {tab === 'materials' && <MaterialsPanel />}
                {tab === 'spawns' && <MarkersPanel />}
                {tab === 'lights' && <LightsPanel />}
                {tab === 'export' && <ExportPanel />}
                {tab === 'health' && <HealthPanel />}
              </div>
            </>
          ) : <Inspector onSamples={() => setPicking(true)} onPlay={() => setPlaying(true)} />}
        </aside>
      </div>
      {advanced && <LogBar />}
      {picking && <Suspense fallback={null}><SamplePicker onClose={() => setPicking(false)} onBuilt={useSample} /></Suspense>}
      {chatting && <Suspense fallback={null}><AiChat onClose={() => setChatting(false)} /></Suspense>}
      {playing && <PlayDialog onClose={() => setPlaying(false)} onSamples={() => { setPlaying(false); setPicking(true) }} />}
      {publishing && <Suspense fallback={null}><PublishDialog projectId={project.id} onClose={() => setPublishing(false)} /></Suspense>}
      {touring && !picking && !playing && <Tour onDone={endTour} />}
    </div>
  )
}

type MenuItem = { label: string; on?: boolean; run: () => void; title?: string } | null

/** A small drop-down menu; null items are separators. */
function Menu({ label, items, title }: { label: string; items: MenuItem[]; title?: string }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="menu-wrap" onMouseDown={(e) => e.stopPropagation()}>
      <button className={'sm' + (open ? ' on' : '')} onClick={() => setOpen(!open)} title={title} aria-haspopup="menu" aria-expanded={open}>{label} ▾</button>
      {open && (
        <div className="menu" role="menu">
          {items.map((it, i) => it ? (
            <button key={i} role={it.on === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={it.on} title={it.title} className="menu-item" onClick={() => { it.run(); setOpen(false) }}>
              <span className="check">{it.on ? '✓' : ''}</span>{it.label}
            </button>
          ) : <hr key={i} />)}
        </div>
      )}
    </div>
  )
}

const KEYS_HELP = 'Camera: left-drag spin · right-drag slide · scroll zoom · F zoom to selection · WASD / Q E fly (Shift = faster)\n' +
  'Tools: V move · 2 turn · 3 size · H shape · B paint · I pick · P spawn · K weapon · L light · X erase · Esc back to Move · G snap\n' +
  'Ctrl+Z / Ctrl+Shift+Z: undo / redo · Ctrl+D: copy · Delete: delete · Ctrl+S: save'

function TopBar({ onPublish, onPlay, onTour, onAi }: { onPublish: () => void; onPlay: () => void; onTour: () => void; onAi: () => void }) {
  const name = useEditor((s) => s.project!.name)
  const projectId = useEditor((s) => s.project!.id)
  const remix = useEditor((s) => s.project!.remix_of)
  const saveState = useEditor((s) => s.saveState)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const undoLabel = useEditor((s) => s.past[s.past.length - 1]?.label)
  const wireframe = useEditor((s) => s.wireframe)
  const snap = useEditor((s) => s.snap)
  const freeCam = useEditor((s) => s.freeCam)
  const collision = useEditor((s) => s.collisionView)
  const doubleSided = useEditor((s) => s.project!.settings.double_sided)
  const advanced = useEditor((s) => s.advanced)
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
        <button className="sm" disabled={!canUndo} onClick={() => st().undo()} title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}>↶ Undo</button>
        <button className="sm" disabled={!canRedo} onClick={() => st().redo()} title="Redo (Ctrl+Shift+Z)">↷</button>
      </div>
      <button className={'sm' + (snap ? ' on' : '')} onClick={() => st().set({ snap: !snap })} title="Line things up on a grid and turn in 15° steps (G)">Snap</button>
      <Menu label="View" items={[
        { label: 'Wireframe', on: wireframe, run: () => st().set({ wireframe: !wireframe }), title: 'Show the triangles' },
        { label: 'Show collision', on: collision === 'faces', run: () => st().set({ collisionView: collision === 'faces' ? 'off' : 'faces' }), title: 'Green = solid, red = players pass through' },
        { label: 'Show both sides of walls', on: doubleSided, run: () => update('Show both sides', (d) => { d.settings.double_sided = !doubleSided }), title: 'In the game, surfaces normally show from the front only. On also shows their backs.' },
        null,
        { label: 'Free camera (like the desktop app)', on: freeCam, run: () => st().set({ freeCam: !freeCam }), title: 'Hold the right mouse button to look around, WASD to fly, Q/E down and up, Shift faster, mouse wheel sets the speed' },
        { label: 'Zoom to selection (F)', run: () => getViewer()?.focusSelection() },
        { label: 'See the whole map', run: () => getViewer()?.frameAll() },
      ]} />
      <span className="spacer" />
      {advanced && (
        <span className="small faint row builder-status" title="Map builder (Python) status">
          <span className={'status-dot ' + (pyStatus === 'ready' ? 'ok' : pyStatus.startsWith('error') ? 'bad' : 'warn')} />
          {pyStatus === 'ready' ? 'Builder ready' : pyStatus === 'idle' ? 'Builder idle' : pyStatus}
        </span>
      )}
      <div className="btn-group" title="Simple shows what most maps need. Advanced shows every setting.">
        <button className={'sm' + (!advanced ? ' on' : '')} onClick={() => st().set({ advanced: false })}>Simple</button>
        <button className={'sm' + (advanced ? ' on' : '')} onClick={() => st().set({ advanced: true })}>Advanced</button>
      </div>
      {accountsEnabled && <Suspense fallback={null}><CloudButton projectId={projectId} /></Suspense>}
      {hubEnabled && <button className="sm" onClick={async () => { await saveNow(true); onPublish() }}>Publish</button>}
      <Menu label="Help" items={[
        { label: 'Take the tour', run: onTour },
        { label: 'Keyboard & mouse', run: () => void confirmDialog('Keyboard & mouse', KEYS_HELP, { confirm: 'Got it', cancel: null }) },
      ]} />
      <button className="sm" onClick={() => st().set({ walking: !st().walking, selection: null, multi: [] })} title="Walk the map at player height, like in the game">🚶 Walk</button>
      <button className="sm" onClick={onAi} title="Describe a change in your own words">✨ Ask AI</button>
      <button className="primary" data-tour="play" onClick={onPlay}>▶ Play</button>
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
