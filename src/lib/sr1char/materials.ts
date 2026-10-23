// Ported from SR1-Creator (github.com/00xJS/SR1-Creator)
// Materials ported from the game's own pixel shaders (Xenos microcode dumped from Saints Reborn).
// The game's colour math runs on raw (gamma-space) texture values, so the textures stay NoColorSpace and each
// shader does that math as the game does, then hands three.js the result in linear space (srLin), because the
// map editor renders with colour management on (sRGB output) unlike SR1-Creator.
import * as THREE from 'three'
import type { CmeshMaterial } from './cmesh'
import type { PegImage } from './peg'

const isPow2 = (n: number) => (n & (n - 1)) === 0

/** A texture from decoded peg pixels. `srgb` for maps three.js samples itself (no custom shader math). */
export function textureFrom(img: PegImage, srgb = false): THREE.DataTexture {
  const t = new THREE.DataTexture(img.rgba, img.width, img.height, THREE.RGBAFormat)
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.flipY = true
  t.magFilter = THREE.LinearFilter
  const mips = isPow2(img.width) && isPow2(img.height)
  t.generateMipmaps = mips
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
  t.needsUpdate = true
  return t
}

const LIN = 'vec3 srLin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }'
const lin = (v: number) => Math.pow(Math.max(0, v), 2.2)
const k = (consts: Record<string, number[]>, name: string, d: number[]) => consts[name] || d

// ---------------- bb-skin2 (head and body) ----------------
// From shader_88F944C5DEE1204D (bb-skin2_c); material constants c30 Diffuse_Color, c31 Diffuse_Map_Saturation,
// c32 Diffuse_Map_Luminosity.
//   gray  = dot(Diffuse_Color, (0.6, 0.3, 0.1))
//   c'    = mix(gray, Diffuse_Color, S)
//   tint  = L >= 1 ? mix(c', 1, L - 1) : c' * L
//   base  = tint * diffuseTex
//   albedo = mix(base, diffuseTex, pigmentTex)          (pigment white = keep texture, e.g. lips)
// S and L are the shader values, 2 x the creator slider (Full_Shader_Value 2 at slider 1).
export function skinMaterial({ diffuse, pigment, specular, consts }: { diffuse: THREE.Texture | null; pigment: THREE.Texture | null; specular: THREE.Texture | null; consts: Record<string, number[]> }) {
  const dc = k(consts, 'diffuse_color', [1, 0.6392, 0.498, 1])
  const specColor = k(consts, 'specular_color', [1, 1, 1, 1])
  const specAlpha = k(consts, 'specular_alpha', [0.333])[0]
  const mat = new THREE.MeshPhongMaterial({
    map: diffuse, specularMap: specular,
    shininess: k(consts, 'specular_power', [20])[0],
    specular: new THREE.Color(specColor[0] * specAlpha, specColor[1] * specAlpha, specColor[2] * specAlpha),
  })
  const uniforms = {
    uPigment: { value: pigment }, uHasPigment: { value: pigment ? 1 : 0 },
    uDiffuseColor: { value: new THREE.Vector3(dc[0], dc[1], dc[2]) },
    uSat: { value: 1 }, uLum: { value: 1 },
    uGlancing: { value: new THREE.Vector3(...k(consts, 'glancing_specular_color', [0.5412, 0.8078, 1]).slice(0, 3).map(lin)) },
    uGlancingAlpha: { value: k(consts, 'glancing_specular_alpha', [2])[0] },
    uFalloffContrast: { value: k(consts, 'glancing_falloff_contrast', [8])[0] },
    uFalloffBright: { value: k(consts, 'glancing_falloff_brightness', [0.12])[0] },
  }
  mat.userData.uniforms = uniforms
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uPigment; uniform int uHasPigment; uniform vec3 uDiffuseColor; uniform float uSat; uniform float uLum;
uniform vec3 uGlancing; uniform float uGlancingAlpha; uniform float uFalloffContrast; uniform float uFalloffBright;
${LIN}`)
      .replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec3 srTex = texture2D(map, vMapUv).rgb;
  float srGray = dot(uDiffuseColor, vec3(0.6, 0.3, 0.1));
  vec3 srC = mix(vec3(srGray), uDiffuseColor, uSat);
  vec3 srTint = uLum >= 1.0 ? mix(srC, vec3(1.0), uLum - 1.0) : srC * uLum;
  vec3 srPig = uHasPigment == 1 ? texture2D(uPigment, vMapUv).rgb : vec3(0.0);
  diffuseColor.rgb *= srLin(mix(srTint * srTex, srTex, srPig));
#endif`)
      // Glancing (rim) term from the same shader's Glancing_* constants; the exact falloff curve is approximated.
      .replace('#include <opaque_fragment>', `
  { float srNV = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
    float srRim = clamp(pow(1.0 - srNV, uFalloffContrast * 0.5) * uFalloffBright * uGlancingAlpha, 0.0, 1.0);
    outgoingLight += uGlancing * srRim * 0.5; }
#include <opaque_fragment>`)
  }
  mat.customProgramCacheKey = () => 'sr-skin'
  return mat
}

/** Skin tone from the creator's Saturation and Luminosity sliders (0..1). */
export function setSkinTone(mat: THREE.Material, sliderSat: number, sliderLum: number) {
  const u = mat.userData.uniforms
  if (!u?.uSat) return
  u.uSat.value = 2 * sliderSat
  u.uLum.value = 2 * sliderLum
}

// ---------------- bb-haircolor2 (hair, beards, brows) ----------------
// From shader_7739555EE198205D: tfetch r8.zxy <- DSA map, so R = diffuse luminance, G = specular, B = alpha.
//   albedo = Diffuse_Color * Diffuse_Map_Luminosity_Amount * R   (c25 * c24 * R)
//   alpha  = B
// The game's hair shader also has a normal map, two lights and an anisotropic highlight that are not ported; a
// diffuse gain plus a constant sheen tinted by each colour's own Specular colour stand in for them (measured in
// SR1-Creator against the running game).
export const HAIR_GAIN = 1.332, HAIR_SHEEN = 30.1 / 255

export interface HairColor { rgb: number[]; lum: number; specular?: number[]; spec_alpha?: number; spec_power?: number; spec_map?: number }

// Alpha is DSA.blue times a scale. Facial hair blends with the scale at 2; head hair uses an opaque alpha test at 0.3.
export function hairMaterial(dsaTex: THREE.Texture, { alphaTest = 0.04, transparent = true, alphaScale = 2 } = {}) {
  const mat = new THREE.MeshPhongMaterial({ map: dsaTex, side: THREE.DoubleSide, transparent, alphaTest, depthWrite: true, shininess: 20, specular: 0x000000 })
  const uniforms = { uHairColor: { value: new THREE.Vector3(0.24, 0.16, 0.07) }, uLumAmount: { value: 1 }, uSpecAmt: { value: 1 }, uSheen: { value: new THREE.Vector3(0.1, 0.1, 0.1) } }
  mat.userData.uniforms = uniforms
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uHairColor; uniform float uLumAmount; uniform float uSpecAmt; uniform vec3 uSheen; vec4 srDSA = vec4(1.0);
${LIN}`)
      .replace('#include <map_fragment>', `
#ifdef USE_MAP
  srDSA = texture2D(map, vMapUv);
  diffuseColor.rgb *= srLin(clamp(uHairColor * uLumAmount * srDSA.r * ${HAIR_GAIN.toFixed(3)}, 0.0, 1.0));
  diffuseColor.a *= clamp(srDSA.b * ${alphaScale.toFixed(2)}, 0.0, 1.0);
#endif`)
      .replace('#include <specularmap_fragment>', 'float specularStrength = srDSA.g * uSpecAmt;')
      .replace('#include <opaque_fragment>', `outgoingLight += uSheen;
#include <opaque_fragment>`)
  }
  mat.customProgramCacheKey = () => 'sr-hair-' + alphaScale
  return mat
}

export function setHairColor(mat: THREE.Material, c: HairColor) {
  const u = mat.userData.uniforms
  if (!u?.uHairColor || !(mat instanceof THREE.MeshPhongMaterial)) return
  u.uHairColor.value.set(c.rgb[0] / 255, c.rgb[1] / 255, c.rgb[2] / 255)
  u.uLumAmount.value = c.lum
  const sa = c.spec_alpha ?? 1, sp = c.specular || [146, 146, 146]
  mat.specular.setRGB((sp[0] / 255) * sa * 0.35, (sp[1] / 255) * sa * 0.35, (sp[2] / 255) * sa * 0.35)
  mat.shininess = c.spec_power ?? 20
  u.uSpecAmt.value = (c.spec_map ?? 100) / 100
  u.uSheen.value.set(lin((sp[0] / 255) * sa * HAIR_SHEEN), lin((sp[1] / 255) * sa * HAIR_SHEEN), lin((sp[2] / 255) * sa * HAIR_SHEEN))
}

// ---------------- eyes ----------------
// Eye materials: Diffuse_Map pcEye_D times Diffuse_Color, with Decal_Map_1 (the iris, DXT5 with alpha) on the second
// UV set tinted by Decal_Map_1_Color (one colour per eye-colour material) and blended by its alpha.
export function eyeMaterial({ diffuse, iris, consts }: { diffuse: THREE.Texture | null; iris: THREE.Texture | null; consts: Record<string, number[]> }) {
  const dc = k(consts, 'diffuse_color', [0.949, 0.8235, 0.7725, 1])
  const ic = k(consts, 'decal_map_1_color', [0.4863, 0.3647, 0.3059, 1])
  const op = k(consts, 'decal_map_1_opacity', [1])[0]
  const mat = new THREE.MeshPhongMaterial({ map: diffuse, shininess: k(consts, 'specular_power', [100])[0], specular: 0x020202 })
  const uniforms = { uIris: { value: iris }, uHasIris: { value: iris ? 1 : 0 }, uIrisColor: { value: new THREE.Vector3(ic[0], ic[1], ic[2]) }, uDiffuseColor: { value: new THREE.Vector3(dc[0], dc[1], dc[2]) }, uIrisOpacity: { value: op } }
  mat.userData.uniforms = uniforms
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 uvIris; varying vec2 vIris;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvIris = uvIris;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uIris; uniform int uHasIris; uniform vec3 uIrisColor; uniform vec3 uDiffuseColor; uniform float uIrisOpacity; varying vec2 vIris;
${LIN}`)
      .replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec3 srBase = texture2D(map, vMapUv).rgb * uDiffuseColor;
  vec4 srIris = uHasIris == 1 ? texture2D(uIris, vIris) : vec4(0.0);
  diffuseColor.rgb *= srLin(mix(srBase, srIris.rgb * uIrisColor, srIris.a * uIrisOpacity));
#endif`)
  }
  mat.customProgramCacheKey = () => 'sr-eye'
  return mat
}

/** Picks one of the eye mesh's colour variants (eyes_blue, eyes_brown, ...) for every eye material. */
export function setEyeColor(mats: THREE.Material[], variant: CmeshMaterial | undefined) {
  if (!variant) return
  const ic = variant.consts.decal_map_1_color || [1, 1, 1, 1], dc = variant.consts.diffuse_color || [1, 1, 1, 1]
  for (const m of mats) {
    const u = m.userData.uniforms
    if (!u?.uIrisColor) continue
    u.uIrisColor.value.set(ic[0], ic[1], ic[2])
    u.uDiffuseColor.value.set(dc[0], dc[1], dc[2])
  }
}

// ---------------- bb-cloth1 (clothing) ----------------
// Diffuse_Map x Diffuse_Color, then Decal_Map_1 and Decal_Map_2 blended over it by their alpha x opacity, each tinted
// by its colour and tiled by its tiling constants (the dark blue of the jeans is decal 1 over a light denim base);
// the fabric detail map, tiled by Spec_Map_Tiling, is overlaid at Detail_Map_Opacity contrast; the same tiling
// carries Specular_Map_4, which scales the specular. A tangent-space normal map adds the folds and creases.
export function clothingMaterial(m: CmeshMaterial, pegs: Record<string, PegImage>) {
  const tex = (n: string | undefined) => {
    const d = n && !/^missing/i.test(n) ? pegs[n.toLowerCase()] : undefined
    return d ? textureFrom(d) : null
  }
  const slot = (name: string) => m.slots.find((s) => s.slot === name)?.texture
  const kk = (n: string, d: number[]) => k(m.consts, n, d)
  const dc = kk('diffuse_color', [1, 1, 1, 1]), sc = kk('specular_color', [0, 0, 0, 1]), sa = kk('specular_alpha', [0.2])[0]
  // misc-white.TGA (a shared engine texture, not in the item's peg) is plain white
  const map = tex(slot('diffuse_map')) || textureFrom({ width: 1, height: 1, rgba: new Uint8Array([255, 255, 255, 255]) })
  const mat = new THREE.MeshPhongMaterial({ map, shininess: kk('specular_power', [10])[0], specular: new THREE.Color(sc[0] * sa * 0.35, sc[1] * sa * 0.35, sc[2] * sa * 0.35) })
  const nm = tex(slot('normal_map'))
  if (nm) { const nh = kk('normal_map_height', [1])[0]; mat.normalMap = nm; mat.normalScale = new THREE.Vector2(nh, nh) }
  const decals = [1, 2]
    .map((i) => ({ t: tex(slot('decal_map_' + i)), c: kk(`decal_map_${i}_color`, [1, 1, 1, 1]), o: kk(`decal_map_${i}_opacity`, [1])[0], tu: kk(`decal_map_${i}_tilingu`, [1])[0], tv: kk(`decal_map_${i}_tilingv`, [1])[0] }))
    .filter((d) => d.t)
  const tu = kk('spec_map_tilingu', [1])[0], tv = kk('spec_map_tilingv', [1])[0]
  const detail = tex(slot('detail_map_4')), specMap = tex(slot('specular_map_4'))
  if (specMap && kk('specular_map_amount', [0])[0] > 0) { specMap.repeat.set(tu, tv); mat.specularMap = specMap }
  const uni: Record<string, { value: unknown }> = { uDC: { value: new THREE.Vector3(dc[0], dc[1], dc[2]) } }
  decals.forEach((d, i) => {
    uni['uDecal' + i] = { value: d.t }
    uni['uDecalC' + i] = { value: new THREE.Vector4(d.c[0], d.c[1], d.c[2], d.o) }
    uni['uDecalT' + i] = { value: new THREE.Vector2(d.tu, d.tv) }
  })
  if (detail) { uni.uDetail = { value: detail }; uni.uDetailT = { value: new THREE.Vector2(tu, tv) }; uni.uDetailO = { value: kk('detail_map_opacity', [0])[0] } }
  const decl = ['uniform vec3 uDC;', LIN]
    .concat(decals.map((_, i) => `uniform sampler2D uDecal${i}; uniform vec4 uDecalC${i}; uniform vec2 uDecalT${i};`))
    .concat(detail ? ['uniform sampler2D uDetail; uniform vec2 uDetailT; uniform float uDetailO;'] : []).join('\n')
  const body = ['vec3 srC = texture2D(map, vMapUv).rgb * uDC;']
    .concat(decals.map((_, i) => `{ vec4 dd = texture2D(uDecal${i}, vMapUv * uDecalT${i}); srC = mix(srC, dd.rgb * uDecalC${i}.rgb, dd.a * uDecalC${i}.a); }`))
    .concat(detail ? ['{ vec3 dt = (texture2D(uDetail, vMapUv * uDetailT).rgb - 0.5) * uDetailO + 0.5;',
      '  srC = mix(2.0 * srC * dt, 1.0 - 2.0 * (1.0 - srC) * (1.0 - dt), step(0.5, srC)); }'] : [])
    .concat(['diffuseColor.rgb *= srLin(srC);']).join('\n')
  mat.userData.uniforms = uni
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + decl)
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n' + body + '\n#endif')
  }
  mat.customProgramCacheKey = () => 'sr-cloth-' + decals.length + (detail ? 'd' : '')
  return mat
}
