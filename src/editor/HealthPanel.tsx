// Map health: checks the map the way players will meet it (who can see whom,
// how safe each spawn is, whether red and blue get the same chances, where
// people will run) and shows the answers on the map. Simple mode gets a short
// section with the headline numbers; advanced mode a tab with the details.
import type { ReactNode } from 'react'
import { Vector3 } from 'three'
import { useEditor } from './store'
import { useBusy } from '../ui'
import { addStairRamps, isRamps } from './stairActions'
import { getViewer } from './Viewport'
import { runHealthCheck, stopHealthCheck, useHealth, useHealthStale, type OverlayKind } from './health'
import { MOVE_COLORS, RISK_COLORS } from './healthOverlay'
import { BOTS } from '../lib/analysis/analyze'
import type { HealthReport, MoveFinding, MoveKind, SpawnReport, TeamStats } from '../lib/analysis/types'

const OVERLAYS: { kind: OverlayKind; label: string; title: string; advanced?: boolean }[] = [
  { kind: 'sight', label: 'Sight lines', title: 'How much of the map sees each spot, standing; red lines are the longest sight lines (sniper lanes)' },
  { kind: 'crouch', label: 'Crouched', title: 'The same for a crouching player: where crouching hides you', advanced: true },
  { kind: 'traffic', label: 'Traffic', title: 'Where the bots ran most: where players will actually run' },
  { kind: 'spawns', label: 'Spawns', title: 'Every spawn, coloured by how safe it is, with lines from the places that can see the risky ones' },
  { kind: 'sides', label: 'Red vs blue', title: 'Which team gets to each spot first', advanced: true },
  { kind: 'moves', label: 'Getting around', title: 'Gaps that take a sprinting jump (or can’t be jumped), drops that hurt or kill, and walls only the game’s own maps let you climb' },
]

const LEGEND: Record<OverlayKind, string> = {
  off: '',
  sight: 'Blue: hidden. Red: seen from much of the map. Red lines: sniper lanes. Numbers: spawns that need a look.',
  crouch: 'As Sight lines, for a crouching player: spots that turn blue are where crouching hides you.',
  traffic: 'Purple: a few runs. Red to yellow: busier. Yellow rings: the busiest spots.',
  spawns: 'Green: safe. Yellow: could use more cover. Red: easy to camp. Click a spawn finding (or one in the Health tab) to see the places that can see it.',
  sides: 'Red or blue: the team that gets there first walking from its spawns.',
  moves: 'Blue: a gap only a sprinting jump crosses. Purple: too wide to jump. Orange: a drop that hurts. Red: a drop that kills. Yellow: a wall exported maps can’t climb. Numbers are metres.',
}

const MOVE_WORD: Record<MoveKind, string> = {
  'sprint-gap': 'Sprint-jump gaps', 'wide-gap': 'Gaps too wide to jump', 'kill-drop': 'Drops that kill', 'hurt-drop': 'Drops that hurt', 'climb-only': 'Walls you can’t climb in exported maps',
}

const RISK_WORD = { ok: 'Safe', watch: 'Needs cover', campable: 'Easy to camp' } as const
const TEAM_WORD = { red: 'Red', blue: 'Blue', shared: 'Shared' } as const

function Progress() {
  const progress = useHealth((s) => s.progress)
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="health-bar"><div style={{ width: `${Math.round((progress?.done ?? 0) * 100)}%` }} /></div>
      <div className="row small faint"><span className="grow">{progress?.text ?? 'Starting'}…</span><button className="sm quiet" onClick={stopHealthCheck}>Stop</button></div>
    </div>
  )
}

function Tile({ label, value, of, tone, title }: { label: string; value: ReactNode; of?: ReactNode; tone?: 'ok' | 'warn' | 'bad'; title?: string }) {
  return (
    <div className="health-tile" title={title}>
      <b className={tone}>{value}{of !== undefined && <span className="faint small">/{of}</span>}</b>
      <span className="small faint">{label}</span>
    </div>
  )
}

const tone = (score: number) => (score >= 80 ? 'ok' : score >= 55 ? 'warn' : 'bad')

function Headline({ r }: { r: HealthReport }) {
  const safe = r.spawns.filter((s) => s.risk === 'ok').length
  return (
    <div className="health-tiles">
      <Tile label="Overall" value={r.score} of={100} tone={tone(r.score)} title="Half spawn safety, half fairness, less for weapons or spawns nobody can walk to" />
      <Tile label="Safe spawns" value={safe} of={r.spawns.length} tone={r.spawns.length ? tone((100 * safe) / r.spawns.length) : 'bad'} title="Spawns out of sight of the enemy and a good walk from them" />
      <Tile label="Fairness" value={r.fairness.basis === 'none' ? '–' : r.fairness.score} of={r.fairness.basis === 'none' ? undefined : 100} tone={r.fairness.basis === 'none' ? undefined : tone(r.fairness.score)} title="Whether red (−Z) and blue (+Z) get the same chances" />
    </div>
  )
}

function OverlayButtons({ advanced }: { advanced?: boolean }) {
  const overlay = useHealth((s) => s.overlay)
  const set = (kind: OverlayKind) => useHealth.setState({ overlay: overlay === kind ? 'off' : kind, focus: null })
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row wrap" style={{ gap: 4 }}>
        <span className="small faint">Show on the map:</span>
        {OVERLAYS.filter((o) => advanced || !o.advanced).map((o) => (
          <button key={o.kind} className={'sm' + (overlay === o.kind ? ' on' : '')} title={o.title} onClick={() => set(o.kind)}>{o.label}</button>
        ))}
      </div>
      {overlay !== 'off' && <span className="small faint">{LEGEND[overlay]}</span>}
    </div>
  )
}

function Findings({ r, max }: { r: HealthReport; max?: number }) {
  return (
    <ul className="health-findings">
      {r.findings.slice(0, max).map((f, i) => {
        const n = /^Spawn (\d+) /.exec(f)?.[1]
        const s = n && r.spawns.find((x) => x.number === Number(n))
        if (f.startsWith('Getting around') && r.moves?.length) return <li key={i}><a href="#" onClick={(e) => { e.preventDefault(); focusMove(r.moves, 0) }} title="Show them on the map">{f}</a></li>
        return <li key={i}>{s ? <a href="#" onClick={(e) => { e.preventDefault(); focusSpawn(s) }} title="Show it on the map, with the places that can see it">{f}</a> : f}</li>
      })}
    </ul>
  )
}

/** Run / re-run controls and the state of the last check. */
function Controls() {
  const running = useHealth((s) => s.running)
  const report = useHealth((s) => s.report)
  const error = useHealth((s) => s.error)
  const stale = useHealthStale()
  const hasMap = useEditor((s) => (s.project?.scene_items.length ?? 0) > 0)
  if (running) return <Progress />
  return (
    <>
      {error && <span className="small bad">{error}</span>}
      {!report && <span className="small faint">Checks who can see whom, how safe each spawn is, whether red and blue get the same chances, and lets a few bots run around the map.</span>}
      {stale && <span className="small warn">The map changed since this check.</span>}
      <button className={report && !stale ? 'sm' : 'primary'} disabled={!hasMap} onClick={() => void runHealthCheck()}>
        {report ? 'Check again' : 'Check my map'}
      </button>
    </>
  )
}

/** Simple mode: the headline numbers, the top findings and the overlay buttons. */
export function HealthSection() {
  const report = useHealth((s) => s.report)
  const running = useHealth((s) => s.running)
  return (
    <>
    <div className="group">
      <span className="section-title">Map health <span className="chip">new</span></span>
      {report && !running && <><Headline r={report} /><Findings r={report} max={4} /><OverlayButtons /></>}
      <Controls />
      {report && !running && <button className="sm quiet more" onClick={() => useEditor.getState().set({ advanced: true, tab: 'health' })}>Every spawn and the red vs blue details →</button>}
    </div>
    <StairRamps />
    </>
  )
}

/** Advanced mode's Health tab. */
export function HealthPanel() {
  const report = useHealth((s) => s.report)
  const running = useHealth((s) => s.running)
  return (
    <div className="col">
      <div className="group">
        <span className="section-title">Map health</span>
        {report && !running && <><Headline r={report} /><Findings r={report} /><OverlayButtons advanced /></>}
        <Controls />
      </div>
      <StairRamps />
      {report && !running && <>
        <Spawns r={report} />
        <Fairness r={report} />
        <SightAndFlow r={report} />
        <GettingAround r={report} />
        <Stats r={report} />
      </>}
    </div>
  )
}

/** Shows a spawn and the places that can see it; advanced mode also selects its marker (simple mode would swap the panel). */
function focusSpawn(s: SpawnReport) {
  const st = useEditor.getState()
  const index = st.project?.markers.findIndex((m) => m.uid === s.uid) ?? -1
  useHealth.setState({ overlay: 'spawns', focus: s.number })
  if (st.advanced && index >= 0) st.select({ kind: 'marker', index })
  // Look at it from where the camera is, far enough back to see what's around.
  const v = getViewer()
  if (!v) return
  const target = new Vector3(...s.position)
  const back = v.camera.position.clone().sub(v.orbit.target)
  if (back.lengthSq() < 1e-6) back.set(1, 1, 1)
  v.orbit.target.copy(target)
  v.camera.position.copy(target).add(back.setLength(70))
  v.requestRender()
}

/** Shows one of the gaps, drops or walls on the map (with the others), the camera looking at it from where it is. */
function focusMove(moves: MoveFinding[], i: number) {
  const mv = moves[i]
  if (!mv) return
  useHealth.setState({ overlay: 'moves', focus: i })
  const v = getViewer()
  if (!v) return
  const target = new Vector3(...(mv.to ? mv.at.map((a, k) => (a + mv.to![k]) / 2) as [number, number, number] : mv.at))
  const back = v.camera.position.clone().sub(v.orbit.target)
  if (back.lengthSq() < 1e-6) back.set(1, 1, 1)
  v.orbit.target.copy(target)
  v.camera.position.copy(target).add(back.setLength(40))
  v.requestRender()
}

/** Gaps, drops and climb-only walls, by kind; click one to see it. */
function GettingAround({ r }: { r: HealthReport }) {
  const focus = useHealth((s) => s.focus)
  const overlay = useHealth((s) => s.overlay)
  const moves = r.moves ?? []
  const kinds = (Object.keys(MOVE_WORD) as MoveKind[]).filter((k) => moves.some((mv) => mv.kind === k))
  return (
    <div className="group">
      <span className="section-title">Getting around</span>
      {!moves.length
        ? <span className="small faint">No gaps to jump, no drops that hurt, and no walls that only climbing would get you up.</span>
        : kinds.map((k) => (
          <div key={k} className="col" style={{ gap: 2 }}>
            <span className="small"><span className="health-badge" style={{ background: MOVE_COLORS[k], width: 10, height: 10, display: 'inline-block', marginRight: 6 }} />{MOVE_WORD[k]}</span>
            <div className="list" style={{ maxHeight: 160 }}>
              {moves.map((mv, i) => mv.kind !== k ? null : (
                <div key={i} className={'list-item' + (overlay === 'moves' && focus === i ? ' selected' : '')} onClick={() => focusMove(moves, i)} title="Show it on the map">
                  <span className="grow small">{mv.text}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      <span className="small faint">From the game’s own numbers: a run jump clears about 2.5 m and a sprint jump 6 m; falls over 4 m hurt and 9 m kills; a jump gets you onto about 1.1 m.</span>
    </div>
  )
}

/** Stairs whose steps are too tall to walk up (common on converted or scaled-up maps): invisible ramps over them. */
function StairRamps() {
  const [run, busy] = useBusy()
  const has = useEditor((s) => !!s.project?.scene_items.some(isRamps))
  const hasMap = useEditor((s) => (s.project?.scene_items.length ?? 0) > 0)
  return (
    <div className="group">
      <span className="section-title">Stairs too tall to run up</span>
      <span className="small faint">The game’s player only steps up about 0.28 m without jumping, so taller steps (often on converted or scaled-up maps) stop you at every one. This finds those stairs and lays a see-through ramp over each: you run up it in game and never see it.</span>
      <div><button className="sm" disabled={busy || !hasMap} onClick={() => run(() => addStairRamps())}>{has ? 'Find stairs again' : 'Add invisible ramps over tall steps'}</button></div>
    </div>
  )
}

function Spawns({ r }: { r: HealthReport }) {
  const focus = useHealth((s) => (s.overlay === 'moves' ? null : s.focus))
  const order = [...r.spawns].sort((a, b) => ['campable', 'watch', 'ok'].indexOf(a.risk) - ['campable', 'watch', 'ok'].indexOf(b.risk) || a.number - b.number)
  return (
    <div className="group">
      <span className="section-title">Spawns ({r.spawns.length})</span>
      {!r.spawns.length ? <span className="small faint">No spawns yet.</span> : (
        <div className="list" style={{ maxHeight: 320 }}>
          {order.map((s) => (
            <div key={s.number} className={'list-item' + (focus === s.number ? ' selected' : '')} onClick={() => focusSpawn(s)} title="Show it on the map, with the places that can see it">
              <span className="health-badge" style={{ background: RISK_COLORS[s.risk] }}>{s.number}</span>
              <span className="grow col" style={{ gap: 0 }}>
                <span>{TEAM_WORD[s.team]} spawn {s.number}: {RISK_WORD[s.risk].toLowerCase()}</span>
                <span className="meta">{s.reasons.join(' · ')}</span>
              </span>
              <span className="meta" style={{ textAlign: 'right' }} title="Share of the map that can see it · walk from the nearest enemy spawn">
                {Math.round(s.exposure * 100)}% seen<br />{s.enemyWalkM === null ? 'no path' : `${s.enemyWalkM} m`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Fairness({ r }: { r: HealthReport }) {
  const f = r.fairness
  const rows: [string, (t: TeamStats) => string][] = [
    ['Spawns', (t) => String(t.spawns)],
    ['Walk to nearest weapon', (t) => metres(t.toWeaponM)],
    ['Walk to a power weapon', (t) => metres(t.toPowerM)],
    ['Walk to a drop-off', (t) => metres(t.toDropM)],
    ['Walk to high ground', (t) => metres(t.toHighM)],
    ['Map reached first', (t) => `${Math.round(t.territory * 100)}%`],
    ['Spawns seen by', (t) => `${Math.round(t.spawnExposure * 100)}% of the map`],
  ]
  return (
    <div className="group">
      <span className="section-title">Red vs blue{f.basis === 'halves' ? ' (the two halves)' : ''}</span>
      {f.red && f.blue && (
        <table className="mats">
          <thead><tr><th></th><th style={{ color: '#ff8f9c' }}>Red (−Z)</th><th style={{ color: '#8fb4ff' }}>Blue (+Z)</th></tr></thead>
          <tbody>{rows.map(([label, get]) => <tr key={label}><td>{label}</td><td>{get(f.red!)}</td><td>{get(f.blue!)}</td></tr>)}</tbody>
        </table>
      )}
      <ul className="health-findings">{f.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  )
}

const metres = (v: number | null) => (v === null ? '–' : `${v} m`)

function SightAndFlow({ r }: { r: HealthReport }) {
  return (
    <div className="group">
      <span className="section-title">Sight lines and traffic</span>
      <span className="small">{Math.round(r.openShare * 100)}% of the floor is wide open (half the map sees it); {Math.round(r.blindShare * 100)}% is hidden from almost everywhere.</span>
      {r.lanes.length > 0 && <span className="small">Longest sight lines: {r.lanes.map((l) => `${l.metres} m`).join(', ')}.</span>}
      {r.unreachable.length > 0 && <span className="small warn">Can't be walked to: {r.unreachable.map((u) => `${u.type.toLowerCase()} at ${u.position.map((v) => Math.round(v)).join(', ')}`).join('; ')}.</span>}
      <span className="small faint">Traffic comes from {BOTS.bots} bots making {BOTS.trips} runs between spawns, weapons and drop-offs, now and then dying and respawning where the game would put them (never within 5 m of an enemy, likelier the further from one).</span>
    </div>
  )
}

function Stats({ r }: { r: HealthReport }) {
  const ms = useHealth((s) => s.ms)
  const s = r.stats
  return (
    <p className="small faint">
      Checked {s.triangles.toLocaleString()} triangles, {s.reachable.toLocaleString()} of {s.nodes.toLocaleString()} floor spots ({r.grid.cell / 2} m apart) from {s.observers} viewpoints,
      {' '}{s.rays.toLocaleString()} rays, in {(ms / 1000).toFixed(1)} s ({Object.entries(s.ms).map(([k, v]) => `${k} ${v} ms`).join(', ')}).
    </p>
  )
}
