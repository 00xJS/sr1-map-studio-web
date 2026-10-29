// Publishing rules shared by the browser and the Netlify publish function.
// Pure module: no DOM, IndexedDB or Node APIs. The client runs these checks
// for good UX; the server runs them again on the stored bytes.
import { baseName, isDataPackPath, normalizeProject, referencedPaths, type FileRef, type Project } from './project'
import { cleanRecipe, recipeProblem, withoutPhoto } from './recipes'
import { withStandIns } from './dummies/standIn'

// ---------------- Saints Row game data ----------------

// Magic numbers of Saints Row 1 (Xbox 360) formats.
export const GAME_SIGNATURES: { name: string; bytes: number[] }[] = [
  { name: 'BBChunk', bytes: [0xbb, 0xca, 0xca, 0x12] },
  { name: 'BBCity', bytes: [0xbb, 0xc1, 0x7e, 0xee] },
  { name: 'PVSV', bytes: [0xbb, 0xda, 0xdd, 0x10] },
  { name: 'PEG texture package', bytes: [0x56, 0x4b, 0x45, 0x47] },
  { name: 'VPP packfile', bytes: [0x51, 0x89, 0x0a, 0xce] },
]
export const GAME_EXTENSIONS = /\.(\w+_xbox2|vpp\w*|cts|peg\w*|str2\w*|xtbl|tgn|bin)$/i

export function gameSignature(head: Uint8Array, name: string, textHead?: string): string | null {
  for (const sig of GAME_SIGNATURES) {
    if (sig.bytes.every((b, i) => head[i] === b)) return sig.name
  }
  if (GAME_EXTENSIONS.test(name)) return 'Saints Row file type (' + name.split('.').pop() + ')'
  if (textHead && /^\s*(\/\/ -+\s*)?#(Includes|Groups|Navpoints)/m.test(textHead) && /\+Chunk:/.test(textHead)) return 'CTS gameplay table'
  return null
}

// ---------------- limits ----------------

/**
 * Supabase project URL from a setting that may hold an API endpoint instead
 * (the dashboard shows `https://<ref>.supabase.co/rest/v1/` on its Data API page).
 */
export function supabaseProjectUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '').replace(/\/(rest|auth|storage|functions)\/v1$/i, '')
}

export const MB = 1024 * 1024
/** Bytes of each file the server inspects. */
export const HEAD_BYTES = 4096

export interface PublishLimits { maxFileBytes: number; maxMapBytes: number }
export const DEFAULT_LIMITS: PublishLimits = { maxFileBytes: 25 * MB, maxMapBytes: 60 * MB }

/** Limits with the map cap taken from HUB_MAX_MAP_MB (per-file cap never exceeds it). */
export function limitsFromEnv(mapMb?: string | null): PublishLimits {
  const n = Number(mapMb)
  if (!mapMb || !Number.isFinite(n) || n <= 0) return DEFAULT_LIMITS
  return { maxMapBytes: n * MB, maxFileBytes: Math.min(DEFAULT_LIMITS.maxFileBytes, n * MB) }
}

const fmtMB = (n: number) => `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`

// ---------------- file checks ----------------

export interface PublishFile { name: string; size: number; type: string; head: Uint8Array; textHead?: string }
export type FileKind = 'obj' | 'mtl' | 'png' | 'jpeg' | 'bmp' | 'gif' | 'webp' | 'tga' | 'dds' | 'tiff'

const bytesOf = (s: string) => [...s].map((c) => c.charCodeAt(0))
const at = (h: Uint8Array, bytes: number[], offset = 0) => h.length >= offset + bytes.length && bytes.every((b, i) => h[offset + i] === b)
const u16 = (h: Uint8Array, o: number) => h[o] | (h[o + 1] << 8)
const u32 = (h: Uint8Array, o: number) => (h[o] | (h[o + 1] << 8) | (h[o + 2] << 16) | (h[o + 3] << 24)) >>> 0

function plausibleTga(h: Uint8Array): boolean {
  if (h.length < 18) return false
  const [, cmapType, imageType] = h
  return (cmapType === 0 || cmapType === 1)
    && [1, 2, 3, 9, 10, 11].includes(imageType)
    && u16(h, 12) > 0 && u16(h, 14) > 0
    && [8, 15, 16, 24, 32].includes(h[16])
}

export function imageKind(h: Uint8Array, name: string): FileKind | null {
  if (at(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (at(h, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (at(h, bytesOf('GIF87a')) || at(h, bytesOf('GIF89a'))) return 'gif'
  if (at(h, bytesOf('RIFF')) && at(h, bytesOf('WEBP'), 8)) return 'webp'
  if (at(h, bytesOf('DDS '))) return 'dds'
  if (at(h, [0x49, 0x49, 0x2a, 0x00]) || at(h, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff'
  if (at(h, bytesOf('BM')) && h.length >= 18 && [12, 40, 52, 56, 64, 108, 124].includes(u32(h, 14))) return 'bmp'
  // TGA has no magic number: trust the extension only with a sane header.
  if (/\.tga$/i.test(name) && plausibleTga(h)) return 'tga'
  return null
}

function isText(h: Uint8Array): boolean {
  let bad = 0
  for (const b of h) {
    if (b === 0) return false
    if (b < 9 || (b > 13 && b < 32)) bad++
  }
  return bad <= h.length * 0.01
}

const decode = (h: Uint8Array) => new TextDecoder('utf-8', { fatal: false }).decode(h)
const OBJ_LINE = /^[ \t]*(v|vt|vn|vp|f|o|g|s|l|p|mtllib|usemtl|#)([ \t]|$)/m

export function fileKind(f: Pick<PublishFile, 'name' | 'head' | 'textHead'>): FileKind | null {
  const img = imageKind(f.head, f.name)
  if (img) return img
  const ext = f.name.toLowerCase().split('.').pop()
  if ((ext === 'obj' || ext === 'mtl') && isText(f.head)) {
    if (ext === 'mtl') return 'mtl'
    if (OBJ_LINE.test(f.textHead ?? decode(f.head))) return 'obj'
  }
  return null
}

/** Problems with the files themselves (game data, unknown kinds, size caps). */
export function checkPublishFiles(files: PublishFile[], limits: PublishLimits = DEFAULT_LIMITS): string[] {
  const problems: string[] = []
  let total = 0
  for (const f of files) {
    total += f.size
    const text = f.textHead ?? decode(f.head)
    const game = gameSignature(f.head, f.name, text)
    if (game) { problems.push(`${f.name} is Saints Row game data (${game}). Game files can't be shared on the hub.`); continue }
    if (f.size === 0) { problems.push(`${f.name} is empty.`); continue }
    if (!fileKind({ name: f.name, head: f.head, textHead: text })) {
      problems.push(`${f.name} isn't a supported file type. Only OBJ/MTL models and PNG, JPEG, BMP, GIF, WebP, TGA, DDS or TIFF images can be shared.`)
    }
    if (f.size > limits.maxFileBytes) problems.push(`${f.name} is ${fmtMB(f.size)}; the limit per file is ${fmtMB(limits.maxFileBytes)}.`)
  }
  if (total > limits.maxMapBytes) problems.push(`This map's files add up to ${fmtMB(total)}; the limit per map is ${fmtMB(limits.maxMapBytes)}.`)
  return problems
}

export const MAX_THUMB_BYTES = 2 * MB

/** Thumbnails go public as-is, so they must be small browser images and nothing else. */
export function isValidThumbnail(size: number, head: Uint8Array): boolean {
  const kind = imageKind(head, 'thumbnail')
  return size > 0 && size <= MAX_THUMB_BYTES && (kind === 'png' || kind === 'jpeg' || kind === 'webp') && !gameSignature(head, 'thumbnail')
}

// ---------------- title / description / tags ----------------

export interface PublishMeta { title: string; description: string; tags: string[] }
export const TAG_RE = /^[a-z0-9-]{2,24}$/
export const MAX_TAGS = 8

/** Split free text ("deathmatch, City  night") or clean a list into lowercase unique tags. */
export function normalizeTags(tags: string[] | string): string[] {
  const list = typeof tags === 'string' ? tags.split(/[\s,#]+/) : tags
  return [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter(Boolean))]
}

export function checkPublishMeta(m: { title: unknown; description: unknown; tags: unknown }): string[] {
  const problems: string[] = []
  const title = typeof m.title === 'string' ? m.title.trim() : ''
  if (title.length < 3 || title.length > 80) problems.push('The title must be 3 to 80 characters.')
  const desc = m.description ?? ''
  if (typeof desc !== 'string') problems.push('The description must be text.')
  else if (desc.length > 4000) problems.push('The description can be at most 4000 characters.')
  if (!Array.isArray(m.tags)) { problems.push('Tags must be a list.'); return problems }
  const tags = normalizeTags(m.tags as string[])
  if (tags.length > MAX_TAGS) problems.push(`Use at most ${MAX_TAGS} tags.`)
  const bad = tags.filter((t) => !TAG_RE.test(t))
  if (bad.length) problems.push(`Tags must be 2 to 24 letters, digits or dashes: ${bad.join(', ')}`)
  return problems
}

export const cleanMeta = (m: PublishMeta): PublishMeta => ({ title: m.title.trim(), description: (m.description || '').trim(), tags: normalizeTags(m.tags) })

// ---------------- projects ----------------

export interface PlannedFile { path: string; ref: FileRef }
export interface UploadPlan {
  /** User files that may go to the cloud and the hub (one entry per path). */
  upload: PlannedFile[]
  /** Game files: kept on this device only. */
  local: PlannedFile[]
  /** Reasons the project can't be published as it is. Cloud saves are still fine. */
  blockers: string[]
  /** Distinct content hashes in `upload`. */
  hashes: string[]
  bytes: number
}

/** Where each referenced path is used, in words ("Object "Crate", material "wood""). */
export function describeReferences(p: Project): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const add = (path: unknown, label: string) => {
    if (typeof path !== 'string' || !path) return
    const list = out.get(path) ?? []
    if (!list.includes(label)) list.push(label)
    out.set(path, list)
  }
  const scan = (items: Project['scene_items'] | Project['asset_library'], kind: string) => {
    for (const it of items) {
      const n = `${kind} "${it.name || 'unnamed'}"`
      add(it.path, `${n} (model)`)
      add(it.native_mesh_obj, `${n} (native mesh)`)
      add(it.glass_custom_texture, `${n} (glass texture)`)
      for (const [mat, t] of Object.entries(it.textures || {})) add(t, `${n}, material "${mat}"`)
    }
  }
  scan(p.scene_items, 'Object')
  scan(p.asset_library, 'Library asset')
  const s = p.settings
  add(s.sky_texture, 'Sky texture (map settings)')
  add(s.minimap_texture, 'Minimap texture (map settings)')
  add(s.bbcity_donor, 'BBCity donor (map settings)')
  add(s.cts_template, 'CTS template (map settings)')
  for (const path of referencedPaths(p)) if (!out.has(path)) add(path, `File ${baseName(path)}`)
  return out
}

const listLabels = (labels: string[]) => labels.length > 3 ? `${labels.slice(0, 3).join('; ')} and ${labels.length - 3} more` : labels.join('; ')

export function projectUploadPlan(source: Project): UploadPlan {
  // Decoy dummies go as their stand-in figures (the characters are built from the player's own game).
  const p = withStandIns(source)
  const upload: PlannedFile[] = []
  const local: PlannedFile[] = []
  for (const [path, ref] of Object.entries(p.files || {})) {
    if (isDataPackPath(path) || !ref || typeof ref !== 'object') continue
    ;(ref.origin === 'user' ? upload : local).push({ path, ref })
  }
  const blockers: string[] = []
  // Game files grouped by the object or setting that uses them (an imported
  // retail map can reference a hundred textures).
  const game = new Map<string, Set<string>>()
  for (const [path, labels] of describeReferences(p)) {
    if (isDataPackPath(path)) continue // recipients use their own data pack
    const ref = p.files?.[path]
    if (!ref) blockers.push(`${listLabels(labels)} uses ${baseName(path)}, which is missing from this project. Re-import or clear it.`)
    else if (ref.origin !== 'user') {
      for (const label of labels) {
        const owner = label.includes('(map settings)') ? label : label.replace(/, material .*$| \([^)]*\)$/, '')
        game.set(owner, (game.get(owner) ?? new Set()).add(ref.name))
      }
    }
  }
  for (const [owner, names] of game) {
    const list = [...names]
    const shown = list.length > 3 ? `${list.slice(0, 3).join(', ')} and ${list.length - 3} more` : list.join(', ')
    const setting = owner.includes('(map settings)')
    blockers.push(`${owner} uses ${list.length === 1 ? 'a file' : `${list.length} files`} from your Saints Row game files (${shown}). Game data can't be shared on the hub; ${setting ? 'clear it so players use the default from their own data pack' : 'remove it or replace it with your own files'} before publishing.`)
  }
  const seen = new Map<string, number>()
  for (const f of upload) seen.set(f.ref.hash, f.ref.size)
  return { upload, local, blockers, hashes: [...seen.keys()], bytes: [...seen.values()].reduce((a, b) => a + b, 0) }
}

/** The project as it is stored on the hub: user files only, nothing from the game. */
export function hubSnapshot(p: Project): Project {
  const copy: Project = JSON.parse(JSON.stringify(withStandIns(p)))
  const files: Project['files'] = {}
  for (const [path, ref] of Object.entries(copy.files || {})) {
    if (ref?.origin === 'user' && !isDataPackPath(path)) files[path] = { hash: ref.hash, size: ref.size, name: ref.name, type: ref.type, origin: 'user' }
  }
  copy.files = files
  return copy
}

export interface HubFile { hash: string; size: number; name: string; type: string }

const HASH_RE = /^[0-9a-f]{64}$/
const MAX_SNAPSHOT_CHARS = 5 * MB

/** `fn` over the items, at most `limit` at a time, results in order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]) } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export interface PreparedPublish { problems: string[]; snapshot: Project; manifest: HubFile[]; meta: PublishMeta }

/**
 * Every check needed before a project goes public. `readHead` returns the
 * real stored size and first HEAD_BYTES of a blob, or null when it is missing.
 */
export async function preparePublish(
  raw: unknown,
  meta: { title: unknown; description: unknown; tags: unknown },
  readHead: (hash: string) => Promise<{ size: number; head: Uint8Array } | null>,
  limits: PublishLimits = DEFAULT_LIMITS,
): Promise<PreparedPublish> {
  const problems = checkPublishMeta(meta)
  const clean = problems.length ? { title: '', description: '', tags: [] } : cleanMeta(meta as PublishMeta)
  let project: Project
  try { project = normalizeProject(raw) } catch {
    return { problems: [...problems, 'The saved project is not a valid SR1 Map Studio project.'], snapshot: raw as Project, manifest: [], meta: clean }
  }
  const plan = projectUploadPlan(project)
  problems.push(...plan.blockers)
  const unique = new Map<string, PlannedFile>()
  for (const f of plan.upload) {
    if (!HASH_RE.test(f.ref.hash)) problems.push(`${f.ref.name} has an invalid content hash.`)
    else if (!unique.has(f.ref.hash)) unique.set(f.ref.hash, f)
  }
  const files = [...unique.values()]
  const heads = await mapLimit(files, 6, (f) => readHead(f.ref.hash))
  const checked: PublishFile[] = []
  const manifest: HubFile[] = []
  files.forEach((f, i) => {
    const h = heads[i]
    if (!h) { problems.push(`${f.ref.name} hasn't been uploaded to your cloud save yet. Save to the cloud and try again.`); return }
    checked.push({ name: f.ref.name, size: h.size, type: f.ref.type, head: h.head })
    manifest.push({ hash: f.ref.hash, size: h.size, name: String(f.ref.name).slice(0, 200), type: String(f.ref.type || '').slice(0, 100) })
  })
  problems.push(...checkPublishFiles(checked, limits))
  const snapshot = hubSnapshot(project)
  for (const ref of Object.values(snapshot.files)) {
    const real = manifest.find((m) => m.hash === ref.hash)
    if (real) ref.size = real.size
  }
  if (JSON.stringify(snapshot).length > MAX_SNAPSHOT_CHARS) problems.push('The project data is too large to publish (over 5 MB of scene data).')
  return { problems, snapshot, manifest, meta: clean }
}

// ---------------- Showcase ----------------
//
// The public Showcase only takes maps built from what the site makes itself:
// starter-library textures (CC0), generated textures, block-out shapes and
// prefabs. Each of those files carries a recipe (recipes.ts), and the Showcase
// stores the recipes, never the files, so nobody's uploads go public. The only
// images it stores are the author's own in-game screenshots and a thumbnail.

export const MAX_SHOTS = 6

/** Starter-library texture ids from public/textures/index.json. */
export const libraryIdsFrom = (index: { textures?: { id: string }[] }) => new Set((index.textures ?? []).map((t) => t.id))

const ITEM_FILE_KEYS = ['path', 'native_mesh_obj', 'glass_custom_texture'] as const
// Fields that can hold paths on the author's own computer.
const PRIVATE_ITEM_KEYS = ['source_path', 'original_import_path', 'native_original_name', 'native_prop_original_name']

/** Settings files the Showcase keeps: a minimap or loading picture the exporter renders itself is dropped. */
function settingsFiles(p: Project): [key: keyof Project['settings'], label: string][] {
  const s = p.settings
  const out: [keyof Project['settings'], string][] = [['sky_texture', 'Sky texture'], ['bbcity_donor', 'BBCity donor'], ['cts_template', 'CTS template']]
  const customMinimap = s.minimap_mode === 'custom' || (!s.minimap_mode && !!s.minimap_texture)
  if (customMinimap) out.push(['minimap_texture', 'Custom minimap picture'])
  if (s.loading_mode === 'custom') out.push(['loading_image', 'Custom loading picture'])
  return out
}

export interface ShowcasePlan {
  /** Reasons the map can't go in the Showcase. */
  blockers: string[]
  /** What the Showcase stores: the map with recipe-only file records. */
  snapshot: Project
}

export function showcasePlan(raw: Project, libraryIds: ReadonlySet<string>): ShowcasePlan {
  const p: Project = JSON.parse(JSON.stringify(withStandIns(raw)))
  p.scene_items = p.scene_items.map((it) => withoutPhoto(it, p.files ?? {}))
  const blockers: string[] = []
  const own = new Map<string, Set<string>>()
  const fromGame = new Map<string, Set<string>>()
  const broken: string[] = []
  const used = new Set<string>()
  const check = (path: unknown, owner: string) => {
    if (typeof path !== 'string' || !path || isDataPackPath(path)) return
    const ref = p.files?.[path]
    if (!ref) { broken.push(`${owner} uses ${baseName(path)}, which is missing from this project.`); return }
    if (ref.origin === 'game') { fromGame.set(owner, (fromGame.get(owner) ?? new Set()).add(ref.name)); return }
    if (!ref.recipe) { own.set(owner, (own.get(owner) ?? new Set()).add(ref.name)); return }
    const why = recipeProblem(ref.recipe, libraryIds)
    if (why) { broken.push(`${owner}: ${ref.name} has a broken recipe (${why}).`); return }
    used.add(path)
  }
  for (const it of p.scene_items) {
    const owner = `Object "${it.name || 'unnamed'}"`
    for (const k of ITEM_FILE_KEYS) check(it[k], owner)
    for (const t of Object.values(it.textures || {})) check(t, owner)
    // A decoy dummy goes only as its stand-in figure (the client swaps it in; checked again on the server).
    if (it.dummy && p.files?.[it.path]?.recipe?.kind !== 'figure') broken.push(`${owner} is a decoy dummy that isn't its stand-in figure.`)
  }
  const s = p.settings
  const kept = settingsFiles(p)
  for (const [k, label] of kept) check(s[k], `${label} (map settings)`)
  for (const [owner, names] of own) {
    const list = [...names]
    const shown = list.length > 3 ? `${list.slice(0, 3).join(', ')} and ${list.length - 3} more` : list.join(', ')
    blockers.push(`${owner} uses ${list.length === 1 ? 'a file' : `${list.length} files`} you added yourself (${shown}). The Showcase only takes maps made from the site's own textures, shapes and prefabs: repaint it from the paint bucket or texture studio, or remove it.`)
  }
  for (const owner of fromGame.keys()) {
    // A setting's picture of the view ("Keep this view") is a game file when it shows the game or the data pack.
    blockers.push(owner.includes('(map settings)')
      ? `${owner} is kept as a game file: it is a picture of your game files or the data pack, or of a map that shows them. Those can only be used in your own maps: choose another picture before sending the map to the Showcase.`
      : `${owner} comes from your Saints Row game files. Objects and pictures from the game can only be used in your own maps: remove it before sending the map to the Showcase.`)
  }
  blockers.push(...new Set(broken))
  if (!p.scene_items.length) blockers.push('The map is empty.')

  // The snapshot: recipe-only files, no library, nothing private.
  const files: Project['files'] = {}
  for (const path of used) {
    const ref = p.files[path]
    files[path] = { hash: String(ref.hash).slice(0, 64), size: 0, name: String(ref.name).slice(0, 120), type: String(ref.type || '').slice(0, 60), origin: 'user', recipe: cleanRecipe(ref.recipe!) }
  }
  p.files = files
  p.asset_library = []
  for (const it of p.scene_items) for (const k of PRIVATE_ITEM_KEYS) delete it[k]
  for (const k of ['sky_texture', 'minimap_texture', 'loading_image', 'bbcity_donor', 'cts_template'] as const) {
    if (!kept.some(([x]) => x === k)) (s as any)[k] = ''
  }
  return { blockers, snapshot: p }
}

export interface PreparedShowcase { problems: string[]; snapshot: Project; meta: PublishMeta }

/** Every check before a map goes in the Showcase; the publish function runs this on the JSON it is sent. */
export function prepareShowcase(
  raw: unknown,
  meta: { title: unknown; description: unknown; tags: unknown },
  libraryIds: ReadonlySet<string>,
): PreparedShowcase {
  const problems = checkPublishMeta(meta)
  const clean = problems.length ? { title: '', description: '', tags: [] } : cleanMeta(meta as PublishMeta)
  let project: Project
  try { project = normalizeProject(raw) } catch {
    return { problems: [...problems, 'That is not a valid SR1 Map Studio project.'], snapshot: raw as Project, meta: clean }
  }
  const plan = showcasePlan(project, libraryIds)
  problems.push(...plan.blockers)
  if (JSON.stringify(plan.snapshot).length > MAX_SNAPSHOT_CHARS) problems.push('The map data is too large to publish (over 5 MB).')
  return { problems, snapshot: plan.snapshot, meta: clean }
}

/** Screenshots and the thumbnail: small PNG, JPEG or WebP images only. */
export function checkShots(shots: { size: number; head: Uint8Array }[]): string[] {
  const problems: string[] = []
  if (shots.length > MAX_SHOTS) problems.push(`Add at most ${MAX_SHOTS} screenshots.`)
  shots.forEach((s, i) => { if (!isValidThumbnail(s.size, s.head)) problems.push(`Screenshot ${i + 1} must be a PNG, JPEG or WebP image of at most 2 MB.`) })
  return problems
}
