// The opt-in "layered surfaces" look for the site's own objects: even, low-contrast base tiles (procedural.ts,
// GenParams.layered) plus retail-style large-scale variation (variation.ts) drawn by the editor's shader patch.
// Measured here: how much a floor repeats on its tile period with and without it. Default textures (what is
// stored and exported) must not change.
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { KINDS, defaultParams, generate, type TextureKind } from '../src/lib/procedural'
import { TILE_SIZE, VARIATION, VARY_GLSL, sampleTile, vary, variationTile } from '../src/lib/variation'
import { itemLook, layeredKind, layeredMaterial, type LookContext } from '../src/editor/gameMaterial'

// sha256 (first 16 hex) of each kind's default 64 px texture, from before the layered option existed.
const BEFORE: Record<string, string> = {
  concrete: '2d9697b3245144b2', asphalt: 'd1df1a3ab00202c7', brick: '1353cdb3113b84db', paint: '570ad349bcd4b7c9', tiles: '8ff3aad8b9c6bfc0',
  metal_plate: '29ea7321c1a611e0', diamond_plate: 'b7c972aa8deaf5c2', wood_planks: 'aec38f8e77221ca4', grass: '4bd510479b004115', dirt: '5734a87b0fbdefa1',
  gravel: 'a2f3c8dc02637a5f', sand: '3d791f84f854e31a', facade: '8856105cd3930a12', storefront: '0cb737c573fca623', garage_door: '93458cd385cdf8dd',
  water: '0e0736183cf87e18', matrix: '56076eaccdf27784', banner: '364a384817dd509e', hazard: '1d1e5df0a6eb91ad', chevrons: '4f4cdc71f47520a2',
  emblem: '38cd5eb361957d6a', screen: '9a67e144d6e946d3', scoreboard: '7c6303e91589bca3', poster: '1192e2c5672c02bb', graffiti: 'e9bc4a8fa3ea12f3',
  sign: 'a3f4a63d2087e7d5', lettering: '84155f7cfe1d5911', sky: '81c8aa0ca393395d', picture: '174bc27e1876fc61',
}

const lum = (px: Uint8ClampedArray, i: number) => (0.2126 * px[4 * i] + 0.7152 * px[4 * i + 1] + 0.0722 * px[4 * i + 2]) / 255
const stats = (v: number[]) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return { mean: m, std: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) } }
/** Spread of the means of 8 x 8 blocks: the large features that show the repeat. */
const blotchiness = (px: Uint8ClampedArray, size: number) => {
  const b = size / 8, means: number[] = []
  for (let by = 0; by < 8; by++) for (let bx = 0; bx < 8; bx++) {
    let s = 0
    for (let y = 0; y < b; y++) for (let x = 0; x < b; x++) s += lum(px, (by * b + y) * size + bx * b + x)
    means.push(s / (b * b))
  }
  return stats(means).std
}

describe('even base tiles', () => {
  it('the stored textures are what they were', () => {
    for (const k of Object.keys(KINDS) as TextureKind[]) {
      expect(createHash('sha256').update(generate(defaultParams(k, 64))).digest('hex').slice(0, 16), k).toBe(BEFORE[k])
      expect(generate({ ...defaultParams(k, 32), layered: false })).toEqual(generate(defaultParams(k, 32)))
    }
  })

  it('are lower in contrast and without large blotches, around the same colour', () => {
    for (const k of ['concrete', 'asphalt', 'grass', 'dirt', 'paint', 'sand'] as TextureKind[]) {
      const p = defaultParams(k, 128)
      const a = generate(p), b = generate({ ...p, layered: true })
      const la = Array.from({ length: 128 * 128 }, (_, i) => lum(a, i)), lb = Array.from({ length: 128 * 128 }, (_, i) => lum(b, i))
      const sa = stats(la), sb = stats(lb)
      expect(Math.abs(sa.mean - sb.mean), k).toBeLessThan(0.06)
      expect(sb.std, k).toBeLessThan(sa.std)
      expect(blotchiness(b, 128), k).toBeLessThan(blotchiness(a, 128) * 0.5)
    }
  })
})

describe('large-scale variation', () => {
  const tile = variationTile()

  it('repeats at retail distances, the GLSL does the same sums', () => {
    expect(VARIATION.grime.map((g) => g.period)).toEqual([10.7, 14.3])
    expect(VARIATION.maskPeriod).toBeGreaterThanOrEqual(45)
    expect(VARIATION.maskPeriod).toBeLessThanOrEqual(200)
    expect(VARY_GLSL).toContain('float P1 = 10.70, P2 = 14.30, PM = 97.0;')
    // The noise picture wraps: its edges meet.
    expect(Math.abs(sampleTile(tile, TILE_SIZE, 0.999, 0.3, 0) - sampleTile(tile, TILE_SIZE, -0.001, 0.3, 0))).toBeLessThan(1e-6)
    // Grime covers some of the surface, not all of it.
    let covered = 0
    for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) if (tile[4 * i] > 64) covered++
    expect(covered / (TILE_SIZE * TILE_SIZE)).toBeGreaterThan(0.1)
    expect(covered / (TILE_SIZE * TILE_SIZE)).toBeLessThan(0.6)
  })

  it('a 40 m floor stops repeating on its 2 m tile: measured', () => {
    // A concrete floor with the editor's usual tiling (4 units of 0.5 m = 2 m per repeat), sampled every 12.5 cm.
    const S = 64, TILE_M = 2, STEP = 0.125, N = 320
    const base = generate(defaultParams('concrete', S)), even = generate({ ...defaultParams('concrete', S), layered: true })
    const at = (px: Uint8ClampedArray, x: number, z: number) => lum(px, (Math.floor(((z / TILE_M) % 1) * S) * S) + Math.floor(((x / TILE_M) % 1) * S))
    const floor = (layered: boolean) => {
      const out = new Float64Array(N * N)
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = i * STEP, z = j * STEP
        const c = layered ? at(even, x, z) : at(base, x, z)
        out[j * N + i] = layered ? vary([c, c, c], tile, TILE_SIZE, [x + 3, 0, z + 5], [0, 1, 0])[1] : c
      }
      return out
    }
    /** Correlation of the floor with itself moved one tile along x: 1 = repeats exactly. */
    const repeat = (f: Float64Array) => {
      const lag = TILE_M / STEP, a: number[] = [], b: number[] = []
      for (let j = 0; j < N; j++) for (let i = 0; i + lag < N; i++) { a.push(f[j * N + i]); b.push(f[j * N + i + lag]) }
      const sa = stats(a), sb = stats(b)
      return a.reduce((s, v, k) => s + (v - sa.mean) * (b[k] - sb.mean), 0) / a.length / (sa.std * sb.std)
    }
    /** Spread of the average brightness of each 2 m tile: 0 when every tile looks the same. */
    const tileSpread = (f: Float64Array) => {
      const per = TILE_M / STEP, means: number[] = []
      for (let tj = 0; tj < N / per; tj++) for (let ti = 0; ti < N / per; ti++) {
        let s = 0
        for (let y = 0; y < per; y++) for (let x = 0; x < per; x++) s += f[(tj * per + y) * N + ti * per + x]
        means.push(s / (per * per))
      }
      return stats(means).std
    }
    const plain = floor(false), layered = floor(true)
    const r0 = repeat(plain), r1 = repeat(layered), t0 = tileSpread(plain), t1 = tileSpread(layered)
    console.log(`repeat correlation at one tile: ${r0.toFixed(3)} plain -> ${r1.toFixed(3)} layered; tile-to-tile spread ${t0.toFixed(4)} -> ${t1.toFixed(4)}`)
    expect(r0).toBeGreaterThan(0.99)
    expect(r1).toBeLessThan(0.6)
    expect(t1).toBeGreaterThan(Math.max(t0 * 10, 0.02))
  })
})

describe('the layered look in the editor', () => {
  const ctx = (recipes: Record<string, unknown>): LookContext => ({
    url: async () => null, blob: async () => undefined, model: async () => { throw new Error('none') }, maxAnisotropy: 8, changed: () => {},
    recipe: (p) => recipes[p] as never, worldScale: () => 0.5, generated: async () => null,
  })
  const compile = (m: THREE.Material) => {
    const L = THREE.ShaderLib.lambert
    const sh = { uniforms: THREE.UniformsUtils.clone(L.uniforms), vertexShader: L.vertexShader, fragmentShader: L.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms
    m.onBeforeCompile(sh, {} as THREE.WebGLRenderer)
    return sh
  }

  it('applies to surfaces only, and only when switched on', async () => {
    const c = ctx({ '/c.png': { kind: 'generated', params: defaultParams('concrete') }, '/sign.png': { kind: 'generated', params: defaultParams('sign') }, '/lib.png': { kind: 'library', id: 'x' } })
    expect(layeredKind({ kind: 'generated', params: defaultParams('brick') })).toBe('even')
    expect(layeredKind({ kind: 'generated', params: defaultParams('poster') })).toBeNull()
    expect(layeredKind({ kind: 'library', id: 'x' })).toBe('grime')
    expect(layeredKind(undefined)).toBeNull()
    const own = new THREE.MeshLambertMaterial()
    expect(layeredMaterial(own, '/sign.png', c)).toBe(own)
    expect(compile(own).fragmentShader).toContain('#include <map_fragment>')
    const m = layeredMaterial(new THREE.MeshLambertMaterial(), '/c.png', c)
    const sh = compile(m)
    expect(sh.fragmentShader).toContain('diffuseColor.rgb = srVary(diffuseColor.rgb, vSrWorld * uSrWs, normalize(vSrWN));')
    expect(sh.vertexShader).toContain('vSrWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    expect(sh.uniforms.uSrWs.value).toBe(0.5)
    expect(m.userData.lookKey).toMatch(/^layered:/)
    const shape = { path: '/s.obj', shape: { kind: 'box' }, textures: { a: '/c.png' } }
    expect(await itemLook(c, shape)).toBeNull()
    expect(await itemLook(c, { path: '/x.obj', textures: { a: '/c.png' } }, { layered: true })).toBeNull()
    const look = (await itemLook(c, shape, { layered: true }))!
    expect(look.material(new THREE.MeshLambertMaterial(), 'a').userData.lookKey).toMatch(/^layered:/)
  })
})
