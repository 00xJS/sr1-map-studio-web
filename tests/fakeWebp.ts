// A WebP file's container and frame header, enough for the preview checks
// (src/play/share.ts previewProblem): no real image data.

/** RIFF/WEBP with a lossy frame of w × h, plus any extra chunks given. */
export function fakeWebp(w = 640, h = 360, extra: [string, number[]][] = []): Uint8Array {
  const chunks: [string, number[]][] = [...extra.filter(([k]) => k === 'VP8X'), ['VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, w & 255, w >> 8, h & 255, h >> 8, 1, 1]], ...extra.filter(([k]) => k !== 'VP8X')]
  const body: number[] = [...'WEBP'].map((c) => c.charCodeAt(0))
  for (const [kind, bytes] of chunks) {
    const n = bytes.length
    body.push(...[...kind].map((c) => c.charCodeAt(0)), n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24, ...bytes, ...(n & 1 ? [0] : []))
  }
  const n = body.length
  return new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24], body))
}
