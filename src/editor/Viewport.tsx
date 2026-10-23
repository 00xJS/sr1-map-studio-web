import { useEffect, useRef, useState } from 'react'
import { Viewer } from './Viewer'
import { breakMerge, setThumbnailProvider, useEditor } from './store'
import { addLight, addMarker, addPrefab, addShape, placeAsset, removeTarget } from './actions'
import { paintAt, pickAt } from './paint'
import { ToolOptions, ToolStrip, chooseTool } from './Tools'
import { toast, toastError } from '../ui'
import type { Vec3 } from '../lib/project'

let active: Viewer | null = null
/** The editor's viewer (for camera center, snapping and thumbnails). */
export const getViewer = () => active

const TAB_FOR = { item: 'scene', marker: 'spawns', light: 'lights' } as const

/** With Snap on, click-placed things land on the grid. */
function snapped(p: Vec3): Vec3 {
  const { snap, step } = useEditor.getState()
  if (!snap) return p
  const r = (v: number) => Math.round(v / step) * step
  return [r(p[0]), p[1], r(p[2])]
}

/** A tool click on a surface. Returns true if the active tool handled it. */
function useTool(point: Vec3, item: number, face: number): boolean {
  const st = useEditor.getState()
  switch (st.tool) {
    case 'shape':
      if (st.toolShape.startsWith('prefab:')) addPrefab(st.toolShape.slice(7), snapped(point), point[1]).catch(toastError)
      else addShape(st.toolShape, snapped(point), point[1]).catch(toastError)
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
  return (
    <div className="camera-pad" data-tour="camera">
      {PAD.map(([icon, label, fn]) => <button key={label} className="sm" title={label} aria-label={label} onClick={fn}>{icon}</button>)}
    </div>
  )
}

export function Viewport({ onEmptyImport, onSamples }: { onEmptyImport: (files: File[]) => void; onSamples: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const project = useEditor((s) => s.project)
  const placeMode = useEditor((s) => s.placeMode)
  const [dropping, setDropping] = useState(false)

  useEffect(() => {
    const el = host.current!
    const viewer = new Viewer(el, {
      onPick(sel, additive) {
        const st = useEditor.getState()
        if (additive && sel?.kind === 'item') { st.toggleItem(sel.index); return }
        st.select(sel)
        if (sel) st.set({ tab: TAB_FOR[sel.kind] })
      },
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
      onSurface(point, item, face, mode, data) {
        const st = useEditor.getState()
        if (mode === 'drop') {
          placeAsset(Number(data), point).catch(toastError)
          return
        }
        if (st.placeMode === 'marker') {
          addMarker(st.placeMarkerType, point)
          st.set({ placeMode: null, tab: 'spawns' })
        } else if (st.placeMode === 'light') {
          try { addLight([point[0], point[1] + 1.5, point[2]] as Vec3) } catch (e) { toastError(e) }
          st.set({ placeMode: null, tab: 'lights' })
        } else if (st.placeMode === 'face' && item >= 0 && face >= 0) {
          st.select({ kind: 'item', index: item })
          st.set({ faceRange: [face, face], tab: 'scene' })
          st.log(`Selected collision source face ${face} on ${st.project?.scene_items[item]?.name}.`)
        } else useTool(point, item, face)
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
        }, { merge: `gizmo-${kind}-${index}` })
        if (done) breakMerge() // drag finished: the next edit starts a new undo step
      },
    })
    active = viewer
    if (import.meta.env.DEV) (window as any).__viewer = viewer
    setThumbnailProvider(() => viewer.capture())
    const sync = () => {
      const s = useEditor.getState()
      const place = s.placeMode || (s.tool === 'select' ? '' : s.tool)
      el.dataset.place = place
      el.style.cursor = place ? (place === 'erase' ? 'not-allowed' : 'crosshair') : ''
      viewer.sync(s.project, {
        selection: s.selection, gizmo: s.gizmo, wireframe: s.wireframe, collisionView: s.collisionView, soloMaterial: s.soloMaterial,
        faceRange: s.faceRange, snap: s.snap, step: s.step, showGizmo: !place, multi: s.multi,
      })
    }
    sync()
    const unsub = useEditor.subscribe(sync)
    return () => { unsub(); setThumbnailProvider(null); active = null; viewer.dispose() }
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
        onEmptyImport([...e.dataTransfer.files])
      }}
    >
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      <ToolStrip />
      <ToolOptions />
      {placeMode && (
        <div className="viewport-banner">
          {placeMode === 'marker' ? 'Click the map to place a marker' : placeMode === 'light' ? 'Click the map to place a light' : 'Click a triangle to pick its collision face'}
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
            <p className="faint small">Or drop your own 3D model here (OBJ with its MTL and textures, GLB, glTF or FBX), or bring in a map from your game with <b>Assets → Import a map from the game</b>.</p>
          </div>
        </div>
      )}
      <CameraPad />
      <div className="viewport-hint">Left-drag: spin · Right-drag: slide · Scroll: zoom · Esc: back to Move</div>
    </div>
  )
}
