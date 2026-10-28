// The home page's "first map in 60 seconds": after the wizard, a small bar
// walks the user through Walk and then Play.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useEditor, writeFlag } from './store'
import '../pages/home.css'

export function FirstMapCoach() {
  const [params, setParams] = useSearchParams()
  const walking = useEditor((s) => s.walking)
  const [walked, setWalked] = useState(false)
  // This path replaces the editor tour (still under Help).
  useEffect(() => { if (params.get('first') === '1') writeFlag('sr1-tour-done', true) }, [])
  useEffect(() => { if (walking) setWalked(true) }, [walking])
  if (params.get('first') !== '1' || walking) return null
  const done = () => { params.delete('first'); setParams(params, { replace: true }) }
  const play = () => { done(); document.querySelector<HTMLButtonElement>('[data-tour="play"]')?.click() }
  return (
    <div className="first-coach" role="status">
      <span className="step-num">{walked ? 3 : 2}</span>
      {walked
        ? <span className="grow"><b>Nice.</b> Last step: press <b>▶ Install in game</b> to build the map and put it in your game.</span>
        : <span className="grow"><b>Your map is ready.</b> Next, walk it at player height: run, jump and crouch from spawn to spawn.</span>}
      {walked
        ? <button className="primary sm" onClick={play}>▶ Install in game</button>
        : <button className="primary sm" onClick={() => useEditor.getState().set({ walking: true, selection: null, multi: [] })}>🚶 Walk it</button>}
      <button className="sm quiet" onClick={done} aria-label="Hide these tips">✕</button>
    </div>
  )
}
