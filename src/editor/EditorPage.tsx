import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEditor, saveNow, readFlag, writeFlag, type SideTab } from './store'
import { Viewport, getViewer } from './Viewport'
import { choosePreset, setLook, useLook } from './look'
import { PRESETS } from '../lib/gameLight'
import { SelectionInspector } from './Inspector'
import { PlayDialog } from './PlayDialog'
import { Tour } from './Tour'
import { HistoryPanel } from './HistoryPanel'
import { FirstMapCoach } from './FirstMapCoach'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { VersionsDialog } from './VersionsDialog'
import { CommandPalette, type PaletteActions } from './CommandPalette'
import { toggleOverlay, useOverlays } from './overlays'
import { useCloudItem } from './cloudItem'
import { TOOL_ENTRIES, ToolStrip } from './Tools'
import { BuildTab } from './tabs/BuildTab'
import { CheckTab, useIssues } from './tabs/CheckTab'
import { GameTab } from './tabs/GameTab'
import { ShipTab } from './tabs/ShipTab'
import { autoVersion } from '../lib/versions'
import { handleKey } from './shortcuts'
import * as act from './actions'
import { db } from '../lib/db'
import { normalizeProject, type Project } from '../lib/project'
import { py } from '../lib/py'
import { accountsEnabled, hubEnabled } from '../lib/backend'
import { modalOpen, toast, toastError } from '../ui'
import { useNarrow } from '../lib/touch'
import { openMapFiles } from '../lib/mapFolder/store'
import { onQueued, queueEdits, takeEdits, type PendingEdits } from '../lib/pendingEdits'
import { runAiActions } from './aiActions'
import { runMapChecks } from './mapChecks'
import { useChat } from './aiSession'

const CloudSync = lazy(() => import('./CloudButton').then((m) => ({ default: m.CloudSync })))
const AiChat = lazy(() => import('./AiChat').then((m) => ({ default: m.AiChat })))
const SamplePicker = lazy(() => import('../pages/SamplePicker').then((m) => ({ default: m.SamplePicker })))
const PublishDialog = lazy(() => import('./PublishDialog').then((m) => ({ default: m.PublishDialog })))
const ShareDialog = lazy(() => import('../play/ShareDialog').then((m) => ({ default: m.ShareDialog })))

const TABS: [SideTab, string, string][] = [
  ['build', 'Build', 'Add things, layers and everything in the map'],
  ['check', 'Check', 'Map health and everything worth fixing'],
  ['game', 'Game', 'Game modes, weather, sound, sky and the other settings for the game'],
  ['ship', 'Ship', 'Ready to play? Install it, share it, save a version'],
]

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
      void autoVersion(opened, rec.thumbnail).catch((err) => useEditor.getState().log('Saved version on open failed: ' + String(err)))
      document.title = rec.name + ' · SR1 Map Studio'
    })
    // Warm up the exporter; if it can't start, say so now rather than at export time.
    void py.init().catch((err) => {
      useEditor.getState().log('The exporter could not start: ' + String(err))
      toast("The exporter couldn't start, so maps can't be built for the game until you reload the page. Details are in the build log.", 'bad', 9000)
    })
    const offLog = py.onLog((t) => useEditor.getState().log(t))
    return () => {
      live = false
      offLog()
      if (useEditor.getState().saveState === 'unsaved') void saveNow()
      useEditor.getState().close()
      useOverlays.setState({ versions: false, keys: false, palette: false })
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
      const st = useEditor.getState()
      if (st.walking || modalOpen()) return
      handleKey(e, st)
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
  const allSettings = useEditor((s) => s.allSettings)
  const hasSelection = useEditor((s) => !!s.selection || s.multi.length > 1)
  const narrow = useNarrow()
  const navigate = useNavigate()
  const [publishing, setPublishing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [picking, setPicking] = useState(false)
  const [chatting, setChatting] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [touring, setTouring] = useState(false)
  const [sheet, setSheet] = useState<'none' | 'tools' | 'side'>('none')
  usePendingEdits(() => setChatting(true))
  const overlays = useOverlays()
  const hasItems = project.scene_items.length > 0
  // First visit: show the tour once there's something to look at (not on phones, where the panels are sheets).
  useEffect(() => { if (hasItems && !narrow && !readFlag('sr1-tour-done')) setTouring(true) }, [hasItems, narrow])
  // Phones: picking something opens the panel sheet to show it; a piece just placed stays in view with its arrows.
  const tool = useEditor((s) => s.tool)
  useEffect(() => { if (narrow && hasSelection && tool === 'select') setSheet('side') }, [narrow, hasSelection])
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
  const actions: PaletteActions = {
    walk: () => { setSheet('none'); useEditor.getState().set({ walking: !useEditor.getState().walking, selection: null, multi: [] }) },
    playHere: async () => { await saveNow(); navigate(`/play/${project.id}`) },
    install: () => setPlaying(true),
    share: () => setSharing(true),
    ai: () => setChatting((v) => !v),
    publish: hubEnabled ? async () => { await saveNow(true); setPublishing(true) } : undefined,
    tour: () => setTouring(true),
  }
  const samples = () => setPicking(true)
  return (
    <div className={'editor' + (narrow ? ' phone' : '')}>
      {narrow && <PhoneBanner onPlay={actions.playHere} />}
      <TopBar actions={actions} compact={narrow} />
      <div className="editor-main">
        <Viewport onEmptyImport={importDropped} onSamples={samples} />
        <aside className={'side' + (narrow ? ' sheet' + (sheet === 'side' ? ' open' : '') : '')} aria-label="Side panel">
          {narrow && <SheetHead title="Panel" onClose={() => setSheet('none')} />}
          <Sidebar onSamples={samples} onInstall={actions.install} onShare={actions.share} onPublish={() => actions.publish?.()} />
        </aside>
      </div>
      {narrow && <PhoneDock sheet={sheet} setSheet={setSheet} />}
      {narrow && sheet === 'tools' && (
        <div className="sheet tools-sheet open" onClick={(e) => { if ((e.target as HTMLElement).closest('.tool')) setSheet('none') }}>
          <SheetHead title="Tools" onClose={() => setSheet('none')} />
          <ToolStrip />
        </div>
      )}
      {allSettings && !narrow && <LogBar />}
      {accountsEnabled && <Suspense fallback={null}><CloudSync projectId={project.id} /></Suspense>}
      {picking && <Suspense fallback={null}><SamplePicker onClose={() => setPicking(false)} onBuilt={useSample} /></Suspense>}
      {chatting && <Suspense fallback={null}><AiChat onClose={() => setChatting(false)} /></Suspense>}
      {playing && <PlayDialog onClose={() => setPlaying(false)} onSamples={() => { setPlaying(false); setPicking(true) }} />}
      {publishing && <Suspense fallback={null}><PublishDialog projectId={project.id} onClose={() => setPublishing(false)} /></Suspense>}
      {sharing && <Suspense fallback={null}><ShareDialog projectId={project.id} onClose={() => setSharing(false)} /></Suspense>}
      {touring && !picking && !playing && <Tour onDone={endTour} />}
      {overlays.history && <HistoryPanel />}
      {overlays.versions && <VersionsDialog />}
      {overlays.keys && <ShortcutsOverlay />}
      {overlays.palette && <CommandPalette actions={actions} />}
      <FirstMapCoach />
      <BusyLock />
    </div>
  )
}

/** While Fix all (a transaction) edits the map, the whole editor waits: nothing else can change it meanwhile. */
function BusyLock() {
  const locked = useEditor((s) => s.locked)
  if (!locked) return null
  return (
    <div className="busy-lock" role="status" aria-live="polite">
      <div className="busy-lock-card"><b>{locked}…</b><span className="small muted">The editor waits until it's done.</span></div>
    </div>
  )
}

/** The side panel: the selection on top, then the four tabs. */
function Sidebar({ onSamples, onInstall, onShare, onPublish }: { onSamples: () => void; onInstall: () => void; onShare: () => void; onPublish: () => void }) {
  const tab = useEditor((s) => s.tab)
  const { issues } = useIssues(onSamples)
  const urgent = issues.filter((x) => x.rank <= 1).length
  const set = (k: SideTab) => useEditor.getState().set({ tab: k })
  return (
    <>
      <SelectionInspector />
      <div className="tabs" role="tablist" aria-label="Side panel tabs">
        {TABS.map(([k, label, title]) => (
          <button key={k} role="tab" id={'tab-' + k} aria-selected={tab === k} aria-controls="side-panel" className={tab === k ? 'active' : ''} title={title} onClick={() => set(k)}>
            {label}{k === 'check' && urgent > 0 && <span className="tab-badge" aria-label={`${urgent} to fix`}>{urgent}</span>}
          </button>
        ))}
      </div>
      <div className="panel" id="side-panel" role="tabpanel" aria-labelledby={'tab-' + tab} data-tour="panel">
        {tab === 'build' && <BuildTab />}
        {tab === 'check' && <CheckTab onSamples={onSamples} />}
        {tab === 'game' && <GameTab />}
        {tab === 'ship' && <ShipTab onInstall={onInstall} onShare={onShare} onPublish={onPublish} onSamples={onSamples} />}
      </div>
    </>
  )
}

type MenuItem = { label: ReactNode; on?: boolean; run: () => void; title?: string; disabled?: boolean } | null

/** A small drop-down menu; null items are separators. */
function Menu({ label, items, title, right, plain, name }: { label: ReactNode; items: MenuItem[]; title?: string; right?: boolean; plain?: boolean; name?: string }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div className="menu-wrap" onPointerDown={(e) => e.stopPropagation()}>
      <button className={'sm' + (open ? ' on' : '')} onClick={() => setOpen(!open)} title={title} aria-label={name} aria-haspopup="menu" aria-expanded={open}>{label}{!plain && ' ▾'}</button>
      {open && (
        <div className={'menu' + (right ? ' right' : '')} role="menu">
          {items.map((it, i) => it ? (
            <button key={i} role={it.on === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={it.on} title={it.title} disabled={it.disabled} className="menu-item" onClick={() => { it.run(); setOpen(false) }}>
              <span className="check">{it.on ? '✓' : ''}</span>{it.label}
            </button>
          ) : <hr key={i} />)}
        </div>
      )}
    </div>
  )
}

function TopBar({ actions, compact }: { actions: PaletteActions; compact: boolean }) {
  const name = useEditor((s) => s.project!.name)
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
  const walking = useEditor((s) => s.walking)
  const doubleSided = useEditor((s) => s.project!.settings.double_sided)
  const allSettings = useEditor((s) => s.allSettings)
  const update = useEditor((s) => s.update)
  const historyOpen = useOverlays((s) => s.history)
  const cloud = useCloudItem((s) => s.item)
  const look = useLook()
  const openMap = useRef<HTMLInputElement>(null)
  const st = useEditor.getState
  const history: MenuItem[] = [
    { label: 'Undo history', on: historyOpen, run: () => toggleOverlay('history'), title: 'Every step since you opened the map; click one to go back to it' },
    { label: 'Saved versions… (Ctrl+Shift+S)', run: () => toggleOverlay('versions', true), title: 'Keep a copy of the map and restore it later' },
  ]
  const view: MenuItem[] = [
    { label: 'Wireframe', on: wireframe, run: () => st().set({ wireframe: !wireframe }), title: 'Show the triangles' },
    { label: 'Show collision', on: collision === 'faces', run: () => st().set({ collisionView: collision === 'faces' ? 'off' : 'faces' }), title: 'Green = solid, red = players pass through' },
    { label: 'Layered surfaces (preview)', on: layered, run: () => st().set({ layeredLook: !layered }), title: 'Draws your shapes and prefabs the way the game\'s own surfaces avoid repeating: an even base tile with soft grime every 10-15 m and a gentle colour change every 100 m. Only in this view: your textures and the exported map stay as they are.' },
    { label: 'Show both sides of walls', on: doubleSided, run: () => update('Show both sides', (d) => { d.settings.double_sided = !doubleSided }), title: 'In the game, surfaces normally show from the front only. On also shows their backs.' },
    null,
    { label: 'Free camera (like the desktop app)', on: freeCam, run: () => st().set({ freeCam: !freeCam }), title: 'Hold the right mouse button to look around, WASD to fly, Q/E down and up, Shift faster, mouse wheel sets the speed' },
    { label: 'Zoom to selection (F)', run: () => getViewer()?.focusSelection() },
    { label: 'See the whole map', run: () => getViewer()?.frameAll() },
    { label: 'Show guide grid', on: getViewer()?.gridShown ?? true, run: () => { const v = getViewer(); v?.showGrid(!v.gridShown) }, title: 'The guide lines under the map: only a guide, not part of the map' },
  ]
  const lighting: MenuItem[] = [
    { label: 'Game lighting (as in the game)', on: look.mode === 'game', run: () => setLook({ mode: 'game' }), title: "The game's sun, fill light, shadows and fog" },
    { label: 'Bright editor lighting', on: look.mode === 'editor', run: () => setLook({ mode: 'editor' }), title: 'Even, bright light for building: not how the game looks' },
    null,
    ...PRESETS.map((p) => ({ label: p.label, on: look.mode === 'game' && look.preset === p.key, run: () => { void choosePreset(p.key) }, title: p.key === 'noon' ? 'How every map with always-clear weather looks in the game' : 'Read from your own game files' })),
    null,
    { label: 'Shadows', on: look.shadows, run: () => setLook({ shadows: !look.shadows }), title: 'The sun casts shadows, as in the game' },
    { label: 'Fog while editing', on: look.fogWhileEditing, run: () => setLook({ fogWhileEditing: !look.fogWhileEditing }), title: "The game's fog in the editor too (always on when you walk or play)" },
    { label: 'SRMaxDetail look', on: look.maxDetail, run: () => setLook({ maxDetail: !look.maxDetail }), title: 'How the game looks with the SRMaxDetail mod installed (darker shade, brighter sun)' },
  ]
  const more: MenuItem[] = [
    ...(compact ? [
      { label: '🎮 Play in browser', run: actions.playHere },
      { label: '▶ Install in game', run: actions.install },
      null,
    ] : []),
    { label: '🔗 Share…', run: actions.share, title: 'A link anyone can open to play this map in their browser, no game or account needed' },
    { label: '✨ Ask AI', run: actions.ai, title: 'Describe a change in your own words' },
    ...(cloud ? [{ label: <><span className={'status-dot' + (cloud.tone ? ' ' + cloud.tone : '')} />{cloud.label.replace(/^☁ /, '')}</>, run: cloud.run, title: cloud.title, disabled: cloud.busy }] : []),
    ...(actions.publish ? [{ label: 'Publish to the hub…', run: actions.publish }] : []),
    null,
    { label: 'Open map…', run: () => openMap.current?.click(), title: 'Open another finished map folder (from SaintsReborn/dist/maps) to edit it or add the game\'s sky; this map stays as it is. You can also drop a map folder or zip on the 3D view.' },
    { label: 'Find anything… (Ctrl+K)', run: () => toggleOverlay('palette', true), title: 'Search tools, prefabs, settings and actions' },
    null,
    ...(compact ? [
      { label: 'Snap (G)', on: snap, run: () => st().set({ snap: !snap }) },
      ...history,
      null,
    ] : []),
    { label: 'Take the tour', run: actions.tour },
    { label: 'Keyboard, mouse and touch (?)', run: () => toggleOverlay('keys', true) },
    null,
    { label: 'Show all settings', on: allSettings, run: () => st().set({ allSettings: !allSettings }), title: 'Opens every "More settings" in the side panel and shows the build log' },
  ]
  return (
    <div className="editor-bar">
      <div className="bar-group">
        <Link to="/" className="btn quiet icon" title="My maps" aria-label="Back to my maps">←</Link>
        <input className="name" value={name} onChange={(e) => update('Rename map', (d) => { d.name = e.target.value }, { merge: 'project-name' })} aria-label="Map name" />
        {!compact && <span className="save-state" aria-live="polite">{({ saved: 'Saved', saving: 'Saving…', unsaved: 'Edited', error: 'Save failed' } as const)[saveState]}</span>}
        {remix && !compact && <span className="chip" title={`Remix of ${remix.title} by ${remix.author}`}>remix</span>}
        <div className="btn-group">
          <button className="sm" disabled={!canUndo} onClick={() => st().undo()} title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)'} aria-label="Undo">↶{compact ? '' : ' Undo'}</button>
          <button className="sm" disabled={!canRedo} onClick={() => st().redo()} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</button>
        </div>
        {!compact && <Menu label="History" title="Undo history and saved versions" items={history} />}
      </div>
      {!compact && (
        <div className="bar-group">
          <button className={'sm' + (snap ? ' on' : '')} aria-pressed={snap} onClick={() => st().set({ snap: !snap })} title="Line things up on a grid and turn in 15° steps (G)">Snap</button>
          <Menu label="View" items={view} />
          <Menu label={look.mode === 'game' ? '☀ Lighting' : 'Lighting'} title="Light the view as the game does, at the time of day and weather you pick" items={lighting} />
        </div>
      )}
      <span className="spacer" />
      <div className="bar-group">
        {compact
          ? <button className={'sm' + (walking ? ' on' : '')} onClick={actions.walk} title="Walk the map at player height" aria-label="Walk">🚶</button>
          : (
            <div className="try-it" role="group" aria-label="Try it">
              <span className="try-label">Try it</span>
              <button className={'sm' + (walking ? ' on' : '')} onClick={actions.walk} title="Walk the map at player height, like in the game">🚶 Walk</button>
              <button className="sm" onClick={actions.playHere} title="Play this map in the browser: weapons to pick up, timed runs, works on phones">🎮 Play in browser</button>
            </div>
          )}
        {!compact && <button className="primary" data-tour="play" onClick={actions.install} title="Build the map and put it in your game">▶ Install in game</button>}
        <Menu label="⋯" name="More" plain right title="More: share, Ask AI, sync, publish, help, Show all settings" items={more} />
      </div>
      <input ref={openMap} type="file" hidden {...({ webkitdirectory: '', directory: '' } as object)}
        onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) openMapFiles(f).catch(toastError) }} />
    </div>
  )
}

function SheetHead({ title, onClose }: { title: string; onClose: () => void }) {
  return <div className="sheet-head"><b className="grow">{title}</b><button className="sm quiet icon" onClick={onClose} aria-label={'Close ' + title.toLowerCase()}>✕</button></div>
}

/** Phones: the bar along the bottom that opens the tools and the panel as sheets. */
function PhoneDock({ sheet, setSheet }: { sheet: 'none' | 'tools' | 'side'; setSheet: (s: 'none' | 'tools' | 'side') => void }) {
  const tool = useEditor((s) => s.tool)
  const gizmo = useEditor((s) => s.gizmo)
  const current = TOOL_ENTRIES.find((e) => (e.tool === 'select' ? tool === 'select' && e.gizmo === gizmo : tool === e.tool))
  return (
    <div className="phone-dock">
      <button className={sheet === 'tools' ? 'on' : ''} onClick={() => setSheet(sheet === 'tools' ? 'none' : 'tools')} aria-expanded={sheet === 'tools'}>🧰 Tools{current ? `: ${current.short}` : ''}</button>
      <button className={sheet === 'side' ? 'on' : ''} onClick={() => setSheet(sheet === 'side' ? 'none' : 'side')} aria-expanded={sheet === 'side'}>☰ Panel</button>
    </div>
  )
}

function PhoneBanner({ onPlay }: { onPlay: () => void }) {
  const [shown, setShown] = useState(() => { try { return sessionStorage.getItem('sr1-phone-banner') !== '0' } catch { return true } })
  if (!shown) return null
  const hide = () => { try { sessionStorage.setItem('sr1-phone-banner', '0') } catch { /* private window */ } setShown(false) }
  return (
    <div className="phone-banner" role="note">
      <span className="grow">Best on a computer · <button className="link" onClick={onPlay}>Play this map</button></span>
      <button className="sm quiet icon" onClick={hide} aria-label="Hide this note">✕</button>
    </div>
  )
}

function LogBar() {
  const logs = useEditor((s) => s.logs)
  const [open, setOpen] = useState(false)
  const [pyStatus, setPyStatus] = useState(py.status)
  const pre = useRef<HTMLPreElement>(null)
  useEffect(() => { if (pre.current) pre.current.scrollTop = pre.current.scrollHeight }, [logs, open])
  useEffect(() => py.onStatus(setPyStatus), [])
  useEffect(() => { if (logs.length && /fail|error/i.test(logs[logs.length - 1])) setOpen(true) }, [logs])
  const busy = pyStatus !== 'ready' && pyStatus !== 'idle' && !pyStatus.startsWith('error')
  return (
    <div className="logbar">
      {busy && <div className="progress"><div /></div>}
      <header>
        <span className="section-title">Build log</span>
        <span className="grow faint ellipsis">{logs[logs.length - 1] || 'Ready'}</span>
        <span className="row small faint" title="Map builder (Python) status">
          <span className={'status-dot ' + (pyStatus === 'ready' ? 'ok' : pyStatus.startsWith('error') ? 'bad' : 'warn')} />
          {pyStatus === 'ready' ? 'Builder ready' : pyStatus === 'idle' ? 'Builder idle' : pyStatus}
        </span>
        <button className="sm quiet" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</button>
      </header>
      {open && <pre ref={pre}>{logs.join('\n') || 'Nothing logged yet.'}</pre>}
    </div>
  )
}
