// Walk-through: play the map at player size before exporting it. First person
// by default (V for a third-person view of a stand-in player), WASD to move,
// Shift to run, Space to jump, steps and ramps climbable, walls solid.
// Sizes are in editor units (1 unit = 0.5 m in game): the player is 3.6 tall.
import * as THREE from 'three'
import type { Vec3 } from '../lib/project'

export interface WalkHost {
  camera: THREE.PerspectiveCamera
  scene: THREE.Scene
  canvas: HTMLCanvasElement
  /** Everything the player collides with. */
  solids(): THREE.Object3D[]
}

export interface WalkState { locked: boolean; third: boolean; running: boolean; height: number }

const HEIGHT = 3.6, EYE = 3.25, RADIUS = 0.7, STEP = 1.2
const WALK = 9, RUN = 15, GRAVITY = 42, JUMP = 13.5
const RAY_HEIGHTS = [STEP + 0.15, 1.9, HEIGHT - 0.3]

/** A plain stand-in player: body, head, arms and legs. */
function mannequin(): THREE.Group {
  const g = new THREE.Group()
  const skin = new THREE.MeshStandardMaterial({ color: 0xc89b7b, roughness: 0.8 })
  const shirt = new THREE.MeshStandardMaterial({ color: 0x6a2a8a, roughness: 0.7 })
  const pants = new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.8 })
  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m }
  part(new THREE.CapsuleGeometry(0.32, 1.3, 4, 10), pants, -0.38, 0.95)
  part(new THREE.CapsuleGeometry(0.32, 1.3, 4, 10), pants, 0.38, 0.95)
  part(new THREE.CapsuleGeometry(0.62, 0.9, 4, 12), shirt, 0, 2.3)
  part(new THREE.CapsuleGeometry(0.22, 1.2, 4, 8), shirt, -0.9, 2.3)
  part(new THREE.CapsuleGeometry(0.22, 1.2, 4, 8), shirt, 0.9, 2.3)
  part(new THREE.SphereGeometry(0.42, 16, 12), skin, 0, 3.3)
  return g
}

export class Walker {
  readonly pos = new THREE.Vector3()
  private vy = 0
  private yaw = 0
  private pitch = 0
  private grounded = false
  private keys = new Set<string>()
  private body = mannequin()
  private ray = new THREE.Raycaster()
  private third = false
  private start: { at: Vec3; yaw: number }
  private off: (() => void)[] = []
  onState?: (s: WalkState) => void

  constructor(private host: WalkHost, at: Vec3, yawDeg: number, private onExit: () => void) {
    this.start = { at, yaw: yawDeg }
    this.respawn(at, yawDeg)
    host.scene.add(this.body)
    this.body.visible = false
    const on = <E extends Event>(t: EventTarget, type: string, fn: (e: E) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts)
      this.off.push(() => t.removeEventListener(type, fn as EventListener, opts))
    }
    on(host.canvas, 'click', () => { if (document.pointerLockElement !== host.canvas) void host.canvas.requestPointerLock() })
    on(document, 'pointerlockchange', () => this.emit())
    on<MouseEvent>(document, 'mousemove', (e) => {
      if (document.pointerLockElement !== host.canvas) return
      this.yaw -= e.movementX * 0.0022
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * 0.0022))
    })
    on<KeyboardEvent>(window, 'keydown', (e) => {
      const k = e.key.toLowerCase()
      if (e.key === 'Escape' && document.pointerLockElement !== host.canvas) { e.preventDefault(); this.onExit(); return }
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (['w', 'a', 's', 'd', ' ', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { this.keys.add(k); e.preventDefault(); e.stopPropagation() }
      if (k === 'v') { this.third = !this.third; this.emit() }
      if (k === 'r') this.respawn(this.start.at, this.start.yaw)
    }, { capture: true })
    on<KeyboardEvent>(window, 'keyup', (e) => { this.keys.delete(e.key.toLowerCase()) }, { capture: true })
    on(window, 'blur', () => this.keys.clear())
  }

  /** Back to a spot, facing the marker way (yaw 0 faces −Z). */
  respawn(at: Vec3, yawDeg: number) {
    this.start = { at, yaw: yawDeg }
    this.pos.set(at[0], at[1] + 0.05, at[2])
    this.vy = 0
    this.yaw = (-yawDeg * Math.PI) / 180
    this.pitch = 0
  }

  dispose() {
    this.off.forEach((f) => f())
    this.host.scene.remove(this.body)
    this.body.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() } })
    if (document.pointerLockElement === this.host.canvas) document.exitPointerLock()
  }

  private emit() {
    this.onState?.({ locked: document.pointerLockElement === this.host.canvas, third: this.third, running: this.keys.has('shift'), height: this.pos.y })
  }

  private cast(from: THREE.Vector3, dir: THREE.Vector3, far: number) {
    this.ray.set(from, dir)
    this.ray.far = far
    return this.ray.intersectObjects(this.host.solids(), false)[0]
  }

  /** Horizontal move with wall sliding. */
  private moveFlat(move: THREE.Vector3) {
    for (let pass = 0; pass < 3 && move.lengthSq() > 1e-8; pass++) {
      const len = move.length()
      const dir = move.clone().divideScalar(len)
      let best: { d: number; n: THREE.Vector3 } | null = null
      for (const h of RAY_HEIGHTS) {
        const hit = this.cast(new THREE.Vector3(this.pos.x, this.pos.y + h, this.pos.z), dir, len + RADIUS)
        if (hit && (!best || hit.distance < best.d)) {
          const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate()
          n.y = 0
          if (n.lengthSq() < 1e-6) continue
          best = { d: hit.distance, n: n.normalize() }
        }
      }
      if (!best) { this.pos.add(move); return }
      const free = Math.max(0, best.d - RADIUS)
      this.pos.addScaledVector(dir, free)
      const rest = move.clone().multiplyScalar(1 - free / len)
      move = rest.sub(best.n.clone().multiplyScalar(rest.dot(best.n)))
    }
  }

  /** Keeps the body out of walls it already touches (corners, things moved into it). */
  private pushOut() {
    const h = 1.9
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
      const hit = this.cast(new THREE.Vector3(this.pos.x, this.pos.y + h, this.pos.z), dir, RADIUS)
      if (hit) this.pos.addScaledVector(dir, -(RADIUS - hit.distance))
    }
  }

  step(dt: number) {
    dt = Math.min(dt, 0.05)
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x)
    const want = new THREE.Vector3()
    const k = this.keys
    if (k.has('w') || k.has('arrowup')) want.add(fwd)
    if (k.has('s') || k.has('arrowdown')) want.sub(fwd)
    if (k.has('d') || k.has('arrowright')) want.add(right)
    if (k.has('a') || k.has('arrowleft')) want.sub(right)
    if (want.lengthSq()) this.moveFlat(want.normalize().multiplyScalar((k.has('shift') ? RUN : WALK) * dt))
    this.pushOut()

    // Up and down: land on whatever is below, step up small ledges, bump heads on ceilings.
    if (this.grounded && k.has(' ')) { this.vy = JUMP; this.grounded = false }
    this.vy -= GRAVITY * dt
    const down = new THREE.Vector3(0, -1, 0)
    if (this.vy > 0) {
      const head = this.cast(new THREE.Vector3(this.pos.x, this.pos.y + HEIGHT - 0.1, this.pos.z), new THREE.Vector3(0, 1, 0), this.vy * dt + 0.1)
      if (head) this.vy = 0
    }
    const fall = Math.max(0, -this.vy * dt)
    const ground = this.cast(new THREE.Vector3(this.pos.x, this.pos.y + STEP, this.pos.z), down, STEP + fall + 0.05)
    if (ground && this.vy <= 0) {
      this.pos.y = ground.point.y
      this.vy = 0
      this.grounded = true
    } else {
      this.pos.y += this.vy * dt
      this.grounded = false
    }
    if (this.pos.y < -200) this.respawn(this.start.at, this.start.yaw)

    // Camera: at the eyes, or behind the stand-in player.
    const cam = this.host.camera
    const look = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch))
    const eye = new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z)
    this.body.visible = this.third
    if (this.third) {
      this.body.position.copy(this.pos)
      this.body.rotation.set(0, this.yaw, 0)
      const back = look.clone().negate()
      const hit = this.cast(eye.clone().add(new THREE.Vector3(0, 0.6, 0)), back, 8)
      const dist = hit ? Math.max(1, hit.distance - 0.4) : 8
      cam.position.copy(eye).add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(back, dist)
    } else cam.position.copy(eye)
    cam.lookAt(cam.position.clone().add(look))
  }
}
