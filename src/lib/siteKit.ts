// The site's own prefabs as pieces for the game dressing (gameObjects/gameDress.ts), so a Site pieces map from the
// wizard is dressed the way Stilwater dresses each kind of place too: meters and newspaper boxes along a shop
// front, dumpsters and trash bags in an alley, barriers, crates and wrecks out in the open. Each area kit name
// (areaKits.ts) maps to the prefabs that look like it, Saints Row style first; each is measured once from its parts.
import type { Vec3 } from './project'
import type { Part } from './sampleKit'
import { ALL_PREFABS } from './prefabRegistry'
import { prefabParams, tagPrefab } from './prefabs'
import { UNITS_PER_M } from './player'
import type { DressCand, DressPieces, DressStats } from './gameObjects/gameDress'
import type { Side } from './gameObjects/cityModules'

/** Area kit names (identify()'s, areaKits.ts) and the site prefabs that stand for each. */
export const SITE_NAMES: Record<string, string[]> = {
  'Parking meter': ['srparkingmeter'],
  'Newspaper box': ['srnewsboxtall', 'srnewsboxshort', 'newsbox'],
  'Trash can': ['srtrashcan', 'srstreetbin', 'srwheeliebin'],
  Bench: ['srbench'],
  Mailbox: ['srmailbox', 'postbox'],
  Payphone: ['srpayphone'],
  Bollard: ['srbollards', 'bollardrow'],
  'Dock post': ['srbollards'],
  Planter: ['srplanterpot', 'srplanterbox', 'planterbox'],
  'Fire hydrant': ['srhydrant'],
  Dumpster: ['srdumpstersmall', 'srdumpsterlarge'],
  'Trash bags': ['srtrashbags', 'trashbags', 'binbags'],
  Trash: ['srtrashbags', 'binbags'],
  Barrel: ['srdrums', 'barrels'],
  Crate: ['srcrate', 'cratestack'],
  Pallet: ['srpallets', 'pallets'],
  'Cardboard box': ['srboxes'],
  'Concrete barrier': ['srjersey'],
  Barrier: ['srbarricade', 'barricade'],
  'Wrecked car': ['srcarhusk', 'burnedcar', 'carwreck'],
  'Shipping container': ['srcontainer'],
  'Bus stop': ['srbusshelter'],
  Tire: ['srtires', 'tirestack'],
  Couch: ['couch'],
  'Cable spool': ['srspool', 'spool'],
  'Cinder block': ['srcinder'],
  Lumber: ['srlumber'],
  Brick: ['brickpallets'],
  'Substation equipment': ['transformer', 'srelecbox'],
  'Traffic cone': ['srcone', 'srconebarrel'],
  Bush: ['bush'],
  'Picnic table': ['srpicnic', 'picnic'],
}

/** Eye heights (metres) a piece has to reach to hide a crouching or a standing player. */
const CROUCH_M = 1.1, STAND_M = 1.65
/** Thinner than this (metres) it is a rail or a post, not cover. */
const THIN_M = 0.3

export interface SiteCand extends DressCand {
  key: string
  /** Its long side is along the prefab's own Z: turned a quarter more than the dressing's frame. */
  alongZ: boolean
  front?: Side
}

const measured = new Map<string, SiteCand | null>()
/** A prefab measured from its parts at the origin: symmetric extents (metres), so a spot's room covers all of it. */
function measure(key: string): SiteCand | null {
  if (measured.has(key)) return measured.get(key)!
  const def = ALL_PREFABS[key]
  let c: SiteCand | null = null
  if (def) {
    let ex = 0, ez = 0, top = 0
    for (const p of def.make(0, 0, 0, 1, prefabParams(def))) {
      const t = ((p.rot ?? 0) * Math.PI) / 180, cs = Math.abs(Math.cos(t)), sn = Math.abs(Math.sin(t))
      ex = Math.max(ex, Math.abs(p.at[0]) + (p.size[0] * cs + p.size[2] * sn) / 2)
      ez = Math.max(ez, Math.abs(p.at[2]) + (p.size[0] * sn + p.size[2] * cs) / 2)
      top = Math.max(top, p.at[1] + p.size[1] - 1)
    }
    const M = UNITS_PER_M, alongZ = ez > ex
    const long = (2 * Math.max(ex, ez)) / M, short = (2 * Math.min(ex, ez)) / M, h = top / M
    const cover = short < THIN_M ? 'none' : h >= STAND_M ? 'stand' : h >= CROUCH_M ? 'crouch' : 'none'
    // Saints Row style pieces face local +Z (a bench, a shelter); a long piece along Z (a car) has no front to keep.
    c = { key, long, short, h, alongZ, cat: { measures: { cover: { value: cover } } }, ...(key.startsWith('sr') && !alongZ ? { front: '+z' as const } : {}) }
  }
  measured.set(key, c)
  return c
}

/** The dressing's six methods over the site's prefabs (gameDress.ts). */
export class SiteKit implements DressPieces<SiteCand> {
  dressed?: DressStats
  private used = new Map<string, number>()
  private of(name: string) { return (SITE_NAMES[name] ?? []).map(measure).filter((c): c is SiteCand => !!c) }

  hasNamed(name: string) { return this.of(name).length > 0 }

  coverOf(name: string): 'none' | 'crouch' | 'stand' {
    const l = this.of(name).map((c) => c.cat.measures.cover.value)
    return l.includes('stand') ? 'stand' : l.includes('crouch') ? 'crouch' : 'none'
  }

  /** The best fit, the least used of those first (so a kit name's prefabs take turns). */
  named(name: string, fit: (c: SiteCand) => number): SiteCand | null {
    let best: SiteCand | null = null, bw = 0, bu = Infinity
    for (const c of this.of(name)) {
      const w = fit(c), u = this.used.get(c.key) ?? 0
      if (w > 0 && (w > bw || (w === bw && u < bu))) { best = c; bw = w; bu = u }
    }
    return best
  }

  frontOf(c: SiteCand): Side | undefined { return c.front }

  place(c: SiteCand, _label: string, at: Vec3, rot: number): Part[] | null {
    const def = ALL_PREFABS[c.key], params = prefabParams(def)
    const r = (((rot + (c.alongZ ? 90 : 0)) % 360) + 360) % 360
    return tagPrefab(def.make(at[0], at[2], r, at[1], params), c.key, params, at, r)
  }

  commit(c: SiteCand) { this.used.set(c.key, (this.used.get(c.key) ?? 0) + 1) }
}
