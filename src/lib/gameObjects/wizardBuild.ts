// Building a "Game pieces" wizard map: each stand-in (a Part with `game`, see wizardPieces.ts) becomes the model
// from the player's own game, placed the way the library places one (place.ts): its files stored in this browser
// as game files (origin 'game', so the map can go into the player's own game but is never shared, published or
// synced), standing where the stand-in stood, turned so its long side and its front go where the stand-in's do.
import type { FileRef, SceneItem } from '../project'
import type { Part } from '../sampleKit'
import type { ObjModel } from '../geometry'
import { peekModel } from '../assets'
import { mapLimit } from '../hubRules'
import { entryById, loadIndex } from './client'
import { identify } from './identity'
import { gameObjectItem, objectFiles } from './place'
import { SOLID_COVER, TEXTURE_BUDGET, fitsStandIn, modelTurn } from './wizardPieces'
import { setLabels, useGameLabels } from './labels'
import { eyeCover } from './eyeCover'

export { eyeCover }

/** The model's extents along X and Z as stored (editor units). */
function extents(m: ObjModel): [number, number] {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let i = 0; i < m.positions.length; i += 3) {
    x0 = Math.min(x0, m.positions[i]); x1 = Math.max(x1, m.positions[i])
    z0 = Math.min(z0, m.positions[i + 2]); z1 = Math.max(z1, m.positions[i + 2])
  }
  return [x1 - x0, z1 - z0]
}

/**
 * The turn a model stands at in place of its stand-in, or null when the site's plain block goes there instead (a
 * building players would see through at eye height, or one bigger than its plot). `ex`, `ez`: the model's extents
 * as stored (editor units); `cover`: eyeCover. Parts of Stilwater modules and groups go exactly as their stand-in.
 */
export function placedTurn(p: Part, ex: number, ez: number, cover: number, front?: '+x' | '-x' | '+z' | '-z'): number | null {
  if (p.game!.exact) return p.rot ?? 0
  if (p.label === 'Game building' && cover < SOLID_COVER) return null
  const rot = modelTurn(ex, ez, p, front)
  return p.label === 'Game building' && !fitsStandIn(ex, ez, p, rot) ? null : rot
}

/** A model as measured once cut out: its extents as stored (editor units) and eyeCover. */
export interface Fit { ex: number; ez: number; cover: number }

/** Every game texture the stand-ins' models bring (what the wizard budgeted). */
export function mapTextures(parts: Part[]): Set<string> {
  const tex = new Set<string>()
  for (const p of parts) for (const t of entryById(p.game!.id)?.tex ?? []) tex.add(t.toLowerCase())
  return tex
}

/** Alternatives tried per building before it falls back to the site's plain block. */
const ALT_TRIES = 4

/**
 * The model a stand-in becomes and the turn it stands at: its own, or else the first of its alternatives (GamePart.alts)
 * that is solid at eye height, fits the plot and keeps the map within its texture budget (`tex`, the map's textures,
 * gets the new ones). Null: the site's plain block goes there.
 */
export async function standing(p: Part, measure: (id: string) => Promise<Fit | null>, tex: Set<string>): Promise<{ id: string; rot: number } | null> {
  const ids = [p.game!.id, ...(p.game!.alts ?? []).slice(0, ALT_TRIES)]
  for (const [i, id] of ids.entries()) {
    const e = entryById(id)
    if (!e) continue
    const fresh = i ? e.tex.map((t) => t.toLowerCase()).filter((t) => !tex.has(t)) : []
    if (tex.size + new Set(fresh).size > TEXTURE_BUDGET) continue
    const r = await measure(id)
    const rot = r ? placedTurn(p, r.ex, r.ez, r.cover, identify(e).building?.front) : null
    if (rot === null) continue
    for (const t of fresh) tex.add(t)
    return { id, rot }
  }
  return null
}

/**
 * Scene items for the stand-ins, in their order. A building that turns out see-through at eye height or too big for
 * its plot is swapped for one of its alternatives; ones still without a model come back in `failed` (the caller
 * builds them as plain blocks). Every building measured is remembered in the player's labels, so later maps leave
 * out the see-through ones from the start.
 */
export async function placeGameParts(parts: Part[], ws: number, onProgress?: (t: string) => void): Promise<{ items: SceneItem[]; files: Record<string, FileRef>; failed: Part[] }> {
  await loadIndex()
  const ids = [...new Set(parts.map((p) => p.game!.id))]
  const ready = new Map<string, Promise<Fit | null>>()
  // Each model is cut out and stored once, however many times the map uses it.
  const measure = (id: string) => {
    let r = ready.get(id)
    if (!r) {
      r = (async () => {
        const e = entryById(id)
        if (!e) return null
        const s = await objectFiles(e, ws)
        const m = await peekModel(s.path)
        if (!m) return null
        const [ex, ez] = extents(m)
        return { ex, ez, cover: eyeCover(m) }
      })().catch(() => null)
      ready.set(id, r)
    }
    return r
  }
  let done = 0
  await mapLimit(ids, 3, async (id) => {
    await measure(id)
    onProgress?.(`Bringing in models from your game (${++done}/${ids.length})…`)
  })
  const tex = mapTextures(parts)
  const items: SceneItem[] = [], files: Record<string, FileRef> = {}, failed: Part[] = []
  for (const p of parts) {
    const s = await standing(p, measure, tex)
    if (!s) { failed.push(p); continue }
    const placed = await gameObjectItem(entryById(s.id)!, [p.at[0], p.at[1], p.at[2]], s.rot, ws)
    Object.assign(files, placed.files)
    items.push(placed.item)
  }
  // How solid each building measured is, for the wizard's next maps (as "Check game pieces" measures it).
  const known = useGameLabels.getState().labels, covers: Record<string, { cover: number }> = {}
  const buildings = new Set(parts.filter((p) => p.label === 'Game building').flatMap((p) => [p.game!.id, ...(p.game!.alts ?? [])]))
  for (const [id, r] of ready) {
    const fit = await r
    if (fit && buildings.has(id) && known[id]?.cover === undefined) covers[id] = { cover: +fit.cover.toFixed(3) }
  }
  if (Object.keys(covers).length) await setLabels(covers).catch(() => {})
  return { items, files, failed }
}
