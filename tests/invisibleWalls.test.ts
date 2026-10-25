// Invisible walls (src/lib/invisibleWalls.ts): the health check's sliver test, the same rule as py/collision_fix.py.
import { describe, expect, it } from 'vitest'
import { findSlivers, isSliver } from '../src/lib/invisibleWalls'

const T = (...p: number[]) => Float32Array.from(p)

describe('invisible walls', () => {
  it('calls three corners in a line, or two in one place, a sliver; a thin strip with width and ordinary triangles are not', () => {
    expect(isSliver(T(0, 0, 0, 3, 0, 0, 6.83, 0.0001, 0), 0)).toBe(true)
    expect(isSliver(T(0, 0, 0, 0, 0, 0, 1, 1, 1), 0)).toBe(true)
    expect(isSliver(T(0, 0, 0, 2, 0, 0, 0, 0.02, 0), 0)).toBe(false)
    expect(isSliver(T(0, 0, 0, 1, 0, 0, 0, 1, 0), 0)).toBe(false)
  })

  it('counts only solid ones, and says where they are', () => {
    const tris = T(0, 0, 0, 1, 0, 0, 0, 1, 0, /* sliver */ 0, 0, 0, 3, 0, 0, 6, 0, 0, /* sliver, look only */ 0, 0, 0, 3, 0, 0, 6, 0, 0)
    const r = findSlivers(tris, Uint8Array.from([1, 1, 0]))
    expect(r.count).toBe(1)
    expect(r.places[0]).toEqual([3, 0, 0])
  })
})
