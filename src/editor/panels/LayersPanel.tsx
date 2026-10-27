// The Layers panel: the map's objects in named layers (lib/layers.ts), each one shown or hidden like a paint
// program's layers, shown on its own, selected, renamed, reordered or deleted; the selection moved into a layer;
// and "Sort into layers" to put every object in a layer by what it is called.
import { useEffect, useState } from 'react'
import { useEditor } from '../store'
import { Check, Field, toast } from '../../ui'
import { NO_LAYER, layerList, layerOf } from '../../lib/layers'
import * as L from '../layerActions'

export function LayersPanel({ compact = false }: { compact?: boolean }) {
  const project = useEditor((s) => s.project)!
  useEditor((s) => s.selection)
  useEditor((s) => s.multi)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [target, setTarget] = useState('')
  const layers = layerList(project)
  const named = layers.filter((l) => l.name)
  const chosen = L.selectedItems()
  const hiddenCount = layers.filter((l) => l.hidden).reduce((a, l) => a + l.count, 0)
  const unsorted = project.scene_items.filter((it) => !layerOf(it)).length

  const sort = (all: boolean) => {
    const n = L.sortIntoLayers(all)
    toast(n ? `${n} object${n === 1 ? '' : 's'} put in layers by what they are called.` : 'Every object is already in its layer.')
  }
  const finish = (from: string) => { L.rename(from, draft); setEditing(null) }

  return (
    <div className="group layers">
      <div className="row between">
        <span className="section-title">Layers</span>
        <div className="row">
          {hiddenCount > 0 && <button className="sm quiet" onClick={L.showAll} title="Show every layer">Show all</button>}
          <button className="sm" disabled={!project.scene_items.length} onClick={() => sort(false)}
            title={unsorted ? `Put the ${unsorted} object${unsorted === 1 ? '' : 's'} in no layer into layers by name (every house in a House layer)` : 'Every object is in a layer'}>
            Sort into layers
          </button>
        </div>
      </div>
      {!layers.length && <span className="faint small">No objects yet.</span>}
      <div className="list" role="list">
        {layers.map((l, k) => (
          <div key={l.name || '\u0000'} className={'list-item layer-row' + (l.hidden ? ' faint' : '')} role="listitem">
            <button className={'sm quiet layer-eye' + (l.hidden ? '' : ' on')} aria-pressed={!l.hidden} onClick={() => L.setHidden(l.name, !l.hidden)}
              title={l.hidden ? 'Show this layer' : 'Hide this layer'} aria-label={(l.hidden ? 'Show ' : 'Hide ') + (l.name || NO_LAYER)}>{l.hidden ? '◌' : '👁'}</button>
            {editing === l.name && l.name ? (
              <input className="grow" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Layer name"
                onBlur={() => finish(l.name)} onKeyDown={(e) => { if (e.key === 'Enter') finish(l.name); else if (e.key === 'Escape') setEditing(null) }} />
            ) : (
              <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', fontStyle: l.name ? undefined : 'italic' }}
                title={l.name ? 'Click: select its objects. Double-click: rename' : 'Objects in no layer: click to select them'}
                onClick={() => L.selectLayer(l.name)} onDoubleClick={() => { if (l.name) { setEditing(l.name); setDraft(l.name) } }}>
                {l.name || NO_LAYER} <span className="faint small">{l.count}</span>
              </span>
            )}
            <button className="sm quiet" onClick={() => L.solo(l.name)} title="Show only this layer (again: show all)">Solo</button>
            {!compact && l.name && <>
              <button className="sm quiet" disabled={k === 0} onClick={() => L.reorder(l.name, -1)} title="Move up" aria-label={`Move ${l.name} up`}>↑</button>
              <button className="sm quiet" disabled={k >= named.length - 1} onClick={() => L.reorder(l.name, 1)} title="Move down" aria-label={`Move ${l.name} down`}>↓</button>
              <button className="sm quiet" onClick={() => L.remove(l.name)} title="Delete the layer (its objects stay, in no layer)" aria-label={`Delete layer ${l.name}`}>✕</button>
            </>}
          </div>
        ))}
      </div>
      {chosen.length > 0 && (
        <div className="row wrap small" style={{ gap: 6 }}>
          <span className="muted">{chosen.length === 1 ? 'Selected object' : `${chosen.length} selected`} to</span>
          <input list="layer-names" placeholder="layer name" value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: 120 }} aria-label="Layer to move the selection to"
            onKeyDown={(e) => { if (e.key === 'Enter' && target.trim()) { L.moveTo(chosen, target.trim()); setTarget('') } }} />
          <datalist id="layer-names">{named.map((l) => <option key={l.name} value={l.name} />)}</datalist>
          <button className="sm" disabled={!target.trim()} onClick={() => { L.moveTo(chosen, target.trim()); setTarget('') }}>Move</button>
          <button className="sm quiet" onClick={() => L.moveTo(chosen, '')} title="Take them out of their layer">No layer</button>
        </div>
      )}
      {!compact && (
        <>
          <Check checked={project.export_hidden_layers !== false} onChange={L.setExportHidden}>Export hidden layers too</Check>
          <p className="faint small">
            Hidden layers are left out of the view, clicking and the walk-through{project.export_hidden_layers === false ? ', and out of the export' : '; the export still builds them'}.
            {named.length > 0 && <> <button className="link small" onClick={() => sort(true)}>Sort every object again</button> (the ones in layers too).</>}
          </p>
        </>
      )}
    </div>
  )
}

/** The layer of the selected object(s), in the inspector: type a layer's name (a new one is made) or clear it. */
export function LayerField({ indices }: { indices: number[] }) {
  const project = useEditor((s) => s.project)!
  const names = layerList(project).filter((l) => l.name).map((l) => l.name)
  const current = new Set(indices.map((i) => (project.scene_items[i] ? layerOf(project.scene_items[i]) : '')))
  const value = current.size === 1 ? [...current][0] : ''
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => { const v = draft.trim(); if (v !== value || current.size > 1) L.moveTo(indices, v) }
  return (
    <Field label="Layer">
      <input list="layer-field-names" value={draft} placeholder={current.size > 1 ? 'several layers' : NO_LAYER} onChange={(e) => setDraft(e.target.value)}
        onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit() }} title="Type a layer's name to move it there (a new name makes a new layer)" />
      <datalist id="layer-field-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
    </Field>
  )
}

