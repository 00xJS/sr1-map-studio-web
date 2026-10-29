// A placed prefab's parts as the one model the editor stores for it: shape
// pieces relative to where it was placed, with a material per distinct
// texture. Pure, so the share function can rebuild a prefab the same way the
// editor built it (src/play/shareBuilds.ts).
import type { Vec3 } from './project'
import { turn, type Part, type Tex } from './sampleKit'
import type { CompoundPiece } from './shapes'
import { partShape, unflicker } from './zfight'

export interface PrefabModel {
  pieces: CompoundPiece[]
  /** Material name (m0, m1... in first-use order) for a texture. */
  matOf: (t: Tex) => string
  /** The textures by material name. */
  mats: Map<string, Tex>
  origin: Vec3
  turnBy: number
}

export function prefabModel(unit: Part[]): PrefabModel {
  const tag = unit[0].prefab
  const origin = tag?.at ?? unit[0].at
  const turnBy = tag?.rot ?? 0
  const byKey = new Map<string, string>()
  const mats = new Map<string, Tex>()
  const matOf = (t: Tex) => {
    const k = JSON.stringify(t)
    let m = byKey.get(k)
    if (!m) { m = 'm' + byKey.size; byKey.set(k, m); mats.set(m, t) }
    return m
  }
  // A road network (thousands of pieces) is laid out flicker-free by construction (see roads.ts); checking it takes seconds.
  const pieces = (tag?.key === 'road' ? unit : unflicker(unit)).map((p) => {
    const [dx, dz] = turn(p.at[0] - origin[0], p.at[2] - origin[2], -turnBy)
    return { shape: partShape(p), at: [dx, p.at[1] - origin[1], dz] as Vec3, rot: (p.rot ?? 0) - turnBy, top: matOf(p.top), side: matOf(p.side) }
  })
  return { pieces, matOf, mats, origin, turnBy }
}
