// The "Ready to play" checklist. Each open item has a button that takes you to
// the tool (or place) that fixes it.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapChanged, editJob, useEditor } from './store'
import { chooseTool } from './Tools'
import { addDefaultSky, removeMarkersOfType } from './actions'
import { fixSpawnsAndWeapons } from './spawnActions'
import { toast, toastError } from '../ui'
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
        break
      case 'marker':
        st.select({ kind: 'marker', index: fix.index })
        // Once the selection reaches the view, look at it.
        setTimeout(() => getViewer()?.focusSelection(), 50)
        break
      case 'removeMarkers': removeMarkersOfType(fix.types); break
      // These run on after the Install dialog closes: as edit jobs, so Fix all waits for them.
      case 'sky': void editJob(addDefaultSky).catch(quiet); break
      case 'autoSpawns':
        toast('Finding spots for spawns and weapons…', 'info', 4000)
        void editJob(fixSpawnsAndWeapons).then((r) => toast(r.floor
          ? `Done: ${r.added.spawns} spawn${r.added.spawns === 1 ? '' : 's'} and ${r.added.weapons} weapon${r.added.weapons === 1 ? '' : 's'} added${r.moved ? `, ${r.moved} moved somewhere players can use` : ''} (one undo step).`
          : 'No floor a player can stand on was found: add a floor first.', r.floor ? 'ok' : 'info', 10000), quiet)
        break
      case 'modes':
        st.set({ tab: 'game' })
        setTimeout(() => document.getElementById('game-modes')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
        break
    }
  }
}

/** A job another map cancelled says nothing: the map it was for is gone. */
const quiet = (err: unknown) => { if (!(err instanceof MapChanged)) toastError(err) }

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
