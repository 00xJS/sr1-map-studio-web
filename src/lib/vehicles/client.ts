// Vehicles from the player's own game, on the page: the car models drawn at Vehicle spawn markers and the pictures
// in the vehicle picker. The packfiles are read in a worker (cmesh_stream.vpp_xbox2 for the models and textures,
// variants.vpp_xbox2 for the look a car spawns with, pegfiles.vpp_xbox2 for the textures all cars share); the last few
// cars read are kept in memory. Nothing
// read here is uploaded, published, shared or written into a map.
import { create } from 'zustand'
import { gamePack } from '../gameFiles'
import { catalogs } from '../catalogs'
import type { PackSource } from '../gameObjects/worker'
import type { CarReply, CarRequest, CarResult } from './car.worker'

export type { CarResult } from './car.worker'

export const CMESH_PACK = 'cmesh_stream.vpp_xbox2'
export const VARIANTS_PACK = 'variants.vpp_xbox2'
/** Holds always_loaded.peg_xbox2: the wheel, plate and other textures every car shares. */
export const PEGFILES_PACK = 'pegfiles.vpp_xbox2'
/** Largest texture side the editor keeps for a car. */
const TEX = 512

/** The four vehicles the retail multiplayer Gangsta Brawl maps place, in the picker's order. */
export const RETAIL_MP_VEHICLES = ['sp_metermaid01', 'car_4dr_standard08', 'car_2dr_sports03', 'car_2dr_muscle01']

/** Display name for a vehicle ID (the catalog's, or the ID itself). */
export function vehicleName(id: string): string {
  const k = id.toLowerCase()
  return catalogs.vehicles.find(([, v]) => v.toLowerCase() === k)?.[0] ?? id
}

/** The picker's list: the retail multiplayer four first, then the rest by name. */
export function vehicleChoices(): { id: string; name: string; retail: boolean }[] {
  const all = catalogs.vehicles.map(([name, id]) => ({ id, name, retail: RETAIL_MP_VEHICLES.includes(id.toLowerCase()) }))
  const first = RETAIL_MP_VEHICLES.map((id) => all.find((v) => v.id.toLowerCase() === id)).filter((v): v is NonNullable<typeof v> => !!v)
  const rest = all.filter((v) => !v.retail).sort((a, b) => a.name.localeCompare(b.name))
  return [...first, ...rest]
}

export interface VehiclesState {
  /** The game's vehicle files are open in the worker this tab. */
  open: boolean
  /** Size of each car read so far (metres: length, width, height), by lower-case ID. */
  sizes: Record<string, [number, number, number]>
}
export const useVehicles = create<VehiclesState>(() => ({ open: false, sizes: {} }))

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
type Body = CarRequest extends infer R ? (R extends CarRequest ? Omit<R, 'id'> : never) : never
function call<T>(msg: Body): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./car.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<CarReply>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.ok) p.resolve(e.data.value)
      else p.reject(new Error(e.data.error))
    }
  }
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker!.postMessage({ ...msg, id } as CarRequest)
  })
}

let devSources: { cmesh: PackSource; variants: PackSource | null; pegfiles: PackSource | null } | null = null
let opened: Promise<boolean> | null = null
let failedAt = 0

/** Forget a failed attempt, so the next ask looks for the files again (after the player opens their game files). */
export function retryVehicles() { failedAt = 0 }

/**
 * Opens the vehicle packfiles in the worker when they can be read without asking (the remembered game folder, files
 * picked by hand, or in development the dev server). Resolves false when they can't (yet): asked again at most every
 * few seconds, or at once after retryVehicles().
 */
export function openVehicles(ask = false): Promise<boolean> {
  if (opened) return opened
  if (!ask && failedAt && performance.now() - failedAt < 5000) return Promise.resolve(false)
  const p = (async () => {
    let src = devSources
    if (!src) {
      const cm = await gamePack(CMESH_PACK, ask).catch(() => null)
      if (!cm) return false
      src = { cmesh: cm, variants: await gamePack(VARIANTS_PACK, false).catch(() => null), pegfiles: await gamePack(PEGFILES_PACK, false).catch(() => null) }
    }
    await call({ type: 'open', cmesh: src.cmesh, variants: src.variants, pegfiles: src.pegfiles })
    useVehicles.setState({ open: true })
    return true
  })()
  opened = p
  const failed = () => { if (opened === p) { opened = null; failedAt = performance.now() } }
  p.then((ok) => { if (!ok) failed() }, failed)
  return p
}

const cars = new Map<string, Promise<CarResult | null>>()
const KEEP = 8

/**
 * One car as the game spawns it by default (null when the game files aren't open or it isn't a vehicle there).
 * Read once per tab.
 */
export function loadCar(vehicle: string): Promise<CarResult | null> {
  const id = vehicle.trim().toLowerCase()
  let p = cars.get(id)
  if (p) { cars.delete(id); cars.set(id, p); return p }
  // Only the last few stay in memory (the picker's pictures read many; the editor keeps its own built cars).
  while (cars.size >= KEEP) cars.delete(cars.keys().next().value!)
  p = (async () => {
    if (!id || !(await openVehicles())) return null
    try {
      const r = await call<CarResult>({ type: 'car', vehicle: id, texSize: TEX })
      const { min, max, wheelBottom } = r.model
      const size: [number, number, number] = [max[2] - min[2], max[0] - min[0], max[1] - (wheelBottom ?? min[1])].map((v) => Math.round(v * 100) / 100) as [number, number, number]
      useVehicles.setState((s) => ({ sizes: { ...s.sizes, [id]: size } }))
      return r
    } catch (e) {
      console.warn('Vehicle', id, (e as Error).message)
      return null
    }
  })()
  cars.set(id, p)
  // Not readable yet (game files closed): forget, so the next ask tries again.
  p.then((r) => { if (!r && !useVehicles.getState().open && cars.get(id) === p) cars.delete(id) })
  return p
}

/** Development only: the dev server's copies of the vehicle packfiles (see scripts/devGameFiles.ts). */
export function useDevVehicleSources(sizes: Record<string, number>) {
  if (!sizes[CMESH_PACK]) return false
  const at = (n: string) => (sizes[n] ? { url: `${location.origin}/__sr1dev/packfiles/${n}`, size: sizes[n] } : null)
  devSources = { cmesh: at(CMESH_PACK)!, variants: at(VARIANTS_PACK), pegfiles: at(PEGFILES_PACK) }
  opened = null
  failedAt = 0
  for (const [k, p] of cars) void p.then((r) => { if (!r) cars.delete(k) })
  void openVehicles()
  return true
}
