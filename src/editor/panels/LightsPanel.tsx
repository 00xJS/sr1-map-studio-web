import { useEditor } from '../store'
import * as act from '../actions'
import { getViewer } from '../Viewport'
import { Check, Field, NumberInput, Vec3Input, toastError } from '../../ui'
import { catalogs } from '../../lib/catalogs'
import type { Light, Vec3 } from '../../lib/project'

const toHex = (c: Vec3) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')
const fromHex = (h: string): Vec3 => [1, 3, 5].map((i) => +(parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4)) as Vec3

export function LightsPanel() {
  const project = useEditor((s) => s.project)!
  const selection = useEditor((s) => s.selection)
  const placeMode = useEditor((s) => s.placeMode)
  const index = selection?.kind === 'light' ? selection.index : -1
  const l = project.lights[index]
  return (
    <>
      <div className="group">
        <span className="section-title">Point lights</span>
        <div className="row">
          <button className={placeMode === 'light' ? 'on' : 'primary'} disabled={!project.scene_items.length} onClick={() => useEditor.getState().set({ placeMode: placeMode === 'light' ? null : 'light' })}>
            {placeMode === 'light' ? 'Click the map…' : '◎ Place on map'}
          </button>
          <button onClick={() => { try { const c = getViewer()?.center() ?? [0, 0, 0]; act.addLight([c[0], c[1] + 3, c[2]]) } catch (e) { toastError(e) } }}>+ At view center</button>
        </div>
        <div className="list">
          {project.lights.map((x, i) => (
            <div key={x.uid} className={'list-item' + (i === index ? ' selected' : '')} onClick={() => useEditor.getState().select({ kind: 'light', index: i })}>
              <span className="swatch" style={{ background: toHex(x.color), opacity: x.enabled ? 1 : 0.35 }} />
              <span className="grow">{x.name}</span>
              <span className="meta">{+(x.range * project.settings.world_scale).toFixed(1)} m</span>
            </div>
          ))}
          {!project.lights.length && <div className="list-item faint">No lights.</div>}
        </div>
        <p className="faint small">Native SR1 point lights are embedded in the map. Up to {catalogs.limits.max_lights} per map; first gameplay test pending.</p>
      </div>
      {l && <LightEditor key={l.uid} l={l} index={index} />}
    </>
  )
}

function LightEditor({ l, index }: { l: Light; index: number }) {
  const update = useEditor((s) => s.update)
  const scale = useEditor((s) => s.project!.settings.world_scale)
  const m = (v: number) => +(v * scale).toFixed(1)
  const set = (label: string, fn: (d: Light) => void, merge?: string) => update(label, (d) => { fn(d.lights[index]) }, merge ? { merge: merge + index } : undefined)
  return (
    <div className="group">
      <div className="row between"><span className="section-title">Selected light</span><button className="sm danger" onClick={act.removeSelected}>Remove</button></div>
      <Field label="Name"><input value={l.name} maxLength={80} onChange={(e) => set('Rename light', (d) => { d.name = e.target.value }, 'lname')} /></Field>
      <Check checked={l.enabled} onChange={(v) => set('Toggle light', (d) => { d.enabled = v })}>Enabled</Check>
      <Field label="Position"><Vec3Input value={l.position} onChange={(v) => set('Move light', (d) => { d.position = v })} /></Field>
      <div className="form-grid">
        <Field label="Color"><input type="color" value={toHex(l.color)} onChange={(e) => set('Light color', (d) => { d.color = fromHex(e.target.value) }, 'color')} /></Field>
        <Field label="Intensity (0–10)"><NumberInput value={l.intensity} step={0.1} min={0} max={10} onChange={(v) => set('Intensity', (d) => { d.intensity = v })} /></Field>
        <Field label="Full-bright range"><NumberInput value={l.inner_range} step={0.5} min={0} max={1000} onChange={(v) => set('Inner range', (d) => { d.inner_range = v })} /></Field>
        <Field label="Outer range"><NumberInput value={l.range} step={0.5} min={0.01} max={1000} onChange={(v) => set('Range', (d) => { d.range = v })} /></Field>
      </div>
      <span className="faint small">In game: full bright to {m(l.inner_range)} m, dark at {m(l.range)} m (the game's own: rooms 1 / 3 m, street lamps 11 / 17 m).</span>
      {l.inner_range >= l.range && <span className="small bad">Full-bright range must be smaller than the outer range.</span>}
    </div>
  )
}
