// The real car at each Vehicle spawn marker, read from the player's own game files (lib/vehicles): a visual only
// (the marker stays what is picked and moved). Each car is built once per tab and shared by every marker that
// spawns it; without the game files the marker is drawn alone, as before.
import * as THREE from 'three'
import type { Marker } from '../lib/project'
import { loadCar, retryVehicles, useVehicles } from '../lib/vehicles/client'
import { useGameObjects } from '../lib/gameObjects/client'

/** Built cars by lower-case vehicle ID (null: not readable). */
const built = new Map<string, THREE.Group | null>()
const loading = new Set<string>()
const redraws = new Set<() => void>()

const noRaycast = (o: THREE.Object3D) => o.traverse((c) => { c.raycast = () => {} })

function request(id: string) {
  loading.add(id)
  void Promise.all([loadCar(id), import('../lib/vehicles/render')]).then(([r, { carObject }]) => {
    built.set(id, r ? carObject(r) : null)
  }, () => built.set(id, null)).finally(() => {
    loading.delete(id)
    redraws.forEach((fn) => fn())
  })
}

/** Cars that couldn't be read are asked for again once the game files are open. */
function retry() {
  retryVehicles()
  let any = false
  for (const [id, g] of built) if (!g) { built.delete(id); any = true }
  if (any) redraws.forEach((fn) => fn())
}
useGameObjects.subscribe((s, prev) => { if (s.connected && !prev.connected) retry() })
useVehicles.subscribe((s, prev) => { if (s.open && !prev.open) retry() })

/**
 * Adds, swaps or removes the car drawn in a marker's group. `k` is the marker's own size factor (bigger when
 * selected): the car is scaled back so it stays true to size. `redraw` re-syncs the markers once a car arrives.
 * In the group (one unit = one game metre, yaw already applied, yaw 0 facing -Z) the car's front, +Z in the game's
 * car frame, turns to -Z and its sides swap, matching the editor's mirrored X.
 */
export function syncVehicle(g: THREE.Group, m: Marker, k: number, redraw: () => void) {
  redraws.add(redraw)
  const want = m.type === 'Vehicle spawn' ? (m.vehicle || '').trim().toLowerCase() : ''
  let car = g.getObjectByName('vehicle')
  if (car && car.userData.vehicle !== want) { g.remove(car); car = undefined }
  if (!want) return
  if (!car) {
    const template = built.get(want)
    if (template === undefined) { if (!loading.has(want)) request(want); return }
    if (!template) return
    car = template.clone()
    car.name = 'vehicle'
    car.userData = { vehicle: want }
    noRaycast(car)
    g.add(car)
  }
  car.scale.set(1 / k, 1 / k, -1 / k)
}

/** Size of a vehicle read this session (metres: length, width, height), if any. */
export const vehicleSize = (id: string) => useVehicles.getState().sizes[id.trim().toLowerCase()]
