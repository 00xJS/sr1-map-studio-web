// A prefab's thumbnail, asked for only while it is on screen (see lib/prefabThumbs.ts).
// Used by the prefab browser and the map catalog.
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { readyThumb, subscribeThumb } from '../lib/prefabThumbs'
import type { ThumbBundle } from '../lib/prefabRender'

type Watch = (el: Element, fn: (visible: boolean) => void) => () => void

/** One IntersectionObserver for many tiles; `root` is the scrolling box they sit in (null: the page). */
export function makeWatcher(root: Element | null, margin = '200px'): Watch {
  const fns = new Map<Element, (visible: boolean) => void>()
  let io: IntersectionObserver | null = null
  return (el, fn) => {
    io ??= new IntersectionObserver((list) => list.forEach((e) => fns.get(e.target)?.(e.isIntersecting)), { root, rootMargin: margin })
    fns.set(el, fn)
    io.observe(el)
    return () => { fns.delete(el); io?.unobserve(el) }
  }
}

const pageWatcher = typeof IntersectionObserver === 'function' ? makeWatcher(null) : null
/** The watcher thumbnails use; the prefab browser provides one for its scrolling grid. */
export const ThumbWatch = createContext<Watch | null>(null)

export function PrefabThumb({ shape, saved, size }: { shape: string; saved?: { sig: string; bundle: ThumbBundle }; size?: number }) {
  const el = useRef<HTMLSpanElement>(null)
  const watch = useContext(ThumbWatch) ?? pageWatcher
  const [url, setUrl] = useState<string | null | undefined>(() => (saved ? undefined : readyThumb(shape)))
  useEffect(() => {
    const known = saved ? undefined : readyThumb(shape)
    setUrl(known)
    if (known !== undefined) return
    let off: (() => void) | null = null
    const want = () => { off ??= subscribeThumb(shape, setUrl, saved) }
    if (!watch || !el.current) { want(); return () => off?.() }
    const stop = watch(el.current, (visible) => {
      if (visible) want()
      else if (off) { off(); off = null }
    })
    return () => { stop(); off?.() }
  }, [shape, saved?.sig, watch])
  const style = size ? { width: size, height: size } : undefined
  return (
    <span ref={el} className={'prefab-thumb' + (url === undefined ? ' loading' : '')} style={style} aria-hidden>
      {url && <img src={url} alt="" draggable={false} />}
      {url === null && <span className="prefab-thumb-none">◇</span>}
    </span>
  )
}
