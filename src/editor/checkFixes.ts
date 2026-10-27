// Running the Check tab's fixes (checkIssues.ts): one at a time from its line, or every one at once as a
// single undo step (Fix all), then the health check again so the list shows what is left.
import { useEditor } from './store'
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

export async function fixOne(f: AutoFix): Promise<string> {
  const said = await runAutoFix(f)
  recheck()
  return said
}

/** Every fix, as one undo step called "Fix all". Returns what each did. */
export async function fixAll(fixes: AutoFix[]): Promise<string[]> {
  const said: string[] = []
  await useEditor.getState().transaction('Fix all', async () => {
    for (const f of fixes) said.push(await runAutoFix(f))
  })
  recheck()
  return said
}
