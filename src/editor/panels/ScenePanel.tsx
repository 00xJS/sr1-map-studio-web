import { useEffect, useState } from 'react'
import { useEditor } from '../store'
import * as act from '../actions'
import { Check, Field, FileButton, NumberInput, Vec3Input, confirmDialog, infoDialog, toastError, useBusy } from '../../ui'
import { catalogs } from '../../lib/catalogs'
import { isCustomNative, isGlass, isProp, type SceneItem, type Vec3 } from '../../lib/project'
import { loadModel } from '../../lib/assets'
import { getViewer } from '../Viewport'

const STEPS = [['Fine', 0.05], ['Normal', 0.5], ['Coarse', 5]] as const
const MODEL_ACCEPT = '.obj,.mtl,.glb,.gltf,.fbx,.bin,.png,.jpg,.jpeg,.tga,.bmp,.dds,.tif,.tiff'

function nativeTag(it: SceneItem) {
  if (isProp(it)) return catalogs.prop_presets[it.native_prop_behavior!]?.label ?? 'Native prop'
  if (isCustomNative(it)) return it.native_breakable_kind === 'wood' ? 'Breakable wood' : 'Breakable'
  if (isGlass(it)) return 'Glass'
  return null
}

export function ScenePanel() {
  const project = useEditor((s) => s.project)!
  const selection = useEditor((s) => s.selection)
  const step = useEditor((s) => s.step)
  const [run, busy] = useBusy()
  const items = project.scene_items
  const index = selection?.kind === 'item' ? selection.index : -1
  const it = items[index]

  return (
    <>
      <div className="group">
        <div className="row between">
          <span className="section-title">Objects</span>
          <div className="row">
            <FileButton className="sm" multiple accept={MODEL_ACCEPT} onFiles={(f) => run(async () => {
              if (items.length && !(await confirmDialog('Replace the base map?', 'This replaces every object in the scene with the new base map. You can undo this.', { confirm: 'Replace' }))) return
              await act.importModelFiles(f, 'base')
            })}>Open base map</FileButton>
            <FileButton className="sm primary" multiple accept={MODEL_ACCEPT} disabled={!items.length} onFiles={(f) => run(() => act.importModelFiles(f, 'add'))}>+ Add model</FileButton>
          </div>
        </div>
        <div className="list" role="listbox">
          {items.map((x, i) => (
            <div key={x.uid} className={'list-item' + (i === index ? ' selected' : '')} onClick={() => useEditor.getState().select({ kind: 'item', index: i })}>
              <span className="faint mono">{String(i).padStart(2, '0')}</span>
              <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span>
              {i === 0 && <span className="chip">base</span>}
              {nativeTag(x) && <span className="tag-native">{nativeTag(x)}</span>}
              {x.collision_disabled && <span className="tag-warn">no collision</span>}
            </div>
          ))}
          {!items.length && <div className="list-item faint">No objects yet. Open a base map to begin.</div>}
        </div>
        <p className="faint small">{busy ? 'Importing…' : 'Select an OBJ together with its MTL and textures, or a GLB/glTF/FBX. You can also drop files on the viewport.'}</p>
      </div>
      {it && <ObjectEditor key={it.uid} it={it} index={index} step={step} />}
      <div className="row wrap">
        <button className="sm" onClick={() => run(async () => infoDialog('Scene audit', <pre>{await act.sceneAudit()}</pre>))}>Audit scene</button>
        <button className="sm" onClick={() => run(async () => infoDialog('Check breakables', <pre>{await act.checkBreakables()}</pre>))}>Check breakables</button>
      </div>
    </>
  )
}

function ObjectEditor({ it, index, step }: { it: SceneItem; index: number; step: number }) {
  const update = useEditor((s) => s.update)
  const [run] = useBusy()
  const fixedGlass = isGlass(it) && !isCustomNative(it)
  const native = isGlass(it)
  const set = (label: string, fn: (d: SceneItem) => void, merge?: string) =>
    update(label, (d) => { fn(d.scene_items[index] as SceneItem) }, merge ? { merge: merge + index } : undefined)

  return (
    <>
      <div className="group">
        <div className="row between"><span className="section-title">Transform</span>
          <div className="btn-group">
            {STEPS.map(([label, v]) => <button key={label} className={'sm' + (step === v ? ' on' : '')} onClick={() => useEditor.getState().set({ step: v })}>{label}</button>)}
          </div>
        </div>
        <Field label="Name"><input value={it.name} onChange={(e) => set('Rename', (d) => { d.name = e.target.value }, 'name')} /></Field>
        <Field label="Position"><Vec3Input value={it.position} step={step} onChange={(v) => set('Move', (d) => { d.position = v })} /></Field>
        <Field label="Rotation (degrees) — X pitch, Y heading, Z roll"><Vec3Input value={it.rotation} step={step < 1 ? 5 : 15} onChange={(v) => set('Rotate', (d) => { d.rotation = v })} /></Field>
        <div className="row">
          <Field label="Scale"><NumberInput value={it.scale} step={0.1} min={0.001} max={10000} disabled={fixedGlass} onChange={(v) => set('Scale', (d) => { d.scale = v })} /></Field>
          <div className="grow" />
        </div>
        <PivotControls it={it} index={index} />
        <div className="row wrap">
          <button className="sm" onClick={() => run(async () => act.duplicateItem(index))}>Duplicate</button>
          <button className="sm" onClick={() => run(() => act.groundItem(index))}>Ground Y=0</button>
          <button className="sm" onClick={() => getViewer()?.focusSelection()} title="Focus the camera (F)">Focus</button>
          <span className="spacer" />
          <button className="sm" disabled={index === 0} onClick={() => act.moveItem(index, index - 1)} title="Move up">↑</button>
          <button className="sm" disabled={index === useEditor.getState().project!.scene_items.length - 1} onClick={() => act.moveItem(index, index + 1)} title="Move down">↓</button>
          <button className="sm danger" onClick={() => act.removeItem(index)}>Remove</button>
        </div>
      </div>

      {!native && (
        <div className="group">
          <span className="section-title">Collision &amp; rendering</span>
          <Check checked={!!it.double_sided} onChange={(v) => set('Two-sided', (d) => { d.double_sided = v })}>Show both sides of this object (export)</Check>
          <Check checked={!it.collision_disabled} onChange={(v) => set('Collision', (d) => { d.collision_disabled = !v })}>Solid collision for this object</Check>
          <CollisionFaces it={it} index={index} />
        </div>
      )}

      {index > 0 && <NativeControls it={it} index={index} />}

      {!native && (
        <Field label="Physics intent (planning note only)" hint="Legacy annotation. Use Movable & explosive props above to create real native objects.">
          <select value={it.physics_intent || 'Static'} onChange={(e) => set('Physics intent', (d) => { d.physics_intent = e.target.value })}>
            {['Static', 'No collision', 'Movable (planned)', 'Destructible (planned)', 'Explosive (planned)'].map((o) => <option key={o}>{o}</option>)}
          </select>
        </Field>
      )}
    </>
  )
}

function PivotControls({ it, index }: { it: SceneItem; index: number }) {
  const [custom, setCustom] = useState<Vec3>(it.pivot || [0, 0, 0])
  const [open, setOpen] = useState(false)
  useEffect(() => setCustom(it.pivot || [0, 0, 0]), [it.pivot])
  const [run] = useBusy()
  return (
    <div className="col">
      <div className="row wrap">
        <span className="small muted">Pivot</span>
        <button className="sm" onClick={() => run(() => act.setPivot(index, 'center'))} title="The object stays in place; rotation and scaling use the new center.">Center on mesh</button>
        <button className="sm" onClick={() => run(() => act.setPivot(index, 'bottom'))}>Bottom center</button>
        <button className="sm" onClick={() => run(() => act.setPivot(index, 'reset'))}>Reset</button>
        <button className={'sm' + (open ? ' on' : '')} onClick={() => setOpen(!open)}>Custom…</button>
      </div>
      {open && (
        <div className="row">
          <div className="grow"><Vec3Input value={custom} step={0.1} onChange={setCustom} /></div>
          <button className="sm" onClick={() => run(() => act.setPivot(index, custom))}>Apply</button>
        </div>
      )}
      {it.pivot && it.pivot.some((v) => v) && <span className="faint small">Local pivot: {it.pivot.map((v) => +v.toFixed(4)).join(', ')}</span>}
    </div>
  )
}

function CollisionFaces({ it, index }: { it: SceneItem; index: number }) {
  const faceRange = useEditor((s) => s.faceRange)
  const placeMode = useEditor((s) => s.placeMode)
  const collisionView = useEditor((s) => s.collisionView)
  const update = useEditor((s) => s.update)
  const [count, setCount] = useState(0)
  const project = useEditor((s) => s.project)
  useEffect(() => { loadModel(project, it.path).then((m) => setCount(m.faces.length / 3)).catch(() => setCount(0)) }, [it.path])
  const excluded = it.collision_excluded_faces || []
  const [a, b] = [Math.min(...faceRange), Math.max(...faceRange)]
  const edit = (exclude: boolean) => {
    if (a >= count || b >= count) { toastError(new Error(`Valid triangle IDs: 0 to ${Math.max(0, count - 1)}.`)); return }
    update(exclude ? 'Exclude collision faces' : 'Restore collision faces', (d) => {
      const cur = new Set(d.scene_items[index].collision_excluded_faces || [])
      for (let f = a; f <= b; f++) exclude ? cur.add(f) : cur.delete(f)
      d.scene_items[index].collision_excluded_faces = [...cur].sort((x, y) => x - y)
    })
    useEditor.getState().log(`${exclude ? 'Excluded' : 'Restored'} collision for ${b - a + 1} source triangles on ${it.name}.`)
  }
  return (
    <div className="col">
      <div className="row wrap">
        <span className="small muted">Face collision editor</span>
        <button className={'sm' + (collisionView === 'faces' ? ' on' : '')} onClick={() => useEditor.getState().set({ collisionView: collisionView === 'faces' ? 'off' : 'faces' })}>Show collision</button>
        <button className={'sm' + (placeMode === 'face' ? ' on' : '')} onClick={() => useEditor.getState().set({ placeMode: placeMode === 'face' ? null : 'face', collisionView: 'faces' })}>Pick face in 3D</button>
      </div>
      <div className="row">
        <Field label="First"><NumberInput value={faceRange[0]} step={1} digits={0} min={0} onChange={(v) => useEditor.getState().set({ faceRange: [Math.round(v), faceRange[1]] })} /></Field>
        <Field label="Last"><NumberInput value={faceRange[1]} step={1} digits={0} min={0} onChange={(v) => useEditor.getState().set({ faceRange: [faceRange[0], Math.round(v)] })} /></Field>
      </div>
      <div className="row">
        <button className="sm" onClick={() => edit(true)}>Exclude range</button>
        <button className="sm" onClick={() => edit(false)}>Restore range</button>
      </div>
      <span className="faint small">{count.toLocaleString()} source triangles; {excluded.length} excluded from Havok collision. Green = solid, red = excluded, orange = selected range. Excluded faces stay visible.</span>
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
    <div className="group">
      <span className="section-title">Movable &amp; explosive props</span>
      <div className="row">
        <select className="grow" value={behavior} onChange={(e) => setBehavior(e.target.value as any)}>
          {Object.entries(catalogs.prop_presets).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
        </select>
        <button className="sm" disabled={busy || (glass && !custom)} onClick={() => run(() => act.applyNativeProp(index, behavior))}>Apply</button>
      </div>
      <p className="faint small">{catalogs.prop_presets[behavior]?.description} Keeps your mesh and texture. One material, 1–{lim.max_native_triangles.toLocaleString()} triangles, {lim.min_native_axis}–{lim.max_native_axis} game units per axis. Up to {lim.max_native_objects} native props and glass panes combined.</p>
      <span className="section-title">Breakables (experimental)</span>
      <div className="row wrap">
        <button className="sm" disabled={busy || (glass && !custom)} onClick={() => run(async () => {
          if (!custom && !(await confirmDialog('Experimental breakable glass', 'Your mesh, position, rotation and size are kept. The exporter generates an experimental fitted Havok box hull. This is structurally tested, not verified in game. Back up your map and test in a private match.', { confirm: 'Convert' }))) return
          await act.convertBreakable(index, 'glass')
        })}>Breakable glass</button>
        <button className="sm" disabled={busy || (glass && !custom)} onClick={() => run(async () => {
          if (!custom && !(await confirmDialog('Experimental breakable wood', 'Wood uses a solid scenery shader, the _wo texture suffix and GLASS shatter/damage (experimental). The fitted Havok box is not verified in game.', { confirm: 'Convert' }))) return
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
      {glass && !custom && <p className="faint small">Native pane: {catalogs.glass_size.map((v) => v.toFixed(2)).join(' × ')} game units with its own collision and shatter effect. Size is fixed.</p>}
    </div>
  )
}
