// The editor's shader patch for objects from the game (src/editor/gameMaterial.ts): the GLSL it puts into
// three's own Lambert, Phong and Standard shaders, the alpha handling by kind, the vertex data it maps onto the
// viewer's geometry, and that the static batch keeps it. Made-up looks; nothing from the game.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { gameMaterial, itemLook, lookGeometry, type LookContext } from '../src/editor/gameMaterial'
import { copyMaterial } from '../src/editor/batch'
import type { GameLook } from '../src/lib/gameObjects/material'
import { encodeLook, type LookData } from '../src/lib/gameObjects/lookFile'
import { parseObj } from '../src/lib/geometry'

const ctx = (files: Record<string, Uint8Array> = {}, model?: ReturnType<typeof parseObj>): LookContext => ({
  url: async () => null,
  blob: async (p) => (files[p] ? new Blob([files[p]]) : undefined),
  model: async () => { if (!model) throw new Error('no model'); return model },
  maxAnisotropy: 16,
  changed: () => {},
})

const layer = (tex: string, uv = 0, repeat: [number, number] = [1, 1], clamp: [boolean, boolean] = [false, false]) => ({ tex, uv, repeat, clamp })
const wall: GameLook = {
  shader: 'bb-standard_s', kind: 'standard', base: layer('/d.png'), tint: [0.7, 0.75, 0.8],
  decals: [{ layer: layer('/grime.png', 1, [3.5, 2]), opacity: 0.6 }, { layer: layer('/sticker.png', 2, [1, 1], [true, true]), opacity: 1 }],
  normal: { ...layer('/n.png', 0, [4, 4]), scale: 0.5 }, specular: { map: layer('/s.png', 0, [2, 2]), amount: 1, color: [1, 1, 1], power: 40, alpha: 0.3 },
  selfIllum: 0, glow: false, blend: false, ground: false,
}

const lib = (kind: 'lambert' | 'phong' | 'standard') => THREE.ShaderLib[kind]
const compile = (m: THREE.Material, kind: 'lambert' | 'phong' | 'standard') => {
  const sh = { uniforms: THREE.UniformsUtils.clone(lib(kind).uniforms), vertexShader: lib(kind).vertexShader, fragmentShader: lib(kind).fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms
  m.onBeforeCompile(sh, {} as THREE.WebGLRenderer)
  return sh
}

describe('the game look shader patch', () => {
  it('composes diffuse x tint and the decals by alpha x opacity on their own UV sets; specular map; Lambert becomes Phong for gloss', () => {
    const base = new THREE.MeshLambertMaterial({ color: 0xffffff })
    base.userData.mat = 'wall'
    const m = gameMaterial(base, { diffuse: '/d.png', look: wall }, false, ctx()) as THREE.MeshPhongMaterial
    expect(m).toBeInstanceOf(THREE.MeshPhongMaterial)
    expect(m.userData.mat).toBe('wall')
    expect(m.shininess).toBe(40)
    expect(m.normalScale.toArray()).toEqual([0.5, 0.5])
    expect(m.normalMap).toBeTruthy()
    const sh = compile(m, 'phong')
    expect(sh.fragmentShader).not.toContain('#include <map_fragment>')
    expect(sh.fragmentShader).not.toContain('#include <specularmap_fragment>')
    expect(sh.fragmentShader).toContain('srMap(srFlip(vSrUv0 * uSrR0))')
    // The helper that reads the map comes after three declares it.
    expect(sh.fragmentShader.indexOf('vec4 srMap(')).toBeGreaterThan(sh.fragmentShader.indexOf('#include <map_pars_fragment>'))
    expect(sh.fragmentShader).toContain('srC = mix(srC, srD.rgb, srD.a * uSrOp1)')
    expect(sh.fragmentShader).toContain('texture2D(uSrL1, srFlip(vSrUv1 * uSrR1))')
    expect(sh.fragmentShader).toContain('texture2D(uSrL2, srFlip(vSrUv2 * uSrR2))')
    expect(sh.fragmentShader).toContain('mix(1.0, texture2D(uSrL3, srFlip(vSrUv0 * uSrR3)).r, uSrSpecAmt)')
    expect(sh.vertexShader).toContain('attribute vec2 srUv1;')
    expect(sh.vertexShader).toContain('vSrUv2 = srUv2;')
    expect((sh.uniforms.uSrR1.value as THREE.Vector2).toArray()).toEqual([3.5, 2])
    expect(sh.uniforms.uSrOp1.value).toBe(0.6)
    // Tints are the game's (gamma) values, drawn in linear light.
    expect((sh.uniforms.uSrTint.value as THREE.Color).r).toBeCloseTo(new THREE.Color().setRGB(0.7, 0, 0, THREE.SRGBColorSpace).r)
    expect(m.userData.srAttrs).toEqual(['srUv1', 'srUv2'])
    expect(m.transparent).toBe(false)
  })

  it('patches Lambert and Standard too (the viewer may use either)', () => {
    for (const [kind, M] of [['lambert', THREE.MeshLambertMaterial], ['standard', THREE.MeshStandardMaterial]] as const) {
      const look: GameLook = { ...wall, specular: { ...wall.specular, alpha: 0 }, glow: true, selfIllum: 1 }
      const m = gameMaterial(new M(), { diffuse: '/d.png', look }, false, ctx())
      expect(m).toBeInstanceOf(M)
      const sh = compile(m, kind)
      expect(sh.fragmentShader).not.toContain('#include <map_fragment>')
      expect(sh.fragmentShader).toContain('totalEmissiveRadiance += diffuseColor.rgb * uSrGlow;')
      expect(sh.uniforms.uSrGlow.value).toBe(1)
    }
  })

  it('terrain mixes two tinted pictures by the mask RGB mean; alpha by kind', () => {
    const terrain: GameLook = { ...wall, kind: 'terrain', ground: true, base2: layer('/dirt.png', 1), tint2: [0.7, 0.6, 0.5], mask: layer('/mask.png', 2), invertMask: true, decals: [], specular: { ...wall.specular, map: undefined, alpha: 0 } }
    const t = gameMaterial(new THREE.MeshLambertMaterial(), { diffuse: '/d.png', look: terrain }, true, ctx())
    const sh = compile(t, 'lambert')
    expect(sh.fragmentShader).toContain('float srT = dot(texture2D(uSrL2, srFlip(vSrUv2 * uSrR2)).rgb, vec3(1.0 / 3.0));')
    expect(sh.fragmentShader).toContain('srT = 1.0 - srT;')
    expect(sh.fragmentShader).toContain('srC = mix(srC, texture2D(uSrL1, srFlip(vSrUv1 * uSrR1)).rgb * uSrTint2, srT);')
    // An opaque picture with holes cuts out at half alpha and writes depth.
    expect([t.transparent, t.alphaTest, t.depthWrite]).toEqual([false, 0.5, true])
    // Ground pictures arriving later get the renderer's best filtering.
    const tex = new THREE.Texture()
    ;(t as THREE.MeshLambertMaterial).map = tex
    expect(tex.anisotropy).toBe(16)

    const line: GameLook = { ...wall, kind: 'decal', blend: true, ground: true, base: undefined, decals: [{ layer: layer('/line.png', 1, [1, 12], [true, false]), opacity: 0.9 }], normal: undefined, specular: { ...wall.specular, map: undefined, alpha: 0 } }
    const d = gameMaterial(new THREE.MeshLambertMaterial(), { diffuse: '/line.png', look: line }, true, ctx())
    expect([d.transparent, d.depthWrite, d.polygonOffset, d.polygonOffsetFactor]).toEqual([true, false, true, -1])
    const dsh = compile(d, 'lambert')
    expect(dsh.fragmentShader).toContain('float srA = srD.a * uSrOp0;')
    // The clamped decal reads its own clamped copy, not the repeating map.
    expect(dsh.fragmentShader).toContain('texture2D(uSrL0, srFlip(vSrUv1 * uSrR0))')
    expect(dsh.fragmentShader).toContain('gl_FragDepth -= 3e-5;')
  })

  it('the static batch keeps the patch on its merged copy', () => {
    const m = gameMaterial(new THREE.MeshLambertMaterial(), { diffuse: '/d.png', look: { ...wall, specular: { ...wall.specular, alpha: 0 } } }, false, ctx()) as THREE.MeshLambertMaterial
    const c = copyMaterial(m)
    expect(c.onBeforeCompile).toBe(m.onBeforeCompile)
    expect(c.customProgramCacheKey()).toBe(m.customProgramCacheKey())
    expect(c.userData.lookKey).toBe(m.userData.lookKey)
    const plain = new THREE.MeshLambertMaterial()
    expect(copyMaterial(plain).onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile)
  })
})

describe('the look on the viewer geometry', () => {
  // Two triangles over four OBJ vertices; the viewer's vertices are split by v/vt corner.
  const obj = 'v 0 0 0\nv 1 0 0\nv 0 0 1\nv 1 0 1\nvt 0 0\nvt 1 0\nvt 0 1\nvt 1 1\nusemtl wall\nf 1/1 2/2 3/3\nf 3/3 2/2 4/4\nusemtl plain\nf 4/4 2/2 1/1\n'
  const model = parseObj(obj)
  const data: LookData = {
    mats: { wall: { diffuse: '/d.png', look: wall } }, vertices: 4,
    uvs: [Float32Array.from([0, 0, 10, 0, 0, 10, 10, 10]), Float32Array.from([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5])],
    normals: Float32Array.from([0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0]),
  }

  it('maps the per-OBJ-vertex data onto the split vertices, keeping computed normals where none is stored', () => {
    expect([...model.vIndex!]).toEqual([0, 1, 2, 3])
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(model.positions, 3))
    g.setIndex([...model.faces])
    g.computeVertexNormals()
    const before = g.getAttribute('normal').getY(1)
    lookGeometry(g, model, data, 'k')
    expect([...(g.getAttribute('srUv1').array as Float32Array)]).toEqual([0, 0, 10, 0, 0, 10, 10, 10])
    expect(g.getAttribute('srUv2').getX(3)).toBe(0.5)
    expect(g.getAttribute('normal').getX(3)).toBe(1)
    expect(g.getAttribute('normal').getY(1)).toBe(before)
  })

  it('an item gets its look only for materials that have one and still show the game picture', async () => {
    const files = { '/x.look': encodeLook(data) }
    const look = (await itemLook(ctx(files, model), { path: '/x.obj', game_look: { path: '/x.look' }, textures: { wall: '/d.png', plain: '/p.png' } }))!
    const m = new THREE.MeshLambertMaterial()
    expect(look.material(m, 'plain')).toBe(m)
    expect(look.material(m, 'wall')).not.toBe(m)
    // The user painted their own picture on it: drawn as before.
    const painted = (await itemLook(ctx(files, model), { path: '/x.obj', game_look: { path: '/x.look' }, textures: { wall: '/mine.png' } }))!
    const n = new THREE.MeshLambertMaterial()
    expect(painted.material(n, 'wall')).toBe(n)
    // Not from the game: no look at all.
    expect(await itemLook(ctx(), { path: '/y.obj', textures: {} })).toBeNull()
  })
})
