// Viewport behaviour of the Terrain and Road tools, kept out of the viewer:
// - Terrain: hold the left button on a terrain to sculpt it with the chosen
//   brush (Shift swaps raise and lower); the mesh redraws every frame and the
//   stroke is kept as one undo step when the button comes up. Dragging off a
//   terrain still turns the camera.
// - Road: click points along the map, Enter (or click the last point again)
//   to finish. Start on the selected road to add a branch to it. With a road
//   selected its points show as handles: drag one to move it, Alt+click to
//   remove it, Shift+click the road to add a point there.
import * as THREE from 'three'
import { create } from 'zustand'
import type { Viewer } from './Viewer'
import { currentProject, useEditor } from './store'
import { grid, heightAt, sculpt, terrainModel, type Brush } from '../lib/terrain'
import { addRoad, commitTerrain, isRoad, roadLines, setRoadLines } from './groundActions'
import { toast, toastError } from '../ui'
import { ROAD_DEFAULTS, type Polyline, type Pt } from '../lib/roads'
import type { Shape } from '../lib/shapes'

export interface GroundToolState {
  brush: Brush
  /** Brush radius and strength in world units (strength: units per second for raise and lower). */
  radius: number
  strength: number
  /** Keep every slope 45° or gentler, so players can walk anywhere. */
  walkable: boolean
  terrainSize: number
  /** Settings for the next road drawn. */
  road: { width: number; walk: number; lines: string; lamps: number; crossings: string }
  /** Points in the road being drawn (0 when none). */
  draft: number
  set(p: Partial<GroundToolState>): void
}

export const useGround = create<GroundToolState>((set) => ({
  brush: 'raise', radius: 12, strength: 6, walkable: true, terrainSize: 160,
  road: { width: ROAD_DEFAULTS.width, walk: ROAD_DEFAULTS.walk, lines: ROAD_DEFAULTS.lines, lamps: ROAD_DEFAULTS.lamps, crossings: 'yes' },
  draft: 0,
  set: (p) => set(p),
}))

let hooks: { finish(): void; undo(): void; cancel(): void } | null = null
/** Tool bar buttons: finish the road being drawn, take back its last point, or drop it. */
export const finishRoad = () => hooks?.finish()
export const undoRoadPoint = () => hooks?.undo()
export const cancelRoad = () => hooks?.cancel()

const isTerrain = (i: number) => currentProject()?.scene_items[i]?.shape?.kind === 'terrain'
const UP = new THREE.Vector3(0, 1, 0)

/** Nearest point on any of the lines to (x, z), with which line and segment it is on. */
function nearest(lines: Polyline[], x: number, z: number) {
  let best = { line: -1, seg: -1, p: [x, z] as Pt, d: Infinity }
  lines.forEach((l, li) => {
    for (let k = 0; k + 1 < l.length; k++) {
      const [ax, az] = l[k], [bx, bz] = l[k + 1]
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2))
      const p: Pt = [ax + dx * t, az + dz * t]
      const d = Math.hypot(p[0] - x, p[1] - z)
      if (d < best.d) best = { line: li, seg: k, p, d }
    }
  })
  return best
}

export function attachGroundTools(viewer: Viewer): () => void {
  const el = viewer.renderer.domElement
  const rc = new THREE.Raycaster()
  const ndc = (e: MouseEvent) => {
    const r = el.getBoundingClientRect()
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  }
  const tool = () => useEditor.getState().tool
  const capture = (e: PointerEvent) => { try { el.setPointerCapture(e.pointerId) } catch { /* the pointer is already gone */ } }
  const overlay = <T extends THREE.Object3D>(o: T): T => { o.renderOrder = 20; o.raycast = () => {}; o.frustumCulled = false; return o }

  // Brush ring, drawn over everything.
  const ring = overlay(new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffd23d, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide })))
  ring.rotation.x = -Math.PI / 2
  ring.visible = false
  // The road being drawn, and the selected road's lines and point handles.
  const draftLine = overlay(new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd23d, depthTest: false, transparent: true })))
  const roadGuide = new THREE.Group()
  const handles = new THREE.Group()
  viewer.scene.add(ring, draftLine, roadGuide, handles)
  const handleGeo = new THREE.SphereGeometry(0.9, 16, 10)
  const handleMat = new THREE.MeshBasicMaterial({ color: 0xffd23d, depthTest: false, transparent: true, opacity: 0.95 })
  const guideMat = new THREE.LineBasicMaterial({ color: 0x37e3ff, depthTest: false, transparent: true, opacity: 0.9 })

  // ---------------- terrain ----------------

  function hitTerrain(e: MouseEvent, only?: number) {
    const p = currentProject()
    if (!p) return null
    rc.setFromCamera(ndc(e), viewer.camera)
    let best: { index: number; world: THREE.Vector3; mesh: THREE.Mesh; d: number } | null = null
    for (const i of only !== undefined ? [only] : p.scene_items.map((_, k) => k).filter(isTerrain)) {
      const mesh = viewer.itemMesh(i)
      if (!mesh?.parent?.visible) continue
      const h = rc.intersectObject(mesh, false)[0]
      if (h && (!best || h.distance < best.d)) best = { index: i, world: h.point.clone(), mesh, d: h.distance }
    }
    if (!best) return null
    return { index: best.index, world: best.world, local: best.mesh.worldToLocal(best.world.clone()), scale: p.scene_items[best.index].scale || 1 }
  }

  let stroke: { index: number; shape: Shape; heights: number[]; level: number; at: THREE.Vector3; scale: number; last: number; raf: number; invert: boolean } | null = null

  const brushStep = (now: number) => {
    const s = stroke
    if (!s) return
    // Slow frames still sculpt at the set rate (a busy machine, a background tab).
    const dt = Math.min(0.2, Math.max(0, (now - s.last) / 1000))
    s.last = now
    const g = useGround.getState()
    const brush: Brush = s.invert ? (g.brush === 'raise' ? 'lower' : g.brush === 'lower' ? 'raise' : g.brush) : g.brush
    const shape = { ...s.shape, heights: s.heights }
    s.heights = sculpt(shape, { brush, x: s.at.x, z: s.at.z, radius: g.radius / s.scale, strength: brush === 'raise' || brush === 'lower' ? g.strength / s.scale : g.strength / 6, dt, level: s.level }, g.walkable)
    viewer.previewItem(s.index, terrainModel({ ...shape, heights: s.heights }))
    s.raf = requestAnimationFrame(brushStep)
  }

  const showRing = (hit: ReturnType<typeof hitTerrain>) => {
    ring.visible = !!hit
    if (hit) {
      ring.position.copy(hit.world).addScaledVector(UP, 0.25)
      ring.scale.setScalar(useGround.getState().radius)
    }
    viewer.requestRender()
  }

  // ---------------- roads ----------------

  let draft: { pts: THREE.Vector3[]; join: number | null; y: number } | null = null
  let hover: THREE.Vector3 | null = null
  let drag: { road: number; line: number; point: number; lines: Polyline[]; y: number } | null = null
  let press: { x: number; y: number } | null = null

  const selectedRoad = (): number | null => {
    const s = useEditor.getState()
    return s.selection?.kind === 'item' && isRoad(s.selection.index) ? s.selection.index : null
  }
  const onPlane = (e: MouseEvent, y: number) => {
    rc.setFromCamera(ndc(e), viewer.camera)
    return rc.ray.intersectPlane(new THREE.Plane(UP, -y), new THREE.Vector3())
  }

  const drawDraft = () => {
    const pts = draft ? [...draft.pts, ...(hover ? [hover] : [])] : []
    draftLine.geometry.dispose()
    draftLine.geometry = new THREE.BufferGeometry().setFromPoints(pts.map((p) => p.clone().addScaledVector(UP, 0.3)))
    draftLine.visible = pts.length >= 2
    useGround.getState().set({ draft: draft?.pts.length ?? 0 })
    viewer.requestRender()
  }

  /** Handles at the selected road's points, and its lines drawn over everything. */
  const drawHandles = () => {
    roadGuide.children.forEach((c) => (c as THREE.Line).geometry.dispose())
    roadGuide.clear()
    handles.clear()
    const st = useEditor.getState()
    const r = st.tool === 'road' && !st.walking ? selectedRoad() : null
    if (r === null) { viewer.requestRender(); return }
    const y = currentProject()!.scene_items[r].position[1] + 0.4
    const lines = drag?.road === r ? drag.lines : roadLines(r)
    lines.forEach((l, li) => {
      roadGuide.add(overlay(new THREE.Line(new THREE.BufferGeometry().setFromPoints(l.map(([x, z]) => new THREE.Vector3(x, y, z))), guideMat)))
      l.forEach(([x, z], pi) => {
        const h = new THREE.Mesh(handleGeo, handleMat)
        h.position.set(x, y, z)
        h.renderOrder = 22
        h.userData = { line: li, point: pi }
        handles.add(h)
      })
    })
    viewer.requestRender()
  }

  const finish = () => {
    const d = draft
    if (!d) return
    if (d.pts.length < 2) { toast('Click at least two points along the map for a road.', 'info', 2500); return }
    draft = null; hover = null
    drawDraft()
    const pts = d.pts.map((p): Pt => [+p.x.toFixed(2), +p.z.toFixed(2)])
    if (d.join !== null && isRoad(d.join)) setRoadLines(d.join, [...roadLines(d.join), pts]).then(drawHandles).catch(toastError)
    else addRoad(pts, d.y, useGround.getState().road).then(drawHandles).catch(toastError)
  }
  const undo = () => {
    if (!draft) return
    draft.pts.pop()
    if (!draft.pts.length) draft = null
    drawDraft()
  }
  const cancel = () => { draft = null; hover = null; drawDraft() }
  hooks = { finish, undo, cancel }

  /** A click with the Road tool (not a drag). */
  const roadClick = (e: MouseEvent) => {
    const hit = viewer.raycast(e.clientX, e.clientY)
    const r = selectedRoad()
    if (!draft) {
      if (!hit) return
      if (hit.item >= 0 && isRoad(hit.item) && hit.item !== r) {
        useEditor.getState().select({ kind: 'item', index: hit.item })
        return
      }
      if (r !== null && e.shiftKey) {
        // Shift+click on the selected road: a new point on the nearest line.
        const lines = roadLines(r)
        const n = nearest(lines, hit.point[0], hit.point[2])
        if (n.line < 0) return
        lines[n.line].splice(n.seg + 1, 0, n.p)
        setRoadLines(r, lines).then(drawHandles).catch(toastError)
        return
      }
      const p = new THREE.Vector3(...hit.point)
      let join: number | null = null
      if (r !== null && hit.item === r) {
        // Starting on the selected road: a branch from its middle line.
        const n = nearest(roadLines(r), p.x, p.z)
        p.set(n.p[0], currentProject()!.scene_items[r].position[1], n.p[1])
        join = r
      }
      draft = { pts: [p], join, y: p.y }
      drawDraft()
      return
    }
    const last = draft.pts[draft.pts.length - 1]
    let p = onPlane(e, draft.y)
    if (!p) return
    // Ending on the road it branches from (or the selected road): snap onto its middle line.
    const target = draft.join ?? r
    if (target !== null && hit?.item === target) {
      const n = nearest(roadLines(target), p.x, p.z)
      p = new THREE.Vector3(n.p[0], draft.y, n.p[1])
    }
    if (p.distanceTo(last) < 1.5) { finish(); return }
    draft.pts.push(p)
    drawDraft()
  }

  // ---------------- pointer and keys ----------------

  const down = (e: PointerEvent) => {
    if (e.button !== 0) return
    const t = tool()
    if (t === 'sculpt') {
      const hit = hitTerrain(e)
      if (!hit) return // off the terrain: let the camera turn
      e.stopImmediatePropagation()
      e.preventDefault()
      capture(e)
      const shape = currentProject()!.scene_items[hit.index].shape!
      stroke = { index: hit.index, shape, heights: grid(shape).h.slice(), level: heightAt(shape, hit.local.x, hit.local.z) ?? 0, at: hit.local, scale: hit.scale, last: performance.now(), raf: 0, invert: e.shiftKey }
      stroke.raf = requestAnimationFrame(brushStep)
    } else if (t === 'road') {
      press = { x: e.clientX, y: e.clientY }
      const r = selectedRoad()
      if (r === null || draft) return
      rc.setFromCamera(ndc(e), viewer.camera)
      const h = rc.intersectObjects(handles.children, false)[0]
      if (!h) return
      e.stopImmediatePropagation()
      e.preventDefault()
      press = null
      const { line, point } = h.object.userData as { line: number; point: number }
      const lines = roadLines(r)
      if (e.altKey) {
        lines[line].splice(point, 1)
        if (lines[line].length < 2) lines.splice(line, 1)
        setRoadLines(r, lines).then(drawHandles).catch(toastError)
        return
      }
      drag = { road: r, line, point, lines, y: currentProject()!.scene_items[r].position[1] }
      capture(e)
    }
  }

  const move = (e: PointerEvent) => {
    const t = tool()
    if (t === 'sculpt') {
      const hit = stroke ? hitTerrain(e, stroke.index) : hitTerrain(e)
      if (stroke && hit) stroke.at = hit.local
      showRing(hit)
    } else if (t === 'road') {
      if (drag) {
        const p = onPlane(e, drag.y)
        if (!p) return
        drag.lines[drag.line][drag.point] = [+p.x.toFixed(2), +p.z.toFixed(2)]
        drawHandles()
      } else if (draft) {
        hover = onPlane(e, draft.y)
        drawDraft()
      }
    }
  }

  const up = (e: PointerEvent) => {
    if (stroke) {
      const s = stroke
      stroke = null
      cancelAnimationFrame(s.raf)
      commitTerrain(s.index, s.heights).catch(toastError)
      return
    }
    if (drag) {
      const d = drag
      drag = null
      setRoadLines(d.road, d.lines).then(drawHandles).catch(toastError)
      return
    }
    if (tool() !== 'road' || !press || e.button !== 0) return
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y)
    press = null
    if (moved <= 5) roadClick(e)
  }

  const key = (e: KeyboardEvent) => {
    if (tool() !== 'road' || !draft || useEditor.getState().walking) return
    const t = e.target as HTMLElement
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
    if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); finish() }
    else if (e.key === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); undo() }
  }
  const leave = () => { if (!stroke) { ring.visible = false; viewer.requestRender() } }

  el.addEventListener('pointerdown', down, { capture: true })
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointerleave', leave)
  window.addEventListener('keydown', key, { capture: true })

  // Keep the overlays in step with the editor: tool changes drop a half-drawn road, the selection picks the handles.
  let was = { tool: tool(), sel: useEditor.getState().selection, project: currentProject(), walking: false }
  const unsub = useEditor.subscribe((s) => {
    if (s.tool !== was.tool) {
      if (s.tool !== 'road') cancel()
      if (s.tool !== 'sculpt') ring.visible = false
    }
    if (s.walking) { ring.visible = false; cancel() }
    if (s.tool !== was.tool || s.selection !== was.sel || s.project !== was.project || s.walking !== was.walking) drawHandles()
    was = { tool: s.tool, sel: s.selection, project: s.project, walking: s.walking }
  })

  return () => {
    unsub()
    if (stroke) cancelAnimationFrame(stroke.raf)
    el.removeEventListener('pointerdown', down, { capture: true })
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointerleave', leave)
    window.removeEventListener('keydown', key, { capture: true })
    viewer.scene.remove(ring, draftLine, roadGuide, handles)
    hooks = null
  }
}
