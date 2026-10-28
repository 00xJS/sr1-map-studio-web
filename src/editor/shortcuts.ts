// Every keyboard, mouse and touch control in the editor, in one list. The editor's key handler runs the
// bindings that have `run`, in order (the first that matches wins), and the "?" sheet shows all of them, so
// the sheet can't fall behind the keys. Keys handled elsewhere (the camera on the canvas, the walk-through,
// the physics preview, the road tool) are listed here with `where` so they show on the sheet; tests/shortcuts
// checks those handlers still use the keys listed.
import { useEditor, saveNow, selectedItems } from './store'
import { toggleOverlay } from './overlays'
import { TOOL_ENTRIES, chooseTool } from './Tools'
import * as act from './actions'
import { toast, toastError } from '../ui'

type St = ReturnType<typeof useEditor.getState>
export interface Ctx { e: KeyboardEvent; st: St; mod: boolean; key: string; typing: boolean }

export interface Shortcut {
  /** As shown on the sheet: "Ctrl+Z", "W A S D", "Ctrl+C / Ctrl+V". */
  keys: string
  what: string
  group: 'Camera' | 'Tools' | 'Editing' | 'Map' | 'Walking' | 'Road tool' | 'Touch (tablet)'
  /** Handled by the editor's key handler: when it matches, it runs (the first match wins). */
  test?: (c: Ctx) => boolean
  run?: (c: Ctx) => void
  /** Runs even while typing in a field (Ctrl+S, Ctrl+Z outside text). */
  whileTyping?: boolean
  /** Handled somewhere else; listed for the sheet. */
  where?: 'canvas' | 'walk' | 'physics' | 'road' | 'touch'
}

const tryIt = (fn: () => void) => { try { fn() } catch (err) { toastError(err) } }

const toolRows: Shortcut[] = TOOL_ENTRIES.map((t) => ({
  keys: t.key, what: t.label, group: 'Tools' as const,
  // Letters pick tools by key; the gizmo modes also answer to 1 (Move), 2 and 3.
  test: ({ mod, key }) => !mod && key === t.key.toLowerCase(),
  run: () => chooseTool(t.id),
}))

export const SHORTCUTS: Shortcut[] = [
  // Camera (the canvas listens for these itself)
  { keys: 'Left-drag', what: 'Spin around', group: 'Camera', where: 'canvas' },
  { keys: 'Right-drag', what: 'Slide', group: 'Camera', where: 'canvas' },
  { keys: 'Scroll', what: 'Zoom', group: 'Camera', where: 'canvas' },
  { keys: 'F', what: 'Zoom to selection (click the map first)', group: 'Camera', where: 'canvas' },
  { keys: 'W A S D', what: 'Fly', group: 'Camera', where: 'canvas' },
  { keys: 'Q / E', what: 'Down / up', group: 'Camera', where: 'canvas' },
  { keys: 'Shift', what: 'Fly faster', group: 'Camera', where: 'canvas' },

  // Editing: modifier keys first, so Ctrl+Shift+S wins over Ctrl+S.
  { keys: 'Ctrl+Z', what: 'Undo', group: 'Editing', whileTyping: true, test: ({ mod, key, e, typing }) => mod && key === 'z' && !e.shiftKey && !typing, run: ({ st }) => st.undo() },
  { keys: 'Ctrl+Shift+Z / Ctrl+Y', what: 'Redo', group: 'Editing', whileTyping: true, test: ({ mod, key, e, typing }) => mod && !typing && (key === 'y' || (key === 'z' && e.shiftKey)), run: ({ st }) => st.redo() },
  { keys: 'Ctrl+Shift+S', what: 'Saved versions', group: 'Map', whileTyping: true, test: ({ mod, key, e }) => mod && e.shiftKey && key === 's', run: () => toggleOverlay('versions', true) },
  { keys: 'Ctrl+K', what: 'Find a tool, prefab, setting or action', group: 'Map', whileTyping: true, test: ({ mod, key }) => mod && key === 'k', run: () => toggleOverlay('palette') },
  { keys: 'Ctrl+S', what: 'Save now', group: 'Map', whileTyping: true, test: ({ mod, key }) => mod && key === 's', run: () => { void saveNow(true).then(() => toast('Saved in this browser', 'ok', 1800)) } },
  { keys: 'Ctrl+D', what: 'Duplicate', group: 'Editing', whileTyping: true, test: ({ mod, key, typing }) => mod && key === 'd' && !typing, run: () => { if (selectedItems().length) tryIt(() => act.duplicateItems(selectedItems())) } },
  { keys: '?', what: 'This sheet', group: 'Map', test: ({ e }) => e.key === '?' || (e.shiftKey && e.code === 'Slash'), run: () => toggleOverlay('keys') },
  {
    keys: 'Ctrl+C / Ctrl+V', what: 'Copy / paste (works across maps)', group: 'Editing',
    test: ({ mod, key }) => mod && (key === 'c' || key === 'v'),
    run: ({ key, e }) => {
      if (key === 'c') {
        if (!selectedItems().length || window.getSelection()?.toString()) return
        e.preventDefault()
        tryIt(() => { const n = act.copyItems(selectedItems()); toast(`Copied ${n} object${n === 1 ? '' : 's'}. Ctrl+V pastes, in this map or another.`, 'ok', 2200) })
      } else {
        e.preventDefault()
        tryIt(() => { if (!act.pasteItems()) toast('Nothing copied yet: pick objects and press Ctrl+C.', 'info', 2200) })
      }
    },
  },
  { keys: 'Ctrl+G / Ctrl+Shift+G', what: 'Group / ungroup', group: 'Editing', test: ({ mod, key }) => mod && key === 'g', run: ({ e }) => tryIt(() => (e.shiftKey ? act.ungroupItems(selectedItems()) : act.groupItems(selectedItems()))) },
  { keys: 'Ctrl+A', what: 'Select everything', group: 'Editing', test: ({ mod, key }) => mod && key === 'a', run: ({ st }) => st.selectItems(st.project?.scene_items.map((_, i) => i) ?? []) },
  {
    keys: 'Delete', what: 'Delete selection', group: 'Editing',
    test: ({ e, st }) => (e.key === 'Delete' || e.key === 'Backspace') && (st.multi.length > 1 || !!st.selection),
    run: ({ st }) => (st.multi.length > 1 ? act.removeItems(st.multi) : act.removeSelected()),
  },
  { keys: 'Shift+click', what: 'Add to selection', group: 'Editing', where: 'canvas' },
  {
    keys: 'Esc', what: 'Back to Move, then clear the selection', group: 'Tools',
    test: ({ e }) => e.key === 'Escape',
    run: ({ st }) => {
      if (st.tool !== 'select' || st.placeMode) chooseTool('select')
      else if (st.selection || st.multi.length) st.select(null)
    },
  },
  { keys: '1', what: 'Select and move', group: 'Tools', test: ({ mod, key }) => !mod && key === '1', run: () => chooseTool('select') },
  // While placing shapes and prefabs, R turns the preview instead of picking the Road tool.
  {
    keys: 'R / Shift+R', what: 'Turn the shape preview (Shape tool)', group: 'Tools',
    test: ({ mod, key, st }) => !mod && st.tool === 'shape' && key === 'r',
    run: ({ st, e }) => st.set({ placeRot: (((st.placeRot + (e.shiftKey ? -15 : 15)) % 360) + 360) % 360 }),
  },
  // Before the tool letters: Shift+M is mirror mode, M alone the Measure tool.
  {
    keys: 'Shift+M', what: 'Mirror mode on / off (edits copied across the middle)', group: 'Editing',
    test: ({ mod, key, e }) => !mod && e.shiftKey && key === 'm',
    run: ({ st }) => { st.set({ mirror: !st.mirror }); toast(st.mirror ? 'Mirror mode off' : 'Mirror mode on: edits are copied across the middle', 'info', 1800) },
  },
  ...toolRows,
  { keys: 'G', what: 'Snap on / off', group: 'Tools', test: ({ mod, key }) => !mod && key === 'g', run: ({ st }) => st.set({ snap: !st.snap }) },

  // The road tool (groundTools.ts)
  { keys: 'Enter', what: 'Finish the road', group: 'Road tool', where: 'road' },
  { keys: 'Backspace', what: 'Take back the last point', group: 'Road tool', where: 'road' },

  // Walking (walk.ts, physicsPreview.ts)
  { keys: 'W A S D', what: 'Run', group: 'Walking', where: 'walk' },
  { keys: 'Shift', what: 'Sprint (3 s, then it refills)', group: 'Walking', where: 'walk' },
  { keys: 'Space', what: 'Jump', group: 'Walking', where: 'walk' },
  { keys: 'C', what: 'Crouch', group: 'Walking', where: 'walk' },
  { keys: 'V', what: 'Third person', group: 'Walking', where: 'walk' },
  { keys: 'R', what: 'Back to the start', group: 'Walking', where: 'walk' },
  { keys: 'Click', what: 'Shoot a physics prop', group: 'Walking', where: 'physics' },
  { keys: 'G', what: 'Blast props (or right-click)', group: 'Walking', where: 'physics' },
  { keys: 'F', what: 'Kick', group: 'Walking', where: 'physics' },
  { keys: 'T', what: 'Put the props back', group: 'Walking', where: 'physics' },
  { keys: 'Esc', what: 'Free the mouse, then stop walking', group: 'Walking', where: 'walk' },

  // Touch
  { keys: 'Tap', what: 'Select, or use the current tool', group: 'Touch (tablet)', where: 'touch' },
  { keys: 'One-finger drag', what: 'Spin around', group: 'Touch (tablet)', where: 'touch' },
  { keys: 'Pinch', what: 'Zoom', group: 'Touch (tablet)', where: 'touch' },
  { keys: 'Two-finger drag', what: 'Slide', group: 'Touch (tablet)', where: 'touch' },
  { keys: 'Camera buttons', what: 'Circle, zoom, see the whole map', group: 'Touch (tablet)', where: 'touch' },
]

/** The editor's key handler: the first binding that matches runs. */
export function handleKey(e: KeyboardEvent, st: St) {
  // A job like Fix all is editing the map: no key changes it meanwhile (Ctrl+Z included).
  if (st.locked) { if (e.ctrlKey || e.metaKey) e.preventDefault(); return true }
  const t = e.target as HTMLElement
  const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
  const c: Ctx = { e, st, mod: e.ctrlKey || e.metaKey, key: e.key.toLowerCase(), typing }
  for (const s of SHORTCUTS) {
    if (!s.test || !s.run) continue
    if (typing && !s.whileTyping) continue
    if (!s.test(c)) continue
    // Copy and paste decide for themselves (copy leaves text selection alone).
    if (s.keys !== 'Ctrl+C / Ctrl+V' && (c.mod || ['?', 'r', 'delete', 'backspace'].includes(c.key))) e.preventDefault()
    s.run(c)
    return true
  }
  return false
}

/** The sheet's groups, in the order they first appear. */
export function shortcutGroups(): [Shortcut['group'], Shortcut[]][] {
  const out = new Map<Shortcut['group'], Shortcut[]>()
  for (const s of SHORTCUTS) {
    const rows = out.get(s.group) ?? []
    if (!rows.some((r) => r.keys === s.keys && r.what === s.what)) rows.push(s)
    out.set(s.group, rows)
  }
  return [...out]
}
