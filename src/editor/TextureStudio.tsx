// Texture studio: make a texture for one material from a photo, the
// generator or the free starter library, preview it tiled, and assign it
// together with the matching physical surface.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from './store'
import * as act from './actions'
import { Check, Field, FileButton, Modal, toastError, useBusy } from '../ui'
import { catalogs } from '../lib/catalogs'
import { flattenLighting, makeSeamless } from '../lib/images'
import { KINDS, PREFAB_ONLY, defaultParams, generate, type GenParams, type TextureKind } from '../lib/procedural'
import { SIGN_STYLES, signText, type SignStyle } from '../lib/signFont'
import { tagRecipe } from '../lib/recipes'

type Tab = 'photo' | 'generate' | 'library'
const SIZES = [256, 512, 1024, 2048]

interface LibraryEntry { id: string; name: string; surface: number; authors: string[]; source: string }

function toCanvas(px: Uint8ClampedArray, size: number): OffscreenCanvas {
  const c = new OffscreenCanvas(size, size)
  c.getContext('2d')!.putImageData(new ImageData(px, size, size), 0, 0)
  return c
}

async function canvasFile(c: OffscreenCanvas, name: string, type: 'image/png' | 'image/jpeg' = 'image/png') {
  const blob = await c.convertToBlob(type === 'image/jpeg' ? { type, quality: 0.92 } : { type })
  return new File([blob], name, { type })
}

/** Draws the source 3 × 3 so seams show. */
function TilePreview({ source }: { source: CanvasImageSource & { width: number; height: number } | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [tiled, setTiled] = useState(true)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#100d13'
    ctx.fillRect(0, 0, c.width, c.height)
    if (!source) return
    const n = tiled ? 3 : 1
    const step = c.width / n
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) ctx.drawImage(source, x * step, y * step, step, step)
  }, [source, tiled])
  return (
    <div className="col" style={{ alignItems: 'center' }}>
      <canvas ref={ref} width={300} height={300} style={{ width: 300, height: 300, borderRadius: 6, border: '1px solid var(--line-strong)' }} />
      <Check checked={tiled} onChange={setTiled}>Show tiled 3 × 3</Check>
    </div>
  )
}

export function TextureStudio({ index, mat, onClose }: { index: number; mat: string; onClose: () => void }) {
  const item = useEditor((s) => s.project!.scene_items[index])
  const [tab, setTab] = useState<Tab>('photo')
  const [surface, setSurface] = useState<number>(item?.surface_ids?.[mat] ?? 0)
  const [size, setSize] = useState(1024)
  const [preview, setPreview] = useState<OffscreenCanvas | ImageBitmap | null>(null)
  const make = useRef<(() => Promise<File>) | null>(null)
  const [run, busy] = useBusy()

  const use = () => run(async () => {
    if (!make.current) throw new Error('Choose or make a texture first.')
    const file = await make.current()
    await act.assignTexture(index, mat, file, surface)
    onClose()
  })

  return (
    <Modal title={`Texture for ${mat}`} onClose={onClose} wide footer={<>
      <Field label="Surface (footsteps, impacts)">
        <select value={surface} onChange={(e) => setSurface(+e.target.value)}>
          {catalogs.surface_types.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>
      </Field>
      <span className="spacer" />
      <button className="quiet" onClick={onClose}>Cancel</button>
      <button className="primary" disabled={busy || !preview} onClick={use}>{busy ? 'Saving…' : 'Use texture'}</button>
    </>}>
      <div className="tabs" style={{ padding: 0 }}>
        {([['photo', 'From a photo'], ['generate', 'Generate'], ['library', 'Starter library']] as const).map(([k, label]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => { setTab(k); setPreview(null); make.current = null }}>{label}</button>
        ))}
      </div>
      <div className="row" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div className="col grow" style={{ minWidth: 260 }}>
          {tab === 'photo' && <PhotoTab size={size} onPreview={setPreview} make={make} />}
          {tab === 'generate' && <GenerateTab size={size} onPreview={setPreview} make={make} onSurface={setSurface} />}
          {tab === 'library' && <LibraryTab onPreview={setPreview} make={make} onSurface={setSurface} />}
          {tab !== 'library' && (
            <Field label="Texture size" hint="1024 suits most surfaces. Bigger textures use more of the map's texture memory.">
              <select value={size} onChange={(e) => setSize(+e.target.value)}>{SIZES.map((s) => <option key={s} value={s}>{s} × {s}</option>)}</select>
            </Field>
          )}
        </div>
        <TilePreview source={preview} />
      </div>
    </Modal>
  )
}

interface TabProps { onPreview: (c: OffscreenCanvas | ImageBitmap | null) => void; make: React.MutableRefObject<(() => Promise<File>) | null> }

// ---------------- photo ----------------

interface PhotoOpts { whole: boolean; zoom: number; panX: number; panY: number; flatten: number; seamless: boolean; blend: number; brightness: number }

function renderPhoto(bmp: ImageBitmap, o: PhotoOpts, size: number): OffscreenCanvas {
  const c = new OffscreenCanvas(size, size)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  if (o.whole) ctx.drawImage(bmp, 0, 0, size, size)
  else {
    const side = Math.min(bmp.width, bmp.height) / o.zoom
    const sx = o.panX * (bmp.width - side), sy = o.panY * (bmp.height - side)
    ctx.drawImage(bmp, sx, sy, side, side, 0, 0, size, size)
  }
  let px = ctx.getImageData(0, 0, size, size).data
  if (o.flatten > 0) {
    // A tiny copy scaled back up is a cheap, very wide blur: the photo's lighting.
    const tiny = new OffscreenCanvas(6, 6)
    const tctx = tiny.getContext('2d')!
    tctx.drawImage(c, 0, 0, 6, 6)
    const big = new OffscreenCanvas(size, size)
    const bctx = big.getContext('2d', { willReadFrequently: true })!
    bctx.imageSmoothingQuality = 'high'
    bctx.drawImage(tiny, 0, 0, size, size)
    px = flattenLighting(px, bctx.getImageData(0, 0, size, size).data, o.flatten)
  }
  if (o.seamless) px = makeSeamless(px, size, size, o.blend)
  if (o.brightness !== 0) {
    const k = 1 + o.brightness / 100
    for (let i = 0; i < px.length; i += 4) { px[i] *= k; px[i + 1] *= k; px[i + 2] *= k }
  }
  ctx.putImageData(new ImageData(new Uint8ClampedArray(px), size, size), 0, 0)
  return c
}

function PhotoTab({ size, onPreview, make }: TabProps & { size: number }) {
  const [bmp, setBmp] = useState<ImageBitmap | null>(null)
  const [name, setName] = useState('photo')
  const [o, setO] = useState<PhotoOpts>({ whole: false, zoom: 1, panX: 0.5, panY: 0.5, flatten: 0.6, seamless: true, blend: 0.5, brightness: 0 })
  const set = (patch: Partial<PhotoOpts>) => setO((x) => ({ ...x, ...patch }))
  const load = async (f: File) => {
    try {
      setBmp(await createImageBitmap(f, { imageOrientation: 'from-image' }))
      setName(f.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 40) || 'photo')
    } catch { toastError(new Error('That image could not be read. Use a JPG or PNG.')) }
  }
  useEffect(() => {
    if (!bmp) { onPreview(null); make.current = null; return }
    const t = setTimeout(() => onPreview(renderPhoto(bmp, o, 256)), 60)
    make.current = () => canvasFile(renderPhoto(bmp, o, size), `${name}_${size}.png`)
    return () => clearTimeout(t)
  }, [bmp, o, size])
  return (
    <>
      <div className="row wrap">
        <FileButton className="primary" accept="image/*" onFiles={([f]) => load(f)}>Choose image…</FileButton>
        <FileButton accept="image/*" capture="environment" onFiles={([f]) => load(f)} title="On a phone or tablet this opens the camera">Take photo</FileButton>
      </div>
      <p className="faint small">Shoot straight at the surface in even daylight, avoiding shadows and the flash. Your own photos are yours to share.</p>
      {bmp && (
        <>
          <Check checked={o.whole} onChange={(v) => set({ whole: v })}>Use the whole image (stretch to square)</Check>
          {!o.whole && (
            <div className="form-grid">
              <Field label={`Zoom: ${o.zoom.toFixed(1)}×`}><input type="range" min={1} max={4} step={0.1} value={o.zoom} onChange={(e) => set({ zoom: +e.target.value })} /></Field>
              <Field label="Left / right"><input type="range" min={0} max={1} step={0.01} value={o.panX} onChange={(e) => set({ panX: +e.target.value })} /></Field>
              <Field label="Up / down"><input type="range" min={0} max={1} step={0.01} value={o.panY} onChange={(e) => set({ panY: +e.target.value })} /></Field>
            </div>
          )}
          <Field label={`Even out lighting: ${Math.round(o.flatten * 100)}%`} hint="Removes shading and gradients from the photo so it repeats cleanly.">
            <input type="range" min={0} max={1} step={0.05} value={o.flatten} onChange={(e) => set({ flatten: +e.target.value })} />
          </Field>
          <Check checked={o.seamless} onChange={(v) => set({ seamless: v })}>Make seamless (blend the edges so it tiles)</Check>
          {o.seamless && <Field label={`Blend width: ${Math.round(o.blend * 100)}%`}><input type="range" min={0.1} max={1} step={0.05} value={o.blend} onChange={(e) => set({ blend: +e.target.value })} /></Field>}
          <Field label={`Brightness: ${o.brightness > 0 ? '+' : ''}${o.brightness}%`}><input type="range" min={-50} max={50} step={5} value={o.brightness} onChange={(e) => set({ brightness: +e.target.value })} /></Field>
        </>
      )}
    </>
  )
}

// ---------------- generator ----------------

function GenerateTab({ size, onPreview, make, onSurface }: TabProps & { size: number; onSurface: (n: number) => void }) {
  const [p, setP] = useState<GenParams>(defaultParams('concrete', 256))
  const set = (patch: Partial<GenParams>) => setP((x) => ({ ...x, ...patch }))
  const info = KINDS[p.kind]
  useEffect(() => { onSurface(KINDS[p.kind].surface) }, [p.kind])
  useEffect(() => {
    const t = setTimeout(() => onPreview(toCanvas(generate({ ...p, size: 256 }), 256)), 40)
    // The recipe keeps a sign's words as they will show.
    const q = p.kind === 'lettering' ? { ...p, text: signText(p.text ?? '') } : p
    make.current = async () => tagRecipe(await canvasFile(toCanvas(generate({ ...q, size }), size), `${q.kind}_${q.seed}_${size}.png`), { kind: 'generated', params: { ...q, size } })
    return () => clearTimeout(t)
  }, [p, size])
  return (
    <>
      <div className="chips" style={{ gap: 6 }}>
        {(Object.keys(KINDS) as TextureKind[]).filter((k) => !PREFAB_ONLY.has(k)).map((k) => (
          <button key={k} className={'sm' + (p.kind === k ? ' on' : '')} onClick={() => setP({ ...defaultParams(k, 256), seed: p.seed })}>{KINDS[k].label}</button>
        ))}
      </div>
      {p.kind === 'lettering' && (
        <Field label="Text" hint="Shows in capitals: two lines of up to 24 letters.">
          <textarea rows={2} maxLength={80} value={p.text ?? ''} onChange={(e) => set({ text: e.target.value })} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
        </Field>
      )}
      <div className="form-grid">
        {p.kind === 'lettering' && (
          <Field label="Style">
            <select value={p.style} onChange={(e) => { const style = e.target.value as SignStyle; set({ style, color: SIGN_STYLES[style].color, accent: SIGN_STYLES[style].accent }) }}>
              {Object.entries(SIGN_STYLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
        )}
        <Field label="Color"><input type="color" value={p.color} onChange={(e) => set({ color: e.target.value })} /></Field>
        <Field label={info.accentLabel}><input type="color" value={p.accent} onChange={(e) => set({ accent: e.target.value })} /></Field>
        <Field label={`${info.scaleLabel}: ${p.scale}`}><input type="range" min={1} max={32} step={1} value={p.scale} onChange={(e) => set({ scale: +e.target.value })} /></Field>
        <Field label={`Wear: ${Math.round(p.wear * 100)}%`}><input type="range" min={0} max={1} step={0.05} value={p.wear} onChange={(e) => set({ wear: +e.target.value })} /></Field>
        {p.kind === 'asphalt' && (
          <Field label="Road line">
            <select value={p.line} onChange={(e) => set({ line: e.target.value as GenParams['line'] })}>
              <option value="none">None</option><option value="yellow">Yellow (line color)</option><option value="white">White</option>
            </select>
          </Field>
        )}
      </div>
      <div className="row"><button className="sm" onClick={() => set({ seed: 1 + Math.floor(Math.random() * 99999) })}>🎲 New variation</button><span className="faint small">Generated textures are made from scratch, so they're free to share.</span></div>
    </>
  )
}

// ---------------- library ----------------

let libraryPromise: Promise<LibraryEntry[]> | null = null
const loadLibrary = () => (libraryPromise ??= fetch('/textures/index.json').then((r) => {
  if (!r.ok) throw new Error('The starter library could not be loaded.')
  return r.json()
}).then((d) => d.textures as LibraryEntry[]))

function LibraryTab({ onPreview, make, onSurface }: TabProps & { onSurface: (n: number) => void }) {
  const [items, setItems] = useState<LibraryEntry[]>([])
  const [selected, setSelected] = useState<LibraryEntry | null>(null)
  const [filter, setFilter] = useState('')
  useEffect(() => { loadLibrary().then(setItems, toastError) }, [])
  const shown = useMemo(() => items.filter((t) => `${t.name} ${catalogs.surface_types[t.surface]}`.toLowerCase().includes(filter.toLowerCase())), [items, filter])
  const pick = async (t: LibraryEntry) => {
    setSelected(t)
    onSurface(t.surface)
    const blob = await (await fetch(`/textures/${t.id}.jpg`)).blob()
    onPreview(await createImageBitmap(blob))
    make.current = async () => tagRecipe(new File([blob], `${t.id}.jpg`, { type: 'image/jpeg' }), { kind: 'library', id: t.id })
  }
  return (
    <>
      <input placeholder="Filter: brick, metal, grass…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 6, maxHeight: 300, overflow: 'auto' }}>
        {shown.map((t) => (
          <button key={t.id} title={`${t.name} · ${catalogs.surface_types[t.surface]}`} onClick={() => pick(t).catch(toastError)}
            className={selected?.id === t.id ? 'on' : ''} style={{ flexDirection: 'column', padding: 4, gap: 2, whiteSpace: 'normal' }}>
            <img src={`/textures/thumbs/${t.id}.jpg`} alt="" loading="lazy" style={{ width: 72, height: 72, borderRadius: 4, display: 'block' }} />
            <span className="small" style={{ lineHeight: 1.1 }}>{t.name}</span>
          </button>
        ))}
      </div>
      {selected
        ? <p className="faint small">{selected.name} by {selected.authors.join(', ')}, from <a href={selected.source} target="_blank" rel="noreferrer">Poly Haven</a>. CC0: free to use and share.</p>
        : <p className="faint small">Textures from <a href="https://polyhaven.com" target="_blank" rel="noreferrer">Poly Haven</a>, all CC0 (public domain): free to use and share in your maps.</p>}
    </>
  )
}
