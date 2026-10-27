// "From Stilwater" in the Start a map dialog: an original city from the site's own pieces, for anyone, game or no
// game. Pick a size, see it from above with its districts, reroll until you like it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { CITY_SIZES, DISTRICTS, citySample, type CitySize } from '../lib/cityGen'
import { newSeed } from '../lib/mapWizard'
import type { Sample } from '../lib/sampleKit'
import { FooterActions } from './FooterActions'

const LOT_COLOURS = Object.fromEntries(Object.values(DISTRICTS).map((d) => [`${d.label} lot`, d.sketch]))

/** Top-down: district lots in their colours, streets dark, the river blue, buildings lighter the taller they are. */
export function CitySketch({ s }: { s: Sample }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const g = c.getContext('2d')!
    const size = c.width
    const ground = s.parts.filter((p) => p.label === 'Ground')
    const span = Math.max(...ground.map((p) => p.size[0])) + 8
    const k = size / span
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = '#26272b'
    g.fillRect(0, 0, size, size)
    g.setTransform(k, 0, 0, k, size / 2, size / 2)
    const draw = (p: Sample['parts'][number], fill: string) => {
      g.fillStyle = fill
      g.save()
      g.translate(p.at[0], p.at[2])
      g.rotate((-(p.rot ?? 0) * Math.PI) / 180)
      if (p.kind === 'blob' && p.outline) { g.beginPath(); p.outline.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z))); g.closePath(); g.fill() }
      else if (p.kind === 'cylinder') { g.beginPath(); g.ellipse(0, 0, p.size[0] / 2, p.size[2] / 2, 0, 0, Math.PI * 2); g.fill() }
      else g.fillRect(-p.size[0] / 2, -p.size[2] / 2, p.size[0], p.size[2])
      g.restore()
    }
    for (const p of s.parts) if (p.label === 'River' || p.label === 'Pond') draw(p, '#2e6f96')
    // Bridges carry the street over the water.
    for (const p of s.parts) if (p.label === 'Bridge deck') draw(p, '#26272b')
    for (const p of s.parts) if (LOT_COLOURS[p.label]) draw(p, LOT_COLOURS[p.label] + '66')
    for (const p of s.parts) if (p.label === 'Median') draw(p, '#4f8f45')
    // Buildings and big pieces: each placed prefab as one footprint (its parts' box, square to the prefab's own
    // heading), shaded by height; then anything else whose top stands above head height; the freeway on top.
    const groups = new Map<string, { x: number; z: number; rot: number; x0: number; x1: number; z0: number; z1: number; top: number }>()
    for (const p of s.parts) {
      if (!p.prefab || p.prefab.key === 'road' || !p.group) continue
      const { at, rot } = p.prefab
      const g0 = groups.get(p.group) ?? { x: at[0], z: at[2], rot, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, top: 0 }
      // The part in the prefab's frame.
      const t = (-rot * Math.PI) / 180, dx = p.at[0] - at[0], dz = p.at[2] - at[2]
      const lx = dx * Math.cos(t) + dz * Math.sin(t), lz = -dx * Math.sin(t) + dz * Math.cos(t)
      const a = (((p.rot ?? 0) - rot) * Math.PI) / 180, c = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a))
      const hx = (p.size[0] * c + p.size[2] * sn) / 2, hz = (p.size[0] * sn + p.size[2] * c) / 2
      g0.x0 = Math.min(g0.x0, lx - hx); g0.x1 = Math.max(g0.x1, lx + hx); g0.z0 = Math.min(g0.z0, lz - hz); g0.z1 = Math.max(g0.z1, lz + hz)
      g0.top = Math.max(g0.top, p.at[1] + p.size[1])
      groups.set(p.group, g0)
    }
    const shade = (top: number) => `hsl(215 12% ${40 + Math.min(1, top / 160) * 50}%)`
    for (const b of [...groups.values()].filter((b) => b.top > 6).sort((a, c) => a.top - c.top)) {
      g.fillStyle = shade(b.top)
      g.save(); g.translate(b.x, b.z); g.rotate((-b.rot * Math.PI) / 180); g.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0); g.restore()
    }
    const tall = s.parts.filter((p) => !p.prefab && p.at[1] + p.size[1] > 6 && p.at[1] < 4 && !/^(Ground|Wall)$|railing|pier|pillar|quay|bed|freeway/i.test(p.label)).sort((a, b) => a.at[1] + a.size[1] - (b.at[1] + b.size[1]))
    for (const p of tall) draw(p, shade(p.at[1] + p.size[1]))
    for (const p of s.parts) if (p.label === 'Freeway deck') draw(p, '#4a4b52')
    const dot = (color: string, r: number) => (q: number[]) => { g.fillStyle = color; g.beginPath(); g.arc(q[0], q[2], r / k, 0, Math.PI * 2); g.fill() }
    for (const [type, p] of s.markers) {
      if (type === 'Red team spawn') dot('#ff4d4d', 3.5)(p)
      else if (type === 'Blue team spawn') dot('#4d8dff', 3.5)(p)
      else if (type === 'Shared spawn') dot('#f2f2f2', 2.5)(p)
    }
  }, [s])
  return <canvas ref={ref} width={460} height={460} style={{ width: '100%', maxWidth: 460, aspectRatio: '1', borderRadius: 8, display: 'block' }} />
}

export function CityWizard({ busy, onCreate, footer = null }: { busy: boolean; onCreate: (s: Sample) => void; footer?: HTMLElement | null }) {
  const [size, setSize] = useState<CitySize>('town')
  const [seed, setSeed] = useState(newSeed)
  const [name, setName] = useState('')
  const sample = useMemo(() => citySample({ size, seed }), [size, seed])
  return (
    <div className="wizard">
      <div className="col" style={{ gap: 12, flex: '1 1 300px', minWidth: 0 }}>
        <p className="small muted">An original city in the style of Saints Row's Stilwater, built from the site's own pieces, so it works with or without the game: a river with bridges and quays, streets that bend and a diagonal avenue, downtown towers, a Chinatown-like quarter, a red-light strip, the projects, a barrio, suburbs, hillside homes, docks and factories, and parks, with sidewalks, street lamps, shops and parked cars.</p>
        <div className="col" style={{ gap: 6 }}>
          <span className="section-title">Size</span>
          <div className="row wrap">
            {(Object.keys(CITY_SIZES) as CitySize[]).map((k) => <button key={k} className={'sm' + (size === k ? ' on' : '')} onClick={() => setSize(k)}>{CITY_SIZES[k].label}</button>)}
          </div>
          <span className="faint small">{CITY_SIZES[size].hint}</span>
        </div>
        <label className="col" style={{ gap: 6 }}>
          <span className="section-title">Name</span>
          <input value={name} placeholder={sample.name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <div className="row wrap small" style={{ gap: 10 }}>
          {Object.values(DISTRICTS).map((d) => <span key={d.label} className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: d.sketch, display: 'inline-block' }} />{d.label}</span>)}
        </div>
      </div>
      <div className="col" style={{ gap: 6, flex: '1 1 300px', alignItems: 'stretch', minWidth: 0 }}>
        <CitySketch s={sample} />
        <span className="faint small">Seed {seed} · {sample.markers.filter(([t]) => /spawn/.test(t)).length} spawns · red and blue start at opposite ends.</span>
      </div>
      <FooterActions footer={footer}>
        <button onClick={() => setSeed(newSeed())} disabled={busy} title="Same size, a different city">🎲 Reroll</button>
        <button className="primary" disabled={busy} onClick={() => onCreate({ ...sample, name: name.trim() || sample.name })}>Create this city</button>
      </FooterActions>
    </div>
  )
}
