// Outlines of zone markers in the 3D view: Blinged Out Ride trigger boxes and sound zones, drawn at their size in
// metres around the marker (see lib/retailModes.ts).
import * as THREE from 'three'
import type { Marker } from '../lib/project'
import { BOR_CAR_BLUE, BOR_CAR_RED, BOR_CASH, BOR_GARAGE_BLUE, BOR_GARAGE_RED, SOUND_ZONE, isZone, zoneShape } from '../lib/retailModes'

export const RETAIL_MARKER_COLORS: Record<string, number> = {
  [BOR_CAR_RED]: 0xff4d5e, [BOR_GARAGE_RED]: 0xff4d5e, [BOR_CAR_BLUE]: 0x4d8bff, [BOR_GARAGE_BLUE]: 0x4d8bff,
  [BOR_CASH]: 0x3dff9a, [SOUND_ZONE]: 0x5ce1e6,
}

const BOX = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0))
const SPHERE = (() => {
  // Three rings: around, and two upright ones.
  const pts: THREE.Vector3[] = []
  const ring = (f: (a: number) => THREE.Vector3) => {
    for (let i = 0; i < 64; i++) pts.push(f((i / 64) * Math.PI * 2), f(((i + 1) / 64) * Math.PI * 2))
  }
  ring((a) => new THREE.Vector3(Math.cos(a), 0, Math.sin(a)))
  ring((a) => new THREE.Vector3(Math.cos(a), Math.sin(a), 0))
  ring((a) => new THREE.Vector3(0, Math.sin(a), Math.cos(a)))
  return new THREE.BufferGeometry().setFromPoints(pts)
})()

/**
 * Adds, updates or removes the zone outline of a marker's group. `groupScale` is the group's own scale (markers are
 * drawn about one game unit across), so the outline is divided by it to come out in game metres.
 */
export function syncZone(g: THREE.Group, m: Marker, groupScale: number, color: number) {
  let zone = g.getObjectByName('zone') as THREE.LineSegments | undefined
  if (!isZone(m)) { if (zone) g.remove(zone); return }
  const shape = zoneShape(m)
  const kind = 'box' in shape ? 'box' : 'sphere'
  if (zone && zone.userData.kind !== kind) { g.remove(zone); zone = undefined }
  if (!zone) {
    zone = new THREE.LineSegments(kind === 'box' ? BOX : SPHERE, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7, depthTest: false }))
    zone.name = 'zone'
    zone.userData.kind = kind
    zone.raycast = () => {}
    zone.renderOrder = 9
    g.add(zone)
  }
  if ('box' in shape) zone.scale.set(...(shape.box.map((v) => v / groupScale) as [number, number, number]))
  else zone.scale.setScalar(shape.radius / groupScale)
}
