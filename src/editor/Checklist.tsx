// The "Ready to play" checklist. Each open item has a button that takes you to
// the tool (or place) that fixes it.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEditor } from './store'
import { chooseTool } from './Tools'
import { addDefaultSky, removeMarkersOfType } from './actions'
import { getViewer } from './Viewport'
import { dataPackStatus } from '../lib/datapack'
import { mapChecklist, type CheckItem, type Fix } from '../lib/checklist'

export function useChecklist(): CheckItem[] {
  const project = useEditor((s) => s.project)!
  const [pack, setPack] = useState<boolean | null>(null)
  useEffect(() => { dataPackStatus().then((p) => setPack(p.ready)).catch(() => setPack(null)) }, [])
  return mapChecklist(project, pack)
}

export function useApplyFix(onSamples: () => void) {
  const nav = useNavigate()
  return (fix: Fix) => {
    const st = useEditor.getState()
    switch (fix.kind) {
      case 'tool':
        chooseTool(fix.tool)
        if (fix.spawn) st.set({ toolSpawn: fix.spawn })
        break
      case 'samples': onSamples(); break
      case 'setup': nav('/setup'); break
      case 'select':
        st.select({ kind: 'item', index: fix.index })
        if (st.advanced) st.set({ tab: 'materials' })
        break
      case 'marker':
        st.select({ kind: 'marker', index: fix.index })
        if (st.advanced) st.set({ tab: 'spawns' })
        // Once the selection reaches the view, look at it.
        setTimeout(() => getViewer()?.focusSelection(), 50)
        break
      case 'removeMarkers': removeMarkersOfType(fix.types); break
      case 'sky': void addDefaultSky(); break
      case 'modes':
        st.select(null)
        if (st.advanced) st.set({ tab: 'export' })
        else setTimeout(() => document.getElementById('game-modes')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
        break
    }
  }
}

const MARK = { done: '✓', needed: '!', suggested: '•' } as const

export function Checklist({ items, onFix }: { items: CheckItem[]; onFix: (f: Fix) => void }) {
  return (
    <ul className="checklist">
      {items.map((c) => (
        <li key={c.id} className={c.state}>
          <span className="mark" aria-label={c.state}>{MARK[c.state]}</span>
          <span className="grow">{c.text}</span>
          {c.fix && c.action && <button className="sm" onClick={() => onFix(c.fix!)}>{c.action}</button>}
        </li>
      ))}
    </ul>
  )
}
