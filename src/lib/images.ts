// Getting images ready to be map textures. The exporter reads files with
// Pillow, which ignores the EXIF rotation phones write, and rounds each side
// to a power of two with no upper limit (a 12 MP photo becomes 4096x2048).
// So images are baked upright and sized here, before the exporter sees them.

/** EXIF orientation (1-8) of a JPEG, or 1 when absent. */
export function jpegOrientation(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1
  let i = 2
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) return 1
    const marker = bytes[i + 1]
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(i + 4, i + 8)) === 'Exif') {
      const t = i + 10 // TIFF header
      const le = bytes[t] === 0x49
      const u16 = (o: number) => (le ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1])
      const u32 = (o: number) => (le ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0 : ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0)
      const ifd = t + u32(t + 4)
      const count = u16(ifd)
      for (let e = 0; e < count; e++) {
        const at = ifd + 2 + e * 12
        if (at + 10 > bytes.length) break
        if (u16(at) === 0x0112) {
          const v = u16(at + 8)
          return v >= 1 && v <= 8 ? v : 1
        }
      }
      return 1
    }
    if (marker === 0xda) return 1 // image data starts; no EXIF before it
    i += 2 + len
  }
  return 1
}

/** Nearest power of two, the size the exporter would stretch to anyway. */
export const pow2 = (n: number) => 2 ** Math.round(Math.log2(Math.max(1, n)))

/** Fit (w, h) under maxSize and snap each side to a power of two. */
export function textureSize(w: number, h: number, maxSize: number): [number, number] {
  const k = Math.min(1, maxSize / Math.max(w, h))
  return [Math.min(maxSize, pow2(w * k)), Math.min(maxSize, pow2(h * k))]
}

const BROWSER_IMAGE = /\.(png|jpe?g|bmp|gif|webp)$/i

export interface Prepared { file: File; note?: string }

/**
 * Bakes rotation and caps the size of an image the browser can read.
 * TGA/DDS/TIFF pass through unchanged (the exporter reads them itself).
 */
export async function prepareTexture(file: File, maxSize = 2048): Promise<Prepared> {
  if (!BROWSER_IMAGE.test(file.name)) return { file }
  const orientation = /\.jpe?g$/i.test(file.name) ? jpegOrientation(new Uint8Array(await file.slice(0, 131072).arrayBuffer())) : 1
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const [w, h] = textureSize(bitmap.width, bitmap.height, maxSize)
    const resize = w !== bitmap.width || h !== bitmap.height
    if (orientation === 1 && !resize) return { file }
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, w, h)
    const jpeg = /\.jpe?g$/i.test(file.name)
    const blob = await canvas.convertToBlob(jpeg ? { type: 'image/jpeg', quality: 0.92 } : { type: 'image/png' })
    const name = file.name.replace(/\.[^.]+$/, jpeg ? '.jpg' : '.png')
    const notes = [orientation !== 1 && 'turned upright', resize && `resized from ${bitmap.width}×${bitmap.height} to ${w}×${h}`].filter(Boolean)
    return { file: new File([blob], name, { type: blob.type }), note: `${file.name}: ${notes.join(', ')}` }
  } finally {
    bitmap.close()
  }
}

// ---------------- pixel tools for the texture studio ----------------

/**
 * Makes an RGBA image tile without seams. Each axis in turn: blend with a
 * copy shifted by half the image, using the shifted copy near the edges (its
 * pixels continue across the wrap) and the original in the middle, where the
 * shifted copy has its own seam. Doing the axes separately keeps the first
 * axis tileable. blend 0..1 = crossfade width as a fraction of half the image.
 */
export function makeSeamless(src: Uint8ClampedArray, w: number, h: number, blend = 0.5): Uint8ClampedArray {
  const pass = (img: Uint8ClampedArray, horizontal: boolean) => {
    const out = new Uint8ClampedArray(img.length)
    const len = horizontal ? w : h
    const band = Math.max(1, (len / 2) * Math.min(1, Math.max(0.05, blend)))
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = horizontal ? x : y
        const m = Math.max(0, 1 - Math.min(p, len - 1 - p) / band)
        const t = m * m * (3 - 2 * m) // smoothstep
        const a = (y * w + x) * 4
        const b = horizontal ? (y * w + ((x + (w >> 1)) % w)) * 4 : ((((y + (h >> 1)) % h) * w) + x) * 4
        for (let c = 0; c < 4; c++) out[a + c] = img[a + c] * (1 - t) + img[b + c] * t
      }
    }
    return out
  }
  return pass(pass(src, true), false)
}

/**
 * Evens out lighting: divides each pixel by the local brightness (a heavily
 * blurred copy, same size) and rescales to the image's average.
 */
export function flattenLighting(src: Uint8ClampedArray, blurred: Uint8ClampedArray, amount = 1): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length)
  const avg = [0, 0, 0]
  const n = src.length / 4
  for (let i = 0; i < src.length; i += 4) for (let c = 0; c < 3; c++) avg[c] += blurred[i + c]
  for (let c = 0; c < 3; c++) avg[c] /= n
  for (let i = 0; i < src.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const flat = (src[i + c] * avg[c]) / Math.max(8, blurred[i + c])
      out[i + c] = src[i + c] + (flat - src[i + c]) * amount
    }
    out[i + 3] = src[i + 3]
  }
  return out
}
