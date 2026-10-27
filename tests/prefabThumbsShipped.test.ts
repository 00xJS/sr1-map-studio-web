// The prefab thumbnails the site ships (public/thumbs, drawn by npm run thumbs) match the prefabs as they are now,
// and were drawn with the renderer and texture generators as they are now (scripts/thumbSources.mjs).
// A prefab whose parts changed would still get a picture (drawn live in the visitor's browser), but slowly.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ALL_PREFABS } from '../src/lib/prefabRegistry'
import { prefabThumbSig } from '../src/lib/prefabIndex'
import { drawingSources } from '../scripts/thumbSources.mjs'

const dir = new URL('../public/thumbs/', import.meta.url)
const manifest: Record<string, string> = existsSync(new URL('manifest.json', dir)) ? JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8')) : {}
const drawnWith: Record<string, string> = existsSync(new URL('drawn-with.json', dir)) ? JSON.parse(readFileSync(new URL('drawn-with.json', dir), 'utf8')) : {}
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

  it('were drawn with the current renderer, texture generators and texture previews', () => {
    const now = drawingSources(fileURLToPath(new URL('..', import.meta.url)))
    const changed = [...new Set([...Object.keys(now), ...Object.keys(drawnWith)])].filter((f) => now[f] !== drawnWith[f])
    expect(changed, `What the prefab thumbnails are drawn with changed: ${changed.join(', ')}. If prefabs look different now, bump THUMB_VERSION `
      + 'in src/lib/prefabIndex.ts (pictures visitors already have are kept until it changes). Either way, run `npm run thumbs` '
      + '(it draws every picture again; the git diff shows which really changed) and commit public/thumbs.').toEqual([])
  })
})
