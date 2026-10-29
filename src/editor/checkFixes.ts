// Running the Check tab's fixes (checkIssues.ts): one at a time from its line, or every one at once as a
// single undo step (Fix all), then the health check again so the list shows what is left.
import { JOB_TIME_LIMIT, editJob, isCurrent, startRun, useEditor, withoutMirror } from './store'
import { addDefaultSky, removeMarkersOfType } from './actions'
import { fixSpawnsAndWeapons } from './spawnActions'
import { addStairRamps } from './stairActions'
import { runHealthCheck, useHealth } from './health'
import type { AutoFix } from './checkIssues'

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

/** Applies one fix; returns what it did, in a few words. */
export async function runAutoFix(f: AutoFix): Promise<string> {
  switch (f.kind) {
    case 'spawns': {
      const r = await fixSpawnsAndWeapons()
      if (!r.floor) return 'no floor a player can stand on was found, so no spawns or weapons moved'
      const parts = [
        r.moved ? `${r.moved} moved somewhere players can use` : '',
        r.added.spawns ? `${plural(r.added.spawns, 'spawn')} added` : '',
        r.added.weapons ? `${plural(r.added.weapons, 'weapon')} added` : '',
      ].filter(Boolean)
      return parts.length ? parts.join(', ') : 'every spawn and weapon was already fine'
    }
    case 'ramps': {
      const n = await addStairRamps()
      return n ? `${plural(n, 'invisible ramp')} over tall stairs` : 'no stairs needed ramps'
    }
    case 'walls':
      useEditor.getState().update('Remove invisible walls', (d) => { d.settings.remove_invisible_walls = true })
      return 'invisible walls left out at export'
    case 'sky':
      await addDefaultSky()
      return 'a sky added'
    case 'removeMarkers': {
      const n = removeMarkersOfType(f.types)
      return `${plural(n, 'unused marker')} removed`
    }
  }
}

/** Runs the health check again if the map has one, keeping the overlay that is showing. */
const recheck = () => { if (useHealth.getState().report) void runHealthCheck(useHealth.getState().overlay) }

/** One fix from its line: an edit job, so Fix all waits for it rather than folding it into its own undo step. Like Fix
 *  all, mirror mode leaves it alone: a fix puts things where this map needs them, and their mirror images could land
 *  in walls or where there are no stairs. */
export async function fixOne(f: AutoFix): Promise<string> {
  const said = await editJob(() => withoutMirror(() => runAutoFix(f)))
  recheck()
  return said
}

const NAMES: Record<AutoFix['kind'], string> = { spawns: 'spawns and weapons', ramps: 'stair ramps', walls: 'invisible walls', sky: 'the sky', removeMarkers: 'unused markers' }

export interface FixAllResult { done: string[]; failed: string[] }

/** How long one fix may take before Fix all stops (a file that never loads would otherwise hold the editor). */
export const FIX_TIME_LIMIT = 120_000
/** How long Fix all waits for the edit job running: past JOB_TIME_LIMIT, so a job stopped on time lets it begin. */
export const FIX_WAIT_LIMIT = JOB_TIME_LIMIT + 30_000
const TOO_LONG = new Error('took too long')

/**
 * Every fix, as one undo step called "Fix all", with the editor locked meanwhile. A fix that fails is reported and
 * the rest still run. Stop on the cover, a fix that takes over FIX_TIME_LIMIT, or opening a map ends it: what was
 * fixed by then stays (one Undo takes it back), and the fixes left are reported as not done. It begins once the edit
 * job running then (AI edits) ends, which takes JOB_TIME_LIMIT at most; if it still hasn't after FIX_WAIT_LIMIT, it
 * fixes nothing.
 */
export async function fixAll(fixes: AutoFix[], limit = FIX_TIME_LIMIT, wait = FIX_WAIT_LIMIT): Promise<FixAllResult> {
  const done: string[] = [], failed: string[] = []
  const st = useEditor.getState()
  const id = st.project?.id
  let next = 0
  const minutes = `${Math.round(limit / 60_000)} minutes`
  const how = await st.transaction('Fix all', async () => {
    // This run ends on Stop, its time limit or a map opened; edit jobs outside it (AI edits) don't.
    const run = startRun()
    for (; next < fixes.length && isCurrent(run); next++) {
      const f = fixes[next]
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = new Promise<never>((_, fail) => { timer = setTimeout(() => fail(TOO_LONG), limit) })
      try { done.push(await Promise.race([runAutoFix(f), late])) } catch (err) {
        if (!isCurrent(run)) return
        if (err === TOO_LONG) {
          failed.push(`${NAMES[f.kind]} (took over ${minutes}, so Fix all stopped)`)
          next++
          useEditor.getState().stopTransaction()
          return
        }
        failed.push(`${NAMES[f.kind]} (${(err as Error)?.message || String(err)})`)
      } finally { clearTimeout(timer) }
    }
  }, { wait })
  // Ended early: the fix running then and the ones after it weren't done.
  if (next < fixes.length) {
    const why = how === 'busy' ? `other changes to the map took over ${Math.floor(wait / 60_000)} minutes, so Fix all didn't start`
      : useEditor.getState().project?.id !== id ? 'another map was opened' : 'stopped'
    for (; next < fixes.length; next++) failed.push(`${NAMES[fixes[next].kind]} (${why})`)
  }
  if (useEditor.getState().project?.id === id) recheck()
  return { done: [...done], failed: [...failed] }
}
