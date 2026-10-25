// The map wizard's preview: the map as it will be built, drawn small at a 3/4 angle and from above before the player
// accepts it. Shells first (the site's shapes, and every game model as its stand-in box), then each game model as it
// comes in from the player's own game files, biggest first, placed as the map builder places it (wizardBuild.ts),
// then the checks the editor runs once the map is open, on the real triangles: the health check, stairs too tall
// to run up, invisible walls. Drawn with the prefab thumbnails' renderer; nothing is stored, and the models stay in
// memory only (they are the player's game files).
import * as THREE from 'three'
import type { Part, Sample } from './sampleKit'
import { drawView, partsObject } from './prefabRender'
import { parseObj, type ObjModel } from './geometry'
import { newProject, type SceneItem } from './project'
import { mapLimit } from './hubRules'
import { sampleInput } from './analysis/sampleInput'
import { collisionFromProject } from './analysis/collision'
import { analyzeInWorkers, cancelAnalysis } from './analysis/client'
import { findStairs } from './stairRamps'
import { findSlivers } from './invisibleWalls'
import { NeedGameFolder, entryById, getObject } from './gameObjects/client'
import { identify } from './gameObjects/identity'
import { objectMesh } from './gameObjects/render'
import { objText, safe, stemOf } from './gameObjects/place'
import { eyeCover, mapTextures, placedTurn, standing } from './gameObjects/wizardBuild'

const RAD = Math.PI / 180
/** Editor units per metre's worth of world scale (the wizard's maps are built at 0.5). */
const WS = 0.5
/** Texture size the preview asks for: small, it is drawn small. */
const TEX = 64
export const ANGLE_PX = 520
export const TOP_PX = 260

export interface Preview {
  /** Object URLs of the pictures so far. */
  angle?: string
  top?: string
  stage: 'shells' | 'models' | 'checks' | 'done'
  /** Game models in, of how many. */
  models: [number, number]
  /** The game files aren't open in this tab: the models stay boxes until the player picks the folder. */
  needFolder?: boolean
  health?: number
  findings?: string[]
  stairs?: number
  walls?: number
  /** The checks couldn't run. */
  error?: string
}

interface Model { mesh: THREE.Mesh; obj: ObjModel; alpha: Record<string, boolean>; ex: number; ez: number; cover: number }
/** Models already brought in this visit, by library id (rerolls reuse most of them). */
const models = new Map<string, Promise<Model>>()
const MAX_MODELS = 300

async function modelOf(id: string): Promise<Model> {
  let m = models.get(id)
  if (!m) {
    m = (async () => {
      const e = entryById(id)
      if (!e) throw new Error('not in the library')
      const r = await getObject(e, TEX)
      const mesh = objectMesh(r, WS)
      mesh.geometry.computeBoundingBox()
      const b = mesh.geometry.boundingBox!
      // The collision model as the map builder stores it (place.ts), and which of its materials are see-through.
      const used = new Set<string>()
      const names = r.mesh.materials.map((tex) => { let n = safe(tex ? stemOf(tex) : 'plain'); const base = n; for (let i = 2; used.has(n); i++) n = `${base}_${i}`; used.add(n); return n })
      const obj = parseObj(objText(r, WS, names, e.name))
      const alpha = Object.fromEntries(names.map((n, i) => [n, !!r.textures[i]?.alpha]))
      const cover = eyeCover({ positions: r.mesh.positions.map((v) => v / WS), faces: r.mesh.triangles })
      return { mesh, obj, alpha, ex: b.max.x - b.min.x, ez: b.max.z - b.min.z, cover }
    })()
    models.set(id, m)
    m.catch(() => models.delete(id))
    // Oldest out first.
    if (models.size > MAX_MODELS) models.delete(models.keys().next().value!)
  }
  return m
}

const BOX = new THREE.BoxGeometry(1, 1, 1)
const BOX_MAT = new THREE.MeshLambertMaterial({ color: 0x8c9894 })

/** A stand-in drawn as the plain box it is until its model comes in. */
function boxOf(p: Part): THREE.Mesh {
  const m = new THREE.Mesh(BOX, BOX_MAT)
  m.scale.set(p.size[0], p.size[1], p.size[2])
  m.position.set(p.at[0], p.at[1] + p.size[1] / 2, p.at[2])
  m.rotation.y = (p.rot ?? 0) * RAD
  return m
}

/**
 * Draws `sample` and checks it, calling `onUpdate` as each stage lands. Returns a function that stops it (a reroll
 * starts another).
 */
export function previewMap(sample: Sample, onUpdate: (p: Preview) => void): () => void {
  let live = true
  const urls: string[] = []
  const game = sample.parts.filter((p) => p.game)
  const ids = [...new Set(game.map((p) => p.game!.id))]
  const state: Preview = { stage: 'shells', models: [0, ids.length] }
  const emit = () => { if (live) onUpdate({ ...state }) }
  let site: THREE.Object3D | null = null
  const root = new THREE.Group()
  const boxes = new Map<Part, THREE.Mesh>()
  /** Stand-ins whose model is in: the model (its own, or an alternative the map builder would use) and its turn. */
  const placed = new Map<Part, { id: string; rot: number }>()

  let drawing: Promise<void> | null = null, again = false
  const draw = async () => {
    if (drawing) { again = true; return drawing }
    drawing = (async () => {
      do {
        again = false
        const angle = await drawView(root, { px: ANGLE_PX, keep: true })
        const top = await drawView(root, { px: TOP_PX, top: true, keep: true })
        if (!live) return
        for (const [k, b] of [['angle', angle], ['top', top]] as const) if (b) { const u = URL.createObjectURL(b); urls.push(u); state[k] = u }
        emit()
      } while (again && live)
    })().finally(() => { drawing = null })
    return drawing
  }

  const show = (p: Part, m: Model, s: { id: string; rot: number }) => {
    const inst = new THREE.Mesh(m.mesh.geometry, m.mesh.material)
    inst.position.set(p.at[0], p.at[1], p.at[2])
    inst.rotation.y = s.rot * RAD
    root.add(inst)
    root.remove(boxes.get(p)!)
    placed.set(p, s)
  }

  const run = async () => {
    site = await partsObject(sample.parts.filter((p) => !p.game))
    if (!live) return
    root.add(site)
    for (const p of game) { const b = boxOf(p); boxes.set(p, b); root.add(b) }
    await draw()

    // Game models, the biggest first (buildings and module shells before their details).
    const bulk = new Map<string, number>()
    for (const p of game) bulk.set(p.game!.id, (bulk.get(p.game!.id) ?? 0) + p.size[0] * p.size[1] * p.size[2])
    ids.sort((a, b) => bulk.get(b)! - bulk.get(a)!)
    state.stage = 'models'
    let last = performance.now()
    await mapLimit(ids, 3, async (id) => {
      if (!live || state.needFolder) return
      let m: Model
      try { m = await modelOf(id) } catch (e) {
        if (e instanceof NeedGameFolder) state.needFolder = true
        return
      }
      if (!live) return
      const front = identify(entryById(id)!).building?.front
      for (const p of game.filter((q) => q.game!.id === id)) {
        const rot = placedTurn(p, m.ex, m.ez, m.cover, front)
        // Not this model: an alternative below, or the site's plain block (it stays a box).
        if (rot === null) continue
        show(p, m, { id, rot })
      }
      state.models = [state.models[0] + 1, ids.length]
      if (performance.now() - last > 900) { last = performance.now(); void draw() }
    })
    if (!live) return
    // Buildings whose own model won't do: the alternative the map builder will use, in the same order it tries them.
    const tex = mapTextures(game)
    const measure = (id: string) => modelOf(id).catch(() => null)
    for (const p of game) {
      if (placed.has(p) || !p.game!.alts?.length || state.needFolder || !live) continue
      const s = await standing(p, measure, tex)
      if (s && s.id !== p.game!.id) show(p, await modelOf(s.id), s)
    }
    if (!live) return
    await draw()

    // The editor's checks, on what the map will really be made of.
    state.stage = 'checks'
    emit()
    const plain = sample.parts.filter((p) => !p.game || !placed.has(p)).map(({ game: _, ...p }) => p)
    const shapes = sampleInput({ parts: plain, markers: sample.markers })
    const project = newProject('preview')
    const byPath = new Map<string, ObjModel>()
    project.scene_items = [...placed].map(([p, { id, rot }], i): SceneItem => {
      const path = '/preview/' + id
      return { uid: String(i), name: p.game!.name, path, position: p.at, rotation: [0, rot, 0], scale: 1, textures: {}, alpha: {} }
    })
    // Every model here is already in (the promises above resolve at once).
    const ms = await Promise.all(project.scene_items.map((it) => modelOf(it.path.slice('/preview/'.length))))
    project.scene_items.forEach((it, i) => { byPath.set(it.path, ms[i].obj); it.alpha = ms[i].alpha })
    const models = collisionFromProject(project, (path) => byPath.get(path))
    const tris = new Float32Array(shapes.tris.length + models.tris.length)
    tris.set(shapes.tris); tris.set(models.tris, shapes.tris.length)
    const flags = new Uint8Array(shapes.flags.length + models.flags.length)
    flags.set(shapes.flags); flags.set(models.flags, shapes.flags.length)
    state.walls = findSlivers(tris, flags).count
    // The stair finder measures in editor units at the usual world scale, which the wizard's maps have.
    state.stairs = findStairs(tris, flags).length
    emit()
    const report = await analyzeInWorkers({ tris, flags, markers: shapes.markers })
    if (!live) return
    state.health = report.score
    state.findings = report.findings.slice(0, 2)
    state.stage = 'done'
    emit()
  }

  run().catch((e) => { if (live) { state.error = (e as Error).message; state.stage = 'done'; emit() } }).finally(() => dispose())

  const dispose = () => {
    if (!site) return
    site.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); for (const m of [o.material].flat()) { (m as THREE.MeshLambertMaterial).map?.dispose(); m.dispose() } } })
    site = null
  }
  return () => {
    if (!live) return
    live = false
    if (state.stage === 'checks') cancelAnalysis()
    // The pictures stay up until the next preview has its own.
    setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 8000)
  }
}
