// Ctrl+K: one search box over the editor's tools and keys (shortcuts.ts), every prefab, the settings in the
// side panel's tabs and the top bar's actions. Enter (or a click) runs what is highlighted.
import { useEffect, useMemo, useState, type KeyboardEvent as ReactKey } from 'react'
import { useEditor, type SideTab } from './store'
import { SHORTCUTS } from './shortcuts'
import { TOOL_ENTRIES, chooseTool } from './Tools'
import { toggleOverlay } from './overlays'
import { getViewer } from './Viewport'
import { openMore } from './More'
import { markPrefabUsed } from './prefabLists'
import { setLook } from './look'
import { runHealthCheck } from './health'
import { alignSelected, distributeSelected } from './ArrangePanel'
import { saveCurrentView, useSavedViews } from './savedViews'
import { Modal, toast } from '../ui'
import { normalize, prefabEntries } from '../lib/prefabIndex'

export interface Command { id: string; label: string; group: 'Actions' | 'Tools' | 'Settings' | 'Keys' | 'Prefabs'; keys?: string; hint?: string; run: () => void }

/** What the top bar does, from the editor page. */
export interface PaletteActions { walk: () => void; playHere: () => void; install: () => void; share: () => void; ai: () => void; publish?: () => void; tour: () => void }

/** Opens a tab and brings one of its sections into view (opening its More settings first when it has one). */
export function revealSetting(tab: SideTab, title: string, more?: string) {
  if (more) openMore(more)
  useEditor.getState().set({ tab })
  setTimeout(() => {
    // A setting can name itself (data-setting); otherwise the section, field or fold whose title starts with it.
    const named = [...document.querySelectorAll<HTMLElement>('.side [data-setting]')].find((x) => x.dataset.setting === title)
    const el = named ?? [...document.querySelectorAll<HTMLElement>('.side .section-title, .side .field > span, .side .more-toggle')]
      .find((x) => x.textContent?.trim().toLowerCase().startsWith(title.toLowerCase()))
    const box = named ?? el?.closest<HTMLElement>('.section, .field, .more-fold') ?? el
    if (!box) return
    box.scrollIntoView({ behavior: 'smooth', block: 'center' })
    box.classList.add('flash')
    setTimeout(() => box.classList.remove('flash'), 1400)
  }, 80)
}

const SETTINGS: [string, SideTab, string?, string?][] = [
  // [label, tab, section title when it differs, More settings it sits in]
  ['Add to your map', 'build'], ['Everything in your map', 'build', 'In your map'], ['Layers', 'build'], ['Replace the map with a model', 'build', 'Models', 'build'],
  ['Library and imports', 'build', 'Your library', 'build'], ['Every texture', 'build', 'Every texture', 'build'],
  ['Map health', 'check'], ['To fix', 'check'], ['Remove invisible walls', 'check'], ['Every spawn and red vs blue', 'check', 'Spawns', 'check'],
  ['Game modes', 'game'], ['Time and weather', 'game'], ['Background sound', 'game'], ['Loading screen', 'game'], ['Sky', 'game'], ['Minimap', 'game'],
  ['World scale', 'game', 'World', 'world'], ['Mirror X and flip textures', 'game', 'World', 'world'], ['Surface impacts', 'game', 'Surfaces', 'world'], ['Spawn table (CTS)', 'game', 'Spawn table', 'world'],
  ['Ready to play checklist', 'ship', 'Ready to play'], ['Name in the game', 'ship', 'In the game'], ['Description', 'ship', 'In the game'], ['File name', 'ship', 'File name', 'ship'],
]

const TAB_NAME: Record<SideTab, string> = { build: 'Build', check: 'Check', game: 'Game', ship: 'Ship' }

function commands(a: PaletteActions): Command[] {
  const st = useEditor.getState
  const flip = (k: 'snap' | 'wireframe' | 'freeCam' | 'allSettings' | 'plan' | 'mirror', label: string, keys?: string) => ({ id: 'toggle-' + k, label, group: 'Settings' as const, keys, hint: st()[k] ? 'on' : 'off', run: () => st().set({ [k]: !st()[k] }) })
  const several = 'two or more objects picked'
  const out: Command[] = [
    { id: 'walk', label: 'Walk the map', group: 'Actions', hint: 'at player height', run: a.walk },
    { id: 'play', label: 'Play in browser', group: 'Actions', run: a.playHere },
    { id: 'install', label: 'Install in game', group: 'Actions', run: a.install },
    { id: 'share', label: 'Share a link', group: 'Actions', run: a.share },
    { id: 'ai', label: 'Ask AI', group: 'Actions', hint: 'describe a change', run: a.ai },
    ...(a.publish ? [{ id: 'publish', label: 'Publish to the hub', group: 'Actions' as const, run: a.publish }] : []),
    { id: 'check', label: 'Check my map', group: 'Actions', run: () => { st().set({ tab: 'check' }); void runHealthCheck() } },
    { id: 'undo', label: 'Undo', group: 'Actions', keys: 'Ctrl+Z', run: () => st().undo() },
    { id: 'redo', label: 'Redo', group: 'Actions', keys: 'Ctrl+Shift+Z', run: () => st().redo() },
    { id: 'history', label: 'Undo history', group: 'Actions', run: () => toggleOverlay('history', true) },
    { id: 'versions', label: 'Saved versions', group: 'Actions', keys: 'Ctrl+Shift+S', run: () => toggleOverlay('versions', true) },
    { id: 'zoom', label: 'Zoom to selection', group: 'Actions', keys: 'F', run: () => getViewer()?.focusSelection() },
    { id: 'frame', label: 'See the whole map', group: 'Actions', run: () => getViewer()?.frameAll() },
    { id: 'tour', label: 'Take the tour', group: 'Actions', run: a.tour },
    { id: 'keys', label: 'Keyboard, mouse and touch', group: 'Actions', keys: '?', run: () => toggleOverlay('keys', true) },
    ...TOOL_ENTRIES.map((t): Command => ({ id: 'tool-' + t.id, label: t.label, group: 'Tools', keys: t.key, hint: t.help, run: () => chooseTool(t.id) })),
    flip('allSettings', 'Show all settings'), flip('snap', 'Snap to the grid'), flip('wireframe', 'Wireframe'), flip('freeCam', 'Free camera'),
    flip('plan', 'Plan view (from straight above)', 'O'), flip('mirror', 'Mirror mode (edits copied across the middle)', 'Shift+M'),
    { id: 'view-save', label: 'Save this camera view', group: 'Actions', run: () => { const n = saveCurrentView(); if (n) toast(`Saved as ${n}.`, 'ok', 1800) } },
    { id: 'view-list', label: 'Saved camera views', group: 'Actions', keys: 'Alt+1 … 9 or Shift+1 … 9', run: () => useSavedViews.setState({ open: true }) },
    { id: 'align-x', label: 'Line up along X (middles)', group: 'Actions', hint: several, run: () => alignSelected(0, 'mid') },
    { id: 'align-z', label: 'Line up along Z (middles)', group: 'Actions', hint: several, run: () => alignSelected(2, 'mid') },
    { id: 'align-y', label: 'Level the bottoms', group: 'Actions', hint: several, run: () => alignSelected(1, 'min') },
    { id: 'space-x', label: 'Space evenly along X', group: 'Actions', hint: 'three or more objects picked', run: () => distributeSelected(0) },
    { id: 'space-z', label: 'Space evenly along Z', group: 'Actions', hint: 'three or more objects picked', run: () => distributeSelected(2) },
    { id: 'collision', label: 'Show collision', group: 'Settings', run: () => st().set({ collisionView: st().collisionView === 'faces' ? 'off' : 'faces' }) },
    { id: 'look-game', label: 'Game lighting', group: 'Settings', run: () => setLook({ mode: 'game' }) },
    { id: 'look-editor', label: 'Bright editor lighting', group: 'Settings', run: () => setLook({ mode: 'editor' }) },
    ...SETTINGS.map(([label, tab, title, more]): Command => ({ id: 'set-' + label, label, group: 'Settings', hint: TAB_NAME[tab] + ' tab', run: () => revealSetting(tab, title ?? label, more) })),
  ]
  // Keys the editor answers to that aren't above: listed so they can be found, run where that makes sense.
  const have = new Set(out.map((c) => c.keys).filter(Boolean))
  for (const s of SHORTCUTS) {
    if (have.has(s.keys) || s.group === 'Tools') continue
    const runs = !!s.run && !s.where && !['Ctrl+C / Ctrl+V', 'Ctrl+K', '?'].includes(s.keys)
    out.push({
      id: 'key-' + s.group + s.keys + s.what, label: s.what, group: 'Keys', keys: s.keys, hint: s.group,
      run: runs ? () => s.run!({ e: new KeyboardEvent('keydown'), st: st(), mod: true, key: '', typing: false }) : () => toggleOverlay('keys', true),
    })
  }
  return out
}

function prefabCommands(): Command[] {
  return prefabEntries().map((e) => ({
    id: 'prefab-' + e.shape, label: e.label, group: 'Prefabs', hint: e.category,
    run: () => {
      useEditor.getState().set({ tool: 'shape', placeMode: null, toolShape: e.shape })
      markPrefabUsed(e.shape)
      toast(`${e.label}: click the map to place it.`, 'info', 3000)
    },
  }))
}

/** Every word of the query somewhere in the command; labels that start with it first. */
export function searchCommands(list: Command[], query: string): Command[] {
  const q = normalize(query).trim()
  if (!q) return list.filter((c) => c.group === 'Actions' || c.group === 'Tools')
  const words = q.split(' ')
  const scored: [Command, number][] = []
  for (const c of list) {
    const label = normalize(c.label)
    const text = label + normalize(`${c.group} ${c.hint ?? ''} ${c.keys ?? ''}`)
    if (!words.every((w) => text.includes(' ' + w) || text.includes(w))) continue
    const score = (label.startsWith(' ' + q) ? 0 : label.includes(' ' + words[0]) ? 1 : 2) * 10 + (c.group === 'Prefabs' ? 1 : 0)
    scored.push([c, score])
  }
  return scored.sort((a, b) => a[1] - b[1]).map(([c]) => c).slice(0, 60)
}

export function CommandPalette({ actions }: { actions: PaletteActions }) {
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const all = useMemo(() => [...commands(actions), ...prefabCommands()], [actions])
  const found = useMemo(() => searchCommands(all, query), [all, query])
  const close = () => toggleOverlay('palette', false)
  // Ctrl+K again closes it, wherever the focus is (the editor's own keys are off while a dialog is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); toggleOverlay('palette', false) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  const runIt = (c: Command | undefined) => { if (!c) return; close(); c.run() }
  const onKey = (e: ReactKey) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(found.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); runIt(found[at]) }
  }
  return (
    <Modal title="Find anything" onClose={close}>
      <div className="palette-box stack">
        <input autoFocus value={query} placeholder="A tool, a prefab, a setting or an action…" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="palette-list"
          aria-activedescendant={found[at] ? 'pal-' + at : undefined} onChange={(e) => { setQuery(e.target.value); setAt(0) }} onKeyDown={onKey} />
        <div className="list palette-list" id="palette-list" role="listbox" aria-label="Results">
          {found.map((c, i) => (
            <button type="button" key={c.id} id={'pal-' + i} role="option" aria-selected={i === at} className={'list-item' + (i === at ? ' selected' : '')}
              onMouseEnter={() => setAt(i)} onClick={() => runIt(c)}>
              <span className="grow ellipsis">{c.label}{c.hint && <span className="faint"> · {c.hint}</span>}</span>
              {c.keys && <kbd>{c.keys}</kbd>}
              <span className="meta">{c.group}</span>
            </button>
          ))}
          {!found.length && <div className="list-item faint">Nothing found for "{query}".</div>}
        </div>
        <span className="faint small">↑ ↓ to choose · Enter to use it · Esc to close</span>
      </div>
    </Modal>
  )
}
