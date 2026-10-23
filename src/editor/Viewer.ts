// Imperative three.js scene for the editor. React calls sync() whenever the
// project or view options change; the viewer diffs by uid and only rebuilds
// what changed. Transforms follow sr1_scene.transform exactly:
//   world = T(position) · Ry · Rx · Rz · S(scale) · T(-pivot)
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { MinimapRect } from '../lib/minimap'
import { RADIUS, STAND_HEIGHT, Walker, type WalkBody, type WalkState } from './walk'
import { PhysicsPreview, type PhysicsStatus } from './physicsPreview'
import { presetOf } from '../lib/physicsProps'
import { StaticBatch, batchable, type BatchSource } from './batch'
import type { ObjModel } from '../lib/geometry'
import { loadModel, peekModel, textureUrl } from '../lib/assets'
import { isCustomNative, isGlass, isProp, type Light, type Marker, type Project, type SceneItem, type Vec3 } from '../lib/project'
import { RETAIL_MARKER_COLORS, syncZone } from './zones'

export interface ViewOptions {
  selection: { kind: 'item' | 'marker' | 'light'; index: number } | null
  gizmo: 'translate' | 'rotate' | 'scale'
  wireframe: boolean
  collisionView: 'off' | 'faces'
  soloMaterial: string | null
  faceRange: [number, number]
  snap?: boolean
  step?: number
  /** False while a click tool (paint, eraser...) is active. */
  showGizmo?: boolean
  readOnly?: boolean
  /** Several objects selected together; the gizmo moves them as one. */
  multi?: number[]
  /** Desktop-style free camera: right-drag looks around in place, WASD/QE fly, wheel sets the speed. */
  freeCam?: boolean
}

export interface ViewerEvents {
  onPick(sel: ViewOptions['selection'], additive?: boolean): void
  onSurface(point: Vec3, item: number, sourceFace: number, mode: 'click' | 'drop', data?: string, normal?: Vec3): void
  onTransform(kind: 'item' | 'marker' | 'light', index: number, t: { position: Vec3; rotation?: Vec3; scale?: number; yaw?: number }, done: boolean): void
  /** Eraser click: whatever is under the cursor (marker, light or object). */
  onErase(target: NonNullable<ViewOptions['selection']>): void
  /** The gizmo moved several objects at once. */
  onTransformMany?(updates: { index: number; position: Vec3; rotation: Vec3; scale: number }[], done: boolean): void
  /** Free camera: the flying speed changed (mouse wheel). */
  onFlySpeed?(unitsPerSecond: number): void
}

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

const MARKER_COLORS: Record<string, number> = {
  'Shared spawn': 0x37e3ff, 'Red team spawn': 0xff4d5e, 'Blue team spawn': 0x4d8bff,
  'Weapon pickup': 0xffc23d, 'Vehicle spawn': 0xb98cff, 'Human NPC spawn': 0x7dff8f, 'Special spawn': 0x7dff8f,
}
const markerColor = (t: string) => MARKER_COLORS[t] ?? RETAIL_MARKER_COLORS[t] ?? (/navpoint/i.test(t) ? 0x9aa4b5 : 0xff42bf)

interface GeoInfo { geometry: THREE.BufferGeometry; faceOrder: Uint32Array; mats: string[] }
interface ItemNode {
  uid: string
  group: THREE.Group
  mesh: THREE.Mesh | null
  key: string // rebuild key: path + textures + flags
  overlay: THREE.Mesh | null
  overlayKey: string
  path: string
}

let missingTexture: THREE.Texture | null = null
function checker(): THREE.Texture {
  if (missingTexture) return missingTexture
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#ff42bf' : '#1a0f19'; g.fillRect(x * 8, y * 8, 8, 8) }
  missingTexture = new THREE.CanvasTexture(c)
  missingTexture.wrapS = missingTexture.wrapT = THREE.RepeatWrapping
  missingTexture.colorSpace = THREE.SRGBColorSpace
  return missingTexture
}

export class Viewer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.05, 50000)
  readonly orbit: OrbitControls
  readonly gizmo: TransformControls
  private root = new THREE.Group()
  private markerRoot = new THREE.Group()
  private lightRoot = new THREE.Group()
  private grid: THREE.GridHelper
  private box = new THREE.Box3Helper(new THREE.Box3(), 0xff42bf)
  /** Handle the gizmo holds when several objects are selected. */
  private pivot = new THREE.Object3D()
  private pivotStart: { center: THREE.Vector3; items: { index: number; pos: Vec3; rot: Vec3; scale: number }[] } | null = null
  private items = new Map<string, ItemNode>()
  private geos = new Map<string, Promise<GeoInfo>>()
  private textures = new Map<string, THREE.Texture | null>()
  private project: Project | null = null
  private opts: ViewOptions = { selection: null, gizmo: 'translate', wireframe: false, collisionView: 'off', soloMaterial: null, faceRange: [0, 0] }
  private raf = 0
  private keys = new Set<string>()
  private dragging = false
  private framed = false
  private resizeObs: ResizeObserver
  private loaded = new THREE.LoadingManager()
  private texLoader = new THREE.TextureLoader(this.loaded)

  constructor(private host: HTMLElement, private events: ViewerEvents) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(this.renderer.domElement)
    this.renderer.domElement.tabIndex = 0
    this.scene.background = new THREE.Color(0x120f15)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a2a38, 2.2))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(0.4, 1, 0.3)
    this.scene.add(sun)
    this.grid = new THREE.GridHelper(200, 40, 0x6b2a5a, 0x2b1c2b)
    this.scene.add(this.grid, this.root, this.markerRoot, this.lightRoot, this.box, this.pivot, this.batch.root)
    this.box.visible = false
    this.camera.position.set(30, 25, 30)
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement)
    this.orbit.enableDamping = true
    this.orbit.dampingFactor = 0.15
    this.orbit.screenSpacePanning = true
    // Tablets: one finger spins, two fingers pinch to zoom and drag to slide.
    this.orbit.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement)
    this.gizmo.setSize(0.9)
    this.scene.add(this.gizmo.getHelper())
    this.gizmo.addEventListener('dragging-changed', (e: any) => {
      this.orbit.enabled = !e.value && !this.opts.freeCam && !this.walker
      this.dragging = e.value
      if (!e.value) this.emitTransform(true)
    })
    this.gizmo.addEventListener('objectChange', () => this.emitTransform(false))
    this.loaded.onLoad = () => this.requestRender()
    this.bindInput()
    this.bindFreeCam()
    this.renderer.domElement.addEventListener('pointermove', (e) => this.moveGhost(e.clientX, e.clientY))
    this.renderer.domElement.addEventListener('pointerleave', () => { if (this.ghost?.visible) { this.ghost.visible = false; this.requestRender() } })
    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(host)
    this.resize()
    this.loop()
  }

  dispose() {
    this.batch.dispose()
    this.stopWalk()
    cancelAnimationFrame(this.raf)
    this.resizeObs.disconnect()
    // TransformControls.dispose() in r169 assumes an Object3D; detach manually.
    this.gizmo.detach()
    this.gizmo.disconnect()
    this.orbit.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private needsRender = true
  requestRender() { this.needsRender = true }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    if (this.walker) {
      const now = performance.now()
      this.walker.step((now - this.lastFly) / 1000)
      this.physics?.step(Math.min((now - this.lastFly) / 1000, 0.1))
      this.lastFly = now
      this.renderer.render(this.scene, this.camera)
      return
    }
    const moved = this.flyStep() || this.tourStep()
    const damped = this.orbit.update()
    if (this.needsRender || moved || damped || this.dragging) {
      this.needsRender = false
      this.renderer.render(this.scene, this.camera)
    }
  }

  private resize() {
    const w = this.host.clientWidth || 1
    const h = this.host.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.requestRender()
  }

  // ---------------- input ----------------

  private pointerDown: { x: number; y: number } | null = null
  /** Fingers on the screen; a tap only counts when one finger went down and came up. */
  private fingers = new Set<number>()

  private bindInput() {
    const el = this.renderer.domElement
    el.style.touchAction = 'none'
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.fingers.add(e.pointerId)
      if (e.button === 0) this.pointerDown = this.fingers.size > 1 ? null : { x: e.clientX, y: e.clientY }
      el.focus()
    })
    el.addEventListener('pointerup', (e) => {
      const d = this.pointerDown
      this.pointerDown = null
      const pinch = this.fingers.size > 1
      this.fingers.delete(e.pointerId)
      if (!d || e.button !== 0 || this.dragging || pinch) return
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > (e.pointerType === 'touch' ? 12 : 5)) return
      this.click(e.clientX, e.clientY, e.shiftKey)
    })
    el.addEventListener('pointercancel', (e) => { this.fingers.delete(e.pointerId); this.pointerDown = null })
    el.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if ('wasdqe'.includes(k) && k.length === 1) { this.keys.add(k); e.preventDefault() }
      if (e.key === 'Shift') this.keys.add('shift')
      if (k === 'f') this.focusSelection()
    })
    el.addEventListener('keyup', (e) => { this.keys.delete(e.key.toLowerCase()); if (e.key === 'Shift') this.keys.delete('shift') })
    el.addEventListener('blur', () => this.keys.clear())
    el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('application/x-sr1-asset')) e.preventDefault() })
    el.addEventListener('drop', (e) => {
      const data = e.dataTransfer?.getData('application/x-sr1-asset')
      if (!data) return
      e.preventDefault()
      const hit = this.raycast(e.clientX, e.clientY)
      const point = hit ? hit.point : this.orbit.target.toArray() as Vec3
      this.events.onSurface(point, hit?.item ?? -1, hit?.face ?? -1, 'drop', data, hit?.normal)
    })
  }

  // ---------------- free camera (as in the desktop SR1 Map Studio) ----------------

  /** Units per second while flying in the free camera. */
  flySpeed = 8
  private looking: { lock: boolean } | null = null

  private setFreeCam(on: boolean) {
    this.orbit.enabled = !on && !this.walker && !this.dragging
    if (on) {
      // Fly at a speed that suits the map's size, keeping the current view.
      const box = new THREE.Box3().setFromObject(this.root)
      const radius = box.isEmpty() ? 50 : box.getSize(new THREE.Vector3()).length() / 2
      this.flySpeed = Math.max(0.6, Math.min(80, radius * 0.08))
    }
    this.renderer.domElement.style.cursor = on ? 'crosshair' : ''
  }

  /** Turns the camera in place by a mouse movement (0.22° per pixel, like the desktop app). */
  private lookBy(dx: number, dy: number) {
    const dir = this.camera.getWorldDirection(new THREE.Vector3())
    let yaw = Math.atan2(-dir.x, -dir.z)
    let pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)))
    const k = (0.22 * Math.PI) / 180
    yaw -= dx * k
    pitch = Math.max((-89 * Math.PI) / 180, Math.min((89 * Math.PI) / 180, pitch - dy * k))
    const look = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
    const dist = Math.max(1, this.camera.position.distanceTo(this.orbit.target))
    this.orbit.target.copy(this.camera.position).addScaledVector(look, dist)
    this.camera.lookAt(this.orbit.target)
    this.requestRender()
  }

  private bindFreeCam() {
    const el = this.renderer.domElement
    el.addEventListener('contextmenu', (e) => { if (this.opts.freeCam) e.preventDefault() })
    el.addEventListener('pointerdown', (e) => {
      if (!this.opts.freeCam || this.walker || this.dragging) return
      if (e.button === 2) {
        // Right button: hide the cursor and look around until it's released.
        this.looking = { lock: true }
        void el.requestPointerLock?.()
      } else if (e.button === 0) this.looking = { lock: false }
    })
    el.addEventListener('pointermove', (e) => {
      if (!this.looking || this.dragging || this.gizmo.dragging || document.pointerLockElement === el) return
      if (!this.looking.lock && Math.hypot(e.clientX - (this.pointerDown?.x ?? e.clientX), e.clientY - (this.pointerDown?.y ?? e.clientY)) < 5) return
      this.lookBy(e.movementX, e.movementY)
    })
    // Moves while the pointer is locked arrive on the document.
    document.addEventListener('mousemove', (e) => { if (this.looking?.lock && document.pointerLockElement === el) this.lookBy(e.movementX, e.movementY) })
    const end = () => { if (this.looking?.lock && document.pointerLockElement === el) document.exitPointerLock(); this.looking = null }
    window.addEventListener('pointerup', end)
    window.addEventListener('blur', end)
    el.addEventListener('wheel', (e) => {
      if (!this.opts.freeCam || this.walker) return
      e.preventDefault()
      e.stopImmediatePropagation()
      this.flySpeed = Math.max(0.05, Math.min(1000, this.flySpeed * 1.22 ** (-e.deltaY / 100)))
      this.events.onFlySpeed?.(this.flySpeed)
    }, { capture: true, passive: false })
  }

  private lastFly = performance.now()
  private flyStep(): boolean {
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.lastFly) / 1000)
    this.lastFly = now
    if (!this.keys.size || (this.keys.size === 1 && this.keys.has('shift'))) return false
    const dist = this.camera.position.distanceTo(this.orbit.target)
    // Free camera: a set speed the wheel changes. Orbit camera: faster the further out you are.
    const speed = (this.opts.freeCam ? this.flySpeed : Math.max(2, dist * 0.9)) * (this.keys.has('shift') ? 3 : 1) * dt
    const fwd = new THREE.Vector3()
    this.camera.getWorldDirection(fwd)
    const right = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize()
    const move = new THREE.Vector3()
    if (this.keys.has('w')) move.add(fwd)
    if (this.keys.has('s')) move.sub(fwd)
    if (this.keys.has('d')) move.add(right)
    if (this.keys.has('a')) move.sub(right)
    if (this.keys.has('e')) move.y += 1
    if (this.keys.has('q')) move.y -= 1
    if (this.opts.freeCam && (this.keys.has('e') || this.keys.has('q')) && move.lengthSq() > 1) move.y = Math.sign(move.y)
    if (!move.lengthSq()) return false
    move.normalize().multiplyScalar(speed)
    this.camera.position.add(move)
    this.orbit.target.add(move)
    return true
  }

  private ndc(x: number, y: number) {
    const r = this.renderer.domElement.getBoundingClientRect()
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1)
  }

  /** Nearest scene-item surface under the cursor. */
  raycast(x: number, y: number): { point: Vec3; item: number; face: number; normal: Vec3 } | null {
    const rc = new THREE.Raycaster()
    rc.setFromCamera(this.ndc(x, y), this.camera)
    const meshes: THREE.Object3D[] = []
    this.items.forEach((n) => { if (n.mesh && n.group.visible) meshes.push(n.mesh) })
    const hit = rc.intersectObjects(meshes, false)[0]
    if (!hit) return null
    const node = [...this.items.values()].find((n) => n.mesh === hit.object)
    const index = this.project?.scene_items.findIndex((it) => it.uid === node?.uid) ?? -1
    const info = (hit.object as THREE.Mesh).userData.faceOrder as Uint32Array | undefined
    const face = info && hit.faceIndex != null ? info[hit.faceIndex] : -1
    const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).toArray() as Vec3 : [0, 1, 0] as Vec3
    return { point: hit.point.toArray() as Vec3, item: index, face, normal }
  }

  // ---------------- walk-through ----------------

  private walker: Walker | null = null
  private physics: PhysicsPreview | null = null
  private walkBody: WalkBody | null = null
  private beforeWalk: { pos: THREE.Vector3; target: THREE.Vector3; fov: number; hidden: [THREE.Object3D, boolean][]; background: THREE.Scene['background']; fog: THREE.Scene['fog'] } | null = null
  private daySky: THREE.Texture | null = null

  /** A noon sky: deep blue overhead fading to a hazy horizon, like the game's clear weather. */
  private sky(): THREE.Texture {
    if (this.daySky) return this.daySky
    const c = document.createElement('canvas')
    c.width = 2; c.height = 256
    const g = c.getContext('2d')!
    const grad = g.createLinearGradient(0, 0, 0, 256)
    grad.addColorStop(0, '#3f78c4'); grad.addColorStop(0.45, '#8db7e2'); grad.addColorStop(0.5, '#cfdbe4'); grad.addColorStop(1, '#8e8a84')
    g.fillStyle = grad; g.fillRect(0, 0, 2, 256)
    this.daySky = new THREE.CanvasTexture(c)
    this.daySky.colorSpace = THREE.SRGBColorSpace
    this.daySky.mapping = THREE.EquirectangularReflectionMapping
    return this.daySky
  }

  get walking() { return !!this.walker }

  /** Solid scene objects the walker bumps into (not ones marked pass-through). */
  private solids(): THREE.Object3D[] {
    const out: THREE.Object3D[] = []
    for (const it of this.project?.scene_items ?? []) {
      if (it.collision_disabled) continue
      const n = this.items.get(it.uid)
      if (n?.mesh && n.group.visible) out.push(n.mesh)
    }
    return out
  }

  /** Puts the camera at player height at `at` (a spawn, say) and hands the controls to the walker. */
  startWalk(at: Vec3, yaw: number, onExit: () => void, onState?: (s: WalkState) => void) {
    this.stopWalk()
    const hidden: [THREE.Object3D, boolean][] = [this.grid, this.box, this.lightRoot, this.markerRoot, this.gizmo.getHelper(), this.pivot].map((o) => [o, o.visible])
    hidden.forEach(([o]) => { o.visible = false })
    this.beforeWalk = { pos: this.camera.position.clone(), target: this.orbit.target.clone(), fov: this.camera.fov, hidden, background: this.scene.background, fog: this.scene.fog }
    this.scene.background = this.sky()
    this.scene.fog = new THREE.Fog(0xb9c9d6, 120, 900)
    this.orbit.enabled = false
    this.gizmo.enabled = false
    this.camera.fov = 70
    this.camera.near = 0.05
    this.camera.updateProjectionMatrix()
    const solids = this.solids()
    // Props blown away in the physics preview are hidden: the walker no longer bumps into them.
    this.walker = new Walker({ camera: this.camera, scene: this.scene, canvas: this.renderer.domElement, solids: () => solids.filter((o) => o.parent?.visible !== false) }, at, yaw, onExit, this.walkBody)
    this.walker.onState = onState
    const walker = this.walker
    // Physics props move in the walk-through (the engine loads only for maps that have some).
    if (this.project?.scene_items.some((it) => presetOf(it))) this.physics = new PhysicsPreview({
      scene: this.scene, camera: this.camera, canvas: this.renderer.domElement,
      objects: () => (this.project?.scene_items ?? []).flatMap((it) => { const n = this.items.get(it.uid); return n ? [{ it, group: n.group, mesh: n.mesh }] : [] }),
      player: () => ({ pos: walker.pos, height: STAND_HEIGHT, radius: RADIUS }),
    })
    this.lastFly = performance.now()
  }

  /** The third-person body for this and later walks (null: the stand-in). The caller owns it. */
  setWalkBody(body: WalkBody | null) {
    this.walkBody = body
    this.walker?.setBody(body)
  }

  /** Spawn and pickup markers while walking: hidden by default so they don't cover the player. */
  showWalkMarkers(on: boolean) { if (this.walker) this.markerRoot.visible = on }

  /** Moves the walker to another spot without leaving the walk. */
  walkTo(at: Vec3, yaw: number) { this.walker?.respawn(at, yaw) }

  /** The running walk (position, touch input), or null. */
  get walk(): Walker | null { return this.walker }

  /** Resolves once every object's model has loaded or failed (start a walk after it, so all of them are solid). */
  async whenLoaded() {
    await Promise.allSettled([...this.geos.values()])
    await new Promise((r) => setTimeout(r, 0)) // the meshes attach in the models' own handlers
  }

  /** The walk-through's physics preview: loading, how many props, how many destroyed. */
  physicsStatus(): PhysicsStatus | null { return this.physics?.status() ?? null }

  stopWalk() {
    if (!this.walker) return
    this.physics?.dispose()
    this.physics = null
    this.walker.dispose()
    this.walker = null
    const b = this.beforeWalk!
    b.hidden.forEach(([o, v]) => { o.visible = v })
    this.scene.background = b.background
    this.scene.fog = b.fog
    this.camera.position.copy(b.pos)
    this.orbit.target.copy(b.target)
    this.camera.fov = b.fov
    this.camera.updateProjectionMatrix()
    this.orbit.enabled = !this.opts.freeCam
    this.gizmo.enabled = true
    this.beforeWalk = null
    this.requestRender()
  }

  private overlay: THREE.Object3D | null = null
  /** Something drawn over the map (the health checks' heatmaps and sight lines); the caller disposes it. */
  setOverlay(object: THREE.Object3D | null) {
    if (this.overlay) this.scene.remove(this.overlay)
    this.overlay = object
    if (object) this.scene.add(object)
    this.requestRender()
  }

  /** The mesh drawn for a scene object (its local frame is the object's own), or null while it loads. */
  itemMesh(index: number): THREE.Mesh | null {
    const it = this.project?.scene_items[index]
    return (it && this.items.get(it.uid)?.mesh) || null
  }

  /** Shows a new mesh for an object until the project catches up (terrain sculpting draws every frame this way). */
  previewItem(index: number, model: ObjModel) {
    const mesh = this.itemMesh(index)
    if (!mesh) return
    const info = buildGeometry(model)
    const mats = mesh.material as THREE.Material[]
    const byName = new Map(mats.map((m) => [m.userData.mat as string, m]))
    if (mesh.userData.preview) mesh.geometry.dispose()
    mesh.geometry = info.geometry
    // Materials by name; one the object doesn't have yet borrows the last one until the real mesh arrives.
    mesh.material = info.mats.map((n) => byName.get(n || 'default') ?? mats[mats.length - 1])
    mesh.userData.faceOrder = info.faceOrder
    mesh.userData.preview = true
    this.requestRender()
  }

  /** World box of one scene object, or null while it is loading. */
  itemBounds(index: number): [Vec3, Vec3] | null {
    const it = this.project?.scene_items[index]
    const g = it && this.items.get(it.uid)?.group
    if (!g) return null
    const b = new THREE.Box3().setFromObject(g)
    return b.isEmpty() ? null : [b.min.toArray() as Vec3, b.max.toArray() as Vec3]
  }

  /** Height of the first scene surface straight below (x, z), or null. */
  surfaceBelow(x: number, y: number, z: number): number | null {
    const meshes: THREE.Object3D[] = []
    this.items.forEach((n) => { if (n.mesh) meshes.push(n.mesh) })
    const box = new THREE.Box3()
    meshes.forEach((m) => box.expandByObject(m))
    const top = Math.max(y, box.isEmpty() ? y : box.max.y) + 5
    const rc = new THREE.Raycaster(new THREE.Vector3(x, top, z), new THREE.Vector3(0, -1, 0))
    rc.params.Line = { threshold: 0 }
    const hit = rc.intersectObjects(meshes, false).find((h) => h.point.y <= y + 0.01) ?? rc.intersectObjects(meshes, false)[0]
    return hit ? hit.point.y : null
  }

  private click(x: number, y: number, additive = false) {
    if (this.opts.readOnly || this.walker) return
    const rc = new THREE.Raycaster()
    rc.setFromCamera(this.ndc(x, y), this.camera)
    // Markers and lights first: they are small and sit on top of geometry.
    const handles = rc.intersectObjects([...this.markerRoot.children, ...this.lightRoot.children], true)[0]
    const surface = this.raycast(x, y)
    const placing = this.host.dataset.place || ''
    let handle: ViewOptions['selection'] = null
    if (handles) {
      let o: THREE.Object3D | null = handles.object
      while (o && !o.userData.kind) o = o.parent
      if (o) handle = { kind: o.userData.kind, index: o.userData.index }
    }
    if (placing === 'erase') {
      const target = handle ?? (surface && surface.item >= 0 ? { kind: 'item' as const, index: surface.item } : null)
      if (target) this.events.onErase(target)
      return
    }
    if (placing) {
      if (surface) this.events.onSurface(surface.point, surface.item, surface.face, 'click', undefined, surface.normal)
      return
    }
    if (handle) { this.events.onPick(handle); return }
    this.events.onPick(surface && surface.item >= 0 ? { kind: 'item', index: surface.item } : null, additive)
  }

  // ---------------- sync ----------------

  // ---------------- placement ghost ----------------

  private ghost: THREE.Object3D | null = null
  private ghostRot = 0

  /** The see-through preview that follows the mouse while placing (null removes it). */
  setGhost(obj: THREE.Object3D | null) {
    if (this.ghost) this.scene.remove(this.ghost)
    this.ghost = obj
    if (obj) { obj.visible = false; obj.rotation.y = (this.ghostRot * Math.PI) / 180; this.scene.add(obj) }
    this.requestRender()
  }

  /** The ghost's turn in degrees (the same heading a placed piece gets). */
  setGhostRot(deg: number) {
    this.ghostRot = deg
    if (this.ghost) { this.ghost.rotation.y = (deg * Math.PI) / 180; this.requestRender() }
  }

  /** Moves the ghost to where a click at (x, y) would place it, snapped like a real placement. */
  private moveGhost(x: number, y: number) {
    if (!this.ghost) return
    const hit = this.host.dataset.place === 'shape' && !this.walker ? this.raycast(x, y) : null
    if (!hit) { if (this.ghost.visible) { this.ghost.visible = false; this.requestRender() } return }
    const p = hit.point
    const r = (v: number) => (this.opts.snap ? Math.round(v / (this.opts.step || 1)) * (this.opts.step || 1) : v)
    this.ghost.position.set(r(p[0]), p[1], r(p[2]))
    this.ghost.visible = true
    this.requestRender()
  }

  sync(project: Project | null, opts: ViewOptions) {
    const firstProject = this.project?.id !== project?.id
    this.project = project
    if (!!opts.freeCam !== !!this.opts.freeCam) this.setFreeCam(!!opts.freeCam)
    this.opts = opts
    if (firstProject) this.framed = false
    this.syncItems()
    this.syncMarkers(project?.markers || [])
    this.syncLights(project?.lights || [])
    this.syncGizmo()
    this.requestRender()
  }

  private geometry(path: string): Promise<GeoInfo> {
    let g = this.geos.get(path)
    if (!g) {
      g = (peekModel(path) || loadModel(this.project, path)).then((m) => buildGeometry(m))
      g.catch(() => this.geos.delete(path))
      this.geos.set(path, g)
    }
    return g
  }

  private texture(path: string | undefined): THREE.Texture | null | undefined {
    if (!path) return null
    if (this.textures.has(path)) return this.textures.get(path)
    this.textures.set(path, undefined as any)
    textureUrl(this.project, path).then((url) => {
      if (!url) { this.textures.set(path, null); this.refreshMaterials(); return }
      this.texLoader.load(url, (t) => {
        t.colorSpace = THREE.SRGBColorSpace
        t.wrapS = t.wrapT = THREE.RepeatWrapping
        t.anisotropy = 4
        this.textures.set(path, t)
        this.refreshMaterials()
      }, undefined, () => { this.textures.set(path, null); this.refreshMaterials() })
    })
    return undefined
  }

  private refreshMaterials() {
    for (const n of this.items.values()) n.key = ''
    this.syncItems()
    this.requestRender()
  }

  private itemKey(it: SceneItem, index: number) {
    const o = this.opts
    const s = this.project!.settings
    return JSON.stringify([it.path, it.textures, it.alpha, it.double_sided, s.double_sided, o.wireframe, o.soloMaterial?.startsWith(index + ':') ? o.soloMaterial : o.soloMaterial ? 'other' : null, it.native_opacity, it.glass_custom_texture])
  }

  private syncItems() {
    const items = this.project?.scene_items || []
    const seen = new Set<string>()
    items.forEach((it, index) => {
      seen.add(it.uid)
      let node = this.items.get(it.uid)
      if (!node) {
        node = { uid: it.uid, group: new THREE.Group(), mesh: null, key: '', overlay: null, overlayKey: '', path: it.path }
        node.group.userData = { kind: 'item' }
        this.items.set(it.uid, node)
        this.root.add(node.group)
      }
      node.group.userData.index = index
      applyTransform(node.group, it)
      const key = this.itemKey(it, index)
      if (node.key !== key || node.path !== it.path) {
        node.key = key
        node.path = it.path
        this.buildItemMesh(node, it, index)
      } else if (node.mesh) {
        node.mesh.position.set(...(it.pivot ? (it.pivot.map((v) => -v) as Vec3) : [0, 0, 0] as Vec3))
      }
      this.syncOverlay(node, it, index)
    })
    for (const [uid, node] of this.items) {
      if (!seen.has(uid)) {
        this.root.remove(node.group)
        node.overlay?.geometry.dispose()
        this.items.delete(uid)
      }
    }
    if (!this.framed && items.length) {
      const first = this.items.get(items[0].uid)
      if (first?.mesh) { this.framed = true; this.frame(first.group) }
    }
    this.updateSelectionBox()
    this.batch.update(this.batchSources())
  }

  // Big maps draw unselected, unchanging objects merged by material (batch.ts).
  private batch = new StaticBatch(() => this.batchSources(), () => this.requestRender())
  private batchSources(): BatchSource[] | null {
    const o = this.opts
    if (o.wireframe || o.collisionView !== 'off' || o.soloMaterial) return null
    const live = new Set(o.multi?.length ? o.multi : o.selection?.kind === 'item' ? [o.selection.index] : [])
    const out: BatchSource[] = []
    this.project?.scene_items.forEach((it, i) => {
      const n = this.items.get(it.uid)
      // Physics props move on their own in the walk-through.
      if (live.has(i) || !n?.mesh || !n.group.visible || presetOf(it) || !batchable(n.mesh)) return
      out.push({ uid: it.uid, mesh: n.mesh, sig: n.key + JSON.stringify([it.position, it.rotation, it.scale, it.pivot]) })
    })
    return out
  }

  private buildItemMesh(node: ItemNode, it: SceneItem, index: number) {
    const s = this.project!.settings
    const opts = this.opts
    this.geometry(it.path).then((info) => {
      if (this.items.get(it.uid) !== node || node.path !== it.path) return
      // Fixed glass panes are flat quads; show both faces like the game does.
      const side = s.double_sided || it.double_sided || (isGlass(it) && !isCustomNative(it)) ? THREE.DoubleSide : THREE.FrontSide
      const custom = isCustomNative(it)
      const materials = info.mats.map((raw) => {
        const mat = raw || 'default'
        const texPath = custom ? it.glass_custom_texture : it.textures?.[mat]
        const tex = this.texture(texPath)
        const alpha = !!it.alpha?.[mat] || (custom && (it.native_opacity ?? 100) < 100)
        const solo = opts.soloMaterial
        const m = new THREE.MeshLambertMaterial({
          map: tex || (tex === null || !texPath ? checker() : null),
          color: tex === undefined && texPath ? 0x554455 : 0xffffff,
          side, wireframe: opts.wireframe,
          transparent: alpha, alphaTest: alpha ? 0.02 : 0,
          opacity: custom ? Math.max(0.15, (it.native_opacity ?? 100) / 100) : 1,
          depthWrite: !alpha,
        })
        m.visible = !solo || solo === `${index}:${mat}`
        m.userData.mat = mat
        return m
      })
      if (node.mesh) {
        node.group.remove(node.mesh)
        ;(node.mesh.material as THREE.Material[]).forEach((m) => m.dispose())
      }
      const mesh = new THREE.Mesh(info.geometry, materials)
      mesh.userData.faceOrder = info.faceOrder
      mesh.position.set(...(it.pivot ? (it.pivot.map((v) => -v) as Vec3) : [0, 0, 0] as Vec3))
      node.mesh = mesh
      node.group.add(mesh)
      if (!this.framed && index === 0) { this.framed = true; this.frame(node.group) }
      this.syncOverlay(node, it, index, true)
      this.updateSelectionBox()
      this.batch.update(this.batchSources())
      this.requestRender()
    }).catch(() => { /* missing file: shown in the scene list */ })
  }

  private syncOverlay(node: ItemNode, it: SceneItem, index: number, force = false) {
    const on = this.opts.collisionView === 'faces'
    const sel = this.opts.selection?.kind === 'item' && this.opts.selection.index === index ? this.opts.faceRange : null
    const key = on ? JSON.stringify([it.path, it.collision_disabled, it.collision_excluded_faces?.length, it.collision_excluded_faces?.slice(0, 50), isGlass(it), sel]) : ''
    if (!force && key === node.overlayKey) return
    node.overlayKey = key
    if (node.overlay) { node.mesh?.remove(node.overlay); node.overlay.geometry.dispose(); node.overlay = null }
    if (!on || !node.mesh) return
    const model = peekModel(it.path)
    model?.then((m) => {
      if (node.overlayKey !== key || !node.mesh) return
      const excluded = new Set(it.collision_excluded_faces || [])
      const native = isGlass(it) || isProp(it)
      const tris = m.faces.length / 3
      const pos = new Float32Array(tris * 9)
      const col = new Float32Array(tris * 9)
      const green = [0.2, 0.95, 0.45], red = [1, 0.25, 0.3], blue = [0.35, 0.6, 1], orange = [1, 0.6, 0.1]
      for (let f = 0; f < tris; f++) {
        const c = native ? blue : sel && f >= Math.min(...sel) && f <= Math.max(...sel) ? orange : it.collision_disabled || excluded.has(f) ? red : green
        for (let k = 0; k < 3; k++) {
          const v = m.faces[f * 3 + k] * 3
          pos.set([m.positions[v], m.positions[v + 1], m.positions[v + 2]], f * 9 + k * 3)
          col.set(c, f * 9 + k * 3)
        }
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      g.setAttribute('color', new THREE.BufferAttribute(col, 3))
      const overlay = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.DoubleSide }))
      overlay.raycast = () => {}
      node.overlay = overlay
      node.mesh.add(overlay)
      this.requestRender()
    })
  }

  private syncMarkers(markers: Marker[]) {
    const root = this.markerRoot
    while (root.children.length > markers.length) root.remove(root.children[root.children.length - 1])
    markers.forEach((m, i) => {
      let g = root.children[i] as THREE.Group | undefined
      if (!g || g.userData.type !== m.type) {
        if (g) root.remove(g)
        g = markerObject(m.type)
        root.children.splice(i, 0, g)
        g.parent = root
      }
      g.userData = { kind: 'marker', index: i, type: m.type }
      g.position.set(...m.position)
      g.rotation.set(0, -m.yaw * RAD, 0)
      const selected = this.opts.selection?.kind === 'marker' && this.opts.selection.index === i
      // Marker meshes are ~1 game unit across; editor units are game units / world scale.
      const scale = (selected ? 1.25 : 1) / (this.project?.settings.world_scale || 0.5)
      g.scale.setScalar(scale)
      syncZone(g, m, scale, markerColor(m.type))
    })
  }

  private syncLights(lights: Light[]) {
    const root = this.lightRoot
    while (root.children.length > lights.length) root.remove(root.children[root.children.length - 1])
    lights.forEach((l, i) => {
      let g = root.children[i] as THREE.Group | undefined
      if (!g) { g = lightObject(); root.add(g) }
      g.userData = { kind: 'light', index: i }
      g.position.set(...l.position)
      const color = new THREE.Color(...l.color)
      ;((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color = color
      const ring = g.children[1] as THREE.LineLoop
      ring.scale.setScalar(l.range)
      ;(ring.material as THREE.LineBasicMaterial).color = color
      ;(ring.material as THREE.LineBasicMaterial).opacity = l.enabled ? 0.8 : 0.25
      const selected = this.opts.selection?.kind === 'light' && this.opts.selection.index === i
      ring.visible = selected || l.enabled
    })
  }

  private get many() { return (this.opts.multi?.length ?? 0) > 1 }

  private target(): THREE.Object3D | null {
    const sel = this.opts.selection
    if (!sel || !this.project) return null
    if (this.many) return this.pivot
    if (sel.kind === 'item') {
      const it = this.project.scene_items[sel.index]
      return it ? this.items.get(it.uid)?.group ?? null : null
    }
    if (sel.kind === 'marker') return this.markerRoot.children[sel.index] ?? null
    return this.lightRoot.children[sel.index] ?? null
  }

  /** Union box of the selected objects. */
  private manyBox(): THREE.Box3 {
    const box = new THREE.Box3()
    for (const i of this.opts.multi ?? []) {
      const it = this.project?.scene_items[i]
      const g = it && this.items.get(it.uid)?.group
      if (g) box.expandByObject(g)
    }
    return box
  }

  private syncGizmo() {
    if (this.dragging) return
    if (this.many && this.project) {
      // Put the handle at the bottom centre of the selection, square to the world.
      const box = this.manyBox()
      const center = box.isEmpty() ? new THREE.Vector3() : new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2)
      this.pivot.position.copy(center); this.pivot.rotation.set(0, 0, 0); this.pivot.scale.set(1, 1, 1)
      this.pivotStart = {
        center: center.clone(),
        items: (this.opts.multi ?? []).flatMap((i) => { const it = this.project!.scene_items[i]; return it ? [{ index: i, pos: [...it.position] as Vec3, rot: [...it.rotation] as Vec3, scale: it.scale }] : [] }),
      }
    }
    const t = this.opts.readOnly || this.opts.showGizmo === false ? null : this.target()
    const sel = this.opts.selection
    if (!t || !sel) { this.gizmo.detach(); return }
    let mode = this.opts.gizmo
    const it = sel.kind === 'item' ? this.project!.scene_items[sel.index] : null
    if (sel.kind === 'light') mode = 'translate'
    if (sel.kind === 'marker' && mode === 'scale') mode = 'translate'
    if (it && mode === 'scale' && isGlass(it) && !isCustomNative(it)) mode = 'translate'
    this.gizmo.setMode(mode)
    const snap = !!this.opts.snap
    this.gizmo.setTranslationSnap(snap ? this.opts.step ?? 0.5 : null)
    this.gizmo.setRotationSnap(snap ? Math.PI / 12 : null)
    this.gizmo.setScaleSnap(snap ? 0.1 : null)
    this.gizmo.setSpace(mode === 'rotate' && sel.kind === 'item' && !this.many ? 'local' : 'world')
    const yawOnly = (sel.kind === 'marker' || this.many) && mode === 'rotate'
    this.gizmo.showX = !yawOnly
    this.gizmo.showZ = !yawOnly
    this.gizmo.showY = true
    if (this.gizmo.object !== t) this.gizmo.attach(t)
  }

  private emitTransform(done: boolean) {
    const sel = this.opts.selection
    const o = this.gizmo.object
    if (!sel || !o) return
    if (this.many && o === this.pivot && this.pivotStart) {
      // Move, turn (about the vertical) and scale every selected object about the shared handle.
      const st = this.pivotStart
      const yaw = new THREE.Euler().setFromQuaternion(o.quaternion, 'YXZ').y
      const sc = [o.scale.x, o.scale.y, o.scale.z].reduce((b, v) => (Math.abs(v - 1) > Math.abs(b - 1) ? v : b), 1)
      o.scale.setScalar(sc)
      const up = new THREE.Vector3(0, 1, 0)
      const updates = st.items.map((m) => {
        const rel = new THREE.Vector3(...m.pos).sub(st.center).applyAxisAngle(up, yaw).multiplyScalar(sc)
        const p = rel.add(o.position)
        return { index: m.index, position: [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)] as Vec3, rotation: [m.rot[0], +(m.rot[1] + yaw * DEG).toFixed(3), m.rot[2]] as Vec3, scale: +(m.scale * sc).toFixed(5) }
      })
      this.events.onTransformMany?.(updates, done)
      this.updateSelectionBox()
      return
    }
    const position = o.position.toArray() as Vec3
    if (sel.kind === 'item') {
      const it = this.project!.scene_items[sel.index]
      const e = new THREE.Euler().setFromQuaternion(o.quaternion, 'YXZ')
      const prev = it.scale
      const s = [o.scale.x, o.scale.y, o.scale.z]
      const scale = s.reduce((best, v) => (Math.abs(v - prev) > Math.abs(best - prev) ? v : best), prev)
      o.scale.setScalar(scale)
      this.events.onTransform('item', sel.index, { position, rotation: [e.x * DEG, e.y * DEG, e.z * DEG], scale }, done)
    } else if (sel.kind === 'marker') {
      this.events.onTransform('marker', sel.index, { position, yaw: -o.rotation.y * DEG }, done)
    } else {
      this.events.onTransform('light', sel.index, { position }, done)
    }
    this.updateSelectionBox()
  }

  private updateSelectionBox() {
    const sel = this.opts.selection
    if (sel?.kind !== 'item') { this.box.visible = false; return }
    if (this.many) {
      const b = this.manyBox()
      this.box.box.copy(b)
      this.box.visible = !b.isEmpty()
      return
    }
    const t = this.target()
    if (!t) { this.box.visible = false; return }
    this.box.box.setFromObject(t)
    this.box.visible = !this.box.box.isEmpty()
  }

  // ---------------- camera ----------------

  private frame(obj: THREE.Object3D | THREE.Box3) {
    const box = obj instanceof THREE.Box3 ? obj : new THREE.Box3().setFromObject(obj)
    if (box.isEmpty()) return
    const size = box.getSize(new THREE.Vector3()).length()
    const center = box.getCenter(new THREE.Vector3())
    this.orbit.target.copy(center)
    const dir = new THREE.Vector3(0.8, 0.65, 0.9).normalize()
    this.camera.position.copy(center).addScaledVector(dir, Math.max(2, size * 0.75))
    this.camera.near = Math.max(0.01, size / 5000)
    this.camera.far = Math.max(1000, size * 20)
    this.camera.updateProjectionMatrix()
    const span = Math.max(20, Math.ceil(size / 10) * 10)
    this.scene.remove(this.grid)
    this.grid = new THREE.GridHelper(span * 2, 40, 0x6b2a5a, 0x2b1c2b)
    this.grid.position.y = box.min.y
    this.scene.add(this.grid)
    this.requestRender()
  }

  focusSelection() {
    if (this.many) { this.frame(this.manyBox()); return }
    const t = this.target()
    if (t) this.frame(t)
    else if (this.project?.scene_items[0]) {
      const n = this.items.get(this.project.scene_items[0].uid)
      if (n) this.frame(n.group)
    }
  }

  resetView() { this.framed = false; this.focusSelection() }

  /** Fit the whole map in view. */
  frameAll() { this.frame(this.root) }

  private tour = 0
  private tourAt = 0
  /** Showreel (the home page): no grid or handles, the camera circles the map at `degPerSec`; 0 stops. */
  flythrough(degPerSec: number) {
    this.tour = degPerSec
    this.tourAt = performance.now()
    for (const o of [this.grid, this.markerRoot, this.lightRoot, this.box]) o.visible = !degPerSec
    this.orbit.enabled = !degPerSec
    this.requestRender()
  }
  private tourStep(): boolean {
    if (!this.tour) return false
    const now = performance.now()
    this.orbitBy(this.tour * Math.min(0.1, (now - this.tourAt) / 1000))
    this.tourAt = now
    this.grid.visible = false
    return true
  }

  /** Camera buttons: circle the target by `deg` degrees. */
  orbitBy(deg: number) {
    const offset = this.camera.position.clone().sub(this.orbit.target)
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), deg * Math.PI / 180)
    this.camera.position.copy(this.orbit.target).add(offset)
    this.requestRender()
  }

  /** Camera buttons: move toward (factor < 1) or away from the target. */
  zoomBy(factor: number) {
    const offset = this.camera.position.clone().sub(this.orbit.target).multiplyScalar(factor)
    if (offset.length() < 0.5) return
    this.camera.position.copy(this.orbit.target).add(offset)
    this.requestRender()
  }

  /** Point at the camera target (used to place things "in front of you"). */
  center(): Vec3 { return this.orbit.target.toArray() as Vec3 }

  /** Square area the minimap covers, in editor units: the map's footprint plus `padUnits` on every side. */
  minimapRect(padUnits: number): MinimapRect | null {
    const box = new THREE.Box3().setFromObject(this.root, true)
    if (box.isEmpty()) return null
    const half = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + padUnits
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2
    const r = (v: number) => +v.toFixed(3)
    return [r(cx - half), r(cz - half), r(cx + half), r(cz + half)]
  }

  /**
   * Straight-down picture of `rect` for the minimap: +X right, +Z down (the
   * exporter's X mirror turns that into the game's layout; `mirror` flips it
   * for maps exported without the mirror).
   */
  async captureTopDown(o: { size: number; rect: MinimapRect; mirror?: boolean }): Promise<Blob | null> {
    const box = new THREE.Box3().setFromObject(this.root)
    if (box.isEmpty()) return null
    const [x0, z0, x1, z1] = o.rect
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
    const cam = new THREE.OrthographicCamera(-(x1 - x0) / 2, (x1 - x0) / 2, (z1 - z0) / 2, -(z1 - z0) / 2, 0.1, box.max.y - box.min.y + 2000)
    cam.position.set(cx, box.max.y + 500, cz)
    cam.up.set(0, 0, -1)
    cam.lookAt(cx, box.min.y, cz)
    const hidden = [this.markerRoot, this.lightRoot, this.grid, this.box, this.gizmo.getHelper()]
    const was = hidden.map((h) => h.visible)
    hidden.forEach((h) => { h.visible = false })
    const bg = this.scene.background
    this.scene.background = new THREE.Color(0x000000)
    const rt = new THREE.WebGLRenderTarget(o.size, o.size, { colorSpace: THREE.SRGBColorSpace })
    this.renderer.setRenderTarget(rt)
    this.renderer.render(this.scene, cam)
    const px = new Uint8Array(o.size * o.size * 4)
    this.renderer.readRenderTargetPixels(rt, 0, 0, o.size, o.size, px)
    this.renderer.setRenderTarget(null)
    rt.dispose()
    this.scene.background = bg
    hidden.forEach((h, i) => { h.visible = was[i] })
    this.requestRender()
    // GL rows run bottom-up; images run top-down.
    const canvas = new OffscreenCanvas(o.size, o.size)
    const img = new ImageData(o.size, o.size)
    const row = o.size * 4
    for (let y = 0; y < o.size; y++) {
      const src = (o.size - 1 - y) * row
      if (!o.mirror) { img.data.set(px.subarray(src, src + row), y * row); continue }
      for (let x = 0; x < o.size; x++) img.data.set(px.subarray(src + (o.size - 1 - x) * 4, src + (o.size - x) * 4), y * row + x * 4)
    }
    canvas.getContext('2d')!.putImageData(img, 0, 0)
    return canvas.convertToBlob({ type: 'image/png' })
  }

  async capture(width = 640, height = 360): Promise<Blob | null> {
    const prevBox = this.box.visible
    const helper = this.gizmo.getHelper()
    const prevGizmo = helper.visible
    this.box.visible = false
    helper.visible = false
    const w = this.renderer.domElement.width, h = this.renderer.domElement.height
    this.renderer.render(this.scene, this.camera)
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')!
    const scale = Math.max(width / w, height / h)
    const sw = width / scale, sh = height / scale
    ctx.drawImage(this.renderer.domElement, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, width, height)
    this.box.visible = prevBox
    helper.visible = prevGizmo
    this.requestRender()
    return canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })
  }
}

function applyTransform(g: THREE.Object3D, it: SceneItem) {
  g.position.set(...it.position)
  g.rotation.set(it.rotation[0] * RAD, it.rotation[1] * RAD, it.rotation[2] * RAD, 'YXZ')
  g.scale.setScalar(it.scale || 1)
}

function buildGeometry(m: ObjModel): GeoInfo {
  const tris = m.faces.length / 3
  const order = Array.from({ length: tris }, (_, i) => i).sort((a, b) => m.faceMat[a] - m.faceMat[b] || a - b)
  const index = new Uint32Array(tris * 3)
  const faceOrder = new Uint32Array(tris)
  const g = new THREE.BufferGeometry()
  let start = 0
  order.forEach((f, i) => {
    index.set(m.faces.subarray(f * 3, f * 3 + 3), i * 3)
    faceOrder[i] = f
    const next = order[i + 1]
    if (next === undefined || m.faceMat[next] !== m.faceMat[f]) {
      g.addGroup(start * 3, (i + 1 - start) * 3, m.faceMat[f])
      start = i + 1
    }
  })
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return { geometry: g, faceOrder, mats: m.mats }
}

function markerObject(type: string): THREE.Group {
  const color = markerColor(type)
  const g = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 })
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.7, 12, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide }))
  body.position.y = 0.85
  const base = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.42, 24), mat)
  base.rotation.x = -Math.PI / 2
  base.position.y = 0.02
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 10), mat)
  arrow.rotation.x = -Math.PI / 2
  arrow.position.set(0, 0.25, -0.65) // yaw 0 faces -Z, like the desktop viewer
  g.add(body, base, arrow)
  g.renderOrder = 10
  return g
}

function lightObject(): THREE.Group {
  const g = new THREE.Group()
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd9a6 }))
  const pts: THREE.Vector3[] = []
  for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a))) }
  const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffd9a6, transparent: true, opacity: 0.8 }))
  ring.raycast = () => {}
  g.add(bulb, ring)
  return g
}
