// Draws objects from the game the way the game does, as one patch (onBeforeCompile) on the material the viewer
// builds for a scene item: colour = diffuse x tint, then each decal mixed over it by its alpha x opacity (UV1 and
// UV2, with their own tiling and edge clamping); ground and street blends mix two tinted pictures by the mean of
// a large mask's RGB; normal maps scaled by Normal_Map_Height; specular maps; self-illumination for glowing
// (flags 0xB) materials. Opaque cut-outs use an alpha cut-off; decals and glass blend, with a depth offset.
// The look comes from the object's look file (lib/gameObjects/lookFile.ts). Objects that aren't from the game,
// and game objects without a look file, are drawn exactly as before (their material is returned untouched).
// The same patch, opt-in ("layered surfaces"), gives the site's own shapes and prefabs retail's way of not
// repeating: an evenly lit, low-contrast base tile plus world-space grime and a large tint mask (lib/variation.ts).
import * as THREE from 'three'
import type { GameLook, LookLayer } from '../lib/gameObjects/material'
import { decodeLook, type LookData, type StoredLook } from '../lib/gameObjects/lookFile'
import type { ObjModel } from '../lib/geometry'
import { fileBlob, loadModel, peekModel, textureUrl } from '../lib/assets'
import type { Project } from '../lib/project'
import type { FileRecipe } from '../lib/recipes'
import { SURFACE_KINDS, type GenParams } from '../lib/procedural'
import { TILE_SIZE, VARY_GLSL, variationTile } from '../lib/variation'

/** What the patch needs from the viewer. */
export interface LookContext {
  /** An object URL for a stored picture, or null when it is missing. */
  url(path: string): Promise<string | null>
  /** A stored file's bytes (the look file). */
  blob(path: string): Promise<Blob | undefined>
  /** The parsed OBJ of a stored model. */
  model(path: string): Promise<ObjModel>
  maxAnisotropy: number
  /** A layer picture arrived: draw again (and refresh merged copies). */
  changed(): void
  /** How the site made a stored picture (layered surfaces), and the map's metres per editor unit. */
  recipe?(path: string): FileRecipe | undefined
  worldScale?(): number
  /** An object URL for a generated picture made with these settings (never stored), or null. */
  generated?(params: GenParams): Promise<string | null>
}

/** The context for the editor's viewer: its project's stored files, its renderer's filtering, its redraw. */
export function lookContext(project: () => Project | null, renderer: () => THREE.WebGLRenderer | undefined, changed: () => void): LookContext {
  return {
    url: (p) => textureUrl(project(), p),
    blob: (p) => fileBlob(project(), p),
    model: (p) => peekModel(p) || loadModel(project(), p),
    get maxAnisotropy() { return renderer()?.capabilities.getMaxAnisotropy() ?? 4 },
    changed,
    recipe: (p) => project()?.files[p]?.recipe,
    worldScale: () => project()?.settings.world_scale || 0.5,
    generated: async (params) => {
      const { generatedPng } = await import('../lib/texgen')
      return URL.createObjectURL(await generatedPng(params, 'layered.png'))
    },
  }
}

// ---------------- the look file and the geometry ----------------

const looks = new Map<string, Promise<LookData | null>>()

/** The decoded look file at `path` (null when it can't be read), read once. */
export function loadLook(ctx: LookContext, path: string): Promise<LookData | null> {
  let p = looks.get(path)
  if (!p) {
    p = ctx.blob(path).then(async (b) => (b ? decodeLook(new Uint8Array(await b.arrayBuffer())) : null)).catch(() => null)
    looks.set(path, p)
  }
  return p
}

/**
 * Puts the look's vertex data on the geometry the viewer built from the OBJ (one vertex per v/vt corner): UV sets
 * 1-3 as srUv1-3, and the game's stored normals where it has them. Done once per geometry.
 */
export function lookGeometry(g: THREE.BufferGeometry, model: ObjModel, d: LookData, key: string) {
  if (g.userData.srLook === key) return
  const vi = model.vIndex
  const n = g.getAttribute('position')?.count ?? 0
  if (!vi || vi.length !== n) return
  d.uvs.forEach((u, k) => {
    const a = new Float32Array(2 * n)
    for (let j = 0; j < n; j++) { const s = vi[j]; if (s < d.vertices) { a[2 * j] = u[2 * s]; a[2 * j + 1] = u[2 * s + 1] } }
    g.setAttribute('srUv' + (k + 1), new THREE.BufferAttribute(a, 2))
  })
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute | undefined
  if (d.normals && nrm) {
    for (let j = 0; j < n; j++) {
      const s = vi[j]
      if (s >= d.vertices) continue
      const x = d.normals[3 * s], y = d.normals[3 * s + 1], z = d.normals[3 * s + 2]
      if (x * x + y * y + z * z > 0.25) nrm.setXYZ(j, x, y, z)
    }
    nrm.needsUpdate = true
  }
  g.userData.srLook = key
}

// ---------------- pictures ----------------

const loader = new THREE.TextureLoader()
const pictures = new Map<string, Promise<THREE.Texture | null>>()
const variants = new Map<string, Promise<THREE.Texture | null>>()

function picture(ctx: LookContext, path: string): Promise<THREE.Texture | null> {
  let p = pictures.get(path)
  if (!p) {
    p = ctx.url(path).then((u) => (u ? loader.loadAsync(u) : null)).catch(() => null)
    pictures.set(path, p)
  }
  return p
}

/** A layer's picture with its own wrapping (clamped axes), colour space and filtering; shared between materials alike. */
function layerPicture(ctx: LookContext, l: LookLayer, color: boolean, aniso: number): Promise<THREE.Texture | null> {
  const key = [l.tex, l.clamp[0], l.clamp[1], color, aniso].join('|')
  let p = variants.get(key)
  if (!p) {
    p = picture(ctx, l.tex).then((t) => {
      if (!t) return null
      const c = t.clone()
      c.wrapS = l.clamp[0] ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping
      c.wrapT = l.clamp[1] ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping
      c.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
      c.anisotropy = aniso
      c.needsUpdate = true
      return c
    })
    variants.set(key, p)
  }
  return p
}

const pixel = (r: number, g: number, b: number, a: number) => {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat)
  t.needsUpdate = true
  return t
}
/** Stand-ins until a picture arrives: a clear decal, a grey mask or second layer, full specular, a flat normal. */
const CLEAR = pixel(0, 0, 0, 0), GREY = pixel(128, 128, 128, 255), WHITE = pixel(255, 255, 255, 255), FLAT = pixel(128, 128, 255, 255)

// ---------------- the material ----------------

type Mat = THREE.MeshLambertMaterial | THREE.MeshPhongMaterial | THREE.MeshStandardMaterial

/** The same material as Phong (for specular highlights), keeping everything the viewer set on it. */
function asPhong(m: THREE.MeshLambertMaterial): THREE.MeshPhongMaterial {
  const p = new THREE.MeshPhongMaterial()
  THREE.Material.prototype.copy.call(p, m)
  const src = m as unknown as Record<string, unknown>, dst = p as unknown as Record<string, unknown>
  for (const k of ['color', 'map', 'lightMap', 'lightMapIntensity', 'aoMap', 'aoMapIntensity', 'emissive', 'emissiveIntensity', 'emissiveMap', 'bumpMap', 'bumpScale',
    'normalMap', 'normalMapType', 'normalScale', 'displacementMap', 'displacementScale', 'displacementBias', 'alphaMap', 'specularMap', 'envMap', 'envMapRotation',
    'reflectivity', 'refractionRatio', 'combine', 'wireframe', 'wireframeLinewidth', 'flatShading', 'fog']) {
    if (!(k in src) || !(k in dst)) continue
    const v = src[k] as { copy?: unknown } | unknown
    if (v && typeof (v as { copy?: unknown }).copy === 'function' && dst[k] && typeof (dst[k] as { copy?: unknown }).copy === 'function') (dst[k] as { copy(x: unknown): void }).copy(v)
    else dst[k] = v
  }
  m.dispose()
  return p
}

const linear = (c: [number, number, number]) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace)
const vec2 = (v: [number, number]) => new THREE.Vector2(v[0], v[1])

/** Builds the GLSL and uniforms for a look; `diffuse` is the material's own picture (sampled through `map`). */
function lookShader(l: GameLook, diffuse: string) {
  const uni: Record<string, THREE.IUniform> = {}
  const decl: string[] = [], uvs = new Set<number>()
  const pending: [string, LookLayer, boolean, THREE.Texture][] = []
  let n = 0
  /** GLSL that samples a layer at its UV set and tiling. */
  const sample = (x: LookLayer | undefined, color: boolean, stand: THREE.Texture): string | null => {
    if (!x) return null
    if (x.uv) uvs.add(x.uv)
    const i = n++
    uni['uSrR' + i] = { value: vec2(x.repeat) }
    decl.push(`uniform vec2 uSrR${i};`)
    const at = `srFlip(vSrUv${x.uv} * uSrR${i})`
    if (x.tex === diffuse && !x.clamp[0] && !x.clamp[1]) return `srMap(${at})`
    uni['uSrL' + i] = { value: stand }
    decl.push(`uniform sampler2D uSrL${i};`)
    pending.push(['uSrL' + i, x, color, stand])
    return `texture2D(uSrL${i}, ${at})`
  }
  uni.uSrTint = { value: linear(l.tint) }
  decl.push('uniform vec3 uSrTint;')
  const body: string[] = []
  if (l.kind === 'decal') {
    const d = l.decals[0]
    const s = sample(d?.layer, true, CLEAR)
    uni.uSrOp0 = { value: d?.opacity ?? 0 }
    decl.push('uniform float uSrOp0;')
    body.push(s ? `vec4 srD = ${s}; vec3 srC = srD.rgb; float srA = srD.a * uSrOp0;` : 'vec3 srC = vec3(1.0); float srA = 0.0;')
  } else if (l.kind === 'glass') {
    uni.uSrGlassA = { value: Math.min(0.9, Math.max(0.2, (l.opacity ?? 1) * 0.75)) }
    decl.push('uniform float uSrGlassA;')
    body.push('vec3 srC = uSrTint; float srA = uSrGlassA;')
  } else {
    const b = sample(l.base, true, WHITE) ?? 'vec4(1.0)'
    body.push(`vec4 srB = ${b}; vec3 srC = srB.rgb * uSrTint; float srA = srB.a;`)
    if (l.kind === 'terrain' || l.kind === 'blend') {
      const b2 = sample(l.base2, true, GREY), m = sample(l.mask, false, GREY)
      uni.uSrTint2 = { value: linear(l.tint2 ?? [1, 1, 1]) }
      decl.push('uniform vec3 uSrTint2;')
      if (b2 && m) {
        body.push(`float srT = dot(${m}.rgb, vec3(1.0 / 3.0));`)
        if (l.invertMask) body.push('srT = 1.0 - srT;')
        body.push(`srC = mix(srC, ${b2}.rgb * uSrTint2, srT);`)
      }
    }
  }
  if (l.kind !== 'decal') {
    l.decals.forEach((d, k) => {
      const s = sample(d.layer, true, CLEAR)
      if (!s) return
      uni['uSrOp' + (k + 1)] = { value: d.opacity }
      decl.push(`uniform float uSrOp${k + 1};`)
      body.push(`{ vec4 srD = ${s}; srC = mix(srC, srD.rgb, srD.a * uSrOp${k + 1});${l.kind === 'glass' ? ` srA = max(srA, srD.a * uSrOp${k + 1});` : ''} }`)
    })
  }
  body.push('diffuseColor.rgb *= srC; diffuseColor.a *= srA;')
  // Specular strength: lerp(1, map, Specular_Map_Amount), as the light passes do.
  let spec = ''
  const sp = l.specular
  if (sp.map && sp.amount > 0) {
    const s = sample(sp.map, false, WHITE)
    uni.uSrSpecAmt = { value: sp.amount }
    decl.push('uniform float uSrSpecAmt;')
    spec = `float specularStrength = mix(1.0, ${s}.r, uSrSpecAmt);`
  }
  const glow = l.selfIllum > 0 ? l.selfIllum : l.glow ? 0.6 : 0
  if (glow) { uni.uSrGlow = { value: glow }; decl.push('uniform float uSrGlow;') }
  return { uni, decl, body: body.join('\n'), spec, glow: !!glow, uvs: [...uvs].sort(), pending }
}

/**
 * The viewer's material for one material of a game object, patched to draw `stored`'s look. `alpha`: its
 * picture has see-through parts (an opaque look then cuts out at half alpha). Returns a new material when it
 * has to change kind (Lambert to Phong for specular); the one passed in is then disposed.
 */
export function gameMaterial(base: THREE.Material, stored: StoredLook, alpha: boolean, ctx: LookContext): THREE.Material {
  const l = stored.look
  let mat = base as Mat
  const wantSpec = l.specular.alpha > 0.01
  if (wantSpec && mat.type === 'MeshLambertMaterial') mat = asPhong(mat as THREE.MeshLambertMaterial)
  if (mat instanceof THREE.MeshPhongMaterial) {
    // three's Blinn-Phong is energy-normalised; scaled so the peak is near the game's Specular_Alpha.
    mat.specular = linear(l.specular.color).multiplyScalar(wantSpec ? l.specular.alpha * 0.4 : 0)
    mat.shininess = Math.max(1, l.specular.power)
  } else if (mat instanceof THREE.MeshStandardMaterial) {
    mat.roughness = wantSpec ? Math.min(1, Math.max(0.25, Math.sqrt(2 / (l.specular.power + 2)) * 2)) : 1
    mat.metalness = 0
  }
  const aniso = l.ground ? ctx.maxAnisotropy : 4
  const sh = lookShader(l, stored.diffuse)
  for (const [name, layer, color] of sh.pending) {
    void layerPicture(ctx, layer, color, aniso).then((t) => { if (t) { sh.uni[name].value = t; ctx.changed() } })
  }
  if (l.normal) {
    const nl = l.normal
    mat.normalMap = FLAT
    mat.normalScale = new THREE.Vector2(nl.scale, nl.scale)
    void layerPicture(ctx, nl, false, aniso).then((t) => {
      if (!t) return
      const c = t.clone()
      // The normal map reads the OBJ's UVs (v flipped) through three's own transform: tile it, and offset so a
      // tiling that isn't whole lines up as in the game (row from the top = v x tiling).
      c.repeat.set(nl.repeat[0], nl.repeat[1])
      c.offset.set(0, 1 - nl.repeat[1])
      c.needsUpdate = true
      mat.normalMap = c
      ctx.changed()
    })
  }
  // Alpha by kind: decals and glass blend over what's under them; opaque pictures with holes cut out.
  if (l.blend) {
    mat.transparent = true; mat.depthWrite = false; mat.alphaTest = 0.004
    mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -1
  } else {
    mat.transparent = false; mat.depthWrite = true; mat.alphaTest = alpha ? 0.5 : 0
  }
  // Ground seen at a grazing angle: the diffuse picture is filtered anisotropically too (it arrives later).
  if (l.ground) {
    let cur = mat.map
    const bump = (t: THREE.Texture | null) => { if (t && t.anisotropy < ctx.maxAnisotropy) { t.anisotropy = ctx.maxAnisotropy; t.needsUpdate = true } }
    bump(cur)
    Object.defineProperty(mat, 'map', { configurable: true, enumerable: true, get: () => cur, set: (t: THREE.Texture | null) => { cur = t; bump(t) } })
  }
  const key = 'srlook:' + [l.kind, sh.decl.join(''), sh.body, sh.spec, sh.glow, sh.uvs.join(','), l.blend].join('|')
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey
  mat.onBeforeCompile = (s, r) => {
    prev.call(mat, s, r)
    Object.assign(s.uniforms, sh.uni)
    s.vertexShader = s.vertexShader
      .replace('#include <common>', ['#include <common>', 'varying vec2 vSrUv0;', ...sh.uvs.map((k) => `attribute vec2 srUv${k}; varying vec2 vSrUv${k};`)].join('\n'))
      .replace('#include <uv_vertex>', ['#include <uv_vertex>', 'vSrUv0 = vec2(uv.x, 1.0 - uv.y);', ...sh.uvs.map((k) => `vSrUv${k} = srUv${k};`)].join('\n'))
    s.fragmentShader = s.fragmentShader
      // After map_pars_fragment, so `map` is declared.
      .replace('#include <map_pars_fragment>', ['#include <map_pars_fragment>', 'varying vec2 vSrUv0;', ...sh.uvs.map((k) => `varying vec2 vSrUv${k};`), ...sh.decl,
        'vec2 srFlip(vec2 g) { return vec2(g.x, 1.0 - g.y); }',
        '#ifdef USE_MAP', 'vec4 srMap(vec2 at) { return texture2D(map, at); }', '#else', 'vec4 srMap(vec2 at) { return vec4(1.0); }', '#endif'].join('\n'))
      .replace('#include <map_fragment>', sh.body)
      .replace('#include <specularmap_fragment>', sh.spec || '#include <specularmap_fragment>')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + (sh.glow ? '\ntotalEmissiveRadiance += diffuseColor.rgb * uSrGlow;' : ''))
      // Decals with a logarithmic depth buffer: the polygon offset doesn't reach the depth written here.
      .replace('#include <logdepthbuf_fragment>', '#include <logdepthbuf_fragment>' + (l.blend ? '\n#if defined( USE_LOGDEPTHBUF )\ngl_FragDepth -= 3e-5;\n#endif' : ''))
  }
  mat.customProgramCacheKey = () => prevKey.call(mat) + key
  // Materials that look different must not be merged into one by the static batch.
  mat.userData.lookKey = JSON.stringify([stored.diffuse, l, alpha])
  mat.userData.srAttrs = sh.uvs.map((k) => 'srUv' + k)
  mat.needsUpdate = true
  return mat
}

// ---------------- layered surfaces (the site's own objects, opt-in) ----------------

let varyTile: THREE.DataTexture | null = null
/** The variation layers' noise picture, made once. */
function varyTexture() {
  if (!varyTile) {
    varyTile = new THREE.DataTexture(variationTile(), TILE_SIZE, TILE_SIZE, THREE.RGBAFormat)
    varyTile.wrapS = varyTile.wrapT = THREE.RepeatWrapping
    varyTile.magFilter = THREE.LinearFilter
    varyTile.minFilter = THREE.LinearMipmapLinearFilter
    varyTile.generateMipmaps = true
    varyTile.needsUpdate = true
  }
  return varyTile
}

const evenTiles = new Map<string, Promise<THREE.Texture | null>>()
/** The evenly lit, low-contrast version of a generated surface picture (GenParams.layered), for the view only. */
function evenTile(ctx: LookContext, params: GenParams): Promise<THREE.Texture | null> {
  const key = JSON.stringify(params)
  let p = evenTiles.get(key)
  if (!p) {
    p = (ctx.generated?.({ ...params, layered: true }) ?? Promise.resolve(null)).then((u) => (u ? loader.loadAsync(u) : null)).then((t) => {
      if (t) { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ctx.maxAnisotropy }
      return t
    }).catch(() => null)
    evenTiles.set(key, p)
  }
  return p
}

/** Which pictures get the layered look: generated surfaces (their base made even too) and starter-library ones. */
export function layeredKind(r: FileRecipe | undefined): 'even' | 'grime' | null {
  if (r?.kind === 'generated') return SURFACE_KINDS.has(r.params.kind) ? 'even' : null
  return r?.kind === 'library' ? 'grime' : null
}

/**
 * The viewer's material for one of the site's own objects with the layered look: its picture swapped for the even
 * base tile once that is made (generated surfaces), then the world-space grime and tint mask over it. Pictures
 * that aren't surfaces (signs, posters, the user's own) are left as they are.
 */
export function layeredMaterial(base: THREE.Material, texPath: string | undefined, ctx: LookContext): THREE.Material {
  const r = texPath ? ctx.recipe?.(texPath) : undefined
  const kind = layeredKind(r)
  if (!kind) return base
  const mat = base as Mat
  const uni: Record<string, THREE.IUniform> = {
    uSrVary: { value: varyTexture() }, uSrWs: { value: ctx.worldScale?.() ?? 0.5 },
    uSrEven: { value: WHITE }, uSrEvenOn: { value: 0 },
  }
  if (kind === 'even' && r?.kind === 'generated') {
    void evenTile(ctx, r.params).then((t) => { if (t) { uni.uSrEven.value = t; uni.uSrEvenOn.value = 1; ctx.changed() } })
  }
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey
  mat.onBeforeCompile = (s, rr) => {
    prev.call(mat, s, rr)
    Object.assign(s.uniforms, uni)
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSrWorld;\nvarying vec3 vSrWN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvSrWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSrWN = normalize(mat3(modelMatrix) * objectNormal);')
    s.fragmentShader = s.fragmentShader
      .replace('#include <map_pars_fragment>', ['#include <map_pars_fragment>', 'varying vec3 vSrWorld;', 'varying vec3 vSrWN;',
        'uniform sampler2D uSrVary; uniform float uSrWs; uniform sampler2D uSrEven; uniform float uSrEvenOn;', VARY_GLSL].join('\n'))
      .replace('#include <map_fragment>', [
        '#ifdef USE_MAP',
        'diffuseColor *= mix(texture2D(map, vMapUv), texture2D(uSrEven, vMapUv), uSrEvenOn);',
        '#endif',
        // Editor units to metres: the layers repeat at retail's distances whatever the map's world scale.
        'diffuseColor.rgb = srVary(diffuseColor.rgb, vSrWorld * uSrWs, normalize(vSrWN));',
      ].join('\n'))
  }
  mat.customProgramCacheKey = () => prevKey.call(mat) + 'srlayered'
  mat.userData.lookKey = 'layered:' + JSON.stringify(r)
  mat.needsUpdate = true
  return mat
}

/**
 * The look of a scene item: null for items not from the game or without a look file (and, unless `layered`, for
 * the site's own shapes and prefabs). Otherwise `prepare` puts the vertex data on its geometry and `material`
 * patches the viewer's material for an OBJ material name (left as it is when that material has no look, or the
 * user painted their own picture on it).
 */
export async function itemLook(ctx: LookContext, it: { path: string; game_look?: { path: string }; textures?: Record<string, string>; alpha?: Record<string, boolean>; shape?: unknown; prefab?: unknown }, opts: { layered?: boolean } = {}) {
  if (!it.game_look?.path) {
    if (!opts.layered || !(it.shape || it.prefab)) return null
    return { prepare() {}, material: (m: THREE.Material, mat: string) => layeredMaterial(m, it.textures?.[mat], ctx) }
  }
  const [d, model] = await Promise.all([loadLook(ctx, it.game_look.path), ctx.model(it.path).catch(() => null)])
  if (!d || !model) return null
  const key = it.game_look.path
  return {
    prepare(g: THREE.BufferGeometry) { lookGeometry(g, model, d, key) },
    material(m: THREE.Material, mat: string): THREE.Material {
      const s = d.mats[mat]
      if (!s || it.textures?.[mat] !== s.diffuse) return m
      return gameMaterial(m, s, !!it.alpha?.[mat], ctx)
    },
  }
}
