// The Measure tool: click two points (on the map, or the ground off it) and see how far apart they are in metres.
// The line between them is drawn over the map until the tool is put down.
import * as THREE from 'three'
import { create } from 'zustand'
import { useEditor } from './store'
import type { Viewer } from './Viewer'
import { measure } from '../lib/arrange'
import { fmtM, toMetres } from '../lib/units'
import type { Vec3 } from '../lib/project'

interface MeasureState { a: Vec3 | null; b: Vec3 | null }
export const useMeasure = create<MeasureState>(() => ({ a: null, b: null }))

/** A click with the Measure tool: the first point, then the second; a third click starts again. */
export function measureClick(p: Vec3) {
  const { a, b } = useMeasure.getState()
  useMeasure.setState(!a || b ? { a: p, b: null } : { b: p })
}

export const clearMeasure = () => useMeasure.setState({ a: null, b: null })

/** What the tool bar says: what to click next, or the distance (straight, across the ground and up or down). */
export function measureText(m: MeasureState, worldScale?: number): string {
  if (!m.a) return 'Click the first point.'
  if (!m.b) return 'Now click the second point.'
  const d = measure(m.a, m.b)
  const metres = (u: number) => fmtM(toMetres(u, worldScale))
  const parts = [metres(d.length)]
  if (Math.abs(d.rise) >= 0.05 && d.flat >= 0.05) parts.push(`${metres(d.flat)} across`, `${metres(Math.abs(d.rise))} ${d.rise > 0 ? 'up' : 'down'}`)
  return parts.join(' · ')
}

/** Draws the measured line in the viewer while the Measure tool is in hand; returns the detach function. */
export function attachMeasure(viewer: Viewer): () => void {
  const mat = new THREE.LineBasicMaterial({ color: 0xffd23d, depthTest: false, transparent: true })
  const line = new THREE.Line(new THREE.BufferGeometry(), mat)
  const dotGeo = new THREE.SphereGeometry(0.35, 12, 8)
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffd23d, depthTest: false, transparent: true })
  const dots = [new THREE.Mesh(dotGeo, dotMat), new THREE.Mesh(dotGeo, dotMat)]
  const group = new THREE.Group()
  group.add(line, ...dots)
  group.renderOrder = 20
  group.traverse((o) => { o.renderOrder = 20; o.raycast = () => {} })
  viewer.scene.add(group)
  const draw = () => {
    const { a, b } = useMeasure.getState()
    const on = useEditor.getState().tool === 'measure'
    group.visible = on && !!a
    dots[0].visible = !!a
    dots[1].visible = !!b
    if (a) dots[0].position.set(...a)
    if (b) dots[1].position.set(...b)
    line.visible = !!(a && b)
    if (a && b) line.geometry.setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)])
    viewer.requestRender()
  }
  draw()
  const offMeasure = useMeasure.subscribe(draw)
  // Putting the tool down forgets the points.
  const offTool = useEditor.subscribe((s, prev) => { if (s.tool !== prev.tool) { if (s.tool !== 'measure') clearMeasure(); draw() } })
  return () => {
    offMeasure(); offTool()
    viewer.scene.remove(group)
    line.geometry.dispose(); mat.dispose(); dotGeo.dispose(); dotMat.dispose()
  }
}
