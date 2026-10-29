// Walk-through: play the map at player size before exporting it. First person
// by default (V for a third-person view of the player: a stand-in, or the
// user's own Saints Row character once loaded), WASD to run (a keyboard always
// runs in the game), Shift to sprint while the sprint meter lasts, Space to jump,
// hold C to crouch (not Ctrl: Ctrl+W would close the tab), steps and ramps
// climbable, walls solid. Sizes are in editor units (1 unit = 0.5 m in game);
// the game's own numbers live in src/lib/player.ts.
import * as THREE from 'three'
import type { Vec3 } from '../lib/project'
import { GRAVITY, JUMP_SPEED, PITCH_DOWN_DEG, PITCH_UP_DEG, RUN_SPEED, SPRINT_SPEED, STEP, SprintMeter, CROUCH_SPEED as GAME_CROUCH_SPEED, JUMP_HEIGHT as GAME_JUMP_HEIGHT } from '../lib/player'

// The fog's cap (the game's never hides things completely) is fogCap.ts's, which the viewer installs.

export interface WalkHost {
  camera: THREE.PerspectiveCamera
  scene: THREE.Scene
  canvas: HTMLCanvasElement
  /** Everything the player collides with. */
  solids(): THREE.Object3D[]
}

export interface WalkState {
  locked: boolean; third: boolean; running: boolean; height: number
  crouched: boolean
  /** The sprint meter ran dry: no sprinting until Shift is let go. */
  tired?: boolean
  /** Eye height above the feet the camera is heading to, editor units. */
  eye: number
  /** Collision height (capsule top above the feet), editor units. */
  head: number
}

/** What third person shows: origin at the feet, facing −Z, editor units. `update` animates it: speed in units/s,
 *  crouch from 0 (standing) to 1 (crouched). */
export interface WalkBody { object: THREE.Object3D; update?(dt: number, speed: number, crouch: number): void }

// Player collision and camera, editor units (game metres x 2): the size of the game's own player capsule.
// Capsule radius 0.425 m; capsule top 1.78 m standing and 1.11 m crouched; eyes about 1.62 m standing and 1.05 m
// crouched (medium confidence, from a first-person mod); crouch_walk_speed 1.9 m/s; jump height 0.85 m.
// The models (the real SR1 player and the stand-in) only draw the pose: the real one measures 1.76 m standing with
// the eyes at 1.63 m, and 1.17 m crouched with the eyes at 1.04 m (tests/sr1char.test.ts).
export const STAND_HEIGHT = 3.56
export const STAND_EYE = 3.24
export const CROUCH_HEIGHT = 2.22
export const CROUCH_EYE = 2.1
export const RADIUS = 0.85
/** SR1's crouch_walk_speed, 1.9 m/s. */
export const CROUCH_SPEED = GAME_CROUCH_SPEED
/** Jump height 0.85 m. */
export const JUMP_HEIGHT = GAME_JUMP_HEIGHT
/** How fast the camera and pose blend between standing and crouched (per second). */
const CROUCH_BLEND = 9
const PITCH_MIN = (PITCH_DOWN_DEG * Math.PI) / 180, PITCH_MAX = (PITCH_UP_DEG * Math.PI) / 180
const clampPitch = (p: number) => Math.max(PITCH_MIN, Math.min(PITCH_MAX, p))
/** Heights of the wall-probe rays for a body `h` tall. */
const rayHeights = (h: number) => [STEP + 0.15, Math.min(1.9, h - 0.6), h - 0.3]

/** A plain stand-in player (body, head, arms and legs) as tall as the real one, which can walk and crouch. */
export function mannequin(): WalkBody {
  const g = new THREE.Group()
  const skin = new THREE.MeshStandardMaterial({ color: 0xc89b7b, roughness: 0.8 })
  const shirt = new THREE.MeshStandardMaterial({ color: 0x6a2a8a, roughness: 0.7 })
  const pants = new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.8 })
  const part = (to: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, 0); to.add(m); return m }
  const HIP = 1.84, THIGH = 0.92, SHIN = 0.92
  const hips = new THREE.Group()
  hips.position.y = HIP
  g.add(hips)
  // The upper body pivots at the hips so it can lean; the head tops out at the capsule top.
  const upper = new THREE.Group()
  hips.add(upper)
  part(upper, new THREE.CapsuleGeometry(0.55, 0.3, 4, 12), shirt, 0, 0.62)
  part(upper, new THREE.CapsuleGeometry(0.2, 1.1, 4, 8), shirt, -0.8, 0.5)
  part(upper, new THREE.CapsuleGeometry(0.2, 1.1, 4, 8), shirt, 0.8, 0.5)
  part(upper, new THREE.SphereGeometry(0.33, 16, 12), skin, 0, STAND_HEIGHT - HIP - 0.33)
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group()
    hip.position.x = side * 0.36
    hips.add(hip)
    part(hip, new THREE.CapsuleGeometry(0.3, 0.38, 4, 10), pants, 0, -THIGH / 2)
    const knee = new THREE.Group()
    knee.position.y = -THIGH
    hip.add(knee)
    part(knee, new THREE.CapsuleGeometry(0.27, 0.4, 4, 10), pants, 0, -SHIN / 2)
    return { hip, knee, side }
  })
  let phase = 0, amp = 0
  const update = (dt: number, speed: number, crouch: number) => {
    // Facing −Z, a positive turn about X swings a hanging leg forward; a negative one tips the upper body forward.
    const want = Math.min(0.6, speed * 0.05) * (1 - 0.5 * crouch)
    amp += (want - amp) * Math.min(1, dt * 10)
    phase = (phase + (dt * speed * Math.PI) / 1.6) % (Math.PI * 2)
    const a = 1.4 * crouch, c = 0.8 * crouch, s = Math.sin(phase)
    for (const l of legs) {
      l.hip.rotation.x = a + amp * s * l.side
      l.knee.rotation.x = -(a + c) - 1.6 * amp * Math.max(0, Math.cos(phase) * l.side)
    }
    upper.rotation.x = -0.4 * crouch
    // keep the feet on the ground, under the walker's position
    hips.position.set(0, HIP - THIGH * (1 - Math.cos(a)) - SHIN * (1 - Math.cos(c)) - amp * 0.2 * Math.abs(s), THIGH * Math.sin(a) - SHIN * Math.sin(c))
  }
  return { object: g, update }
}

export class Walker {
  readonly pos = new THREE.Vector3()
  private vy = 0
  private yaw = 0
  private pitch = 0
  private grounded = false
  private keys = new Set<string>()
  private stand = mannequin()
  private body: WalkBody = this.stand
  private crouched = false
  private sprint = new SprintMeter()
  private tired = false
  /** 0 standing, 1 crouched: the camera and pose blend. */
  private crouchK = 0
  private ray = new THREE.Raycaster()
  private third = false
  private start: { at: Vec3; yaw: number }
  private off: (() => void)[] = []
  /** Touch controls: stick position (x right, y forward, each -1..1), added to the keys. */
  readonly stick = { x: 0, y: 0 }
  onState?: (s: WalkState) => void

  constructor(private host: WalkHost, at: Vec3, yawDeg: number, private onExit: () => void, body?: WalkBody | null) {
    this.start = { at, yaw: yawDeg }
    this.respawn(at, yawDeg)
    host.scene.add(this.stand.object)
    this.stand.object.visible = false
    if (body) this.setBody(body)
    const on = <E extends Event>(t: EventTarget, type: string, fn: (e: E) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts)
      this.off.push(() => t.removeEventListener(type, fn as EventListener, opts))
    }
    // Phones have no pointer lock (iOS Safari lacks the method): touch controls drive the walker there.
    on(host.canvas, 'click', () => { if (document.pointerLockElement !== host.canvas) void host.canvas.requestPointerLock?.()?.catch?.(() => {}) })
    on(document, 'pointerlockchange', () => this.emit())
    on<MouseEvent>(document, 'mousemove', (e) => {
      if (document.pointerLockElement !== host.canvas) return
      this.yaw -= e.movementX * 0.0022
      this.pitch = clampPitch(this.pitch - e.movementY * 0.0022)
    })
    on<KeyboardEvent>(window, 'keydown', (e) => {
      const k = e.key.toLowerCase()
      if (e.key === 'Escape' && document.pointerLockElement !== host.canvas) { e.preventDefault(); this.onExit(); return }
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (['w', 'a', 's', 'd', ' ', 'shift', 'c', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { this.keys.add(k); e.preventDefault(); e.stopPropagation() }
      if (k === 'v') { this.third = !this.third; this.emit() }
      if (k === 'r') this.respawn(this.start.at, this.start.yaw)
    }, { capture: true })
    on<KeyboardEvent>(window, 'keyup', (e) => { this.keys.delete(e.key.toLowerCase()) }, { capture: true })
    on(window, 'blur', () => this.keys.clear())
  }

  /** Turns the view by a drag, in pixels (touch look). */
  look(dx: number, dy: number, speed = 0.005) {
    this.yaw -= dx * speed
    this.pitch = clampPitch(this.pitch - dy * speed)
  }

  /** Holds or releases a key from an on-screen button (' ' jump, 'c' crouch, 'shift' sprint). */
  press(key: string, down: boolean) {
    if (down) this.keys.add(key); else this.keys.delete(key)
    if (key === 'shift') this.emit()
  }

  /** Facing angle in radians (0 faces −Z, turning left is positive). */
  get heading() { return this.yaw }

  /** Back to a spot, facing the marker way (yaw 0 faces −Z). */
  respawn(at: Vec3, yawDeg: number) {
    this.start = { at, yaw: yawDeg }
    this.pos.set(at[0], at[1] + 0.05, at[2])
    this.vy = 0
    this.yaw = (-yawDeg * Math.PI) / 180
    this.pitch = 0
    this.sprint.reset()
  }

  /** The sprint meter, 0 empty .. 1 full. */
  get sprintLeft() { return this.sprint.level }

  /** Swaps the third-person body (null: back to the stand-in). The walker never disposes a body it was given. */
  setBody(body: WalkBody | null) {
    const next = body ?? this.stand
    if (next.object === this.body.object) { this.body = next; return }
    this.host.scene.remove(this.body.object)
    this.body = next
    next.object.visible = this.third
    this.host.scene.add(next.object)
  }

  dispose() {
    this.off.forEach((f) => f())
    this.host.scene.remove(this.body.object)
    this.host.scene.remove(this.stand.object)
    this.stand.object.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() } })
    if (document.pointerLockElement === this.host.canvas) document.exitPointerLock()
  }

  private emit() {
    this.onState?.({
      locked: document.pointerLockElement === this.host.canvas, third: this.third, running: this.keys.has('shift'), height: this.pos.y,
      crouched: this.crouched, tired: this.tired, eye: this.crouched ? CROUCH_EYE : STAND_EYE, head: this.crouched ? CROUCH_HEIGHT : STAND_HEIGHT,
    })
  }

  private cast(from: THREE.Vector3, dir: THREE.Vector3, far: number) {
    this.ray.set(from, dir)
    this.ray.far = far
    return this.ray.intersectObjects(this.host.solids(), false)[0]
  }

  /** Room overhead to stand up from a crouch (a few rays across the body). */
  private roomToStand() {
    const up = new THREE.Vector3(0, 1, 0), r = RADIUS * 0.6
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const from = new THREE.Vector3(this.pos.x + dx, this.pos.y + CROUCH_HEIGHT - 0.1, this.pos.z + dz)
      if (this.cast(from, up, STAND_HEIGHT - CROUCH_HEIGHT + 0.1)) return false
    }
    return true
  }

  /** Horizontal move with wall sliding. */
  private moveFlat(move: THREE.Vector3, height: number) {
    for (let pass = 0; pass < 3 && move.lengthSq() > 1e-8; pass++) {
      const len = move.length()
      const dir = move.clone().divideScalar(len)
      let best: { d: number; n: THREE.Vector3 } | null = null
      for (const h of rayHeights(height)) {
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
    const was = { x: this.pos.x, z: this.pos.z }
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x)
    const want = new THREE.Vector3()
    const k = this.keys
    // Crouch while C is held; stand again only when there is room overhead.
    const wasCrouched = this.crouched
    if (k.has('c')) this.crouched = true
    else if (this.crouched && this.roomToStand()) this.crouched = false
    if (this.crouched !== wasCrouched) this.emit()
    const height = this.crouched ? CROUCH_HEIGHT : STAND_HEIGHT
    if (k.has('w') || k.has('arrowup')) want.add(fwd)
    if (k.has('s') || k.has('arrowdown')) want.sub(fwd)
    if (k.has('d') || k.has('arrowright')) want.add(right)
    if (k.has('a') || k.has('arrowleft')) want.sub(right)
    const keyed = want.lengthSq() > 0
    const stick = keyed ? 0 : Math.min(1, Math.hypot(this.stick.x, this.stick.y))
    if (stick > 0.05) want.addScaledVector(fwd, this.stick.y).addScaledVector(right, this.stick.x)
    // Shift sprints while the meter lasts (on the ground or in the air, as long as you are moving).
    const sprinting = this.sprint.update(dt, k.has('shift') && !this.crouched && want.lengthSq() > 0)
    if (this.sprint.empty !== this.tired) { this.tired = this.sprint.empty; this.emit() }
    let pace = this.crouched ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : RUN_SPEED
    // The stick moves slower when half pushed and runs when pushed all the way.
    if (stick > 0.05 && stick <= 0.9) pace *= stick
    if (want.lengthSq()) this.moveFlat(want.normalize().multiplyScalar(pace * dt), height)
    this.pushOut()

    // Up and down: land on whatever is below, step up small ledges, bump heads on ceilings.
    if (this.grounded && !this.crouched && k.has(' ')) { this.vy = JUMP_SPEED; this.grounded = false; this.sprint.jump() }
    this.vy -= GRAVITY * dt
    const down = new THREE.Vector3(0, -1, 0)
    if (this.vy > 0) {
      const head = this.cast(new THREE.Vector3(this.pos.x, this.pos.y + height - 0.1, this.pos.z), new THREE.Vector3(0, 1, 0), this.vy * dt + 0.1)
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

    const moved = Math.hypot(this.pos.x - was.x, this.pos.z - was.z)
    const speed = dt > 0 && this.grounded && moved < SPRINT_SPEED * dt * 1.5 ? moved / dt : 0

    // Camera: at the eyes (blending between standing and crouched), or behind the player.
    this.crouchK += ((this.crouched ? 1 : 0) - this.crouchK) * Math.min(1, dt * CROUCH_BLEND)
    if (Math.abs(this.crouchK - (this.crouched ? 1 : 0)) < 1e-3) this.crouchK = this.crouched ? 1 : 0
    const cam = this.host.camera
    const look = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch))
    const eye = new THREE.Vector3(this.pos.x, this.pos.y + STAND_EYE + (CROUCH_EYE - STAND_EYE) * this.crouchK, this.pos.z)
    const body = this.body.object
    body.visible = this.third
    if (this.third) {
      body.position.copy(this.pos)
      body.rotation.set(0, this.yaw, 0)
      this.body.update?.(dt, speed, this.crouchK)
      const back = look.clone().negate()
      const hit = this.cast(eye.clone().add(new THREE.Vector3(0, 0.6, 0)), back, 8)
      const dist = hit ? Math.max(1, hit.distance - 0.4) : 8
      cam.position.copy(eye).add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(back, dist)
    } else cam.position.copy(eye)
    cam.lookAt(cam.position.clone().add(look))
  }
}
