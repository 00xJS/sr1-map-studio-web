// The "Map wizard" tab of the Start a map dialog: pick a setting, a layout,
// how many players and how busy, see it from above, reroll until you like it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { DENSITY, LAYOUTS, SETTINGS, newSeed, wizardSample, type WizardDensity, type WizardLayout, type WizardOptions, type WizardSetting } from '../lib/mapWizard'
import { mapSize } from '../lib/sampleScale'
import type { Sample } from '../lib/sampleKit'

const PLAYERS = [4, 6, 8, 10, 12]

/** Top-down sketch of a generated map, laid out like its minimap (+X right, +Z down). */
function Sketch({ s }: { s: Sample }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const g = c.getContext('2d')!
    const size = c.width
    const groundPart = s.parts.find((p) => p.label === 'Ground')
    const span = Math.max(groundPart?.size[0] ?? 100, groundPart?.size[2] ?? 100) + 6
    const k = size / span
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = '#101014'
    g.fillRect(0, 0, size, size)
    g.setTransform(k, 0, 0, k, size / 2, size / 2)
    const top = (p: Sample['parts'][number]) => p.at[1] + p.size[1]
    const ordered = s.parts.filter((p) => p.label !== 'Ground').sort((a, b) => top(a) - top(b))
    if (groundPart) {
      g.fillStyle = s.theme === 'Cyber' ? '#1b1d2e' : s.theme === 'Urban paintball' ? '#35522a' : '#3a3c40'
      g.fillRect(-groundPart.size[0] / 2, -groundPart.size[2] / 2, groundPart.size[0], groundPart.size[2])
    }
    for (const p of ordered) {
      const h = Math.min(1, Math.max(0, (top(p) - 1) / 24))
      const raised = /Platform|Ramp|Deck/.test(p.label)
      g.fillStyle = raised ? `hsl(38 45% ${42 + h * 30}%)`
        : s.theme === 'Cyber' ? `hsl(280 45% ${30 + h * 45}%)`
          : `hsl(215 12% ${38 + h * 45}%)`
      g.save()
      g.translate(p.at[0], p.at[2])
      g.rotate((-(p.rot ?? 0) * Math.PI) / 180)
      if (p.kind === 'cylinder') { g.beginPath(); g.ellipse(0, 0, p.size[0] / 2, p.size[2] / 2, 0, 0, Math.PI * 2); g.fill() }
      else g.fillRect(-p.size[0] / 2, -p.size[2] / 2, p.size[0], p.size[2])
      g.restore()
    }
    const dot = (color: string, r: number) => (p: number[]) => { g.fillStyle = color; g.beginPath(); g.arc(p[0], p[2], r / k, 0, Math.PI * 2); g.fill() }
    for (const [type, p] of s.markers) {
      if (type === 'Red team spawn') dot('#ff4d4d', 3.5)(p)
      else if (type === 'Blue team spawn') dot('#4d8dff', 3.5)(p)
      else if (type === 'Shared spawn') dot('#f2f2f2', 2.5)(p)
      else if (type === 'Weapon pickup') dot('#ffd23f', 2.5)(p)
      else if (type === 'Chains drop-off') dot('#3dff9a', 3.5)(p)
    }
  }, [s])
  return <canvas ref={ref} width={420} height={420} style={{ width: '100%', maxWidth: 420, aspectRatio: '1', borderRadius: 8, display: 'block' }} />
}

export function MapWizard({ busy, onCreate, onBlank }: { busy: boolean; onCreate: (s: Sample) => void; onBlank?: () => void }) {
  const [o, setO] = useState<WizardOptions>(() => ({ setting: 'downtown', layout: 'blocks', players: 10, density: 'normal', seed: newSeed() }))
  const [name, setName] = useState('')
  const set = (patch: Partial<WizardOptions>) => setO((x) => ({ ...x, ...patch }))
  const sample = useMemo(() => wizardSample(o), [o])
  const size = mapSize(sample)
  const count = (...t: string[]) => sample.markers.filter(([m]) => t.includes(m)).length
  return (
    <div className="wizard">
      <div className="col" style={{ gap: 12, flex: '1 1 300px', minWidth: 0 }}>
        <div className="col" style={{ gap: 6 }}>
          <span className="section-title">Setting</span>
          <div className="row wrap">
            {(Object.keys(SETTINGS) as WizardSetting[]).map((k) => (
              <button key={k} className={'sm' + (o.setting === k ? ' on' : '')} title={SETTINGS[k].hint} onClick={() => set({ setting: k })}>{SETTINGS[k].icon} {SETTINGS[k].label}</button>
            ))}
          </div>
          <span className="faint small">{SETTINGS[o.setting].hint}</span>
        </div>
        <div className="col" style={{ gap: 6 }}>
          <span className="section-title">Layout</span>
          <div className="row wrap">
            {(Object.keys(LAYOUTS) as WizardLayout[]).map((k) => (
              <button key={k} className={'sm' + (o.layout === k ? ' on' : '')} title={LAYOUTS[k].hint} onClick={() => set({ layout: k })}>{LAYOUTS[k].label}</button>
            ))}
          </div>
          <span className="faint small">{LAYOUTS[o.layout].hint}</span>
        </div>
        <div className="row wrap" style={{ gap: 16 }}>
          <div className="col" style={{ gap: 6 }}>
            <span className="section-title">Players</span>
            <div className="row">
              {PLAYERS.map((n) => <button key={n} className={'sm' + (o.players === n ? ' on' : '')} onClick={() => set({ players: n })}>{n}</button>)}
            </div>
          </div>
          <div className="col" style={{ gap: 6 }}>
            <span className="section-title">How busy</span>
            <div className="row">
              {(Object.keys(DENSITY) as WizardDensity[]).map((k) => <button key={k} className={'sm' + (o.density === k ? ' on' : '')} onClick={() => set({ density: k })}>{DENSITY[k].label}</button>)}
            </div>
          </div>
        </div>
        <label className="col" style={{ gap: 6 }}>
          <span className="section-title">Name</span>
          <input value={name} placeholder={sample.name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <div className="row wrap">
          <button onClick={() => set({ seed: newSeed() })} disabled={busy} title="Same choices, a different map">🎲 Reroll</button>
          <button className="primary" disabled={busy} onClick={() => onCreate({ ...sample, name: name.trim() || sample.name })}>Create this map</button>
          {onBlank && <button className="link small" disabled={busy} onClick={onBlank}>or start blank</button>}
        </div>
      </div>
      <div className="col" style={{ gap: 6, flex: '1 1 300px', alignItems: 'stretch', minWidth: 0 }}>
        <Sketch s={sample} />
        <span className="small muted">
          {size.widthM} × {size.depthM} m · about {size.players} players · {count('Red team spawn', 'Blue team spawn', 'Shared spawn')} spawns · {count('Weapon pickup')} weapons
        </span>
        <span className="faint small">
          <span style={{ color: '#ff4d4d' }}>●</span> red <span style={{ color: '#4d8dff' }}>●</span> blue <span style={{ color: '#f2f2f2' }}>●</span> anyone{' '}
          <span style={{ color: '#ffd23f' }}>●</span> weapon <span style={{ color: '#3dff9a' }}>●</span> chains drop-off · lighter is taller, tan is a deck or ramp. Seed {o.seed}.
        </span>
      </div>
    </div>
  )
}
