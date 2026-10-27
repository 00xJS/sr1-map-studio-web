import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEditor, saveNow, readFlag, writeFlag, selectedItems } from './store'
import { Viewport, getViewer } from './Viewport'
import { choosePreset, setLook, useLook } from './look'
import { PRESETS } from '../lib/gameLight'
import { Inspector } from './Inspector'
import { PlayDialog } from './PlayDialog'
import { Tour } from './Tour'
import { HistoryPanel } from './HistoryPanel'
import { FirstMapCoach } from './FirstMapCoach'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { VersionsDialog } from './VersionsDialog'
import { toggleOverlay, useOverlays } from './overlays'
import { autoVersion } from '../lib/versions'
import { TOOL_KEYS, chooseTool } from './Tools'
import * as act from './actions'
import { ScenePanel } from './panels/ScenePanel'
import { LayersPanel } from './panels/LayersPanel'
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
import { FileButton, toast, toastError } from '../ui'
import { openMapFiles } from '../lib/mapFolder/store'
import { onQueued, queueEdits, takeEdits, type PendingEdits } from '../lib/pendingEdits'
import { runAiActions } from './aiActions'
import { runMapChecks } from './mapChecks'
import { useChat } from './aiSession'

const CloudButton = lazy(() => import('./CloudButton').then((m) => ({ default: m.CloudButton })))
const AiChat = lazy(() => import('./AiChat').then((m) => ({ default: m.AiChat })))
const SamplePicker = lazy(() => import('../pages/SamplePicker').then((m) => ({ default: m.SamplePicker })))
const PublishDialog = lazy(() => import('./PublishDialog').then((m) => ({ default: m.PublishDialog })))
const ShareDialog = lazy(() => import('../play/ShareDialog').then((m) => ({ default: m.ShareDialog })))

const TABS = [
  ['scene', 'Objects'], ['layers', 'Layers'], ['assets', 'Library'], ['materials', 'Textures'], ['spawns', 'Spawns'], ['lights', 'Lights'], ['health', 'Health'], ['export', 'Map & export'],
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
      const opened = normalizeProject(rec.project)
      useEditor.getState().open(opened)
      void autoVersion(opened, rec.thumbnail).catch(() => {})
      document.title = rec.name + ' · SR1 Map Studio'
    })
    void py.init().catch(() => {})
    const offLog = py.onLog((t) => useEditor.getState().log(t))
    return () => {
      live = false
      offLog()
      if (useEditor.getState().saveState === 'unsaved') void saveNow()
      useEditor.getState().close()
      useOverlays.setState({ versions: false, keys: false })
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
      else if (mod && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); toggleOverlay('versions', true) }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(true).then(() => toast('Saved in this browser', 'ok', 1800)) }
      else if (mod && e.key.toLowerCase() === 'd' && !typing) {
        e.preventDefault()
        if (selectedItems().length) { try { act.duplicateItems(selectedItems()) } catch (err) { toastError(err) } }
      }
      else if (typing) return
      else if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) { e.preventDefault(); toggleOverlay('keys') }
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
      // While placing shapes and prefabs, R turns the ghost (Shift+R the other way) instead of picking the Road tool.
      else if (!mod && st.tool === 'shape' && e.key.toLowerCase() === 'r') { e.preventDefault(); st.set({ placeRot: (((st.placeRot + (e.shiftKey ? -15 : 15)) % 360) + 360) % 360 }) }
      else if (!mod && TOOL_KEYS[e.key.toLowerCase()]) chooseTool(TOOL_KEYS[e.key.toLowerCase()])
      else if (e.key.toLowerCase() === 'g') st.set({ snap: !st.snap })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Runs edits the AI queued for this map (the extras for a map it made) once the 3D view has loaded it. */
function usePendingEdits(openChat: () => void) {
  const id = useEditor((s) => s.project?.id)
  useEffect(() => {
    if (!id) return
    let live = true
    const run = async () => {
      const job = takeEdits(id)
      if (!job) return
      // Edits land on surfaces, so wait (up to 20 s) for the objects to load.
      for (let k = 0; k < 100 && live; k++) {
        const v = getViewer(), p = useEditor.getState().project
        if (v && p && p.scene_items.every((_, i) => v.itemBounds(i))) break
        await new Promise((r) => setTimeout(r, 200))
      }
      if (!live) { queueEdits(id, job); return }
      // Game models bring their own stairs and slivers: ramps over stairs too tall to run up, the invisible walls,
      // then the health check, summed up with what the wizard found.
      if (job.checks) void runMapChecks(job.summary)
      if (!job.actions.length) return
      const { done, skipped } = await runAiActions(job.actions, job.label)
      const chat = useChat.getState()
      if (chat.turns.length || job.openChat) chat.add({ role: 'assistant', text: done ? `Added the extras: ${done} change${done === 1 ? '' : 's'}.` : 'The extras made no changes.', note: skipped.length ? `Skipped: ${skipped.join('; ')}.` : undefined, undoLabel: done ? job.label : undefined })
      else if (done) toast(`AI extras: ${done} change${done === 1 ? '' : 's'} (undo to remove them).`)
      if (job.openChat) openChat()
    }
    void run()
    const off = onQueued(() => void run())
    return () => { live = false; off() }
  }, [id])
}

function Editor() {
  const project = useEditor((s) => s.project)!
  const tab = useEditor((s) => s.tab)
  const advanced = useEditor((s) => s.advanced)
  const [publishing, setPublishing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [picking, setPicking] = useState(false)
  const [chatting, setChatting] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [touring, setTouring] = useState(false)
  usePendingEdits(() => setChatting(true))
  const overlays = useOverlays()
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
  const useSample = (p: Project, edits?: PendingEdits) => {
    if (edits) queueEdits(project.id, edits)
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
      <TopBar onPublish={() => setPublishing(true)} onShare={() => setSharing(true)} onPlay={() => setPlaying(true)} onTour={() => setTouring(true)} onAi={() => setChatting((v) => !v)} />
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
                {tab === 'layers' && <LayersPanel />}
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
      {sharing && <Suspense fallback={null}><ShareDialog projectId={project.id} onClose={() => setSharing(false)} /></Suspense>}
      {touring && !picking && !playing && <Tour onDone={endTour} />}
      {overlays.history && <HistoryPanel />}
      {overlays.versions && <VersionsDialog />}
      {overlays.keys && <ShortcutsOverlay />}
      <FirstMapCoach />
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
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <div className="menu-wrap" onPointerDown={(e) => e.stopPropagation()}>
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

function TopBar({ onPublish, onShare, onPlay, onTour, onAi }: { onPublish: () => void; onShare: () => void; onPlay: () => void; onTour: () => void; onAi: () => void }) {
  const navigate = useNavigate()
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
  const layered = useEditor((s) => s.layeredLook)
  const collision = useEditor((s) => s.collisionView)
  const doubleSided = useEditor((s) => s.project!.settings.double_sided)
  const advanced = useEditor((s) => s.advanced)
  const update = useEditor((s) => s.update)
  const historyOpen = useOverlays((s) => s.history)
  const look = useLook()
  const [pyStatus, setPyStatus] = useState(py.status)
  useEffect(() => py.onStatus(setPyStatus), [])
  const st = useEditor.getState
  return (
    <div className="editor-bar">
      <Link to="/" className="btn quiet" title="My maps">←</Link>
      <FileButton className="sm quiet" directory onFiles={(f) => openMapFiles(f).catch(toastError)}
        title="Open another finished map folder (from SaintsReborn/dist/maps) to edit it or add the game's sky; this map stays as it is. You can also drop a map folder or zip on the 3D view.">Open map…</FileButton>
      <input className="name" value={name} onChange={(e) => update('Rename map', (d) => { d.name = e.target.value }, { merge: 'project-name' })} aria-label="Map name" />
      <span className="save-state">{({ saved: 'Saved', saving: 'Saving…', unsaved: 'Edited', error: 'Save failed' } as const)[saveState]}</span>
      {remix && <span className="chip" title={`Remix of ${remix.title} by ${remix.author}`}>remix</span>}
      <div className="btn-group">
        <button className="sm" disabled={!canUndo} onClick={() => st().undo()} title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}>↶ Undo</button>
        <button className="sm" disabled={!canRedo} onClick={() => st().redo()} title="Redo (Ctrl+Shift+Z)">↷</button>
      </div>
      <Menu label="History" title="Undo history and saved versions" items={[
        { label: 'Undo history', on: historyOpen, run: () => toggleOverlay('history'), title: 'Every step since you opened the map; click one to go back to it' },
        { label: 'Saved versions… (Ctrl+Shift+S)', run: () => toggleOverlay('versions', true), title: 'Keep a copy of the map and restore it later' },
      ]} />
      <button className={'sm' + (snap ? ' on' : '')} onClick={() => st().set({ snap: !snap })} title="Line things up on a grid and turn in 15° steps (G)">Snap</button>
      <Menu label="View" items={[
        { label: 'Wireframe', on: wireframe, run: () => st().set({ wireframe: !wireframe }), title: 'Show the triangles' },
        { label: 'Show collision', on: collision === 'faces', run: () => st().set({ collisionView: collision === 'faces' ? 'off' : 'faces' }), title: 'Green = solid, red = players pass through' },
        { label: 'Layered surfaces (preview)', on: layered, run: () => st().set({ layeredLook: !layered }), title: 'Draws your shapes and prefabs the way the game\'s own surfaces avoid repeating: an even base tile with soft grime every 10-15 m and a gentle colour change every 100 m. Only in this view: your textures and the exported map stay as they are.' },
        { label: 'Show both sides of walls', on: doubleSided, run: () => update('Show both sides', (d) => { d.settings.double_sided = !doubleSided }), title: 'In the game, surfaces normally show from the front only. On also shows their backs.' },
        null,
        { label: 'Free camera (like the desktop app)', on: freeCam, run: () => st().set({ freeCam: !freeCam }), title: 'Hold the right mouse button to look around, WASD to fly, Q/E down and up, Shift faster, mouse wheel sets the speed' },
        { label: 'Zoom to selection (F)', run: () => getViewer()?.focusSelection() },
        { label: 'See the whole map', run: () => getViewer()?.frameAll() },
        { label: 'Show guide grid', on: getViewer()?.gridShown ?? true, run: () => { const v = getViewer(); v?.showGrid(!v.gridShown) }, title: 'The guide lines under the map: only a guide, not part of the map' },
      ]} />
      <Menu label={look.mode === 'game' ? '☀ Lighting' : 'Lighting'} title="Light the view as the game does, at the time of day and weather you pick" items={[
        { label: 'Game lighting (as in the game)', on: look.mode === 'game', run: () => setLook({ mode: 'game' }), title: "The game's sun, fill light, shadows and fog" },
        { label: 'Bright editor lighting', on: look.mode === 'editor', run: () => setLook({ mode: 'editor' }), title: 'Even, bright light for building: not how the game looks' },
        null,
        ...PRESETS.map((p) => ({ label: p.label, on: look.mode === 'game' && look.preset === p.key, run: () => { void choosePreset(p.key) }, title: p.key === 'noon' ? 'How every map with always-clear weather looks in the game' : 'Read from your own game files' })),
        null,
        { label: 'Shadows', on: look.shadows, run: () => setLook({ shadows: !look.shadows }), title: 'The sun casts shadows, as in the game' },
        { label: 'Fog while editing', on: look.fogWhileEditing, run: () => setLook({ fogWhileEditing: !look.fogWhileEditing }), title: "The game's fog in the editor too (always on when you walk or play)" },
        { label: 'SRMaxDetail look', on: look.maxDetail, run: () => setLook({ maxDetail: !look.maxDetail }), title: 'How the game looks with the SRMaxDetail mod installed (darker shade, brighter sun)' },
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
        { label: 'Keyboard, mouse & touch (?)', run: () => toggleOverlay('keys', true) },
      ]} />
      <button className="sm" onClick={() => st().set({ walking: !st().walking, selection: null, multi: [] })} title="Walk the map at player height, like in the game">🚶 Walk</button>
      <button className="sm" onClick={async () => { await saveNow(); navigate(`/play/${projectId}`) }} title="Play this map in the browser: weapons to pick up, timed runs, works on phones">🎮 Play here</button>
      <button className="sm" onClick={onShare} title="A link anyone can open to play this map in their browser, no game or account needed">🔗 Share</button>
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
