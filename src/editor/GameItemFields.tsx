// Settings of an "Item prop" marker: which of the game's items stands there. The names come from the player's own
// game files; only the name goes into the map. See lib/gameObjects/items.ts.
import { useEffect, useState } from 'react'
import { Field } from '../ui'
import type { Marker } from '../lib/project'
import { itemsLoaded, loadItems, MISC_PACK, type GameItem } from '../lib/gameObjects/items'
import { GameFilesButton } from './RetailMarkerFields'

type Set = (label: string, fn: (d: Marker) => void, merge?: string) => void

export function GameItemFields({ m, set }: { m: Marker; set: Set }) {
  const [list, setList] = useState<GameItem[] | null>(null)
  useEffect(() => { itemsLoaded()?.then(setList, () => {}) ?? loadItems(false).then(setList, () => {}) }, [])
  const chosen = list?.find((i) => i.name === m.item)
  return (
    <>
      <Field label="Item" hint={list ? `${list.length} items from your game. Only the name goes into the map.` : 'The names come from your own game files.'}>
        <input list="game-items" value={m.item ?? ''} placeholder={list ? 'Type part of a name to search' : 'Read the names from your game first'}
          onChange={(e) => set('Item', (d) => { d.item = e.target.value.trim(); d.label = d.item }, 'item')} />
        {list && <datalist id="game-items">{list.map((i) => <option key={i.name} value={i.name}>{i.category}</option>)}</datalist>}
      </Field>
      {!list && <GameFilesButton pack={MISC_PACK} what="item names" onReady={() => loadItems(false).then(setList)} />}
      {chosen && (
        <span className="faint small">
          {chosen.category || 'Item'}{chosen.touch ? ` · touching it runs “${chosen.touch}” (it may be picked up)` : ' · nothing happens when touched'}
          {chosen.preload ? '' : ' · its model may not be loaded in multiplayer'}
        </span>
      )}
      <span className="faint small">The game places the item itself by name, like a weapon pickup, so this map stays shareable. New: not yet tried in game.</span>
    </>
  )
}
