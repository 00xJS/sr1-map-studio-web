// How the site made a file: a starter-library texture, a generated texture, or
// geometry built from the block-out shapes. A file with a recipe can be rebuilt
// anywhere from the recipe alone, so play links and the Showcase share recipes
// and never the file: no picture or model a user uploaded can go out this way.
// Pure module (used by the share and publish functions).
import { KINDS, type GenParams } from './procedural'
import { SIGN_STYLES, signTextProblem } from './signFont'
import type { CompoundPiece, Shape, ShapeKind } from './shapes'

export type FileRecipe =
  | { kind: 'library'; id: string }
  | { kind: 'generated'; params: GenParams }
  | { kind: 'shape'; shape: Shape }
  | { kind: 'compound'; pieces: CompoundPiece[] }

/** The recipes that make a texture. */
export type TextureRecipe = Extract<FileRecipe, { kind: 'library' | 'generated' }>
export const isTextureRecipe = (r: unknown): r is TextureRecipe => {
  const k = (r as FileRecipe | null)?.kind
  return k === 'library' || k === 'generated'
}

// Files the site is about to store, tagged by whoever made them; storeFile
// records the recipe on the file's FileRef.
const made = new WeakMap<Blob, FileRecipe>()

/** Marks a file the site just made, so storeFile records its recipe. Returns the same file. */
export function tagRecipe<T extends Blob>(file: T, recipe: FileRecipe): T {
  made.set(file, cleanRecipe(recipe))
  return file
}

export const recipeOf = (file: Blob): FileRecipe | undefined => made.get(file)

/** Recipes as early play links and saves wrote them ({gen} / {lib}), in today's form; anything else as it is. */
export function fromLegacy(r: unknown): unknown {
  const x = r as Record<string, unknown> | null
  if (!x || typeof x !== 'object' || 'kind' in x || Object.keys(x).length !== 1) return r
  if ('gen' in x) return { kind: 'generated', params: x.gen }
  if ('lib' in x) return { kind: 'library', id: x.lib }
  return r
}

// ---------------- photo frames ----------------

interface PrefabUser { textures: Record<string, string>; prefab?: { defaults: Record<string, string> } }

/** The material of a placed prefab that shows a picture (a photo frame's stand-in, or the photo chosen for it); null if it has none. */
export function pictureSlot(it: PrefabUser, files: Record<string, { recipe?: FileRecipe }>): string | null {
  const d = it.prefab?.defaults
  if (!d) return null
  return Object.keys(d).find((m) => { const r = files[d[m]]?.recipe; return r?.kind === 'generated' && r.params?.kind === 'picture' }) ?? null
}

/**
 * The object as share links and the Showcase see it: a photo frame shows its
 * stand-in picture, never the photo chosen for it (that stays the user's own).
 */
export function withoutPhoto<T extends PrefabUser>(it: T, files: Record<string, { recipe?: FileRecipe }>): T {
  const m = pictureSlot(it, files)
  if (!m || !it.textures || it.textures[m] === it.prefab!.defaults[m]) return it
  return { ...it, textures: { ...it.textures, [m]: it.prefab!.defaults[m] } }
}

// ---------------- checks (the share and publish functions run these on untrusted JSON) ----------------

export const LIBRARY_ID = /^[a-z0-9_]{1,64}$/
export const MAX_TEXTURE_SIZE = 2048
const SHAPE_KINDS: ShapeKind[] = ['box', 'ramp', 'stairs', 'cylinder', 'roof', 'blob', 'torus']
const MAX_PIECES = 400
const MAX_OUTLINE = 256
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const MAT = /^[A-Za-z0-9_.-]{1,40}$/
const PARAM_KEYS = new Set(['kind', 'size', 'color', 'accent', 'scale', 'wear', 'seed', 'line', 'bricks', 'text', 'style'])
const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi
const vec3 = (v: unknown, lo: number, hi: number) => Array.isArray(v) && v.length === 3 && v.every((x) => num(x, lo, hi))

export function validShape(s: any): boolean {
  if (!s || typeof s !== 'object' || !SHAPE_KINDS.includes(s.kind)) return false
  if (!vec3(s.size, 0.01, 2000) || !num(s.tile, 0.01, 1000)) return false
  if (s.segments !== undefined && !int(s.segments, 1, 128)) return false
  if (s.taper !== undefined && !num(s.taper, 0, 10)) return false
  if (s.bevel !== undefined && !num(s.bevel, 0, 100)) return false
  if (s.lie !== undefined && typeof s.lie !== 'boolean') return false
  if (s.fit !== undefined && typeof s.fit !== 'boolean') return false
  if (s.outline !== undefined) {
    if (!Array.isArray(s.outline) || s.outline.length < 3 || s.outline.length > MAX_OUTLINE) return false
    if (!s.outline.every((p: unknown) => Array.isArray(p) && p.length === 2 && p.every((x) => num(x, -2000, 2000)))) return false
  }
  return true
}

/** Null when the generator settings are well formed; otherwise what is wrong. */
export function paramsProblem(p: any): string | null {
  if (!p || typeof p !== 'object') return 'is not a texture recipe'
  if (typeof p.kind !== 'string' || !Object.hasOwn(KINDS, p.kind)) return 'uses an unknown texture kind'
  if (!int(p.size, 16, MAX_TEXTURE_SIZE)) return 'has a texture size out of range'
  if (typeof p.color !== 'string' || !HEX.test(p.color) || typeof p.accent !== 'string' || !HEX.test(p.accent)) return 'has a bad color'
  if (!num(p.scale, 0, 256) || !num(p.wear, 0, 1) || !int(p.seed, 0, 2 ** 31 - 1)) return 'has settings out of range'
  if (p.line !== undefined && !['none', 'yellow', 'white'].includes(p.line)) return 'has a bad road line'
  if (p.bricks !== undefined && typeof p.bricks !== 'boolean') return 'has a bad brick setting'
  if (p.text !== undefined) { const why = signTextProblem(p.text); if (why) return why }
  if (p.style !== undefined && (typeof p.style !== 'string' || !Object.hasOwn(SIGN_STYLES, p.style))) return 'has an unknown sign style'
  if (Object.keys(p).some((k) => !PARAM_KEYS.has(k))) return 'has unknown settings'
  return null
}
export const validParams = (p: unknown) => !paramsProblem(p)

/**
 * Null when the recipe is well formed; otherwise what is wrong with it.
 * With `libraryIds`, a starter texture must be one of them; without, its id
 * must at least look like one (viewers only ever load /textures/<id>.jpg).
 */
export function recipeProblem(r: unknown, libraryIds?: ReadonlySet<string>): string | null {
  const x = r as any
  if (!x || typeof x !== 'object') return 'is not a recipe'
  const extra = (keys: string[]) => Object.keys(x).some((k) => !keys.includes(k))
  switch (x.kind) {
    case 'library':
      if (extra(['kind', 'id']) || typeof x.id !== 'string' || !LIBRARY_ID.test(x.id)) return 'names an unknown library texture'
      return !libraryIds || libraryIds.has(x.id) ? null : `names an unknown starter texture "${x.id}"`
    case 'generated': return extra(['kind', 'params']) ? 'is not a texture recipe' : paramsProblem(x.params)
    case 'shape': return !extra(['kind', 'shape']) && validShape(x.shape) ? null : 'has shape settings out of range'
    case 'compound':
      if (extra(['kind', 'pieces']) || !Array.isArray(x.pieces) || !x.pieces.length || x.pieces.length > MAX_PIECES) return 'is a prefab with too many or no pieces'
      return x.pieces.every((pc: any) => pc && validShape(pc.shape) && vec3(pc.at, -5000, 5000) && num(pc.rot, -3600, 3600) && MAT.test(pc.top) && MAT.test(pc.side))
        ? null : 'has a prefab piece out of range'
    default: return 'is not a recipe'
  }
}

/** Textures only (play links): a library or generated recipe. */
export const textureRecipeProblem = (r: unknown, libraryIds?: ReadonlySet<string>) =>
  isTextureRecipe(r) ? recipeProblem(r, libraryIds) : 'is not a texture recipe'

/** Only the fields a recipe may carry (drops anything else smuggled into the JSON). */
export function cleanRecipe<R extends FileRecipe>(r: R): R
export function cleanRecipe(r: FileRecipe): FileRecipe {
  const shape = (s: Shape): Shape => {
    const out: Shape = { kind: s.kind, size: [...s.size] as Shape['size'], tile: s.tile }
    for (const k of ['segments', 'taper', 'bevel', 'lie', 'fit'] as const) if (s[k] !== undefined) (out as any)[k] = s[k]
    if (s.outline) out.outline = s.outline.map(([a, b]) => [a, b])
    return out
  }
  switch (r.kind) {
    case 'library': return { kind: 'library', id: r.id }
    case 'generated': {
      const p = r.params
      const params: GenParams = { kind: p.kind, size: p.size, color: p.color, accent: p.accent, scale: p.scale, wear: p.wear, seed: p.seed }
      if (p.line !== undefined) params.line = p.line
      if (p.bricks !== undefined) params.bricks = p.bricks
      if (p.text !== undefined) params.text = p.text
      if (p.style !== undefined) params.style = p.style
      return { kind: 'generated', params }
    }
    case 'shape': return { kind: 'shape', shape: shape(r.shape) }
    case 'compound': return { kind: 'compound', pieces: r.pieces.map((pc) => ({ shape: shape(pc.shape), at: [...pc.at] as CompoundPiece['at'], rot: pc.rot, top: pc.top, side: pc.side })) }
  }
}
