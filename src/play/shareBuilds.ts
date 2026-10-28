// The gallery's check that a map was really made on the site. A share says
// how each model was made (share.ts `made`) and carries the settings it was
// built from (`builds`): a block-out shape, a compound of shapes, or a prefab
// and its settings. The share function rebuilds every one with the editor's
// own code and lists the map only if each comes out as the OBJ in the share,
// allowing for float rounding. An imported model relabelled as a shape, or a
// shape with a vertex moved, fails. The browser runs the same check before
// offering the gallery. Pure: no DOM, IndexedDB or Node APIs.
//
// The work is bounded before anything is built: every setting is in range
// (a road is never rebuilt from its points, which can take minutes: a road
// placed today is stored, and checked, as its pieces), and the lines each
// model would write are counted first. A model whose settings would write more lines than the
// share's model holds can't match, so it isn't built; and the counting itself
// is charged to one budget for the whole share (MAX_LINES), so the check takes
// a couple of seconds at most however the share was made.
import { ALL_PREFABS } from '../lib/prefabRegistry'
import { prefabParams, tagPrefab } from '../lib/prefabs'
import { prefabModel } from '../lib/prefabModel'
import { validShape } from '../lib/recipes'
import type { Part } from '../lib/sampleKit'
import { compoundObj, faces, shapeObj, type Shape } from '../lib/shapes'
import { TERRAIN_MAX_CELLS } from '../lib/terrain'
import { partShape } from '../lib/zfight'
import { cleanObj, type ModelBuild, type ShareDoc } from './share'

/** Pieces one compound may have (a road network has a few thousand). */
const MAX_PIECES = 20000
/**
 * OBJ lines (v, vt, vn and f) a share's rebuild may write, counted before building. The biggest sample
 * map writes about 150,000 and takes about a second; this many takes about 2 s on a laptop.
 */
export const MAX_LINES = 300_000
/** What a prefab's own code is charged before it runs (one at its largest settings takes ~10 ms, about 1,500 lines' worth). */
const PREFAB_CHARGE = 1500
/** What a compound's piece is charged for having its settings checked: about 20 lines' worth. */
const PIECE_CHARGE = 20
/** What a prefab's part is charged for being turned into a piece (lifted apart where faces meet): about 60 lines' worth. */
const PART_CHARGE = 60
/** How far a rebuilt number may be from the share's (OBJ numbers are written rounded). */
const TOLERANCE = 1e-3

const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi
const vec3 = (v: unknown, lo: number, hi: number) => Array.isArray(v) && v.length === 3 && v.every((x) => num(x, lo, hi))
const HEX = /^#[0-9a-f]{6}$/i

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
      if (def.params?.some((d) => d.kind === 'path')) return 'are for a road, which the gallery can’t rebuild'
      if (!vec3(x.at, -100000, 100000) || !num(x.rot, -3600, 3600) || !x.params || typeof x.params !== 'object' || Array.isArray(x.params)) return 'are out of range'
      const defs = new Map((def.params ?? []).map((d) => [d.key, d]))
      for (const [k, v] of Object.entries(x.params)) {
        const d = defs.get(k)
        if (!d) return 'have a setting the prefab doesn’t have'
        const ok = d.kind === 'number' ? num(v, d.min ?? -10000, d.max ?? 10000)
          : typeof v !== 'string' ? false
          : d.kind === 'select' ? !!d.options?.some(([o]) => o === v)
          : d.kind === 'color' ? v === '' || HEX.test(v)
          : d.kind === 'text' ? v.length <= 200
          : false
        if (!ok) return 'are out of range'
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

/**
 * The OBJ lines (v, vt, vn and f) a shape writes: `least`, never more than it really writes, says whether it
 * can match a model; `most` is what building it is charged.
 */
export function shapeLines(s: Shape, inCompound: boolean): { least: number; most: number } {
  if (s.kind === 'terrain' && !inCompound) {
    // Its own writer (terrain.ts terrainObj): two triangles a cell at least; a vertex and its uv per grid point, skirts and all.
    const [nx, nz] = s.cells ?? [1, 1]
    return { least: 2 * nx * nz, most: 8 * (nx + 1) * (nz + 1) + 4 * nx * nz + 4096 }
  }
  let n = 0
  for (const f of faces(s)) n += f.pts.length * (f.ns ? 3 : 2) + 1
  return { least: n, most: n }
}

/** The v, vt, vn and f lines of a share OBJ. */
function objLines(text: string): number {
  let n = 0
  for (let i = 0; i < text.length;) {
    const c = text.charCodeAt(i)
    if (c === 118 /* v */ || (c === 102 /* f */ && text.charCodeAt(i + 1) === 32)) n++
    const next = text.indexOf('\n', i)
    if (next < 0) break
    i = next + 1
  }
  return n
}

class Budget {
  constructor(public left: number, private deadline = Infinity) {}
  /** False once the share has used up what its check may do. */
  charge(n: number): boolean {
    this.left -= n
    return this.left >= 0 && performance.now() < this.deadline
  }
}

type Rebuilt = { obj: string } | { mismatch: true } | { over: true }

/** The model a build makes, as share OBJ; or that it can't make a model of `lines` lines; or that the budget ran out. */
function rebuild(b: ModelBuild, lines: number, budget: Budget): Rebuilt {
  let shapes: Shape[], pieces = null as Parameters<typeof compoundObj>[0] | null
  if (b.kind === 'shape') shapes = [b.shape]
  else if (b.kind === 'compound') { pieces = b.pieces; shapes = b.pieces.map((pc) => pc.shape) }
  else {
    if (!budget.charge(PREFAB_CHARGE)) return { over: true }
    const parts = prefabParts(b)
    if (!parts.length || parts.length > MAX_PIECES) return { mismatch: true }
    if (!budget.charge(PART_CHARGE * parts.length)) return { over: true }
    // One part is stored as a plain shape, several as one compound (lib/samples.ts materialize).
    if (parts.length === 1) shapes = [partShape(parts[0])]
    else { pieces = prefabModel(parts).pieces; shapes = pieces.map((pc) => pc.shape) }
  }
  let least = 0
  for (const s of shapes) {
    const c = shapeLines(s, !!pieces)
    if (!budget.charge(c.most)) return { over: true }
    least += c.least
    if (least > lines) return { mismatch: true }
  }
  return { obj: cleanObj(pieces ? compoundObj(pieces) : shapeObj(shapes[0])) ?? '' }
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
    const r = rebuild(b, objLines(obj), new Budget(MAX_LINES))
    return 'obj' in r && sameObj(r.obj, obj)
  } catch { return false }
}

/**
 * Why the map can't go in the gallery: empty when every model rebuilds from its settings as the model in the
 * share. `deadline` (performance.now() ms) is a last guard for the server: past it the check gives up.
 */
export function galleryProblems(doc: Pick<ShareDoc, 'models' | 'made' | 'builds'>, o: { deadline?: number } = {}): string[] {
  const out = new Set<string>()
  const budget = new Budget(MAX_LINES, o.deadline)
  for (const [k, text] of Object.entries(doc.models)) {
    const made = doc.made && Object.hasOwn(doc.made, k) ? doc.made[k] : undefined
    if (!made || made === 'import') { out.add('It has imported models. Only maps built from the site’s own shapes and prefabs can go in the gallery.'); continue }
    const b = doc.builds && Object.hasOwn(doc.builds, k) ? doc.builds[k] : undefined
    if (!b || b.kind !== made) { out.add('A model has no settings to rebuild it from.'); continue }
    // Checking a compound's settings is work too.
    if (!budget.charge(b.kind === 'compound' && Array.isArray(b.pieces) ? PIECE_CHARGE * b.pieces.length : 0)) { out.add('The map has too many models to check for the gallery.'); break }
    const why = buildProblem(b)
    if (why) { out.add(`A model’s settings ${why}.`); continue }
    let r: Rebuilt
    try { r = rebuild(b, objLines(text), budget) } catch { r = { mismatch: true } }
    if ('over' in r) { out.add('The map has too many models to check for the gallery.'); break }
    if ('mismatch' in r || !sameObj(r.obj, text)) out.add('A model doesn’t match the shape or prefab it says it was built from.')
  }
  return [...out]
}
