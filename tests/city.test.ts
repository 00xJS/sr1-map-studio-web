// The city cut-out and hole scan (src/lib/city): the collision reader and the clipping on made-up data, and the
// whole thing on a local game install when there is one (SR1_PACKFILES, or the default install folder).
// Nothing from the game is copied into the repo.
import { describe, expect, it } from 'vitest'
import { existsSync, openAsBlob } from 'node:fs'
import { join } from 'node:path'
import { moppKeys } from '../src/lib/city/collision'
import { Grid, clip, cutArea, isCityChunk, scanArea, triangleKey } from '../src/lib/city/city'
import { openVpp } from '../src/lib/sr1char/vpp'
import { readChunk } from '../src/lib/gameObjects/chunk'

describe('collision keys', () => {
  it('reads terminals, offsets and both branches of a split', () => {
    // A split (0x23) whose two branches end at keys 3 and 0x45 + offset 0x100.
    const left = [0x33]
    const right = [0x09, 0x10, 0x50, 0x45 - 0x10 + 0x100 - 0x100]
    const code = [0x23, 0, 0, 0, 0, 0, left.length, ...left, ...right]
    expect(moppKeys(Uint8Array.from(code)).sort((a, b) => a - b)).toEqual([3, 0x45])
    expect(moppKeys(Uint8Array.from([0x51, 0x01, 0x02]))).toEqual([0x102])
    expect(moppKeys(new Uint8Array())).toEqual([])
    expect(() => moppKeys(Uint8Array.from([0xff]))).toThrow(/opcode/)
  })
})

describe('cutting at the edge', () => {
  const r = { x0: 0, z0: 0, x1: 10, z1: 10 }
  it('keeps what is inside, trims what crosses, drops what is outside', () => {
    const inside = [[1, 0, 1, 0, 0], [2, 0, 1, 1, 0], [1, 0, 2, 0, 1]]
    expect(clip(inside, r)).toHaveLength(3)
    const across = [[-5, 0, 5, 0, 0], [5, 0, 5, 1, 0], [-5, 0, 6, 0, 1]]
    const cut = clip(across, r)
    expect(cut.length).toBeGreaterThanOrEqual(3)
    for (const v of cut) expect(v[0]).toBeGreaterThanOrEqual(-1e-9)
    // UVs carried along the cut: the corner at x = 0 on the bottom edge is halfway along u.
    expect(cut.some((v) => Math.abs(v[0]) < 1e-9 && Math.abs(v[2] - 5) < 1e-9 && Math.abs(v[3] - 0.5) < 1e-9)).toBe(true)
    expect(clip([[-5, 0, -5, 0, 0], [-4, 0, -5, 0, 0], [-5, 0, -4, 0, 0]], r)).toEqual([])
  })

  it('the grid finds the height under a sloped triangle', () => {
    const g = new Grid({ x0: 0, z0: 0, x1: 4, z1: 4 }, 2)
    const hits: [number, number][] = []
    g.cover(Float64Array.from([0, 0, 0, 4, 4, 0, 0, 0, 4]), (i, y) => hits.push([i, y]))
    expect(hits.map(([i]) => i)).toEqual([0, 1, 2])
    expect(hits[1][1]).toBeCloseTo(3)
  })

  it('the same triangle from two chunks has one key, whatever corner comes first', () => {
    expect(triangleKey(Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe(triangleKey(Float64Array.from([4, 5, 6, 7, 8, 9, 1, 2, 3])))
  })
})

const GAME = process.env.SR1_PACKFILES || 'C:/Games/SaintsReborn/dist/game/packfiles'
const haveGame = existsSync(join(GAME, 'sr_city_stream.vpp_xbox2'))

describe.skipIf(!haveGame)('the city from a local game install', () => {
  it('cuts a downtown block with its textures named, solid and look-only apart, and finds street level', async () => {
    const vpp = await openVpp(await openAsBlob(join(GAME, 'sr_city_stream.vpp_xbox2')), 'city')
    expect(vpp.list().filter((n) => n.endsWith('.bbchunk_xbox2')).map((n) => n.slice(0, -14)).filter(isCityChunk).length).toBeGreaterThan(150)
    const chunks: [string, ReturnType<typeof readChunk>][] = []
    for (const s of ['sr_chunk13', 'sr_chunk14', 'sr_chunk15']) chunks.push([s, readChunk(await vpp.read(s + '.bbchunk_xbox2'))])
    const r = { x0: -10, z0: 658, x1: 130, z1: 798 }
    const cut = cutArea(chunks, r)
    expect(cut.solid.triangles.length / 3).toBeGreaterThan(10000)
    expect(cut.look.triangles.length / 3).toBeGreaterThan(5000)
    expect(cut.solid.materials.filter(Boolean).length).toBeGreaterThan(50)
    expect(cut.ground).toBeGreaterThan(-8)
    expect(cut.ground).toBeLessThan(0)
    expect(cut.standable.length).toBeGreaterThan(500)
    // Everything inside the area (decals lifted 2 cm may poke out a hair), centred on it.
    for (let i = 0; i < cut.solid.positions.length; i += 3) {
      expect(Math.abs(cut.solid.positions[i])).toBeLessThanOrEqual(70.05)
      expect(Math.abs(cut.solid.positions[i + 2])).toBeLessThanOrEqual(70.05)
    }
    // The scan finds the raised slab beside the street with nothing solid under it.
    const holes = scanArea(chunks, r)
    expect(holes.some((h) => h.kind === 'fall' && Math.hypot(h.x - 69, h.z - 690) < 20 && h.above < 6)).toBe(true)
  }, 300000)
})
