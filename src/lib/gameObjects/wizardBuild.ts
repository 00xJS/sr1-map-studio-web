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
import { SOLID_COVER, fitsStandIn, modelTurn } from './wizardPieces'

/** The model's extents along X and Z as stored (editor units). */
function extents(m: ObjModel): [number, number] {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let i = 0; i < m.positions.length; i += 3) {
    x0 = Math.min(x0, m.positions[i]); x1 = Math.max(x1, m.positions[i])
    z0 = Math.min(z0, m.positions[i + 2]); z1 = Math.max(z1, m.positions[i + 2])
  }
  return [x1 - x0, z1 - z0]
}

/** Eye height band players look through, editor units above the model's feet (0.3 to 2.5 m). */
const EYE: [number, number] = [0.6, 5]
const CELLS = 24

/**
 * How much of the model, seen side-on from X and from Z, is solid at eye height (0..1, the less of the two): a
 * building is nearly 1; a canopy on posts, a billboard frame or a light rig is far less.
 */
export function eyeCover(m: Pick<ObjModel, 'positions' | 'faces'>): number {
  const P = m.positions
  let lo = Infinity
  for (const axis of [0, 2]) {
    let a0 = Infinity, a1 = -Infinity
    for (let i = 0; i < P.length; i += 3) { a0 = Math.min(a0, P[i + axis]); a1 = Math.max(a1, P[i + axis]) }
    const span = a1 - a0
    if (!(span > 0)) return 0
    // Cells across the side view (along `axis`) and up the eye band; a cell is solid when a triangle covers its middle.
    const hit = new Uint8Array(CELLS * CELLS)
    const cu = (u: number) => ((u - a0) / span) * CELLS - 0.5, cv = (v: number) => ((v - EYE[0]) / (EYE[1] - EYE[0])) * CELLS - 0.5
    for (let t = 0; t < m.faces.length; t += 3) {
      const ia = m.faces[t] * 3, ib = m.faces[t + 1] * 3, ic = m.faces[t + 2] * 3
      const ax = cu(P[ia + axis]), ay = cv(P[ia + 1]), bx = cu(P[ib + axis]), by = cv(P[ib + 1]), cx = cu(P[ic + axis]), cy = cv(P[ic + 1])
      const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
      if (Math.abs(d) < 1e-9) continue
      const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx))), i1 = Math.min(CELLS - 1, Math.floor(Math.max(ax, bx, cx)))
      const j0 = Math.max(0, Math.ceil(Math.min(ay, by, cy))), j1 = Math.min(CELLS - 1, Math.floor(Math.max(ay, by, cy)))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const w1 = ((bx - i) * (cy - j) - (cx - i) * (by - j)) / d, w2 = ((cx - i) * (ay - j) - (ax - i) * (cy - j)) / d
        if (w1 >= 0 && w2 >= 0 && w1 + w2 <= 1) hit[j * CELLS + i] = 1
      }
    }
    let n = 0
    for (const h of hit) n += h
    lo = Math.min(lo, n / hit.length)
  }
  return lo
}

/**
 * Scene items for the stand-ins, in their order. Ones whose model can't be read, and buildings players could see
 * through at eye height, come back in `failed` (the caller builds them as plain blocks).
 */
export async function placeGameParts(parts: Part[], ws: number, onProgress?: (t: string) => void): Promise<{ items: SceneItem[]; files: Record<string, FileRef>; failed: Part[] }> {
  await loadIndex()
  const ids = [...new Set(parts.map((p) => p.game!.id))]
  const ready = new Map<string, { ex: number; ez: number; cover: number } | null>()
  let done = 0
  // Each model is cut out and stored once, however many times the map uses it.
  await mapLimit(ids, 3, async (id) => {
    const e = entryById(id)
    try {
      if (!e) throw new Error('not in the library')
      const s = await objectFiles(e, ws)
      const m = await peekModel(s.path)
      if (!m) throw new Error('no model')
      const [ex, ez] = extents(m)
      ready.set(id, { ex, ez, cover: eyeCover(m) })
    } catch { ready.set(id, null) }
    onProgress?.(`Bringing in models from your game (${++done}/${ids.length})…`)
  })
  const items: SceneItem[] = [], files: Record<string, FileRef> = {}, failed: Part[] = []
  for (const p of parts) {
    const e = entryById(p.game!.id), r = ready.get(p.game!.id)
    // A building players would see through is built as the site's plain block in its place.
    if (!e || !r || (p.label === 'Game building' && r.cover < SOLID_COVER)) { failed.push(p); continue }
    const rot = modelTurn(r.ex, r.ez, p, identify(e).building?.front)
    // A building bigger than its footprint said would reach off its plot: the plain block instead.
    if (p.label === 'Game building' && !fitsStandIn(r.ex, r.ez, p, rot)) { failed.push(p); continue }
    const placed = await gameObjectItem(e, [p.at[0], p.at[1], p.at[2]], rot, ws)
    Object.assign(files, placed.files)
    items.push(placed.item)
  }
  return { items, files, failed }
}
