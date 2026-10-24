// On-screen controls for phones and tablets: a stick on the left half (it
// appears where your thumb lands), drag anywhere on the right half to look,
// and buttons for jump, crouch and the third-person view.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Walker } from '../editor/walk'

/** A touch screen is the main pointer (phones, tablets). */
export const touchFirst = () => typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 1)

/** Keeps a finger's moves coming to the control it started on, even when it slides off. */
const capture = (e: ReactPointerEvent<Element>) => { try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ } }

const STICK = 56 // px from the centre to the edge of the stick's travel

/** Presses a key the walker listens for (V: third person, R: back to the spawn). */
const tap = (key: string) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }))
  window.dispatchEvent(new KeyboardEvent('keyup', { key }))
}

export function TouchControls({ walker, onMenu }: { walker: () => Walker | null; onMenu: () => void }) {
  const [stick, setStick] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null)
  const [crouch, setCrouch] = useState(false)
  const stickId = useRef<number | null>(null)
  const origin = useRef({ x: 0, y: 0 })
  const look = useRef<{ id: number; x: number; y: number } | null>(null)

  useEffect(() => () => { const w = walker(); if (w) { w.stick.x = w.stick.y = 0; w.press('c', false); w.press(' ', false); w.press('shift', false) } }, [walker])

  const moveDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (stickId.current !== null) return
    capture(e)
    stickId.current = e.pointerId
    origin.current = { x: e.clientX, y: e.clientY }
    setStick({ x: e.clientX, y: e.clientY, dx: 0, dy: 0 })
  }
  const moveMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== stickId.current) return
    const o = origin.current
    let dx = e.clientX - o.x, dy = e.clientY - o.y
    const len = Math.hypot(dx, dy)
    if (len > STICK) { dx *= STICK / len; dy *= STICK / len }
    setStick({ ...o, dx, dy })
    const w = walker()
    if (w) { w.stick.x = dx / STICK; w.stick.y = -dy / STICK }
  }
  const moveUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== stickId.current) return
    stickId.current = null
    setStick(null)
    const w = walker()
    if (w) w.stick.x = w.stick.y = 0
  }

  const lookDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (look.current) return
    capture(e)
    look.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
  }
  const lookMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const l = look.current
    if (!l || e.pointerId !== l.id) return
    walker()?.look(e.clientX - l.x, e.clientY - l.y)
    l.x = e.clientX; l.y = e.clientY
  }
  const lookUp = (e: ReactPointerEvent<HTMLDivElement>) => { if (look.current?.id === e.pointerId) look.current = null }

  const hold = (key: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => { e.preventDefault(); capture(e); walker()?.press(key, true) },
    onPointerUp: () => walker()?.press(key, false),
    onPointerCancel: () => walker()?.press(key, false),
  })

  return (
    <div className="play-touch">
      <div className="play-touch-move" onPointerDown={moveDown} onPointerMove={moveMove} onPointerUp={moveUp} onPointerCancel={moveUp}>
        {stick
          ? <div className="play-stick" style={{ left: stick.x, top: stick.y }}><div style={{ transform: `translate(${stick.dx}px, ${stick.dy}px)` }} /></div>
          : <span className="play-touch-hint">Move</span>}
      </div>
      <div className="play-touch-look" onPointerDown={lookDown} onPointerMove={lookMove} onPointerUp={lookUp} onPointerCancel={lookUp}>
        <span className="play-touch-hint">Drag to look</span>
      </div>
      <div className="play-touch-buttons">
        <button className="play-round" aria-label="Menu" onClick={onMenu}>☰</button>
        <button className="play-round" aria-label="Third person view" onClick={() => tap('v')}>👁</button>
        <button className={'play-round' + (crouch ? ' on' : '')} aria-label="Crouch" aria-pressed={crouch}
          onClick={() => { const next = !crouch; setCrouch(next); walker()?.press('c', next) }}>⤓</button>
        <button className="play-round" aria-label="Sprint (hold)" {...hold('shift')}>»</button>
        <button className="play-round big" aria-label="Jump" {...hold(' ')}>⤒</button>
      </div>
    </div>
  )
}
