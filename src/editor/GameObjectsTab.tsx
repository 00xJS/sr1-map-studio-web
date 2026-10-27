// The prefab browser's "From my game" tab: real Saints Row objects read from the player's own game install,
// with search, categories and pictures drawn on demand. Choosing one arms the Shape tool with "game:<id>" like a
// prefab (ghost, R to turn, click to place). Everything here stays on this device: the objects are for the
// player's own maps and can't be shared or published.
import { memo, useEffect, useMemo, useState } from 'react'
import { useEditor } from './store'
import { PrefabThumb } from './PrefabThumb'
import { toggleFavourite, usePrefabLists } from './prefabLists'
import { toast, toastError, useBusy } from '../ui'
import { buildIndex, forgetIndex, loadIndex, NeedGameFolder, connect, useGameObjects } from '../lib/gameObjects/client'
import { identify } from '../lib/gameObjects/identity'
import { CATEGORIES } from '../lib/gameObjects/classify'
import type { GameObjectEntry } from '../lib/gameObjects/indexer'
import { canPickFolder } from '../lib/gameFiles'
import { missingInProject, rebuildMissing } from './gameObjectActions'
import { normalize } from '../lib/prefabIndex'
import { describeEntry, displayName, tagsFor, tagsOf } from '../lib/gameObjects/tags'
import { AMBIENCE_OPTIONS } from '../lib/mapFeatures'
import type { MapSummary } from '../lib/gameObjects/indexer'

/** A retail map's name as players know it: "The Corner (mp_bac_01)". */
export function mapLabel(stem: string): string {
  // The copies the game renders its minimaps from carry the map's name plus _mm or _minimap.
  const mm = stem.match(/^(.+?)_(mm|minimap)$/)
  if (mm) return mapLabel(mm[1]).replace(/ \((.+)\)$/, `, minimap version (${stem})`)
  return AMBIENCE_OPTIONS.find((o) => o.file === 'amb_' + stem)?.label ?? stem
}
const CITY = 'city'

/** One line about what a retail map holds. */
function mapLine(m: MapSummary | undefined, objects: number): string {
  if (!m) return `${objects.toLocaleString()} objects`
  const w = Math.round(m.extent[2] - m.extent[0]), d = Math.round(m.extent[3] - m.extent[1])
  return `${objects.toLocaleString()} different objects · ${m.records.toLocaleString()} placed (${m.instances.toLocaleString()} pieces) · ${m.lights} lights · ${m.sky ? "the game's sky" : 'no sky of its own'} · about ${w} × ${d} m · ${m.textures} textures`
}

const PAGE = 120
export const GAME_TAB = 'From my game'
export const NOTICE = 'From your game files: usable in your own maps, not shareable.'

export interface GameTile { shape: string; label: string; hint: string }

/** What the game places it with (identify(): its parts, the whole it belongs to, its usual neighbours), in words. */
const indexes = new WeakMap<GameObjectEntry[], Map<string, GameObjectEntry>>()
function companions(e: GameObjectEntry): string {
  const all = useGameObjects.getState().entries ?? []
  let by = indexes.get(all)
  if (!by) indexes.set(all, (by = new Map(all.map((x) => [x.id, x]))))
  const name = (id: string) => { const o = by!.get(id); return o ? displayName(o).toLowerCase() : '' }
  const id = identify(e), out: string[] = []
  if (id.assembly?.length) out.push('comes with ' + [...new Set(id.assembly.map((p) => name(p.id)).filter(Boolean))].join(', '))
  if (id.partOf) out.push('part of a ' + name(id.partOf))
  if (id.copyOf) out.push('a second copy of a ' + name(id.copyOf) + ' at the same spot')
  if (id.belongsTo?.length) out.push(`made for ${id.belongsTo.length > 1 ? 'buildings like the' : 'the'} ${name(id.belongsTo[0])} (${id.kitOf}) only`)
  if (id.layout?.length) out.push(`completed by ${id.layout.length} pieces of its own`)
  if (id.near?.length) out.push('usually near ' + [...new Set(id.near.slice(0, 4).map(name).filter(Boolean))].join(', '))
  return out.length ? ' · ' + out.join(' · ') : ''
}

export const tileOf = (e: GameObjectEntry): GameTile => ({
  shape: 'game:' + e.id,
  label: displayName(e),
  hint: `${describeEntry(e)}${companions(e)} · ${e.tris.toLocaleString()} triangles · ${NOTICE}`,
})

/** Its names, the game's own record names and its texture names (so "USPSMailBox" finds the mailbox that wears it). */
const searchText = (e: GameObjectEntry) => normalize([e.name, ...(e.names ?? []), ...(e.raw ?? []), ...(e.tex ?? []).map((t) => t.replace(/\.\w+$/, '')), e.profile, e.cat, e.chunk, displayName(e), ...tagsOf(e)].join(' ')) + ' ' + [...(e.raw ?? []), ...(e.tex ?? []), ...tagsOf(e)].join(' ').toLowerCase()

const Tile = memo(function Tile({ e, on, fav, onChoose, onHover }: { e: GameObjectEntry; on: boolean; fav: boolean; onChoose: (t: GameTile) => void; onHover: (t: GameTile | null) => void }) {
  const t = tileOf(e)
  return (
    <div className={'prefab-tile' + (on ? ' on' : '')} onMouseEnter={() => onHover(t)} onMouseLeave={() => onHover(null)}>
      <button className="prefab-pick" title={t.hint} aria-pressed={on} draggable onClick={() => onChoose(t)} onFocus={() => onHover(t)}
        onDragStart={(ev) => { ev.dataTransfer.setData('application/x-sr1-asset', t.shape); ev.dataTransfer.effectAllowed = 'copy' }}>
        <PrefabThumb shape={t.shape} />
        <span className="prefab-label">{t.label}</span>
      </button>
      <button className={'prefab-fav' + (fav ? ' on' : '')} title={fav ? 'Remove from favourites' : 'Add to favourites'} aria-label={(fav ? 'Remove from favourites: ' : 'Add to favourites: ') + t.label} aria-pressed={fav}
        onClick={() => toggleFavourite(t.shape)}>★</button>
    </div>
  )
})

function FolderButton({ label, className = 'sm primary' }: { label: string; className?: string }) {
  const [run, busy] = useBusy()
  return (
    <button className={className} disabled={busy} onClick={() => run(async () => {
      try { await buildIndex(true) } catch (e) { if (!(e instanceof NeedGameFolder)) throw e; toastError(e) }
    })}>{label}</button>
  )
}

function Missing() {
  const project = useEditor((s) => s.project)
  const connected = useGameObjects((s) => s.connected)
  const [n, setN] = useState(0)
  const [run, busy] = useBusy()
  useEffect(() => { let live = true; missingInProject().then((m) => { if (live) setN(m.length) }, () => {}); return () => { live = false } }, [project?.scene_items.length, project?.id])
  if (!n) return null
  return (
    <div className="group small">
      <span>{n === 1 ? '1 object' : `${n} objects`} from the game in this map {n === 1 ? 'has' : 'have'} no files on this device (it came from a backup or another computer).</span>
      <button className="sm" disabled={busy} onClick={() => run(async () => { const done = await rebuildMissing(!connected); setN(0); toast(`Rebuilt ${done} object${done === 1 ? '' : 's'} from your game files.`) })}>Rebuild from my game</button>
    </div>
  )
}

export function GameObjectsTab({ query, current, onChoose, onHover }: { query: string; current: string; onChoose: (t: GameTile) => void; onHover: (t: GameTile | null) => void }) {
  const { status, entries, progress, error, connected, info } = useGameObjects()
  const [cat, setCat] = useState('All')
  const [where, setWhere] = useState('All')
  const [shown, setShown] = useState(PAGE)
  const { favs, recent } = usePrefabLists()
  useEffect(() => { void loadIndex() }, [])
  // With the index stored and the folder still allowed, open the game files quietly for the pictures.
  useEffect(() => { if (entries && !connected) connect(false).catch(() => {}) }, [entries, connected])
  useEffect(() => setShown(PAGE), [query, cat, where])

  const here = useMemo(() => (entries ?? []).filter((e) => where === 'All' || (e.where ?? [CITY]).includes(where)), [entries, where])
  const counts = useMemo(() => here.reduce((m, e) => m.set(e.cat, (m.get(e.cat) ?? 0) + 1), new Map<string, number>()), [here])
  // Every place the library has objects from: the city, then each retail multiplayer map.
  const places = useMemo(() => {
    const n = new Map<string, number>()
    for (const e of entries ?? []) for (const w of e.where ?? [CITY]) n.set(w, (n.get(w) ?? 0) + 1)
    return [...n.entries()].sort((a, b) => (a[0] === CITY ? -1 : b[0] === CITY ? 1 : mapLabel(a[0]).localeCompare(mapLabel(b[0]))))
  }, [entries])
  const texts = useMemo(() => new Map((entries ?? []).map((e) => [e.id, searchText(e)])), [entries])
  const list = useMemo(() => {
    const words = normalize(query).split(' ').filter(Boolean)
    // Everyday words count as the tags they mean ("ghetto" finds run-down things).
    const tags = tagsFor(query)
    return here.filter((e) => (cat === 'All' || e.cat === cat) && (words.every((w) => texts.get(e.id)!.includes(w)) || (tags.length > 0 && tags.every((t) => tagsOf(e).includes(t)))))
  }, [here, cat, query, texts])

  const byId = useMemo(() => new Map((entries ?? []).map((e) => [e.id, e])), [entries])
  const favSet = useMemo(() => new Set(favs), [favs])
  // The player's starred and last used objects (shapes "game:<id>"), shown first when not searching.
  const mine = (shapes: string[]) => shapes.filter((x) => x.startsWith('game:')).map((x) => byId.get(x.slice(5))).filter((e): e is GameObjectEntry => !!e && (where === 'All' || (e.where ?? [CITY]).includes(where)) && (cat === 'All' || e.cat === cat))
  const favList = query ? [] : mine(favs), recentList = query || cat !== 'All' ? [] : mine(recent)
  const grid = (l: GameObjectEntry[]) => <div className="prefab-grid">{l.map((e) => <Tile key={e.id} e={e} on={current === 'game:' + e.id} fav={favSet.has('game:' + e.id)} onChoose={onChoose} onHover={onHover} />)}</div>

  const head = <p className="faint small game-notice">{NOTICE} Read from your own Saints Reborn install in this browser; nothing is uploaded, and maps that use them can't go on the hub, the Showcase or a share link.</p>

  if (status === 'indexing') {
    const pct = progress?.total ? Math.round((100 * progress.done) / progress.total) : 0
    return (
      <div className="col" style={{ gap: 8, padding: '8px 2px' }}>
        {head}
        <b>Reading your game's city… {progress?.total ? `${progress.done} / ${progress.total} map pieces` : ''}</b>
        <progress max={100} value={pct} style={{ width: '100%' }} />
        <span className="faint small">This happens once (about a minute); you can keep working. Closing the tab is fine: it carries on next time.</span>
      </div>
    )
  }
  if (!entries) {
    return (
      <div className="col" style={{ gap: 10, padding: '8px 2px' }}>
        {head}
        <span>Use real Saints Row objects in your map: street lights, benches, fences, signs, crates, buildings and thousands more, straight from your own copy of the game.</span>
        {canPickFolder()
          ? <FolderButton label="Choose your Saints Reborn folder…" />
          : <span className="faint small">This needs a browser that can open a folder (Chrome or Edge on a computer).</span>}
        {status === 'error' && error && <span className="small" style={{ color: 'var(--bad)' }}>{error}</span>}
        <span className="faint small">Pick the Saints Reborn folder (or <code>dist\game\packfiles</code> inside it). The library is built once and kept in this browser.</span>
      </div>
    )
  }

  return (
    <div className="col" style={{ gap: 6 }}>
      {head}
      {!connected && (
        <div className="row wrap small">
          <span className="muted grow">Pictures and placing need your game files open.</span>
          <FolderButton label="Open game files" />
        </div>
      )}
      <Missing />
      <div className="row wrap small" style={{ gap: 6 }}>
        <label className="row" style={{ gap: 6 }}>
          <span className="muted">Where</span>
          <select value={where} onChange={(e) => setWhere(e.target.value)} aria-label="Which map the objects come from">
            <option value="All">Everywhere ({entries.length.toLocaleString()})</option>
            {places.map(([w, n]) => <option key={w} value={w}>{w === CITY ? 'Stilwater (the city)' : mapLabel(w)} ({n.toLocaleString()})</option>)}
          </select>
        </label>
        {where !== 'All' && where !== CITY && <span className="faint">{mapLine(info?.maps?.find((m) => m.chunk.toLowerCase() === where), here.length)}</span>}
      </div>
      <div className="prefab-tabs" style={{ padding: '0 0 6px', borderBottom: 'none' }} onWheel={(e) => { if (!e.deltaX) e.currentTarget.scrollLeft += e.deltaY }}>
        {['All', ...CATEGORIES.filter((c) => counts.has(c))].map((c) => (
          <button key={c} className={'sm' + (cat === c ? ' on' : '')} aria-pressed={cat === c} onClick={() => setCat(c)}>
            {c}<span className="faint"> {c === 'All' ? here.length : counts.get(c)}</span>
          </button>
        ))}
      </div>
      {favList.length > 0 && <><b className="small">★ Favourites <span className="faint">{favList.length}</span></b>{grid(favList)}</>}
      {recentList.length > 0 && <><b className="small">Recently used</b>{grid(recentList)}</>}
      {(favList.length > 0 || recentList.length > 0) && list.length > 0 && <b className="small">{cat === 'All' ? 'Everything' : cat}</b>}
      {list.length
        ? grid(list.slice(0, shown))
        : <div className="prefab-empty col"><span className="muted">Nothing called “{query}”{cat !== 'All' ? ` in ${cat}` : ''}.</span></div>}
      {list.length > shown && <button className="sm" onClick={() => setShown((n) => n + PAGE * 2)}>Show more ({(list.length - shown).toLocaleString()} left)</button>}
      {!favList.length && !query && <p className="faint small">Tip: ★ an object to keep it at the top.</p>}
      <div className="row wrap faint small" style={{ marginTop: 8 }}>
        <span className="grow">{entries.length.toLocaleString()} objects{info ? ` · read ${new Date(info.builtAt).toLocaleDateString()} in ${Math.round(info.ms / 1000)} s` : ''}</span>
        <button className="sm quiet" title="Read the game files again (after reinstalling or patching the game)" onClick={() => buildIndex(true, true).catch(toastError)}>Read again</button>
        <button className="sm quiet" title="Forget the library and its pictures in this browser (your maps keep their objects)" onClick={() => forgetIndex().catch(toastError)}>Forget</button>
      </div>
    </div>
  )
}
