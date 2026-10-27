// A small prompt where something needs a connection this browser doesn't have yet (lib/setup.ts): what it needs,
// what that unlocks, and a link to the Connect page. Shows nothing once it is connected.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { UNLOCKS, useSetup, type SetupItem, type SetupState } from '../lib/setup'
import { useGameObjects } from '../lib/gameObjects/client'

const has: Record<Exclude<SetupItem, 'library'>, (s: SetupState) => boolean> = {
  datapack: (s) => !s.loaded || !!s.datapack?.ready,
  gameFolder: (s) => !s.loaded || !!s.gameFolder,
  mapsFolder: (s) => !s.loaded || !!s.mapsFolder,
  aiKey: (s) => !s.loaded || s.aiKey,
}

/** Whether this browser has `what` (true until it has been checked, so nothing flashes up). */
export function useHasSetup(what: SetupItem): boolean {
  const lib = useGameObjects((s) => s.status === 'ready' && !!s.entries?.length)
  const ok = useSetup(what === 'library' ? () => true : has[what])
  return what === 'library' ? lib : ok
}

export function NeedsSetup({ what, children, tone = 'warn' }: { what: SetupItem; children?: ReactNode; tone?: 'warn' | 'info' }) {
  const ok = useHasSetup(what)
  if (ok) return null
  const u = UNLOCKS[what]
  return (
    <div className={'callout' + (tone === 'warn' ? ' warn' : '')}>
      <div className="col grow" style={{ gap: 2 }}>
        <b>{children ?? `Connect your ${u.label.toLowerCase()}`}</b>
        <span className="small">{u.unlocks}</span>
      </div>
      <Link to={`/connect#${what}`} className="btn sm">Connect</Link>
    </div>
  )
}
