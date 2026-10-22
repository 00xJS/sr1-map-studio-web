// Model import. OBJ (+MTL +images) is stored as-is. GLB/glTF/FBX are baked
// to OBJ + PNG in the browser with three.js, replacing the desktop app's
// optional Blender step. Output follows Blender's OBJ export (Y up).
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { parseMtl, parseObj, type ObjModel } from './geometry'
import { storeFile, type StoredFile } from './files'
import { prepareTexture, textureSize } from './images'
import type { FileRef } from './project'

export interface ImportedModel {
  name: string
  objPath: string
  sourceName: string
  textures: Record<string, string>
  alpha: Record<string, boolean>
  triangles: number
  files: Record<string, FileRef>
  model: ObjModel
  warnings: string[]
}

const lower = (s: string) => s.toLowerCase()
const base = (s: string) => s.replace(/\\/g, '/').split('/').pop() || s
const stem = (s: string) => base(s).replace(/\.[^.]+$/, '')
const isImage = (n: string) => /\.(png|jpe?g|bmp|tga|dds|tiff?|gif|webp)$/i.test(n)

// Desktop _default_use_alpha: only obvious translucent materials opt in.
export const defaultUseAlpha = (mat: string) => ['teleporter', 'shield', 'glass', 'transparent', 'water'].some((k) => mat.toLowerCase().includes(k))

/** Import every model in a file selection; companion MTL/images are matched by name. */
export async function importModels(files: File[]): Promise<ImportedModel[]> {
  const byName = new Map(files.map((f) => [lower(base(f.name)), f]))
  const models = files.filter((f) => /\.(obj|glb|gltf|fbx)$/i.test(f.name))
  if (!models.length) throw new Error('Choose an .obj, .glb, .gltf or .fbx file (select its .mtl and textures too).')
  const out: ImportedModel[] = []
  for (const f of models) {
    if (/\.obj$/i.test(f.name)) out.push(await importObj(f, byName, files))
    else out.push(await importThree(f, byName))
  }
  return out
}

async function importObj(file: File, byName: Map<string, File>, all: File[]): Promise<ImportedModel> {
  const text = await file.text()
  const model = parseObj(text)
  if (!model.faces.length) throw new Error('OBJ has no faces: ' + file.name)
  const warnings: string[] = []
  const refs: Record<string, FileRef> = {}
  const objFile = await storeFile(file, file.name)
  refs[objFile.vpath] = objFile.ref
  let mtlFiles = model.mtllibs.map((m) => byName.get(lower(base(m)))).filter(Boolean) as File[]
  if (!mtlFiles.length) mtlFiles = all.filter((f) => /\.mtl$/i.test(f.name) && lower(stem(f.name)) === lower(stem(file.name)))
  if (model.mtllibs.length && !mtlFiles.length) warnings.push(`Select ${model.mtllibs.join(', ')} with the OBJ to load its textures automatically.`)
  const textures: Record<string, string> = {}
  const usedMats = new Set(model.mats.map((m) => m || 'default'))
  const stored = new Map<File, StoredFile>()
  for (const mtl of mtlFiles) {
    const defs = parseMtl(await mtl.text())
    for (const [mat, tex] of Object.entries(defs)) {
      if (!usedMats.has(mat)) continue
      const img = byName.get(lower(base(tex)))
      if (!img) { warnings.push(`Texture ${base(tex)} for ${mat} was not selected.`); continue }
      let s = stored.get(img)
      if (!s) {
        const prepared = await prepareTexture(img)
        if (prepared.note) warnings.push(prepared.note)
        s = await storeFile(prepared.file, prepared.file.name)
        stored.set(img, s)
      }
      refs[s.vpath] = s.ref
      textures[mat] = s.vpath
    }
  }
  const alpha = Object.fromEntries([...usedMats].map((m) => [m, defaultUseAlpha(m)]))
  return { name: stem(file.name), objPath: objFile.vpath, sourceName: file.name, textures, alpha, triangles: model.faces.length / 3, files: refs, model, warnings }
}

// ---------------- three.js based conversion ----------------

const normalizeName = (name: string, used: Set<string>) => {
  let n = (name || 'material').replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^[._]+|[._]+$/g, '').slice(0, 48) || 'material'
  const original = n
  let i = 2
  while (used.has(n)) n = `${original}_${i++}`
  used.add(n)
  return n
}

async function imageToPng(image: CanvasImageSource & { width: number; height: number }): Promise<Blob | null> {
  if (!image || !image.width || !image.height) return null
  const [w, h] = textureSize(image.width, image.height, 2048)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, w, h)
  return canvas.convertToBlob({ type: 'image/png' })
}

async function importThree(file: File, byName: Map<string, File>): Promise<ImportedModel> {
  const warnings: string[] = []
  const urls: string[] = []
  const manager = new THREE.LoadingManager()
  let pending = 0
  let settle: () => void = () => {}
  const idle = new Promise<void>((r) => { settle = r })
  manager.onStart = () => { pending++ }
  manager.onLoad = () => { pending = 0; settle() }
  manager.onError = (u) => warnings.push('Could not load ' + base(u))
  manager.setURLModifier((url) => {
    if (/^(blob:|data:)/.test(url)) return url
    const f = byName.get(lower(base(decodeURIComponent(url))))
    if (!f) return url
    const u = URL.createObjectURL(f)
    urls.push(u)
    return u
  })
  const buf = await file.arrayBuffer()
  let root: THREE.Object3D
  let flipV = false
  try {
    if (/\.fbx$/i.test(file.name)) {
      root = new FBXLoader(manager).parse(buf, '')
    } else {
      flipV = true // glTF UV origin is top-left; OBJ is bottom-left.
      const loader = new GLTFLoader(manager)
      const data: ArrayBuffer | string = /\.gltf$/i.test(file.name) ? new TextDecoder().decode(buf) : buf
      root = (await loader.parseAsync(data, '')).scene
    }
    if (pending) await Promise.race([idle, new Promise((r) => setTimeout(r, 8000))])
    return await bakeToObj(root, file, flipV, warnings)
  } finally {
    urls.forEach((u) => URL.revokeObjectURL(u))
  }
}

async function bakeToObj(root: THREE.Object3D, file: File, flipV: boolean, warnings: string[]): Promise<ImportedModel> {
  root.updateMatrixWorld(true)
  const lines: string[] = ['# Baked by SR1 Map Studio web from ' + file.name]
  const used = new Set<string>()
  const matNames = new Map<THREE.Material, string>()
  const matTextures = new Map<string, THREE.Texture | null>()
  let vBase = 1
  let triangles = 0
  const v = new THREE.Vector3()
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const g = mesh.geometry as THREE.BufferGeometry
    const posAttr = g.getAttribute('position')
    if (!posAttr) return
    const uvAttr = g.getAttribute('uv')
    const flip = mesh.matrixWorld.determinant() < 0
    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld)
      lines.push(`v ${+v.x.toFixed(6)} ${+v.y.toFixed(6)} ${+v.z.toFixed(6)}`)
    }
    for (let i = 0; i < posAttr.count; i++) {
      const uu = uvAttr ? uvAttr.getX(i) : 0
      const vv = uvAttr ? uvAttr.getY(i) : 0
      lines.push(`vt ${+uu.toFixed(6)} ${+(flipV ? 1 - vv : vv).toFixed(6)}`)
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const nameFor = (m: THREE.Material | undefined) => {
      const key = m || materials[0]
      let n = matNames.get(key)
      if (!n) {
        n = normalizeName(key?.name || stem(file.name), used)
        matNames.set(key, n)
        matTextures.set(n, ((key as THREE.MeshStandardMaterial)?.map) || null)
      }
      return n
    }
    const index = g.getIndex()
    const count = index ? index.count : posAttr.count
    const at = (k: number) => (index ? index.getX(k) : k)
    const groups = g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }]
    for (const grp of groups) {
      lines.push('usemtl ' + nameFor(materials[grp.materialIndex ?? 0]))
      const end = Math.min(grp.start + grp.count, count)
      for (let k = grp.start; k + 2 < end; k += 3) {
        let [a, b, c] = [at(k), at(k + 1), at(k + 2)]
        if (flip) [b, c] = [c, b]
        lines.push(`f ${a + vBase}/${a + vBase} ${b + vBase}/${b + vBase} ${c + vBase}/${c + vBase}`)
        triangles++
      }
    }
    vBase += posAttr.count
  })
  if (!triangles) throw new Error(file.name + ' contains no mesh triangles.')
  const objName = stem(file.name) + '.obj'
  const objBlob = new Blob([lines.join('\n') + '\n'], { type: 'model/obj' })
  const objStored = await storeFile(objBlob, objName)
  const refs: Record<string, FileRef> = { [objStored.vpath]: objStored.ref }
  const textures: Record<string, string> = {}
  for (const [mat, tex] of matTextures) {
    if (!tex) continue
    const png = await imageToPng(tex.image as any).catch(() => null)
    if (!png) { warnings.push(`Material ${mat} has a texture that could not be read.`); continue }
    const s = await storeFile(png, `${mat}.png`)
    refs[s.vpath] = s.ref
    textures[mat] = s.vpath
  }
  const model = parseObj(await objBlob.text())
  const alpha = Object.fromEntries(model.mats.map((m) => [m || 'default', defaultUseAlpha(m)]))
  return { name: stem(file.name), objPath: objStored.vpath, sourceName: file.name, textures, alpha, triangles, files: refs, model, warnings }
}

/** A texture image, turned upright and capped at maxSize (see images.ts). */
export async function importImage(file: File, maxSize = 2048): Promise<StoredFile & { note?: string }> {
  if (!isImage(file.name)) throw new Error('Choose an image: PNG, JPG, TGA, BMP, TIFF or DDS.')
  const prepared = await prepareTexture(file, maxSize)
  return { ...(await storeFile(prepared.file, prepared.file.name)), note: prepared.note }
}
