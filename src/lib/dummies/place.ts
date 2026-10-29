// A decoy dummy in a map: one object, drawn as the posed character from the player's own game (an OBJ and PNGs
// stored in this browser as game files, origin 'game': never uploaded, synced, published or shared) or as the
// site's stand-in figure, with body boxes that are its only solid part (SceneItem.collision_materials).
//
// The item keeps its recipe (SceneItem.dummy: model, pose, look, world scale) and its stand-in's files (site
// recipes, shareable). Share links, the Showcase and the hub get the stand-in (asStandIn); a backup or a cloud save
// keeps the recipe, and whoever opens it builds the character again from their own game (rebuildDummy).
import { storeFile } from '../files'
import { tagRecipe } from '../recipes'
import type { FileRef, SceneItem, Vec3 } from '../project'
import { BODY_MAT, BOX_TRIANGLES, STAND_IN_MATS, bodyObj, bodySegments, standInObj } from './figure'
import { dummyName, lookOf, specKey, standInColours, type DummySpec } from './models'
import { MATERIAL_ALPHA, SURFACES, asStandIn, dummyRefOf, type DummyRef } from './standIn'
import type { BakedDummy } from './bake'
import type { Vpp } from '../sr1char/vpp'

export { asStandIn, dummyRefOf, isDummy, withStandIns, type DummyRef } from './standIn'

// ---------------- files ----------------

async function generatedTexture(color: string, name: string, invisible = false) {
  const [{ defaultParams }, { generatedPng }] = await Promise.all([import('../procedural'), import('../texgen')])
  const size = invisible ? 16 : 32
  const params = invisible ? { ...defaultParams('invisible', size), seed: 1 } : { ...defaultParams('paint', size), color, accent: color, wear: 0, seed: 1 }
  return storeFile(tagRecipe(await generatedPng(params, name), { kind: 'generated', params }), name)
}

export interface StoredDummy { path: string; textures: Record<string, string>; alpha: Record<string, boolean>; triangles: number; files: Record<string, FileRef> }

/** The stand-in's OBJ and pictures (site recipes), for a dummy's look and pose. */
export async function standInFiles(spec: DummySpec, ws: number): Promise<StoredDummy> {
  const text = standInObj(spec.pose, ws)
  const obj = await storeFile(tagRecipe(new Blob([text], { type: 'model/obj' }), { kind: 'figure', pose: spec.pose, ws }), `dummy_${spec.pose}.obj`)
  const colours = standInColours(spec)
  const files: Record<string, FileRef> = { [obj.vpath]: obj.ref }
  const textures: Record<string, string> = {}
  for (const [part, mat] of Object.entries(STAND_IN_MATS) as [keyof typeof STAND_IN_MATS, string][]) {
    const t = await generatedTexture(colours[part], `${mat}_${colours[part].slice(1)}.png`)
    files[t.vpath] = t.ref
    textures[mat] = t.vpath
  }
  const body = await generatedTexture('#000000', 'invisible.png', true)
  files[body.vpath] = body.ref
  textures[BODY_MAT] = body.vpath
  const { cacheModel } = await import('../assets')
  const { parseObj } = await import('../geometry')
  cacheModel(obj.vpath, parseObj(text))
  return { path: obj.vpath, textures, alpha: Object.fromEntries(Object.keys(textures).map((m) => [m, MATERIAL_ALPHA(m)])), triangles: text.split('\nf ').length - 1, files }
}

/** The baked character as an OBJ in editor units (metres / world scale), then its body boxes. */
export function dummyObjText(b: BakedDummy, ws: number, title: string): string {
  const f = (v: number) => +v.toFixed(5)
  const n = b.positions.length / 3
  const lines = ['# ' + title + ', from your own Saints Row game files (kept on this device)']
  for (let i = 0; i < n; i++) lines.push(`v ${f(b.positions[3 * i] / ws)} ${f(b.positions[3 * i + 1] / ws)} ${f(b.positions[3 * i + 2] / ws)}`)
  for (let i = 0; i < n; i++) lines.push(`vt ${f(b.uvs[2 * i])} ${f(b.uvs[2 * i + 1])}`)
  for (let i = 0; i < n; i++) lines.push(`vn ${f(b.normals[3 * i])} ${f(b.normals[3 * i + 1])} ${f(b.normals[3 * i + 2])}`)
  const byMat = new Map<number, number[]>()
  for (let t = 0; t < b.triMaterial.length; t++) { const m = b.triMaterial[t]; const l = byMat.get(m); if (l) l.push(t); else byMat.set(m, [t]) }
  for (const [m, list] of [...byMat].sort((x, y) => x[0] - y[0])) {
    lines.push('usemtl ' + b.materials[m].name)
    for (const t of list) {
      const [a, c, d] = [0, 1, 2].map((k) => b.triangles[3 * t + k] + 1)
      lines.push(`f ${a}/${a}/${a} ${c}/${c}/${c} ${d}/${d}/${d}`)
    }
  }
  return lines.join('\n') + '\n' + bodyObj(b.joints, ws, { v: n + 1, vt: n + 1, vn: n + 1 }).text
}

async function pngOf(p: BakedDummy['materials'][number]['picture'], name: string): Promise<File> {
  const { rgbaPng } = await import('../gameObjects/place')
  return rgbaPng({ width: p.width, height: p.height, rgba: p.rgba.slice().buffer }, name)
}

/** Bakes the character from the packfiles and stores it as game files (with the body boxes' site texture). */
export async function gameFiles(packs: Vpp[], spec: DummySpec, ws: number, tag = ''): Promise<StoredDummy & { summary: string }> {
  const { bakeDummy } = await import('./bake')
  const b = await bakeDummy(packs, spec)
  const files: Record<string, FileRef> = {}
  const textures: Record<string, string> = {}, alpha: Record<string, boolean> = {}
  for (const m of b.materials) {
    const name = m.name + tag + '.png'
    const s = await storeFile(await pngOf(m.picture, name), name, 'game')
    s.ref.origin = 'game'
    files[s.vpath] = s.ref
    textures[m.name] = s.vpath
    alpha[m.name] = m.picture.alpha
  }
  const text = dummyObjText(b, ws, dummyName(spec))
  const obj = await storeFile(new Blob([text], { type: 'model/obj' }), `dummy_${spec.model.replace(/[^A-Za-z0-9]+/g, '_')}_${spec.pose}${tag}.obj`, 'game')
  obj.ref.origin = 'game'
  files[obj.vpath] = obj.ref
  const body = await generatedTexture('#000000', 'invisible.png', true)
  files[body.vpath] = body.ref
  textures[BODY_MAT] = body.vpath
  alpha[BODY_MAT] = true
  const { cacheModel } = await import('../assets')
  const { parseObj } = await import('../geometry')
  cacheModel(obj.vpath, parseObj(text))
  return { path: obj.vpath, textures, alpha, triangles: b.triangles.length / 3 + BOX_TRIANGLES * bodySegments(b.joints).length, files, summary: b.summary }
}

// Files made this tab, by look, pose and world scale (copies of one dummy share them).
const made = new Map<string, Promise<StoredDummy & { summary?: string }>>()
const once = (key: string, make: () => Promise<StoredDummy & { summary?: string }>) => {
  let p = made.get(key)
  if (!p) { p = make(); made.set(key, p); p.catch(() => made.delete(key)) }
  return p
}

/**
 * A dummy's object, standing at `at` turned `rot` degrees: the character from `packs` (the player's packfiles), or
 * the stand-in when there are none.
 */
export async function dummyItem(spec: DummySpec, at: Vec3, rot: number, ws: number, packs: Vpp[] | null, uid: string): Promise<{ item: SceneItem; files: Record<string, FileRef>; summary?: string }> {
  const s = { ...spec, look: lookOf(spec.model, spec.look) }
  const key = specKey(s) + '@' + ws
  const stand = await once('s' + key, () => standInFiles(s, ws))
  const ref: DummyRef = { source: 'dummy', ...s, ws, built: false, stand_in: { path: stand.path, textures: stand.textures } }
  const base: SceneItem = {
    uid, name: dummyName(s), path: stand.path, source_path: stand.path, position: at, rotation: [0, rot, 0], scale: 1,
    textures: {}, alpha: {}, physics_intent: 'Static', triangles: stand.triangles, dummy: ref,
  }
  if (!packs) return { item: asStandIn(base), files: { ...stand.files } }
  const g = await once('g' + key, () => gameFiles(packs, s, ws))
  const item: SceneItem = {
    ...base, path: g.path, source_path: g.path, textures: g.textures, alpha: g.alpha, surface_ids: SURFACES(Object.keys(g.textures)),
    collision_materials: [BODY_MAT], triangles: g.triangles, dummy: { ...ref, built: true },
  }
  return { item, files: { ...stand.files, ...g.files }, summary: g.summary }
}

/** A placed dummy made again (another look, pose or world scale, or its game files missing here), keeping its place. */
export async function rebuildDummy(it: SceneItem, spec: DummySpec, ws: number, packs: Vpp[] | null) {
  const r = await dummyItem(spec, it.position, it.rotation[1], ws, packs, it.uid)
  const keep: Partial<SceneItem> = { position: it.position, rotation: it.rotation, scale: it.scale, ...(it.layer ? { layer: it.layer } : {}), ...(it.group ? { group: it.group } : {}) }
  return { item: { ...r.item, ...keep, name: it.name === dummyName(dummyRefOf(it) ?? spec) ? r.item.name : it.name }, files: r.files, summary: r.summary }
}
