// Stilwater: the real city from the player's own game, seen from above. Drag a rectangle to start a map from
// that piece of the city, or scan it (or the whole city) for spots that look finished but aren't: floors you'd
// fall through and buildings with no roof. Everything is read from this device's game files and stays here.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, requestPersistence } from '../lib/db'
import { downloadBlob } from '../lib/exporter'
import { buildCityMap, connectCity, loadCityMap, NeedGameFolder, workerCityScan, workerCityTextures } from '../lib/gameObjects/client'
import { SAFE_PEG_MB, TEMPLATE_PEG_BYTES, pictureBytes } from '../lib/textureBudget'
import type { CityMap } from '../lib/gameObjects/worker'
import { MAP, chunksIn, type Hole, type Rect } from '../lib/city/city'
import { MAX_SIDE, cityProject } from '../lib/city/build'
import { toastError } from '../ui'

/** Map pixel (mirrored like the editor's view: the editor's +X is the game's −X) to game x, z, and back. */
const toGame = (mx: number, my: number): [number, number] => [MAP.x0 + (MAP.size - mx) * MAP.cell, MAP.z0 + my * MAP.cell]
const toMap = (gx: number, gz: number): [number, number] => [MAP.size - (gx - MAP.x0) / MAP.cell, (gz - MAP.z0) / MAP.cell]
const NEAR_STREET = 6
/** Ready-made squares: the game's own multiplayer maps are 45 to 120 m across; 300 m is the most a cut can be. */
const PRESETS: [number, string][] = [[60, '60 m'], [90, '90 m'], [120, '120 m'], [200, '200 m'], [MAX_SIDE, `${MAX_SIDE} m (largest)`]]
const SCAN_TILE = 250

/** Map colours per kind of surface (see Ground), like a printed city map. */
const PALETTE: [number, number, number][] = [
  [30, 72, 99], // nothing: the sea round Stilwater
  [62, 65, 71], // road
  [168, 163, 154], // pavement
  [92, 138, 68], // grass
  [161, 143, 104], // dirt
  [47, 111, 150], // water
  [107, 90, 75], // rails
  [143, 139, 132], // other
  [120, 116, 110], // wall
]
/** The sea's surface in the game (m): lower surfaces are under water. */
const SEA = -5.6
const ROOF_LOW: [number, number, number] = [176, 168, 156], ROOF_HIGH: [number, number, number] = [236, 230, 220]

function picture(map: CityMap): ImageBitmap | HTMLCanvasElement {
  const n = MAP.size
  const c = document.createElement('canvas')
  c.width = n; c.height = n
  const g = c.getContext('2d')!
  const img = g.createImageData(n, n)
  const NONE = -32768
  const h = map.top, kind = map.kind
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= n || j >= n ? NONE : h[j * n + i])
  // Ground level round each pixel (lowest surface within ~12 m): what stands well above it is a building.
  const R = Math.round(12 / MAP.cell)
  const rowMin = new Int16Array(n * n), low = new Int16Array(n * n)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let m = 32767
    for (let d = -R; d <= R; d++) { const v = at(i + d, j); if (v !== NONE && v < m) m = v }
    rowMin[j * n + i] = m
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let m = 32767
    for (let d = -R; d <= R; d++) { const jj = j + d; if (jj >= 0 && jj < n && rowMin[jj * n + i] < m) m = rowMin[jj * n + i] }
    low[j * n + i] = m
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = h[j * n + i]
    const o = 4 * (j * n + (n - 1 - i))
    if (v === NONE) { const [r, gg, b] = PALETTE[0]; img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255; continue }
    const m = v / 10, above = (v - low[j * n + i]) / 10
    let col = PALETTE[kind?.[j * n + i] ?? 7] ?? PALETTE[7]
    // Below sea level (about −6 m) is the sea floor: draw the water over it, darker where it's deeper.
    if (m < SEA) {
      const deep = Math.max(0, Math.min(1, (SEA - m) / 10))
      const [r, gg, b] = PALETTE[5].map((x, k) => x + (PALETTE[0][k] - x) * deep)
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255
      continue
    }
    // Rooftops: light, a little lighter the taller the building.
    if (above > 3.5) { const t = Math.max(0, Math.min(1, above / 60)); col = [0, 1, 2].map((k) => ROOF_LOW[k] + (ROOF_HIGH[k] - ROOF_LOW[k]) * t) as [number, number, number] }
    // Lit from the top left (the map shows the game's −X to the left): slopes toward the light brighter.
    const left = at(i + 1, j), up = at(i, j - 1)
    const dl = left === NONE ? 0 : m - left / 10, du = up === NONE ? 0 : m - up / 10
    let shade = 1 + Math.max(-0.35, Math.min(0.35, (dl + du) * 0.08))
    // Outlines where the height jumps (building edges, kerbs of raised ground).
    const right = at(i - 1, j), down = at(i, j + 1)
    if ([left, up, right, down].some((q) => q !== NONE && Math.abs(q - v) > 25)) shade *= 0.72
    // Shadows from a sun 45° up in the top left: cast by anything up there taller than its distance away.
    for (let s = 1; s <= 12; s++) {
      const q = at(i + s, j - s)
      if (q !== NONE && (q - v) / 10 > s * MAP.cell * Math.SQRT2) { shade *= 0.78; break }
    }
    img.data[o] = col[0] * shade; img.data[o + 1] = col[1] * shade; img.data[o + 2] = col[2] * shade; img.data[o + 3] = 255
  }
  g.putImageData(img, 0, 0)
  return c
}

/** The square of the map that has anything in it. */
function extent(map: CityMap): [number, number, number, number] {
  let x0 = MAP.size, y0 = MAP.size, x1 = 0, y1 = 0
  const n = MAP.size
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (map.top[j * n + i] !== -32768) {
    const x = n - 1 - i
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (j < y0) y0 = j; if (j > y1) y1 = j
  }
  return x0 <= x1 ? [x0, y0, x1, y1] : [0, 0, n, n]
}

const size = (r: Rect) => [Math.round(r.x1 - r.x0), Math.round(r.z1 - r.z0)]
const rectKey = (r: Rect) => [r.x0, r.z0, r.x1, r.z1].map((v) => v.toFixed(1)).join(',')

/** An area's textures as the exported map will store them (each picture once): MB, and how many pictures. */
async function areaTextures(map: CityMap, r: Rect): Promise<{ mb: number; pictures: number }> {
  const stems = chunksIn(map.summaries, r)
  const pics = stems.length ? await workerCityTextures(r, stems) : []
  const bytes = pics.reduce((a, [, w, h, alpha]) => a + pictureBytes(w, h, alpha), TEMPLATE_PEG_BYTES)
  return { mb: +(bytes / 1e6).toFixed(1), pictures: pics.length }
}
const around = (x: number, z: number, half: number): Rect => ({ x0: x - half, z0: z - half, x1: x + half, z1: z + half })

export default function City() {
  const nav = useNavigate()
  const [map, setMap] = useState<CityMap | null | undefined>(undefined)
  const [progress, setProgress] = useState<string | null>(null)
  const [sel, setSel] = useState<Rect | null>(null)
  const [holes, setHoles] = useState<Hole[] | null>(null)
  const [nearStreet, setNearStreet] = useState(true)
  /** The picked area's textures (for the area it was measured on), or why it couldn't be measured yet. */
  const [tex, setTex] = useState<{ key: string; mb: number; pictures: number } | { key: string; checking: true } | { key: string; folder: true } | null>(null)
  const stop = useRef(false)
  useEffect(() => { loadCityMap().then(setMap).catch(() => setMap(null)) }, [])
  // The area's textures, once the player stops moving it (a map whose textures don't fit the game's memory loads black).
  const measure = async (r: Rect, ask: boolean) => {
    if (!map) return
    const key = rectKey(r)
    setTex({ key, checking: true })
    try {
      await connectCity(ask, map)
      const t = await areaTextures(map, r)
      setTex((cur) => (cur?.key === key ? { key, ...t } : cur))
    } catch (e) {
      setTex((cur) => (cur?.key === key ? { key, folder: true } : cur))
      if (ask && !(e instanceof NeedGameFolder)) toastError(e)
    }
  }
  useEffect(() => {
    if (!sel || !map || Math.max(...size(sel)) > MAX_SIDE) { setTex(null); return }
    const t = setTimeout(() => void measure(sel, false), 700)
    return () => clearTimeout(t)
  }, [sel && rectKey(sel), map])
  /** Shrinks the area round its middle until its textures fit (pictures roughly follow the area). */
  const shrink = () => sel && map && run('Shrinking the area to fit…', async () => {
    await connectCity(true, map)
    let r = sel, t = await areaTextures(map, r)
    for (let k = 0; k < 6 && t.mb > 24; k++) {
      const base = TEMPLATE_PEG_BYTES / 1e6
      const f = Math.max(0.5, Math.min(0.95, Math.sqrt((SAFE_PEG_MB * 0.85 - base) / Math.max(0.1, t.mb - base))))
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, hw = ((r.x1 - r.x0) / 2) * f, hd = ((r.z1 - r.z0) / 2) * f
      r = { x0: cx - hw, z0: cz - hd, x1: cx + hw, z1: cz + hd }
      setProgress(`Shrinking the area to fit: ${size(r).join(' × ')} m, textures about ${t.mb} MB…`)
      t = await areaTextures(map, r)
    }
    setSel(r)
    setTex({ key: rectKey(r), ...t })
  })
  const texNow = sel && tex?.key === rectKey(sel) ? tex : null
  const over = !!texNow && 'mb' in texNow && texNow.mb > SAFE_PEG_MB

  const run = async (label: string, job: () => Promise<void>) => {
    setProgress(label)
    try { await job() } catch (e) { toastError(e instanceof NeedGameFolder ? new Error('Choose your Saints Reborn folder (the one with dist/game/packfiles) to read the city.') : e) } finally { setProgress(null) }
  }
  const build = () => run('Opening your game files…', async () => {
    const m = await buildCityMap(true, (d, t) => setProgress(`Reading the city: ${d} of ${t} parts`))
    setMap(m)
  })
  const start = () => sel && map && run('Starting…', async () => {
    await connectCity(true, map)
    const p = await cityProject(sel, map, setProgress)
    await db.putProject({ id: p.id, name: p.name, updated_at: p.updated_at, project: p })
    void requestPersistence()
    nav('/editor/' + p.id + '?first=1')
  })
  const scan = (all: boolean) => map && run('Opening your game files…', async () => {
    await connectCity(true, map)
    stop.current = false
    const areas: Rect[] = []
    if (all) {
      const [x0, y0, x1, y1] = extent(map)
      const [ga, gb] = toGame(x1, y0), [gc, gd] = toGame(x0, y1)
      for (let z = gb; z < gd; z += SCAN_TILE) for (let x = ga; x < gc; x += SCAN_TILE) areas.push({ x0: x, z0: z, x1: x + SCAN_TILE, z1: z + SCAN_TILE })
    } else if (sel) areas.push(sel)
    const found: Hole[] = []
    for (const [i, a] of areas.entries()) {
      if (stop.current) break
      const stems = chunksIn(map.summaries, a)
      if (stems.length) found.push(...await workerCityScan(a, stems))
      setProgress(`Scanning: ${i + 1} of ${areas.length} areas, ${found.length} spot${found.length === 1 ? '' : 's'} found`)
      setHoles([...found])
    }
    setHoles(found)
  })

  const shown = useMemo(() => (holes ?? []).filter((h) => !nearStreet || h.above < NEAR_STREET).sort((a, b) => (a.kind === b.kind ? b.area - a.area : a.kind === 'fall' ? -1 : 1)), [holes, nearStreet])
  const csv = () => {
    const rows = [['kind', 'x', 'y', 'z', 'width_m', 'depth_m', 'area_m2', 'above_street_m', 'drop_m', 'chunk'], ...shown.map((h) => [h.kind, h.x.toFixed(1), h.y.toFixed(1), h.z.toFixed(1), h.w, h.d, h.area, h.above.toFixed(1), h.drop === undefined ? '' : Number.isFinite(h.drop) ? h.drop.toFixed(1) : 'nothing below', h.chunk])]
    downloadBlob(new Blob([rows.map((r) => r.join(',')).join('\n') + '\n'], { type: 'text/csv' }), 'stilwater-holes.csv')
  }

  if (map === undefined) return <div className="page"><p className="muted">Loading…</p></div>
  return (
    <div className="page">
      <h1>Stilwater</h1>
      <p className="muted">The real city from your own game, seen from above. Drag a rectangle to start a map from that piece of the city, or scan it for floors you'd fall through and buildings without a roof. It's all read from the game files on this device and stays here.</p>
      {!map ? (
        <div className="card col" style={{ gap: 10 }}>
          <p>Read the city from your Saints Reborn install once (about a minute or two); the map is kept on this device after that.</p>
          <div className="row"><button className="primary" disabled={!!progress} onClick={build}>Choose your game folder and read the city</button>{progress && <span className="small muted">{progress}</span>}</div>
        </div>
      ) : (
        <div className="city-layout">
          <CityCanvas map={map} sel={sel} onSelect={setSel} holes={shown} />
          <div className="col" style={{ gap: 12, minWidth: 260, flex: '0 1 340px' }}>
            <div className="card col" style={{ gap: 8 }}>
              <span className="section-title">Area</span>
              <div className="row wrap" style={{ gap: 6 }} title="A square of this size round the middle of the area (or of the city)">
                {PRESETS.map(([m, label]) => (
                  <button key={m} className={'sm' + (sel && size(sel)[0] === m && size(sel)[1] === m ? ' on' : '')} onClick={() => {
                    const [cx, cz] = sel ? [(sel.x0 + sel.x1) / 2, (sel.z0 + sel.z1) / 2] : [0, 400]
                    setSel(around(cx, cz, m / 2))
                  }}>{label}</button>
                ))}
              </div>
              {sel ? <>
                <span>{size(sel).join(' × ')} m</span>
                {Math.max(...size(sel)) > MAX_SIDE && <span className="small warn">At most {MAX_SIDE} m across: the game's own multiplayer maps are 45 to 120 m.</span>}
                {texNow && 'checking' in texNow && <span className="small muted">Measuring its textures…</span>}
                {texNow && 'folder' in texNow && <span className="small muted">Its textures aren't measured yet: <button className="link small" onClick={() => void measure(sel, true)}>measure them</button> (asks for your game folder).</span>}
                {texNow && 'mb' in texNow && (over
                  ? <span className="small warn">Textures: about {texNow.mb} MB ({texNow.pictures} different pictures). The game loads about 25 MB of textures for a map; past that it may load none and the map shows black. Pick a smaller area, or <button className="link small" disabled={!!progress} onClick={shrink}>shrink it to fit</button>.</span>
                  : texNow.mb > 25
                    ? <span className="small warn" title="Each picture counts once, however many surfaces use it, as the export stores it">Textures: about {texNow.mb} MB ({texNow.pictures} different pictures), at the edge of the about 25 MB maps are known to load with. A little smaller is safer: <button className="link small" disabled={!!progress} onClick={shrink}>shrink it to fit</button>.</span>
                    : <span className="small muted" title="Each picture counts once, however many surfaces use it, as the export stores it">Textures: about {texNow.mb} MB of the about 25 MB the game loads ({texNow.pictures} different pictures).</span>)}
                <button className="primary" disabled={!!progress || Math.max(...size(sel)) > MAX_SIDE} onClick={start}>{over ? 'Start anyway (may load black in game)' : 'Start a map from this area'}</button>
                <button disabled={!!progress} onClick={() => scan(false)}>Scan this area</button>
              </> : <span className="small muted">Drag on the map to draw an area, or pick a size above (a click picks 120 m round it). Drag the area to move it, its edges or corners to resize it. Right-drag to move the map, the wheel to zoom.</span>}
              <button className="quiet" disabled={!!progress} onClick={() => scan(true)} title="Every part of the city, a few minutes">Scan the whole city</button>
              {progress && <span className="small muted row" style={{ gap: 8 }}>{progress}{/Scanning/.test(progress) && <button className="sm" onClick={() => { stop.current = true }}>Stop</button>}</span>}
            </div>
            {holes && (
              <div className="card col" style={{ gap: 8 }}>
                <span className="section-title">Found {shown.length}{holes.length !== shown.length ? ` of ${holes.length}` : ''}</span>
                <label className="row small"><input type="checkbox" checked={nearStreet} onChange={(e) => setNearStreet(e.target.checked)} /> Only within {NEAR_STREET} m of street level</label>
                <span className="faint small"><span style={{ color: '#ff5a5a' }}>●</span> a raised floor the game may not treat as solid · <span style={{ color: '#ffb02e' }}>●</span> open top: no roof seen from above. These are candidates to check in game: part of the game's road and ground collision can't be read yet, so expect some false alarms, mostly on ramps and freeways.</span>
                <div className="list" style={{ maxHeight: 360 }}>
                  {shown.slice(0, 300).map((h, i) => (
                    <div key={i} className="list-item" onClick={() => setSel(around(h.x, h.z, Math.max(60, Math.max(h.w, h.d) / 2 + 30)))}>
                      <span style={{ color: h.kind === 'fall' ? '#ff5a5a' : '#ffb02e' }}>●</span>
                      <div className="grow">
                        <div>{h.kind === 'fall' ? 'Floor you may fall through' : 'No roof'} · {h.area} m²</div>
                        <div className="meta">{h.above.toFixed(0)} m above street{h.kind === 'fall' ? ` · ${h.drop !== undefined && Number.isFinite(h.drop) ? `drops ${h.drop.toFixed(0)} m` : 'nothing solid below'}` : ''} · at {h.x.toFixed(0)}, {h.z.toFixed(0)}</div>
                      </div>
                    </div>
                  ))}
                  {!shown.length && <div className="list-item faint">Nothing found here.</div>}
                </div>
                {!!shown.length && <button className="sm" onClick={csv}>Download the list (CSV)</button>}
              </div>
            )}
            <button className="link small" disabled={!!progress} onClick={build}>Read the city again</button>
          </div>
        </div>
      )}
    </div>
  )
}

type Handle = 'move' | 'l' | 'r' | 't' | 'b' | 'lt' | 'rt' | 'lb' | 'rb'
const CURSOR: Record<Handle, string> = { move: 'move', l: 'ew-resize', r: 'ew-resize', t: 'ns-resize', b: 'ns-resize', lt: 'nwse-resize', rb: 'nwse-resize', rt: 'nesw-resize', lb: 'nesw-resize' }
interface ScreenRect { l: number; t: number; r: number; b: number }

function CityCanvas({ map, sel, onSelect, holes }: { map: CityMap; sel: Rect | null; onSelect: (r: Rect | null) => void; holes: Hole[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const img = useMemo(() => picture(map), [map])
  const view = useRef({ s: 1, ox: 0, oy: 0 })
  const drag = useRef<{ kind: 'pan' | 'pick' | 'edit'; handle?: Handle; from?: ScreenRect; x: number; y: number; ox: number; oy: number } | null>(null)
  const [pick, setPick] = useState<Rect | null>(null)
  const [editing, setEditing] = useState(false)
  const [cursor, setCursor] = useState('crosshair')
  const [, redraw] = useState(0)

  // Fit the city on first show.
  useEffect(() => {
    const c = ref.current!
    const [x0, y0, x1, y1] = extent(map)
    const s = Math.min(c.clientWidth / (x1 - x0 + 20), c.clientHeight / (y1 - y0 + 20))
    view.current = { s, ox: (c.clientWidth - (x1 + x0) * s) / 2, oy: (c.clientHeight - (y1 + y0) * s) / 2 }
    redraw((n) => n + 1)
  }, [map])

  const screen = (gx: number, gz: number): [number, number] => { const { s, ox, oy } = view.current; const [mx, my] = toMap(gx, gz); return [ox + mx * s, oy + my * s] }
  const screenRect = (r: Rect): ScreenRect => { const [ax, ay] = screen(r.x0, r.z0), [bx, by] = screen(r.x1, r.z1); return { l: Math.min(ax, bx), r: Math.max(ax, bx), t: Math.min(ay, by), b: Math.max(ay, by) } }
  const local = (e: { clientX: number; clientY: number }): [number, number] => { const b = ref.current!.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top] }
  const gameAtLocal = (px: number, py: number) => { const { s, ox, oy } = view.current; return toGame((px - ox) / s, (py - oy) / s) }
  const gameAt = (e: { clientX: number; clientY: number }) => gameAtLocal(...local(e))
  const rectOf = (a: [number, number], b: [number, number]): Rect => ({ x0: Math.min(a[0], b[0]), z0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), z1: Math.max(a[1], b[1]) })
  const fromScreen = (q: ScreenRect): Rect => rectOf(gameAtLocal(q.l, q.t), gameAtLocal(q.r, q.b))

  /** Which part of the picked area is under the pointer: an edge or corner to resize, the inside to move. */
  const handleAt = (px: number, py: number): Handle | null => {
    if (!sel) return null
    const q = screenRect(sel), m = 7
    if (px < q.l - m || px > q.r + m || py < q.t - m || py > q.b + m) return null
    const l = Math.abs(px - q.l) < m, r = Math.abs(px - q.r) < m, t = Math.abs(py - q.t) < m, b = Math.abs(py - q.b) < m
    if (l && t) return 'lt'
    if (r && t) return 'rt'
    if (l && b) return 'lb'
    if (r && b) return 'rb'
    if (l) return 'l'
    if (r) return 'r'
    if (t) return 't'
    if (b) return 'b'
    return 'move'
  }

  useEffect(() => {
    const c = ref.current!
    const dpr = window.devicePixelRatio || 1
    c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = '#0d0e12'; g.fillRect(0, 0, c.clientWidth, c.clientHeight)
    const { s, ox, oy } = view.current
    g.imageSmoothingEnabled = s < 2
    g.drawImage(img as CanvasImageSource, ox, oy, MAP.size * s, MAP.size * s)
    for (const h of holes) {
      const [x, y] = screen(h.x, h.z)
      g.fillStyle = h.kind === 'fall' ? '#ff5a5a' : '#ffb02e'
      g.beginPath(); g.arc(x, y, Math.max(2.5, Math.sqrt(h.area) / MAP.cell * s / 2), 0, Math.PI * 2); g.fill()
    }
    const shown = pick ?? sel
    if (!shown) return
    const q = screenRect(shown)
    const [w, d] = size(shown), big = Math.max(w, d) > MAX_SIDE
    // While drawing or changing it: the largest area allowed, dashed, round its middle.
    if (pick || editing) {
      const lim = screenRect(around((shown.x0 + shown.x1) / 2, (shown.z0 + shown.z1) / 2, MAX_SIDE / 2))
      g.setLineDash([6, 5]); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.5
      g.strokeRect(lim.l, lim.t, lim.r - lim.l, lim.b - lim.t)
      g.setLineDash([])
    }
    g.fillStyle = big ? 'rgba(255,80,80,0.12)' : 'rgba(255,61,216,0.10)'
    g.fillRect(q.l, q.t, q.r - q.l, q.b - q.t)
    g.strokeStyle = big ? '#ff5a5a' : pick ? '#ffffff' : '#ff3dd8'; g.lineWidth = 2
    g.strokeRect(q.l, q.t, q.r - q.l, q.b - q.t)
    if (!pick) {
      g.fillStyle = '#ffffff'
      for (const [hx, hy] of [[q.l, q.t], [q.r, q.t], [q.l, q.b], [q.r, q.b], [(q.l + q.r) / 2, q.t], [(q.l + q.r) / 2, q.b], [q.l, (q.t + q.b) / 2], [q.r, (q.t + q.b) / 2]]) g.fillRect(hx - 3.5, hy - 3.5, 7, 7)
    }
    // Its size, on it.
    const label = `${w} × ${d} m${big ? ` (over ${MAX_SIDE} m)` : ''}`
    g.font = '600 12px system-ui, sans-serif'
    const tw = g.measureText(label).width
    g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(q.l, q.t - 20, tw + 10, 18)
    g.fillStyle = big ? '#ff8a8a' : '#ffffff'; g.fillText(label, q.l + 5, q.t - 7)
  })

  return (
    <canvas ref={ref} className="city-map" style={{ cursor }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        const h = e.button === 0 && !e.shiftKey ? handleAt(...local(e)) : null
        if (h && sel) { drag.current = { kind: 'edit', handle: h, from: screenRect(sel), x: e.clientX, y: e.clientY, ox: 0, oy: 0 }; setEditing(true); return }
        drag.current = { kind: e.button === 0 && !e.shiftKey ? 'pick' : 'pan', x: e.clientX, y: e.clientY, ox: view.current.ox, oy: view.current.oy }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) { const h = handleAt(...local(e)); setCursor(h ? CURSOR[h] : 'crosshair'); return }
        if (d.kind === 'pan') { view.current.ox = d.ox + e.clientX - d.x; view.current.oy = d.oy + e.clientY - d.y; redraw((n) => n + 1); return }
        if (d.kind === 'edit' && d.from && d.handle) {
          const dx = e.clientX - d.x, dy = e.clientY - d.y, q = { ...d.from }, h = d.handle
          if (h === 'move') { q.l += dx; q.r += dx; q.t += dy; q.b += dy }
          if (h.includes('l')) q.l += dx
          if (h.includes('r')) q.r += dx
          if (h.includes('t')) q.t += dy
          if (h.includes('b')) q.b += dy
          // Dragged past the other side: it turns round rather than going inside out.
          onSelect(fromScreen({ l: Math.min(q.l, q.r), r: Math.max(q.l, q.r), t: Math.min(q.t, q.b), b: Math.max(q.t, q.b) }))
          return
        }
        setPick(rectOf(gameAt({ clientX: d.x, clientY: d.y }), gameAt(e)))
      }}
      onPointerUp={(e) => {
        const d = drag.current
        drag.current = null
        setEditing(false)
        if (!d || d.kind !== 'pick') return
        setPick(null)
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) { const [x, z] = gameAt(e); onSelect(around(x, z, 60)) } else onSelect(rectOf(gameAt({ clientX: d.x, clientY: d.y }), gameAt(e)))
      }}
      onWheel={(e) => {
        const b = ref.current!.getBoundingClientRect()
        const v = view.current, k = e.deltaY < 0 ? 1.25 : 0.8
        const px = e.clientX - b.left, py = e.clientY - b.top
        v.ox = px - (px - v.ox) * k; v.oy = py - (py - v.oy) * k; v.s *= k
        redraw((n) => n + 1)
      }}
    />
  )
}
