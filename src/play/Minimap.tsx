// Corner minimap: a top-down picture of the map taken before the walk began,
// with the player's arrow, weapons still out (gold), drop-offs (pink, green once touched),
// a ghost being raced (a pale ring) and race bots (dots in their colours).
import { useEffect, useRef } from 'react'
import type { MinimapRect } from '../lib/minimap'
import { visible } from './game'
import type { PlaySession } from './session'

export function Minimap({ session, image, rect, size = 168 }: { session: PlaySession; image: HTMLImageElement | null; rect: MinimapRect; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvas.current!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = c.height = Math.round(size * dpr)
    const g = c.getContext('2d')!
    const [x0, z0, x1, z1] = rect
    const toMap = (x: number, z: number): [number, number] => [((x - x0) / (x1 - x0)) * size, ((z - z0) / (z1 - z0)) * size]
    let raf = 0
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.fillStyle = '#0c0b0f'
      g.fillRect(0, 0, size, size)
      if (image) { g.globalAlpha = 0.9; g.drawImage(image, 0, 0, size, size); g.globalAlpha = 1 }
      for (const p of session.pickups()) {
        if (!visible(p, now)) continue
        const [u, v] = toMap(p.at[0], p.at[2])
        g.beginPath()
        if (p.kind === 'weapon') { g.fillStyle = '#ffc23d'; g.arc(u, v, 3, 0, Math.PI * 2); g.fill() } else {
          g.strokeStyle = p.taken ? '#4fd18b' : '#ff42bf'; g.lineWidth = 2
          g.arc(u, v, Math.max(4, (p.radius / (x1 - x0)) * size), 0, Math.PI * 2); g.stroke()
        }
      }
      // A ghost is a hollow ring, bots solid dots in their colour.
      for (const o of session.others()) {
        const [u, v] = toMap(o.at[0], o.at[2])
        g.beginPath(); g.arc(u, v, o.kind === 'ghost' ? 4 : 3.5, 0, Math.PI * 2)
        if (o.kind === 'ghost') { g.strokeStyle = o.color; g.lineWidth = 2; g.stroke() } else { g.fillStyle = o.color; g.fill(); g.strokeStyle = '#000000'; g.lineWidth = 1; g.stroke() }
      }
      const me = session.player()
      if (me) {
        const [u, v] = toMap(me.at[0], me.at[2])
        // Heading 0 faces −Z, which is up on the map; turning left is positive.
        g.save()
        g.translate(Math.max(4, Math.min(size - 4, u)), Math.max(4, Math.min(size - 4, v)))
        g.rotate(-me.heading)
        g.beginPath(); g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(0, 3); g.lineTo(-5.5, 6); g.closePath()
        g.fillStyle = '#ffffff'; g.strokeStyle = '#000000'; g.lineWidth = 1.5
        g.fill(); g.stroke()
        g.restore()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [session, image, rect, size])
  return <canvas ref={canvas} className="play-minimap" style={{ width: size, height: size }} aria-label="Minimap" />
}
