// The prefab browser: every ready-made piece and every saved one, with search,
// category tabs, favourites and recently used, as a grid of small 3D pictures.
// Clicking a tile arms the Shape tool with it (toolShape "prefab:<key>" or
// "mine:<id>"); dragging one onto the map places it there. Opens from the Shape
// tool's options and from the side panel's "Add to your map".
import { memo, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { create } from 'zustand'
import { useEditor } from './store'
import { useMyPrefabs, type MyPrefab } from './myPrefabs'
import { MINE, normalize, prefabCategories, prefabEntries, searchPrefabs, type PrefabEntry } from '../lib/prefabIndex'
import { PrefabThumb, ThumbWatch, makeWatcher } from './PrefabThumb'
import type { ThumbBundle } from '../lib/prefabRender'
import { GAME_TAB, GameObjectsTab, tileOf, type GameTile } from './GameObjectsTab'
import { loadIndex, useGameObjects } from '../lib/gameObjects/client'
import { entryById } from '../lib/gameObjects/client'

type Entry = PrefabEntry & { saved?: { sig: string; bundle: ThumbBundle } }

export const usePrefabBrowser = create<{ open: boolean; hover: Entry | null }>(() => ({ open: false, hover: null }))

/** Opens the browser (and the Shape tool it belongs to). */
export function openPrefabBrowser() {
  useEditor.getState().set({ tool: 'shape', placeMode: null })
  usePrefabBrowser.setState({ open: true })
}
export const closePrefabBrowser = () => usePrefabBrowser.setState({ open: false, hover: null })
// It belongs to the Shape tool: leaving the tool closes it.
useEditor.subscribe((s) => { if (s.tool !== 'shape' && usePrefabBrowser.getState().open) closePrefabBrowser() })

/** Phones: the browser covers the map, so it closes once a piece is chosen. */
const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

// ---------------- favourites and recently used (this browser only) ----------------

const FAVS = 'sr1ms.prefabFavs'
const RECENT = 'sr1ms.prefabRecent'
const EVENT = 'sr1ms-prefablists'
const RECENT_MAX = 12

function readList(key: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] }
}
let lists: { favs: string[]; recent: string[] } | null = null
const listSnapshot = () => (lists ??= { favs: readList(FAVS), recent: readList(RECENT) })
const listSubscribe = (fn: () => void) => {
  const on = () => { lists = null; fn() }
  window.addEventListener(EVENT, on); window.addEventListener('storage', on)
  return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on) }
}
function writeList(key: string, list: string[]) {
  try { localStorage.setItem(key, JSON.stringify(list)) } catch { /* storage blocked: lists last until reload */ }
  lists = { ...listSnapshot(), [key === FAVS ? 'favs' : 'recent']: list }
  window.dispatchEvent(new Event(EVENT))
}
const usePrefabLists = () => useSyncExternalStore(listSubscribe, listSnapshot)

export function toggleFavourite(shape: string) {
  const { favs } = listSnapshot()
  writeList(FAVS, favs.includes(shape) ? favs.filter((x) => x !== shape) : [...favs, shape])
}
export function markPrefabUsed(shape: string) {
  const { recent } = listSnapshot()
  if (recent[0] !== shape) writeList(RECENT, [shape, ...recent.filter((x) => x !== shape)].slice(0, RECENT_MAX))
}

/** Arms the Shape tool with a prefab or saved piece. */
function choose(e: Entry) {
  useEditor.getState().set({ tool: 'shape', placeMode: null, toolShape: e.shape })
  markPrefabUsed(e.shape)
  if (narrow()) closePrefabBrowser()
}

const mineEntry = (p: MyPrefab): Entry => {
  const n = p.bundle.items.length
  return {
    shape: 'mine:' + p.id, label: p.name, hint: `Saved by you: ${n} object${n === 1 ? '' : 's'}`, category: MINE,
    text: normalize(`${p.name} ${MINE} saved mine`), saved: { sig: `${p.saved}:${n}`, bundle: p.bundle },
  }
}

// ---------------- tiles ----------------

const Tile = memo(function Tile({ e, on, fav }: { e: Entry; on: boolean; fav: boolean }) {
  return (
    <div className={'prefab-tile' + (on ? ' on' : '')} onMouseEnter={() => usePrefabBrowser.setState({ hover: e })} onMouseLeave={() => usePrefabBrowser.setState({ hover: null })}>
      <button className="prefab-pick" title={e.hint} aria-pressed={on} draggable
        onClick={() => choose(e)} onFocus={() => usePrefabBrowser.setState({ hover: e })}
        onDragStart={(ev) => { ev.dataTransfer.setData('application/x-sr1-asset', e.shape); ev.dataTransfer.effectAllowed = 'copy'; markPrefabUsed(e.shape) }}>
        <PrefabThumb shape={e.shape} saved={e.saved} />
        <span className="prefab-label">{e.label}</span>
      </button>
      <button className={'prefab-fav' + (fav ? ' on' : '')} title={fav ? 'Remove from favourites' : 'Add to favourites'} aria-label={(fav ? 'Remove from favourites: ' : 'Add to favourites: ') + e.label} aria-pressed={fav}
        onClick={() => toggleFavourite(e.shape)}>★</button>
    </div>
  )
})

function Grid({ list, current, favs }: { list: Entry[]; current: string; favs: Set<string> }) {
  return <div className="prefab-grid">{list.map((e) => <Tile key={e.shape} e={e} on={current === e.shape} fav={favs.has(e.shape)} />)}</div>
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="prefab-section">
      <h4>{title}{count !== undefined && <span className="faint"> {count}</span>}</h4>
      {children}
    </section>
  )
}

function HintLine() {
  const hover = usePrefabBrowser((s) => s.hover)
  const current = useEditor((s) => s.toolShape)
  const label = hover ? <><b>{hover.label}</b> · {hover.hint}</> : /^(prefab|mine|game):/.test(current) ? <>Click the map to place it, or drag a picture onto the map.</> : <>Pick a piece, then click the map to place it.</>
  return <div className="prefab-hint small muted">{label}</div>
}

// ---------------- the panel ----------------

export function PrefabBrowser() {
  const open = usePrefabBrowser((s) => s.open)
  return open ? <Panel /> : null
}

function Panel() {
  const current = useEditor((s) => s.toolShape)
  const mine = useMyPrefabs()
  const { favs, recent } = usePrefabLists()
  const [query, setQuery] = useState('')
  // With a library of the player's own game objects, it opens on those first.
  const gameEntries = useGameObjects((s) => s.entries)
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('sr1ms.prefabTab') || '' } catch { return '' } })
  useEffect(() => { void loadIndex() }, [])
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const watch = useMemo(() => (scroller && typeof IntersectionObserver === 'function' ? makeWatcher(scroller, '240px 0px') : null), [scroller])

  const mineEntries = useMemo(() => mine.map(mineEntry), [mine])
  const all = useMemo<Entry[]>(() => [...mineEntries, ...prefabEntries()], [mineEntries])
  const byShape = useMemo(() => new Map(all.map((e) => [e.shape, e])), [all])
  const cats = useMemo(() => [...(mineEntries.length ? [MINE] : []), ...prefabCategories()], [mineEntries.length])
  const counts = useMemo(() => all.reduce((m, e) => m.set(e.category, (m.get(e.category) ?? 0) + 1), new Map<string, number>()), [all])
  const favSet = useMemo(() => new Set(favs), [favs])
  const pick = (list: string[]) => list.map((s) => byShape.get(s)).filter((e): e is Entry => !!e)

  const activeTab = tab === 'All' || tab === GAME_TAB || counts.has(tab) ? tab : gameEntries?.length ? GAME_TAB : 'All'
  const gameHits = useMemo(() => {
    const words = normalize(query).split(' ').filter(Boolean)
    if (!words.length || !gameEntries || activeTab === GAME_TAB) return 0
    return gameEntries.filter((e) => { const t = normalize([e.name, ...(e.names ?? []), ...(e.raw ?? []), ...e.tex.map((x) => x.replace(/\.\w+$/, ''))].join(' ')); return words.every((w) => t.includes(w)) }).length
  }, [query, gameEntries, activeTab])
  const chooseTab = (t: string) => { setTab(t); try { sessionStorage.setItem('sr1ms.prefabTab', t) } catch { /* fine */ } scroller?.scrollTo({ top: 0 }) }
  const inTab = activeTab === 'All' ? all : all.filter((e) => e.category === activeTab)
  const q = query.trim()
  const found = useMemo(() => (q && activeTab !== GAME_TAB ? searchPrefabs(inTab, q) : null), [q, inTab, activeTab])

  useEffect(() => { scroller?.scrollTo({ top: 0 }) }, [q])

  // Sit just under the tool options bar, however many lines it wraps to.
  const [top, setTop] = useState<number | null>(null)
  useLayoutEffect(() => {
    const bar = document.querySelector<HTMLElement>('.tooloptions')
    if (!bar || typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(() => setTop(bar.offsetTop + bar.offsetHeight + 6))
    ro.observe(bar)
    return () => ro.disconnect()
  }, [])

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); if (query) setQuery(''); else closePrefabBrowser() }
    else if (e.key === 'Enter' && found?.length) choose(found[0])
  }

  const grid = (list: Entry[]) => <Grid list={list} current={current} favs={favSet} />
  let body: ReactNode
  if (activeTab === GAME_TAB) {
    // Objects from the player's own game files (their own tab: thousands of them, never mixed into All).
    body = <GameObjectsTab query={q} current={current} onChoose={(t: GameTile) => choose(t as unknown as Entry)} onHover={(t) => usePrefabBrowser.setState({ hover: t as unknown as Entry | null })} />
  } else if (found) {
    const fromGame = gameHits > 0 && <button className="sm game-tab" onClick={() => chooseTab(GAME_TAB)}>{gameHits.toLocaleString()} from your game →</button>
    body = found.length
      ? <>{fromGame}<Section title={`${found.length} found`}>{grid(found)}</Section></>
      : (
        <div className="prefab-empty col">
          <span className="muted">Nothing called “{q}”{activeTab !== 'All' ? ` in ${activeTab}` : ''}.</span>
          {fromGame}
          {activeTab !== 'All' && <button className="sm" onClick={() => chooseTab('All')}>Search everything</button>}
        </div>
      )
  } else if (activeTab === 'All') {
    const favList = pick(favs), recentList = pick(recent)
    body = <>
      {favList.length > 0 && <Section title="Favourites" count={favList.length}>{grid(favList)}</Section>}
      {recentList.length > 0 && <Section title="Recently used">{grid(recentList)}</Section>}
      {cats.map((c) => <Section key={c} title={c} count={counts.get(c)}>{grid(all.filter((e) => e.category === c))}</Section>)}
      {!favList.length && <p className="faint small">Tip: ★ a piece to keep it at the top.</p>}
    </>
  } else {
    const favHere = pick(favs).filter((e) => e.category === activeTab)
    body = <>
      {favHere.length > 0 && <Section title="Favourites">{grid(favHere)}</Section>}
      <Section title={activeTab} count={inTab.length}>{grid(inTab)}</Section>
    </>
  }

  return (
    <div className="prefab-browser" role="dialog" aria-label="Prefabs" onMouseDown={(e) => e.stopPropagation()} style={top === null ? undefined : { '--prefab-top': top + 'px' } as CSSProperties}>
      <div className="prefab-head">
        <b>Prefabs <span className="faint small">{all.length}</span></b>
        <input type="search" className="grow" placeholder="Search: car, tree, bunker…" value={query} autoFocus={!coarse}
          onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} aria-label="Search prefabs" />
        <button className="sm quiet" onClick={closePrefabBrowser} title="Close (Esc)" aria-label="Close prefabs">✕</button>
      </div>
      <div className="prefab-tabs" role="tablist" onWheel={(e) => { if (!e.deltaX) e.currentTarget.scrollLeft += e.deltaY }}>
        {[GAME_TAB, 'All', ...cats].map((c) => c === GAME_TAB
          ? <button key={c} role="tab" aria-selected={activeTab === c} className={'sm game-tab' + (activeTab === c ? ' on' : '')} title="Real objects from your own Saints Row game files: for your own maps, not shareable" onClick={() => chooseTab(c)}>{c}</button>
          : (
            <button key={c} role="tab" aria-selected={activeTab === c} className={'sm' + (activeTab === c ? ' on' : '')} onClick={() => chooseTab(c)}>
              {c}{c !== 'All' && <span className="faint"> {counts.get(c)}</span>}
            </button>
          ))}
      </div>
      <div className="prefab-scroll" ref={setScroller}>
        {watch && <ThumbWatch.Provider value={watch}>{body}</ThumbWatch.Provider>}
      </div>
      <HintLine />
    </div>
  )
}

/** The Shape tool's button for the browser: shows the armed piece, if any. */
export function PrefabButton() {
  const current = useEditor((s) => s.toolShape)
  const open = usePrefabBrowser((s) => s.open)
  const mine = useMyPrefabs()
  const armed = /^(prefab|mine|game):/.test(current)
  const game = current.startsWith('game:') ? entryById(current.slice(5)) : undefined
  const entry: Entry | undefined = game ? tileOf(game) as unknown as Entry : armed ? (current.startsWith('mine:') ? mine.map(mineEntry).find((e) => e.shape === current) : prefabEntries().find((e) => e.shape === current)) : undefined
  return (
    <button className={'sm prefab-button' + (armed ? ' on' : '')} aria-expanded={open}
      title="Ready-made pieces: buildings, cars, trees, street furniture, and pieces you saved"
      onClick={() => (open ? closePrefabBrowser() : openPrefabBrowser())}>
      {entry && <PrefabThumb shape={entry.shape} saved={entry.saved} size={22} />}
      <span>{entry ? entry.label : 'Prefabs…'}</span>
      <span className="faint">▾</span>
    </button>
  )
}
