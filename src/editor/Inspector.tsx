// The inspector: whatever is selected, on top of the side panel. The settings most maps need show straight
// away; the rest (exact numbers, pivot, collision faces, native props, every marker field) sit in "More
// settings", which "Show all settings" opens.
import { lazy, Suspense, useEffect, useState } from 'react'
import { useEditor, selectedItems, thingKey, type Swatch } from './store'
import * as act from './actions'
import { getViewer } from './Viewport'
import { saveMyPrefab } from './myPrefabs'
import { Palette } from './Tools'
import { niceName, paintMaterial } from './paint'
import { ArrangePanel } from './ArrangePanel'
import { More } from './More'
import { Check, Field, FileButton, NumberInput, Status, Vec3Input, confirmDialog, toast, toastError, useBusy } from '../ui'
import { statusParen, triedInGame } from '../lib/featureStatus'
import { catalogs } from '../lib/catalogs'
import { loadModel, textureUrl } from '../lib/assets'
import { MARKER_HINTS, SIMPLE_MARKERS, markerLabel } from '../lib/labels'
import { PIMP_EXIT, isCustomNative, isGlass, isProp, type Light, type Marker, type SceneItem, type Vec3 } from '../lib/project'
import { RETAIL_MARKER_TYPES } from '../lib/retailModes'
import { ALL_PREFABS } from '../lib/prefabRegistry'
import { prefabParams } from '../lib/prefabs'
import { photoAspect } from '../lib/prefabsSigns'
import { pickupRespawnMs } from '../lib/player'
import { py } from '../lib/py'
import { fmtM, toMetres, toUnits } from '../lib/units'
import { BREAKING_PRESETS, CRATE_PROFILE, MOVABLE_PRESETS, waterHint } from '../lib/mapFeatures'
import { RoadPanel, TERRAIN_LOOK, TerrainPanel } from './GroundToolOptions'
import { PhysicsPanel } from './PhysicsPanel'
import { CrateDebrisNote, RetailMarkerFields } from './RetailMarkerFields'
import { VehiclePicker } from './VehiclePicker'
import { SwapPanel } from './SwapPanel'
import { LayerField } from './panels/LayersPanel'

const TextureStudio = lazy(() => import('./TextureStudio').then((m) => ({ default: m.TextureStudio })))

export const weaponName = (id: string) => catalogs.weapons.find(([, w]) => w === id)?.[0] ?? id
const TRIGGERS = new Set(catalogs.trigger_kinds)
const MARKER_TYPES = [...catalogs.marker_types, ...RETAIL_MARKER_TYPES]

/** The map's world scale, for showing editor units in metres. */
const useScale = () => useEditor((s) => s.project?.settings.world_scale || 0.5)

/** A position shown and typed in metres; `factor` is metres per stored unit. Typing in one axis changes only
 *  that axis: the other two keep their stored values exactly. */
export function MetresVec3({ value, onChange, step, factor }: { value: Vec3; onChange: (v: Vec3) => void; step?: number; factor: number }) {
  return (
    <div className="vec3">
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <label key={axis} data-axis={axis}>
          <NumberInput value={value[i] * factor} step={step} onChange={(v) => {
            const next = [...value] as Vec3
            next[i] = factor ? v / factor : v
            onChange(next)
          }} />
        </label>
      ))}
    </div>
  )
}

/** What is selected, or nothing when nothing is. */
export function SelectionInspector() {
  const project = useEditor((s) => s.project)!
  const sel = useEditor((s) => s.selection)
  const multi = useEditor((s) => s.multi)
  const item = sel?.kind === 'item' && multi.length < 2 ? project.scene_items[sel.index] : undefined
  const marker = sel?.kind === 'marker' ? project.markers[sel.index] : undefined
  const light = sel?.kind === 'light' ? project.lights[sel.index] : undefined
  if (!item && !marker && !light && multi.length < 2) return null
  const title = multi.length > 1 ? `${multi.length} objects` : item ? item.name : marker ? markerLabel(marker.type) + (marker.type === 'Weapon pickup' ? `: ${weaponName(marker.weapon)}` : '') : 'Light'
  return (
    <section className="inspector" aria-label="Selected">
      <div className="inspector-head">
        <b className="grow ellipsis">{title}</b>
        <button className="sm quiet" onClick={() => getViewer()?.focusSelection()} title="Zoom to it (F)">Zoom to it</button>
        <button className="sm quiet icon" onClick={() => useEditor.getState().select(null)} title="Deselect (Esc)" aria-label="Deselect">✕</button>
      </div>
      <div className="inspector-body stack">
        {item && <ObjectInspector key={item.uid} it={item} index={sel!.index} />}
        {marker && <MarkerInspector key={marker.uid} m={marker} index={sel!.index} />}
        {light && <LightInspector key={light.uid} l={light} index={sel!.index} />}
        {multi.length > 1 && <MultiInspector indices={multi} />}
      </div>
    </section>
  )
}

// ---------------- an object ----------------

function TexThumb({ path }: { path: string }) {
  const project = useEditor((s) => s.project)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { setUrl(null); if (path) textureUrl(project, path).then(setUrl).catch(() => setUrl(null)) }, [path])
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
  if (name === null) return <button className="sm quiet start" onClick={() => setName(suggest)} title="Keep these to place again, in this map or any other">★ Save as my prefab</button>
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
      <div className="section">
        <div className="row wrap">
          <button className="sm" onClick={() => act.turnItems(selectedItems(), -90)} title="Turn them all 90° left, about their middle">Turn left</button>
          <button className="sm" onClick={() => act.turnItems(selectedItems(), 90)} title="Turn them all 90° right, about their middle">Turn right</button>
          <button className="sm" onClick={() => run(async () => act.duplicateItems(selectedItems()))} title="Ctrl+D">Duplicate</button>
          <button className="sm" onClick={() => run(async () => { act.copyItems(selectedItems()) })} title="Ctrl+C, then Ctrl+V to paste, even into another map">Copy</button>
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
      <ArrangePanel pieces={new Set(items.map((it, k) => it.group ?? '#' + k)).size} />
      <div className="section">
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
    update(label, (d) => { fn(d.scene_items[index] as SceneItem) }, merge ? { merge: merge + thingKey('item', index) } : undefined)
  const fixedGlass = isGlass(it) && !isCustomNative(it)
  const turn = (deg: number) => set('Turn', (d) => { d.rotation = [d.rotation[0], ((d.rotation[1] + deg) % 360 + 360) % 360, d.rotation[2]] })
  return (
    <>
      <div className="section">
        <Field label="Name"><input value={it.name} onChange={(e) => set('Rename', (d) => { d.name = e.target.value }, 'name')} /></Field>
        <LayerField indices={[index]} />
        <div className="row wrap">
          <button className="sm" onClick={() => turn(-90)} title="Turn 90° left">Turn left</button>
          <button className="sm" onClick={() => turn(90)} title="Turn 90° right">Turn right</button>
          <button className="sm" onClick={() => run(async () => act.duplicateItem(index))} title="Make a copy (Ctrl+D)">Duplicate</button>
          <span className="spacer" />
          <button className="sm danger" onClick={() => act.removeItem(index)}>Delete</button>
        </div>
        <SaveMine indices={[index]} suggest={it.name} />
        <span className="faint small">Drag the coloured arrows in the view to move it. Shift+click other objects to pick several.</span>
        {it.game_object && <span className="small muted">From your game files: usable in your own maps, not shareable (share links, the hub and the Showcase leave it out; backups carry only where it came from).</span>}
      </div>

      <SwapPanel it={it} index={index} />
      {it.prefab && ALL_PREFABS[it.prefab.key]?.params && <PrefabSettings it={it} index={index} />}
      {it.prefab?.key === 'road' && <RoadPanel />}
      {it.shape?.kind === 'terrain' && <TerrainPanel it={it} />}

      {fixedGlass
        ? <div className="section"><span className="section-title">Look</span><span className="small muted">A breakable glass window. It keeps its glass look and size.</span></div>
        : <LookEditor it={it} index={index} />}

      <div className="section">
        <span className="section-title">Size</span>
        {it.shape ? <ShapeSize it={it} index={index} /> : (
          <Field label="Scale" hint="1 = the size it was made at">
            <NumberInput value={it.scale} step={0.1} min={0.001} max={10000} disabled={fixedGlass} onChange={(v) => set('Scale', (d) => { d.scale = v })} />
          </Field>
        )}
      </div>

      {!isGlass(it) && (
        <div className="section">
          <Check checked={!it.collision_disabled} onChange={(v) => set('Solid', (d) => { d.collision_disabled = !v })}>
            <span className="stack tight"><span>Solid</span><span className="faint small">Players and cars can't pass through it.</span></span>
          </Check>
          <Check checked={!!it.swimmable_water} onChange={(v) => set('Swimmable water', (d) => { d.swimmable_water = v })}>
            <span className="stack tight"><span>Swimmable water <Status id="water" /></span><span className="faint small">{waterHint(it)}</span></span>
          </Check>
        </div>
      )}
      <PhysicsPanel indices={[index]} />
      <More id="object">
        <Transform it={it} index={index} />
        {!isGlass(it) && <CollisionSettings it={it} index={index} />}
        {index > 0 && <NativeControls it={it} index={index} />}
        {it.physics_intent && it.physics_intent !== 'Static' && (
          <div className="section">
            <span className="small muted">An old planning note says "{it.physics_intent}". It does nothing in the game: Movable and explosive props above make real ones.</span>
            <div><button className="sm" onClick={() => set('Clear planning note', (d) => { d.physics_intent = 'Static' })}>Clear the note</button></div>
          </div>
        )}
      </More>
    </>
  )
}

const STEPS = [['Fine', 0.05], ['Normal', 0.5], ['Coarse', 5]] as const

/** Exact position, turn and size, in metres; the pivot; its place in the list. */
function Transform({ it, index }: { it: SceneItem; index: number }) {
  const update = useEditor((s) => s.update)
  const step = useEditor((s) => s.step)
  const ws = useScale()
  const count = useEditor((s) => s.project!.scene_items.length)
  const [run] = useBusy()
  const fixedGlass = isGlass(it) && !isCustomNative(it)
  const set = (label: string, fn: (d: SceneItem) => void) => update(label, (d) => { fn(d.scene_items[index] as SceneItem) })
  return (
    <div className="section">
      <div className="row between"><span className="section-title">Position</span>
        <div className="btn-group" title="How far the arrow keys and Snap move it">
          {STEPS.map(([label, v]) => <button key={label} className={'sm' + (step === v ? ' on' : '')} onClick={() => useEditor.getState().set({ step: v })} title={fmtM(toMetres(v, ws))}>{label}</button>)}
        </div>
      </div>
      <Field label="Position (metres)"><MetresVec3 value={it.position} factor={ws} step={toMetres(step, ws)} onChange={(v) => set('Move', (d) => { d.position = v })} /></Field>
      <Field label="Turn (degrees): X tilt, Y heading, Z roll"><Vec3Input value={it.rotation} step={step < 1 ? 5 : 15} onChange={(v) => set('Rotate', (d) => { d.rotation = v })} /></Field>
      {it.shape && <Field label="Scale"><NumberInput value={it.scale} step={0.1} min={0.001} max={10000} disabled={fixedGlass} onChange={(v) => set('Scale', (d) => { d.scale = v })} /></Field>}
      <PivotControls it={it} index={index} />
      <div className="row wrap">
        <button className="sm" onClick={() => run(() => act.groundItem(index))} title="Put its lowest point at height 0">Stand it on height 0</button>
        <span className="spacer" />
        <span className="small muted">In the list</span>
        <button className="sm" disabled={index === 0} onClick={() => act.moveItem(index, index - 1)} title="Move up the object list" aria-label="Move up the object list">↑</button>
        <button className="sm" disabled={index === count - 1} onClick={() => act.moveItem(index, index + 1)} title="Move down the object list" aria-label="Move down the object list">↓</button>
      </div>
    </div>
  )
}

function PivotControls({ it, index }: { it: SceneItem; index: number }) {
  // The pivot is in the model's own units, before its scale: metres = pivot × scale × world scale.
  const factor = it.scale * useScale()
  const [custom, setCustom] = useState<Vec3>(it.pivot || [0, 0, 0])
  const [open, setOpen] = useState(false)
  useEffect(() => setCustom(it.pivot || [0, 0, 0]), [it.pivot])
  const [run] = useBusy()
  return (
    <div className="stack tight">
      <div className="row wrap">
        <span className="small muted">Pivot</span>
        <button className="sm" onClick={() => run(() => act.setPivot(index, 'center'))} title="The object stays in place; turning and resizing use the new centre.">Centre</button>
        <button className="sm" onClick={() => run(() => act.setPivot(index, 'bottom'))}>Bottom centre</button>
        <button className="sm" onClick={() => run(() => act.setPivot(index, 'reset'))}>Reset</button>
        <button className={'sm' + (open ? ' on' : '')} onClick={() => setOpen(!open)}>Custom…</button>
      </div>
      {open && (
        <div className="row">
          <div className="grow"><MetresVec3 value={custom} factor={factor} step={0.05} onChange={setCustom} /></div>
          <button className="sm" onClick={() => run(() => act.setPivot(index, custom))}>Apply</button>
        </div>
      )}
      {it.pivot && it.pivot.some((v) => v) && <span className="faint small">Pivot: {it.pivot.map((v) => fmtM(v * factor)).join(', ')} from the model's origin</span>}
    </div>
  )
}

function CollisionSettings({ it, index }: { it: SceneItem; index: number }) {
  const update = useEditor((s) => s.update)
  const faceRange = useEditor((s) => s.faceRange)
  const placeMode = useEditor((s) => s.placeMode)
  const collisionView = useEditor((s) => s.collisionView)
  const project = useEditor((s) => s.project)
  const [count, setCount] = useState(0)
  useEffect(() => { loadModel(project, it.path).then((m) => setCount(m.faces.length / 3)).catch(() => setCount(0)) }, [it.path])
  const excluded = it.collision_excluded_faces || []
  const [a, b] = [Math.min(...faceRange), Math.max(...faceRange)]
  const edit = (exclude: boolean) => {
    if (a >= count || b >= count) { toastError(new Error(`Triangle numbers go from 0 to ${Math.max(0, count - 1)}.`)); return }
    update(exclude ? 'Exclude collision faces' : 'Restore collision faces', (d) => {
      const cur = new Set(d.scene_items[index].collision_excluded_faces || [])
      for (let f = a; f <= b; f++) exclude ? cur.add(f) : cur.delete(f)
      d.scene_items[index].collision_excluded_faces = [...cur].sort((x, y) => x - y)
    })
    useEditor.getState().log(`${exclude ? 'Excluded' : 'Restored'} collision for ${b - a + 1} source triangles on ${it.name}.`)
  }
  const st = useEditor.getState
  return (
    <div className="section">
      <span className="section-title">Collision and sides</span>
      <Check checked={!!it.double_sided} onChange={(v) => update('Two-sided', (d) => { d.scene_items[index].double_sided = v })}>Show both sides of this object in the game</Check>
      <div className="row wrap">
        <span className="small muted">Solid triangles</span>
        <button className={'sm' + (collisionView === 'faces' ? ' on' : '')} onClick={() => st().set({ collisionView: collisionView === 'faces' ? 'off' : 'faces' })}>Show collision</button>
        <button className={'sm' + (placeMode === 'face' ? ' on' : '')} onClick={() => st().set({ placeMode: placeMode === 'face' ? null : 'face', collisionView: 'faces' })}>Pick a triangle in 3D</button>
      </div>
      <div className="form-grid">
        <Field label="First"><NumberInput value={faceRange[0]} step={1} digits={0} min={0} onChange={(v) => st().set({ faceRange: [Math.round(v), faceRange[1]] })} /></Field>
        <Field label="Last"><NumberInput value={faceRange[1]} step={1} digits={0} min={0} onChange={(v) => st().set({ faceRange: [faceRange[0], Math.round(v)] })} /></Field>
      </div>
      <div className="row">
        <button className="sm" onClick={() => edit(true)}>Make them pass-through</button>
        <button className="sm" onClick={() => edit(false)}>Make them solid again</button>
      </div>
      <span className="faint small">{count.toLocaleString()} triangles; {excluded.length} pass-through. Green = solid, red = pass-through, orange = the chosen range. Pass-through triangles stay visible.</span>
    </div>
  )
}

function NativeControls({ it, index }: { it: SceneItem; index: number }) {
  const [behavior, setBehavior] = useState<'movable' | 'explosive'>(it.native_prop_behavior || 'movable')
  const [run, busy] = useBusy()
  const custom = isCustomNative(it)
  const glass = isGlass(it)
  const lim = catalogs.limits
  return (
    <div className="section">
      <span className="section-title">Movable and explosive props</span>
      <div className="row">
        <select className="grow" value={behavior} onChange={(e) => setBehavior(e.target.value as 'movable' | 'explosive')} aria-label="Prop behaviour">
          {Object.entries(catalogs.prop_presets).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
        </select>
        <button className="sm" disabled={busy || (glass && !custom)} onClick={() => run(() => act.applyNativeProp(index, behavior))}>Apply</button>
      </div>
      <span className="faint small">{catalogs.prop_presets[behavior]?.description} Keeps your mesh and texture. One material, 1–{lim.max_native_triangles.toLocaleString()} triangles, {lim.min_native_axis}–{lim.max_native_axis} m on each side in the game. Up to {lim.max_native_objects} native props and glass panes together.</span>
      <span className="section-title">Breakables <Status id="breakable_glass" /></span>
      <div className="row wrap">
        <button className="sm" disabled={busy || (glass && !custom)} onClick={() => run(async () => {
          if (!custom && !triedInGame('breakable_glass') && !(await confirmDialog('Experimental breakable glass', 'Your mesh, position, rotation and size are kept. The exporter generates an experimental fitted Havok box hull. This is structurally tested, not verified in game. Back up your map and test in a private match.', { confirm: 'Convert' }))) return
          await act.convertBreakable(index, 'glass')
        })}>Breakable glass</button>
        <button className="sm" disabled={busy || (glass && !custom)} onClick={() => run(async () => {
          if (!custom && !triedInGame('breakable_wood') && !(await confirmDialog('Experimental breakable wood', 'Wood keeps your mesh with a solid look and the _wo (wood) texture suffix. In the game it becomes a loose object that disappears when it breaks (choose how below), with no debris. The fitted Havok box is not verified in game.', { confirm: 'Convert' }))) return
          await act.convertBreakable(index, 'wood')
        })}>Breakable wood</button>
        {glass && <button className="sm" disabled={busy} onClick={() => run(() => act.returnStatic(index))}>Return to static</button>}
        {glass && !custom && <button className="sm" onClick={() => act.resetGlassSize(index)}>Reset glass size</button>}
        {custom && <button className="sm" onClick={() => act.makeOpaque(index)}>Make opaque</button>}
      </div>
      {custom && it.native_breakable_kind !== 'wood' && !isProp(it) && (
        <Field label={`Opacity: ${it.native_opacity ?? 100}%`} hint="100% = opaque shader + DXT1. Lower uses the tinted material + DXT5; test transparency in game.">
          <input type="range" min={0} max={100} value={it.native_opacity ?? 100} onChange={(e) => act.setOpacity(index, +e.target.value)} />
        </Field>
      )}
      {glass && !custom && <span className="faint small">Native pane: {catalogs.glass_size.map((v) => fmtM(v)).join(' × ')}, with its own collision and shatter effect. Its size is fixed.</span>}
      <ProfilePreset it={it} index={index} />
    </div>
  )
}

/** Stock break / weight preset of a movable prop or breakable-wood object. */
function ProfilePreset({ it, index }: { it: SceneItem; index: number }) {
  const update = useEditor((s) => s.update)
  if (!isCustomNative(it)) return null
  const wood = it.native_breakable_kind === 'wood' && !isProp(it)
  const presets = wood ? BREAKING_PRESETS : it.native_prop_behavior === 'movable' ? MOVABLE_PRESETS : null
  if (!presets) return null
  const value = presets.some(([p]) => p === it.native_profile) ? it.native_profile! : presets[0][0]
  return (
    <Field label={(wood ? 'How it breaks' : 'Weight preset') + statusParen(wood ? 'breakable_wood' : 'physics_props')}
      hint="Stock presets from the game's own object table. Health and weight come with each preset: a map can't set its own numbers.">
      <select value={value} onChange={(e) => update('Object preset', (d) => { d.scene_items[index].native_profile = e.target.value })}>
        {presets.map(([p, label]) => <option key={p} value={p}>{label}</option>)}
      </select>
      {value === CRATE_PROFILE && <CrateDebrisNote />}
    </Field>
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
  // Shapes and terrains name their surfaces; a model's are named by the picture on them.
  const label = (mat: string, k: number, tex: string | undefined) => (it.shape?.kind === 'terrain' ? TERRAIN_LOOK[mat] ?? mat
    : it.shape ? (mat === 'top' ? 'Top' : 'Sides')
    : tex ? niceName(tex) : shown.length > 1 ? `Surface ${k + 1}` : 'Surface')
  return (
    <div className="section">
      <span className="section-title">Look</span>
      {shown.map((mat, k) => {
        const tex = custom ? it.glass_custom_texture : it.textures?.[mat]
        const named = !!it.shape
        return (
          <div key={mat} className="stack tight">
            <div className="row look-row">
              <TexThumb path={tex || ''} />
              <div className="stack tight grow" title={named ? undefined : `Material ${mat}`}>
                <span className="ellipsis">{label(mat, k, tex)}</span>
                {named && tex && <span className="small ellipsis faint">{niceName(tex)}</span>}
                {!tex && <span className="small bad">No texture yet</span>}
              </div>
              <button className={'sm' + (picking === mat ? ' on' : '')} onMouseDown={(e) => e.stopPropagation()} onClick={() => setPicking(picking === mat ? null : mat)}>Change ▾</button>
              <button className="sm quiet" onClick={() => setStudio(mat)} title="Use a photo, your camera, or make your own colours">Photo…</button>
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

/** A shape's size and pattern, in metres. */
function ShapeSize({ it, index }: { it: SceneItem; index: number }) {
  const [run] = useBusy()
  const ws = useScale()
  const shape = it.shape!
  const set = (patch: Partial<typeof shape>) => run(() => act.updateShape(index, patch))
  const dim = (i: number, label: string) => (
    <Field label={label}><NumberInput value={toMetres(shape.size[i], ws)} step={0.25} min={toMetres(0.1, ws)} max={toMetres(2000, ws)} onChange={(v) => {
      const size = [...shape.size] as Vec3
      size[i] = toUnits(v, ws)
      set({ size })
    }} /></Field>
  )
  return (
    <>
      <div className="form-grid three">{dim(0, 'Width (m)')}{dim(1, 'Height (m)')}{dim(2, 'Depth (m)')}</div>
      {shape.kind === 'stairs' && <Field label="Steps"><NumberInput value={shape.segments ?? 8} step={1} digits={0} min={1} max={64} onChange={(v) => set({ segments: Math.round(v) })} /></Field>}
      {shape.kind === 'cylinder' && <Field label="Sides"><NumberInput value={shape.segments ?? 16} step={1} digits={0} min={3} max={64} onChange={(v) => set({ segments: Math.round(v) })} /></Field>}
      <Field label="Pattern repeats every (m)" hint="Smaller = smaller bricks and tiles">
        <NumberInput value={toMetres(shape.tile, ws)} step={0.25} min={toMetres(0.1, ws)} max={toMetres(100, ws)} onChange={(v) => set({ tile: toUnits(v, ws) })} />
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
  }, merge ? { merge: merge + thingKey('marker', index) } : undefined)
  const types = m.type === 'Weapon pickup' ? ['Weapon pickup'] : SIMPLE_MARKERS.includes(m.type) ? SIMPLE_MARKERS : [m.type, ...SIMPLE_MARKERS]
  const turn = (deg: number) => set('Turn', (d) => { d.yaw = ((Math.round(d.yaw + deg) % 360) + 360) % 360 })
  return (
    <>
      <div className="section">
        {m.type !== 'Weapon pickup' && (
          <Field label="What it is" hint={MARKER_HINTS[m.type]}>
            <select value={m.type} onChange={(e) => set('Marker type', (d) => { d.type = e.target.value })}>
              {m.type === PIMP_EXIT && <option value={PIMP_EXIT}>Pimp exit (not in the game, change this)</option>}
              {types.map((t) => <option key={t} value={t}>{markerLabel(t)}</option>)}
            </select>
          </Field>
        )}
        {m.type === 'Weapon pickup' && <WeaponField m={m} set={set} />}
        {m.type === 'Vehicle spawn' && (
          <Field label="Vehicle">
            <VehiclePicker value={m.vehicle} onChange={(id) => set('Vehicle', (d) => { d.vehicle = id.trim() || 'car_2dr_sports03' })} />
          </Field>
        )}
        <RetailMarkerFields m={m} index={index} set={set} />
        <div className="row wrap">
          <span className="small muted">Faces</span>
          <svg viewBox="-10 -10 20 20" width="26" height="26" style={{ transform: `rotate(${m.yaw}deg)` }} aria-hidden>
            <circle r="9" fill="none" stroke="var(--line-strong)" /><path d="M0 -7 L4 2 L0 0 L-4 2Z" fill="var(--accent)" />
          </svg>
          <span className="small mono">{((Math.round(m.yaw) % 360) + 360) % 360}°</span>
          <button className="sm" onClick={() => turn(-45)} title="Turn 45° left">Turn left</button>
          <button className="sm" onClick={() => turn(45)} title="Turn 45° right">Turn right</button>
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
      <More id="marker">
        <MarkerMore m={m} set={set} />
      </More>
    </>
  )
}

type SetMarker = (label: string, fn: (d: Marker) => void, merge?: string) => void

const OTHER = '\u0000other'

/** The weapon a pickup gives: one from the list, or any weapon ID typed in (Other…). */
function WeaponField({ m, set }: { m: Marker; set: SetMarker }) {
  const known = catalogs.weapons.some(([, id]) => id === m.weapon)
  const [other, setOther] = useState(!known)
  return (
    <Field label="Weapon" hint={other ? "The game's own weapon ID, as in its weapon tables" : undefined}>
      <select value={other ? OTHER : m.weapon} onChange={(e) => {
        if (e.target.value === OTHER) { setOther(true); return }
        setOther(false)
        set('Weapon', (d) => { d.weapon = e.target.value })
      }}>
        {catalogs.weapons.map(([n, id]) => <option key={id} value={id}>{n}</option>)}
        <option value={OTHER}>Other…</option>
      </select>
      {other && <input value={m.weapon} aria-label="Weapon ID" placeholder="e.g. ak47" onChange={(e) => set('Weapon', (d) => { d.weapon = e.target.value.trim() }, 'weapon')}
        onBlur={() => { if (!m.weapon) set('Weapon', (d) => { d.weapon = 'ak47' }) }} />}
    </Field>
  )
}

/** Every other marker field: all the marker types, exact position, triggers, NPCs. */
function MarkerMore({ m, set }: { m: Marker; set: SetMarker }) {
  const ws = useScale()
  // With "marker positions are game coordinates" on, a marker's position is already in game metres.
  const gameCoords = useEditor((s) => !!s.project?.settings.marker_game_coords)
  const [preview, setPreview] = useState('')
  const [run] = useBusy()
  const trig = TRIGGERS.has(m.type)
  return (
    <div className="section">
      <Field label="Every kind of marker">
        <select value={m.type} onChange={(e) => set('Marker type', (d) => { d.type = e.target.value })}>
          {m.type === PIMP_EXIT && <option value={PIMP_EXIT}>Pimp exit (not in the game, change this)</option>}
          {MARKER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Position (metres)"><MetresVec3 value={m.position} factor={gameCoords ? 1 : ws} onChange={(v) => set('Move marker', (d) => { d.position = v })} /></Field>
      <Field label="Facing (degrees)"><NumberInput value={m.yaw} step={15} digits={1} onChange={(v) => set('Rotate marker', (d) => { d.yaw = v })} /></Field>
      {m.type === 'Weapon pickup' && (
        <div className="form-grid">
          <Check checked={!!m.respawn_ms} title="Off: the game's own time for this weapon (15 s; a sniper rifle 20 s; an RPG 30 s)"
            onChange={(v) => set('Respawn time', (d) => { if (v) d.respawn_ms = pickupRespawnMs(d.weapon); else delete d.respawn_ms })}>
            Own time to come back
          </Check>
          {m.respawn_ms
            ? <Field label="Comes back after (s)"><NumberInput value={m.respawn_ms / 1000} step={5} digits={1} min={1} max={600} onChange={(v) => set('Respawn time', (d) => { d.respawn_ms = Math.round(v * 1000) }, 'respawn')} /></Field>
            : <span className="small faint">Comes back {pickupRespawnMs(m.weapon) / 1000} s after it's taken, as in the game.</span>}
        </div>
      )}
      {m.type !== 'Weapon pickup' && m.type !== 'Vehicle spawn' && (
        <Field label="Label or note"><input value={m.label} onChange={(e) => set('Label', (d) => { d.label = e.target.value }, 'label')} /></Field>
      )}
      {trig && (
        <div className="form-grid">
          <Field label="Trigger radius (m)"><NumberInput value={m.radius} step={0.1} min={0.05} max={1000} onChange={(v) => set('Radius', (d) => { d.radius = v })} /></Field>
          <Field label="Delay (ms)"><NumberInput value={m.delay_ms} step={1000} digits={0} min={0} onChange={(v) => set('Delay', (d) => { d.delay_ms = Math.round(v) })} /></Field>
          <Field label="Max fires (0 = no limit)"><NumberInput value={m.max_fires} step={1} digits={0} min={0} onChange={(v) => set('Max fires', (d) => { d.max_fires = Math.round(v) })} /></Field>
          <Check checked={m.disabled} onChange={(v) => set('Initially disabled', (d) => { d.disabled = v })}>Starts switched off</Check>
          {m.type === 'Sphere trigger (custom)' && <Field label="Trigger action"><input value={m.trigger_action} onChange={(e) => set('Trigger action', (d) => { d.trigger_action = e.target.value }, 'action')} /></Field>}
        </div>
      )}
      {m.type === 'Special spawn' && (
        <Field label="NPC activity">
          <input list="special" value={m.special_type} onChange={(e) => set('Activity', (d) => { d.special_type = e.target.value }, 'special')} />
          <datalist id="special">{catalogs.special_spawn_types.map((t) => <option key={t} value={t} />)}</datalist>
        </Field>
      )}
      {m.type === 'Human NPC spawn' && (
        <div className="form-grid">
          <Field label="Character">
            <input list="chars" value={m.char_type} onChange={(e) => set('Character', (d) => { d.char_type = e.target.value }, 'char')} />
            <datalist id="chars">{catalogs.human_char_types.map((t) => <option key={t} value={t} />)}</datalist>
          </Field>
          <Field label="Group"><input value={m.group} placeholder="e.g. gang_a" onChange={(e) => set('Group', (d) => { d.group = e.target.value }, 'group')} /></Field>
          <Field label="Leash distance (m)"><NumberInput value={m.leash_distance} step={1} min={0} max={10000} onChange={(v) => set('Leash', (d) => { d.leash_distance = v })} /></Field>
        </div>
      )}
      <div className="row wrap">
        <button className="sm" onClick={() => {
          const { project: p, lastItem } = useEditor.getState()
          const sel = p!.scene_items[lastItem]
          if (!sel) { toastError(new Error('Select an object first, then this marker.')); return }
          set('Marker from object', (d) => { d.position = [...sel.position] as Vec3; d.yaw = sel.rotation[1] })
        }} title="Copies the position and heading of the object you selected last">Move to the last object</button>
        <button className="sm" onClick={() => run(async () => {
          const p = useEditor.getState().project!
          await py.syncProject(p)
          const r = await py.sceneOp<{ xyz: Vec3; orient: number; origin: Vec3 }>('marker_preview', { marker: m, items: p.scene_items, world_scale: p.settings.world_scale, mirror_x: p.settings.mirror_x, marker_game_coords: p.settings.marker_game_coords })
          setPreview(`In-game XYZ <${r.xyz.map((v) => v.toFixed(3)).join(' ')}> · orient [${r.orient.toFixed(6)}] rad`)
        })}>Show game coordinates</button>
      </div>
      {preview && <span className="mono small muted">{preview}</span>}
    </div>
  )
}

// ---------------- a light ----------------

const toHex = (c: Vec3) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')
const fromHex = (h: string): Vec3 => [1, 3, 5].map((i) => +(parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4)) as Vec3
const LIGHT_PRESETS: [string, Vec3][] = [['Warm', [1, 0.85, 0.65]], ['White', [1, 1, 1]], ['Cool', [0.7, 0.85, 1]], ['Red', [1, 0.25, 0.2]], ['Purple', [0.8, 0.3, 1]], ['Green', [0.3, 1, 0.45]]]

function LightInspector({ l, index }: { l: Light; index: number }) {
  const update = useEditor((s) => s.update)
  const ws = useScale()
  const set = (label: string, fn: (d: Light) => void, merge?: string) => update(label, (d) => { fn(d.lights[index]) }, merge ? { merge: merge + thingKey('light', index) } : undefined)
  return (
    <>
      <div className="section">
        <Check checked={l.enabled} onChange={(v) => set('Toggle light', (d) => { d.enabled = v })}>On</Check>
        <Field label="Colour">
          <div className="row wrap">
            {LIGHT_PRESETS.map(([name, c]) => (
              <button key={name} className={'sm' + (toHex(c) === toHex(l.color) ? ' on' : '')} onClick={() => set('Light color', (d) => { d.color = c })}>
                <span className="swatch" style={{ background: toHex(c) }} />{name}
              </button>
            ))}
            <input type="color" value={toHex(l.color)} title="Any colour" aria-label="Any colour" onChange={(e) => set('Light color', (d) => { d.color = fromHex(e.target.value) }, 'color')} />
          </div>
        </Field>
        <Field label={`Brightness: ${l.intensity.toFixed(1)}`}>
          <input type="range" min={0} max={10} step={0.1} value={l.intensity} onChange={(e) => set('Brightness', (d) => { d.intensity = +e.target.value }, 'intensity')} />
        </Field>
        <Field label={`Reach: ${fmtM(toMetres(l.range, ws))}`} hint="How far the light spreads">
          <input type="range" min={1} max={60} step={1} value={l.range} onChange={(e) => set('Reach', (d) => {
            d.range = +e.target.value
            if (d.inner_range >= d.range) d.inner_range = +(d.range * 0.4).toFixed(2)
          }, 'range')} />
        </Field>
        <div className="row"><span className="spacer" /><button className="sm danger" onClick={act.removeSelected}>Delete</button></div>
      </div>
      <More id="light">
        <div className="section">
          <Field label="Name"><input value={l.name} maxLength={80} onChange={(e) => set('Rename light', (d) => { d.name = e.target.value }, 'lname')} /></Field>
          <Field label="Position (metres)"><MetresVec3 value={l.position} factor={ws} onChange={(v) => set('Move light', (d) => { d.position = v })} /></Field>
          <div className="form-grid">
            <Field label="Fully bright to (m)"><NumberInput value={toMetres(l.inner_range, ws)} digits={2} step={0.25} min={0} max={toMetres(1000, ws)} onChange={(v) => set('Inner range', (d) => { d.inner_range = toUnits(v, ws) })} /></Field>
            <Field label="Dark at (m)"><NumberInput value={toMetres(l.range, ws)} digits={2} step={0.25} min={0.01} max={toMetres(1000, ws)} onChange={(v) => set('Range', (d) => { d.range = toUnits(v, ws) })} /></Field>
          </div>
          <span className="faint small">The game's own lights: rooms 1 m / 3 m, street lamps 11 m / 17 m. Up to {catalogs.limits.max_lights} lights per map.</span>
          {l.inner_range >= l.range && <span className="small bad">"Fully bright to" must be less than "Dark at".</span>}
        </div>
      </More>
    </>
  )
}

// ---------------- a prefab's settings ----------------

/** Size, floors, style, colour... of a placed prefab; it rebuilds in place as they change. */
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
    <div className="section">
      <div className="row between"><span className="section-title">{def.label} settings</span>{busy && <span className="faint small">Rebuilding…</span>}</div>
      {params.filter((d) => d.kind === 'text').map((d) => (
        <Field key={d.key} label={d.label} hint={d.hint}>
          <textarea rows={2} maxLength={80} value={String(values[d.key])} onChange={(e) => change(d.key, e.target.value)} />
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
                    <input type="color" value={String(values[d.key] || d.auto?.(values) || '#808080')} onChange={(e) => change(d.key, e.target.value)} />
                    {values[d.key] ? <button className="sm" title="Use the style's own colour" onClick={(e) => { e.preventDefault(); change(d.key, '') }}>Reset</button> : <span className="faint small">Style's</span>}
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
