import { useEffect, useState } from 'react'
import { thingKey, useEditor } from '../store'
import * as act from '../actions'
import { getViewer } from '../Viewport'
import { Check, Field, FileButton, NumberInput, Vec3Input, infoDialog, useBusy } from '../../ui'
import { catalogs } from '../../lib/catalogs'
import { py } from '../../lib/py'
import { db } from '../../lib/db'
import { PIMP_EXIT, SPAWN_TYPES, baseName, type Marker, type Vec3 } from '../../lib/project'
import { RETAIL_MARKER_TYPES } from '../../lib/retailModes'
import { pickupRespawnMs } from '../../lib/player'
import { RetailMarkerFields } from '../RetailMarkerFields'
import { VehiclePicker } from '../VehiclePicker'

const TRIGGERS = new Set(catalogs.trigger_kinds)
const MARKER_TYPES = [...catalogs.marker_types, ...RETAIL_MARKER_TYPES]

export function MarkersPanel() {
  const project = useEditor((s) => s.project)!
  const selection = useEditor((s) => s.selection)
  const placeMode = useEditor((s) => s.placeMode)
  const type = useEditor((s) => s.placeMarkerType)
  const [run] = useBusy()
  const markers = project.markers
  const index = selection?.kind === 'marker' ? selection.index : -1
  const m = markers[index]
  const spawns = markers.filter((x) => SPAWN_TYPES.includes(x.type)).length

  return (
    <>
      <div className="group">
        <span className="section-title">Spawns &amp; gameplay markers</span>
        <div className="row">
          <select className="grow" value={type} onChange={(e) => useEditor.getState().set({ placeMarkerType: e.target.value })}>
            {MARKER_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <button className={placeMode === 'marker' ? 'on' : 'primary'} disabled={!project.scene_items.length} onClick={() => useEditor.getState().set({ placeMode: placeMode === 'marker' ? null : 'marker' })}>
            {placeMode === 'marker' ? 'Click the map…' : '◎ Place on map'}
          </button>
          <button onClick={() => act.addMarker(type, (getViewer()?.center() ?? [0, 0, 0]) as Vec3)} title="Add at the camera target">+</button>
        </div>
        <div className="list">
          {markers.map((x, i) => (
            <div key={x.uid} className={'list-item' + (i === index ? ' selected' : '')} onClick={() => useEditor.getState().select({ kind: 'marker', index: i })}>
              <span className="faint mono">{String(i + 1).padStart(2, '0')}</span>
              <span className="grow">{x.type}{x.label ? <span className="faint"> · {x.label}</span> : null}</span>
              {x.type === PIMP_EXIT && <span className="tag-warn" title="The game has no pimp exit action; change the type or remove it">unsupported</span>}
              <span className="meta mono">{x.position.map((v) => v.toFixed(1)).join(', ')}</span>
            </div>
          ))}
          {!markers.length && <div className="list-item faint">No markers. Exports need at least one spawn.</div>}
        </div>
        <div className="row wrap">
          <span className={'small ' + (spawns ? 'ok' : 'bad')}>{spawns} spawn{spawns === 1 ? '' : 's'}</span>
          <span className="spacer" />
          <button className="sm" onClick={() => run(async () => infoDialog('Marker check', (await py.sceneOp<string[]>('validate_markers', { markers })).join('\n')))}>Check markers</button>
        </div>
      </div>
      {m && <MarkerEditor key={m.uid} m={m} index={index} />}
      <CtsSettings />
    </>
  )
}

function MarkerEditor({ m, index }: { m: Marker; index: number }) {
  const update = useEditor((s) => s.update)
  const [preview, setPreview] = useState('')
  const [run] = useBusy()
  const set = (label: string, fn: (d: Marker) => void, merge?: string) => update(label, (d) => {
    const x = d.markers[index]
    fn(x)
    if (x.type === 'Weapon pickup') x.label = x.weapon
    if (x.type === 'Vehicle spawn') x.label = x.vehicle
  }, merge ? { merge: merge + thingKey('marker', index) } : undefined)
  const trig = TRIGGERS.has(m.type)
  return (
    <div className="group">
      <div className="row between"><span className="section-title">Selected marker</span><button className="sm danger" onClick={act.removeSelected}>Remove</button></div>
      <Field label="Type">
        <select value={m.type} onChange={(e) => set('Marker type', (d) => { d.type = e.target.value })}>
          {m.type === PIMP_EXIT && <option value={PIMP_EXIT}>Pimp exit (not in the game, change this)</option>}
          {MARKER_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Position"><Vec3Input value={m.position} onChange={(v) => set('Move marker', (d) => { d.position = v })} /></Field>
      <Field label="Facing (yaw °)"><NumberInput value={m.yaw} step={15} digits={1} onChange={(v) => set('Rotate marker', (d) => { d.yaw = v })} /></Field>
      {m.type === 'Weapon pickup' && (
        <Field label="Weapon" hint="CTS always receives the internal ID.">
          <input list="weapons" value={m.weapon} onChange={(e) => set('Weapon', (d) => { d.weapon = e.target.value.split(' — ').pop()!.trim() || 'ak47' }, 'weapon')} />
          <datalist id="weapons">{catalogs.weapons.map(([n, id]) => <option key={id} value={id}>{n}</option>)}</datalist>
        </Field>
      )}
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
      {m.type === 'Vehicle spawn' && (
        <Field label="Vehicle" hint="Choose a vehicle or type a custom game ID.">
          <VehiclePicker value={m.vehicle} onChange={(id) => set('Vehicle', (d) => { d.vehicle = id.trim() || 'car_2dr_sports03' })} />
        </Field>
      )}
      {m.type !== 'Weapon pickup' && m.type !== 'Vehicle spawn' && (
        <Field label="Label / note"><input value={m.label} onChange={(e) => set('Label', (d) => { d.label = e.target.value }, 'label')} /></Field>
      )}
      {trig && (
        <div className="form-grid">
          <Field label="Trigger radius"><NumberInput value={m.radius} step={0.1} min={0.05} max={1000} onChange={(v) => set('Radius', (d) => { d.radius = v })} /></Field>
          <Field label="Delay (ms)"><NumberInput value={m.delay_ms} step={1000} digits={0} min={0} onChange={(v) => set('Delay', (d) => { d.delay_ms = Math.round(v) })} /></Field>
          <Field label="Max fires (0 = unlimited)"><NumberInput value={m.max_fires} step={1} digits={0} min={0} onChange={(v) => set('Max fires', (d) => { d.max_fires = Math.round(v) })} /></Field>
          <Check checked={m.disabled} onChange={(v) => set('Initially disabled', (d) => { d.disabled = v })}>Initially disabled</Check>
          {m.type === 'Sphere trigger (custom)' && <Field label="Trigger action"><input value={m.trigger_action} onChange={(e) => set('Trigger action', (d) => { d.trigger_action = e.target.value }, 'action')} /></Field>}
        </div>
      )}
      <RetailMarkerFields m={m} index={index} set={set} />
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
          <Field label="Leash distance"><NumberInput value={m.leash_distance} step={1} min={0} max={10000} onChange={(v) => set('Leash', (d) => { d.leash_distance = v })} /></Field>
        </div>
      )}
      <div className="row wrap">
        <button className="sm" onClick={() => {
          const y = getViewer()?.surfaceBelow(m.position[0], m.position[1], m.position[2])
          if (y == null) { useEditor.getState().log('No terrain triangle directly below marker'); return }
          set('Snap marker', (d) => { d.position = [m.position[0], y + 0.12, m.position[2]] })
        }}>↓ Snap to surface</button>
        <button className="sm" onClick={() => {
          const { project: p, lastItem } = useEditor.getState()
          const sel = p!.scene_items[lastItem]
          if (!sel) { useEditor.getState().log('Select a scene object first, then select the marker.'); return }
          set('Marker from object', (d) => { d.position = [...sel.position] as Vec3; d.yaw = sel.rotation[1] })
        }} title="Copies the position and heading of the object you selected last">Use selected object</button>
        <button className="sm" onClick={() => run(async () => {
          const p = useEditor.getState().project!
          await py.syncProject(p)
          const r = await py.sceneOp<{ xyz: Vec3; orient: number; origin: Vec3 }>('marker_preview', { marker: m, items: p.scene_items, world_scale: p.settings.world_scale, mirror_x: p.settings.mirror_x, marker_game_coords: p.settings.marker_game_coords })
          setPreview(`In-game XYZ <${r.xyz.map((v) => v.toFixed(3)).join(' ')}> · orient [${r.orient.toFixed(6)}] rad`)
        })}>Preview game XYZ</button>
      </div>
      {preview && <span className="mono small muted">{preview}</span>}
    </div>
  )
}

function CtsSettings() {
  const s = useEditor((st) => st.project!.settings)
  const update = useEditor((st) => st.update)
  const [templates, setTemplates] = useState<string[]>([])
  useEffect(() => { db.listDataPack().then((p) => setTemplates(p.filter((x) => x.startsWith('cts_examples/')))) }, [])
  const own = s.cts_template && !s.cts_template.startsWith('/studio/')
  return (
    <div className="group">
      <span className="section-title">Spawn table (CTS)</span>
      <Check checked={s.marker_game_coords} onChange={(v) => update('Marker coordinates', (d) => { d.settings.marker_game_coords = v })}>Marker XYZ are already SR1 game coordinates</Check>
      <Field label="Template" hint="Optional. New markers are appended to a copy; other gameplay content stays intact. Blank uses the exporter's default.">
        <select value={own ? 'own' : s.cts_template} onChange={(e) => { if (e.target.value !== 'own') update('CTS template', (d) => { d.settings.cts_template = e.target.value }) }}>
          <option value="">Default (none)</option>
          {templates.map((t) => <option key={t} value={'/studio/' + t}>{baseName(t)} (data pack)</option>)}
          {own && <option value="own">{baseName(s.cts_template)} (your file)</option>}
        </select>
      </Field>
      <FileButton className="sm" accept=".cts" onFiles={([f]) => act.setProjectFile('cts_template', f)}>Use a CTS from my game…</FileButton>
      <p className="faint small">Scene XYZ are centered and grounded exactly like the exported map. Facing still needs in-game confirmation.</p>
    </div>
  )
}
