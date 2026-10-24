// The vehicle worker: reads one car at a time out of the player's own packfiles (cmesh_stream for the model and its
// textures, variants for which optional pieces and paint it spawns with, pegfiles for the textures all cars share),
// by byte range. Nothing is uploaded or stored.
/// <reference lib="webworker" />
import { openVpp, type Vpp } from '../sr1char/vpp'
import { findTexture, hasAlpha, indexPeg, shrink, type PegIndex } from '../gameObjects/textures'
import type { PackSource } from '../gameObjects/worker'
import { defaultVariant, parseCar, parseCarVariants, type CarModel } from './car'

export interface CarTexture { width: number; height: number; rgba: ArrayBuffer; alpha: boolean }
export interface CarResult { id: string; model: CarModel; textures: Record<string, CarTexture> }

export type CarRequest =
  | { id: number; type: 'open'; cmesh: PackSource; variants: PackSource | null; pegfiles: PackSource | null }
  | { id: number; type: 'car'; vehicle: string; texSize: number }
export type CarReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string }

const post = (m: CarReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)

/** Byte ranges of a URL, shaped like the Blob slices openVpp reads (development only). */
function rangeSource(url: string, size: number): Blob {
  const slice = (a = 0, b = size) => ({
    async arrayBuffer() {
      const r = await fetch(url, { headers: { Range: `bytes=${a}-${Math.min(b, size) - 1}` } })
      if (r.status !== 206 && r.status !== 200) throw new Error('could not read ' + url)
      return r.arrayBuffer()
    },
  })
  return { size, slice } as unknown as Blob
}
const open = (src: PackSource, label: string) => openVpp(src instanceof Blob ? src : rangeSource(src.url, src.size), label)

let cmesh: Promise<Vpp> | null = null
let variants: Promise<Vpp> | null = null
let pegfiles: Promise<Vpp> | null = null
let shared: Promise<PegIndex | null> | null = null

/** The texture file every car shares (wheels, number plates), read once: pegfiles.vpp_xbox2: always_loaded.peg_xbox2. */
const SHARED_PEG = 'always_loaded.peg_xbox2'
function sharedPeg(): Promise<PegIndex | null> {
  return (shared ??= (pegfiles ?? Promise.reject(new Error('no pegfiles'))).then(async (v) => (v.has(SHARED_PEG) ? indexPeg(await v.read(SHARED_PEG)) : null)).catch(() => null))
}

/** Every diffuse picture the drawn materials use: the car's own texture file first, then the shared one. */
function carTextures(model: CarModel, pegBytes: Uint8Array | null, common: PegIndex | null, texSize: number): Record<string, CarTexture> {
  const out: Record<string, CarTexture> = {}
  const own = pegBytes ? indexPeg(pegBytes) : null
  const used = new Set<number>()
  for (const m of model.meshes) for (const g of m.groups) used.add(g.material)
  for (const mi of used) {
    const name = model.materials[mi]?.slots.find((s) => s.slot === 'diffuse_map')?.texture?.toLowerCase()
    if (!name || name in out) continue
    const img = findTexture(name, [own, common].filter((p): p is PegIndex => !!p))
    if (!img) continue
    const small = shrink(img, texSize)
    out[name] = { width: small.width, height: small.height, rgba: small.rgba.buffer.slice(small.rgba.byteOffset, small.rgba.byteOffset + small.rgba.byteLength) as ArrayBuffer, alpha: hasAlpha(small) }
  }
  return out
}

async function loadCar(vehicle: string, texSize: number): Promise<CarResult> {
  if (!cmesh) throw new Error('the game files are not open')
  const id = vehicle.toLowerCase()
  const pack = await cmesh
  if (!pack.has(id + '.car_xbox2')) throw new Error(`${vehicle} is not a vehicle in cmesh_stream.vpp_xbox2`)
  const [carBytes, pegBytes, xtbl, common] = await Promise.all([
    pack.read(id + '.car_xbox2'),
    pack.has(id + '.peg_xbox2') ? pack.read(id + '.peg_xbox2') : Promise.resolve(null),
    variants ? variants.then(async (v) => (v.has(id + '.xtbl') ? new TextDecoder('latin1').decode(await v.read(id + '.xtbl')) : '')).catch(() => '') : Promise.resolve(''),
    sharedPeg(),
  ])
  const model = parseCar(carBytes, xtbl ? defaultVariant(parseCarVariants(xtbl)) : null)
  return { id, model, textures: carTextures(model, pegBytes, common, texSize) }
}

self.onmessage = async (e: MessageEvent<CarRequest>) => {
  const m = e.data
  try {
    if (m.type === 'open') {
      cmesh = open(m.cmesh, 'cmesh_stream.vpp_xbox2')
      variants = m.variants ? open(m.variants, 'variants.vpp_xbox2') : null
      variants?.catch(() => {})
      pegfiles = m.pegfiles ? open(m.pegfiles, 'pegfiles.vpp_xbox2') : null
      pegfiles?.catch(() => {})
      shared = null
      await cmesh
      post({ id: m.id, ok: true, value: true })
    } else {
      const r = await loadCar(m.vehicle, m.texSize)
      const transfer: Transferable[] = []
      for (const mesh of r.model.meshes) transfer.push(mesh.positions.buffer, mesh.normals.buffer, mesh.uvs.buffer, mesh.indices.buffer)
      for (const t of Object.values(r.textures)) transfer.push(t.rgba)
      post({ id: m.id, ok: true, value: r }, transfer)
    }
  } catch (err) {
    post({ id: m.id, ok: false, error: (err as Error).message })
  }
}
