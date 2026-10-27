// "Swap for…" in a selected object's panel: other things that would stand where it stands (the same thing in other
// art, other versions of it, things of its kind, then anything that fits; lib/gameObjects/swap.ts), each with its
// picture. One click swaps it in place, turned to fit; Ctrl+Z puts the old one back.
import { useEffect, useMemo, useState } from 'react'
import { useEditor } from './store'
import { PrefabThumb } from './PrefabThumb'
import { useBusy } from '../ui'
import type { SceneItem } from '../lib/project'
import { connect, loadIndex, useGameObjects } from '../lib/gameObjects/client'
import { SWAP_HEADINGS, SWAP_WHY, swapOptions, swapPool, swapPrefabs, type SwapOption, type SwapSpot } from '../lib/gameObjects/swap'
import { spotOf, swapItem, swappable } from './swapActions'
import { NOTICE } from './GameObjectsTab'

const m = (v: number) => (v >= 10 ? Math.round(v) : +v.toFixed(1))
const size = (o: { long: number; short: number; h: number }) => `${m(o.long)} × ${m(o.short)} × ${m(o.h)} m`

export function SwapPanel({ it, index }: { it: SceneItem; index: number }) {
  const [open, setOpen] = useState(false)
  if (!swappable(it)) return null
  return (
    <div className="group">
      <button className="quiet section-toggle" onClick={() => setOpen(!open)} aria-expanded={open} title="Other things that would fit where this one stands">
        <span className="section-title">Swap for…</span><span className="faint">{open ? '▾' : '▸'}</span>
      </button>
      {open && <SwapList it={it} index={index} />}
    </div>
  )
}

function SwapList({ it, index }: { it: SceneItem; index: number }) {
  const project = useEditor((s) => s.project)!
  const ws = project.settings.world_scale || 0.5
  const { entries, connected } = useGameObjects()
  const [spot, setSpot] = useState<SwapSpot | null>(null)
  const [err, setErr] = useState('')
  const [run, busy] = useBusy()
  useEffect(() => { void loadIndex() }, [])
  // With the library stored and the folder still allowed, open the game files quietly for the pictures.
  useEffect(() => { if (entries && !connected) connect(false).catch(() => {}) }, [entries, connected])
  useEffect(() => {
    let live = true
    setErr('')
    spotOf(it, project).then((s) => { if (live) setSpot(s) }, (e) => { if (live) setErr(String(e?.message ?? e)) })
    return () => { live = false }
  }, [it.uid, it.path, it.scale, it.pivot, entries, ws])
  const options = useMemo(() => (spot ? swapOptions(spot, { models: entries ? swapPool(entries) : [], prefabs: swapPrefabs(ws) }) : []), [spot, entries, ws])
  if (err) return <span className="faint small">Can’t measure it: {err}</span>
  if (!spot) return <span className="faint small">Measuring…</span>
  const pick = (o: SwapOption) => run(() => swapItem(index, o))
  return (
    <div className="col" style={{ gap: 8 }}>
      <span className="faint small">About {size(spot)}. Click one to put it here instead, turned to fit; Ctrl+Z puts this one back.</span>
      {SWAP_WHY.map((why) => {
        const list = options.filter((o) => o.why === why)
        if (!list.length) return null
        return (
          <div key={why} className="col" style={{ gap: 4 }}>
            <span className="small muted">{SWAP_HEADINGS[why]}</span>
            <div className="prefab-grid">
              {list.map((o) => (
                <div key={o.key} className="prefab-tile">
                  <button className="prefab-pick" disabled={busy} onClick={() => pick(o)}
                    title={`${o.label}: ${size(o)}${o.key.startsWith('game:') ? ' · ' + NOTICE : ' · a site prefab'}`}>
                    <PrefabThumb shape={o.key} />
                    <span className="prefab-label">{o.label}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      })}
      {!options.length && <span className="faint small">Nothing else of about this size{entries ? '' : ' among the site’s prefabs'}.</span>}
      {!entries && <span className="faint small">Game models show here too once your game library is built (Prefabs → From my game).</span>}
    </div>
  )
}
