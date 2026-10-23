// A play session on top of the editor's viewer and walk-through: puts the
// weapon pickups and drop-offs in the world, follows the player's feet and
// runs the rules from game.ts every frame.
import * as THREE from 'three'
import type { Viewer } from '../editor/Viewer'
import type { WalkState } from '../editor/walk'
import type { Marker, Project, Vec3 } from '../lib/project'
import { newRun, stepRun, visible, type GameEvent, type Pickup, type RunMode, type RunState } from './game'

const SPAWNS = ['Shared spawn', 'Red team spawn', 'Blue team spawn']

/** Spawns to start at: shared ones first, then team spawns. */
export function spawnsOf(markers: Marker[]): Marker[] {
  return SPAWNS.flatMap((t) => markers.filter((m) => m.type === t))
}

const GOLD = new THREE.MeshBasicMaterial({ color: 0xffc23d })
const GOLD_RING = new THREE.MeshBasicMaterial({ color: 0xffc23d, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
const GEM = new THREE.OctahedronGeometry(0.55)
const RING = new THREE.RingGeometry(0.9, 1.2, 32)

function weaponProp(): THREE.Object3D {
  const g = new THREE.Group()
  const gem = new THREE.Mesh(GEM, GOLD)
  gem.name = 'gem'
  gem.position.y = 1.6
  const ring = new THREE.Mesh(RING, GOLD_RING)
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.05
  g.add(gem, ring)
  return g
}

function dropoffProp(radius: number): THREE.Object3D {
  const mat = new THREE.MeshBasicMaterial({ color: 0xff42bf, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 3, 40, 1, true), mat)
  wall.position.y = 1.5
  const floor = new THREE.Mesh(new THREE.RingGeometry(radius * 0.92, radius, 40), mat)
  floor.rotation.x = -Math.PI / 2
  floor.position.y = 0.06
  const g = new THREE.Group()
  g.add(wall, floor)
  g.userData.mat = mat
  return g
}

export class PlaySession {
  run: RunState
  /** The spawn this run started at. */
  spawn: { at: Vec3; yaw: number }
  private props = new Map<string, THREE.Object3D>()
  private root = new THREE.Group()
  private raf = 0
  private t0 = performance.now()
  onEvents?: (events: GameEvent[]) => void

  constructor(private viewer: Viewer, private project: Project, mode: RunMode, private onExit: () => void, private onWalk: (s: WalkState) => void, spawnIndex = 0) {
    this.spawn = this.pickSpawn(spawnIndex)
    this.run = newRun(project.markers, mode, this.spawn.at)
    viewer.scene.add(this.root)
    this.buildProps()
    viewer.startWalk(this.spawn.at, this.spawn.yaw, onExit, onWalk)
    this.raf = requestAnimationFrame(this.tick)
  }

  private pickSpawn(i: number): { at: Vec3; yaw: number } {
    const spawns = spawnsOf(this.project.markers)
    const m = spawns[((i % spawns.length) + spawns.length) % spawns.length]
    if (m) return { at: m.position, yaw: m.yaw ?? 0 }
    const c = this.viewer.center()
    return { at: [c[0], this.viewer.surfaceBelow(c[0], 1e4, c[2]) ?? c[1], c[2]], yaw: 0 }
  }

  private buildProps() {
    this.disposeProps()
    this.props.clear()
    for (const p of this.run.pickups) {
      const o = p.kind === 'weapon' ? weaponProp() : dropoffProp(p.radius)
      o.position.set(...p.at)
      this.props.set(p.id, o)
      this.root.add(o)
    }
  }

  /** A fresh run (same or another mode), back at a spawn. */
  restart(mode: RunMode = this.run.mode, spawnIndex = 0) {
    this.spawn = this.pickSpawn(spawnIndex)
    this.run = newRun(this.project.markers, mode, this.spawn.at)
    this.buildProps()
    if (this.viewer.walk) this.viewer.walkTo(this.spawn.at, this.spawn.yaw)
    else this.viewer.startWalk(this.spawn.at, this.spawn.yaw, this.onExit, this.onWalk)
  }

  /** Where the player stands and faces (for the minimap). */
  player(): { at: Vec3; heading: number } | null {
    const w = this.viewer.walk
    return w ? { at: w.pos.toArray() as Vec3, heading: w.heading } : null
  }

  pickups(): Pickup[] { return this.run.pickups }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick)
    const w = this.viewer.walk
    if (!w) return
    const events = stepRun(this.run, w.pos.toArray() as Vec3, now)
    const t = (now - this.t0) / 1000
    for (const p of this.run.pickups) {
      const o = this.props.get(p.id)
      if (!o) continue
      o.visible = visible(p, now)
      if (p.kind === 'weapon') {
        const gem = o.getObjectByName('gem')!
        gem.rotation.y = t * 2
        gem.position.y = 1.6 + Math.sin(t * 2.4 + p.at[0]) * 0.18
      } else {
        const mat = o.userData.mat as THREE.MeshBasicMaterial
        const counts = this.run.mode === 'dropoffs'
        mat.color.set(p.taken ? 0x4fd18b : counts ? 0xff42bf : 0xb98cff)
        mat.opacity = (p.taken ? 0.18 : 0.26) + Math.sin(t * 3) * 0.06
      }
    }
    if (events.length) this.onEvents?.(events)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.viewer.stopWalk()
    this.viewer.scene.remove(this.root)
    this.disposeProps()
  }

  private disposeProps() {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry !== GEM && o.geometry !== RING) {
        o.geometry.dispose()
        if (o.material !== GOLD && o.material !== GOLD_RING) (o.material as THREE.Material).dispose()
      }
    })
    this.root.clear()
  }
}
