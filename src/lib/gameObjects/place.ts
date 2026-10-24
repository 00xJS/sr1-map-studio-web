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
import type { ObjectResult, ObjectTexture } from './worker'
import type { ObjectMesh } from './extract'
import { lookTextures, lookUvSets } from './material'
import { encodeLook, mapLookTextures, type GameLookRef, type StoredLook } from './lookFile'

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

export const stemOf = (tex: string) => tex.replace(/\.[^.]+$/, '')
export const safe = (s: string) => s.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'mat'

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

export async function rgbaPng(t: { width: number; height: number; rgba: ArrayBuffer }, name: string): Promise<File> {
  const c = new OffscreenCanvas(t.width, t.height)
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(t.rgba), t.width, t.height), 0, 0)
  return new File([await c.convertToBlob({ type: 'image/png' })], name, { type: 'image/png' })
}

/** A plain stand-in for a material whose picture couldn't be read (the exporter needs one per material). */
export const plain = () => ({ width: 8, height: 8, rgba: new Uint8Array(8 * 8 * 4).fill(150).buffer, alpha: false })

export interface StoredObject {
  path: string
  files: Record<string, FileRef>
  textures: Record<string, string>
  alpha: Record<string, boolean>
  surface_ids: Record<string, number>
  triangles: number
  /** How the game draws its materials (absent: every material is one picture). */
  look?: GameLookRef
}

/**
 * Stores the layer pictures (decals, masks, normal and specular maps) the given materials' looks use, each once
 * (`have` remembers lower-cased texture name -> stored path across calls), as game files.
 */
export async function storeLayers(mesh: ObjectMesh, mats: number[], layers: Record<string, ObjectTexture | null> | undefined, tag: string, files: Record<string, FileRef>, have: Map<string, string | null>) {
  // A material's own picture is its OBJ texture already; only the others are stored here.
  const own = (i: number, t: string) => t.toLowerCase() === mesh.materials[i].toLowerCase()
  for (const tex of new Set(mats.flatMap((i) => lookTextures(mesh.looks?.[i] ?? null).filter((t) => !own(i, t))))) {
    const k = tex.toLowerCase()
    if (have.has(k)) continue
    const t = layers?.[k]
    if (!t) { have.set(k, null); continue }
    const name = safe(stemOf(tex)) + (/\.tgn$/i.test(tex) ? '_nm' : '') + tag + '.png'
    const s = await storeFile(await rgbaPng(t, name), name, 'game')
    s.ref.origin = 'game'
    files[s.vpath] = s.ref
    have.set(k, s.vpath)
  }
}

/**
 * The look file of a mesh written as an OBJ with `matNames` (objText): per material its look with stored paths,
 * and the vertex data the OBJ can't hold (UV sets 1-3, stored normals mirrored into editor space). Null when no
 * material has more than one picture to draw.
 */
export async function storeLook(mesh: ObjectMesh, matNames: string[], diffuse: string[], layerPath: (tex: string) => string | null, name: string, files: Record<string, FileRef>): Promise<GameLookRef | null> {
  const mats: Record<string, StoredLook> = {}
  const used = new Set<string>()
  let sets = 0
  mesh.materials.forEach((_, i) => {
    const l = mesh.looks?.[i]
    if (!l) return
    const own = mesh.materials[i].toLowerCase()
    // The material's own picture (the OBJ material's texture) is the diffuse path; other pictures are layer files.
    const look = mapLookTextures(l, (t) => (own && t.toLowerCase() === own ? diffuse[i] : layerPath(t)))
    mats[matNames[i]] = { diffuse: diffuse[i], look }
    for (const t of lookTextures(look)) if (t !== diffuse[i]) used.add(t)
    sets = Math.max(sets, lookUvSets(look))
  })
  if (!Object.keys(mats).length) return null
  const n = mesh.positions.length / 3
  const uvs = Array.from({ length: sets }, (_, k) => mesh.extraUvs?.[k] ?? new Float32Array(2 * n))
  let normals: Float32Array | undefined
  if (mesh.normals) {
    normals = new Float32Array(mesh.normals.length)
    // The OBJ mirrors X (editor space); so do the normals.
    for (let i = 0; i < n; i++) { normals[3 * i] = -mesh.normals[3 * i]; normals[3 * i + 1] = mesh.normals[3 * i + 1]; normals[3 * i + 2] = mesh.normals[3 * i + 2] }
  }
  const bytes = encodeLook({ mats, vertices: n, uvs, normals })
  const f = await storeFile(new Blob([bytes], { type: 'application/octet-stream' }), safe(name) + '.look', 'game')
  f.ref.origin = 'game'
  files[f.vpath] = f.ref
  return { path: f.vpath, layers: [...used] }
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
  // The game's layers (decals, masks, normal and specular maps) and the vertex data they need, beside the OBJ.
  const have = new Map<string, string | null>()
  await storeLayers(r.mesh, r.mesh.materials.map((_, i) => i), r.layers, tag, files, have)
  const look = await storeLook(r.mesh, matNames, matNames.map((m) => textures[m]), (t) => have.get(t.toLowerCase()) ?? null, name + tag, files)
  // Every file here is game data, whatever storeFile guessed from its bytes.
  for (const ref of Object.values(files)) ref.origin = 'game'
  const { cacheModel } = await import('../assets')
  cacheModel(obj.vpath, parseObj(text))
  return { path: obj.vpath, files, textures, alpha, surface_ids, triangles: r.mesh.triangles.length / 3, ...(look ? { look } : {}) }
}

const made = new Map<string, Promise<StoredObject>>()

/** The stored files for a library entry at a world scale (made once per tab). */
export function objectFiles(e: Pick<GameObjectEntry, 'id' | 'name' | 'pack' | 'chunk' | 'record' | 'parts'>, ws: number): Promise<StoredObject> {
  const k = e.id + '@' + ws
  let p = made.get(k)
  if (!p) {
    p = getObject(e, PLACE_TEX, false, true).then((r) => storeObject(r, e.name, ws))
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
    triangles: s.triangles, game_object, ...(s.look ? { game_look: s.look } : {}),
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
  const s = await getObject(g, PLACE_TEX, false, true).then((r) => storeObject(r, it.name, g.ws, '_' + Date.now().toString(36)))
  const textures = { ...s.textures }
  const alpha = { ...s.alpha }
  for (const [m, v] of Object.entries(it.textures || {})) {
    if (m in textures && have[v]?.origin === 'user') { textures[m] = v; alpha[m] = !!it.alpha?.[m] }
  }
  return { patch: { path: s.path, source_path: s.path, textures, alpha, game_look: s.look }, files: s.files }
}
