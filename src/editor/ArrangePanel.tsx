// Several objects picked: line them up along X or Z (or level their bottoms) and space them evenly.
import * as act from './actions'
import { getViewer } from './Viewport'
import { selectedItems } from './store'
import { toast, toastError } from '../ui'
import type { Axis, Edge } from '../lib/arrange'

const bounds: act.BoundsOf = (i) => getViewer()?.itemBounds(i) ?? null

export function alignSelected(axis: Axis, edge: Edge) {
  try { if (!act.alignItems(selectedItems(), axis, edge, bounds)) toast('Already lined up.', 'info', 1600) } catch (e) { toastError(e) }
}

export function distributeSelected(axis: Axis) {
  try { if (!act.distributeItems(selectedItems(), axis, bounds)) toast('Already evenly spaced.', 'info', 1600) } catch (e) { toastError(e) }
}

export function ArrangePanel({ pieces }: { pieces: number }) {
  const row = (axis: Axis, name: string) => (
    <div className="row wrap">
      <span className="small faint" style={{ minWidth: 56 }}>Along {name}:</span>
      <button className="sm" onClick={() => alignSelected(axis, 'min')} title={`Every −${name} edge at the furthest one`}>−{name} edges</button>
      <button className="sm" onClick={() => alignSelected(axis, 'mid')} title="Every middle on the middle of them all">Middles</button>
      <button className="sm" onClick={() => alignSelected(axis, 'max')} title={`Every +${name} edge at the furthest one`}>+{name} edges</button>
    </div>
  )
  return (
    <div className="section">
      <span className="section-title">Line up</span>
      {row(0, 'X')}
      {row(2, 'Z')}
      <div className="row wrap">
        <button className="sm" onClick={() => alignSelected(1, 'min')} title="Every bottom at the lowest one">Level the bottoms</button>
        <span className="small faint">Space evenly:</span>
        <button className="sm" disabled={pieces < 3} onClick={() => distributeSelected(0)} title={pieces < 3 ? 'Pick three or more' : 'Equal gaps along X; the two at the ends stay'}>Along X</button>
        <button className="sm" disabled={pieces < 3} onClick={() => distributeSelected(2)} title={pieces < 3 ? 'Pick three or more' : 'Equal gaps along Z; the two at the ends stay'}>Along Z</button>
      </div>
      <span className="faint small">A group moves as one piece.</span>
    </div>
  )
}
