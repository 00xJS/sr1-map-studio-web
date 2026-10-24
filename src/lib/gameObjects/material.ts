// What a world material draws, worked out from its record (chunk.ts): which picture goes on which UV set at what
// tiling, the tints, the decal layers and their opacity and clamping, the blend mask of ground and street
// shaders, the normal and specular maps, self-illumination, and whether it is alpha-blended. Pure: names are
// matched by their Volition hashes (CRC-32 of the lower-cased name), the effect files' own names for shaders.
// The editor's shader patch (src/editor/gameMaterial.ts) draws the result; nothing here reads game files.
import type { Material } from './chunk'
import { volitionHash } from '../sr1char/hash'

const SLOT_NAMES = [
  'Diffuse_Map', 'Diffuse_Map_1', 'Diffuse_Map_2', 'Diffuse_Map_A', 'Diffuse_Map_B', 'Decal_Map_1', 'Decal_Map_2',
  'Normal_Map', 'Normal_Map_1', 'Normal_Map_2', 'Specular_Map', 'Specular_Map_1', 'Specular_Map_2', 'Specular_Map_4',
  'Transition_Map_2', 'Transition_Map_3', 'Transition_Map_4', 'Detail_Map_4', 'Night_Additive_Map', 'Night_Additive_Map_4',
  'Reflection_Map', 'Parallax_Map',
]
const CONST_NAMES = [
  'Diffuse_Color', 'Diffuse_Color_1', 'Diffuse_Color_2', 'Decal_Map_1_Opacity', 'Decal_Map_2_Opacity', 'Decal_Map_1_Color', 'Decal_Map_2_Color',
  'Decal_Map_1_TilingU', 'Decal_Map_1_TilingV', 'Decal_Map_2_TilingU', 'Decal_Map_2_TilingV', 'Normal_Map_TilingU', 'Normal_Map_TilingV',
  'Spec_Map_TilingU', 'Spec_Map_TilingV', 'Normal_Map_Height', 'Normal_Map_1_Height', 'Normal_Map_2_Height', 'Specular_Map_Amount',
  'Specular_Map_1_Amount', 'Specular_Map_2_Amount', 'Specular_Power', 'Specular_Power_1', 'Specular_Power_2', 'Specular_Alpha',
  'Specular_Alpha_1', 'Specular_Alpha_2', 'Specular_Color', 'Specular_Color_1', 'Specular_Color_2', 'Self_Illumination',
  'Invert_Transition_Map', 'Glass_Color', 'Glass_Opacity', 'Night_Additive_Color',
]
/** World effect names (the .fxo files of shaders.vpp_xbox2, without the extension) the editor knows how to draw. */
const SHADER_NAMES = [
  'bb-standard_s', 'bb-standard-ns_s', 'bb-standard2_s', 'bb-simple1_s', 'bb-simple2_s', 'bb-street1_s', 'bb-terrain1_s', 'bb-terrain1-ns_s',
  'bb-blend1_s', 'bb-blend1-ns_s', 'bb-blend2_s', 'bb-blend2-ns_s', 'bb-blendsimple1_s', 'bb-floatingdecal1_s', 'bb-additivedecal1_s',
  'bb-tod-window1_s', 'bb-tod-window2_s', 'bb-glass1_s', 'bb-cloth1_s', 'bb-pavement1_s', 'bb-parallax1_s', 'bb-kennygrass1_s',
  'bb-chrome1_s', 'bb-flatreflect1_s', 'bb-fresnelreflection1_s', 'standard_s',
]

const byHash = (names: string[]) => new Map(names.map((n) => [volitionHash(n), n]))
const SLOTS = byHash(SLOT_NAMES), CONSTS = byHash(CONST_NAMES), SHADERS = byHash(SHADER_NAMES)

/** A material's effect name, or its hash in hex when it is not one the editor draws. */
export const shaderName = (m: Pick<Material, 'shader'>) => SHADERS.get(m.shader) ?? (m.shader >>> 0).toString(16).padStart(8, '0')

/** Slot name -> picture, constant name -> values, with the address records per slot name. */
export function namedMaterial(m: Material) {
  const slots = new Map<string, string>(), consts = new Map<string, number[]>(), clamp = new Map<string, [boolean, boolean]>()
  m.slots.forEach((s, i) => {
    const n = SLOTS.get(s.slot)
    if (!n) return
    slots.set(n, s.texture)
    for (const a of m.address) {
      if (a.param !== i || a.mode !== 3) continue
      const c = clamp.get(n) ?? [false, false]
      if (a.axis === 1) c[0] = true
      if (a.axis === 2) c[1] = true
      clamp.set(n, c)
    }
  })
  for (const c of [...m.tiling, ...m.constants]) { const n = CONSTS.get(c.name); if (n) consts.set(n, c.values) }
  return { slots, consts, clamp }
}

/** One picture of a look: the texture name, the UV set it reads (0-3), its tiling and per-axis clamping. */
export interface LookLayer { tex: string; uv: number; repeat: [number, number]; clamp: [boolean, boolean] }

export type LookKind = 'standard' | 'terrain' | 'blend' | 'decal' | 'glass'

/**
 * How the game draws a material (section-2 maths of the world effects):
 *   colour = base * tint, then each decal mixed over it by decal.a * opacity;
 *   terrain/blend: t = mean(mask.rgb) (1 - t when inverted), colour = mix(base * tint, base2 * tint2, t);
 *   decal shaders draw only their decal, alpha = decal.a * opacity; glass is Glass_Color with decals, see-through.
 */
export interface GameLook {
  shader: string
  kind: LookKind
  base?: LookLayer
  tint: [number, number, number]
  base2?: LookLayer
  tint2?: [number, number, number]
  mask?: LookLayer
  invertMask?: boolean
  decals: { layer: LookLayer; opacity: number }[]
  normal?: LookLayer & { scale: number }
  specular: { map?: LookLayer; amount: number; color: [number, number, number]; power: number; alpha: number }
  /** Self_Illumination: an ambient lift toward twice the colour (1 = lit windows). */
  selfIllum: number
  /** Flags 0xB: a self-lit, glowing material (windows, lamps, neon). */
  glow: boolean
  /** Drawn alpha-blended (decal and glass shaders); others are opaque, with a cut-out when the picture has alpha. */
  blend: boolean
  /** Glass: how opaque it is (Glass_Opacity). */
  opacity?: number
  /** Ground and streets, seen at grazing angles (anisotropic filtering). */
  ground: boolean
}

/** Stand-in pictures that mean "nothing in this slot". */
export const EMPTY_TEXTURE = /^(missing(-alpha)?|flat-normalmap|misc-white|black|white)\.(tga|tgn|dds)$/i
const real = (t: string | undefined): t is string => !!t && !EMPTY_TEXTURE.test(t)

/**
 * The look of a material, or null for one the editor draws as before (one picture on UV0): sky, water, clouds,
 * stand-in proxies, and anything it doesn't know. `uvSets` is how many UV sets the geometry using it has, so a
 * layer on a set the mesh lacks is left out instead of stretched over it.
 */
export function describeMaterial(m: Material, uvSets = 4): GameLook | null {
  const shader = shaderName(m)
  if (!SHADERS.has(m.shader) || shader === 'standard_s' || /chrome|reflect/.test(shader)) return null
  const { slots, consts, clamp } = namedMaterial(m)
  const k = (n: string, d: number[]) => consts.get(n) ?? d
  const k1 = (n: string, d: number) => (consts.get(n) ?? [d])[0]
  const rgb = (n: string): [number, number, number] => { const v = k(n, [1, 1, 1]); return [v[0], v[1], v[2]] }
  const layer = (slot: string, uv: number, repeat: [number, number] = [1, 1]): LookLayer | undefined => {
    const tex = slots.get(slot)
    if (!real(tex) || uv >= uvSets) return undefined
    return { tex, uv, repeat, clamp: clamp.get(slot) ?? [false, false] }
  }
  const tiling = (p: string): [number, number] => [k1(p + '_TilingU', 1), k1(p + '_TilingV', 1)]
  const decal = (i: 1 | 2) => {
    const l = layer('Decal_Map_' + i, i, tiling('Decal_Map_' + i))
    const opacity = k1(`Decal_Map_${i}_Opacity`, 1)
    return l && opacity > 0 ? [{ layer: l, opacity }] : []
  }
  const specOf = (suffix: '' | '_1', map?: LookLayer) => ({
    map, amount: map ? k1(`Specular_Map${suffix}_Amount`, 0) : 0, color: rgb('Specular_Color' + suffix),
    power: k1('Specular_Power' + suffix, 60), alpha: /-ns_s$/.test(shader) ? 0 : k1('Specular_Alpha' + suffix, 0),
  })
  const normalOf = (slot: string, height: string, uv: number, repeat: [number, number] = [1, 1]) => {
    const l = layer(slot, uv, repeat)
    return l ? { ...l, scale: k1(height, 1) } : undefined
  }
  const common = { shader, selfIllum: k1('Self_Illumination', 0), glow: m.flags === 0xb }
  const ground = /terrain|blend|street|pavement|kennygrass/.test(shader) || /^ter_/i.test(slots.get('Diffuse_Map') ?? slots.get('Diffuse_Map_1') ?? '')

  if (/terrain1/.test(shader)) {
    return {
      ...common, kind: 'terrain', ground: true, blend: false,
      base: layer('Diffuse_Map_1', 0), tint: rgb('Diffuse_Color_1'), base2: layer('Diffuse_Map_2', 1), tint2: rgb('Diffuse_Color_2'),
      mask: layer('Transition_Map_3', 2), invertMask: k1('Invert_Transition_Map', 0) >= 1, decals: [],
      normal: normalOf('Normal_Map_1', 'Normal_Map_1_Height', 0), specular: specOf('_1', layer('Specular_Map_1', 0)),
    }
  }
  if (/blend/.test(shader)) {
    // blend1: one picture, two tints, mask on UV3; blendsimple1: mask on UV1; blend2: two pictures, mask on UV2.
    const two = /blend2/.test(shader)
    const base = layer(two ? 'Diffuse_Map_A' : 'Diffuse_Map', 0)
    const mask = /blendsimple1/.test(shader) ? layer('Transition_Map_2', 1) : two ? layer('Transition_Map_3', 2) : layer('Transition_Map_4', 3)
    return {
      ...common, kind: 'blend', ground: !two, blend: false,
      base, tint: rgb('Diffuse_Color_1'), base2: two ? layer('Diffuse_Map_B', 0) : base, tint2: rgb('Diffuse_Color_2'),
      mask, invertMask: k1('Invert_Transition_Map', 0) >= 1, decals: [...decal(1), ...(two ? [] : decal(2))],
      normal: normalOf('Normal_Map', 'Normal_Map_Height', 0, tiling('Normal_Map')), specular: specOf('', layer('Specular_Map', 0, tiling('Spec_Map'))),
    }
  }
  if (/floatingdecal|additivedecal/.test(shader)) {
    return {
      ...common, kind: 'decal', ground: true, blend: true, tint: [1, 1, 1], decals: decal(1),
      normal: normalOf('Normal_Map', 'Normal_Map_Height', 0, tiling('Normal_Map')), specular: specOf('', layer('Specular_Map', 0, tiling('Spec_Map'))),
    }
  }
  if (/glass/.test(shader)) {
    return { ...common, kind: 'glass', ground: false, blend: true, tint: rgb('Glass_Color'), opacity: k1('Glass_Opacity', 1), decals: [...decal(1), ...decal(2)], specular: specOf('') }
  }
  const base = layer('Diffuse_Map', 0)
  if (!base) return null
  return {
    ...common, kind: 'standard', ground, blend: false,
    base, tint: rgb(/kennygrass/.test(shader) ? 'Diffuse_Color_1' : 'Diffuse_Color'),
    decals: /simple|street|kennygrass/.test(shader) ? [] : [...decal(1), ...decal(2)],
    normal: normalOf('Normal_Map', 'Normal_Map_Height', 0, tiling('Normal_Map')),
    specular: specOf('', layer('Specular_Map', 0, tiling('Spec_Map'))),
  }
}

/** Every picture a look uses (each once). */
export function lookTextures(l: GameLook | null): string[] {
  if (!l) return []
  const all = [l.base, l.base2, l.mask, l.normal, l.specular.map, ...l.decals.map((d) => d.layer)].filter((x): x is LookLayer => !!x).map((x) => x.tex)
  return [...new Set(all)]
}

/** The UV sets a look reads (beyond UV0). */
export const lookUvSets = (l: GameLook | null) => Math.max(0, ...(l ? [l.base, l.base2, l.mask, ...l.decals.map((d) => d.layer)].map((x) => x?.uv ?? 0) : []))

/** A key that is equal for materials drawn the same (so they can share one material). */
export const lookKey = (tex: string, l: GameLook | null) => tex.toLowerCase() + (l ? '|' + JSON.stringify(l).toLowerCase() : '')
