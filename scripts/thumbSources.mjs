// What the prefab thumbnails are drawn with besides each prefab's parts: the renderer, the texture generators,
// the shape builders and the starter library's small texture previews. npm run thumbs records a hash of each in
// public/thumbs/drawn-with.json; tests/prefabThumbsShipped.test.ts fails when one has changed since.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const DRAWING_SOURCES = [
  'src/lib/prefabRender.ts', 'src/lib/procedural.ts', 'src/lib/signFont.ts', 'src/lib/shapes.ts', 'src/lib/zfight.ts', 'src/lib/geometry.ts',
  'public/textures/thumbs',
]

const hash = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16)
// Text the same on every checkout (Windows gets CRLF); pictures as they are.
const read = (f) => (/\.(ts|mjs|js|json)$/.test(f) ? readFileSync(f, 'utf8').replace(/\r\n/g, '\n') : readFileSync(f))

/** Path (relative to the web root, forward slashes) → short hash, for every file the thumbnails are drawn with. */
export function drawingSources(root) {
  const out = {}
  for (const src of DRAWING_SOURCES) {
    const full = join(root, src)
    const files = statSync(full).isDirectory() ? readdirSync(full).sort().map((f) => `${src}/${f}`) : [src]
    for (const f of files) out[f] = hash(read(join(root, f)))
  }
  return out
}
