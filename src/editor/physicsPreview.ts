// Physics preview for the walk-through: physics props (lib/physicsProps.ts)
// become real rigid bodies, so the player can shove them, shoot them (click),
// blow them up (G) and kick them (F), and watch them tumble. Everything else
// in the map is solid ground and walls.
//
// It uses Rapier (@dimforge/rapier3d-compat), loaded only when a walk starts:
// it collides moving boxes, balls and hulls with any triangle mesh (the map),
// stacks boxes steadily and runs in WebAssembly. cannon-es was the other
// option, but its triangle meshes only collide with balls and planes.
//
// It is an approximate preview: the game uses its own physics engine and its
// own object table; weights, bounce and blasts here are rough figures.
// Sizes are editor units (1 unit = 0.5 m in game).
import * as THREE from 'three'
import type RapierNS from '@dimforge/rapier3d-compat'
import type { SceneItem } from '../lib/project'
import { bounds, cylinderAxis, cylinderPoints, mergePieces, pieces, presetOf, shapeOf, type P3, type PhysicsPreset } from '../lib/physicsProps'

type R = typeof RapierNS
let rapier: Promise<R> | null = null
const loadRapier = () => (rapier ??= import('@dimforge/rapier3d-compat').then(async (m) => { await m.default.init(); return m.default }))

export interface PhysicsHost {
  scene: THREE.Scene
  camera: THREE.Camera
  canvas: HTMLCanvasElement
  /** Every scene object with its node in the 3D view. */
  objects(): { it: SceneItem; group: THREE.Object3D; mesh: THREE.Mesh | null }[]
  /** The walking player: feet position, collision height and radius. */
  player(): { pos: THREE.Vector3; height: number; radius: number }
}

export interface PhysicsStatus { loading: boolean; error?: string; props: number; destroyed: number }

/** Metres to editor units. */
const U = 2
const GRAVITY = 9.81 * U
const LB = 0.45359
/** Push of one bullet (kg·m/s), a kick (top speed m/s and most force) and a grenade (G). */
const SHOT = 8, KICK_SPEED = 6, KICK_MAX = 60, GRENADE = { radius: 5, force: 20000 }
/** Blast push per unit of the game's blast strength, and the fastest a blast throws anything (m/s). */
const BLAST_SCALE = 0.011, BLAST_TOP = 30
/** Damage of one bullet, and of a blast at its centre. */
const BULLET_DAMAGE = 20, BLAST_DAMAGE = 200
// Collision groups (membership << 16 | filter): the player only touches props it can push.
const G_STATIC = 1, G_PROP = 2, G_HEAVY = 4, G_PLAYER = 8
const groups = (member: number, filter: number) => (member << 16) | filter
const RAY_GROUPS = groups(G_STATIC | G_PROP | G_HEAVY, G_STATIC | G_PROP | G_HEAVY)

interface Prop {
  it: SceneItem
  preset: PhysicsPreset
  group: THREE.Object3D
  body: RapierNS.RigidBody | null
  kg: number
  hp: number
  start: { pos: THREE.Vector3; quat: THREE.Quaternion }
}

interface Effect { mesh: THREE.Object3D; age: number; life: number; grow: number; light?: THREE.PointLight }

export class PhysicsPreview {
  private R!: R
  private world: RapierNS.World | null = null
  private props: Prop[] = []
  private byCollider = new Map<number, Prop>()
  private player: RapierNS.RigidBody | null = null
  private pending: { at: number; pos: THREE.Vector3; blast: { radius: number; force: number } }[] = []
  private effects: Effect[] = []
  private clock = 0
  private acc = 0
  private loading = true
  private error: string | undefined
  private off: (() => void)[] = []
  private disposed = false

  constructor(private host: PhysicsHost) {
    const on = <E extends Event>(t: EventTarget, type: string, fn: (e: E) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts)
      this.off.push(() => t.removeEventListener(type, fn as EventListener, opts))
    }
    on<MouseEvent>(host.canvas, 'mousedown', (e) => {
      if (document.pointerLockElement !== host.canvas) return
      if (e.button === 0) this.shoot()
      if (e.button === 2) this.grenade()
    })
    on<KeyboardEvent>(window, 'keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || e.repeat) return
      const k = e.key.toLowerCase()
      if (k === 'g') this.grenade()
      else if (k === 'f') this.kick()
      else if (k === 't') this.reset()
    })
    loadRapier().then((R) => {
      if (this.disposed) return
      this.R = R
      this.build()
      this.loading = false
    }).catch((e) => { this.loading = false; this.error = 'Physics preview failed to load: ' + (e as Error).message })
  }

  status(): PhysicsStatus {
    return { loading: this.loading, error: this.error, props: this.props.length, destroyed: this.props.filter((p) => !p.body).length }
  }

  /** Puts every prop back where it was, whole again. */
  reset() {
    if (!this.world) return
    this.restoreNodes()
    this.world.free()
    this.world = null
    this.pending = []
    this.build()
  }

  dispose() {
    this.disposed = true
    this.off.forEach((f) => f())
    this.restoreNodes()
    for (const e of this.effects) this.dropEffect(e)
    this.effects = []
    this.world?.free()
    this.world = null
  }

  private restoreNodes() {
    for (const p of this.props) {
      p.group.position.copy(p.start.pos)
      p.group.quaternion.copy(p.start.quat)
      p.group.visible = true
    }
  }

  private build() {
    const R = this.R
    const world = new R.World({ x: 0, y: -GRAVITY, z: 0 })
    this.world = world
    this.props = []
    this.byCollider.clear()
    const ground = world.createRigidBody(R.RigidBodyDesc.fixed())
    for (const { it, group, mesh } of this.host.objects()) {
      if (!mesh || !group.visible) continue
      group.updateWorldMatrix(true, true)
      const preset = presetOf(it)
      if (preset) { this.addProp(it, preset, group, mesh); continue }
      if (it.collision_disabled || (it.swimmable_water && !it.water_materials?.length)) continue
      const { verts, index } = meshData(mesh, mesh.matrixWorld)
      if (index.length < 3) continue
      world.createCollider(R.ColliderDesc.trimesh(verts, index).setCollisionGroups(groups(G_STATIC, 0xffff)), ground)
    }
    const pl = this.host.player()
    const r = pl.radius + 0.15
    this.player = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(pl.pos.x, pl.pos.y + pl.height / 2, pl.pos.z))
    world.createCollider(R.ColliderDesc.capsule(Math.max(0.05, pl.height / 2 - r), r).setCollisionGroups(groups(G_PLAYER, G_PROP)), this.player)
  }

  private addProp(it: SceneItem, preset: PhysicsPreset, group: THREE.Object3D, mesh: THREE.Mesh) {
    const R = this.R, world = this.world!
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3()
    group.matrixWorld.decompose(pos, quat, scale)
    // The mesh in the body's own frame (the group's position and turn, its size baked in).
    const toBody = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1)).invert().multiply(mesh.matrixWorld)
    const { verts, index } = meshData(mesh, toBody)
    const points: P3[] = []
    for (let i = 0; i < verts.length; i += 3) points.push([verts[i], verts[i + 1], verts[i + 2]])
    if (!points.length) return
    const kg = preset.lb * LB
    const shapes = this.shapes(shapeOf(it), points, index)
    const total = shapes.reduce((s, x) => s + x.volume, 0) || 1
    const heavy = !!it.physics_bottom_heavy
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z).setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setLinearDamping(preset.damping[0]).setAngularDamping(preset.damping[1]).setCcdEnabled(kg < 10))
    const member = preset.pushable ? G_PROP : G_HEAVY
    const prop: Prop = { it, preset, group, body, kg, hp: preset.hp, start: { pos: group.position.clone(), quat: group.quaternion.clone() } }
    for (const s of shapes) {
      const c = world.createCollider(s.desc.setMass((heavy ? 0.4 : 1) * kg * s.volume / total).setFriction(preset.friction).setRestitution(preset.bounce)
        .setCollisionGroups(groups(member, 0xffff)), body)
      this.byCollider.set(c.handle, prop)
    }
    if (heavy) {
      // Most of the weight low down: the same lowered centre of mass as the exporter writes.
      const [lo, hi] = bounds(points)
      const c = { x: (lo[0] + hi[0]) / 2, y: lo[1], z: (lo[2] + hi[2]) / 2 }
      const k = 0.6 * kg * 0.05 * ((hi[0] - lo[0]) ** 2 + (hi[2] - lo[2]) ** 2)
      body.setAdditionalMassProperties(0.6 * kg, c, { x: k, y: k, z: k }, { x: 0, y: 0, z: 0, w: 1 }, true)
    }
    this.props.push(prop)
  }

  private shapes(kind: string, points: P3[], index: Uint32Array): { desc: RapierNS.ColliderDesc; volume: number }[] {
    const R = this.R
    const [lo, hi] = bounds(points)
    const c = { x: (lo[0] + hi[0]) / 2, y: (lo[1] + hi[1]) / 2, z: (lo[2] + hi[2]) / 2 }
    const size = [0, 1, 2].map((k) => Math.max(hi[k] - lo[k], 0.04))
    const box = () => ({ desc: R.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2).setTranslation(c.x, c.y, c.z), volume: size[0] * size[1] * size[2] })
    const hull = (pts: P3[]) => {
      const [l, h] = bounds(pts)
      const desc = R.ColliderDesc.convexHull(new Float32Array(pts.flat()))
      const volume = Math.max(1e-6, (h[0] - l[0]) * (h[1] - l[1]) * (h[2] - l[2]))
      if (desc) return { desc, volume }
      const s = [0, 1, 2].map((k) => Math.max(h[k] - l[k], 0.04))
      return { desc: R.ColliderDesc.cuboid(s[0] / 2, s[1] / 2, s[2] / 2).setTranslation((l[0] + h[0]) / 2, (l[1] + h[1]) / 2, (l[2] + h[2]) / 2), volume }
    }
    if (kind === 'sphere') {
      let r = 0
      for (const p of points) r = Math.max(r, Math.hypot(p[0] - c.x, p[1] - c.y, p[2] - c.z))
      return [{ desc: R.ColliderDesc.ball(Math.max(r, 0.02)).setTranslation(c.x, c.y, c.z), volume: (4 / 3) * Math.PI * r ** 3 }]
    }
    if (kind === 'cylinder') {
      // Rapier's own cylinder when the model is round: stacked many-sided hulls sink into each other in Rapier.
      const axis = cylinderAxis(lo, hi)
      const [u, v] = [0, 1, 2].filter((k) => k !== axis)
      const ru = (hi[u] - lo[u]) / 2, rv = (hi[v] - lo[v]) / 2, half = (hi[axis] - lo[axis]) / 2
      if (Math.abs(ru - rv) > 0.15 * Math.max(ru, rv) || half <= 0) return [hull(cylinderPoints(lo, hi))]
      const r = (ru + rv) / 2
      const along = new THREE.Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0)
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along)
      return [{ desc: R.ColliderDesc.cylinder(half, r).setTranslation(c.x, c.y, c.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }), volume: Math.PI * r * r * 2 * half }]
    }
    if (kind === 'hull') return [hull(points)]
    if (kind === 'parts') return mergePieces(pieces(points, index).map((g) => g.map((i) => points[i]))).map(hull)
    return [box()]
  }

  step(dt: number) {
    const world = this.world
    if (!world) return
    this.clock += dt
    const pl = this.host.player()
    this.player?.setNextKinematicTranslation({ x: pl.pos.x, y: pl.pos.y + pl.height / 2, z: pl.pos.z })
    this.acc = Math.min(this.acc + dt, 1 / 15)
    while (this.acc >= 1 / 60) {
      world.timestep = 1 / 60
      world.step()
      this.acc -= 1 / 60
    }
    for (const p of this.props) {
      if (!p.body) continue
      const t = p.body.translation(), q = p.body.rotation()
      if (t.y < -500) { this.destroy(p, false); continue }
      p.group.position.set(t.x, t.y, t.z)
      p.group.quaternion.set(q.x, q.y, q.z, q.w)
    }
    const due = this.pending.filter((b) => b.at <= this.clock)
    this.pending = this.pending.filter((b) => b.at > this.clock)
    for (const b of due) this.explode(b.pos, b.blast)
    for (const e of [...this.effects]) {
      e.age += dt
      const k = e.age / e.life
      if (k >= 1) { this.dropEffect(e); this.effects.splice(this.effects.indexOf(e), 1); continue }
      e.mesh.scale.setScalar(Math.max(0.01, e.grow * Math.min(1, k * 3)))
      const m = (e.mesh as THREE.Mesh).material as THREE.MeshBasicMaterial
      m.opacity = 0.7 * (1 - k) ** 2
      if (e.light) e.light.intensity = 12 * (1 - k)
    }
  }

  /** What the crosshair points at: the hit point and the prop, if any. */
  private aim(far: number) {
    const R = this.R, world = this.world
    if (!world) return null
    const o = new THREE.Vector3(), d = new THREE.Vector3()
    this.host.camera.getWorldPosition(o)
    this.host.camera.getWorldDirection(d)
    const hit = world.castRay(new R.Ray(o, d), far, true, undefined, RAY_GROUPS)
    if (!hit) return { point: o.clone().addScaledVector(d, far), dir: d, prop: null as Prop | null, hit: false }
    return { point: o.clone().addScaledVector(d, hit.timeOfImpact), dir: d, prop: this.byCollider.get(hit.collider.handle) ?? null, hit: true }
  }

  private shoot() {
    const a = this.aim(400)
    if (!a?.hit) return
    this.effect(a.point, 0.25, 0.12, 0xfff0a0)
    const p = a.prop
    if (!p?.body) return
    p.body.applyImpulseAtPoint(a.dir.clone().multiplyScalar(SHOT * U), a.point, true)
    if (p.preset.hurtBy.includes('b')) this.damage(p, BULLET_DAMAGE)
  }

  private kick() {
    const a = this.aim(7)
    const p = a?.prop
    if (!a || !p?.body || !p.preset.pushable) return
    const push = a.dir.clone().setY(Math.max(a.dir.y, 0) + 0.35).normalize()
    p.body.applyImpulseAtPoint(push.multiplyScalar(Math.min(p.kg * KICK_SPEED, KICK_MAX) * U), a.point, true)
  }

  private grenade() {
    const a = this.aim(60)
    if (a) this.explode(a.point, GRENADE)
  }

  private damage(p: Prop, amount: number) {
    if (!p.body || p.hp <= 0) return
    p.hp -= amount
    if (p.hp <= 0 && p.preset.breaks) this.destroy(p, true)
  }

  private destroy(p: Prop, blow: boolean) {
    if (!p.body || !this.world) return
    const t = p.body.worldCom()
    const at = new THREE.Vector3(t.x, t.y, t.z)
    for (let i = 0; i < p.body.numColliders(); i++) this.byCollider.delete(p.body.collider(i).handle)
    this.world.removeRigidBody(p.body)
    p.body = null
    p.group.visible = false
    if (blow && p.preset.blast) this.pending.push({ at: this.clock + 0.12 + Math.random() * 0.15, pos: at, blast: p.preset.blast })
  }

  /** A blast: pushes and damages props in range, sets off other explosives. */
  private explode(at: THREE.Vector3, blast: { radius: number; force: number }) {
    const radius = blast.radius * U
    // A fireball about half the blast's reach (the push reaches further).
    this.effect(at, radius * 0.45, 0.5, 0xff9a30, true)
    for (const p of [...this.props]) {
      if (!p.body) continue
      const c = p.body.worldCom()
      const away = new THREE.Vector3(c.x - at.x, c.y - at.y, c.z - at.z)
      const d = away.length()
      if (d > radius) continue
      const falloff = 1 - d / radius
      const dir = d > 1e-3 ? away.divideScalar(d) : new THREE.Vector3(0, 1, 0)
      dir.y += 0.4
      dir.normalize()
      const j = Math.min(blast.force * BLAST_SCALE * falloff, BLAST_TOP * p.kg)
      // Push a little off-centre, towards the blast, so it spins.
      const point = new THREE.Vector3(c.x, c.y, c.z).addScaledVector(dir, -0.3)
      p.body.applyImpulseAtPoint(dir.multiplyScalar(j * U), point, true)
      if (p.preset.hurtBy.includes('x')) this.damage(p, BLAST_DAMAGE * falloff)
    }
  }

  private effect(at: THREE.Vector3, size: number, life: number, color: number, light = false) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }))
    mesh.position.copy(at)
    mesh.scale.setScalar(0.01)
    this.host.scene.add(mesh)
    const e: Effect = { mesh, age: 0, life, grow: size }
    if (light) {
      e.light = new THREE.PointLight(0xffa040, 12, size * 4, 1)
      e.light.position.copy(at)
      this.host.scene.add(e.light)
    }
    this.effects.push(e)
  }

  private dropEffect(e: Effect) {
    this.host.scene.remove(e.mesh)
    const m = e.mesh as THREE.Mesh
    m.geometry.dispose()
    ;(m.material as THREE.Material).dispose()
    if (e.light) this.host.scene.remove(e.light)
  }
}

/** Vertex positions (moved by `m`) and triangle indices of a mesh. */
function meshData(mesh: THREE.Mesh, m: THREE.Matrix4) {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
  const verts = new Float32Array(pos.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m)
    verts[i * 3] = v.x; verts[i * 3 + 1] = v.y; verts[i * 3 + 2] = v.z
  }
  const idx = mesh.geometry.getIndex()
  const index = idx ? new Uint32Array(idx.array) : Uint32Array.from({ length: pos.count }, (_, i) => i)
  return { verts, index }
}
