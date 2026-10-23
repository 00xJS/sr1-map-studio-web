// Turns a project into a play-link share (see share.ts): plain OBJ geometry,
// texture recipes, and nothing else. Textures the site didn't make (your own
// pictures) and files from the game block the share, or are swapped out when
// the user chooses to.
import { db, sha256 } from '../lib/db'
import { gameSignature } from '../lib/hubRules'
import { KINDS, defaultParams, generate, type GenParams, type TextureKind } from '../lib/procedural'
import { baseName, isDataPackPath, uid, type FileRef, type Project, type SceneItem } from '../lib/project'
import type { TextureRecipe } from '../lib/recipes'
import { FILE_SETTINGS, cleanObj, itemPaths, type ShareDoc } from './share'

export type IssueKind = 'texture' | 'game' | 'missing' | 'model'

export interface ShareIssue {
  kind: IssueKind
  /** File name, for the list. */
  file: string
  /** Objects that use it. */
  users: string[]
}

export interface SharePlan {
  doc: ShareDoc
  /** Problems found. `doc` already works around them (objects left out, textures swapped); share it only if the user agrees. */
  issues: ShareIssue[]
  /** Objects left out (strip: their model can't be shared). */
  dropped: number
  /** Textures swapped for a plain stand-in (strip). */
  swapped: number
  /** Objects drawn from the data pack: viewers see them only if they have one. */
  dataPack: number
}

/** What a swapped-out texture becomes: plain concrete, made from scratch. */
export const STAND_IN: TextureRecipe = { gen: { ...defaultParams('concrete', 256), wear: 0.15, seed: 7 } }
const STAND_IN_KEY = 'tex/stand-in'

const ISSUE_TEXT: Record<IssueKind, string> = {
  texture: 'is a picture that wasn’t made on this site',
  game: 'comes from your Saints Row game files',
  missing: 'is missing from this project',
  model: 'isn’t a model that can be shared',
}
export const issueText = (i: ShareIssue) => `${i.file} ${ISSUE_TEXT[i.kind]} (used by ${i.users.length > 3 ? `${i.users.slice(0, 3).join(', ')} and ${i.users.length - 3} more` : i.users.join(', ')}).`

// ---------------- where a texture came from ----------------

let libraryIds: Promise<Set<string>> | null = null
const loadLibraryIds = () => (libraryIds ??= fetch('/textures/index.json').then((r) => r.ok ? r.json() : { textures: [] })
  .then((d: { textures: { id: string }[] }) => new Set(d.textures.map((t) => t.id))).catch(() => new Set<string>()))

const libraryHashes = new Map<string, Promise<string | null>>()
const libraryHash = (id: string) => {
  let p = libraryHashes.get(id)
  if (!p) {
    p = fetch(`/textures/${id}.jpg`).then((r) => r.ok ? r.blob().then(sha256) : null).catch(() => null)
    libraryHashes.set(id, p)
  }
  return p
}

/** Generator settings used by the sample maps and prefabs, by "kind:seed" (to recognise textures made before recipes were recorded). */
let tweakIndex: Promise<Map<string, GenParams[]>> | null = null
function knownTweaks(): Promise<Map<string, GenParams[]>> {
  tweakIndex ??= (async () => {
    const [{ SAMPLES }, { ALL_PREFABS }, { prefabParams }] = await Promise.all([import('../lib/samples'), import('../lib/prefabRegistry'), import('../lib/prefabs')])
    const out = new Map<string, GenParams[]>()
    const seen = new Set<string>()
    const add = (t: { gen?: TextureKind; tweak?: Partial<GenParams> }) => {
      if (!t.gen) return
      const k = JSON.stringify([t.gen, t.tweak ?? {}])
      if (seen.has(k)) return
      seen.add(k)
      const p = { ...defaultParams(t.gen), ...t.tweak }
      const key = `${t.gen}:${p.seed}`
      out.set(key, [...(out.get(key) ?? []), p])
    }
    // The samples as drawn (building them in full takes minutes); the prefabs they get dressed with are below.
    for (const s of SAMPLES) for (const part of s.parts) { add(part.top as never); add(part.side as never) }
    for (const def of Object.values(ALL_PREFABS)) {
      try { for (const part of def.make(0, 0, 0, 0, prefabParams(def, {}))) { add(part.top as never); add(part.side as never) } } catch { /* skip */ }
    }
    return out
  })()
  return tweakIndex
}

async function pixelsOf(blob: Blob): Promise<{ w: number; h: number; px: Uint8ClampedArray } | null> {
  try {
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const g = c.getContext('2d')!
    g.drawImage(bmp, 0, 0)
    bmp.close()
    return { w: c.width, h: c.height, px: g.getImageData(0, 0, c.width, c.height).data }
  } catch { return null }
}

/** Close enough at a spread of sample points (PNG is lossless; this allows for browser rounding). */
function samePixels(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false
  const stride = Math.max(1, Math.floor(a.length / 4 / 3000)) * 4
  for (let i = 0; i < a.length; i += stride) {
    for (let c = 0; c < 3; c++) if (Math.abs(a[i + c] - b[i + c]) > 3) return false
  }
  return true
}

const GEN_NAME = /^([a-z_]+?)_(\d+)(?:_(\d+))?\.png$/
const BLOCKOUT: Record<string, [TextureKind, number]> = { 'blockout_top.png': ['concrete', 1], 'blockout_side.png': ['brick', 1] }

/** The recipe for a texture the site made, or null for anything else (a photo, a download, an imported model's image). */
export async function recipeFor(ref: FileRef): Promise<TextureRecipe | null> {
  if (ref.origin !== 'user') return null
  if (ref.recipe) return ref.recipe
  // Made before recipes were recorded: recognise it by name and check the content matches.
  const lib = /^([a-z0-9_]+)\.jpg$/.exec(ref.name)
  if (lib && (await loadLibraryIds()).has(lib[1])) return (await libraryHash(lib[1])) === ref.hash ? { lib: lib[1] } : null
  const m = GEN_NAME.exec(ref.name)
  const named = BLOCKOUT[ref.name] ?? (m && Object.hasOwn(KINDS, m[1]) ? [m[1] as TextureKind, Number(m[2])] as const : null)
  if (!named) return null
  const blob = await db.getBlob(ref.hash)
  const img = blob && await pixelsOf(blob)
  if (!img || img.w !== img.h) return null
  const [kind, seed] = named
  const candidates = [{ ...defaultParams(kind), seed }, ...((await knownTweaks()).get(`${kind}:${seed}`) ?? [])]
  for (const c of candidates) {
    const p = { ...c, size: img.w }
    if (samePixels(generate(p), img.px)) return { gen: p }
  }
  return null
}

// ---------------- the share ----------------

/** Item fields that hold file paths and have no use in a play link. */
const DROP_FIELDS = ['source_path', 'original_import_path', 'asset_ref', 'prefab'] as const

export async function planShare(project: Project, opts: { title: string; onProgress?: (t: string) => void }): Promise<SharePlan> {
  const issues = new Map<string, ShareIssue>()
  const users = new Map<string, string[]>()
  const items = project.scene_items
  for (const it of items) {
    const { models, textures } = itemPaths(it)
    for (const p of [...models, ...textures]) users.set(p, [...new Set([...(users.get(p) ?? []), `"${it.name || 'unnamed'}"`])])
  }
  const flag = (path: string, kind: IssueKind) => issues.set(path, { kind, file: project.files[path]?.name ?? baseName(path), users: users.get(path) ?? [] })

  // Models: plain OBJ geometry from files that aren't game data.
  const models = new Map<string, string>() // path -> cleaned OBJ
  const modelPaths = [...new Set(items.flatMap((it) => itemPaths(it).models))].filter((p) => !isDataPackPath(p))
  for (const [i, path] of modelPaths.entries()) {
    if (i % 25 === 0) opts.onProgress?.(`Checking models (${i + 1}/${modelPaths.length})…`)
    const ref = project.files[path]
    if (!ref) { flag(path, 'missing'); continue }
    if (ref.origin !== 'user') { flag(path, 'game'); continue }
    const blob = await db.getBlob(ref.hash)
    if (!blob) { flag(path, 'missing'); continue }
    const text = await blob.text()
    if (gameSignature(new Uint8Array(await blob.slice(0, 4096).arrayBuffer()), ref.name, text.slice(0, 4096))) { flag(path, 'game'); continue }
    const obj = cleanObj(text)
    if (!obj) { flag(path, 'model'); continue }
    models.set(path, obj)
  }

  // Textures: only ones the site can make again from a recipe.
  const recipes = new Map<string, TextureRecipe>()
  const texPaths = [...new Set(items.flatMap((it) => itemPaths(it).textures))].filter((p) => !isDataPackPath(p))
  for (const [i, path] of texPaths.entries()) {
    if (i % 10 === 0) opts.onProgress?.(`Checking textures (${i + 1}/${texPaths.length})…`)
    const ref = project.files[path]
    if (!ref) { flag(path, 'missing'); continue }
    if (ref.origin !== 'user') { flag(path, 'game'); continue }
    const r = await recipeFor(ref)
    if (r) recipes.set(path, r)
    else flag(path, 'texture')
  }

  // Neutral keys: the share never shows the user's file names or hashes.
  const modelKey = new Map([...models.keys()].map((p, i) => [p, `mesh/${i}`]))
  const texKey = new Map([...recipes.keys()].map((p, i) => [p, `tex/${i}`]))
  let dropped = 0, dataPack = 0
  const swapped = new Set<string>()
  const outItems: SceneItem[] = []
  for (const it of items) {
    const { models: ms } = itemPaths(it)
    if (ms.some((m) => !isDataPackPath(m) && !modelKey.has(m))) { dropped++; continue }
    if ([...ms, ...itemPaths(it).textures].some(isDataPackPath)) dataPack++
    const copy: SceneItem = JSON.parse(JSON.stringify(it))
    for (const f of DROP_FIELDS) delete copy[f]
    const tex = (p: string) => isDataPackPath(p) ? p : texKey.get(p) ?? (swapped.add(p), STAND_IN_KEY)
    copy.path = isDataPackPath(it.path) ? it.path : modelKey.get(it.path)!
    if (it.native_mesh_obj) copy.native_mesh_obj = isDataPackPath(it.native_mesh_obj) ? it.native_mesh_obj : modelKey.get(it.native_mesh_obj)!
    copy.textures = Object.fromEntries(Object.entries(it.textures || {}).map(([m, p]) => [m, p ? tex(p) : '']))
    if (it.glass_custom_texture) copy.glass_custom_texture = tex(it.glass_custom_texture)
    // Anything else that still points at a stored file goes.
    for (const [k, v] of Object.entries(copy)) if (typeof v === 'string' && v.startsWith('/work/')) delete copy[k]
    outItems.push(copy)
  }

  const settings = { ...project.settings }
  for (const k of FILE_SETTINGS) (settings as Record<string, unknown>)[k] = ''
  delete settings.minimap_rect
  const shared: Project = {
    format: 'sr1-map-studio-web', version: 1, id: uid(), name: project.name, description: '',
    created_at: project.created_at, updated_at: project.updated_at, settings,
    scene_items: outItems, asset_library: [], markers: JSON.parse(JSON.stringify(project.markers)), lights: JSON.parse(JSON.stringify(project.lights)), files: {},
  }
  const doc: ShareDoc = {
    format: 'sr1-map-studio-share', version: 1, title: opts.title.trim().slice(0, 80) || project.name.slice(0, 80) || 'Shared map', created_at: new Date().toISOString(),
    project: shared,
    models: Object.fromEntries([...modelKey].map(([p, k]) => [k, models.get(p)!])),
    textures: Object.fromEntries([...texKey].map(([p, k]) => [k, recipes.get(p)!])),
  }
  if (swapped.size) doc.textures[STAND_IN_KEY] = STAND_IN
  // Only what the kept objects still use.
  const live = new Set(outItems.flatMap((it) => { const x = itemPaths(it); return [...x.models, ...x.textures] }))
  for (const k of Object.keys(doc.models)) if (!live.has(k)) delete doc.models[k]
  for (const k of Object.keys(doc.textures)) if (!live.has(k)) delete doc.textures[k]
  return { doc, issues: [...issues.values()], dropped, swapped: swapped.size, dataPack }
}
