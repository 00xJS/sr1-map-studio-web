// The game's time-of-day and weather tables, read from the player's own misc.vpp_xbox2 in this browser (never
// stored or uploaded). Without them the editor offers noon only (gameLight.ts NOON).
import { gamePack } from './gameFiles'
import { openVpp } from './sr1char/vpp'
import { MISC_PACK } from './gameObjects/items'
import { readLightTables, type LightTables } from './gameLight'

let tables: Promise<LightTables | null> | null = null

/** The tables, or null without the game files (`ask` may open the folder picker). */
export function loadLightTables(ask = false): Promise<LightTables | null> {
  if (tables) return tables
  const p = (async () => {
    const file = await gamePack(MISC_PACK, ask)
    if (!file) return null
    const vpp = await openVpp(file, MISC_PACK)
    if (!vpp.has('time_of_day.xtbl') || !vpp.has('weather_time_of_day.xtbl')) return null
    const dec = new TextDecoder('latin1')
    return readLightTables(dec.decode(await vpp.read('time_of_day.xtbl')), dec.decode(await vpp.read('weather_time_of_day.xtbl')))
  })()
  tables = p
  // Try again next time when the files weren't there (or failed).
  p.then((t) => { if (!t && tables === p) tables = null }, () => { if (tables === p) tables = null })
  return p
}
