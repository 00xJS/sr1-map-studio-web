// A play session on top of the editor's viewer and walk-through: puts the
// weapon pickups and drop-offs in the world, follows the player's feet and
// runs the rules from game.ts every frame. It records a ghost of every timed
// run, can replay one beside the player, and moves the bots of a race.
import * as THREE from 'three'
import type { Viewer } from '../editor/Viewer'
import { mannequin, type WalkBody, type WalkState } from '../editor/walk'
import type { Marker, Project, Vec3 } from '../lib/project'
import { BOT_COLORS, RaceBots } from './bots'
import { newRun, stepBot, stepRun, visible, type GameEvent, type Pickup, type RunMode, type RunState } from './game'
import { GhostRecorder, ghostAt, type GhostSample } from './ghost'

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

/** A stand-in figure: see-through for a ghost, or in a bot's colour. */
function figure(o: { ghost?: boolean; color?: number }): WalkBody {
  const body = mannequin()
  body.object.traverse((x) => {
    if (!(x instanceof THREE.Mesh)) return
    const m = x.material as THREE.MeshStandardMaterial
    if (o.color !== undefined && m.color.getHex() === 0x6a2a8a) m.color.setHex(o.color)
    if (o.ghost) { m.transparent = true; m.opacity = 0.38; m.depthWrite = false; m.color.lerp(new THREE.Color(0x9fd8ff), 0.6) }
  })
  return body
}

function disposeFigure(b: WalkBody) {
  b.object.traverse((x) => { if (x instanceof THREE.Mesh) { x.geometry.dispose(); (x.material as THREE.Material).dispose() } })
}

/** Something else on the map, for the minimap. */
export interface Other { at: Vec3; color: string; kind: 'ghost' | 'bot' }

export class PlaySession {
  run: RunState
  /** The spawn this run started at. */
  spawn: { at: Vec3; yaw: number }
  /** This run's ghost, recorded from the moment the clock starts. */
  recorder = new GhostRecorder()
  private props = new Map<string, THREE.Object3D>()
  /** Pickups and drop-offs (rebuilt each run). */
  private root = new THREE.Group()
  /** The ghost and the bots. */
  private figures = new THREE.Group()
  private raf = 0
  private t0 = performance.now()
  private last = performance.now()
  private ghost: { samples: GhostSample[]; body: WalkBody; at: Vec3 | null } | null = null
  private racers: { bots: RaceBots; bodies: WalkBody[] } | null = null
  onEvents?: (events: GameEvent[]) => void

  constructor(private viewer: Viewer, private project: Project, mode: RunMode, private onExit: () => void, private onWalk: (s: WalkState) => void, spawnIndex = 0) {
    this.spawn = this.pickSpawn(spawnIndex)
    this.run = newRun(project.markers, mode, this.spawn.at)
    viewer.scene.add(this.root, this.figures)
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
    this.recorder = new GhostRecorder()
    this.setBots(null)
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

  /** Replays a ghost beside the player through this run (null: none). */
  setGhost(samples: GhostSample[] | null) {
    if (this.ghost) { this.figures.remove(this.ghost.body.object); disposeFigure(this.ghost.body); this.ghost = null }
    if (!samples?.length) return
    const body = figure({ ghost: true })
    this.figures.add(body.object)
    this.ghost = { samples, body, at: null }
  }

  /** Bots for a race (null: none). Call after `restart`. */
  setBots(bots: RaceBots | null) {
    if (this.racers) for (const b of this.racers.bodies) { this.figures.remove(b.object); disposeFigure(b) }
    this.racers = null
    if (!bots) return
    const bodies = bots.bots.map((b) => {
      const f = figure({ color: BOT_COLORS[(b.id - 1) % BOT_COLORS.length] })
      f.object.position.set(...b.at)
      this.figures.add(f.object)
      return f
    })
    this.racers = { bots, bodies }
  }

  /** The ghost and the bots, for the minimap. */
  others(): Other[] {
    const out: Other[] = []
    if (this.ghost?.at) out.push({ at: this.ghost.at, color: '#9fd8ff', kind: 'ghost' })
    for (const b of this.racers?.bots.bots ?? []) out.push({ at: b.at, color: '#' + BOT_COLORS[(b.id - 1) % BOT_COLORS.length].toString(16).padStart(6, '0'), kind: 'bot' })
    return out
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick)
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    const w = this.viewer.walk
    if (!w) return
    const feet = w.pos.toArray() as Vec3
    const run = this.run
    const events = stepRun(run, feet, now)
    if (run.started !== null) {
      if (run.finished === null) this.recorder.add(now - run.started, feet, w.heading)
      else if (events.some((e) => e.type === 'finish')) this.recorder.finish(run.finished - run.started, feet, w.heading)
    }
    if (this.ghost) {
      const g = ghostAt(this.ghost.samples, run.started === null ? 0 : (run.finished ?? now) - run.started)
      if (g) {
        const prev = this.ghost.at
        const o = this.ghost.body.object
        o.position.set(...g.at)
        o.rotation.set(0, g.heading, 0)
        this.ghost.body.update?.(dt, prev && dt > 0 ? Math.hypot(g.at[0] - prev[0], g.at[2] - prev[2]) / dt : 0, 0)
        this.ghost.at = g.at
      }
    }
    if (this.racers) {
      const { bots, bodies } = this.racers
      bots.step(dt, run)
      bots.bots.forEach((b, i) => {
        bodies[i].object.position.set(...b.at)
        bodies[i].object.rotation.set(0, b.heading, 0)
        bodies[i].update?.(dt, b.speed, 0)
        events.push(...stepBot(run, b.id, b.at, now))
      })
    }
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
    this.setGhost(null)
    this.setBots(null)
    this.viewer.scene.remove(this.figures)
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
