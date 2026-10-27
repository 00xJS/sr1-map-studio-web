// The prefab thumbnails the site ships (public/thumbs, drawn by npm run thumbs) match the prefabs as they are now.
// A prefab whose parts changed would still get a picture (drawn live in the visitor's browser), but slowly.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ALL_PREFABS } from '../src/lib/prefabRegistry'
import { prefabThumbSig } from '../src/lib/prefabIndex'

const dir = new URL('../public/thumbs/', import.meta.url)
const manifest: Record<string, string> = existsSync(new URL('manifest.json', dir)) ? JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8')) : {}
const RERUN = 'Prefab thumbnails are out of date: run `npm run thumbs` and commit public/thumbs.'

describe('shipped prefab thumbnails', () => {
  it('match every prefab\'s current parts', () => {
    const stale = Object.keys(ALL_PREFABS).filter((k) => manifest[k] !== prefabThumbSig(k))
    expect(stale, `${RERUN} Changed or new: ${stale.join(', ')}`).toEqual([])
  })

  it('are only for prefabs that exist, each with its picture', () => {
    const extra = Object.keys(manifest).filter((k) => !(k in ALL_PREFABS) || !existsSync(new URL(k + '.webp', dir)))
    expect(extra, `${RERUN} Gone or missing a picture: ${extra.join(', ')}`).toEqual([])
  })
})
