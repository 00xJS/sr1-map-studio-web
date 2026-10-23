// The home page's moving picture: a sample map built and rendered live in the
// editor's own viewer, the camera slowly circling it. Stays a still picture
// with reduced motion, and pauses while scrolled out of view.
import { useEffect, useRef, useState } from 'react'
import { Viewer } from '../editor/Viewer'
import { buildSample } from '../lib/samples'

const NOOP = { onPick() {}, onSurface() {}, onTransform() {}, onErase() {} }

export default function HeroReel({ sampleId, onReady }: { sampleId: string; onReady?: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let live = true
    let viewer: Viewer | null = null
    let io: IntersectionObserver | null = null
    void (async () => {
      // Let the page settle first: textures are generated on this thread.
      await new Promise((r) => setTimeout(r, 400))
      if (!live) return
      const project = await buildSample(sampleId, undefined, { compact: true })
      if (!live || !host.current) return
      viewer = new Viewer(host.current, NOOP)
      viewer.sync(project, { selection: null, gizmo: 'translate', wireframe: false, collisionView: 'off', soloMaterial: null, faceRange: [0, 0], readOnly: true, showGizmo: false })
      await viewer.whenLoaded()
      if (!live) return
      viewer.frameAll()
      viewer.zoomBy(0.62)
      viewer.flythrough(6)
      io = new IntersectionObserver(([e]) => viewer?.flythrough(e.isIntersecting ? 6 : 0))
      io.observe(host.current)
      setReady(true)
      onReady?.()
    })().catch(() => { /* the still picture stays */ })
    return () => { live = false; io?.disconnect(); viewer?.dispose() }
  }, [sampleId])
  return <div ref={host} className={'reel-canvas' + (ready ? ' ready' : '')} aria-hidden="true" />
}
