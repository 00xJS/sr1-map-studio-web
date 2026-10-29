// The checks a map built from game models gets once it is open (the wizard's "Game pieces"): invisible ramps over
// stairs too tall to run up, the invisible walls its models bring, and the health check. What they find, with
// what the wizard found while building it, goes in one summary in the editor's log and a toast.
import { editJob, isCurrent, mapRun, useEditor } from './store'
import { addStairRamps, solidTriangles } from './stairActions'
import { runHealthCheck, useHealth } from './health'
import { findSlivers } from '../lib/invisibleWalls'
import { toast, toastError } from '../ui'

/** Runs the checks on the open map; `found`: what the wizard noted while building it. Returns the summary's lines. */
export async function runMapChecks(found: string[] = []): Promise<string[]> {
  // For this map only: once another opens, its tab, health check and toast are left alone.
  const run = mapRun()
  // An edit job: Fix all (the Check tab opens below) waits for the ramps rather than folding them into its step.
  const ramps = await editJob(addStairRamps).catch((e) => { toastError(e); return 0 })
  const project = useEditor.getState().project
  if (!isCurrent(run)) return []
  const walls = project ? await solidTriangles(project).then((t) => findSlivers(t.tris, t.flags)).catch(() => null) : null
  if (!isCurrent(run)) return []
  useEditor.getState().set({ tab: 'check' })
  // The score and findings only: the sight-lines colours stay off the floor until the player asks for them.
  await runHealthCheck('off')
  if (!isCurrent(run)) return []
  const report = useHealth.getState().report
  const removed = useEditor.getState().project?.settings.remove_invisible_walls !== false
  const lines = [
    report ? `Health ${report.score}/100${report.findings[0] ? `: ${report.findings[0]}` : ''} (Check tab: Sight lines shows it on the map).` : 'The health check didn\'t finish (Check tab → Check again).',
    ...(ramps ? [`${ramps} flight${ramps === 1 ? '' : 's'} of stairs too tall to run up got invisible ramps.`] : []),
    ...(walls?.count ? [`${walls.count} invisible wall${walls.count === 1 ? '' : 's'} (paper-thin triangles in the models): ${removed ? 'left out of the collision at export' : 'kept at export, as Remove invisible walls is off'}.`] : []),
    ...found,
  ]
  useEditor.getState().log('Map checks: ' + lines.join(' '))
  const problems = (report && report.score < 60) || found.length
  toast('Map checks: ' + lines.join(' '), problems ? 'info' : 'ok', 12000)
  return lines
}
