// The catalogue: every model in the player's game library, broken down so the wizard (and the player) know exactly
// what each one is before using it. Eight sides of it, each with how sure it is and the evidence it rests on:
//
//   form       what it is to look at: a 3D model, a flat sheet (decal, sign, poster), a line (wires, rails), something
//              invisible (collision only, a proxy), a light, part of the sky;
//   structure  how it is put together: standalone, an assembly (it comes with parts), a part (always placed with a
//              bigger one), a building kit piece, a connector (corner, end cap, joint), a copy (a second state);
//   role       building, cover, clutter, street furniture, nature, vehicle, machine, fence or wall, ground, light, sign;
//   measures   footprint, height, bulk, how solid it is at eye height, whether players can stand on it, what cover
//              it gives (none, crouching, standing);
//   stands     on the ground, on a wall, on a roof, hanging or only on its building, which side faces out, the floor
//              it needs clear in front (placement.ts);
//   material   the surface the game makes of it (concrete, metal, wood...: the texture name's suffix) and its pictures;
//   use        where the game uses it (multiplayer maps, Stilwater districts), how often, what stands near it;
//   site       which of the site's own pieces it can stand in for, with the difference in size (placeholders.ts).
//
// Everything is worked out from the library (indexer.ts) and the rules over it (identity.ts, placement.ts); the
// player's own corrections (labels.ts) come first. Pure: nothing here reads game files.
import catalogs from '../catalogs.json'
import type { GameObjectEntry } from './indexer'
import { identify, type GameIdentity, type GameRole, type PropKind } from './identity'
import type { PlacementRule } from './cityModules'
import { INVISIBLE_TEXTURE } from './textures'

export type Form = 'model' | 'flat' | 'line' | 'invisible' | 'water' | 'light' | 'sky'
export type Structure = 'standalone' | 'assembly' | 'part' | 'kit' | 'connector' | 'copy' | 'base' | 'top'
export type Role = 'building' | 'cover' | 'clutter' | 'street' | 'nature' | 'vehicle' | 'machine' | 'fence' | 'ground' | 'light' | 'sign' | 'furniture' | 'piece' | 'hidden'
export type CoverGiven = 'none' | 'crouch' | 'stand'

/** One judgement, how sure it is (0..1) and why. */
export interface Judged<T> { value: T; sure: number; why: string }

export interface CatalogEntry {
  id: string
  name: string
  /** The plain name the rules give it. */
  title: string
  form: Judged<Form>
  structure: Judged<Structure>
  role: Judged<Role>
  measures: {
    /** Metres: long side, short side, height; footprint m², bulk m³ (its box). */
    long: number; short: number; height: number; footprint: number; bulk: number
    /** Solid at eye height (0..1), when measured. */
    solid?: number
    /** A player can stand on top: low enough to jump onto (1.1 m), big enough to stand on. */
    standOn: boolean
    cover: Judged<CoverGiven>
    triangles: number
  }
  stands?: { attach: PlacementRule['attach']; facing?: string; clearFront?: number; mayVary: string[] }
  material: { surfaces: string[]; textures: number; seeThrough: boolean }
  use: { seen: number; maps: string[]; districts: string[]; near: string[] }
  /** The model it is a part, copy or kit piece of (id), and the parts it comes with (ids). */
  of?: string
  parts?: string[]
  /** A base: the models the game stands on it (the variations that fit it), most used first, with how often. */
  tops?: { id: string; n: number }[]
  /** What it stands on top of (its bases), with how often. */
  bases?: { id: string; n: number }[]
}

const SURFACE_NAMES: string[] = (catalogs as { surface_types?: string[] }).surface_types ?? []
const SUFFIXES: string[] = (catalogs as { surface_suffixes: string[] }).surface_suffixes

/** The surface a texture name gives (its suffix, as the game reads it), by name. */
export function surfaceName(tex: string): string {
  const m = tex.match(/_([a-zA-Z]{2})\.[^.]+$/)
  const i = m ? SUFFIXES.indexOf(m[1].toLowerCase()) : -1
  return SURFACE_NAMES[i < 0 ? 0 : i] ?? (i < 0 ? 'Concrete' : SUFFIXES[i])
}

/** Thinner than this (m) across one side: a sheet. Thinner across two: a line. */
const SHEET = 0.06
const LINE = 0.12
/** Highest a player jumps onto (m), and least to stand on (m across). */
const JUMP_ONTO = 1.1
const STAND_ON = 0.6
/** Cover heights (m): a crouching player hides behind CROUCH, a standing one behind STAND. */
const CROUCH = 0.9, STAND = 1.6

const CONNECTOR = /(^|_)(corner|crnr|end|endcap|cap|joint|connector|elbow|tee|junction|adapter|post|pillar|column)(_|\d|$)|corner|endcap|elbow/i
/** The game's sky objects, by their record names (gameSky.ts), and a few other sky models by name. */
const SKY = /^(sun|moon|stars|atmosphere|cloud layer|skybox|skydome|sky)$/i
const LIGHTISH = /(light|lamp|glow|flare|beam|corona|bulb)/i
const SEE_THROUGH = /(_gl|_fm|_lv)\.|alpha|glass|fence|chain|grate|grill|leaf|leaves|tree|bush/i

/** Catalogue entry for one model; `rule` is its placement rule (placement.ts), `ident` its identity (labels first). */
export function catalogEntry(e: GameObjectEntry, ident: GameIdentity = identify(e), rule?: PlacementRule): CatalogEntry {
  const [long, short, height] = e.size
  const dims = [long, short, height].sort((a, b) => a - b)
  const tex = e.tex.map((t) => t.toLowerCase())

  // Form: invisible and sky first (what the game never draws as a thing), then thin as a sheet or a line.
  let form: Judged<Form>
  if (/water/i.test(e.name) && height < 0.3 && long * short >= 1 && !tex.some((t) => /proxy/.test(t))) form = { value: 'water', sure: 0.75, why: 'A water surface (the game draws water with a shader)' }
  else if (tex.length && tex.every((t) => INVISIBLE_TEXTURE.test(t))) form = { value: 'invisible', sure: 0.9, why: tex.some((t) => /proxy/.test(t)) ? 'A stand-in shell (proxy pictures): the low-detail version seen from far away, or collision only' : 'Only placeholder pictures: the game draws nothing' }
  else if (!tex.length) form = { value: 'invisible', sure: 0.7, why: 'No pictures at all' }
  else if (SKY.test(e.name) || (e.raw ?? []).some((r) => SKY.test(r))) form = { value: 'sky', sure: 0.9, why: 'One of the game’s sky objects (sun, moon, stars, clouds)' }
  else if (dims[0] < SHEET && dims[1] < LINE && dims[2] > 1) form = { value: 'line', sure: 0.8, why: `Thin both ways (${fmt(dims[0])} × ${fmt(dims[1])} m) and ${fmt(dims[2])} m long: a wire, cable or rail` }
  else if (dims[0] < SHEET && dims[1] > 0.2) form = { value: 'flat', sure: 0.85, why: `Only ${fmt(dims[0])} m thick across ${fmt(dims[1])} × ${fmt(dims[2])} m: a sheet (decal, sign, poster, window)` }
  else if (ident.kind === 'light' && (LIGHTISH.test(e.name) || tex.some((t) => LIGHTISH.test(t))) && e.tris <= 300) form = { value: 'light', sure: 0.6, why: 'A small lamp or glow model' }
  else form = { value: 'model', sure: 0.9, why: `Solid shape ${fmt(long)} × ${fmt(short)} × ${fmt(height)} m` }

  // Structure: a copy or a part says so outright (the game places them with another); kit pieces belong to one
  // building kind; connectors by name and shape; assemblies come with parts; the rest stand alone.
  let structure: Judged<Structure>
  const onTop = (e.tops ?? []).reduce((a, t) => a + t.n, 0), under = e.bases?.[0]
  if (e.copyOf) structure = { value: 'copy', sure: 0.9, why: 'Always at the same spot as another model of its size (a second copy or its damaged state)' }
  else if (e.tops?.length && onTop >= Math.max(2, 0.4 * e.seen) && height <= 1.5 && ident.role !== 'building')
    structure = { value: 'base', sure: onTop >= 0.8 * e.seen ? 0.85 : 0.65, why: `Something stands on it in ${Math.min(onTop, e.seen)} of its ${e.seen} placements: ${e.tops.length} variation${e.tops.length === 1 ? '' : 's'}` }
  else if (under && under.n >= 0.5 * e.seen) structure = { value: 'top', sure: under.n >= 0.8 * e.seen ? 0.85 : 0.65, why: `Stands on a base in ${under.n} of its ${e.seen} placements` }
  else if (e.partOf || ident.partOf) structure = { value: 'part', sure: 0.85, why: 'The game nearly always places it at one spot of a bigger model' }
  else if (e.kitOf) structure = { value: 'kit', sure: 0.85, why: `Only ever used on buildings of kind ${e.kitOf}` }
  else if (CONNECTOR.test(e.name) && dims[2] < 4 && (ident.role === 'fence' || ident.role === 'piece')) structure = { value: 'connector', sure: 0.6, why: 'Named as a corner, end, cap, post or joint of a wall, fence or rail' }
  else if (e.assembly?.length) structure = { value: 'assembly', sure: 0.85, why: `Comes with ${e.assembly.length} part${e.assembly.length === 1 ? '' : 's'} the game always places with it` }
  else if (ident.role === 'piece') structure = { value: 'part', sure: 0.55, why: 'A piece of something bigger (a wall, window, roof or trim), by its name' }
  else structure = { value: 'standalone', sure: e.seen >= 3 ? 0.8 : 0.6, why: `Placed on its own${e.seen ? `, ${e.seen} time${e.seen === 1 ? '' : 's'}` : ''}` }

  const role = roleOf(ident, form.value)
  const solid = e.eye ?? e.sits?.cover
  const standOn = height <= JUMP_ONTO && short >= STAND_ON && form.value === 'model'
  const blocks = solid === undefined ? form.value === 'model' : solid >= 0.5
  const cover: Judged<CoverGiven> = !blocks || height < CROUCH * 0.8
    ? { value: 'none', sure: solid === undefined ? 0.5 : 0.8, why: blocks ? `Only ${fmt(height)} m tall` : 'See-through at eye height' }
    : height < STAND ? { value: 'crouch', sure: 0.7, why: `${fmt(height)} m tall: hides a crouching player` }
      : { value: 'stand', sure: solid === undefined ? 0.6 : 0.8, why: `${fmt(height)} m tall${solid !== undefined ? `, ${Math.round(solid * 100)}% solid at eye height` : ''}` }

  const surfaces = [...new Set(tex.filter((t) => !INVISIBLE_TEXTURE.test(t)).map(surfaceName))]
  return {
    id: e.id, name: e.name, title: ident.name, form, structure, role,
    measures: { long, short, height, footprint: +(long * short).toFixed(2), bulk: +(long * short * height).toFixed(2), ...(solid !== undefined ? { solid } : {}), standOn, cover, triangles: e.tris },
    ...(rule ? { stands: { attach: rule.attach, ...(rule.facing ? { facing: rule.facing } : {}), ...(rule.clearFront ? { clearFront: rule.clearFront } : {}), mayVary: rule.mayVary } } : {}),
    material: { surfaces, textures: tex.length, seeThrough: tex.some((t) => SEE_THROUGH.test(t)) },
    use: { seen: e.seen, maps: (e.where ?? []).filter((w) => w !== 'city'), districts: e.districts ?? [], near: (e.near ?? []).slice(0, 5).map((n) => n.id) },
    ...(e.copyOf || e.partOf || e.kitOf ? { of: e.copyOf ?? e.partOf ?? e.belongsTo?.[0] } : {}),
    ...(e.assembly?.length ? { parts: e.assembly.map((a) => a.id) } : {}),
    ...(e.tops?.length ? { tops: e.tops.map(({ id, n }) => ({ id, n })) } : {}),
    ...(e.bases?.length ? { bases: e.bases } : {}),
  }
}

/** The role, from the identity rules (and what it looks like). */
function roleOf(ident: GameIdentity, form: Form): Judged<Role> {
  if (form === 'invisible') return { value: 'hidden', sure: 0.9, why: 'Not drawn' }
  if (form === 'sky') return { value: 'hidden', sure: 0.7, why: 'Part of the sky' }
  if (form === 'water') return { value: 'ground', sure: 0.6, why: 'A water surface' }
  const byRole: Partial<Record<GameRole, Role>> = { building: 'building', fence: 'fence', ground: 'ground', piece: 'piece', skip: 'hidden' }
  const byKind: Record<PropKind, Role> = { cover: 'cover', clutter: 'clutter', street: 'street', nature: 'nature', light: 'light', vehicle: 'vehicle', sign: 'sign', furniture: 'furniture', machine: 'machine' }
  if (ident.role === 'prop' && ident.kind) return { value: byKind[ident.kind], sure: 0.75, why: `${ident.category}: ${ident.name}` }
  const r = byRole[ident.role]
  if (r) return { value: r, sure: ident.role === 'piece' ? 0.6 : 0.8, why: `${ident.category}: ${ident.name}` }
  if (form === 'flat') return { value: 'sign', sure: 0.5, why: 'A flat sheet' }
  return { value: 'clutter', sure: 0.4, why: `${ident.category}: ${ident.name}` }
}

const fmt = (v: number) => (v >= 10 ? Math.round(v).toString() : v.toFixed(v >= 1 ? 1 : 2))

/** The player's corrections on top (labels.ts): what they set is sure; a model they marked right is sure all round. */
export function withCorrections(c: CatalogEntry, l?: { ok?: boolean; form?: Form; structure?: Structure }): CatalogEntry {
  if (!l || (!l.ok && !l.form && !l.structure)) return c
  const mine = <T,>(j: Judged<T>, v?: T): Judged<T> => (v !== undefined ? { value: v, sure: 1, why: 'Set by you' } : l.ok ? { ...j, sure: 1, why: j.why + ' (checked by you)' } : j)
  return { ...c, form: mine(c.form, l.form), structure: mine(c.structure, l.structure), role: l.ok ? mine(c.role) : c.role }
}

/** The whole library catalogued (once per library and labels), keyed by id. */
const made = new WeakMap<GameObjectEntry[], Map<string, Map<string, CatalogEntry>>>()
export function catalogue(entries: GameObjectEntry[], ident: (e: GameObjectEntry) => GameIdentity = identify, rule?: (e: GameObjectEntry) => PlacementRule, key = ''): Map<string, CatalogEntry> {
  let byKey = made.get(entries)
  if (!byKey) made.set(entries, byKey = new Map())
  let out = byKey.get(key)
  if (!out) {
    out = new Map()
    for (const e of entries) out.set(e.id, catalogEntry(e, ident(e), rule?.(e)))
    byKey.set(key, out)
  }
  return out
}

/** How many models fall under each value of each side, for the page's filters and a quick read of the library. */
export function tally(cat: Iterable<CatalogEntry>): Record<'form' | 'structure' | 'role' | 'cover', Record<string, number>> {
  const t = { form: {}, structure: {}, role: {}, cover: {} } as Record<'form' | 'structure' | 'role' | 'cover', Record<string, number>>
  for (const c of cat) {
    for (const [k, v] of [['form', c.form.value], ['structure', c.structure.value], ['role', c.role.value], ['cover', c.measures.cover.value]] as const) t[k][v] = (t[k][v] ?? 0) + 1
  }
  return t
}
