// The "Map wizard" tab of the Start a map dialog: pick a setting, a layout,
// how many players and how busy, see it from above, reroll until you like it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { DENSITY, LAYOUTS, SETTINGS, busyLabel, busyOf, densityFor, newSeed, wizardSample, type WizardLayout, type WizardOptions, type WizardSetting } from '../lib/mapWizard'
import { mapSize } from '../lib/sampleScale'
import type { Sample } from '../lib/sampleKit'
import { NeedGameFolder, buildIndex, connect, loadIndex, useGameObjects } from '../lib/gameObjects/client'
import { gamePiecesSuit } from '../lib/gameObjects/wizardPieces'
import { GameCity } from '../lib/gameObjects/wizardModules'
import { loadLabels, useGameLabels } from '../lib/gameObjects/labels'
import { Link } from 'react-router-dom'
import { toastError } from '../ui'
import type { Preview } from '../lib/wizardPreview'

const PLAYERS = [4, 6, 8, 10, 12]
const GROUND_COLORS: Record<string, string> = {
  Road: '#26272b', Junction: '#26272b', 'Lane dash': '#c9c6bd', 'Edge line': '#8a887f', 'Centre line': '#b38a10', Crosswalk: '#c9c6bd',
  Sidewalk: '#6d6a64', Kerb: '#86837c', Lot: '#57544f', Lawn: '#3d5a2a', Path: '#7d776d', Pond: '#1f5470',
}

/** Top-down sketch of a generated map, laid out like its minimap (+X right, +Z down). */
export function Sketch({ s }: { s: Sample }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const g = c.getContext('2d')!
    const size = c.width
    const groundPart = s.parts.find((p) => p.label === 'Ground')
    const span = Math.max(groundPart?.size[0] ?? 100, groundPart?.size[2] ?? 100) + 6
    const k = size / span
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = '#101014'
    g.fillRect(0, 0, size, size)
    g.setTransform(k, 0, 0, k, size / 2, size / 2)
    const top = (p: Sample['parts'][number]) => p.at[1] + p.size[1]
    const ordered = s.parts.filter((p) => p.label !== 'Ground').sort((a, b) => top(a) - top(b))
    if (groundPart) {
      g.fillStyle = s.theme === 'Cyber' ? '#1b1d2e' : s.theme === 'Urban paintball' ? '#35522a' : '#3a3c40'
      g.fillRect(-groundPart.size[0] / 2, -groundPart.size[2] / 2, groundPart.size[0], groundPart.size[2])
    }
    for (const p of ordered) {
      const h = Math.min(1, Math.max(0, (top(p) - 1) / 24))
      const raised = /Platform|Ramp|Deck/.test(p.label)
      // Streets, sidewalks and green ground in their own colours; terrain shaded by its highest point.
      const flat = GROUND_COLORS[p.label]
      g.fillStyle = flat ? flat
        : p.game ? `hsl(160 28% ${34 + h * 40}%)`
        : p.kind === 'terrain' ? `hsl(95 30% ${26 + Math.min(1, Math.max(0, ...(p.heights ?? [0])) / 12) * 22}%)`
          : raised ? `hsl(38 45% ${42 + h * 30}%)`
            : s.theme === 'Cyber' ? `hsl(280 45% ${30 + h * 45}%)`
              : `hsl(215 12% ${38 + h * 45}%)`
      g.save()
      g.translate(p.at[0], p.at[2])
      g.rotate((-(p.rot ?? 0) * Math.PI) / 180)
      if (p.kind === 'cylinder') { g.beginPath(); g.ellipse(0, 0, p.size[0] / 2, p.size[2] / 2, 0, 0, Math.PI * 2); g.fill() }
      else if (p.kind === 'blob' && p.outline) { g.beginPath(); p.outline.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z))); g.closePath(); g.fill() }
      else g.fillRect(-p.size[0] / 2, -p.size[2] / 2, p.size[0], p.size[2])
      g.restore()
    }
    const dot = (color: string, r: number) => (p: number[]) => { g.fillStyle = color; g.beginPath(); g.arc(p[0], p[2], r / k, 0, Math.PI * 2); g.fill() }
    for (const [type, p] of s.markers) {
      if (type === 'Red team spawn') dot('#ff4d4d', 3.5)(p)
      else if (type === 'Blue team spawn') dot('#4d8dff', 3.5)(p)
      else if (type === 'Shared spawn') dot('#f2f2f2', 2.5)(p)
      else if (type === 'Weapon pickup') dot('#ffd23f', 2.5)(p)
      else if (type === 'Chains drop-off') dot('#3dff9a', 3.5)(p)
    }
  }, [s])
  return <canvas ref={ref} width={420} height={420} style={{ width: '100%', maxWidth: 420, aspectRatio: '1', borderRadius: 8, display: 'block' }} />
}

export function MapWizard({ busy, onCreate, onBlank, initial }: { busy: boolean; onCreate: (s: Sample) => void; onBlank?: () => void; initial?: WizardOptions }) {
  const [o, setO] = useState<WizardOptions>(() => initial ?? { setting: 'downtown', layout: 'blocks', players: 10, density: 'normal', seed: newSeed() })
  const [name, setName] = useState(initial?.name ?? '')
  const set = (patch: Partial<WizardOptions>) => setO((x) => ({ ...x, ...patch }))
  const [useGame, setUseGame] = useState(false)
  const entries = useGameObjects((s) => s.entries)
  // The library is read from this browser when there is one (no game files needed for that).
  // The player's own labels for the models (Check game pieces) are picked by too.
  const { labels, version } = useGameLabels()
  useEffect(() => { void loadIndex().catch(() => {}); void loadLabels() }, [])
  const gameOn = useGame && !!entries && gamePiecesSuit(o.setting)
  // Game pieces: whole Stilwater modules and groups where the game library has them, single game models otherwise.
  const { sample, city } = useMemo(() => {
    const city = gameOn ? new GameCity(entries!, { ...o, labels, labelsVersion: version }) : undefined
    return { sample: wizardSample(o, city?.pieces), city }
  }, [o, gameOn, entries, labels, version])
  const create = async () => {
    // Placing the models needs the game files open (the browser may ask for the folder once).
    if (city) try { await connect(true) } catch (e) { toastError(e instanceof NeedGameFolder ? new Error('Choose your Saints Reborn folder so the wizard can bring in the models from your game.') : e); return }
    onCreate({ ...sample, name: name.trim() || sample.name, ...(city?.used && city.problems.length ? { problems: city.problems } : {}) })
  }
  const size = mapSize(sample)
  const level = busyOf(o)
  const count = (...t: string[]) => sample.markers.filter(([m]) => t.includes(m)).length
  return (
    <div className="wizard">
      <div className="col" style={{ gap: 12, flex: '1 1 300px', minWidth: 0 }}>
        <div className="col" style={{ gap: 6 }}>
          <span className="section-title">Setting</span>
          <div className="row wrap">
            {(Object.keys(SETTINGS) as WizardSetting[]).map((k) => (
              <button key={k} className={'sm' + (o.setting === k ? ' on' : '')} title={SETTINGS[k].hint} onClick={() => set({ setting: k })}>{SETTINGS[k].icon} {SETTINGS[k].label}</button>
            ))}
          </div>
          <span className="faint small">{SETTINGS[o.setting].hint}</span>
        </div>
        <div className="col" style={{ gap: 6 }}>
          <span className="section-title">Layout</span>
          <div className="row wrap">
            {(Object.keys(LAYOUTS) as WizardLayout[]).map((k) => (
              <button key={k} className={'sm' + (o.layout === k ? ' on' : '')} title={LAYOUTS[k].hint} onClick={() => set({ layout: k })}>{LAYOUTS[k].label}</button>
            ))}
          </div>
          <span className="faint small">{LAYOUTS[o.layout].hint}</span>
          {o.layout === 'neighbourhood' && (
            <label className="row small" title="Wooded hills along the side walls and a raised plaza in the park; every slope walkable">
              <input type="checkbox" checked={o.terrain !== false} onChange={(e) => set({ terrain: e.target.checked })} /> Hills and a raised plaza
            </label>
          )}
        </div>
        <div className="row wrap" style={{ gap: 16 }}>
          <div className="col" style={{ gap: 6 }}>
            <span className="section-title">Players</span>
            <div className="row">
              {PLAYERS.map((n) => <button key={n} className={'sm' + (o.players === n ? ' on' : '')} onClick={() => set({ players: n })}>{n}</button>)}
            </div>
          </div>
          <label className="col grow" style={{ gap: 6, minWidth: 200 }}>
            <span className="section-title">How busy <span className="faint">{busyLabel(level)}</span></span>
            <input type="range" min={0} max={100} step={5} value={level} list="wizard-busy" onChange={(e) => set({ busy: +e.target.value, density: densityFor(+e.target.value) })}
              title="How much is built and how many props: Open, Normal, Packed, up to about three times Packed" />
            <datalist id="wizard-busy">{Object.values(DENSITY).map((d) => <option key={d.label} value={d.busy} label={d.label} />)}</datalist>
            <span className="row faint small" style={{ justifyContent: 'space-between' }}><span>Open</span><span>Packed</span><span>3× packed</span></span>
          </label>
        </div>
        <GamePiecesChoice on={useGame} setOn={setUseGame} suits={gamePiecesSuit(o.setting)} city={city} />
        <label className="col" style={{ gap: 6 }}>
          <span className="section-title">Name</span>
          <input value={name} placeholder={sample.name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <div className="row wrap">
          <button onClick={() => set({ seed: newSeed() })} disabled={busy} title="Same choices, a different map">🎲 Reroll</button>
          <button className="primary" disabled={busy} onClick={() => void create()}>Create this map</button>
          {onBlank && <button className="link small" disabled={busy} onClick={onBlank}>or start blank</button>}
        </div>
      </div>
      <div className="col" style={{ gap: 6, flex: '1 1 300px', alignItems: 'stretch', minWidth: 0 }}>
        <MapPreview sample={sample} busy={busy} onReroll={() => set({ seed: newSeed() })} onCreate={() => void create()} />
        <Sketch s={sample} />
        <span className="small muted">
          {size.widthM} × {size.depthM} m · about {size.players} players · {count('Red team spawn', 'Blue team spawn', 'Shared spawn')} spawns · {count('Weapon pickup')} weapons
        </span>
        <span className="faint small">
          <span style={{ color: '#ff4d4d' }}>●</span> red <span style={{ color: '#4d8dff' }}>●</span> blue <span style={{ color: '#f2f2f2' }}>●</span> anyone{' '}
          <span style={{ color: '#ffd23f' }}>●</span> weapon <span style={{ color: '#3dff9a' }}>●</span> chains drop-off · lighter is taller, tan is a deck or ramp. Seed {o.seed}.
        </span>
      </div>
    </div>
  )
}

/** "What to build with": the site's own shapes and prefabs, or models from the player's own game. */
function GamePiecesChoice({ on, setOn, suits, city }: { on: boolean; setOn: (v: boolean) => void; suits: boolean; city?: GameCity }) {
  const { entries, status, progress } = useGameObjects()
  const [loading, setLoading] = useState(false)
  const load = async () => {
    setLoading(true)
    try { await buildIndex(true); setOn(true) } catch (e) { toastError(e) } finally { setLoading(false) }
  }
  const st = city?.pieces.stats, cs = city?.stats
  return (
    <div className="col" style={{ gap: 6 }}>
      <span className="section-title">Build with</span>
      <div className="row wrap">
        <button className={'sm' + (!on ? ' on' : '')} onClick={() => setOn(false)} title="The site's own buildings, shapes and prefabs">Site pieces</button>
        <button className={'sm' + (on ? ' on' : '')} disabled={!entries} onClick={() => setOn(true)}
          title={entries ? 'Real buildings and props from your own Saints Row game files' : 'Load your game library first'}>🎮 Game pieces</button>
      </div>
      {!entries && (
        <span className="faint small">
          Game pieces builds the map from real buildings and props in your own game. It needs your game library, read from your Saints Reborn folder on this device:{' '}
          {status === 'indexing' || loading
            ? <b>reading your game ({progress ? `${progress.done}/${progress.total || '…'}` : '…'})</b>
            : <button className="link small" onClick={() => void load()}>load my game library</button>}
          {' '}(or in the editor: Shape tool → Prefabs → From my game).
        </span>
      )}
      {on && entries && !suits && <span className="faint small">The game has nothing like the cyber grid: this setting uses the site's pieces.</span>}
      {on && entries && suits && (
        <span className="small" style={{ color: 'var(--warn, #e0b050)' }}>
          Built from models in your own game files, kept on this device: you can export this map to your game, but it can't be shared, put on the Showcase or synced.
          {city?.used && cs && st && <span className="faint">
            {' '}Built from {cs.modules} pieces of Stilwater as the game has them ({cs.names.slice(0, 3).join(', ')}{cs.names.length > 3 ? ` and ${cs.names.length - 3} more` : ''}), {cs.groups} groups
            {cs.wallProps ? `, ${cs.wallProps} wall things` : ''}, {st.props} props and {st.lights} lights ({Math.round(st.triangles / 1000)}k triangles, {st.textures} textures){cs.open ? `; ${cs.open} block${cs.open === 1 ? '' : 's'} left as open lots` : ''}.
          </span>}
          {city && !city.used && st && <span className="faint">
            {' '}{city.ready ? 'No piece of Stilwater fits this layout' : "Pieces of Stilwater aren't ready in your library yet"}, so single models go in the layout's plots:{' '}
            {st.buildings} buildings, {st.props} props, {st.lights} lights and {st.fences} fence pieces from {st.models} models ({Math.round(st.triangles / 1000)}k triangles, {st.textures} textures){st.kept ? `; ${st.kept} spots keep the site's piece where nothing fitted` : ''}.
          </span>}
          {' '}<Link to="/game-pieces" className="small">Check which models it picks →</Link>
        </span>
      )}
      {on && city?.used && city.problems.length > 0 && (
        <span className="small" style={{ color: 'var(--warn, #e0b050)' }}>Found while building it: {city.problems.join(' ')} Reroll for another, or fix it in the editor.</span>
      )}
    </div>
  )
}

/**
 * The map as it will be built, at a 3/4 angle and from above: the site's shapes and the game models' boxes first,
 * then each game model as it comes in, then the checks the editor runs once it is open (wizardPreview.ts).
 */
function MapPreview({ sample, busy, onReroll, onCreate }: { sample: Sample; busy: boolean; onReroll: () => void; onCreate: () => void }) {
  const [p, setP] = useState<Preview | null>(null)
  const [on, setOn] = useState(true)
  const [tries, setTries] = useState(0)
  useEffect(() => {
    if (!on) return
    let stop: (() => void) | null = null, gone = false
    // The last pictures stay up until the new ones come; its checks don't.
    setP((q) => q && { angle: q.angle, top: q.top, stage: 'shells', models: [0, 0] })
    // A moment's pause, so dragging the busy slider doesn't start a preview per step.
    const t = setTimeout(() => void import('../lib/wizardPreview').then((m) => { if (!gone) stop = m.previewMap(sample, setP) }), 350)
    return () => { gone = true; clearTimeout(t); stop?.() }
  }, [sample, on, tries])
  const openFolder = async () => {
    try { await connect(true); setTries((n) => n + 1) } catch (e) { toastError(e instanceof NeedGameFolder ? new Error('Choose your Saints Reborn folder to see the models from your game.') : e) }
  }
  if (!on) return <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setOn(true)}>Show the 3D preview</button>
  const status = !p ? 'Drawing…'
    : p.stage === 'shells' ? 'Drawing the shapes…'
      : p.stage === 'models' ? `Bringing in models from your game (${p.models[0]}/${p.models[1]})…`
        : p.stage === 'checks' ? 'Checking it the way the editor will…' : ''
  return (
    <div className="col" style={{ gap: 6 }}>
      <div style={{ position: 'relative', background: '#101014', borderRadius: 8, aspectRatio: '1', overflow: 'hidden' }}>
        {p?.angle && <img src={p.angle} alt="The map at a 3/4 angle" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />}
        {p?.top && <img src={p.top} alt="The map from above" title="From above" style={{ position: 'absolute', right: 6, bottom: 6, width: '32%', aspectRatio: '1', background: '#0b0b0e', borderRadius: 6, border: '1px solid #2a2a30' }} />}
        {status && <span className="small faint" style={{ position: 'absolute', left: 8, top: 6 }}>{status}</span>}
      </div>
      {p?.needFolder && <span className="small faint">The game models show as boxes until this tab can read your game files: <button className="link small" onClick={() => void openFolder()}>choose your Saints Reborn folder</button>.</span>}
      {(p?.health !== undefined || p?.stairs !== undefined) && (
        <span className="small">
          {p.health !== undefined && <b style={{ color: p.health >= 70 ? 'var(--ok, #6c6)' : p.health >= 50 ? 'var(--warn, #e0b050)' : 'var(--bad, #e06060)' }}>Health {p.health}/100</b>}
          {p.findings?.length ? <span className="faint"> · {p.findings.join(' ')}</span> : null}
          {p.stairs ? <span> · {p.stairs} flight{p.stairs === 1 ? '' : 's'} of stairs too tall to run up (invisible ramps go in when it opens)</span> : null}
          {p.walls ? <span> · {p.walls} invisible wall{p.walls === 1 ? '' : 's'} (left out of the collision at export)</span> : null}
        </span>
      )}
      {p?.error && <span className="small faint">The checks couldn't run here ({p.error}); they run again once the map is open.</span>}
      <div className="row wrap" style={{ gap: 6 }}>
        <button className="sm" onClick={onReroll} disabled={busy} title="Same choices, a different map">🎲 Reroll</button>
        <button className="sm primary" onClick={onCreate} disabled={busy}>Create this map</button>
        <button className="link small" onClick={() => setOn(false)} title="Stop drawing previews (quicker rerolls)">hide preview</button>
      </div>
    </div>
  )
}
