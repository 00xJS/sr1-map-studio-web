// The vehicle picker for Vehicle spawn markers: every vehicle by name, the four the retail multiplayer Gangsta Brawl
// maps use first, each with a small picture and its size once the player's own game files are open (drawn in this
// browser from their files, kept on this device only), and a box for a custom game ID.
import { useEffect, useState } from 'react'
import type { MeshPhongMaterial, Texture } from 'three'
import { PrefabThumb } from './PrefabThumb'
import { registerThumbSource, resetThumbs } from '../lib/prefabThumbs'
import { RETAIL_MP_VEHICLES, loadCar, openVehicles, useVehicles, vehicleChoices, vehicleName } from '../lib/vehicles/client'

const THUMB_VERSION = 1

registerThumbSource('vehicle:', {
  sig: (key) => `v${THUMB_VERSION}:${key.slice(8)}`,
  async draw(key) {
    const r = await loadCar(key.slice(8))
    if (!r) return null
    const [{ carObject }, { drawObject }, THREE] = await Promise.all([import('../lib/vehicles/render'), import('../lib/prefabRender'), import('three')])
    const car = carObject(r)
    const maps = new Set<Texture>()
    car.traverse((o) => { if (o instanceof THREE.Mesh) for (const m of [o.material].flat() as MeshPhongMaterial[]) if (m.map) maps.add(m.map) })
    // As the editor shows it (front to -Z, X mirrored back), turned to the thumbnails' 3/4 view.
    const holder = new THREE.Group()
    car.scale.set(1, 1, -1)
    holder.add(car)
    holder.rotation.y = Math.PI * 0.85
    const blob = await drawObject(holder)
    maps.forEach((t) => t.dispose())
    return blob
  },
})
// Pictures asked for before the game files were open are drawn once they are.
useVehicles.subscribe((s, prev) => { if (s.open && !prev.open) resetThumbs('vehicle:') })

const sizeText = (s: [number, number, number] | undefined) => (s ? `${s[0].toFixed(1)} × ${s[1].toFixed(1)} m` : '')

export function VehiclePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const sizes = useVehicles((s) => s.sizes)
  const filesOpen = useVehicles((s) => s.open)
  useEffect(() => { void openVehicles() }, [])
  const id = value.toLowerCase()
  const choices = vehicleChoices()
  const known = choices.some((c) => c.id.toLowerCase() === id)
  const row = (c: { id: string; name: string }) => (
    <button type="button" key={c.id} className={'list-item' + (c.id.toLowerCase() === id ? ' selected' : '')} aria-pressed={c.id.toLowerCase() === id} onClick={() => { onChange(c.id); setOpen(false) }} title={c.id}>
      <PrefabThumb shape={'vehicle:' + c.id.toLowerCase()} size={40} />
      <span className="grow">{c.name}</span>
      <span className="meta mono">{sizeText(sizes[c.id.toLowerCase()])}</span>
    </button>
  )
  return (
    <div className="vehicle-picker" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button type="button" className="list-item" style={{ border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-input)' }} onClick={() => setOpen(!open)} aria-expanded={open} title={value}>
        <PrefabThumb shape={'vehicle:' + id} size={40} />
        <span className="grow">{vehicleName(value)}{!known && <span className="faint"> (custom ID)</span>}</span>
        <span className="meta mono">{sizeText(sizes[id])}</span>
        <span className="faint">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="list" style={{ maxHeight: 320 }}>
          <div className="list-head">Used in retail multiplayer maps</div>
          {choices.filter((c) => RETAIL_MP_VEHICLES.includes(c.id.toLowerCase())).map(row)}
          <div className="list-head">All vehicles</div>
          {choices.filter((c) => !RETAIL_MP_VEHICLES.includes(c.id.toLowerCase())).map(row)}
        </div>
      )}
      {open && (
        <div className="row">
          <input className="grow" placeholder="Custom game ID, e.g. car_2dr_sports03" value={custom} onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && custom.trim()) { onChange(custom.trim()); setOpen(false) } }} />
          <button className="sm" disabled={!custom.trim()} onClick={() => { onChange(custom.trim()); setOpen(false) }}>Use</button>
        </div>
      )}
      {!filesOpen && <span className="small faint">Open your game files (Prefabs → From my game) to see each car, its size, and the car itself at the marker.</span>}
    </div>
  )
}
