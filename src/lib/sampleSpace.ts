// What is where in a sample map, for passes that place things sensibly (the
// street dressing) and for the checks that inspect the result: footprints
// turned as the editor turns them, surface heights (ramps and stairs rise
// toward local −Z), overlaps between bodies, and a grid to find neighbours.
import type { Vec3 } from './project'
import type { Part } from './sampleKit'

const R = (deg: number) => (deg * Math.PI) / 180

/** World offset of a local (dx, dz) turned by deg (as the editor turns objects). */
export const turnBy = (dx: number, dz: number, deg: number): [number, number] => {
  const t = R(deg)
  return [dx * Math.cos(t) + dz * Math.sin(t), -dx * Math.sin(t) + dz * Math.cos(t)]
}
/** A world point in a part's own frame. */
export function toLocal(p: Part, x: number, z: number): [number, number] {
  const t = R(p.rot ?? 0), dx = x - p.at[0], dz = z - p.at[2]
  return [dx * Math.cos(t) - dz * Math.sin(t), dx * Math.sin(t) + dz * Math.cos(t)]
}
/** Footprint half sizes along the part's own x and z (round parts a little inside their box). */
function half(p: Part): [number, number] {
  const k = p.kind === 'cylinder' && !p.lie ? 0.86 : 1
  return [(p.size[0] / 2) * k, (p.size[2] / 2) * k]
}
export function inside(p: Part, x: number, z: number, margin = 0): boolean {
  const [lx, lz] = toLocal(p, x, z)
  if (p.kind === 'cylinder' && !p.lie) {
    const rx = p.size[0] / 2 + margin, rz = p.size[2] / 2 + margin
    return rx > 0 && rz > 0 && (lx / rx) ** 2 + (lz / rz) ** 2 <= 1
  }
  return Math.abs(lx) <= p.size[0] / 2 + margin && Math.abs(lz) <= p.size[2] / 2 + margin
}
export const top = (p: Part) => p.at[1] + p.size[1]
/** Surface height of a part at (x, z), or null off its footprint. */
export function heightAt(p: Part, x: number, z: number): number | null {
  if (!inside(p, x, z)) return null
  if (p.kind === 'ramp' || p.kind === 'stairs') {
    const [, lz] = toLocal(p, x, z)
    const t = Math.min(1, Math.max(0, 0.5 - lz / p.size[2]))
    const steps = p.segments ?? 8
    return p.at[1] + p.size[1] * (p.kind === 'stairs' ? Math.ceil(t * steps) / steps : t)
  }
  return top(p)
}
/** Corners of a part's footprint in the world, shrunk by `shrink`. */
export function corners(p: Part, shrink = 0): [number, number][] {
  const [hx, hz] = half(p)
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
    const [ox, oz] = turnBy(a * Math.max(0, hx - shrink), b * Math.max(0, hz - shrink), p.rot ?? 0)
    return [p.at[0] + ox, p.at[2] + oz]
  })
}
/** How deep two footprints overlap seen from above (0 when apart). */
export function penetration(a: Part, b: Part, grow = 0): number {
  let depth = Infinity
  const ca = corners(a), cb = corners(b)
  for (const p of [a, b]) {
    const t = R(p.rot ?? 0)
    for (const ax of [[Math.cos(t), -Math.sin(t)], [Math.sin(t), Math.cos(t)]] as [number, number][]) {
      const proj = (cs: [number, number][]) => { const v = cs.map(([x, z]) => x * ax[0] + z * ax[1]); return [Math.min(...v), Math.max(...v)] }
      const [a0, a1] = proj(ca), [b0, b1] = proj(cb)
      depth = Math.min(depth, Math.min(a1, b1) - Math.max(a0, b0) + grow)
      if (depth <= 0) return 0
    }
  }
  return depth
}
export const yOverlap = (a: Part, b: Part) => Math.min(top(a), top(b)) - Math.max(a.at[1], b.at[1])

/** Paint, films, water and decals: nothing to bump into. */
export const isFlat = (p: Part) => p.size[1] <= 0.13 || !!p.water || !!p.fit

/** The map's parts on a grid, to ask what stands near a spot. */
export class Space {
  private grid = new Map<string, Part[]>()
  constructor(public parts: Part[], private cell = 16) { for (const p of parts) this.add(p) }
  private keys(p: Part) {
    const cs = corners(p)
    const xs = cs.map((c) => c[0]), zs = cs.map((c) => c[1])
    const out: string[] = []
    for (let i = Math.floor(Math.min(...xs) / this.cell); i <= Math.floor(Math.max(...xs) / this.cell); i++)
      for (let j = Math.floor(Math.min(...zs) / this.cell); j <= Math.floor(Math.max(...zs) / this.cell); j++) out.push(i + ',' + j)
    return out
  }
  add(p: Part) { for (const k of this.keys(p)) { const l = this.grid.get(k); if (l) l.push(p); else this.grid.set(k, [p]) } }
  near(x: number, z: number): Part[] { return this.grid.get(Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell)) ?? [] }
  /** Everything whose footprint cells meet a part's. */
  around(p: Part): Part[] { return [...new Set(this.keys(p).flatMap((k) => this.grid.get(k) ?? []))] }
  /** Highest surface under (x, z) no higher than maxY. */
  floorAt(x: number, z: number, maxY: number, skip?: (p: Part) => boolean): { y: number; by: Part | null } {
    let y = -Infinity, by: Part | null = null
    for (const p of this.near(x, z)) {
      if (p.water || skip?.(p)) continue
      const h = heightAt(p, x, z)
      if (h !== null && h <= maxY + 1e-6 && h > y) { y = h; by = p }
    }
    return { y, by }
  }
  /** A body around height y at (x, z). */
  solidAt(x: number, y: number, z: number, skip?: (p: Part) => boolean): Part | undefined {
    return this.near(x, z).find((p) => !isFlat(p) && !skip?.(p) && p.at[1] < y && (heightAt(p, x, z) ?? -Infinity) > y)
  }
  /** Would these parts stand clear of every body here, `gap` apart (things they rest on are fine)? */
  fits(parts: Part[], gap = 0.3, skip?: (p: Part) => boolean): boolean {
    for (const a of parts) {
      if (isFlat(a)) continue
      for (const b of this.around(a)) {
        if (isFlat(b) || skip?.(b)) continue
        if (yOverlap(a, b) > 0.05 && penetration(a, b, gap) > 0) return false
      }
    }
    return true
  }
}

/** A point `d` in front of something at `at` turned `rot` (its front is local +Z). */
export const ahead = (at: Vec3, rot: number, d: number, side = 0): [number, number] => {
  const [ox, oz] = turnBy(side, d, rot)
  return [at[0] + ox, at[2] + oz]
}
