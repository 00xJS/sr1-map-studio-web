// The prefab browser's "From my game" tab: real Saints Row objects read from the player's own game install,
// with search, categories and pictures drawn on demand. Choosing one arms the Shape tool with "game:<id>" like a
// prefab (ghost, R to turn, click to place). Everything here stays on this device: the objects are for the
// player's own maps and can't be shared or published.
import { memo, useEffect, useMemo, useState } from 'react'
import { useEditor } from './store'
import { PrefabThumb } from './PrefabThumb'
import { toast, toastError, useBusy } from '../ui'
import { buildIndex, forgetIndex, loadIndex, NeedGameFolder, connect, useGameObjects } from '../lib/gameObjects/client'
import { CATEGORIES } from '../lib/gameObjects/classify'
import type { GameObjectEntry } from '../lib/gameObjects/indexer'
import { canPickFolder } from '../lib/gameFiles'
import { missingInProject, rebuildMissing } from './gameObjectActions'
import { normalize } from '../lib/prefabIndex'

const PAGE = 120
export const GAME_TAB = 'From my game'
export const NOTICE = 'From your game files: usable in your own maps, not shareable.'

export interface GameTile { shape: string; label: string; hint: string }

export const tileOf = (e: GameObjectEntry): GameTile => ({
  shape: 'game:' + e.id,
  label: e.name,
  hint: `${e.profile ? e.profile + ' · ' : ''}${e.size.map((v) => v.toFixed(v < 10 ? 2 : 1)).join(' × ')} m · ${e.tris.toLocaleString()} triangles · in the game ${e.seen.toLocaleString()}× · ${NOTICE}`,
})

const searchText = (e: GameObjectEntry) => normalize([e.name, ...(e.names ?? []), e.profile, e.cat, e.chunk].join(' '))

const Tile = memo(function Tile({ e, on, onChoose, onHover }: { e: GameObjectEntry; on: boolean; onChoose: (t: GameTile) => void; onHover: (t: GameTile | null) => void }) {
  const t = tileOf(e)
  return (
    <div className={'prefab-tile' + (on ? ' on' : '')} onMouseEnter={() => onHover(t)} onMouseLeave={() => onHover(null)}>
      <button className="prefab-pick" title={t.hint} aria-pressed={on} draggable onClick={() => onChoose(t)} onFocus={() => onHover(t)}
        onDragStart={(ev) => { ev.dataTransfer.setData('application/x-sr1-asset', t.shape); ev.dataTransfer.effectAllowed = 'copy' }}>
        <PrefabThumb shape={t.shape} />
        <span className="prefab-label">{t.label}</span>
      </button>
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
  const [shown, setShown] = useState(PAGE)
  useEffect(() => { void loadIndex() }, [])
  // With the index stored and the folder still allowed, open the game files quietly for the pictures.
  useEffect(() => { if (entries && !connected) connect(false).catch(() => {}) }, [entries, connected])
  useEffect(() => setShown(PAGE), [query, cat])

  const counts = useMemo(() => (entries ?? []).reduce((m, e) => m.set(e.cat, (m.get(e.cat) ?? 0) + 1), new Map<string, number>()), [entries])
  const texts = useMemo(() => new Map((entries ?? []).map((e) => [e.id, searchText(e)])), [entries])
  const list = useMemo(() => {
    const words = normalize(query).split(' ').filter(Boolean)
    return (entries ?? []).filter((e) => (cat === 'All' || e.cat === cat) && words.every((w) => texts.get(e.id)!.includes(w)))
  }, [entries, cat, query, texts])

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
      <div className="prefab-tabs" style={{ padding: '0 0 6px', borderBottom: 'none' }} onWheel={(e) => { if (!e.deltaX) e.currentTarget.scrollLeft += e.deltaY }}>
        {['All', ...CATEGORIES.filter((c) => counts.has(c))].map((c) => (
          <button key={c} className={'sm' + (cat === c ? ' on' : '')} aria-pressed={cat === c} onClick={() => setCat(c)}>
            {c}<span className="faint"> {c === 'All' ? entries.length : counts.get(c)}</span>
          </button>
        ))}
      </div>
      {list.length
        ? <div className="prefab-grid">{list.slice(0, shown).map((e) => <Tile key={e.id} e={e} on={current === 'game:' + e.id} onChoose={onChoose} onHover={onHover} />)}</div>
        : <div className="prefab-empty col"><span className="muted">Nothing called “{query}”{cat !== 'All' ? ` in ${cat}` : ''}.</span></div>}
      {list.length > shown && <button className="sm" onClick={() => setShown((n) => n + PAGE * 2)}>Show more ({(list.length - shown).toLocaleString()} left)</button>}
      <div className="row wrap faint small" style={{ marginTop: 8 }}>
        <span className="grow">{entries.length.toLocaleString()} objects{info ? ` · read ${new Date(info.builtAt).toLocaleDateString()} in ${Math.round(info.ms / 1000)} s` : ''}</span>
        <button className="sm quiet" title="Read the game files again (after reinstalling or patching the game)" onClick={() => buildIndex(true, true).catch(toastError)}>Read again</button>
        <button className="sm quiet" title="Forget the library and its pictures in this browser (your maps keep their objects)" onClick={() => forgetIndex().catch(toastError)}>Forget</button>
      </div>
    </div>
  )
}
