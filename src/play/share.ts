// Play links: what a shared map holds and the rules it must pass. Shared by
// the browser and the Netlify share function (pure: no DOM, IndexedDB or Node APIs).
//
// A share carries no files. Models travel as plain OBJ geometry (numbers only:
// comments, names of material libraries and any other text are dropped), and
// textures as recipes (generator settings or a starter-library id) that the
// viewer's browser remakes. So nothing uploaded by a user, and nothing from
// Saints Row, can ride along: there are no image bytes in a share at all.
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate'
import { isPose, standInObj, validFigureScale, type PoseId } from '../lib/dummies/figure'
import { gameSignature, MB } from '../lib/hubRules'
import { isDataPackPath, normalizeProject, type Project, type Vec3 } from '../lib/project'
import { LIBRARY_ID, cleanRecipe, fromLegacy, textureRecipeProblem, type TextureRecipe } from '../lib/recipes'
import type { CompoundPiece, Shape } from '../lib/shapes'
import { buildKeysOk, cleanProject } from './shareSchema'

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
  /** How each model was made, by model key. Links made before this was recorded have none (they count as imported). */
  made?: Record<string, MadeKind>
  /**
   * The settings each model the site made was built from, by model key. The share function rebuilds
   * them and lists the map in the gallery only if every one comes out as the model in the share
   * (src/play/shareBuilds.ts).
   */
  builds?: Record<string, ModelBuild>
}

/** What the site built a model from: a block-out shape, a compound of shapes, or a prefab and its settings. */
export type ModelBuild =
  | { kind: 'shape'; shape: Shape }
  | { kind: 'compound'; pieces: CompoundPiece[] }
  | { kind: 'prefab'; key: string; params: Record<string, number | string>; at: Vec3; rot: number }
  /** A decoy dummy's stand-in figure (lib/dummies/figure.ts): its pose and the world scale it was made at. */
  | { kind: 'figure'; pose: PoseId; ws: number }

/** A block-out shape, a compound of shapes, a prefab from the site's library, or a model someone imported. */
export type MadeKind = 'shape' | 'compound' | 'prefab' | 'figure' | 'import'
export const MADE_KINDS: readonly MadeKind[] = ['shape', 'compound', 'prefab', 'figure', 'import']

/**
 * The gallery shows only maps whose every model was made on the site: an
 * imported model travels as its full geometry, which may be someone else's work.
 */
export const galleryReady = (doc: Pick<ShareDoc, 'models' | 'made'>): boolean =>
  Object.keys(doc.models).every((k) => !!doc.made && Object.hasOwn(doc.made, k) && doc.made[k] !== 'import')

/** Anonymous links, rate limits and boards. The share function can override the numbers with environment variables. */
export const SHARE_RULES = {
  /** Days an anonymous link lasts. */
  anonDays: 30,
  /** Links a signed-in user can make or update a day (SHARE_MAX_PER_DAY). */
  perDay: 50,
  /** Links a signed-in user can keep (SHARE_MAX_PER_USER). */
  perUser: 200,
  /** Anonymous links one IP address can make a day (SHARE_ANON_PER_DAY). */
  anonPerDay: 10,
  /** Reports one IP address can send a day (SHARE_REPORTS_PER_DAY). */
  reportsPerDay: 20,
  /** Times one IP address can submit an hour (SHARE_TIMES_PER_HOUR). */
  timesPerHour: 60,
  /** Times kept per board. */
  boardKeep: 50,
  /** Times an anonymous link can be updated from one address a day (SHARE_ANON_UPDATES_PER_DAY). */
  anonUpdatesPerDay: 30,
  /**
   * Tries at making or updating a link per account, or per address without one, an hour (SHARE_ATTEMPTS_PER_HOUR):
   * counted before the share is read, failed ones included, since checking one is the costly part.
   */
  attemptsPerHour: 30,
}

export const SHARE_LIMITS = {
  /** All the OBJ text together. */
  modelChars: 16 * MB,
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

// A run of digits splits only one way (an optional fraction after it), so a long run followed by a bad
// character fails in linear time instead of trying every split.
const NUM = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?'
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
    if (raw.length > MAX_LINE && !raw.trimStart().startsWith('#')) return null
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

/** A material name a site-made piece may have (compound pieces, shareBuilds.ts). */
export const MATERIAL_NAME = /^[A-Za-z0-9_.-]{1,64}$/
/** Materials one model may use, and a whole share. */
export const MAX_MATERIALS = 256
export const MAX_SHARE_MATERIALS = 4096
/**
 * Triangles placed in all, each object counting its model's: what a board time's wall check builds (about 3 s for
 * a million on the server), and what a phone has to draw.
 */
export const MAX_PLACED_TRIANGLES = 1_000_000
/** Coordinates beyond this aren't a map's (editor units); a model with one isn't shared. */
const MAX_COORD = 1e7
const MAX_INDEX = 1e8
/** A number already as canonicalObj writes it: at most five decimals, no trailing zeros, no sign on zero. */
const CANON_NUM = /^-?(?:0|[1-9]\d{0,6})(?:\.\d{0,4}[1-9])?$/
const ANY_NUM = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/
/** No number or index a model needs is longer; anything longer is refused before any pattern is tried. */
const MAX_TOKEN = 32
/** Longer than any line cleanObj keeps (64 corners of three indices). */
const MAX_LINE = 4096
const INDEX = /^-?\d{1,9}$/
const NAME_OK = new RegExp(`^${NAME}$`)
const SMOOTH = /^(?:\d{1,6}|on|off)$/
/** Numbers each kind of line takes. */
const COUNTS: Record<string, [number, number]> = { v: [3, 6], vt: [1, 3], vn: [3, 3], f: [3, 64], l: [2, 64] }

/**
 * A model as a share stores it, in one pass over text that cleanObj made (null when a line isn't one it keeps,
 * or a number is out of range): vertices, normals, texture coordinates and faces with numbers written to five
 * decimals; every material renamed m0, m1… in the order the model first uses them (`renamed` gives the old
 * names); and no object, group or smoothing lines. So the text says nothing but the geometry. `materials` is how
 * many it uses (validateShareDoc caps them).
 */
export function canonicalObj(text: string): { obj: string; renamed: Map<string, string>; materials: number; triangles: number } | null {
  if (!text.endsWith('\n')) return null
  const renamed = new Map<string, string>()
  let materials = 0, triangles = 0, faces = false
  const out: string[] = []
  const num = (t: string) => {
    if (t.length > MAX_TOKEN) return null
    if (CANON_NUM.test(t) && t !== '-0') return t
    if (!ANY_NUM.test(t)) return null
    const x = Number(t)
    return Number.isFinite(x) && Math.abs(x) <= MAX_COORD ? String(+x.toFixed(5)) : null
  }
  const index = (t: string, first: boolean) => {
    if (t === '') return first ? null : ''
    if (t.length > 10 || !INDEX.test(t)) return null
    const i = Number(t)
    return i !== 0 && Math.abs(i) <= MAX_INDEX ? String(i) : null
  }
  for (let at = 0; at < text.length;) {
    const end = text.indexOf('\n', at)
    const line = text.slice(at, end)
    at = end + 1
    if (line.length > MAX_LINE) return null
    const cut = line.indexOf(' ')
    if (cut <= 0) return null
    const key = line.slice(0, cut), rest = line.slice(cut + 1)
    if (key === 'usemtl' || key === 'o' || key === 'g') {
      if (!NAME_OK.test(rest)) return null
      if (key !== 'usemtl') continue // names say nothing about the shape
      if (!renamed.has(rest)) renamed.set(rest, 'm' + materials++)
      out.push('usemtl ' + renamed.get(rest))
      continue
    }
    if (key === 's') { if (!SMOOTH.test(rest)) return null; continue }
    const count = COUNTS[key]
    if (!count) return null
    const toks = rest.split(' ')
    if (toks.length < count[0] || toks.length > count[1]) return null
    if (key === 'f' || key === 'l') {
      for (let i = 0; i < toks.length; i++) {
        const parts = toks[i].split('/')
        if (parts.length > 3) return null
        for (let j = 0; j < parts.length; j++) {
          const v = index(parts[j], j === 0)
          if (v === null) return null
          parts[j] = v
        }
        toks[i] = parts.join('/')
      }
      if (key === 'f') { faces = true; triangles += toks.length - 2 }
    } else {
      for (let i = 0; i < toks.length; i++) {
        const v = num(toks[i])
        if (v === null) return null
        toks[i] = v
      }
    }
    out.push(key + ' ' + toks.join(' '))
  }
  return faces ? { obj: out.join('\n') + '\n', renamed, materials, triangles } : null
}

/** True when every line is a geometry line cleanObj would keep as it is. */
export function isCleanObj(text: string): boolean {
  if (!text.endsWith('\n')) return false
  const lines = text.slice(0, -1).split('\n')
  return lines.some((l) => l.startsWith('f ')) && lines.every((l) => l.length <= MAX_LINE && (OBJ_RULES[l.split(' ', 1)[0]]?.test(l) ?? false))
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

/**
 * Checks a share and, when it passes, gives it back rebuilt from only the fields a share may hold
 * (shareSchema.ts): what a server stores is this doc, never what it was sent.
 */
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
  // From here on, only the fields a share may hold.
  project = cleanProject(project)
  for (const k of FILE_SETTINGS) if (project.settings[k]) problems.push(`The map setting ${k} must be empty in a share.`)
  if (project.scene_items.length > SHARE_LIMITS.items) problems.push(`A share can hold at most ${SHARE_LIMITS.items} objects.`)
  if (project.markers.length > SHARE_LIMITS.markers) problems.push(`A share can hold at most ${SHARE_LIMITS.markers} markers.`)
  if (project.lights.length > SHARE_LIMITS.lights) problems.push(`A share can hold at most ${SHARE_LIMITS.lights} lights.`)
  if (JSON.stringify(project).length > SHARE_LIMITS.projectChars) problems.push('The map data is too large to share.')

  const usedModels = new Set<string>()
  for (const it of project.scene_items) {
    for (const m of itemPaths(it).models) {
      if (isDataPackPath(m)) continue
      if (!Object.hasOwn(d.models, m)) { problems.push(`Object "${String(it.name).slice(0, 60)}" uses a model the share doesn't hold.`); continue }
      usedModels.add(m)
    }
  }
  let chars = 0
  const models = new Map<string, string>(), renames = new Map<string, Map<string, string>>(), triangles = new Map<string, number>()
  let materials = 0
  for (const [path, text] of Object.entries(d.models)) {
    if (!usedModels.has(path)) { problems.push('The share holds a model no object uses.'); break }
    if (typeof text !== 'string') { problems.push('A model in the share is not text.'); continue }
    chars += text.length
    if (chars > SHARE_LIMITS.modelChars) break
    const head = text.slice(0, 4096)
    if (gameSignature(strToU8(head), path, head)) { problems.push('A model in the share looks like Saints Row game data.'); continue }
    // Every line must be geometry, so nothing further down can be a game table either.
    const c = canonicalObj(text)
    if (!c) { problems.push('A model in the share is not plain OBJ geometry.'); continue }
    if (c.materials > MAX_MATERIALS) { problems.push(`A model in the share uses more than ${MAX_MATERIALS} materials.`); continue }
    materials += c.materials
    models.set(path, c.obj)
    renames.set(path, c.renamed)
    triangles.set(path, c.triangles)
  }
  if (materials > MAX_SHARE_MATERIALS) problems.push(`The share’s models use more than ${MAX_SHARE_MATERIALS.toLocaleString('en')} materials in all.`)
  if (chars > SHARE_LIMITS.modelChars) problems.push('The map\'s models are too large to share.')
  let placed = 0
  for (const it of project.scene_items) for (const m of itemPaths(it).models) placed += triangles.get(m) ?? 0
  if (placed > MAX_PLACED_TRIANGLES) problems.push(`The map places more than ${MAX_PLACED_TRIANGLES.toLocaleString('en')} triangles in all (each object counts its model’s).`)

  // Objects follow their models' renamed materials; settings for materials their model doesn't have go. Which
  // textures are used is worked out after that, so a texture only a dropped setting named goes too.
  for (const it of project.scene_items) {
    const own = renames.get(it.path), mesh = renames.get(it.native_mesh_obj ?? '')
    if (!own && !mesh) continue
    const r = new Map<string, string>([['(default)', '(default)'], ...(mesh ?? []), ...(own ?? [])])
    const keys = <T,>(o: Record<string, T> | undefined) => o && Object.fromEntries(Object.entries(o).filter(([k]) => r.has(k)).map(([k, v]) => [r.get(k)!, v]))
    it.textures = keys(it.textures)!
    it.alpha = keys(it.alpha)!
    if (it.glow) it.glow = keys(it.glow)
    if (it.surface_ids) it.surface_ids = keys(it.surface_ids)
    if (it.water_materials) it.water_materials = it.water_materials.filter((m) => r.has(m)).map((m) => r.get(m)!)
    if (it.collision_materials) it.collision_materials = it.collision_materials.filter((m) => r.has(m)).map((m) => r.get(m)!)
  }
  // A dummy is drawn as its stand-in figure: its object's own model must be exactly the figure its pose and scale
  // make, with the object's (renamed) pictures. Anything else isn't a dummy here (the setting goes, the object
  // stays), so no other model can pass as one.
  // Making a figure takes ~30 ms: a map's dummies share its scale and a few poses, so a share gets this many.
  const kinds = new Set<string>()
  for (const it of project.scene_items) {
    const dm = it.dummy as { pose?: unknown; ws?: unknown; stand_in?: { path: string; textures: Record<string, string> } } | undefined
    if (!dm) continue
    const key = `${dm.pose}:${dm.ws}`
    // Once the share has that many, only a new kind is turned away: more dummies of a kind already seen are fine.
    const ok = isPose(dm.pose) && validFigureScale(dm.ws) && (kinds.has(key) || kinds.size < MAX_FIGURE_KINDS)
    if (ok) kinds.add(key)
    const figure = ok ? standInText(dm.pose as Parameters<typeof standInObj>[0], dm.ws as number) : null
    if (!figure || dm.stand_in?.path !== it.path || models.get(it.path) !== figure) delete it.dummy
    else dm.stand_in.textures = { ...it.textures }
  }
  const usedTextures = new Set<string>()
  for (const it of project.scene_items) {
    for (const t of itemPaths(it).textures) {
      if (isDataPackPath(t)) continue
      if (!Object.hasOwn(d.textures, t)) { problems.push(`Object "${String(it.name).slice(0, 60)}" uses a texture the share doesn't hold.`); continue }
      usedTextures.add(t)
    }
  }
  const allTextures = Object.entries(d.textures)
  if (allTextures.length > SHARE_LIMITS.textures) problems.push(`A share can hold at most ${SHARE_LIMITS.textures} textures.`)
  // A texture no object uses is left out (not refused): settings for a material its model doesn't have may have named it.
  const textures = allTextures.filter(([path]) => usedTextures.has(path))
  for (const [, r] of textures) {
    const bad = checkRecipe(r)
    if (bad) { problems.push(`A texture in the share ${bad}.`); break }
  }
  if (d.made !== undefined) {
    if (!d.made || typeof d.made !== 'object' || Array.isArray(d.made)) problems.push('The share’s list of how models were made is not valid.')
    else for (const [k, v] of Object.entries(d.made)) {
      if (!Object.hasOwn(d.models, k) || !MADE_KINDS.includes(v)) { problems.push('The share’s list of how models were made is not valid.'); break }
    }
  }
  if (d.builds !== undefined) {
    // Checked in full only when the map is listed (shareBuilds.ts); here just its shape and size.
    const ok = !!d.builds && typeof d.builds === 'object' && !Array.isArray(d.builds)
      && Object.entries(d.builds).every(([k, b]) => Object.hasOwn(d.models, k) && buildKeysOk(b))
    if (!ok) problems.push('The share’s model settings are not valid.')
    else if (JSON.stringify(d.builds).length > SHARE_LIMITS.projectChars) problems.push('The share’s model settings are too large.')
  }
  const uniq = [...new Set(problems)]
  if (uniq.length) return { problems: uniq, doc: null }
  const clean = Object.fromEntries(textures.map(([k, r]) => [k, cleanRecipe(fromLegacy(r) as TextureRecipe)]))
  const doc: ShareDoc = {
    format: 'sr1-map-studio-share', version: 1, title: d.title.trim(), created_at: typeof d.created_at === 'string' ? d.created_at.slice(0, 40) : '',
    project, models: Object.fromEntries(models), textures: clean,
  }
  if (d.made) doc.made = { ...d.made }
  if (d.builds) doc.builds = JSON.parse(JSON.stringify(d.builds))
  return { problems: uniq, doc }
}

/** Stand-in figures (pose and scale) a share's dummies may use; others are plain objects in it. */
const MAX_FIGURE_KINDS = 16
const figures = new Map<string, string | null>()
/** A stand-in figure's model as a share stores it (lib/dummies/figure.ts makes it; remembered, it's the same each time). */
function standInText(pose: Parameters<typeof standInObj>[0], ws: number): string | null {
  const key = `${pose}:${ws}`
  if (!figures.has(key)) {
    if (figures.size > 256) figures.clear()
    const clean = cleanObj(standInObj(pose, ws))
    figures.set(key, clean ? canonicalObj(clean)?.obj ?? null : null)
  }
  return figures.get(key)!
}

/**
 * What a board's times depend on (shares.data_hash): the map itself, not its title, description, ids or dates, so
 * renaming a link keeps its board.
 */
export const mapContent = (doc: ShareDoc): string =>
  JSON.stringify([doc.models, doc.project.scene_items, doc.project.markers, doc.project.lights, doc.project.settings])

/** What a link shows before the map loads: its timed runs and how many can start at once. */
export function shareMeta(doc: ShareDoc): { modes: string[]; players: number } {
  const ms = doc.project.markers
  const modes = ['roam']
  const weapons = ms.filter((m) => m.type === 'Weapon pickup').length, drops = ms.filter((m) => m.type === 'Chains drop-off').length
  if (weapons) modes.push('weapons')
  if (drops) modes.push('dropoffs')
  if ((weapons || drops) >= 2) modes.push('race') // the set a race is run for (game.ts newRun)
  const spawns = ms.filter((m) => m.type === 'Shared spawn' || m.type === 'Red team spawn' || m.type === 'Blue team spawn').length
  return { modes, players: Math.min(12, spawns) }
}

export const MODE_NAMES: Record<string, string> = { roam: 'Free roam', weapons: 'Weapon run', dropoffs: 'Drop-off run', race: 'Race the bots' }

// ---------------- preview pictures ----------------

/**
 * A link's preview picture: only the site's own render of the share (sharePreview.ts), as a WebP of
 * exactly this size, and only for signed-in authors. Links made without an account show the site's
 * own picture (public/og.jpg).
 */
export const PREVIEW_W = 640
export const PREVIEW_H = 360
export const MAX_PREVIEW_BYTES = 256 * 1024

/** Chunks a preview may hold: the image and its transparency, nothing else (no metadata, no animation). */
const PREVIEW_CHUNKS = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH'])

/** Null for a WebP the share function stores as a preview; otherwise what is wrong with it. */
export function previewProblem(b: Uint8Array): string | null {
  const tag = (at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])
  const u32 = (at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0
  if (b.length > MAX_PREVIEW_BYTES) return 'is too large'
  if (b.length < 30 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP' || u32(4) !== b.length - 8) return 'is not a WebP picture'
  let size: [number, number] | null = null
  for (let at = 12; at < b.length;) {
    if (at + 8 > b.length) return 'is not a WebP picture'
    const kind = tag(at), len = u32(at + 4), body = at + 8
    if (!PREVIEW_CHUNKS.has(kind) || body + len > b.length) return 'holds more than a picture'
    if (kind === 'VP8 ' && !size && len >= 10 && b[body + 3] === 0x9d && b[body + 4] === 0x01 && b[body + 5] === 0x2a)
      size = [(b[body + 6] | (b[body + 7] << 8)) & 0x3fff, (b[body + 8] | (b[body + 9] << 8)) & 0x3fff]
    else if (kind === 'VP8L' && !size && len >= 5 && b[body] === 0x2f) {
      const bits = u32(body + 1)
      size = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]
    } else if (kind === 'VP8X') {
      if (at !== 12 || len < 10 || (b[body] & ~0x10)) return 'holds more than a picture' // alpha only: no animation, colour profile or metadata
    }
    at = body + len + (len & 1)
  }
  if (!size) return 'is not a WebP picture'
  return size[0] === PREVIEW_W && size[1] === PREVIEW_H ? null : `must be ${PREVIEW_W}×${PREVIEW_H}`
}

// ---------------- packing ----------------

/** gzip of the share's JSON. */
/** `level` 3 is what a server repacks with: a third of the time of 9, and about 3% larger. */
/** No timestamp in the gzip: the same share packs to the same bytes, so its hash (a board's map) stays the same. */
export const packShare = (doc: ShareDoc, level: 3 | 9 = 9): Uint8Array => gzipSync(strToU8(JSON.stringify(doc)), { level, mtime: 0 })

/** Reads a packed share, refusing anything that would unpack past the limits. */
export const unpackShare = (bytes: Uint8Array): unknown => JSON.parse(unpackShareText(bytes))

/** A packed share's JSON text (see unpackShare). */
export function unpackShareText(bytes: Uint8Array): string {
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error('This is not an SR1 Map Studio play link.')
  // A tenth over the limit: a server stores its own, quicker packing (level 3), a little larger than a browser's.
  if (bytes.length > SHARE_LIMITS.packedBytes * 1.1) throw new Error('This shared map is too large.')
  // gzip ends with the unpacked size (mod 4 GB): check it before unpacking.
  const n = bytes.length, size = (bytes[n - 4] | (bytes[n - 3] << 8) | (bytes[n - 2] << 16) | (bytes[n - 1] << 24)) >>> 0
  if (size > SHARE_LIMITS.modelChars + SHARE_LIMITS.projectChars + MB) throw new Error('This shared map is too large.')
  return strFromU8(gunzipSync(bytes))
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
