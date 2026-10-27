// The gallery's check that a map was really made on the site. A share says
// how each model was made (share.ts `made`) and carries the settings it was
// built from (`builds`): a block-out shape, a compound of shapes, or a prefab
// and its settings. The share function rebuilds every one with the editor's
// own code and lists the map only if each comes out as the OBJ in the share,
// allowing for float rounding. An imported model relabelled as a shape, or a
// shape with a vertex moved, fails. The browser runs the same check before
// offering the gallery. Pure: no DOM, IndexedDB or Node APIs.
import { ALL_PREFABS } from '../lib/prefabRegistry'
import { prefabParams, tagPrefab } from '../lib/prefabs'
import { prefabModel } from '../lib/prefabModel'
import { validShape } from '../lib/recipes'
import type { Part } from '../lib/sampleKit'
import { compoundObj, shapeObj, type Shape } from '../lib/shapes'
import { TERRAIN_MAX_CELLS } from '../lib/terrain'
import { partShape } from '../lib/zfight'
import { cleanObj, type ModelBuild, type ShareDoc } from './share'

/** Pieces one compound may have (a road network has a few thousand). */
const MAX_PIECES = 20000
/** Rough work a share's rebuild may take, in faces (see cost). */
const MAX_COST = 2_000_000
/** How far a rebuilt number may be from the share's (OBJ numbers are written rounded). */
const TOLERANCE = 1e-3

const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi
const vec3 = (v: unknown, lo: number, hi: number) => Array.isArray(v) && v.length === 3 && v.every((x) => num(x, lo, hi))

function shapeOk(s: any): boolean {
  if (s?.kind !== 'terrain') return validShape(s)
  if (!vec3(s.size, 0.01, 2000) || !num(s.tile, 0.01, 1000) || !Array.isArray(s.cells) || s.cells.length !== 2) return false
  const [nx, nz] = s.cells
  if (!int(nx, 1, TERRAIN_MAX_CELLS) || !int(nz, 1, TERRAIN_MAX_CELLS)) return false
  return Array.isArray(s.heights) && s.heights.length === (nx + 1) * (nz + 1) && s.heights.every((h: unknown) => num(h, -2000, 2000))
}

/** Null when a build's settings are in range; otherwise what is wrong. */
export function buildProblem(b: ModelBuild): string | null {
  const x = b as any
  switch (x?.kind) {
    case 'shape': return shapeOk(x.shape) ? null : 'are out of range'
    case 'compound':
      if (!Array.isArray(x.pieces) || !x.pieces.length || x.pieces.length > MAX_PIECES) return 'have too many or no pieces'
      return x.pieces.every((pc: any) => pc && shapeOk(pc.shape) && vec3(pc.at, -5000, 5000) && num(pc.rot, -3600, 3600) && typeof pc.top === 'string' && typeof pc.side === 'string' && pc.top.length <= 64 && pc.side.length <= 64)
        ? null : 'have a piece out of range'
    case 'prefab': {
      const def = typeof x.key === 'string' && Object.hasOwn(ALL_PREFABS, x.key) ? ALL_PREFABS[x.key] : null
      if (!def) return 'name a prefab the site doesn’t have'
      if (!vec3(x.at, -100000, 100000) || !num(x.rot, -3600, 3600) || !x.params || typeof x.params !== 'object' || Array.isArray(x.params)) return 'are out of range'
      const defs = new Map((def.params ?? []).map((d) => [d.key, d]))
      for (const [k, v] of Object.entries(x.params)) {
        const d = defs.get(k)
        if (!d) return 'have a setting the prefab doesn’t have'
        if (typeof v === 'number') { if (!num(v, d.min ?? -10000, d.max ?? 10000)) return 'are out of range' }
        else if (typeof v !== 'string' || v.length > 20000 || (d.kind === 'select' && d.options && !d.options.some(([o]) => o === v))) return 'are out of range'
      }
      return null
    }
    default: return 'aren’t a shape, compound or prefab'
  }
}

/** A prefab's parts as the editor placed them (src/editor/act/shapes.ts prefabItem). */
function prefabParts(b: Extract<ModelBuild, { kind: 'prefab' }>): Part[] {
  const def = ALL_PREFABS[b.key]
  const p = prefabParams(def, b.params)
  return tagPrefab(def.make(b.at[0], b.at[2], b.rot, b.at[1], p), b.key, p, b.at, b.rot)
}

/** Faces a shape makes, roughly: what rebuilding it costs. */
function cost(s: Shape): number {
  const seg = s.segments ?? 24
  if (s.kind === 'sphere' || s.kind === 'torus') return seg * seg
  if (s.kind === 'terrain') return (s.cells?.[0] ?? 2) * (s.cells?.[1] ?? 2) * 2
  if (s.kind === 'blob') return (s.outline?.length ?? 8) * 4
  if (s.kind === 'stairs' || s.kind === 'cylinder') return seg * 4
  return 12
}

/** The model a build makes, as share OBJ, and what making it costs; the cost alone when it's over `budget`. */
function rebuild(b: ModelBuild, budget: number): { obj: string | null; cost: number } {
  if (b.kind === 'shape') {
    const c = cost(b.shape)
    return { obj: c > budget ? null : cleanObj(shapeObj(b.shape)), cost: c }
  }
  if (b.kind === 'compound') {
    const c = b.pieces.reduce((n, pc) => n + cost(pc.shape), 0)
    return { obj: c > budget ? null : cleanObj(compoundObj(b.pieces)), cost: c }
  }
  const parts = prefabParts(b)
  if (!parts.length || parts.length > MAX_PIECES) return { obj: null, cost: 0 }
  const c = parts.reduce((n, p) => n + cost(partShape(p)), 0)
  if (c > budget) return { obj: null, cost: c }
  // One part is stored as a plain shape, several as one compound (lib/samples.ts materialize).
  return { obj: cleanObj(parts.length === 1 ? shapeObj(partShape(parts[0])) : compoundObj(prefabModel(parts).pieces)), cost: c }
}

const NUMERIC = new Set(['v', 'vt', 'vn'])

/** Two share OBJs are the same model: same lines, numbers equal to within TOLERANCE. */
export function sameObj(a: string, b: string): boolean {
  if (a === b) return true
  const la = a.split('\n'), lb = b.split('\n')
  if (la.length !== lb.length) return false
  for (let i = 0; i < la.length; i++) {
    if (la[i] === lb[i]) continue
    const ta = la[i].split(' '), tb = lb[i].split(' ')
    if (ta.length !== tb.length || ta[0] !== tb[0] || !NUMERIC.has(ta[0])) return false
    for (let j = 1; j < ta.length; j++) if (!(Math.abs(Number(ta[j]) - Number(tb[j])) <= TOLERANCE)) return false
  }
  return true
}

/** True when the build makes this model (share OBJ). */
export function buildMakes(b: ModelBuild, obj: string): boolean {
  if (buildProblem(b)) return false
  try {
    const r = rebuild(b, MAX_COST)
    return !!r.obj && sameObj(r.obj, obj)
  } catch { return false }
}

/** Why the map can't go in the gallery: empty when every model rebuilds from its settings as the model in the share. */
export function galleryProblems(doc: Pick<ShareDoc, 'models' | 'made' | 'builds'>): string[] {
  const out = new Set<string>()
  let budget = MAX_COST
  for (const [k, text] of Object.entries(doc.models)) {
    const made = doc.made && Object.hasOwn(doc.made, k) ? doc.made[k] : undefined
    if (!made || made === 'import') { out.add('It has imported models. Only maps built from the site’s own shapes and prefabs can go in the gallery.'); continue }
    const b = doc.builds && Object.hasOwn(doc.builds, k) ? doc.builds[k] : undefined
    if (!b || b.kind !== made) { out.add('A model has no settings to rebuild it from.'); continue }
    const why = buildProblem(b)
    if (why) { out.add(`A model’s settings ${why}.`); continue }
    let r: { obj: string | null; cost: number }
    try { r = rebuild(b, budget) } catch { r = { obj: null, cost: 0 } }
    budget -= r.cost
    if (budget < 0) { out.add('The map has too many models to check for the gallery.'); break }
    if (!r.obj || !sameObj(r.obj, text)) out.add('A model doesn’t match the shape or prefab it says it was built from.')
  }
  return [...out]
}
