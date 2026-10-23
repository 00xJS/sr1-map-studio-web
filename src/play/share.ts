// Play links: what a shared map holds and the rules it must pass. Shared by
// the browser and the Netlify share function (pure: no DOM, IndexedDB or Node APIs).
//
// A share carries no files. Models travel as plain OBJ geometry (numbers only:
// comments, names of material libraries and any other text are dropped), and
// textures as recipes (generator settings or a starter-library id) that the
// viewer's browser remakes. So nothing uploaded by a user, and nothing from
// Saints Row, can ride along: there are no image bytes in a share at all.
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate'
import { gameSignature, MB } from '../lib/hubRules'
import { isDataPackPath, normalizeProject, type Project } from '../lib/project'
import { LIBRARY_ID, cleanRecipe, fromLegacy, textureRecipeProblem, type TextureRecipe } from '../lib/recipes'

export interface ShareDoc {
  format: 'sr1-map-studio-share'
  version: 1
  title: string
  created_at: string
  /** The map with no files and no settings that point at files. Paths are keys into models and textures. */
  project: Project
  /** OBJ geometry by path. */
  models: Record<string, string>
  textures: Record<string, TextureRecipe>
}

export const SHARE_LIMITS = {
  /** All the OBJ text together. */
  modelChars: 40 * MB,
  /** The map's JSON without the models. */
  projectChars: 3 * MB,
  /** The gzip a hosted share stores. */
  packedBytes: 8 * MB,
  items: 4000,
  markers: 3000,
  lights: 500,
  textures: 2000,
  textureSize: 2048,
}

// ---------------- OBJ geometry ----------------

const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?'
const IDX = '-?\\d+(?:/-?\\d*)?(?:/-?\\d+)?'
const NAME = '[^\\x00-\\x1f\\x7f]{1,64}'
const OBJ_RULES: Record<string, RegExp> = {
  v: new RegExp(`^v(?: ${NUM}){3,6}$`),
  vt: new RegExp(`^vt(?: ${NUM}){1,3}$`),
  vn: new RegExp(`^vn(?: ${NUM}){3}$`),
  f: new RegExp(`^f(?: ${IDX}){3,64}$`),
  l: new RegExp(`^l(?: ${IDX}){2,64}$`),
  o: new RegExp(`^o ${NAME}$`),
  g: new RegExp(`^g ${NAME}$`),
  usemtl: new RegExp(`^usemtl ${NAME}$`),
  s: /^s (?:\d{1,6}|on|off)$/,
}

/**
 * Geometry only: keeps vertex, face, group and material lines (whitespace
 * normalised) and drops comments, mtllib and anything else. Returns null when
 * a kept line is malformed or nothing is left.
 */
export function cleanObj(text: string): string | null {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/\s+/g, ' ')
    if (!line || line.startsWith('#')) continue
    const key = line.split(' ', 1)[0]
    const rule = OBJ_RULES[key]
    if (!rule) continue // mtllib, vp, curves...: not needed to draw or walk the map
    if (!rule.test(line)) return null
    out.push(line)
  }
  return out.some((l) => l.startsWith('f ')) ? out.join('\n') + '\n' : null
}

/** True when every line is a geometry line cleanObj would keep as it is. */
export function isCleanObj(text: string): boolean {
  if (!text.endsWith('\n')) return false
  const lines = text.slice(0, -1).split('\n')
  return lines.some((l) => l.startsWith('f ')) && lines.every((l) => OBJ_RULES[l.split(' ', 1)[0]]?.test(l) ?? false)
}

// ---------------- texture recipes ----------------

export { LIBRARY_ID }

/** Null for a good texture recipe (today's form or an early link's {gen} / {lib}); otherwise what is wrong. */
export const checkRecipe = (r: unknown): string | null => textureRecipeProblem(fromLegacy(r))

// ---------------- the whole share ----------------

/** Settings that point at files; a share clears them (the viewer uses its own sky and minimap). */
export const FILE_SETTINGS = ['sky_texture', 'minimap_texture', 'bbcity_donor', 'cts_template', 'loading_image', 'ambience'] as const

/** Every model and texture path an item uses. */
export function itemPaths(it: Project['scene_items'][number]): { models: string[]; textures: string[] } {
  const models = [it.path, it.native_mesh_obj].filter((p): p is string => typeof p === 'string' && !!p)
  const textures = [...Object.values(it.textures || {}), it.glass_custom_texture].filter((p): p is string => typeof p === 'string' && !!p)
  return { models: [...new Set(models)], textures: [...new Set(textures)] }
}

export function validateShareDoc(raw: unknown): { problems: string[]; doc: ShareDoc | null } {
  const problems: string[] = []
  const d = raw as ShareDoc
  if (!d || typeof d !== 'object' || d.format !== 'sr1-map-studio-share' || d.version !== 1) return { problems: ['This is not an SR1 Map Studio play link.'], doc: null }
  if (typeof d.title !== 'string' || !d.title.trim() || d.title.length > 80) problems.push('The title must be 1 to 80 characters.')
  if (!d.models || typeof d.models !== 'object' || !d.textures || typeof d.textures !== 'object') return { problems: [...problems, 'The share has no models or textures list.'], doc: null }
  let project: Project
  try { project = normalizeProject(JSON.parse(JSON.stringify(d.project))) } catch { return { problems: [...problems, 'The map in the share is not valid.'], doc: null } }
  if (Object.keys(project.files).length) problems.push('A share must not hold files.')
  if (project.asset_library.length) problems.push('A share must not hold a model library.')
  for (const k of FILE_SETTINGS) if (project.settings[k]) problems.push(`The map setting ${k} must be empty in a share.`)
  if (project.scene_items.length > SHARE_LIMITS.items) problems.push(`A share can hold at most ${SHARE_LIMITS.items} objects.`)
  if (project.markers.length > SHARE_LIMITS.markers) problems.push(`A share can hold at most ${SHARE_LIMITS.markers} markers.`)
  if (project.lights.length > SHARE_LIMITS.lights) problems.push(`A share can hold at most ${SHARE_LIMITS.lights} lights.`)
  if (JSON.stringify(project).length > SHARE_LIMITS.projectChars) problems.push('The map data is too large to share.')

  const usedModels = new Set<string>(), usedTextures = new Set<string>()
  for (const it of project.scene_items) {
    const { models, textures } = itemPaths(it)
    for (const m of models) {
      if (isDataPackPath(m)) continue
      if (!Object.hasOwn(d.models, m)) { problems.push(`Object "${String(it.name).slice(0, 60)}" uses a model the share doesn't hold.`); continue }
      usedModels.add(m)
    }
    for (const t of textures) {
      if (isDataPackPath(t)) continue
      if (!Object.hasOwn(d.textures, t)) { problems.push(`Object "${String(it.name).slice(0, 60)}" uses a texture the share doesn't hold.`); continue }
      usedTextures.add(t)
    }
  }
  let chars = 0
  for (const [path, text] of Object.entries(d.models)) {
    if (!usedModels.has(path)) { problems.push('The share holds a model no object uses.'); break }
    if (typeof text !== 'string') { problems.push('A model in the share is not text.'); continue }
    chars += text.length
    if (gameSignature(strToU8(text.slice(0, 4096)), path, text.slice(0, 4096))) problems.push('A model in the share looks like Saints Row game data.')
    else if (!isCleanObj(text)) problems.push('A model in the share is not plain OBJ geometry.')
  }
  if (chars > SHARE_LIMITS.modelChars) problems.push('The map\'s models are too large to share.')
  const textures = Object.entries(d.textures)
  if (textures.length > SHARE_LIMITS.textures) problems.push(`A share can hold at most ${SHARE_LIMITS.textures} textures.`)
  for (const [path, r] of textures) {
    if (!usedTextures.has(path)) { problems.push('The share holds a texture no object uses.'); break }
    const bad = checkRecipe(r)
    if (bad) { problems.push(`A texture in the share ${bad}.`); break }
  }
  const uniq = [...new Set(problems)]
  if (uniq.length) return { problems: uniq, doc: null }
  const clean = Object.fromEntries(textures.map(([k, r]) => [k, cleanRecipe(fromLegacy(r) as TextureRecipe)]))
  return { problems: uniq, doc: { ...d, title: d.title.trim(), project, textures: clean } }
}

// ---------------- packing ----------------

/** gzip of the share's JSON. */
export const packShare = (doc: ShareDoc): Uint8Array => gzipSync(strToU8(JSON.stringify(doc)), { level: 9 })

/** Reads a packed share, refusing anything that would unpack past the limits. */
export function unpackShare(bytes: Uint8Array): unknown {
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error('This is not an SR1 Map Studio play link.')
  if (bytes.length > SHARE_LIMITS.packedBytes) throw new Error('This shared map is too large.')
  // gzip ends with the unpacked size (mod 4 GB): check it before unpacking.
  const n = bytes.length, size = (bytes[n - 4] | (bytes[n - 3] << 8) | (bytes[n - 2] << 16) | (bytes[n - 1] << 24)) >>> 0
  if (size > SHARE_LIMITS.modelChars + SHARE_LIMITS.projectChars + MB) throw new Error('This shared map is too large.')
  return JSON.parse(strFromU8(gunzipSync(bytes)))
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** Unlisted link tokens: 128 random bits, base64url. */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{22}$/

export function newShareToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  return toBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
