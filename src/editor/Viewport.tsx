import { useEffect, useRef, useState } from 'react'
import { Viewer } from './Viewer'
import { breakMerge, setThumbnailProvider, useEditor } from './store'
import { addLight, addMarker, placeAsset } from './actions'
import { toastError } from '../ui'
import type { Vec3 } from '../lib/project'

let active: Viewer | null = null
/** The editor's viewer (for camera center, snapping and thumbnails). */
export const getViewer = () => active

const TAB_FOR = { item: 'scene', marker: 'spawns', light: 'lights' } as const

export function Viewport({ onEmptyImport }: { onEmptyImport: (files: File[]) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const project = useEditor((s) => s.project)
  const placeMode = useEditor((s) => s.placeMode)
  const [dropping, setDropping] = useState(false)

  useEffect(() => {
    const el = host.current!
    const viewer = new Viewer(el, {
      onPick(sel) {
        const st = useEditor.getState()
        st.select(sel)
        if (sel) st.set({ tab: TAB_FOR[sel.kind] })
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
        }
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
      el.dataset.place = s.placeMode || ''
      viewer.sync(s.project, { selection: s.selection, gizmo: s.gizmo, wireframe: s.wireframe, collisionView: s.collisionView, soloMaterial: s.soloMaterial, faceRange: s.faceRange })
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
      {placeMode && (
        <div className="viewport-banner">
          {placeMode === 'marker' ? 'Click the map to place a marker' : placeMode === 'light' ? 'Click the map to place a light' : 'Click a triangle to pick its collision face'}
          <button className="sm" onClick={() => useEditor.getState().set({ placeMode: null })}>Done (Esc)</button>
        </div>
      )}
      {empty && (
        <div className="empty-viewport">
          <div className="card">
            <h2>Start with a base map</h2>
            <p className="muted">Drop an OBJ (with its MTL and textures), GLB, glTF or FBX here, or use <b>Open base map</b> in the Scene tab.</p>
            <p className="faint small">These are your own 3D models: export them from Blender, SketchUp or 3ds Max, or download them from a model site. The game doesn't include any. To start from a map you already have installed, use <b>Assets → Import a map from the game</b>.</p>
          </div>
        </div>
      )}
      <div className="viewport-hint">Left drag orbit · right drag pan · wheel zoom · WASD/QE fly (Shift faster) · F focus · 1/2/3 move/rotate/scale</div>
    </div>
  )
}
