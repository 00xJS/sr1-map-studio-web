// What the map health checks draw in the 3D view: a coloured tile over every
// standable spot (how exposed it is, how busy, or which side gets there
// first), the sniper lanes, and numbered spawn badges coloured by risk.
import * as THREE from 'three'
import type { HealthReport, Risk } from '../lib/analysis/types'

export type OverlayKind = 'off' | 'sight' | 'crouch' | 'traffic' | 'spawns' | 'sides'

export const RISK_COLORS: Record<Risk, string> = { ok: '#4fd18b', watch: '#ffc23d', campable: '#ff5d6c' }
const EYE = 3.24

/** 0 hidden (blue) → 1 seen by the whole map (red). */
function heat(v: number, out: THREE.Color) { return out.setHSL(0.62 * (1 - Math.min(1, v * 1.6)), 0.9, 0.5) }
/** Few runs (dim purple) → busiest (bright yellow), through red. */
function busy(v: number, out: THREE.Color) { const t = Math.sqrt(v); return out.setHSL((0.8 + 0.35 * t) % 1, 1, 0.22 + 0.4 * t) }

export interface Overlay { object: THREE.Object3D; dispose(): void }

export function buildOverlay(r: HealthReport, kind: OverlayKind, focus: number | null): Overlay {
  const root = new THREE.Group()
  root.name = 'health-overlay'
  const disposables: { dispose(): void }[] = []
  const keep = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x }

  if (kind !== 'spawns') root.add(tiles(r, kind, keep))
  if (kind === 'sight' || kind === 'crouch') root.add(lines(r.lanes.map((l) => [l.from, l.to]), 0xff3355, 0.9, keep))
  if (kind === 'traffic') for (const p of r.hotspots) root.add(ring([p[0], p[1] + 0.15, p[2]], 6, 0xffe066, keep))
  // Spawn badges on every overlay, and lines from the places that can see the spawn picked in the panel.
  for (const s of r.spawns) {
    const show = kind === 'spawns' || s.risk !== 'ok' || s.number === focus
    if (!show) continue
    root.add(badge(String(s.number), RISK_COLORS[s.risk], [s.position[0], s.position[1] + 5, s.position[2]], s.number === focus ? 4.2 : 3, keep))
    if (s.number === focus) {
      const eye: [number, number, number] = [s.position[0], s.position[1] + EYE, s.position[2]]
      root.add(lines(s.seenFrom.map((p) => [[p[0], p[1] + EYE, p[2]], eye]), new THREE.Color(RISK_COLORS[s.risk]).getHex(), 0.75, keep))
    }
  }
  root.traverse((o) => { o.raycast = () => {} })
  return { object: root, dispose: () => disposables.forEach((d) => d.dispose()) }
}

function tiles(r: HealthReport, kind: OverlayKind, keep: <T extends { dispose(): void }>(x: T) => T): THREE.Object3D {
  const { grid } = r
  const list: number[] = []
  for (let i = 0; i < grid.count; i++) {
    if (!grid.reachable[i]) continue
    if (kind === 'traffic' && r.traffic[i] < 0.04) continue
    if (kind === 'sides' && !r.territory[i]) continue
    list.push(i)
  }
  const size = grid.cell * 0.92
  const geo = keep(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2))
  const mat = keep(new THREE.MeshBasicMaterial({ transparent: true, opacity: kind === 'traffic' ? 0.75 : 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length))
  mesh.count = list.length
  const m = new THREE.Matrix4(), c = new THREE.Color()
  const red = new THREE.Color('#ff4d5e'), blue = new THREE.Color('#4d8bff')
  list.forEach((n, k) => {
    m.makeTranslation(grid.pos[n * 3], grid.pos[n * 3 + 1] + 0.06, grid.pos[n * 3 + 2])
    mesh.setMatrixAt(k, m)
    if (kind === 'sight') heat(r.exposure[n], c)
    else if (kind === 'crouch') heat(r.exposureCrouch[n], c)
    else if (kind === 'traffic') busy(r.traffic[n], c)
    else c.copy(r.territory[n] < 0 ? red : blue)
    mesh.setColorAt(k, c)
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.frustumCulled = false
  mesh.renderOrder = 2
  return mesh
}

function lines(segs: [ArrayLike<number>, ArrayLike<number>][], color: number, opacity: number, keep: <T extends { dispose(): void }>(x: T) => T): THREE.Object3D {
  const pos = new Float32Array(segs.length * 6)
  segs.forEach(([a, b], i) => { pos.set([a[0], a[1], a[2], b[0], b[1], b[2]], i * 6) })
  const geo = keep(new THREE.BufferGeometry())
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const seg = new THREE.LineSegments(geo, keep(new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false })))
  seg.renderOrder = 4
  return seg
}

function ring(at: [number, number, number], radius: number, color: number, keep: <T extends { dispose(): void }>(x: T) => T): THREE.Object3D {
  const mesh = new THREE.Mesh(keep(new THREE.RingGeometry(radius * 0.8, radius, 40).rotateX(-Math.PI / 2)), keep(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide })))
  mesh.position.set(...at)
  mesh.renderOrder = 3
  return mesh
}

/** A round numbered badge that always faces the camera and shows through walls. */
function badge(text: string, color: string, at: [number, number, number], size: number, keep: <T extends { dispose(): void }>(x: T) => T): THREE.Object3D {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = color
  g.beginPath(); g.arc(32, 32, 29, 0, Math.PI * 2); g.fill()
  g.lineWidth = 4; g.strokeStyle = '#120f15'; g.stroke()
  g.fillStyle = '#120f15'
  g.font = `bold ${text.length > 1 ? 30 : 36}px system-ui, sans-serif`
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(text, 32, 34)
  const tex = keep(new THREE.CanvasTexture(c))
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })))
  sprite.position.set(...at)
  sprite.scale.set(size, size, 1)
  sprite.renderOrder = 5
  return sprite
}
