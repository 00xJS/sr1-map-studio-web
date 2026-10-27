// Simple mode's side panel: one panel that shows whatever is selected, or the
// map itself (checklist, game modes, adding things, everything in the map)
// when nothing is.
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useEditor, selectedItems, type Swatch } from './store'
import * as act from './actions'
import { getViewer } from './Viewport'
import { saveMyPrefab } from './myPrefabs'
const PhotoDialog = lazy(() => import('./PhotoDialog').then((m) => ({ default: m.PhotoDialog })))
import { Palette, chooseTool } from './Tools'
import { Checklist, useApplyFix, useChecklist } from './Checklist'
import { HealthSection } from './HealthPanel'
import { niceName, paintMaterial } from './paint'
import { Check, Field, FileButton, NumberInput, toast, toastError, useBusy } from '../ui'
import { catalogs } from '../lib/catalogs'
import { loadModel, textureUrl } from '../lib/assets'
import { dataPackStatus, hasGroup, type DataPackStatus } from '../lib/datapack'
import { blockers } from '../lib/checklist'
import { MARKER_HINTS, MODE_HINTS, SIMPLE_MARKERS, markerLabel } from '../lib/labels'
import { GAME_MODES, isCustomNative, isGlass, type Light, type Marker, type SceneItem, type Vec3 } from '../lib/project'
import { ALL_PREFABS } from '../lib/prefabRegistry'
import { prefabParams } from '../lib/prefabs'
import { photoAspect } from '../lib/prefabsSigns'
import { RoadPanel, TERRAIN_LOOK, TerrainPanel } from './GroundToolOptions'
import { AMBIENCE_OPTIONS, ambienceHint, waterHint } from '../lib/mapFeatures'
import { LoadingSetting } from './panels/ExportPanel'
import { PhysicsPanel } from './PhysicsPanel'
import { RetailMarkerFields } from './RetailMarkerFields'
import { VehiclePicker } from './VehiclePicker'
import { openPrefabBrowser } from './PrefabBrowser'
import { SwapPanel } from './SwapPanel'
import { LayerField, LayersPanel } from './panels/LayersPanel'

const TextureStudio = lazy(() => import('./TextureStudio').then((m) => ({ default: m.TextureStudio })))
const MODEL_ACCEPT = '.obj,.mtl,.glb,.gltf,.fbx,.bin,.png,.jpg,.jpeg,.tga,.bmp,.dds,.tif,.tiff'

/** Opens advanced mode on the tab that holds the rest of the settings. */
function MoreOptions({ tab, children }: { tab: string; children: ReactNode }) {
  return <button className="sm quiet more" onClick={() => useEditor.getState().set({ advanced: true, tab })}>{children} →</button>
}

export function Inspector({ onSamples, onPlay }: { onSamples: () => void; onPlay: () => void }) {
  const project = useEditor((s) => s.project)!
  const sel = useEditor((s) => s.selection)
  const multi = useEditor((s) => s.multi)
  const item = sel?.kind === 'item' && multi.length < 2 ? project.scene_items[sel.index] : undefined
  const marker = sel?.kind === 'marker' ? project.markers[sel.index] : undefined
  const light = sel?.kind === 'light' ? project.lights[sel.index] : undefined
  const title = multi.length > 1 ? `${multi.length} objects` : item ? item.name : marker ? markerLabel(marker.type) + (marker.type === 'Weapon pickup' ? `: ${weaponName(marker.weapon)}` : '') : light ? 'Light' : 'Your map'
  return (
    <>
      <div className="inspector-head">
        {sel && <button className="sm quiet" onClick={() => useEditor.getState().select(null)} title="Back to the map overview (Esc)">← Map</button>}
        <b className="grow ellipsis">{title}</b>
      </div>
      <div className="panel inspector" data-tour="panel">
        {item && <ObjectInspector key={item.uid} it={item} index={sel!.index} />}
        {marker && <MarkerInspector key={marker.uid} m={marker} index={sel!.index} />}
        {light && <LightInspector key={light.uid} l={light} index={sel!.index} />}
        {multi.length > 1 && <MultiInspector indices={multi} />}
        {!item && !marker && !light && multi.length < 2 && <MapOverview onSamples={onSamples} onPlay={onPlay} />}
      </div>
    </>
  )
}

const weaponName = (id: string) => catalogs.weapons.find(([, w]) => w === id)?.[0] ?? id

// ---------------- nothing selected: the map ----------------

function MapOverview({ onSamples, onPlay }: { onSamples: () => void; onPlay: () => void }) {
  const project = useEditor((s) => s.project)!
  const update = useEditor((s) => s.update)
  const items = useChecklist()
  const fix = useApplyFix(onSamples)
  const blocked = blockers(items).length > 0
  const modes = project.settings.modes
  return (
    <>
      <div className="group">
        <span className="section-title">Ready to play?</span>
        <Checklist items={items} onFix={fix} />
        <button className="primary" onClick={onPlay}>{blocked ? 'Play in game…' : '▶ Play in game'}</button>
      </div>

      <HealthSection />

      <div className="group" id="game-modes">
        <span className="section-title">Game modes</span>
        {GAME_MODES.map((m) => (
          <Check key={m} checked={modes.includes(m)} onChange={(v) => update('Game modes', (d) => { d.settings.modes = GAME_MODES.filter((x) => (x === m ? v : modes.includes(x))) })}>
            <span className="col" style={{ gap: 0 }}><span>{m}</span><span className="faint small">{MODE_HINTS[m]}</span></span>
          </Check>
        ))}
      </div>

      <div className="group">
        <span className="section-title">Time and weather</span>
        <div className="row wrap">
          <button className={'sm' + (project.settings.always_clear_weather ? ' on' : '')} onClick={() => update('Time and weather', (d) => { d.settings.always_clear_weather = true })}>☀️ Always noon, clear</button>
          <button className={'sm' + (!project.settings.always_clear_weather ? ' on' : '')} onClick={() => update('Time and weather', (d) => { d.settings.always_clear_weather = false })}>🌗 Changes each match</button>
        </div>
        <span className="faint small">{project.settings.always_clear_weather
          ? 'Every match is at noon under a clear sky, like most custom maps.'
          : 'Like the retail maps: each match rolls noon, midnight, dusk or dawn and the weather. Not yet tried on custom maps, so check how it looks at night.'}</span>
      </div>

      <div className="group">
        <span className="section-title">Background sound <span className="chip">new</span></span>
        <select value={project.settings.ambience || ''} onChange={(e) => update('Background sound', (d) => { d.settings.ambience = e.target.value })}>
          <option value="">None</option>
          {AMBIENCE_OPTIONS.map((o) => <option key={o.file} value={o.file}>{o.label}</option>)}
        </select>
        <span className="faint small">{ambienceHint(project.settings.ambience)}</span>
      </div>

      <div className="group">
        <span className="section-title">Loading screen</span>
        <LoadingSetting />
      </div>

      <AddThings />
      {project.scene_items.length > 0 && <LayersPanel compact />}
      <Everything />
      <p className="faint small">Click anything in the map to change it here. Need every setting? <MoreOptions tab="scene">Advanced mode</MoreOptions></p>
    </>
  )
}

function AddThings() {
  const project = useEditor((s) => s.project)!
  const [pack, setPack] = useState<DataPackStatus | null>(null)
  const [run, busy] = useBusy()
  const [photo, setPhoto] = useState(false)
  useEffect(() => { dataPackStatus().then(setPack) }, [])
  const center = () => (getViewer()?.center() ?? [0, 0, 0]) as Vec3
  const lib = project.asset_library
  const tool = (id: string, label: string) => <button className="sm" onClick={() => chooseTool(id)}>{label}</button>
  return (
    <div className="group">
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
      </div>
      {photo && <Suspense fallback={null}><PhotoDialog onClose={() => setPhoto(false)} /></Suspense>}
      {lib.length > 0 && (
        <div className="list" style={{ maxHeight: 160 }}>
          {lib.map((a, i) => (
            <div key={a.uid} className="list-item" title="Click to place where the camera is looking" onClick={() => act.placeAsset(i, center()).catch(toastError)}>
              <span className="grow ellipsis">{a.name}</span><span className="meta">place</span>
            </div>
          ))}
        </div>
      )}
      <span className="faint small">Shapes, spawns, weapons and lights: pick the tool, then click the map where you want it.</span>
    </div>
  )
}

function Everything() {
  const project = useEditor((s) => s.project)!
  const [open, setOpen] = useState(false)
  const select = useEditor((s) => s.select)
  const total = project.scene_items.length + project.markers.length + project.lights.length
  const row = (key: string, label: ReactNode, onClick: () => void) => <div key={key} className="list-item" onClick={onClick}><span className="grow ellipsis">{label}</span></div>
  return (
    <div className="group">
      <button className="quiet section-toggle" onClick={() => setOpen(!open)}>
        <span className="section-title">Everything in your map ({total})</span><span className="faint">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="list" style={{ maxHeight: 320 }}>
          <div className="list-head">Objects</div>
          {project.scene_items.map((x, i) => row(x.uid, x.name, () => { select({ kind: 'item', index: i }); getViewer()?.focusSelection() }))}
          <div className="list-head">Spawns &amp; pickups</div>
          {project.markers.map((m, i) => row(m.uid, <>{markerLabel(m.type)}{m.type === 'Weapon pickup' && <span className="faint">: {weaponName(m.weapon)}</span>}</>, () => select({ kind: 'marker', index: i })))}
          {!project.markers.length && <div className="list-item faint">None yet</div>}
          <div className="list-head">Lights</div>
          {project.lights.map((l, i) => row(l.uid, l.name, () => select({ kind: 'light', index: i })))}
          {!project.lights.length && <div className="list-item faint">None yet</div>}
        </div>
      )}
    </div>
  )
}

// ---------------- an object ----------------

function TexThumb({ path }: { path: string }) {
  const project = useEditor((s) => s.project)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { setUrl(null); if (path) textureUrl(project, path).then(setUrl) }, [path])
  return url ? <img className="tex-thumb" src={url} alt="" /> : <span className="tex-thumb" />
}

/** "Save as my prefab": names the picked objects and keeps them to place again in any map. */
function SaveMine({ indices, suggest }: { indices: number[]; suggest: string }) {
  const [name, setName] = useState<string | null>(null)
  const save = () => {
    try {
      const p = saveMyPrefab(indices, name ?? suggest)
      setName(null)
      toast(`Saved "${p.name}". Find it under Add shape → Prefabs → My prefabs, in any map.`, 'ok', 4000)
    } catch (err) { toastError(err) }
  }
  if (name === null) return <button className="sm quiet" onClick={() => setName(suggest)} title="Keep these to place again, in this map or any other">★ Save as my prefab</button>
  return (
    <div className="row">
      <input className="grow" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setName(null) }} aria-label="Prefab name" />
      <button className="sm primary" onClick={save}>Save</button>
      <button className="sm quiet" onClick={() => setName(null)}>Cancel</button>
    </div>
  )
}

/** Several objects picked with Shift+click, or a group. */
function MultiInspector({ indices }: { indices: number[] }) {
  const project = useEditor((s) => s.project)!
  const [run] = useBusy()
  const items = indices.map((i) => project.scene_items[i]).filter(Boolean)
  const groups = new Set(items.map((it) => it.group).filter(Boolean))
  const grouped = groups.size === 1 && items.every((it) => it.group)
  const counts = new Map<string, number>()
  for (const it of items) counts.set(it.name, (counts.get(it.name) ?? 0) + 1)
  return (
    <>
      <div className="group">
        <div className="row wrap">
          <button className="sm" onClick={() => act.turnItems(selectedItems(), -90)} title="Turn them all 90° left, about their middle">↺ Turn</button>
          <button className="sm" onClick={() => act.turnItems(selectedItems(), 90)} title="Turn them all 90° right">↻ Turn</button>
          <button className="sm" onClick={() => run(async () => act.duplicateItems(selectedItems()))} title="Ctrl+D">Duplicate</button>
          <button className="sm" onClick={() => run(async () => { act.copyItems(selectedItems()) })} title="Ctrl+C, then Ctrl+V to paste, even into another map">Copy</button>
          <button className="sm" onClick={() => getViewer()?.focusSelection()}>Zoom to them</button>
        </div>
        <div className="row wrap">
          {grouped
            ? <button className="sm" onClick={() => act.ungroupItems(selectedItems())} title="Ctrl+Shift+G">Ungroup</button>
            : <button className="sm primary" onClick={() => run(async () => act.groupItems(selectedItems()))} title="Ctrl+G: clicking any of them picks them all">Group</button>}
          <span className="spacer" />
          <button className="sm danger" onClick={() => act.removeItems(selectedItems())}>Delete {items.length}</button>
        </div>
        <LayerField indices={indices} />
        <SaveMine indices={indices} suggest={grouped ? 'My group' : 'My piece'} />
        <span className="faint small">{grouped ? 'A group: clicking any part picks the whole group. ' : ''}Drag the arrows to move them together. Shift+click an object to add or remove it.</span>
      </div>
      <div className="group">
        <span className="section-title">Picked</span>
        <span className="small muted">{[...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ')}</span>
      </div>
      <PhysicsPanel indices={indices} />
    </>
  )
}

function ObjectInspector({ it, index }: { it: SceneItem; index: number }) {
  const update = useEditor((s) => s.update)
  const [run] = useBusy()
  const set = (label: string, fn: (d: SceneItem) => void, merge?: string) =>
    update(label, (d) => { fn(d.scene_items[index] as SceneItem) }, merge ? { merge: merge + index } : undefined)
  const fixedGlass = isGlass(it) && !isCustomNative(it)
  const turn = (deg: number) => set('Turn', (d) => { d.rotation = [d.rotation[0], ((d.rotation[1] + deg) % 360 + 360) % 360, d.rotation[2]] })
  return (
    <>
      <div className="group">
        <Field label="Name"><input value={it.name} onChange={(e) => set('Rename', (d) => { d.name = e.target.value }, 'name')} /></Field>
        <LayerField indices={[index]} />
        <div className="row wrap">
          <button className="sm" onClick={() => turn(-90)} title="Turn 90° left">↺ Turn</button>
          <button className="sm" onClick={() => turn(90)} title="Turn 90° right">↻ Turn</button>
          <button className="sm" onClick={() => run(async () => act.duplicateItem(index))} title="Make a copy (Ctrl+D)">Duplicate</button>
          <button className="sm" onClick={() => getViewer()?.focusSelection()}>Zoom to it</button>
          <span className="spacer" />
          <button className="sm danger" onClick={() => act.removeItem(index)}>Delete</button>
        </div>
        <SaveMine indices={[index]} suggest={it.name} />
        <span className="faint small">Drag the colored arrows in the view to move it. The tools on the left turn and resize it too. Shift+click other objects to pick several.</span>
        {it.game_object && <span className="small muted">From your game files: usable in your own maps, not shareable (share links, the hub and the Showcase leave it out; backups carry only where it came from).</span>}
      </div>

      <SwapPanel it={it} index={index} />
      {it.prefab && ALL_PREFABS[it.prefab.key]?.params && <PrefabSettings it={it} index={index} />}
      {it.prefab?.key === 'road' && <RoadPanel />}
      {it.shape?.kind === 'terrain' && <TerrainPanel it={it} />}

      {fixedGlass
        ? <div className="group"><span className="section-title">Look</span><span className="small muted">A breakable glass window. It keeps its glass look and size.</span></div>
        : <LookEditor it={it} index={index} />}

      <div className="group">
        <span className="section-title">Size</span>
        {it.shape ? <ShapeSize it={it} index={index} /> : (
          <Field label="Scale" hint="1 = the size it was made at">
            <NumberInput value={it.scale} step={0.1} min={0.001} max={10000} disabled={fixedGlass} onChange={(v) => set('Scale', (d) => { d.scale = v })} />
          </Field>
        )}
      </div>

      {!isGlass(it) && (
        <div className="group">
          <Check checked={!it.collision_disabled} onChange={(v) => set('Solid', (d) => { d.collision_disabled = !v })}>
            <span className="col" style={{ gap: 0 }}><span>Solid</span><span className="faint small">Players and cars can't pass through it.</span></span>
          </Check>
          <Check checked={!!it.swimmable_water} onChange={(v) => set('Swimmable water', (d) => { d.swimmable_water = v })}>
            <span className="col" style={{ gap: 0 }}><span>Swimmable water <span className="chip">new</span></span><span className="faint small">{waterHint(it)}</span></span>
          </Check>
        </div>
      )}
      <PhysicsPanel indices={[index]} />
      <MoreOptions tab="scene">More options: breakable, movable or explosive, exact position</MoreOptions>
    </>
  )
}

function LookEditor({ it, index }: { it: SceneItem; index: number }) {
  const project = useEditor((s) => s.project)
  const [mats, setMats] = useState<string[]>([])
  const [picking, setPicking] = useState<string | null>(null)
  const [studio, setStudio] = useState<string | null>(null)
  const [run] = useBusy()
  useEffect(() => { loadModel(project, it.path).then((m) => setMats(m.mats.map((x) => x || 'default'))).catch(() => setMats(Object.keys(it.textures || {}))) }, [it.path])
  useEffect(() => {
    if (!picking) return
    const close = () => setPicking(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [picking])
  const custom = isCustomNative(it)
  const shown = custom ? mats.slice(0, 1) : mats
  const label = (mat: string) => (it.shape?.kind === 'terrain' ? TERRAIN_LOOK[mat] ?? mat : it.shape ? (mat === 'top' ? 'Top' : 'Sides') : mat)
  return (
    <div className="group">
      <span className="section-title">Look</span>
      {shown.map((mat) => {
        const tex = custom ? it.glass_custom_texture : it.textures?.[mat]
        return (
          <div key={mat} className="col" style={{ gap: 6 }}>
          <div className="row look-row">
            <TexThumb path={tex || ''} />
            <div className="col grow" style={{ gap: 0, minWidth: 0 }}>
              <span className="small">{label(mat)}</span>
              <span className={'small ellipsis ' + (tex ? 'faint' : 'bad')}>{tex ? niceName(tex) : 'No texture yet'}</span>
            </div>
            <button className={'sm' + (picking === mat ? ' on' : '')} onMouseDown={(e) => e.stopPropagation()} onClick={() => setPicking(picking === mat ? null : mat)}>Change ▾</button>
            <button className="sm quiet" onClick={() => setStudio(mat)} title="Use a photo, your camera, or make your own colors">Photo…</button>
          </div>
          {picking === mat && <Palette onClose={() => setPicking(null)} current={tex ? 'file:' + tex : undefined}
            onPick={(s: Swatch) => run(() => paintMaterial(index, mat, s))} />}
          </div>
        )
      })}
      <span className="faint small">Or use the Paint bucket tool and click any surface.</span>
      {studio && <Suspense fallback={null}><TextureStudio index={index} mat={studio} onClose={() => setStudio(null)} /></Suspense>}
    </div>
  )
}

function ShapeSize({ it, index }: { it: SceneItem; index: number }) {
  const [run] = useBusy()
  const shape = it.shape!
  const set = (patch: Partial<typeof shape>) => run(() => act.updateShape(index, patch))
  const dim = (i: number, label: string) => (
    <Field label={label}><NumberInput value={shape.size[i]} step={0.5} min={0.1} max={2000} onChange={(v) => {
      const size = [...shape.size] as Vec3
      size[i] = v
      set({ size })
    }} /></Field>
  )
  return (
    <>
      <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>{dim(0, 'Width')}{dim(1, 'Height')}{dim(2, 'Depth')}</div>
      {shape.kind === 'stairs' && <Field label="Steps"><NumberInput value={shape.segments ?? 8} step={1} digits={0} min={1} max={64} onChange={(v) => set({ segments: Math.round(v) })} /></Field>}
      <Field label="Pattern size" hint="Smaller = smaller bricks and tiles">
        <input type="range" min={0.5} max={16} step={0.5} value={shape.tile} onChange={(e) => set({ tile: +e.target.value })} />
      </Field>
    </>
  )
}

// ---------------- a spawn or pickup ----------------

function MarkerInspector({ m, index }: { m: Marker; index: number }) {
  const update = useEditor((s) => s.update)
  const set = (label: string, fn: (d: Marker) => void, merge?: string) => update(label, (d) => {
    const x = d.markers[index]
    fn(x)
    if (x.type === 'Weapon pickup') x.label = x.weapon
    if (x.type === 'Vehicle spawn') x.label = x.vehicle
  }, merge ? { merge: merge + index } : undefined)
  const types = m.type === 'Weapon pickup' ? ['Weapon pickup'] : SIMPLE_MARKERS.includes(m.type) ? SIMPLE_MARKERS : [m.type, ...SIMPLE_MARKERS]
  const turn = (deg: number) => set('Turn', (d) => { d.yaw = ((Math.round(d.yaw + deg) % 360) + 360) % 360 })
  return (
    <>
      <div className="group">
        {m.type !== 'Weapon pickup' && (
          <Field label="What it is" hint={MARKER_HINTS[m.type]}>
            <select value={m.type} onChange={(e) => set('Marker type', (d) => { d.type = e.target.value })}>
              {types.map((t) => <option key={t} value={t}>{markerLabel(t)}</option>)}
            </select>
          </Field>
        )}
        {m.type === 'Weapon pickup' && (
          <Field label="Weapon">
            <select value={m.weapon} onChange={(e) => set('Weapon', (d) => { d.weapon = e.target.value })}>
              {!catalogs.weapons.some(([, id]) => id === m.weapon) && <option value={m.weapon}>{m.weapon}</option>}
              {catalogs.weapons.map(([n, id]) => <option key={id} value={id}>{n}</option>)}
            </select>
          </Field>
        )}
        {m.type === 'Vehicle spawn' && (
          <Field label="Vehicle">
            <VehiclePicker value={m.vehicle} onChange={(id) => set('Vehicle', (d) => { d.vehicle = id })} />
          </Field>
        )}
        <RetailMarkerFields m={m} index={index} set={set} />
        <div className="row">
          <span className="small muted">Faces</span>
          <svg viewBox="-10 -10 20 20" width="26" height="26" style={{ transform: `rotate(${m.yaw}deg)` }} aria-hidden>
            <circle r="9" fill="none" stroke="var(--line-strong)" /><path d="M0 -7 L4 2 L0 0 L-4 2Z" fill="var(--accent)" />
          </svg>
          <span className="small mono">{((Math.round(m.yaw) % 360) + 360) % 360}°</span>
          <button className="sm" onClick={() => turn(-45)}>↺</button>
          <button className="sm" onClick={() => turn(45)}>↻</button>
        </div>
        <div className="row wrap">
          <button className="sm" onClick={() => {
            const y = getViewer()?.surfaceBelow(m.position[0], m.position[1] + 1, m.position[2])
            if (y == null) { toastError(new Error('There is nothing under it to stand on.')); return }
            set('Drop to ground', (d) => { d.position = [m.position[0], y + 0.12, m.position[2]] })
          }}>Drop to the ground</button>
          <span className="spacer" />
          <button className="sm danger" onClick={act.removeSelected}>Delete</button>
        </div>
        <span className="faint small">Drag the arrows in the view to move it.</span>
      </div>
      <MoreOptions tab="spawns">More options: exact position, triggers, NPCs</MoreOptions>
    </>
  )
}

// ---------------- a light ----------------

const toHex = (c: Vec3) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')
const fromHex = (h: string): Vec3 => [1, 3, 5].map((i) => +(parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4)) as Vec3
const LIGHT_PRESETS: [string, Vec3][] = [['Warm', [1, 0.85, 0.65]], ['White', [1, 1, 1]], ['Cool', [0.7, 0.85, 1]], ['Red', [1, 0.25, 0.2]], ['Purple', [0.8, 0.3, 1]], ['Green', [0.3, 1, 0.45]]]

function LightInspector({ l, index }: { l: Light; index: number }) {
  const update = useEditor((s) => s.update)
  const set = (label: string, fn: (d: Light) => void, merge?: string) => update(label, (d) => { fn(d.lights[index]) }, merge ? { merge: merge + index } : undefined)
  return (
    <>
      <div className="group">
        <Check checked={l.enabled} onChange={(v) => set('Toggle light', (d) => { d.enabled = v })}>On</Check>
        <Field label="Color">
          <div className="row wrap">
            {LIGHT_PRESETS.map(([name, c]) => (
              <button key={name} className={'sm' + (toHex(c) === toHex(l.color) ? ' on' : '')} onClick={() => set('Light color', (d) => { d.color = c })}>
                <span className="swatch" style={{ background: toHex(c) }} />{name}
              </button>
            ))}
            <input type="color" value={toHex(l.color)} title="Any color" onChange={(e) => set('Light color', (d) => { d.color = fromHex(e.target.value) }, 'color')} style={{ width: 40, padding: 2 }} />
          </div>
        </Field>
        <Field label={`Brightness: ${l.intensity.toFixed(1)}`}>
          <input type="range" min={0} max={10} step={0.1} value={l.intensity} onChange={(e) => set('Brightness', (d) => { d.intensity = +e.target.value }, 'intensity')} />
        </Field>
        <Field label={`Reach: ${l.range.toFixed(0)}`} hint="How far the light spreads">
          <input type="range" min={1} max={60} step={1} value={l.range} onChange={(e) => set('Reach', (d) => {
            d.range = +e.target.value
            if (d.inner_range >= d.range) d.inner_range = +(d.range * 0.4).toFixed(2)
          }, 'range')} />
        </Field>
        <div className="row"><span className="spacer" /><button className="sm danger" onClick={act.removeSelected}>Delete</button></div>
      </div>
      <MoreOptions tab="lights">More options: name, exact position, falloff</MoreOptions>
    </>
  )
}

// ---------------- a prefab's settings ----------------

/** Size, floors, style, color... of a placed prefab; it rebuilds in place as they change. */
function PrefabSettings({ it, index }: { it: SceneItem; index: number }) {
  const def = ALL_PREFABS[it.prefab!.key]
  const [values, setValues] = useState(() => prefabParams(def, it.prefab!.params))
  const [busy, setBusy] = useState(false)
  useEffect(() => setValues(prefabParams(def, it.prefab!.params)), [it.uid])
  // Rebuild shortly after the last change, so dragging a number doesn't rebuild on every step.
  useEffect(() => {
    if (JSON.stringify(values) === JSON.stringify(prefabParams(def, it.prefab!.params))) return
    const t = setTimeout(() => {
      setBusy(true)
      act.updatePrefab(index, values).catch(toastError).finally(() => setBusy(false))
    }, 350)
    return () => clearTimeout(t)
  }, [values])
  const change = (k: string, v: number | string) => setValues((x) => ({ ...x, [k]: v }))
  const params = def.params!.filter((d) => d.kind !== 'path')
  return (
    <div className="group">
      <div className="row between"><span className="section-title">{def.label} settings</span>{busy && <span className="faint small">Rebuilding…</span>}</div>
      {params.filter((d) => d.kind === 'text').map((d) => (
        <Field key={d.key} label={d.label} hint={d.hint}>
          <textarea rows={2} maxLength={80} value={String(values[d.key])} onChange={(e) => change(d.key, e.target.value)} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
        </Field>
      ))}
      <div className="form-grid">
        {params.filter((d) => d.kind !== 'text').map((d) => (
          <Field key={d.key} label={d.label} hint={d.hint}>
            {d.kind === 'select'
              ? <select value={String(values[d.key])} onChange={(e) => change(d.key, e.target.value)}>{d.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              : d.kind === 'color'
                ? (
                  <div className="row">
                    <input type="color" value={String(values[d.key] || d.auto?.(values) || '#808080')} onChange={(e) => change(d.key, e.target.value)} style={{ width: 40, padding: 2 }} />
                    {values[d.key] ? <button className="sm" title="Use the style's own color" onClick={(e) => { e.preventDefault(); change(d.key, '') }}>Reset</button> : <span className="faint small">Style's</span>}
                  </div>
                )
                : <NumberInput value={Number(values[d.key])} min={d.min} max={d.max} step={d.step} onChange={(v) => change(d.key, v)} />}
          </Field>
        ))}
      </div>
      {def.photo && <FramePhoto it={it} index={index} aspect={photoAspect(values)} />}
      <span className="faint small">Your repaints are kept when it rebuilds.</span>
    </div>
  )
}

/** A photo frame's picture: choose one of your own, or take it out. */
function FramePhoto({ it, index, aspect }: { it: SceneItem; index: number; aspect: number }) {
  const files = useEditor((s) => s.project?.files)
  const [run, busy] = useBusy()
  const mat = files && act.photoMaterial(it, files)
  if (!mat) return null
  const has = it.textures[mat] !== it.prefab!.defaults[mat]
  return (
    <div className="row wrap">
      <FileButton className="sm" accept="image/*" disabled={busy} onFiles={([f]) => run(() => act.setFramePhoto(index, f, aspect))}>{has ? 'Change photo…' : 'Choose photo…'}</FileButton>
      {has && <button className="sm" disabled={busy} onClick={() => run(() => act.setFramePhoto(index, null))}>Remove photo</button>}
      <span className="faint small">Cut to the frame's shape. Your photo goes into your game; share links and the Showcase show the stand-in picture instead.</span>
    </div>
  )
}
