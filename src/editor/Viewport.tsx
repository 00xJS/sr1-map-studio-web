import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { attachLook } from './look'
import { Viewer } from './Viewer'
import { breakMerge, setThumbnailProvider, thingKey, useEditor } from './store'
import { addLight, addMarker, addPrefab, addShape, placeAsset, removeTarget } from './actions'
import { paintAt, pickAt } from './paint'
import { ToolOptions, ToolStrip, chooseTool } from './Tools'
import { PrefabBrowser } from './PrefabBrowser'
import { toast, toastError } from '../ui'
import type { Vec3 } from '../lib/project'
import { placeMyPrefab } from './myPrefabs'
import { ALL_PREFABS } from '../lib/prefabRegistry'
import { placeGameObject } from './gameObjectActions'
import { STAND_EYE, STAND_HEIGHT, type WalkState } from './walk'
import { chooseGameFolder, currentPlayer, folderPickerSupported, loadFromRememberedFolder, loadPlayer, pickPackfiles, rememberedGameFolder } from '../lib/sr1char/folder'
import type { PlayerModel } from '../lib/sr1char/player'
import { placePendingDecal } from './PhotoDialog'
import { ghostFor } from './ghost'
import { PhysicsHud } from './PhysicsHud'
import { WeatherHud } from './WeatherHud'
import { attachHealthOverlay } from './health'
import { attachGroundTools } from './groundTools'
import { attachMeasure, measureClick } from './measure'
import { ViewsMenu } from './ViewsMenu'
import { dropHasMap } from '../lib/mapFolder/files'
import { openMapDrop } from '../lib/mapFolder/store'
import { coarsePointer, useNarrow } from '../lib/touch'
import { fmtM, toMetres } from '../lib/units'

let active: Viewer | null = null
/** The editor's viewer (for camera center, snapping and thumbnails). */
export const getViewer = () => active

/** Touch screen without a mouse (tablets, phones). */
const coarse = coarsePointer()

/** With Snap on, click-placed things land on the grid. */
function snapped(p: Vec3): Vec3 {
  const { snap, step } = useEditor.getState()
  if (!snap) return p
  const r = (v: number) => Math.round(v / step) * step
  return [r(p[0]), p[1], r(p[2])]
}

/**
 * Places a shape preset, prefab ("prefab:<key>"), saved piece ("mine:<id>") or object from the game ("game:<id>") on a surface point.
 * A sign or photo frame put on a wall (`normal` is the wall's outward direction) sticks to it.
 */
function placeShape(shape: string, point: Vec3, normal?: Vec3) {
  const rot = useEditor.getState().placeRot
  if (shape.startsWith('prefab:')) {
    const wall = normal && Math.abs(normal[1]) < 0.6 && ALL_PREFABS[shape.slice(7)]?.onWall ? normal : undefined
    addPrefab(shape.slice(7), wall ? point : snapped(point), point[1], { rot, wall }).catch(toastError)
  }
  else if (shape.startsWith('mine:')) { try { placeMyPrefab(shape.slice(5), snapped(point), rot) } catch (err) { toastError(err) } }
  else if (shape.startsWith('game:')) placeGameObject(shape.slice(5), snapped(point), point[1], rot).catch(toastError)
  else addShape(shape, snapped(point), point[1], { rot }).catch(toastError)
}

/** A tool click on a surface. Returns true if the active tool handled it. */
function applyTool(point: Vec3, item: number, face: number, normal?: Vec3): boolean {
  const st = useEditor.getState()
  switch (st.tool) {
    case 'shape':
      placeShape(st.toolShape, point, normal)
      return true
    case 'spawn':
      addMarker(st.toolSpawn, snapped(point))
      return true
    case 'weapon':
      addMarker('Weapon pickup', snapped(point), { weapon: st.toolWeapon })
      return true
    case 'light':
      try { addLight([point[0], point[1] + 1.5, point[2]]) } catch (e) { toastError(e) }
      return true
    case 'measure':
      measureClick(point)
      return true
    case 'paint':
      if (!st.swatch) { toast('Choose a texture first: click the box next to the tool options.'); return true }
      if (item >= 0) paintAt(item, face, st.swatch).catch(toastError)
      return true
    case 'pick':
      if (item >= 0) pickAt(item, face).then((s) => {
        if (!s) { toast('That surface has no texture yet.'); return }
        // Like Paint: the eyedropper hands its color to the bucket.
        useEditor.getState().set({ swatch: s })
        chooseTool('paint')
      }).catch(toastError)
      return true
    default:
      return false
  }
}

const PAD: [string, string, () => void][] = [
  ['⟲', 'Circle left', () => active?.orbitBy(-45)],
  ['⟳', 'Circle right', () => active?.orbitBy(45)],
  ['+', 'Zoom in', () => active?.zoomBy(0.7)],
  ['−', 'Zoom out', () => active?.zoomBy(1.4)],
  ['⤢', 'See the whole map', () => active?.frameAll()],
]

/** Camera buttons for people who don't use mouse-drag controls. */
function CameraPad() {
  const freeCam = useEditor((s) => s.freeCam)
  const plan = useEditor((s) => s.plan)
  return (
    <div className="camera-pad" data-tour="camera">
      <button className={'sm' + (plan ? ' on' : '')} title={plan ? 'Plan view on: the map from straight above. Click for the 3D view (O).' : 'Plan view: the map from straight above, flat (O)'} aria-label="Plan view" aria-pressed={plan}
        onClick={() => useEditor.getState().set({ plan: !plan })}>▦</button>
      {!plan && <button className={'sm' + (freeCam ? ' on' : '')} title={freeCam ? 'Free camera on: hold right mouse to look, WASD to fly. Click for the orbit camera.' : 'Free camera, like the desktop app'} aria-label="Free camera"
        onClick={() => useEditor.getState().set({ freeCam: !freeCam })}>🎥</button>}
      {PAD.filter(([, label]) => !plan || !label.startsWith('Circle')).map(([icon, label, fn]) => <button key={label} className="sm" title={label} aria-label={label} onClick={fn}>{icon}</button>)}
      <ViewsMenu />
    </div>
  )
}

const SPAWNS = ['Shared spawn', 'Red team spawn', 'Blue team spawn']

type CharState = { kind: 'idle' | 'loading' | 'on' | 'off' | 'error'; text?: string; folder?: string }

/** Third person with the user's own Saints Row player, read from their game folder in the browser (nothing is uploaded).
 *  `viewer`: the viewer to put the character in (default: the editor's). */
export function MyCharacter({ viewer }: { viewer?: () => Viewer | null } = {}) {
  const target = () => viewer?.() ?? active
  const [st, setSt] = useState<CharState>({ kind: 'idle' })
  const input = useRef<HTMLInputElement | null>(null)
  const run = async (p: Promise<PlayerModel | null>) => {
    setSt((s) => ({ kind: 'loading', folder: s.folder }))
    try {
      const m = await p
      if (!m) { setSt((s) => ({ kind: 'idle', folder: s.folder })); return }
      target()?.setWalkBody(m)
      setSt({ kind: 'on', text: m.summary })
    } catch (e) {
      setSt((s) => ({ kind: 'error', text: (e as Error).message, folder: s.folder }))
    }
  }
  useEffect(() => {
    let live = true
    const built = currentPlayer()
    if (built) { void run(built); return }
    // A folder chosen on an earlier walk opens again without asking while the browser still allows reading it.
    rememberedGameFolder().then((r) => {
      if (!live || !r) return
      if (r.ready) void run(loadFromRememberedFolder(false))
      else setSt({ kind: 'idle', folder: r.name })
    }).catch(() => {})
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const choose = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur()
    const built = currentPlayer()
    if (built) { void run(built); return }
    if (!folderPickerSupported()) { input.current?.click(); return }
    void run(st.folder ? loadFromRememberedFolder(true).then((m) => m ?? chooseGameFolder()) : chooseGameFolder())
  }
  const standIn = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur()
    target()?.setWalkBody(null)
    setSt({ kind: 'off' })
  }
  const picked = (files: FileList | null) => {
    if (!files?.length) return
    const list = [...files], folder = list[0].webkitRelativePath.split('/')[0] || 'the folder'
    void run(loadPlayer(pickPackfiles(list), folder))
    if (input.current) input.current.value = ''
  }
  return (
    <div className="row">
      {st.kind === 'on'
        ? <button className="sm" onClick={standIn} title="Show the plain stand-in in third person">Use the stand-in</button>
        : <button className="sm" disabled={st.kind === 'loading'} onClick={choose}
            title="Pick your Saints Reborn folder: the player is read from your own game files in this browser. Nothing is uploaded.">
            {st.kind === 'loading' ? 'Loading your character…' : 'Use my Saints Row character'}
          </button>}
      <span className="small" style={{ opacity: 0.8 }}>
        {st.kind === 'on' ? 'Your character is in. Press V for third person.'
          : st.kind === 'error' ? st.text
          : st.kind === 'idle' && st.folder ? `From ${st.folder} (asks once)`
          : st.kind === 'idle' ? 'See the game’s player in third person (V), read from your game folder' : ''}
      </span>
      <input ref={(el) => { input.current = el; el?.setAttribute('webkitdirectory', '') }} type="file" multiple hidden onChange={(e) => picked(e.target.files)} />
    </div>
  )
}

/** Walk-through overlay: starts the walk at a spawn, shows the controls, hops between spawns. */
function WalkHud() {
  const [state, setState] = useState<WalkState>({ locked: false, third: false, running: false, height: 0, crouched: false, eye: STAND_EYE, head: STAND_HEIGHT })
  const [at, setAt] = useState(0)
  const [markers, setMarkers] = useState(false)
  const spawns = useEditor((s) => s.project?.markers.filter((m) => SPAWNS.includes(m.type)) ?? [])
  const stop = () => useEditor.getState().set({ walking: false })
  useEffect(() => {
    const v = active
    if (!v) return
    const first = spawns[0]
    const start: Vec3 = first ? first.position : [v.center()[0], v.surfaceBelow(v.center()[0], 1e4, v.center()[2]) ?? 1, v.center()[2]]
    v.startWalk(start, first?.yaw ?? 0, stop, setState)
    return () => v.stopWalk()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const go = (step: number) => {
    if (!spawns.length) return
    const i = (at + step + spawns.length) % spawns.length
    setAt(i)
    active?.walkTo(spawns[i].position, spawns[i].yaw ?? 0)
  }
  return (
    <>
      <div className="walk-crosshair" />
      <div className="walk-hud">
        <b>Walking the map <span className="small" style={{ fontWeight: 'normal', opacity: 0.8 }}>· {state.crouched ? 'Crouching' : 'Standing'}{state.tired ? ' · out of sprint' : ''} · head {(state.head / 2).toFixed(2)} m · eyes {(state.eye / 2).toFixed(2)} m</span></b>
        <span className="small">{state.locked ? 'WASD run · Shift sprint (3 s, then it refills) · Space jump · C crouch · V third person · R back to start · Esc frees the mouse' : 'Click the map to look around with the mouse'}</span>
        <PhysicsHud viewer={active} />
        <WeatherHud viewer={active} />
        <div className="row">
          {spawns.length > 0 && <>
            <button className="sm" onClick={() => go(-1)}>◀</button>
            <span className="small">{spawns[at]?.type ?? 'Spawn'} {at + 1} of {spawns.length}</span>
            <button className="sm" onClick={() => go(1)}>▶</button>
          </>}
          <span className="spacer" />
          <label className="row small" title="Show spawn, weapon and other markers while walking"><input type="checkbox" checked={markers} onChange={(e) => { setMarkers(e.target.checked); active?.showWalkMarkers(e.target.checked) }} /> Markers</label>
          <button className="sm primary" onClick={stop}>Stop walking (Esc)</button>
        </div>
        <MyCharacter />
      </div>
    </>
  )
}

export function Viewport({ onEmptyImport, onSamples }: { onEmptyImport: (files: File[]) => void; onSamples: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const project = useEditor((s) => s.project)
  const placeMode = useEditor((s) => s.placeMode)
  const walking = useEditor((s) => s.walking)
  const freeCam = useEditor((s) => s.freeCam)
  const plan = useEditor((s) => s.plan)
  const mirror = useEditor((s) => s.mirror)
  const narrow = useNarrow()
  const [dropping, setDropping] = useState(false)

  useEffect(() => {
    const el = host.current!
    const viewer = new Viewer(el, {
      onPick(sel, additive) {
        const st = useEditor.getState()
        if (additive && sel?.kind === 'item') { st.toggleItem(sel.index); return }
        // The inspector shows on top of whichever tab is open.
        st.select(sel)
      },
      onFlySpeed(speed) { toast(`Free camera speed: ${fmtM(toMetres(speed, useEditor.getState().project?.settings.world_scale))} a second`, 'info', 1200) },
      onTransformMany(updates, done) {
        useEditor.getState().update('Move objects', (d) => {
          for (const u of updates) {
            const it = d.scene_items[u.index]
            if (!it) continue
            it.position = u.position; it.rotation = u.rotation; it.scale = u.scale
          }
        }, { merge: 'gizmo-many' })
        if (done) breakMerge()
      },
      onErase(target) {
        removeTarget(target)
        useEditor.getState().select(null)
      },
      onSurface(point, item, face, mode, data, normal) {
        const st = useEditor.getState()
        if (st.placeMode === 'decal' && mode === 'click') { placePendingDecal(point, normal).catch(toastError); return }
        if (mode === 'drop') {
          // From the prefab browser: "prefab:<key>", "mine:<id>" or "game:<id>"; otherwise an asset library index.
          if (data && /^(prefab|mine|game):/.test(data)) placeShape(data, point, normal)
          else placeAsset(Number(data), point).catch(toastError)
          return
        }
        if (st.placeMode === 'marker') {
          addMarker(st.placeMarkerType, point)
          st.set({ placeMode: null })
        } else if (st.placeMode === 'light') {
          try { addLight([point[0], point[1] + 1.5, point[2]] as Vec3) } catch (e) { toastError(e) }
          st.set({ placeMode: null })
        } else if (st.placeMode === 'face' && item >= 0 && face >= 0) {
          st.select({ kind: 'item', index: item })
          st.set({ faceRange: [face, face] })
          st.log(`Selected collision source face ${face} on ${st.project?.scene_items[item]?.name}.`)
        } else applyTool(point, item, face, normal)
      },
      onTransform(kind, index, t, done) {
        const st = useEditor.getState()
        st.update('Move ' + kind, (d) => {
          if (kind === 'item') {
            const it = d.scene_items[index]
            if (!it) return
            it.position = t.position
            if (t.rotation) it.rotation = t.rotation.map((v) => +v.toFixed(4)) as Vec3
            if (t.scale !== undefined) it.scale = +t.scale.toFixed(5)
          } else if (kind === 'marker') {
            const m = d.markers[index]
            if (!m) return
            m.position = t.position
            if (t.yaw !== undefined) m.yaw = +t.yaw.toFixed(2)
          } else {
            const l = d.lights[index]
            if (l) l.position = t.position
          }
        }, { merge: `gizmo-${thingKey(kind, index)}` })
        if (done) breakMerge() // drag finished: the next edit starts a new undo step
      },
    })
    active = viewer
    const ground = attachGroundTools(viewer)
    const offMeasure = attachMeasure(viewer)
    if (import.meta.env.DEV) (window as any).__viewer = viewer
    setThumbnailProvider(() => viewer.capture(), () => viewer.drawsGameData())
    const sync = () => {
      const s = useEditor.getState()
      const place = s.placeMode || (s.tool === 'select' ? '' : s.tool)
      el.dataset.place = place
      el.style.cursor = place ? (place === 'erase' ? 'not-allowed' : 'crosshair') : ''
      viewer.sync(s.project, {
        selection: s.selection, gizmo: s.gizmo, wireframe: s.wireframe, collisionView: s.collisionView, soloMaterial: s.soloMaterial,
        faceRange: s.faceRange, snap: s.snap, step: s.step, showGizmo: !place, multi: s.multi, freeCam: s.freeCam, plan: s.plan, layeredLook: s.layeredLook,
      })
    }
    sync()
    const unsub = useEditor.subscribe(sync)
    // The ghost: rebuilt when the Shape tool's choice changes, turned with R.
    let ghostKey = ''
    const syncGhost = () => {
      const s = useEditor.getState()
      const key = s.tool === 'shape' && !s.placeMode ? s.toolShape : ''
      viewer.setGhostRot(s.placeRot)
      if (key === ghostKey) return
      ghostKey = key
      if (!key) { viewer.setGhost(null); return }
      void ghostFor(key).then((g) => { if (ghostKey === key) viewer.setGhost(g) })
    }
    syncGhost()
    const unsubGhost = useEditor.subscribe(syncGhost)
    const offHealth = attachHealthOverlay(viewer)
    const offLook = attachLook(viewer)
    return () => { unsub(); unsubGhost(); offHealth(); offLook(); ground(); offMeasure(); setThumbnailProvider(null); active = null; viewer.dispose() }
  }, [])

  const empty = !project?.scene_items.length
  return (
    <div
      className={'viewport' + (dropping ? ' dropzone-active' : '')}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true) } }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false)
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        // A map folder or zip from the game opens as a map of its own.
        if (dropHasMap(e.dataTransfer)) { openMapDrop(e.dataTransfer).catch(toastError); return }
        onEmptyImport([...e.dataTransfer.files])
      }}
    >
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      {walking ? <WalkHud /> : <>
      {!narrow && <ToolStrip />}
      <ToolOptions />
      <PrefabBrowser />
      {placeMode && (
        <div className="viewport-banner">
          {placeMode === 'marker' ? 'Click the map to place a marker' : placeMode === 'light' ? 'Click the map to place a light' : placeMode === 'decal' ? 'Click a wall to stick your tag on it (as many as you like)' : 'Click a triangle to pick its collision face'}
          <button className="sm" onClick={() => useEditor.getState().set({ placeMode: null })}>Done (Esc)</button>
        </div>
      )}
      {empty && (
        <div className="empty-viewport">
          <div className="card">
            <h2>Start a map</h2>
            <div className="col" style={{ width: '100%' }}>
              <button className="primary" onClick={onSamples}>Start from a sample map…</button>
              <button onClick={() => { chooseTool('shape'); useEditor.getState().set({ toolShape: 'floor' }) }}>Draw from scratch: place a floor</button>
            </div>
            <p className="faint small">Or drop your own 3D model here (OBJ with its MTL and textures, GLB, glTF or FBX), or bring in a map from your game: Build tab → <b>Library, imports and every texture</b>.</p>
          </div>
        </div>
      )}
      <CameraPad />
      {mirror && <button className="sm mirror-badge" onClick={() => useEditor.getState().set({ mirror: false })}
        title="Edits are copied to the other half. Click to turn mirror mode off (Shift+M).">⇄ Mirror mode</button>}
      <div className="viewport-hint">{plan
        ? (coarse ? 'Plan view · One finger: slide · Pinch: zoom · Tap: select' : 'Plan view · Drag: slide · Scroll: zoom · WASD slide · O: back to 3D')
        : freeCam
        ? 'Free camera: hold right mouse to look · WASD fly · Q/E down/up · Shift faster · Wheel: speed'
        : coarse ? 'One finger: spin · Pinch: zoom · Two fingers: slide · Tap: select'
        : 'Left-drag: spin · Right-drag: slide · Scroll: zoom · WASD fly · Esc: back to Move · ?: all shortcuts'}</div>
      </>}
    </div>
  )
}
