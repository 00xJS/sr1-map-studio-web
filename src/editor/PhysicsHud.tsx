// Walk-through line for the physics preview: its controls, and how many
// props are in play. Shown only when the map has physics props.
import { useEffect, useState } from 'react'
import type { Viewer } from './Viewer'
import type { PhysicsStatus } from './physicsPreview'

export function PhysicsHud({ viewer }: { viewer: Viewer | null }) {
  const [s, setS] = useState<PhysicsStatus | null>(null)
  useEffect(() => {
    const tick = () => setS(viewer?.physicsStatus() ?? null)
    tick()
    const t = setInterval(tick, 400)
    return () => clearInterval(t)
  }, [viewer])
  if (!s || (!s.loading && !s.error && !s.props)) return null
  return (
    <span className="small">
      {s.loading ? 'Loading the physics preview…'
        : s.error ?? <>
          <b>Physics props ({s.props - s.destroyed} of {s.props}):</b> click shoot · right-click or G blast · F kick · walk into them to shove · T put them back.{' '}
          <span style={{ opacity: 0.7 }}>A rough preview: the game uses its own physics.</span>
        </>}
    </span>
  )
}
