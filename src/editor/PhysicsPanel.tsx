// "Make it a physics prop": the simple-mode panel for one or more selected
// objects. Pick a behaviour (light crate, heavy, rolls, explodes, breaks...),
// then the collision shape; the limits are shown as you go.
import { useEffect, useState } from 'react'
import { useEditor } from './store'
import * as act from './actions'
import { makePhysicsProps, setBottomHeavy, setPhysicsShape } from './physicsActions'
import { Check, Field, Status, useBusy } from '../ui'
import { statusSentence } from '../lib/featureStatus'
import { isCustomNative, isGlass, isProp, type SceneItem } from '../lib/project'
import { LIBRARY_PRESETS, OBJECT_BUDGET, PHYSICS_PRESETS, PHYSICS_SHAPES, countPhysics, presetOf, shapeOf, type PhysicsPreset, type PhysicsShape } from '../lib/physicsProps'
import { loadPropLibrary } from '../lib/propLibrary'

/** The first presets shown as buttons; the rest are in the list. */
const QUICK = ['light_crate', 'heavy', 'rolls', 'ball', 'explodes', 'breaks']

/** The stock objects of v1.15's library in this browser's data pack (none with a v1.13 pack). */
function useLibraryPresets(): PhysicsPreset[] {
  const [list, setList] = useState(() => LIBRARY_PRESETS.slice())
  useEffect(() => { let live = true; loadPropLibrary().then((l) => { if (live) setList(l) }); return () => { live = false } }, [])
  return list
}

const LibraryOptions = ({ presets }: { presets: PhysicsPreset[] }) => presets.length ? (
  <optgroup label="Stock objects (v1.15 package)">
    {presets.map((p) => <option key={p.key} value={p.key} title={p.hint}>{p.label}</option>)}
  </optgroup>
) : null

function Limits() {
  const project = useEditor((s) => s.project)!
  const c = countPhysics(project)
  return (
    <>
      <span className="faint small">
        Physics objects in this map: {c.objects} of {OBJECT_BUDGET} (props, breakables and glass together), {c.models} different model{c.models === 1 ? '' : 's'}. Copies of one model are cheapest. Each prop needs one material with a picture.
      </span>
      {c.warnings.map((w) => <span key={w} className="small warn">{w}</span>)}
    </>
  )
}

export function PhysicsPanel({ indices }: { indices: number[] }) {
  const project = useEditor((s) => s.project)!
  const [run, busy] = useBusy()
  const items = indices.map((i) => project.scene_items[i]).filter(Boolean)
  if (!items.length || indices.includes(0)) return null
  if (items.some((it) => isGlass(it) && !isCustomNative(it))) return null
  const physical = items.filter((it) => presetOf(it))
  const one = items.length === 1 ? items[0] : null
  const library = useLibraryPresets()
  const preset = one ? presetOf(one) : null
  const apply = (key: string) => run(() => makePhysicsProps(indices, key))
  return (
    <div className="group">
      <span className="section-title">Physics prop <Status id="physics_props" /></span>
      {!preset && (
        <>
          <span className="small muted">
            {items.length > 1 ? `Make these ${items.length} objects` : 'Make it'} a loose object with weight: it falls, tumbles, gets shoved, shot and blown up, in the walk-through and in game.
          </span>
          <div className="row wrap">
            {QUICK.map((k) => {
              const p = PHYSICS_PRESETS.find((x) => x.key === k)!
              return <button key={k} className="sm" disabled={busy} title={p.hint} onClick={() => apply(k)}>{p.label}</button>
            })}
            <select className="sm" value="" disabled={busy} onChange={(e) => e.target.value && apply(e.target.value)}>
              <option value="">More…</option>
              {PHYSICS_PRESETS.filter((p) => !QUICK.includes(p.key)).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              <LibraryOptions presets={library} />
            </select>
          </div>
          {physical.length > 0 && <span className="faint small">{physical.length} of these {physical.length === 1 ? 'is' : 'are'} already physics props.</span>}
        </>
      )}
      {preset && one && <PropSettings it={one} index={indices[0]} library={library} />}
      <Limits />
    </div>
  )
}

function PropSettings({ it, index, library }: { it: SceneItem; index: number; library: PhysicsPreset[] }) {
  const [run, busy] = useBusy()
  const preset = presetOf(it)!
  const shape = shapeOf(it)
  return (
    <>
      <Field label="Behaviour" hint={preset.hint}>
        <select value={preset.key} disabled={busy} onChange={(e) => run(() => makePhysicsProps([index], e.target.value))}>
          {PHYSICS_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          <LibraryOptions presets={library} />
          {!library.some((p) => p.key === preset.key) && !PHYSICS_PRESETS.includes(preset) && <option value={preset.key}>{preset.label}</option>}
        </select>
      </Field>
      <Field label="Collision shape" hint={PHYSICS_SHAPES.find((s) => s.key === shape)?.hint}>
        <select value={shape} onChange={(e) => setPhysicsShape(index, e.target.value as PhysicsShape)}>
          {PHYSICS_SHAPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </Field>
      <Check checked={!!it.physics_bottom_heavy} onChange={(v) => setBottomHeavy(index, v)}>
        <span className="col" style={{ gap: 0 }}><span>Bottom-heavy</span><span className="faint small">Weight sits low, so it rocks back upright like a punching bag.</span></span>
      </Check>
      <div className="row wrap">
        <button className="sm primary" onClick={() => useEditor.getState().set({ walking: true, selection: null, multi: [] })} title="Walk the map: shoot props (click), blast them (G), kick them (F)">▶ Try it</button>
        {isProp(it) && <button className="sm" disabled={busy} onClick={() => run(() => act.returnStatic(index))}>Back to a normal object</button>}
      </div>
      <span className="faint small">
        In game, weight, bounce and health come with the behaviour (the game's own object table: a map can't set its own numbers); the exporter fits the shape to your model.{statusSentence('physics_props')} The walk-through shows a rough preview.
      </span>
    </>
  )
}
