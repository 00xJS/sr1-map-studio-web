// A finished map's chunk back into objects the editor can move: every drawn triangle in world space, then split
// into pieces. Placed game objects (named records, props with a physics shape) stay one piece each, like the
// Stilwater cut-out (city/build.ts). The map's own geometry, which converters cut into meshes by vertex count
// ("BeaverCreek_12"), is pooled and split again into its connected parts, parts whose boxes touch kept together
// (a building with the window frames and signs on it), the big floors on their own. Exporters that make walls double-sided write each
// triangle twice, the copy turned round and left out of collision: the copy is dropped and the piece marked
// double-sided, as the editor exports it. The game's sky objects and the template's fake sky box are left out
// (the export adds the sky again). Each material comes in as one picture (materialPlan: its glow, tint, light-pool
// decals and additive pictures folded in). Pure functions over a parsed chunk; game frame (metres) throughout.
import type { Chunk, Material } from '../gameObjects/chunk'
import { describeMaterial } from '../gameObjects/material'
import type { ObjectMesh } from '../gameObjects/extract'
import { forEachTriangle, pieceName } from '../city/city'
import { solidity } from '../city/collision'
import { SKY_OBJECTS } from '../gameSky'

/** The picture the Beaver Creek template's sky box draws (a map's own sky image goes in under this name). */
export const FAKE_SKY = 'bc_sky_baked.tga'

/** Every triangle, as arrays: corners (9 per triangle), UVs (6), solid, material and instance. */
export interface TriSoup {
  pos: Float32Array
  uv: Float32Array
  solid: Uint8Array
  mat: Uint16Array
  inst: Uint32Array
  /** Picture name per material ('' for none): its diffuse, or what materialPlan() makes it from. */
  materials: string[]
  /** How each material's picture is made and drawn. */
  plans: MaterialPlan[]
}

/**
 * How one of the map's materials becomes the editor's one picture on one UV set, keeping what the game drew that
 * the editor and the exporter can: a tint (Diffuse_Color) multiplied in; a self-lit glow (flags 0xB, a lamp's
 * glass) kept as `glow`; an additive picture (black shows nothing: light pools, flares) made a blended one (colour
 * scaled up, alpha from its brightness); and decals over a plain base on a UV set of their own (retail lobby's
 * CircularLight / CircularDark pools baked on the floor) mixed into one picture over the base's average colour.
 */
export interface MaterialPlan {
  /** The picture's name: the diffuse, or the decal a baked or decal-shader picture is made from. */
  tex: string
  /** The UV set the picture is read with (0-3). */
  uv: number
  /** Diffuse_Color, when not white. */
  tint?: [number, number, number]
  /** Baked: the base picture (its average colour, times the tint) with these decals mixed over it, by alpha × opacity. */
  base?: string
  decals?: { tex: string; opacity: number }[]
  /** Its black is see-through. */
  additive?: boolean
  /** Drawn blended and lit by itself this much (Self_Illumination; 0: blended only, a decal shader's). */
  glow?: number
}

const white = (c: number[]) => c.every((v) => Math.abs(v - 1) < 0.02)

/**
 * The plan for material `m` (on geometry with `uvSets` UV sets) whose diffuse is `tex`. `flat`: whether a picture is
 * one plain colour all over (a base that decals can be baked over).
 */
export function materialPlan(m: Material | undefined, uvSets: number, tex: string, flat: (name: string) => boolean): MaterialPlan {
  const look = m ? describeMaterial(m, uvSets) : null
  if (!look) return { tex, uv: 0 }
  const glow = look.glow && look.selfIllum > 0 ? +look.selfIllum.toFixed(3) : undefined
  const tint = white(look.tint) ? undefined : look.tint.map((v) => +v.toFixed(3)) as [number, number, number]
  if (look.kind === 'decal') {
    // Decal shaders draw only their decal, blended.
    const d = look.decals[0]
    if (!d) return { tex, uv: 0 }
    const additive = /additive/.test(look.shader)
    return { tex: d.layer.tex, uv: d.layer.uv, ...(additive ? { additive } : {}), glow: glow ?? (additive ? 1 : 0) }
  }
  if (look.kind === 'standard') {
    const ds = look.decals, k = ds[0]?.layer.uv ?? 0
    // Decals on a UV set of their own over a plain base: one picture of the decals on that set.
    if (k > 0 && ds.every((d) => d.layer.uv === k && d.layer.repeat.every((r) => r === 1)) && (!look.base || flat(look.base.tex))) {
      return { tex: ds[0].layer.tex, uv: k, ...(look.base ? { base: look.base.tex } : {}), decals: ds.map((d) => ({ tex: d.layer.tex, opacity: d.opacity })), ...(tint ? { tint } : {}), ...(glow !== undefined ? { glow } : {}) }
    }
  }
  return { tex, uv: 0, ...(tint ? { tint } : {}), ...(glow !== undefined ? { glow } : {}) }
}

export interface SourceInstance {
  /** Its record's name, '' for none. */
  record: string
  /** Has a physics shape of its own: a prop or a breakable (glass) in the game. */
  prop: boolean
  /** Its stock damage profile ('' for none). */
  profile: string
}

export interface ChunkSoup {
  soup: TriSoup
  instances: SourceInstance[]
  /** Triangles of the fake sky box left out, and the sky objects. */
  skipped: { fakeSky: number; skyObjects: number }
  /** Whether the template's fake sky box draws the map's sky picture (so the picture can come back as the sky image). */
  fakeSky: boolean
}

class Grow {
  pos: number[] = []; uv: number[] = []; solid: number[] = []; mat: number[] = []; inst: number[] = []
}

/**
 * Every drawn triangle of the chunk, sky left out, each material as materialPlan() makes it (`flat`: which pictures
 * are one plain colour; none when not given). When the collision can't be read, everything counts as solid.
 */
export function chunkSoup(ch: Chunk, flat: (name: string) => boolean = () => false): ChunkSoup {
  const g = new Grow()
  const materials: string[] = [], plans: MaterialPlan[] = [], matIndex = new Map<string, number>()
  const recOf = new Map(ch.records.map((r) => [r.instance, r]))
  const sky = new Set(ch.records.filter((r) => SKY_OBJECTS.includes(r.name)).map((r) => r.instance))
  const readable = !!solidity(ch)
  let fakeSky = 0
  const skyTris = new Set<number>()
  const planOf = new Map<string, MaterialPlan>()
  forEachTriangle(ch, (t) => {
    if (sky.has(t.inst)) { skyTris.add(t.inst); return }
    if (t.tex.toLowerCase() === FAKE_SKY) { fakeSky++; return }
    let plan = planOf.get(t.mat + ':' + t.uvSets)
    if (!plan) planOf.set(t.mat + ':' + t.uvSets, (plan = materialPlan(ch.materials[t.mat], t.uvSets, t.tex, flat)))
    const key = JSON.stringify(plan).toLowerCase()
    let m = matIndex.get(key)
    if (m === undefined) { m = materials.length; materials.push(plan.tex); plans.push(plan); matIndex.set(key, m) }
    for (let k = 0; k < 9; k++) g.pos.push(t.p[k])
    if (plan.uv) for (let k = 0; k < 3; k++) g.uv.push(t.uvx[(k * 3 + plan.uv - 1) * 2], t.uvx[(k * 3 + plan.uv - 1) * 2 + 1])
    else for (let k = 0; k < 6; k++) g.uv.push(t.uv[k])
    g.solid.push(readable ? (t.solid ? 1 : 0) : 1)
    g.mat.push(m)
    g.inst.push(t.inst)
  }, { extras: true })
  const instances = ch.instances.map((_, i): SourceInstance => {
    const r = recOf.get(i)
    return { record: r?.name ?? '', prop: (r?.shape ?? -1) >= 0, profile: r?.profile && r.profile !== 'Default' ? r.profile : '' }
  })
  return {
    soup: { pos: new Float32Array(g.pos), uv: new Float32Array(g.uv), solid: new Uint8Array(g.solid), mat: new Uint16Array(g.mat), inst: new Uint32Array(g.inst), materials, plans },
    instances, skipped: { fakeSky, skyObjects: skyTris.size }, fakeSky: fakeSky > 0,
  }
}

// ---------------- back faces ----------------

const Q = 1000 // 1 mm
const corner = (pos: Float32Array, t: number, k: number) => `${Math.round(pos[9 * t + 3 * k] * Q)},${Math.round(pos[9 * t + 3 * k + 1] * Q)},${Math.round(pos[9 * t + 3 * k + 2] * Q)}`
/** The same key for the same triangle whichever corner it starts at; `reverse` reads it turned round. */
function triKey(pos: Float32Array, t: number, reverse: boolean): string {
  const c = [corner(pos, t, 0), corner(pos, t, 1), corner(pos, t, 2)]
  if (reverse) [c[1], c[2]] = [c[2], c[1]]
  const rots = [c.join('|'), [c[1], c[2], c[0]].join('|'), [c[2], c[0], c[1]].join('|')]
  return rots.sort()[0]
}

/**
 * For each triangle that is another one turned round (a back face the exporter added), that one's index; -1
 * otherwise. The copy is never the solid one of a pair.
 */
export function backFaces(soup: TriSoup): Int32Array {
  const n = soup.mat.length
  const out = new Int32Array(n).fill(-1)
  const front = new Map<string, number>()
  const order = [...Array(n).keys()].sort((a, b) => soup.solid[b] - soup.solid[a] || a - b)
  const taken = new Uint8Array(n)
  for (const t of order) {
    const r = front.get(triKey(soup.pos, t, true))
    if (r !== undefined && !taken[r] && soup.solid[r] >= soup.solid[t]) { out[t] = r; taken[r] = 1; continue }
    const k = triKey(soup.pos, t, false)
    if (!front.has(k)) front.set(k, t)
  }
  return out
}

// ---------------- pieces ----------------

export interface MapPiece {
  name: string
  /** A placed game object (its record), or a part of the map's own geometry. */
  kind: 'object' | 'part'
  record: string
  prop: boolean
  profile: string
  doubleSided: boolean
  /** Triangles about the piece's base; materials index into the soup's list. */
  mesh: ObjectMesh
  /** Per triangle: 1 when it is only drawn (no collision). */
  look: Uint8Array
  /** Middle of its footprint at its lowest point (game frame). */
  base: [number, number, number]
}

export interface SplitOptions {
  /** Most pieces the map's own geometry is split into. */
  maxParts?: number
  /** An instance with more triangles than this is map geometry, whatever its record is called. */
  bigInstance?: number
}

/** Map geometry a converter cut by size: no record, the template's generic names, or very big. */
const GENERIC = /^(beavercreek_\d+|$)/i

class Union {
  p: Int32Array
  constructor(n: number) { this.p = new Int32Array(n).map((_, i) => i) }
  find(a: number): number { while (this.p[a] !== a) { this.p[a] = this.p[this.p[a]]; a = this.p[a] } return a }
  join(a: number, b: number) { a = this.find(a); b = this.find(b); if (a !== b) this.p[Math.max(a, b)] = Math.min(a, b) }
}

interface Box { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }
const emptyBox = (): Box => ({ x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity })
function grow(b: Box, pos: Float32Array, t: number) {
  for (let k = 0; k < 3; k++) {
    const o = 9 * t + 3 * k
    b.x0 = Math.min(b.x0, pos[o]); b.x1 = Math.max(b.x1, pos[o]); b.y0 = Math.min(b.y0, pos[o + 1]); b.y1 = Math.max(b.y1, pos[o + 1]); b.z0 = Math.min(b.z0, pos[o + 2]); b.z1 = Math.max(b.z1, pos[o + 2])
  }
}

/**
 * The map geometry's triangles in groups: connected parts (sharing a corner), each with the small parts inside
 * its box, except the big ones (floors, the ground) that would swallow everything standing on them. When that
 * leaves too many, small groups near each other are put together.
 */
export function splitParts(soup: TriSoup, tris: number[], maxParts = 250): number[][] {
  if (!tris.length) return []
  const u = new Union(tris.length)
  const at = new Map<string, number>()
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const c = corner(soup.pos, t, k)
      const j = at.get(c)
      if (j === undefined) at.set(c, i)
      else u.join(i, j)
    }
  })
  const compOf = new Map<number, number>()
  const comps: { tris: number[]; box: Box }[] = []
  tris.forEach((t, i) => {
    const r = u.find(i)
    let c = compOf.get(r)
    if (c === undefined) { c = comps.length; compOf.set(r, c); comps.push({ tris: [], box: emptyBox() }) }
    comps[c].tris.push(t)
    grow(comps[c].box, soup.pos, t)
  })
  const all = emptyBox()
  for (const c of comps) { all.x0 = Math.min(all.x0, c.box.x0); all.x1 = Math.max(all.x1, c.box.x1); all.z0 = Math.min(all.z0, c.box.z0); all.z1 = Math.max(all.z1, c.box.z1); all.y0 = Math.min(all.y0, c.box.y0); all.y1 = Math.max(all.y1, c.box.y1) }
  const span = Math.hypot(all.x1 - all.x0, all.z1 - all.z0) || 1
  const huge = comps.map((c) => Math.hypot(c.box.x1 - c.box.x0, c.box.z1 - c.box.z0) >= 0.35 * span)
  // A part inside another's box (a window frame in a wall, a sign on a building) goes with it: the smallest
  // of the biggest few hundred parts that holds it.
  const g = new Union(comps.length)
  const vol = (b: Box) => Math.max(b.x1 - b.x0, 0.01) * Math.max(b.y1 - b.y0, 0.01) * Math.max(b.z1 - b.z0, 0.01)
  const holders = comps.map((_, i) => i).filter((i) => !huge[i]).sort((a, b) => vol(comps[b].box) - vol(comps[a].box)).slice(0, 400).reverse()
  const E = 0.05
  const inside = (a: Box, b: Box) => a.x0 >= b.x0 - E && a.x1 <= b.x1 + E && a.y0 >= b.y0 - E && a.y1 <= b.y1 + E && a.z0 >= b.z0 - E && a.z1 <= b.z1 + E
  comps.forEach((c, i) => {
    if (huge[i]) return
    const v = vol(c.box)
    const h = holders.find((j) => j !== i && vol(comps[j].box) > v && inside(c.box, comps[j].box))
    if (h !== undefined) g.join(i, h)
  })
  const groups = new Map<number, { tris: number[]; box: Box; huge: boolean }>()
  comps.forEach((c, i) => {
    const r = g.find(i)
    let x = groups.get(r)
    if (!x) groups.set(r, (x = { tris: [], box: emptyBox(), huge: huge[i] }))
    for (const t of c.tris) x.tris.push(t)
    x.box = { x0: Math.min(x.box.x0, c.box.x0), y0: Math.min(x.box.y0, c.box.y0), z0: Math.min(x.box.z0, c.box.z0), x1: Math.max(x.box.x1, c.box.x1), y1: Math.max(x.box.y1, c.box.y1), z1: Math.max(x.box.z1, c.box.z1) }
  })
  let list = [...groups.values()]
  if (list.length > maxParts) {
    // Too many: the small groups by grid cell, cells sized to leave about maxParts of them.
    const big = list.filter((x) => x.huge), rest = list.filter((x) => !x.huge)
    const cells = Math.max(1, maxParts - big.length)
    const side = Math.max((all.x1 - all.x0), (all.z1 - all.z0)) / Math.max(1, Math.floor(Math.sqrt(cells)))
    const byCell = new Map<string, { tris: number[]; box: Box; huge: boolean }>()
    for (const x of rest) {
      const cx = Math.floor(((x.box.x0 + x.box.x1) / 2 - all.x0) / side), cz = Math.floor(((x.box.z0 + x.box.z1) / 2 - all.z0) / side)
      const k = cx + ',' + cz
      const c = byCell.get(k)
      if (c) for (const t of x.tris) c.tris.push(t)
      else byCell.set(k, { tris: [...x.tris], box: x.box, huge: false })
    }
    list = [...big, ...byCell.values()]
  }
  return list.map((x) => x.tris).sort((a, b) => b.length - a.length)
}

/** Picture names converters make up from the map's name ("dust_t03.tga", "studiote_004_0ca437e4_me.tga"). */
const CONVERTED = /_t\d+(_[a-z]{2})?\.\w+$|_[0-9a-f]{3}_[0-9a-f]{8}(_[a-z]{2})?\.\w+$/i

/** What a placed object is called: its record's name in words; our exporter's glass panes and props by what they are. */
export function objectName(record: string, prop: boolean): string {
  if (/_native_glass_\d+$/i.test(record)) return 'Glass pane'
  if (/_native_prop_\d+$/i.test(record)) return 'Prop'
  return pieceName(record) || record || (prop ? 'Prop' : 'Object')
}

/** What a group of triangles is, in a word: a floor when most of it faces up, else from its main picture. */
function partName(soup: TriSoup, tris: number[]): string {
  let up = 0, total = 0
  const use = new Map<number, number>()
  for (const t of tris) {
    const p = soup.pos, o = 9 * t
    const ex = p[o + 3] - p[o], ey = p[o + 4] - p[o + 1], ez = p[o + 5] - p[o + 2], fx = p[o + 6] - p[o], fy = p[o + 7] - p[o + 1], fz = p[o + 8] - p[o + 2]
    const nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx
    const a = Math.hypot(nx, ny, nz)
    total += a
    if (a && ny / a > 0.8) up += a
    use.set(soup.mat[t], (use.get(soup.mat[t]) ?? 0) + a)
  }
  if (total && up / total > 0.6) return 'Floor'
  const main = [...use.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const tex = main === undefined ? '' : soup.materials[main]
  // The converters name pictures after the map ("dust_t03.tga"): no help as a name.
  // Without the surface suffix ("floor_co.tga": concrete).
  return (!CONVERTED.test(tex) && pieceName(tex.replace(/_[a-z]{2}(\.\w+)$/i, '$1'))) || 'Structure'
}

function pieceOf(soup: TriSoup, tris: number[], meta: Omit<MapPiece, 'mesh' | 'look' | 'base'>): MapPiece {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], mat: number[] = [], look: number[] = []
  const remap = new Map<string, number>()
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const o = 9 * t + 3 * k, q = 6 * t + 2 * k
      // Corners with the same place and UV are one vertex.
      const key = `${soup.pos[o]},${soup.pos[o + 1]},${soup.pos[o + 2]},${soup.uv[q]},${soup.uv[q + 1]}`
      let v = remap.get(key)
      if (v === undefined) {
        v = pos.length / 3
        remap.set(key, v)
        pos.push(soup.pos[o], soup.pos[o + 1], soup.pos[o + 2])
        uv.push(soup.uv[q], soup.uv[q + 1])
        x0 = Math.min(x0, soup.pos[o]); x1 = Math.max(x1, soup.pos[o]); y0 = Math.min(y0, soup.pos[o + 1]); z0 = Math.min(z0, soup.pos[o + 2]); z1 = Math.max(z1, soup.pos[o + 2])
      }
      idx.push(v)
    }
    mat.push(soup.mat[t])
    look.push(soup.solid[t] ? 0 : 1)
  }
  const base: [number, number, number] = [(x0 + x1) / 2, y0, (z0 + z1) / 2]
  const p = new Float32Array(pos.length)
  for (let i = 0; i < pos.length; i++) p[i] = pos[i] - base[i % 3]
  return {
    ...meta, base, look: new Uint8Array(look),
    mesh: { positions: p, uvs: new Float32Array(uv), triangles: new Uint32Array(idx), triMaterial: new Uint16Array(mat), materials: soup.materials },
  }
}

/** The pieces of a map, biggest first (the exporter places the map about the first one). */
export function splitScene(soup: TriSoup, instances: SourceInstance[], opts: SplitOptions = {}): MapPiece[] {
  const back = backFaces(soup)
  const n = soup.mat.length
  const perInst = new Map<number, number[]>()
  for (let t = 0; t < n; t++) {
    if (back[t] >= 0) continue
    const l = perInst.get(soup.inst[t])
    if (l) l.push(t); else perInst.set(soup.inst[t], [t])
  }
  // Each triangle's back copy, by the triangle it copies.
  const copyOf = new Map<number, number>()
  for (let t = 0; t < n; t++) if (back[t] >= 0) copyOf.set(back[t], t)
  const big = opts.bigInstance ?? 4000
  const pool: number[] = []
  const pieces: MapPiece[] = []
  const finish = (tris: number[], meta: Omit<MapPiece, 'mesh' | 'look' | 'base' | 'doubleSided'>) => {
    const copies = tris.map((t) => copyOf.get(t)).filter((c): c is number => c !== undefined)
    // Mostly double-sided: the copies go, the piece exports both sides. Otherwise they stay as they were.
    const doubleSided = copies.length > 0 && copies.length >= 0.5 * tris.length
    pieces.push(pieceOf(soup, doubleSided ? tris : [...tris, ...copies], { ...meta, doubleSided }))
  }
  for (const [i, tris] of perInst) {
    const src = instances[i] ?? { record: '', prop: false, profile: '' }
    if (!src.prop && (GENERIC.test(src.record) || tris.length > big)) { for (const t of tris) pool.push(t); continue }
    finish(tris, { name: objectName(src.record, src.prop), kind: 'object', record: src.record, prop: src.prop, profile: src.profile })
  }
  for (const tris of splitParts(soup, pool, opts.maxParts)) finish(tris, { name: partName(soup, tris), kind: 'part', record: '', prop: false, profile: '' })
  // Biggest first, props after the rest (the export can't be placed about a prop); the same name numbered.
  pieces.sort((a, b) => Number(a.prop) - Number(b.prop) || Number(a.kind === 'object') - Number(b.kind === 'object') || b.look.length - a.look.length)
  const counts = new Map<string, number>()
  for (const p of pieces) {
    const k = (counts.get(p.name) ?? 0) + 1
    counts.set(p.name, k)
    if (k > 1) p.name = `${p.name} ${k}`
  }
  return pieces
}

/** The point of the game frame that becomes the editor's origin: the middle of the map across, at its lowest point. */
export function sceneOrigin(soup: TriSoup): [number, number, number] {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let i = 0; i < soup.pos.length; i += 3) {
    x0 = Math.min(x0, soup.pos[i]); x1 = Math.max(x1, soup.pos[i]); y0 = Math.min(y0, soup.pos[i + 1]); z0 = Math.min(z0, soup.pos[i + 2]); z1 = Math.max(z1, soup.pos[i + 2])
  }
  return Number.isFinite(x0) ? [(x0 + x1) / 2, y0, (z0 + z1) / 2] : [0, 0, 0]
}
