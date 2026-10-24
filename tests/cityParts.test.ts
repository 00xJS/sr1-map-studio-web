// A city object's parts (a frontage's windows, posters and doors as objects of their own) and the plain names
// for the game's objects and parts.
import { describe, expect, it } from 'vitest'
import { splitParts } from '../src/lib/city/parts'
import { objectName, partName } from '../src/lib/city/names'

/** A flat quad (two triangles) at z, from (x0, y0) to (x1, y1): 18 numbers. */
const quad = (x0: number, y0: number, x1: number, y1: number, z: number) =>
  [x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z]

describe('the parts of a city object', () => {
  const TEX = ['C19_brick_co.tga', 'B38_window01_gl.tga', 'F38_BasePoster_gl.tga', 'A12_dirt_d.tga', 'billboardframe_me.tga']
  // A 10 × 6 m wall, a window, a poster with its frame (two touching pieces) and a grime overlay on the wall.
  const pos = [...quad(0, 0, 10, 6, 0), ...quad(1, 1, 3, 3, 0.02), ...quad(5, 1, 6, 3, 0.03), ...quad(4.9, 0.9, 6.1, 3.1, 0.02), ...quad(0, 0, 4, 1, 0.01)]
  const mat = [0, 0, 1, 1, 2, 2, 4, 4, 3, 3]
  const look = [0, 0, 0, 0, 1, 1, 0, 0, 1, 1]

  it('keeps the wall (and its grime) as the object, and gives the window and the framed poster their own', () => {
    const parts = splitParts(pos, mat, (m) => TEX[m], look, 'Building')
    expect(parts.map((p) => p.name)).toEqual(['Building', 'Window', 'Poster'])
    expect(parts[0].tris).toEqual([0, 1, 8, 9])
    expect(parts[1].tris).toEqual([2, 3])
    // The poster and the frame round it touch: one part.
    expect(parts[2].tris).toEqual([4, 5, 6, 7])
    expect(parts.flatMap((p) => p.tris).sort((a, b) => a - b)).toEqual([...Array(10).keys()])
  })

  it('leaves an object with one material whole, and folds specks into it', () => {
    expect(splitParts(quad(0, 0, 2, 2, 0), [0, 0], () => 'conc4_co.tga', [0, 0], 'Wall')).toEqual([{ tris: [0, 1], name: 'Wall' }])
    const speck = splitParts([...quad(0, 0, 2, 2, 0), ...quad(5, 5, 5.05, 5.05, 0)], [0, 0, 1, 1], (m) => ['conc4_co.tga', 'screw_me.tga'][m], [0, 0, 0, 0], 'Wall')
    expect(speck).toEqual([{ tris: [0, 1, 2, 3], name: 'Wall' }])
  })
})

describe('plain names', () => {
  it('reads the game codes for objects', () => {
    expect(objectName('ap_trshd')).toBe('Trash can')
    expect(objectName('apb_prkblk')).toBe('Parking block')
    expect(objectName('utilitypolea')).toBe('Utility pole')
    expect(objectName('psemitrailera')).toBe('Semi trailer')
    expect(objectName('boxcara')).toBe('Boxcar')
    expect(objectName('cardboardboxa')).toBe('Cardboard box')
    expect(objectName('ap_lmpststa')).toBe('Street lamp')
    // "street" is not a tree.
    expect(objectName('ter_street01')).toBe('Road')
    // A record that only says where it is gives way to a texture that says what it is.
    expect(objectName('ter_street_dec01', 'AllTrash_01_pl.tga')).toBe('Trash')
    // A code with no words: the texture names it.
    expect(objectName('bstvk_a_medsa', 'B38_window02_gl.tga')).toBe('Window')
    expect(objectName('glassbar', 'missing-alpha.tga')).toBe('Invisible blocker')
  })

  it('names building parts from their textures, and falls back to the surface they are', () => {
    expect(partName('B11_window_tm.tga')).toBe('Window')
    expect(partName('H01_doorfr_wo.tga')).toBe('Door')
    expect(partName('C15_toptrim_co.tga')).toBe('Trim')
    expect(partName('A14_rainpipe_tm.tga')).toBe('Pipe')
    expect(partName('Ter_2YellowStrp_co.tga')).toBe('Road paint')
    expect(partName('zz123_qq_wo.tga')).toBe('Wood')
    expect(partName('zz123')).toBe('')
  })
})
