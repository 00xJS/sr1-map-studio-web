// "From a photo…": turn a picture into a building front or a cut-out panel.
import { useEffect, useState } from 'react'
import { useEditor, currentProject } from './store'
import { getViewer } from './Viewport'
import { Check, Field, FileButton, Modal, NumberInput, toastError } from '../ui'
import { canvasImage, decalParts, photoParts, preparePhoto, type PhotoImage, type PhotoKind } from '../lib/photoPiece'
import { TAG_STYLES, renderTag, type TagStyle } from '../lib/tagArt'
import { materialize } from '../lib/samples'
import type { Vec3 } from '../lib/project'

/** The tag or sticker waiting to be stuck on the next wall clicked. */
let pending: { img: PhotoImage; width: number; name: string } | null = null

/** Sticks the waiting tag or sticker where a wall was clicked (Viewport calls this in decal mode). */
export async function placePendingDecal(point: Vec3, normal: Vec3 | undefined) {
  if (!pending) return
  if (!normal || Math.abs(normal[1]) > 0.6) { toastError(new Error('Click a wall: tags and stickers go on upright surfaces.')); return }
  const parts = await decalParts(pending.img, pending.width, point, normal, pending.name)
  const { items, files } = await materialize(parts)
  const item = { ...items[0], name: pending.name, collision_disabled: true }
  useEditor.getState().update('Add ' + pending.name.toLowerCase(), (d) => { Object.assign(d.files, files); d.scene_items.push(item) })
}

export function PhotoDialog({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState<PhotoKind>('building')
  const [cut, setCut] = useState(true)
  const [img, setImg] = useState<PhotoImage | null>(null)
  const [width, setWidth] = useState(24)
  const [depth, setDepth] = useState(18)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState('')
  const [text, setText] = useState('SAINTS')
  const [style, setStyle] = useState<TagStyle>('spray')
  const [fill, setFill] = useState('#a24bd6')
  const [outline, setOutline] = useState('#111111')
  const [sticker, setSticker] = useState(false)

  useEffect(() => {
    // Tags redraw as you type.
    if (kind !== 'decal' || sticker) return
    const t = setTimeout(() => { const c = renderTag(text, style, fill, outline); setImg(canvasImage(c)); setPreview(c.toDataURL('image/png')) }, 120)
    return () => clearTimeout(t)
  }, [kind, sticker, text, style, fill, outline])

  useEffect(() => {
    if (!file || (kind === 'decal' && !sticker)) return
    let live = true
    preparePhoto(file, kind, cut).then((p) => {
      if (!live) return
      setImg(p)
      setPreview(p.canvas.toDataURL('image/png'))
    }).catch(toastError)
    return () => { live = false }
  }, [file, kind, cut, sticker])

  useEffect(() => { setWidth(kind === 'building' ? 24 : kind === 'decal' ? 8 : 6) }, [kind])

  const height = img ? width / img.aspect : 0
  const ws = currentProject()?.settings.world_scale || 0.5

  const stick = () => {
    if (!img) return
    pending = { img, width, name: name.trim() || (sticker ? 'Sticker' : `Tag ${text.trim().split('\n')[0].slice(0, 20)}`) }
    useEditor.getState().set({ placeMode: 'decal' })
    onClose()
  }

  const create = async () => {
    if (kind === 'decal') return stick()
    if (!img) return
    setBusy(true)
    try {
      const v = getViewer()
      const c = (v?.center() ?? [0, 0, 0]) as Vec3
      const y = v?.surfaceBelow(c[0], 1e4, c[2]) ?? 1
      const label = name.trim() || (kind === 'building' ? 'Photo building' : 'Photo cut-out')
      const parts = await photoParts(img, kind, { width, depth, x: c[0], z: c[2], y, name: label })
      const { items, files } = await materialize(parts)
      const item = { ...items[0], name: label }
      useEditor.getState().update('Add ' + label.toLowerCase(), (d) => { Object.assign(d.files, files); d.scene_items.push(item) })
      useEditor.getState().select({ kind: 'item', index: currentProject()!.scene_items.length - 1 })
      onClose()
    } catch (e) { toastError(e) } finally { setBusy(false) }
  }

  return (
    <Modal title="Make something from a photo" onClose={busy ? undefined : onClose}
      footer={<><button onClick={onClose} disabled={busy}>Cancel</button><button className="primary" disabled={!img || busy} onClick={create}>{busy ? 'Making it…' : kind === 'decal' ? 'Stick it on a wall' : 'Add to my map'}</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="row wrap">
          <button className={'sm' + (kind === 'building' ? ' on' : '')} onClick={() => setKind('building')}>🏢 Building front</button>
          <button className={'sm' + (kind === 'cutout' ? ' on' : '')} onClick={() => setKind('cutout')}>🪧 Cut-out</button>
          <button className={'sm' + (kind === 'decal' ? ' on' : '')} onClick={() => setKind('decal')}>🎨 Tag or sticker</button>
        </div>
        <span className="small muted">{kind === 'building'
          ? 'Take a photo straight at a shop, house or wall. It becomes the front of a building, and the sides are colored to match.'
          : kind === 'cutout' ? 'A sign, a poster, graffiti, a fence, anything flat. Against a plain background, the background is cut away.'
            : 'Graffiti, a crew tag, a poster or a logo, stuck flat on any wall you click. Players walk past it, not into it.'}</span>
        {kind === 'decal' && (
          <div className="row wrap">
            <button className={'sm' + (!sticker ? ' on' : '')} onClick={() => setSticker(false)}>✍️ Write text</button>
            <button className={'sm' + (sticker ? ' on' : '')} onClick={() => setSticker(true)}>🖼️ Use a picture</button>
          </div>
        )}
        {kind === 'decal' && !sticker && (
          <div className="col" style={{ gap: 8 }}>
            <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-label="Tag text" placeholder="Your tag" />
            <div className="row wrap">
              {(Object.keys(TAG_STYLES) as TagStyle[]).map((k) => <button key={k} className={'sm' + (style === k ? ' on' : '')} onClick={() => setStyle(k)}>{TAG_STYLES[k].label}</button>)}
            </div>
            <div className="row wrap">
              <label className="row small">Paint <input type="color" value={fill} onChange={(e) => setFill(e.target.value)} /></label>
              <label className="row small">Outline <input type="color" value={outline} onChange={(e) => setOutline(e.target.value)} /></label>
            </div>
          </div>
        )}
        {(kind !== 'decal' || sticker) && <div className="row wrap">
          <FileButton className="sm" accept="image/*" capture="environment" onFiles={(f) => f[0] && setFile(f[0])}>📷 Take a photo</FileButton>
          <FileButton className="sm" accept="image/*" onFiles={(f) => f[0] && setFile(f[0])}>Choose a picture…</FileButton>
          {file && <span className="small faint ellipsis">{file.name}</span>}
        </div>}
        {preview && (
          <div style={{ background: 'repeating-conic-gradient(#2a2430 0% 25%, #1b1720 0% 50%) 50% / 16px 16px', borderRadius: 8, padding: 8, textAlign: 'center' }}>
            <img src={preview} alt="Preview" style={{ maxWidth: '100%', maxHeight: 260 }} />
          </div>
        )}
        {(kind === 'cutout' || (kind === 'decal' && sticker)) && <Check checked={cut} onChange={setCut}>Cut away the background</Check>}
        <div className="row wrap" style={{ gap: 12 }}>
          <Field label="Width" hint={`${(width * ws).toFixed(1)} m in game`}><NumberInput value={width} min={1} max={200} step={1} onChange={setWidth} /></Field>
          {kind === 'building' && <Field label="Depth" hint={`${(depth * ws).toFixed(1)} m`}><NumberInput value={depth} min={2} max={200} step={1} onChange={setDepth} /></Field>}
          {img && <Field label="Height" hint="from the photo's shape"><span className="small">{height.toFixed(1)} ({(height * ws).toFixed(1)} m)</span></Field>}
        </div>
        <Field label="Name"><input value={name} placeholder={kind === 'building' ? 'Photo building' : kind === 'cutout' ? 'Photo cut-out' : 'Tag'} onChange={(e) => setName(e.target.value)} /></Field>
        <span className="faint small">{kind === 'decal' ? 'After this, click walls to stick it on; click Done when finished.' : 'It appears where the camera is looking; move and turn it like anything else.'} The picture stays in your browser.</span>
      </div>
    </Modal>
  )
}
