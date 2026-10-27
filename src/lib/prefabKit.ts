// The small helpers every prefab pack uses to declare its pieces, in one place.
import { group, local, type ParamDef, type Params } from './prefabs'
import type { Part, Tex } from './sampleKit'

/** A point in a piece's own frame, placed in the map. */
export type Lf = (dx: number, dy: number, dz: number) => [number, number, number]

/** The group id of one placed piece: its name and where it stands. */
export const id = (name: string, x: number, y: number, z: number) => `${name}@${+x.toFixed(2)},${+y.toFixed(2)},${+z.toFixed(2)}`

/** A prefab without settings. */
export const pf = (name: string, make: (L: Lf) => Part[]) =>
  (x: number, z: number, rot: number, y: number) => group(id(name, x, y, z), local(x, y, z, rot, make))

/** A prefab with settings: returns its params and a make that fills in defaults. */
export const pfp = (name: string, params: ParamDef[], make: (L: Lf, p: Params) => Part[]) => ({
  params,
  make: (x: number, z: number, rot: number, y: number, given?: Params) => {
    const p = Object.fromEntries(params.map((d) => [d.key, given?.[d.key] ?? d.default]))
    return group(id(name, x, y, z), local(x, y, z, rot, (L) => make(L, p)))
  },
})

export const num = (key: string, label: string, min: number, max: number, def: number, step = 1): ParamDef => ({ key, label, kind: 'number', min, max, step, default: def })
export const sel = (key: string, label: string, options: [string, string][], def: string): ParamDef => ({ key, label, kind: 'select', options, default: def })
export const yesNo = (key: string, label: string, def: 'yes' | 'no'): ParamDef => sel(key, label, [['yes', 'Yes'], ['no', 'No']], def)

/** A plain painted colour with a little wear. */
export const solid = (color: string, accent: string, seed: number, surface = 17): Tex => ({ gen: 'paint', tweak: { color, accent, scale: 2, wear: 0.06, seed }, surface })
