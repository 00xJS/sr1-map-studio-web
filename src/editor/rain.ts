// Rain in the walk-through, for checking a map's rain blockers: streaks falling round the camera that fade out
// while the camera is inside a rain-stopping box, as the game fades its rain (lib/rainPreview.ts), and the boxes'
// outlines when asked for. Only drawn while walking (the viewer steps it each frame then).
import * as THREE from 'three'
import { insideRain, type RainBox } from '../lib/rainPreview'

/** Metres: how far round the camera drops fall, how high the column is, how fast and how long a streak is. */
const RADIUS = 14, HEIGHT = 16, SPEED = 9, STREAK = 0.45
const MAX_DROPS = 4000
/** Seconds the rain takes to fade in or out at a box's edge (py/regions.py BLEND). */
const BLEND = 1

const BOX = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0))

export class Rain {
  readonly root = new THREE.Group()
  private lines: THREE.LineSegments
  private mat = new THREE.LineBasicMaterial({ color: 0xb8c6d6, transparent: true, opacity: 0, depthWrite: false })
  private drops = new Float32Array(MAX_DROPS * 3)
  private outlines = new THREE.Group()
  private amount = 0
  private ws = 0.5
  private boxes: RainBox[] = []
  private level = 0
  /** The camera is inside a rain-stopping box. */
  dry = false

  constructor() {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_DROPS * 6), 3))
    this.lines = new THREE.LineSegments(geo, this.mat)
    this.lines.frustumCulled = false
    this.lines.raycast = () => {}
    this.outlines.visible = false
    this.root.add(this.lines, this.outlines)
    this.root.visible = false
    for (let i = 0; i < MAX_DROPS; i++) this.place(i, Math.random())
  }

  /** How hard it rains (0: not at all), the boxes it stops in, whether their outlines show, and metres per unit. */
  set(o: { amount: number; boxes: RainBox[]; showBoxes: boolean; ws: number }) {
    this.amount = o.amount
    this.ws = o.ws || 0.5
    this.boxes = o.boxes
    this.outlines.clear()
    for (const b of o.boxes) {
      const l = new THREE.LineSegments(BOX, new THREE.LineBasicMaterial({ color: b.dry ? 0x5ce1e6 : 0x6aa8ff, transparent: true, opacity: 0.8, depthTest: false }))
      l.position.set(...b.at)
      l.rotation.y = (-b.yaw * Math.PI) / 180
      l.scale.set(...b.size)
      l.renderOrder = 9
      l.raycast = () => {}
      this.outlines.add(l)
    }
    this.outlines.visible = o.showBoxes
  }

  /** A drop at a random spot round the camera, `t` (0-1) down its column. */
  private place(i: number, t: number) {
    const a = Math.random() * Math.PI * 2, r = RADIUS * Math.sqrt(Math.random())
    this.drops[3 * i] = Math.cos(a) * r
    this.drops[3 * i + 1] = HEIGHT * (0.5 - t)
    this.drops[3 * i + 2] = Math.sin(a) * r
  }

  /** One frame: drops fall, and the rain fades toward none inside a box. */
  step(dt: number, cam: THREE.Vector3) {
    this.root.visible = true
    this.dry = insideRain(this.boxes, [cam.x, cam.y, cam.z])
    const want = this.amount > 0 && !this.dry ? 1 : 0
    this.level += Math.sign(want - this.level) * Math.min(Math.abs(want - this.level), dt / BLEND)
    this.mat.opacity = 0.5 * this.level
    this.lines.visible = this.level > 0
    if (!this.lines.visible) return
    const n = Math.round(MAX_DROPS * Math.min(1, this.amount)), k = 1 / this.ws
    const pos = this.lines.geometry.getAttribute('position') as THREE.BufferAttribute
    const out = pos.array as Float32Array
    for (let i = 0; i < n; i++) {
      this.drops[3 * i + 1] -= SPEED * dt
      if (this.drops[3 * i + 1] < -HEIGHT / 2) this.place(i, 0)
      const x = cam.x + this.drops[3 * i] * k, y = cam.y + this.drops[3 * i + 1] * k, z = cam.z + this.drops[3 * i + 2] * k
      out.set([x, y, z, x + 0.04 * k, y + STREAK * k, z], 6 * i)
    }
    pos.needsUpdate = true
    this.lines.geometry.setDrawRange(0, 2 * n)
  }

  /** Out of the walk-through: nothing drawn. */
  stop() { this.root.visible = false; this.level = 0; this.dry = false }
}
