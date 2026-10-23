// Tool bar options for the Terrain and Road tools, and their panels in the
// object inspector.
import { cancelRoad, finishRoad, undoRoadPoint, useGround } from './groundTools'
import { addTerrain } from './groundActions'
import { chooseTool } from './Tools'
import { getViewer } from './Viewport'
import { useEditor } from './store'
import { toastError } from '../ui'
import { peak, steepest, type Brush } from '../lib/terrain'
import type { SceneItem } from '../lib/project'

const BRUSHES: [Brush, string, string][] = [
  ['raise', 'Raise', 'Pull the ground up into hills (hold Shift to dig instead)'],
  ['lower', 'Lower', 'Dig hollows and ditches (hold Shift to raise instead)'],
  ['smooth', 'Smooth', 'Round off bumps and sharp edges'],
  ['flatten', 'Flatten', 'Level the ground to the height where the stroke started: plazas, building pads'],
]

/** Puts a flat terrain at the middle of the view, on whatever is below. */
function addTerrainHere() {
  const v = getViewer()
  const c = v?.center() ?? [0, 0, 0]
  const y = v?.surfaceBelow(c[0], 1e4, c[2]) ?? null
  addTerrain([Math.round(c[0]), 0, Math.round(c[2])], y, useGround.getState().terrainSize).catch(toastError)
}

export function GroundToolOptions({ tool }: { tool: 'sculpt' | 'road' }) {
  const g = useGround()
  const hasTerrain = useEditor((s) => !!s.project?.scene_items.some((it) => it.shape?.kind === 'terrain'))
  const road = g.road
  const setRoad = (p: Partial<typeof road>) => g.set({ road: { ...road, ...p } })
  if (tool === 'sculpt') return (
    <>
      <div className="row wrap">
        {BRUSHES.map(([b, label, hint]) => (
          <button key={b} className={'sm' + (g.brush === b ? ' on' : '')} title={hint} onClick={() => g.set({ brush: b })}>{label}</button>
        ))}
      </div>
      <label className="row small" title="Brush size, editor units (2 = 1 m)">Size
        <input type="range" min={3} max={60} step={1} value={g.radius} onChange={(e) => g.set({ radius: +e.target.value })} />
      </label>
      <label className="row small" title="How fast the brush works">Strength
        <input type="range" min={1} max={20} step={0.5} value={g.strength} onChange={(e) => g.set({ strength: +e.target.value })} />
      </label>
      <label className="row small" title="Keep every slope at 45° or gentler, so players can walk up anything"><input type="checkbox" checked={g.walkable} onChange={(e) => g.set({ walkable: e.target.checked })} /> Walkable slopes</label>
      <span className="row">
        <select value={g.terrainSize} onChange={(e) => g.set({ terrainSize: +e.target.value })} title="Width and depth of a new terrain (units; 2 units = 1 m)">
          {[80, 120, 160, 200, 256].map((s) => <option key={s} value={s}>{s} × {s}</option>)}
        </select>
        <button className={'sm' + (hasTerrain ? '' : ' primary')} onClick={addTerrainHere} title="A flat grassy terrain at the middle of the view, ready to sculpt">+ Add terrain</button>
      </span>
      <span className="small muted">{hasTerrain ? 'Hold the left button on a terrain and drag to sculpt. Drag off it to turn the camera.' : 'Add a terrain first, then drag on it to sculpt.'}</span>
    </>
  )
  return (
    <>
      <label className="row small" title="Kerb to kerb (units; 14 = two 3.5 m lanes)">Width
        <input type="number" min={6} max={40} step={1} value={road.width} style={{ width: 56 }} onChange={(e) => setRoad({ width: Math.max(6, +e.target.value || 14) })} />
      </label>
      <label className="row small" title="Sidewalk each side, kerb included; 0 for none">Sidewalks
        <input type="number" min={0} max={14} step={0.5} value={road.walk} style={{ width: 56 }} onChange={(e) => setRoad({ walk: Math.max(0, +e.target.value || 0) })} />
      </label>
      <select value={road.lines} onChange={(e) => setRoad({ lines: e.target.value })} title="Lane markings">
        <option value="dashed">Dashed line</option><option value="double">Double yellow</option><option value="none">No markings</option>
      </select>
      <label className="row small" title="Units between street lamps; 0 for none">Lamps every
        <input type="number" min={0} max={120} step={2} value={road.lamps} style={{ width: 56 }} onChange={(e) => setRoad({ lamps: Math.max(0, +e.target.value || 0) })} />
      </label>
      {g.draft > 0 && <span className="row">
        <button className="sm primary" onClick={finishRoad} disabled={g.draft < 2} title="Enter, or click the last point again">Finish road</button>
        <button className="sm" onClick={undoRoadPoint} title="Backspace">Undo point</button>
        <button className="sm quiet" onClick={cancelRoad}>Cancel</button>
      </span>}
      <span className="small muted">{g.draft > 0 ? `${g.draft} point${g.draft === 1 ? '' : 's'}: click on, Enter to finish.` : 'Click points along the map, Enter to finish. Start on a selected road to branch off it. Selected road: drag its points, Alt+click removes one, Shift+click adds one.'}</span>
    </>
  )
}

/** Inspector panel for a terrain: how high and steep it is, and a way into sculpting. */
export function TerrainPanel({ it }: { it: SceneItem }) {
  const s = it.shape!
  return (
    <div className="group">
      <span className="section-title">Terrain</span>
      <span className="small muted">{s.cells?.[0]} × {s.cells?.[1]} cells · highest point {(peak(s) / 2).toFixed(1)} m · steepest slope {steepest(s).toFixed(0)}°</span>
      <div className="row"><button className="sm primary" onClick={() => chooseTool('sculpt')} title="T">Sculpt it</button></div>
      <span className="faint small">Grass covers the flats, dirt the slopes and stones the steepest, highest ground. Change each under Look.</span>
    </div>
  )
}

/** Inspector note for a road: its points are edited in the view with the Road tool. */
export function RoadPanel() {
  return (
    <div className="group">
      <span className="section-title">Road points</span>
      <div className="row"><button className="sm primary" onClick={() => chooseTool('road')} title="R">Edit points</button></div>
      <span className="faint small">With the Road tool: drag a point to move it, Alt+click to remove it, Shift+click the road to add one, or start a new line on it to add a branch with a junction.</span>
    </div>
  )
}

export const TERRAIN_LOOK: Record<string, string> = { top: 'Grass (flat ground)', side: 'Dirt (slopes, edges)', rock: 'Rock (steep, high)' }
