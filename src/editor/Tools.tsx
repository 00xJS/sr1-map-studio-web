// Paint-style toolbox: a strip of tools down the viewport's left edge and a
// bar with the active tool's options (shape kind, marker type, weapon, palette).
import { useEffect, useState, type ReactNode } from 'react'
import { useEditor, type Swatch, type Tool, type GizmoMode } from './store'
import { generatedSwatches, librarySwatches, mapSwatches, swatchThumb } from './paint'
import { SHAPE_PRESETS } from '../lib/shapes'
import { ALL_PREFABS, PREFAB_CATEGORIES } from '../lib/prefabRegistry'
import { catalogs } from '../lib/catalogs'
import { MARKER_HINTS, SIMPLE_MARKERS, markerLabel } from '../lib/labels'
import { deleteMyPrefab, renameMyPrefab, useMyPrefabs } from './myPrefabs'
import { confirmDialog } from '../ui'
import { GroundToolOptions } from './GroundToolOptions'

const I = (d: ReactNode) => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const ICONS = {
  select: I(<path d="M5 3l12 9-5 1 3 6-2 1-3-6-4 4z" />),
  rotate: I(<><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v5h-5" /></>),
  scale: I(<><rect x="3" y="11" width="10" height="10" /><path d="M13 11l8-8M15 3h6v6" /></>),
  shape: I(<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></>),
  paint: I(<><path d="M5 11l7-7 7 7-7 7z" /><path d="M19 11c1.5 2 2 3.2 2 4a2 2 0 0 1-4 0c0-.8.5-2 2-4z" /><path d="M8 8h8" /></>),
  pick: I(<><path d="M14 4l6 6-2 2-6-6z" /><path d="M13 7l-8 8v4h4l8-8" /></>),
  spawn: I(<><circle cx="12" cy="7" r="3" /><path d="M6 21v-3a6 6 0 0 1 12 0v3" /></>),
  weapon: I(<><path d="M3 10h14l3-2v4h-4l-2 2v4h-3l-1-4H3z" /></>),
  light: I(<><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 1 4 10.5c-.8.8-1 1.5-1 2.5H9c0-1-.2-1.7-1-2.5A6 6 0 0 1 12 3z" /></>),
  erase: I(<><path d="M20 20H9L4 15l9-9 7 7-6 6" /><path d="M9 11l6 6" /></>),
  sculpt: I(<><path d="M2 19l6-9 4 5 3-4 7 8z" /><path d="M14.5 6.5l2-2 2 2" /></>),
  road: I(<><path d="M8 3L5 21M16 3l3 18" /><path d="M12 4v3M12 10.5v3M12 17v3" /></>),
}

type Entry = { id: string; label: string; short: string; key: string; tool: Tool; gizmo?: GizmoMode; help: string }
const ENTRIES: Entry[] = [
  { id: 'select', label: 'Select and move', short: 'Move', key: 'V', tool: 'select', gizmo: 'translate', help: 'Click to select; drag the arrows to move.' },
  { id: 'rotate', label: 'Rotate', short: 'Turn', key: '2', tool: 'select', gizmo: 'rotate', help: 'Drag the rings to turn the selection.' },
  { id: 'scale', label: 'Scale', short: 'Size', key: '3', tool: 'select', gizmo: 'scale', help: 'Drag to resize the selection.' },
  { id: 'shape', label: 'Shape', short: 'Shape', key: 'H', tool: 'shape', help: 'Click the map to place a shape.' },
  { id: 'sculpt', label: 'Terrain', short: 'Terrain', key: 'T', tool: 'sculpt', help: 'Drag on a terrain to sculpt it.' },
  { id: 'road', label: 'Road', short: 'Road', key: 'R', tool: 'road', help: 'Click points for a road, Enter to finish.' },
  { id: 'paint', label: 'Paint bucket', short: 'Paint', key: 'B', tool: 'paint', help: 'Click a surface to paint it with the chosen texture.' },
  { id: 'pick', label: 'Eyedropper', short: 'Pick', key: 'I', tool: 'pick', help: 'Click a surface to pick up its texture.' },
  { id: 'spawn', label: 'Spawns & markers', short: 'Spawn', key: 'P', tool: 'spawn', help: 'Click the map to place a spawn or marker.' },
  { id: 'weapon', label: 'Weapon', short: 'Weapon', key: 'K', tool: 'weapon', help: 'Click the map to place a weapon pickup.' },
  { id: 'light', label: 'Light', short: 'Light', key: 'L', tool: 'light', help: 'Click the map to place a light.' },
  { id: 'erase', label: 'Eraser', short: 'Erase', key: 'X', tool: 'erase', help: 'Click anything to delete it.' },
]

export function chooseTool(id: string) {
  const e = ENTRIES.find((x) => x.id === id)
  if (!e) return
  const st = useEditor.getState()
  st.set({ tool: e.tool, placeMode: null, ...(e.gizmo ? { gizmo: e.gizmo } : {}) })
}

/** Keyboard shortcut letter -> tool id. */
export const TOOL_KEYS: Record<string, string> = Object.fromEntries(ENTRIES.filter((e) => /[A-Z]/.test(e.key)).map((e) => [e.key.toLowerCase(), e.id]))

export function ToolStrip() {
  const tool = useEditor((s) => s.tool)
  const gizmo = useEditor((s) => s.gizmo)
  const active = (e: Entry) => (e.tool === 'select' ? tool === 'select' && e.gizmo === gizmo : tool === e.tool)
  return (
    <div className="toolstrip" role="toolbar" aria-label="Tools" data-tour="tools">
      {ENTRIES.map((e) => (
        <button key={e.id} className={'tool' + (active(e) ? ' on' : '') + (e.id === 'shape' || e.id === 'erase' ? ' gap' : '')}
          title={`${e.label} (${e.key}) · ${e.help}`} aria-label={e.label} onClick={() => chooseTool(e.id)} data-tour={e.id === 'paint' ? 'paint' : undefined}>
          {ICONS[e.id as keyof typeof ICONS]}
          <span className="tool-label">{e.short}</span>
        </button>
      ))}
    </div>
  )
}

function SwatchImg({ s, size = 28 }: { s: Swatch; size?: number }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { let live = true; swatchThumb(s).then((u) => live && setUrl(u)); return () => { live = false } }, [s.key])
  return url ? <img src={url} alt="" width={size} height={size} style={{ borderRadius: 4, display: 'block' }} /> : <span className="tex-thumb" style={{ width: size, height: size }} />
}

/** Texture choices: in this map, generated and the starter library. */
export function Palette({ onClose, onPick, current }: { onClose: () => void; onPick?: (s: Swatch) => void; current?: string }) {
  const [lib, setLib] = useState<Swatch[]>([])
  useEffect(() => { librarySwatches().then(setLib).catch(() => setLib([])) }, [])
  const chosen = useEditor((s) => s.swatch)?.key
  const active = onPick ? current : chosen
  const pick = (s: Swatch) => { if (onPick) onPick(s); else useEditor.getState().set({ swatch: s }); onClose() }
  const group = (title: string, items: Swatch[], note?: string) => (
    <div className="col" style={{ gap: 4 }}>
      <span className="section-title">{title}</span>
      {note && <span className="faint small">{note}</span>}
      <div className="palette-grid">
        {items.map((s) => (
          <button key={s.key} className={'swatch-btn' + (active === s.key ? ' on' : '')} title={`${s.label} · ${catalogs.surface_types[s.surface]}`} onClick={() => pick(s)}>
            <SwatchImg s={s} size={44} /><span>{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
  const inMap = mapSwatches()
  return (
    <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
      {inMap.length > 0 && group('In this map', inMap)}
      {group('Generated', generatedSwatches(), 'Made in your browser. Free to share.')}
      {group('Starter library', lib, 'From Poly Haven, CC0. Free to share.')}
      {!onPick && <span className="faint small">For a photo or your own colors, select the object and use <b>Photo or custom…</b> in its panel.</span>}
    </div>
  )
}

/** Options for the active tool, shown along the top of the viewport. */
/** Rename or delete the saved piece chosen in the Prefabs list. */
function MineActions({ id, onGone }: { id: string; onGone: () => void }) {
  const p = useMyPrefabs().find((x) => x.id === id)
  if (!p) return null
  const rename = () => { const n = window.prompt('Name for this piece', p.name); if (n?.trim()) renameMyPrefab(id, n.trim()) }
  const remove = async () => {
    if (await confirmDialog('Delete saved piece?', `"${p.name}" is removed from My prefabs. Copies already placed in maps stay.`, { confirm: 'Delete', danger: true })) { deleteMyPrefab(id); onGone() }
  }
  return (
    <>
      <span className="faint small">{p.bundle.items.length} object{p.bundle.items.length === 1 ? '' : 's'}: click the map to place it.</span>
      <button className="sm quiet" onClick={rename}>Rename</button>
      <button className="sm quiet danger" onClick={remove}>Delete</button>
    </>
  )
}

export function ToolOptions() {
  const tool = useEditor((s) => s.tool)
  const swatch = useEditor((s) => s.swatch)
  const toolShape = useEditor((s) => s.toolShape)
  const mine = useMyPrefabs()
  const toolSpawn = useEditor((s) => s.toolSpawn)
  const toolWeapon = useEditor((s) => s.toolWeapon)
  const advanced = useEditor((s) => s.advanced)
  const [open, setOpen] = useState(false)
  useEffect(() => { if (tool !== 'paint' && tool !== 'pick') setOpen(false) }, [tool])
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const set = useEditor.getState().set
  if (tool === 'select') return null
  const help = ENTRIES.find((e) => e.tool === tool)?.help
  return (
    <div className="tooloptions">
      {tool === 'shape' && (
        <div className="row wrap">
          {Object.entries(SHAPE_PRESETS).map(([k, p]) => (
            <button key={k} className={'sm' + (toolShape === k ? ' on' : '')} title={p.hint} onClick={() => set({ toolShape: k })}>{p.label}</button>
          ))}
          <select value={/^(prefab|mine):/.test(toolShape) ? toolShape : ''} onChange={(e) => e.target.value && set({ toolShape: e.target.value })}
            className={/^(prefab|mine):/.test(toolShape) ? 'on' : ''} title="Ready-made pieces: buildings, cars, trees, street furniture, and pieces you saved">
            <option value="">Prefabs…</option>
            {mine.length > 0 && (
              <optgroup label="My prefabs">
                {mine.map((p) => <option key={p.id} value={'mine:' + p.id}>{p.name}</option>)}
              </optgroup>
            )}
            {PREFAB_CATEGORIES.map((c) => (
              <optgroup key={c} label={c}>
                {Object.entries(ALL_PREFABS).filter(([, p]) => p.category === c).map(([k, p]) => <option key={k} value={'prefab:' + k} title={p.hint}>{p.label}</option>)}
              </optgroup>
            ))}
          </select>
          {toolShape.startsWith('mine:') && <MineActions id={toolShape.slice(5)} onGone={() => set({ toolShape: 'box' })} />}
        </div>
      )}
      {(tool === 'paint' || tool === 'pick') && (
        <div className="row" style={{ position: 'relative' }}>
          <button className="sm" onMouseDown={(e) => e.stopPropagation()} onClick={() => setOpen(!open)} title="Choose the paint texture">
            {swatch ? <SwatchImg s={swatch} size={22} /> : <span className="tex-thumb" style={{ width: 22, height: 22 }} />}
            <span>{swatch ? swatch.label : 'Choose texture…'}</span>
            <span className="faint">▾</span>
          </button>
          {swatch && <span className="faint small">Surface: {catalogs.surface_types[swatch.surface]}</span>}
          {open && <Palette onClose={() => setOpen(false)} />}
        </div>
      )}
      {tool === 'spawn' && (
        <select value={toolSpawn} onChange={(e) => set({ toolSpawn: e.target.value })} title={MARKER_HINTS[toolSpawn]}>
          {(advanced ? catalogs.marker_types.filter((t) => t !== 'Weapon pickup') : SIMPLE_MARKERS).map((t) => <option key={t} value={t}>{markerLabel(t)}</option>)}
        </select>
      )}
      {(tool === 'sculpt' || tool === 'road') && <GroundToolOptions tool={tool} />}
      {tool === 'weapon' && (
        <select value={toolWeapon} onChange={(e) => set({ toolWeapon: e.target.value })}>
          {catalogs.weapons.map(([n, id]) => <option key={id} value={id}>{n}</option>)}
        </select>
      )}
      {tool !== 'sculpt' && tool !== 'road' && <span className="small muted">{tool === 'spawn' ? MARKER_HINTS[toolSpawn] ?? help : help}</span>}
      <button className="sm quiet" onClick={() => chooseTool('select')} title="Back to Select (Esc)">Done</button>
    </div>
  )
}
