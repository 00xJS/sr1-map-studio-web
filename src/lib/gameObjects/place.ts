// Placing a game object: its mesh becomes an OBJ (editor space: X mirrored, like every model the exporter
// mirrors back; one unit = world_scale metres) and its textures PNGs, stored in this browser as files from the
// game (origin 'game': never uploaded, synced, published or shared), so the editor and the exporter use it like
// any imported model, offline too. The scene item keeps where it came from ({ source: 'game', chunk, record }),
// so a copy of the map that arrives without those files (a backup, a cloud save) can rebuild them from that
// player's own game.
import { storeFile } from '../files'
import { catalogs } from '../catalogs'
import { parseObj } from '../geometry'
import type { FileRef, Project, SceneItem } from '../project'
import { getObject } from './client'
import type { GameObjectEntry } from './indexer'
import type { ObjectResult } from './worker'

/** Where a placed game object came from. */
export interface GameObjectRef {
  source: 'game'
  pack: string
  chunk: string
  record: number
  parts?: number[]
  /** The library entry. */
  id: string
  /** World scale the mesh was written at. */
  ws: number
}

export const gameRefOf = (it: { game_object?: unknown }): GameObjectRef | null => {
  const g = it.game_object as GameObjectRef | undefined
  return g && g.source === 'game' && typeof g.chunk === 'string' && Number.isInteger(g.record) ? g : null
}

/** Largest texture side kept for placing (the exporter packs them again). */
const PLACE_TEX = 1024

const stemOf = (tex: string) => tex.replace(/\.[^.]+$/, '')
const safe = (s: string) => s.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'mat'

/** Surface type from the texture name's suffix, the way the game reads it (concrete when there is none). */
export function surfaceOf(tex: string): number {
  const m = tex.match(/_([a-zA-Z]{2})\.[^.]+$/)
  const i = m ? catalogs.surface_suffixes.indexOf(m[1].toLowerCase()) : -1
  return i < 0 ? 0 : i
}

/** The OBJ text: editor-space vertices, UVs flipped to OBJ's bottom-left origin, one group per material. */
export function objText(r: ObjectResult, ws: number, matNames: string[], title: string): string {
  const { mesh } = r
  const lines = ['# ' + title + ', from your own Saints Row game files (kept on this device)']
  const n = mesh.positions.length / 3
  const f = (v: number) => +v.toFixed(5)
  for (let i = 0; i < n; i++) lines.push(`v ${f(-mesh.positions[3 * i] / ws)} ${f(mesh.positions[3 * i + 1] / ws)} ${f(mesh.positions[3 * i + 2] / ws)}`)
  for (let i = 0; i < n; i++) lines.push(`vt ${f(mesh.uvs[2 * i])} ${f(1 - mesh.uvs[2 * i + 1])}`)
  const tris = mesh.triangles.length / 3
  const byMat = new Map<number, number[]>()
  for (let t = 0; t < tris; t++) { const m = mesh.triMaterial[t]; const l = byMat.get(m); if (l) l.push(t); else byMat.set(m, [t]) }
  for (const [m, list] of [...byMat.entries()].sort((a, b) => a[0] - b[0])) {
    lines.push('usemtl ' + matNames[m])
    for (const t of list) {
      // Mirroring X turns triangles over; swapping two corners keeps them facing out (the exporter does the same back).
      const a = mesh.triangles[3 * t] + 1, b = mesh.triangles[3 * t + 2] + 1, c = mesh.triangles[3 * t + 1] + 1
      lines.push(`f ${a}/${a} ${b}/${b} ${c}/${c}`)
    }
  }
  return lines.join('\n') + '\n'
}

async function rgbaPng(t: { width: number; height: number; rgba: ArrayBuffer }, name: string): Promise<File> {
  const c = new OffscreenCanvas(t.width, t.height)
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(t.rgba), t.width, t.height), 0, 0)
  return new File([await c.convertToBlob({ type: 'image/png' })], name, { type: 'image/png' })
}

/** A plain stand-in for a material whose picture couldn't be read (the exporter needs one per material). */
const plain = () => ({ width: 8, height: 8, rgba: new Uint8Array(8 * 8 * 4).fill(150).buffer, alpha: false })

export interface StoredObject {
  path: string
  files: Record<string, FileRef>
  textures: Record<string, string>
  alpha: Record<string, boolean>
  surface_ids: Record<string, number>
  triangles: number
}

/**
 * Writes the object's OBJ and PNGs to this browser's file store, marked as game files. `tag` goes into the file
 * names, so rebuilt files get new paths and the views that remembered them as missing load them again.
 */
export async function storeObject(r: ObjectResult, name: string, ws: number, tag = ''): Promise<StoredObject> {
  const used = new Set<string>()
  const matNames = r.mesh.materials.map((tex) => {
    let n = safe(tex ? stemOf(tex) : 'plain')
    const base = n
    for (let i = 2; used.has(n); i++) n = `${base}_${i}`
    used.add(n)
    return n
  })
  const files: Record<string, FileRef> = {}
  const textures: Record<string, string> = {}, alpha: Record<string, boolean> = {}, surface_ids: Record<string, number> = {}
  for (const [i, m] of matNames.entries()) {
    const t = r.textures[i] ?? plain()
    const file = m + tag + '.png'
    const s = await storeFile(await rgbaPng(t, file), file, 'game')
    files[s.vpath] = s.ref
    textures[m] = s.vpath
    alpha[m] = t.alpha
    surface_ids[m] = surfaceOf(r.mesh.materials[i])
  }
  const text = objText(r, ws, matNames, name)
  const obj = await storeFile(new Blob([text], { type: 'model/obj' }), safe(name) + tag + '.obj', 'game')
  files[obj.vpath] = obj.ref
  // Every file here is game data, whatever storeFile guessed from its bytes.
  for (const ref of Object.values(files)) ref.origin = 'game'
  const { cacheModel } = await import('../assets')
  cacheModel(obj.vpath, parseObj(text))
  return { path: obj.vpath, files, textures, alpha, surface_ids, triangles: r.mesh.triangles.length / 3 }
}

const made = new Map<string, Promise<StoredObject>>()

/** The stored files for a library entry at a world scale (made once per tab). */
export function objectFiles(e: Pick<GameObjectEntry, 'id' | 'name' | 'pack' | 'chunk' | 'record' | 'parts'>, ws: number): Promise<StoredObject> {
  const k = e.id + '@' + ws
  let p = made.get(k)
  if (!p) {
    p = getObject(e, PLACE_TEX).then((r) => storeObject(r, e.name, ws))
    made.set(k, p)
    p.catch(() => made.delete(k))
  }
  return p
}

/** A scene item for a library entry, standing at `at`, turned `rot` degrees. */
export async function gameObjectItem(e: GameObjectEntry, at: [number, number, number], rot: number, ws: number): Promise<{ item: SceneItem; files: Record<string, FileRef> }> {
  const s = await objectFiles(e, ws)
  const game_object: GameObjectRef = { source: 'game', pack: e.pack, chunk: e.chunk, record: e.record, ...(e.parts ? { parts: e.parts } : {}), id: e.id, ws }
  const item: SceneItem = {
    uid: crypto.randomUUID(), name: e.name, path: s.path, source_path: s.path,
    position: at, rotation: [0, rot, 0], scale: 1,
    textures: { ...s.textures }, alpha: { ...s.alpha }, surface_ids: { ...s.surface_ids }, physics_intent: 'Static',
    triangles: s.triangles, game_object,
  }
  return { item, files: s.files }
}

/** Placed game objects whose files aren't in this browser (a backup or cloud save from elsewhere). */
export async function missingGameObjects(p: Project, has: (hash: string) => Promise<boolean>): Promise<number[]> {
  const out: number[] = []
  for (const [i, it] of p.scene_items.entries()) {
    if (!gameRefOf(it)) continue
    const ref = p.files[it.path]
    if (!ref || !(await has(ref.hash))) out.push(i)
  }
  return out
}

/**
 * Rebuilds a placed game object's files from this player's own game, keeping the item's place and any
 * textures the user painted on it (a painted material keeps its file; the game's own come back).
 */
export async function rebuildItem(it: SceneItem, have: Record<string, FileRef>): Promise<{ patch: Partial<SceneItem>; files: Record<string, FileRef> }> {
  const g = gameRefOf(it)
  if (!g) throw new Error(it.name + ' is not from the game')
  const s = await getObject(g, PLACE_TEX).then((r) => storeObject(r, it.name, g.ws, '_' + Date.now().toString(36)))
  const textures = { ...s.textures }
  const alpha = { ...s.alpha }
  for (const [m, v] of Object.entries(it.textures || {})) {
    if (m in textures && have[v]?.origin === 'user') { textures[m] = v; alpha[m] = !!it.alpha?.[m] }
  }
  return { patch: { path: s.path, source_path: s.path, textures, alpha }, files: s.files }
}
