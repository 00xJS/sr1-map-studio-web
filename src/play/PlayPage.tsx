// Play a map in the browser: /play/:id (one of your maps, read-only),
// /play/s/:token (a play link), /play (a share file). Built on the editor's
// viewer and walk-through, with weapon pickups, drop-offs, timed runs, a
// minimap and touch controls. No game files are needed or read, except your
// own Saints Row character if you choose to load it from your game folder.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Viewer, type ViewOptions } from '../editor/Viewer'
import { MyCharacter } from '../editor/Viewport'
import { STAND_EYE, STAND_HEIGHT, type WalkState } from '../editor/walk'
import { textureUrl } from '../lib/assets'
import type { MinimapRect } from '../lib/minimap'
import { isDataPackPath, type Project } from '../lib/project'
import { FileButton } from '../ui'
import { RUN_LABELS, availableRuns, bestTime, elapsed, formatTime, progress, recordTime, weaponName, type GameEvent, type RunMode } from './game'
import { Minimap } from './Minimap'
import { openLocal, openShare } from './openShare'
import { PlaySession, spawnsOf } from './session'
import { itemPaths, type ShareDoc } from './share'
import { fetchShare, readShare } from './shareApi'
import { TouchControls, touchFirst } from './TouchControls'
import './play.css'

const OPTS: ViewOptions = { selection: null, gizmo: 'translate', wireframe: false, collisionView: 'off', soloMaterial: null, faceRange: [0, 0], readOnly: true, showGizmo: false }
const NO_EVENTS = { onPick() {}, onSurface() {}, onTransform() {}, onErase() {} }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Waits for `p`, but never longer than `ms` (a slow image or a background tab must not hold up the menu). */
const atMost = <T,>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p, sleep(ms).then(() => null)])
const store = (() => { try { return window.localStorage } catch { return null } })()

interface Source { project: Project; mapKey: string; shared: boolean; back: { to: string; label: string } }

export default function PlayPage() {
  const { id, token } = useParams()
  const [src, setSrc] = useState<Source | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Loading the map…')

  const fromDoc = useCallback(async (doc: ShareDoc, key: string) => {
    setStatus('Building the map…')
    const project = await openShare(doc, setStatus)
    setSrc({ project, mapKey: key, shared: true, back: { to: '/', label: 'SR1 Map Studio' } })
  }, [])

  useEffect(() => {
    setSrc(null); setError('')
    if (id) {
      openLocal(id).then((p) => p ? setSrc({ project: p, mapKey: 'local:' + id, shared: false, back: { to: `/editor/${id}`, label: 'Back to the editor' } }) : setError('This map isn’t saved in this browser.'), (e) => setError(String(e?.message || e)))
    } else if (token) {
      fetchShare(token).then((doc) => fromDoc(doc, 's:' + token)).catch((e) => setError(String(e?.message || e)))
    }
  }, [id, token, fromDoc])

  useEffect(() => { document.title = (src ? src.project.name + ' · ' : '') + 'Play · SR1 Map Studio'; return () => { document.title = 'SR1 Map Studio' } }, [src])

  if (src) return <PlayView key={src.project.id} {...src} />
  if (error) return <PlayMessage title="This map can’t be opened" text={error} />
  if (!id && !token) return <OpenShareFile onDoc={(doc) => fromDoc(doc, 'f:' + doc.title).catch((e) => setError(String(e?.message || e)))} />
  return <PlayMessage title={status} />
}

function PlayMessage({ title, text }: { title: string; text?: string }) {
  return (
    <div className="play-screen">
      <div className="card play-card">
        <h2>{title}</h2>
        {text && <p className="muted">{text}</p>}
        <Link to="/" className="btn">SR1 Map Studio</Link>
      </div>
    </div>
  )
}

/** /play with no link: open a .sr1play file someone sent you. */
function OpenShareFile({ onDoc }: { onDoc: (d: ShareDoc) => void }) {
  const [err, setErr] = useState('')
  const open = async (f?: File) => {
    if (!f) return
    try { onDoc(readShare(new Uint8Array(await f.arrayBuffer()))) } catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className="play-screen" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void open(e.dataTransfer.files[0]) }}>
      <div className="card play-card">
        <h2>Play a shared map</h2>
        <p className="muted">Open a <code>.sr1play</code> file someone sent you, or drop it here. It plays right in the browser: no game or account needed.</p>
        <FileButton className="primary" accept=".sr1play" onFiles={([f]) => void open(f)}>Open a share file…</FileButton>
        {err && <p className="bad small">{err}</p>}
        <Link to="/" className="small">SR1 Map Studio</Link>
      </div>
    </div>
  )
}

type Phase = 'loading' | 'menu' | 'playing' | 'paused'
interface Feed { id: number; text: string; tone: 'gold' | 'pink' | 'ok' }

function PlayView({ project, mapKey, shared, back }: Source) {
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const session = useRef<PlaySession | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [loadText, setLoadText] = useState('Loading models…')
  const [mini, setMini] = useState<{ image: HTMLImageElement | null; rect: MinimapRect } | null>(null)
  const [walk, setWalk] = useState<WalkState>({ locked: false, third: false, running: false, height: 0, crouched: false, eye: STAND_EYE, head: STAND_HEIGHT })
  const [feed, setFeed] = useState<Feed[]>([])
  const [finish, setFinish] = useState<{ time: number; record: boolean; best: number | null } | null>(null)
  const [, redraw] = useReducer((x: number) => x + 1, 0)
  const touch = useRef(touchFirst()).current
  const runs = availableRuns(project.markers)
  const feedId = useRef(0)
  const spawnCount = spawnsOf(project.markers).length

  useEffect(() => {
    const v = new Viewer(host.current!, NO_EVENTS)
    viewer.current = v
    if (import.meta.env.DEV) (window as any).__play = { viewer: v, session }
    v.sync(project, OPTS)
    let live = true
    let url = ''
    ;(async () => {
      await atMost(v.whenLoaded(), 30000)
      if (!live) return
      setLoadText('Loading textures…')
      const textures = [...new Set(project.scene_items.flatMap((it) => itemPaths(it).textures))].filter((p) => !isDataPackPath(p))
      await atMost(Promise.all(textures.map((p) => textureUrl(project, p))), 8000)
      await sleep(500) // the viewer decodes the images after their URLs are ready
      if (!live) return
      v.frameAll()
      const rect = v.minimapRect(8)
      let image: HTMLImageElement | null = null
      if (rect) {
        const blob = await atMost(v.captureTopDown({ size: 512, rect }).catch(() => null), 5000)
        if (blob) {
          url = URL.createObjectURL(blob)
          image = new Image()
          image.src = url
          await atMost(image.decode().catch(() => {}), 3000)
        }
      }
      if (!live) return
      setMini(rect ? { image, rect } : null)
      setPhase('menu')
    })()
    return () => {
      live = false
      session.current?.dispose()
      session.current = null
      v.dispose()
      viewer.current = null
      if (url) URL.revokeObjectURL(url)
    }
  }, [project])

  // The clock on screen.
  useEffect(() => {
    if (phase !== 'playing') return
    const t = setInterval(redraw, 100)
    return () => clearInterval(t)
  }, [phase])

  const say = (text: string, tone: Feed['tone']) => {
    const id = ++feedId.current
    setFeed((f) => [...f.slice(-3), { id, text, tone }])
    setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 2600)
  }

  const onEvents = (events: GameEvent[]) => {
    const s = session.current
    if (!s) return
    for (const e of events) {
      if (e.type === 'weapon') say(`Picked up ${e.pickup.label}${e.first ? '' : ' (more ammo)'}`, 'gold')
      else if (e.type === 'dropoff') say(e.left ? `Drop-off! ${e.left} to go` : 'Drop-off!', 'pink')
      else if (e.type === 'start') say('Go!', 'ok')
      else if (e.type === 'finish') {
        const best = bestTime(store, mapKey, s.run.mode)
        const record = recordTime(store, mapKey, s.run.mode, e.time)
        setFinish({ time: e.time, record, best })
        document.exitPointerLock?.()
      }
    }
    redraw()
  }

  const lock = () => { if (!touch) void viewer.current?.renderer.domElement.requestPointerLock?.()?.catch?.(() => {}) }

  const start = (mode: RunMode) => {
    const v = viewer.current
    if (!v) return
    setFinish(null)
    const spawn = Math.floor(Math.random() * Math.max(1, spawnCount))
    if (session.current) session.current.restart(mode, spawn)
    else {
      const s = new PlaySession(v, project, mode, () => setPhase('paused'), setWalk, spawn)
      s.onEvents = onEvents
      session.current = s
    }
    setPhase('playing')
    redraw()
    lock()
  }

  const resume = () => { setPhase('playing'); lock() }
  const s = session.current
  const playing = phase === 'playing' && s

  return (
    <div className="play-page">
      <div ref={host} className="play-canvas" />
      {phase === 'loading' && <div className="play-screen overlay"><div className="card play-card"><h2>{project.name}</h2><p className="muted">{loadText}</p></div></div>}

      {playing && <>
        <div className="walk-crosshair" />
        <PlayHud session={s} mapKey={mapKey} />
        <div className="play-feed">{feed.map((f) => <div key={f.id} className={'play-feed-item ' + f.tone}>{f.text}</div>)}</div>
        {mini && <div className="play-minimap-wrap"><Minimap session={s} image={mini.image} rect={mini.rect} size={touch ? 120 : 168} /></div>}
        {!touch && !walk.locked && !finish && (
          <div className="play-hint">
            <b>Click the map to play</b>
            <span className="small">WASD run · Shift sprint · Space jump · C crouch · V third person · R back to the spawn · Esc menu</span>
          </div>
        )}
        {touch && !finish && <TouchControls walker={() => viewer.current?.walk ?? null} onMenu={() => setPhase('paused')} />}
        {!touch && walk.locked && <button className="sm play-menu-btn" onClick={() => { document.exitPointerLock?.(); setPhase('paused') }}>Menu (Esc)</button>}
        {finish && s && (
          <div className="play-screen overlay">
            <div className="card play-card">
              <h2>{s.run.mode === 'weapons' ? 'Every weapon collected!' : 'Every drop-off touched!'}</h2>
              <div className="play-big-time">{formatTime(finish.time)}</div>
              <p className={finish.record ? 'ok' : 'muted'}>{finish.record ? (finish.best ? `New best! (was ${formatTime(finish.best)})` : 'Your first time on this map.') : `Your best: ${formatTime(finish.best!)}`}</p>
              <div className="row wrap">
                <button className="primary" onClick={() => start(s.run.mode)}>Run again</button>
                <button onClick={() => start('roam')}>Free roam</button>
                <button onClick={() => { setFinish(null); setPhase('paused') }}>Menu</button>
              </div>
            </div>
          </div>
        )}
      </>}

      {(phase === 'menu' || phase === 'paused') && (
        <div className="play-screen overlay">
          <div className="card play-card">
            <div className="row between">
              <h2 style={{ margin: 0 }}>{project.name}</h2>
              {shared && <span className="chip accent">shared map</span>}
            </div>
            {phase === 'paused' && s && <button className="primary" onClick={resume}>Resume{s.run.mode !== 'roam' ? ` (${RUN_LABELS[s.run.mode].toLowerCase()})` : ''}</button>}
            <div className="col">
              {runs.map((r) => {
                const best = r.mode === 'roam' ? null : bestTime(store, mapKey, r.mode)
                return (
                  <button key={r.mode} className={phase === 'menu' && r.mode === 'roam' ? 'primary play-run' : 'play-run'} onClick={() => start(r.mode)}>
                    <span>{r.label}{r.count ? ` (${r.count})` : ''}</span>
                    <span className="small">{r.mode === 'roam' ? 'Walk around, pick up weapons' : best ? `Best ${formatTime(best)}` : 'Timed'}</span>
                  </button>
                )
              })}
            </div>
            {runs.length === 1 && <p className="faint small">This map has no weapon pickups or Chains drop-offs, so there are no timed runs. Add some in the editor.</p>}
            {!touch && <MyCharacter viewer={() => viewer.current} />}
            <p className="faint small">{touch
              ? 'Left thumb moves (push all the way to run), drag on the right to look, buttons to sprint, jump and crouch.'
              : 'WASD to run, the mouse to look, Shift to sprint (for 3 s, then it refills), Space to jump, C to crouch, V for third person.'}{' '}
              Plays in your browser: no game needed.</p>
            <Link to={back.to} className="small">{back.label}</Link>
          </div>
        </div>
      )}
    </div>
  )
}

function PlayHud({ session: s, mapKey }: { session: PlaySession; mapKey: string }) {
  const run = s.run
  const { done, total } = progress(run)
  const best = run.mode === 'roam' ? null : bestTime(store, mapKey, run.mode)
  return (
    <div className="play-hud">
      <b>{RUN_LABELS[run.mode]}</b>
      {run.mode !== 'roam' && <>
        <div className="play-time">{formatTime(elapsed(run, performance.now()))}</div>
        <div className="small">{done} / {total} {run.mode === 'weapons' ? 'weapons' : 'drop-offs'}{best ? ` · best ${formatTime(best)}` : ''}{run.started === null ? ' · the clock starts when you move' : ''}</div>
      </>}
      {run.current && <div className="small">In hand: <b>{weaponName(run.current)}</b></div>}
      {run.inventory.length > 1 && <div className="play-inv">{run.inventory.map((w) => <span key={w} className={'chip' + (w === run.current ? ' accent' : '')}>{weaponName(w)}</span>)}</div>}
    </div>
  )
}
