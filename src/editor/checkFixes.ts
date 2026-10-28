// Running the Check tab's fixes (checkIssues.ts): one at a time from its line, or every one at once as a
// single undo step (Fix all), then the health check again so the list shows what is left.
import { useEditor, withoutMirror } from './store'
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

/** One fix from the Check tab. Like Fix all, mirror mode leaves it alone: a fix puts things where this map needs
 *  them, and their mirror images could land in walls or where there are no stairs. */
export async function fixOne(f: AutoFix): Promise<string> {
  const said = await withoutMirror(() => runAutoFix(f))
  recheck()
  return said
}

const NAMES: Record<AutoFix['kind'], string> = { spawns: 'spawns and weapons', ramps: 'stair ramps', walls: 'invisible walls', sky: 'the sky', removeMarkers: 'unused markers' }

export interface FixAllResult { done: string[]; failed: string[] }

/**
 * Every fix, as one undo step called "Fix all", with the editor locked meanwhile. A fix that fails is reported and
 * the rest still run; if another map is opened meanwhile, the fixes left stop.
 */
export async function fixAll(fixes: AutoFix[]): Promise<FixAllResult> {
  const out: FixAllResult = { done: [], failed: [] }
  const id = useEditor.getState().project?.id
  await useEditor.getState().transaction('Fix all', async () => {
    for (const f of fixes) {
      if (useEditor.getState().project?.id !== id) { out.failed.push(NAMES[f.kind] + ' (another map was opened)'); continue }
      try { out.done.push(await runAutoFix(f)) } catch (err) {
        out.failed.push(`${NAMES[f.kind]} (${(err as Error)?.message || String(err)})`)
      }
    }
  })
  if (useEditor.getState().project?.id === id) recheck()
  return out
}
