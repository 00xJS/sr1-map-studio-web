// Cyber arena life: holo signs, digital rain screens and pillars, cable
// bundles, consoles, scoreboards, light strips, lane arrows, team base
// markings and warning stripes, so a neon arena looks lived-in and high-tech.
// Also the pass that dresses a built cyber sample with them: screens and light
// trims on its walls, glowing edges on its platforms, a marking under each
// team's start, arrows down the lane from it, stripes at the foot of ramps and
// lights where the glow is.
import type { Vec3 } from './project'
import { CY, LIGHT, box, cyl, lying, turn, type Part, type Sample, type Tex } from './sampleKit'
import { group, local, type ParamDef, type Params, type PrefabDef } from './prefabs'
import { over } from './sampleScale'
import type { TextureKind } from './procedural'

const id = (name: string, x: number, y: number, z: number) => `${name}@${+x.toFixed(2)},${+y.toFixed(2)},${+z.toFixed(2)}`
/** A prefab with settings: returns its params and a make that fills in defaults. */
const pfp = (name: string, params: ParamDef[], make: (L: (dx: number, dy: number, dz: number) => [number, number, number], p: Params) => Part[]) => ({
  params,
  make: (x: number, z: number, rot: number, y: number, given?: Params) => {
    const p = Object.fromEntries(params.map((d) => [d.key, given?.[d.key] ?? d.default]))
    return group(id(name, x, y, z), local(x, y, z, rot, (L) => make(L, p)))
  },
})

/** Glow colors, including the two team colors (red starts at −Z, blue at +Z). */
export const GLOW: Record<string, string> = {
  cyan: '#18d8ff', pink: '#ff3dd8', purple: '#9b5cff', lime: '#8cff3a', orange: '#ff9a1f', white: '#e8f6ff', red: '#ff2f4f', blue: '#2a86ff',
}
const GLOW_OPTIONS: [string, string][] = [['cyan', 'Cyan'], ['pink', 'Pink'], ['purple', 'Purple'], ['lime', 'Lime'], ['orange', 'Orange'], ['white', 'White'], ['red', 'Red team'], ['blue', 'Blue team']]
const glowParam = (d: string): ParamDef => ({ key: 'color', label: 'Glow', kind: 'select', options: GLOW_OPTIONS, default: d })
const num = (key: string, label: string, min: number, max: number, step: number, d: number): ParamDef => ({ key, label, kind: 'number', min, max, step, default: d })

/** Light color (0..1) for each glow. */
export const GLOW_LIGHT: Record<string, Vec3> = {
  cyan: LIGHT.cyan, pink: LIGHT.pink, purple: LIGHT.purple, lime: LIGHT.lime, orange: LIGHT.orange, white: LIGHT.cool, red: [1, 0.2, 0.28], blue: [0.22, 0.5, 1],
}
/** The rain screens' light: code green. */
export const RAIN_LIGHT: Vec3 = [0.3, 1, 0.5]

const SEEDS: Record<string, number> = { cyan: 0, pink: 1, purple: 2, lime: 3, orange: 4, white: 5, red: 6, blue: 7 }
const gen = (kind: TextureKind, color: string, accent: string, seed: number, scale: number, wear = 0): Tex => ({ gen: kind, tweak: { color, accent, scale, wear, seed }, surface: 15 })
/** Solid glowing neon in any glow color. */
export const neonTex = (c: string): Tex => ({ gen: 'paint', tweak: { color: GLOW[c] ?? c, accent: GLOW[c] ?? c, scale: 2, wear: 0, seed: 470 + (SEEDS[c] ?? 9) }, surface: 17 })
/** A console screen glowing in color c. */
export const screenTex = (c: string, seed = 0): Tex => gen('screen', '#06121a', GLOW[c] ?? c, 480 + (SEEDS[c] ?? 9) * 10 + (seed % 10), 9, 0.3)
/** Lane arrows: `arrows` chevrons along the texture. */
export const arrowTex = (c: string, arrows: number): Tex => gen('chevrons', '#0b0f16', GLOW[c] ?? c, 560 + (SEEDS[c] ?? 9), Math.max(1, Math.min(12, Math.round(arrows))))
/** Team badge: red gets the star, blue the triangle. */
export const emblemTex = (team: string): Tex => gen('emblem', team === 'blue' ? '#0b1020' : '#160b10', GLOW[team] ?? team, team === 'blue' ? 571 : 570, 8)
export const SCOREBOARD: Tex = gen('scoreboard', '#e8322b', '#2a7fff', 580, 1)
const STRIPES: Tex = { gen: 'hazard', tweak: { color: '#f2c218', accent: '#15161a', scale: 6, wear: 0.15, seed: 590 }, surface: 15 }
const RUBBER: Tex = { gen: 'concrete', tweak: { color: '#1b1d22', accent: '#0f1013', wear: 0.2, seed: 591 }, surface: 18 }
const neonOf = (p: Params) => String(p.color)

export const CYBER_LIFE_PREFABS: Record<string, PrefabDef & { category: string }> = {
  holosign: { category: 'Cyber', label: 'Holo sign', hint: 'A glowing data screen floating on an emitter post', ...pfp('Holo sign', [glowParam('cyan'), num('h', 'Height', 2, 20, 0.5, 5)], (L, p) => [
    cyl('Emitter', 1.6, 0.5, L(0, 0, 0), neonTex(neonOf(p)), CY.dark, 10), box('Emitter post', [0.3, +p.h - 0.5, 0.3], L(0, 0.5, 0), CY.panel),
    box('Holo frame', [6.3, 0.15, 0.25], L(0, +p.h, 0), neonTex(neonOf(p))),
    { ...box('Holo sign', [6, 3.2, 0.1], L(0, +p.h + 0.15, 0), screenTex(neonOf(p), Math.round(+p.h)), screenTex(neonOf(p), Math.round(+p.h))), fit: true },
    box('Holo frame', [6.3, 0.15, 0.25], L(0, +p.h + 3.35, 0), neonTex(neonOf(p))),
  ]) },
  rainscreen: { category: 'Cyber', label: 'Rain screen', hint: 'A wall screen of falling green code in a frame (its back goes against a wall)', ...pfp('Rain screen', [num('w', 'Width', 2, 30, 0.5, 6), num('h', 'Height', 1, 12, 0.5, 3.5)], (L, p) => [
    box('Screen frame', [+p.w + 0.5, +p.h + 0.5, 0.3], L(0, 0, 0.15), CY.dark),
    { ...box('Rain screen', [+p.w, +p.h, 0.1], L(0, 0.25, 0.35), CY.matrix, CY.matrix), fit: true },
  ]) },
  codepillar: { category: 'Cyber', label: 'Code pillar', hint: 'A square pillar of falling digital rain', ...pfp('Code pillar', [glowParam('lime'), num('h', 'Height', 2, 30, 0.5, 6)], (L, p) => [
    box('Pillar base', [2.8, 0.6, 2.8], L(0, 0, 0), CY.dark, CY.panel), { ...box('Code pillar', [2.2, +p.h, 2.2], L(0, 0.6, 0), CY.dark, CY.matrix), fit: true },
    box('Glow band', [2.9, 0.2, 2.9], L(0, 0.6 + +p.h - 0.3, 0), neonTex(neonOf(p))), box('Pillar cap', [2.8, 0.5, 2.8], L(0, 0.6 + +p.h, 0), CY.dark, CY.panel),
  ]) },
  cables: { category: 'Cyber', label: 'Cable bundle', hint: 'Cables lying along the floor, held by clamps', ...pfp('Cables', [glowParam('cyan'), num('len', 'Length', 2, 60, 1, 8)], (L, p) => [
    lying('Cable', 0.5, +p.len, L(0, 0, -0.45), RUBBER, RUBBER, 8), lying('Cable', 0.4, +p.len, L(0, 0, 0.05), neonTex(neonOf(p)), neonTex(neonOf(p)), 8), lying('Cable', 0.35, +p.len, L(0, 0, 0.45), RUBBER, RUBBER, 8),
    ...[...Array(Math.max(1, Math.floor(+p.len / 3)))].map((_, i, a) => box('Cable clamp', [0.3, 0.6, 1.5], L(-+p.len / 2 + (+p.len * (i + 0.5)) / a.length, 0, 0), CY.panelLight)),
  ]) },
  terminal: { category: 'Cyber', label: 'Terminal', hint: 'A console desk with a glowing screen (faces +Z)', ...pfp('Terminal', [glowParam('cyan')], (L, p) => [
    { ...box('Console desk', [4, 2.2, 1.6], L(0, 0, 0), CY.panelLight, CY.panel), bevel: 0.1 }, box('Console top', [4, 0.25, 1.6], L(0, 2.2, 0), screenTex(neonOf(p), 3), CY.panel),
    box('Screen stand', [0.4, 0.65, 0.3], L(0, 2.45, -0.6), CY.dark),
    { ...box('Terminal screen', [3.6, 2, 0.12], L(0, 3.1, -0.6), screenTex(neonOf(p), 1), CY.dark), fit: true },
    box('Console light', [4, 0.12, 0.12], L(0, 2.05, 0.86), neonTex(neonOf(p))),
  ]) },
  holoscoreboard: { category: 'Cyber', label: 'Holo scoreboard', hint: 'A big two-sided score screen on legs', ...pfp('Scoreboard', [num('h', 'Height', 3, 30, 0.5, 9), num('w', 'Width', 6, 40, 1, 13)], (L, p) => [
    box('Scoreboard leg', [0.8, +p.h, 0.8], L(-+p.w / 2 + 1, 0, 0), CY.dark, CY.panel), box('Scoreboard leg', [0.8, +p.h, 0.8], L(+p.w / 2 - 1, 0, 0), CY.dark, CY.panel),
    box('Scoreboard frame', [+p.w + 0.6, +p.w * 0.46 + 0.6, 0.5], L(0, +p.h, 0), CY.dark, CY.panel),
    { ...box('Scoreboard', [+p.w, +p.w * 0.46, 0.06], L(0, +p.h + 0.3, 0.28), SCOREBOARD, SCOREBOARD), fit: true },
    { ...box('Scoreboard', [+p.w, +p.w * 0.46, 0.06], L(0, +p.h + 0.3, -0.28), SCOREBOARD, SCOREBOARD, 180), fit: true },
  ]) },
  lightstrip: { category: 'Cyber', label: 'Light strip', hint: 'A thin glowing bar for edges and floors', ...pfp('Light strip', [glowParam('cyan'), num('len', 'Length', 1, 80, 0.5, 8)], (L, p) => [box('Light strip', [+p.len, 0.25, 0.25], L(0, 0, 0), neonTex(neonOf(p)))]) },
  lanearrows: { category: 'Cyber', label: 'Lane arrows', hint: 'Glowing arrows on the floor pointing the way (toward −Z)', ...pfp('Lane arrows', [glowParam('cyan'), num('len', 'Length', 3, 80, 1, 12), num('w', 'Width', 1, 10, 0.5, 3)], (L, p) => [
    { ...box('Lane arrows', [+p.w, 0.08, +p.len], L(0, 0, 0), arrowTex(neonOf(p), +p.len / (+p.w * 1.3)), CY.dark), fit: true },
  ]) },
  teampad: { category: 'Cyber', label: 'Team base marking', hint: 'A glowing square on the floor with the team badge in the middle', ...pfp('Base marking', [{ key: 'team', label: 'Team', kind: 'select', options: [['red', 'Red'], ['blue', 'Blue']], default: 'red' }, num('size', 'Size', 6, 40, 1, 14)], (L, p) => {
    const s = +p.size, t = String(p.team), e = s * 0.45
    return [
      box('Base line', [s, 0.08, 0.6], L(0, 0, -s / 2 + 0.3), neonTex(t)), box('Base line', [s, 0.08, 0.6], L(0, 0, s / 2 - 0.3), neonTex(t)),
      box('Base line', [0.6, 0.08, s - 1.2], L(-s / 2 + 0.3, 0, 0), neonTex(t)), box('Base line', [0.6, 0.08, s - 1.2], L(s / 2 - 0.3, 0, 0), neonTex(t)),
      { ...box('Team emblem', [e, 0.08, e], L(0, 0, 0), emblemTex(t), CY.dark), fit: true },
    ]
  }) },
  hazardstrip: { category: 'Cyber', label: 'Warning stripes', hint: 'Yellow and black stripes painted on the floor', ...pfp('Warning stripes', [num('len', 'Length', 1, 40, 0.5, 4), num('w', 'Width', 0.4, 6, 0.1, 0.8)], (L, p) => [box('Warning stripes', [+p.len, 0.06, +p.w], L(0, 0, 0), STRIPES, STRIPES, 0, 2)]) },
  holocore: { category: 'Cyber', label: 'Holo core', hint: 'A data core of falling code with rings of light round it', ...pfp('Holo core', [glowParam('cyan'), num('h', 'Height', 4, 30, 0.5, 10)], (L, p) => {
    const h = +p.h
    return [
      cyl('Core base', 8, 1.2, L(0, 0, 0), neonTex(neonOf(p)), CY.dark, 12), cyl('Core plinth', 5, 1, L(0, 1.2, 0), CY.dark, CY.panel, 12),
      { ...cyl('Data core', 3.2, h, L(0, 2.2, 0), CY.matrix, CY.matrix, 12), tile: 2 }, { ...cyl('Core tip', 3.2, 1.6, L(0, 2.2 + h, 0), neonTex(neonOf(p)), neonTex(neonOf(p)), 12), taper: 0 },
      ...[0.35, 0.7].flatMap((k) => [...Array(10)].map((_, i) => {
        const a = (i * 36 * Math.PI) / 180, [dx, dz] = [Math.cos(a) * 3, Math.sin(a) * 3]
        return box('Halo ring', [1.9, 0.25, 0.25], L(dx, 2.2 + h * k, dz), neonTex(neonOf(p)), neonTex(neonOf(p)), -i * 36 - 90)
      })),
    ]
  }) },
  arrowsign: { category: 'Cyber', label: 'Neon arrow', hint: 'A glowing arrow on a post, pointing along +X', ...pfp('Neon arrow', [glowParam('orange'), num('h', 'Height', 1, 20, 0.5, 4)], (L, p) => [
    box('Arrow post', [0.3, +p.h, 0.3], L(-1.4, 0, 0), CY.panel), box('Neon arrow', [3.4, 0.5, 0.25], L(0, +p.h, 0), neonTex(neonOf(p))),
    box('Neon arrow', [1.7, 0.5, 0.25], L(1.15, +p.h, 0.5), neonTex(neonOf(p)), neonTex(neonOf(p)), 40), box('Neon arrow', [1.7, 0.5, 0.25], L(1.15, +p.h, -0.5), neonTex(neonOf(p)), neonTex(neonOf(p)), -40),
  ]) },
}

// ---------------- dressing a built map ----------------

const top = (p: Part) => p.at[1] + p.size[1]
const flat = (p: Part) => p.size[1] <= 0.3
const isFloor = (p: Part) => p.at[1] <= 0.01 && p.size[1] <= 1.01 && Math.max(p.size[0], p.size[2]) >= 40
const WALL = /^(Wall|Ring wall|Outer wall)$/
const hdg = (dx: number, dz: number) => +((Math.atan2(dx, dz) * 180) / Math.PI).toFixed(2)
/** Team tint by end of the map: red at −Z, blue at +Z, purple along the sides. */
const tint = (x: number, z: number) => (Math.abs(z) < Math.abs(x) * 0.6 ? 'purple' : z < 0 ? 'red' : 'blue')

/** Something solid (not paint) at (x, z) between heights y0 and y1. */
const solidAt = (parts: Part[], x: number, z: number, y0: number, y1: number, margin = 0) =>
  parts.some((q) => !flat(q) && !isFloor(q) && q.at[1] < y1 && top(q) > y0 && over(q, x, z, margin))
/** A flat top at height y under (x, z). */
const floorAt = (parts: Part[], x: number, z: number, y: number) =>
  parts.some((q) => (q.kind === 'box' || q.kind === 'cylinder') && !q.lie && Math.abs(top(q) - y) < 0.05 && over(q, x, z, -0.1))

function place(key: string, x: number, y: number, z: number, rot: number, params: Params): Part[] {
  const def = CYBER_LIFE_PREFABS[key]
  const full = Object.fromEntries((def.params ?? []).map((d) => [d.key, params[d.key] ?? d.default]))
  const at: Vec3 = [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)], r = +(((rot % 360) + 360) % 360).toFixed(2)
  const id = `${key}@${at.join(',')}`
  return def.make(at[0], at[2], r, at[1], full).map((q) => ({ ...q, group: id, prefab: { key, params: full, at, rot: r } }))
}

/** A wall's long axis, inward normal (toward the map's middle) and half thickness. */
function wallFrame(p: Part) {
  const alongX = p.size[0] >= p.size[2]
  const len = alongX ? p.size[0] : p.size[2], half = (alongX ? p.size[2] : p.size[0]) / 2
  const [ax, az] = turn(alongX ? 1 : 0, alongX ? 0 : 1, p.rot ?? 0)
  let [nx, nz] = turn(alongX ? 0 : 1, alongX ? 1 : 0, p.rot ?? 0)
  if (nx * -p.at[0] + nz * -p.at[2] < 0) { nx = -nx; nz = -nz }
  return { len, half, ax, az, nx, nz }
}

export interface LifeOptions {
  /** Most lights the map should have in all (the life pass adds up to this many). */
  lights: number
  /** Distance between wall screens. */
  screenEvery: number
}

/** Dresses a built cyber map: wall screens and trims, platform edge lights, team markings, lane arrows, ramp stripes and lights at the glow. */
export function cyberLife(s: Sample, o: LifeOptions = { lights: 24, screenEvery: 22 }): Sample {
  const base = s.parts
  const add: Part[] = []
  const lights: [Vec3, Vec3?][] = []
  const floors = base.filter(isFloor)
  const ground = floors.length ? Math.max(...floors.map(top)) : 1
  const markers = s.markers.map(([, p]) => p)
  const nearMarker = (x: number, z: number, y: number, r: number) => markers.some((m) => Math.abs(m[1] - y) < 3 && Math.hypot(m[0] - x, m[2] - z) < r)

  // Outer walls: a light strip on the inner top edge; rain screens with a conduit and cables where the wall is tall,
  // no two screens closer than screenEvery (round a ring of short walls, every other one).
  const placed: [number, number][] = []
  for (const w of base.filter((p) => p.kind === 'box' && WALL.test(p.label))) {
    const f = wallFrame(w)
    const t = tint(w.at[0], w.at[2])
    const [ex, ez] = [w.at[0] + f.nx * (f.half - 0.15), w.at[2] + f.nz * (f.half - 0.15)]
    add.push(...place('lightstrip', ex, top(w), ez, hdg(f.ax, f.az) - 90, { color: t, len: +(f.len - 0.6).toFixed(2) }))
    const high = top(w) - ground
    if (high < 5.5 || f.len < 9) continue
    const count = Math.max(1, Math.floor(f.len / o.screenEvery))
    const lit: { along: number; at: Vec3 }[] = []
    for (let i = 0; i < count; i++) {
      const along = (i + 0.5) * (f.len / count) - f.len / 2
      if (Math.abs(along) > f.len / 2 - 4) continue
      const [fx, fz] = [w.at[0] + f.ax * along + f.nx * f.half, w.at[2] + f.az * along + f.nz * f.half]
      // Room in front of the wall: nothing standing there, no spawn or pickup right under it.
      const clear = [-4, 0, 4].every((d) => !solidAt(base, fx + f.ax * d + f.nx * 1.2, fz + f.az * d + f.nz * 1.2, ground + 0.3, ground + 6.5, 0.2))
      if (!clear || nearMarker(fx + f.nx * 2, fz + f.nz * 2, ground, 3) || placed.some(([x, z]) => Math.hypot(x - fx, z - fz) < o.screenEvery * 0.8)) continue
      placed.push([fx, fz])
      const sh = Math.min(4, high - 3.2), sw = Math.min(8, f.len - 3)
      const rot = hdg(f.nx, f.nz)
      add.push(...place('rainscreen', fx, ground + 2.4, fz, rot, { w: sw, h: sh }))
      add.push(...place('lightstrip', fx + f.nx * 0.2, ground + 2.4 + sh + 0.5, fz + f.nz * 0.2, rot, { color: t, len: sw + 0.5 }).map((q) => ({ ...q, size: [q.size[0], 0.15, 0.4] as Vec3 })))
      // Its feed: a conduit down to the floor and a cable bundle running off along the wall.
      const side = along > 0 ? 1 : -1
      const [cx, cz] = [fx + f.ax * side * (sw / 2 - 0.8) + f.nx * 0.25, fz + f.az * side * (sw / 2 - 0.8) + f.nz * 0.25]
      add.push(...group(`Conduit@${cx.toFixed(2)},${cz.toFixed(2)}`, [box('Conduit', [0.6, 2.4, 0.5], [cx, ground, cz], CY.panelLight, CY.panel, rot)]))
      const run = Math.min(10, f.len / 2 - Math.abs(along) - 2)
      if (run >= 3) {
        const mid = sw / 2 - 0.8 + run / 2
        const [kx, kz] = [fx + f.ax * side * mid + f.nx * 0.9, fz + f.az * side * mid + f.nz * 0.9]
        if (!solidAt(base, kx, kz, ground + 0.1, ground + 2, 0.6 + run / 2) && !nearMarker(kx, kz, ground, run / 2 + 1)) add.push(...place('cables', kx, ground, kz, hdg(f.ax, f.az) - 90, { color: t, len: +run.toFixed(1) }))
      }
      lit.push({ along, at: [fx + f.nx * 4, ground + 5, fz + f.nz * 4] })
    }
    // A green light in front of the wall's middle screen(s).
    const mid = Math.min(...lit.map((l) => Math.abs(l.along)))
    for (const l of lit) if (Math.abs(l.along) - mid < 0.01) lights.push([l.at, RAIN_LIGHT])
  }

  // Raised blocks and platforms: a glowing band just under the top edge, all the way round.
  for (const p of base) {
    if (p.group || WALL.test(p.label) || isFloor(p) || p.lie || p.size[1] < 1.5 || top(p) < ground + 1.5) continue
    const t = tint(p.at[0], p.at[2])
    const color = /Core|core/.test(p.label) ? 'cyan' : t
    const y = top(p) - 0.45
    if (p.kind === 'cylinder' && Math.min(p.size[0], p.size[2]) >= 4) {
      add.push(...group(`Glow band@${p.at.join(',')}`, [{ ...cyl('Glow band', p.size[0] + 0.24, 0.25, [p.at[0], y, p.at[2]], neonTex(color), neonTex(color), p.segments ?? 16, p.rot ?? 0), size: [p.size[0] + 0.24, 0.25, p.size[2] + 0.24] }]))
    } else if (p.kind === 'box' && Math.min(p.size[0], p.size[2]) >= 3 && Math.max(p.size[0], p.size[2]) <= 80) {
      const [w, , d] = p.size, r = p.rot ?? 0
      const edge = (dx: number, dz: number, len: number, along: boolean): Part => {
        const [ox, oz] = turn(dx, dz, r)
        return box('Edge light', along ? [len, 0.25, 0.14] : [0.14, 0.25, len], [p.at[0] + ox, y, p.at[2] + oz], neonTex(color), neonTex(color), r)
      }
      add.push(...group(`Edge lights@${p.at.join(',')}`, [edge(0, d / 2 + 0.07, w, true), edge(0, -d / 2 - 0.07, w, true), edge(w / 2 + 0.07, 0, d, false), edge(-w / 2 - 0.07, 0, d, false)]))
    }
  }

  // Team starts: a marking under each team's spawns, arrows down the lane toward the middle, a light over it.
  for (const team of ['red', 'blue'] as const) {
    const sp = s.markers.filter(([t]) => t === (team === 'red' ? 'Red team spawn' : 'Blue team spawn')).map(([, p]) => p)
    if (!sp.length) continue
    const y = sp[0][1]
    if (sp.some((p) => p[1] !== y)) continue
    const xs = sp.map((p) => p[0]), zs = sp.map((p) => p[2])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2
    let size = Math.max(10, Math.min(26, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 6))
    // As big as the floor allows without its lines running under a wall or a barrier.
    const edge = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0], [-0.5, 1], [0.5, 1], [-0.5, -1], [0.5, -1], [1, 0.5], [1, -0.5], [-1, 0.5], [-1, -0.5]]
    const fits = (sz: number) => edge.every(([a, b]) => { const x = cx + (a * sz) / 2, z = cz + (b * sz) / 2; return floorAt(base, x, z, y) && !solidAt(base, x, z, y + 0.1, y + 3, 0.3) })
    while (size >= 6 && !fits(size)) size -= 1
    if (size < 6) continue
    add.push(...place('teampad', cx, y, cz, 0, { team, size }))
    lights.unshift([[cx, y + 8, cz], GLOW_LIGHT[team]])
    // Arrows from the marking's front edge toward the middle, as far as the floor is open.
    const len0 = Math.hypot(cx, cz)
    if (len0 < 1) continue
    const dx = -cx / len0, dz = -cz / len0
    let run = 0
    for (let d = size / 2 + 1; d < len0 - 2; d += 1) {
      const x = cx + dx * d, z = cz + dz * d
      const ok = [-1.8, 0, 1.8].every((k) => floorAt(base, x - dz * k, z + dx * k, y) && !solidAt(base, x - dz * k, z + dx * k, y + 0.12, y + 3.4, 0.3))
      if (!ok) break
      run = d - size / 2 - 1
    }
    run = Math.min(run, 30)
    if (run >= 6) {
      const mid = size / 2 + 1 + run / 2
      add.push(...place('lanearrows', cx + dx * mid, y, cz + dz * mid, hdg(-dx, -dz), { color: team, len: Math.floor(run), w: 3 }))
    }
  }

  // Ramps and stairs up from the floor: warning stripes across the foot.
  for (const p of base) {
    if ((p.kind !== 'ramp' && p.kind !== 'stairs') || p.size[0] > 10 || /Seating|Jump/.test(p.label)) continue
    const [ox, oz] = turn(0, p.size[2] / 2 + 0.6, p.rot ?? 0)
    const x = p.at[0] + ox, z = p.at[2] + oz
    if (!floorAt(base, x, z, p.at[1]) || solidAt(base, x, z, p.at[1] + 0.1, p.at[1] + 3, 0.5)) continue
    add.push(...place('hazardstrip', x, p.at[1], z, p.rot ?? 0, { len: p.size[0], w: 0.8 }))
  }

  // Lights where the glow is, up to the map's budget (its own lights first).
  const room = Math.max(0, o.lights - (s.lights?.length ?? 0))
  return { ...s, parts: [...base, ...add], lights: [...(s.lights ?? []), ...lights.slice(0, room)] }
}
