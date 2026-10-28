// The Build tab: adding things (tools, prefabs, your own models and photos), the layers, and every object,
// spawn and light in the map, with the selected one scrolled into view.
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { useEditor } from '../store'
import * as act from '../actions'
import { getViewer } from '../Viewport'
import { chooseTool } from '../Tools'
import { openPrefabBrowser } from '../PrefabBrowser'
import { LayersPanel } from '../panels/LayersPanel'
import { AssetsPanel } from '../panels/AssetsPanel'
import { MaterialsPanel } from '../panels/MaterialsPanel'
import { More } from '../More'
import { DummyPicker } from '../DummyPanel'
import { weaponName } from '../Inspector'
import { FileButton, confirmDialog, toastError, useBusy } from '../../ui'
import { catalogs } from '../../lib/catalogs'
import { dataPackStatus, hasGroup, type DataPackStatus } from '../../lib/datapack'
import { markerLabel } from '../../lib/labels'
import { RETAIL_MARKER_TYPES } from '../../lib/retailModes'
import { PIMP_EXIT, isCustomNative, isGlass, isProp, type SceneItem, type Vec3 } from '../../lib/project'

const PhotoDialog = lazy(() => import('../PhotoDialog').then((m) => ({ default: m.PhotoDialog })))
export const MODEL_ACCEPT = '.obj,.mtl,.glb,.gltf,.fbx,.bin,.png,.jpg,.jpeg,.tga,.bmp,.dds,.tif,.tiff'

export function BuildTab() {
  const hasItems = useEditor((s) => s.project!.scene_items.length > 0)
  return (
    <>
      <AddThings />
      <ObjectList />
      {hasItems && <LayersPanel compact />}
      <More id="build" title="Library, imports and every texture">
        <SceneTools />
        <AssetsPanel />
        <div className="section">
          <span className="section-title">Every texture</span>
          <MaterialsPanel />
        </div>
      </More>
    </>
  )
}

function AddThings() {
  const project = useEditor((s) => s.project)!
  const [pack, setPack] = useState<DataPackStatus | null>(null)
  const [run, busy] = useBusy()
  const [photo, setPhoto] = useState(false)
  const [dummy, setDummy] = useState(false)
  useEffect(() => { dataPackStatus().then(setPack).catch(() => setPack(null)) }, [])
  const center = () => (getViewer()?.center() ?? [0, 0, 0]) as Vec3
  const lib = project.asset_library
  const tool = (id: string, label: string) => <button className="sm" onClick={() => chooseTool(id)}>{label}</button>
  return (
    <div className="section">
      <span className="section-title">Add to your map</span>
      <div className="row wrap">
        {tool('shape', 'Shape')}<button className="sm" onClick={openPrefabBrowser} title="Buildings, cars, trees, bunkers and more, ready to place">Prefabs…</button>{tool('spawn', 'Spawn')}{tool('weapon', 'Weapon')}{tool('light', 'Light')}
        {hasGroup(pack, 'glass') && <button className="sm" disabled={busy} onClick={() => run(() => act.addGlass(Object.keys(catalogs.glass_styles)[0], center()))}>Glass window</button>}
      </div>
      <div className="row wrap">
        <FileButton className="sm" multiple accept={MODEL_ACCEPT} disabled={busy}
          title="OBJ (with its MTL and textures), GLB, glTF or FBX from Blender or a model website"
          onFiles={(f) => run(() => act.importModelFiles(f, project.scene_items.length ? 'add' : 'base'))}>Your own 3D model…</FileButton>
        <button className="sm" onClick={() => setPhoto(true)} title="Turn a photo into a building front or a cut-out sign">From a photo…</button>
        <button className={'sm' + (dummy ? ' on' : '')} onClick={() => setDummy(!dummy)} aria-expanded={dummy} title="A posed Saints Row player or person standing still, to keep players guessing">Dummy…</button>
      </div>
      {dummy && <DummyPicker onClose={() => setDummy(false)} />}
      <AnyMarker />
      {photo && <Suspense fallback={null}><PhotoDialog onClose={() => setPhoto(false)} /></Suspense>}
      {lib.length > 0 && (
        <div className="list short">
          {lib.map((a, i) => (
            <button type="button" key={a.uid} className="list-item" title="Click to place where the camera is looking" onClick={() => act.placeAsset(i, center()).catch(toastError)}>
              <span className="grow ellipsis">{a.name}</span><span className="meta">place</span>
            </button>
          ))}
        </div>
      )}
      <span className="faint small">Pick a tool, then click the map where you want it.</span>
    </div>
  )
}

const MARKER_TYPES = [...catalogs.marker_types, ...RETAIL_MARKER_TYPES]

/** Every kind of marker (triggers, NPCs, retail-mode markers), placed by a click or where the camera looks; a light
 *  where the camera looks. */
function AnyMarker() {
  const hasItems = useEditor((s) => s.project!.scene_items.length > 0)
  const placeMode = useEditor((s) => s.placeMode)
  const type = useEditor((s) => s.placeMarkerType)
  const st = useEditor.getState
  const atCamera = () => (getViewer()?.center() ?? [0, 0, 0]) as Vec3
  return (
    <More id="add" title="Any kind of marker, or at the camera">
      <div className="stack">
        <div className="row wrap">
          <select className="grow" value={type} onChange={(e) => st().set({ placeMarkerType: e.target.value })} aria-label="Kind of marker">
            {MARKER_TYPES.map((t) => <option key={t} value={t}>{markerLabel(t)}</option>)}
          </select>
          <button className={'sm' + (placeMode === 'marker' ? ' on' : '')} disabled={!hasItems} onClick={() => st().set({ placeMode: placeMode === 'marker' ? null : 'marker' })}>
            {placeMode === 'marker' ? 'Click the map…' : '◎ Place on map'}
          </button>
          <button className="sm" onClick={() => { try { act.addMarker(type, atCamera()) } catch (e) { toastError(e) } }} title="Where the camera is looking">+ At the camera</button>
        </div>
        <div className="row wrap">
          <button className="sm" onClick={() => { try { const c = atCamera(); act.addLight([c[0], c[1] + 3, c[2]]) } catch (e) { toastError(e) } }} title="A little above where the camera is looking">+ Light at the camera</button>
        </div>
      </div>
    </More>
  )
}

function nativeTag(it: SceneItem) {
  if (isProp(it)) return catalogs.prop_presets[it.native_prop_behavior!]?.label ?? 'Native prop'
  if (isCustomNative(it)) return it.native_breakable_kind === 'wood' ? 'Breakable wood' : 'Breakable'
  if (isGlass(it)) return 'Glass'
  return null
}

/** Everything in the map; the selected row is highlighted and scrolled into view. */
function ObjectList() {
  const project = useEditor((s) => s.project)!
  const sel = useEditor((s) => s.selection)
  const multi = useEditor((s) => s.multi)
  const select = useEditor((s) => s.select)
  const list = useRef<HTMLDivElement>(null)
  const total = project.scene_items.length + project.markers.length + project.lights.length
  const on = (kind: 'item' | 'marker' | 'light', i: number) => (kind === 'item' && multi.length > 1 ? multi.includes(i) : sel?.kind === kind && sel.index === i)
  // Keep the selected row in view of the list (only the list scrolls, not the panel).
  useEffect(() => {
    const box = list.current, row = box?.querySelector<HTMLElement>('.list-item.selected')
    if (!box || !row) return
    const top = row.offsetTop - box.offsetTop, bottom = top + row.offsetHeight
    if (top < box.scrollTop) box.scrollTop = top - 24
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight + 4
  }, [sel?.kind, sel?.index, multi.length])
  const row = (key: string, kind: 'item' | 'marker' | 'light', i: number, label: ReactNode, extra?: ReactNode) => (
    <button type="button" key={key} className={'list-item' + (on(kind, i) ? ' selected' : '')} aria-pressed={on(kind, i)}
      onClick={(e) => {
        const st = useEditor.getState()
        if (kind === 'item' && e.shiftKey) st.toggleItem(i)
        else select({ kind, index: i })
      }}
      onDoubleClick={() => getViewer()?.focusSelection()} title="Click to select, double-click to zoom to it">
      <span className="grow ellipsis">{label}</span>{extra}
    </button>
  )
  return (
    <div className="section">
      <span className="section-title">In your map ({total})</span>
      <div className="list tall" ref={list} aria-label="Everything in your map">
        <div className="list-head">Objects ({project.scene_items.length})</div>
        {project.scene_items.map((x, i) => row(x.uid, 'item', i, x.name, <>
          {nativeTag(x) && <span className="tag-native">{nativeTag(x)}</span>}
          {x.collision_disabled && <span className="tag-warn">not solid</span>}
          {x.swimmable_water && <span className="tag-native">water</span>}
        </>))}
        {!project.scene_items.length && <div className="list-item faint">None yet</div>}
        <div className="list-head">Spawns and pickups ({project.markers.length})</div>
        {project.markers.map((m, i) => row(m.uid, 'marker', i, <>{markerLabel(m.type)}{m.type === 'Weapon pickup' && <span className="faint">: {weaponName(m.weapon)}</span>}</>,
          m.type === PIMP_EXIT ? <span className="tag-warn" title="The game has no pimp exit: change its type or delete it">not in the game</span> : undefined))}
        {!project.markers.length && <div className="list-item faint">None yet</div>}
        <div className="list-head">Lights ({project.lights.length})</div>
        {project.lights.map((l, i) => row(l.uid, 'light', i, l.name, !l.enabled ? <span className="meta">off</span> : undefined))}
        {!project.lights.length && <div className="list-item faint">None yet</div>}
      </div>
    </div>
  )
}

/** Replacing the whole map with a model, and adding one. */
function SceneTools() {
  const items = useEditor((s) => s.project!.scene_items)
  const [run, busy] = useBusy()
  return (
    <div className="section">
      <span className="section-title">Models</span>
      <div className="row wrap">
        <FileButton className="sm" multiple accept={MODEL_ACCEPT} disabled={busy} onFiles={(f) => run(async () => {
          if (items.length && !(await confirmDialog('Replace the whole map?', 'This replaces every object in the map with the model you chose. You can undo this.', { confirm: 'Replace' }))) return
          await act.importModelFiles(f, 'base')
        })}>Replace the map with a model…</FileButton>
      </div>
      <span className="faint small">{busy ? 'Importing…' : 'Choose an OBJ with its MTL and textures (usually in the folder you exported it to), or a GLB, glTF or FBX. You can also drop files on the 3D view.'}</span>
    </div>
  )
}
