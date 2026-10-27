// Physics showcase sets: ready-made groups of physics props (lib/physicsProps.ts)
// to shoot, kick and blow up. Unlike other prefabs, each prop is its own object
// with one material, so the game can move it on its own; the static parts (a
// ramp, a lane) stay one object. Placed with their base at y and turned by rot.
import { PB, box, cyl, lying, ramp, type Part, type Tex } from './sampleKit'
import { group, local, type PrefabDef } from './prefabs'
import type { PhysicsShape } from './physicsProps'
import { id } from './prefabKit'

/** What a part becomes: a physics prop with this preset (and shape), or a ball made from its size. */
export interface PhysicsTag { preset: string; shape?: PhysicsShape; bottomHeavy?: boolean; ball?: boolean }
export type PhysicsPart = Part & { physics?: PhysicsTag }

export const isPhysicsSet = (def: PrefabDef): boolean => !!(def as { physicsSet?: boolean }).physicsSet

const prop = (part: Part, preset: string, shape?: PhysicsShape, bottomHeavy?: boolean): PhysicsPart =>
  ({ ...part, physics: { preset, ...(shape ? { shape } : {}), ...(bottomHeavy ? { bottomHeavy } : {}) } })
/** A ball `d` across, its bottom at `at` (built as a sphere when placed). */
const ball = (label: string, d: number, at: [number, number, number], tex: Tex, preset: string): PhysicsPart =>
  ({ ...box(label, [d, d, d], at, tex), physics: { preset, shape: 'sphere', ball: true } })

const paint = (color: string, accent: string, seed: number, surface: number): Tex => ({ gen: 'paint', tweak: { color, accent, scale: 2, wear: 0.08, seed }, surface })
const CRATE: Tex = PB.planks
const TANK: Tex = paint('#c8302a', '#6a1410', 371, 15)
const PIN: Tex = paint('#f2efe6', '#b8b2a2', 372, 21)
const LANE: Tex = PB.plywood

/** Crates 2 units (1 m) across; stacked with a hair of space so none starts inside another. */
const C = 2, GAP = 0.02

const set = (label: string, hint: string, make: (L: (dx: number, dy: number, dz: number) => [number, number, number], x: number, y: number, z: number) => PhysicsPart[]) =>
  ({ category: 'Physics', label, hint, physicsSet: true as const, make: (x: number, z: number, rot: number, y: number) => local(x, y, z, rot, (L) => make(L, x, y, z)) })

export const PHYSICS_PREFABS: Record<string, PrefabDef & { category: string; physicsSet: true }> = {
  crate_tower: set('Crate tower', 'Ten light crates stacked in a pyramid: shoot, kick or blast it over (physics props)', (L) => {
    const out: PhysicsPart[] = []
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 4 - row; i++) out.push(prop(box('Crate', [C, C, C], L((i - (3 - row) / 2) * (C + GAP), row * (C + GAP), 0), CRATE), 'light_crate', 'box'))
    }
    return out
  }),
  tire_ramp: set('Tire ramp', 'A stack of tires and three standing tires at the top of a ramp: knock them down and watch them roll (physics props)', (L, x, y, z) => [
    ...group(id('Tire ramp', x, y, z), [
      ramp('Ramp', [8, 3, 10], L(0, 0, 0), PB.concrete),
      box('Ramp top', [8, 3, 6], L(0, 0, -8), PB.concrete),
    ]),
    ...[0, 1, 2, 3].map((k) => prop(cyl('Tire', 1.8, 0.7, L(-2, 3 + k * (0.7 + GAP), -8.5), PB.tire, PB.tire, 16), 'rolls', 'cylinder')),
    ...[-1, 1, 3].map((dx) => prop(lying('Tire', 1.8, 0.7, L(dx, 3, -5.9), PB.tire, PB.tire, 16), 'rolls', 'cylinder')),
  ]),
  propane_chain: set('Propane chain reaction', 'Eight propane tanks in a zigzag with crates at the end: shoot the first one (physics props)', (L) => [
    ...Array.from({ length: 8 }, (_, k) => prop(cyl('Propane tank', 0.9, 1.8, L((k % 2 ? 1 : -1) * 0.8, 0, -k * 3.5), TANK, TANK, 12), 'explodes', 'cylinder')),
    ...[[-1.1, 0], [1.1, 0], [0, 1]].map(([dx, row]) => prop(box('Crate', [C, C, C], L(dx, row * (C + GAP), -8 * 3.5 - 1), CRATE), 'light_crate', 'box')),
  ]),
  bowling: set('Bowling pins', 'Ten pins at the end of a lane and a heavy ball: walk into it to roll it at them (physics props)', (L, x, y, z) => {
    const pins: PhysicsPart[] = []
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i <= row; i++) pins.push(prop(cyl('Pin', 0.8, 2.4, L((i - row / 2) * 1.5, 0.3, -12 - row * 1.3), PIN, PIN, 12, 0, 4), 'wood_block', 'cylinder', true))
    }
    return [
      ...group(id('Bowling lane', x, y, z), [box('Lane', [8, 0.3, 24], L(0, 0, -6), LANE)]),
      ...pins,
      ball('Bowling ball', 1.4, L(0, 0.3, 2), PB.black, 'heavy'),
    ]
  }),
}

const fmt = (n: number) => String(+n.toFixed(5))

/** OBJ text of a ball `d` across with its bottom at the origin, one material ("m0"), outward faces. */
export function ballObj(d: number, lon = 16, lat = 10): string {
  const r = d / 2
  const v: string[] = [], vt: string[] = [], f: string[] = []
  const at = (i: number, j: number) => i * (lon + 1) + j + 1
  for (let i = 0; i <= lat; i++) {
    const th = (Math.PI * i) / lat
    for (let j = 0; j <= lon; j++) {
      const ph = (2 * Math.PI * j) / lon
      v.push(`v ${fmt(r * Math.sin(th) * Math.cos(ph))} ${fmt(r + r * Math.cos(th))} ${fmt(r * Math.sin(th) * Math.sin(ph))}`)
      vt.push(`vt ${fmt(j / lon)} ${fmt(1 - i / lat)}`)
    }
  }
  const face = (...k: number[]) => f.push('f ' + k.map((x) => `${x}/${x}`).join(' '))
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      if (i > 0) face(at(i, j), at(i, j + 1), at(i + 1, j + 1))
      if (i < lat - 1) face(at(i, j), at(i + 1, j + 1), at(i + 1, j))
    }
  }
  return ['# SR1 Map Studio ball', ...v, ...vt, 'usemtl m0', ...f].join('\n') + '\n'
}

/** A block-out shape's OBJ with its "top" and "side" materials made one ("m0"): a physics prop has one material. */
export const oneMaterial = (obj: string) => obj.replace(/^usemtl \w+$/gm, 'usemtl m0')
