// "Generate" in the Start a map dialog: pick a setting, a layout, how many players and how busy, see it drawn and
// checked, reroll until you like it. Each map is built in a worker (wizardClient.ts) and checked the way the editor
// checks it (wizardPreview.ts); one that scores under the bar is quietly tried again with other seeds, and the best
// of them is shown, with its score as a grade.
import { useEffect, useRef, useState } from 'react'
import { DENSITY, LAYOUTS, SETTINGS, busyLabel, busyOf, densityFor, newSeed, type WizardLayout, type WizardOptions, type WizardSetting } from '../lib/mapWizard'
import { mapSize } from '../lib/sampleScale'
import type { Sample } from '../lib/sampleKit'
import { NeedGameFolder, connect } from '../lib/gameObjects/client'
import { gamePiecesSuit } from '../lib/gameObjects/wizardPieces'
import { useGameSource, type GameSource } from './BuildWith'
import { toastError } from '../ui'
import type { Preview } from '../lib/wizardPreview'
import { PASS, TRIES, grade, nextSeeds, wizardBuild, type CityInfo, type GameLibrary } from '../lib/wizardClient'
import { FooterActions } from './FooterActions'

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

/** The player's library and labels as the worker gets them, under a key that changes when any of them does. */
const libKeys = new WeakMap<object, number>()
let libCount = 0
function libraryOf(src: GameSource): GameLibrary | null {
  if (!src.entries) return null
  let k = libKeys.get(src.entries)
  if (k === undefined) libKeys.set(src.entries, k = ++libCount)
  const { groups, modules, version } = src.cityLabels
  return { key: `${k}:${src.version}:${version}`, entries: src.entries, labels: src.labels, labelsVersion: src.version, cityLabels: { groups, modules } }
}

/** The quality gate for one set of choices: the seed the player got, and each seed's score so far. */
interface Gate { base: number; scores: [number, number][]; done: boolean }

export function MapWizard({ busy, progress = null, footer = null, onCreate, initial, game = false }: { busy: boolean; progress?: string | null; footer?: HTMLElement | null; onCreate: (s: Sample) => void; initial?: WizardOptions; game?: boolean }) {
  const [o, setO] = useState<WizardOptions>(() => initial ?? { setting: 'downtown', layout: 'blocks', players: 10, density: 'normal', seed: newSeed() })
  const [name, setName] = useState(initial?.name ?? '')
  const gate = useRef<Gate>({ base: o.seed, scores: [], done: false })
  const [, redraw] = useState(0)
  /** New choices: the gate starts again from the seed showing. */
  const set = (patch: Partial<WizardOptions>) => setO((x) => { const n = { ...x, ...patch }; gate.current = { base: n.seed, scores: [], done: false }; return n })
  const reroll = () => set({ seed: newSeed() })
  // Game pieces (chosen at the top of the dialog, BuildWith.tsx): the player's library and their labels for it.
  const src = useGameSource()
  const gameOn = game && !!src.entries && gamePiecesSuit(o.setting)
  const lib = gameOn ? libraryOf(src) : null
  // Built in the worker; the last map stays up until the next one is in.
  const [built, setBuilt] = useState<{ o: WizardOptions; sample: Sample; city?: CityInfo } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setError('')
    wizardBuild(o, lib).then((r) => { if (live) setBuilt({ o, ...r }) }, (e) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [o, lib?.key])
  /** The check's score for the map showing: under the bar, the next seed; after the last, the best of them. */
  const scored = (seed: number, health: number | null) => {
    const g = gate.current
    if (g.done || g.scores.some(([s]) => s === seed)) return
    if (health === null) { g.done = true; redraw((n) => n + 1); return }
    g.scores.push([seed, health])
    if (health >= PASS) g.done = true
    else if (g.scores.length < TRIES) setO((x) => ({ ...x, seed: nextSeeds(g.base, TRIES - 1)[g.scores.length - 1] }))
    else {
      g.done = true
      const best = g.scores.reduce((a, b) => (b[1] > a[1] ? b : a))
      if (best[0] !== seed) setO((x) => ({ ...x, seed: best[0] }))
    }
    redraw((n) => n + 1)
  }
  const sample = built?.sample, city = built?.city
  const create = async () => {
    if (!sample) return
    // Placing the models needs the game files open (the browser may ask for the folder once).
    if (city) try { await connect(true) } catch (e) { toastError(e instanceof NeedGameFolder ? new Error('Choose your Saints Reborn folder so the wizard can bring in the models from your game.') : e); return }
    onCreate({ ...sample, name: name.trim() || sample.name, ...(city?.used && city.problems.length ? { problems: city.problems } : {}) })
  }
  const g = gate.current
  const searching = !g.done && g.scores.length > 0 ? g.scores.length : 0
  const level = busyOf(o)
  const size = sample && mapSize(sample)
  const count = (...t: string[]) => (sample ? sample.markers.filter(([m]) => t.includes(m)).length : 0)
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
        {game && <GamePiecesInfo suits={gamePiecesSuit(o.setting)} city={city} />}
        <label className="col" style={{ gap: 6 }}>
          <span className="section-title">Name</span>
          <input value={name} placeholder={sample?.name ?? `${SETTINGS[o.setting].label} ${LAYOUTS[o.layout].label}`} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
      </div>
      <div className="col" style={{ gap: 6, flex: '1 1 300px', alignItems: 'stretch', minWidth: 0 }}>
        {sample && built ? <MapPreview sample={sample} seed={built.o.seed} progress={progress} searching={searching} gate={g} onScored={scored} /> : <div className="sk" style={{ aspectRatio: '1' }} aria-busy="true" />}
        {error && <span className="small warn">The wizard couldn't build this one ({error}). Reroll for another.</span>}
        {sample ? <Sketch s={sample} /> : <div className="sk" style={{ aspectRatio: '1', maxWidth: 420 }} />}
        {size && (
          <span className="small muted">
            {size.widthM} × {size.depthM} m · about {size.players} players · {count('Red team spawn', 'Blue team spawn', 'Shared spawn')} spawns · {count('Weapon pickup')} weapons
          </span>
        )}
        <span className="faint small">
          <span style={{ color: '#ff4d4d' }}>●</span> red <span style={{ color: '#4d8dff' }}>●</span> blue <span style={{ color: '#f2f2f2' }}>●</span> anyone{' '}
          <span style={{ color: '#ffd23f' }}>●</span> weapon <span style={{ color: '#3dff9a' }}>●</span> chains drop-off · lighter is taller, tan is a deck or ramp. Seed {o.seed}.
        </span>
      </div>
      <FooterActions footer={footer}>
        <button onClick={reroll} disabled={busy} title="Same choices, a different map">🎲 Reroll</button>
        <button className="primary" disabled={busy || !sample || built?.o !== o} onClick={() => void create()}>Create this map</button>
      </FooterActions>
    </div>
  )
}

/** What the wizard built from the player's game: the Stilwater pieces it used, or the single models in its plots. */
function GamePiecesInfo({ suits, city }: { suits: boolean; city?: CityInfo }) {
  const st = city?.pieces.stats, cs = city?.stats
  return (
    <div className="col" style={{ gap: 6 }}>
      {!suits && <span className="faint small">The game has nothing like the cyber grid: this setting uses the site's pieces.</span>}
      {suits && city && (
        <span className="small faint">
          {city.used && cs && st && <>
            Built from {cs.modules} pieces of Stilwater as the game has them ({cs.names.slice(0, 3).join(', ')}{cs.names.length > 3 ? ` and ${cs.names.length - 3} more` : ''}), {cs.groups} groups
            {cs.wallProps ? `, ${cs.wallProps} wall things` : ''}, {st.props} props and {st.lights} lights ({Math.round(st.triangles / 1000)}k triangles, {st.textures} textures){cs.open ? `; ${cs.open} block${cs.open === 1 ? '' : 's'} left as open lots` : ''}.
          </>}
          {!city.used && st && <>
            {city.ready ? 'No piece of Stilwater fits this layout' : "Pieces of Stilwater aren't ready in your library yet"}, so single models go in the layout's plots:{' '}
            {st.buildings} buildings, {st.props} props, {st.lights} lights and {st.fences} fence pieces from {st.models} models ({Math.round(st.triangles / 1000)}k triangles, {st.textures} textures){st.kept ? `; ${st.kept} spots keep the site's piece where nothing fitted` : ''}.
          </>}
        </span>
      )}
      {city?.used && city.problems.length > 0 && (
        <span className="small" style={{ color: 'var(--warn, #e0b050)' }}>Found while building it: {city.problems.join(' ')} Reroll for another, or fix it in the editor.</span>
      )}
    </div>
  )
}

/** How far the preview has got, 0..1, for its bar. */
const stageDone = (p: Preview | null) => !p ? 0.05 : p.stage === 'shells' ? 0.15 : p.stage === 'models' ? 0.15 + 0.6 * (p.models[1] ? p.models[0] / p.models[1] : 1) : p.stage === 'checks' ? 0.85 : 1

/**
 * The map as it will be built, at a 3/4 angle and from above: the site's shapes and the game models' boxes first,
 * then each game model as it comes in, then the checks the editor runs once it is open (wizardPreview.ts). Its
 * health goes to `onScored` for the quality gate; while the map is being built, its progress is drawn over it.
 */
function MapPreview({ sample, seed, progress, searching, gate, onScored }: { sample: Sample; seed: number; progress: string | null; searching: number; gate: Gate; onScored: (seed: number, health: number | null) => void }) {
  const [p, setP] = useState<Preview | null>(null)
  const [tries, setTries] = useState(0)
  const report = useRef(onScored)
  report.current = onScored
  useEffect(() => {
    let stop: (() => void) | null = null, gone = false, told = false
    // The last pictures stay up until the new ones come; its checks don't.
    setP((q) => q && { angle: q.angle, top: q.top, stage: 'shells', models: [0, 0] })
    const update = (q: Preview) => {
      setP(q)
      if (q.stage === 'done' && !told) { told = true; report.current(seed, q.health ?? null) }
    }
    // A moment's pause, so dragging the busy slider doesn't start a preview per step.
    const t = setTimeout(() => void import('../lib/wizardPreview').then((m) => { if (!gone) stop = m.previewMap(sample, update) }), 350)
    return () => { gone = true; clearTimeout(t); stop?.() }
  }, [sample, tries])
  const openFolder = async () => {
    try { await connect(true); setTries((n) => n + 1) } catch (e) { toastError(e instanceof NeedGameFolder ? new Error('Choose your Saints Reborn folder to see the models from your game.') : e) }
  }
  const status = !p ? 'Drawing…'
    : p.stage === 'shells' ? 'Drawing the shapes…'
      : p.stage === 'models' ? `Bringing in models from your game (${p.models[0]}/${p.models[1]})…`
        : p.stage === 'checks' ? 'Checking it the way the editor will…' : ''
  const shown = gate.scores.find(([s]) => s === seed)?.[1] ?? p?.health
  const tried = gate.done && gate.scores.length > 1 ? gate.scores.length : 0
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="preview-box">
        {p?.angle ? <img src={p.angle} alt="The map at a 3/4 angle" className="preview-angle" /> : <div className="sk preview-fill" />}
        {p?.top && <img src={p.top} alt="The map from above" title="From above" className="preview-top" />}
        {!progress && (status || searching > 0) && (
          <div className="preview-bar">
            <span className="small">{searching ? `Scored ${gate.scores[searching - 1][1]}, under ${PASS}: trying another seed (${searching + 1} of ${TRIES})…` : status}</span>
            <div className="progress determinate"><div style={{ width: `${Math.round(stageDone(p) * 100)}%` }} /></div>
          </div>
        )}
        {progress && (
          <div className="preview-building" role="status">
            <span className="small">{progress}</span>
            <div className="progress"><div /></div>
          </div>
        )}
      </div>
      {p?.needFolder && <span className="small faint">The game models show as boxes until this tab can read your game files: <button className="link small" onClick={() => void openFolder()}>choose your Saints Reborn folder</button>.</span>}
      {(shown !== undefined || p?.stairs !== undefined) && (
        <span className="small">
          {shown !== undefined && <b className={'grade grade-' + grade(shown)} title={`Health ${shown}/100 on the editor's health check`}>Grade {grade(shown)} · {shown}/100</b>}
          {tried > 0 && <span className="faint"> · the best of {tried} seeds</span>}
          {p?.findings?.length ? <span className="faint"> · {p.findings.join(' ')}</span> : null}
          {p?.stairs ? <span> · {p.stairs} flight{p.stairs === 1 ? '' : 's'} of stairs too tall to run up (invisible ramps go in when it opens)</span> : null}
          {p?.walls ? <span> · {p.walls} invisible wall{p.walls === 1 ? '' : 's'} (left out of the collision at export)</span> : null}
        </span>
      )}
      {p?.error && <span className="small faint">The checks couldn't run here ({p.error}); they run again once the map is open.</span>}
    </div>
  )
}
