// The Check tab: the map's health score, then one list of everything worth fixing (checklist, health check,
// tall stairs, invisible walls), worst first, each with its own fix, and Fix all.
import { useEditor } from '../store'
import { findNow, useFindings, useHealth, useHealthStale } from '../health'
import { Controls, HealthDetails, Headline, OverlayButtons, focusSpawn } from '../HealthPanel'
import { useApplyFix, useChecklist } from '../Checklist'
import { WHY, buildIssues, autoFixes, type AutoFix, type Issue } from '../checkIssues'
import { fixAll, fixOne } from '../checkFixes'
import { getViewer } from '../Viewport'
import { More, Why } from '../More'
import * as act from '../actions'
import { py } from '../../lib/py'
import { Check, infoDialog, toast, useBusy } from '../../ui'

const MARK = ['!', '!', '•', 'i'] as const
const TONE = ['needed', 'bad', 'warn', 'tip'] as const

/** Looks at a spot from where the camera is. */
function lookAt(at: [number, number, number], distance = 25) {
  getViewer()?.lookAt(at, distance)
}

function show(what: NonNullable<Issue['show']>['what']) {
  if ('spawn' in what) {
    const s = useHealth.getState().report?.spawns.find((x) => x.number === what.spawn)
    if (s) focusSpawn(s)
  } else if ('overlay' in what) useHealth.setState({ overlay: what.overlay, focus: null })
  else lookAt(what.place)
}

/** The ranked list, built from the checklist, the last health check and its stair and wall finds. */
export function useIssues(onSamples: () => void) {
  const checklist = useChecklist()
  const { report, stairs, slivers } = useFindings()
  const removeWalls = useEditor((s) => s.project?.settings.remove_invisible_walls !== false)
  const go = useApplyFix(onSamples)
  return { issues: buildIssues({ checklist, report, stairs, slivers, removeWalls }), go }
}

export function CheckTab({ onSamples }: { onSamples: () => void }) {
  const { issues, go } = useIssues(onSamples)
  const { report } = useFindings()
  const hasMap = useEditor((s) => (s.project?.scene_items.length ?? 0) > 0)
  const running = useHealth((s) => s.running)
  const stale = useHealthStale()
  const allSettings = useEditor((s) => s.allSettings)
  const removeWalls = useEditor((s) => s.project?.settings.remove_invisible_walls !== false)
  const markers = useEditor((s) => s.project?.markers)
  const [run, busy] = useBusy()
  const fixes = autoFixes(issues)

  const doAll = () => run(async () => {
    const { done, failed } = await fixAll(fixes)
    const did = done.length ? `Fixed in one step (Undo puts it all back): ${done.join('; ')}.` : ''
    toast([did, failed.length ? `Couldn't fix: ${failed.join('; ')}.` : ''].filter(Boolean).join(' '), failed.length ? 'bad' : 'ok', 12000)
  })
  const doFix = (fix: AutoFix) => run(async () => {
    const said = await fixOne(fix)
    toast(said.charAt(0).toUpperCase() + said.slice(1) + '.', 'ok', 7000)
  })
  const find = (what: 'stairs' | 'walls') => run(async () => {
    const r = await findNow(what)
    if (!r) return
    const n = what === 'stairs' ? r.stairs! : r.slivers!.count
    toast(n ? `Found ${n}: see the list.` : what === 'stairs' ? 'No stairs too tall to walk up.' : 'No invisible walls on this map.', n ? 'info' : 'ok', 6000)
  })

  return (
    <>
      <div className="section">
        <span className="section-title">Map health</span>
        {report && !running && <><Headline r={report} /><OverlayButtons advanced={allSettings} /></>}
        <Controls />
      </div>

      <div className="section">
        <div className="row between">
          <span className="section-title">{issues.length ? `To fix (${issues.length})` : 'To fix'}</span>
          {fixes.length > 0 && <button className="sm primary" disabled={busy} onClick={doAll} title="Every fix that needs no choices, as one undo step">{busy ? 'Fixing…' : `Fix all (${fixes.length})`}</button>}
        </div>
        {!report && !running && <span className="small faint">Check my map adds sight lines, spawn safety, tall stairs and invisible walls to this list.</span>}
        {stale && report && <span className="small warn">The map changed since the last check: Check again to update the list.</span>}
        {issues.length ? (
          <ul className="issues">
            {issues.map((x) => (
              <li key={x.id} className={TONE[x.rank]}>
                <span className="mark" aria-hidden>{MARK[x.rank]}</span>
                <span className="grow stack tight">
                  <span>{x.text} {x.why && <Why>{x.why}</Why>}</span>
                  {x.places && x.places.length > 0 && (
                    <span className="small">Look at: {x.places.map((pl, i) => <button key={i} className="link" onClick={() => lookAt(pl)} aria-label={`Look at spot ${i + 1}`}>{i + 1}</button>)}</span>
                  )}
                </span>
                <span className="row issue-actions">
                  {x.show && <button className="sm quiet" onClick={() => show(x.show!.what)}>{x.show.label}</button>}
                  {x.auto && <button className="sm" disabled={busy} onClick={() => doFix(x.auto!.fix)}>{x.auto.label}</button>}
                  {x.go && <button className="sm" onClick={() => go(x.go!.fix)}>{x.go.label}</button>}
                </span>
              </li>
            ))}
          </ul>
        ) : <span className="small ok">Nothing to fix{report ? '' : ' on the checklist'}.</span>}
        <div className="row wrap">
          <span className="small muted">Check one thing now:</span>
          <button className="sm quiet" disabled={busy || !hasMap} onClick={() => find('stairs')} title={WHY.stairs}>Find stairs</button>
          <button className="sm quiet" disabled={busy || !hasMap} onClick={() => find('walls')} title={WHY.walls}>Find invisible walls</button>
          <button className="sm quiet" disabled={busy || !hasMap} onClick={() => doFix({ kind: 'spawns' })} title={WHY.spawns}>Fix spawns and weapons</button>
        </div>
      </div>

      <div className="section">
        <span className="section-title">When it's built</span>
        <div data-setting="Remove invisible walls">
          <Check checked={removeWalls} onChange={(v) => useEditor.getState().update('Remove invisible walls', (d) => { d.settings.remove_invisible_walls = v })}>
            <span className="stack tight"><span>Remove invisible walls</span><span className="faint small">Leaves paper-thin triangles out of the collision, so players don't bump into nothing.</span></span>
          </Check>
        </div>
      </div>

      <More id="check" title="Every detail">
        <HealthDetails />
        <div className="section">
          <span className="section-title">More checks</span>
          <div className="row wrap">
            <button className="sm" disabled={busy} onClick={() => run(async () => infoDialog('Marker check', (await py.sceneOp<string[]>('validate_markers', { markers })).join('\n')))}>Check markers</button>
            <button className="sm" disabled={busy} onClick={() => run(async () => infoDialog('Scene audit', <pre>{await act.sceneAudit()}</pre>))}>Audit objects</button>
            <button className="sm" disabled={busy} onClick={() => run(async () => infoDialog('Check breakables', <pre>{await act.checkBreakables()}</pre>))}>Check breakables</button>
          </div>
        </div>
      </More>
    </>
  )
}
