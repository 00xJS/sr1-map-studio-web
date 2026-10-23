// First-run tour: five short tips, each pointing at the part of the editor it
// explains. Shown once per browser; Help → Take the tour shows it again.
import { useEffect, useLayoutEffect, useState } from 'react'

interface Step { at: string; title: string; text: string; place: 'left' | 'right' | 'bottom' }

const STEPS: Step[] = [
  { at: '[data-tour="camera"]', place: 'left', title: 'Look around', text: 'Left-drag in the view to spin the camera, right-drag to slide it, and scroll to zoom. These buttons do the same.' },
  { at: '[data-tour="tools"]', place: 'right', title: 'Pick a tool, then click the map', text: 'Just like Paint. Shape adds floors, walls and ramps. Spawn and Weapon place where players appear and what they pick up. Eraser deletes.' },
  { at: '[data-tour="paint"]', place: 'right', title: 'Paint it', text: 'Choose a texture from the bar at the top, then click any wall or floor. Pick copies a texture you already used.' },
  { at: '[data-tour="panel"]', place: 'left', title: 'Change what you click', text: 'This panel shows whatever you clicked: its look, size, and a Delete button. Click empty space to see what your map still needs.' },
  { at: '[data-tour="play"]', place: 'bottom', title: 'Play it', text: 'When your map is ready, press Play to put it in your game.' },
]

const CARD = 300

function position(r: DOMRect, place: Step['place']) {
  const W = window.innerWidth, H = window.innerHeight
  const clampX = (x: number) => Math.min(Math.max(8, x), W - CARD - 8)
  const clampY = (y: number) => Math.min(Math.max(8, y), H - 190)
  if (place === 'right' && r.right + 12 + CARD < W) return { left: r.right + 12, top: clampY(r.top + r.height / 2 - 80) }
  if (place === 'left' && r.left - 12 - CARD > 0) return { left: r.left - 12 - CARD, top: clampY(r.top + r.height / 2 - 80) }
  // Not enough room beside it (narrow screens): go below, or above.
  const below = r.bottom + 12
  return { left: clampX(r.left + r.width / 2 - CARD / 2), top: below + 180 < H ? below : clampY(r.top - 192) }
}

export function Tour({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const step = STEPS[i]

  useLayoutEffect(() => {
    const measure = () => {
      const el = document.querySelector(step.at)
      if (!el) { setRect(null); return }
      setRect(el.getBoundingClientRect())
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [i])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const next = () => (i + 1 < STEPS.length ? setI(i + 1) : onDone())
  const pos = rect ? position(rect, step.place) : { left: window.innerWidth / 2 - CARD / 2, top: window.innerHeight / 2 - 90 }
  return (
    <div className="tour" role="dialog" aria-label="Editor tour">
      {rect && <div className="tour-ring" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} />}
      <div className="tour-card" style={{ ...pos, width: CARD }}>
        <span className="faint small">{i + 1} of {STEPS.length}</span>
        <b>{step.title}</b>
        <p className="small">{step.text}</p>
        <div className="row">
          <button className="sm quiet" onClick={onDone}>Skip tour</button>
          <span className="spacer" />
          {i > 0 && <button className="sm" onClick={() => setI(i - 1)}>Back</button>}
          <button className="sm primary" onClick={next}>{i + 1 < STEPS.length ? 'Next' : 'Start building'}</button>
        </div>
      </div>
    </div>
  )
}
