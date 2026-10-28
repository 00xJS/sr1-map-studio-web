// The editor view's camera: the perspective orbit camera, the straight-down plan view (orthographic, like the minimap
// picture, capture.ts), framing, the camera buttons and the desktop-style free camera. The viewer owns one; `camera`
// is whichever is showing.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Vec3 } from '../../lib/project'

/** What the camera needs from the viewer. */
export interface CameraHost {
  readonly canvas: HTMLCanvasElement
  requestRender(): void
  /** The free camera is on (and the viewer isn't walking or dragging the gizmo). */
  freeCam(): boolean
  /** Walking or dragging the gizmo: the mouse is someone else's. */
  busy(): boolean
  /** Where the left button went down, for telling a click from a drag. */
  pointerDown(): { x: number; y: number } | null
  /** Roughly how big the map is (half its diagonal, units), for the free camera's speed. */
  mapRadius(): number
  onFlySpeed?(unitsPerSecond: number): void
}

/** A camera view to come back to (saved views, savedViews.ts). Plan views keep how much of the map shows instead of
 *  where the camera is. */
export type CameraView =
  | { plan: false; target: Vec3; position: Vec3 }
  | { plan: true; target: Vec3; half: number }

/** How high the plan camera sits over what it looks at (units); far enough above any map. */
const PLAN_HEIGHT = 10000
const r3 = (v: number) => +v.toFixed(3)
const vec = (v: THREE.Vector3): Vec3 => [r3(v.x), r3(v.y), r3(v.z)]

export class ViewCamera {
  readonly persp = new THREE.PerspectiveCamera(55, 1, 0.05, 50000)
  readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, PLAN_HEIGHT * 4)
  readonly orbit: OrbitControls
  /** Units per second while flying in the free camera. */
  flySpeed = 8
  private planOn = false
  /** The plan view's half height at zoom 1 (units). */
  private half = 50
  private aspect = 1
  /** Which way the perspective camera looked from before the plan view, to look from there again after. */
  private back = new THREE.Vector3(0.8, 0.65, 0.9).normalize()
  private keys = new Set<string>()
  private looking: { lock: boolean } | null = null
  private lastFly = performance.now()
  private tour = 0
  private tourAt = 0

  constructor(private host: CameraHost) {
    this.persp.position.set(30, 25, 30)
    this.orbit = new OrbitControls(this.persp, host.canvas)
    this.orbit.enableDamping = true
    this.orbit.dampingFactor = 0.15
    this.orbit.screenSpacePanning = true
    // Tablets: one finger spins, two fingers pinch to zoom and drag to slide.
    this.orbit.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
    this.bindFreeCam()
  }

  /** The camera that's showing: the plan view's or the perspective one. */
  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera { return this.planOn ? this.ortho : this.persp }
  get plan() { return this.planOn }
  get target() { return this.orbit.target }

  dispose() { this.orbit.dispose() }

  resize(w: number, h: number) {
    this.aspect = w / h
    this.persp.aspect = this.aspect
    this.persp.updateProjectionMatrix()
    this.fitOrtho()
  }

  private fitOrtho() {
    Object.assign(this.ortho, { left: -this.half * this.aspect, right: this.half * this.aspect, top: this.half, bottom: -this.half })
    this.ortho.updateProjectionMatrix()
  }

  /** How far the perspective camera's view reaches up and down at `distance`: half the picture's height. */
  private halfAt(distance: number) { return distance * Math.tan((this.persp.fov * Math.PI) / 360) }
  /** The plan view's half height as it is now (zoomed). */
  private shownHalf() { return this.half / this.ortho.zoom }

  /** Straight down onto the map (+X right, +Z down, as the minimap picture), or back to the perspective camera. In plan
   *  view the camera doesn't turn: dragging slides and the wheel zooms. */
  setPlan(on: boolean) {
    if (on === this.planOn) return
    const t = this.orbit.target
    if (on) {
      const offset = this.persp.position.clone().sub(t)
      if (offset.lengthSq() > 1e-9) this.back.copy(offset).normalize()
      this.half = Math.max(2, this.halfAt(offset.length()))
      this.ortho.zoom = 1
      this.fitOrtho()
      this.placeOrtho()
    } else {
      this.persp.position.copy(t).addScaledVector(this.back, Math.max(2, this.shownHalf() / Math.tan((this.persp.fov * Math.PI) / 360)))
      this.persp.lookAt(t)
    }
    this.planOn = on
    this.orbit.object = this.camera
    this.orbit.enableRotate = !on
    // Plan view: the left button slides the map (a click still selects), as the right one does.
    this.orbit.mouseButtons = { LEFT: on ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    this.orbit.touches = { ONE: on ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
    this.syncFreeCam()
    this.orbit.update()
    this.host.requestRender()
  }

  /** The plan camera over the target, a hair off vertical so the controls keep +Z pointing down the screen. */
  private placeOrtho() {
    const t = this.orbit.target
    this.ortho.position.set(t.x, t.y + PLAN_HEIGHT, t.z + PLAN_HEIGHT * 1e-4)
    this.ortho.lookAt(t)
  }

  // ---------------- framing and the camera buttons ----------------

  /** Looks at the whole of `box`; returns its size (the diagonal), or 0 when it's empty. */
  frame(box: THREE.Box3): number {
    if (box.isEmpty()) return 0
    const size = box.getSize(new THREE.Vector3()).length()
    const center = box.getCenter(new THREE.Vector3())
    this.orbit.target.copy(center)
    this.persp.position.copy(center).addScaledVector(this.back, Math.max(2, size * 0.75))
    this.persp.near = Math.max(0.01, size / 5000)
    this.persp.far = Math.max(1000, size * 20)
    this.persp.updateProjectionMatrix()
    if (this.planOn) {
      this.half = Math.max(2, size * 0.55)
      this.ortho.zoom = 1
      this.fitOrtho()
      this.placeOrtho()
    }
    this.host.requestRender()
    return size
  }

  /** Looks at `at` from where the camera is, `distance` away (in plan view: as much of the map as that shows). */
  lookAt(at: Vec3, distance: number) {
    const offset = this.camera.position.clone().sub(this.orbit.target)
    if (offset.lengthSq() < 1e-6) offset.set(1, 1, 1)
    this.orbit.target.set(...at)
    if (this.planOn) {
      this.ortho.zoom = this.half / Math.max(1, this.halfAt(distance))
      this.ortho.updateProjectionMatrix()
      this.placeOrtho()
    } else this.persp.position.copy(this.orbit.target).add(offset.setLength(distance))
    this.host.requestRender()
  }

  /** Camera buttons: circle the target by `deg` degrees (not in plan view, which doesn't turn). */
  orbitBy(deg: number) {
    if (this.planOn) return
    const offset = this.persp.position.clone().sub(this.orbit.target)
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), deg * Math.PI / 180)
    this.persp.position.copy(this.orbit.target).add(offset)
    this.host.requestRender()
  }

  /** Camera buttons: move toward (factor < 1) or away from the target. */
  zoomBy(factor: number) {
    if (this.planOn) {
      this.ortho.zoom = Math.max(0.001, this.ortho.zoom / factor)
      this.ortho.updateProjectionMatrix()
    } else {
      const offset = this.persp.position.clone().sub(this.orbit.target).multiplyScalar(factor)
      if (offset.length() < 0.5) return
      this.persp.position.copy(this.orbit.target).add(offset)
    }
    this.host.requestRender()
  }

  /** Where the camera is and what it looks at, to come back to. */
  view(): CameraView {
    const target = vec(this.orbit.target)
    return this.planOn ? { plan: true, target, half: r3(this.shownHalf()) } : { plan: false, target, position: vec(this.persp.position) }
  }

  /** Back to a saved view (switch the plan view to match first). */
  setView(v: CameraView) {
    this.orbit.target.set(...v.target)
    if (v.plan) {
      this.ortho.zoom = this.half / Math.max(0.5, v.half)
      this.ortho.updateProjectionMatrix()
      this.placeOrtho()
    } else {
      this.persp.position.set(...v.position)
      this.persp.lookAt(this.orbit.target)
    }
    this.orbit.update()
    this.host.requestRender()
  }

  // ---------------- showreel ----------------

  /** Showreel (the home page): the camera circles the map at `degPerSec`; 0 stops. */
  flythrough(degPerSec: number) {
    this.tour = degPerSec
    this.tourAt = performance.now()
    this.orbit.enabled = !degPerSec
  }

  /** One frame of the showreel; true when the camera moved. */
  tourStep(): boolean {
    if (!this.tour) return false
    const now = performance.now()
    this.orbitBy(this.tour * Math.min(0.1, (now - this.tourAt) / 1000))
    this.tourAt = now
    return true
  }

  // ---------------- keys and the free camera (as in the desktop SR1 Map Studio) ----------------

  /** WASD/QE held on the canvas. */
  keyDown(e: KeyboardEvent) {
    const k = e.key.toLowerCase()
    if ('wasdqe'.includes(k) && k.length === 1) { this.keys.add(k); e.preventDefault() }
    if (e.key === 'Shift') this.keys.add('shift')
  }
  keyUp(e: KeyboardEvent) { this.keys.delete(e.key.toLowerCase()); if (e.key === 'Shift') this.keys.delete('shift') }
  clearKeys() { this.keys.clear() }
  /** The time the next fly step counts from (after a walk, which steps on its own). */
  resetClock() { this.lastFly = performance.now() }

  /** The free camera only flies the perspective view; plan view keeps sliding and zooming. */
  private get free() { return this.host.freeCam() && !this.planOn }

  /** The free camera turned on or off (or the plan view changed): who gets the mouse. */
  syncFreeCam() {
    this.orbit.enabled = !this.free && !this.host.busy()
    this.host.canvas.style.cursor = this.free ? 'crosshair' : ''
    if (this.free) {
      // Fly at a speed that suits the map's size, keeping the current view.
      this.flySpeed = Math.max(0.6, Math.min(80, this.host.mapRadius() * 0.08))
    }
  }

  /** Turns the camera in place by a mouse movement (0.22° per pixel, like the desktop app). */
  private lookBy(dx: number, dy: number) {
    const cam = this.persp
    const dir = cam.getWorldDirection(new THREE.Vector3())
    let yaw = Math.atan2(-dir.x, -dir.z)
    let pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)))
    const k = (0.22 * Math.PI) / 180
    yaw -= dx * k
    pitch = Math.max((-89 * Math.PI) / 180, Math.min((89 * Math.PI) / 180, pitch - dy * k))
    const look = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
    const dist = Math.max(1, cam.position.distanceTo(this.orbit.target))
    this.orbit.target.copy(cam.position).addScaledVector(look, dist)
    cam.lookAt(this.orbit.target)
    this.host.requestRender()
  }

  private bindFreeCam() {
    const el = this.host.canvas
    el.addEventListener('contextmenu', (e) => { if (this.free) e.preventDefault() })
    el.addEventListener('pointerdown', (e) => {
      if (!this.free || this.host.busy()) return
      if (e.button === 2) {
        // Right button: hide the cursor and look around until it's released.
        this.looking = { lock: true }
        void el.requestPointerLock?.()
      } else if (e.button === 0) this.looking = { lock: false }
    })
    el.addEventListener('pointermove', (e) => {
      if (!this.looking || this.host.busy() || document.pointerLockElement === el) return
      const down = this.host.pointerDown()
      if (!this.looking.lock && Math.hypot(e.clientX - (down?.x ?? e.clientX), e.clientY - (down?.y ?? e.clientY)) < 5) return
      this.lookBy(e.movementX, e.movementY)
    })
    // Moves while the pointer is locked arrive on the document.
    document.addEventListener('mousemove', (e) => { if (this.looking?.lock && document.pointerLockElement === el) this.lookBy(e.movementX, e.movementY) })
    const end = () => { if (this.looking?.lock && document.pointerLockElement === el) document.exitPointerLock(); this.looking = null }
    window.addEventListener('pointerup', end)
    window.addEventListener('blur', end)
    el.addEventListener('wheel', (e) => {
      if (!this.free || this.host.busy()) return
      e.preventDefault()
      e.stopImmediatePropagation()
      this.flySpeed = Math.max(0.05, Math.min(1000, this.flySpeed * 1.22 ** (-e.deltaY / 100)))
      this.host.onFlySpeed?.(this.flySpeed)
    }, { capture: true, passive: false })
  }

  /** One frame of WASD flying; true when the camera moved. In plan view WASD slide the map. */
  flyStep(): boolean {
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.lastFly) / 1000)
    this.lastFly = now
    if (!this.keys.size || (this.keys.size === 1 && this.keys.has('shift'))) return false
    const fast = this.keys.has('shift') ? 3 : 1
    const move = new THREE.Vector3()
    let speed: number
    if (this.planOn) {
      // Up the screen is -Z.
      if (this.keys.has('w')) move.z -= 1
      if (this.keys.has('s')) move.z += 1
      if (this.keys.has('d')) move.x += 1
      if (this.keys.has('a')) move.x -= 1
      speed = this.shownHalf() * 1.2 * fast * dt
    } else {
      const cam = this.persp
      const dist = cam.position.distanceTo(this.orbit.target)
      // Free camera: a set speed the wheel changes. Orbit camera: faster the further out you are.
      speed = (this.free ? this.flySpeed : Math.max(2, dist * 0.9)) * fast * dt
      const fwd = new THREE.Vector3()
      cam.getWorldDirection(fwd)
      const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize()
      if (this.keys.has('w')) move.add(fwd)
      if (this.keys.has('s')) move.sub(fwd)
      if (this.keys.has('d')) move.add(right)
      if (this.keys.has('a')) move.sub(right)
      if (this.keys.has('e')) move.y += 1
      if (this.keys.has('q')) move.y -= 1
      if (this.free && (this.keys.has('e') || this.keys.has('q')) && move.lengthSq() > 1) move.y = Math.sign(move.y)
    }
    if (!move.lengthSq()) return false
    move.normalize().multiplyScalar(speed)
    this.camera.position.add(move)
    this.orbit.target.add(move)
    return true
  }
}
