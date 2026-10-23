// Item props: small objects the game places by name in a map's CTS (#Items), the way it places weapon pickups.
// The names and their details come from the player's own game files (items_3d.xtbl in misc.vpp_xbox2), read in
// this browser; only the chosen name goes into the map (py/item_props.py writes it), so a map that uses one can
// be shared like one with a vehicle spawn. Not yet tried in game.
import { gamePack } from '../gameFiles'
import { openVpp } from '../sr1char/vpp'

export const ITEM_PROP = 'Item prop'
export const MISC_PACK = 'misc.vpp_xbox2'
const TABLE = 'items_3d.xtbl'

export interface GameItem {
  name: string
  /** The table's editor category. */
  category: string
  /** Its model is loaded when the game starts (likelier to show in multiplayer). */
  preload: boolean
  /** What touching it does (a pickup script), '' for nothing. */
  touch: string
}

const tag = (block: string, t: string) => block.match(new RegExp(`<${t}>([^<]*)</${t}>`, 'i'))?.[1].trim() ?? ''

/** The items in an items_3d.xtbl (plain XML: one <Item> per item). */
export function parseItems(xml: string): GameItem[] {
  const out: GameItem[] = []
  for (const m of xml.matchAll(/<Item>([\s\S]*?)<\/Item>/gi)) {
    const block = m[1], name = tag(block, 'Name')
    if (!name || !/^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,47}$/.test(name)) continue
    out.push({ name, category: tag(block, 'Category'), preload: /<Preload>\s*true\s*<\/Preload>/i.test(block), touch: tag(block, 'Touch_Script') })
  }
  return out
}

let items: Promise<GameItem[]> | null = null

/** The game's items, read once per tab. Null when the game files aren't available (`ask` lets the browser ask). */
export async function loadItems(ask: boolean): Promise<GameItem[] | null> {
  if (items) return items
  const file = await gamePack(MISC_PACK, ask)
  if (!file) return null
  const p = (async () => {
    const vpp = await openVpp(file, MISC_PACK)
    if (!vpp.has(TABLE)) throw new Error(`${TABLE} isn't in ${MISC_PACK}`)
    return parseItems(new TextDecoder().decode(await vpp.read(TABLE))).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  })()
  items = p
  p.catch(() => { if (items === p) items = null })
  return p
}

export const itemsLoaded = () => items
