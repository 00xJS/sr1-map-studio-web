// A map's chunk and texture files into what the editor makes a project from: its pieces (scene.ts), one decoded
// picture per material from the map's own texture file, the sky picture the template's sky box drew, and the
// loading screen (ld-<map>.peg_xbox2). Pure: runs in the map folder worker and in Node tests.
import { readChunk } from '../gameObjects/chunk'
import { INVISIBLE_TEXTURE, findShared, findTexture, hasAlpha, indexPeg, shrink, type PegIndex } from '../gameObjects/textures'
import { decodeEntry, parsePeg, type PegImage } from '../sr1char/peg'
import { FAKE_SKY, chunkSoup, sceneOrigin, splitScene, type MapPiece } from './scene'

export interface SceneTexture { width: number; height: number; rgba: ArrayBuffer; alpha: boolean }

export interface MapScene {
  pieces: MapPiece[]
  /** Texture name per material (pieces index into it), and its picture (null: not in the map's files). */
  materials: string[]
  textures: (SceneTexture | null)[]
  /** The game point the editor's origin is put at (middle across, lowest point). */
  origin: [number, number, number]
  /** The picture the template's sky box drew, and the loading screen. */
  sky: SceneTexture | null
  loading: SceneTexture | null
  skipped: { fakeSky: number; skyObjects: number }
  /** Triangles in the chunk, and in the pieces (back-face copies folded into double-sided pieces). */
  triangles: { chunk: number; pieces: number }
}

const pic = (img: PegImage, max: number): SceneTexture => {
  const s = shrink(img, max)
  return { width: s.width, height: s.height, rgba: s.rgba.slice().buffer, alpha: hasAlpha(s) }
}

/** `pegs`: the map's texture files, its own first. */
export function readMapScene(chunk: Uint8Array, pegs: Uint8Array[], loading: Uint8Array | null, texSize = 1024): MapScene {
  const ch = readChunk(chunk)
  const { soup, instances, skipped, fakeSky } = chunkSoup(ch)
  const pieces = splitScene(soup, instances)
  const index: PegIndex[] = []
  for (const p of pegs) { try { index.push(indexPeg(p)) } catch { /* not a texture file: its pictures stay grey */ } }
  const textures = soup.materials.map((name): SceneTexture | null => {
    if (!name) return null
    if (INVISIBLE_TEXTURE.test(name)) return { width: 8, height: 8, rgba: new Uint8Array(8 * 8 * 4).buffer, alpha: true }
    const img = findTexture(name, index) ?? findShared(name, index)
    return img ? pic(img, texSize) : null
  })
  const skyImg = fakeSky ? findTexture(FAKE_SKY, index) : null
  let load: SceneTexture | null = null
  if (loading) {
    try {
      const peg = parsePeg(loading)
      const e = peg.entries.find((x) => x.size)
      const img = e ? decodeEntry(peg, e) : null
      if (img) load = { width: img.width, height: img.height, rgba: img.rgba.slice().buffer, alpha: false }
    } catch { /* no loading screen */ }
  }
  return {
    pieces, materials: soup.materials, textures, origin: sceneOrigin(soup), sky: skyImg ? pic(skyImg, 2048) : null, loading: load, skipped,
    triangles: { chunk: soup.mat.length, pieces: pieces.reduce((a, p) => a + p.look.length, 0) },
  }
}

/** The buffers to hand over without copying. */
export function sceneTransfer(s: MapScene): Transferable[] {
  const out: Transferable[] = []
  for (const p of s.pieces) out.push(p.mesh.positions.buffer, p.mesh.uvs.buffer, p.mesh.triangles.buffer, p.mesh.triMaterial.buffer, p.look.buffer)
  for (const t of [...s.textures, s.sky, s.loading]) if (t) out.push(t.rgba)
  return out
}
